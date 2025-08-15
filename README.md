# Daily News Bot for Discord

## 概要 (Overview)

このBotは、毎日指定された時間に、複数のニュースサイトから**「一次産業 × テクノロジー」**に関連するニュースを自動で抽出し、Discordチャンネルに投稿します。

さらに、投稿されたニュースには自動でスレッドが作成され、そこでの**議論内容や参加者の情報をGoogleスプレッドシートに自動で記録・蓄積**します。コミュニティの知見を可視化し、活性化させることを目的とした高機能Botです。

---

## ✨ 主な機能 (Features)

- **高精度なニュース抽出**:
  - 登録された全RSSフィードから直近24時間以内の記事を取得。
  - 「一次産業」「技術」「活用事例」などのキーワードで多段階のフィルタリングを行い、最も関連性の高いニュースを自動で選び出します。
- **Googleスプレッドシートへの自動ロギング**:
  - **投稿ニュースの記録**: Botが投稿したニュースの履歴を`News`シートに記録します。
  - **議論内容の記録**: Botが作成したスレッド内での全発言を、発言者情報と共に`User`シートに記録します。
  - **議論コンテキストの記録**: どのニュースに対するコメントかを紐付けるため、元記事のタイトルやURLも記録します。
- **ユーザーロール判定**:
  - 議論に参加したユーザーが特定のロール（例: ビギナー、メンバー）を持っているかを判定し、スプレッドシートに記録します。
- **自動デプロイ**:
  - GitHubのmainブランチにプッシュするだけで、GitHub Actionsが自動でサーバーにデプロイします。
- **高いカスタマイズ性**:
  - ニュースソース(RSS)、抽出キーワード、判定対象ロールなどを設定ファイルやコード上で簡単に変更できます。

---

## 🛠️ 使用技術 (Technology Stack)

- **Bot**: Node.js, discord.js, axios, node-cron, rss-parser
- **データ記録**: Google Apps Script (GAS), Google Sheets
- **デプロイ**: Docker, GitHub Actions

---

## 🚀 導入・セットアップ方法 (Setup)

このBotを動作させるには、いくつかのサービスの設定が必要です。順番に進めてください。

### Part 1: Discord Botの準備

1.  **Botの作成**: [Discord Developer Portal](https://discord.com/developers/applications)で新しいアプリケーションとBotを作成し、**Botトークン**をコピーします。
2.  **Message Content Intentの有効化**:
    - Developer Portalの`Bot`ページにある **"Privileged Gateway Intents"** セクションで、「**MESSAGE CONTENT INTENT**」を**必ず有効**にしてください。これがないと議論内容を読み取れません。
3.  **Botの招待**:
    - `OAuth2` > `URL Generator`ページで、スコープに`bot`を選択します。
    - `Bot Permissions`で以下の権限にチェックを入れます。
      - `Send Messages`
      - `Create Public Threads`
      - `Embed Links`
      - `Read Message History`
    - 生成されたURLで、Botをあなたのサーバーに招待します。

### Part 2: Googleスプレッドシート & GASの準備

1.  **スプレッドシートの作成**: ログ記録用の新しいGoogleスプレッドシートを作成します。
2.  **GASの設定**:
    - スプレッドシートのメニュー `[拡張機能]` > `[Apps Script]` を選択します。
    - エディタに以下のコードを**まるごと貼り付け**ます。

    ```javascript
    function doPost(e) {
      try {
        const data = JSON.parse(e.postData.contents);
        const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
        
        if (data.type === 'discussion') {
          const SHEET_NAME = "User";
          let sheet = spreadsheet.getSheetByName(SHEET_NAME);
          if (!sheet) { sheet = spreadsheet.insertSheet(SHEET_NAME); }
          if (sheet.getLastRow() === 0) {
            sheet.appendRow(["日時", "ユーザーID", "ユーザー名", "投稿内容", "元ニュースのタイトル", "元ニュースのURL", "元ニュースの投稿日", "ロール"]);
          }
          sheet.appendRow([ new Date(data.timestamp), data.userId, data.username, data.content, data.newsTitle, data.newsUrl, new Date(data.newsPostDate), data.userRole ]);
        } else {
          const SHEET_NAME = "News";
          let sheet = spreadsheet.getSheetByName(SHEET_NAME);
          if (!sheet) { sheet = spreadsheet.insertSheet(SHEET_NAME); }
          if (sheet.getLastRow() === 0) {
            sheet.appendRow(["投稿日時", "タイトル", "URL", "ニュースの日付"]);
          }
          sheet.appendRow([ new Date(), data.title, data.link, data.newsDate ]);
        }
        return ContentService.createTextOutput(JSON.stringify({ "result": "success" })).setMimeType(ContentService.MimeType.JSON);
      } catch (error) {
        return ContentService.createTextOutput(JSON.stringify({ "result": "error", "message": error.message })).setMimeType(ContentService.MimeType.JSON);
      }
    }
    ```
3.  **Webアプリとしてデプロイ**:
    - GASエディタ上部の `[デプロイ]` > `[新しいデプロイ]` をクリック。
    - `種類の選択`で「**ウェブアプリ**」を選択。
    - `アクセスできるユーザー:` を「**全員**」に変更します。
    - `[デプロイ]`ボタンを押し、承認プロセスを完了させます。
    - 表示された**ウェブアプリのURL**をコピーしておきます。

### Part 3: プロジェクトのセットアップ

1.  **リポジトリをクローンし、ライブラリをインストール**
    ```bash
    git clone https://github.com/Metagri-Bot/daily-news-bot.git
    cd daily-news-bot
    npm install
    ```
2.  **`.env`ファイルを作成**
    - `.env.sample`をコピーして`.env`という名前のファイルを作成します。
    - 以下の項目に、取得した値を設定します。
      - `DISCORD_BOT_TOKEN`: Part 1で取得したBotトークン
      - `NEWS_CHANNEL_ID`: ニュースを投稿したいチャンネルのID
      - `GOOGLE_APPS_SCRIPT_URL`: Part 2で取得したGASのURL
      - `BIGNER_ROLE_ID`, `METAGRI_ROLE_ID`: 判定したいDiscordロールのID
      - `NEWS_RSS_FEEDS...`: ニュースソースのRSSフィードURL
3.  **ローカルで起動**
    ```bash
    node index.js
    ```

---

## 🚢 デプロイ方法 (Deployment)

このプロジェクトは、GitHub ActionsとDockerを使用して自動でサーバーにデプロイされます。

1.  **`docker-compose.yml`の準備**:
    リポジトリには、Botをサービスとして実行するための`docker-compose.yml`が含まれている必要があります。
2.  **GitHub Secretsの設定**:
    デプロイを機能させるには、リポジトリの`Settings` > `Secrets and variables` > `Actions`に以下の情報を登録する必要があります。
    - `SSH_HOST`: デプロイ先サーバーのIPアドレス
    - `SSH_USER`: SSH接続ユーザー名
    - `SSH_PRIVATE_KEY`: SSH秘密鍵
    - 上記`.env`ファイルに設定したすべての変数 (`DISCORD_BOT_TOKEN`, `NEWS_CHANNEL_ID`, etc.)

設定後、`main`ブランチにプッシュすると、自動的にデプロイが実行されます。

---

## ⚙️ 使い方とカスタマイズ

- **抽出キーワードの変更**:
  `index.js`ファイル上部の`PRIMARY_INDUSTRY_KEYWORDS`, `TECH_KEYWORDS`, `USECASE_KEYWORDS`の配列を編集します。
- **ニュースソースの変更**:
  `.env`ファイル（またはGitHub Secrets）の`NEWS_RSS_FEEDS_...`の値を変更します。
- **投稿時間の変更**:
  `index.js`内の`cron.schedule('0 7 * * *', ...)`の書式を変更します。（デフォルトは毎朝7時）

---

## 📄 ライセンス (License)

このプロジェクトは [MIT License](LICENSE) の下で公開されています。