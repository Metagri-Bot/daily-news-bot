'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateEditorialFit } = require('../news-editorial-fit');

const GOOD_NEWS_TITLES = [
  '茶の製法ゲームで知って　カードゲームチャウト　京都の高校生が企画　販売検討も',
  '全国の農家・生産者がつながるコミュニティ　販路拡大・情報交換・異業種連携を支援する「フードリンクコミュニティ」発足',
  'サクランボ産地、盗難にピリピリ　センサー初設置、侵入探知',
  '東京の田んぼ、復活プロジェクトが始動　都が田植えや稲刈りなど支援',
  '近畿大学農学部生が摘果した近大ICTメロンを動物園に提供　産学連携で持続可能な農業の実現をめざす',
  '農業課題は「伸びしろ」。元プログラマーが仕掛ける、廃棄資源を徹底活用した小さな農家のSDGs',
  '大学で農系学部・学科が続々　現場×先端技術で人材育成　学生確保課題も',
  'ＡＩ活用し予約倍増　東京「南町田ブルーベリー園」の摘み取り体験'
];

const LOW_QUALITY_TITLES = [
  'アセロラ希少品種を特産にしたい　本庄市の男性、定年後に地元貢献めざす',
  'ゆがんだ水路…農地に爪痕　熊本地震　地割れ、落果など影響広く',
  '開墾から日々の除草まで。20年超の家庭菜園で愛用する7つの道具【DIY的半農生活】'
];

test('過去に評価の高かった8件をすべて選定対象にする', () => {
  for (const title of GOOD_NEWS_TITLES) {
    const result = evaluateEditorialFit({ title });
    assert.equal(result.eligible, true, title);
    assert.ok(result.editorialScore >= 9, title);
    assert.ok(result.reasons.length >= 2, title);
  }
});

test('精度が低かった3件を選定対象から除外する', () => {
  for (const title of LOW_QUALITY_TITLES) {
    const result = evaluateEditorialFit({ title });
    assert.equal(result.eligible, false, title);
  }
});

test('災害記事でも具体的な技術対策があれば選定できる', () => {
  const result = evaluateEditorialFit({
    title: '豪雨被害を防止　農家がAIセンサーを導入し冠水対策を開始'
  });

  assert.equal(result.eligible, true);
  assert.equal(result.exclusionReasons.length, 0);
});

test('枠を埋めるだけの単一人物プロフィールは除外する', () => {
  const result = evaluateEditorialFit({
    title: '定年後に珍しい果樹を栽培　地域の特産を目指す男性'
  });

  assert.equal(result.eligible, false);
});
