'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
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

function reconcileGasTransfers(state, observations, now) {
  let changed = 0;
  for (const observation of Array.isArray(observations) ? observations : []) {
    if (!observation || typeof observation !== 'object') continue;
    const url = canonicalUrl(observation.url);
    const entry = state.articles[url];
    if (!entry?.discord || (entry.gas && entry.gas.status !== 'legacy_unknown')) continue;
    if (!['archived', 'recorded'].includes(observation.status)) continue;
    entry.gas = { status: 'recorded', at: new Date(now).toISOString(), reconciledFrom: observation.status };
    changed++;
  }
  return changed;
}

async function deliver({ state, items, now = Date.now(), recover, save, prepare, send, record, inspect, result = {}, log = console.log }) {
  result.discordUrl = null;
  result.gasUrl = null;
  discover(state, items, now);
  await recover(state);
  save(state);
  if (inspect) {
    const urls = Object.entries(state.articles)
      .filter(([, e]) => e.discord && (!e.gas || e.gas.status === 'legacy_unknown'))
      .map(([url]) => url).slice(0, 50);
    if (urls.length) {
      try {
        const observations = await inspect(urls);
        const requested = new Set(urls);
        const changed = reconcileGasTransfers(state,
          (Array.isArray(observations) ? observations : []).filter(o => o && requested.has(canonicalUrl(o.url))), now);
        if (changed) { save(state); log(`[AI Guide] gas_reconciled count=${changed}`); }
      } catch (error) {
        // 旧GASや照合APIの一時障害で、新規Discord投稿まで止めない。
        log(`[AI Guide] GAS history reconciliation unavailable: ${error.message}`);
      }
    }
  }
  const entries = Object.entries(state.articles).sort((a, b) => Date.parse(a[1].publishedAt) - Date.parse(b[1].publishedAt));
  // Discord has its own queue. A pending single-slot GAS draft must not block new posts.
  const selected = entries.find(([, e]) => !e.discord);
  if (selected) {
    const [url, entry] = selected;
    if (!entry.payload) {
      const prepared = await prepare({ ...entry, link: url, isoDate: entry.publishedAt, contentSnippet: entry.snippet });
      entry.payload = prepared.payload;
      entry.message = prepared.message;
      save(state);
    }
    // Shared identity also protects simultaneous sends from separate state volumes.
    const nonce = crypto.createHash('sha256').update(url).digest('hex').slice(0, 25);
    const sent = await send({ ...entry.message, nonce, enforceNonce: true });
    entry.discord = { messageId: sent.id, at: new Date(now).toISOString() };
    result.discordUrl = url;
    save(state);
    log(`[AI Guide] discord_sent url=${url} messageId=${sent.id}`);
  }
  // Keep GAS FIFO and attempt only one draft per run, including older pending work.
  const pending = entries.find(([, e]) => e.discord && !e.gas && e.payload);
  if (pending) {
    const [url, entry] = pending;
    await record(entry.payload);
    entry.gas = { status: 'recorded', at: new Date(now).toISOString() };
    save(state);
    result.gasUrl = url;
    log(`[AI Guide] gas_recorded url=${url}`);
  }
  if (!result.discordUrl && !result.gasUrl) log('[AI Guide] No undelivered articles');
  return result.discordUrl || result.gasUrl || null;
}

// Discordには出たがスプレッドシートへ転送できていない記事。legacy_unknown は台帳が
// 失われたあと復元された記事で、転送済みか判定できないため配信対象から外れる。
// 放置すると二度と転送されないので、直近14日ぶんは必ず表に出す。
function pendingGasTransfers(state, now = Date.now()) {
  return Object.entries(state?.articles || {})
    .filter(([, entry]) => entry.discord && (!entry.gas || entry.gas.status === 'legacy_unknown'))
    .filter(([, entry]) => Date.parse(entry.publishedAt) >= now - 14 * DAY)
    .sort((a, b) => Date.parse(a[1].publishedAt) - Date.parse(b[1].publishedAt))
    .map(([url, entry]) => ({ url, status: entry.gas?.status || 'pending', publishedAt: entry.publishedAt }));
}

module.exports = { canonicalUrl, loadState, saveState, discover, recoverHistory, deliver, pendingGasTransfers, reconcileGasTransfers };
