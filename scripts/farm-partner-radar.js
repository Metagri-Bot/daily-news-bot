'use strict';
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const { Client, GatewayIntentBits } = require('discord.js');
const { runRadar } = require('../farm-partner-radar');

(async () => {
  const args = process.argv.slice(2);
  const live = args.includes('--send');
  const outputIndex = args.indexOf('--output');
  if (outputIndex >= 0 && !args[outputIndex + 1]) throw new Error('--output needs a path');
  const client = live ? new Client({ intents: [GatewayIntentBits.Guilds] }) : null;
  try {
    let channel;
    if (client) {
      const channelId = process.env.FARM_PARTNER_CHANNEL_ID || process.env.PUBLIC_OPPORTUNITY_CHANNEL_ID || process.env.NEWS_CHANNEL_ID;
      if (!channelId) throw new Error('Discord channel is not configured');
      await client.login(process.env.DISCORD_BOT_TOKEN);
      if (!client.isReady()) await new Promise(resolve => client.once('clientReady', resolve));
      channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased() || typeof channel.send !== 'function') throw new Error('Configured channel is not sendable');
    }
    const result = await runRadar({ dryRun: !live,
      minScore: Number(process.env.FARM_PARTNER_MIN_SCORE || 65),
      send: channel && (message => channel.send(message)),
      recover: channel && (async () => [...(await channel.messages.fetch({ limit: 100 })).values()]
        .filter(m => m.author.id === client.user.id).flatMap(m => m.embeds.map(e => e.footer?.text || ''))) });
    if (outputIndex >= 0) fs.writeFileSync(args[outputIndex + 1], JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ checkedAt: result.checkedAt, stats: result.stats, errors: result.errors,
      sent: result.sent, candidates: (result.eligible || result.jobs).map(j => ({ score: j.score, status: j.status, company: j.company, url: j.url })) }, null, 2));
    if (result.errors?.length) process.exitCode = 1;
  } finally { client?.destroy(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
