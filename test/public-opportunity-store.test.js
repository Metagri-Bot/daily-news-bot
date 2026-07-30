'use strict';

/**
 * スプレッドシート（GAS）を使った重複防止のテスト。
 * GASへのPOSTは差し替えるため、外部通信は発生しない。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  fetchRemoteHistory,
  pushRemoteHistory,
  mergeHistories,
  buildRecords,
  normalizeRecord
} = require('../public-opportunity-store');

const { runPublicOpportunityMonitor } = require('../public-opportunity-monitor');
const { opportunityId, opportunitySignature } = require('../public-opportunity');

const GAS_URL = 'https://script.google.com/macros/s/EXAMPLE/exec';
const LIST_URL = 'https://www.maff.go.jp/j/press/index.html';
const DETAIL_URL = 'https://www.maff.go.jp/j/press/kanbo/260727.html';

const LIST_HTML = `<html><body>
  <a href="/j/press/kanbo/260727.html">AI×「農山漁村」インパクト創出ソリューション実装プログラムの参加者公募について</a>
</body></html>`;

function detailHtml(deadlineText) {
  return `<html><body><main>
  <h1>AI×「農山漁村」インパクト創出ソリューション実装プログラムの参加者を公募します</h1>
  <p>生成AIを活用して農山漁村の地域課題を解決するソリューションの社会実装を支援します。
  応募できる者は法人格を有する民間事業者又はコンソーシアムとし、自治体との共創実績・農家とのマッチング体制を評価します。
  現場実装に必要な人件費等の経費を補助し、優良事例は広報・事例化のうえ全国展開を図ります。
  応募締切は${deadlineText}までです。</p>
  </main></body></html>`;
}

const fetchTextImpl = deadlineText => async url => {
  if (url === LIST_URL) return LIST_HTML;
  if (url === DETAIL_URL) return detailHtml(deadlineText);
  throw new Error(`unexpected fetch: ${url}`);
};

const SOURCES = [
  {
    id: 'maff-press',
    organization: '農林水産省',
    label: 'テスト用一覧',
    type: 'html',
    url: LIST_URL,
    linkFilter: /^\/j\//i,
    priority: 1,
    enabled: true
  }
];

function makeChannelSpy() {
  const sent = [];
  return {
    sent,
    client: { channels: { fetch: async () => ({ send: async p => sent.push(p) }) } }
  };
}

function tempPaths() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-'));
  return {
    dir,
    stateFile: path.join(dir, 'state.json'),
    candidatesFile: path.join(dir, 'candidates.json')
  };
}

/** GASの代わりに動く簡易シート */
function makeFakeSheet(initialRecords = []) {
  const rows = new Map(initialRecords.map(record => [record.id, { ...record }]));
  const calls = [];

  const postImpl = async (url, payload) => {
    calls.push(payload);
    assert.equal(url, GAS_URL);

    if (payload.type === 'getPublicOpportunities') {
      return [...rows.values()];
    }
    if (payload.type === 'publicOpportunities') {
      let inserted = 0;
      let updated = 0;
      for (const record of payload.records) {
        if (rows.has(record.id)) updated += 1;
        else inserted += 1;
        rows.set(record.id, { ...record });
      }
      return { result: 'success', inserted, updated };
    }
    throw new Error(`unexpected type: ${payload.type}`);
  };

  return { rows, calls, postImpl };
}

// --- 単体 ---

test('normalizeRecord はid・signatureが欠けた行を捨てる', () => {
  assert.equal(normalizeRecord({ id: 'abc' }), null);
  assert.equal(normalizeRecord({ signature: 'sig' }), null);
  assert.equal(normalizeRecord(null), null);

  const normalized = normalizeRecord({
    id: ' abc ',
    signature: 'sig',
    title: 'タイトル',
    url: 'https://example.go.jp/a',
    score: '92'
  });
  assert.equal(normalized.id, 'abc');
  assert.equal(normalized.entry.score, 92);
});

test('シートの日付セル（Date型）は文字列として読み込む', () => {
  const normalized = normalizeRecord({
    id: 'abc',
    signature: 'sig',
    deadline: new Date('2026-09-30T17:00:00+09:00')
  });
  assert.equal(typeof normalized.entry.deadline, 'string');
  assert.match(normalized.entry.deadline, /^2026-09-30T08:00:00/);
});

test('fetchRemoteHistory はシートの行をstate形式に変換する', async () => {
  const sheet = makeFakeSheet([
    { id: 'id-1', signature: 'sig-1', title: 'A', url: 'https://a.go.jp/1' }
  ]);
  const state = await fetchRemoteHistory(GAS_URL, { postImpl: sheet.postImpl });
  assert.equal(state.status, 'ok');
  assert.equal(Object.keys(state.seen).length, 1);
  assert.equal(state.seen['id-1'].signature, 'sig-1');
});

test('fetchRemoteHistory は通信失敗とGAS未対応を区別する', async () => {
  const failing = async () => {
    throw new Error('network down');
  };
  assert.equal((await fetchRemoteHistory(GAS_URL, { postImpl: failing })).status, 'unavailable');

  // GASが旧バージョンのときの応答
  const unknownType = async () => ({ result: 'error', message: 'Unknown type' });
  assert.equal((await fetchRemoteHistory(GAS_URL, { postImpl: unknownType })).status, 'not_deployed');

  assert.equal((await fetchRemoteHistory(null)).status, 'disabled');
});

test('mergeHistories は新しい通知時刻を優先し、初回通知日時は最古を残す', () => {
  const local = {
    seen: {
      'id-1': {
        signature: 'old',
        first_notified_at: '2026-06-01T00:00:00Z',
        last_notified_at: '2026-06-01T00:00:00Z',
        last_checked_at: '2026-06-01T00:00:00Z'
      }
    }
  };
  const remote = {
    seen: {
      'id-1': {
        signature: 'new',
        first_notified_at: '2026-05-01T00:00:00Z',
        last_notified_at: '2026-07-01T00:00:00Z',
        last_checked_at: '2026-07-20T00:00:00Z'
      },
      'id-2': { signature: 'sig-2' }
    }
  };

  const merged = mergeHistories(local, remote);
  assert.equal(merged.seen['id-1'].signature, 'new');
  assert.equal(merged.seen['id-1'].first_notified_at, '2026-05-01T00:00:00Z');
  assert.equal(merged.seen['id-1'].last_checked_at, '2026-07-20T00:00:00Z');
  assert.ok(merged.seen['id-2'], 'シート側にしかない案件も引き継ぐ');
});

test('buildRecords は指定idのみをシート形式に整形する', () => {
  const seen = {
    a: { signature: 's1', title: 'A', url: 'https://a.go.jp', score: 90 },
    b: { signature: 's2', title: 'B', url: 'https://b.go.jp', score: null }
  };
  const records = buildRecords(seen, ['a']);
  assert.equal(records.length, 1);
  assert.equal(records[0].id, 'a');
  assert.equal(records[0].score, 90);

  const all = buildRecords(seen);
  assert.equal(all.length, 2);
  assert.equal(all[1].score, '');
});

test('pushRemoteHistory は空配列や未設定URLでは送信しない', async () => {
  let called = false;
  const postImpl = async () => {
    called = true;
  };
  assert.equal(await pushRemoteHistory(GAS_URL, [], { postImpl }), false);
  assert.equal(await pushRemoteHistory(null, [{ id: 'a' }], { postImpl }), false);
  assert.equal(called, false);
});

// --- 結合（重複防止） ---

test('投稿するとシートへ記録され、次回はシート履歴で重複を防ぐ', async () => {
  const sheet = makeFakeSheet();
  const paths = tempPaths();
  const first = makeChannelSpy();

  const base = {
    channelId: '123',
    openai: null,
    requestDelayMs: 0,
    sources: SOURCES,
    fetchTextImpl: fetchTextImpl('令和9年8月29日17時00分'),
    stateFile: paths.stateFile,
    candidatesFile: paths.candidatesFile,
    gasUrl: GAS_URL,
    storePostImpl: sheet.postImpl
  };

  const firstRun = await runPublicOpportunityMonitor({ ...base, client: first.client });
  assert.equal(firstRun.notified, 1);
  assert.equal(firstRun.stored_to_sheet, true);
  assert.equal(sheet.rows.size, 1);

  const record = [...sheet.rows.values()][0];
  assert.equal(record.organization, '農林水産省');
  assert.equal(record.rank, 'S');
  assert.ok(record.first_notified_at);

  const second = makeChannelSpy();
  const secondRun = await runPublicOpportunityMonitor({ ...base, client: second.client });
  assert.equal(secondRun.notified, 0);
  assert.equal(second.sent.length, 0);
});

test('ローカル履歴が消えてもシート履歴だけで重複を防げる', async () => {
  const item = {
    title: 'AI×「農山漁村」インパクト創出ソリューション実装プログラムの参加者を公募します',
    url: DETAIL_URL,
    deadline: new Date('2027-08-29T17:00:00+09:00').toISOString()
  };
  const sheet = makeFakeSheet([
    {
      id: opportunityId(item),
      signature: opportunitySignature(item),
      title: item.title,
      url: DETAIL_URL,
      organization: '農林水産省',
      deadline: item.deadline,
      rank: 'S',
      score: 92,
      first_notified_at: '2026-07-01T07:30:00+09:00',
      last_notified_at: '2026-07-01T07:30:00+09:00',
      last_checked_at: '2026-07-01T07:30:00+09:00'
    }
  ]);

  const paths = tempPaths(); // stateFileは存在しない＝コンテナ再作成と同じ状況
  const spy = makeChannelSpy();

  const summary = await runPublicOpportunityMonitor({
    client: spy.client,
    channelId: '123',
    openai: null,
    requestDelayMs: 0,
    sources: SOURCES,
    fetchTextImpl: fetchTextImpl('令和9年8月29日17時00分'),
    stateFile: paths.stateFile,
    candidatesFile: paths.candidatesFile,
    gasUrl: GAS_URL,
    storePostImpl: sheet.postImpl
  });

  assert.equal(summary.notified, 0, 'シート履歴があるため再通知しない');
  assert.equal(spy.sent.length, 0);
});

test('シートに締切違いの記録があれば更新通知になる', async () => {
  const oldItem = {
    title: 'AI×「農山漁村」インパクト創出ソリューション実装プログラムの参加者を公募します',
    url: DETAIL_URL,
    deadline: new Date('2027-06-30T17:00:00+09:00').toISOString()
  };
  const sheet = makeFakeSheet([
    {
      id: opportunityId(oldItem),
      signature: opportunitySignature(oldItem),
      title: oldItem.title,
      url: DETAIL_URL,
      deadline: oldItem.deadline,
      rank: 'S',
      score: 92,
      first_notified_at: '2026-07-01T07:30:00+09:00',
      last_notified_at: '2026-07-01T07:30:00+09:00',
      last_checked_at: '2026-07-01T07:30:00+09:00'
    }
  ]);

  const paths = tempPaths();
  const spy = makeChannelSpy();

  const summary = await runPublicOpportunityMonitor({
    client: spy.client,
    channelId: '123',
    openai: null,
    requestDelayMs: 0,
    sources: SOURCES,
    fetchTextImpl: fetchTextImpl('令和9年8月29日17時00分'),
    stateFile: paths.stateFile,
    candidatesFile: paths.candidatesFile,
    gasUrl: GAS_URL,
    storePostImpl: sheet.postImpl
  });

  assert.equal(summary.notified, 1);
  assert.match(spy.sent[0].embeds[0].title, /^更新｜/);
  assert.equal(sheet.rows.size, 1, '同一案件は行が増えない（id列でupsert）');
});

test('GASが未デプロイ（Unknown type）なら中断せずローカル履歴で動作する', async () => {
  const paths = tempPaths();
  const spy = makeChannelSpy();

  const summary = await runPublicOpportunityMonitor({
    client: spy.client,
    channelId: '123',
    openai: null,
    requestDelayMs: 0,
    sources: SOURCES,
    fetchTextImpl: fetchTextImpl('令和9年8月29日17時00分'),
    stateFile: paths.stateFile,
    candidatesFile: paths.candidatesFile,
    gasUrl: GAS_URL,
    storePostImpl: async () => ({ result: 'error', message: 'Unknown type' })
  });

  assert.equal(summary.notified, 1, '構成の問題では投稿を止めない');
  assert.equal(summary.stored_to_sheet, false);
});

test('通信失敗かつ履歴が空なら投稿せず中断する（過去案件の再通知を防ぐ）', async () => {
  const paths = tempPaths();
  const spy = makeChannelSpy();

  await assert.rejects(
    runPublicOpportunityMonitor({
      client: spy.client,
      channelId: '123',
      openai: null,
      requestDelayMs: 0,
      sources: SOURCES,
      fetchTextImpl: fetchTextImpl('令和9年8月29日17時00分'),
      stateFile: paths.stateFile,
      candidatesFile: paths.candidatesFile,
      gasUrl: GAS_URL,
      storePostImpl: async () => {
        throw new Error('GAS unavailable');
      }
    }),
    /通知履歴を取得できませんでした/
  );

  assert.equal(spy.sent.length, 0, '履歴不明の状態では1件も投稿しない');
});

test('シートが読めなくてもローカル履歴があれば通知を継続する', async () => {
  const paths = tempPaths();
  const sheet = makeFakeSheet();
  const first = makeChannelSpy();

  // 1回目：シート正常。ローカル履歴を作る
  await runPublicOpportunityMonitor({
    client: first.client,
    channelId: '123',
    openai: null,
    requestDelayMs: 0,
    sources: SOURCES,
    fetchTextImpl: fetchTextImpl('令和9年8月29日17時00分'),
    stateFile: paths.stateFile,
    candidatesFile: paths.candidatesFile,
    gasUrl: GAS_URL,
    storePostImpl: sheet.postImpl
  });

  // 2回目：シート障害。ローカル履歴で重複判定を継続する
  const second = makeChannelSpy();
  const summary = await runPublicOpportunityMonitor({
    client: second.client,
    channelId: '123',
    openai: null,
    requestDelayMs: 0,
    sources: SOURCES,
    fetchTextImpl: fetchTextImpl('令和9年8月29日17時00分'),
    stateFile: paths.stateFile,
    candidatesFile: paths.candidatesFile,
    gasUrl: GAS_URL,
    storePostImpl: async () => {
      throw new Error('GAS unavailable');
    }
  });

  assert.equal(summary.notified, 0);
  assert.equal(second.sent.length, 0);
});

test('GAS未設定でも従来どおりローカル履歴だけで動作する', async () => {
  const paths = tempPaths();
  const spy = makeChannelSpy();

  const summary = await runPublicOpportunityMonitor({
    client: spy.client,
    channelId: '123',
    openai: null,
    requestDelayMs: 0,
    sources: SOURCES,
    fetchTextImpl: fetchTextImpl('令和9年8月29日17時00分'),
    stateFile: paths.stateFile,
    candidatesFile: paths.candidatesFile,
    gasUrl: null
  });

  assert.equal(summary.notified, 1);
  assert.equal(summary.stored_to_sheet, false);
});
