// .envファイルから環境変数を読み込む
require('dotenv').config();

// 必要なライブラリを読み込む
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ChannelType } = require('discord.js');
const cron = require('node-cron');
const Parser = require('rss-parser');
const parser = new Parser();
const axios = require('axios');
const OpenAI = require('openai'); // OpenAI APIを使用する場合

// .envから設定を読み込む
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const NEWS_CHANNEL_ID = process.env.NEWS_CHANNEL_ID;
const GOOGLE_APPS_SCRIPT_URL = process.env.GOOGLE_APPS_SCRIPT_URL;
const NEWS_RSS_FEEDS_AGRICULTURE = process.env.NEWS_RSS_FEEDS_AGRICULTURE.split(',');
const NEWS_RSS_FEEDS_WEB3 = process.env.NEWS_RSS_FEEDS_WEB3.split(',');
const INFO_GATHERING_CHANNEL_ID = process.env.INFO_GATHERING_CHANNEL_ID;

// OpenAI API設定（.envに追加が必要）
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ロールIDを読み込む
const BIGNER_ROLE_ID = process.env.BIGNER_ROLE_ID;
const METAGRI_ROLE_ID = process.env.METAGRI_ROLE_ID;

// === キーワード定義 ===
const PRIMARY_INDUSTRY_KEYWORDS = [ '農業', '農家', '農産物', 'アグリ', 'Agri', '畜産', '漁業', '林業', '酪農', '栽培', '養殖', 'スマート農業', 'フードテック', '農林水産', '一次産業', '圃場', '収穫', '品種', 'JGAP' ];
const TECH_KEYWORDS = [ 'Web3', 'ブロックチェーン', 'NFT', 'DAO', 'メタバース', '生成AI', 'LLM', 'ChatGPT', 'AI', '人工知能', 'IoT', 'ドローン', 'DX', 'デジタル', 'ロボット', '自動化', '衛星', 'ソリューション', 'プラットフォーム', 'システム' ];
const USECASE_KEYWORDS = [ '事例', '活用', '導入', '実証実験', '提携', '協業', '開発', 'リリース', '発表', '開始', '連携', '提供' ];

// === Metagri研究所の見解生成関数 ===
async function generateMetagriInsight(article) {
  if (!OPENAI_API_KEY) {
    console.log('[AI Insight] OpenAI APIキーが設定されていないため、デフォルトの見解を使用します。');
    return {
      insight: "このニュースは農業の未来に重要な示唆を与えています。",
      questions: [
        "このテクノロジーは日本の農業にどのような影響を与えるでしょうか？",
        "実装における課題は何だと思いますか？"
      ]
    };
  }

  try {
    const prompt = `
# 命令書
あなたは、日本の農業の未来を探求する先進的な組織「Metagri研究所」の主席研究員です。あなたの使命は、最新ニュースを深く分析し、私たちのコミュニティに有益な洞察と活発な議論の火種を提供することです。

# Metagri研究所の理念
- **現場第一主義**: 常に日本の農家の視点を忘れない。
- **技術楽観主義**: テクノロジーは農業の課題を解決する力を持つと信じる。
- **現実直視**: 導入コスト、技術的障壁、法規制など、理想だけではない現実的な課題にも目を向ける。
- **共創の精神**: 私たちの分析は結論ではなく、コミュニティと共に未来を考えるための「たたき台」である。

# 思考プロセス (この手順に従って分析してください)
1.  **事実確認**: ニュースの【タイトル】と【概要】から、何が起きたのか（Who, What, When, Where, Why）を正確に把握する。
2.  **重要点の抽出**: このニュースの核心は何か？「農業」と「テクノロジー」の観点から最も重要なポイントを1〜2つ特定する。
3.  **深掘り分析**:
    - **影響**: この出来事は、日本の農業全体や特定の作物、地域にどのような影響を与えうるか？（短期的・長期的視点）
    - **可能性**: この技術や取り組みが持つ、未来へのポジティブな可能性は何か？
    - **課題**: 実現に向けた課題、あるいは潜在的なリスクは何か？
4.  **総合見解の生成**: 上記の分析を基に、100〜150文字でMetagri研究所としての公式見解をまとめる。希望と現実のバランスを意識すること。
5.  **議論の設計**: 見解を踏まえ、コミュニティメンバーが「自分ごと」として考えたくなるような、具体的で示唆に富む質問を3つ作成する。

# ニュース情報
【ニュースタイトル】
${article.title}

【ニュース概要】
${article.contentSnippet || ''}

# 理想的なアウトプット例（この形式と質感を参考にしてください）
## 例1：農業web3のニュースの場合
{
  "insight": "web3は農業において、透明性・信頼性・参加型の新しい仕組みをもたらす可能性があります。ただし、現状はリテラシー不足や法制度の未整備、ユーザー体験の複雑さといった壁が大きく、理想と現実のギャップはまだ広いのが実情です。web3の価値を農業に溶け込ませるには、仕組みを“わかりやすく楽しい体験”に変換する工夫が不可欠です。技術と農業コミュニティの共創が未来を左右します。",
  "questions": [
    "皆さんにとって『農業×web3』が身近になるために、一番のハードルは何だと思いますか？（理解、コスト、制度、体験価値など）",
    "NFTやトークンを通じて、農家と消費者が“もっと直接つながる”には、どんな仕組みがあると良いでしょうか？",
    "10年後、『農業DAO』や『農産物NFT』は、どれくらい当たり前の存在になっていると思いますか？"
  ]
}

## 例2：農業DAOのニュースの場合
{
  "insight": "DAOは農業において、民主的な意思決定や参加型の資金調達を可能にする新しい仕組みです。ただし現状は法制度や理解度の壁、継続運営の難しさが課題となっています。農業DAOを“地域が共に楽しみながら関わる場”として設計できるかが、理想の実現を左右します。",
  "questions": [
    "皆さんにとって『農業DAO』が実現するとしたら、最も魅力に感じる点はどこですか？（透明性、参加型資金調達、地域活性など）",
    "農業DAOを持続させるために、どんな工夫が必要だと思いますか？",
    "10年後、地域や農業コミュニティにDAOはどれくらい浸透していると思いますか？"
  ]
}

# あなたの成果物 (JSON形式で出力)
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 500,
    });

    const content = response.choices[0].message.content;

    // ▼▼▼ ここからが修正箇所です ▼▼▼
    try {
      // ```json ... ``` のようなマークダウンコードブロックを除去し、JSON部分のみを抽出
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      // マッチしない場合、そのままパースを試みる
      return JSON.parse(content);
    } catch (parseError) {
      console.error('[AI Insight] JSONのパースに失敗しました。AIの応答:', content);
      throw parseError; // エラーを再スローして外側のcatchブロックで処理させる
    }
    // ▲▲▲ ここまでが修正箇所です ▲▲▲

  } catch (error) {
    console.error('[AI Insight] 見解生成中にエラーが発生しました:', error);
    // フォールバック
    return {
      insight: "このニュースは農業とテクノロジーの融合における新たな可能性を示しています。",
      questions: [
        "このアプローチは皆さんの現場でどう活用できそうですか？",
        "実装における課題や懸念点はありますか？",
        "5年後、この技術はどのように進化していると思いますか？"
      ]
    };
  }
}


// ★★★ GASへの書き込み関数を汎用化 ★★★
const logToSpreadsheet = async (type, data) => {
  if (!GOOGLE_APPS_SCRIPT_URL) {
    console.log('[Spreadsheet] GASのURLが設定されていないため、書き込みをスキップします。');
    return;
  }
  try {
    const postData = { type, ...data }; // データに'type'を追加して送信
    await axios.post(GOOGLE_APPS_SCRIPT_URL, postData);
    console.log(`[Spreadsheet] タイプ '${type}' のログ書き込みに成功しました。`);
  } catch (error) {
    console.error('[Spreadsheet] ログの書き込み中にエラーが発生しました:', error.message);
  }
};

// Discordクライアントを初期化
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // ★★★ STEP1で有効化した権限をコードにも追加 ★★★
  ],
  partials: [Partials.Channel],
});

// ▼▼▼ 重複投稿防止用のキャッシュを追加 ▼▼▼
const postedArticleUrls = new Set();
// ▲▲▲ ▲▲▲

/**
 * スプレッドシートから投稿済みURLのリストを取得し、キャッシュを更新する
 */
async function syncPostedUrlsFromSheet() {
  if (!GOOGLE_APPS_SCRIPT_URL) return;
  try {
    console.log('[Info Gathering] Fetching posted URLs from sheet...');
    const response = await axios.get(GOOGLE_APPS_SCRIPT_URL);
    if (Array.isArray(response.data)) {
      response.data.forEach(url => postedArticleUrls.add(url));
      console.log(`[Info Gathering] Synced ${response.data.length} URLs from sheet.`);
    }
  } catch (error) {
    console.error('[Info Gathering] Failed to fetch posted URLs from sheet:', error.message);
  }
}

// Botが起動したときの処理
client.once("ready", async () => {
  console.log(`Bot is ready! Logged in as ${client.user.tag}`);

  // ▼▼▼ この行を追加 ▼▼▼
  await syncPostedUrlsFromSheet();
  // ▲▲▲ ▲▲▲

  // 毎日朝8時 (JST) に実行するcronジョブを設定 ('分 時 日 月 曜日')
  cron.schedule('0 8 * * *', async () => {
 // cron.schedule('40 8 * * *', async () => {

    // cron.schedule('* * * * *', async () => { // テスト用に1分ごとに実行

    console.log('[Daily News] ニュース投稿タスクを開始します...');
    try {
      const channel = await client.channels.fetch(NEWS_CHANNEL_ID);
      if (!channel || channel.type !== ChannelType.GuildText) {
        console.error('[Daily News] ニュース投稿用チャンネルが見つからないか、テキストチャンネルではありません。');
        return;
      }

      const allFeeds = [...NEWS_RSS_FEEDS_AGRICULTURE, ...NEWS_RSS_FEEDS_WEB3];
      let allArticles = [];
      // axiosでXMLを取得し、parser.parseStringで解析する方式に変更
      const feedPromises = allFeeds.map(async (url) => {
        try {
          const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          return await parser.parseString(response.data);
        } catch (err) {
          console.error(`[Daily News] RSSフィードの取得に失敗しました: ${url}`, err.message);
          return null;
        }
      });
      const feeds = await Promise.all(feedPromises);

      for (const feed of feeds) {
        if (feed && feed.items) { allArticles.push(...feed.items); }
      }

      if (allArticles.length === 0) {
        console.log('[Daily News] どのRSSフィードからも記事を取得できませんでした。');
        return;
      }

      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
      const recentArticles = allArticles.filter(article => {
        if (!article.isoDate) return false;
        return new Date(article.isoDate) >= twentyFourHoursAgo;
      });

      if (recentArticles.length === 0) {
        console.log('[Daily News] 直近24時間のニュースが見つかりませんでした。');
        return;
      }
      console.log(`[Daily News] 直近24時間で ${recentArticles.length} 件の記事を取得しました。フィルタリングを開始します...`);

      // ★★★ 多段階フィルタリングロジック ★★★
      let articlesToSelectFrom = [];

      // --- 【最優先】一次産業 + 技術 + 活用事例 ---
      articlesToSelectFrom = recentArticles.filter(article => {
        const content = (article.title + ' ' + (article.contentSnippet || '')).toLowerCase();
        const hasPrimary = PRIMARY_INDUSTRY_KEYWORDS.some(key => content.includes(key.toLowerCase()));
        const hasTech = TECH_KEYWORDS.some(key => content.includes(key.toLowerCase()));
        const hasUsecase = USECASE_KEYWORDS.some(key => content.includes(key.toLowerCase()));
        return hasPrimary && hasTech && hasUsecase;
      });

      // --- 【次善】一次産業 + 技術 ---
      if (articlesToSelectFrom.length === 0) {
        console.log('[Daily News] 最優先条件に合致せず。緩和条件1（一次産業+技術）で再検索...');
        articlesToSelectFrom = recentArticles.filter(article => {
          const content = (article.title + ' ' + (article.contentSnippet || '')).toLowerCase();
          const hasPrimary = PRIMARY_INDUSTRY_KEYWORDS.some(key => content.includes(key.toLowerCase()));
          const hasTech = TECH_KEYWORDS.some(key => content.includes(key.toLowerCase()));
          return hasPrimary && hasTech;
        });
      }

      // --- 【次次善】一次産業 + 活用事例 ---
      if (articlesToSelectFrom.length === 0) {
        console.log('[Daily News] 緩和条件1に合致せず。緩和条件2（一次産業+活用事例）で再検索...');
        articlesToSelectFrom = recentArticles.filter(article => {
            const content = (article.title + ' ' + (article.contentSnippet || '')).toLowerCase();
            const hasPrimary = PRIMARY_INDUSTRY_KEYWORDS.some(key => content.includes(key.toLowerCase()));
            const hasUsecase = USECASE_KEYWORDS.some(key => content.includes(key.toLowerCase()));
            return hasPrimary && hasUsecase;
        });
      }

      // --- 【次次次善】一次産業のみ ---
      if (articlesToSelectFrom.length === 0) {
        console.log('[Daily News] 緩和条件2に合致せず。最終緩和条件（一次産業のみ）で再検索...');
        articlesToSelectFrom = recentArticles.filter(article => {
            const content = (article.title + ' ' + (article.contentSnippet || '')).toLowerCase();
            const hasPrimary = PRIMARY_INDUSTRY_KEYWORDS.some(key => content.includes(key.toLowerCase()));
            return hasPrimary;
        });
      }
      
      if (articlesToSelectFrom.length > 0) {
        console.log(`[Daily News] 最終的に ${articlesToSelectFrom.length} 件の候補が見つかりました。`);
      } else {
        console.log('[Daily News] 本日はキーワードに合致する関連ニュースが見つかりませんでした。');
        return; // どの条件にも合致しなければ終了
      }

      // 候補の中からランダムに1つ選ぶ
      const selectedArticle = articlesToSelectFrom[Math.floor(Math.random() * articlesToSelectFrom.length)];
      
        // === Metagri研究所の見解を生成 ===
      const metagriAnalysis = await generateMetagriInsight(selectedArticle);
      
// Embedを作成
      const embed = new EmbedBuilder()
        .setColor(0x28a745)
        .setTitle(selectedArticle.title)
        .setURL(selectedArticle.link)
        .setDescription(selectedArticle.contentSnippet?.substring(0, 250) + '...' || '概要はありません。')
        // addFieldsを削除
        .setFooter({ text: `Source: ${selectedArticle.feed?.title || new URL(selectedArticle.link).hostname}` })
        .setTimestamp(new Date(selectedArticle.isoDate));

      // 投げかけの質問を含むメッセージを作成
      let discussionQuestions = "**💭 今日の議論テーマ**\n";
      metagriAnalysis.questions.forEach((q, i) => {
        discussionQuestions += `${i + 1}. ${q}\n`;
      });

            const postContent = `
## 【**Metagri研究所 Daily Insight**】🌱🤖

おはようございます！本日の注目ニュースをお届けします。

🔬 **Metagri研究所より**
${metagriAnalysis.insight}

${discussionQuestions}

**【ディスカッションに参加しよう！✨】**
スレッドで皆さまのご意見をお聞かせください。
現場の声、技術的な考察、未来への提案など、どんな視点も歓迎です！

## **<報酬について>**
✅ <@&${METAGRI_ROLE_ID}> はMLTT
✅ <@&${BIGNER_ROLE_ID}> はポイントを
それぞれ1日1回配布します！
⏰ **本日17:00まで**のスレッド内でのご発言が対象となります。

一緒に農業の未来を考えましょう！🌾
`;


      const message = await channel.send({ content: postContent, embeds: [embed] });
      // ▲▲▲ ここまで ▲▲▲

      await message.startThread({
        name: `【議論】${selectedArticle.title.substring(0, 80)}`,
        autoArchiveDuration: 1440,
        reason: 'デイリーニュースに関する議論のため',
      });
        console.log(`[Daily News] ニュースを投稿しました: ${selectedArticle.title}`);
      
      // ★★★ ログ関数呼び出しを修正 ★★★
      await logToSpreadsheet('news', {
          title: selectedArticle.title,
          link: selectedArticle.link,
          newsDate: selectedArticle.isoDate,
    metagriInsight: metagriAnalysis.insight,         // ★記録していた
    discussionQuestions: metagriAnalysis.questions  // ★記録していた
      });

    } catch (error) {
      console.error('[Daily News] ニュース投稿中に予期せぬエラーが発生しました:', error);
    }
  });


 // --- 2. 3時間ごとの情報収集ニュース投稿タスク (新しい機能) ---
  // JSTで朝6時から夜6時まで、3時間ごとに実行 (6, 9, 12, 15, 18時)
  cron.schedule('0 6-18/3 * * *', async () => {
    // cron.schedule('* * * * *', async () => { // テスト用に1分ごとに実行
  console.log('[Info Gathering] 情報収集タスクを開始します...');
    try {
      if (!INFO_GATHERING_CHANNEL_ID) { return; }
      const channel = await client.channels.fetch(INFO_GATHERING_CHANNEL_ID);
      if (!channel || channel.type !== ChannelType.GuildText) { return; }

      // Step 0: カテゴリ別に記事を並行取得
      const fetchArticles = async (urls) => {
        const promises = urls.map(async (url) => {
          try {
            const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            return await parser.parseString(response.data);
          } catch {
            return null;
          }
        });
        const feeds = await Promise.all(promises);
        return feeds.filter(f => f && f.items).flatMap(f => f.items);
      };
      
      const allAgriArticles = await fetchArticles(NEWS_RSS_FEEDS_AGRICULTURE);
      const allTechArticles = await fetchArticles(NEWS_RSS_FEEDS_WEB3);
     
       // Step 1: 直近24時間の記事のみを対象にする
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
      
      const recentAgriArticles = allAgriArticles.filter(a => a.isoDate && new Date(a.isoDate) >= twentyFourHoursAgo);
      const recentTechArticles = allTechArticles.filter(a => a.isoDate && new Date(a.isoDate) >= twentyFourHoursAgo);

      // Step 2: ★★★ 投稿済みの記事を除外する ★★★
      // ▼▼▼ postedArticleUrls が空だと意味がないので、起動時に同期処理を呼び出す必要があります ▲▲▲
      const newAgriArticles = recentAgriArticles.filter(a => !postedArticleUrls.has(a.link));
      const newTechArticles = recentTechArticles.filter(a => !postedArticleUrls.has(a.link));
      console.log(`[Info Gathering] 新規記事候補: 農業関連=${newAgriArticles.length}件, 技術関連=${newTechArticles.length}件`);

      // Step 3: フィルタリングと優先順位付け
      const candidates = [];
      const addedUrls = new Set(); // 候補リスト内での重複を防ぐセット

      // 記事にラベルを付け、重複をチェックしながら候補リストに追加するヘルパー関数
      const addCandidate = (article, label) => {
        if (article && article.link && !addedUrls.has(article.link)) {
          candidates.push({ ...article, priorityLabel: label });
          addedUrls.add(article.link);
        }
      };
      
    // --- 【優先度1】農業記事 ∩ 技術キーワード ---
      const priority1 = newAgriArticles.filter(a => TECH_KEYWORDS.some(k => (a.title + (a.contentSnippet||'')).toLowerCase().includes(k.toLowerCase())));
      priority1.forEach(a => addCandidate(a, 'P1: Agri x Tech'));

      // --- 【優先度2】技術記事 ∩ 農業キーワード ---
      const priority2 = newTechArticles.filter(a => PRIMARY_INDUSTRY_KEYWORDS.some(k => (a.title + (a.contentSnippet||'')).toLowerCase().includes(k.toLowerCase())));
      priority2.forEach(a => addCandidate(a, 'P2: Tech x Agri'));
      
      // --- 【優先度3】残りの農業記事（新しい順）---
      newAgriArticles.sort((a, b) => new Date(b.isoDate) - new Date(a.isoDate));
      newAgriArticles.forEach(a => addCandidate(a, 'P3: Agri General'));

      // --- 【優先度4】残りの技術記事（新しい順）---
      newTechArticles.sort((a, b) => new Date(b.isoDate) - new Date(a.isoDate));
      newTechArticles.forEach(a => addCandidate(a, 'P4: Tech General'));
      
      // Step 5: 最終的に上位3件を抽出
      const finalArticles = candidates.slice(0, 3);
      
      if (finalArticles.length === 0) {
        console.log('[Info Gathering] 投稿対象の記事がありませんでした。');
        return;
      }

      console.log('[Info Gathering] 最終選考記事リスト:');
      finalArticles.forEach((article, index) => {
        console.log(`  ${index + 1}. [${article.priorityLabel}] ${article.title}`);
      });
      // ▲▲▲ ロジック改善とラベリングここまで ▲▲▲

      let postContent = `### 🚀 最新情報ヘッドライン（${finalArticles.length}件）\n---\n`;
      const articlesToLog = [];

      finalArticles.forEach((article, index) => {
        postContent += `**${index + 1}. ${article.title}**\n${article.link}\n\n`;
        postedArticleUrls.add(article.link);
        articlesToLog.push({
          url: article.link,
          title: article.title,
          pubDate: article.isoDate,
          priority: article.priorityLabel // ▼▼▼ ラベルもログに記録 ▼▼▼
        });
      });

      await channel.send({ content: postContent });
      console.log(`[Info Gathering] ${finalArticles.length}件のニュースを投稿しました。`);

      if (articlesToLog.length > 0) {
        await logToSpreadsheet('addArticles', { articles: articlesToLog });
      }

    } catch (error) {
      console.error('[Info Gathering] タスク実行中にエラーが発生しました:', error);
    }
  }, {
    timezone: "Asia/Tokyo"
  });

  console.log('Daily news (8am) and Info gathering (6am-6pm, every 3h) jobs have been scheduled.');
});

// ★★★ 議論スレッドのメッセージ監視ロジックを更新 ★★★
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;
  if (!message.channel.isThread()) return;

  try {
    const starterMessage = await message.channel.fetchStarterMessage();
    if (starterMessage.author.id !== client.user.id) return;

    const newsEmbed = starterMessage.embeds[0];
    if (!newsEmbed) return;

    const newsTitle = newsEmbed.title;
    const newsUrl = newsEmbed.url;
    const newsPostDate = newsEmbed.timestamp;

    // ▼▼▼ ここからが重要な変更点 ▼▼▼
    let userRoleIndicator = null; // デフォルトはnull (どちらのロールでもない)
    const memberRoles = message.member.roles.cache;

    // METAGRI_ROLEを優先して判定
    if (METAGRI_ROLE_ID && memberRoles.has(METAGRI_ROLE_ID)) {
      userRoleIndicator = 1;
    } else if (BIGNER_ROLE_ID && memberRoles.has(BIGNER_ROLE_ID)) {
      userRoleIndicator = 0;
    }
    // ▲▲▲ ここまで ▲▲▲

    console.log(`[Discussion Log] ニュース「${newsTitle}」のスレッド内で投稿を検知 (Role: ${userRoleIndicator})`);

    await logToSpreadsheet('discussion', {
      timestamp: message.createdAt.toISOString(),
      userId: message.author.id,
      username: message.author.username,
      content: message.content,
      newsTitle: newsTitle,
      newsUrl: newsUrl,
      newsPostDate: newsPostDate,
      // ▼▼▼ 送信するデータにロール判定結果を追加 ▼▼▼
      userRole: userRoleIndicator
    });

  } catch (error) {
    if (error.code !== 10008) { 
      console.error('[Discussion Log] ログ記録中にエラーが発生しました:', error);
    }
  }
});

// Discordにログイン
client.login(DISCORD_BOT_TOKEN);
