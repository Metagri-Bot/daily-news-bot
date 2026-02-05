// https://script.google.com/u/0/home/projects/195kDZj-Qe4iqWOU01ovIoa30kaLW-gXiYIC3gdFqShkirtPNWf0oCOVZ/edit
/* ========================================
   統合版 doPost (フォーム登録 + 農業AI通信Bot)
======================================== */

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    
    const data = JSON.parse(e.postData.contents);
    
    // --- 分岐1: 農業AI通信Bot (A1/A2 上書き) の場合 ---
    if (data.type === 'aiGuide') {
      return handleAiGuide(data);
    }
    
    // --- 分岐2: フォームからの登録 (スプシ追記) の場合 ---
    // data.email があればフォームからの送信と判断
    if (data.email) {
      return handleFormRegistration(data);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Unknown request type' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.toString() }))
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
    data.timestamp || new Date().toLocaleString('ja-JP'),
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
  
  // ★ 変更箇所：登録タイプで分岐
  if (data.email) {
    if (data.registration_type === 'Nano Banana Pro特典登録') {
      sendNanoBananaProEmail(data.email, data.name);
    } else {
      sendAutoReplyEmail(data.email, data.name);
    }
  }
  
  return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
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
  if (data.facts) contentParts.push(`＜確認できた事実＞\n${formatList(data.facts)}`);
  if (data.keyPoints) contentParts.push(`\n＜要点＞\n${formatList(data.keyPoints, '1.')}`);
  if (data.actionable) contentParts.push(`\n💡 実践のヒント: ${data.actionable}`);
  if (data.evidence) contentParts.push(`\n＜根拠/キーワード＞\n${formatList(data.evidence, '-')}`);

  const articleInfo = contentParts.join('\n').trim();
  let cleanUrl = (data.url || '').split('?utm')[0];

  sheet.getRange('A1').setValue(articleInfo).setWrap(true).setVerticalAlignment('top');
  sheet.getRange('A2').setValue(cleanUrl);
  sheet.setColumnWidth(1, 800);

  return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 自動返信メール送信
 */
function sendAutoReplyEmail(email, name) {
  const subject = '【農業AI通信】テンプレート集をお届けします';
  const body = `${name} 様\n\n農業AI通信にご登録いただき、誠にありがとうございます。\n\n「農家のための生成AIテンプレート集」のダウンロードリンクは下記です。\nhttps://metagrilabo.notion.site/xxx\n\n━━━━━━━━━━━━━━━━━━━━\n農業AI通信 / Metagri研究所\n━━━━━━━━━━━━━━━━━━━━`;
  
  GmailApp.sendEmail(email, subject, body, { name: 'Metagri研究所' });
}

/** 
 * Nano Banana Pro特典用メール送信
 */
function sendNanoBananaProEmail(email, name) {
  const subject = '【農業AI通信】画像生成AIテクニック集をお届けします';
  const body = `
農業AI通信にご登録いただき、誠にありがとうございます！

「農家のための画像生成AI利用テクニック集」のダウンロードリンクは下記です。
https://metagrilabo.notion.site/nano-banana-pro-present

これからもよろしくお願いします！

--------------------------------------------------
農業AI通信 編集部
https://metagri-labo.com/ai-guide
運営：Metagri研究所（株式会社農情人）
--------------------------------------------------
`;
  
  GmailApp.sendEmail(email, subject, body, { name: 'Metagri研究所' });
}