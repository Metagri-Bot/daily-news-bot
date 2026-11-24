'use strict';

require('dotenv').config({ quiet: true });
const { REST, Routes } = require('discord.js');
const { getHeadlineFeedUrls, collectHeadlineFeeds, readHeadlineHistory } = require('../news-headline-feeds');
const { recoverHeadlineHistory } = require('../news-headline-history');
const { selectNewsHeadlines } = require('../news-selection');

async function readDiscordHistory(now) {
  const token = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.INFO_GATHERING_CHANNEL_ID;
  if (!token || !channelId) return [];
  const rest = new REST({ version: '10', hashSweepInterval: 0, handlerSweepInterval: 0, timeout: 15000 }).setToken(token);
  const bot = await rest.get(Routes.user());
  return recoverHeadlineHistory(before => rest.get(Routes.channelMessages(channelId), {
    query: new URLSearchParams({ limit: '100', ...(before ? { before } : {}) })
  }), bot.id, now);
}

async function main() {
  const now = new Date();
  const urls = getHeadlineFeedUrls(process.env.NEWS_RSS_FEEDS_AGRICULTURE, process.env.NEWS_RSS_FEEDS_WEB3);
  const [history, { articles, feeds }, discordHistory] = await Promise.all([
    readHeadlineHistory(process.env.GOOGLE_APPS_SCRIPT_URL),
    collectHeadlineFeeds(urls, { now }),
    readDiscordHistory(now).catch(error => {
      console.warn('Discordの投稿履歴を取得できません:', error.code || error.status || '取得失敗');
      return [];
    })
  ]);
  const { selected, rejected, candidates } = selectNewsHeadlines(articles, { history: [...discordHistory, ...history], now });
  console.log(JSON.stringify({
    checkedAt: now.toISOString(),
    history: { sheetUrls: history.length, sheetDatedTitles: history.filter(entry => entry.title && entry.postedAt).length, discordArticles: discordHistory.length },
    feeds: feeds.map(({ url, items, latest, stale, error }) => ({
      source: url.replace(/[?#].*$/, ''), items: items.length, latest, stale, error
    })),
    candidates: candidates.length,
    rejected,
    selected: selected.map(({ title, link, isoDate, score, editorialReason, isFarmerAiUseCase }) => ({
      title, link, isoDate, score, editorialReason, isFarmerAiUseCase
    }))
  }, null, 2));
}

main().catch(error => {
  console.error('ニュース選定の確認に失敗:', error.code || error.response?.status || error.message);
  process.exitCode = 1;
});
