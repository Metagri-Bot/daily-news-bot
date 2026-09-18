'use strict';
const cheerio = require('cheerio');
const { isNewsWithinFreshness, getArticlePublishedDate } = require('./news-freshness');

const DIRECT_SOURCES = [
  // 公式発表はRSSが無く検索経由でも落ちやすいので直接巡回する。
  // 記事は /newsroom/YYYY/MM/slug で、article:published_time を持つ。
  { name: 'Roblox Newsroom', url: 'https://about.roblox.com/newsroom', pattern: /^\/newsroom\/\d{4}\/\d{2}\/[^/]+$/ },
  { name: 'PR Newswire', url: 'https://www.prnewswire.com/search/news/?keyword=roblox', pattern: /\/news-releases\/[^/]+\.html$/ },
  { name: 'GEEIQ', url: 'https://geeiq.com/resources/blog', pattern: /\/resources\/blog\/[^/]+$/ },
  // 2026-09-18時点でこのサーバーのIP/UAからは一覧・RSSともに403。毎回失敗ログだけ出るため
  // 止めている。Google Newsの site:licenseglobal.com 検索が同じ媒体を拾っている。
  { name: 'License Global', url: 'https://www.licenseglobal.com/entertainment', pattern: /\/entertainment\/[^/]+$/, enabled: false },
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
  // 媒体ごとに公開日の置き場が違う。dateModified・更新日は含めない（古い方を採る規則の
  // 前提が崩れるため）。実測では中継解決に成功しても公開日が読めず落ちる記事が最多だった。
  $([
    'meta[property="article:published_time"]',
    'meta[property="og:article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[name="date"]',
    'meta[name="pubdate"]',
    'meta[name="publish-date"]',
    'meta[name="publication_date"]',
    'meta[name="parsely-pub-date"]',
    'meta[name="sailthru.date"]',
    'meta[name="DC.date.issued"]',
    'meta[itemprop="datePublished"]',
  ].join(', ')).each((_, el) => dates.push($(el).attr('content')));
  $('time[itemprop="datePublished"][datetime], time[pubdate][datetime]').each((_, el) => dates.push($(el).attr('datetime')));
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

// User-Agent だけの素のリクエストは Fashionista・Toy Book・License Global などが
// 403 で弾く（2026-09-18の実測）。ブラウザ相当のAcceptを添える。
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const GOOGLE_NEWS_HOST = 'news.google.com';
// Google's own properties never host the article itself.
const GOOGLE_OWNED_HOST = /(^|\.)(google\.[a-z.]+|gstatic\.com|googleapis\.com|googleusercontent\.com|goo\.gl|youtube\.com|blogger\.com)$/i;
// Share widgets, trackers and CDNs sit next to the real link on a redirect page.
// google-analytics.com は2026-09-19の実測で中継173件すべての誤解決先だった。
const NON_ARTICLE_HOST = /(^|\.)(facebook\.com|twitter\.com|x\.com|linkedin\.com|reddit\.com|pinterest\.com|instagram\.com|whatsapp\.com|t\.co|doubleclick\.net|schema\.org|w3\.org|google-analytics\.com|googletagmanager\.com|googlesyndication\.com|gvt1\.com|cloudflare\.com|jsdelivr\.net|bootstrapcdn\.com)$/i;
// 記事ではなく資源ファイルを指すURL。
const ASSET_PATH = /\.(?:js|mjs|css|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|map|json|xml|rss|txt)(?:$|\?)/i;
// Bound the extra requests a single run makes against Google News.
// 実測: 30本上限で151本、120本上限でも50本を捨てていた。解決失敗は2回とも0本。
// 広域フィードの事前フィルタでページ取得の総量が下がったぶんをここに回す。
const RELAY_RESOLUTION_LIMIT = 200;
// 解決先の公開日が連続で読めない＝解決方法が通用していない。無駄な取得を打ち切る。
// 2026-09-19は173件すべてが空振りで、そのぶん他媒体の取得を圧迫していた。
const RELAY_FAILURE_STREAK_LIMIT = 20;

function isRelayLink(value) {
  try { return new URL(value).hostname === GOOGLE_NEWS_HOST; } catch { return false; }
}

function isExternalArticleUrl(value) {
  try {
    const url = new URL(value);
    // トップページと資源ファイルは記事ではない。リンク走査の取り違えはここで落ちる。
    return ['http:', 'https:'].includes(url.protocol) && url.pathname.replace(/\/+$/, '').length > 1
      && !ASSET_PATH.test(url.pathname)
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
  const $ = cheerio.load(String(html || ''));
  const candidates = [];
  const refresh = $('meta[http-equiv="refresh" i]').attr('content') || '';
  const refreshMatch = refresh.match(/url=([^;]+)/i);
  if (refreshMatch) candidates.push(refreshMatch[1]);
  $('[data-n-au]').each((_, element) => candidates.push($(element).attr('data-n-au')));
  candidates.push($('meta[property="og:url"]').attr('content'));
  candidates.push($('link[rel="canonical"]').attr('href'));
  // 最終手段はアンカーのみを見る。<link rel="dns-prefetch"> や <script src> のような
  // 資源リンクを記事と取り違えないため（実測で計測タグを全件拾っていた）。
  $('a[href]').each((_, element) => candidates.push($(element).attr('href')));
  for (const candidate of candidates) {
    const value = String(candidate || '').replace(/&amp;/g, '&').trim();
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
  let old = 0, unknown = 0, resolved = 0, unresolved = 0, skipped = 0, relayDated = 0;
  let undatedStreak = 0;
  // 解決できても公開日が読めなければ候補にならない。どの媒体で落ちているかを残す。
  const landings = new Map();
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
          // RSSの日付は採用判断には使わない。ただし公開日は「併記された中で最も古い日付」を
          // 採るため、RSS日付が期間外の記事が新しい公開日に覆ることはない。取りに行く理由が
          // ないので除外だけに使う（2026-09-18の実測では187本がここに該当）。
          const feedDate = getArticlePublishedDate(article);
          if (feedDate && feedDate.getTime() < new Date(now).getTime() - 7 * 86400000) { old++; return null; }
          if (isRelayLink(url.href)) {
            if (undatedStreak >= RELAY_FAILURE_STREAK_LIMIT) { skipped++; return null; }
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
        if (!page.publicationVerified) {
          if (relayLink) {
            let host = '(不明)';
            try { host = new URL(page.link).hostname; } catch { /* 解決先が不正 */ }
            landings.set(host, (landings.get(host) || 0) + 1);
            undatedStreak++;
          }
          unknown++; return null;
        }
        if (relayLink) { relayDated++; undatedStreak = 0; }
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
  const topLandings = [...landings.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([host, count]) => `${host}:${count}`).join(' ');
  Object.assign(stats, { verified: verified.length, outdated: old, unverified: unknown,
    relayResolved: resolved, relayVerified: relayDated, relayUnresolved: unresolved, relaySkipped: skipped,
    relayLandings: topLandings });
  logger.log(`[Roblox News] publication verified=${verified.length} outside7days=${old} unverified=${unknown} relay=${resolved} relayDated=${relayDated} relayFailed=${unresolved} relaySkipped=${skipped}`);
  if (topLandings) logger.log(`[Roblox News] 公開日を読めなかった解決先: ${topLandings}`);
  if (undatedStreak >= RELAY_FAILURE_STREAK_LIMIT) {
    logger.log(`[Roblox News] 中継URLの解決が${RELAY_FAILURE_STREAK_LIMIT}件連続で空振りしたため、以降の解決を打ち切りました。`);
  }
  return verified;
}

async function collectDirectArticles({ fetchPage, logger = console, sources = DIRECT_SOURCES }) {
  const articles = [];
  for (const source of sources.filter(source => source.enabled !== false)) {
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

module.exports = { DIRECT_SOURCES, RELAY_RESOLUTION_LIMIT, RELAY_FAILURE_STREAK_LIMIT, BROWSER_HEADERS, discoverLinks, parseArticle, collectDirectArticles,
  verifyFreshArticles, isRelayLink, decodeRelayArticleId, extractRelayDestination, resolveRelayArticle };
