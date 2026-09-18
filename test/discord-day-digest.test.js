'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { compareSnowflake, snowflakeFromDate } = require('../discord-channel-log');
const {
  jstDateTextWithOffset,
  collectDayRows,
  buildDayDigestMarkdown,
  splitForDiscord,
  formatDiaryDraftMessages,
  runDiaryDraft
} = require('../discord-day-digest');

/** Discord API の after 挙動（IDの直後から古い順に返す）を再現するダミーチャンネル */
function makeChannel({ id, name, messages = [] }) {
  return {
    id,
    name,
    guildId: '951780348465909820',
    messages: {
      async fetch({ limit, after }) {
        const hit = messages
          .filter(m => compareSnowflake(m.id, after) > 0)
          .sort((a, b) => compareSnowflake(a.id, b.id))
          .slice(0, limit);
        return new Map(hit.map(m => [m.id, m]));
      }
    }
  };
}

function makeMessage({ at, content, userId = '111', userName = 'tester', displayName = 'テスター' }) {
  const createdAt = new Date(at);
  return {
    id: snowflakeFromDate(createdAt),
    createdAt,
    content,
    author: { id: userId, username: userName, bot: false },
    member: { displayName },
    attachments: new Map(),
    embeds: []
  };
}

test('jstDateTextWithOffset: 日付をまたぐ時間帯でも「JSTの前日」を返す', () => {
  // 2026-09-18 00:30 JST（＝UTCでは 9/17 15:30）。UTCで引くと2日前になってしまう時間帯
  assert.strictEqual(jstDateTextWithOffset(new Date('2026-09-17T15:30:00Z'), 1), '2026-09-17');
  assert.strictEqual(jstDateTextWithOffset(new Date('2026-09-17T14:59:00Z'), 1), '2026-09-16');
  assert.strictEqual(jstDateTextWithOffset(new Date('2026-09-17T15:30:00Z'), 0), '2026-09-18');
});

test('collectDayRows: 指定日(JST)の投稿だけを拾い、前後の日は落とす', async () => {
  const channel = makeChannel({
    id: '1353146559717703732',
    name: '❓｜毎日クイズチャレンジ🌾',
    messages: [
      makeMessage({ at: '2026-09-16T23:59:00Z', content: '前日ぶん（JST 9/17 08:59 ではない）' }),  // JST 9/17 08:59 → 対象
      makeMessage({ at: '2026-09-16T14:00:00Z', content: 'JST 9/16 23:00 → 対象外' }),
      makeMessage({ at: '2026-09-17T15:30:00Z', content: 'JST 9/18 00:30 → 対象外' })
    ]
  });

  const result = await collectDayRows({
    channelIds: ['1353146559717703732'],
    fetchChannel: async () => channel,
    fromText: '2026-09-17'
  });

  assert.strictEqual(result.rows.length, 1);
  assert.strictEqual(result.perChannel[0].count, 1);
  assert.strictEqual(result.errors.length, 0);
});

test('collectDayRows: 1チャンネルが落ちても他は止まらない', async () => {
  const ok = makeChannel({ id: 'A', name: '💬｜雑談', messages: [makeMessage({ at: '2026-09-17T01:00:00Z', content: 'おはようございます' })] });
  const result = await collectDayRows({
    channelIds: ['A', 'B'],
    fetchChannel: async id => { if (id === 'B') throw new Error('Missing Access'); return ok; },
    fromText: '2026-09-17'
  });

  assert.strictEqual(result.rows.length, 1);
  assert.strictEqual(result.errors.length, 1);
  assert.match(result.errors[0], /Missing Access/);
  assert.strictEqual(result.perChannel[1].count, 0);
});

test('buildDayDigestMarkdown: 見出し・件数サマリ・メッセージURLが入る', () => {
  const md = buildDayDigestMarkdown({
    fromText: '2026-09-17',
    channelIds: ['1', '2'],
    perChannel: [{ channelId: '1', channelName: '💬｜雑談', count: 1 }, { channelId: '2', channelName: '📰｜ニュース', count: 0 }],
    rows: [{
      timestamp: '2026/09/17 10:00:00', displayName: 'テスター', userId: '111',
      content: '1行目\n2行目', channelId: '1', channelName: '💬｜雑談', messageId: '999'
    }]
  });

  assert.match(md, /^# Discord投稿ログ 2026-09-17（JST）/);
  assert.match(md, /- 対象チャンネル: 2件 \/ 取得: 1件/);
  assert.match(md, /## 💬｜雑談 `<#1>`/);
  assert.match(md, /> 1行目\n> 2行目/);                                     // 複数行は行ごとに引用
  assert.match(md, /https:\/\/discord\.com\/channels\/951780348465909820\/1\/999/);
});

test('splitForDiscord: 上限を超えず、行の内側では切らない', () => {
  const md = buildDayDigestMarkdown({
    fromText: '2026-09-17',
    channelIds: ['1'],
    perChannel: [{ channelId: '1', channelName: '💬｜雑談', count: 12 }],
    rows: Array.from({ length: 12 }, (_, i) => ({
      timestamp: `2026/09/17 1${i % 10}:00:00`, displayName: 'テスター', userId: '111',
      content: 'あ'.repeat(300), channelId: '1', channelName: '💬｜雑談', messageId: String(1000 + i)
    }))
  });

  const chunks = splitForDiscord(md, { limit: 1900 });
  assert.ok(chunks.length > 1, '長い日は複数通になる');
  chunks.forEach(c => assert.ok(c.length <= 1900, `chunk length ${c.length}`));

  // 行が割れていない＝全チャンクの行を戻すと、元の行がすべて残っている
  const originalLines = md.split('\n').filter(l => l.trim() !== '');
  const roundTrip = chunks.join('\n').split('\n').filter(l => l.trim() !== '');
  assert.deepStrictEqual(roundTrip, originalLines);
});

test('splitForDiscord: 1行が上限を超える場合だけ機械的に割る', () => {
  const chunks = splitForDiscord(`> ${'x'.repeat(5000)}`, { limit: 500 });
  assert.ok(chunks.length >= 10);
  chunks.forEach(c => assert.ok(c.length <= 500));
});

test('formatDiaryDraftMessages: 1通で収まるときは連番を付けない', () => {
  assert.deepStrictEqual(formatDiaryDraftMessages('短い本文', { limit: 1900 }), ['短い本文']);
  const many = formatDiaryDraftMessages(Array.from({ length: 40 }, (_, i) => `行${i} ${'あ'.repeat(60)}`).join('\n'), { limit: 500 });
  assert.ok(many.length > 1);
  assert.match(many[0], /`\(1\/\d+\)`$/);
});

test('runDiaryDraft: 前日ぶんを集めて送る。dryRunなら送らない', async () => {
  const channel = makeChannel({
    id: '1',
    name: '💬｜雑談',
    messages: [makeMessage({ at: '2026-09-17T01:00:00Z', content: 'おはようございます' })]
  });
  const sent = [];

  const result = await runDiaryDraft({
    channelIds: ['1'],
    fetchChannel: async () => channel,
    send: async content => sent.push(content),
    now: new Date('2026-09-18T00:00:00+09:00')
  });

  assert.strictEqual(result.dateText, '2026-09-17');
  assert.strictEqual(result.rows, 1);
  assert.strictEqual(result.sent, 1);
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0], /# Discord投稿ログ 2026-09-17（JST）/);

  const dry = await runDiaryDraft({
    channelIds: ['1'],
    fetchChannel: async () => channel,
    now: new Date('2026-09-18T00:00:00+09:00'),
    dryRun: true
  });
  assert.strictEqual(dry.sent, 0);
  assert.strictEqual(dry.messages, 1);
});

test('runDiaryDraft: 投稿ゼロの日でも「0件」のサマリを送る（静かに落とさない）', async () => {
  const channel = makeChannel({ id: '1', name: '💬｜雑談', messages: [] });
  const sent = [];
  const result = await runDiaryDraft({
    channelIds: ['1'],
    fetchChannel: async () => channel,
    send: async c => sent.push(c),
    now: new Date('2026-09-18T06:00:00+09:00')
  });

  assert.strictEqual(result.rows, 0);
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0], /取得: 0件/);
});

test('splitForDiscord: 1投稿（見出し＋引用＋URL）は1通の中に収める', () => {
  const md = buildDayDigestMarkdown({
    fromText: '2026-09-17',
    channelIds: ['1'],
    perChannel: [{ channelId: '1', channelName: '🎤｜音声日誌', count: 3 }],
    rows: Array.from({ length: 3 }, (_, i) => ({
      timestamp: `2026/09/17 1${i}:00:00`, displayName: 'テスター', userId: '111',
      content: `本文${i}\n` + 'あ'.repeat(200), channelId: '1', channelName: '🎤｜音声日誌', messageId: String(2000 + i)
    }))
  });

  const chunks = splitForDiscord(md, { limit: 700 });
  assert.ok(chunks.length > 1);
  chunks.forEach(chunk => {
    // 見出しが入っているなら、その投稿のURLも同じ通に入っている＝途中で切れていない
    const headings = chunk.split('\n').filter(l => l.startsWith('### ')).length;
    const urls = chunk.split('\n').filter(l => l.startsWith('https://discord.com/channels/')).length;
    assert.strictEqual(headings, urls, `見出し${headings}件に対しURL${urls}件`);
  });
});

test('splitForDiscord: チャンネル見出しだけが前の通に取り残されない', () => {
  const md = buildDayDigestMarkdown({
    fromText: '2026-09-17',
    channelIds: ['1', '2'],
    perChannel: [{ channelId: '1', channelName: '💬｜雑談', count: 1 }, { channelId: '2', channelName: '📰｜ニュース', count: 1 }],
    rows: [
      { timestamp: '2026/09/17 10:00:00', displayName: 'A', userId: '1', content: 'あ'.repeat(400), channelId: '1', channelName: '💬｜雑談', messageId: '1' },
      { timestamp: '2026/09/17 11:00:00', displayName: 'B', userId: '2', content: 'い'.repeat(400), channelId: '2', channelName: '📰｜ニュース', messageId: '2' }
    ]
  });

  splitForDiscord(md, { limit: 600 }).forEach(chunk => {
    const lines = chunk.split('\n').filter(l => l.trim() !== '');
    if (lines[lines.length - 1].startsWith('## ')) assert.fail('チャンネル見出しで終わる通がある');
  });
});
