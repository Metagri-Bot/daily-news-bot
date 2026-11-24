'use strict';

const { NEWS_FRESHNESS_DAYS } = require('./news-freshness');
const { newsUrlKey } = require('./news-selection');

async function recoverGlobalHistory(fetchMessages, botId, now = new Date()) {
  const cutoff = now.getTime() - NEWS_FRESHNESS_DAYS * 86400000;
  const urls = new Set();
  let before;
  while (true) {
    const messages = await fetchMessages(before);
    for (const message of messages) {
      const timestamp = new Date(message.createdTimestamp ?? message.timestamp).getTime();
      if (message.author?.id !== botId || !Number.isFinite(timestamp) || timestamp < cutoff ||
          !message.content?.startsWith('## 🌍 **Metagri Global Research Digest**')) continue;
      for (const embed of message.embeds || []) {
        const key = newsUrlKey(embed.url);
        if (key) urls.add(key);
      }
    }
    if (messages.length < 100 || messages.some(message => new Date(message.createdTimestamp ?? message.timestamp).getTime() < cutoff)) break;
    before = messages.at(-1).id;
  }
  return urls;
}

module.exports = { recoverGlobalHistory };
