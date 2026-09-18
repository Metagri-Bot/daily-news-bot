'use strict';

/**
 * 「日誌素案」用の1日ぶんダイジェスト。
 *
 * 目的は2つ。
 *   1. scripts/export-discord-day.js がローカルへ書き出す discord-log_YYYY-MM-DD.md と
 *      まったく同じ形式を、この1か所だけで組み立てる（形式の正をファイルとBot投稿で割らない）
 *   2. その本文を Discord の1メッセージ上限（2,000字）へ収まる形へ分割する
 *
 * シートは経由しない。日誌の素材は「その日ぶんの生データ」であって通し記録ではないので、
 * GAS側の状態に関係なく取れる経路をここに持たせている（export-discord-day.js と同じ考え方）。
 */

const { snowflakeFromDate, compareSnowflake, toRow } = require('./discord-channel-log');

const LOG_PREFIX = '[Diary Draft]';
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DEFAULT_GUILD_ID = '951780348465909820';
const DISCORD_MESSAGE_LIMIT = 2000;
/** 連番ラベル（`(1/3)`）と、分割時に足す行の見込みぶんを引いた安全側の既定 */
const DEFAULT_CHUNK_LIMIT = 1900;
const DEFAULT_PAGE_SIZE = 100;

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** 'YYYY-MM-DD'（JST）→ その日の 00:00:00 JST を表す Date */
function jstDayStart(dateText) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || '').trim());
  if (!m) throw new Error(`日付は YYYY-MM-DD で指定してください（受け取った値: ${dateText}）`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - JST_OFFSET_MS);
}

/** Date → JSTの 'YYYY-MM-DD' */
function toJstDateText(date) {
  const jst = new Date(new Date(date).getTime() + JST_OFFSET_MS);
  return `${jst.getUTCFullYear()}-${pad2(jst.getUTCMonth() + 1)}-${pad2(jst.getUTCDate())}`;
}

/**
 * 「前日」のようなオフセットを、JSTの日付文字列で返す。
 * UTCで引き算してからJSTへ直すと日付をまたぐ時間帯で1日ずれるので、
 * 必ず「JSTの日付」を求めてから日数を引く。
 */
function jstDateTextWithOffset(now = new Date(), offsetDays = 1) {
  const baseText = toJstDateText(now);
  const shifted = new Date(jstDayStart(baseText).getTime() - Math.round(Number(offsetDays) || 0) * 24 * 60 * 60 * 1000);
  return toJstDateText(shifted);
}

/** 'YYYY-MM-DD' → '9月17日'（見出し用） */
function jstDateLabel(dateText) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || '').trim());
  if (!m) return String(dateText || '');
  return `${Number(m[2])}月${Number(m[3])}日`;
}

function messageUrl(guildId, row) {
  return `https://discord.com/channels/${guildId}/${row.channelId}/${row.messageId}`;
}

/**
 * 指定日（JST・fromText〜toText の終日を含む）の投稿を、チャンネル別に集める。
 *
 * 1チャンネルの失敗で全体を止めない。権限漏れ1本で日誌の素材がまるごと消えるほうが損なので、
 * 失敗したチャンネルは errors と perChannel に残して次へ進む。
 */
async function collectDayRows({
  channelIds = [],
  fetchChannel,
  fromText,
  toText = fromText,
  pageSize = DEFAULT_PAGE_SIZE
} = {}) {
  if (typeof fetchChannel !== 'function') throw new Error('collectDayRows: fetchChannel is required');

  const startAt = jstDayStart(fromText);
  const endAt = new Date(jstDayStart(toText).getTime() + 24 * 60 * 60 * 1000);   // 終日を含む
  if (endAt <= startAt) throw new Error('日付の範囲が逆です（--date より --to が前になっています）');

  const afterId = snowflakeFromDate(new Date(startAt.getTime() - 1));
  const beforeId = snowflakeFromDate(endAt);
  const limit = Math.min(Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE), 100);

  const rows = [];
  const perChannel = [];
  const errors = [];
  let guildId = null;

  for (const channelId of channelIds) {
    try {
      const channel = await fetchChannel(channelId);
      if (!channel || typeof channel.messages?.fetch !== 'function') throw new Error('channel is not readable');
      guildId = guildId || channel.guildId || channel.guild?.id || null;

      const collected = [];
      let cursor = afterId;
      for (;;) {
        const batch = await channel.messages.fetch({ limit, after: cursor });
        const messages = (typeof batch?.values === 'function' ? [...batch.values()] : Array.isArray(batch) ? batch : [])
          .sort((a, b) => compareSnowflake(a.id, b.id));
        if (messages.length === 0) break;

        let reachedEnd = false;
        for (const message of messages) {
          cursor = message.id;
          if (compareSnowflake(message.id, beforeId) >= 0) { reachedEnd = true; break; }
          collected.push(toRow(message, channel));
        }
        if (reachedEnd || messages.length < limit) break;
      }

      rows.push(...collected);
      perChannel.push({ channelId, channelName: channel.name, count: collected.length });
    } catch (error) {
      errors.push(`${channelId}: ${error.message}`);
      perChannel.push({ channelId, channelName: null, count: 0, error: error.message });
    }
  }

  rows.sort((a, b) => compareSnowflake(a.messageId, b.messageId));

  return { rows, perChannel, errors, guildId: guildId || DEFAULT_GUILD_ID };
}

/**
 * 読む用のMarkdown。discord-log_YYYY-MM-DD.md と1文字も変えない。
 * 日誌はチャンネル単位で並ぶので、ここでもチャンネルごとにまとめる。
 */
function buildDayDigestMarkdown({
  fromText,
  toText = fromText,
  channelIds = [],
  rows = [],
  perChannel = [],
  errors = [],
  guildId = DEFAULT_GUILD_ID
} = {}) {
  const byChannel = new Map();
  rows.forEach(row => {
    if (!byChannel.has(row.channelId)) byChannel.set(row.channelId, []);
    byChannel.get(row.channelId).push(row);
  });

  const lines = [];
  lines.push(`# Discord投稿ログ ${fromText}${fromText === toText ? '' : ` 〜 ${toText}`}（JST）`);
  lines.push('');
  lines.push(`- 対象チャンネル: ${channelIds.length}件 / 取得: ${rows.length}件`);
  if (errors.length) lines.push(`- 🔴 取得できなかったチャンネル: ${errors.join(' / ')}`);
  lines.push('');
  perChannel.forEach(c => lines.push(`- ${c.channelName || '(取得失敗)'} \`${c.channelId}\` … ${c.count}件`));
  lines.push('');
  for (const [channelId, list] of byChannel) {
    lines.push('---');
    lines.push('');
    lines.push(`## ${list[0].channelName} \`<#${channelId}>\``);
    lines.push('');
    list.forEach(row => {
      lines.push(`### ${row.timestamp}　${row.displayName}（\`<@${row.userId}>\`）`);
      lines.push('');
      lines.push(row.content ? row.content.split('\n').map(l => `> ${l}`).join('\n') : '> （本文なし）');
      lines.push('');
      lines.push(messageUrl(guildId, row));
      lines.push('');
    });
  }
  return lines.join('\n');
}

/** URLや長い1行だけは、行の途中でも機械的に割るしかない */
function hardWrap(line, max) {
  const pieces = [];
  let rest = line;
  while (rest.length > max) {
    pieces.push(rest.slice(0, max));
    rest = rest.slice(max);
  }
  pieces.push(rest);
  return pieces;
}

/**
 * Markdownを「まとまり」へ切る。
 *   - `---`        … チャンネルの切れ目
 *   - `### …`      … 1投稿の切れ目
 * 先頭のサマリ（タイトル＋件数一覧）は最初のまとまりになる。
 */
function splitIntoUnits(lines) {
  const units = [];
  let current = [];
  const isBoundary = line => line === '---' || line.startsWith('### ');

  for (const line of lines) {
    if (isBoundary(line) && current.length) { units.push(current); current = []; }
    current.push(line);
  }
  if (current.length) units.push(current);

  return units.map(unit => {
    const copy = [...unit];
    while (copy.length && copy[copy.length - 1].trim() === '') copy.pop();
    return copy;
  }).filter(unit => unit.length > 0);
}

/**
 * `---` ＋ `## チャンネル名` だけのまとまりは、次の投稿とくっつける。
 * 単独で残すと、前のメッセージの末尾にチャンネル見出しだけが取り残される。
 */
function mergeHeaderUnits(units, max) {
  const isHeaderOnly = unit => unit[0] === '---' && !unit.some(line => line.startsWith('### '));
  const merged = [];

  for (const unit of units) {
    const previous = merged[merged.length - 1];
    const canMerge = previous
      && isHeaderOnly(previous)
      && !isHeaderOnly(unit)
      && previous.join('\n').length + 2 + unit.join('\n').length <= max;

    if (canMerge) merged[merged.length - 1] = [...previous, '', ...unit];
    else merged.push(unit);
  }
  return merged;
}

/** 1投稿だけで上限を超えるとき用。行の切れ目で機械的に詰める */
function packLines(lines, max) {
  const chunks = [];
  let current = [];
  let length = 0;

  const flush = () => {
    while (current.length && current[current.length - 1].trim() === '') current.pop();
    if (current.length) chunks.push(current.join('\n'));
    current = [];
    length = 0;
  };

  for (const rawLine of lines) {
    for (const line of (rawLine.length <= max ? [rawLine] : hardWrap(rawLine, max))) {
      if (length + line.length + (current.length ? 1 : 0) > max) flush();
      if (current.length === 0 && line.trim() === '') continue;
      current.push(line);
      length += line.length + (current.length > 1 ? 1 : 0);
    }
  }
  flush();
  return chunks;
}

/**
 * Discordの1メッセージ上限へ収まるよう分割する。
 *
 * 切る場所は〈投稿の切れ目〉が第一。1投稿（見出し＋引用＋URL）は1通の中に収める。
 * 引用ブロックの途中で切れると読めなくなるので、1投稿だけで上限を超えるときに限り
 * 行の切れ目で割る（1行だけで超える場合のみ、行の内側も割る）。
 */
function splitForDiscord(text, { limit = DEFAULT_CHUNK_LIMIT } = {}) {
  const max = Math.min(Math.max(200, Number(limit) || DEFAULT_CHUNK_LIMIT), DISCORD_MESSAGE_LIMIT);
  const source = String(text ?? '');
  if (source.trim() === '') return [];

  const units = mergeHeaderUnits(splitIntoUnits(source.split('\n')), max);
  const chunks = [];
  let current = null;

  for (const unit of units) {
    const block = unit.join('\n');

    if (block.length > max) {                       // 1投稿で上限を超える＝中で割るしかない
      if (current) { chunks.push(current); current = null; }
      packLines(unit, max).forEach(chunk => chunks.push(chunk));
      continue;
    }
    if (current && current.length + 2 + block.length > max) {
      chunks.push(current);
      current = null;
    }
    current = current ? `${current}\n\n${block}` : block;
  }
  if (current) chunks.push(current);

  return chunks;
}

/**
 * 実際に送る本文の配列。2通以上になるときだけ `(1/3)` を付ける。
 * 付けるのは、日誌を書く人が「途中で切れている」と分かるようにするため。
 */
function formatDiaryDraftMessages(markdown, { limit = DEFAULT_CHUNK_LIMIT } = {}) {
  const chunks = splitForDiscord(markdown, { limit });
  if (chunks.length <= 1) return chunks;
  return chunks.map((chunk, i) => `${chunk}\n\n\`(${i + 1}/${chunks.length})\``);
}

/**
 * 収集 → 整形 → 送信までを1回分。送信は send() に任せる（テストで差し替えるため）。
 *
 * @param {(content: string) => Promise<any>} send  1メッセージを送る関数
 * @returns {Promise<{dateText:string, rows:number, perChannel:Array, errors:Array, messages:number, sent:number}>}
 */
async function runDiaryDraft({
  channelIds = [],
  fetchChannel,
  send,
  now = new Date(),
  offsetDays = 1,
  dateText = null,
  toDateText = null,
  limit = DEFAULT_CHUNK_LIMIT,
  dryRun = false
} = {}) {
  const fromText = dateText || jstDateTextWithOffset(now, offsetDays);
  const toText = toDateText || fromText;

  const { rows, perChannel, errors, guildId } = await collectDayRows({ channelIds, fetchChannel, fromText, toText });
  const markdown = buildDayDigestMarkdown({ fromText, toText, channelIds, rows, perChannel, errors, guildId });
  const messages = formatDiaryDraftMessages(markdown, { limit });

  let sent = 0;
  if (!dryRun) {
    if (typeof send !== 'function') throw new Error('runDiaryDraft: send is required');
    // 1通ずつ順に送る。途中で落ちても、そこまでは残す（素材は部分的でも役に立つ）。
    for (const content of messages) {
      await send(content);
      sent += 1;
    }
  }

  return { dateText: fromText, toDateText: toText, rows: rows.length, perChannel, errors, messages: messages.length, sent, markdown };
}

module.exports = {
  LOG_PREFIX,
  DEFAULT_GUILD_ID,
  DISCORD_MESSAGE_LIMIT,
  DEFAULT_CHUNK_LIMIT,
  jstDayStart,
  toJstDateText,
  jstDateTextWithOffset,
  jstDateLabel,
  messageUrl,
  collectDayRows,
  buildDayDigestMarkdown,
  splitForDiscord,
  formatDiaryDraftMessages,
  runDiaryDraft
};
