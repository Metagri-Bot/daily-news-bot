# Daily News Bot for Discord

## 概要 (Overview)

このBotは、毎日指定された時間に、複数のニュースサイトから**「一次産業 × 新技術/Web3」**に関連するニュースを自動で抽出し、Discordチャンネルに投稿するBotです。
投稿されたニュースには自動でスレッドが作成され、メンバー同士の専門的な議論を促進することを目的としています。

---

## ✨ 主な機能 (Features)

- **キーワードによるニュース抽出**: 複数のRSSフィードから取得した全ニュースの中から、定義されたキーワード（例: `農業` + `AI`）に合致する記事だけを賢くフィルタリングします。
- **定時ニュース投稿**: 毎日朝7時（JST）にニュースを自動投稿します。投稿時間は自由に変更可能です。
- **複数ソース対応**: 複数のRSSフィードからまとめてニュースを取得します。
- **自動スレッド作成**: 投稿されたニュース記事に対して、議論用のスレッドを自動で作成します。
- **高いカスタマイズ性**: `.env`ファイルや設定ファイルの一部を編集するだけで、投稿チャンネル、ニュースソース、抽出キーワードを簡単に追加・変更できます。

---

## 🛠️ 使用技術 (Technology Stack)

- **言語**: Node.js
- **主要ライブラリ**:
  - `discord.js`: Discord APIと連携し、Botを動作させるためのコアライブラリ
  - `node-cron`: 指定した時間にタスクを自動実行するためのスケジューラ
  - `rss-parser`: RSSフィードを簡単に解析するためのライブラリ
  - `dotenv`: 環境変数を`.env`ファイルで管理するためのライブラリ

---

## 🚀 導入方法 (Setup)

### 前提条件

- [Node.js](https://nodejs.org/) (v16.9.0 以上)
- [Git](https://git-scm.com/)

### インストール手順

1.  **リポジトリをクローンする**
    ```bash
    git clone https://github.com/【あなたのユーザー名】/daily-news-bot.git
    cd daily-news-bot
    ```

2.  **必要なライブラリをインストールする**
    ```bash
    npm install
    ```

3.  **`.env` ファイルを設定する**
    プロジェクトのルートディレクトリに `.env` という名前のファイルを作成し、以下の内容をコピーして、ご自身の情報に書き換えてください。
    ```env
    # === Discord Bot 基本設定 ===
    # Discord Developer Portalから取得したBotのトークン
    DISCORD_BOT_TOKEN=YOUR_DISCORD_BOT_TOKEN

    # === デイリーニュースBot用設定 ===
    # ニュースを投稿するDiscordチャンネルのID
    NEWS_CHANNEL_ID=YOUR_NEWS_CHANNEL_ID

    # 農業系ニュースのRSSフィードURL（複数ある場合はカンマ区切り）
    NEWS_RSS_FEEDS_AGRICULTURE=https://www.agrinews.co.jp/feed,https://agri.mynavi.jp/feed/,https://www.jacom.or.jp/rss/

    # Web3系ニュースのRSSフィードURL（複数ある場合はカンマ区切り）
    NEWS_RSS_FEEDS_WEB3=https://coinpost.jp/rss,https://news.yahoo.co.jp/rss/media/neweco/all.xml,https://news.yahoo.co.jp/rss/media/coindesk/all.xml
    ```

4.  **Botを起動する**
    以下のコマンドでBotを起動します。
    ```bash
    node index.js
    ```
    ターミナルに `Bot is ready! Logged in as (Bot名)` と表示されれば起動成功です。

---

## ⚙️ 使い方とカスタマイズ (Usage & Customization)

### 抽出キーワードのカスタマイズ

ニュースを抽出するためのキーワードは `index.js` ファイルの上部で定義されています。このリストを編集することで、Botが選ぶニュースの傾向を調整できます。

`index.js`を開き、以下の配列を編集してください。
```javascript
// === キーワード定義 ===
// ここを編集することで、抽出するニュースの精度を調整できます
const PRIMARY_INDUSTRY_KEYWORDS = [
  '農業', '農家', 'アグリ', 'Agri', '畜産', '漁業', '林業', '酪農', '栽培', '養殖', 'スマート農業', 'フードテック', '農林水産', '一次産業'
];
const TECH_KEYWORDS = [
  'Web3', 'ブロックチェーン', 'NFT', 'DAO', 'メタバース', 'AI', '人工知能', 'IoT', 'ドローン', 'DX', 'デジタル', 'ロボット', '自動化', '衛星', 'テック'
];
```

### ニュースソースの追加・変更

- `.env` ファイル内の `NEWS_RSS_FEEDS_...` の値を編集することで、ニュースソースを自由に変更できます。
- URLをカンマ(`,`)で区切ることで、複数のRSSフィードを登録できます。

### 投稿時間の変更

- ニュースの投稿時間は `index.js` ファイル内の `cron.schedule` で設定されています。
- デフォルトは毎朝7時 (`'0 7 * * *'`) です。cronの書式に従って自由に変更してください。
  ```javascript
  // 例: 毎時0分に実行する場合 -> '0 * * * *'
  // 例: 毎日正午12時に実行する場合 -> '0 12 * * *'
  cron.schedule('0 7 * * *', async () => {
    // ...
  });
  ```

---

## 💡 今後の拡張案 (Future Plans)

- **キーワード管理の外部化**: キーワードリストをJSONファイルなどに分離し、より管理しやすくする。
- **ユーザー参加型機能**: `/suggest_rss` や `/add_keyword` のようなスラッシュコマンドを実装し、メンバーがニュースソースやキーワードを提案できる機能。
- **エラーハンドリングの強化**: RSSフィードが取得できなかった場合のリトライ処理など。

---

## 📄 ライセンス (License)

このプロジェクトは [MIT License](LICENSE) の下で公開されています。
