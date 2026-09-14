// 農業AI通信: GAS予約 + Brevo Marketing Campaigns (2026-09-10)
// Script properties: BREVO_API_KEY, BREVO_FOLDER_ID, BREVO_ENABLED=true
// Optional: BREVO_SENDER_EMAIL (default OWNER_EMAIL), BREVO_MAX_RECIPIENTS (default 290)
const BREVO_JOBS_SHEET = 'Brevo配信管理';
const BREVO_TERMINAL = ['SENT', 'CANCELLED', 'FAILED', 'REVIEW', 'SUSPENDED'];

function brevoConfig_() {
  const p = PropertiesService.getScriptProperties();
  const key = p.getProperty('BREVO_API_KEY');
  if (!key) throw new Error('BREVO_API_KEYをスクリプトプロパティに設定してください。');
  return {key: key, folderId: Number(p.getProperty('BREVO_FOLDER_ID')),
    sender: p.getProperty('BREVO_SENDER_EMAIL') || OWNER_EMAIL,
    max: Number(p.getProperty('BREVO_MAX_RECIPIENTS') || 290)};
}

function brevoApi_(method, path, payload) {
  const config = brevoConfig_();
  const options = {method: method, contentType: 'application/json',
    headers: {'api-key': config.key, accept: 'application/json'}, muteHttpExceptions: true};
  if (payload !== undefined) options.payload = JSON.stringify(payload);
  let response;
  try { response = UrlFetchApp.fetch('https://api.brevo.com/v3' + path, options); }
  catch (_) { throw new Error('Brevo通信結果不明。配信管理の状態を確認してください。'); }
  const status = response.getResponseCode();
  // Never log provider bodies: they may contain addresses or credentials.
  if (status < 200 || status >= 300) {
    const error = new Error('Brevo HTTP ' + status + '。Brevo管理画面で認証・残量・配信状態を確認してください。');
    error.httpStatus = status;
    throw error;
  }
  const body = response.getContentText();
  return body ? JSON.parse(body) : {};
}

// Read-only connection check; does not send mail or upload contacts.
function checkBrevoConnection() {
  const config = brevoConfig_();
  brevoApi_('get', '/account');
  const senders = brevoApi_('get', '/senders').senders || [];
  if (!senders.some(s => String(s.email).toLowerCase() === config.sender.toLowerCase() && s.active)) {
    throw new Error('Brevoで送信元 ' + config.sender + ' を認証してください。');
  }
  console.log('Brevo接続・送信者認証OK。メールは送信していません。');
  return true;
}

// Run once after domain authentication / API key setup. No mail is sent.
function setupBrevoIntegration() {
  checkBrevoConnection();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const config = brevoConfig_();
    if (!Number.isInteger(config.folderId) || config.folderId < 1) {
      const folder = brevoApi_('post', '/contacts/folders', {name: '農業AI通信（GAS予約）'});
      if (!folder.id) throw new Error('BrevoフォルダIDを取得できませんでした。');
      SCRIPT_PROPERTIES.setProperty('BREVO_FOLDER_ID', String(folder.id));
    } else { brevoApi_('get', '/contacts/folders/' + config.folderId); }
    brevoJobsSheet_();
    brevoEnsureWorker_();
    SCRIPT_PROPERTIES.setProperty('BREVO_ENABLED', 'true');
    console.log('Brevo予約配信の設定完了。原稿を確認後、B3の日時で予約してください。');
  } finally { lock.releaseLock(); }
}

function brevoRequireEnabled_() {
  const config = brevoConfig_();
  if (SCRIPT_PROPERTIES.getProperty('BREVO_ENABLED') !== 'true' || !Number.isInteger(config.folderId) || config.folderId < 1) {
    throw new Error('Brevo初期設定が未完了です。setupBrevoIntegrationを実行してください。');
  }
  if (!Number.isInteger(config.max) || config.max < 1 || config.max > 1000) {
    throw new Error('BREVO_MAX_RECIPIENTSは1〜1000で設定してください。');
  }
  return config;
}

function brevoJobsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(BREVO_JOBS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(BREVO_JOBS_SHEET);
    sheet.appendRow(['予約ID', '状態', '予約日時', '件名', '記事URL', 'BrevoキャンペーンID',
      '対象数', '詳細', '更新日時', '管理データ（編集不可）', '予約本文（編集不可）', 'X投稿案']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function brevoCell_(value) {
  return typeof value === 'string' && /^[=+\-@]/.test(value) ? "'" + value : value;
}

function brevoSave_(job) {
  const sheet = brevoJobsSheet_();
  const meta = Object.assign({}, job);
  delete meta.html; delete meta.xPost; delete meta.row;
  const json = JSON.stringify(meta);
  if (json.length > 45000 || job.html.length > 45000 || job.xPost.length > 45000) {
    throw new Error('予約データが大きすぎます。本文または配信リストを小さくしてください。');
  }
  if (!job.row) job.row = sheet.getLastRow() + 1;
  sheet.getRange(job.row, 1, 1, 12).setValues([[job.id, job.state, new Date(job.at), job.subject,
    job.url, job.campaignId || '', job.emails.length, job.note || '', new Date(), json, job.html, job.xPost].map(brevoCell_)]);
  // Persist the intent BEFORE external operations (especially sendNow).
  SpreadsheetApp.flush();
}

function brevoJobs_() {
  const sheet = brevoJobsSheet_();
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 12).getValues().map((row, i) => {
    const job = JSON.parse(row[9]);
    job.row = i + 2; job.html = String(row[10]); job.xPost = String(row[11]);
    return job;
  });
}

function brevoEmails_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('配信リスト');
  if (!sheet || sheet.getLastRow() < 2) throw new Error('配信リストが空です。');
  const emails = [...new Set(sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues()
    .flat().map(v => String(v).trim().toLowerCase()).filter(Boolean))];
  if (!emails.length || emails.some(e => !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(e))) {
    throw new Error('配信リストに無効なメールアドレスがあります。');
  }
  return emails;
}

function brevoSnapshot_() {
  const config = brevoRequireEnabled_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('原稿作成');
  const url = aiGuideCanonicalUrl_(sheet.getRange('A2').getValue());
  const subject = String(sheet.getRange('B1').getValue()).trim();
  const html = String(sheet.getRange('B2').getValue());
  if (!url || !subject || !html) throw new Error('記事URL・件名・本文を確認してください。');
  if (SCRIPT_PROPERTIES.getProperty('AI_GUIDE_DRAFT_URL') !== url) {
    throw new Error('記事URLと原稿が一致しません。AIで下書きを作り直してください。');
  }
  const legacy = SCRIPT_PROPERTIES.getProperty('AI_GUIDE_SEND_IN_FLIGHT');
  if (legacy && aiGuideCanonicalUrl_(JSON.parse(legacy).url) === url) {
    throw new Error('この記事はGmailの部分送信が未確認です。別の記事を作成するか、前回配信を確認してください。');
  }
  if (aiGuideArchived_(ss, url)) throw new Error('この記事は既にアーカイブに記録済みです。');
  const emails = brevoEmails_();
  if (emails.length > config.max) throw new Error('対象数がBREVO_MAX_RECIPIENTS（' + config.max + '名）を超えています。契約上限を確認してください。');
  return {url: url, subject: subject, html: html, emails: emails,
    xPost: String(sheet.getRange('B4').getValue()), sender: config.sender,
    senderName: String(ss.getSheetByName('設定').getRange('B2').getValue()) || '農業AI通信 編集部'};
}

function brevoEnsureWorker_() {
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'brevoWorker')) {
    ScriptApp.newTrigger('brevoWorker').timeBased().everyMinutes(5).create();
  }
}

function brevoCancelPending_() {
  brevoJobs_().forEach(job => {
    // Never erase uncertainty about a request already sent to Brevo.
    if (['QUEUED', 'PREPARING', 'READY', 'FAILED'].includes(job.state) && !job.sendAttempted) {
      job.state = 'CANCELLED'; job.note = 'GAS予約をキャンセルしました。'; brevoSave_(job);
    }
  });
  deleteTriggersByHandler_('scheduledBroadcast');
}

function brevoReserve_(when) {
  if (!(when instanceof Date) || !isFinite(when.getTime())) throw new Error('予約日時が不正です。');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let job;
  try {
    const snapshot = brevoSnapshot_();
    if (brevoJobs_().some(j => j.url === snapshot.url && j.state !== 'CANCELLED' &&
        (j.sendAttempted || ['SENT', 'REVIEW', 'SUSPENDED', 'CREATING'].includes(j.state)))) {
      throw new Error('この記事の配信記録が既にあります。Brevo配信管理で確認してください。');
    }
    job = Object.assign(snapshot, {id: Utilities.getUuid(), at: when.toISOString(), state: 'QUEUED', cursor: 0});
    // Validate size before cancelling the previous reservation.
    if (JSON.stringify(job).length > 43000) throw new Error('原稿・配信リストの合計サイズが大きすぎます。');
    brevoEnsureWorker_();
    brevoCancelPending_();
    brevoSave_(job);
    ScriptApp.newTrigger('scheduledBroadcast').timeBased().at(new Date(Math.max(Date.now() + 60000, when.getTime()))).create();
  } finally { lock.releaseLock(); }
  // Preparation only. Dispatch is performed by the timer after the due time.
  brevoWorker(true);
  return job.id;
}

function brevoWorker(prepareOnly) {
  if (SCRIPT_PROPERTIES.getProperty('BREVO_ENABLED') !== 'true') return;
  // Timer event objects must NOT be treated as prepareOnly=true.
  prepareOnly = prepareOnly === true;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  const deadline = Date.now() + 180000;
  try {
    brevoRequireEnabled_();
    for (const job of brevoJobs_()) {
      if (Date.now() > deadline) break;
      if (BREVO_TERMINAL.includes(job.state)) continue;
      try { brevoStep_(job, deadline, prepareOnly); }
      catch (error) {
        job.note = error.message;
        if (['SENDING', 'ACCEPTED'].includes(job.state)) {
          // Keep polling a known campaign. Do not issue another send request.
        } else if (job.state === 'CREATING') { job.state = 'REVIEW'; }
        else { job.state = 'FAILED'; }
        brevoSave_(job);
        console.error('Brevo予約 ' + job.id + ': ' + error.message);
      }
    }
  } finally { lock.releaseLock(); }
}

function brevoStep_(job, deadline, prepareOnly) {
  if (['SENDING', 'ACCEPTED'].includes(job.state)) { brevoReconcile_(job); return; }
  if (job.state === 'CREATING') {
    job.state = 'REVIEW'; job.note = 'キャンペーン作成結果が不明です。Brevoで予約IDを検索してください。';
    brevoSave_(job); return;
  }
  if (!job.listId) {
    const list = brevoApi_('post', '/contacts/lists', {name: 'AI Guide ' + job.id, folderId: brevoConfig_().folderId});
    if (!list.id) throw new Error('リストIDを取得できませんでした。');
    job.listId = list.id; job.state = 'PREPARING'; brevoSave_(job);
  }
  const current = new Set(brevoEmails_());
  while (job.cursor < job.emails.length && Date.now() < deadline - 15000) {
    const email = job.emails[job.cursor];
    if (current.has(email)) {
      // Omit emailBlacklisted: never explicitly re-subscribe blocked contacts.
      brevoApi_('post', '/contacts', {email: email, listIds: [job.listId], updateEnabled: true});
      Utilities.sleep(120);
    }
    job.cursor++;
    if (job.cursor % 10 === 0) brevoSave_(job);
  }
  if (job.cursor < job.emails.length) { brevoSave_(job); return; }
  job.state = 'READY'; job.note = '原稿・読者の準備完了。予約時刻を待っています。'; brevoSave_(job);
  if (prepareOnly || Date.now() < new Date(job.at).getTime() || Date.now() > deadline - 15000) return;
  // A form unsubscribe or manual list deletion since preparation must take effect.
  const remaining = new Set(brevoEmails_());
  const removed = job.emails.filter(e => !remaining.has(e));
  for (let i = 0; i < removed.length; i += 100) {
    brevoApi_('post', '/contacts/lists/' + job.listId + '/contacts/remove', {emails: removed.slice(i, i + 100)});
  }
  if (!job.emails.some(e => remaining.has(e))) throw new Error('予約対象者が全員配信リストから外れています。');
  job.state = 'CREATING'; brevoSave_(job);
  const campaign = brevoApi_('post', '/emailCampaigns', {
    name: '農業AI通信 ' + job.id, type: 'classic', subject: job.subject,
    sender: {email: job.sender, name: job.senderName}, replyTo: OWNER_EMAIL,
    htmlContent: brevoHtml_(job.html), recipients: {listIds: [job.listId]}
  });
  if (!campaign.id) throw new Error('キャンペーンIDが取得できませんでした。');
  job.campaignId = campaign.id;
  job.state = 'SENDING'; job.sendAttempted = true;
  job.note = 'Brevoへ配信要求中。結果不明時は自動再送しません。'; brevoSave_(job);
  try {
    brevoApi_('post', '/emailCampaigns/' + job.campaignId + '/sendNow');
    job.state = 'ACCEPTED'; job.note = 'Brevo受付済み。配信完了を確認中です。';
  } catch (error) {
    // Even explicit API rejections are left for review; there is no blind retry.
    job.note = error.message + ' キャンペーンID=' + job.campaignId;
  }
  brevoSave_(job);
}

function brevoHtml_(html) {
  if (!html.includes('{{ unsubscribe }}')) {
    html += '<p><a href="{{ unsubscribe }}">農業AI通信の配信停止</a></p>';
  }
  return html;
}

function brevoReconcile_(job) {
  const campaign = brevoApi_('get', '/emailCampaigns/' + job.campaignId);
  if (campaign.status === 'sent') {
    const stats = (campaign.statistics || {}).globalStats || {};
    job.sentCount = typeof stats.sent === 'number' ? stats.sent : '';
    job.deliveredCount = typeof stats.delivered === 'number' ? stats.delivered : '';
    // Archive before marking SENT; the archive write itself is idempotent.
    brevoArchive_(job);
    job.state = 'SENT'; job.note = 'Brevo配信処理完了。到達状況はBrevoで確認してください。';
  } else if (campaign.status === 'suspended') {
    job.state = 'SUSPENDED'; job.note = 'Brevoで配信停止中。残量・審査・停止理由を確認してください。';
  } else {
    job.note = 'Brevo状態: ' + campaign.status + '。自動再送はしません。';
  }
  brevoSave_(job);
}

function brevoArchive_(job) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('アーカイブ');
  if (!sheet) sheet = ss.insertSheet('アーカイブ');
  if (sheet.getLastRow() === 0) sheet.appendRow(['送信日時', '件名', '記事URL', '配信数', 'メルマガ本文', 'X投稿案']);
  sheet.getRange(1, 7).setValue('BrevoキャンペーンID');
  if (sheet.getLastRow() > 1 && sheet.getRange(2, 7, sheet.getLastRow() - 1, 1).getValues()
    .some(r => String(r[0]) === String(job.campaignId))) return;
  sheet.appendRow([new Date(), job.subject, job.url, job.sentCount, job.html, job.xPost, job.campaignId].map(brevoCell_));
  SpreadsheetApp.flush();
}

// Menu command: read-only provider checks, never sendNow.
function refreshBrevoStatus() {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    brevoJobs_().filter(j => j.campaignId && j.state !== 'CANCELLED').forEach(brevoReconcile_);
  } finally { lock.releaseLock(); }
  SpreadsheetApp.getUi().alert('Brevo配信管理シートを更新しました。');
}

function brevoSendTest_(subject, html, senderName) {
  const config = brevoRequireEnabled_();
  brevoApi_('post', '/smtp/email', {sender: {email: config.sender, name: senderName},
    to: [{email: OWNER_EMAIL}], replyTo: {email: OWNER_EMAIL},
    subject: '【テスト確認】' + subject, htmlContent: html});
}
