# Daily News Bot システム仕様書

## 1. システム概要

### 1.1 目的
農業・Web3・AI技術関連のニュースをインテリジェントに収集・分析し、Discord上で自動配信するBotシステム。AIが生成した見解と質問を通じてコミュニティの議論を活性化させ、その活動データを永続化・分析する。

### 1.2 システム構成図

```
┌─────────────────────────────────────────────────────────────────────┐
│                           外部データソース                           │
├─────────────┬─────────────┬─────────────┬─────────────┬────────────┤
│  農業RSS    │  Web3 RSS   │  海外RSS    │  Roblox RSS │ 楽天Books  │
└─────┬───────┴─────┬───────┴─────┬───────┴─────┬───────┴─────┬──────┘
      │             │             │             │             │
      └─────────────┴─────────────┼─────────────┴─────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │      Node.js Bot          │
                    │      (index.js)           │
                    │  ┌─────────────────────┐  │
                    │  │  node-cron          │  │
                    │  │  (スケジューラ)      │  │
                    │  └─────────────────────┘  │
                    │  ┌─────────────────────┐  │
                    │  │  rss-parser         │  │
                    │  │  (RSS取得)          │  │
                    │  └─────────────────────┘  │
                    │  ┌─────────────────────┐  │
                    │  │  cheerio            │  │
                    │  │  (スクレイピング)    │  │
                    │  └─────────────────────┘  │
                    │  ┌─────────────────────┐  │
                    │  │  Scoring Engine     │  │
                    │  │  (スコアリング)      │  │
                    │  └─────────────────────┘  │
                    └─────────────┬─────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
          ▼                       ▼                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  OpenAI API     │     │  Discord API    │     │  Google Apps    │
│  (GPT-4o)       │     │  (discord.js)   │     │  Script         │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                  │                       │
                                  ▼                       ▼
                        ┌─────────────────┐     ┌─────────────────┐
                        │  Discord Server │     │  Google Sheets  │
                        │  - チャンネル    │     │  - ログ記録     │
                        │  - スレッド      │     │  - 重複管理     │
                        └─────────────────┘     └─────────────────┘
```

---

## 2. 機能仕様

### 2.1 AI研究員による厳選ニュース配信

#### 実行タイミング
- Cron式: `0 8 * * *`（毎日 8:00 JST）

#### 処理フロー
1. トレンド・メトリクス更新
2. RSSフィード取得（農業 + Web3）
3. 24時間以内の記事をフィルタ
4. 多段階フィルタリング
   - 【最優先】一次産業 + 技術 + 活用事例
   - 【次善】一次産業 + 技術
   - 【次次善】一次産業 + 活用事例
5. 上位1記事を選出
6. GPT-4oで見解・質問生成
7. Discord投稿 + スレッド作成
8. Google Sheets記録

#### AI分析プロンプト仕様
```
ペルソナ: Metagri研究所の主席研究員
思考プロセス: 5ステップ分析
出力形式: JSON
{
  "insight": "100-150文字の見解",
  "questions": ["質問1", "質問2", "質問3"]
}
```

#### Discord投稿フォーマット
- Embed形式
- 色: ブランドカラー
- フィールド: タイトル、要約、AI見解、議論用質問
- スレッド自動作成

---

### 2.2 国内情報収集ヘッドライン

#### 実行タイミング
- Cron式: `0 6,9,12,15,18 * * *`（6:00, 9:00, 12:00, 15:00, 18:00 JST）

#### 処理フロー
1. 両カテゴリRSSを並行取得
2. 24時間以内の記事をフィルタ
3. スコアリング（7カテゴリ）
4. 動的スコアリング適用
5. 類似記事検出＆統合
6. 上位3件を選出
7. Discord投稿
8. 投稿済みURL記録

#### スコアリング詳細

| カテゴリ | 配列名 | 点数 |
|---------|--------|------|
| コア農業 | CORE_AGRI_KEYWORDS | +3点 |
| 技術革新 | TECH_INNOVATION_KEYWORDS | +5点 |
| 消費者体験 | CONSUMER_EXPERIENCE_KEYWORDS | +5点 |
| 社会課題 | SOCIAL_SUSTAINABILITY_KEYWORDS | +4点 |
| ヒト・ストーリー | HUMAN_STORY_KEYWORDS | +4点 |
| ビジネス・政策 | BUSINESS_POLICY_KEYWORDS | +3点 |
| ボーナス | BUZZ_KEYWORDS | +2点 |

#### シナジーボーナス
- コア農業 + 技術革新: +10点
- コア農業 + 消費者体験: +8点

---

### 2.3 Robloxビジネス速報

#### 実行タイミング
- Cron式: `0 7 * * *`（毎日 7:00 JST）

#### スコアリング

| カテゴリ | 点数 | キーワード例 |
|---------|------|------------|
| ビジネス/ブランド | +5点 | partnership, brand, retail, virtual store |
| プラットフォーム | +5点 | update, feature, engine, studio |
| 財務/市場 | +4点 | earnings, revenue, stock, investment |
| 技術/イノベーション | +3点 | AI, metaverse, VR, AR |

#### フィルタ条件
- スコア4点未満: 除外
- 選出上限: 5件

---

### 2.4 新刊紹介

#### 実行タイミング
- 農業・Web3関連: `0 10 * * *`（毎日 10:00 JST）
- 一般書: `5 10 * * *`（毎日 10:05 JST）

#### 書籍API統合

| API | 優先度 | 用途 |
|-----|--------|------|
| 楽天Books API | 1 | 主検索 |
| OpenBD API | 2 | 詳細情報取得 |
| 版元ドットコム API | 3 | 情報補完 |
| 国立国会図書館 API | 4 | 情報補完 |
| Google Books API | 5 | フォールバック |

#### 重複防止
- ISBNベースでGoogle Sheetsに記録
- 起動時に投稿済みISBNリストを同期

---

### 2.5 海外文献ダイジェスト

#### 実行タイミング
- Cron式: `10 10,19 * * *`（毎日 10:10, 19:10 JST）

#### スコアリング

| カテゴリ | 配列名 | 点数 |
|---------|--------|------|
| 農業 | GLOBAL_AGRI_KEYWORDS | +5点 |
| 技術 | GLOBAL_TECH_KEYWORDS | +5点 |
| 研究 | GLOBAL_RESEARCH_KEYWORDS | +3点 |

#### Agri-Techシナジーボーナス
- 農業 + 技術: +10点（最優先選出）

#### 本文スクレイピング
- cheerioでHTMLパース
- 試行セレクタ: `article`, `.article-body`, `main`, `#content`
- 抽出上限: 8,000文字

---

### 2.6 農業AI通信

#### 実行タイミング
- Cron式: `30 10 * * *`（毎日 10:30 JST）

#### 処理フロー
1. metagri-labo.comからAI Guide記事を取得
2. コンテンツをクリーンアップ（不要なHTML除去）
3. AIGuideCode.gs経由でGoogle Sheetsに転記
   - A1セル: 本文
   - A2セル: URL

---

## 3. データ構造

### 3.1 Google Sheetsシート構成

#### Userシート
| 列 | フィールド名 | 型 | 説明 |
|----|-------------|----|----|
| A | 日時 | DateTime | 発言日時 |
| B | ユーザーID | String | Discord ユーザーID |
| C | ユーザー名 | String | Discord ユーザー名 |
| D | 投稿内容 | String | 発言内容 |
| E | 元ニュースのタイトル | String | 関連ニュースタイトル |
| F | 元ニュースのURL | String | 関連ニュースURL |
| G | 元ニュースの投稿日 | DateTime | ニュース投稿日 |
| H | ロール | String | ユーザーロール（0 or 1） |

#### Newsシート
| 列 | フィールド名 | 型 | 説明 |
|----|-------------|----|----|
| A | 投稿日時 | DateTime | Bot投稿日時 |
| B | タイトル | String | ニュースタイトル |
| C | URL | String | ニュースURL |
| D | ニュースの日付 | DateTime | 記事公開日 |
| E | AIの見解 | String | GPT-4o生成見解 |
| F | AIの質問 | String | GPT-4o生成質問（改行区切り） |

#### Posted_URLsシート
| 列 | フィールド名 | 型 | 説明 |
|----|-------------|----|----|
| A | 投稿日時 | DateTime | 投稿日時 |
| B | URL | String | 記事URL |
| C | タイトル | String | 記事タイトル |
| D | 記事の日付 | DateTime | 記事公開日 |
| E | 優先度 | String | 優先度ラベル |
| F | スコア | Number | スコアリング結果 |

#### Posted_Booksシート
| 列 | フィールド名 | 型 | 説明 |
|----|-------------|----|----|
| A | timestamp | DateTime | 投稿日時 |
| B | isbn | String | ISBN |
| C | title | String | 書籍タイトル |
| D | author | String | 著者 |
| E | publisher | String | 出版社 |
| F | pubdate | String | 発売日 |
| G | score | Number | スコア |
| H | categories | String | カテゴリ |
| I | bookType | String | 書籍タイプ |
| J | postedDate | DateTime | 投稿日 |

#### Global_Researchシート
| 列 | フィールド名 | 型 | 説明 |
|----|-------------|----|----|
| A | 投稿日時 | DateTime | Bot投稿日時 |
| B | 元のタイトル | String | 英語タイトル |
| C | 日本語タイトル | String | AI翻訳タイトル |
| D | URL | String | 記事URL |
| E | 要約 | String | AI生成要約 |
| F | 重要ポイント | String | キーポイント |
| G | 示唆 | String | インプリケーション |
| H | 記事の日付 | DateTime | 記事公開日 |

---

## 4. API仕様

### 4.1 Google Apps Script API

#### doPost エンドポイント

**リクエスト形式**: JSON POST

| type | 用途 | 必須フィールド |
|------|------|--------------|
| `discussion` | スレッド発言記録 | timestamp, userId, username, content, newsTitle, newsUrl, newsPostDate, userRole |
| `news` | 厳選ニュース記録 | title, link, newsDate, metagriInsight, discussionQuestions |
| `addArticles` | 複数記事URL記録 | articles[] (url, title, pubDate, priority, score) |
| `globalResearch` | 海外文献記録 | titleOriginal, titleJa, link, summary, keyPoints, implications, publishDate |
| `newBook` | 新刊記録 | isbn, title, author, publisher, pubdate, score, categories, bookType |
| `getDiscussionMetrics` | 議論メトリクス取得 | なし |
| `getRecentNews` | 過去ニュース取得 | days (optional, default: 7) |
| `aiGuide` | 農業AI通信記録 | content, url |

#### doGet エンドポイント

| type | 用途 | レスポンス |
|------|------|----------|
| (default) | 投稿済みURL取得 | URL配列 (JSON) |
| `getPostedBooks` | 投稿済み書籍取得 | ISBN配列 (JSON) |

---

## 5. キーワード定義

### 5.1 国内ニュース用キーワード

#### CORE_AGRI_KEYWORDS（コア農業）
```javascript
[
  '農業', '農家', '農産', '農作', '農協', '農地', '農村',
  '稲作', '畑作', '果樹', '野菜', '米', '麦', '大豆',
  '畜産', '酪農', '養鶏', '養豚', '肉牛', '乳牛',
  '水産', '漁業', '養殖', '漁師', '漁協',
  '林業', '森林', '木材',
  '圃場', '耕作', '収穫', '播種', '施肥', '防除',
  '品種', '育種', '種苗',
  '一次産業', 'アグリ', 'ファーム'
]
```

#### TECH_INNOVATION_KEYWORDS（技術革新）
```javascript
[
  'AI', '人工知能', '機械学習', 'ディープラーニング',
  'IoT', 'センサー', 'スマート農業', 'アグリテック', 'AgriTech',
  'ドローン', 'ロボット', '自動化', '自動運転', '無人',
  'ブロックチェーン', 'NFT', 'Web3', 'DAO', 'トークン',
  'メタバース', 'VR', 'AR', 'デジタルツイン',
  'データ分析', 'ビッグデータ', 'クラウド', 'SaaS',
  '衛星', 'GPS', 'GNSS', 'リモートセンシング',
  'ゲノム編集', 'バイオ', 'CRISPR',
  'スタートアップ', 'ベンチャー', 'DX', 'デジタル化'
]
```

#### CONSUMER_EXPERIENCE_KEYWORDS（消費者体験）
```javascript
[
  '6次産業', '6次産業化', '六次産業',
  'D2C', '直販', '産直', '道の駅', 'マルシェ',
  'ブランド', 'ブランディング', '付加価値', '高付加価値',
  '体験', '観光農園', '農泊', 'グリーンツーリズム',
  '食育', '地産地消', 'フードマイレージ',
  'EC', 'ネット販売', 'オンライン', 'サブスク',
  'ふるさと納税', '返礼品',
  '輸出', '海外展開', 'インバウンド'
]
```

#### SOCIAL_SUSTAINABILITY_KEYWORDS（社会課題）
```javascript
[
  '食料安全保障', '食料危機', 'フードセキュリティ',
  '人手不足', '担い手不足', '後継者不足', '高齢化',
  '耕作放棄地', '遊休農地', '農地集約',
  '気候変動', '温暖化', '異常気象', '災害',
  'SDGs', '持続可能', 'サステナブル', 'サステナビリティ',
  '有機', 'オーガニック', '減農薬', '無農薬', '環境負荷',
  '脱炭素', 'カーボンニュートラル', 'CO2削減',
  '地方創生', '地域活性化', '過疎', '移住',
  'フードロス', '食品ロス', 'もったいない'
]
```

#### HUMAN_STORY_KEYWORDS（ヒト・ストーリー）
```javascript
[
  '新規就農', '就農', '脱サラ', '転職',
  'Uターン', 'Iターン', 'Jターン',
  '後継者', '事業承継', '世代交代',
  '農業女子', '女性農家', 'アグリガール',
  '若手', '青年', '学生', '高校生',
  '企業参入', '異業種', '副業',
  '挑戦', '成功', '失敗', '奮闘',
  '年収', '収入', '売上', '黒字化'
]
```

#### BUSINESS_POLICY_KEYWORDS（ビジネス・政策）
```javascript
[
  '農業経営', '経営改善', '規模拡大', '法人化',
  '農業法人', '農事組合', '株式会社',
  'JAS', 'GAP', 'HACCP', '認証',
  '補助金', '助成金', '交付金', '支援',
  '農水省', '農林水産省', '農政', '基本法',
  '輸入', '関税', 'FTA', 'EPA', 'TPP',
  '市場', '卸売', 'JA', '農協',
  '契約栽培', '買取', '相場'
]
```

#### BUZZ_KEYWORDS（ボーナス）
```javascript
[
  '提携', '連携', 'パートナーシップ', '協業',
  '実証実験', '実証', 'PoC', '試験導入',
  'コンテスト', 'アワード', '受賞', '表彰',
  '発表', 'リリース', '発売', 'ローンチ',
  '資金調達', '出資', '投資', 'VC'
]
```

#### EXCLUSION_KEYWORDS（除外）
```javascript
[
  '訃報', '死去', '逮捕', '事件', '事故', '詐欺',
  '不正', '違反', '摘発', '捜査',
  'PR', 'プレスリリース', 'お知らせ',
  'セミナー', 'ウェビナー', '募集', '参加者',
  '株価', 'チャート', '相場'
]
```

### 5.2 海外文献用キーワード

#### GLOBAL_AGRI_KEYWORDS
```javascript
[
  'agriculture', 'farming', 'farm', 'farmer',
  'crop', 'livestock', 'dairy', 'poultry',
  'aquaculture', 'fishery', 'forestry',
  'agritech', 'agtech', 'agri-tech',
  'food production', 'food security',
  'harvest', 'cultivation', 'irrigation'
]
```

#### GLOBAL_TECH_KEYWORDS
```javascript
[
  'AI', 'artificial intelligence', 'machine learning',
  'IoT', 'sensor', 'smart farming', 'precision agriculture',
  'drone', 'UAV', 'robot', 'automation', 'autonomous',
  'blockchain', 'NFT', 'Web3', 'DAO', 'token',
  'satellite', 'remote sensing', 'GIS',
  'gene editing', 'CRISPR', 'biotech',
  'startup', 'venture', 'digital'
]
```

#### GLOBAL_RESEARCH_KEYWORDS
```javascript
[
  'research', 'study', 'findings', 'analysis',
  'report', 'publication', 'journal',
  'innovation', 'breakthrough', 'discovery',
  'experiment', 'trial', 'pilot'
]
```

---

## 6. エラーハンドリング

### 6.1 RSS取得エラー
- リトライ: 最大3回（指数バックオフ）
- フォールバック: 他のRSSソースから取得続行

### 6.2 OpenAI APIエラー
- リトライ: 最大3回（指数バックオフ）
- フォールバック: デフォルトメッセージで投稿

### 6.3 Discord API エラー
- リトライ: 最大3回
- ログ: コンソールにエラー詳細出力

### 6.4 Google Apps Script エラー
- リトライ: 最大3回
- フォールバック: メモリキャッシュで継続

### 6.5 スクレイピングエラー
- フォールバック: RSS要約を使用
- 抽出文字数上限: 8,000文字

---

## 7. 拡張ポイント

### 7.1 新しいニュースソースの追加
1. `.env`に新しいRSS URLを追加
2. `index.js`でフィードを取得する処理に追加

### 7.2 新しいスコアリングカテゴリの追加
1. `index.js`上部にキーワード配列を定義
2. スコアリング関数に新カテゴリを追加
3. 必要に応じてシナジーボーナスを設定

### 7.3 新しい投稿先チャンネルの追加
1. `.env`に新しいチャンネルIDを追加
2. GitHub Secretsに追加
3. `index.js`でチャンネルを使用する処理を実装

### 7.4 新しいGASエンドポイントの追加
1. `Code.gs`の`doPost`関数に新しい`type`分岐を追加
2. 必要なシートを自動作成するロジックを追加
3. `index.js`から新エンドポイントを呼び出す処理を実装

---

## 8. 運用ガイドライン

### 8.1 監視項目
- Bot起動状態（Docker logs）
- Discord投稿の成否
- Google Sheetsへの記録状況
- OpenAI API使用量

### 8.2 メンテナンス手順
1. GitHub mainブランチにプッシュ
2. GitHub Actionsが自動デプロイ
3. SSHでサーバーログを確認

### 8.3 トラブルシューティング

| 症状 | 確認ポイント | 対処法 |
|------|------------|--------|
| 投稿されない | スケジュール、チャンネルID | cron式確認、環境変数確認 |
| AI分析なし | OpenAI API キー | APIキー有効性、残高確認 |
| ログ記録なし | GAS URL | デプロイ状態、アクセス権限確認 |
| 重複投稿 | キャッシュ | Bot再起動、Sheets確認 |

---

## 9. バージョン履歴

| バージョン | 日付 | 変更内容 |
|-----------|------|---------|
| 1.0.0 | - | 初期リリース |
| 1.1.0 | - | 動的スコアリング追加 |
| 1.2.0 | - | 重複記事検出追加 |
| 1.3.0 | - | コンテキスト分析追加 |
| 1.4.0 | - | 新刊紹介機能追加 |
| 1.5.0 | - | 農業AI通信機能追加 |

---

## 10. 今後の拡張計画（参考）

### 10.1 機能拡張案
- [ ] ユーザーリアクション分析
- [ ] 自動要約の精度向上
- [ ] 多言語対応
- [ ] Slack連携

### 10.2 技術改善案
- [ ] TypeScript移行
- [ ] テストコード追加
- [ ] モジュール分割
- [ ] ログ管理強化

---

*本仕様書は開発・運用の参考資料です。実際の動作はソースコード（index.js）が正となります。*
