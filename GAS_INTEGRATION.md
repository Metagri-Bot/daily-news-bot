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
    Logger.log('Error in doPost: ' + error.toString());
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * GETリクエスト処理（投稿済みISBN取得用）
 */
function doGet(e) {
  try {
    const type = e.parameter.type;

    if (type === 'getPostedBooks') {
      // 投稿済みISBNリストを返す
      const isbns = getPostedBooks();
      return ContentService.createTextOutput(JSON.stringify(isbns))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 既存のGET処理（Posted_URLs取得など）
    // ...

    return ContentService.createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    Logger.log('Error in doGet: ' + error.toString());
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

### Google Sheetsに書き込まれない場合

**症状**: Botログに「[Spreadsheet] タイプ 'newBook' のログ書き込みに成功しました。」と表示されるが、シートに反映されない

**原因と解決策**:

1. **GASコードの確認**
   - `logNewBook(data)`関数が正しく実装されているか確認
   - `Posted_Books`シートが存在するか確認
   - GASの実行ログ（`Logger.log`）を確認

2. **GAS再デプロイ**
   ```
   1. GASエディタで「デプロイ」→「デプロイを管理」
   2. 既存のデプロイの右側の鉛筆アイコンをクリック
   3. 「バージョン」を「新バージョン」に変更
   4. 「デプロイ」をクリック
   ```

3. **権限の確認**
   - GASがGoogle Sheetsへの書き込み権限を持っているか確認
   - 初回実行時に権限承認が必要

4. **デバッグ方法**
   ```javascript
   // GASのlogNewBook関数の先頭に追加
   Logger.log('[logNewBook] データ受信: ' + JSON.stringify(data));
   ```

### ISBNが重複して投稿される場合

1. `Posted_Books`シートが正しく作成されているか確認
2. GASの`doGet`関数が正しく実装されているか確認
3. Bot起動ログで「X件の投稿済み書籍を読み込みました」と表示されるか確認
4. GASのURLが正しく設定されているか確認

### 書籍が全く投稿されない場合

1. 環境変数`NEW_BOOK_CHANNEL_ID`と`POPULAR_BOOK_CHANNEL_ID`が設定されているか確認
2. スコアリングで基準を満たす書籍があるか確認
3. 投稿済みチェックで全て除外されていないか確認
4. APIから書籍を取得できているか確認（Botログ）

### 楽天API 429エラー（レート制限）

**症状**: `[New Book] 楽天Books API (XX) エラー: Request failed with status code 429`

**解決策**:
- **既に実装済み**: 書籍データキャッシュにより、2つのタスクが同じAPIを2回叩くことを防止
- キャッシュは1時間有効
- 9:00と10:00の実行で同じデータを共有

## メンテナンス

### 投稿履歴のクリア

テストや誤投稿の修正のため、特定のISBNを削除したい場合：

1. Google Sheetsの`Posted_Books`シートを開く
2. 該当するISBNの行を削除
3. Botを再起動（キャッシュを更新）

### 定期的なデータ整理

長期運用により`Posted_Books`シートが大きくなった場合、古いデータをアーカイブすることを推奨します。

---

# 公募モニターの履歴シート（Public_Opportunities）

官公庁・自治体 公募モニターの**重複投稿防止の「正」**となるシートです。ローカルの `state/public-opportunities.json` は写し（キャッシュ）であり、シートが優先されます。

## シート構成

シート名: `Public_Opportunities`（Bot初回実行時に自動作成されます）

| 列 | フィールド | 説明 |
|----|-----------|------|
| A | `id` | 正規化URLのSHA-256先頭20桁。重複判定のキー |
| B | `signature` | タイトル＋URL＋締切のハッシュ |
| C | `title` | 公募タイトル |
| D | `url` | 公式URL（正規化済み） |
| E | `organization` | 所管する省庁・自治体 |
| F | `deadline` | 応募締切（ISO文字列） |
| G | `rank` | S / A |
| H | `score` | 100点評価の点数 |
| I | `first_notified_at` | 初回通知日時 |
| J | `last_notified_at` | 最終通知日時 |
| K | `last_checked_at` | 最終確認日時（再確認ジョブ用） |

**重要**: A・B・F・I・J・K列は「書式なしテキスト」に固定されます（GAS側で自動設定）。数値や日付に自動変換されるとBot側のハッシュ・締切と一致せず、同じ案件を毎回「更新」として再通知してしまうためです。手作業でこれらの列の書式を変更しないでください。

## 導入手順（必須）

Bot側のコードだけでは動きません。GASの再デプロイが必要です。

**コピペ用の完全版コードと手順は `GAS_UPDATE_PUBLIC_OPPORTUNITY.md` にまとめてあります**（内容は `.gascode` と同一）。要点のみ再掲します。

1. スプレッドシートの拡張機能 → Apps Script を開き、`.gascode` の内容で全置換
2. `testPublicOpportunities` を実行して動作確認（テスト行は削除する）
3. **デプロイ → デプロイを管理 → 編集 → バージョン「新バージョン」→ デプロイ**
   - 新しいバージョンでデプロイしないと、既存のURLでは古いコードが動き続けます
4. Bot側から疎通確認

```bash
node -e "require('dotenv').config();require('./public-opportunity-store').fetchRemoteHistory(process.env.GOOGLE_APPS_SCRIPT_URL).then(r=>console.log(r.status, r.status==='ok'?Object.keys(r.seen).length+'件':''))"
```

`ok` 以外が出た場合の意味: `not_deployed`=GASが旧バージョン／`unavailable`=通信失敗／`disabled`=URL未設定。

## API

```jsonc
// 履歴の取得
POST { "type": "getPublicOpportunities" }
→ [ { "id": "...", "signature": "...", "title": "...", ... } ]

// 履歴の記録（id列でupsert）
POST { "type": "publicOpportunities", "records": [ { "id": "...", "signature": "...", ... } ] }
→ { "result": "success", "inserted": 1, "updated": 0 }
```

同時実行による二重追記を防ぐため、`upsertPublicOpportunities` は `LockService` でスクリプトロックを取得します。

## 重複投稿が起きたときの確認順

1. `Public_Opportunities` シートに該当URLの行が**2行以上ある** → A列の書式が数値・日付になっていないか確認（`@`に戻し、重複行を1行に統合）
2. 行は1行なのに再通知される → F列（`deadline`）が実行ごとに変わっていないか確認。省庁ページの表記揺れで締切の抽出結果が変動している可能性
3. Botのログに `⚠ シート履歴が取得できないため` が出ている → GASのデプロイ状態とアクセス権限を確認
4. Coworkスキル側からの通知と重複 → スキルの `.env` の `PUBLIC_OPPORTUNITY_SOURCE_ENV` が `daily-news-bot\.env` を指しているか確認（`GOOGLE_APPS_SCRIPT_URL` を読めていないとシートを参照できません）

## 履歴のリセット

テスト後に通知履歴を消す場合は、`Public_Opportunities` シートの該当行を削除し、Bot側の `state/public-opportunities.json` も削除してください（片方だけ消してもシート側が正として復元されます）。

# 朝の農業ニュース音声配信

独立のApps Scriptプロジェクト「毎日ニュース｜農業ニュース音声配信」で [`MorningPodcast.gs`](MorningPodcast.gs) を実行します。朝6時のDiscord投稿後に更新される「毎日ニュース」の `Posted_URLs` を入力とし、Geminiで作った音声をDriveに保存して、実行アカウント本人にGmailで知らせます。定期処理はApps Scriptの時間トリガーで動きます。 [選定・配信の機能仕様](SPECIFICATION.md#朝の農業ニュース音声配信)

## セットアップと時刻変更

1. 音声配信用の独立Apps Scriptを開き、`MorningPodcast.gs` の内容を保存します。別の台帳を使うときは `PODCAST.spreadsheetId` を対象のIDに変更します。
2. Google AI Studioで「無料枠」と表示されるプロジェクトのAPIキーを用意します。Apps Scriptの「プロジェクトの設定」→「スクリプト プロパティ」に `GEMINI_API_KEY` として直接登録します。キーはスクリプト本文やGitに置かず、GASの設定で管理します。 [AI Studioのプロジェクト](https://aistudio.google.com/projects)
3. `checkPodcastSources` を実行し、初回はSheets、Drive、外部URLへのアクセス、メール送信、トリガー操作に必要な権限を確認して承認します。
4. `testPodcastDelivery` を実行して、テスト音声と本人宛てメールを確認します。Gmailの「今日の音声を聴く」を開くとDriveで再生できます。
5. 新規の設定時は `installMorningPodcast` を実行します。「トリガー」画面で `runMorningPodcast` と `retryMorningPodcast` が1本ずつあることを確認します。現行は毎朝6:20ごろと6:40ごろ（日本時間）です。時刻を変更する場合は `PODCAST.schedule` を変更して保存し、インストール関数を再実行します。曜日は `schedule.days` を編集して保存すると切り替えられます（月曜が1、日曜が7）。 [Apps Scriptの時刻指定](https://developers.google.com/apps-script/reference/script/clock-trigger-builder#nearMinute(Integer))

## 手動で確認できる処理

| 関数 | 確認内容 |
| --- | --- |
| `checkPodcastSources` | 実際の台帳と出典ページから候補を抽出し、件数を実行ログに表示。Gemini呼び出し、Driveへの保存、メール送信なし |
| `createPodcastPreview` | `試聴_v3_` が付いた台本JSONとWAVをDriveに保存。実行ログで件数と実測尺を確認できる。メール送信なし |
| `testPodcastDelivery` | `テスト_v3_` が付いた台本JSONとWAVをDriveに保存し、`【テスト｜毎日ニュース音声】` の件名で本人に送信。同日の送信済みテストは再送しない |
| `runMorningPodcast` | 当日分の通常配信。手動で実行した場合も本番と同様に本人に送信する |

## 保存先と確認順

- 実行アカウントのDriveに `毎日ニュース｜農業ニュース音声` フォルダを作成します。`PODCAST_FOLDER_ID` は初回作成時に保存されます。配信日は `YYYY-MM-DD_農業ニュース.json` と `.wav` を照合できます。
- 実行ログに「未紹介の話題」「採用できる独立した話題」が3件未満と出た日は、朝の予備枠で再確認します。「音声尺」で保留した場合は、同日の再実行で台本を使い回し、読み上げ速度を調整します。
- メールが見つからない場合は、Apps Scriptの「実行数」で出典の有無、API応答、音声URL、送信結果の順に確認します。`sending` は送信の成否が確定する前に実行が止まった可能性があるため、再送の前に本人のGmailで件名を検索します。
- `PODCAST_API_TEXT` と `PODCAST_API_AUDIO` は太平洋時間の日付で呼び出し数を管理します。各モデルの処理回数は定期実行では同日合計2回まで、試聴・手動テストを含める場合は4回までです。API側でHTTP 429になった日は該当モデルを保留します。 [Gemini APIのレート制限](https://aistudio.google.com/docs/rate-limits)

2026-11-24の手動テストで、3件のニュースから1分36秒の音声を生成し、Driveでの再生とGmailの受信トレイへの到着を確認しました。朝6時台のトリガーは2本の登録を確認済みです。変更後の時刻での初回自動実行とAndroidの画面消灯中の再生は未確認です。

## Metagri Voices 火曜版

[`WeeklyVoices.gs`](WeeklyVoices.gs) と [`MorningPodcast.gs`](MorningPodcast.gs) を同じプロジェクトで実行します。両方のコードを一つのスクリプトファイルに連結して配置することもできます。既存の `GEMINI_API_KEY` と台帳を使います。週刊の成果物はDriveの `Metagri Voices｜火曜・週刊農業ニュース` フォルダに作ります。

- `installWeeklyVoices` で、火曜8:20ごろと9:20ごろの日本時間トリガーを登録します。曜日や時刻を変更するときは `WEEKLY_VOICES` を変更して保存し、同じ関数を再実行します。
- `createWeeklyVoicesPreview` で、直近の火曜号を手動生成できます。準備済みの回は同じファイルを返します。
- 冒頭では、メタが番組で見るポイントを紹介し、グリが5本の話題を本編と同じ順に予告します。メタが1本目の問いを添え、短い間を取って本編に入ります。2本目以降はグリが番号と短い見出しを読みます。
- `createWeeklyVoicesTransitionPreview` は、同じ冒頭と話題の切り替えを固定の5本で短く確認する手動試聴です。同日の同じ版の試聴音声は再利用します。新規生成には音声生成の枠を使います。ログのDriveリンクから聴けます。
- 週刊の音声生成は `GEMINI_API_KEY` を優先します。Geminiが無料の日次枠の上限、または利用可能枠ゼロを返したときに限り、スクリプトプロパティ `GEMINI_API_KEY_bk` の別キーで1回試します。GAS内の回数制限や無料キーの認証エラー、短時間のレート制限だけでは切り替えません。短い手動試聴では、GAS内の上限に達していてもGemini側を無料キーで1回確認できます。
- 週刊版を仕上げるときは、[ニュース調のオリジナルBGM](assets/weekly-voices/Weekly_Agri_News_Bed.wav) をループし、2本目以降の発話直前に [短い2音の合図](assets/weekly-voices/Weekly_Agri_News_Cue.wav) を計4か所重ねます。合図の間だけBGMを少し下げ、次の見出しまで自然な間を残します。既定の概要には `BGM オリジナル（週刊農業ニュース）` が入ります。別の曲で仕上げた場合は、公開前にクレジットを合わせます。
- 火曜を含む直近7日の記事から独立した5件を選びます。直近8週の週刊版と出典・話題を照合し、記事が5件そろわない日は予備枠で再確認します。
- 選定した5件だけを台本生成に渡し、話題ごとに出典URL、本文の根拠、要約と発話に出る固有の語句を照合します。選定後に台本が保留になった場合は、同日の再実行で確認済みの候補を使います。
- グリをErinome、メタをOrusで読み上げます。WAVの実測が5〜7分に収まった回に、Speaker 1/2形式の台本と出典付きの配信概要を添えます。生成したWAVを確認し、BGMと合図を重ねてからSpotify for Creatorsに入稿します。 [Spotifyの音声エピソード公開手順](https://support.spotify.com/sr-en/creators/article/publishing-audio-episodes/)
- 定期実行の上限は太平洋時間同日で台本用4回、音声用2回です。日刊と週刊の呼び出し数は個別に記録し、Gemini側のプロジェクト割当を共用します。
