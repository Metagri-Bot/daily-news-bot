/**
 * Discordチャンネル投稿ログ用 Google Apps Script
 * ------------------------------------------------------------------
 * 既存の daily-news-bot 用GAS（`.gascode`）とは別プロジェクト・別スプレッドシート。
 * 新規スプレッドシートを作り、拡張機能 > Apps Script にこのファイルを丸ごと貼って
 * 「ウェブアプリ」としてデプロイする（実行ユーザー=自分 / アクセス=全員）。
 *
 * 受け付けるリクエスト:
 *   POST { type:'getChannelLogCursors' }
 *        → { success:true, cursors:{ <channelId>: <lastMessageId> } }
 *   POST { type:'channelLog', records:[ {timestamp,date,messageId,...}, ... ] }
 *        → { success:true, appended:<n>, skipped:<n> }
 *
 * 設計上いちばん大事な点:
 *   Discordのsnowflake（Message ID / User ID / Channel ID）は19桁の数値文字列で、
 *   何もしないとスプレッドシートが数値と解釈して指数表記へ丸める＝IDが壊れる。
 *   そのため該当列は必ず書式「@（プレーンテキスト）」を先に当ててから書き込む。
 */

var SHEET_NAME = 'Discord_Channel_Log';

var HEADERS = [
  'Timestamp',     // JST表示用
  'Date',          // ISO8601（UTC）
  'Message ID',
  'User ID',
  'User Name',
  'Display Name',
  'Content',
  'Channel ID',
  'Channel Name'
];

var FIELD_ORDER = [
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

// 1始まりの列番号。IDが壊れないようテキスト固定にする列
var TEXT_COLUMNS = [2, 3, 4, 8];      // Date / Message ID / User ID / Channel ID
var TIMESTAMP_COLUMN = 1;
var MESSAGE_ID_COLUMN = 3;
var CHANNEL_ID_COLUMN = 8;

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var type = data.type;

    if (type === 'getChannelLogCursors') {
      return jsonResponse_({ success: true, cursors: getChannelLogCursors_() });
    }

    if (type === 'channelLog') {
      var result = appendChannelLogRecords_(data.records || []);
      return jsonResponse_({ success: true, appended: result.appended, skipped: result.skipped });
    }

    return jsonResponse_({ success: false, error: 'unknown type: ' + type });
  } catch (error) {
    Logger.log('[doPost] ' + error.toString());
    return jsonResponse_({ success: false, error: error.toString() });
  }
}

/** ブラウザで開いたときの疎通確認用 */
function doGet(e) {
  var type = e && e.parameter ? e.parameter.type : null;
  if (type === 'cursors') {
    return jsonResponse_({ success: true, cursors: getChannelLogCursors_() });
  }
  var sheet = getLogSheet_();
  return jsonResponse_({ success: true, sheet: SHEET_NAME, rows: Math.max(0, sheet.getLastRow() - 1) });
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/** シートを取得（無ければ作成し、ヘッダーと書式を用意する） */
function getLogSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }

  var maxRows = sheet.getMaxRows();
  for (var i = 0; i < TEXT_COLUMNS.length; i++) {
    sheet.getRange(1, TEXT_COLUMNS[i], maxRows, 1).setNumberFormat('@');
  }
  sheet.getRange(1, TIMESTAMP_COLUMN, maxRows, 1).setNumberFormat('yyyy/MM/dd HH:mm:ss');
  return sheet;
}

/**
 * snowflakeの大小比較。桁数が違えば桁数の大きいほうが新しい。
 * 19桁と18桁が混ざると単純な文字列比較は誤るので、先に長さを見る。
 */
function compareSnowflake_(a, b) {
  var x = String(a || '');
  var y = String(b || '');
  if (x.length !== y.length) return x.length - y.length;
  return x < y ? -1 : (x > y ? 1 : 0);
}

/** チャンネル別の最終Message IDを返す（Botの取得起点になる） */
function getChannelLogCursors_() {
  var sheet = getLogSheet_();
  var lastRow = sheet.getLastRow();
  var cursors = {};
  if (lastRow <= 1) return cursors;

  var values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  for (var i = 0; i < values.length; i++) {
    var messageId = String(values[i][MESSAGE_ID_COLUMN - 1] || '');
    var channelId = String(values[i][CHANNEL_ID_COLUMN - 1] || '');
    if (!messageId || !channelId) continue;
    if (!cursors[channelId] || compareSnowflake_(messageId, cursors[channelId]) > 0) {
      cursors[channelId] = messageId;
    }
  }
  return cursors;
}

/** 記録済みMessage IDの集合（重複排除用） */
function getExistingMessageIds_(sheet) {
  var lastRow = sheet.getLastRow();
  var ids = {};
  if (lastRow <= 1) return ids;
  var values = sheet.getRange(2, MESSAGE_ID_COLUMN, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    var id = String(values[i][0] || '');
    if (id) ids[id] = true;
  }
  return ids;
}

/** 行を追記する。Message IDが既にあればスキップ */
function appendChannelLogRecords_(records) {
  if (!records || records.length === 0) return { appended: 0, skipped: 0 };

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getLogSheet_();
    var existing = getExistingMessageIds_(sheet);
    var rows = [];
    var skipped = 0;

    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      var messageId = String(record.messageId || '');
      if (!messageId || existing[messageId]) { skipped++; continue; }
      existing[messageId] = true;

      var row = [];
      for (var f = 0; f < FIELD_ORDER.length; f++) {
        var value = record[FIELD_ORDER[f]];
        row.push(value === null || value === undefined ? '' : String(value));
      }
      // Timestamp列だけは日付として持たせる（並べ替え・フィルタのため）
      row[TIMESTAMP_COLUMN - 1] = record.date ? new Date(record.date) : row[TIMESTAMP_COLUMN - 1];
      rows.push(row);
    }

    if (rows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
    }
    return { appended: rows.length, skipped: skipped };
  } finally {
    lock.releaseLock();
  }
}

/** 手動テスト用。実行するとダミー1行が入るので、確認後に削除すること */
function testChannelLog() {
  var result = appendChannelLogRecords_([{
    timestamp: '2026/01/01 00:00:00',
    date: '2025-12-31T15:00:00.000Z',
    messageId: '000000000000000001',
    userId: '000000000000000002',
    userName: 'test-user',
    displayName: 'テストユーザー',
    content: 'テスト行です。確認後に削除してください。',
    channelId: '000000000000000003',
    channelName: 'test-channel'
  }]);
  Logger.log(JSON.stringify(result));
  Logger.log(JSON.stringify(getChannelLogCursors_()));
}
