#!/usr/bin/env node
'use strict';

/**
 * 日誌素案の投稿を手動で1回実行する。
 *
 *   node scripts/run-diary-draft-once.js --dry-run            # 投稿せず、送る本文をそのまま画面に出す
 *   node scripts/run-diary-draft-once.js                      # 日誌素案チャンネルへ投稿
 *   node scripts/run-diary-draft-once.js --date 2026-09-17    # 日付を指定（既定は前日）
 *   node scripts/run-diary-draft-once.js --date 2026-09-12 --to 2026-09-13   # 2日まとめ
 *   node scripts/run-diary-draft-once.js --to-channel 123456789               # 投稿先を一時的に上書き
 *
 * 本番の毎週金曜ジョブと同じ経路（discord-day-digest.js）を通る。
 * ⚠ --dry-run を付けない限り、実行した時点でチャンネルへ投稿される。
 */

require('dotenv').config();

const { Client, Events, GatewayIntentBits, Partials } = require('discord.js');

const { runDiaryDraft, jstDateTextWithOffset } = require('../discord-day-digest');

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
  const dateText = readValue('date', null);
  const toDateText = readValue('to', null);
  const targetChannelId = readValue('to-channel', process.env.DIARY_DRAFT_CHANNEL_ID || '');
  const channelIds = String(readValue('channels', process.env.DIARY_DRAFT_SOURCE_CHANNEL_IDS || process.env.DISCORD_CHANNEL_LOG_CHANNEL_IDS || ''))
    .split(',').map(id => id.trim()).filter(Boolean);

  if (channelIds.length === 0) {
    console.error('収集対象チャンネルが空です。DISCORD_CHANNEL_LOG_CHANNEL_IDS か --channels を指定してください。');
    process.exit(1);
  }
  if (!dryRun && !targetChannelId) {
    console.error('投稿先が空です。DIARY_DRAFT_CHANNEL_ID か --to-channel を指定してください（--dry-run なら不要）。');
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
    let target = null;
    if (!dryRun) {
      target = await client.channels.fetch(targetChannelId);
      if (!target?.isTextBased() || typeof target.send !== 'function') throw new Error('日誌素案チャンネルへ投稿できません（IDと権限を確認してください）');
    }

    const result = await runDiaryDraft({
      channelIds,
      fetchChannel: id => client.channels.fetch(id),
      // メンションはすべて無効化する。生ログにはロールメンションがそのまま入っているので、
      // 素案の投稿で本番のロールを鳴らしてしまわないようにする。
      send: content => target.send({ content, allowedMentions: { parse: [] } }),
      dateText,
      toDateText,
      dryRun
    });

    console.log(`[Diary Draft] 対象日: ${result.dateText}${result.toDateText !== result.dateText ? ` 〜 ${result.toDateText}` : ''}（既定は前日＝${jstDateTextWithOffset(new Date(), 1)}）`);
    console.log(`[Diary Draft] 取得 ${result.rows}件 / 送信 ${result.messages}通`);
    result.perChannel.forEach(c => console.log(`  - ${c.channelName || '(失敗)'}: ${c.count}件${c.error ? ' / ' + c.error : ''}`));
    if (result.errors.length > 0) console.error('[Diary Draft] エラー', result.errors);

    if (dryRun) {
      console.log('\n--- 以下が投稿される本文（--dry-run のため送信していません） ---\n');
      console.log(result.markdown);
    }
  } finally {
    await client.destroy();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
