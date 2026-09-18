'use strict';

// AI_GUIDE_GAS_URL の疎通確認。
//   node scripts/check-ai-guide-gas.js            シートを一切書き換えずにエンドポイントだけ確認
//   node scripts/check-ai-guide-gas.js --send     実際にA1/A2を上書きする（現在の原稿は消えます）
//
// 既定の確認は type を 'aiGuidePing' にして送ります。GAS側の doPost は未知のtypeを
// 「Unknown request type」で弾き、シートには触れません。つまり JSON が返ってくれば
// URL・デプロイ・アクセス権はすべて正常、と切り分けられます。
require('dotenv').config({ quiet: true });
const axios = require('axios');

const GAS_URL = process.env.AI_GUIDE_GAS_URL;
const DESTRUCTIVE = process.argv.includes('--send');
// GAS側の doPost は lock.waitLock(30000)。これより短く切ると、正常でも必ずタイムアウトする。
const TIMEOUT = Number(process.argv[process.argv.indexOf('--timeout') + 1]) || 45000;

const PROBE = { type: 'aiGuidePing', note: 'connectivity probe from check-ai-guide-gas.js' };
const SAMPLE = {
  type: 'aiGuide',
  title: '【テスト送信】農業AI通信の疎通確認',
  url: 'https://metagri-labo.com/ai-guide/test/',
  summary: 'これは疎通確認用のテスト送信です。本番の原稿ではありません。',
  keyPoints: 'テスト1\nテスト2', facts: 'テスト送信です', actionable: 'テスト送信です',
  evidence: 'テスト送信です', articleDate: new Date().toISOString(),
};

function describe(response) {
  const contentType = String(response.headers['content-type'] || '');
  const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
  return { status: response.status, contentType, body: body.slice(0, 400),
    json: typeof response.data === 'object' && response.data !== null ? response.data : null };
}

async function main() {
  if (!GAS_URL) {
    console.error('AI_GUIDE_GAS_URL が設定されていません。');
    process.exitCode = 1;
    return;
  }
  console.log(`宛先: ${GAS_URL.slice(0, 60)}…`);
  console.log(DESTRUCTIVE
    ? '⚠ --send 指定のため、実際に「原稿作成」A1/A2 を上書きします。'
    : '疎通確認のみ。シートは書き換えません（--send で実書き込み）。');

  // まず疎通だけを見る。デプロイが生きていれば、doGetが無くても即座に何かを返す。
  try {
    const started = Date.now();
    const probe = await axios.get(GAS_URL, { timeout: 15000, validateStatus: () => true, maxRedirects: 5 });
    const note = probe.status < 400 ? '（デプロイは応答しています）' : '（4xx/5xx。実行環境の遮断かデプロイの問題）';
    console.log(`GET応答: HTTP ${probe.status} / ${Date.now() - started}ms${note}`);
  } catch (error) {
    console.log(`GET応答: ${error.message}`);
    if (/timeout/i.test(error.message)) {
      console.log('  → GETすら返りません。デプロイ自体が応答していない状態です。');
    }
  }

  const started = Date.now();
  let response;
  try {
    response = await axios.post(GAS_URL, DESTRUCTIVE ? SAMPLE : PROBE,
      { timeout: TIMEOUT, headers: { 'Content-Type': 'application/json' }, validateStatus: () => true, maxRedirects: 5 });
  } catch (error) {
    console.error(`✗ POSTに失敗しました（${Date.now() - started}ms / 上限${TIMEOUT}ms）: ${error.message}`);
    if (/timeout/i.test(error.message)) {
      console.error('  → 応答が返る前に切っています。GAS側の doPost は lock.waitLock(30000) で');
      console.error('     最大30秒スクリプトロックを待つため、他の実行（auto-mail.gs のトリガー等）が');
      console.error('     ロックを保持していると、この時間内に返りません。');
      console.error('  → Apps Scriptの「実行数」画面で doPost の実行時間と、同時刻に走っている関数を確認してください。');
      console.error(`  → さらに長く待って確認する: node scripts/check-ai-guide-gas.js --timeout 90000`);
    } else {
      console.error('  → URLの誤り、デプロイの削除、ネットワーク遮断のいずれかです。');
    }
    process.exitCode = 1;
    return;
  }

  const result = describe(response);
  console.log(`POST応答: HTTP ${result.status} / ${result.contentType} / ${Date.now() - started}ms`);
  console.log(`応答: ${result.body}`);

  // Bot側の判定は response.data?.status === 'success' の一点。ここを同じ基準で説明する。
  // 実行環境のプロキシに遮断された場合を、GAS側の異常と取り違えない。
  if (/network allowlist|proxy|CONNECT tunnel/i.test(result.body)) {
    console.log('△ 実行環境のネットワーク制限で遮断されました。GASの状態は判定できていません。');
    console.log('  → Botが動いているサーバー上で実行してください: docker compose exec -T app node scripts/check-ai-guide-gas.js');
    process.exitCode = 1;
    return;
  }
  if (!result.json) {
    console.log('✗ JSONが返っていません。ログインページかエラーページの可能性が高いです。');
    console.log('  → GASの「デプロイ」を新しいバージョンで作り直し、アクセスを「全員」にしてください。');
    console.log('  → 新しいURLになった場合は Secrets の AI_GUIDE_GAS_URL も更新が必要です。');
    process.exitCode = 1;
    return;
  }
  if (DESTRUCTIVE) {
    console.log(result.json.status === 'success'
      ? '✓ success が返りました。「原稿作成」A1/A2 を確認してください（テスト内容で上書きされています）。'
      : `✗ success が返りませんでした: ${JSON.stringify(result.json)}`);
    if (result.json.status !== 'success') process.exitCode = 1;
    return;
  }
  if (result.json.status === 'error' && /unknown request type/i.test(String(result.json.message || ''))) {
    console.log('✓ エンドポイントは正常です（URL・デプロイ・アクセス権いずれも問題なし）。');
    console.log('  → 転送が届かない原因はGAS接続ではありません。Bot側のログと配信台帳を確認してください。');
    return;
  }
  console.log(`△ 想定と異なる応答です: ${JSON.stringify(result.json)}`);
  console.log('  → doPost が更新されている可能性があります。GAS側のコードを確認してください。');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
