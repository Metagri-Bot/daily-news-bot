'use strict';

const { AI_KEYWORDS } = require('./farmer-ai-usecase');
const { includesNewsKeyword, normalizeNewsText } = require('./news-keywords');

const SECTORS = [
  ['林業', /林業|森林組合|造林|育林|伐採|間伐|立木|森林計測|森林資源|植林/u],
  ['水産', /水産業|水産技術|スマート水産|漁業|漁協|漁師|漁船|漁場|魚群|養殖|生け簀|いけす|定置網/u],
  ['農業', /農業|農家|農園|営農|圃場|ほ場|農機|水田|稲作|栽培|収穫|選果|畜産|酪農|乳牛|牧場|養鶏|養豚/u]
];
const FIELD_TECH = ['ドローン', 'ロボット', '自動操舵', '自動運転', '自動給餌', '自動潅水',
  '自動灌水', 'センサー', 'リモートセンシング', '衛星画像', 'レーザ計測', 'レーザー計測',
  'lidar', 'iot', 'デジタルツイン'];
const ACTION = /導入|実証|運用|稼働|活用|開発|実用化|検証|計測|推定|予測|自動化|削減|短縮/u;
const NOTICE = /セミナー|参加者募集|ウェビナー|講演会|導入予定|導入を検討|導入前の確認|何が変わる[?？]|選び方/u;

function fieldSector(text) {
  return SECTORS.find(([, pattern]) => pattern.test(text))?.[0];
}

function fieldInnovation(article) {
  if (NOTICE.test(normalizeNewsText(article.title))) return '';
  for (const value of [article.title, article.contentSnippet, article.summary, article.content]) {
    for (const sentence of normalizeNewsText(value).split(/[。！？!?\n]/u)) {
      const sector = fieldSector(sentence);
      if (!sector || !ACTION.test(sentence) || NOTICE.test(sentence)) continue;
      if (AI_KEYWORDS.some(word => includesNewsKeyword(sentence, word))) return sector + 'のAI活用・研究';
      if (FIELD_TECH.some(word => includesNewsKeyword(sentence, word))) return sector + 'の先端技術';
    }
  }
  return '';
}

module.exports = { fieldSector, fieldInnovation };
