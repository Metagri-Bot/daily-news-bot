'use strict';

const FARMER_ACTOR_KEYWORDS = [
  '農家', '農業者', '生産者', '農業法人', '農園', '果樹園',
  '牧場', 'ファーム', '営農', 'farmer', 'farm operator'
];

const AI_KEYWORDS = [
  'ai', '人工知能', '生成ai', 'chatgpt', 'claude', 'gemini',
  'copilot', 'llm', '機械学習', '画像認識', '画像生成',
  '音声認識', 'aiエージェント'
];

const PRACTICAL_USE_KEYWORDS = [
  '活用', '導入', '利用', '使用', '使う', '使い', '使って', '使った',
  '実践', '運用', '試す', '試した', '自作', '制作', '作成',
  '業務効率化', '省力化', '販売促進', '販促', '情報発信', '発信',
  '分析', '予測', '相談', '記録', 'aiで', 'chatgptで', 'claudeで', 'geminiで'
];

function articleText(article = {}) {
  return [
    article.title,
    article.contentSnippet,
    article.content,
    article.summary
  ]
    .filter(Boolean)
    .join(' ')
    .normalize('NFKC')
    .toLowerCase();
}

function includesAny(text, keywords) {
  return keywords.some(keyword => text.includes(keyword.toLowerCase()));
}

/**
 * 「農家などの現場主体」×「AI」×「実利用」の3条件で事例を判定する。
 * 例: 「農家向け生成AIサービスを提供開始」は実利用語がないため対象外。
 */
function isFarmerAiUseCase(article) {
  const text = articleText(article);
  return (
    includesAny(text, FARMER_ACTOR_KEYWORDS) &&
    includesAny(text, AI_KEYWORDS) &&
    includesAny(text, PRACTICAL_USE_KEYWORDS)
  );
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
