#!/usr/bin/env node
'use strict';

/**
 * 公募モニターを手動で1回だけ実行する。
 *
 * 使い方:
 *   node scripts/run-public-opportunity-once.js --dry-run      # Discordへ送らず内容だけ確認
 *   node scripts/run-public-opportunity-once.js                # 実際にDiscordへ投稿
 *   node scripts/run-public-opportunity-once.js --priority 1   # 優先度1の監視先だけ
 *   node scripts/run-public-opportunity-once.js --min-score 60 # 通知の下限点を変更
 *   node scripts/run-public-opportunity-once.js --no-ai        # OpenAI整形なし（キーワード評価のみ）
 *   node scripts/run-public-opportunity-once.js --model gpt-5.6-terra  # モデルを一時的に変更
 *
 * dry-run では通知履歴を更新しないため、何度でも同じ結果を確認できる。
 */

require('dotenv').config();

const OpenAI = require('openai');
const { Client, GatewayIntentBits } = require('discord.js');
const { runPublicOpportunityMonitor } = require('../public-opportunity-monitor');

function parseArgs(argv) {
  const args = {
    dryRun: false,
    useAi: true,
    priority: 3,
    minScore: 65,
    model: process.env.PUBLIC_OPPORTUNITY_OPENAI_MODEL || 'gpt-5.6-luna'
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--dry-run') args.dryRun = true;
    else if (key === '--no-ai') args.useAi = false;
    else if (key === '--priority') args.priority = Number(argv[++i]);
    else if (key === '--min-score') args.minScore = Number(argv[++i]);
    else if (key === '--model') args.model = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const channelId = process.env.PUBLIC_OPPORTUNITY_CHANNEL_ID || process.env.NEWS_CHANNEL_ID;
  const openai =
    args.useAi && process.env.OPENAI_API_KEY
      ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      : null;

  if (openai) {
    console.log(`[Public Opportunity] 使用モデル: ${args.model}`);
  } else {
    console.log('[Public Opportunity] OpenAI整形なしで実行します（キーワード評価のみ）。');
  }

  let client = null;
  if (!args.dryRun) {
    if (!process.env.DISCORD_BOT_TOKEN || !channelId) {
      console.error('DISCORD_BOT_TOKEN と NEWS_CHANNEL_ID（または PUBLIC_OPPORTUNITY_CHANNEL_ID）が必要です。');
      process.exit(1);
    }
    client = new Client({ intents: [GatewayIntentBits.Guilds] });
    await client.login(process.env.DISCORD_BOT_TOKEN);
    await new Promise(resolve => client.once('ready', resolve));
  }

  try {
    const summary = await runPublicOpportunityMonitor({
      client,
      channelId,
      openai,
      model: args.model,
      dryRun: args.dryRun,
      minScore: args.minScore,
      maxPriority: args.priority
    });
    console.log('実行サマリ:', JSON.stringify(summary, null, 2));
  } finally {
    if (client) await client.destroy();
  }
}

main().catch(error => {
  console.error('実行に失敗しました:', error.stack || error.message);
  process.exit(1);
});
