'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseImportantArticles, curateRobloxArticles } = require('../roblox-news-editorial');
const { postedArticleContext } = require('../roblox-news');
const now = new Date('2026-09-06');
const candidates = Array.from({ length: 12 }, (_, i) => ({ title: `Roblox specific brand ${i}`, score: 10,
  contentSnippet: 'Confirmed launch', duplicateKeys: [`url:https://example.com/${i}`] }));
const evaluation = (id, importance = 75, extra = {}) => ({ id, importance, topicKey: `brand:${id}:launch`,
  duplicateOfPosted: false, reason: '具体的な企業施策の開始', evidence: 'Confirmed launch', ...extra });

test('未投稿でも70点未満は採用せず、2件しか重要でなければ2件にする', () => {
  const response = { evaluations: candidates.map((_, i) => evaluation(i, i < 2 ? 80 : 45)) };
  assert.equal(chooseImportantArticles(candidates, response, {}, now).length, 2);
});

test('重要度順に選び、8件以上重要なら8件、7件なら5件に絞る', () => {
  const eight = { evaluations: candidates.map((_, i) => evaluation(i, i < 8 ? 70 + i : 20)) };
  const selected = chooseImportantArticles(candidates, eight, {}, now);
  assert.equal(selected.length, 8);
  assert.equal(selected[0].importance, 77);
  const seven = { evaluations: candidates.map((_, i) => evaluation(i, i < 7 ? 75 : 20)) };
  assert.equal(chooseImportantArticles(candidates, seven, {}, now).length, 5);
});

test('同一話題を1件にまとめ、低重要度の転載もURLを引き継ぐ', () => {
  const response = { evaluations: candidates.map((_, i) => evaluation(i, i === 1 ? 50 : 75, { topicKey: 'same:campaign:launch' })) };
  const selected = chooseImportantArticles(candidates, response, {}, now);
  assert.equal(selected.length, 1);
  assert.ok(selected[0].duplicateKeys.includes('url:https://example.com/1'));
});

test('履歴の話題または投稿済みと判定した話題は採用しない', () => {
  const response = { evaluations: candidates.map((_, i) => evaluation(i, 90, { topicKey: 'same:launch', duplicateOfPosted: i === 0 })) };
  assert.equal(chooseImportantArticles(candidates, response, {}, now).length, 0);
  const fresh = { evaluations: candidates.map((_, i) => evaluation(i)) };
  const sent = Object.fromEntries(candidates.map((_, i) => [`topic:brand:${i}:launch`, now.toISOString()]));
  assert.equal(chooseImportantArticles(candidates, fresh, sent, now).length, 0);
});

test('根拠の捏造・評価欠落・重複ID・不正な型は投稿に進めない', () => {
  for (const evaluations of [[], [evaluation(0), evaluation(0)], [evaluation(0, 80, { evidence: 'invented KPI' })],
    [evaluation(0, '80')], [evaluation(0, 80, { duplicateOfPosted: 'false' })]]) {
    assert.throws(() => chooseImportantArticles(candidates.slice(0, 1), { evaluations }, {}, now));
  }
});

test('評価APIが失敗したら件数を埋めるフォールバックはしない', async () => {
  await assert.rejects(curateRobloxArticles({ candidates, sent: {}, now, evaluate: async () => { throw new Error('API down'); } }));
});

test('旧履歴のURLから顧客ブランドと開発会社の情報を編集審査へ渡す', async () => {
  const sent = { 'url:https://www.example.com/pr': now.toISOString() };
  const historyArticles = [{ title: 'The Doux My Salon Empire', link: 'https://example.com/pr', contentSnippet: 'Developed by Exclusible for The Doux.' }];
  assert.equal(postedArticleContext(historyArticles, sent, now).length, 1);
  let prompt;
  await curateRobloxArticles({ candidates: candidates.slice(0, 1), sent, historyArticles, now,
    logger: { log() {} }, evaluate: async text => { prompt = text; return { evaluations: [evaluation(0, 45)] }; } });
  assert.ok(prompt.includes('Developed by Exclusible for The Doux.'));
});

test('評価の不正は1度だけ再評価し、再失敗なら採用しない', async () => {
  let attempts = 0;
  await assert.rejects(curateRobloxArticles({ candidates: candidates.slice(0, 1), sent: {}, now,
    logger: { log() {} }, evaluate: async () => { attempts++; return { evaluations: [] }; } }));
  assert.equal(attempts, 2);
});

test('モデルが高得点でも新規性を確認できない使い方解説を投稿しない', () => {
  const articles = [{ ...candidates[0], title: 'Optimize Testing with Roblox Analytics', contentSnippet: 'Optimize Testing with Roblox Analytics' }];
  const response = { evaluations: [evaluation(0, 90, { evidence: articles[0].title })] };
  assert.equal(chooseImportantArticles(articles, response, {}, now).length, 0);
});
