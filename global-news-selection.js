'use strict';

const { normalizeNewsText } = require('./news-keywords');
const { getArticlePublishedDate } = require('./news-freshness');
const { newsUrlKey } = require('./news-selection');

const SECTOR = /\b(?:agricultur\w*|agritech|agtech|agrotech|agronom\w*|agribusiness|farms?|farmers?|farming|crops?|orchards?|vineyards?|irrigation|horticultur\w*|livestock|dairy|cattle|poultry|aquaponics|aquaculture|fisher(?:y|ies|men)|fishing vessels?|fish stocks?|forestry|silvicultur\w*|timber harvesting|forest inventories|forest inventory|food security|food systems?)\b/u;
const TECH = /\b(?:ai|llms?|chatgpt|artificial intelligence|machine learning|deep learning|computer vision|remote sensing|lidar|sensors?|drones?|satellite\w*|robots?|robotics|automation|autonomous|iot|digital twins?|data analytics|web3|blockchain|metaverse|smart contracts?|biotech\w*|gene editing|crispr)\b/u;
const RESEARCH = /\b(?:research\w*|study|studies|findings|development|trials?|experiments?|analysis|validated|evaluated|deployed|pilot|tested|demonstrat\w*)\b/u;

function topicText(value) {
  return normalizeNewsText(value).replace(/\b(?:wind|solar|server|click|crypto|tank) farms?\b/gu, ' ');
}

function filterGlobalArticles(articles) {
  const ranked = [];
  for (const article of articles) {
    const key = newsUrlKey(article.link);
    if (!key || !article.title?.trim()) continue;
    const title = topicText(article.title);
    const summary = topicText(article.contentSnippet || article.summary || article.content).slice(0, 1200);
    const text = title + ' ' + summary;
    // 総合誌では、本文末尾の別分野への言及だけで採択しない。
    if (!SECTOR.test(title) && !(SECTOR.test(summary) && (TECH.test(title) || RESEARCH.test(title)))) continue;
    if (!TECH.test(text) && !RESEARCH.test(text)) continue;
    const score = Number(SECTOR.test(title)) * 2 + Number(TECH.test(text)) * 3
      + Number(RESEARCH.test(text)) * 2 + Number(TECH.test(title));
    ranked.push({ article, key, score, date: getArticlePublishedDate(article)?.getTime() || 0 });
  }
  ranked.sort((a, b) => b.score - a.score || b.date - a.date || a.key.localeCompare(b.key));
  const seen = new Set();
  return ranked.filter(({ key }) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(({ article }) => article);
}

module.exports = { filterGlobalArticles };
