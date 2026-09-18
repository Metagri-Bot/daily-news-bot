'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { collectRobloxArticles, isRobloxScopedFeed, mentionsRoblox } = require('../roblox-news');

const now = new Date('2026-09-18T00:00:00Z');
const logger = { log() {}, error() {} };
const page = `<meta property="article:published_time" content="2026-09-17T09:00:00Z">
  <h1>Retail brand opens a Roblox store</h1>
  <article>The retailer launched a Roblox experience tied to its physical collection.</article>`;

const broadItems = [
  { title: 'Retail brand opens a Roblox store', link: 'https://broad.example.com/a', isoDate: '2026-09-17T09:00:00Z' },
  { title: 'Pinterest unveils new ad tools', link: 'https://broad.example.com/b', isoDate: '2026-09-17T09:00:00Z' },
  { title: 'Weekly retail briefing', link: 'https://broad.example.com/c', isoDate: '2026-09-17T09:00:00Z',
    contentSnippet: 'The brief covers a Roblox activation and two store openings.' },
  { title: 'Robloxian creators share tips', link: 'https://broad.example.com/d', isoDate: '2026-09-17T09:00:00Z' },
];

function harness(items) {
  const fetched = [];
  return {
    fetched,
    options: {
      logger, now, directSources: [],
      fetchFeed: async () => ({ title: 'feed', items }),
      fetchPage: async url => { fetched.push(url); return page; },
    },
  };
}

test('広域フィードは見出しにも要約にもRobloxが無い項目をページ取得の前に落とす', async () => {
  const { fetched, options } = harness(broadItems);
  const stats = {};
  const result = await collectRobloxArticles({ urls: ['https://digiday.example.com/feed/'], stats, ...options });
  assert.deepEqual(fetched, ['https://broad.example.com/a', 'https://broad.example.com/c']);
  assert.equal(stats.prefiltered, 2);
  assert.equal(stats.collected, 2);
  assert.equal(result.length, 2);
});

test('要約にだけRobloxが出る項目は残す', () => {
  assert.equal(mentionsRoblox({ title: 'Weekly brief', contentSnippet: 'a Roblox activation' }), true);
});

test('Robloxianのような部分一致では拾わない', () => {
  assert.equal(mentionsRoblox({ title: 'Robloxian creators share tips', contentSnippet: '' }), false);
});

test('Roblox専用フィードは全項目をそのまま検証へ回す', async () => {
  const { fetched, options } = harness(broadItems);
  const stats = {};
  await collectRobloxArticles({ urls: ['https://techcrunch.example.com/tag/roblox/feed/'], stats, ...options });
  assert.equal(fetched.length, 4);
  assert.equal(stats.prefiltered, 0);
});

test('フィードURLの表記からRoblox専用かどうかを判定する', () => {
  for (const url of ['https://devforum.roblox.com/c/updates/45.rss',
    'https://techcrunch.com/tag/roblox/feed/',
    'https://news.google.com/rss/search?q=Roblox%20brand%20when%3A7d']) {
    assert.equal(isRobloxScopedFeed(url), true, url);
  }
  for (const url of ['https://digiday.com/feed/', 'https://www.marketingdive.com/feeds/news/',
    'https://toybook.com/feed/']) {
    assert.equal(isRobloxScopedFeed(url), false, url);
  }
});

test('広域フィードを足してもページ取得は言及のある件数までしか増えない', async () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ title: `Unrelated retail story ${i}`,
    link: `https://broad.example.com/${i}`, isoDate: '2026-09-17T09:00:00Z' }));
  const { fetched, options } = harness([...many, broadItems[0]]);
  const stats = {};
  await collectRobloxArticles({ urls: ['https://retaildive.example.com/feeds/news/'], stats, ...options });
  assert.equal(fetched.length, 1);
  assert.equal(stats.prefiltered, 40);
});
