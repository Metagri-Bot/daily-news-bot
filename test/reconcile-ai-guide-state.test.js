'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {reconcileState} = require('../scripts/reconcile-ai-guide-state');

test('recovery batches at most 50 URLs and only trusts requested articles with positive sheet evidence', async () => {
  const state = {version: 1, articles: {}};
  const urls = Array.from({length: 51}, (_, i) => `https://metagri-labo.com/ai-guide/item-${i}/`);
  for (const url of urls) state.articles[url] = {publishedAt: new Date().toISOString(), discord: {}, gas: {status: 'legacy_unknown'}};
  const batches = [];
  const result = await reconcileState(state, async batch => {
    batches.push(batch);
    return batch.map(url => ({url, status: url === urls[50] ? 'unknown' : 'archived'}));
  });
  assert.deepEqual(batches.map(b => b.length), [50, 1]);
  assert.equal(result.checked, 51); assert.equal(result.reconciled, 50);
  assert.deepEqual(result.remaining.map(e => e.url), [urls[50]]);
});

test('failed later batch does not mutate or partially reconcile the ledger', async () => {
  const state = {version: 1, articles: {}};
  for (let i = 0; i < 51; i++) state.articles[`https://metagri-labo.com/ai-guide/item-${i}/`] = {discord: {}};
  const before = JSON.stringify(state); let calls = 0;
  await assert.rejects(reconcileState(state, async batch => {
    if (++calls > 1) throw new Error('GAS unavailable');
    return batch.map(url => ({url, status: 'recorded'}));
  }), /GAS unavailable/);
  assert.equal(JSON.stringify(state), before);
});
