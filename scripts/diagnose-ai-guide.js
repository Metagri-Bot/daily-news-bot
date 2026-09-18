'use strict';

// 農業AI通信の配信経路をローカルで再現・検査する。外部ネットワークもDiscordも使わない。
//   node scripts/diagnose-ai-guide.js                 本番で起こりうる3パターンをモックGASで再現
//   node scripts/diagnose-ai-guide.js --state <path>  本番の台帳ファイルを読んで状態を一覧表示
//
// 本番のGAS・スプレッドシート・Discordには一切アクセスしません。

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const axios = require('axios');
const aiGuide = require('../ai-guide-delivery');

const ARTICLE = 'https://metagri-labo.com/ai-guide/test-article/';
const ITEMS = [{ title: 'ローカル検証用の記事', link: ARTICLE,
  isoDate: new Date().toISOString(), contentSnippet: '本文の抜粋' }];

// GASの応答を模す。html はデプロイ未更新・アクセス権不足でログインページが返る状態。
function startMockGas(mode) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
        if (mode === 'html') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body>Sign in to continue</body></html>');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success' }));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

// Discordチャンネルの代役。送信を記録し、履歴取得にも同じ内容を返す。
function makeChannel() {
  const posted = [];
  return {
    posted,
    async send(message) {
      const record = { id: String(posted.length + 1), author: { id: 'bot' },
        embeds: message.embeds || [], createdTimestamp: Date.now() };
      posted.push(record);
      return record;
    },
    messages: { async fetch() { return new Map(posted.map(message => [message.id, message])); } },
  };
}

async function runOnce({ stateFile, gasUrl, channel }) {
  const logs = [];
  const state = aiGuide.loadState(stateFile);
  let delivered = null;
  let failure = null;
  try {
    delivered = await aiGuide.deliver({
      state, items: ITEMS, now: Date.now(),
      recover: current => aiGuide.recoverHistory(channel, 'bot', current, Date.now()),
      save: current => aiGuide.saveState(stateFile, current),
      prepare: async article => ({
        message: { content: '### 📡 農業AI通信', embeds: [{ url: article.link, title: article.title }] },
        payload: { type: 'aiGuide', title: article.title, url: article.link, summary: '要約' },
      }),
      send: message => channel.send(message),
      record: async payload => {
        const response = await axios.post(gasUrl, payload, { timeout: 5000, headers: { 'Content-Type': 'application/json' } });
        // index.js と同じ判定。ここが false なら転送は未完了のまま残す。
        if (response.data?.status !== 'success') throw new Error('GAS did not confirm success; transfer remains pending');
      },
      log: message => logs.push(message),
    });
  } catch (error) { failure = error; }
  return { delivered, failure, logs, state: aiGuide.loadState(stateFile) };
}

function printLedger(state, indent = '    ') {
  const entries = Object.entries(state.articles || {});
  if (!entries.length) { console.log(`${indent}(台帳は空です)`); return; }
  for (const [url, entry] of entries) {
    console.log(`${indent}${url}`);
    console.log(`${indent}  Discord投稿: ${entry.discord ? '済' : '未'}　スプシ転送: ${entry.gas ? entry.gas.status : '未'}`);
  }
  const pending = aiGuide.pendingGasTransfers(state);
  console.log(`${indent}→ 未転送として検出: ${pending.length}件${pending.length ? `（${pending.map(p => p.status).join(', ')}）` : ''}`);
}

async function scenario(title, note, steps) {
  console.log(`\n──────────────────────────────────────────`);
  console.log(`▼ ${title}`);
  console.log(`  ${note}`);
  await steps();
}

function tempState() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-guide-')), 'ledger.json');
}

async function simulate() {
  console.log('農業AI通信のローカル再現（本番のGAS・スプシ・Discordには接続しません）');

  const ok = await startMockGas('success');
  const ng = await startMockGas('html');
  try {
    await scenario('① 正常時', 'GASが success を返す場合', async () => {
      const stateFile = tempState();
      const channel = makeChannel();
      const run = await runOnce({ stateFile, gasUrl: ok.url, channel });
      run.logs.forEach(line => console.log(`    ${line}`));
      console.log(`    Discord投稿数: ${channel.posted.length}`);
      printLedger(run.state);
    });

    await scenario('② GAS転送が失敗した場合',
      'ログインページなどJSON以外が返る（デプロイ未更新・アクセス権不足）', async () => {
      const stateFile = tempState();
      const channel = makeChannel();
      const first = await runOnce({ stateFile, gasUrl: ng.url, channel });
      first.logs.forEach(line => console.log(`    ${line}`));
      console.log(`    1回目: 例外=${first.failure ? first.failure.message : 'なし'}`);
      printLedger(first.state);
      const second = await runOnce({ stateFile, gasUrl: ok.url, channel });
      second.logs.forEach(line => console.log(`    ${line}`));
      console.log(`    2回目（GAS復旧後）: Discord投稿数=${channel.posted.length}（増えていなければ再投稿なし）`);
      printLedger(second.state);
    });

    await scenario('③ 台帳が失われた場合',
      'state/ai-guide-delivery.json の消失（Dockerボリューム再作成など）', async () => {
      const stateFile = tempState();
      const channel = makeChannel();
      const first = await runOnce({ stateFile, gasUrl: ng.url, channel });
      console.log(`    1回目: Discord投稿=${channel.posted.length}件 / 転送=失敗`);
      fs.rmSync(stateFile);
      console.log('    → 台帳を削除（本番で言えばボリューム再作成）');
      const second = await runOnce({ stateFile, gasUrl: ok.url, channel });
      second.logs.forEach(line => console.log(`    ${line}`));
      console.log(`    2回目: 配信=${second.delivered || 'なし'} / Discord投稿=${channel.posted.length}件`);
      printLedger(second.state);
      console.log('    ※ GASは復旧しているのに転送されません。これが legacy_unknown です。');
    });
  } finally {
    ok.server.close();
    ng.server.close();
  }

  console.log(`\n──────────────────────────────────────────`);
  console.log('③の状態になった記事は自動では復旧しません。次で手動転記してください。');
  console.log('  node scripts/post-ai-guide-url.js <記事URL> --gas-only');
}

function inspect(file) {
  console.log(`台帳: ${file}`);
  const state = aiGuide.loadState(file);
  printLedger(state, '  ');
  const pending = aiGuide.pendingGasTransfers(state);
  if (pending.length) {
    console.log('\n未転送の記事（この順で手動転記してください）:');
    for (const item of pending) {
      console.log(`  node scripts/post-ai-guide-url.js ${item.url} --gas-only   # ${item.status}`);
    }
    process.exitCode = 1;
  } else {
    console.log('\n未転送の記事はありません。転送が届かない原因は台帳以外にあります。');
  }
}

const stateArg = process.argv.indexOf('--state');
if (stateArg !== -1 && process.argv[stateArg + 1]) inspect(process.argv[stateArg + 1]);
else simulate().catch(error => { console.error(error); process.exitCode = 1; });
