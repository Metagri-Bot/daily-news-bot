'use strict';

const axios = require('axios');
const Parser = require('rss-parser');
const { getArticlePublishedDate, NEWS_FRESHNESS_DAYS } = require('./news-freshness');

const MAFF_RSS = 'https://www.maff.go.jp/rss.xml';
const OLD_MAFF_RSS = 'https://www.maff.go.jp/j/new/rss.xml';

function getHeadlineFeedUrls(agriculture = '', technology = '') {
  const sources = [
    agriculture, technology,
    'https://smartagri-jp.com/rss',
    'https://www.naro.go.jp/top_new_feed.xml',
    'https://www.ffpri.go.jp/saizensen.xml',
    'https://www.rinya.maff.go.jp/rss.xml',
    'https://www.jfa.maff.go.jp/rss.xml'
  ];
  return [...new Set(sources.join(',').split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .map(url => url === OLD_MAFF_RSS ? MAFF_RSS : url))];
}

async function collectHeadlineFeeds(urls, { now = new Date(), fetch = axios.get, parser = new Parser() } = {}) {
  const results = await Promise.all(urls.map(async url => {
    try {
      const host = new URL(url).hostname;
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
      const feed = await parser.parseString(response.data);
      const items = feed.items.map(item => ({ ...item, feedHost: host }));
      const latest = items.map(getArticlePublishedDate).filter(date => date && date <= now)
        .reduce((newest, date) => !newest || date > newest ? date : newest, null);
      const stale = !latest || now - latest > NEWS_FRESHNESS_DAYS * 86400000;
      return { url, items, latest, stale };
    } catch (error) {
      return { url, items: [], error: error.response?.status || error.code || 'RSS読み込み失敗' };
    }
  }));
  return { articles: results.flatMap(result => result.items), feeds: results };
}

async function readHeadlineHistory(gasUrl, fetch = axios.get) {
  if (!gasUrl) return [];
  const { data } = await fetch(gasUrl, { params: { type: 'getPostedNewsArticles' }, timeout: 15000 });
  if (!Array.isArray(data)) throw new Error('投稿履歴のレスポンスが配列ではありません');
  // 既存デプロイが新しい取得種別に未対応の場合は従来のURL配列が返る。
  return data.map(entry => typeof entry === 'string' ? { url: entry } : entry)
    .filter(entry => typeof entry?.url === 'string' && entry.url);
}

module.exports = { getHeadlineFeedUrls, collectHeadlineFeeds, readHeadlineHistory };
