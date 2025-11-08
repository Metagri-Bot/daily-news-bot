// ========================================
// Daily News Bot - Google Apps Script
// ========================================

/**
 * POST リクエスト処理
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const type = data.type;

    Logger.log(`[doPost] リクエスト受信: type=${type}`);

    // ========== 新刊紹介機能用の処理 ==========
    if (type === 'newBook') {
      logNewBook(data);
      return ContentService.createTextOutput(JSON.stringify({ success: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 既存の処理
    if (type === 'discussion') {
      logDiscussion(data);
    } else if (type === 'news') {
      logNews(data);
    } else if (type === 'addArticles') {
      logArticles(data.articles);
    } else if (type === 'globalResearch') {
      logGlobalResearch(data);
    }

    return ContentService.createTextOutput(JSON.stringify({ success: true }))
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
 * GET リクエスト処理
 */
function doGet(e) {
  try {
    const type = e.parameter.type;

    Logger.log(`[doGet] リクエスト受信: type=${type}`);

    if (type === 'getPostedBooks') {
      // 投稿済みISBNリストを返す
      const isbns = getPostedBooks();
      Logger.log(`[doGet] ${isbns.length}件のISBNを返却`);
      return ContentService.createTextOutput(JSON.stringify(isbns))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 既存のGET処理（Posted_URLs取得など）
    // 例: if (type === 'getPostedUrls') { ... }

    return ContentService.createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    Logger.log('[doGet] エラー: ' + error.toString());
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ========================================
// 新刊紹介機能
// ========================================

/**
 * 投稿済み書籍のISBNリストを取得
 * @returns {Array<string>} ISBNの配列
 */
function getPostedBooks() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Posted_Booksシートを取得（なければ作成）
  let sheet = ss.getSheetByName('Posted_Books');
  if (!sheet) {
    Logger.log('[getPostedBooks] Posted_Booksシートを新規作成');
    sheet = ss.insertSheet('Posted_Books');
    // ヘッダー行を追加
    sheet.appendRow([
      'timestamp',
      'isbn',
      'title',
      'author',
      'publisher',
      'pubdate',
      'score',
      'categories',
      'bookType',
      'postedDate'
    ]);
    return [];
  }

  // ISBNカラム（B列）のデータを取得
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    Logger.log('[getPostedBooks] データなし（ヘッダーのみ）');
    return [];
  }

  const isbnRange = sheet.getRange(2, 2, lastRow - 1, 1);
  const isbnValues = isbnRange.getValues();

  // 空でないISBNのみを抽出
  const isbns = isbnValues
    .map(row => row[0])
    .filter(isbn => isbn && isbn.toString().trim() !== '');

  Logger.log(`[getPostedBooks] ${isbns.length}件の投稿済みISBNを返却`);
  return isbns;
}

/**
 * 新刊書籍の投稿記録を保存
 * @param {Object} data 書籍データ
 */
function logNewBook(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  Logger.log('[logNewBook] データ受信: ' + JSON.stringify(data));

  // Posted_Booksシートを取得（なければ作成）
  let sheet = ss.getSheetByName('Posted_Books');
  if (!sheet) {
    Logger.log('[logNewBook] Posted_Booksシートを新規作成');
    sheet = ss.insertSheet('Posted_Books');
    // ヘッダー行を追加
    sheet.appendRow([
      'timestamp',
      'isbn',
      'title',
      'author',
      'publisher',
      'pubdate',
      'score',
      'categories',
      'bookType',
      'postedDate'
    ]);
  }

  // データを追加
  const row = [
    new Date(),
    data.isbn || '',
    data.title || '',
    data.author || '',
    data.publisher || '',
    data.pubdate || '',
    data.score || 0,
    data.categories || '',
    data.bookType || '', // 'agritech' or 'popular'
    data.postedDate || new Date().toISOString()
  ];

  sheet.appendRow(row);

  Logger.log(`[logNewBook] 新刊を記録しました: ${data.title} (ISBN: ${data.isbn})`);
}

// ========================================
// 既存の機能（例）
// 以下は既存のコードに合わせて実装してください
// ========================================

/**
 * 議論ログを記録
 */
function logDiscussion(data) {
  // 既存の実装
  Logger.log('[logDiscussion] 議論ログを記録');
}

/**
 * ニュースを記録
 */
function logNews(data) {
  // 既存の実装
  Logger.log('[logNews] ニュースを記録');
}

/**
 * 記事を記録
 */
function logArticles(articles) {
  // 既存の実装
  Logger.log('[logArticles] 記事を記録');
}

/**
 * 海外文献を記録
 */
function logGlobalResearch(data) {
  // 既存の実装
  Logger.log('[logGlobalResearch] 海外文献を記録');
}
