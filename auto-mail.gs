// === 環境設定 ===
const SCRIPT_PROPERTIES = PropertiesService.getScriptProperties();
const OPENAI_API_KEY = SCRIPT_PROPERTIES.getProperty('OPENAI_API_KEY');
const OPENAI_API_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

// === 【設定】メールアドレス ===
const OWNER_EMAIL = 'yuichiro.kai@noujoujin.com';
const AUTOMATION_TIMEZONE = 'Asia/Tokyo';

// === 【設定】配信停止フォームのURL ===
const UNSUBSCRIBE_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSfgeAKfmm5BZI7_jvb9ScygOQlQ6CUT0QqbaNxf4lNGQJrBjg/viewform';

// === 【設定】学習データ（X投稿例）のシート名 ===
const SHEET_NAME_X_EXAMPLES = 'X投稿例';

const SHEET_NAME_CATALOG = 'ContentCatalog'; // カタログ用シート名

// === 【設定】冒頭の挨拶 ===
const GREETING = `こんにちは、農業AI通信の編集部です。<br>
農業AI通信の新たな記事の更新のお知らせです！`;

// === 【設定】署名 ===
const SIGNATURE = `
<br>--------------------------------------------------<br>
農業AI通信 編集部<br>
<a href="https://metagri-labo.com/ai-guide">https://metagri-labo.com/ai-guide</a><br>
<br>
運営：Metagri研究所（株式会社農情人）<br>
--------------------------------------------------<br>
`;

/**
 * メニューを追加
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('メルマガAIシステム')
    .addItem('1. AIで下書き作成 & テスト送信', 'generateDraftAndTest')
    .addSeparator()
    .addItem('1.5. 修正後にテスト送信（自分のみ）', 'sendManualTest')
    .addItem('2. 読者へ一斉配信（本番）', 'broadcastEmail')
    .addItem('3. 送信予約を設定する', 'setSchedule')
    .addItem('4. 予約をキャンセルする', 'cancelSchedule')
    .addItem('5. Brevo接続確認（送信なし）', 'checkBrevoConnection')
    .addItem('6. Brevo配信状況を更新', 'refreshBrevoStatus')
    .addToUi();
}

/**
 * 定期実行用の関数（月・水・金 10:00〜10:59 JSTにこれを呼ぶ）
 */
function scheduledDailyDraft() {
  if (!isMondayWednesdayFridayTestDraftWindow_()) {
    console.log('scheduledDailyDraft skipped: outside Mon/Wed/Fri 10:00-10:59 JST window.');
    return;
  }

  console.log("定期実行：下書き作成を開始します。");
  generateDraftAndTest(true);
}

/**
 * 1. AIで下書きを作り（メルマガ＆X＆カタログ）、自分にテスト送信する機能
 */
function isMondayWednesdayFridayTestDraftWindow_() {
  const now = new Date();
  const dayOfWeek = Number(Utilities.formatDate(now, AUTOMATION_TIMEZONE, 'u')); // Mon=1, Sun=7
  const hour = Number(Utilities.formatDate(now, AUTOMATION_TIMEZONE, 'H'));
  return [1, 3, 5].includes(dayOfWeek) && hour === 10;
}

function setupWeekdayTestDraftTrigger() {
  deleteTriggersByHandler_('scheduledDailyDraft');

  const weekdays = [
    ScriptApp.WeekDay.MONDAY,
    ScriptApp.WeekDay.WEDNESDAY,
    ScriptApp.WeekDay.FRIDAY
  ];

  weekdays.forEach(function(weekday) {
    ScriptApp.newTrigger('scheduledDailyDraft')
      .timeBased()
      .onWeekDay(weekday)
      .atHour(10)
      .nearMinute(30)
      .inTimezone(AUTOMATION_TIMEZONE)
      .create();
  });

  console.log('Test draft triggers created: Mon/Wed/Fri, 10:00-11:00 JST.');
}

function deleteTriggersByHandler_(handlerName) {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === handlerName) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function generateDraftAndTestCore_(isAuto = false, options = {}) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const draftSheet = ss.getSheetByName('原稿作成');
  const ui = isAuto ? null : SpreadsheetApp.getUi();

  if (!OPENAI_API_KEY) {
    if (isAuto) console.error('エラー：APIキー未設定');
    else ui.alert('エラー：スクリプトプロパティに「OPENAI_API_KEY」が設定されていません。');
    return;
  }

  const articleText = draftSheet.getRange('A1').getValue();
  const articleUrl = draftSheet.getRange('A2').getValue(); 

  if (!articleText) {
    if (isAuto) console.error('エラー：A1が空です');
    else ui.alert('エラー：「原稿作成」シートのA1セルに、記事の本文を入力してください。');
    return;
  }

  const xExamples = getXPostExamples();

  // AIプロンプト（カタログ用の指示を追加）
  const prompt = `
  あなたは「農業AI通信」というメディアの熟練編集者兼、SNSマーケターです。
  以下の記事本文を読み、「メルマガ原稿」「X投稿案」、および「コンテンツカタログ用メタデータ」を作成してください。

  # 記事URL: ${articleUrl}
  # 記事本文: ${articleText}
  # X投稿用学習データ: ${xExamples}
  # X投稿のルール（重要）
  ・文字数は「140文字以内」を厳守すること。
  ・末尾には必ず「記事は固定ポストから👇 @Metagrilabo」と記載すること。
  ・学習データの文体を模倣しつつ、結論から刺さる文章にすること。
  ・X投稿時にそのまま使える、改行も入れること。

  # 出力フォーマット（JSON形式）
  {
    "subject": "件名",
    "intro": "核心を突く1文",
    "summary": "2行程度の要約",
    "appeal": "読者が得られるメリット",
    "x_post": "140文字以内のポスト本文",
    "catalog": {
      "category": "[インタビュー・事例, 開発・実装, 経理・確定申告, 収益化・ビジネス, ツール・使い方, テンプレート, 全体像・入門, 画像AI・制作, 販売・販促, 画像AI・診断]から1つ",
      "target_types": "[builder, ai_explorer, practical_operator, efficiency_starter, growth_oriented]から1〜2つ（カンマ区切り）",
      "tags": "3〜4つのキーワード（英語小文字、カンマ区切り）",
      "priority": 1〜10の数値,
      "read_time": 読了目安時間（分）の数値,
      "reason_template": "推薦文（〜を学べる/把握できる〜ガイドです、の形式で）"
    }
  }

  ※連載シリーズや農家インタビューの場合は、回数や農家情報（氏名・地域・作物等）を各項目に必ず含めること。
  `;

  try {
    const response = UrlFetchApp.fetch(OPENAI_API_ENDPOINT, {
      method: 'post',
      headers: {
        'Authorization': 'Bearer ' + OPENAI_API_KEY,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({
        model: 'gpt-5.1', // モデル
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: "json_object" }
      })
    });

    const json = JSON.parse(response.getContentText());
    const content = JSON.parse(json.choices[0].message.content);

    // メルマガ用URL
    const trackedUrl = addTrackingParams(articleUrl);

    // メルマガ本文組み立て
    const aiBody = content.intro + '<br><br>' + 
               content.summary + '<br><br>' + 
               content.appeal + `<br><br>記事は<a href="${trackedUrl}">こちら</a>から`;

    let footer = SIGNATURE;
    if (UNSUBSCRIBE_URL && UNSUBSCRIBE_URL.startsWith('http')) {
      footer += `<br>配信停止は<a href="${UNSUBSCRIBE_URL}">こちら</a>から`;
    }

    const fullHtmlBody = GREETING + '<br>' + aiBody + '<br>' + footer;

    // スプレッドシートに書き込み（原稿作成シート）
    draftSheet.getRange('B1').setValue(content.subject);
    draftSheet.getRange('B2').setValue(fullHtmlBody);
    draftSheet.getRange('B4').setValue(content.x_post).setWrap(true);
    SCRIPT_PROPERTIES.setProperty('AI_GUIDE_DRAFT_URL', aiGuideCanonicalUrl_(articleUrl));

    // ★新規：コンテンツカタログに自動追加
    updateContentCatalog(content.catalog, content.subject, articleUrl);

    // テストメール送信
    const testSent = sendManualTest(true, isAuto);

    // ★追加：自動実行時はテスト送信後に当日15時の配信予約を自動セット
    if (isAuto && testSent && !options.skipAutomaticSchedule) {
      setAutomaticSchedule();
    }

  } catch (e) {
    if (isAuto) throw e;
    else ui.alert('エラーが発生しました：\n' + e.toString());
  }
}

/**
 * 自動実行用：テストメール作成後、当日15時の配信予約をセットする
 */
function setAutomaticSchedule() {
  const when = getTodayAtJst_(15, 0);
  if (when <= new Date()) throw new Error('本日15時を過ぎています。B3に未来の日時を設定してください。');
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName('原稿作成').getRange('B3').setValue(when);
  brevoReserve_(when);
  console.log('Brevo配信を本日15時に予約しました。');
}

function getTodayAtJst_(hour, minute) {
  const dateStr = Utilities.formatDate(new Date(), AUTOMATION_TIMEZONE, 'yyyy/MM/dd');
  const timeStr = ('0' + hour).slice(-2) + ':' + ('0' + minute).slice(-2);
  return Utilities.parseDate(dateStr + ' ' + timeStr, AUTOMATION_TIMEZONE, 'yyyy/MM/dd HH:mm');
}


/**
 * ★新規：コンテンツカタログシートの更新
 */
function updateContentCatalog(cat, title, url) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME_CATALOG);
  
  // シートがない場合は作成
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME_CATALOG);
    sheet.appendRow(['content_id', 'title', 'url', 'content_type', 'category', 'target_types', 'tags', 'priority', 'read_time', 'reason_template']);
    sheet.getRange(1, 1, 1, 10).setBackground('#eeeeee').setFontWeight('bold');
  }

  const lastRow = sheet.getLastRow();
  const cleanUrl = url.split('?utm')[0];

  // URLによる重複チェック
  if (lastRow > 1) {
    const existingUrls = sheet.getRange(2, 3, lastRow - 1, 1).getValues().flat();
    if (existingUrls.includes(cleanUrl)) {
      console.log('カタログ：既に登録済みのURLのため追加をスキップしました。');
      return;
    }
  }

  // content_id の自動採番
  let nextId = 'c072';
  if (lastRow > 1) {
    const lastId = sheet.getRange(lastRow, 1).getValue().toString();
    const lastNum = parseInt(lastId.replace('c', ''), 10);
    if (!isNaN(lastNum)) {
      nextId = 'c' + ('000' + (lastNum + 1)).slice(-3);
    }
  }

  // 行の追加
  sheet.appendRow([
    nextId,
    title,
    cleanUrl,
    'article',
    cat.category,
    cat.target_types,
    cat.tags,
    cat.priority,
    cat.read_time,
    cat.reason_template
  ]);
  
  console.log(`カタログ追加完了: ${nextId}`);
}

/**
 * 学習用データ（X投稿例）をシートから読み込む関数
 */
function getXPostExamples() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_X_EXAMPLES);
  
  if (!sheet) return ""; // シートがない場合は空文字を返す

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return ""; // データがない場合

  // A列（内容）、B列（分類）を取得
  const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  
  // AIに渡しやすいテキスト形式に整形
  // 例：
  // 分類：画像生成
  // ポスト内容：(本文)...
  const examplesText = data.map(row => {
    const postContent = row[0]; // A列
    const category = row[1];    // B列
    if (!postContent) return "";
    return `【参考例】\n分類: ${category}\nポスト内容: ${postContent}`;
  }).join("\n\n");

  return examplesText;
}

/**
 * 1.5. 修正後にテスト送信する機能
 * 修正後にテスト送信する機能
 * @param {boolean} isFromAI AI作成直後か
 * @param {boolean} isAuto 自動実行かどうか
 */
function sendManualTest(isFromAI = false, isAuto = false) {
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
    SpreadsheetApp.getUi().alert('下書きは保存済みですが、テスト送信できませんでした。\n' + e.message);
    return false;
  }
}
/**
 * 2. 読者へ一斉配信
 */
function broadcastEmail() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert('⚠️ 即時配信の確認', '今すぐ読者へ一斉送信しますか？', ui.ButtonSet.YES_NO);
  if (response !== ui.Button.YES) return;
  executeBroadcast();
}

/**
 * 3. 送信予約を設定
 */
function setSchedule() {
  const when = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('原稿作成').getRange('B3').getValue();
  if (!(when instanceof Date) || !isFinite(when.getTime()) || when <= new Date()) {
    throw new Error('B3セルに未来の予約日時を入力してください。');
  }
  const id = brevoReserve_(when);
  SpreadsheetApp.getUi().alert('Brevo予約を保存しました。\n予約ID: ' + id + '\n予約時点の原稿を配信します。修正後は再予約してください。');
}

/**
 * 4. 予約キャンセル
 */
function cancelSchedule(isSilent = false) {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try { brevoCancelPending_(); } finally { lock.releaseLock(); }
  if (!isSilent) SpreadsheetApp.getUi().alert('GASの未送信予約をキャンセルしました。Brevo受付済みの配信はBrevo管理画面で確認してください。');
}

function scheduledBroadcast() {
  brevoWorker();
}

/**
 * 共通の送信処理 ＋ アーカイブ保存（X投稿対応版）
 */
function executeBroadcastCore_(isAuto = false) {
  // Old Gmail batch delivery has been replaced; no automatic Gmail fallback.
  if (isAuto) { brevoWorker(); return; }
  const id = brevoReserve_(new Date());
  SpreadsheetApp.getUi().alert('Brevo配信を受け付けました。準備後にトリガーで配信します。\n予約ID: ' + id);
}

/**
 * アーカイブ保存（X投稿対応版）
 */
function saveToArchive(subject, htmlBody, articleUrl, recipientCount, xPost) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let archiveSheet = ss.getSheetByName('アーカイブ');
  
  // シートがなければ作成（ヘッダーにX投稿案を追加）
  if (!archiveSheet) {
    archiveSheet = ss.insertSheet('アーカイブ');
    archiveSheet.appendRow(['送信日時', '件名', '記事URL', '配信数', 'メルマガ本文', 'X投稿案']);
    archiveSheet.getRange(1, 1, 1, 6).setBackground('#eeeeee').setFontWeight('bold');
  }

  // もし既存のシートにX投稿案のヘッダーがなければ、1行目を上書きして項目追加（メンテナンス用）
  if (archiveSheet.getLastColumn() < 6) {
    archiveSheet.getRange(1, 5, 1, 2).setValues([['メルマガ本文', 'X投稿案']]);
  }

  archiveSheet.appendRow([
    new Date(), 
    subject, 
    articleUrl, 
    recipientCount, 
    htmlBody,
    xPost // ★追加
  ]);
}

function autoDeleteSubscriber(e) {
  if (!e || !e.namedValues) return;
  const targetEmail = e.namedValues['メールアドレス'] ? e.namedValues['メールアドレス'][0] : null;
  if (!targetEmail) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const listSheet = ss.getSheetByName('配信リスト');
  const data = listSheet.getDataRange().getValues();

  for (let i = data.length - 1; i >= 1; i--) { 
    if (data[i][0] === targetEmail) listSheet.deleteRow(i + 1);
  }
    // 2026-09-16: WordPress会員としてBrevoの会員用リストにも居る場合に備え、Brevo側でも配信停止にする
  if (typeof brevoBlockEmail_ === 'function') brevoBlockEmail_(targetEmail);
}


/**
 * URLにGA4追跡用のUTMパラメータを付与する（日付は当日を設定）
 */
function addTrackingParams(url) {
  if (!url || !url.startsWith('http')) return url;

  // 1. 「当日」の日付を取得
  const now = new Date();
  const dateStr = Utilities.formatDate(now, AUTOMATION_TIMEZONE, "yyyyMMdd");

  // 2. ドメイン名を抽出 (例: metagri-labo.com)
  let domain = "unknown";
  try {
    domain = url.split('/')[2];
  } catch (e) {
    console.error("ドメイン抽出エラー: " + e.message);
  }

  // 3. パラメータの組み立て
  const utmSource = "newsletter";
  const utmMedium = "email";
  const utmCampaign = "ai_guide_" + dateStr; // 例: ai_guide_20250131
  const utmContent = url.split(/[?#]/)[0].split('/').filter(String).pop() || domain; // 記事単位で識別

  return addOrReplaceQueryParams_(url, {
    utm_source: utmSource,
    utm_medium: utmMedium,
    utm_campaign: utmCampaign,
    utm_content: utmContent
  });
}

function addOrReplaceQueryParams_(url, params) {
  const hashIndex = url.indexOf('#');
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex);
  const urlWithoutHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const queryIndex = urlWithoutHash.indexOf('?');
  const baseUrl = queryIndex === -1 ? urlWithoutHash : urlWithoutHash.slice(0, queryIndex);
  const existingQuery = queryIndex === -1 ? '' : urlWithoutHash.slice(queryIndex + 1);
  const replaceKeys = Object.keys(params);

  const queryParts = existingQuery
    ? existingQuery.split('&').filter(function(part) {
        const key = decodeURIComponent(part.split('=')[0] || '');
        return replaceKeys.indexOf(key) === -1;
      })
    : [];

  replaceKeys.forEach(function(key) {
    queryParts.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
  });

  return baseUrl + '?' + queryParts.join('&') + hash;
}

// RSS配信の重複・原稿取り違え防止（2026-09-09）
function aiGuideCanonicalUrl_(raw) {
  const base = String(raw || '').trim().split(/[?#]/)[0];
  return /^https:\/\/metagri-labo\.com\/ai-guide\/[^/]+\/?$/.test(base) ? base.replace(/\/?$/, '/') : '';
}

function aiGuideArchived_(ss, url) {
  const sheet = ss.getSheetByName('アーカイブ');
  return !!(url && sheet && sheet.getLastRow() > 1 && sheet.getRange(2, 3, sheet.getLastRow() - 1, 1).getValues().some(row => aiGuideCanonicalUrl_(row[0]) === url));
}

function generateDraftAndTest(isAuto = false, options = {}) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const url = aiGuideCanonicalUrl_(ss.getSheetByName('原稿作成').getRange('A2').getValue());
  if (isAuto && (!url || aiGuideArchived_(ss, url) || brevoJobs_().some(j => j.url === url && j.state !== 'CANCELLED'))) {
    console.log('AI Guide: archived/reserved article; draft/test skipped.');
    return;
  }
  return generateDraftAndTestCore_(isAuto, options);
}

function executeBroadcast(isAuto = false) {
  return executeBroadcastCore_(isAuto);
}

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
  // 宛先 = シート「配信リスト」（フォーム登録者）＋ Brevoの会員用リスト（WordPress無料会員の希望者）
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('配信リスト');
  const sheetEmails = sheet && sheet.getLastRow() >= 2
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat().map(v => String(v).trim().toLowerCase()).filter(Boolean)
    : [];
  if (sheetEmails.some(e => !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(e))) {
    throw new Error('配信リストに無効なメールアドレスがあります。');
  }
  const emails = [...new Set(sheetEmails.concat(brevoMemberEmails_()))];
  if (!emails.length) throw new Error('配信リストが空です。');
  return emails;
}

// WordPress会員リストの連絡先（配信停止・退会の人も含む）。取得に失敗したら例外で止める。
function brevoMemberContacts_() {
  const listId = Number(PropertiesService.getScriptProperties().getProperty('BREVO_MEMBER_LIST_ID'));
  if (!Number.isInteger(listId) || listId < 1) return [];
  const out = [];
  for (let offset = 0; offset < 50000; offset += 500) {
    const contacts = brevoApi_('get', '/contacts/lists/' + listId + '/contacts?limit=500&offset=' + offset).contacts || [];
    contacts.forEach(c => {
      const email = String(c.email || '').trim().toLowerCase();
      if (!email || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email)) return;
      const unsubscribed = (c.listUnsubscribed || []).map(Number).includes(listId);
      const wpStatus = String((c.attributes || {}).WP_MEMBER_STATUS || '').trim();
      const active = !c.emailBlacklisted && !unsubscribed;
      // 状態の優先順位：WordPressが記録した状態（退会申請など）＞Brevo上の配信可否
      const status = !active && (!wpStatus || wpStatus === '配信中') ? '配信停止' : (wpStatus || '配信中');
      const reason = active ? '' : String((c.attributes || {}).WP_WITHDRAW_REASON || '').trim();
      out.push({email: email, active: active, status: active ? '配信中' : status, created: c.createdAt || '', reason: reason});
    });
    if (contacts.length < 500) break;
  }
  return out;
}

// WordPress会員の希望者＝配信対象だけ。配信停止（emailBlacklisted）とリスト解除済みは含めない。
function brevoMemberEmails_() {
  return brevoMemberContacts_().filter(c => c.active).map(c => c.email);
}

// ---- WordPress会員をシートで管理する（2026-09-16 追加・6時間ごと）----
// 正はBrevoの会員用リスト。シート「会員（WordPress）」は台帳で、行は消さずに状態を上書きする（物理削除しない）。
//   状態：配信中／配信停止／退会申請／退会（削除）／リスト外（Brevoのリストから消えた）
//   配信対象：TRUE のときだけ配信される（判定は配信のたびにBrevoから直接読む。シートを手で書き換えても配信は変わらない）
//   退会理由：配信対象が FALSE の会員だけ、WordPressの退会申請で書かれた理由を入れる（配信中に戻ったら空にする）
const BREVO_MEMBER_SHEET = '会員（WordPress）';
const BREVO_MEMBER_HEADER = ['メール', '状態', '配信対象', '初回登録', '状態変更', '最終同期', '退会理由'];

function syncWpMembersToSheet() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    const listId = Number(PropertiesService.getScriptProperties().getProperty('BREVO_MEMBER_LIST_ID'));
    if (!Number.isInteger(listId) || listId < 1) { console.log('BREVO_MEMBER_LIST_ID未設定のため会員同期をスキップ'); return; }
    const contacts = brevoMemberContacts_();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(BREVO_MEMBER_SHEET) || ss.insertSheet(BREVO_MEMBER_SHEET);
    const now = new Date();
    const width = BREVO_MEMBER_HEADER.length;
    sheet.getRange(1, 1, 1, width).setValues([BREVO_MEMBER_HEADER]);
    sheet.setFrozenRows(1);
    const last = sheet.getLastRow();
    const rows = last > 1 ? sheet.getRange(2, 1, last - 1, width).getValues() : [];
    const index = {};
    rows.forEach((r, i) => {
      const email = String(r[0] || '').trim().toLowerCase();
      if (!email) return;
      // 旧形式（メール／連携元／最終同期）の行は、状態を空にして読み替える
      if (r[1] === 'WordPress会員') { r[1] = ''; r[2] = ''; r[5] = r[5] || ''; }
      index[email] = i;
    });
    const seen = {};
    contacts.forEach(c => {
      seen[c.email] = true;
      if (index[c.email] === undefined) {
        rows.push([c.email, c.status, c.active, c.created ? new Date(c.created) : now, now, now, c.reason]);
        index[c.email] = rows.length - 1;
        return;
      }
      const r = rows[index[c.email]];
      if (r[1] !== c.status || r[2] !== c.active) { r[1] = c.status; r[2] = c.active; r[4] = now; }
      if (!r[3]) r[3] = c.created ? new Date(c.created) : now;
      r[5] = now;
      r[6] = c.active ? '' : (c.reason || r[6] || '');
    });
    // Brevoのリストから消えた会員も行は残し、状態だけ「リスト外」にする
    Object.keys(index).forEach(email => {
      if (seen[email]) return;
      const r = rows[index[email]];
      if (r[1] !== 'リスト外' || r[2] !== false) { r[1] = 'リスト外'; r[2] = false; r[4] = now; }
      r[5] = now;
    });
    if (rows.length) sheet.getRange(2, 1, rows.length, width).setValues(rows);
    console.log('会員同期: ' + contacts.length + '件（配信対象 ' + contacts.filter(c => c.active).length + '件）');
  } finally { lock.releaseLock(); }
}

// 実行すると同期トリガーを「6時間ごと」に作り直し、すぐ1回同期する（何回実行してもトリガーは1つ）
function setupWpMemberSync() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncWpMembersToSheet')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncWpMembersToSheet').timeBased().everyHours(6).create();
  syncWpMembersToSheet();
}

// 解約フォームなどでシートから外した人を、Brevo側でも配信停止にする（会員用リスト経由で届き続けないように）
function brevoBlockEmail_(email) {
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('BREVO_ENABLED') !== 'true' || !p.getProperty('BREVO_API_KEY')) return false;
  const address = String(email || '').trim().toLowerCase();
  if (!address) return false;
  try {
    brevoApi_('put', '/contacts/' + encodeURIComponent(address), {emailBlacklisted: true});
  } catch (error) {
    if (error.httpStatus !== 404) { console.error('Brevo配信停止に失敗: ' + error.message); return false; }
    brevoApi_('post', '/contacts', {email: address, emailBlacklisted: true});
  }
  return true;
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
