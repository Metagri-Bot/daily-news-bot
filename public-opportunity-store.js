'use strict';

/**
 * 公募モニターの通知履歴をGoogleスプレッドシートに永続化する。
 *
 * 重複投稿を防ぐ「正」はスプレッドシート（`Public_Opportunities`シート）に置く。
 * ローカルの `state/public-opportunities.json` はその写し（キャッシュ）として扱うため、
 * サーバー移行・コンテナ再作成・ボリューム削除でも過去案件が再通知されない。
 *
 * GAS側のエンドポイント（`.gascode` 参照）:
 *   POST { type: 'getPublicOpportunities' }              → 記録済みレコードの配列
 *   POST { type: 'publicOpportunities', records: [...] } → id列でupsert
 */

const axios = require('axios');

const LOG_PREFIX = '[Public Opportunity Store]';
const REQUEST_TIMEOUT_MS = 20000;

/** GASへのPOST（テストで差し替え可能） */
async function defaultPost(url, payload) {
  const response = await axios.post(url, payload, { timeout: REQUEST_TIMEOUT_MS });
  return response.data;
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const id = String(record.id || '').trim();
  const signature = String(record.signature || '').trim();
  if (!id || !signature) return null;

  const toText = value => {
    if (value === null || value === undefined || value === '') return null;
    // Sheets側で日付セルに変換されてしまった場合も文字列に戻す
    if (value instanceof Date) return value.toISOString();
    return String(value);
  };

  return {
    id,
    entry: {
      signature,
      title: toText(record.title) || '',
      url: toText(record.url) || '',
      organization: toText(record.organization),
      deadline: toText(record.deadline),
      rank: toText(record.rank),
      score: record.score === undefined || record.score === null ? null : Number(record.score),
      first_notified_at: toText(record.first_notified_at),
      last_notified_at: toText(record.last_notified_at),
      last_checked_at: toText(record.last_checked_at)
    }
  };
}

/**
 * スプレッドシートから通知履歴を取得する。
 *
 * @returns {Promise<{status:'ok'|'not_deployed'|'unavailable'|'disabled', seen:object}>}
 *   ok            … 取得成功
 *   not_deployed  … GASが応答したが未対応（旧バージョン・権限設定など＝構成の問題）
 *   unavailable   … 通信自体が失敗（一時障害の可能性）
 *   disabled      … GASのURLが未設定
 *
 * `unavailable` と `not_deployed` を区別するのは、前者だけが
 * 「履歴があるはずなのに読めない」状態＝重複通知の危険がある状態だから。
 */
async function fetchRemoteHistory(gasUrl, { postImpl = defaultPost } = {}) {
  if (!gasUrl) return { status: 'disabled', seen: {} };

  let data;
  try {
    data = await postImpl(gasUrl, { type: 'getPublicOpportunities' });
  } catch (error) {
    console.error(`${LOG_PREFIX} 履歴の取得に失敗しました（通信エラー）: ${error.message}`);
    return { status: 'unavailable', seen: {} };
  }

  const records = Array.isArray(data) ? data : Array.isArray(data?.records) ? data.records : null;
  if (!records) {
    console.error(
      `${LOG_PREFIX} GASが履歴取得に対応していません（応答: ${JSON.stringify(data).slice(0, 200)}）。` +
        'Apps Scriptを最新の .gascode で更新し、新バージョンでデプロイしてください。'
    );
    return { status: 'not_deployed', seen: {} };
  }

  const seen = {};
  let skipped = 0;
  for (const record of records) {
    const normalized = normalizeRecord(record);
    if (!normalized) {
      skipped += 1;
      continue;
    }
    seen[normalized.id] = normalized.entry;
  }
  console.log(
    `${LOG_PREFIX} スプレッドシートから履歴 ${Object.keys(seen).length}件を取得しました` +
      (skipped ? `（不正な行 ${skipped}件をスキップ）` : '')
  );
  return { status: 'ok', seen };
}

function timestampOf(entry) {
  const value = new Date(entry?.last_notified_at || entry?.first_notified_at || 0).getTime();
  return Number.isNaN(value) ? 0 : value;
}

/**
 * ローカル履歴とシート履歴を統合する。
 * 同一idは「最後に通知した時刻が新しい方」を採用し、確認日時は新しい方を残す。
 */
function mergeHistories(localState, remoteState) {
  const local = (localState && localState.seen) || {};
  const remote = (remoteState && remoteState.seen) || {};
  const seen = { ...local };

  for (const [id, remoteEntry] of Object.entries(remote)) {
    const localEntry = seen[id];
    if (!localEntry) {
      seen[id] = remoteEntry;
      continue;
    }

    const base = timestampOf(remoteEntry) > timestampOf(localEntry) ? remoteEntry : localEntry;
    const checkedAt = [localEntry.last_checked_at, remoteEntry.last_checked_at]
      .filter(Boolean)
      .sort()
      .pop();
    const firstNotifiedAt = [localEntry.first_notified_at, remoteEntry.first_notified_at]
      .filter(Boolean)
      .sort()
      .shift();

    seen[id] = {
      ...base,
      first_notified_at: firstNotifiedAt || base.first_notified_at || null,
      last_checked_at: checkedAt || null
    };
  }

  return {
    version: 1,
    seen,
    last_run_at: (localState && localState.last_run_at) || null,
    last_result: (localState && localState.last_result) || {}
  };
}

/** state の seen からシート追記用レコード配列を作る */
function buildRecords(seen, ids) {
  const targetIds = ids || Object.keys(seen || {});
  return targetIds
    .filter(id => seen && seen[id])
    .map(id => ({
      id,
      signature: seen[id].signature,
      title: seen[id].title || '',
      url: seen[id].url || '',
      organization: seen[id].organization || '',
      deadline: seen[id].deadline || '',
      rank: seen[id].rank || '',
      score: seen[id].score === null || seen[id].score === undefined ? '' : seen[id].score,
      first_notified_at: seen[id].first_notified_at || '',
      last_notified_at: seen[id].last_notified_at || '',
      last_checked_at: seen[id].last_checked_at || ''
    }));
}

/**
 * 通知した案件をスプレッドシートへ追記（id一致なら更新）する。
 * @returns {Promise<boolean>} 追記できたか
 */
async function pushRemoteHistory(gasUrl, records, { postImpl = defaultPost } = {}) {
  if (!gasUrl || !Array.isArray(records) || records.length === 0) return false;

  try {
    const response = await postImpl(gasUrl, { type: 'publicOpportunities', records });

    // GASは失敗時もHTTP 200で {"result":"error"} を返すため、本文で成否を判定する
    if (response && typeof response === 'object' && response.result && response.result !== 'success') {
      console.error(
        `${LOG_PREFIX} スプレッドシートが記録を拒否しました: ${response.message || response.result}。` +
          'Apps Scriptを最新の .gascode で更新し、新バージョンでデプロイしてください。'
      );
      return false;
    }

    console.log(`${LOG_PREFIX} スプレッドシートへ ${records.length}件を記録しました`);
    return true;
  } catch (error) {
    console.error(`${LOG_PREFIX} スプレッドシートへの記録に失敗しました: ${error.message}`);
    return false;
  }
}

module.exports = {
  fetchRemoteHistory,
  pushRemoteHistory,
  mergeHistories,
  buildRecords,
  normalizeRecord
};
