'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getArticlePublishedDate, isNewsWithinFreshness } = require('./news-freshness');

const LOOKBACK_DAYS = 21;
// US English search is independent of the deployment machine's locale.
const SEARCH_QUERIES = [
  'Roblox (brand OR partnership OR integration OR activation OR campaign)',
  'Roblox (beauty OR haircare OR toys OR licensing OR retail OR commerce)',
  'Roblox (building OR collection OR toy OR collectibles)',
  'Roblox site:prnewswire.com',
  'Roblox site:businesswire.com',
  'Roblox site:licenseglobal.com',
  'Roblox site:geeiq.com',
  'Roblox site:fashionista.com',
];

function getRobloxFeeds(configured = '') {
  const custom = configured.split(',').map(s => s.trim()).filter(Boolean);
  return [...new Set([...custom, ...SEARCH_QUERIES.map(query =>
    `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:${LOOKBACK_DAYS}d`)}&hl=en-US&gl=US&ceid=US:en`
  ),
  // Search-engine date filters can omit correctly dated articles. Validate dates locally.
  `https://news.google.com/rss/search?q=${encodeURIComponent('Roblox site:licenseglobal.com (collection OR launches OR toys)')}&hl=en-US&gl=US&ceid=US:en`,
  ])];
}

function cleanText(text = '') {
  return String(text).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

const TITLE_STOP_WORDS = new Set(('a an the and or of to in on for with by from as at its it is are ' +
  'new now into through brings bring launches launch launched launching releases release released ' +
  'announces announced announcement roblox game games gaming experience experiences brand brands ' +
  'company worldwide continues takes next level').split(' '));

function headline(article) {
  const title = cleanText(article.title || '').normalize('NFKC');
  // Only strip a known source, not a meaningful subtitle after a dash.
  const source = cleanText(article.source || '');
  return source && title.toLowerCase().endsWith(` - ${source.toLowerCase()}`)
    ? title.slice(0, -(source.length + 3)) : title;
}

function titleTokens(article) {
  return [...new Set((headline(article).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter(word => !TITLE_STOP_WORDS.has(word) && (word.length > 1 || /^\d$/.test(word))))].sort();
}

function similarTokens(a, b) {
  const common = a.filter(word => b.includes(word)).length;
  // A different quarter/year is a distinct update, even with a recycled headline.
  const periods = tokens => tokens.filter(word => /^(?:\d+|q[1-4])$/.test(word));
  const ap = periods(a), bp = periods(b);
  if (ap.length && bp.length && !ap.some(word => bp.includes(word))) return false;
  const aq = a.filter(word => /^q[1-4]$/.test(word)), bq = b.filter(word => /^q[1-4]$/.test(word));
  if (aq.length && bq.length && !aq.some(word => bq.includes(word))) return false;
  return common >= 3 && common / Math.min(a.length, b.length) >= 0.65
    && common / (a.length + b.length - common) >= 0.3;
}

function duplicateKeys(article) {
  const words = headline(article).match(/[\p{L}\p{N}]+/gu) || [];
  const phrases = [];
  for (let i = 0; i + 2 < words.length; i++) {
    const phrase = words.slice(i, i + 3);
    if (phrase.every(word => /^[A-Z]/.test(word) && !TITLE_STOP_WORDS.has(word.toLowerCase()))) {
      phrases.push(`named-phrase:${phrase.join(' ').toLowerCase()}`);
    }
  }
  return [...articleKeys(article), ...phrases, `fingerprint:${JSON.stringify(titleTokens(article))}`];
}

function matchesKeys(article, keys) {
  if (duplicateKeys(article).some(key => keys.has(key))) return true;
  const compactTitle = headline(article).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const tokens = titleTokens(article);
  for (const key of keys) {
    if (key.startsWith('experience:') && compactTitle.includes(key.slice(11).replace(/[^\p{L}\p{N}]/gu, ''))) return true;
    if (key.startsWith('fingerprint:')) {
      try { if (similarTokens(tokens, JSON.parse(key.slice(12)))) return true; } catch { /* legacy entry */ }
    }
  }
  return false;
}

function groupRobloxArticles(articles) {
  const groups = [];
  for (const article of articles) {
    const ownKeys = new Set(duplicateKeys(article));
    const matches = groups.filter(group => matchesKeys(article, group.keys)
      || group.articles.some(other => matchesKeys(other, ownKeys)));
    const group = { articles: [article], keys: ownKeys };
    for (const match of matches) {
      group.articles.push(...match.articles);
      for (const key of match.keys) group.keys.add(key);
      groups.splice(groups.indexOf(match), 1);
    }
    groups.push(group);
  }
  return groups;
}

function adaptiveLimit(count) {
  return count >= 8 ? 8 : Math.min(count, 5);
}

function postedArticleContext(articles, sent, now = new Date()) {
  const keys = new Set(Object.entries(sent).filter(([, date]) => new Date(date).getTime() >= new Date(now).getTime() - 30 * 86400000).map(([key]) => key));
  for (const key of [...keys]) if (key.startsWith('url:')) articleKeys({ link: key.slice(4) }).forEach(k => keys.add(k));
  const titles = new Set();
  return articles.filter(a => matchesKeys(a, keys))
    .sort((a, b) => (b.contentSnippet || '').length - (a.contentSnippet || '').length)
    .filter(a => { const title = headline(a).toLowerCase(); if (titles.has(title)) return false; titles.add(title); return true; })
    .slice(0, 30).map(a => ({ title: a.title, excerpt: (a.contentSnippet || '').slice(0, 2500) }));
}

function scoreRobloxArticle(article) {
  // Never match feed title or source domain: broad business feeds contain unrelated news.
  // Long press releases can mention Roblox only in an unrelated biography/footer.
  const snippet = cleanText(article.contentSnippet || '');
  const relevantSentences = snippet.split(/(?<=[.!?])\s+/).filter(sentence => /\broblox\b/i.test(sentence)).join(' ');
  const text = cleanText(`${article.title || ''} ${relevantSentences}`).toLowerCase();
  if (!/\broblox\b/.test(text)) return { score: 0, label: '', business: false };
  const isForum = /^https?:\/\/devforum\.roblox\.com\//i.test(article.link || '');
  const business = !isForum && (/\b(brands?|partnerships?|collaborations?|campaigns?|activations?|integrations?|retail|e-?commerce|licensing|licensed|beauty|haircare|toys?|blind boxes|gamification|salon)\b/.test(text)
    || /\blaunch(?:es|ed|ing)?\b.*\b(collection|experience|game|world)\b/.test(text));
  const categories = [];
  let score = 0;
  if (business) { score += 10; categories.push('Business/Brand'); }
  if (business && /\b(pr newswire|business wire|license global|geeiq)\b/i.test(article.source || '')) score += 3;
  if (/\b(updates?|features?|engine|studio|developers?|creators?|economy|monetization|marketplace|immersive ads|ugc|evaluation|age verification)\b/.test(text)) {
    score += 5; categories.push('Platform Update');
  }
  if (/\b(earnings|revenue|stock|shares|investment|acquisition|ipo|financial|quarterly|growth|mau|dau)\b/.test(text)) {
    score += 4; categories.push('Finance/Market');
  }
  if (/\b(ai|generative ai|metaverse|avatars?|vr|ar|physics|rendering|phygital|virtual goods|digital twin|shopify)\b/.test(text)) {
    score += 3; categories.push('Tech/Innovation');
  }
  return { score, label: categories.join(' & '), business };
}

function articleKeys(article) {
  let url;
  try {
    url = new URL(article.link);
    if (!['https:', 'http:'].includes(url.protocol)) return [];
  } catch { return []; }
  url.hash = '';
  url.hostname = url.hostname.replace(/^www\./, '');
  url.pathname = url.pathname.replace(/\/$/, '') || '/';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  const title = cleanText(article.title).replace(/\s[-–|]\s[^–|]+$/, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
  // Quoted experience names unite differently headlined coverage of the same launch.
  const campaigns = [...cleanText(article.title).matchAll(/["“‘']([^"”’']{6,80})["”’']/g)]
    .map(match => match[1].toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim())
    .filter(name => name.split(' ').length >= 3);
  return [`url:${url.href}`, ...(title ? [`title:${title}`] : []), ...campaigns.map(name => `experience:${name}`)];
}

function rankRobloxArticles(articles, { now = new Date(), sent = {}, logger } = {}) {
  const seen = new Set(Object.entries(sent)
    .filter(([, date]) => new Date(date).getTime() >= new Date(now).getTime() - 30 * 86400000)
    .map(([key]) => key));
  // Include legacy URL spelling in history; normalization must not reset prior postings.
  for (const key of [...seen]) if (key.startsWith('url:')) {
    articleKeys({ link: key.slice(4) }).forEach(normalized => seen.add(normalized));
  }
  const candidates = articles.filter(a => isNewsWithinFreshness(a, now, LOOKBACK_DAYS))
    .map(a => ({ ...a, ...scoreRobloxArticle(a) }))
    .filter(a => a.score >= 4)
    .sort((a, b) => b.score - a.score || getArticlePublishedDate(b) - getArticlePublishedDate(a));
  const groups = groupRobloxArticles(candidates.filter(a => articleKeys(a).length));
  const unique = groups.filter(group => !group.articles.some(a => matchesKeys(a, seen)))
    .map(group => ({ ...group.articles.sort((a, b) => b.score - a.score || getArticlePublishedDate(b) - getArticlePublishedDate(a))[0],
      duplicateKeys: [...group.keys], relatedArticleCount: group.articles.length }))
    .sort((a, b) => b.score - a.score || getArticlePublishedDate(b) - getArticlePublishedDate(a));
  logger?.log(`[Roblox News] eligible=${candidates.length} topics=${groups.length} unseen=${unique.length}`);
  return unique;
}

function selectRobloxArticles(articles, { limit, ...options } = {}) {
  const unique = rankRobloxArticles(articles, options);
  limit = limit === undefined ? adaptiveLimit(unique.length) : Math.max(0, Math.min(8, Math.floor(Number(limit) || 0)));
  // Reserve up to three places for commercial cases; unused places stay available.
  const priority = unique.filter(a => a.business).slice(0, Math.min(3, limit));
  return [...priority, ...unique.filter(a => !priority.includes(a))].slice(0, limit);
}

async function collectRobloxArticles({ urls, fetchFeed, fetchPage, logger = console, now = new Date() }) {
  const articles = [];
  // Bounded batches keep the extra search feeds from overwhelming the network.
  for (let i = 0; i < urls.length; i += 4) {
    const results = await Promise.all(urls.slice(i, i + 4).map(async url => {
      try {
        const feed = await fetchFeed(url);
        logger.log(`[Roblox News] feed=${url} fetched=${feed.items?.length || 0}`);
        return (feed.items || []).map(item => ({
          ...item,
          source: (typeof item.source === 'string' ? item.source : item.source?._)
            || (/^https?:\/\/news\.google\.com\//.test(item.link || '') ? item.title?.split(' - ').at(-1) : null) || feed.title,
          contentSnippet: cleanText(item.contentSnippet || item.content || item.summary || ''),
          published: getArticlePublishedDate(item),
        }));
      } catch (error) {
        logger.error(`[Roblox News] feed failed: ${url}: ${error.message}`);
        return [];
      }
    }));
    articles.push(...results.flat());
  }
  if (fetchPage) {
    const { collectDirectArticles } = require('./roblox-news-sources');
    articles.push(...await collectDirectArticles({ fetchPage, logger }));
  }
  logger.log(`[Roblox News] collected=${articles.length} fresh=${articles.filter(a => isNewsWithinFreshness(a, now, LOOKBACK_DAYS)).length}`);
  return articles;
}

function loadHistory(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid Roblox history');
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error; // Do not silently replay everything if persisted history is damaged.
  }
}

function saveHistory(file, sent, articles, now = new Date()) {
  const cutoff = new Date(now).getTime() - 30 * 86400000;
  const next = Object.fromEntries(Object.entries(sent).filter(([, date]) => new Date(date).getTime() >= cutoff));
  for (const article of articles) {
    const keys = [...duplicateKeys(article), ...(article.duplicateKeys || []), `editorial-title:${headline(article)}`];
    if (article.topicKey) keys.push(`topic:${article.topicKey}`);
    for (const key of keys) next[key] = new Date(now).toISOString();
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(next, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

module.exports = { LOOKBACK_DAYS, SEARCH_QUERIES, getRobloxFeeds, scoreRobloxArticle,
  articleKeys, selectRobloxArticles, collectRobloxArticles, loadHistory, saveHistory,
  adaptiveLimit, groupRobloxArticles, titleTokens, rankRobloxArticles, postedArticleContext };
