'use strict';
const cheerio = require('cheerio');
const { isNewsWithinFreshness } = require('./news-freshness');

const DIRECT_SOURCES = [
  { name: 'PR Newswire', url: 'https://www.prnewswire.com/search/news/?keyword=roblox', pattern: /\/news-releases\/[^/]+\.html$/ },
  { name: 'GEEIQ', url: 'https://geeiq.com/resources/blog', pattern: /\/resources\/blog\/[^/]+$/ },
  { name: 'License Global', url: 'https://www.licenseglobal.com/entertainment', pattern: /\/entertainment\/[^/]+$/ },
];

function discoverLinks(html, source) {
  const $ = cheerio.load(html);
  const links = new Set();
  $('a[href]').each((_, element) => {
    try {
      const url = new URL($(element).attr('href'), source.url);
      if (url.origin === new URL(source.url).origin && source.pattern.test(url.pathname)) links.add(url.href);
    } catch { /* malformed link */ }
  });
  return [...links].slice(0, 20);
}

function parseArticle(html, link, source) {
  const $ = cheerio.load(html);
  const dates = [];
  $('meta[property="article:published_time"], meta[name="date"], meta[itemprop="datePublished"]').each((_, el) => dates.push($(el).attr('content')));
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.datePublished) dates.push(value.datePublished);
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  }
  $('script[type="application/ld+json"]').each((_, element) => {
    try { visit(JSON.parse($(element).text())); } catch { /* non-JSON markup */ }
  });
  // Conflicting dates are handled conservatively: an older original publication
  // must not be hidden by a recent migration/republication timestamp.
  const validDates = dates.map(date => new Date(date)).filter(date => !Number.isNaN(date.getTime()));
  const published = validDates.length ? new Date(Math.min(...validDates.map(date => date.getTime()))).toISOString() : undefined;
  // Never use dateModified or the collection time as a publication date.
  const title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || $('title').text();
  $('script, style, nav, header, footer, aside').remove();
  const body = $('article').first().text() || $('main').first().text();
  const contentSnippet = (body || $('meta[name="description"]').attr('content') || '').replace(/\s+/g, ' ').trim().slice(0, 8000);
  return { title, link, source, published, contentSnippet, publicationVerified: !!published };
}

const GOOGLE_NEWS_HOST = 'news.google.com';
// Google's own properties never host the article itself.
const GOOGLE_OWNED_HOST = /(^|\.)(google\.[a-z.]+|gstatic\.com|googleapis\.com|googleusercontent\.com|goo\.gl|youtube\.com|blogger\.com)$/i;
// Share widgets and trackers sit next to the real link on a redirect page.
const NON_ARTICLE_HOST = /(^|\.)(facebook\.com|twitter\.com|x\.com|linkedin\.com|reddit\.com|pinterest\.com|instagram\.com|whatsapp\.com|t\.co|doubleclick\.net|schema\.org|w3\.org)$/i;
// Bound the extra requests a single run makes against Google News.
const RELAY_RESOLUTION_LIMIT = 30;

function isRelayLink(value) {
  try { return new URL(value).hostname === GOOGLE_NEWS_HOST; } catch { return false; }
}

function isExternalArticleUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol)
      && !GOOGLE_OWNED_HOST.test(url.hostname) && !NON_ARTICLE_HOST.test(url.hostname);
  } catch { return false; }
}

// Legacy Google News ids carry the original URL in a length-delimited protobuf
// field. Current ids (AU_yqL...) are opaque, so this returns null for them and
// the caller falls back to fetching the relay page.
function decodeRelayArticleId(link) {
  try {
    const id = new URL(link).pathname.split('/articles/')[1];
    if (!id) return null;
    const raw = Buffer.from(id.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    let offset = 0;
    while (offset < raw.length) {
      const wire = raw[offset++] & 0x07;
      if (wire === 0) { while (offset < raw.length && raw[offset++] & 0x80); continue; }
      if (wire !== 2) return null;
      let length = 0, shift = 0, byte;
      do { byte = raw[offset++]; length |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80 && offset < raw.length);
      const value = raw.subarray(offset, offset + length).toString('utf8');
      offset += length;
      if (isExternalArticleUrl(value)) return value;
    }
    return null;
  } catch { return null; }
}

// Read the destination out of a relay page. Declared destinations come first;
// the generic link scan is a last resort and can pick a neighbouring link, so a
// wrong guess must still fail the publication-date and Roblox checks downstream.
function extractRelayDestination(html) {
  const text = String(html || '');
  const candidates = [];
  const push = pattern => { for (const match of text.matchAll(pattern)) candidates.push(match[1]); };
  push(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*?url=([^"';]+)/gi);
  push(/data-n-au=["']([^"']+)["']/gi);
  push(/<meta[^>]+property=["']og:url["'][^>]*content=["']([^"']+)["']/gi);
  push(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/gi);
  push(/href=["'](https?:\/\/[^"'\s<>]{12,600})["']/gi);
  for (const candidate of candidates) {
    const value = candidate.replace(/&amp;/g, '&').trim();
    if (isExternalArticleUrl(value)) return value;
  }
  return null;
}

// A relay link hides the original publication date, so resolve the source
// article instead of discarding the candidate outright.
async function resolveRelayArticle(article, { fetchPage }) {
  const embedded = decodeRelayArticleId(article.link);
  if (embedded) return { page: parseArticle(await fetchPage(embedded), embedded, article.source), via: 'id' };
  const html = await fetchPage(article.link);
  const destination = extractRelayDestination(html);
  // The fetcher follows redirects, so the relay body can already be the article.
  const direct = parseArticle(html, destination || article.link, article.source);
  if (direct.publicationVerified) return { page: direct, via: destination ? 'redirect' : 'relay' };
  if (!destination) return null;
  return { page: parseArticle(await fetchPage(destination), destination, article.source), via: 'page' };
}

async function verifyFreshArticles(articles, { fetchPage, now = new Date(), logger = console, stats = {}, relayLimit = RELAY_RESOLUTION_LIMIT } = {}) {
  const verified = [];
  const cache = new Map();
  const relayCache = new Map();
  let old = 0, unknown = 0, resolved = 0, unresolved = 0, skipped = 0;
  for (let i = 0; i < articles.length; i += 4) {
    const batch = await Promise.all(articles.slice(i, i + 4).map(async article => {
      try {
        let page = article;
        let relayLink;
        if (!article.publicationVerified) {
          const url = new URL(article.link);
          // Aggregators provide discovery dates, not reliable original publication
          // dates. A directly collected version can still be included independently.
          if (!fetchPage || !['http:', 'https:'].includes(url.protocol)) { unknown++; return null; }
          if (isRelayLink(url.href)) {
            if (!relayCache.has(url.href) && relayCache.size >= relayLimit) { skipped++; return null; }
            relayLink = url.href;
            if (!relayCache.has(url.href)) relayCache.set(url.href, resolveRelayArticle(article, { fetchPage })
              .catch(error => { logger.error(`[Roblox News] relay resolution failed: ${url.href}: ${error.message}`); return null; }));
            const relayed = await relayCache.get(url.href);
            if (!relayed) { unresolved++; unknown++; return null; }
            resolved++;
            page = relayed.page;
          } else {
            if (!cache.has(url.href)) cache.set(url.href, fetchPage(url.href).then(html => parseArticle(html, url.href, article.source)));
            page = await cache.get(url.href);
          }
        }
        if (!page.publicationVerified) { unknown++; return null; }
        // Do not copy isoDate/pubDate from the RSS item: shared date helpers give
        // those fields priority over published and could otherwise re-admit old news.
        if (!isNewsWithinFreshness({ published: page.published }, now, 7)) { old++; return null; }
        return { ...page, title: page.title || article.title, source: article.source,
          // Keep the relay URL: history written before resolution only holds that spelling.
          ...(relayLink ? { relayLinks: [relayLink] } : {}),
          rssPublished: article.isoDate || article.pubDate || article.published };
      } catch (error) {
        unknown++;
        logger.error(`[Roblox News] publication verification failed: ${article.link}: ${error.message}`);
        return null;
      }
    }));
    verified.push(...batch.filter(Boolean));
  }
  Object.assign(stats, { verified: verified.length, outdated: old, unverified: unknown,
    relayResolved: resolved, relayUnresolved: unresolved, relaySkipped: skipped });
  logger.log(`[Roblox News] publication verified=${verified.length} outside7days=${old} unverified=${unknown} relay=${resolved} relayFailed=${unresolved} relaySkipped=${skipped}`);
  return verified;
}

async function collectDirectArticles({ fetchPage, logger = console, sources = DIRECT_SOURCES }) {
  const articles = [];
  for (const source of sources) {
    try {
      const links = discoverLinks(await fetchPage(source.url), source);
      let succeeded = 0;
      for (let i = 0; i < links.length; i += 4) {
        const batch = await Promise.all(links.slice(i, i + 4).map(async link => {
          try {
            const article = parseArticle(await fetchPage(link), link, source.name);
            succeeded++;
            return article;
          } catch (error) { logger.error(`[Roblox News] page failed: ${link}: ${error.message}`); return null; }
        }));
        articles.push(...batch.filter(Boolean));
      }
      logger.log(`[Roblox News] direct=${source.name} discovered=${links.length} fetched=${succeeded}`);
    } catch (error) { logger.error(`[Roblox News] direct failed: ${source.name}: ${error.message}`); }
  }
  return articles;
}

module.exports = { DIRECT_SOURCES, RELAY_RESOLUTION_LIMIT, discoverLinks, parseArticle, collectDirectArticles,
  verifyFreshArticles, isRelayLink, decodeRelayArticleId, extractRelayDestination, resolveRelayArticle };
