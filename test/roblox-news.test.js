'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getRobloxFeeds, selectRobloxArticles, scoreRobloxArticle, collectRobloxArticles,
  articleKeys, loadHistory, saveHistory } = require('../roblox-news');
const now = new Date('2026-09-05T00:00:00Z');
const article = (title, extra = {}) => ({ title, link: `https://example.com/${encodeURIComponent(title)}`, published: '2026-09-03', ...extra });

test('添付3事例とGEEIQ分析が未知ブランド名でも選定される', () => {
  const examples = [
    article('DAISE takes the gamification of beauty to the next level with Dollface blind boxes coming to Roblox', { published: '2026-08-28' }),
    article('BLDR launches new Monster Jam collection and Roblox game', { published: '2026-08-24' }),
    article('The Doux launches My Salon Empire on Roblox celebrating textured hair', { published: '2026-08-31' }),
    article("What do Roblox's evaluation changes mean for brands?"),
  ];
  assert.equal(selectRobloxArticles(examples, { now }).length, 4);
  assert.ok(examples.every(a => scoreRobloxArticle(a).business));
});

test('短い語の部分一致とRoblox無関係記事を加点しない', () => {
  assert.equal(scoreRobloxArticle(article('Roblox chair guide')).score, 0);
  assert.equal(scoreRobloxArticle(article('Beauty brand launches game on Fortnite')).score, 0);
  assert.equal(scoreRobloxArticle(article('Roblox AI and AR rendering')).score, 3);
});

test('21日境界・未来・日付不明を検証', () => {
  const items = ['2026-08-15T00:00:00Z', '2026-08-14T23:59:59Z', '2026-09-06', null, 'invalid']
    .map((published, i) => article(`Roblox brand ${i}`, { published }));
  assert.equal(selectRobloxArticles(items, { now }).length, 1);
});

test('企業事例枠、URL/タイトル重複、投稿済み除外', () => {
  const business = article('Roblox beauty partnership');
  const platform = Array.from({ length: 8 }, (_, i) => article(`Roblox developer revenue AI update ${i}`));
  const copy = { ...business, link: business.link + '?utm_source=test' };
  const result = selectRobloxArticles([...platform, business, copy], { now });
  assert.equal(result.length, 8);
  assert.equal(result[0].title, business.title);
  assert.equal(result.filter(a => a.business).length, 1);
  const sent = Object.fromEntries(articleKeys(business).map(k => [k, now.toISOString()]));
  assert.equal(selectRobloxArticles([business, copy], { now, sent }).length, 0);
});

test('設定RSSを保持し、英語検索を追加、空要素・重複を除く', () => {
  const feeds = getRobloxFeeds(' https://example.com/rss, ,https://example.com/rss');
  assert.equal(feeds.filter(f => f === 'https://example.com/rss').length, 1);
  assert.ok(feeds.some(f => f.includes('prnewswire.com') && f.includes('ceid=US:en')));
});

test('一部取得失敗でも継続しRSS本文を選定に渡す', async () => {
  const errors = [];
  const articles = await collectRobloxArticles({ urls: ['bad', 'good'], now,
    logger: { log() {}, error(message) { errors.push(message); } },
    fetchFeed: async url => {
      if (url === 'bad') throw new Error('timeout');
      return { title: 'Business news', items: [{ title: 'New collection', link: 'https://example.com/a', pubDate: '2026-09-03', content: '<p>Roblox brand integration</p>' }] };
    },
  });
  assert.equal(errors.length, 1);
  assert.equal(selectRobloxArticles(articles, { now }).length, 1);
});

test('履歴の永続化・期限削除・破損時の停止', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roblox-news-'));
  const file = path.join(dir, 'sent.json');
  try {
    assert.deepEqual(loadHistory(file), {});
    const item = article('Roblox brand campaign');
    saveHistory(file, { old: '2026-01-01' }, [item], now);
    const sent = loadHistory(file);
    assert.equal(sent.old, undefined);
    assert.equal(selectRobloxArticles([item], { now, sent }).length, 0);
    fs.writeFileSync(file, 'broken');
    assert.throws(() => loadHistory(file));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('フォーラムの広告相談を企業事例にしない', () => {
  assert.equal(scoreRobloxArticle(article('Roblox brand campaign developer', { link: 'https://devforum.roblox.com/t/help/1' })).business, false);
});

test('見出しが異なっても引用された体験名で重複を除く', () => {
  const items = [article('The Doux launches "My Salon Empire" on Roblox'), article('Roblox beauty with ‘My Salon Empire’')];
  assert.equal(selectRobloxArticles(items, { now }).length, 1);
});

test('直接記事では発売日・更新日を公開日として使わない', () => {
  const { parseArticle, discoverLinks } = require('../roblox-news-sources');
  const item = parseArticle('<meta name="date" content="2026-08-19"><h1>DAISE Roblox beauty</h1><article>Launch August 28</article>', 'https://example.com/a', 'PR Newswire');
  assert.equal(item.published, '2026-08-19');
  assert.equal(selectRobloxArticles([item], { now }).length, 1);
  const undated = parseArticle('<script type="application/ld+json">{"dateModified":"2026-09-01"}</script>', 'https://example.com/a', 'test');
  assert.equal(undated.published, undefined);
  const links = discoverLinks('<a href="/news/a">A</a><a href="https://other.com/news/b">B</a><a href="/news/a">A</a>', { url: 'https://example.com/list', pattern: /\/news\// });
  assert.deepEqual(links, ['https://example.com/news/a']);
});

test('直接収集経路は一媒体が403でも残りを取得する', async () => {
  const { collectDirectArticles } = require('../roblox-news-sources');
  const result = await collectDirectArticles({
    sources: [{ name: 'bad', url: 'https://bad.com', pattern: /./ }, { name: 'good', url: 'https://example.com/list', pattern: /\/news\// }],
    logger: { log() {}, error() {} },
    fetchPage: async url => {
      if (url.includes('bad.com')) throw new Error('403');
      if (url.endsWith('/list')) return '<a href="/news/a">A</a>';
      return '<h1>Roblox brand</h1><script type="application/ld+json">{"@graph":[{"datePublished":"2026-09-01"}]}</script>';
    },
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].published, '2026-09-01');
});
