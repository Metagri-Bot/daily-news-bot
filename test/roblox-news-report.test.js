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

test('0件の日は重要度不足と既出を分けて添える', () => {
  const report = describeRobloxNewsRun({ eligible: 10, evaluated: 7, selected: 0, duplicateSkipped: 1,
    nearMiss: [{ title: 'Brand opens Roblox store', importance: 62, duplicate: false, reason: '規模が不明' }],
    duplicateMiss: [{ title: 'RDC 2026 follow-up', importance: 82, duplicate: true, reason: '投稿済みと同一施策' }] });
  assert.equal(report.level, 'warn');
  assert.ok(report.details.includes('■ 重要度が届かなかった候補'));
  assert.ok(report.details.includes('[重要度62] Brand opens Roblox store'));
  assert.ok(report.details.includes('■ 既出として見送った候補'));
  assert.ok(report.details.includes('[重要度82] RDC 2026 follow-up'));
  assert.ok(report.description.includes('既出除外=1'));
  assert.ok(!report.title.includes('配信済み'), '重要度不足も居るので通常の0件見出し');
});

test('既出だけで0件になった日は見出しでそれと分かる', () => {
  const report = describeRobloxNewsRun({ selected: 0, duplicateSkipped: 3,
    duplicateMiss: [{ title: 'RDC 2026 follow-up', importance: 82, duplicate: true, reason: '投稿済みと同一施策' }] });
  assert.ok(report.title.includes('配信済み'));
  assert.ok(!report.details.includes('■ 重要度が届かなかった候補'));
});

test('事前除外の件数も内訳に出す', () => {
  assert.ok(describeRobloxNewsRun({ prefiltered: 187 }).description.includes('事前除外=187'));
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

test('RSS設定にURL以外が混ざったら配信結果より先にerrorで知らせる', () => {
  const report = describeRobloxNewsRun({ feeds: 9, feedsInvalid: 1, posted: 0,
    invalidFeedSamples: ['c:\\Users\\user\\deck.pptx'] });
  assert.equal(report.level, 'error');
  assert.ok(report.title.includes('RSS設定'));
  assert.ok(report.details.includes('deck.pptx'));
  assert.ok(report.description.includes('フィード=9'));
});

test('中継解決のうち公開日まで読めた件数を内訳に出す', () => {
  const report = describeRobloxNewsRun({ relayResolved: 176, relayVerified: 7, posted: 0 });
  assert.ok(report.description.includes('GoogleNews解決=176'));
  assert.ok(report.description.includes('うち公開日あり=7'));
});
