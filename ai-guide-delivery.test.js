'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { canonicalUrl, discover, deliver, recoverHistory, loadState, saveState } = require('./ai-guide-delivery');
const now = Date.parse('2026-09-09T00:50:00Z');
const url = slug => `https://metagri-labo.com/ai-guide/${slug}/`;
const item = (slug, age = 3) => ({ title: slug, link: url(slug) + '?utm_source=rss', isoDate: new Date(now - age * 86400000).toISOString(), contentSnippet: slug });
const fresh = () => ({ version: 1, articles: {} });
function harness(state, overrides = {}) {
  const sent = [], recorded = [];
  return { sent, recorded, args: { state, now, items: [], recover: async () => {}, save: () => {},
    prepare: async a => ({ message: { title: a.title }, payload: { url: a.link } }),
    send: async m => { sent.push(m); return { id: String(sent.length) }; },
    record: async p => { recorded.push(p); }, log: () => {}, ...overrides } };
}
test('canonical identity removes RSS/Discord tracking and rejects off-site links', () => {
  assert.equal(canonicalUrl(url('a') + '?utm_source=discord#x'), url('a'));
  assert.equal(canonicalUrl('https://evil.example/ai-guide/a/'), null);
  assert.equal(canonicalUrl('https://metagri-labo.com/ai-guide/'), null);
});
test('discovers all valid recent items, including weekend, and retains queued items beyond freshness window', () => {
  const state = fresh();
  discover(state, [item('new', 1), item('weekend', 4), item('old', 15), item('future', -1), { ...item('bad'), isoDate: 'invalid' }], now);
  assert.deepEqual(Object.keys(state.articles), [url('new'), url('weekend')]);
  discover(state, [], now + 30 * 86400000);
  assert.equal(Object.keys(state.articles).length, 2);
});
test('delivers oldest first, one draft per run, then next item without duplicates', async () => {
  const h = harness(fresh(), { items: [item('new', 1), item('old', 4)] });
  assert.equal(await deliver(h.args), url('old'));
  assert.equal(await deliver(h.args), url('new'));
  assert.equal(await deliver(h.args), null);
  assert.equal(h.sent.length, 2); assert.equal(h.recorded.length, 2);
});
test('GAS failure retries transfer without reposting Discord or overwriting with a new article', async () => {
  let fail = true;
  const h = harness(fresh(), { items: [item('new', 1), item('old', 4)], record: async () => { if (fail) throw new Error('GAS unavailable'); } });
  await assert.rejects(deliver(h.args), /GAS unavailable/);
  assert.equal(h.sent.length, 1);
  fail = false;
  assert.equal(await deliver(h.args), url('old'));
  assert.equal(h.sent.length, 1);
  assert.equal(await deliver(h.args), url('new'));
});
test('send failure leaves prepared work retryable and does not invoke GAS', async () => {
  const h = harness(fresh(), { items: [item('a')], send: async () => { throw new Error('send failed'); } });
  await assert.rejects(deliver(h.args), /send failed/);
  assert.equal(h.recorded.length, 0);
  assert.equal(h.args.state.articles[url('a')].discord, undefined);
});
test('recovers delivered messages after process failure, and distinguishes legacy GAS status', async () => {
  const state = fresh(); discover(state, [item('prepared'), item('legacy')], now);
  state.articles[url('prepared')].payload = { url: url('prepared') };
  const channel = { messages: { fetch: async () => new Map(['prepared', 'legacy'].map((slug, i) => [i, { id: String(i), author: { id: 'bot' }, createdTimestamp: now, embeds: [{ url: url(slug) + '?utm_campaign=ai_guide_manual' }] }])) } };
  await recoverHistory(channel, 'bot', state, now);
  assert.equal(state.articles[url('prepared')].discord.messageId, '0');
  assert.equal(state.articles[url('prepared')].gas, undefined);
  assert.equal(state.articles[url('legacy')].gas.status, 'legacy_unknown');
});
test('history permission failure stops all sending', async () => {
  const h = harness(fresh(), { items: [item('a')], recover: async () => { throw new Error('Forbidden'); } });
  await assert.rejects(deliver(h.args), /Forbidden/); assert.equal(h.sent.length, 0);
});
test('state survives reload and corrupted file is not treated as empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-guide-test-'));
  const file = path.join(dir, 'state.json');
  try {
    const state = loadState(file); discover(state, [item('a')], now); saveState(file, state);
    assert.deepEqual(loadState(file), state);
    fs.writeFileSync(file, '{'); assert.throws(() => loadState(file));
  } finally { fs.rmSync(dir, { recursive: true }); }
});
