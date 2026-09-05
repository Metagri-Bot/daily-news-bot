'use strict';

// Read-only: no Discord client, OpenAI calls, or history writes.
require('dotenv').config({ quiet: true });
const axios = require('axios');
const Parser = require('rss-parser');
const path = require('node:path');
const { getRobloxFeeds, collectRobloxArticles, selectRobloxArticles, loadHistory } = require('../roblox-news');

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
  const selected = selectRobloxArticles(articles, { sent });
  console.log(JSON.stringify(selected.map(({ title, source, score, link }) => ({ title, source, score, link })), null, 2));
  console.log('Reference coverage:', JSON.stringify(articles.filter(a => /daise|bldr|the doux|evaluation changes/i.test(a.title)).map(a => ({ title: a.title, published: a.published }))));
  if (!articles.length) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
