'use strict';

/**
 * Discordチャンネルの投稿をスプレッドシートへ記録する（日次バッチ）。
 *
 * 設計の前提（2026-09-18 本人判断）:
 *   - 収集は「定期バッチのみ」。messageCreate によるリアルタイム追記はしない。
 *   - 対象は「チャンネル直下のメッセージ」だけ。スレッド内の発言は対象外
 *     （スレッドは既存の議論ログ機能が `type:'discussion'` で別シートへ記録している）。
 *   - Botの投稿も記録する（「◯月◯日のまとめ」のような自動投稿も資産として残す）。
 *
 * 取得の起点は「日付」でなく「前回記録した最後のMessage ID」。
 * Discordのsnowflakeは時刻の昇順なので、IDをカーソルにすると
 *   - 実行が1日飛んでも取りこぼさない
 *   - 同じ実行を2回走らせても重複しない
 * の2つが同時に成立する。日付ウィンドウで切ると両方とも壊れる。
 *
 * カーソルの「正」はスプレッドシート側（discord-channel-log-store.js が取得する）。
 * ローカルの state/*.json はその写しであって正ではない。
 */

const LOG_PREFIX = '[Channel Log]';

// Discord snowflake のタイムスタンプ基準（2015-01-01T00:00:00Z）
const DISCORD_EPOCH_MS = 1420070400000;

const DEFAULT_PAGE_SIZE = 100;          // Discord APIの上限
const DEFAULT_MAX_PER_RUN = 1000;       // 1チャンネル1実行あたりの取得上限
const DEFAULT_LOOKBACK_DAYS = 7;        // カーソルが無い初回だけ使う遡り日数

const ROW_FIELDS = [
  'timestamp',    // JST表示用 'YYYY/MM/DD HH:mm:ss'
  'date',         // ISO8601（UTC）
  'messageId',
  'userId',
  'userName',
  'displayName',
  'content',
  'channelId',
  'channelName'
];

/** 日時から、その時刻に相当する最小のsnowflakeを作る（初回実行の起点に使う） */
function snowflakeFromDate(date) {
  const ms = date instanceof Date ? date.getTime() : Number(date);
  if (!Number.isFinite(ms)) throw new Error('snowflakeFromDate: invalid date');
  const offset = BigInt(Math.max(0, Math.floor(ms) - DISCORD_EPOCH_MS));
  return (offset << 22n).toString();
}

/** snowflakeから投稿時刻を復元する */
function dateFromSnowflake(id) {
  return new Date(Number(BigInt(String(id)) >> 22n) + DISCORD_EPOCH_MS);
}

/**
 * snowflakeの大小比較。
 * 桁数が違えば桁数が大きいほうが新しい（19桁と18桁が混ざると文字列比較は誤る）。
 */
function compareSnowflake(a, b) {
  const x = String(a);
  const y = String(b);
  if (x.length !== y.length) return x.length - y.length;
  return x < y ? -1 : x > y ? 1 : 0;
}

function maxSnowflake(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return compareSnowflake(a, b) >= 0 ? String(a) : String(b);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * ISO日時をJSTの 'YYYY/MM/DD HH:mm:ss' にする。
 * スプレッドシートの表示列と、Discord上の見え方（JST）を一致させるための列。
 */
function toJstTimestamp(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}/${pad2(jst.getUTCMonth() + 1)}/${pad2(jst.getUTCDate())} `
    + `${pad2(jst.getUTCHours())}:${pad2(jst.getUTCMinutes())}:${pad2(jst.getUTCSeconds())}`;
}

/** 添付・スタンプしか無い投稿で Content が空にならないよう、本文が空のときだけ補う */
function buildContent(message) {
  const base = typeof message.content === 'string' ? message.content : '';
  if (base.trim() !== '') return base;

  const notes = [];
  const attachments = message.attachments;
  const files = attachments && typeof attachments.values === 'function'
    ? [...attachments.values()]
    : Array.isArray(attachments) ? attachments : [];
  files.forEach(file => notes.push(`[attachment] ${file.url || file.name || ''}`.trim()));

  const embeds = Array.isArray(message.embeds) ? message.embeds : [];
  embeds.forEach(embed => {
    const title = embed?.title || embed?.data?.title;
    const url = embed?.url || embed?.data?.url;
    if (title || url) notes.push(`[embed] ${[title, url].filter(Boolean).join(' ')}`);
  });

  return notes.join('\n');
}

/** discord.js の Message を、スプレッドシート1行ぶんの素直なオブジェクトへ落とす */
function toRow(message, channel) {
  const createdAt = message.createdAt instanceof Date
    ? message.createdAt
    : dateFromSnowflake(message.id);
  const author = message.author || {};

  return {
    timestamp: toJstTimestamp(createdAt),
    date: createdAt.toISOString(),
    messageId: String(message.id),
    userId: String(author.id || ''),
    userName: author.username || '',
    displayName: message.member?.displayName || author.globalName || author.username || '',
    content: buildContent(message),
    channelId: String(channel?.id || message.channelId || ''),
    channelName: channel?.name || ''
  };
}

/**
 * 1チャンネルぶんを、カーソル以降の古い順に取得する。
 *
 * @param {object} channel               discord.js の TextChannel（messages.fetch を持つもの）
 * @param {string|null} afterId          この Message ID より後だけ取る。null なら lookback から起こす
 * @param {boolean} includeBots          Botの投稿を含めるか
 * @param {number} maxMessages           1実行あたりの上限
 * @param {number} pageSize              1回のfetch件数（最大100）
 * @param {number} lookbackDays          カーソルが無いときに遡る日数
 * @param {Date} now                     テスト用に現在時刻を注入できるようにする
 */
async function collectChannelMessages({
  channel,
  afterId = null,
  includeBots = true,
  maxMessages = DEFAULT_MAX_PER_RUN,
  pageSize = DEFAULT_PAGE_SIZE,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  now = new Date()
} = {}) {
  if (!channel || typeof channel.messages?.fetch !== 'function') {
    throw new Error('collectChannelMessages: channel.messages.fetch is required');
  }

  const limit = Math.min(Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE), 100);
  let cursor = afterId
    ? String(afterId)
    : snowflakeFromDate(new Date(now.getTime() - Math.max(0, lookbackDays) * 24 * 60 * 60 * 1000));

  const rows = [];
  const seen = new Set();
  let fetched = 0;
  let truncated = false;

  // Discord API は after 指定のとき「そのIDの直後（＝いちばん古い側）」から返す。
  // バッチ内の最大IDを次のカーソルにすると、前へ前へと進める。
  for (;;) {
    const batch = await channel.messages.fetch({ limit, after: cursor });
    const messages = typeof batch?.values === 'function' ? [...batch.values()] : Array.isArray(batch) ? batch : [];
    if (messages.length === 0) break;

    messages.sort((a, b) => compareSnowflake(a.id, b.id));
    for (const message of messages) {
      fetched += 1;
      cursor = maxSnowflake(cursor, message.id);
      if (seen.has(String(message.id))) continue;
      seen.add(String(message.id));
      if (!includeBots && message.author?.bot) continue;
      rows.push(toRow(message, channel));
    }

    if (messages.length < limit) break;
    if (fetched >= maxMessages) { truncated = true; break; }
  }

  rows.sort((a, b) => compareSnowflake(a.messageId, b.messageId));

  return {
    channelId: String(channel.id),
    channelName: channel.name || '',
    rows,
    fetched,
    lastMessageId: rows.length > 0 ? rows[rows.length - 1].messageId : (afterId ? String(afterId) : null),
    cursor,
    truncated  // 上限で打ち切った＝次の実行で続きから取る（取りこぼしではない）
  };
}

/**
 * 全対象チャンネルを1回ぶん収集する。
 * 1チャンネルの失敗で全体を止めない（権限漏れ1本で他のチャンネルの記録が止まるほうが損）。
 */
async function runDiscordChannelLog({
  channelIds = [],
  fetchChannel,
  cursors = {},
  includeBots = true,
  maxMessages = DEFAULT_MAX_PER_RUN,
  pageSize = DEFAULT_PAGE_SIZE,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  now = new Date(),
  logger = console
} = {}) {
  if (typeof fetchChannel !== 'function') throw new Error('runDiscordChannelLog: fetchChannel is required');

  const targets = [...new Set(channelIds.map(id => String(id).trim()).filter(Boolean))];
  const rows = [];
  const perChannel = [];
  const errors = [];

  for (const channelId of targets) {
    try {
      const channel = await fetchChannel(channelId);
      if (!channel || typeof channel.messages?.fetch !== 'function') {
        throw new Error('channel is not readable');
      }
      const result = await collectChannelMessages({
        channel,
        afterId: cursors[channelId] || null,
        includeBots,
        maxMessages,
        pageSize,
        lookbackDays,
        now
      });
      rows.push(...result.rows);
      perChannel.push({
        channelId,
        channelName: result.channelName,
        collected: result.rows.length,
        fetched: result.fetched,
        lastMessageId: result.lastMessageId,
        truncated: result.truncated,
        firstRun: !cursors[channelId]
      });
    } catch (error) {
      const message = `${channelId}: ${error.message}`;
      errors.push(message);
      logger.error?.(`${LOG_PREFIX} ${message}`);
    }
  }

  rows.sort((a, b) => compareSnowflake(a.messageId, b.messageId));

  return { rows, perChannel, errors, stats: { channels: targets.length, collected: rows.length } };
}

module.exports = {
  LOG_PREFIX,
  ROW_FIELDS,
  DEFAULT_PAGE_SIZE,
  DEFAULT_MAX_PER_RUN,
  DEFAULT_LOOKBACK_DAYS,
  snowflakeFromDate,
  dateFromSnowflake,
  compareSnowflake,
  maxSnowflake,
  toJstTimestamp,
  buildContent,
  toRow,
  collectChannelMessages,
  runDiscordChannelLog
};
