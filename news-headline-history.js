'use strict';

const { NEWS_FRESHNESS_DAYS } = require('./news-freshness');

async function recoverHeadlineHistory(fetchMessages, botId, now = new Date()) {
  const cutoff = now.getTime() - NEWS_FRESHNESS_DAYS * 86400000;
  const entries = [];
  let before;

  for (let page = 0; page < 3; page++) {
    const messages = await fetchMessages(before);
    for (const message of messages) {
      const postedAt = new Date(message.createdTimestamp ?? message.timestamp);
      if (message.author?.id !== botId || !Number.isFinite(postedAt.getTime()) || postedAt.getTime() < cutoff
        || !message.content?.startsWith('### 🚀 最新情報ヘッドライン（')) continue;

      let title;
      for (const line of message.content.split('\n')) {
        const heading = line.match(/^\*\*\d+\. (.+)\*\*$/u);
        if (heading) title = heading[1];
        if (title && /^https?:\/\/\S+$/iu.test(line)) {
          entries.push({ title, url: line, postedAt: postedAt.toISOString() });
          title = null;
        }
      }
    }
    if (messages.length < 100 || messages.some(message => new Date(message.createdTimestamp ?? message.timestamp) < cutoff)) break;
    before = messages.at(-1).id;
  }
  return entries;
}

module.exports = { recoverHeadlineHistory };
