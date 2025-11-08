# Google Apps Script (GAS) 連携ドキュメント - 新刊紹介機能

## 概要

新刊紹介機能では、一度投稿した書籍を二度と投稿しないよう、Google Sheets で投稿済み書籍のISBNを管理しています。

## 必要なシート構成

Google Spreadsheetsに以下のシートを追加してください：

### `Posted_Books` シート

投稿済み書籍のISBNを記録するシート

| 列名 | 説明 | データ型 | 例 |
|------|------|---------|-----|
| A: `timestamp` | 投稿日時 | DateTime | 2025-11-08 09:00:00 |
| B: `isbn` | 書籍のISBN | String | 978-4-7981-8000-0 |
| C: `title` | 書籍タイトル | String | スマート農業入門 |
| D: `author` | 著者名 | String | 山田太郎 |
| E: `publisher` | 出版社 | String | 技術評論社 |
| F: `pubdate` | 発売日 | String | 20241101 |
| G: `score` | スコア | Number | 15 |
| H: `categories` | カテゴリ | String | 技術革新 + コア農業 |
| I: `bookType` | 書籍タイプ | String | agritech / popular |
| J: `postedDate` | 投稿日時（ISO） | String | 2025-11-08T00:00:00.000Z |

## GAS コード実装

`Code.gs` に以下のコードを追加してください：

```javascript
// ========================================
// 新刊紹介機能: 投稿済み書籍管理
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
  if (lastRow <= 1) return []; // ヘッダーのみの場合

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

  // Posted_Booksシートを取得（なければ作成）
  let sheet = ss.getSheetByName('Posted_Books');
  if (!sheet) {
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
  sheet.appendRow([
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
  ]);

  Logger.log(`[logNewBook] 新刊を記録しました: ${data.title} (ISBN: ${data.isbn})`);
}

/**
 * 既存のdoPost関数に新刊タイプの処理を追加
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const type = data.type;

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
    // ========== 新刊紹介機能用の処理を追加 ==========
    else if (type === 'newBook') {
      logNewBook(data);
    } else if (type === 'getPostedBooks') {
      // 投稿済みISBNリストを返す
      const isbns = getPostedBooks();
      return ContentService.createTextOutput(JSON.stringify(isbns))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    Logger.log('Error in doPost: ' + error.toString());
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
```

## Bot側の実装

### 起動時の処理

Bot起動時に投稿済みISBNリストを取得してキャッシュします：

```javascript
client.once("ready", async () => {
  await syncPostedBooksFromSheet(); // 投稿済み書籍リストを同期
  // ... 他の初期化処理
});
```

### 投稿時の処理

新刊を投稿する際、以下の処理を行います：

1. **投稿前チェック**: ISBNが投稿済みリストに含まれていないか確認
2. **Discord投稿**: Embedメッセージを投稿
3. **キャッシュ更新**: 投稿済みISBNをメモリキャッシュに追加
4. **GAS記録**: Google Sheetsに投稿記録を保存

```javascript
// 投稿済みチェック
if (score > 0 && isbn && !postedBookIsbns.has(isbn)) {
  // 未投稿の書籍のみ候補に追加
  scoredBooks.push({ book, score, categories });
}

// 投稿後
if (bookData.isbn) {
  postedBookIsbns.add(bookData.isbn);
}

await logToSpreadsheet('newBook', {
  title: bookData.title,
  isbn: bookData.isbn,
  bookType: 'agritech', // または 'popular'
  // ... その他のデータ
});
```

## データフロー

```
[Bot起動]
   ↓
[GASにリクエスト: type='getPostedBooks']
   ↓
[GAS: Posted_Booksシートから全ISBNを取得]
   ↓
[Bot: メモリキャッシュに保存]
   ↓
[定期実行: 毎日9:00, 10:00]
   ↓
[新刊API取得 → スコアリング → 投稿済みフィルタリング]
   ↓
[未投稿の最高スコア書籍を選定]
   ↓
[Discord投稿]
   ↓
[GASにリクエスト: type='newBook', data={...}]
   ↓
[GAS: Posted_Booksシートに記録]
   ↓
[Bot: メモリキャッシュに追加]
```

## 重複防止の仕組み

1. **ISBNベースの管理**: 書籍の一意識別子であるISBNを使用
2. **メモリキャッシュ**: Bot起動中は高速アクセス可能
3. **永続化**: Google Sheetsで長期保存
4. **起動時同期**: Bot再起動時も過去の投稿履歴を引き継ぐ

## トラブルシューティング

### ISBNが重複して投稿される場合

1. `Posted_Books`シートが正しく作成されているか確認
2. GASの`doPost`関数が正しくデプロイされているか確認
3. Bot起動ログで「X件の投稿済み書籍を読み込みました」と表示されるか確認

### 書籍が全く投稿されない場合

1. 環境変数`NEW_BOOK_CHANNEL_ID`と`POPULAR_BOOK_CHANNEL_ID`が設定されているか確認
2. スコアリングで基準を満たす書籍があるか確認
3. 投稿済みチェックで全て除外されていないか確認

## メンテナンス

### 投稿履歴のクリア

テストや誤投稿の修正のため、特定のISBNを削除したい場合：

1. Google Sheetsの`Posted_Books`シートを開く
2. 該当するISBNの行を削除
3. Botを再起動（キャッシュを更新）

### 定期的なデータ整理

長期運用により`Posted_Books`シートが大きくなった場合、古いデータをアーカイブすることを推奨します。
