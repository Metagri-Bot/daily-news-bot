'use strict';

const { normalizeNewsText } = require('./news-keywords');

const FARMER_ACTOR_KEYWORDS = [
  '農家', '農業者', '生産者', '農業法人', '農園', '果樹園',
  '牧場', 'ファーム', '営農組合', '農事組合法人', 'ブルーベリー園',
  '観光農園', 'farmer', 'farm operator'
];

const AI_KEYWORDS = [
  'ai', '人工知能', '生成ai', 'chatgpt', 'claude', 'gemini',
  'copilot', 'llm', '機械学習', '画像認識', '画像生成', '音声認識'
];

const PRACTICAL_USE_KEYWORDS = [
  '活用', '導入', '利用', '使用', '使う', '使い', '使って', '使った', '運用', '試した'
];

const actorNames = FARMER_ACTOR_KEYWORDS.map(keyword => /^[a-z ]+$/u.test(keyword) ? `\\b${keyword}\\b` : keyword);
const actor = `(?:${actorNames.join('|')})(?!\\s*(?:向け|用|のため|を対象|を支援|に提供))`;
const aiNames = AI_KEYWORDS.map(keyword => /^[a-z]+$/u.test(keyword) ? `(?<![a-z0-9])${keyword}(?![a-z0-9])` : keyword);
const ai = `(?:${aiNames.join('|')})`;
const use = `(?:${PRACTICAL_USE_KEYWORDS.join('|')})`;
const farmer = new RegExp(actor, 'u');
const namedActor = new RegExp(`${actor}(?:が|は|、|\\s|$)`, 'u');
const directUse = new RegExp(`${ai}(?:(?:ツール|カメラ|センサー|チャットボット|システム|アプリ))?(?:を|の|で|による|\\s)*${use}`, 'u');
const taskWithAi = new RegExp(`(?:電話対応|問い合わせ対応|接客|予約管理|栽培記録|作業記録|経理|飼養記録)(?:は|を)\\s*${ai}で|${ai}(?:を使って|で).{0,18}(?:作成|記録|分析|予測|可視化|対応|選別)`, 'u');
const announcement = /提供開始|販売開始|発売|サービスを発表|サービスを提供|導入を支援|活用を支援|(?:導入|活用|利用|使用|運用)(?:の|を)?(?:予定|計画|検討|目指|推進|提案|呼びかけ|する方針)/u;
const providerSubject = /(?:提供企業|開発企業|ベンダー|当社|メーカー|開発元|同社)(?:が|は)/u;

/**
 * 「農家などの現場主体」×「AI」×「実利用」の3条件で事例を判定する。
 * 例: 「農家向け生成AIサービスを提供開始」は実利用語がないため対象外。
 */
function isFarmerAiUseCase(article) {
  const sentences = [article.title, article.contentSnippet, article.summary, article.content]
    .filter(Boolean)
    .flatMap(value => normalizeNewsText(value).split(/[。!?\n]/u));

  return sentences.some(sentence => {
    if (announcement.test(sentence) || providerSubject.test(sentence) || !farmer.test(sentence)) {
      return false;
    }
    return (directUse.test(sentence) || taskWithAi.test(sentence)) &&
      (namedActor.test(sentence) || /(?:農家|農園|農業法人)の.{0,16}(?:事例|実践)/u.test(sentence));
  });
}

/**
 * 評点順を尊重しながら、農家AI活用事例があれば通知枠を1件保証する。
 */
function prioritizeFarmerAiUseCases(articles, limit = 3) {
  if (!Array.isArray(articles) || limit <= 0) return [];

  const farmerAiUseCase = articles.find(article =>
    article.isFarmerAiUseCase || isFarmerAiUseCase(article)
  );

  if (!farmerAiUseCase) return articles.slice(0, limit);

  return [
    farmerAiUseCase,
    ...articles.filter(article => article !== farmerAiUseCase)
  ].slice(0, limit);
}

module.exports = {
  FARMER_ACTOR_KEYWORDS,
  AI_KEYWORDS,
  PRACTICAL_USE_KEYWORDS,
  isFarmerAiUseCase,
  prioritizeFarmerAiUseCases
};
