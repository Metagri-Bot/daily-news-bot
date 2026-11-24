'use strict';

const { AI_KEYWORDS } = require('./farmer-ai-usecase');
const { includesNewsKeyword, normalizeNewsText } = require('./news-keywords');

const SECTORS = [
  ['林業', /林業|森林組合|造林|育林|伐採|間伐|立木|森林計測|森林資源|植林|素材生産|集材|林道|造材/u],
  ['水産', /水産業|水産技術|スマート水産|漁業|漁協|漁師|漁船|漁場|魚群|養殖|生け簀|いけす|定置網|水揚げ|漁獲|採苗|種苗生産|海苔網|魚体重/u],
  ['農業', /農業|農家|農園|営農|圃場|ほ場|農機|水田|稲作|栽培|収穫|選果|畜産|酪農|乳牛|牧場|養鶏|養豚|搾乳|摘果|選別機|水稲|施設園芸|植物工場|乾田直播|防除/u]
];
const FIELD_TECH = ['ドローン', 'ロボット', '自動操舵', '自動運転', '自動給餌', '自動潅水',
  '自動灌水', 'センサー', 'リモートセンシング', '衛星画像', 'レーザ計測', 'レーザー計測',
  'lidar', 'iot', 'デジタルツイン', '点群', '音響測深', '水中カメラ', '衛星測位', '可変施肥', '環境制御'];
const ACTION = /導入|実証|運用|稼働|活用|開発|実用化|検証|計測|推定|予測|自動化|削減|短縮/u;
const TRIAL = /試験養殖|試験栽培|実証|試験操業|現地試験/u;
const MEASURED_RESULT = /(?:生存率|活着率|収量|漁獲量|作業時間|燃料消費量|労働時間|生産コスト)[^。]{0,12}[0-9]+(?:[.,][0-9]+)?\s*(?:%|割|倍|時間|分|kg|トン)/u;
const NOTICE = /セミナー|参加者募集|ウェビナー|講演会|導入予定|導入を検討|導入前の確認|何が変わる[?？]|選び方/u;

function fieldSector(text) {
  return SECTORS.find(([, pattern]) => pattern.test(text))?.[0];
}

function fieldInnovation(article) {
  if (NOTICE.test(normalizeNewsText(article.title))) return '';
  const titleSector = fieldSector(normalizeNewsText(article.title));
  for (const value of [article.title, article.contentSnippet, article.summary, article.content]) {
    const sentences = normalizeNewsText(value).trim().split(/[。！？!?\n]/u);
    for (const [index, sentence] of sentences.entries()) {
      // 短い見出しで示された業種を、概要の冒頭に限って補う。
      const sector = fieldSector(sentence) || (index === 0 && titleSector);
      if (!sector || NOTICE.test(sentence)) continue;
      if (TRIAL.test(sentence) && MEASURED_RESULT.test(sentence)) return sector + 'の実証成果';
      if (!ACTION.test(sentence)) continue;
      if (AI_KEYWORDS.some(word => includesNewsKeyword(sentence, word))) return sector + 'のAI活用・研究';
      if (FIELD_TECH.some(word => includesNewsKeyword(sentence, word))) return sector + 'の先端技術';
    }
  }
  return '';
}

module.exports = { fieldSector, fieldInnovation };
