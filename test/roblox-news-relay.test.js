'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyFreshArticles, decodeRelayArticleId, extractRelayDestination } = require('../roblox-news-sources');
const { rankRobloxArticles, saveHistory } = require('../roblox-news');

const now = new Date('2026-09-18T00:00:00Z');
const logger = { log() {}, error() {} };
const RELAY = 'https://news.google.com/rss/articles/CBMiOPAQUEIDXYZ?oc=5';
const ORIGIN = 'https://www.licenseglobal.com/entertainment/brand-launches-roblox-collection';

const articleHtml = (date = '2026-09-17T09:00:00Z') => `
  <meta property="article:published_time" content="${date}">
  <h1>Brand launches licensed Roblox collection</h1>
  <article>The brand launched a licensed Roblox experience and toy collection with its retail partners.</article>`;

const relayItem = (link = RELAY) => ({ title: 'Brand launches licensed Roblox collection', link,
  source: 'License Global', isoDate: '2026-09-17T09:00:00Z' });

// 旧形式のGoogle News IDは元URLを内包する（新形式は内包しないためnullになる）
function legacyRelayUrl(url) {
  const payload = Buffer.from(url, 'utf8');
  const body = Buffer.concat([Buffer.from([0x08, 0x13, 0x22, payload.length]), payload, Buffer.from([0x32, 0x02, 0x65, 0x6e])]);
  return `https://news.google.com/rss/articles/${body.toString('base64url')}?oc=5`;
}

test('meta refreshで示された元記事へ解決し、公開日を確認して採用する', async () => {
  const fetched = [];
  const fetchPage = async url => {
    fetched.push(url);
    return url === RELAY ? `<meta http-equiv="refresh" content="0;URL=${ORIGIN}">` : articleHtml();
  };
  const stats = {};
  const result = await verifyFreshArticles([relayItem()], { now, logger, fetchPage, stats });
  assert.equal(result.length, 1);
  assert.equal(result[0].link, ORIGIN);
  assert.deepEqual(result[0].relayLinks, [RELAY]);
  assert.equal(result[0].published, '2026-09-17T09:00:00.000Z');
  assert.deepEqual(fetched, [RELAY, ORIGIN]);
  assert.equal(stats.relayResolved, 1);
  assert.equal(stats.verified, 1);
});

test('data-n-au・og:url・canonicalからも元記事URLを取り出す', () => {
  assert.equal(extractRelayDestination(`<a data-n-au="${ORIGIN}">x</a>`), ORIGIN);
  assert.equal(extractRelayDestination(`<meta property="og:url" content="${ORIGIN}">`), ORIGIN);
  assert.equal(extractRelayDestination(`<link rel="canonical" href="${ORIGIN}">`), ORIGIN);
});

test('Google自社ドメインとSNS共有リンクは元記事とみなさない', () => {
  assert.equal(extractRelayDestination(`
    <a href="https://policies.google.com/terms">terms</a>
    <a href="https://www.facebook.com/sharer?u=x">share</a>
    <a href="https://accounts.google.com/signin">signin</a>`), null);
});

test('リダイレクト追従済みで中継URLの本文が元記事そのものなら、そのまま採用する', async () => {
  const stats = {};
  const result = await verifyFreshArticles([relayItem()], { now, logger, stats,
    fetchPage: async () => `<link rel="canonical" href="${ORIGIN}">${articleHtml()}` });
  assert.equal(result.length, 1);
  assert.equal(result[0].link, ORIGIN);
  assert.equal(stats.relayResolved, 1);
});

test('旧形式IDに埋め込まれた元URLは取得前にデコードする', async () => {
  const legacy = legacyRelayUrl(ORIGIN);
  assert.equal(decodeRelayArticleId(legacy), ORIGIN);
  const fetched = [];
  const result = await verifyFreshArticles([relayItem(legacy)], { now, logger,
    fetchPage: async url => { fetched.push(url); return articleHtml(); } });
  assert.deepEqual(fetched, [ORIGIN]);
  assert.equal(result[0].link, ORIGIN);
});

test('新形式の不透明IDはデコードせず、中継ページの取得にフォールバックする', () => {
  assert.equal(decodeRelayArticleId('https://news.google.com/rss/articles/CBMi1wFBVV95cUxQVFlhU1I?oc=5'), null);
});

test('元記事を特定できない中継URLは従来どおり見送る', async () => {
  const stats = {};
  const result = await verifyFreshArticles([relayItem()], { now, logger, stats,
    fetchPage: async () => '<html><body>Redirecting...</body></html>' });
  assert.equal(result.length, 0);
  assert.equal(stats.relayUnresolved, 1);
  assert.equal(stats.unverified, 1);
});

test('中継ページの取得が失敗しても他の記事の検証を続ける', async () => {
  const stats = {};
  const direct = { title: 'Roblox brand campaign', link: 'https://example.com/a' };
  const result = await verifyFreshArticles([relayItem(), direct], { now, logger, stats,
    fetchPage: async url => { if (url === RELAY) throw new Error('403'); return articleHtml(); } });
  assert.equal(result.length, 1);
  assert.equal(result[0].link, 'https://example.com/a');
  assert.equal(stats.relayUnresolved, 1);
});

test('1回の実行で解決する中継URLの本数に上限をかける', async () => {
  const items = Array.from({ length: 4 }, (_, i) => relayItem(`https://news.google.com/rss/articles/ID${i}?oc=5`));
  const stats = {};
  const result = await verifyFreshArticles(items, { now, logger, stats, relayLimit: 2,
    fetchPage: async url => (url.startsWith('https://news.google.com') ? `<meta http-equiv="refresh" content="0;URL=${ORIGIN}${url.slice(-6)}">` : articleHtml()) });
  assert.equal(stats.relayResolved, 2);
  assert.equal(stats.relaySkipped, 2);
  assert.equal(result.length, 2);
});

test('解決前に中継URLで保存された履歴とも照合し、再投稿しない', async () => {
  const resolved = await verifyFreshArticles([relayItem()], { now, logger,
    fetchPage: async url => (url === RELAY ? `<meta http-equiv="refresh" content="0;URL=${ORIGIN}">` : articleHtml()) });
  assert.equal(rankRobloxArticles(resolved, { now }).length, 1);
  const sent = { [`url:${RELAY}`]: '2026-09-17T22:00:00.000Z' };
  assert.equal(rankRobloxArticles(resolved, { now, sent }).length, 0);
});

test('保存する履歴に中継URLと元記事URLの両方を残す', async () => {
  const [article] = await verifyFreshArticles([relayItem()], { now, logger,
    fetchPage: async url => (url === RELAY ? `<meta http-equiv="refresh" content="0;URL=${ORIGIN}">` : articleHtml()) });
  const writes = {};
  const file = require('node:path').join(require('node:os').tmpdir(), `roblox-relay-${process.pid}.json`);
  saveHistory(file, writes, [article], now);
  const saved = JSON.parse(require('node:fs').readFileSync(file, 'utf8'));
  require('node:fs').unlinkSync(file);
  assert.ok(Object.keys(saved).some(key => key.startsWith('url:https://news.google.com/')));
  assert.ok(Object.keys(saved).some(key => key.startsWith('url:https://licenseglobal.com/')));
});

test('enabled:false の直接巡回ソースは取得しない', async () => {
  const { collectDirectArticles } = require('../roblox-news-sources');
  const fetched = [];
  await collectDirectArticles({ logger, fetchPage: async url => { fetched.push(url); return '<a href="/x/y">x</a>'; },
    sources: [{ name: '停止中', url: 'https://off.example.com/list', pattern: /./, enabled: false },
      { name: '稼働中', url: 'https://on.example.com/list', pattern: /^\/x\/y$/ }] });
  assert.ok(!fetched.some(url => url.startsWith('https://off.example.com')));
  assert.ok(fetched.includes('https://on.example.com/list'));
});

test('解決先がトップページなら記事とみなさない', () => {
  assert.equal(extractRelayDestination('<a href="https://www.licenseglobal.com/">home</a>'), null);
  assert.equal(extractRelayDestination('<a href="https://www.licenseglobal.com/entertainment/x">a</a>'),
    'https://www.licenseglobal.com/entertainment/x');
});

test('解決できても公開日が読めない中継は、着地先を集計して残す', async () => {
  const stats = {};
  const result = await verifyFreshArticles([relayItem()], { now, logger, stats,
    fetchPage: async url => (url === RELAY ? `<meta http-equiv="refresh" content="0;URL=${ORIGIN}">` : '<h1>No date here</h1>') });
  assert.equal(result.length, 0);
  assert.equal(stats.relayResolved, 1);
  assert.equal(stats.relayVerified, 0);
  assert.equal(stats.relayLandings, 'www.licenseglobal.com:1');
});

test('公開日を読めた中継は relayVerified に計上する', async () => {
  const stats = {};
  await verifyFreshArticles([relayItem()], { now, logger, stats,
    fetchPage: async url => (url === RELAY ? `<meta http-equiv="refresh" content="0;URL=${ORIGIN}">` : articleHtml()) });
  assert.equal(stats.relayVerified, 1);
  assert.equal(stats.relayLandings, '');
});

test('計測タグや資源リンクを元記事と取り違えない', () => {
  // 実測では <link rel="dns-prefetch"> のGoogle Analyticsを全件拾っていた。
  const html = `<link rel="dns-prefetch" href="https://www.google-analytics.com">
    <link rel="preconnect" href="https://www.googletagmanager.com">
    <script src="https://cdn.jsdelivr.net/npm/app.js"></script>
    <a href="https://www.licenseglobal.com/entertainment/brand-launches-roblox-collection">記事</a>`;
  assert.equal(extractRelayDestination(html), ORIGIN);
});

test('資源ファイルを指すURLは記事とみなさない', () => {
  assert.equal(extractRelayDestination('<a href="https://example.com/assets/app.js">x</a>'), null);
  assert.equal(extractRelayDestination('<a href="https://example.com/logo.png">x</a>'), null);
});

test('解決が連続で空振りしたら以降の中継解決を打ち切る', async () => {
  const items = Array.from({ length: 30 }, (_, i) => relayItem(`https://news.google.com/rss/articles/S${i}?oc=5`));
  const stats = {};
  await verifyFreshArticles(items, { now, logger, stats,
    fetchPage: async url => (url.startsWith('https://news.google.com')
      ? `<a href="https://undated.example.com/a${url.slice(-6)}">記事</a>` : '<h1>No date</h1>') });
  assert.ok(stats.relayResolved <= 24, `打ち切りが効いていない: ${stats.relayResolved}`);
  assert.ok(stats.relaySkipped >= 5, `打ち切り件数が計上されていない: ${stats.relaySkipped}`);
  assert.equal(stats.relayVerified, 0);
});
