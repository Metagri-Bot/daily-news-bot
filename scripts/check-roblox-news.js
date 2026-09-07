'use strict';

// No Discord posting or history writes. --editorial opts into OpenAI evaluation.
require('dotenv').config({ quiet: true });
const axios = require('axios');
const Parser = require('rss-parser');
const path = require('node:path');
const { getRobloxFeeds, collectRobloxArticles, selectRobloxArticles, rankRobloxArticles, loadHistory } = require('../roblox-news');
const { buildJsonCompletionParams } = require('../openai-chat');

async function main() {
  const parser = new Parser();
  const articles = await collectRobloxArticles({
    urls: getRobloxFeeds(process.env.ROBLOX_RSS_FEEDS || ''),
    fetchPage: async url => (await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } })).data,
    fetchFeed: async url => {
      const response = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      return parser.parseString(response.data);
    },
  });
  const sent = loadHistory(path.join(__dirname, '..', 'state', 'roblox-news-sent.json'));
  let selected;
  if (process.argv.includes('--editorial')) {
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const { curateRobloxArticles } = require('../roblox-news-editorial');
    selected = await curateRobloxArticles({ candidates: rankRobloxArticles(articles, { sent, logger: console }), sent, historyArticles: articles,
      evaluate: async prompt => {
        const response = await openai.chat.completions.create(buildJsonCompletionParams({
          model: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
          messages: [{ role: 'user', content: prompt }],
          maxTokens: 10000
        }));
        return JSON.parse(response.choices[0].message.content);
      },
    });
  } else {
    selected = selectRobloxArticles(articles, { sent, logger: console });
    console.log('[Roblox News] 候補プレビュー（重要度審査前）。最終選定の確認は --editorial を指定。');
  }
  console.log(JSON.stringify(selected.map(({ title, source, score, link, importance, importanceReason }) => ({ title, source, score, link, importance, importanceReason })), null, 2));
  if (!articles.length) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
