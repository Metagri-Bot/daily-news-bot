'use strict';

const fs = require('node:fs');
const path = require('node:path');
const DAY = 86400000;

function canonicalUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== 'metagri-labo.com' || !/^\/ai-guide\/[^/]+\/?$/.test(url.pathname)) return null;
    url.search = ''; url.hash = '';
    url.pathname = url.pathname.replace(/\/?$/, '/');
    return url.href;
  } catch { return null; }
}

function loadState(file) {
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (state.version !== 1 || !state.articles || Array.isArray(state.articles) || typeof state.articles !== 'object') throw new Error('Invalid AI Guide delivery state');
    for (const [url, entry] of Object.entries(state.articles)) {
      if (canonicalUrl(url) !== url || !entry || !Number.isFinite(Date.parse(entry.publishedAt))) throw new Error('Invalid AI Guide article state');
    }
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, articles: {} };
    throw error;
  }
}

function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function discover(state, items, now) {
  for (const item of items) {
    const url = canonicalUrl(item.link);
    const date = Date.parse(item.isoDate || item.pubDate);
    if (!url || !Number.isFinite(date) || date > now || date < now - 14 * DAY || state.articles[url]) continue;
    state.articles[url] = { title: item.title || '農業AI通信', publishedAt: new Date(date).toISOString(), snippet: String(item.contentSnippet || '').slice(0, 12000), discoveredAt: new Date(now).toISOString() };
  }
}

async function recoverHistory(channel, botId, state, now) {
  const pending = Object.entries(state.articles).filter(([, entry]) => !entry.discord);
  if (!pending.length) return;
  const cutoff = Math.min(now - 14 * DAY, ...pending.map(([, e]) => Date.parse(e.discoveredAt || e.publishedAt)));
  let before;
  for (let page = 0; page < 20; page++) {
    const messages = [...(await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) })).values()];
    if (!messages.length) return;
    for (const message of messages) {
      if (message.author?.id !== botId) continue;
      for (const embed of message.embeds || []) {
        const url = canonicalUrl(embed.url);
        const entry = state.articles[url];
        if (!entry || entry.discord) continue;
        entry.discord = { messageId: message.id, at: new Date(message.createdTimestamp).toISOString(), recovered: true };
        // Before this ledger existed, GAS completion is unknown. Do not overwrite today's draft with historical articles.
        if (!entry.payload) entry.gas = { status: 'legacy_unknown' };
      }
    }
    const last = messages[messages.length - 1];
    if (messages.length < 100 || last.createdTimestamp < cutoff) return;
    before = last.id;
  }
  throw new Error('Discord history scan incomplete; refusing to risk duplicate delivery');
}

async function deliver({ state, items, now = Date.now(), recover, save, prepare, send, record, log = console.log }) {
  discover(state, items, now);
  await recover(state);
  save(state);
  const entries = Object.entries(state.articles).sort((a, b) => Date.parse(a[1].publishedAt) - Date.parse(b[1].publishedAt));
  // Retry an unfinished GAS transfer before selecting another article: A1/A2 is a single draft slot.
  const selected = entries.find(([, e]) => e.discord && !e.gas && e.payload) || entries.find(([, e]) => !e.discord);
  if (!selected) { log('[AI Guide] No undelivered articles'); return null; }
  const [url, entry] = selected;
  if (!entry.payload) {
    const prepared = await prepare({ ...entry, link: url, isoDate: entry.publishedAt, contentSnippet: entry.snippet });
    entry.payload = prepared.payload;
    entry.message = prepared.message;
    save(state);
  }
  if (!entry.discord) {
    const sent = await send(entry.message);
    entry.discord = { messageId: sent.id, at: new Date(now).toISOString() };
    save(state);
    log(`[AI Guide] discord_sent url=${url} messageId=${sent.id}`);
  }
  if (!entry.gas) {
    await record(entry.payload);
    entry.gas = { status: 'recorded', at: new Date(now).toISOString() };
    save(state);
    log(`[AI Guide] gas_recorded url=${url}`);
  }
  return url;
}

module.exports = { canonicalUrl, loadState, saveState, discover, recoverHistory, deliver };
