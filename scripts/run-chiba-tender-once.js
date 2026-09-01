#!/usr/bin/env node
'use strict';

/**
 * 千葉県自治体案件レーダーを手動で1回実行する。
 *
 *   node scripts/run-chiba-tender-once.js --dry-run      # 投稿せず内容だけ確認
 *   node scripts/run-chiba-tender-once.js                # 実際に投稿
 *   node scripts/run-chiba-tender-once.js --dry-run --model gpt-5.6-terra
 *   node scripts/run-chiba-tender-once.js --dry-run --no-ai   # AIを呼ばず採点だけ見る
 *   node scripts/run-chiba-tender-once.js --dry-run --min-score 40
 */

require('dotenv').config();

const { Client, Events, GatewayIntentBits } = require('discord.js');
const OpenAI = require('openai');

const { runChibaTenderRadar, DEFAULT_AI_MODEL } = require('../chiba-tender-radar');
const { MIN_NOTIFY_SCORE, ALERT_SCORE } = require('../chiba-tender-score');

function readFlag(name) {
  return process.argv.includes(`--${name}`);
}

function readValue(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index === process.argv.length - 1) return fallback;
  return process.argv[index + 1];
}

async function main() {
  const dryRun = readFlag('dry-run');
  const noAi = readFlag('no-ai');
  // モデルは公募モニターと共用（2026-09-02 本人判断）。専用の環境変数は持たない。
  // 片方だけ変えたいときは --model で一時的に上書きする。
  const model = readValue('model', process.env.PUBLIC_OPPORTUNITY_OPENAI_MODEL || DEFAULT_AI_MODEL);
  const minScore = Number(readValue('min-score', process.env.CHIBA_TENDER_MIN_SCORE || MIN_NOTIFY_SCORE));
  const alertScore = Number(readValue('alert-score', process.env.CHIBA_TENDER_ALERT_SCORE || ALERT_SCORE));
  const maxPriority = Number(readValue('max-priority', process.env.CHIBA_TENDER_MAX_PRIORITY || 2));

  const openai =
    !noAi && process.env.OPENAI_API_KEY
      ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      : null;

  if (!openai) console.log('[run-chiba-tender-once] AIなしで実行します（キーワード採点のみ）');

  let client = null;
  if (!dryRun) {
    const channelId = process.env.CHIBA_TENDER_CHANNEL_ID;
    if (!channelId) throw new Error('CHIBA_TENDER_CHANNEL_ID が未設定です');

    client = new Client({ intents: [GatewayIntentBits.Guilds] });
    const ready = new Promise(resolve => client.once(Events.ClientReady, resolve));
    await client.login(process.env.DISCORD_BOT_TOKEN);
    await ready;
  }

  try {
    const summary = await runChibaTenderRadar({
      client,
      channelId: process.env.CHIBA_TENDER_CHANNEL_ID,
      openai,
      model,
      dryRun,
      minScore,
      alertScore,
      maxPriority
    });
    console.log('--- 実行サマリ ---');
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (client) await client.destroy();
  }
}

main().catch(error => {
  console.error('[run-chiba-tender-once] 失敗:', error.message);
  process.exitCode = 1;
});
