'use strict';

/**
 * 収集〜採点〜投稿〜重複除外までを、HTTP取得を差し替えてオフライン検証する。
 * 実際の省庁サイトへはアクセスしない。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  runPublicOpportunityMonitor,
  buildCompletionParams,
  DEFAULT_AI_MODEL
} = require('../public-opportunity-monitor');

const LIST_URL = 'https://www.maff.go.jp/j/press/index.html';
const DETAIL_URL = 'https://www.maff.go.jp/j/press/kanbo/260727.html';
const NOISE_URL = 'https://www.maff.go.jp/j/press/kanbo/260701.html';

const LIST_HTML = `
<html><body>
  <ul>
    <li><a href="/j/press/kanbo/260727.html">AI×「農山漁村」インパクト創出ソリューション実装プログラムの参加者公募について</a></li>
    <li><a href="/j/press/kanbo/260701.html">農業機械導入支援事業の募集について</a></li>
    <li><a href="/j/press/kanbo/260601.html">スマート農業実証事業の採択結果について</a></li>
    <li><a href="/j/about/index.html">お問い合わせ</a></li>
  </ul>
</body></html>`;

function detailHtml(deadlineText) {
  return `
<html><body><main>
  <h1>AI×「農山漁村」インパクト創出ソリューション実装プログラムの参加者を公募します</h1>
  <p>本プログラムでは、生成AIを活用して農山漁村の地域課題を解決するソリューションの社会実装を支援します。
  応募できる者は法人格を有する民間事業者又はコンソーシアムとし、自治体との共創実績・農家とのマッチング体制を評価します。
  現場実装に必要な人件費等の経費を補助し、優良事例は広報・事例化のうえ全国展開を図ります。
  応募締切は${deadlineText}までです。</p>
</main></body></html>`;
}

// 機械導入のみ＝除外される想定のページ
const NOISE_HTML = `
<html><body><main>
  <h1>農業機械導入支援事業の募集について</h1>
  <p>本事業は農業機械の購入費を補助します。応募できるのは認定農業者に限ります。応募締切は令和8年9月30日です。</p>
</main></body></html>`;

function makeFetch(deadlineText) {
  return async url => {
    if (url === LIST_URL) return LIST_HTML;
    if (url === DETAIL_URL) return detailHtml(deadlineText);
    if (url === NOISE_URL) return NOISE_HTML;
    throw new Error(`unexpected fetch: ${url}`);
  };
}

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
    client: {
      channels: {
        fetch: async () => ({
          send: async payload => {
            sent.push(payload);
          }
        })
      }
    }
  };
}

function tempPaths() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pom-'));
  return {
    dir,
    stateFile: path.join(dir, 'state.json'),
    candidatesFile: path.join(dir, 'candidates.json')
  };
}

test('公募モニターが対象案件のみ投稿し、履歴に記録する', async () => {
  const paths = tempPaths();
  const spy = makeChannelSpy();

  const summary = await runPublicOpportunityMonitor({
    client: spy.client,
    channelId: '123',
    openai: null,
    requestDelayMs: 0,
    sources: SOURCES,
    fetchTextImpl: makeFetch('令和9年8月29日17時00分'),
    stateFile: paths.stateFile,
    candidatesFile: paths.candidatesFile
  });

  assert.equal(summary.notified, 1, '投稿は1件だけ');
  assert.equal(spy.sent.length, 1);
  assert.equal(spy.sent[0].embeds.length, 1);
  assert.match(spy.sent[0].embeds[0].title, /【S・\d+点】/);
  assert.match(spy.sent[0].content, /高親和性の公募案件/);

  // 採択結果・機械導入のみ・ナビゲーションは投稿されない
  const titles = spy.sent[0].embeds.map(embed => embed.title).join(' ');
  assert.ok(!titles.includes('採択結果'));
  assert.ok(!titles.includes('農業機械導入支援'));

  const state = JSON.parse(fs.readFileSync(paths.stateFile, 'utf8'));
  assert.equal(Object.keys(state.seen).length, 1);
  assert.equal(state.last_result.notified, 1);

  const candidates = JSON.parse(fs.readFileSync(paths.candidatesFile, 'utf8'));
  assert.equal(candidates.candidates.length, 1);
  assert.equal(candidates.candidates[0].organization, '農林水産省');
});

test('2回目の実行では同じ案件を再投稿しない', async () => {
  const paths = tempPaths();
  const first = makeChannelSpy();
  const options = {
    channelId: '123',
    openai: null,
    requestDelayMs: 0,
    sources: SOURCES,
    fetchTextImpl: makeFetch('令和9年8月29日17時00分'),
    stateFile: paths.stateFile,
    candidatesFile: paths.candidatesFile
  };

  await runPublicOpportunityMonitor({ ...options, client: first.client });

  const second = makeChannelSpy();
  const summary = await runPublicOpportunityMonitor({ ...options, client: second.client });

  assert.equal(summary.notified, 0);
  assert.equal(second.sent.length, 0, '該当なしの実行では投稿しない');
});

test('締切が変わった案件は更新通知として再投稿する', async () => {
  const paths = tempPaths();
  const base = {
    channelId: '123',
    openai: null,
    requestDelayMs: 0,
    sources: SOURCES,
    stateFile: paths.stateFile,
    candidatesFile: paths.candidatesFile
  };

  const first = makeChannelSpy();
  await runPublicOpportunityMonitor({
    ...base,
    client: first.client,
    fetchTextImpl: makeFetch('令和9年8月29日17時00分')
  });

  // 再確認の間隔を空けるため、最終確認日時だけを過去に書き換える
  // （last_notified_at は履歴保持期間の判定に使うため触らない）
  const state = JSON.parse(fs.readFileSync(paths.stateFile, 'utf8'));
  for (const entry of Object.values(state.seen)) {
    entry.last_checked_at = '2026-01-01T00:00:00+09:00';
  }
  fs.writeFileSync(paths.stateFile, JSON.stringify(state), 'utf8');

  const second = makeChannelSpy();
  const summary = await runPublicOpportunityMonitor({
    ...base,
    client: second.client,
    fetchTextImpl: makeFetch('令和9年10月31日17時00分')
  });

  assert.equal(summary.notified, 1);
  assert.match(second.sent[0].embeds[0].title, /^更新｜/);
});

test('dry-runではDiscordへ送らず履歴も更新しない', async () => {
  const paths = tempPaths();
  const spy = makeChannelSpy();

  const summary = await runPublicOpportunityMonitor({
    client: spy.client,
    channelId: '123',
    openai: null,
    requestDelayMs: 0,
    dryRun: true,
    sources: SOURCES,
    fetchTextImpl: makeFetch('令和9年8月29日17時00分'),
    stateFile: paths.stateFile,
    candidatesFile: paths.candidatesFile
  });

  assert.equal(summary.notified, 1);
  assert.equal(spy.sent.length, 0);
  assert.equal(fs.existsSync(paths.stateFile), false);
});

test('締切済みの案件は投稿しない', async () => {
  const paths = tempPaths();
  const spy = makeChannelSpy();

  const summary = await runPublicOpportunityMonitor({
    client: spy.client,
    channelId: '123',
    openai: null,
    requestDelayMs: 0,
    sources: SOURCES,
    fetchTextImpl: makeFetch('令和7年8月29日17時00分'), // 過去日
    stateFile: paths.stateFile,
    candidatesFile: paths.candidatesFile
  });

  assert.equal(summary.notified, 0);
  assert.equal(spy.sent.length, 0);
});

test('取得に失敗した監視先があっても処理を継続する', async () => {
  const paths = tempPaths();
  const spy = makeChannelSpy();

  const brokenSource = { ...SOURCES[0], id: 'broken', url: 'https://example.go.jp/dead.html' };
  const summary = await runPublicOpportunityMonitor({
    client: spy.client,
    channelId: '123',
    openai: null,
    requestDelayMs: 0,
    sources: [brokenSource, SOURCES[0]],
    fetchTextImpl: makeFetch('令和9年8月29日17時00分'),
    stateFile: paths.stateFile,
    candidatesFile: paths.candidatesFile
  });

  assert.equal(summary.notified, 1, '1件失敗しても残りの監視先は処理される');
});

test('OpenAI整形の結果がEmbedに反映される', async () => {
  const paths = tempPaths();
  const spy = makeChannelSpy();

  const fakeOpenai = {
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  relevant: true,
                  title: 'AI×農山漁村 実装プログラム（第2回公募）',
                  deadline: '2027-08-29T17:00:00+09:00',
                  summary: '生成AIで農山漁村の課題解決を行う事業者を公募する。人件費を含む経費を補助する。',
                  eligibility: '法人格を有する民間事業者又はコンソーシアム',
                  support: '1件あたり上限1,000万円',
                  fit_reasons: ['白井市PR動画AIコンテストの自治体共創実績', 'Metagri研究所の農家ネットワーク'],
                  use_cases: ['予算', '広報', 'パートナー'],
                  action: '公募要領を確認し、8月上旬までに事務局へ参加要件を照会する',
                  caution: '共同申請の要否は要確認'
                })
              }
            }
          ]
        })
      }
    }
  };

  await runPublicOpportunityMonitor({
    client: spy.client,
    channelId: '123',
    openai: fakeOpenai,
    requestDelayMs: 0,
    sources: SOURCES,
    fetchTextImpl: makeFetch('令和9年8月29日17時00分'),
    stateFile: paths.stateFile,
    candidatesFile: paths.candidatesFile
  });

  const embed = spy.sent[0].embeds[0];
  assert.match(embed.title, /第2回公募/);
  assert.match(embed.fields[1].value, /白井市/);
  assert.equal(embed.fields[2].value, '予算 / 広報 / パートナー');
  assert.match(embed.fields[3].value, /事務局へ参加要件を照会/);
  assert.match(embed.fields[4].value, /共同申請の要否/);
});

test('AIがrelevant=falseと判定した案件は投稿しない', async () => {
  const paths = tempPaths();
  const spy = makeChannelSpy();

  const vetoOpenai = {
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  relevant: false,
                  irrelevant_reason: '既に受付を終了している'
                })
              }
            }
          ]
        })
      }
    }
  };

  const summary = await runPublicOpportunityMonitor({
    client: spy.client,
    channelId: '123',
    openai: vetoOpenai,
    requestDelayMs: 0,
    sources: SOURCES,
    fetchTextImpl: makeFetch('令和9年8月29日17時00分'),
    stateFile: paths.stateFile,
    candidatesFile: paths.candidatesFile
  });

  assert.equal(summary.notified, 0);
  assert.equal(spy.sent.length, 0);
});

// --- モデル別パラメータ ---

test('既定モデルは gpt-5.6-luna', () => {
  assert.equal(DEFAULT_AI_MODEL, 'gpt-5.6-luna');
});

test('GPT-5系は temperature を送らず max_completion_tokens を使う', () => {
  const params = buildCompletionParams('gpt-5.6-luna', []);
  assert.equal(params.temperature, undefined);
  assert.equal(params.max_tokens, undefined);
  assert.equal(params.max_completion_tokens, 4000);
  assert.equal(params.reasoning_effort, 'low');
});

test('従来モデルは temperature と max_tokens を使う', () => {
  const params = buildCompletionParams('gpt-4.1-mini', []);
  assert.equal(params.temperature, 0.2);
  assert.equal(params.max_tokens, 1200);
  assert.equal(params.max_completion_tokens, undefined);
  assert.equal(params.reasoning_effort, undefined);
});

test('パラメータ非対応で400が返っても最小構成で再試行して通知できる', async () => {
  const paths = tempPaths();
  const spy = makeChannelSpy();
  const calls = [];

  const pickyOpenai = {
    chat: {
      completions: {
        create: async params => {
          calls.push(params);
          if (calls.length === 1) {
            const error = new Error("Unsupported parameter: 'reasoning_effort'");
            error.status = 400;
            throw error;
          }
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    relevant: true,
                    title: 'AI×農山漁村 実装プログラム',
                    deadline: '2027-08-29T17:00:00+09:00',
                    summary: '再試行後に取得した要約。',
                    fit_reasons: ['Metagri研究所の農家ネットワーク'],
                    use_cases: ['予算'],
                    action: '公募要領を確認する',
                    caution: '要確認'
                  })
                }
              }
            ]
          };
        }
      }
    }
  };

  const summary = await runPublicOpportunityMonitor({
    client: spy.client,
    channelId: '123',
    openai: pickyOpenai,
    requestDelayMs: 0,
    sources: SOURCES,
    fetchTextImpl: makeFetch('令和9年8月29日17時00分'),
    stateFile: paths.stateFile,
    candidatesFile: paths.candidatesFile
  });

  assert.equal(calls.length, 2, '400のあとに1回だけ再試行する');
  assert.equal(calls[1].reasoning_effort, undefined, '再試行は最小構成');
  assert.equal(summary.notified, 1);
  assert.match(spy.sent[0].embeds[0].description, /再試行後に取得した要約/);
});

test('AI呼び出しが400以外で失敗してもキーワード評価で通知を継続する', async () => {
  const paths = tempPaths();
  const spy = makeChannelSpy();

  const brokenOpenai = {
    chat: {
      completions: {
        create: async () => {
          const error = new Error('service unavailable');
          error.status = 503;
          throw error;
        }
      }
    }
  };

  const summary = await runPublicOpportunityMonitor({
    client: spy.client,
    channelId: '123',
    openai: brokenOpenai,
    requestDelayMs: 0,
    sources: SOURCES,
    fetchTextImpl: makeFetch('令和9年8月29日17時00分'),
    stateFile: paths.stateFile,
    candidatesFile: paths.candidatesFile
  });

  assert.equal(summary.notified, 1, 'AI失敗時も投稿は止めない');
  assert.match(spy.sent[0].embeds[0].title, /【S・\d+点】/);
});
