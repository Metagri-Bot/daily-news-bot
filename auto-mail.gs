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
    .addItem('1.6. 本番と同じ内容でBrevoテスト（自分のみ）', 'sendCampaignSelfTest')
    .addItem('2. 読者へ一斉配信（本番）', 'broadcastEmail')
    .addItem('3. 送信予約を設定する', 'setSchedule')
    .addItem('4. 予約をキャンセルする', 'cancelSchedule')
    .addItem('5. Brevo接続確認（送信なし）', 'checkBrevoConnection')
    .addItem('6. Brevo配信状況を更新', 'refreshBrevoStatus')
    .addSeparator()
    .addItem('7. 週末ダイジェストを原稿作成へ取り込む', 'stageWeeklyDigest')
    .addItem('7.5 週末ダイジェスト：選定済みの行の一言を作る', 'weeklyDigestBuildNow')
    .addItem('8. 週末ダイジェスト自動運転をONにする', 'setupWeeklyDigestTrigger')
    .addItem('9. 週末ダイジェスト自動運転をOFFにする', 'removeWeeklyDigestTrigger')
    .addToUi();
}

/**
 * 定期実行用の関数（月・木 9:00〜10:59 JSTにこれを呼ぶ）
 */
function scheduledDailyDraft() {
  if (!isMondayThursdayTestDraftWindow_()) {
    console.log('scheduledDailyDraft skipped: outside Mon/Thu 09:00-10:59 JST window.');
    return;
  }

  console.log("定期実行：下書き作成を開始します。");
  generateDraftAndTest(true);
}

/**
 * 1. AIで下書きを作り（メルマガ＆X＆カタログ）、自分にテスト送信する機能
 */
function isMondayThursdayTestDraftWindow_() {
  const now = new Date();
  const dayOfWeek = Number(Utilities.formatDate(now, AUTOMATION_TIMEZONE, 'u')); // Mon=1, Sun=7
  const hour = Number(Utilities.formatDate(now, AUTOMATION_TIMEZONE, 'H'));
  return [1, 4].includes(dayOfWeek) && [9, 10].includes(hour);
}

function setupWeekdayTestDraftTrigger() {
  deleteTriggersByHandler_('scheduledDailyDraft');

  const weekdays = [
    ScriptApp.WeekDay.MONDAY,
    ScriptApp.WeekDay.THURSDAY
  ];

  weekdays.forEach(function(weekday) {
    ScriptApp.newTrigger('scheduledDailyDraft')
      .timeBased()
      .onWeekDay(weekday)
      .atHour(9)
      .nearMinute(30)
      .inTimezone(AUTOMATION_TIMEZONE)
      .create();
  });

  console.log('Test draft triggers created: Mon/Thu, 09:00-10:59 JST window (trigger near 09:30).');
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

  # メルマガ件名のルール（2026-09-28 Phase 1）
  ・件名は2案つくる。
  ・subject_result＝「確かめた結果」型：記事で試した・検証した結果や、実践者（農家名・地域）が先に見える件名。疑問形「〜した結果は？」も可。連載名・回数は末尾の【】へ。
    例：×「【第6弾】農家のためのCloudflare入門：直売予約を0円でネット受付する方法」→ ○「直売予約を0円で受け付けられた？ Cloudflareで試した結果【第6弾】」
  ・subject_classic＝従来型：連載名や道具名を先頭に置く、これまでどおりの件名。
  ・どちらも全角40字以内。記事に書かれていない結果・数字を作らない。

  # 返信を促す1問のルール
  ・reply_question＝読者が1行で答えられる、記事テーマに関する具体的な質問を1つ。
    例：「田んぼの収穫時期は、何を見て決めていますか？」
  ・はい/いいえで終わる質問や、個人情報（住所・売上額など）を聞く質問にしない。

  # 出力フォーマット（JSON形式）
  {
    "subject_result": "「確かめた結果」型の件名",
    "subject_classic": "従来型の件名",
    "reply_question": "読者に1行で返信してもらう質問",
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
        model: 'gpt-6-luna',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: "json_object" }
      })
    });

    const json = JSON.parse(response.getContentText());
    const content = JSON.parse(json.choices[0].message.content);

    // 件名2案（Phase 1）。旧形式（subject のみ）が返っても動くようにする
    const subjectResult = String(content.subject_result || content.subject || '').trim();
    const subjectClassic = String(content.subject_classic || content.subject || '').trim();
    content.subject = subjectResult || subjectClassic;

    // メルマガ用URL（単体用）
    const trackedUrl = addTrackingParams(articleUrl);

    // メルマガ本文組み立て（4段は従来どおり＋返信の1問＋P.S.の関連記事1本）
    let aiBody = content.intro + '<br><br>' +
               content.summary + '<br><br>' +
               content.appeal + `<br><br>記事は<a href="${trackedUrl}">こちら</a>から`;
    aiBody += mailReplyQuestionHtml_(content.reply_question);
    aiBody += mailPostscriptHtml_(pickRelatedArticle_(content.catalog && content.catalog.category, articleUrl));

    let footer = SIGNATURE;
    if (UNSUBSCRIBE_URL && UNSUBSCRIBE_URL.startsWith('http')) {
      footer += `<br>配信停止は<a href="${UNSUBSCRIBE_URL}">こちら</a>から`;
    }

    const fullHtmlBody = GREETING + '<br>' + aiBody + '<br>' + footer;

    // スプレッドシートに書き込み（原稿作成シート）
    draftSheet.getRange('B1').setValue(content.subject);
    draftSheet.getRange('B2').setValue(fullHtmlBody);
    draftSheet.getRange('B4').setValue(content.x_post).setWrap(true);
    // 件名の候補＝B5 結果型／B6 従来型（B1 を B6 に差し替えれば従来型で配信。型は予約時に自動判定）
    draftSheet.getRange('B5').setValue(subjectResult);
    draftSheet.getRange('B6').setValue(subjectClassic);
    SCRIPT_PROPERTIES.setProperty('AI_GUIDE_DRAFT_URL', aiGuideCanonicalUrl_(articleUrl));

    // ★新規：コンテンツカタログに自動追加（タイトルは記事名に近い従来型の件名を使う）
    updateContentCatalog(content.catalog, subjectClassic || content.subject, articleUrl);

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
  
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME_CATALOG);
    sheet.appendRow(['content_id', 'title', 'url', 'content_type', 'category', 'target_types', 'tags', 'priority', 'read_time', 'reason_template']);
    sheet.getRange(1, 1, 1, 10).setBackground('#eeeeee').setFontWeight('bold');
  }

  const lastRow = sheet.getLastRow();
  const cleanUrl = url.split('?utm')[0];

  if (lastRow > 1) {
    const existingUrls = sheet.getRange(2, 3, lastRow - 1, 1).getValues().flat();
    if (existingUrls.includes(cleanUrl)) {
      console.log('カタログ：既に登録済みのURLのため追加をスキップしました。');
      return;
    }
  }

  let nextId = 'c072';
  if (lastRow > 1) {
    const lastId = sheet.getRange(lastRow, 1).getValue().toString();
    const lastNum = parseInt(lastId.replace('c', ''), 10);
    if (!isNaN(lastNum)) {
      nextId = 'c' + ('000' + (lastNum + 1)).slice(-3);
    }
  }

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
 * Phase 1（2026-09-28）：返信を促す1問
 */
function mailReplyQuestionHtml_(question) {
  const q = String(question || '').trim();
  if (!q) return '';
  return '<br><br>――<br>ひとつだけ質問です。<br><b>' + mailEscapeHtml_(q) + '</b><br>' +
    'このメールに1行で返信していただけると、次の記事づくりの参考にします。';
}

/**
 * Phase 1：P.S. の関連記事1本（ContentCatalog から同カテゴリ・優先度の高いものを1本）
 * 見つからなければ空文字（本文は従来どおり）
 */
function pickRelatedArticle_(category, excludeUrl) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_CATALOG);
    if (!sheet || sheet.getLastRow() < 2) return null;
    const exclude = String(excludeUrl || '').split(/[?#]/)[0].replace(/\/?$/, '/');
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 10).getValues();
    return pickRelatedFromRows_(rows, category, exclude);
  } catch (e) {
    console.error('P.S. 関連記事の選定をスキップ: ' + e.message);
    return null;
  }
}

// テスト可能な純関数：rows は ContentCatalog の [id,title,url,type,category,target,tags,priority,read_time,reason]
function pickRelatedFromRows_(rows, category, excludeUrlWithSlash) {
  const norm = u => String(u || '').split(/[?#]/)[0].replace(/\/?$/, '/');
  const candidates = rows.filter(r => r[2] && /^https:\/\/metagri-labo\.com\/ai-guide\//.test(String(r[2])) &&
    norm(r[2]) !== excludeUrlWithSlash && String(r[3] || 'article') === 'article');
  if (!candidates.length) return null;
  const same = category ? candidates.filter(r => String(r[4]) === String(category)) : [];
  const pool = (same.length ? same : candidates).slice();
  // 優先度の高い順、同点は新しい行（IDが大きい）を優先
  pool.sort((a, b) => (Number(b[7]) || 0) - (Number(a[7]) || 0) || String(b[0]).localeCompare(String(a[0])));
  const top = pool[0];
  return {title: String(top[1]), url: norm(top[2]), sameCategory: same.length > 0};
}

function mailPostscriptHtml_(article) {
  if (!article || !article.url) return '';
  const lead = article.sameCategory ? 'あわせて読まれている記事' : 'こちらもおすすめ';
  return '<br><br>P.S. ' + lead + '：<a href="' + article.url + '">' + mailEscapeHtml_(article.title) + '</a>';
}

function mailEscapeHtml_(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Phase 1：件名の型ラベル（B1 が B5/B6 のどちらか）。Brevo のキャンペーン名末尾に付け、分析で使う
 */
function mailSubjectType_(subject, resultCandidate, classicCandidate) {
  const s = String(subject || '').trim();
  if (/【週末まとめ】\s*$/.test(s)) return '週末まとめ'; // 週末ダイジェスト（weekly-digest.gs）
  if (s && s === String(resultCandidate || '').trim()) return '結果型';
  if (s && s === String(classicCandidate || '').trim()) return '従来型';
  return '手直し';
}

/**
 * 学習用データ（X投稿例）をシートから読み込む関数
 */
function getXPostExamples() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME_X_EXAMPLES);
  
  if (!sheet) return "";

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return "";

  const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  
  const examplesText = data.map(row => {
    const postContent = row[0];
    const category = row[1];
    if (!postContent) return "";
    return `【参考例】\n分類: ${category}\nポスト内容: ${postContent}`;
  }).join("\n\n");

  return examplesText;
}

/**
 * 1.5. 修正後にテスト送信する機能
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
 * 1.6. 本番と同じ内容でBrevoテスト（自分のみ）※2026-09-30 追加
 * 読者配信と同じ brevoHtml_（UTM付与・配信停止リンク）で、Brevoの「キャンペーン」を作り、Brevoの
 * テスト送信（sendTest）で自分にだけ送る。宛先リストは自分1人だけの新規リストで、sendNow は呼ばないので読者には届かない。
 * キャンペーン名は「農業AI通信 」で始めない（配信実績の集計に入れない）。
 */
function sendCampaignSelfTest() {
  const ui = SpreadsheetApp.getUi();
  try {
    const r = brevoCampaignSelfTest_();
    ui.alert('Brevoのキャンペーン（下書き）を本番と同じ内容で作り、自分宛てにテスト送信しました。\n読者には送られていません。\nキャンペーンID: ' + r.campaignId + '\n' + r.url);
  } catch (e) {
    ui.alert('本番内容のテスト送信に失敗しました（読者には送られていません）。\n' + e.message);
  }
}

function brevoCampaignSelfTest_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('原稿作成');
  const subject = String(sheet.getRange('B1').getValue()).trim();
  const html = String(sheet.getRange('B2').getValue());
  if (!subject || !html) throw new Error('件名または本文が空です。');
  const config = brevoRequireEnabled_();
  const senderName = String(ss.getSheetByName('設定').getRange('B2').getValue()) || '農業AI通信 編集部';
  const now = new Date();
  const stamp = Utilities.formatDate(now, AUTOMATION_TIMEZONE, 'yyyyMMdd-HHmm');
  const list = brevoApi_('post', '/contacts/lists', {name: 'TEST 自分のみ ' + stamp, folderId: config.folderId});
  if (!list.id) throw new Error('テスト用リストのIDを取得できませんでした。');
  brevoApi_('post', '/contacts', {email: OWNER_EMAIL, listIds: [list.id], updateEnabled: true});
  const campaign = brevoApi_('post', '/emailCampaigns', {
    name: 'TEST 本番確認 ' + stamp,
    type: 'classic',
    subject: '【本番確認テスト】' + subject,
    sender: {email: config.sender, name: senderName},
    replyTo: OWNER_EMAIL,
    htmlContent: brevoHtml_(html, now),
    recipients: {listIds: [list.id]},
    utmCampaign: 'ai_guide_' + Utilities.formatDate(now, AUTOMATION_TIMEZONE, 'yyyyMMdd')
  });
  if (!campaign.id) throw new Error('キャンペーンIDを取得できませんでした。');
  brevoApi_('post', '/emailCampaigns/' + campaign.id + '/sendTest', {emailTo: [OWNER_EMAIL]});
  return {campaignId: campaign.id, url: 'https://app.brevo.com/marketing-campaign/edit/' + campaign.id};
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
  
  if (!archiveSheet) {
    archiveSheet = ss.insertSheet('アーカイブ');
    archiveSheet.appendRow(['送信日時', '件名', '記事URL', '配信数', 'メルマガ本文', 'X投稿案']);
    archiveSheet.getRange(1, 1, 1, 6).setBackground('#eeeeee').setFontWeight('bold');
  }

  if (archiveSheet.getLastColumn() < 6) {
    archiveSheet.getRange(1, 5, 1, 2).setValues([['メルマガ本文', 'X投稿案']]);
  }

  archiveSheet.appendRow([
    new Date(), 
    subject, 
    articleUrl, 
    recipientCount, 
    htmlBody,
    xPost
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
  if (typeof brevoBlockEmail_ === 'function') brevoBlockEmail_(targetEmail);
}

/**
 * HTML本文中のすべての <a href="..."> に対し、GA4用UTMパラメータを付与する
 */
function appendUtmParamsToAllLinks_(html, targetDate) {
  if (!html) return html;
  const date = targetDate instanceof Date ? targetDate : new Date();
  const dateStr = Utilities.formatDate(date, AUTOMATION_TIMEZONE, "yyyyMMdd");
  const utmCampaign = "ai_guide_" + dateStr;

  return html.replace(/<a\s+([^>]*?)href=(["'])(.*?)\2([^>]*?)>/gi, function(match, before, quote, url, after) {
    if (!url.startsWith('http') || url.indexOf('{{') !== -1 || url.indexOf('unsubscribe') !== -1) {
      return match;
    }

    const cleanUrl = url.split(/[?#]/)[0];
    const domainOrSlug = cleanUrl.split('/').filter(String).pop() || "link";

    const trackedUrl = addOrReplaceQueryParams_(url, {
      utm_source: "newsletter",
      utm_medium: "email",
      utm_campaign: utmCampaign,
      utm_content: domainOrSlug
    });

    return '<a ' + before + 'href=' + quote + trackedUrl + quote + after + '>';
  });
}

/**
 * URLにGA4追跡用のUTMパラメータを付与する（日付は当日を設定）
 */
function addTrackingParams(url) {
  if (!url || !url.startsWith('http')) return url;

  const now = new Date();
  const dateStr = Utilities.formatDate(now, AUTOMATION_TIMEZONE, "yyyyMMdd");

  let domain = "unknown";
  try {
    domain = url.split('/')[2];
  } catch (e) {
    console.error("ドメイン抽出エラー: " + e.message);
  }

  const utmSource = "newsletter";
  const utmMedium = "email";
  const utmCampaign = "ai_guide_" + dateStr;
  const utmContent = url.split(/[?#]/)[0].split('/').filter(String).pop() || domain;

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
  const baseUrl = queryIndex === -1 ? urlWithoutHash : urlWithoutHash.slice(0, queryIndex); // 2026-09-30 修正：以前は slice(queryIndex + 1)＝クエリ側を返し、UTM付きリンクへ再付与するとURLが壊れた
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

// 農業AI通信: GAS予約 + Brevo Marketing Campaigns
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
  if (status < 200 || status >= 300) {
    const error = new Error('Brevo HTTP ' + status + '。Brevo管理画面で認証・残量・配信状態を確認してください。');
    error.httpStatus = status;
    throw error;
  }
  const body = response.getContentText();
  return body ? JSON.parse(body) : {};
}

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

// 2026-09-30 追加：配信が異常状態になったら自分宛てに1回だけ知らせる（以前はSUSPENDEDでも黙って止まり、翌日まで気づけなかった）
const BREVO_ALERT_STATES = ['SUSPENDED', 'REVIEW', 'FAILED'];

function brevoAlert_(job) {
  try {
    if (BREVO_ALERT_STATES.indexOf(job.state) === -1 || job.alertedState === job.state) return;
    const config = brevoConfig_();
    const report = job.campaignId ? 'https://app.brevo.com/marketing-reports/email/' + job.campaignId + '/overview' : '';
    const guide = {
      SUSPENDED: 'Brevoが配信を「停止」にしました。届いていても、この状態ではアーカイブ転記・配信数の記録が自動で行われません。Brevoのレポートで到達数を確認し、アーカイブへ手動で転記してください。',
      REVIEW: 'キャンペーンが作られたかどうか不明です。二重送信を防ぐため自動再送していません。Brevoの「Campaigns」でこの予約IDのキャンペーンがあるか確認してください。',
      FAILED: '配信の準備または送信でエラーになりました。Brevoの残量・認証と、Brevo配信管理シートの「詳細」を確認してください。'
    }[job.state];
    const html = '<p>メルマガの配信が <b>' + job.state + '</b> になりました。</p>' +
      '<p>件名: ' + String(job.subject || '').replace(/[<>&]/g, '') + '<br>予約ID: ' + job.id + '<br>キャンペーンID: ' + (job.campaignId || 'なし') + '<br>詳細: ' + String(job.note || '').replace(/[<>&]/g, '') + '</p>' +
      '<p>' + guide + '</p>' +
      (report ? '<p>Brevoのレポート: <a href="' + report + '">' + report + '</a></p>' : '') +
      '<p>管理シート: <a href="' + SpreadsheetApp.getActiveSpreadsheet().getUrl() + '">Brevo配信管理</a></p>';
    brevoApi_('post', '/smtp/email', {sender: {email: config.sender, name: '農業AI通信 GAS通知'},
      to: [{email: OWNER_EMAIL}], subject: '【要確認】メルマガ配信が ' + job.state + ' です｜' + String(job.subject || '').slice(0, 30),
      htmlContent: html});
    job.alertedState = job.state; // 同じ状態では再通知しない（保存される）
  } catch (e) {
    console.error('異常通知に失敗しました（配信処理には影響しません）: ' + e.message);
  }
}

function brevoSave_(job) {
  const sheet = brevoJobsSheet_();
  brevoAlert_(job);
  const meta = Object.assign({}, job);
  delete meta.html; delete meta.xPost; delete meta.row;
  const json = JSON.stringify(meta);
  if (json.length > 45000 || job.html.length > 45000 || job.xPost.length > 45000) {
    throw new Error('予約データが大きすぎます。本文または配信リストを小さくしてください。');
  }
  if (!job.row) job.row = sheet.getLastRow() + 1;
  sheet.getRange(job.row, 1, 1, 12).setValues([[job.id, job.state, new Date(job.at), job.subject,
    job.url, job.campaignId || '', job.emails.length, job.note || '', new Date(), json, job.html, job.xPost].map(brevoCell_)]);
  sheet.getRange(job.row, 1, 1, 8).setBackground(BREVO_ALERT_STATES.indexOf(job.state) === -1 ? null : '#fde7e9'); // 異常の行は薄い赤
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
      const active = !c.emailBlacklisted && !unsubscribed && wpStatus !== '未希望';
      const status = !active && (!wpStatus || wpStatus === '配信中') ? '配信停止' : (wpStatus || '配信中');
      const reason = active ? '' : String((c.attributes || {}).WP_WITHDRAW_REASON || '').trim();
      out.push({email: email, active: active, status: active ? '配信中' : status, created: c.createdAt || '', reason: reason});
    });
    if (contacts.length < 500) break;
  }
  return out;
}

function brevoMemberEmails_() {
  return brevoMemberContacts_().filter(c => c.active).map(c => c.email);
}

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

function setupWpMemberSync() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncWpMembersToSheet')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncWpMembersToSheet').timeBased().everyHours(6).create();
  syncWpMembersToSheet();
}

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
  const subjectType = mailSubjectType_(subject, sheet.getRange('B5').getValue(), sheet.getRange('B6').getValue());
  return {url: url, subject: subject, html: html, emails: emails, subjectType: subjectType,
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
    if (JSON.stringify(job).length > 43000) throw new Error('原稿・配信リストの合計サイズが大きすぎます。');
    brevoEnsureWorker_();
    brevoCancelPending_();
    brevoSave_(job);
    ScriptApp.newTrigger('scheduledBroadcast').timeBased().at(new Date(Math.max(Date.now() + 60000, when.getTime()))).create();
  } finally { lock.releaseLock(); }
  brevoWorker(true);
  return job.id;
}

function brevoWorker(prepareOnly) {
  if (SCRIPT_PROPERTIES.getProperty('BREVO_ENABLED') !== 'true') return;
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
      brevoApi_('post', '/contacts', {email: email, listIds: [job.listId], updateEnabled: true});
      Utilities.sleep(120);
    }
    job.cursor++;
    if (job.cursor % 10 === 0) brevoSave_(job);
  }
  if (job.cursor < job.emails.length) { brevoSave_(job); return; }
  job.state = 'READY'; job.note = '原稿・読者の準備完了。予約時刻を待っています。'; brevoSave_(job);
  if (prepareOnly || Date.now() < new Date(job.at).getTime() || Date.now() > deadline - 15000) return;
  
  const remaining = new Set(brevoEmails_());
  const removed = job.emails.filter(e => !remaining.has(e));
  for (let i = 0; i < removed.length; i += 100) {
    brevoApi_('post', '/contacts/lists/' + job.listId + '/contacts/remove', {emails: removed.slice(i, i + 100)});
  }
  if (!job.emails.some(e => remaining.has(e))) throw new Error('予約対象者が全員配信リストから外れています。');
  job.state = 'CREATING'; brevoSave_(job);

  const sendDate = job.at ? new Date(job.at) : new Date();
  const campaign = brevoApi_('post', '/emailCampaigns', {
    name: '農業AI通信 ' + job.id + (job.subjectType ? ' [' + job.subjectType + ']' : ''),
    type: 'classic',
    subject: job.subject,
    sender: {email: job.sender, name: job.senderName},
    replyTo: OWNER_EMAIL,
    htmlContent: brevoHtml_(job.html, sendDate),
    recipients: {listIds: [job.listId]},
    utmCampaign: 'ai_guide_' + Utilities.formatDate(sendDate, AUTOMATION_TIMEZONE, "yyyyMMdd")
  });
  if (!campaign.id) throw new Error('キャンペーンIDが取得できませんでした。');
  job.campaignId = campaign.id;
  job.state = 'SENDING'; job.sendAttempted = true;
  job.note = 'Brevoへ配信要求中。結果不明時は自動再送しません。'; brevoSave_(job);
  try {
    brevoApi_('post', '/emailCampaigns/' + job.campaignId + '/sendNow');
    job.state = 'ACCEPTED'; job.note = 'Brevo受付済み。配信完了を確認中です。';
  } catch (error) {
    job.note = error.message + ' キャンペーンID=' + job.campaignId;
  }
  brevoSave_(job);
}

function brevoHtml_(html, sendDate = new Date()) {
  let processedHtml = appendUtmParamsToAllLinks_(html, sendDate);
  if (!processedHtml.includes('{{ unsubscribe }}')) {
    processedHtml += '<p><a href="{{ unsubscribe }}">農業AI通信の配信停止</a></p>';
  }
  return processedHtml;
}

function brevoReconcile_(job) {
  const campaign = brevoApi_('get', '/emailCampaigns/' + job.campaignId);
  if (campaign.status === 'sent') {
    const stats = (campaign.statistics || {}).globalStats || {};
    job.sentCount = typeof stats.sent === 'number' ? stats.sent : '';
    job.deliveredCount = typeof stats.delivered === 'number' ? stats.delivered : '';
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
