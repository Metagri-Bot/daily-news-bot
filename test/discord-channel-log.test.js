'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  snowflakeFromDate,
  dateFromSnowflake,
  compareSnowflake,
  toJstTimestamp,
  buildContent,
  collectChannelMessages,
  runDiscordChannelLog
} = require('../discord-channel-log');

const { toRecord, normalizeCursors, saveRows } = require('../discord-channel-log-store');

/** Discord API の after 挙動（IDの直後から古い順に返す）を再現するダミーチャンネル */
function makeChannel({ id = '1029635603807096842', name = 'テスト日誌', messages = [] } = {}) {
  const calls = [];
  return {
    id,
    name,
    calls,
    messages: {
      async fetch({ limit, after }) {
        calls.push({ limit, after });
        const target = messages
          .filter(m => compareSnowflake(m.id, after) > 0)
          .sort((a, b) => compareSnowflake(a.id, b.id))
          .slice(0, limit);
        // Discordは新しい順で返してくるので、その順序でも壊れないことを確かめる
        return new Map(target.reverse().map(m => [m.id, m]));
      }
    }
  };
}

function makeMessage({ id, userId = '798046999588372490', username = 'noujoujin', displayName = 'NouJouJin', content = 'テスト', bot = false }) {
  return {
    id,
    channelId: '1029635603807096842',
    createdAt: dateFromSnowflake(id),
    author: { id: userId, username, globalName: displayName, bot },
    member: { displayName },
    content,
    attachments: new Map(),
    embeds: []
  };
}

test('snowflakeは時刻へ往復でき、桁数違いも正しく比較できる', () => {
  const date = new Date('2025-08-23T00:38:37.908Z');
  const id = snowflakeFromDate(date);
  assert.strictEqual(dateFromSnowflake(id).getTime(), date.getTime());
  // 19桁 > 18桁。単純な文字列比較だと '9...'(18桁) が '1...'(19桁) より大きくなり誤る
  assert.ok(compareSnowflake('1409336131329331310', '999999999999999999') > 0);
});

test('TimestampはJSTの表示になる（サンプルの 2025/08/23 9:38:38 と同じ土俵）', () => {
  assert.strictEqual(toJstTimestamp('2025-08-23T00:38:37.908Z'), '2025/08/23 09:38:37');
});

test('本文が空の投稿は添付・埋め込みで補われる', () => {
  const content = buildContent({
    content: '   ',
    attachments: new Map([['a', { url: 'https://example.com/a.png' }]]),
    embeds: [{ title: '記事タイトル', url: 'https://example.com/news' }]
  });
  assert.match(content, /\[attachment\] https:\/\/example\.com\/a\.png/);
  assert.match(content, /\[embed\] 記事タイトル https:\/\/example\.com\/news/);
});

test('カーソル以降だけを古い順に集め、100件超はページングする', async () => {
  const base = BigInt(snowflakeFromDate(new Date('2025-08-20T00:00:00Z')));
  const messages = [];
  for (let i = 0; i < 250; i++) {
    messages.push(makeMessage({ id: String(base + BigInt(i + 1) * (1n << 22n)), content: `msg-${i}` }));
  }
  const channel = makeChannel({ messages });

  const result = await collectChannelMessages({ channel, afterId: String(base), maxMessages: 1000 });

  assert.strictEqual(result.rows.length, 250);
  assert.strictEqual(result.rows[0].content, 'msg-0');
  assert.strictEqual(result.rows[249].content, 'msg-249');
  assert.strictEqual(result.lastMessageId, messages[249].id);
  assert.ok(channel.calls.length >= 3, 'ページングが走っている');
  // 2回目以降のfetchは1回目のバッチの最大IDを起点にしている
  assert.strictEqual(compareSnowflake(channel.calls[1].after, channel.calls[0].after) > 0, true);
});

test('同じカーソルで2回走らせても2回目は0件（重複しない）', async () => {
  const base = BigInt(snowflakeFromDate(new Date('2025-08-20T00:00:00Z')));
  const messages = [makeMessage({ id: String(base + (1n << 22n)) })];
  const channel = makeChannel({ messages });

  const first = await collectChannelMessages({ channel, afterId: String(base) });
  const second = await collectChannelMessages({ channel, afterId: first.lastMessageId });

  assert.strictEqual(first.rows.length, 1);
  assert.strictEqual(second.rows.length, 0);
  assert.strictEqual(second.lastMessageId, first.lastMessageId, 'カーソルは後退しない');
});

test('includeBots=false のときだけBot投稿が落ちる', async () => {
  const base = BigInt(snowflakeFromDate(new Date('2025-08-20T00:00:00Z')));
  const messages = [
    makeMessage({ id: String(base + (1n << 22n)), content: '人間' }),
    makeMessage({ id: String(base + 2n * (1n << 22n)), content: '８月２３日のまとめ', bot: true })
  ];

  const withBots = await collectChannelMessages({ channel: makeChannel({ messages }), afterId: String(base), includeBots: true });
  const withoutBots = await collectChannelMessages({ channel: makeChannel({ messages }), afterId: String(base), includeBots: false });

  assert.strictEqual(withBots.rows.length, 2);
  assert.strictEqual(withoutBots.rows.length, 1);
  // Bot投稿を除いてもカーソルは最新まで進む必要がある（進まないと毎回同じ範囲を取り直す）
  assert.strictEqual(withoutBots.cursor, messages[1].id);
});

test('カーソルが無いチャンネルは lookbackDays から起こす', async () => {
  const now = new Date('2025-08-23T00:00:00Z');
  const channel = makeChannel({ messages: [] });
  await collectChannelMessages({ channel, afterId: null, lookbackDays: 7, now });
  const startedAt = dateFromSnowflake(channel.calls[0].after);
  assert.strictEqual(startedAt.toISOString(), '2025-08-16T00:00:00.000Z');
});

test('1チャンネルが失敗しても他のチャンネルの収集は止まらない', async () => {
  const base = BigInt(snowflakeFromDate(new Date('2025-08-20T00:00:00Z')));
  const ok = makeChannel({ id: '111', name: 'ok', messages: [makeMessage({ id: String(base + (1n << 22n)) })] });

  const result = await runDiscordChannelLog({
    channelIds: ['999', '111', '111'],   // 重複指定は1本に畳まれる
    fetchChannel: async id => {
      if (id === '999') throw new Error('Missing Access');
      return ok;
    },
    cursors: { '111': String(base) },
    logger: { error() {} }
  });

  assert.strictEqual(result.stats.channels, 2);
  assert.strictEqual(result.rows.length, 1);
  assert.strictEqual(result.errors.length, 1);
  assert.match(result.errors[0], /999/);
  assert.strictEqual(result.perChannel[0].channelId, '111');
});

test('シートへ送る行は9列すべて文字列になる（IDが数値へ丸められない）', () => {
  const record = toRecord({
    timestamp: '2025/08/23 09:38:37',
    date: '2025-08-23T00:38:37.908Z',
    messageId: '1409336131329331310',
    userId: '798046999588372490',
    userName: 'noujoujin',
    displayName: 'NouJouJin',
    content: '８月２３日のまとめ',
    channelId: '1029635603807096842',
    channelName: '📔｜ꓟetagri日誌'
  });
  assert.strictEqual(Object.keys(record).length, 9);
  Object.values(record).forEach(value => assert.strictEqual(typeof value, 'string'));
  assert.strictEqual(record.messageId, '1409336131329331310');
});

test('保存が途中で失敗したら打ち切ってエラーを返す（カーソルを進めさせない）', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ messageId: String(i + 1) }));
  let calls = 0;
  const result = await saveRows({
    gasUrl: 'https://example.com/exec',
    rows,
    chunkSize: 2,
    logger: { error() {} },
    post: async () => {
      calls += 1;
      if (calls === 2) throw new Error('GAS timeout');
      return { success: true, appended: 2, skipped: 0 };
    }
  });
  assert.strictEqual(result.sent, 2);
  assert.strictEqual(result.errors.length, 1);
  assert.strictEqual(calls, 2, '失敗した時点で止まる');
});

test('カーソルの正規化は空値を落とし、文字列へ揃える', () => {
  assert.deepStrictEqual(
    normalizeCursors({ '111': 1409336131329331310n.toString(), '222': '', '': '333' }),
    { '111': '1409336131329331310' }
  );
});

test('GASのHTTPエラーは「何を直すか」まで言い当てる', () => {
  const { describeGasError } = require('../discord-channel-log-store');
  assert.match(describeGasError({ response: { status: 401 } }), /アクセスできるユーザー: 全員/);
  assert.match(describeGasError({ response: { status: 403 } }), /次のユーザーとして実行: 自分/);
  assert.match(describeGasError({ response: { status: 404 } }), /URLが古いデプロイ/);
  assert.match(describeGasError({ response: { status: 500 } }), /実行ログ/);
  assert.strictEqual(describeGasError({ message: 'socket hang up' }), 'socket hang up');
});
