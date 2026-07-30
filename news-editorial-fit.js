'use strict';

const { isFarmerAiUseCase } = require('./farmer-ai-usecase');

const EDITORIAL_DIMENSIONS = [
  {
    id: 'technology',
    label: '現場技術',
    keywords: [
      'ai', '人工知能', '生成ai', 'chatgpt', 'ict', 'iot', 'dx',
      'センサー', '先端技術', 'スマート農業', 'ドローン', 'ロボット',
      '自動化', 'デジタル', 'プログラマー', '侵入探知'
    ]
  },
  {
    id: 'business',
    label: '事業・販路',
    keywords: [
      '販路拡大', '販売', '予約', '集客', '商談', 'ecサイト',
      '商品開発', 'ブランド', '事業化', '新規事業', '起業',
      '収益', '6次産業', '観光農園', 'コミュニティ'
    ]
  },
  {
    id: 'collaboration',
    label: '連携・共創',
    keywords: [
      '産学連携', '異業種連携', '官民連携', '連携', '共創',
      'コミュニティ', 'プロジェクト', 'ネットワーク', '支援',
      '大学', '高校生', '企業', '自治体', '都が'
    ]
  },
  {
    id: 'sustainability',
    label: '課題解決',
    keywords: [
      'sdgs', '持続可能', 'サステナブル', '廃棄', '有効活用',
      '食品ロス', 'フードロス', '規格外', '循環', '再生',
      '復活', '地域活性', '地域課題', '盗難', '防犯',
      '人手不足', '省力化', '担い手不足'
    ]
  },
  {
    id: 'education',
    label: '教育・体験',
    keywords: [
      'ゲーム', 'カードゲーム', '高校生', '大学生', '学生',
      '大学', '農学部', '学科', '人材育成', '教育', '実践的に学ぶ',
      '体験', '田植え', '稲刈り', '摘み取り'
    ]
  },
  {
    id: 'practitioner',
    label: '現場ストーリー',
    keywords: [
      '農家', '生産者', '農業法人', '農園', '就農',
      '元プログラマー', '挑戦', '仕掛ける', '現場'
    ]
  }
];

const ACTION_KEYWORDS = [
  '活用', '導入', '実証', '設置', '発足', '始動', '開始',
  '企画', '開発', '販売', '提供', '支援', '連携', '運用',
  '実践', '育成', '創出', '拡大', '復活', '仕掛ける',
  '立ち上げ', 'プロジェクト', 'つながる', '探知', '防止'
];

const OUTCOME_KEYWORDS = [
  '倍増', '増加', '拡大', '削減', '向上', '改善', '実現',
  '達成', '成果', '効率化', '省力化', '安定化', '予約',
  '販路', '利用者', '売上'
];

const SOLUTION_KEYWORDS = [
  '課題', '解決', '対策', '防止', '支援', '復活', '再生',
  '有効活用', '持続可能', '省力化', '効率化', '人材育成'
];

const HARD_EXCLUSIONS = [
  {
    label: '家庭菜園・ハウツー',
    keywords: [
      '家庭菜園', '半農生活', 'ガーデニング', '育て方',
      '栽培方法', '愛用する道具', 'おすすめの道具', 'diy的'
    ]
  },
  {
    label: '災害・被害の状況報告',
    keywords: [
      '地震', '豪雨', '大雨', '台風', '被災', '爪痕',
      '地割れ', '冠水', '落果'
    ]
  },
  {
    label: '市況・作柄のみ',
    keywords: [
      '市況', '相場', '平均価格', '高値', '安値',
      '豊作', '不作', '作柄'
    ]
  }
];

const WEAK_PROFILE_KEYWORDS = [
  '定年後', '地元貢献', '特産にしたい', 'めざす', '目指す'
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

function evaluateEditorialFit(article) {
  const text = articleText(article);
  const dimensions = EDITORIAL_DIMENSIONS.filter(dimension =>
    includesAny(text, dimension.keywords)
  );
  const dimensionIds = new Set(dimensions.map(dimension => dimension.id));
  const hasAction = includesAny(text, ACTION_KEYWORDS);
  const hasOutcome = includesAny(text, OUTCOME_KEYWORDS);
  const hasSolution = includesAny(text, SOLUTION_KEYWORDS);
  const farmerAiUseCase = isFarmerAiUseCase(article);
  const hardExclusions = HARD_EXCLUSIONS.filter(exclusion =>
    includesAny(text, exclusion.keywords)
  );
  const weakProfile = includesAny(text, WEAK_PROFILE_KEYWORDS);

  // 被害ニュースでも、具体的な技術対策・導入まで含む場合は通す。
  const solutionOverride =
    hasAction &&
    (
      farmerAiUseCase ||
      (dimensionIds.has('technology') && hasSolution) ||
      (dimensionIds.has('collaboration') && hasSolution)
    );

  const excludedByTopic = hardExclusions.length > 0 && !solutionOverride;
  const dimensionCount = dimensions.length;

  let editorialScore = dimensionCount * 3;
  if (hasAction) editorialScore += 3;
  if (hasOutcome) editorialScore += 4;
  if (hasSolution) editorialScore += 3;
  if (farmerAiUseCase) editorialScore += 6;
  if (weakProfile) editorialScore -= 3;

  const meetsQualityGate =
    farmerAiUseCase ||
    (dimensionCount >= 2 && hasAction) ||
    (dimensionCount >= 3) ||
    (hasAction && hasOutcome && dimensionCount >= 1);

  const eligible =
    !excludedByTopic &&
    meetsQualityGate &&
    editorialScore >= 9;

  const reasons = dimensions.map(dimension => dimension.label);
  if (hasAction) reasons.push('具体的な取り組み');
  if (hasOutcome) reasons.push('成果・展開');

  return {
    eligible,
    editorialScore,
    dimensions: dimensions.map(dimension => dimension.id),
    reasons,
    exclusionReasons: excludedByTopic
      ? hardExclusions.map(exclusion => exclusion.label)
      : [],
    hasAction,
    hasOutcome,
    farmerAiUseCase
  };
}

module.exports = {
  EDITORIAL_DIMENSIONS,
  evaluateEditorialFit
};
