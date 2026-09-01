'use strict';

/**
 * 千葉県自治体案件レーダーの案件台帳をGoogleスプレッドシートに永続化する。
 *
 * 重複投稿を防ぐ「正」はスプレッドシート（`Chiba_Tenders`シート）。
 * ローカルの `state/chiba-tenders.json` はその写し（キャッシュ）。
 *
 * 既存の public-opportunity-store.js と違う点:
 *   - 通知した案件だけでなく、59点以下の案件も台帳に残す。
 *     フェーズ2（更新案件レーダー）の予測は、落とした案件の履歴があって成立する。
 *   - 列に source_id / department / budget_upper / contract_period / multi_year /
 *     gate_flags / status を持つ。契約期間は結果ページに載らないため、
 *     公告の時点で保存しておかないと後から取れない。
 *
 * GAS側のエンドポイント（`.gascode` 参照）:
 *   POST { type: 'getChibaTenders' }              → 記録済みレコードの配列
 *   POST { type: 'chibaTenders', records: [...] } → id列でupsert
 */

const axios = require('axios');

const LOG_PREFIX = '[Chiba Tender Store]';
const REQUEST_TIMEOUT_MS = 20000;

const RECORD_FIELDS = [
  'id',
  'signature',
  'source_id',
  'organization',
  'department',
  'title',
  'url',
  'type',
  'deadline',
  'budget_upper',
  'contract_period',
  'multi_year',
  'score',
  'rank',
  'gate_flags',
  'status',
  'summary',
  'action',
  'first_notified_at',
  'last_notified_at',
  'last_checked_at'
];

async function defaultPost(url, payload) {
  const response = await axios.post(url, payload, { timeout: REQUEST_TIMEOUT_MS });
  return response.data;
}

function toText(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function parseJsonish(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (error) {
    return {};
  }
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const id = String(record.id || '').trim();
  const signature = String(record.signature || '').trim();
  if (!id || !signature) return null;

  return {
    id,
    entry: {
      signature,
      source_id: toText(record.source_id) || '',
      organization: toText(record.organization) || '',
      department: toText(record.department) || '',
      title: toText(record.title) || '',
      url: toText(record.url) || '',
      type: toText(record.type) || '',
      deadline: toText(record.deadline),
      budget_upper:
        record.budget_upper === undefined || record.budget_upper === null || record.budget_upper === ''
          ? null
          : Number(record.budget_upper),
      contract_period: toText(record.contract_period) || '',
      multi_year: record.multi_year === true || String(record.multi_year).toLowerCase() === 'true',
      score: record.score === undefined || record.score === null || record.score === '' ? null : Number(record.score),
      rank: toText(record.rank) || '',
      gate_flags: parseJsonish(record.gate_flags),
      status: toText(record.status) || '',
      summary: toText(record.summary) || '',
      action: toText(record.action) || '',
      first_notified_at: toText(record.first_notified_at),
      last_notified_at: toText(record.last_notified_at),
      last_checked_at: toText(record.last_checked_at),
      reminded_days: parseRemindedDays(record.reminded_days)
    }
  };
}

/**
 * リマインド済みの線はシートに列を増やさず、status列の末尾に埋め込まない。
 * シート側に列が無いバージョンでも壊れないよう、無ければ空配列を返す。
 */
function parseRemindedDays(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
  } catch (error) {
    return [];
  }
}

/**
 * スプレッドシートから案件台帳を取得する。
 * 戻り値の status の意味は public-opportunity-store.js と同じ。
 */
async function fetchRemoteLedger(gasUrl, { postImpl = defaultPost } = {}) {
  if (!gasUrl) return { status: 'disabled', seen: {} };

  let data;
  try {
    data = await postImpl(gasUrl, { type: 'getChibaTenders' });
  } catch (error) {
    console.error(`${LOG_PREFIX} 台帳の取得に失敗しました（通信エラー）: ${error.message}`);
    return { status: 'unavailable', seen: {} };
  }

  const records = Array.isArray(data) ? data : Array.isArray(data?.records) ? data.records : null;
  if (!records) {
    console.error(
      `${LOG_PREFIX} GASが Chiba_Tenders に対応していません（応答: ${JSON.stringify(data).slice(0, 200)}）。` +
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
    `${LOG_PREFIX} スプレッドシートから台帳 ${Object.keys(seen).length}件を取得しました` +
      (skipped ? `（不正な行 ${skipped}件をスキップ）` : '')
  );
  return { status: 'ok', seen };
}

function timestampOf(entry) {
  const value = new Date(
    entry?.last_checked_at || entry?.last_notified_at || entry?.first_notified_at || 0
  ).getTime();
  return Number.isNaN(value) ? 0 : value;
}

/** ローカル台帳とシート台帳を統合する（新しいほうを採用） */
function mergeLedgers(localState, remoteState) {
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
    // リマインド済みの線は「どちらかで出していれば出した」とする（二重送信の防止）
    const reminded = new Set([
      ...(localEntry.reminded_days || []),
      ...(remoteEntry.reminded_days || [])
    ]);

    seen[id] = {
      ...base,
      first_notified_at: firstNotifiedAt || base.first_notified_at || null,
      last_checked_at: checkedAt || null,
      reminded_days: [...reminded].sort((a, b) => b - a)
    };
  }

  return {
    version: 1,
    seen,
    last_run_at: (localState && localState.last_run_at) || null,
    last_result: (localState && localState.last_result) || {}
  };
}

/** state の seen からシート書き込み用レコード配列を作る */
function buildRecords(seen, ids) {
  const targetIds = ids || Object.keys(seen || {});
  return targetIds
    .filter(id => seen && seen[id])
    .map(id => {
      const entry = seen[id];
      return {
        id,
        signature: entry.signature || '',
        source_id: entry.source_id || '',
        organization: entry.organization || '',
        department: entry.department || '',
        title: entry.title || '',
        url: entry.url || '',
        type: entry.type || '',
        deadline: entry.deadline || '',
        budget_upper:
          entry.budget_upper === null || entry.budget_upper === undefined ? '' : entry.budget_upper,
        contract_period: entry.contract_period || '',
        multi_year: entry.multi_year ? 'true' : 'false',
        score: entry.score === null || entry.score === undefined ? '' : entry.score,
        rank: entry.rank || '',
        gate_flags: JSON.stringify(entry.gate_flags || {}),
        status: entry.status || '',
        summary: String(entry.summary || '').slice(0, 500),
        action: String(entry.action || '').slice(0, 300),
        first_notified_at: entry.first_notified_at || '',
        last_notified_at: entry.last_notified_at || '',
        last_checked_at: entry.last_checked_at || '',
        reminded_days: JSON.stringify(entry.reminded_days || [])
      };
    });
}

/** 案件台帳をスプレッドシートへ書き込む（id一致なら更新） */
async function pushRemoteLedger(gasUrl, records, { postImpl = defaultPost } = {}) {
  if (!gasUrl || !Array.isArray(records) || records.length === 0) return false;

  try {
    const response = await postImpl(gasUrl, { type: 'chibaTenders', records });

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
  RECORD_FIELDS,
  fetchRemoteLedger,
  pushRemoteLedger,
  mergeLedgers,
  buildRecords,
  normalizeRecord
};
