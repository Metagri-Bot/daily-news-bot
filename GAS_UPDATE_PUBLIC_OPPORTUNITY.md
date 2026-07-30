# GAS更新手順書（公募モニター対応版）

**作成日**: 2026-07-30
**対象**: daily-news-bot が参照するメインのGoogle Apps Script（`GOOGLE_APPS_SCRIPT_URL`）
**目的**: 官公庁・自治体 公募モニターの通知履歴を `Public_Opportunities` シートに記録し、同じ案件を二度投稿しないようにする

このファイルの完全版コードは、リポジトリの `.gascode` と同一内容です。

---

## 1. 何が変わるか

現行コードに **追加するだけ** で、既存の処理（discussion / news / addArticles / globalResearch / getDiscussionMetrics / getRecentNews / newBook / aiGuide / doGet）は一切変更しません。

| 追加するもの | 内容 |
|---|---|
| `doPost` の分岐 `getPublicOpportunities` | 通知履歴を返す。Botが実行前に読み、既に通知した案件を除外する |
| `doPost` の分岐 `publicOpportunities` | 通知履歴を記録する。`id`列が一致する行は更新（行を増やさない） |
| 定数 `PUBLIC_OPPORTUNITY_SHEET_NAME` / `PUBLIC_OPPORTUNITY_HEADERS` / `PUBLIC_OPPORTUNITY_TEXT_COLUMNS` | シート名・列定義 |
| 関数 `getPublicOpportunitySheet_` | シートの取得・自動作成・列書式の固定 |
| 関数 `toIsoText_` | 日付セルをISO文字列へ正規化 |
| 関数 `getPublicOpportunities` | 履歴の読み取り |
| 関数 `upsertPublicOpportunities` | 履歴の upsert（`LockService` で二重追記を防止） |
| 関数 `testPublicOpportunities` | エディタから実行する動作確認用 |

### なぜBot側だけでは足りないのか

Botは起動時と実行時にこのGASへ `getPublicOpportunities` を投げます。GASが未対応だと `Unknown type` が返り、Botは「シート履歴なし」と判断してローカルの履歴ファイルだけで重複判定します。サーバー移行やコンテナ再作成でローカル履歴が消えると、過去案件が再通知される可能性が残ります。

---

## 2. 更新手順

1. スプレッドシートを開き、**拡張機能 → Apps Script**
2. エディタのコードを、下の「3. 完全版コード」で**全置換**する
3. 保存（Ctrl+S / ⌘+S）
4. エディタ上部の関数選択で `testPublicOpportunities` を選び、**実行**
   - 初回は権限承認のダイアログが出ます（承認 → 詳細 → 安全でないページに移動 → 許可）
   - 実行ログに `upsert結果: {"inserted":1,"updated":0}` が出れば成功
   - `Public_Opportunities` シートが自動作成されるので、**テスト行（id = test0000000000000000）は削除**しておく
5. **デプロイ → デプロイを管理 → 編集（鉛筆アイコン）→ バージョン「新バージョン」→ デプロイ**
   - ここで新バージョンにしないと、既存URLでは古いコードが動き続けます（**最も多い失敗**）
   - 「次のユーザーとして実行: 自分」「アクセスできるユーザー: 全員」の設定は変更しない
6. Bot側から疎通確認（`daily-news-bot` ディレクトリで実行）

```bash
node -e "require('dotenv').config();require('./public-opportunity-store').fetchRemoteHistory(process.env.GOOGLE_APPS_SCRIPT_URL).then(r=>console.log(r.status, r.status==='ok'?Object.keys(r.seen).length+'件':''))"
```

| 出力 | 意味 |
|---|---|
| `ok 0件` | 成功（履歴が空の状態） |
| `not_deployed` | GASが旧バージョンのまま。手順5をやり直す |
| `unavailable` | 通信失敗。URLとネットワークを確認 |
| `disabled` | `.env` の `GOOGLE_APPS_SCRIPT_URL` が未設定 |

---

## 3. 完全版コード

エディタのコードをこの内容で全置換してください。

```javascript
// ====================================================================
//  メインロジック (Botからのリクエスト受信)
// ====================================================================

/**
 * BotからのPOSTリクエストを処理する関数
 * 主にデータの【書き込み】や【複雑な取得】を行う
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const type = data.type; // ここで type を定義しておくことでミスを防ぎます

    // --- ログ記録処理 ---

    if (type === 'discussion') {
      const sheet = getSheetByName(spreadsheet, "User");
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["日時", "ユーザーID", "ユーザー名", "投稿内容", "元ニュースのタイトル", "元ニュースのURL", "元ニュースの投稿日", "ロール"]);
      }
      sheet.appendRow([ new Date(data.timestamp), data.userId, data.username, data.content, data.newsTitle, data.newsUrl, new Date(data.newsPostDate), data.userRole ]);
      return createSuccessResponse();
    }

    else if (type === 'news') {
      const sheet = getSheetByName(spreadsheet, "News");
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["投稿日時", "タイトル", "URL", "ニュースの日付", "AIの見解", "AIの質問"]);
      }
      sheet.appendRow([ new Date(), data.title, data.link, data.newsDate, data.metagriInsight, Array.isArray(data.discussionQuestions) ? data.discussionQuestions.join('\n') : data.discussionQuestions ]);
      return createSuccessResponse();
    }

    else if (type === 'addArticles') {
      const sheet = getSheetByName(spreadsheet, "Posted_URLs");
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["投稿日時", "URL", "タイトル", "記事の日付", "優先度", "スコア"]);
      }
      const now = new Date();
      const rows = data.articles.map(article => [now, article.url, article.title, new Date(article.pubDate), article.priority, article.score]);
      if (rows.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
      }
      return createSuccessResponse();
    }

    else if (type === 'globalResearch') {
      const sheet = getSheetByName(spreadsheet, "GlobalResearch");
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["投稿日時", "原文タイトル", "日本語タイトル", "URL", "要約", "重要ポイント", "日本の農業への示唆", "原文公開日"]);
      }
      const keyPoints = Array.isArray(data.keyPoints) ? data.keyPoints.join('\n') : data.keyPoints;
      sheet.appendRow([ new Date(), data.titleOriginal, data.titleJa, data.link, data.summary, keyPoints, data.implications, new Date(data.publishDate) ]);
      return createSuccessResponse();
    }

    // --- 取得系処理 ---

    else if (type === 'getDiscussionMetrics') {
      const sheet = spreadsheet.getSheetByName("User");
      if (!sheet || sheet.getLastRow() <= 1) {
        return createJsonResponse([]);
      }
      const allData = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
      const result = allData.map(row => ({
        timestamp: row[0], userId: row[1], username: row[2], content: row[3],
        newsTitle: row[4], newsUrl: row[5], newsPostDate: row[6], userRole: row[7]
      }));
      return createJsonResponse(result);
    }

    else if (type === 'getRecentNews') {
      const days = data.days || 7;
      const sheet = spreadsheet.getSheetByName("News");
      if (!sheet || sheet.getLastRow() <= 1) {
        return createJsonResponse([]);
      }
      const allData = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const recentNews = allData
        .filter(row => new Date(row[0]) >= cutoffDate)
        .map(row => ({
          publishDate: row[0], title: row[1], url: row[2],
          newsDate: row[3], insight: row[4], questions: row[5]
        }));
      return createJsonResponse(recentNews);
    }

    // --- 新機能（外部関数呼び出し） ---

    else if (type === 'newBook') {
      logNewBook(data);
      return createSuccessResponse();
    }

    else if (type === 'aiGuide') {
      logAiGuide(data); // 農業AI通信の記録を実行
      return createSuccessResponse(); // 成功レスポンスを返して終了
    }

    // --- 公募モニター（重複投稿の防止） ---

    // 通知履歴の取得。Botは実行前にこれを読み、既に通知した案件を除外する
    else if (type === 'getPublicOpportunities') {
      return createJsonResponse(getPublicOpportunities());
    }

    // 通知履歴の記録。id列が一致する行は更新し、行を増やさない
    else if (type === 'publicOpportunities') {
      const upsertResult = upsertPublicOpportunities(data.records);
      return createJsonResponse({
        "result": "success",
        "inserted": upsertResult.inserted,
        "updated": upsertResult.updated
      });
    }

    // どのタイプにも一致しない場合
    Logger.log("Received unknown data type: " + type);
    return createJsonResponse({ "result": "error", "message": "Unknown type: " + type });

  } catch (error) {
    Logger.log("Error in doPost: " + error.message);
    return createJsonResponse({ "result": "error", "message": error.message });
  }
}

/**
 * 成功時のレスポンスを作成するヘルパー関数
 */
function createSuccessResponse() {
  return ContentService.createTextOutput(JSON.stringify({ "result": "success" }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * JSONレスポンスを作成するヘルパー関数
 */
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * BotからのGETリクエストに応答する関数
 * 主に単純なデータの【読み取り】を行う
 * 【修正箇所】typeパラメータに応じて処理を分岐するように変更
 */
function doGet(e) {
  try {
    // === 投稿済み書籍リストの取得（?type=getPostedBooks）===
    if (e.parameter.type === 'getPostedBooks') {
      const isbns = getPostedBooks();
      return ContentService.createTextOutput(JSON.stringify(isbns))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // === 投稿済みURLリストの取得（type指定なし or それ以外）===
    else {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Posted_URLs");
      if (!sheet || sheet.getLastRow() < 2) {
        return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
      }
      const data = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
      const urls = data.map(row => row[0]).filter(url => url);
      return ContentService.createTextOutput(JSON.stringify(urls)).setMimeType(ContentService.MimeType.JSON);
    }

  } catch (error) {
    Logger.log("Error in doGet: " + error.message);
    return ContentService.createTextOutput(JSON.stringify({ "result": "error", "message": error.message })).setMimeType(ContentService.MimeType.JSON);
  }
}


// ====================================================================
//  ヘルパー関数
// ====================================================================

function getSheetByName(spreadsheet, name) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }
  return sheet;
}

// ========================================
//  新刊紹介機能の関数
// ========================================

function getPostedBooks() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Posted_Books');
  if (!sheet || sheet.getLastRow() <= 1) {
    return [];
  }
  const isbnRange = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1);
  const isbnValues = isbnRange.getValues();
  const isbns = isbnValues.map(row => row[0]).filter(isbn => isbn && isbn.toString().trim() !== '');
  Logger.log(`[getPostedBooks] ${isbns.length}件の投稿済みISBNを返却`);
  return isbns;
}

function logNewBook(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = 'Posted_Books';
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow([
      'timestamp', 'isbn', 'title', 'author', 'publisher', 'pubdate',
      'score', 'categories', 'bookType', 'postedDate'
    ]);
  }

  sheet.appendRow([
    new Date(),
    data.isbn || '',
    data.title || '',
    Array.isArray(data.author) ? data.author.join(', ') : (data.author || ''),
    data.publisher || '',
    data.pubdate || '',
    data.score || 0,
    Array.isArray(data.categories) ? data.categories.join(', ') : (data.categories || ''),
    data.bookType || '',
    data.postedDate || new Date().toISOString()
  ]);
  Logger.log(`[logNewBook] 新刊を記録しました: ${data.title} (ISBN: ${data.isbn})`);
}


// ========================================
//  公募モニター（Public_Opportunities）
//  daily-news-bot の重複投稿防止の「正」となる履歴シート
// ========================================

const PUBLIC_OPPORTUNITY_SHEET_NAME = 'Public_Opportunities';
const PUBLIC_OPPORTUNITY_HEADERS = [
  'id',
  'signature',
  'title',
  'url',
  'organization',
  'deadline',
  'rank',
  'score',
  'first_notified_at',
  'last_notified_at',
  'last_checked_at'
];

// id・signature・日時の列。書式なしテキストに固定して自動変換を防ぐ
const PUBLIC_OPPORTUNITY_TEXT_COLUMNS = ['A', 'B', 'F', 'I', 'J', 'K'];

/**
 * Public_Opportunitiesシートを取得（なければヘッダー付きで作成）
 */
function getPublicOpportunitySheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(PUBLIC_OPPORTUNITY_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(PUBLIC_OPPORTUNITY_SHEET_NAME);
    sheet.appendRow(PUBLIC_OPPORTUNITY_HEADERS);
    sheet.setFrozenRows(1);
    Logger.log('[PublicOpportunity] シートを新規作成しました');
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(PUBLIC_OPPORTUNITY_HEADERS);
    sheet.setFrozenRows(1);
  }

  // 重要: id・signature・日時列は必ず「書式なしテキスト」にする。
  // 数値や日付に自動変換されるとBotが計算したハッシュ・締切と一致せず、
  // 同じ案件を毎回「更新」として再通知してしまう。
  PUBLIC_OPPORTUNITY_TEXT_COLUMNS.forEach(function (column) {
    sheet.getRange(column + '1:' + column).setNumberFormat('@');
  });

  return sheet;
}

/**
 * 日付セル（Date型）をISO文字列に正規化する。Botは文字列で受け取る前提。
 */
function toIsoText_(value) {
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX");
  }
  return value.toString();
}

/**
 * 通知済み公募の履歴を返す
 * @returns {Array<Object>} レコードの配列
 */
function getPublicOpportunities() {
  const sheet = getPublicOpportunitySheet_();
  if (sheet.getLastRow() <= 1) {
    Logger.log('[PublicOpportunity] 履歴なし（ヘッダーのみ）');
    return [];
  }

  const values = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, PUBLIC_OPPORTUNITY_HEADERS.length)
    .getValues();

  const records = values
    .filter(function (row) {
      return row[0] && row[0].toString().trim() !== '';
    })
    .map(function (row) {
      return {
        id: row[0].toString().trim(),
        signature: row[1].toString().trim(),
        title: row[2],
        url: row[3],
        organization: row[4],
        deadline: toIsoText_(row[5]),
        rank: row[6],
        score: row[7],
        first_notified_at: toIsoText_(row[8]),
        last_notified_at: toIsoText_(row[9]),
        last_checked_at: toIsoText_(row[10])
      };
    });

  Logger.log(`[PublicOpportunity] ${records.length}件の履歴を返却`);
  return records;
}

/**
 * 通知済み公募を記録する。id列が一致する行があれば更新、なければ追記。
 * @param {Array<Object>} records Botから送られたレコード
 * @returns {Object} 追加件数・更新件数
 */
function upsertPublicOpportunities(records) {
  if (!records || !records.length) {
    return { inserted: 0, updated: 0 };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000); // 同時実行による二重追記を防ぐ

  try {
    const sheet = getPublicOpportunitySheet_();
    const lastRow = sheet.getLastRow();

    // 既存id → 行番号のマップを作る
    const rowById = {};
    if (lastRow > 1) {
      const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i][0];
        if (id && id.toString().trim() !== '') {
          rowById[id.toString().trim()] = i + 2;
        }
      }
    }

    let inserted = 0;
    let updated = 0;
    const appendRows = [];

    records.forEach(function (record) {
      const id = (record.id || '').toString().trim();
      if (!id || !record.signature) return;

      const row = [
        id,
        record.signature,
        record.title || '',
        record.url || '',
        record.organization || '',
        record.deadline || '',
        record.rank || '',
        record.score === undefined || record.score === null ? '' : record.score,
        record.first_notified_at || '',
        record.last_notified_at || '',
        record.last_checked_at || ''
      ];

      if (rowById[id]) {
        sheet.getRange(rowById[id], 1, 1, row.length).setValues([row]);
        updated++;
      } else {
        appendRows.push(row);
        inserted++;
      }
    });

    if (appendRows.length > 0) {
      sheet
        .getRange(sheet.getLastRow() + 1, 1, appendRows.length, PUBLIC_OPPORTUNITY_HEADERS.length)
        .setValues(appendRows);
    }

    Logger.log(`[PublicOpportunity] 追加${inserted}件・更新${updated}件を記録`);
    return { inserted: inserted, updated: updated };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 動作確認用。Apps Scriptのエディタから直接実行してログを確認する。
 */
function testPublicOpportunities() {
  const before = getPublicOpportunities();
  Logger.log('現在の履歴件数: ' + before.length);

  const result = upsertPublicOpportunities([{
    id: 'test0000000000000000',
    signature: 'test-signature',
    title: 'テスト案件（あとで行を削除してください）',
    url: 'https://example.go.jp/test',
    organization: 'テスト省',
    deadline: '2026-12-31T17:00:00+09:00',
    rank: 'A',
    score: 70,
    first_notified_at: new Date().toISOString(),
    last_notified_at: new Date().toISOString(),
    last_checked_at: new Date().toISOString()
  }]);
  Logger.log('upsert結果: ' + JSON.stringify(result));
  Logger.log('確認後、Public_Opportunitiesシートのテスト行を削除してください');
}


// // ========================================
// // 農業AI通信機能
// // ========================================
// // 注意: 現在この関数はコメントアウトされています。
// // doPostの type === 'aiGuide' 分岐から呼び出されるため、有効化しないまま
// // aiGuideのリクエストが来ると「logAiGuide is not defined」でエラーになります。
// // 農業AI通信は別デプロイ（AIGuideCode.gs / AI_GUIDE_GAS_URL）で記録しているため、
// // こちらで使う場合はコメントを解除してください。

// /**
//  * 農業AI通信の投稿記録を保存
//  * @param {Object} data 農業AI通信データ
//  */
// function logAiGuide(data) {
//   const ss = SpreadsheetApp.openById('1175r6MLXn9renkA1tvvKWovhKDa3r_axmv081WjFSoo');

//   Logger.log('[logAiGuide] データ受信: ' + JSON.stringify(data));

//   // AI_Guide_Logシートを取得（なければ作成）
//   let sheet = ss.getSheetByName('AI_Guide_Log');
//   if (!sheet) {
//     Logger.log('[logAiGuide] AI_Guide_Logシートを新規作成');
//     sheet = ss.insertSheet('AI_Guide_Log');
//     // ヘッダー行を追加
//     sheet.appendRow([
//       'timestamp',
//       'title',
//       'url',
//       'summary',
//       'keyPoints',
//       'actionable',
//       'articleDate'
//     ]);
//     // ヘッダー行のフォーマット
//     sheet.getRange(1, 1, 1, 7).setFontWeight('bold');
//   }

//   // 要点を文字列に変換（配列の場合）
//   let keyPointsStr = '';
//   if (Array.isArray(data.keyPoints)) {
//     keyPointsStr = data.keyPoints.join('\n');
//   } else if (data.keyPoints) {
//     keyPointsStr = data.keyPoints;
//   }

//   // データを追加
//   const row = [
//     new Date(),
//     data.title || '',
//     data.url || '',
//     data.summary || '',
//     keyPointsStr,
//     data.actionable || '',
//     data.articleDate || ''
//   ];

//   sheet.appendRow(row);

//   Logger.log(`[logAiGuide] 農業AI通信を記録しました: ${data.title}`);
// }
```

---

## 4. Public_Opportunities シートの仕様

| 列 | フィールド | 説明 |
|----|-----------|------|
| A | `id` | 正規化URLのSHA-256先頭20桁。**重複判定のキー** |
| B | `signature` | タイトル＋URL＋締切のハッシュ |
| C | `title` | 公募タイトル |
| D | `url` | 公式URL（utm等を除去した正規化済みURL） |
| E | `organization` | 所管する省庁・自治体 |
| F | `deadline` | 応募締切（ISO文字列） |
| G | `rank` | S / A |
| H | `score` | 100点評価の点数 |
| I | `first_notified_at` | 初回通知日時 |
| J | `last_notified_at` | 最終通知日時 |
| K | `last_checked_at` | 最終確認日時（締切変更の再確認ジョブが使用） |

### 触ってはいけない設定

**A・B・F・I・J・K列は「書式なしテキスト」（`@`）に固定**されます（`getPublicOpportunitySheet_` が毎回設定）。

これらが数値や日付に自動変換されると、Botが計算したハッシュ・締切と一致せず、同じ案件を毎回「更新｜」付きで再通知します。列の書式を手動で変更しないでください。

### 安全に行える手作業

- 通知履歴のリセット: 該当行を削除（あわせてBot側の `state/public-opportunities.json` も削除）
- 誤検知した案件を「今後通知しない」: その行を残したまま `deadline` を空にせず、そのまま置いておく（同じ締切のままなら再通知されません）

---

## 5. API仕様

```jsonc
// 履歴の取得
POST { "type": "getPublicOpportunities" }
→ [ { "id": "...", "signature": "...", "title": "...", "deadline": "...", ... } ]

// 履歴の記録（id列でupsert）
POST { "type": "publicOpportunities", "records": [ { "id": "...", "signature": "...", ... } ] }
→ { "result": "success", "inserted": 1, "updated": 0 }
```

GASは失敗時もHTTP 200で `{"result":"error"}` を返すため、Bot側は本文で成否を判定しています。

---

## 6. 重複投稿が起きたときの確認順

1. `Public_Opportunities` に同じURLの行が**2行以上ある** → A列の書式が数値・日付になっていないか確認。`@`に戻し、重複行を1行に統合する
2. 行は1行なのに再通知される → F列（`deadline`）が実行ごとに変わっていないか確認。省庁ページの表記揺れで締切の抽出結果が変動している可能性がある
3. Botのログに `⚠ GASが履歴APIに未対応` が出ている → 手順5（新バージョンでのデプロイ）が未実施
4. Coworkスキル側の通知と重複する → スキルの `.env` の `PUBLIC_OPPORTUNITY_SOURCE_ENV` が `daily-news-bot\.env` を指しているか確認（`GOOGLE_APPS_SCRIPT_URL` を読めていないとシートを参照できない）

Botとスキルは案件ID・署名の計算方法が一致しており、同じシートを見ています。どちらが先に通知しても、もう一方は再通知しません。

---

## 7. あわせて確認したい既知の注意点

**`logAiGuide` がコメントアウトされたまま `doPost` から呼ばれています。**

現行コードの `type === 'aiGuide'` 分岐は `logAiGuide(data)` を呼びますが、関数本体はコメントアウトされています。この状態で `aiGuide` のリクエストが届くと `logAiGuide is not defined` で例外になり、`{"result":"error"}` が返ります（Bot側は握りつぶすため、記録が静かに失敗します）。

農業AI通信は別デプロイ（`AIGuideCode.gs` / `AI_GUIDE_GAS_URL`）で記録しているため、実運用で困っていなければ現状維持で問題ありません。こちらのGASでも記録したい場合は、コード末尾の `logAiGuide` のコメントを解除してください。完全版コードにはこの注意をコメントとして残しています。
