'use strict';

const { evaluateEditorialFit } = require('./news-editorial-fit');
const { getArticlePublishedDate, NEWS_FRESHNESS_DAYS } = require('./news-freshness');
const { normalizeNewsText } = require('./news-keywords');

const { fieldSector } = require('./news-field-innovation');

const DAY = 24 * 60 * 60 * 1000;
const PREFERRED_AGE = 2 * DAY;
const HISTORY_TOPIC_AGE = NEWS_FRESHNESS_DAYS * DAY;
const AGRICULTURE = /農業|農家|農林水産|農産物|農園|営農|農政|農地|農機|農事組合|農協|農研|農学|農系|農村|就農|生産者|(?:稲|麦|米|野菜|果樹|花き|茶)作|栽培|水田|田んぼ|田植え|稲刈り|圃場|ほ場|直播|防除|病害虫|選果|畜産|酪農|養鶏|養豚|養殖|漁業|林業|飼料|茶の製法|果樹園|ブルーベリー園|食料安全保障|鳥インフルエンザ|豚熱/u;
const FIELD_VALUE = /省力|省人|人手不足|担い手|労働力|農業経営|販路|生産コスト|資材高|肥料高|収量|収穫|作付|産地|調達|実証|導入|研究成果|新技術|新品種|育成|補助金|助成|公募|制度|対策|防疫|被害|契約栽培|規格外|摘果|廃棄|食品ロス|農業政策|営農支援/u;
const PROMOTION = /再販|再登場|限定販売|季節限定|数量限定|期間限定|リニューアル|フェア開催|新メニュー|お取り寄せ|キャンペーン/u;
const PROMOTION_VALUE = /規格外|摘果|未利用|食品ロス|獣害|廃棄削減|販路拡大|契約栽培|生産者への還元|就農支援/u;
const EXCLUDED = /metagri|農情人|アグリゲーター|アグリゲート|アグリーメント|aggregator|aggregate|agreement/u;
const TRACKING_PARAMS = /^(?:utm_.+|fbclid|gclid|msclkid)$/i;
const PRESS_HOST = /(?:^|\.)(?:prtimes\.jp|atpress\.ne\.jp|value-press\.com|dreamnews\.jp|kyodonewsprwire\.jp)$/i;
const PRIMARY_HOST = /(?:^|\.)(?:maff\.go\.jp|naro\.go\.jp|affrc\.go\.jp|lg\.jp)$/i;

function newsUrlKey(value) {
  try {
    const url = new URL(String(value).trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    for (const param of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(param) || (param === 'source' && url.searchParams.get(param) === 'rss')) {
        url.searchParams.delete(param);
      }
    }
    url.searchParams.sort();
    return `${url.host}${url.pathname.replace(/\/+$/, '') || '/'}${url.search}`;
  } catch {
    return '';
  }
}

function titleKey(value) {
  return normalizeNewsText(value)
    .replace(/^\s*【(?:ニュース|プレスリリース|速報|お知らせ|研究成果)】/u, '')
    .replace(/\s*(?:\((?:日本農業新聞|マイナビ農業|農業協同組合新聞)\)|[|｜-]\s*(?:日本農業新聞|マイナビ農業|pr times|@press).*)\s*$/u, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function titleBigrams(text) {
  return new Set(Array.from({ length: text.length - 1 }, (_, i) => text.slice(i, i + 2)));
}

function sameTopic(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 18) return false;
  const caseNumber = /(?:国内|県内)?(\d+)例目/u;
  const firstCase = a.match(caseNumber)?.[1];
  const secondCase = b.match(caseNumber)?.[1];
  if (firstCase && secondCase && firstCase !== secondCase) return false;

  const first = titleBigrams(a);
  const second = titleBigrams(b);
  const overlap = [...first].filter(part => second.has(part)).length;
  const shorter = Math.min(first.size, second.size);
  const sameOpening = a.slice(0, 7) === b.slice(0, 7);
  const sameEnding = a.slice(-7) === b.slice(-7);
  // 配信先で見出しの中ほどだけ加筆された転載も、前後の固有の文言で照合する。
  return (sameOpening && overlap / shorter >= 0.92)
    || (sameOpening && sameEnding && overlap / shorter >= 0.82)
    || (a.slice(-10) === b.slice(-10) && overlap / shorter >= 0.88)
    || overlap / (first.size + second.size - overlap) >= 0.8;
}

function historyEntry(value) {
  return typeof value === 'string' ? { url: value } : value;
}

function selectNewsHeadlines(articles, { history = [], now = new Date(), limit = 3 } = {}) {
  const reference = new Date(now).getTime();
  const entries = history.map(historyEntry).filter(Boolean);
  const postedUrls = new Set(entries.map(entry => newsUrlKey(entry.url)).filter(Boolean));
  const recentTitles = entries.filter(entry => {
    const posted = new Date(entry.postedAt || '').getTime();
    return posted <= reference && posted >= reference - HISTORY_TOPIC_AGE;
  }).map(entry => titleKey(entry.title)).filter(Boolean);
  const rejected = {};
  const candidates = [];
  const reject = reason => { rejected[reason] = (rejected[reason] || 0) + 1; };

  for (const article of articles) {
    const published = getArticlePublishedDate(article);
    const age = reference - published?.getTime();
    if (!Number.isFinite(age) || age < 0 || age > NEWS_FRESHNESS_DAYS * DAY) {
      reject('公開日が期間外・不明');
      continue;
    }
    const urlKey = newsUrlKey(article.link);
    if (!article.title?.trim() || !urlKey || String(article.link).length > 400) {
      reject('見出し・URL不備');
      continue;
    }
    const topicKey = titleKey(article.title);
    if (postedUrls.has(urlKey) || recentTitles.some(title => sameTopic(topicKey, title))) {
      reject('投稿済み');
      continue;
    }

    const headline = normalizeNewsText(article.title).replace(/農林水産省|農林水産大臣/gu, ' ');
    const summary = normalizeNewsText(article.contentSnippet || article.summary || article.content || '')
      .replace(/農林水産省|農林水産大臣/gu, ' ');
    const text = `${headline} ${summary}`;
    const headlineIsAgriculture = AGRICULTURE.test(headline) || Boolean(fieldSector(headline));
    const fit = evaluateEditorialFit(article);
    const fieldInSummary = AGRICULTURE.test(summary) || fieldSector(summary);
    const technicalHeadline = /実証|運用|予測|推定|自動化|開発|計測/u.test(headline);
    const related = headlineIsAgriculture || (FIELD_VALUE.test(headline) && fieldInSummary)
      || (technicalHeadline && fit.innovation);
    if (EXCLUDED.test(text) || !related) {
      reject('農業・現場との関連が薄い');
      continue;
    }
    if (PROMOTION.test(headline) && !PROMOTION_VALUE.test(text)) {
      reject('商品・イベントの販促');
      continue;
    }

    const primary = PRIMARY_HOST.test(new URL(article.link).hostname);
    const press = PRESS_HOST.test(new URL(article.link).hostname) || PRESS_HOST.test(article.feedHost || '');
    // 省庁・研究機関の対策や成果は、編集カテゴリ数が少なくても拾う。
    const officialUpdate = primary && headlineIsAgriculture && FIELD_VALUE.test(headline)
      && fit.exclusionReasons.length === 0;
    if (!fit.eligible && !officialUpdate) {
      reject('具体性・編集基準');
      continue;
    }

    const reasons = [
      ...(officialUpdate ? ['発表元の情報'] : []),
      ...fit.reasons,
      ...(fit.farmerAiUseCase ? ['現場でのAI利用'] : [])
    ];
    const score = fit.editorialScore + (headlineIsAgriculture ? 4 : 0)
      + (FIELD_VALUE.test(headline) ? 4 : 0) + (primary ? 5 : 0)
      + (fit.farmerAiUseCase ? 8 : 0) - (press ? 4 : 0);
    candidates.push({
      ...article,
      isoDate: published.toISOString(),
      urlKey,
      topicKey,
      age,
      press,
      score,
      priorityLabel: fit.farmerAiUseCase ? '農家AI活用事例' : fit.innovation || reasons[0] || 'コア農業',
      editorialReason: reasons.slice(0, 3).join('・') || '農業の現場への影響',
      isFarmerAiUseCase: fit.farmerAiUseCase
    });
  }

  candidates.sort((a, b) => Number(b.age <= PREFERRED_AGE) - Number(a.age <= PREFERRED_AGE)
    || b.score - a.score || a.age - b.age || a.urlKey.localeCompare(b.urlKey));
  const priority = candidates.find(article => article.isFarmerAiUseCase && article.age <= PREFERRED_AGE);
  const ordered = priority ? [priority, ...candidates.filter(article => article !== priority)] : candidates;
  const selected = [];
  const distinct = [];
  for (const article of ordered) {
    if (distinct.some(previous => previous.urlKey === article.urlKey || sameTopic(previous.topicKey, article.topicKey))) {
      reject('同じ回の重複');
      continue;
    }
    distinct.push(article);
    if (selected.length < limit && (!article.press || !selected.some(previous => previous.press))) {
      selected.push(article);
    }
  }
  return { selected, rejected, candidates: distinct };
}

module.exports = { newsUrlKey, selectNewsHeadlines };
