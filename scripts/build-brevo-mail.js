const fs = require('node:fs');
// A function ends at an unindented closing brace in this GAS source.
function replaceFunction(source, name, body) {
  const re = new RegExp('^function ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?^\\}', 'm');
  if (!re.test(source)) throw new Error('Missing function: ' + name);
  return source.replace(re, () => body);
}
function migrate(source) {
  let s = source.replace(/\r\n/g, '\n');
  s = s.replace("    .addToUi();", "    .addItem('5. Brevo接続確認（送信なし）', 'checkBrevoConnection')\n    .addItem('6. Brevo配信状況を更新', 'refreshBrevoStatus')\n    .addToUi();");
  s = replaceFunction(s, 'setAutomaticSchedule', `function setAutomaticSchedule() {
  const when = getTodayAtJst_(15, 0);
  if (when <= new Date()) throw new Error('本日15時を過ぎています。B3に未来の日時を設定してください。');
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName('原稿作成').getRange('B3').setValue(when);
  brevoReserve_(when);
  console.log('Brevo配信を本日15時に予約しました。');
}`);
  s = replaceFunction(s, 'setSchedule', `function setSchedule() {
  const when = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('原稿作成').getRange('B3').getValue();
  if (!(when instanceof Date) || !isFinite(when.getTime()) || when <= new Date()) {
    throw new Error('B3セルに未来の予約日時を入力してください。');
  }
  const id = brevoReserve_(when);
  SpreadsheetApp.getUi().alert('Brevo予約を保存しました。\\n予約ID: ' + id + '\\n予約時点の原稿を配信します。修正後は再予約してください。');
}`);
  s = replaceFunction(s, 'cancelSchedule', `function cancelSchedule(isSilent = false) {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try { brevoCancelPending_(); } finally { lock.releaseLock(); }
  if (!isSilent) SpreadsheetApp.getUi().alert('GASの未送信予約をキャンセルしました。Brevo受付済みの配信はBrevo管理画面で確認してください。');
}`);
  s = replaceFunction(s, 'scheduledBroadcast', `function scheduledBroadcast() {
  brevoWorker();
}`);
  s = replaceFunction(s, 'executeBroadcastCore_', `function executeBroadcastCore_(isAuto = false) {
  // Old Gmail batch delivery has been replaced; no automatic Gmail fallback.
  if (isAuto) { brevoWorker(); return; }
  const id = brevoReserve_(new Date());
  SpreadsheetApp.getUi().alert('Brevo配信を受け付けました。準備後にトリガーで配信します。\\n予約ID: ' + id);
}`);
  s = replaceFunction(s, 'sendManualTest', `function sendManualTest(isFromAI = false, isAuto = false) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('原稿作成');
  const subject = String(sheet.getRange('B1').getValue());
  const html = String(sheet.getRange('B2').getValue());
  if (!subject || !html) throw new Error('件名または本文が空です。');
  const senderName = String(ss.getSheetByName('設定').getRange('B2').getValue()) || '農業AI通信 編集部';
  try {
    brevoSendTest_(subject, '※下書き確認用です。<br>修正リンク: <a href="' + ss.getUrl() + '">スプレッドシート</a><br><br>' + html, senderName);
    if (!isAuto) SpreadsheetApp.getUi().alert('現在の原稿をBrevo経由で自分宛てにテスト送信しました。');
    return true;
  } catch (e) {
    if (isAuto) throw e;
    SpreadsheetApp.getUi().alert('下書きは保存済みですが、テスト送信できませんでした。\\n' + e.message);
    return false;
  }
}`);
  // Production has wrappers; the repository's reconciled base needs them appended.
  if (!s.includes('function aiGuideCanonicalUrl_(')) {
    s += `
function aiGuideCanonicalUrl_(raw) {
  const base = String(raw || '').trim().split(/[?#]/)[0];
  return /^https:\\/\\/metagri-labo\\.com\\/ai-guide\\/[^/]+\\/?$/.test(base) ? base.replace(/\\/?$/, '/') : '';
}

function aiGuideArchived_(ss, url) {
  const sheet = ss.getSheetByName('アーカイブ');
  return !!(url && sheet && sheet.getLastRow() > 1 && sheet.getRange(2, 3, sheet.getLastRow() - 1, 1).getValues().some(row => aiGuideCanonicalUrl_(row[0]) === url));
}

function generateDraftAndTest(isAuto = false, options = {}) {
}

function executeBroadcast(isAuto = false) {
}
`;
  }
  s = replaceFunction(s, 'generateDraftAndTest', `function generateDraftAndTest(isAuto = false, options = {}) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const url = aiGuideCanonicalUrl_(ss.getSheetByName('原稿作成').getRange('A2').getValue());
  if (isAuto && (!url || aiGuideArchived_(ss, url) || brevoJobs_().some(j => j.url === url && j.state !== 'CANCELLED'))) {
    console.log('AI Guide: archived/reserved article; draft/test skipped.');
    return;
  }
  return generateDraftAndTestCore_(isAuto, options);
}`);
  s = replaceFunction(s, 'executeBroadcast', `function executeBroadcast(isAuto = false) {
  return executeBroadcastCore_(isAuto);
}`);
  // Surface automated draft errors as failed executions, instead of silent success.
  s = s.replace("if (isAuto) console.error('エラー発生：' + e.toString());", "if (isAuto) throw e;");
  return s;
}
if (require.main === module) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/build-brevo-mail.js <production-auto-mail.gs> [output.gs]');
  fs.writeFileSync(process.argv[3] || 'auto-mail.gs', migrate(fs.readFileSync(process.argv[2], 'utf8')));
}
module.exports = {migrate, replaceFunction};
