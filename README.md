# Daily News Bot for Discord

## 概要 (Overview)

このBotは、AIによるインテリジェントなニュース分析機能と、コミュニティの活動を自動で記録するロギング機能を備えた高機能Botです。単なる情報配信に留まらず、コミュニティの対話を活性化させ、その知見を資産として蓄積することを目指します。

1.  **AI研究員による厳選ニュース配信 (毎日 AM 8:00)**:
    国内のニュースサイトから「一次産業 × テクノロジー」に関連する最も重要なニュースを1つだけ選び出し、**AI（GPT-4o）が生成した独自の「見解」と「問いかけ」**を添えて投稿します。

2.  **国内情報収集ヘッドライン (AM 6:00 - PM 18:00 / 3時間ごと)**:
    幅広いニュースソースから、**スコアリング方式**で関連性の高い最新ニュースを最大3件抽出し、情報収集用のチャンネルに投稿します。コミュニティの関心に合わせてスコアを調整可能です。

3.  **海外文献ダイジェスト (毎日 AM 10:00 & PM 19:00)**:
    世界の主要な農業技術・ビジネス情報源から最新の英語文献を収集。**スコアリングで厳選後、記事本文をスクレイピングし、AIが日本語に翻訳・要約**して、専門用語の解説付きで投稿します。

4.  **Roblox関連のビジネス・アップデート速報 (毎日 AM 7:00):**:
    Roblox関連の英語ニュースをスコアリングで厳選し、AIがビジネスの要点を日本語で翻訳・要約して配信します。

5.  **活動ログの自動記録**:
    投稿されたニューススレッド内での全発言を、発言者情報（ロール判定含む）と共にGoogleスプレッドシートに自動で記録・蓄積します。

---

## ✨ 主な機能 (Features)

- **AIによるニュース分析・翻訳・要約**: GPT-4oを活用し、国内ニュースへの「見解」付与や、海外の英語文献の高度な日本語要約を自動生成。
- **高度なスコアリング方式**: 複数のキーワードカテゴリ（技術、消費者体験、社会課題など）に基づいてニュースを点数付けし、コミュニティの関心に合致した情報を高精度で選出。
- **Webスクレイピング**: RSSフィードに概要がない場合でも、記事のWebページから直接本文を取得し、AIの分析精度を向上。
- **デュアル国内ニュース配信**: 目的の異なる2つの国内ニュース配信タスクをスケジュール実行。
- **重複投稿防止**: 一度投稿したニュースはキャッシュし、再度投稿しない仕組みを搭載。
- **Googleスプレッドシート連携**: Google Apps Script (GAS) をWebアプリとして利用し、Discordでの活動データを安全かつリアルタイムに記録。
- **ユーザーロール判定**: 議論に参加したユーザーが特定のロールを持っているかを判定し、ログに記録。
- **自動デプロイ**: GitHubのmainブランチへのプッシュをトリガーに、GitHub ActionsがDockerコンテナを自動でビルド＆デプロイ。

---

## 機能の仕組み

### 1. AI研究員による厳選ニュース配信 (毎日 AM 8:00)

AIがファシリテーターとなり、コミュニティでの質の高い議論を創出します。

```mermaid
sequenceDiagram
    participant Scheduler as スケジューラ (Bot内部)
    participant DailyNewsTask as 厳選ニュース機能
    participant NewsSites as ニュースサイト (RSS)
    participant OpenAI
    participant Discord
    participant GoogleSheets as Googleスプレッドシート

    Scheduler->>DailyNewsTask: 毎朝8時に実行命令
    DailyNewsTask->>NewsSites: 全ソースから最新記事を要求
    NewsSites-->>DailyNewsTask: 記事リストを返す
    DailyNewsTask->>DailyNewsTask: 多段階フィルタリングで1件を厳選
    DailyNewsTask->>OpenAI: 厳選したニュースを渡し、分析を依頼
    OpenAI-->>DailyNewsTask: 「見解」と「問いかけ」を生成して返す
    DailyNewsTask->>Discord: ニュースとAIの分析結果を投稿
    Discord-->>DailyNewsTask: 投稿メッセージ情報を返す
    DailyNewsTask->>Discord: 受け取った情報をもとにスレッドを作成
    DailyNewsTask->>GoogleSheets: 投稿ログとAIの分析結果を記録
```

### 2. 情報収集ヘッドライン (AM 6:00 - PM 18:00 / 3時間ごと)

個人の情報収集をサポートするため、幅広いニュースソースから関連性の高い最新ニュースを最大3件、重複なく届け続けます。

```mermaid
sequenceDiagram
    participant Scheduler as スケジューラ (Bot内部)
    participant InfoGatheringTask as 情報収集機能
    participant GoogleSheets as Googleスプレッドシート
    participant NewsSites as ニュースサイト (RSS)
    participant Discord

    Scheduler->>InfoGatheringTask: 3時間ごとに実行命令
    InfoGatheringTask->>GoogleSheets: 投稿済みURLリストを要求
    GoogleSheets-->>InfoGatheringTask: URLリストを返す
    InfoGatheringTask->>NewsSites: 全ソースから最新記事を要求
    NewsSites-->>InfoGatheringTask: 記事リストを返す
    InfoGatheringTask->>InfoGatheringTask: フィルタリング (投稿済み除外, 鮮度, 優先度)
    InfoGatheringTask->>InfoGatheringTask: 上位3件を選出
    InfoGatheringTask->>Discord: ヘッドライン形式でニュース3件を投稿
    InfoGatheringTask->>GoogleSheets: 新しく投稿したURLを追記
```

### 3. 海外文献ダイジェスト (毎日 AM 10:00 & PM 19:00)

収集、フィルタリング、スクレイピング、AI分析という多段階のプロセスを経て、世界の最先端情報を届けます。

```mermaid
sequenceDiagram
    participant Scheduler as スケジューラ (Bot内部)
    participant GlobalTask as 海外文献収集機能
    participant NewsSites as 海外RSSフィード
    participant WebPage as 記事のWebページ
    participant OpenAI
    participant Discord
    participant GoogleSheets as Googleスプレッドシート

    Scheduler->>GlobalTask: 1日2回実行命令
    GlobalTask->>NewsSites: 最新記事を要求
    NewsSites-->>GlobalTask: 記事リストを返す
    GlobalTask->>GlobalTask: スコアリングで候補を厳選
    GlobalTask->>WebPage: 候補記事の本文を要求 (スクレイピング)
    WebPage-->>GlobalTask: 本文テキストを返す
    GlobalTask->>OpenAI: 本文を渡し、翻訳・要約を依頼
    OpenAI-->>GlobalTask: 日本語の分析結果を返す
    GlobalTask->>Discord: 整形してEmbed形式で投稿
    GlobalTask->>GoogleSheets: 投稿ログを記録
```
### 4. Robloxビジネス・アップデート速報 (毎日 AM 7:00)

収集からAI分析、投稿までを自動化し、Robloxのビジネス動向を効率的にキャッチアップします。

```mermaid
sequenceDiagram
    participant Scheduler as スケジューラ (Bot内部)
    participant RobloxTask as Robloxニュース機能
    participant NewsSites as Roblox関連RSS
    participant WebPage as 記事のWebページ
    participant OpenAI
    participant Discord

    Scheduler->>RobloxTask: 毎朝7時に実行命令
    RobloxTask->>NewsSites: 最新記事を要求
    NewsSites-->>RobloxTask: 記事リストを返す
    RobloxTask->>RobloxTask: スコアリングで候補を厳選
    RobloxTask->>OpenAI: 候補記事を渡し、翻訳・要約を依頼
    OpenAI-->>RobloxTask: 日本語の分析結果を返す
    RobloxTask->>Discord: 整形してEmbed形式で投稿
```
*（注：Robloxニュースは現在、ログ記録の対象外です）*

#### 選定ロジックの詳細

**目的**: ブランドの活用事例やプラットフォームの大型アップデートなど、ビジネス上の重要ニュースに絞り込み、その要点を日本語で速報する。

**処理フロー**:
1.  **【記事収集】**: 登録されたRSSフィードから、過去24時間以内のRoblox関連ニュースをすべて収集します。

2.  **【スコアリング】**: 収集した各記事を、以下の4つのカテゴリで評価し、スコアを付けます。
    *   `ビジネス/ブランド活用`: **+5点**（`partnership`, `brand`, `virtual store`など）
    *   `プラットフォームアップデート`: **+5点**（`update`, `feature`, `engine`, `studio`など）
    *   `財務/市場動向`: **+4点**（`earnings`, `revenue`, `stock`, `investment`など）
    *   `技術/イノベーション`: **+3点**（`AI`, `metaverse`, `VR`など）

3.  **【フィルタリング】**: スコアの合計が**4点未満**の記事は、重要度が低いと判断し、この時点で除外します。

4.  **【最終選定】**: フィルタリングを通過した記事をスコアの高い順に並べ替え、翻訳・要約の対象として**上位最大5件**を選出します。

5.  **【AIによる翻訳・要約】**: 選定された記事のタイトルと概要をGPT-4oに渡し、**「メタバースとゲーム業界の専門アナリスト」**という役割（ペルソナ）を与えて、ビジネスパーソン向けの日本語要約を生成させます。概要が短い場合でも、タイトルから内容を推測して要約を作成するように指示しています。

6.  **【Discordへの投稿】**: AIが生成した日本語タイトルと要約を、スコアやカテゴリと共に、見やすい`Embed`形式で指定されたチャンネルに投稿します。

---

## ニュース選定ロジックの詳細 (Scoring Logic Details)

このBotの心臓部である、ニュースを自動で選定するスコアリングロジックについて解説します。国内と海外で、目的の異なるロジックを実装しています。

### 1. 国内情報収集ヘッドラインのスコアリング

**目的**: コミュニティの関心（ヒト、体験、社会課題など）を多角的に評価し、議論のきっかけとなりやすい多様なニュースを選出する。

**処理フロー**:
1.  **【必須条件】**: まず、記事に`CORE_AGRI_KEYWORDS`（`'農業'`, `'農家'`など）が1つでも含まれているかをチェックします。含まれていない場合、その記事は処理対象外となります。

2.  **【カテゴリ別スコアリング】**: 必須条件をクリアした記事に対し、以下のカテゴリに合致するキーワードが含まれていれば、それぞれ点数を加算します。
    *   `技術革新`: **+5点**
    *   `消費者体験・6次産業化`: **+5点**
    *   `ヒト・人材・ストーリー`: **+4点**
    *   `社会課題・サステナビリティ`: **+4点**
    *   `ビジネス・政策・制度`: **+3点**
    *   `コア農業・一次産業`: **+2点** (基礎点)
    *   `ボーナス・バズワード`: **+2点**

3.  **【シナジーボーナス】**: さらに、特定のカテゴリが組み合わさることで、より価値の高い記事と判断し、ボーナス点を加算します。
    *   `コア農業` + `技術革新` → **+10点**
    *   `コア農業` + `消費者体験` → **+8点**

4.  **【最終選定】**: 全カテゴリのスコアとボーナスを合計し、スコアの高い順に記事を並べ替え、上位3件を選出します。

---

### 2. 海外文献ダイジェストのスコアリング

**目的**: AgriTech（農業×技術）分野の重要文献を最優先で選出し、世界の最先端の研究開発動向を捉えることに特化する。

**処理フロー**:
1.  **【必須条件】**: 国内ニュースと同様に、記事に`GLOBAL_AGRI_KEYWORDS`（`'agriculture'`, `'farming'`など）が含まれていなければ、処理対象外とします。

2.  **【カテゴリ別スコアリング】**: 必須条件をクリアした記事に対し、以下のカテゴリのキーワードが含まれているかどうかに応じてスコアを付与します。
    *   `農業キーワード` (必須): **+5点** (基礎点)
    *   `技術キーワード`: **+5点**
    *   `研究キーワード`: **+3点**

3.  **【Agri-Techシナジーボーナス】**: このロジックの最も重要な部分です。`農業`と`技術`の両方のキーワードが含まれる記事には、さらに**+10点**のボーナスが加算され、最優先で選ばれるようになります。

4.  **【最終選定】**: 合計スコアの高い順に記事を並べ替え、上位候補から翻訳・要約する記事を選出します。

---

## 🛠️ 使用技術 (Technology Stack)

- **Bot**: Node.js, discord.js, axios, node-cron, rss-parser
- **AI**: OpenAI API (GPT-4o)
- **データ記録**: Google Apps Script (GAS), Google Sheets
- **デプロイ**: Docker, GitHub Actions

---

## 🚀 導入・セットアップ方法 (Setup)

### Part 1: Discord Bot & OpenAI APIの準備

1.  **Botの作成**: [Discord Developer Portal](https://discord.com/developers/applications)でアプリケーションとBotを作成し、**Botトークン**をコピーします。
2.  **Message Content Intentの有効化**: Developer Portalの`Bot`ページで「**MESSAGE CONTENT INTENT**」を**必ず有効**にしてください。
3.  **Botの招待**: `OAuth2` > `URL Generator`で、スコープに`bot`を選択し、必要な権限（`Send Messages`, `Create Public Threads`, `Embed Links`, `Read Message History`）にチェックを入れてサーバーに招待します。
4.  **OpenAI APIキーの取得**: [OpenAI Platform](https://platform.openai.com/)でアカウントを作成し、**APIキー**を取得します。

### Part 2: Google Apps Script (GAS) の準備

1.  **スプレッドシートの作成**: ログ記録用の新しいGoogleスプレッドシートを作成します。
2.  **GASの設定**:
    - スプレッドシートのメニュー `[拡張機能]` > `[Apps Script]` を選択します。
    - エディタに以下のコードを貼り付けます。（**AIの分析結果を記録する項目を追加済み**）

    ```javascript
    function doPost(e) {
      try {
        const data = JSON.parse(e.postData.contents);
        const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
        
        if (data.type === 'discussion') {
          const sheet = getSheetByName(spreadsheet, "User");
          if (sheet.getLastRow() === 0) {
            sheet.appendRow(["日時", "ユーザーID", "ユーザー名", "投稿内容", "元ニュースのタイトル", "元ニュースのURL", "元ニュースの投稿日", "ロール"]);
          }
          sheet.appendRow([ new Date(data.timestamp), data.userId, data.username, data.content, data.newsTitle, data.newsUrl, new Date(data.newsPostDate), data.userRole ]);
        } else if (data.type === 'news') {
          const sheet = getSheetByName(spreadsheet, "News");
          if (sheet.getLastRow() === 0) {
            sheet.appendRow(["投稿日時", "タイトル", "URL", "ニュースの日付", "AIの見解", "AIの質問"]);
          }
          sheet.appendRow([ new Date(), data.title, data.link, data.newsDate, data.metagriInsight, Array.isArray(data.discussionQuestions) ? data.discussionQuestions.join('\n') : data.discussionQuestions ]);
        }
        return ContentService.createTextOutput(JSON.stringify({ "result": "success" })).setMimeType(ContentService.MimeType.JSON);
      } catch (error) {
        return ContentService.createTextOutput(JSON.stringify({ "result": "error", "message": error.message })).setMimeType(ContentService.MimeType.JSON);
      }
    }
    function getSheetByName(spreadsheet, name) { let sheet = spreadsheet.getSheetByName(name); if (!sheet) { sheet = spreadsheet.insertSheet(name); } return sheet; }
    ```
3.  **Webアプリとしてデプロイ**:
    - GASエディタ上部の `[デプロイ]` > `[新しいデプロイ]` をクリック。
    - `アクセスできるユーザー:` を「**全員**」に変更し、デプロイします。
    - 表示された**ウェブアプリのURL**をコピーしておきます。

### Part 3: プロジェクトのセットアップ

1.  **リポジトリをクローンし、ライブラリをインストール**
    ```bash
    git clone https://github.com/Metagri-Bot/daily-news-bot.git
    cd daily-news-bot
    npm install
    ```
2.  **`.env`ファイルを作成**
    - `.env.sample`をコピーして`.env`ファイルを作成し、以下の項目に値を設定します。
      - `DISCORD_BOT_TOKEN`
      - `OPENAI_API_KEY` (**New!**)
      - `NEWS_CHANNEL_ID`
      - `INFO_GATHERING_CHANNEL_ID`
      - `GOOGLE_APPS_SCRIPT_URL`
      - `BIGNER_ROLE_ID`, `METAGRI_ROLE_ID`
      - `NEWS_RSS_FEEDS...`

---

## 🚢 デプロイ方法 (Deployment)

`main`ブランチにプッシュすると、GitHub Actionsが自動でサーバーにデプロイします。
デプロイには、リポジトリの`Settings` > `Secrets and variables` > `Actions`に以下の情報が登録されている必要があります。

- `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`
- 上記`.env`ファイルに設定したすべての変数 (`DISCORD_BOT_TOKEN`, `OPENAI_API_KEY`, etc.)

---

## ⚙️ 使い方とカスタマイズ

- **投稿時間の変更**: `index.js`内の`cron.schedule(...)`の書式を変更します。
- **AIプロンプトの変更**: `index.js`内の`generateMetagriInsight`関数にあるプロンプトを編集します。
- **抽出キーワードの変更**: `index.js`ファイル上部のキーワード配列を編集します。
- **ニュースソースの変更**: `.env`ファイル（またはGitHub Secrets）の`NEWS_RSS_FEEDS_...`の値を変更します。

---
## 🗂️ Googleスプレッドシート連携の詳細

このBotの強力な機能の一つが、Google Apps Script (GAS) を活用した高度なデータロギングと集計です。Botは単にDiscordに投稿するだけでなく、コミュニティの活動を永続的なデータとして蓄積し、分析可能な形に整形します。

### データの流れと処理

```mermaid
graph TD
    subgraph Discord
        A["ユーザーがスレッドで発言"] --> B{"Botがメッセージを検知"};
    end

    subgraph "Node.js (Botサーバー)"
        B --> C["発言データを整形"];
        C --> D["GAS WebアプリへPOST"];
    end

    subgraph "Google Apps Script (GAS)"
        D --> E["doPost関数がデータ受信"];
        E --> F["シートにログを追記"];
        G["定時実行トリガー (毎日17時台)"] --> H["データ集計・転記処理"];
        H --> I["シートから全ログ読込"];
        I --> J["最新日の投稿のみ抽出"];
        J --> K["ユニークユーザー化"];
        K --> L["ロール別にフィルタリング"];
        L --> M["外部スプレッドシートへPOST"];
    end
    
    subgraph "Google スプレッドシート (ログ用)"
        F --> Sheet1(["Userシート"]);
        F --> Sheet2(["Posted_URLsシート"]);
        I --> Sheet1;
    end

    subgraph "Google スプレッドシート (外部連携用)"
        M --> Sheet3(["Role 0 転記先"]);
        M --> Sheet4(["Role 1 転記先"]);
    end
```

### GASが担う主な役割

1.  **データ受信API (`doPost`, `doGet`)**:
    - Node.jsから送信されるHTTPリクエストを受け取る窓口として機能します。
    - 投稿されたニュースの情報、スレッドでの議論内容、情報収集タスクで投稿した記事のURLなど、様々な種類のデータを受け取り、適切な処理に振り分けます。

2.  **一次ログの記録**:
    - **`User`シート**: スレッド内での全発言を、発言者、内容、どのニュースに対するコメントか、といった詳細情報と共に時系列で記録します。
    - **`News`シート**: 毎朝8時に投稿される厳選ニュースの履歴を記録します。
    - **`Posted_URLs`シート**: 情報収集タスクで投稿したニュースのURLを記録し、永続的な重複投稿防止に利用します。

3.  **定時データ集計と外部連携 (`processAndTransferAllUserData`)**:
    - 毎日17時台に自動実行されるトリガーによって、以下の高度なデータ処理を行います。
    - **最新日データの抽出**: `User`シートの全ログから、**その日に行われた最新の投稿**だけを抽出します。投稿がなかった日は、この時点で処理を中断し、外部シートを更新しません。
    - **ユニークユーザー化**: 最新日の投稿データの中から、各ユーザーの最後の発言だけを残し、重複を除外します。
    - **ロール別フィルタリング**: 抽出されたユニークユーザーを、Discordロール (`0` or `1`) に基づいて2つのグループに分類します。
    - **外部スプレッドシートへの転記**: 分類された各グループのデータを、それぞれ指定された別のスプレッドシートに整形して上書き転記します。これにより、外部ツールとの連携用に常にクリーンなデータセットを維持します。

---

## ⚙️ 使い方とカスタマイズ

- **スコアの調整**:
  `index.js`ファイル上部のキーワードカテゴリ定義エリアで、各カテゴリの**点数を変更する**ことで、ニュース選定の傾向を簡単にチューニングできます。
- **キーワードの変更**:
  国内用（`CORE_AGRI_KEYWORDS`など）と海外用（`GLOBAL_AGRI_KEYWORDS`など）のキーワード配列を編集することで、収集する情報の範囲をカスタマイズできます。
  
---

## 📄 ライセンス (License)

このプロジェクトは [MIT License](LICENSE) の下で公開されています。
