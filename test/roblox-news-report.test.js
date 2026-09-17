'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRobloxNewsSummary, describeRobloxNewsRun } = require('../roblox-news-report');

test('未計測の段は0件として必ず出力する', () => {
  const summary = buildRobloxNewsSummary({});
  for (const label of ['収集', '公開日検証OK', 'GoogleNews解決', '一次候補', 'AI審査', '翻訳成功', '投稿']) {
    assert.ok(summary.includes(`${label}=0`), `${label} が欠けています: ${summary}`);
  }
  assert.ok(summary.includes('重要度70以上=0'));
});

test('投稿できた日はinfoで件数を残す', () => {
  const report = describeRobloxNewsRun({ collected: 120, verified: 9, relayResolved: 7, eligible: 6, selected: 3, translated: 3, posted: 3 });
  assert.equal(report.level, 'info');
  assert.ok(report.description.includes('GoogleNews解決=7'));
  assert.ok(report.description.includes('投稿=3'));
  assert.equal(report.details, null);
});

test('0件の日はwarnで通知し、沈黙で終わらせない', () => {
  const report = describeRobloxNewsRun({ collected: 130, verified: 0, relayUnresolved: 41, unverified: 41 });
  assert.equal(report.level, 'warn');
  assert.ok(report.title.includes('0件'));
  assert.ok(report.description.includes('解決失敗=41'));
});

test('例外はerrorとしてスタックトレース付きで通知する', () => {
  const error = new Error('Roblox editorial evaluation is missing');
  const report = describeRobloxNewsRun({ collected: 5 }, error);
  assert.equal(report.level, 'error');
  assert.ok(report.details.includes('Roblox editorial evaluation is missing'));
  assert.ok(report.description.includes('収集=5'));
});

test('AI審査の閾値はstatsの値を反映する', () => {
  assert.ok(buildRobloxNewsSummary({ threshold: 65 }).includes('重要度65以上=0'));
});
