# Daily News Bot for Discord

## 概要 (Overview)

このBotは、2つのインテリジェントなニュース配信機能と、コミュニティの活動を自動で記録するロギング機能を備えた高機能Botです。

1.  **厳選ニュース配信 (毎日 AM 8:00)**:
    複数のニュースサイトから「一次産業 × テクノロジー」に関連する最も重要なニュースを1つだけ選び出し、ディスカッションを促すメッセージと共に投稿します。

2.  **情報収集ヘッドライン (AM 6:00 - PM 18:00 / 3時間ごと)**:
    幅広いニュースソースから、関連性の高い最新ニュースを3件抽出し、情報収集用のチャンネルに投稿します。鮮度と関連性を両立し、重複投稿を防ぐロジックが組み込まれています。

3.  **活動ログの自動記録**:
    投稿されたニューススレッド内での全発言を、発言者情報（ロール判定含む）やどのニュースに対するコメントかという情報と共に、Googleスプレッドシートに自動で記録・蓄積します。

---

## ✨ 主な機能 (Features)

- **デュアルニュース配信**: 目的の異なる2つのニュース配信タスクをスケジュール実行。
- **高精度なニュースフィルタリング**: 鮮度（直近24時間など）とキーワード（一次産業, 技術, 活用事例など）に基づき、多段階の優先度付けを行ってニュースを厳選。
- **重複投稿防止**: 情報収集タスクでは、一度投稿したニュースはキャッシュし、再度投稿しない仕組みを搭載。
- **Googleスプレッドシート連携**: Google Apps Script (GAS) をWebアプリとして利用し、Discordでの活動データを安全かつリアルタイムに記録。
- **ユーザーロール判定**: 議論に参加したユーザーが特定のロールを持っているかを判定し、ログに記録。
- **自動デプロイ**: GitHubのmainブランチへのプッシュをトリガーに、GitHub ActionsがDockerコンテナを自動でビルド＆デプロイ。

---

## 🛠️ 使用技術 (Technology Stack)

- **Bot**: Node.js, discord.js, axios, node-cron, rss-parser
- **データ記録**: Google Apps Script (GAS), Google Sheets
- **デプロイ**: Docker, GitHub Actions

---

## 🚀 導入・セットアップ方法 (Setup)

### Part 1: Discord Botの準備

1.  **Botの作成**: [Discord Developer Portal](https://discord.com/developers/applications)でアプリケーションとBotを作成し、**Botトークン**をコピーします。
2.  **Message Content Intentの有効化**:
    - Developer Portalの`Bot`ページで「**MESSAGE CONTENT INTENT**」を**必ず有効**にしてください。
3.  **Botの招待**:
    - `OAuth2` > `URL Generator`で、スコープに`bot`を選択し、必要な権限（`Send Messages`, `Create Public Threads`, `Embed Links`, `Read Message History`）にチェックを入れてサーバーに招待します。

### Part 2: Google Apps Script (GAS) の準備

1.  **スプレッドシートの作成**: ログ記録用の新しいGoogleスプレッドシートを作成します。
2.  **GASの設定**:
    - スプレッドシートのメニュー `[拡張機能]` > `[Apps Script]` を選択します。
    - エディタに以下の**Botからのデータを受け取るためのコード**を貼り付けます。

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
        } else {
          const sheet = getSheetByName(spreadsheet, "News");
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
- 上記`.env`ファイルに設定したすべての変数 (`DISCORD_BOT_TOKEN`, `NEWS_CHANNEL_ID`, etc.)

---

## ⚙️ 使い方とカスタマイズ

- **投稿時間の変更**:
  `index.js`内の`cron.schedule(...)`の書式を変更します。
  - 厳選ニュース: `cron.schedule('0 8 * * *', ...)`
  - 情報収集ニュース: `cron.schedule('0 6-18/3 * * *', ...)`
- **抽出キーワードの変更**:
  `index.js`ファイル上部のキーワード配列を編集します。
- **ニュースソースの変更**:
  `.env`ファイル（またはGitHub Secrets）の`NEWS_RSS_FEEDS_...`の値を変更します。

---

## 📄 ライセンス (License)

このプロジェクトは [MIT License](LICENSE) の下で公開されています。
