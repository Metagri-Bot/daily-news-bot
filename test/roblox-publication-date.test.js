'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyFreshArticles, parseArticle } = require('../roblox-news-sources');
const { getRobloxFeeds, LOOKBACK_DAYS, rankRobloxArticles } = require('../roblox-news');
const now = new Date('2026-09-15T00:00:00Z');
const logger = { log() {}, error() {} };
const item = { title: 'Roblox brand campaign', link: 'https://example.com/article', isoDate: '2026-09-15T00:00:00Z', pubDate: '2026-09-15T00:00:00Z' };
const html = date => `<meta property="article:published_time" content="${date}"><h1>Roblox brand campaign</h1><article>Confirmed brand integration.</article>`;

test('検索RSSが新しくても前年の記事・8日前の記事は採用しない', async () => {
  for (const date of ['2025-06-15', '2026-09-07T23:59:59Z']) {
    const result = await verifyFreshArticles([item], { now, logger, fetchPage: async () => html(date) });
    assert.equal(result.length, 0);
  }
});

test('元記事の7日境界を採用し、RSS日付を選定用に残さない', async () => {
  const result = await verifyFreshArticles([item], { now, logger, fetchPage: async () => html('2026-09-08T00:00:00Z') });
  assert.equal(result.length, 1);
  assert.equal(result[0].published, '2026-09-08T00:00:00.000Z');
  assert.equal(result[0].isoDate, undefined);
  assert.equal(result[0].pubDate, undefined);
  assert.equal(rankRobloxArticles(result, { now }).length, 1);
});

test('取得拒否・公開日不明・更新日だけ・未来日はすべて見送る', async () => {
  for (const body of ['', '<script type="application/ld+json">{"dateModified":"2026-09-15"}</script>', html('2026-09-16')]) {
    assert.equal((await verifyFreshArticles([item], { now, logger, fetchPage: async () => body })).length, 0);
  }
  assert.equal((await verifyFreshArticles([item], { now, logger, fetchPage: async () => { throw new Error('403'); } })).length, 0);
});

test('新しいメタ日付と古いdatePublishedが矛盾したら古い公開日を優先', () => {
  const page = parseArticle(html('2026-09-14') + '<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2025-06-15","dateModified":"2026-09-14"}</script>', item.link, 'Campaign');
  assert.equal(page.published, '2025-06-15T00:00:00.000Z');
});

test('Google検索リンクの日付だけでは採用せず、直接取得できた記事は採用', async () => {
  const direct = parseArticle(html('2026-09-14'), item.link, 'Publisher');
  const result = await verifyFreshArticles([{ ...item, link: 'https://news.google.com/rss/articles/opaque' }, direct], { now, logger });
  assert.equal(result.length, 1);
  assert.equal(result[0].link, item.link);
});

test('環境設定のGoogle検索を含め全検索がwhen:7dになる', () => {
  assert.equal(LOOKBACK_DAYS, 7);
  const feeds = getRobloxFeeds('https://news.google.com/rss/search?q=Roblox+when:21d,https://news.google.com/rss/search?q=Roblox');
  assert.ok(feeds.every(feed => /\bwhen:7d\b/.test(new URL(feed).searchParams.get('q'))));
  assert.ok(feeds.every(feed => !decodeURIComponent(feed).includes('when:21d')));
});

test('RSS日付が7日より古い項目は元記事を取りに行かない', async () => {
  const fetched = [];
  const old = { ...item, isoDate: '2026-09-01T00:00:00Z', pubDate: '2026-09-01T00:00:00Z' };
  const result = await verifyFreshArticles([old], { now, logger,
    fetchPage: async url => { fetched.push(url); return html('2026-09-15T00:00:00Z'); } });
  assert.equal(result.length, 0);
  assert.deepEqual(fetched, []);
});

test('RSS日付が無い項目はこれまでどおり元記事を取得して判定する', async () => {
  const fetched = [];
  const undated = { title: 'Roblox brand campaign', link: 'https://example.com/undated' };
  const result = await verifyFreshArticles([undated], { now, logger,
    fetchPage: async url => { fetched.push(url); return html('2026-09-14T00:00:00Z'); } });
  assert.deepEqual(fetched, ['https://example.com/undated']);
  assert.equal(result.length, 1);
});

test('媒体ごとに異なる公開日メタからも公開日を読む', async () => {
  const variants = [
    '<meta property="og:article:published_time" content="2026-09-14T00:00:00Z">',
    '<meta name="parsely-pub-date" content="2026-09-14T00:00:00Z">',
    '<meta name="pubdate" content="2026-09-14T00:00:00Z">',
    '<meta name="DC.date.issued" content="2026-09-14T00:00:00Z">',
    '<time itemprop="datePublished" datetime="2026-09-14T00:00:00Z">Sep 14</time>',
  ];
  for (const meta of variants) {
    const result = await verifyFreshArticles([item], { now, logger,
      fetchPage: async () => `${meta}<h1>Roblox brand campaign</h1><article>Confirmed brand integration.</article>` });
    assert.equal(result.length, 1, meta);
    assert.equal(result[0].published, '2026-09-14T00:00:00.000Z', meta);
  }
});

test('更新日しか無い記事は引き続き見送る', async () => {
  const result = await verifyFreshArticles([item], { now, logger,
    fetchPage: async () => '<meta property="article:modified_time" content="2026-09-17T00:00:00Z"><h1>Roblox brand campaign</h1>' });
  assert.equal(result.length, 0);
});
