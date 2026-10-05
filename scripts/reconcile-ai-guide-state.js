'use strict';

// 配信・原稿更新をせず、GASのA2/アーカイブとBotの転送台帳だけを照合する。
const path = require('node:path');
const axios = require('axios');
const { loadState, saveState, canonicalUrl, reconcileGasTransfers, pendingGasTransfers } = require('../ai-guide-delivery');
const { acquireAiGuideRunLock } = require('../ai-guide-run-lock');

async function reconcileState(state, inspect, now = Date.now()) {
  const urls = Object.entries(state.articles)
    .filter(([, e]) => e.discord && (!e.gas || e.gas.status === 'legacy_unknown')).map(([url]) => url);
  const observations = [];
  for (let offset = 0; offset < urls.length; offset += 50) {
    const batch = urls.slice(offset, offset + 50);
    const requested = new Set(batch);
    const response = await inspect(batch);
    if (!Array.isArray(response)) throw new Error('GAS did not return article statuses');
    observations.push(...response.filter(o => o && requested.has(canonicalUrl(o.url))));
  }
  return { checked: urls.length, reconciled: reconcileGasTransfers(state, observations, now),
    remaining: pendingGasTransfers(state, now) };
}

async function main() {
  require('dotenv').config({quiet: true});
  if (!process.env.AI_GUIDE_GAS_URL) throw new Error('AI_GUIDE_GAS_URL missing');
  const file = path.join(__dirname, '..', 'state', 'ai-guide-delivery.json');
  const release = await acquireAiGuideRunLock(path.join(path.dirname(file), 'ai-guide-run.lock'));
  if (!release) throw new Error('AI Guide delivery is running; retry reconciliation later');
  try {
    const state = loadState(file);
    const result = await reconcileState(state, async urls => {
      const response = await axios.post(process.env.AI_GUIDE_GAS_URL, {type: 'aiGuideStatus', urls},
        {timeout: 45000, headers: {'Content-Type': 'application/json'}});
      if (response.data?.status !== 'success') throw new Error('Deploy the updated GAS status endpoint first');
      return response.data.articles;
    });
    if (result.reconciled) saveState(file, state);
    console.log(JSON.stringify(result));
  } finally { await release(); }
}

if (require.main === module) main().catch(error => {console.error(error.message); process.exitCode = 1;});
module.exports = {reconcileState};
