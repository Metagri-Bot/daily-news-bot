#!/usr/bin/env node
'use strict';

/**
 * Discordチャンネル投稿ログを手動で1回実行する。
 *
 *   node scripts/run-discord-channel-log-once.js --dry-run              # シートへ書かず件数と先頭3行だけ確認
 *   node scripts/run-discord-channel-log-once.js                        # 実際にシートへ追記
 *   node scripts/run-discord-channel-log-once.js --channels 123,456     # .env の対象を一時的に上書き
 *   node scripts/run-discord-channel-log-once.js --lookback-days 30 --dry-run
 *   node scripts/run-discord-channel-log-once.js --from-scratch --lookback-days 90
 *
 * --from-scratch はシート側のカーソルを無視して lookback-days から取り直す。
 * 重複はGAS側がMessage IDで弾くので、取り直しても行は増えない。
 */

require('dotenv').config();

const { Client, Events, GatewayIntentBits, Partials } = require('discord.js');

const { runDiscordChannelLog } = require('../discord-channel-log');
const store = require('../discord-channel-log-store');

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
  const fromScratch = readFlag('from-scratch');
  const gasUrl = process.env.DISCORD_CHANNEL_LOG_GAS_URL;
  const channelIds = String(readValue('channels', process.env.DISCORD_CHANNEL_LOG_CHANNEL_IDS || ''))
    .split(',').map(id => id.trim()).filter(Boolean);
  const lookbackDays = Number(readValue('lookback-days', process.env.DISCORD_CHANNEL_LOG_INITIAL_LOOKBACK_DAYS || 7));
  const maxMessages = Number(readValue('max', process.env.DISCORD_CHANNEL_LOG_MAX_PER_RUN || 1000));
  const includeBots = process.env.DISCORD_CHANNEL_LOG_INCLUDE_BOTS !== 'false';

  if (channelIds.length === 0) {
    console.error('対象チャンネルが空です。DISCORD_CHANNEL_LOG_CHANNEL_IDS か --channels を指定してください。');
    process.exit(1);
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel]
  });

  await new Promise((resolve, reject) => {
    client.once(Events.ClientReady, resolve);
    client.once(Events.Error, reject);
    client.login(process.env.DISCORD_BOT_TOKEN).catch(reject);
  });

  try {
    const { cursors, source } = fromScratch
      ? { cursors: {}, source: 'from-scratch' }
      : await store.loadCursors({ gasUrl });
    console.log(`[Channel Log] カーソルの取得元: ${source}`, JSON.stringify(cursors));

    const result = await runDiscordChannelLog({
      channelIds,
      fetchChannel: id => client.channels.fetch(id),
      cursors,
      includeBots,
      maxMessages,
      lookbackDays
    });

    console.log('[Channel Log] 収集結果', JSON.stringify(result.perChannel, null, 2));
    if (result.errors.length > 0) console.error('[Channel Log] エラー', result.errors);
    console.log(`[Channel Log] 収集 ${result.rows.length} 件`);
    result.rows.slice(0, 3).forEach(row => console.log('  -', JSON.stringify(row).slice(0, 300)));

    if (dryRun) {
      console.log('[Channel Log] --dry-run のためシートへは書き込みません。');
      return;
    }

    const saved = await store.saveRows({ gasUrl, rows: result.rows });
    console.log('[Channel Log] 書き込み結果', JSON.stringify(saved));

    if (saved.errors.length === 0) {
      const next = { ...cursors };
      result.perChannel.forEach(channel => {
        if (channel.lastMessageId) next[channel.channelId] = channel.lastMessageId;
      });
      store.writeLocalCursors(next);
    }
  } finally {
    await client.destroy();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
