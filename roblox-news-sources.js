'use strict';
const cheerio = require('cheerio');

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
  let published = $('meta[property="article:published_time"]').attr('content') || $('meta[name="date"]').attr('content');
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.datePublished && !published) published = value.datePublished;
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  }
  $('script[type="application/ld+json"]').each((_, element) => {
    try { visit(JSON.parse($(element).text())); } catch { /* non-JSON markup */ }
  });
  // Never use dateModified or the collection time as a publication date.
  const title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || $('title').text();
  $('script, style, nav, header, footer, aside').remove();
  const body = $('article').first().text() || $('main').first().text();
  const contentSnippet = (body || $('meta[name="description"]').attr('content') || '').replace(/\s+/g, ' ').trim().slice(0, 8000);
  return { title, link, source, published, contentSnippet };
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

module.exports = { DIRECT_SOURCES, discoverLinks, parseArticle, collectDirectArticles };
