// .envファイルから環境変数を読み込む
require('dotenv').config();

// 必要なライブラリを読み込む
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ChannelType } = require('discord.js');
const cron = require('node-cron');
const Parser = require('rss-parser');
const parser = new Parser();
const axios = require('axios');

// .envから設定を読み込む
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const NEWS_CHANNEL_ID = process.env.NEWS_CHANNEL_ID;
const GOOGLE_APPS_SCRIPT_URL = process.env.GOOGLE_APPS_SCRIPT_URL;
const NEWS_RSS_FEEDS_AGRICULTURE = process.env.NEWS_RSS_FEEDS_AGRICULTURE.split(',');
const NEWS_RSS_FEEDS_WEB3 = process.env.NEWS_RSS_FEEDS_WEB3.split(',');

// ロールIDを読み込む
const BIGNER_ROLE_ID = process.env.BIGNER_ROLE_ID;
const METAGRI_ROLE_ID = process.env.METAGRI_ROLE_ID;

// === キーワード定義 ===
const PRIMARY_INDUSTRY_KEYWORDS = [ '農業', '農家', '農産物', 'アグリ', 'Agri', '畜産', '漁業', '林業', '酪農', '栽培', '養殖', 'スマート農業', 'フードテック', '農林水産', '一次産業', '圃場', '収穫', '品種', 'JGAP' ];
const TECH_KEYWORDS = [ 'Web3', 'ブロックチェーン', 'NFT', 'DAO', 'メタバース', '生成AI', 'LLM', 'ChatGPT', 'AI', '人工知能', 'IoT', 'ドローン', 'DX', 'デジタル', 'ロボット', '自動化', '衛星', 'ソリューション', 'プラットフォーム', 'システム' ];
const USECASE_KEYWORDS = [ '事例', '活用', '導入', '実証実験', '提携', '協業', '開発', 'リリース', '発表', '開始', '連携', '提供' ];


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

// Botが起動したときの処理
client.once("ready", async () => {
  console.log(`Bot is ready! Logged in as ${client.user.tag}`);

  // 毎日朝7時 (JST) に実行するcronジョブを設定 ('分 時 日 月 曜日')
  cron.schedule('0 7 * * *', async () => {

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
      const feedPromises = allFeeds.map(url => 
        parser.parseURL(url).catch(err => {
          console.error(`[Daily News] RSSフィードの取得に失敗しました: ${url}`, err.message);
          return null;
        })
      );
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
      
      const embed = new EmbedBuilder()
        .setColor(0x28a745)
        .setTitle(selectedArticle.title)
        .setURL(selectedArticle.link)
        .setDescription(selectedArticle.contentSnippet?.substring(0, 250) + '...' || '概要はありません。')
        .setFooter({ text: `Source: ${selectedArticle.feed?.title || new URL(selectedArticle.link).hostname}` })
        .setTimestamp(new Date(selectedArticle.isoDate));

  // ▼▼▼ ここからが変更点 ▼▼▼
      // Discordに投稿するメッセージを作成
      const postContent = `
## 【**農業と新技術の注目ニュース！**🌱🤖】

**【ディスカッションに参加しよう！✨】**
このニュースについて、下のスレッドであなたの意見や感想を投稿してみませんか？

## **<MLTT or ポイント配布について>**
✅ <@&1115455932239986738> はMLTT
✅ <@&1105009184442945587> <@&1111648980842053702>  はポイントを
それぞれ1日1回配布します！
⏰ **本日17:00まで**のスレッド内でのご発言が対象となります。
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
          newsDate: selectedArticle.isoDate
      });

    } catch (error) {
      console.error('[Daily News] ニュース投稿中に予期せぬエラーが発生しました:', error);
    }
  });
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
