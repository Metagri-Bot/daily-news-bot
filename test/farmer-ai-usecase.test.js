'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isFarmerAiUseCase,
  prioritizeFarmerAiUseCases
} = require('../farmer-ai-usecase');

test('ブルーベリー農家によるChatGPTの実利用を検知する', () => {
  const article = {
    title: 'ブルーベリー農家、ChatGPTを活用して販促物を作成'
  };

  assert.equal(isFarmerAiUseCase(article), true);
});

test('日本農業新聞の全角AI表記を含む実例タイトルを検知する', () => {
  const article = {
    title: '電話対応はＡＩで　兵庫県相生市　深山農園　本人は作業に集中'
  };

  assert.equal(isFarmerAiUseCase(article), true);
});

test('農業法人による生成AI導入事例を概要から検知する', () => {
  const article = {
    title: '栽培現場の新たな取り組み',
    contentSnippet: '農業法人が生成AIを導入し、日々の栽培記録を効率化した。'
  };

  assert.equal(isFarmerAiUseCase(article), true);
});

test('農家向けAIサービスの発表だけでは実利用事例にしない', () => {
  const article = {
    title: '農家向け生成AIサービスを提供開始'
  };

  assert.equal(isFarmerAiUseCase(article), false);
});

test('AIを含まない農家の省力化記事は対象外にする', () => {
  const article = {
    title: 'ブルーベリー農家が収穫作業を省力化'
  };

  assert.equal(isFarmerAiUseCase(article), false);
});

test('該当事例があれば評点順位にかかわらず通知枠を確保する', () => {
  const general1 = { title: '農業政策ニュース1' };
  const general2 = { title: '農業政策ニュース2' };
  const useCase = {
    title: '酪農家がAIを活用して飼養記録を分析',
    isFarmerAiUseCase: true
  };
  const general3 = { title: '農業政策ニュース3' };

  assert.deepEqual(
    prioritizeFarmerAiUseCases([general1, general2, useCase, general3], 3),
    [useCase, general1, general2]
  );
});
