#!/usr/bin/env node
'use strict';

/**
 * 日誌の下書き素材として、指定日（JST）のDiscord投稿を書き出す。
 *
 *   node scripts/export-discord-day.js --date 2026-09-17
 *   node scripts/export-discord-day.js --date 2026-09-12 --to 2026-09-13   # 2日まとめ
 *   node scripts/export-discord-day.js --date 2026-09-17 --out C:\path\to\01_input
 *
 * 出力（既定は workspace の 01_input/）:
 *   discord-log_2026-09-17.json  … 機械処理用
 *   discord-log_2026-09-17.md    … 読む用（チャンネル別・メッセージURL付き）
 *
 * シートは経由しない。日誌を書くのに必要なのは「その日ぶんの生データ」であって
 * 通し記録ではないので、GASの状態に関係なく取れる経路を別に用意している。
 *
 * ⚠ 収集とMarkdownの組み立ては discord-day-digest.js が正。
 *   同じ形式を毎週金曜にDiscordへも投稿するので、形式をここに持たせると2か所へ割れる。
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client, Events, GatewayIntentBits, Partials } = require('discord.js');

const { collectDayRows, buildDayDigestMarkdown, messageUrl, jstDateLabel } = require('../discord-day-digest');

const DEFAULT_OUT_DIR = path.join(__dirname, '..', '..', '..', '01_input');

function readValue(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index === process.argv.length - 1) return fallback;
  return process.argv[index + 1];
}

async function main() {
  const fromText = readValue('date', null);
  if (!fromText) {
    console.error('使い方: node scripts/export-discord-day.js --date YYYY-MM-DD [--to YYYY-MM-DD]');
    process.exit(1);
  }
  const toText = readValue('to', fromText);
  const outDir = readValue('out', DEFAULT_OUT_DIR);

  const channelIds = String(readValue('channels', process.env.DISCORD_CHANNEL_LOG_CHANNEL_IDS || ''))
    .split(',').map(id => id.trim()).filter(Boolean);
  if (channelIds.length === 0) {
    console.error('対象チャンネルが空です（DISCORD_CHANNEL_LOG_CHANNEL_IDS）。');
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

  let collected;
  try {
    collected = await collectDayRows({
      channelIds,
      fetchChannel: id => client.channels.fetch(id),
      fromText,
      toText
    });
  } finally {
    await client.destroy();
  }

  const { rows, perChannel, errors, guildId } = collected;
  const label = fromText === toText ? fromText : `${fromText}_${toText}`;
  fs.mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, `discord-log_${label}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({
    range: { fromJst: fromText, toJst: toText },
    guildId,
    perChannel,
    errors,
    rows: rows.map(row => ({ ...row, url: messageUrl(guildId, row) }))
  }, null, 2));

  const mdPath = path.join(outDir, `discord-log_${label}.md`);
  fs.writeFileSync(mdPath, buildDayDigestMarkdown({ fromText, toText, channelIds, rows, perChannel, errors, guildId }));

  console.log(`[Export] ${jstDateLabel(fromText)} 〜 取得 ${rows.length}件`);
  perChannel.forEach(c => console.log(`  - ${c.channelName || '(失敗)'}: ${c.count}件${c.error ? ' / ' + c.error : ''}`));
  console.log(`[Export] 書き出し: ${jsonPath}`);
  console.log(`[Export] 書き出し: ${mdPath}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
