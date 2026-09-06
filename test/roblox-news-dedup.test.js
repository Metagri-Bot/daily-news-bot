'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectRobloxArticles, articleKeys } = require('../roblox-news');
const { recoverDiscordHistory, buildDigestBatches, deliverDigest } = require('../roblox-news-delivery');
const now = new Date('2026-09-06T00:00:00Z');
const item = (title, extra = {}) => ({ title, published: '2026-09-04', link: `https://example.com/${encodeURIComponent(title)}`, ...extra });
const dated = keys => Object.fromEntries(keys.map(k => [k, now.toISOString()]));

test('履歴で見つかったCookieRunの言い換え見出しを統合する', () => {
  const titles = [
    'Eurotrip! CookieRun: Braverse TCG Voyages to Sweet New Territories in 2027 as Devsisters Launches a New Roblox Experience Built Around CookieRun Cards Worldwide',
    'CookieRun: Braverse TCG launches in Europe in January 2027, CookieRun Card Collection Roblox game arrives October 10',
  ];
  const selected = selectRobloxArticles(titles.map(t => item(t)), { now });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].relatedArticleCount, 2);
  const sent = dated(selected[0].duplicateKeys);
  assert.equal(selectRobloxArticles([item(titles[1], { link: 'https://another.com/repost' })], { now, sent }).length, 0);
});

test('引用符なしの体験名も旧形式の履歴で抑制する', () => {
  const sent = { 'experience:my salon empire': now.toISOString() };
  assert.equal(selectRobloxArticles([item('The Doux Roblox beauty My Salon Empire launch')], { now, sent }).length, 0);
});

test('同じブランドの別企画・四半期違い・一般語だけの一致は残す', () => {
  for (const titles of [
    ['Acme Roblox brand Moon Garden launch', 'Acme Roblox brand Ocean Adventure launch'],
    ['Roblox earnings revenue quarterly report Q1 2026', 'Roblox earnings revenue quarterly report Q2 2025'],
    ['Red brand Roblox game launches today', 'Blue brand Roblox game launches today'],
  ]) assert.equal(selectRobloxArticles(titles.map(t => item(t)), { now }).length, 2);
});

test('旧URL形式のwww・末尾スラッシュ・追跡パラメータを吸収', () => {
  const sent = { 'url:https://www.example.com/story/': now.toISOString() };
  assert.equal(selectRobloxArticles([item('Roblox brand integration', { link: 'https://example.com/story?utm_source=test' })], { now, sent }).length, 0);
});

test('代表に選ばれなかった別媒体URLも同じグループの履歴に含む', () => {
  const a = item('Acme Roblox brand "Rainbow Salon World"');
  const b = item('Rainbow Salon World on Roblox brand launches', { link: 'https://another.com/news' });
  const selected = selectRobloxArticles([a, b], { now });
  assert.equal(selected.length, 1);
  assert.ok(articleKeys(b).every(k => selected[0].duplicateKeys.includes(k)));
  assert.equal(selectRobloxArticles([a, b], { now, sent: dated(articleKeys(b)) }).length, 0);
});

test('重複除去後0/1/2/3/4/5/6/7/8/12件の投稿数を調整する', () => {
  for (const count of [0, 1, 2, 3, 4, 5, 6, 7, 8, 12]) {
    const articles = Array.from({ length: count }, (_, i) => item(`Roblox brand campaign number ${i}`));
    assert.equal(selectRobloxArticles([...articles, ...articles], { now }).length, count >= 8 ? 8 : Math.min(count, 5));
  }
});

test('成功後の履歴で別媒体の再出現を抑え、失敗したバッチだけ再試行できる', async () => {
  const articles = selectRobloxArticles(Array.from({ length: 8 }, (_, i) => item(`Roblox brand number ${i}`)), { now });
  let sent = {}, sends = 0;
  await assert.rejects(deliverDigest({ channel: { send: async () => { if (++sends === 2) throw new Error('Discord unavailable'); } },
    translatedArticles: articles.map(original => ({ original, translated: { titleJa: 'ニュース', summary: '説明' } })),
    historyFile: 'unused', sent, now,
    persist: (_, old, delivered) => { sent = { ...old, ...dated(delivered.flatMap(a => a.duplicateKeys)) }; },
  }));
  assert.equal(selectRobloxArticles(articles, { now, sent }).length, 4);
});

test('8件・長い日本語要約もDiscordの6000文字/1024文字制限内に分割', () => {
  const translated = Array.from({ length: 8 }, (_, i) => ({ original: { ...item(`Roblox brand ${i}`), score: 10, label: 'Business/Brand', source: 'source' },
    translated: { titleJa: '題'.repeat(300), summary: '要約'.repeat(1500) } }));
  const batches = buildDigestBatches(translated, now);
  assert.deepEqual(batches.map(b => b.embed.fields.length), [4, 4]);
  for (const { embed } of batches) {
    assert.ok(embed.title.length + embed.description.length + embed.fields.reduce((n, f) => n + f.name.length + f.value.length, 0) <= 6000);
    assert.ok(embed.fields.every(f => f.name.length <= 256 && f.value.length <= 1024));
  }
});

test('Discord上の自分の速報だけから履歴を回復し、取得失敗は投稿前に停止', async () => {
  const message = { id: '1', author: { id: 'bot' }, createdTimestamp: now.getTime(), embeds: [
    { title: '🤖 Roblox ビジネス・アップデート速報 (日付)', fields: [{ value: '[原文を読む](https://example.com/posted)' }] },
  ] };
  const other = { ...message, id: '2', author: { id: 'other' }, embeds: [{ ...message.embeds[0], fields: [{ value: '[原文を読む](https://example.com/other)' }] }] };
  const result = await recoverDiscordHistory({ messages: { fetch: async () => new Map([['1', message], ['2', other]]) } }, 'bot', {}, now);
  assert.ok(result['url:https://example.com/posted']);
  assert.equal(result['url:https://example.com/other'], undefined);
  await assert.rejects(recoverDiscordHistory({ messages: { fetch: async () => { throw new Error('403'); } } }, 'bot', {}, now));
});
