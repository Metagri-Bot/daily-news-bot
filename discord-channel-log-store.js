'use strict';

/**
 * チャンネル投稿ログを、専用のGoogleスプレッドシートへ永続化する。
 *
 * 既存の logToSpreadsheet（GOOGLE_APPS_SCRIPT_URL）とは別のWebアプリを使う。
 * 理由は2つ:
 *   1. 本番のGASコードに手を入れずに足せる（AIGuideCode.gs がリポジトリと本番で
 *      不一致という既知の問題があるため、既存GASへの追記は事故の入口になる）
 *   2. 投稿ログは行数が桁違いに増えるので、既存の運用シートと同居させない
 *
 * GAS側のエンドポイント（`ChannelLogCode.gs` 参照）:
 *   POST { type:'getChannelLogCursors' }            → { cursors: { <channelId>: <lastMessageId> } }
 *   POST { type:'channelLog', records:[...] }       → Message ID で重複排除して追記
 *   POST { type:'channelLogDailyCounts', days:n }   → { counts:[{date,channelId,channelName,count}, ...] }
 *
 * 「正」はスプレッドシート。state/discord-channel-log.json はその写し（キャッシュ）で、
 * GASが落ちている日でも前回位置が分かるようにするためだけに置く。
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const LOG_PREFIX = '[Channel Log Store]';
const REQUEST_TIMEOUT_MS = 30000;
const CHUNK_SIZE = 200;          // 1POSTあたりの行数。GASの実行時間上限に対する保険
const STATE_PATH = path.join(__dirname, 'state', 'discord-channel-log.json');

const RECORD_FIELDS = [
  'timestamp',
  'date',
  'messageId',
  'userId',
  'userName',
  'displayName',
  'content',
  'channelId',
  'channelName'
];

/**
 * GASのウェブアプリは、デプロイ設定を間違えると本文でなくHTTPステータスで落ちる。
 * そのとき出るのは axios の `Request failed with status code 401` だけで、
 * 何を直せばよいかが分からない。原因の候補をここで名指しする。
 */
function describeGasError(error) {
  const status = error?.response?.status;
  if (status === 401 || status === 403) {
    return `GASが${status}を返しました。デプロイ設定を確認してください`
      + '（デプロイ → 編集 → 「次のユーザーとして実行: 自分」「アクセスできるユーザー: 全員」）。'
      + 'この2つが揃っていないと、URLが正しくてもログイン画面へ飛ばされて401/403になります。';
  }
  if (status === 404) {
    return 'GASが404を返しました。URLが古いデプロイを指しています（新しいデプロイを作るとURLが変わります）。';
  }
  if (status >= 500) {
    return `GASが${status}を返しました。スクリプト側で例外が出ています（Apps Scriptの実行ログを確認）。`;
  }
  return error?.message || String(error);
}

async function defaultPost(url, payload) {
  try {
    const response = await axios.post(url, payload, { timeout: REQUEST_TIMEOUT_MS });
    return response.data;
  } catch (error) {
    const described = new Error(describeGasError(error));
    described.status = error?.response?.status;
    described.cause = error;
    throw described;
  }
}

function readLocalCursors() {
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.cursors === 'object' ? parsed.cursors : {};
  } catch {
    return {};
  }
}

function writeLocalCursors(cursors) {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), cursors }, null, 2));
  } catch (error) {
    console.error(`${LOG_PREFIX} ローカルカーソルの保存に失敗: ${error.message}`);
  }
}

function normalizeCursors(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.entries(value).reduce((acc, [channelId, messageId]) => {
    if (channelId && messageId) acc[String(channelId)] = String(messageId);
    return acc;
  }, {});
}

/**
 * チャンネル別の最終Message IDを取得する。
 * シートが取れなければローカルの写しで代替する（取れないことを取りこぼしの理由にしない）。
 */
async function loadCursors({ gasUrl, post = defaultPost, logger = console } = {}) {
  const local = readLocalCursors();
  if (!gasUrl) {
    logger.warn?.(`${LOG_PREFIX} GAS URLが未設定のため、ローカルの写しを使います`);
    return { cursors: local, source: 'local' };
  }
  try {
    const data = await post(gasUrl, { type: 'getChannelLogCursors' });
    if (data && data.success === false) throw new Error(data.error || 'GAS returned success:false');
    const cursors = normalizeCursors(data?.cursors ?? data);
    return { cursors, source: 'sheet' };
  } catch (error) {
    logger.error?.(`${LOG_PREFIX} カーソル取得に失敗（ローカルの写しで継続）: ${error.message}`);
    return { cursors: local, source: 'local' };
  }
}

/**
 * 直近N日ぶんの日付×チャンネル件数を取る（日誌素案の「過去との比較」補足が使う）。
 * 取れなければ空配列を返す（GAS未設定・未デプロイは「傾向メモを出さない」で吸収する）。
 */
async function loadDailyCounts({ gasUrl, days = 30, post = defaultPost, logger = console } = {}) {
  if (!gasUrl) return [];
  try {
    const data = await post(gasUrl, { type: 'channelLogDailyCounts', days });
    if (data && data.success === false) throw new Error(data.error || 'GAS returned success:false');
    return Array.isArray(data?.counts) ? data.counts : [];
  } catch (error) {
    logger.error?.(`${LOG_PREFIX} 過去の件数取得に失敗（傾向メモは省略します）: ${error.message}`);
    return [];
  }
}

function toRecord(row) {
  return RECORD_FIELDS.reduce((acc, field) => {
    const value = row[field];
    acc[field] = value === null || value === undefined ? '' : String(value);
    return acc;
  }, {});
}

/**
 * 行をシートへ追記する。重複排除はGAS側（Message ID）で行う。
 * @returns {{ sent:number, appended:number, skipped:number, errors:string[] }}
 */
async function saveRows({ gasUrl, rows = [], post = defaultPost, chunkSize = CHUNK_SIZE, logger = console } = {}) {
  if (rows.length === 0) return { sent: 0, appended: 0, skipped: 0, errors: [] };
  if (!gasUrl) return { sent: 0, appended: 0, skipped: 0, errors: ['DISCORD_CHANNEL_LOG_GAS_URL is not set'] };

  const records = rows.map(toRecord);
  const errors = [];
  let appended = 0;
  let skipped = 0;
  let sent = 0;

  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    try {
      const data = await post(gasUrl, { type: 'channelLog', records: chunk });
      if (data && data.success === false) throw new Error(data.error || 'GAS returned success:false');
      sent += chunk.length;
      appended += Number(data?.appended ?? chunk.length);
      skipped += Number(data?.skipped ?? 0);
    } catch (error) {
      errors.push(`chunk ${i / chunkSize + 1}: ${error.message}`);
      logger.error?.(`${LOG_PREFIX} 追記に失敗: ${error.message}`);
      break;  // 途中で失敗したら止める。カーソルを進めないことで次回まとめて取り直す
    }
  }

  return { sent, appended, skipped, errors };
}

module.exports = {
  LOG_PREFIX,
  describeGasError,
  STATE_PATH,
  RECORD_FIELDS,
  CHUNK_SIZE,
  readLocalCursors,
  writeLocalCursors,
  normalizeCursors,
  loadCursors,
  loadDailyCounts,
  toRecord,
  saveRows
};
