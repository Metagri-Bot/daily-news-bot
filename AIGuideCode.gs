/* ========================================
   統合版 doPost (フォーム登録 + 農業AI通信Bot)
   更新日: 2026-04-11
   変更点:
     - doPost: JSON/フォームパラメータ自動判定 + プロパティ名揺れ吸収
     - handleFormRegistration: Nano Banana 2 のregistration_type追加
======================================== */

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    let data = {};

    // ★ 送信形式（JSON or フォームパラメータ）を自動判定してデータを取得
    if (e.postData && e.postData.contents) {
      try {
        data = JSON.parse(e.postData.contents);
      } catch (err) {
        // JSONパースに失敗した場合は、通常のパラメータとして扱う
        data = e.parameter;
      }
    } else {
      data = e.parameter;
    }

    // ★ プロパティ名の揺れを統一（どちらの名前で来ても data.xxx に変換）
    data.email     = data.email     || data.Email;
    data.name      = data.name      || '';
    data.subscribe = data.subscribe || data.newsletter || 'はい';
    data.page_url  = data.page_url  || data.pageUrl    || '';

    // --- 分岐1: 農業AI通信Bot (A1/A2 上書き) の場合 ---
    if (data.type === 'aiGuide') {
      return handleAiGuide(data);
    }

    // --- 分岐2: フォームからの登録 (スプシ追記) の場合 ---
    if (data.email) {
      return handleFormRegistration(data);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: 'Unknown request type' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}


/**
 * フォーム登録処理
 */
function handleFormRegistration(data) {
  const SPREADSHEET_ID = '1FVcqS0Ze2bouVIqHpHger3WaU5x8TSYqqHk8ZKAhSEU';
  const SHEET_NAME = '登録者一覧';
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['タイムスタンプ', 'メールアドレス', '名前', '購読', 'URL', 'Source', 'Medium', 'Campaign', 'Term', 'Content']);
  }

  sheet.appendRow([
    data.timestamp  || new Date().toLocaleString('ja-JP'),
    data.email,
    data.name,
    data.subscribe,
    data.page_url,
    data.utm_source,
    data.utm_medium,
    data.utm_campaign,
    data.utm_term,
    data.utm_content
  ]);

  // 専用シートへの詳細保存
  if (data.registration_type === 'アンバサダー0日目特典登録') {
    saveAmbassadorDetail(data);
  }
  if (data.registration_type === 'VibeCodingスタートガイド特典登録') {
    saveVibeCodingDetail(data);
  }
  if (data.registration_type === 'スターターキット特典登録') {
    saveStarterKitDetail(data);
  }

  // 登録タイプ別メール送信
  if (data.email) {
    if (data.registration_type === '確定申告テンプレ特典登録') {
      sendKakuteiTemplateEmail(data.email, data.name);
    } else if (
      data.registration_type === 'Nano Banana Pro特典登録' ||
      data.registration_type === 'Nano Banana 2 プロンプト集（全13テンプレート）'  // ★ LP側の実際の値に対応
    ) {
      sendNanoBananaProEmail(data.email, data.name);
    } else if (data.registration_type === 'スターターキット特典登録') {
      sendStarterKitEmail(data.email, data.name);
    } else if (data.registration_type === 'アンバサダー0日目特典登録') {
      sendAmbassadorDayZeroEmail(data.email, data.name);
    } else if (data.registration_type === 'VibeCodingスタートガイド特典登録') {
      sendVibeCodingGuideEmail(data.email, data.name);
    } else {
      sendAutoReplyEmail(data.email, data.name);
    }
  }

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success' }))
    .setMimeType(ContentService.MimeType.JSON);
}


/**
 * 農業AI通信Bot処理 (A1/A2 上書き)
 */
function handleAiGuide(data) {
  const SPREADSHEET_ID = '1FVcqS0Ze2bouVIqHpHger3WaU5x8TSYqqHk8ZKAhSEU';
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheets = ss.getSheets();
  let sheet = sheets.find(s => s.getSheetId() == 1834867434) || sheets[0];

  const formatList = (items, prefix = '・') => {
    if (Array.isArray(items)) return items.map(item => `${prefix} ${item}`).join('\n');
    return items || '';
  };

  const contentParts = [
    `【${data.title || 'タイトルなし'}】\n`,
    `${data.summary || ''}\n`
  ];
  if (data.facts)      contentParts.push(`＜確認できた事実＞\n${formatList(data.facts)}`);
  if (data.keyPoints)  contentParts.push(`\n＜要点＞\n${formatList(data.keyPoints, '1.')}`);
  if (data.actionable) contentParts.push(`\n💡 実践のヒント: ${data.actionable}`);
  if (data.evidence)   contentParts.push(`\n＜根拠/キーワード＞\n${formatList(data.evidence, '-')}`);

  const articleInfo = contentParts.join('\n').trim();
  const cleanUrl = (data.url || '').split('?utm')[0];

  sheet.getRange('A1').setValue(articleInfo).setWrap(true).setVerticalAlignment('top');
  sheet.getRange('A2').setValue(cleanUrl);
  sheet.setColumnWidth(1, 800);

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success' }))
    .setMimeType(ContentService.MimeType.JSON);
}


/**
 * 自動返信メール送信（汎用）
 */
function sendAutoReplyEmail(email, name) {
  const subject = '【農業AI通信】テンプレート集をお届けします';
  const body = `平素よりお世話になっています。
農業AI通信を運営する株式会社農情人の甲斐です。

この度、農業AI通信にご登録いただき、誠にありがとうございます。

「農家のための生成AIテンプレート集」をお送りいたします。
下記のリンクをご参照いただけると幸いです！
https://metagrilabo.notion.site/ai-guide-start-present

今後ともどうぞよろしくお願い致します。
━━━━━━━━━━━━━━━━━━━━
農業AI通信 / Metagri研究所
━━━━━━━━━━━━━━━━━━━━`;

  GmailApp.sendEmail(email, subject, body, { name: 'Metagri研究所' });
}


/**
 * Nano Banana Pro / Nano Banana 2 特典用メール送信
 */
function sendNanoBananaProEmail(email, name) {
  const subject = '【農業AI通信】画像生成AIテクニック集をお届けします';
  const body = `
農業AI通信にご登録いただき、誠にありがとうございます！

「農家のための画像生成AI利用テクニック集」のダウンロードリンクは下記です。
https://metagrilabo.notion.site/nano-banana2-prompt-present

これからもよろしくお願いします！

--------------------------------------------------
農業AI通信 編集部
https://metagri-labo.com/ai-guide
運営：Metagri研究所（株式会社農情人）
--------------------------------------------------
`;

  GmailApp.sendEmail(email, subject, body, { name: 'Metagri研究所' });
}


/**
 * 確定申告テンプレ特典用メール送信
 */
function sendKakuteiTemplateEmail(email, name) {
  const subject = '【農業AI通信】確定申告AIテンプレート集をお届けします';
  const body = `農業AI通信にご登録いただき、誠にありがとうございます。

「農家のためのAI確定申告テンプレート集（2026年版・全16本）」の
ダウンロードリンクは下記です。

▼ テンプレート集を開く
https://metagrilabo.notion.site/tax-return-prompt-present

━━━━━━━━━━━━━━━━━━━━
使い方（かんたん3ステップ）
1. テンプレをコピー
2. ChatGPT（またはGemini）に貼る
3. 【　】を自分の情報に書き換える
━━━━━━━━━━━━━━━━━━━━

⚠️ AIの回答はあくまで参考情報です。
最終的な税務判断は、必要に応じて税理士・税務署にご確認ください。

━━━━━━━━━━━━━━━━━━━━
農業AI通信 / Metagri研究所（株式会社農情人）
https://metagri-labo.com/ai-guide/
━━━━━━━━━━━━━━━━━━━━`;

  GmailApp.sendEmail(email, subject, body, { name: 'Metagri研究所' });
}


/**
 * 新規就農スターターキット特典用メール送信
 */
function sendStarterKitEmail(email, name) {
  const STARTER_PAGE_URL = 'https://metagrilabo.notion.site/new-farmer-ai-start-kit';
  const NOTIFICATION_EMAIL = 'yuichiro.kai@noujoujin.com';

  const subject = '【農業AI通信】新規就農スターターキットをお届けします';
  const body = `${name || ''} 様

農業AI通信「新規就農者向け特集」にお申し込みいただき、
ありがとうございます。

━━━━━━━━━━━━━━━━━━━━━━
特典ページはこちらからご覧いただけます
━━━━━━━━━━━━━━━━━━━━━━

${STARTER_PAGE_URL}

━━━━━━━━━━━━━━━━━━━━━━

【特典に含まれる内容】

最初の90日ロードマップ
   「守り→攻め→継続」の順で段階的にAI導入

コピペ用AIテンプレート（6種）
   ・事業計画1枚プロンプト
   ・経費分類プロンプト
   ・価格設計プロンプト
   ・週次レビュープロンプト
   ・作業日誌→改善抽出プロンプト
   ・SNS投稿トンマナ固定プロンプト

AI活用の注意点ガイド
   個人情報・丸投げ防止・最終確認のルール

━━━━━━━━━━━━━━━━━━━━━━

【使い方】
1. 上のURLをタップしてページを開く
2. 90日ロードマップのチェックリストを確認
3. テンプレートをコピーしてChatGPTやClaudeに貼り付け
4.【 】内を自分の情報に書き換えて実行

スマホでもPCでもそのまま使えます。
ブックマーク保存がおすすめです。

━━━━━━━━━━━━━━━━━━━━━━
農業AI通信｜Metagri研究所（株式会社農情人）
メール: info@metagri-labo.com
公式サイト: https://metagri-labo.com/
━━━━━━━━━━━━━━━━━━━━━━
※このメールは自動送信されています。`;

  GmailApp.sendEmail(email, subject, body, { name: '農業AI通信｜Metagri研究所' });

  MailApp.sendEmail({
    to: NOTIFICATION_EMAIL,
    subject: '【農業AI通信】新規就農スターターキット 新規申込',
    body: `新規就農スターターキットに申込がありました。\n\nお名前: ${name || '未記入'}\nメール: ${email}\n\nスプレッドシートで確認:\nhttps://docs.google.com/spreadsheets/d/1FVcqS0Ze2bouVIqHpHger3WaU5x8TSYqqHk8ZKAhSEU\n\n※自動送信`
  });
}


/**
 * アンバサダー「0日目」先行公開 特典用メール送信
 */
function sendAmbassadorDayZeroEmail(email, name) {
  const DAY_ZERO_PAGE_URL = 'https://metagrilabo.notion.site/ambassador-0day-story';
  const NOTIFICATION_EMAIL = 'yuichiro.kai@noujoujin.com';

  const subject = '【農業AI通信】メディア・アンバサダー「0日目」先行公開をお届けします';
  const body = `${name || ''} 様

農業AI通信にご登録いただき、ありがとうございます。

初代メディア・アンバサダー3名の決定を記念し、
登録者限定コンテンツ「0日目 ── はじめの一歩の裏側」を
先行公開いたします。

━━━━━━━━━━━━━━━━━━━━━━
▼ 「0日目」先行公開ページはこちら
━━━━━━━━━━━━━━━━━━━━━━
${DAY_ZERO_PAGE_URL}
━━━━━━━━━━━━━━━━━━━━━━

【登録者限定 3つの特典】

「0日目」先行公開
　3名の応募背景・現場の課題・AI活用の方向性を
　一般公開に先駆けてお届けします。

90日バックステージ（月2回更新）
　各アンバサダーの「その後」を追跡。
　壁にぶつかるプロセスもリアルタイムでお届けします。

第2期メディア・アンバサダー 優先案内
　第1期を見てから参加したい方へ、
　先行告知＋優先選考枠をご案内します。

━━━━━━━━━━━━━━━━━━━━━━

【選出された3名のテーマ】
・守り … 経営データの見える化（水稲・小麦・大豆・野菜）
・攻め … 確定申告の効率化（ブロッコリー・人参・白ネギ）
・継続 … EC・予約の統合と集客（ぶどう約20品種）

━━━━━━━━━━━━━━━━━━━━━━
農業AI通信｜Metagri研究所（株式会社農情人）
メール: info@metagri-labo.com
公式サイト: https://metagri-labo.com/ai-guide/
━━━━━━━━━━━━━━━━━━━━━━
※このメールは自動送信されています。`;

  GmailApp.sendEmail(email, subject, body, { name: '農業AI通信｜Metagri研究所' });

  MailApp.sendEmail({
    to: NOTIFICATION_EMAIL,
    subject: '【農業AI通信】アンバサダー0日目特典 新規登録',
    body: `アンバサダー「0日目」先行公開の特典登録がありました。\n\nお名前: ${name || '未記入'}\nメール: ${email}\n\nスプレッドシートで確認:\nhttps://docs.google.com/spreadsheets/d/1FVcqS0Ze2bouVIqHpHger3WaU5x8TSYqqHk8ZKAhSEU\n\n※自動送信`
  });
}


/**
 * Vibe Codingスタートガイド特典用メール送信
 */
function sendVibeCodingGuideEmail(email, name) {
  const GUIDE_PAGE_URL = 'https://metagrilabo.notion.site/vibe-coding-campaign-2026';
  const NOTIFICATION_EMAIL = 'yuichiro.kai@noujoujin.com';

  const subject = '【農業AI通信】Vibe Codingスタートガイドをお届けします';
  const body = `${name || ''} 様

農業AI通信にご登録いただき、ありがとうございます。

━━━━━━━━━━━━━━━━━━━━━━
▼ Vibe Codingスタートガイドはこちら
━━━━━━━━━━━━━━━━━━━━━━
${GUIDE_PAGE_URL}
━━━━━━━━━━━━━━━━━━━━━━

【ガイドに含まれる内容】

 3問診断
　AI Studio Build / Antigravity / Codex / Claude Code
　から最適なツールを自動推薦

 5分で農業アプリ完成ガイド
　Google AI Studio Buildを使い、ブラウザだけ・無料で
　農薬希釈計算アプリを開発するステップガイド

 コピペ用プロンプト集
　積算温度計算、収支シミュレーター、
　収穫チェックリスト、作業日報 など

 6段階ステップアップ学習パス

━━━━━━━━━━━━━━━━━━━━━━
農業AI通信｜Metagri研究所（株式会社農情人）
メール: info@metagri-labo.com
公式サイト: https://metagri-labo.com/ai-guide/
━━━━━━━━━━━━━━━━━━━━━━
※このメールは自動送信されています。`;

  GmailApp.sendEmail(email, subject, body, { name: '農業AI通信｜Metagri研究所' });

  MailApp.sendEmail({
    to: NOTIFICATION_EMAIL,
    subject: '【農業AI通信】VibeCodingスタートガイド 新規登録',
    body: `VibeCodingスタートガイドに登録がありました。\n\nお名前: ${name || '未記入'}\nメール: ${email}\n\nスプレッドシートで確認:\nhttps://docs.google.com/spreadsheets/d/1FVcqS0Ze2bouVIqHpHger3WaU5x8TSYqqHk8ZKAhSEU\n\n※自動送信`
  });
}


/**
 * アンバサダーLP応募データを専用シートに保存
 */
function saveAmbassadorDetail(data) {
  const SPREADSHEET_ID = '1FVcqS0Ze2bouVIqHpHger3WaU5x8TSYqqHk8ZKAhSEU';
  const SHEET_NAME = 'アンバサダーLP応募';
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    const headers = ['タイムスタンプ', 'メールアドレス', 'お名前', '農園名・組織名', '主な作目・品目', '関心テーマ', 'AI活用経験', '営農形態', '登録のきっかけ・期待', 'その他', 'ページURL', 'utm_source', 'utm_medium', 'utm_campaign', 'ステータス'];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground('#064e3b').setFontColor('#ffffff').setFontWeight('bold').setHorizontalAlignment('center');
    sheet.setColumnWidth(1, 160); sheet.setColumnWidth(2, 220); sheet.setColumnWidth(6, 250); sheet.setColumnWidth(9, 300); sheet.setColumnWidth(10, 250);
  }

  const row = [
    data.timestamp || new Date().toLocaleString('ja-JP'),
    data.email || '-', data.name || '-', data.orgName || '-', data.department || '-',
    data.interest || '-', data.material || '-', data.decisionFlow || '-',
    data.usagePlan || '-', data.message || '-',
    data.page_url || '-', data.utm_source || '-', data.utm_medium || '-', data.utm_campaign || '-', '未対応'
  ];
  sheet.appendRow(row);
  sheet.getRange(sheet.getLastRow(), 1, 1, row.length).setBorder(true, true, true, true, true, true).setVerticalAlignment('top');
}


/**
 * スターターキットLP応募データを専用シートに保存
 */
function saveStarterKitDetail(data) {
  const SPREADSHEET_ID = '1FVcqS0Ze2bouVIqHpHger3WaU5x8TSYqqHk8ZKAhSEU';
  const SHEET_NAME = 'スターターキットLP応募';
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    const headers = ['タイムスタンプ', 'メールアドレス', 'お名前', '農園名・屋号', '就農年数', '主な作物', '困っていること', '個別コンサル', 'メルマガ購読', 'その他', 'ページURL', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ステータス'];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground('#1a5c2e').setFontColor('#ffffff').setFontWeight('bold').setHorizontalAlignment('center');
    sheet.setColumnWidth(1, 160); sheet.setColumnWidth(2, 220); sheet.setColumnWidth(7, 300); sheet.setColumnWidth(10, 250);
  }

  const row = [
    data.timestamp || new Date().toLocaleString('ja-JP'),
    data.email || '-', data.name || '-', data.farmName || '-', data.farmingYear || '-',
    data.crop || '-', data.challenge || '-', data.consul || '-', data.newsletter || '-', data.message || '-',
    data.page_url || '-', data.utm_source || '-', data.utm_medium || '-', data.utm_campaign || '-',
    data.utm_term || '-', data.utm_content || '-', '未対応'
  ];
  sheet.appendRow(row);
  sheet.getRange(sheet.getLastRow(), 1, 1, row.length).setBorder(true, true, true, true, true, true).setVerticalAlignment('top');
}


/**
 * VibeCoding LP応募データを専用シートに保存
 */
function saveVibeCodingDetail(data) {
  const SPREADSHEET_ID = '1FVcqS0Ze2bouVIqHpHger3WaU5x8TSYqqHk8ZKAhSEU';
  const SHEET_NAME = 'VibeCodingLP応募';
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    const headers = ['タイムスタンプ', 'メールアドレス', 'お名前', '農園名・組織名', '主な作目・品目', 'AI活用経験', '関心テーマ', 'メルマガ購読', 'その他', 'ページURL', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ステータス'];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground('#1a3a5c').setFontColor('#ffffff').setFontWeight('bold').setHorizontalAlignment('center');
    sheet.setColumnWidth(1, 160); sheet.setColumnWidth(2, 220); sheet.setColumnWidth(7, 300); sheet.setColumnWidth(9, 250);
  }

  const row = [
    data.timestamp || new Date().toLocaleString('ja-JP'),
    data.email || '-', data.name || '-', data.orgName || '-', data.crop || '-',
    data.aiExperience || '-', data.interest || '-', data.newsletter || '-', data.message || '-',
    data.page_url || '-', data.utm_source || '-', data.utm_medium || '-', data.utm_campaign || '-',
    data.utm_term || '-', data.utm_content || '-', '未対応'
  ];
  sheet.appendRow(row);
  sheet.getRange(sheet.getLastRow(), 1, 1, row.length).setBorder(true, true, true, true, true, true).setVerticalAlignment('top');
}
