'use strict';

/**
 * 官公庁・自治体 公募案件モニターの純粋ロジック。
 * ネットワーク・ファイルI/Oを持たないため単体テスト可能。
 *
 * 評価軸は Scheduled/public-opportunity-monitor/references/profile.md の
 * 100点ルーブリック（事業テーマ適合25／スケール20／応募可能性15／
 * 既存実績転用15／実行可能性15／緊急性10）をそのまま移植している。
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// 通知の下限。SKILL.md の「S・Aランクかつ65点以上」に一致させる。
const MIN_NOTIFY_SCORE = 65;
const NOTIFY_RANKS = ['S', 'A'];

// --- キーワード辞書 -------------------------------------------------------

// 「これは公募か」を判定する語。1つも無ければ候補にしない。
const CALL_KEYWORDS = [
  '公募', '募集', '提案募集', '参加者募集', 'アイデア募集', '企画提案',
  'プロポーザル', '応募', '申請受付', 'エントリー', 'コンテスト', 'アワード',
  'アクセラレーター', '実証実験', '実証事業', 'パートナー募集', '共創',
  'サポーター募集', '補助金', '助成金', '委託事業', '採択'
];

// 農業・地域側のテーマ
const DOMAIN_KEYWORDS = [
  '農業', '農林水産', '農山漁村', '農村', '農家', '生産者', '就農', '営農',
  'スマート農業', '畜産', '酪農', '園芸', '食料', '食品', 'フードテック',
  '地域', '地方創生', '中山間', '関係人口', '観光', '農泊', '地域資源',
  '一次産業', '林業', '水産', '食文化', '過疎', '集落'
];

// 技術側のテーマ
const TECH_KEYWORDS = [
  'ai', '人工知能', '生成ai', 'llm', 'デジタル', 'dx', 'データ活用',
  'デジタル技術', 'デジタル人材', 'ict', 'iot', 'ロボット', 'ドローン',
  'web3', 'nft', 'dao', 'ブロックチェーン', 'メタバース', 'xr',
  'デジタル公共財', 'オープンデータ', 'デジタルツイン', 'スタートアップ'
];

// 「地域寄りだがテーマが弱い」場合の補助語
const BRIDGE_KEYWORDS = [
  '課題解決', '社会実装', '官民連携', '官民共創', '共創', 'イノベーション',
  '担い手', '人材育成', '情報発信', 'プロモーション', 'ブランディング'
];

// スケール効果（予算・広報・実装・パートナー）
const SCALE_KEYWORDS = [
  '補助', '助成', '委託', '交付', '負担金', '人件費', '事業費', '経費',
  '実証', '社会実装', '現場実装', '伴走', 'マッチング', '専門家派遣',
  '広報', '事例', '事例化', '表彰', '全国展開', '横展開', 'モデル事業',
  'メンタリング', '展示', '登壇', 'ネットワーキング'
];

// 農情人の既存実績が転用できるか
const ASSET_KEYWORDS = [
  '自治体', '市町村', '都道府県', 'コンテスト', 'アワード', '動画',
  'セミナー', '講師', '研修', '講演', '調査', '実態調査', 'レポート',
  'コミュニティ', 'discord', '取材', 'メディア', '発信', '記事',
  'nft', 'web3', 'dao', 'メタバース', 'ハッカソン', '酪農', '生成ai',
  'コンソーシアム', '共同提案', '産学官'
];

// 応募主体の判定
const OPEN_APPLICANT_KEYWORDS = [
  '法人', '民間事業者', '民間企業', '企業', '事業者', '団体',
  'コンソーシアム', '共同提案', '共同事業体', 'グループ', 'スタートアップ'
];

const PARTNER_ONLY_KEYWORDS = [
  '地方公共団体が申請', '自治体が申請', '応募主体は市町村', '応募者は地方公共団体',
  '申請者は地方公共団体', '連携事業者', '協力事業者', '共同申請'
];

const PRODUCER_ONLY_KEYWORDS = [
  '農業者に限', '農業者のみ', '認定農業者に限', '農林漁業者に限',
  '生産者に限', '学校法人に限', '大学に限', '研究機関に限',
  '個人に限', '学生のみ', '地方公共団体に限'
];

// 除外（機会そのものが対象外）
const EXCLUDE_KEYWORDS = [
  '採択結果', '選定結果', '審査結果', '交付決定', '結果の公表', '結果について',
  '一般競争入札', '指名競争入札', '落札', '入札公告', '入札結果', '開札',
  '工事', '修繕', '保守', '清掃', '警備', '賃貸借', '物品購入', '調達仕様書',
  '公募型指名競争', '随意契約', '見積依頼', '不用決定', '売払'
];

// 設備・機械導入のみを目的とした補助金
const HARDWARE_ONLY_KEYWORDS = [
  '機械導入', '機械購入', '設備導入', '設備更新', '施設整備', '機器整備',
  '車両購入', 'ハウス整備', '農機具'
];

// 自己負担・体制要件（実行可能性の減点）
const BURDEN_KEYWORDS = [
  '自己負担', '自己資金', '補助率2分の1', '補助率1/2', '定額負担',
  '複数年度', '専任', '常駐', '事務所を有する'
];

// --- 文字列ユーティリティ -------------------------------------------------

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function opportunityText(item = {}) {
  return normalizeText(
    [
      item.title,
      item.organization,
      item.summary,
      item.body,
      Array.isArray(item.fit_reasons) ? item.fit_reasons.join(' ') : ''
    ]
      .filter(Boolean)
      .join(' ')
  );
}

function matchedKeywords(text, keywords) {
  return keywords.filter(keyword => text.includes(normalizeText(keyword)));
}

function includesAny(text, keywords) {
  return matchedKeywords(text, keywords).length > 0;
}

const TRACKING_PARAMS = new Set(['fbclid', 'gclid', 'yclid', 'mc_cid', 'mc_eid']);

/**
 * URLを正規化する（重複判定のキー）。
 * utm_*・トラッキング・末尾スラッシュ・フラグメントを落とす。
 */
function canonicalUrl(rawUrl) {
  const url = new URL(String(rawUrl).trim());
  const params = [...url.searchParams.entries()]
    .filter(([key]) => {
      const low = key.toLowerCase();
      return !low.startsWith('utm_') && !TRACKING_PARAMS.has(low);
    })
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  url.search = '';
  params.forEach(([key, value]) => url.searchParams.append(key, value));
  url.hash = '';
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  }
  return url.toString();
}

function hashString(value) {
  // 依存を増やさないため require('crypto') を遅延読み込み
  const { createHash } = require('crypto');
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

/** 案件の同一性キー（公式URLベース） */
function opportunityId(item) {
  return hashString(canonicalUrl(item.url)).slice(0, 20);
}

/** 内容変化の検知キー（タイトル・URL・締切） */
function opportunitySignature(item) {
  const material = [
    String(item.title || '').trim(),
    canonicalUrl(item.url),
    String(item.deadline || '').trim()
  ].join('|');
  return hashString(material);
}

// --- 日付処理 -------------------------------------------------------------

const ERA_OFFSETS = { 令和: 2018, 平成: 1988 };

/**
 * 日本語表記の日付を Date に変換する。
 * 「令和8年8月29日 17時00分」「2026/8/29」「2026-08-29」に対応。
 * 時刻が無い場合は締切当日の23:59:59（JST）として扱う。
 */
function parseJapaneseDate(rawText) {
  const text = String(rawText || '').normalize('NFKC');
  if (!text) return null;

  let year = null;
  let month = null;
  let day = null;

  const eraMatch = text.match(/(令和|平成)\s*(元|\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  const jpMatch = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  const isoMatch = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);

  if (eraMatch) {
    const eraYear = eraMatch[2] === '元' ? 1 : Number(eraMatch[2]);
    year = ERA_OFFSETS[eraMatch[1]] + eraYear;
    month = Number(eraMatch[3]);
    day = Number(eraMatch[4]);
  } else if (jpMatch) {
    year = Number(jpMatch[1]);
    month = Number(jpMatch[2]);
    day = Number(jpMatch[3]);
  } else if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const timeMatch = text.match(/(\d{1,2})\s*[:時]\s*(\d{1,2})?/);
  const hour = timeMatch ? Number(timeMatch[1]) : 23;
  const minute = timeMatch && timeMatch[2] !== undefined ? Number(timeMatch[2]) : 59;
  const second = timeMatch ? 0 : 59;

  if (hour > 23 || minute > 59) return null;

  const pad = number => String(number).padStart(2, '0');
  const iso =
    `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}+09:00`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const DEADLINE_LABELS = [
  '応募締切', '申請締切', '提出期限', '応募期限', '受付期限', '締切',
  '締め切り', '応募受付期間', '公募期間', '受付期間', '申込期限', '募集期間'
];

// 完全な日付（年月日）を拾うためのパターン
const DATE_PATTERNS = [
  /(令和|平成)\s*(?:元|\d{1,2})\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*\d{1,2}\s*[:時]\s*\d{1,2}?\s*分?)?/g,
  /\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*\d{1,2}\s*[:時]\s*\d{1,2}?\s*分?)?/g,
  /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s*\d{1,2}:\d{1,2})?/g
];

/**
 * 指定範囲に含まれる完全な日付のうち、最後に現れるものを返す。
 * 「令和8年7月27日から令和8年8月29日まで」のような期間表記では締切側を採る。
 */
function lastDateInText(text) {
  const found = [];
  for (const pattern of DATE_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match) {
      found.push({ index: match.index, value: match[0] });
      match = pattern.exec(text);
    }
  }
  if (found.length === 0) return null;

  found.sort((a, b) => a.index - b.index);
  for (let i = found.length - 1; i >= 0; i -= 1) {
    const parsed = parseJapaneseDate(found[i].value);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * 本文から応募締切を推定する。
 * 締切ラベル近傍120文字を見て、期間表記なら後ろ側（締切）の日付を採用する。
 */
function extractDeadline(rawText) {
  const text = String(rawText || '').normalize('NFKC');
  if (!text) return null;

  for (const label of DEADLINE_LABELS) {
    let index = text.indexOf(label);
    while (index !== -1) {
      const parsed = lastDateInText(text.slice(index, index + 120));
      if (parsed) return parsed;
      index = text.indexOf(label, index + label.length);
    }
  }
  return null;
}

function daysUntil(deadline, now = new Date()) {
  if (!deadline) return null;
  const target = deadline instanceof Date ? deadline : new Date(deadline);
  if (Number.isNaN(target.getTime())) return null;
  return Math.floor((target.getTime() - new Date(now).getTime()) / MS_PER_DAY);
}

// --- スコアリング ---------------------------------------------------------

function scoreTheme(text) {
  const domain = includesAny(text, DOMAIN_KEYWORDS);
  const tech = includesAny(text, TECH_KEYWORDS);
  const bridge = includesAny(text, BRIDGE_KEYWORDS);

  if (domain && tech) return 25;
  if (domain && bridge) return 16;
  if (tech && bridge) return 12;
  if (domain || tech) return 8;
  return 0;
}

function scoreCapped(text, keywords, perHit, cap) {
  return Math.min(cap, matchedKeywords(text, keywords).length * perHit);
}

function scoreEligibility(text) {
  if (includesAny(text, OPEN_APPLICANT_KEYWORDS)) return 15;
  if (includesAny(text, PARTNER_ONLY_KEYWORDS)) return 9;
  return 6; // 記載が読み取れない場合は「要確認」扱いで中間点
}

function scoreFeasibility(text, remainingDays) {
  let score = 15;
  if (remainingDays === null) score = 9;
  else if (remainingDays < 3) score = 5;
  else if (remainingDays < 10) score = 10;

  const burdens = matchedKeywords(text, BURDEN_KEYWORDS).length;
  return Math.max(0, score - Math.min(6, burdens * 2));
}

function scoreUrgency(remainingDays) {
  if (remainingDays === null) return 3;
  if (remainingDays <= 14) return 10;
  if (remainingDays <= 30) return 8;
  if (remainingDays <= 60) return 6;
  return 4;
}

function rankFromScore(score) {
  if (score >= 80) return 'S';
  if (score >= 65) return 'A';
  if (score >= 50) return 'B';
  return 'C';
}

/**
 * 除外理由を返す。null なら除外対象ではない。
 */
function exclusionReason(item, now = new Date()) {
  const text = opportunityText(item);

  // 入札・採択結果などは「公募」の語を含むことがあるため、先に種別で弾く
  const excluded = matchedKeywords(text, EXCLUDE_KEYWORDS);
  if (excluded.length > 0) return `対象外の種別（${excluded[0]}）`;

  if (!includesAny(text, CALL_KEYWORDS)) return '公募・募集の告知ではない';

  if (includesAny(text, PRODUCER_ONLY_KEYWORDS) && !includesAny(text, OPEN_APPLICANT_KEYWORDS)) {
    return '応募資格が農業者・自治体・研究機関等に限定';
  }

  if (
    includesAny(text, HARDWARE_ONLY_KEYWORDS) &&
    !includesAny(text, TECH_KEYWORDS) &&
    !includesAny(text, BRIDGE_KEYWORDS)
  ) {
    return '機械・設備導入のみを目的とした補助';
  }

  const remainingDays = daysUntil(item.deadline, now);
  if (remainingDays !== null && remainingDays < 0) return '締切済み';

  return null;
}

/**
 * 案件を100点で採点する。
 * @returns {{score:number, rank:string, breakdown:object, matched:object,
 *            excluded:boolean, exclusion_reason:string|null, remaining_days:number|null}}
 */
function scoreOpportunity(item, now = new Date()) {
  const text = opportunityText(item);
  const reason = exclusionReason(item, now);
  const remainingDays = daysUntil(item.deadline, now);

  if (reason) {
    return {
      score: 0,
      rank: 'C',
      breakdown: {},
      matched: {},
      excluded: true,
      exclusion_reason: reason,
      remaining_days: remainingDays
    };
  }

  const breakdown = {
    theme: scoreTheme(text),
    scale: scoreCapped(text, SCALE_KEYWORDS, 4, 20),
    eligibility: scoreEligibility(text),
    assets: scoreCapped(text, ASSET_KEYWORDS, 3, 15),
    feasibility: scoreFeasibility(text, remainingDays),
    urgency: scoreUrgency(remainingDays)
  };

  const score = Object.values(breakdown).reduce((total, value) => total + value, 0);

  return {
    score,
    rank: rankFromScore(score),
    breakdown,
    matched: {
      domain: matchedKeywords(text, DOMAIN_KEYWORDS).slice(0, 6),
      tech: matchedKeywords(text, TECH_KEYWORDS).slice(0, 6),
      scale: matchedKeywords(text, SCALE_KEYWORDS).slice(0, 6),
      assets: matchedKeywords(text, ASSET_KEYWORDS).slice(0, 6)
    },
    excluded: false,
    exclusion_reason: null,
    remaining_days: remainingDays
  };
}

/** 通知に値するか（S・Aかつ閾値以上） */
function qualifiesForNotification(item, minScore = MIN_NOTIFY_SCORE) {
  return NOTIFY_RANKS.includes(String(item.rank).toUpperCase()) && Number(item.score) >= minScore;
}

// --- 重複除外 -------------------------------------------------------------

function emptyState() {
  return { version: 1, seen: {}, last_run_at: null, last_result: {} };
}

/**
 * 通知済み履歴と突き合わせ、新規・更新のみを返す。
 * 同一URL・同一署名は再通知しない。締切変更などで署名が変われば更新通知。
 */
function selectNewOpportunities(items, state = emptyState()) {
  const seen = (state && state.seen) || {};
  const results = [];
  const localIds = new Set();

  for (const item of items) {
    let id;
    try {
      id = opportunityId(item);
    } catch (error) {
      continue; // URLが不正な候補は捨てる
    }
    if (localIds.has(id)) continue;
    localIds.add(id);

    const previous = seen[id];
    const signature = opportunitySignature(item);
    if (!previous) {
      results.push({ item, id, signature, updated: false });
    } else if (previous.signature !== signature) {
      results.push({ item, id, signature, updated: true });
    }
  }
  return results;
}

/** 通知後の履歴更新（純粋関数：新しいstateを返す） */
function recordNotified(state, entries, notifiedAt = new Date().toISOString()) {
  const next = {
    version: 1,
    seen: { ...((state && state.seen) || {}) },
    last_run_at: notifiedAt,
    last_result: (state && state.last_result) || {}
  };

  for (const { item, id, signature } of entries) {
    const previous = next.seen[id] || {};
    next.seen[id] = {
      signature,
      title: item.title,
      url: canonicalUrl(item.url),
      deadline: item.deadline || null,
      first_notified_at: previous.first_notified_at || notifiedAt,
      last_notified_at: notifiedAt
    };
  }
  return next;
}

/** 締切から一定期間過ぎた履歴を掃除してファイル肥大を防ぐ */
function pruneState(state, now = new Date(), keepDays = 400) {
  const seen = {};
  const cutoff = new Date(now).getTime() - keepDays * MS_PER_DAY;

  for (const [id, entry] of Object.entries((state && state.seen) || {})) {
    const stamp = new Date(entry.last_notified_at || entry.first_notified_at || 0).getTime();
    if (!Number.isNaN(stamp) && stamp >= cutoff) seen[id] = entry;
  }
  return { ...emptyState(), ...state, seen };
}

// --- Discord表示 ----------------------------------------------------------

function clip(value, limit) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

function bulletList(values, fallback = '—') {
  if (!Array.isArray(values)) return clip(values, 900) || fallback;
  const lines = values
    .filter(value => String(value || '').trim())
    .slice(0, 3)
    .map(value => `• ${clip(value, 280)}`);
  return lines.join('\n') || fallback;
}

function deadlineLabel(deadline, now = new Date()) {
  if (!deadline) return '要確認';
  const target = deadline instanceof Date ? deadline : new Date(deadline);
  if (Number.isNaN(target.getTime())) return clip(deadline, 100);

  const remaining = daysUntil(target, now);
  const formatted = target.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
  const urgent = remaining !== null && remaining <= 14 ? ' 🚨' : '';
  const days = remaining === null ? '' : `（残り約${Math.max(0, remaining)}日）`;
  return `${formatted}${days}${urgent}`;
}

/**
 * Discord Embed（JSON）を組み立てる。
 * discord.js の channel.send({ embeds: [embed] }) にそのまま渡せる形。
 */
function buildOpportunityEmbed(item, { updated = false, now = new Date() } = {}) {
  const rank = String(item.rank || '').toUpperCase();
  const prefix = updated ? '更新｜' : '';
  const fields = [
    {
      name: '所管・締切',
      value: `${clip(item.organization, 200) || '要確認'}\n${deadlineLabel(item.deadline, now)}`,
      inline: false
    },
    {
      name: '農情人との接続',
      value: bulletList(item.fit_reasons),
      inline: false
    },
    {
      name: '獲得できるもの',
      value: clip((item.use_cases || []).join(' / '), 500) || '要確認',
      inline: false
    },
    {
      name: '次の一手',
      value: clip(item.action, 900) || '公式ページと公募要領で応募資格・締切を確認する',
      inline: false
    }
  ];

  if (item.caution) {
    fields.push({ name: '要確認', value: clip(item.caution, 900), inline: false });
  }
  if (item.breakdown) {
    const parts = [
      `テーマ${item.breakdown.theme}/25`,
      `スケール${item.breakdown.scale}/20`,
      `参画${item.breakdown.eligibility}/15`,
      `実績転用${item.breakdown.assets}/15`,
      `実行${item.breakdown.feasibility}/15`,
      `緊急${item.breakdown.urgency}/10`
    ];
    fields.push({ name: '採点内訳', value: parts.join(' ・ '), inline: false });
  }

  return {
    title: clip(`${prefix}【${rank}・${item.score}点】${item.title}`, 256),
    url: canonicalUrl(item.url),
    description: clip(item.summary, 1500),
    color: rank === 'S' ? 0xe74c3c : 0xf39c12,
    fields,
    footer: { text: '株式会社農情人｜高親和性公募モニター' },
    timestamp: new Date(now).toISOString()
  };
}

module.exports = {
  MIN_NOTIFY_SCORE,
  NOTIFY_RANKS,
  CALL_KEYWORDS,
  DOMAIN_KEYWORDS,
  TECH_KEYWORDS,
  EXCLUDE_KEYWORDS,
  normalizeText,
  opportunityText,
  canonicalUrl,
  opportunityId,
  opportunitySignature,
  parseJapaneseDate,
  extractDeadline,
  daysUntil,
  exclusionReason,
  scoreOpportunity,
  rankFromScore,
  qualifiesForNotification,
  emptyState,
  selectNewOpportunities,
  recordNotified,
  pruneState,
  deadlineLabel,
  buildOpportunityEmbed
};
