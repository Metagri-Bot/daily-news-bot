'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isContextlessQuantity,
  normalizeAiGuideResult,
  normalizeEvidence,
  stripOuterQuotes
} = require('../ai-guide-content');

test('外側のかっこ書きが重なっていてもすべて除去する', () => {
  assert.equal(stripOuterQuotes('「「AIに関しては、自発的・意識的には使っていない」」'), 'AIに関しては、自発的・意識的には使っていない');
  assert.equal(stripOuterQuotes('*「具体的な効果も、現時点では出ていない」*'), '具体的な効果も、現時点では出ていない');
});

test('文脈のない数量を除外し、重要ポイントを最大2件に絞る', () => {
  const evidence = normalizeEvidence([
    '「約9000坪」',
    '「AIに関しては、自発的・意識的には使っていない」',
    '「具体的な効果も、現時点では出ていない」',
    '「作業時間を測ると改善余地が見えてきた」'
  ]);

  assert.deepEqual(evidence, [
    'AIに関しては、自発的・意識的には使っていない',
    '具体的な効果も、現時点では出ていない'
  ]);
});

test('数量判定と正規化後の重複除去', () => {
  assert.equal(isContextlessQuantity('約9000坪'), true);
  assert.equal(isContextlessQuantity('約9000坪の農場を経営している'), false);
  assert.deepEqual(normalizeAiGuideResult({ evidence: ['「発言」', '「「発言」」'] }).evidence, ['発言']);
});
