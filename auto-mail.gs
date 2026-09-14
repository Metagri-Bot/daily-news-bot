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
