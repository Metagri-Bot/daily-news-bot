// https://script.google.com/u/0/home/projects/195kDZj-Qe4iqWOU01ovIoa30kaLW-gXiYIC3gdFqShkirtPNWf0oCOVZ/edit
// ========================================
// 農業AI通信 受信専用 Bot (A1/A2 上書き版)
// ========================================

/**
 * POST リクエスト処理
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    
    if (data.type === 'aiGuide') {
      logAiGuide(data);
      return ContentService.createTextOutput(JSON.stringify({ success: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'Unknown type' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    Logger.log('[doPost] エラー: ' + error.toString());
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 農業AI通信の投稿記録を保存 (A1, A2に上書き)
 */
function logAiGuide(data) {
  const ss = SpreadsheetApp.openById('1FVcqS0Ze2bouVIqHpHger3WaU5x8TSYqqHk8ZKAhSEU');
  
  // 指定されたGID（1834867434）のシートを探す
  const sheets = ss.getSheets();
  let sheet = sheets.find(s => s.getSheetId() == 1834867434);
  if (!sheet) {
    sheet = sheets[0];
    Logger.log('指定されたGIDが見つからないため、最初のシートを使用します。');
  }

  // --- 1. 配列データの箇条書き変換用関数 ---
  const formatList = (items, prefix = '・') => {
    if (Array.isArray(items)) return items.map(item => `${prefix} ${item}`).join('\n');
    return items || '';
  };

  // --- 2. 記事情報の組み立て（新項目 facts, evidence に対応） ---
  const contentParts = [];
  
  contentParts.push(`【${data.title || 'タイトルなし'}】\n`);
  contentParts.push(`${data.summary || ''}\n`);

  if (data.facts && data.facts.length > 0) {
    contentParts.push(`＜確認できた事実＞\n${formatList(data.facts)}`);
  }

  if (data.keyPoints && data.keyPoints.length > 0) {
    contentParts.push(`\n＜要点＞\n${formatList(data.keyPoints, '1.')}`);
  }

  if (data.actionable) {
    contentParts.push(`\n💡 実践のヒント: ${data.actionable}`);
  }

  if (data.evidence && data.evidence.length > 0) {
    contentParts.push(`\n＜根拠/キーワード＞\n${formatList(data.evidence, '-')}`);
  }

  const articleInfo = contentParts.join('\n').trim();

  // --- 3. URLのクレンジング ---
  let cleanUrl = data.url || '';
  if (cleanUrl.includes('?utm')) {
    cleanUrl = cleanUrl.split('?utm')[0];
  }

  // --- 4. 書き込み（上書き処理） ---
  try {
    // A1セルに記事情報を書き込み
    const rangeA1 = sheet.getRange('A1');
    rangeA1.setValue(articleInfo);
    rangeA1.setWrap(true);
    rangeA1.setVerticalAlignment('top');

    // A2セルにURLを書き込み
    const rangeA2 = sheet.getRange('A2');
    rangeA2.setValue(cleanUrl);

    // 列幅の調整
    sheet.setColumnWidth(1, 800); 

    Logger.log(`[logAiGuide] A1/A2に上書き完了: ${data.title}`);
  } catch (e) {
    Logger.log(`[logAiGuide] 書き込みエラー: ${e.toString()}`);
    throw e; // エラーをdoPostに渡す
  }
}

/**
 * 生存確認用
 */
function doGet() {
  return ContentService.createTextOutput("Agriculture AI Receiver (Overwrite Mode) is Active.");
}