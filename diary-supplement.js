'use strict';

/**
 * 「日誌素案」に添える補足セクション。
 *
 * 現状の discord-day-digest.js は生ログをそのまま流すだけで、要約や見解は
 * 意図的に入れていない（判断を挟むと「素案」でなく「下書き」になってしまうため）。
 * ここで足すのは見解ではなく「事実」の2種類だけ:
 *
 *   1. リンクの実情報 … 投稿に貼られたURLを実際に開き、タイトル・説明を機械的に添える
 *   2. 過去との比較   … Discord_Channel_Log スプレッドシートの実績と比べた件数の傾向
 *
 * どちらも「読み解いてどう書くか」は日誌を書く人に委ねる。ここでは判断しない。
 */

const dns = require('node:dns').promises;
const net = require('node:net');
const axios = require('axios');
const cheerio = require('cheerio');

const LOG_PREFIX = '[Diary Supplement]';
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_TREND_DAYS = 14;
const URL_PATTERN = /https?:\/\/[^\s<>\)\]]+/g;

// Discord自身のリンク（メッセージ/イベント/CDN）はOGPを取っても意味がないので対象外
const SKIP_HOSTS = new Set([
  'discord.com', 'discordapp.com', 'ptb.discord.com', 'canary.discord.com',
  'cdn.discordapp.com', 'media.discordapp.net'
]);

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

// discord-day-digest.js と同じJST日付計算だが、循環require（向こうがこのモジュールを
// 読む）を避けるためここに複製している。日付境界の考え方を変えたら両方直すこと。
function pad2(n) {
  return String(n).padStart(2, '0');
}

function jstDayStart(dateText) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || '').trim());
  if (!m) throw new Error(`日付は YYYY-MM-DD で指定してください（受け取った値: ${dateText}）`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - JST_OFFSET_MS);
}

function toJstDateText(date) {
  const jst = new Date(new Date(date).getTime() + JST_OFFSET_MS);
  return `${jst.getUTCFullYear()}-${pad2(jst.getUTCMonth() + 1)}-${pad2(jst.getUTCDate())}`;
}

/** 本文からURLを拾う（重複・Discord自身のリンクは除く） */
function extractUrls(content) {
  const matches = String(content || '').match(URL_PATTERN) || [];
  const seen = new Set();
  const urls = [];

  for (const raw of matches) {
    const url = raw.replace(/[.,)\]、。）」』】]+$/, '');   // 文末の句読点・閉じ括弧（全角含む）を落とす
    let parsed;
    try { parsed = new URL(url); } catch { continue; }
    if (!['http:', 'https:'].includes(parsed.protocol)) continue;
    if (SKIP_HOSTS.has(parsed.hostname.replace(/^www\./, ''))) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

/**
 * 社内ネットワークやクラウドのメタデータエンドポイントへ向いていないか確認する。
 * Botサーバーが「ユーザーが貼った任意のURL」を取りに行く以上、SSRFの入口になり得るため、
 * プライベート/ループバック/リンクローカルのアドレスは解決した時点で弾く。
 */
function isPrivateAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  if (net.isIP(address) === 6) {
    const lower = address.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80:')) return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice('::ffff:'.length));
    return false;
  }
  return true;   // 解決できない/未知の形式は安全側で弾く
}

async function assertPublicHost(hostname) {
  const { address } = await dns.lookup(hostname);
  if (isPrivateAddress(address)) throw new Error(`internal address is not allowed (${hostname} -> ${address})`);
}

/**
 * URLを1件取得し、タイトル・説明を返す（見解や要約は生成しない、あるものを読むだけ）。
 * リダイレクトは追わない（追った先が社内アドレスかを検証できないため）。
 */
async function defaultFetchLinkInfo(url, { timeout = DEFAULT_TIMEOUT_MS } = {}) {
  const parsed = new URL(url);
  await assertPublicHost(parsed.hostname);

  const response = await axios.get(url, {
    timeout,
    signal: AbortSignal.timeout(timeout + 2000),
    maxRedirects: 0,
    maxContentLength: 3 * 1024 * 1024,
    validateStatus: status => status >= 200 && status < 300,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Metagri-DiaryDraft/1.0)' }
  });

  const contentType = String(response.headers?.['content-type'] || '');
  if (!contentType.includes('text/html')) return { url, title: null, description: null };

  const $ = cheerio.load(response.data);
  const title = clean($('meta[property="og:title"]').attr('content') || $('title').first().text());
  const description = clean(
    $('meta[property="og:description"]').attr('content')
    || $('meta[name="description"]').attr('content')
    || ''
  );
  return { url, title: title || null, description: description || null };
}

/** 同時実行数を絞りつつ全件処理する */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function runNext() {
    while (cursor < items.length) {
      const current = cursor++;
      results[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, runNext));
  return results;
}

/** その日ぶんの行に含まれるURLを、重複排除しつつ実際に取得する */
async function collectLinkInfos(rows, {
  fetchLinkInfo = defaultFetchLinkInfo,
  concurrency = DEFAULT_CONCURRENCY,
  logger = console
} = {}) {
  const urls = [];
  const seen = new Set();
  for (const row of rows) {
    for (const url of extractUrls(row.content)) {
      if (seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
    }
  }
  if (urls.length === 0) return [];

  return mapWithConcurrency(urls, concurrency, async url => {
    try {
      return await fetchLinkInfo(url);
    } catch (error) {
      logger.error?.(`${LOG_PREFIX} リンク取得に失敗 ${url}: ${error.message}`);
      return { url, title: null, description: null, error: error.message };
    }
  });
}

function buildLinkSupplementSection(linkInfos = []) {
  if (linkInfos.length === 0) return [];

  const withInfo = linkInfos.filter(info => info?.title || info?.description);
  const failed = linkInfos.filter(info => !info?.title && !info?.description);
  if (withInfo.length === 0 && failed.length === 0) return [];

  const lines = ['---', '', '### 🔗 投稿内リンクの実情報（自動取得・機械的な要約や見解は入れていません）', ''];
  withInfo.forEach(info => {
    lines.push(`- ${info.url}`);
    if (info.title) lines.push(`  - タイトル: ${info.title}`);
    if (info.description) lines.push(`  - 説明: ${info.description}`);
  });
  if (failed.length > 0) {
    if (withInfo.length > 0) lines.push('');
    lines.push(`- 🔴 取得できなかったリンク（手動で確認してください）: ${failed.map(i => i.url).join(' / ')}`);
  }
  lines.push('');
  return lines;
}

/**
 * 過去{trendDays}日（対象日は除く）の実績と、今日の件数を比べる。
 * 「多い/少ない」の数字だけを出し、理由の解釈はしない。
 */
function buildTrendSupplementSection({
  dailyCounts = [],
  sourceChannelIds = [],
  perChannelToday = [],
  fromText,
  toText = fromText,
  trendDays = DEFAULT_TREND_DAYS
} = {}) {
  if (dailyCounts.length === 0) return [];

  const excludedDates = new Set();
  for (let d = jstDayStart(fromText); d <= jstDayStart(toText); d = new Date(d.getTime() + 24 * 60 * 60 * 1000)) {
    excludedDates.add(toJstDateText(d));
  }

  const baseline = dailyCounts.filter(row => !excludedDates.has(row.date));
  const windowDayCount = new Set(baseline.map(row => row.date)).size;
  if (windowDayCount === 0) return [];

  const byChannel = new Map();
  baseline.forEach(({ channelId, count }) => {
    const id = String(channelId);
    byChannel.set(id, (byChannel.get(id) || 0) + (Number(count) || 0));
  });

  const todayByChannel = new Map(perChannelToday.map(c => [String(c.channelId), Number(c.count) || 0]));
  const todayTotal = perChannelToday.reduce((sum, c) => sum + (Number(c.count) || 0), 0);
  const baselineTotal = sourceChannelIds.reduce((sum, id) => sum + (byChannel.get(String(id)) || 0), 0);
  const baselineAvg = baselineTotal / windowDayCount;

  const lines = ['---', '', '### 📊 過去との比較（自動集計・Discord_Channel_Logの実績ベース）', ''];
  lines.push(`- 過去${windowDayCount}日平均: ${baselineAvg.toFixed(1)}件/日 → 今日: ${todayTotal}件`);

  if (baselineAvg >= 2 && todayTotal < baselineAvg * 0.5) {
    lines.push('- 🔵 平均より少なめです。日誌として薄い場合は、前後の日とまとめる運用も検討してください（`--to` オプションで対象日を広げられます）。');
  }

  const quietChannels = sourceChannelIds
    .map(id => ({ id: String(id), avg: (byChannel.get(String(id)) || 0) / windowDayCount, today: todayByChannel.get(String(id)) || 0 }))
    .filter(c => c.avg >= 1 / 3 && c.today === 0);

  if (quietChannels.length > 0) {
    lines.push('');
    quietChannels.forEach(c => lines.push(`- 🔵 <#${c.id}> は過去${windowDayCount}日平均${c.avg.toFixed(1)}件/日ですが、今日は0件でした`));
  }
  lines.push('');
  return lines;
}

/**
 * リンク補足 + 過去比較をまとめて組み立てる。どちらも失敗してよい
 * （1つのURL取得失敗やGAS未接続で、日誌素案の投稿そのものを止めない）。
 */
async function buildDiaryDraftSupplement({
  rows = [],
  sourceChannelIds = [],
  perChannelToday = [],
  fromText,
  toText = fromText,
  dailyCounts = [],
  trendDays = DEFAULT_TREND_DAYS,
  fetchLinkInfo,
  concurrency,
  enableLinkSupplement = true,
  enableTrendSupplement = true,
  logger = console
} = {}) {
  const sections = [];

  if (enableLinkSupplement) {
    try {
      const linkInfos = await collectLinkInfos(rows, { fetchLinkInfo, concurrency, logger });
      sections.push(...buildLinkSupplementSection(linkInfos));
    } catch (error) {
      logger.error?.(`${LOG_PREFIX} リンク補足の生成に失敗: ${error.message}`);
    }
  }

  if (enableTrendSupplement && dailyCounts.length > 0) {
    try {
      sections.push(...buildTrendSupplementSection({ dailyCounts, sourceChannelIds, perChannelToday, fromText, toText, trendDays }));
    } catch (error) {
      logger.error?.(`${LOG_PREFIX} 傾向メモの生成に失敗: ${error.message}`);
    }
  }

  return sections.join('\n');
}

module.exports = {
  LOG_PREFIX,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_CONCURRENCY,
  DEFAULT_TREND_DAYS,
  extractUrls,
  isPrivateAddress,
  defaultFetchLinkInfo,
  collectLinkInfos,
  buildLinkSupplementSection,
  buildTrendSupplementSection,
  buildDiaryDraftSupplement
};
