'use strict';

const { articleKeys, saveHistory } = require('./roblox-news');

// Recover links from our own successful posts, including posts made before a local
// history write failed. Reads only this channel and only this bot's Roblox digests.
async function recoverDiscordHistory(channel, botId, sent, now = new Date()) {
  const recovered = { ...sent };
  const cutoff = new Date(now).getTime() - 30 * 86400000;
  let before;
  for (let page = 0; page < 10; page++) {
    const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    const list = [...messages.values()];
    if (!list.length) break;
    for (const message of list) {
      if (message.author?.id !== botId || message.createdTimestamp < cutoff) continue;
      for (const embed of message.embeds || []) {
        if (!embed.title?.startsWith('🤖 Roblox ビジネス・アップデート速報')) continue;
        for (const field of embed.fields || []) {
          for (const match of (field.value || '').matchAll(/\[原文を読む\]\((https?:\/\/[^\s]+)\)/g)) {
            for (const key of articleKeys({ link: match[1] })) {
              const date = new Date(message.createdTimestamp).toISOString();
              if (!recovered[key] || recovered[key] < date) recovered[key] = date;
            }
          }
        }
      }
    }
    if (list.length < 100 || list.some(m => m.createdTimestamp < cutoff)) break;
    before = list.at(-1).id;
  }
  return recovered;
}

function buildDigestBatches(translatedArticles, now = new Date()) {
  const batches = [];
  // Four fields per message stay below Discord's 6000-character aggregate limit.
  for (let offset = 0; offset < translatedArticles.length; offset += 4) {
    const items = translatedArticles.slice(offset, offset + 4);
    const fields = items.map(({ original, translated }) => {
      const title = String(translated.titleJa).replace(/\[/g, '［').replace(/\]/g, '］');
      const link = `\n\n[原文を読む](${original.link}) (*Source: ${String(original.source || '').slice(0, 100)}*)`;
      if (link.length > 1000) throw new Error('Roblox article URL exceeds Discord field budget');
      const summary = String(translated.summary).slice(0, 1024 - link.length);
      return { name: `[重要度${original.importance ?? original.score} | ${original.label}] ${title}`.slice(0, 256), value: summary + link };
    });
    batches.push({ articles: items.map(item => item.original), embed: {
      color: 0x00A2FF,
      title: `🤖 Roblox ビジネス・アップデート速報 (${new Date(now).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })})`,
      description: `全${translatedArticles.length}件の重要ニュース（${offset + 1}〜${offset + items.length}件目）`,
      timestamp: new Date(now).toISOString(), fields,
    } });
  }
  return batches;
}

async function deliverDigest({ channel, translatedArticles, historyFile, sent, now = new Date(), persist = saveHistory }) {
  // Construct all batches first so validation failure cannot cause a partial post.
  const batches = buildDigestBatches(translatedArticles, now);
  const delivered = [];
  for (const batch of batches) {
    await channel.send({ embeds: [batch.embed] });
    delivered.push(...batch.articles);
    // A later batch failure must not replay already delivered batches on retry.
    persist(historyFile, sent, delivered, now);
  }
  return delivered.length;
}

module.exports = { recoverDiscordHistory, buildDigestBatches, deliverDigest };
