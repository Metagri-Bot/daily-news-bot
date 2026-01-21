// .envファイルから環境変数を読み込む
require('dotenv').config();

// Webページの内容を取得（スクレイピング）するために、cheerioというライブラリを使用
const cheerio = require('cheerio');

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

// === AIツール動向専用RSSフィード（新規追加） ===
const NEWS_RSS_FEEDS_AI_TOOLS = [
  'https://rss.itmedia.co.jp/rss/2.0/aiplus.xml'  // ITmedia AI+
];
const INFO_GATHERING_CHANNEL_ID = process.env.INFO_GATHERING_CHANNEL_ID;

// === 海外文献用の新しい環境変数 ===
const GLOBAL_RESEARCH_CHANNEL_ID = process.env.GLOBAL_RESEARCH_CHANNEL_ID;
const GLOBAL_RSS_FEEDS = process.env.GLOBAL_RSS_FEEDS ? process.env.GLOBAL_RSS_FEEDS.split(',') : [];

// === Robloxニュース用の新しい環境変数 ===
const ROBLOX_NEWS_CHANNEL_ID = process.env.ROBLOX_NEWS_CHANNEL_ID;
const ROBLOX_RSS_FEEDS = process.env.ROBLOX_RSS_FEEDS ? process.env.ROBLOX_RSS_FEEDS.split(',') : [];

// === 新刊紹介機能用の環境変数 ===
const NEW_BOOK_CHANNEL_ID = process.env.NEW_BOOK_CHANNEL_ID;
const POPULAR_BOOK_CHANNEL_ID = process.env.POPULAR_BOOK_CHANNEL_ID;
const RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID;

// === 農業AI通信（AI Guide）用の設定 ===
const AI_GUIDE_CHANNEL_ID = '952206763539714088';
const AI_GUIDE_RSS_URL = 'https://metagri-labo.com/ai-guide/feed/';

// OpenAI API設定（.envに追加が必要）
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ロールIDを読み込む
const BIGNER_ROLE_ID = process.env.BIGNER_ROLE_ID;
const METAGRI_ROLE_ID = process.env.METAGRI_ROLE_ID;

// === キーワード定義（旧） ===
const TECH_KEYWORDS = [ 'Web3', 'ブロックチェーン', 'NFT', 'DAO', 'メタバース', '生成AI', 'LLM', 'ChatGPT', 'AI', '人工知能', 'IoT', 'ドローン', 'DX', 'デジタル', 'ロボット', '自動化', '衛星', 'ソリューション', 'プラットフォーム', 'システム' ];
const PRIMARY_INDUSTRY_KEYWORDS = [ '農業', '農家', '農産物', '畜産', '漁業', '林業', '酪農', '栽培', '養殖', 'スマート農業', 'フードテック', '農林水産', '一次産業', '圃場', '収穫', '品種', 'JGAP' ];
const USECASE_KEYWORDS = [ '事例', '活用', '導入', '実証実験', '提携', '協業', '開発', 'リリース', '発表', '開始', '連携', '提供' ];

// === 海外文献用のキーワード（英語） ===
const GLOBAL_AGRI_KEYWORDS = [
  'agriculture', 'agribusiness', 'agronomy', 'agrotech', 'agtech', 'agritech',
  'farming', 'farmer', 'farm',
  'livestock', 'aquaculture', 'aquaponics',
  'soil', 'irrigation',
  'horticulture', 'forestry', 'fishery',
  'regenerative ag', 'sustainable agriculture', 'vertical farming',
  'food security', 'food system', 'precision agriculture', 'smart farming', 'digital agriculture',
  'agritech', 'agtech', 'vertical farming', 'sustainable agriculture',
  'IoT agriculture', 'drone farming', 'satellite agriculture'
];

const GLOBAL_TECH_KEYWORDS = [
  'blockchain', 'artificial intelligence', 'machine learning', 'IoT', 'drone', 'satellite',
  'robotics', 'automation', 'digital twin', 'data analytics', 'sensor', 'computer vision',
  'climate tech', 'biotech', 'gene editing', 'CRISPR', 'synthetic biology',  'blockchain agriculture', 'Web3 farming', 'metaverse agriculture', 'metaverse', 'Web3', 'Generative AI', 'LLM', 'ChatGPT',
  'AI agriculture', 'machine learning crop', 'digital twin farming',
  'smart contracts agriculture', 'NFT agriculture', 'DeFi agriculture'
];

const GLOBAL_RESEARCH_KEYWORDS = [
  'research', 'study', 'paper', 'journal', 'findings', 'innovation', 'breakthrough',
  'development', 'trial', 'experiment', 'analysis', 'report', 'publication'
];

// === 新しいキーワードカテゴリ ===

// 【1. コア農業キーワード】（+3点） - 記事の土台
const CORE_AGRI_KEYWORDS =  [
  // 基本
  '野菜', '農業', '農家', '農産物', '畜産', '漁業', '林業', '酪農', '栽培', '養殖', '収穫', '品種', '圃場', '水産',
  // 新農法・技術
  '乾田直播', '不耕起', 'リジェネラティブ農業', '環境再生型', '陸上養殖', '植物工場', 'バイオ炭', 'バイオスティミュラント'
];

// 【2. テクノロジー・革新キーワード】（+5点） - Metagriらしさ
const TECH_INNOVATION_KEYWORDS = [
  // AI / 生成AI 関連（基本）
  'AI', '人工知能', '生成AI', 'LLM', 'エージェント',

  // Web3 / ブロックチェーン 関連
  'Web3', 'ブロックチェーン', 'NFT', 'DAO', 'メタバース', 'ウォレット', 'RWA', 'DeFi', 'スマートコントラクト', 'トークンエコノミー', 'トークン', 'デジタルツイン', 'デジタルツイン農業',

  // ★ Web3の日常利用・決済関連（新規追加）
  'ステーブルコイン', 'JPYC', 'USDC', 'USDT', 'QR決済', 'マイナウォレット', 'デジタル円', 'CBDC', 'デジタル通貨', '暗号資産決済', 'クリプト決済',
  '商店街DAO', '地域DAO', 'コミュニティDAO', 'ガバナンス', '分散型', '自律分散',

  // スマート農業 / IoT 関連
  'スマート農業', 'IoT', 'ドローン', 'ロボット', '自動化', '衛星', 'DX', 'デジタル', 'フードテック', 'アグリテック', '農業DX', '精密農業', 'センサー', 'コンピュータビジョン', 'データ解析', '気象予測', 'リモートセンシング', '画像解析', '農業用ドローン', '農業用ロボット',

  // バイオ・環境技術 関連
  'カーボンクレジット', 'ゲノム編集', 'フードテック', '培養肉', '代替肉', 'バイオ炭',

  // その他（概念・手法）
  'VR', 'ソリューション', 'プラットフォーム', 'システム'
];

// 【2.5 AIツール動向キーワード】（+6点） - 最先端AIツールのアップデートとビジネス活用
const AI_TOOLS_KEYWORDS = [
  // 主要AIサービス・企業
  'ChatGPT', 'GPT-4', 'GPT-5', 'OpenAI', 'Claude', 'Anthropic', 'Gemini', 'Google AI', 'Copilot', 'Microsoft AI',
  'Perplexity', 'Llama', 'Meta AI', 'Mistral', 'Grok', 'xAI',

  // 動画・画像・音声生成AI
  'Runway', 'Gen-4', 'Gen-5', 'Sora', 'Pika', 'Midjourney', 'DALL-E', 'Stable Diffusion', 'Flux',
  '動画生成AI', '画像生成AI', '音声生成AI', '3Dモデル生成', 'テキスト読み上げ', 'ボイスクローン',

  // コーディング・開発支援AI
  'Vibe Coding', 'バイブコーディング', 'Cursor', 'Windsurf', 'Devin', 'GitHub Copilot', 'Cline', 'Aider',
  'AIコーディング', 'AIプログラミング', 'コード生成',

  // AI活用・実務関連
  '利用上限', 'API', 'プロンプト', 'ファインチューニング', 'RAG', 'エンベディング',
  'AI活用', 'AI導入', 'AI実装', '業務効率化', '生産性向上', 'AIエージェント', 'マルチモーダル',

  // AI関連トレンドワード
  'AGI', '汎用人工知能', 'AI規制', 'AI倫理', 'AIガバナンス'
];

// 【3. 消費者・体験キーワード】（+5点） - 新しい価値
const CONSUMER_EXPERIENCE_KEYWORDS = [ 
   // ビジネスモデル
   '6次産業化', '直売所', 'サブスク', 'スタートアップ', 'ビジネスコンテスト',
    // 商品・サービス
   'スイーツ', '地ビール', '商品開発', 'ブランド', '体験', 'ツーリズム', 'オーナー制度', 'レストラン', 'マンガ', '昆虫食','食の安全', '食の安心', 'トレーサビリティ' , '観光農園', '体験農園', '農泊', 'アグリツーリズム', 'グリーンツーリズム'
  ];

// 【4. 社会課題・サステナビリティキーワード】（+4点） - 大義
const SOCIAL_SUSTAINABILITY_KEYWORDS = [
  // 環境・サステナビリティ
  'オーガニック', '食料危機', '規格外', '食品ロス', 'ゼロ廃棄', '環境再生型', 'サステナブル', '熱中症対策', '有機農業', '環境保全', 'SDGs', '食料安全保障', '食料自給率',
  'フードロス', '食料廃棄', '鳥獣害', '病害虫', '気候変動',

  // ★ 地方創生・地域活性化（強化）
  '地方創生', '地域活性化', '地域振興', '中山間地域', '過疎地域', '限界集落', '関係人口', '移住促進', '地域課題', '地域DX', 'ローカルDX',

  // ★ 実用化・導入支援（新規追加）
  '補助金', '助成金', '実証実験', '導入事例', '活用事例', '成功事例', '右腕', 'サポート', 'アシスタント', '業務支援', '経営支援', '営農支援',

  // 現場の課題
  '人手不足', '古米', '耕作放棄地', '高齢化', '後継者不足', '労働力不足', '担い手不足', '農地集約', '農地中間管理機構', '農業従事者', '農業労働力', '農業就業人口'
];

// 【5. ヒト・ストーリーキーワード】（+4点） - 共感
const HUMAN_STORY_KEYWORDS = [ '挑戦', '想い', '高校生', '脱サラ', '奮闘記', '農家グループ' ,   '担い手', '後継者', '就農', '新規就農', '認定農業者', '農業研修', '農業法人', '挑戦', '想い', '高校生','大学生', '脱サラ', '農家グループ', '奮闘記', '地域おこし協力隊', '関係人口', '二地域居住', '移住', '定住'];

// 【カテゴリ6】ビジネス・政策・制度 (+3点) - 専門的・制度的な側面を補強するキーワード
const BUSINESS_POLICY_KEYWORDS = [
  '農業経営', 'アグリビジネス', '農業経済', '農業金融', '農業保険', '農業共済', '農業政策', '農業白書', 'JAS',
  'GAP', 'HACCP', '有機JAS', 'GLOBALG.A.P', '地理的表示', 'GI', 'JA', '農業協同組合', '農業委員会',
  'ふるさと納税', '農業振興', '基本法', '食料供給'
];

// 【ボーナスキーワード】（+2点） - 議論のきっかけ
const BUZZ_KEYWORDS = [ '異業種', 'コラボ', '提携', '実証実験', 'コンテスト', 'MOU', '連携', 'ソリューション', 'プラットフォーム', 'システム', '農機具', '農業機械', '農業資材' ];

// === ニュース選抜から除外するキーワード ===
const EXCLUSION_KEYWORDS = [
  'metagri', '農情人', 'metagri研究所', '農業aiハッカソン2025',
  // 「アグリ」を含むが無関係な単語を除外
  'アグリゲーター', 'アグリゲート', 'アグリーメント', 'aggregator', 'aggregate', 'agreement'
]; // キーワードは小文字で定義

// === Robloxニュース選定用キーワード（英語） ===
const ROBLOX_BUSINESS_KEYWORDS = [ // ビジネス・ブランド活用事例 (+5点)
  'partner', 'partnership', 'collaboration', 'brand', 'marketing', 'campaign',
  'retail', 'ecommerce', 'virtual store', 'concert', 'event', 'gucci', 'nike', 'disney', 'experience', 'adidas', 'lego', 'warner bros', 'unilever', 'coca-cola', 'mcdonalds', 'starbucks', 'netflix', 'marvel', 'dc', 'sony', 'playstation', 'xbox'
];
const ROBLOX_PLATFORM_KEYWORDS = [ // プラットフォームの大型アップデート (+5点)
  'update', 'feature', 'release', 'engine', 'studio', 'developer', 'creator',
  'economy', 'monetization', 'marketplace', 'immesive ads', 'UGC'
];
const ROBLOX_FINANCE_KEYWORDS = [ // 財務・投資・市場動向 (+4点)
  'earnings', 'revenue', 'stock', 'shares', 'investment', 'acquisition', 'ipo',
  'financial', 'quarterly', 'growth', 'MAU', 'DAU'
];
const ROBLOX_TECH_KEYWORDS = [ // 技術・イノベーション (+3点)
  'AI', 'generative ai', 'metaverse', 'avatar', 'virtual reality', 'VR', 'AR',
  'physics', 'rendering', 'phygital', 'virtual goods', 'digital twin', 'shopify', 'vr', 'virtual reality', 'augmented reality', 'ar'
];

// ▼▼▼ 以下の新しい関数を追加 ▼▼▼
/**
 * URLから記事の本文を取得する
 * @param {string} url 記事のURL
 * @returns {Promise<string|null>} 記事の本文テキスト、または取得失敗時にnull
 */
async function scrapeArticleContent(url) {
  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1', // Do Not Track
      'Upgrade-Insecure-Requests': '1',
      'Connection': 'keep-alive',
      'Referer': 'https://www.google.com/' // Google検索から来たと見せかける
    };

    const { data } = await axios.get(url, { headers, timeout: 15000 }); // タイムアウトを15秒に延長
    const $ = cheerio.load(data);

    // (以降のセレクタと本文抽出ロジックは変更なし)
    const contentSelectors = [
      'article', '.article-body', '.post-content', '#content', 
      '.entry-content', 'div[class*="content"]', 'main'
    ];
    let bodyText = '';
    for (const selector of contentSelectors) {
      if ($(selector).length) {
        bodyText = $(selector).text();
        break;
      }
    }
    if (!bodyText) { bodyText = $('p').text(); }
    
    const cleanedText = bodyText.replace(/\s\s+/g, ' ').trim();
    return cleanedText.substring(0, 8000);
    
  } catch (error) {
    console.error(`[Scraping] 記事本文の取得に失敗: ${url}`, error.message);
    return null;
  }
}
  

/**
 * Roblox関連の英語ニュースを日本語に翻訳・要約する (ロジック緩和版)
 * @param {object} article 記事オブジェクト
 * @returns {Promise<object|null>} 翻訳結果、または失敗時にnull
 */
async function translateAndSummarizeRobloxArticle(article) {
  if (!OPENAI_API_KEY) {
    console.log('[Roblox AI] OpenAI APIキーが設定されていません。');
    return null;
  }

  try {
    // スクレイピングを試みるのは海外文献と同様
    const fullContent = await scrapeArticleContent(article.link);
    // 記事全文があればそれを使い、なければRSSの概要、それもなければ空文字
    const contentForAI = fullContent || article.contentSnippet || '';

    // ▼▼▼ ここからが重要な変更点 ▼▼▼
    const prompt = `
あなたは、メタバースとゲーム業界を専門とするアナリストです。
以下のRoblox関連の英語ニュースを日本語に翻訳し、ビジネスパーソン向けに要点をまとめてください。

【記事タイトル】
${article.title}

【記事概要】
${contentForAI}

【要求事項】
以下のJSON形式で返してください。
もし【記事概要】が非常に短い、または空の場合でも、**【記事タイトル】から内容を最大限推測し**、あなたの知識を基に可能な限り要約を作成してください。
{
  "titleJa": "日本語のタイトル",
  "summary": "日本語の要約（150-250文字）"
}

【注意点】
- 企業の活用事例、プラットフォームのアップデート、市場動向など、ビジネス上の重要点に焦点を当てること。
- 専門用語は避け、分かりやすい言葉で要約すること。
`;
    // ▲▲▲ ▲▲▲

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 1024,
    });

    const content = response.choices[0].message.content;

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return JSON.parse(content);
    } catch (parseError) {
      console.error('[Roblox AI] JSONのパースに失敗しました。AIの応答:', content);
      return null;
    }

  } catch (error) {
    console.error('[Roblox AI] 翻訳・要約中にエラーが発生しました:', error);
    return null;
  }
}
//   try {
//     const { data } = await axios.get(url, {
//       headers: {
//         'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
//       }
//     });
//     const $ = cheerio.load(data);

//     // 一般的な記事本文が含まれる可能性のあるセレクタを試す
//     const contentSelectors = [
//       'article', '.article-body', '.post-content', 
//       '#content', '.entry-content', 'div[class*="content"]'
//     ];
//     let bodyText = '';
//     for (const selector of contentSelectors) {
//       if ($(selector).length) {
//         bodyText = $(selector).text();
//         break;
//       }
//     }

//     // セレクタで見つからなければ、<p>タグをすべて結合する
//     if (!bodyText) {
//       bodyText = $('p').text();
//     }
    
//     // 不要な空白や改行を整理し、長さを制限
//     const cleanedText = bodyText.replace(/\s\s+/g, ' ').trim();
//     return cleanedText.substring(0, 8000); // OpenAIのトークン制限を考慮
//   } catch (error) {
//     console.error(`[Scraping] 記事本文の取得に失敗: ${url}`, error.message);
//     return null;
//   }
// }

// === 海外文献の翻訳・要約関数 ===
async function translateAndSummarizeArticle(article) {
  if (!OPENAI_API_KEY) {
    console.log('[Global Research] OpenAI APIキーが設定されていません。');
    return null;
  }

   try {
     // ▼▼▼ 記事本文の取得処理を追加 ▼▼▼
    const fullContent = await scrapeArticleContent(article.link);
    const contentForAI = fullContent || article.contentSnippet || article.content || '';

    // 本文が短すぎる場合はAPIコール前にスキップ
    if (!contentForAI || contentForAI.length < 200) { 
      console.log(`[Global Research] 記事内容が短すぎるため翻訳をスキップ: ${article.title}`);
      return null;
    }
    // ▲▲▲ ▲▲▲

    const prompt = `
以下の英語記事を日本語で要約してください。専門用語は適切に翻訳し、農業技術の専門家向けの内容として整理してください。

【記事タイトル】
${article.title}

【記事内容】
${contentForAI} // ← 変数を置き換え
// ${article.contentSnippet || article.content || ''}

// ▼▼▼ 以下を追加・修正 ▼▼▼
【要求事項】
以下のJSON形式で**必ず**返してください。
もし記事内容が不十分で要約できない場合でも、各項目に「情報不足」などと記入し、JSONの構造は維持してください。
{
  "titleJa": "日本語タイトル",
  "summary": "要約（200-300文字）",
  "keyPoints": ["重要ポイント1", "重要ポイント2", "重要ポイント3"],
  "implications": "日本の農業への示唆（100-150文字）",
  "technicalTerms": {"英語用語1": "日本語訳1", "英語用語2": "日本語訳2"}
}
// ▲▲▲ ▲▲▲

【注意点】
- 農業技術の専門的な内容を正確に翻訳
- 日本の農業コンテキストとの関連性を意識
- 技術的な新規性や革新性を強調
`;


    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
       temperature: 0.3,
      max_tokens: 2048, // ▼▼▼ 1000から2048に増やします ▼▼▼
    });

    const content = response.choices[0].message.content;

    // ▼▼▼ JSONパース部分のエラーハンドリングを強化 ▼▼▼
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return JSON.parse(content);
    } catch (parseError) {
      console.error('[Global Research] JSONのパースに失敗しました。AIの応答:', content);
      return null; // パースに失敗した場合はnullを返し、処理をスキップさせる
    }
    // ▲▲▲ ▲▲▲
    return JSON.parse(content);
  } catch (error) {
    console.error('[Global Research] 翻訳・要約中にエラーが発生しました:', error);
    return null;
  }
}

// === 海外文献のフィルタリング関数（強化版） ===
function filterGlobalArticles(articles) {
  const scoredArticles = [];
  console.log('[Global Research] Filtering articles...');

  for (const article of articles) {
    const content = (article.title + ' ' + (article.contentSnippet || '')).toLowerCase();
    let score = 0;
    const matchedCategories = new Set(); // どのカテゴリにマッチしたか記録

    // カテゴリごとにキーワードのマッチをチェック
    const hasAgri = GLOBAL_AGRI_KEYWORDS.some(k => content.includes(k.toLowerCase()));
    if (hasAgri) matchedCategories.add('Agri');

    const hasTech = GLOBAL_TECH_KEYWORDS.some(k => content.includes(k.toLowerCase()));
    if (hasTech) matchedCategories.add('Tech');

    const hasResearch = GLOBAL_RESEARCH_KEYWORDS.some(k => content.includes(k.toLowerCase()));
    if (hasResearch) matchedCategories.add('Research');

    // --- 【必須条件】 ---
    // 農業キーワードが含まれていない記事は、この時点で除外
    if (!matchedCategories.has('Agri')) {
      continue; // 次の記事へ
    }

    // --- スコアリング ---
    score += 5; // 農業キーワードが含まれているので基礎点

    if (matchedCategories.has('Tech')) score += 5;
    if (matchedCategories.has('Research')) score += 3;

    // --- 【ボーナス】 ---
    // 農業と技術の両方が含まれる場合に、さらに大きなボーナス
    if (matchedCategories.has('Agri') && matchedCategories.has('Tech')) {
      score += 10;
      matchedCategories.add('Agri-Tech Synergy');
    }
    
    // スコアが0より大きい場合のみ候補に追加
    if (score > 0) {
      scoredArticles.push({ 
        article, 
        score,
        label: Array.from(matchedCategories).join(' + ')
      });
    }
  }
  
  console.log(`[Global Research] Found ${scoredArticles.length} relevant articles.`);

  // スコアの高い順にソート
  scoredArticles.sort((a, b) => b.score - a.score);

  // ログに上位候補を表示
  console.log('[Global Research] Top candidates:');
  scoredArticles.slice(0, 5).forEach(item => {
    console.log(`  - Score: ${item.score}, [${item.label}], Title: ${item.article.title}`);
  });

  return scoredArticles.map(item => item.article);
}

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
    // ★★★ トレンドコンテキストを構築 ★★★
    let trendContext = '';
    if (cachedTrendAnalysis && cachedTrendAnalysis.trendingSummary !== 'トレンドキーワードなし') {
      trendContext = `
# 過去7日間のトレンド情報（参考情報）
直近1週間でコミュニティが注目しているトピック: ${cachedTrendAnalysis.trendingSummary}

この情報を踏まえて、今回のニュースが「継続的なトレンド」なのか「新しい展開」なのかを考慮した分析を行ってください。
`;
    }

    const prompt = `
# 命令書
あなたは、日本の農業の未来を探求する先進的な組織「Metagri研究所」の主席研究員です。あなたの使命は、最新ニュースを深く分析し、私たちのコミュニティに有益な洞察と活発な議論の火種を提供することです。

# Metagri研究所の理念
- **現場第一主義**: 常に日本の農家の視点を忘れない。
- **技術楽観主義**: テクノロジーは農業の課題を解決する力を持つと信じる。
- **現実直視**: 導入コスト、技術的障壁、法規制など、理想だけではない現実的な課題にも目を向ける。
- **共創の精神**: 私たちの分析は結論ではなく、コミュニティと共に未来を考えるための「たたき台」である。
${trendContext}
# 思考プロセス (この手順に従って分析してください)
1.  **事実確認**: ニュースの【タイトル】と【概要】から、何が起きたのか（Who, What, When, Where, Why）を正確に把握する。
2.  **重要点の抽出**: このニュースの核心は何か？「農業」と「テクノロジー」の観点から最も重要なポイントを1〜2つ特定する。
3.  **深掘り分析**:
    - **影響**: この出来事は、日本の農業全体や特定の作物、地域にどのような影響を与えうるか？（短期的・長期的視点）
    - **可能性**: この技術や取り組みが持つ、未来へのポジティブな可能性は何か？
    - **課題**: 実現に向けた課題、あるいは潜在的なリスクは何か？
    - **トレンドとの関連**: (もしトレンド情報が提供されていれば) このニュースは最近の傾向とどう関連しているか？
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
const postedGlobalArticleUrls = new Set(); // ▼▼▼ この行を追加 ▼▼▼
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

/**
 * Google Sheetsから過去の議論データを取得し、記事ごとの反応メトリクスを計算
 * @returns {Promise<Map>} 記事URLをキーとした反応メトリクスのMap
 */
async function getDiscussionMetricsFromSheet() {
  if (!GOOGLE_APPS_SCRIPT_URL) return new Map();

  try {
    console.log('[Dynamic Scoring] Fetching discussion metrics from sheet...');
    const response = await axios.post(GOOGLE_APPS_SCRIPT_URL, {
      type: 'getDiscussionMetrics'
    });

    if (!response.data || !Array.isArray(response.data)) {
      console.log('[Dynamic Scoring] No discussion data available.');
      return new Map();
    }

    // 記事URLごとに議論メトリクスを集計
    const metricsMap = new Map();

    for (const row of response.data) {
      const { newsUrl, content } = row;
      if (!newsUrl) continue;

      if (!metricsMap.has(newsUrl)) {
        metricsMap.set(newsUrl, {
          postCount: 0,
          totalContentLength: 0,
          avgContentLength: 0
        });
      }

      const metrics = metricsMap.get(newsUrl);
      metrics.postCount += 1;
      metrics.totalContentLength += (content || '').length;
    }

    // 平均コメント長を計算
    for (const [url, metrics] of metricsMap) {
      if (metrics.postCount > 0) {
        metrics.avgContentLength = Math.round(metrics.totalContentLength / metrics.postCount);
      }
    }

    console.log(`[Dynamic Scoring] Loaded metrics for ${metricsMap.size} articles.`);
    return metricsMap;

  } catch (error) {
    console.error('[Dynamic Scoring] Failed to fetch discussion metrics:', error.message);
    return new Map();
  }
}

/**
 * 過去の反応データとキーワードパターンから動的にスコアを調整
 * @param {object} article 記事オブジェクト
 * @param {number} baseScore 基本スコア
 * @param {Set} matchedCategories マッチしたカテゴリのSet
 * @param {Map} historicalMetrics 過去の記事の反応メトリクス
 * @returns {number} 調整後のスコア
 */
function applyDynamicScoring(article, baseScore, matchedCategories, historicalMetrics) {
  let adjustedScore = baseScore;

  // 同じカテゴリパターンを持つ過去の記事の平均反応を計算
  const categoryPattern = Array.from(matchedCategories).sort().join('+');

  // historicalMetricsから同じようなキーワードパターンを持つ記事を探す
  const similarArticles = [];

  for (const [url, metrics] of historicalMetrics) {
    // 簡易的に投稿数が多い記事を「良い記事」と判定
    if (metrics.postCount >= 3) {
      similarArticles.push(metrics);
    }
  }

  if (similarArticles.length > 0) {
    // 過去の反応が良かった記事の平均投稿数を計算
    const avgPostCount = similarArticles.reduce((sum, m) => sum + m.postCount, 0) / similarArticles.length;
    const avgContentLength = similarArticles.reduce((sum, m) => sum + m.avgContentLength, 0) / similarArticles.length;

    // 投稿数が多いキーワードパターンにボーナス
    if (avgPostCount >= 10) {
      adjustedScore += Math.round(baseScore * 0.20); // +20%
      console.log(`[Dynamic Scoring] High engagement pattern detected. Bonus: +20%`);
    } else if (avgPostCount >= 5) {
      adjustedScore += Math.round(baseScore * 0.15); // +15%
      console.log(`[Dynamic Scoring] Good engagement pattern. Bonus: +15%`);
    } else if (avgPostCount >= 3) {
      adjustedScore += Math.round(baseScore * 0.10); // +10%
      console.log(`[Dynamic Scoring] Moderate engagement. Bonus: +10%`);
    }

    // 長文コメントが多いキーワードパターンにもボーナス
    if (avgContentLength >= 200) {
      adjustedScore += Math.round(baseScore * 0.10); // +10%
      console.log(`[Dynamic Scoring] Deep discussion pattern. Bonus: +10%`);
    }
  }

  return adjustedScore;
}

/**
 * レーベンシュタイン距離を計算（文字列の類似度を測定）
 * @param {string} str1 比較する文字列1
 * @param {string} str2 比較する文字列2
 * @returns {number} 編集距離
 */
function calculateLevenshteinDistance(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));

  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // 削除
        matrix[i][j - 1] + 1,      // 挿入
        matrix[i - 1][j - 1] + cost // 置換
      );
    }
  }

  return matrix[len1][len2];
}

/**
 * タイトルの類似度を計算（0-100のパーセンテージ）
 * @param {string} title1 タイトル1
 * @param {string} title2 タイトル2
 * @returns {number} 類似度（0-100）
 */
function calculateTitleSimilarity(title1, title2) {
  const maxLen = Math.max(title1.length, title2.length);
  if (maxLen === 0) return 100;

  const distance = calculateLevenshteinDistance(title1, title2);
  const similarity = ((maxLen - distance) / maxLen) * 100;
  return Math.round(similarity);
}

/**
 * 記事リストから類似記事を検出してグループ化
 * @param {Array} articles 記事の配列
 * @param {number} threshold 類似度の閾値（デフォルト70%）
 * @returns {Array} 重複を除いた記事配列と類似記事グループの情報
 */
function detectAndGroupSimilarArticles(articles, threshold = 70) {
  const groups = [];
  const processed = new Set();
  const result = [];

  for (let i = 0; i < articles.length; i++) {
    if (processed.has(i)) continue;

    const currentArticle = articles[i];
    const group = {
      representative: currentArticle,
      similar: []
    };

    for (let j = i + 1; j < articles.length; j++) {
      if (processed.has(j)) continue;

      const similarity = calculateTitleSimilarity(
        currentArticle.title,
        articles[j].title
      );

      if (similarity >= threshold) {
        group.similar.push({
          article: articles[j],
          similarity: similarity
        });
        processed.add(j);
        console.log(`[Duplicate Detection] 類似記事を検出 (${similarity}%): "${currentArticle.title.substring(0, 40)}..." vs "${articles[j].title.substring(0, 40)}..."`);
      }
    }

    groups.push(group);
    result.push(currentArticle);
    processed.add(i);
  }

  if (groups.some(g => g.similar.length > 0)) {
    console.log(`[Duplicate Detection] ${groups.filter(g => g.similar.length > 0).length}件の類似記事グループを検出しました。`);
  }

  return { deduplicated: result, groups: groups };
}

/**
 * Google Sheetsから過去7日間のニュースを取得
 * @returns {Promise<Array>} 過去7日間のニュース配列
 */
async function getRecentNewsFromSheet() {
  if (!GOOGLE_APPS_SCRIPT_URL) return [];

  try {
    console.log('[Context Analysis] Fetching recent news from sheet...');
    const response = await axios.post(GOOGLE_APPS_SCRIPT_URL, {
      type: 'getRecentNews',
      days: 7
    });

    if (!response.data || !Array.isArray(response.data)) {
      console.log('[Context Analysis] No recent news data available.');
      return [];
    }

    console.log(`[Context Analysis] Loaded ${response.data.length} news from the past 7 days.`);
    return response.data;

  } catch (error) {
    console.error('[Context Analysis] Failed to fetch recent news:', error.message);
    return [];
  }
}

/**
 * 過去のニュースからトレンドキーワードを抽出
 * @param {Array} recentNews 過去7日間のニュース
 * @returns {Object} トレンド分析結果
 */
function extractTrendKeywords(recentNews) {
  const keywordCounts = new Map();
  const categoryKeywords = [
    ...CORE_AGRI_KEYWORDS,
    ...TECH_INNOVATION_KEYWORDS,
    ...CONSUMER_EXPERIENCE_KEYWORDS,
    ...SOCIAL_SUSTAINABILITY_KEYWORDS,
    ...HUMAN_STORY_KEYWORDS,
    ...BUSINESS_POLICY_KEYWORDS
  ];

  // 各ニュースのタイトルからキーワードを抽出
  for (const news of recentNews) {
    const text = (news.title || '').toLowerCase();

    for (const keyword of categoryKeywords) {
      if (text.includes(keyword.toLowerCase())) {
        keywordCounts.set(keyword, (keywordCounts.get(keyword) || 0) + 1);
      }
    }
  }

  // カウントの多い順にソート
  const sortedKeywords = Array.from(keywordCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10); // 上位10個

  const trendingTopics = sortedKeywords
    .filter(([keyword, count]) => count >= 2)
    .map(([keyword, count]) => `「${keyword}」(${count}回)`);

  // トレンドの増減を分析
  const recentThreeDays = recentNews.filter(n => {
    const newsDate = new Date(n.newsDate || n.publishDate);
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    return newsDate >= threeDaysAgo;
  });

  const recentKeywords = new Set();
  for (const news of recentThreeDays) {
    const text = (news.title || '').toLowerCase();
    for (const keyword of categoryKeywords) {
      if (text.includes(keyword.toLowerCase())) {
        recentKeywords.add(keyword);
      }
    }
  }

  console.log(`[Context Analysis] Trending keywords: ${trendingTopics.join(', ')}`);

  return {
    topKeywords: sortedKeywords.slice(0, 5).map(([k, c]) => ({ keyword: k, count: c })),
    trendingSummary: trendingTopics.length > 0
      ? trendingTopics.slice(0, 5).join(', ')
      : 'トレンドキーワードなし',
    recentTopics: Array.from(recentKeywords).slice(0, 5)
  };
}

// ========================================
// 新刊紹介機能
// ========================================

/**
 * openBD APIから最近の新刊情報を取得
 * @returns {Promise<Array>} 新刊書籍のリスト
 */
async function fetchNewBooksFromOpenBD() {
  try {
    console.log('[New Book] openBD APIから新刊情報を取得中...');

    // openBD APIは特定のISBNでの検索が主なので、
    // ここでは主要な出版社の最近のISBNを推定する簡易的な方法を使用
    // より確実な方法として、楽天とGoogleのAPIを優先します

    // 今年と去年のISBN範囲を試す（日本の出版社コード）
    const currentYear = new Date().getFullYear();
    const books = [];

    // 複数の出版社コードと年を組み合わせて試す
    const publisherPrefixes = [
      '978-4-7981', // 技術評論社
      '978-4-8156', // SBクリエイティブ
      '978-4-295',  // インプレス
      '978-4-798'   // 翔泳社
    ];

    // 各出版社の最近のISBNをランダムにサンプリング
    const isbnSamples = [];
    for (const prefix of publisherPrefixes) {
      // 各出版社から10個程度のISBNをサンプリング
      for (let i = 0; i < 10; i++) {
        const randomSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        isbnSamples.push(`${prefix}-${randomSuffix}`);
      }
    }

    // サンプリングしたISBNで詳細を取得
    if (isbnSamples.length > 0) {
      try {
        const detailResponse = await axios.post('https://api.openbd.jp/v1/get',
          isbnSamples,
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000
          }
        );

        if (detailResponse.data && Array.isArray(detailResponse.data)) {
          const validBooks = detailResponse.data.filter(book => book !== null);
          books.push(...validBooks);
        }
      } catch (detailError) {
        console.log('[New Book] openBD API詳細取得エラー:', detailError.message);
      }
    }

    console.log(`[New Book] openBD APIから${books.length}件の書籍情報を取得しました`);
    return books;

  } catch (error) {
    console.error('[New Book] openBD API取得エラー:', error.message);
    return [];
  }
}

/**
 * 版元ドットコムAPIから新刊情報を取得（より新しい書籍を確実に取得）
 * @returns {Promise<Array>} 新刊書籍のリスト
 */
async function fetchNewBooksFromHanmoto() {
  try {
    console.log('[New Book] 版元ドットコムAPIから新刊情報を取得中...');

    const books = [];
    const today = new Date();

    // 今日から1ヶ月後までの発売予定を取得
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - 14); // 2週間前から
    const toDate = new Date(today);
    toDate.setDate(toDate.getDate() + 30); // 1ヶ月後まで

    const formatDate = (d) => {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    // 版元ドットコムの新刊情報APIを使用
    // ジャンル別に検索
    const genres = [
      { code: '007', name: 'コンピュータ・IT' },
      { code: '610', name: '農業' },
      { code: '335', name: '企業・経営' },
      { code: '336', name: '経営管理' }
    ];

    for (const genre of genres) {
      try {
        // openBD経由で版元ドットコムの新刊データを取得
        const response = await axios.get('https://api.openbd.jp/v1/coverage', {
          timeout: 10000
        });

        // カバレッジ情報から最近登録されたISBNを取得
        if (response.data && response.data.length > 0) {
          // 最新のISBNを抽出（APIの制限内で）
          const recentIsbns = response.data.slice(0, 100);

          // 詳細情報を取得
          const detailResponse = await axios.post('https://api.openbd.jp/v1/get',
            recentIsbns,
            {
              headers: { 'Content-Type': 'application/json' },
              timeout: 10000
            }
          );

          if (detailResponse.data && Array.isArray(detailResponse.data)) {
            const validBooks = detailResponse.data.filter(book => {
              if (!book || !book.summary) return false;

              // 発売日が2週間前〜1ヶ月後の書籍のみ
              const pubdate = book.summary.pubdate;
              if (!pubdate) return false;

              const dateStr = pubdate.replace(/-/g, '').replace(/\//g, '');
              if (dateStr.length < 8) return false;

              try {
                const year = parseInt(dateStr.substring(0, 4));
                const month = parseInt(dateStr.substring(4, 6)) - 1;
                const day = parseInt(dateStr.substring(6, 8));
                const bookDate = new Date(year, month, day);

                return bookDate >= fromDate && bookDate <= toDate;
              } catch {
                return false;
              }
            });

            books.push(...validBooks.map(book => ({
              ...book,
              source: 'hanmoto'
            })));
          }
        }
      } catch (genreError) {
        console.log(`[New Book] 版元ドットコムAPI (${genre.name}) エラー:`, genreError.message);
      }

      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // 重複除去
    const uniqueBooks = [];
    const seenIsbns = new Set();
    for (const book of books) {
      const isbn = book.summary?.isbn;
      if (isbn && !seenIsbns.has(isbn)) {
        seenIsbns.add(isbn);
        uniqueBooks.push(book);
      }
    }

    console.log(`[New Book] 版元ドットコムAPIから${uniqueBooks.length}件の新刊情報を取得しました`);
    return uniqueBooks;

  } catch (error) {
    console.error('[New Book] 版元ドットコムAPI取得エラー:', error.message);
    return [];
  }
}

/**
 * NDL Search API（国立国会図書館サーチ）から新刊情報を取得
 * @param {Array<string>} keywords 検索キーワード
 * @returns {Promise<Array>} 新刊書籍のリスト
 */
async function fetchNewBooksFromNDL(keywords = ['農業', 'テクノロジー', 'AI', 'DX']) {
  try {
    console.log('[New Book] NDL Search APIから新刊情報を取得中...');

    const allBooks = [];
    const today = new Date();
    const currentYear = today.getFullYear();

    for (const keyword of keywords) {
      try {
        // NDL Search APIでキーワード検索（OpenSearch形式を使用）
        const response = await axios.get('https://iss.ndl.go.jp/api/opensearch', {
          params: {
            title: keyword,
            from: `${currentYear - 1}`,
            cnt: 30,
            mediatype: 1  // 本のみ
          },
          timeout: 15000
        });

        if (response.data) {
          const xmlData = response.data;

          // OpenSearch形式のXMLパース
          const items = xmlData.match(/<item>([\s\S]*?)<\/item>/g) || [];
          console.log(`[New Book] NDL API (${keyword}): ${items.length}件のレコード`);

          for (const item of items) {
            try {
              // タイトル抽出
              const titleMatch = item.match(/<title>([^<]+)<\/title>/);
              const title = titleMatch ? titleMatch[1].trim() : '';

              // 著者抽出
              const authorMatch = item.match(/<author>([^<]+)<\/author>/);
              const author = authorMatch ? authorMatch[1].trim() : '';

              // 出版社抽出
              const publisherMatch = item.match(/<dc:publisher>([^<]+)<\/dc:publisher>/);
              const publisher = publisherMatch ? publisherMatch[1].trim() : '';

              // ISBN抽出（複数形式に対応）
              let isbn = '';
              const isbnMatch = item.match(/<dc:identifier[^>]*>(?:ISBN:)?(\d{10,13})<\/dc:identifier>/i);
              if (isbnMatch) {
                isbn = isbnMatch[1].replace(/-/g, '').trim();
              } else {
                // 別形式のISBN
                const isbn2Match = item.match(/ISBN[:\s]*(\d[\d-]{9,})/i);
                if (isbn2Match) {
                  isbn = isbn2Match[1].replace(/-/g, '').trim();
                }
              }

              // 発行日抽出
              const dateMatch = item.match(/<pubDate>([^<]+)<\/pubDate>/);
              let pubdate = '';
              if (dateMatch) {
                pubdate = dateMatch[1].replace(/[-\.\/]/g, '').trim();
              }

              if (title && isbn && isbn.length >= 10) {
                allBooks.push({
                  source: 'ndl',
                  summary: {
                    title: title,
                    author: author,
                    publisher: publisher,
                    isbn: isbn,
                    pubdate: pubdate,
                    cover: ''
                  },
                  onix: {
                    CollateralDetail: {
                      TextContent: []
                    }
                  }
                });
              }
            } catch (parseError) {
              // 個別レコードのパースエラーは無視
            }
          }
        }
      } catch (keywordError) {
        console.log(`[New Book] NDL API (${keyword}) エラー:`, keywordError.message);
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 重複除去
    const uniqueBooks = [];
    const seenIsbns = new Set();
    for (const book of allBooks) {
      const isbn = book.summary.isbn;
      if (isbn && !seenIsbns.has(isbn)) {
        seenIsbns.add(isbn);
        uniqueBooks.push(book);
      }
    }

    console.log(`[New Book] NDL APIから${uniqueBooks.length}件の書籍情報を取得しました`);
    return uniqueBooks;

  } catch (error) {
    console.error('[New Book] NDL API取得エラー:', error.message);
    return [];
  }
}

/**
 * 楽天Books APIから新刊情報を取得（レートリミット対策強化版）
 * @param {Array<string>} keywords 検索キーワード
 * @param {number} maxRetries リトライ回数
 * @returns {Promise<Array>} 新刊書籍のリスト
 */
async function fetchNewBooksFromRakutenEnhanced(keywords, maxRetries = 3) {
  if (!RAKUTEN_APP_ID) {
    console.log('[New Book] RAKUTEN_APP_IDが設定されていません。楽天Books APIをスキップします。');
    return [];
  }

  console.log('[New Book] 楽天Books API（強化版）から新刊情報を取得中...');

  const allBooks = [];
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  for (const keyword of keywords) {
    let retries = 0;
    let success = false;

    while (retries < maxRetries && !success) {
      try {
        // レートリミット対策：リクエスト前に待機（キーワードごとに増加）
        const baseDelay = 500 + (retries * 1000);
        await delay(baseDelay);

        const response = await axios.get('https://app.rakuten.co.jp/services/api/BooksBook/Search/20170404', {
          params: {
            applicationId: RAKUTEN_APP_ID,
            keyword: keyword,
            sort: '-releaseDate', // 発売日の新しい順
            hits: 30, // 各キーワードで30件取得
            outOfStockFlag: 0, // 在庫ありのみ
            booksGenreId: '001' // 書籍
          },
          timeout: 15000
        });

        if (response.data && response.data.Items && response.data.Items.length > 0) {
          const books = response.data.Items.map(item => {
            const book = item.Item;
            return {
              source: 'rakuten',
              summary: {
                title: book.title || '',
                author: book.author || '',
                publisher: book.publisherName || '',
                isbn: book.isbn || '',
                pubdate: book.salesDate ? book.salesDate.replace(/-/g, '').replace(/年|月/g, '').replace(/日.*$/, '').replace(/頃/, '') : '',
                cover: book.largeImageUrl || book.mediumImageUrl || book.smallImageUrl || ''
              },
              onix: {
                CollateralDetail: {
                  TextContent: book.itemCaption ? [{
                    TextType: '03',
                    Text: book.itemCaption
                  }] : []
                }
              },
              rakutenUrl: book.itemUrl || ''
            };
          });

          allBooks.push(...books);
          success = true;
          console.log(`[New Book] 楽天API (${keyword}): ${books.length}件取得`);
        } else {
          success = true; // 結果なしも成功扱い
        }
      } catch (error) {
        retries++;
        if (error.response && error.response.status === 429) {
          console.log(`[New Book] 楽天API (${keyword}) レートリミット。${retries}回目リトライ...`);
          await delay(2000 * retries); // 指数バックオフ
        } else {
          console.log(`[New Book] 楽天API (${keyword}) エラー: ${error.message}`);
          if (retries >= maxRetries) break;
        }
      }
    }
  }

  console.log(`[New Book] 楽天Books API（強化版）から${allBooks.length}件の書籍情報を取得しました`);
  return allBooks;
}

/**
 * 楽天Books APIから新刊情報を取得
 * @returns {Promise<Array>} 新刊書籍のリスト
 */
async function fetchNewBooksFromRakuten() {
  if (!RAKUTEN_APP_ID) {
    console.log('[New Book] RAKUTEN_APP_IDが設定されていません。楽天Books APIをスキップします。');
    return [];
  }

  try {
    console.log('[New Book] 楽天Books APIから新刊情報を取得中...');

    // 複数のキーワードで検索して結果を統合
    const keywords = ['農業', 'AI', 'DX', 'テクノロジー', 'ビジネス', 'Web3'];
    const allBooks = [];

    for (const keyword of keywords) {
      try {
        // 楽天Books書籍検索APIを使用
        const response = await axios.get('https://app.rakuten.co.jp/services/api/BooksBook/Search/20170404', {
          params: {
            applicationId: RAKUTEN_APP_ID,
            keyword: keyword,
            sort: '-releaseDate', // 発売日の新しい順
            hits: 20, // キーワードごとに20件
            outOfStockFlag: 0 // 在庫ありのみ
          },
          timeout: 10000
        });

        if (response.data && response.data.Items && response.data.Items.length > 0) {
          // 楽天のレスポンスを統一フォーマットに変換
          const books = response.data.Items.map(item => {
            const book = item.Item;
            return {
              source: 'rakuten',
              summary: {
                title: book.title || '',
                author: book.author || '',
                publisher: book.publisherName || '',
                isbn: book.isbn || '',
                pubdate: book.salesDate ? book.salesDate.replace(/-/g, '') : '',
                cover: book.largeImageUrl || book.mediumImageUrl || book.smallImageUrl || ''
              },
              onix: {
                CollateralDetail: {
                  TextContent: book.itemCaption ? [{
                    TextType: '03',
                    Text: book.itemCaption
                  }] : []
                }
              },
              rakutenUrl: book.itemUrl || ''
            };
          });

          allBooks.push(...books);
        }
      } catch (keywordError) {
        console.log(`[New Book] 楽天Books API (${keyword}) エラー:`, keywordError.message);
      }

      // レート制限を考慮して少し待つ
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`[New Book] 楽天Books APIから${allBooks.length}件の書籍情報を取得しました`);
    return allBooks;

  } catch (error) {
    console.error('[New Book] 楽天Books API取得エラー:', error.message);
    return [];
  }
}

/**
 * Google Books APIから新刊情報を取得
 * @returns {Promise<Array>} 新刊書籍のリスト
 */
async function fetchNewBooksFromGoogle() {
  try {
    console.log('[New Book] Google Books APIから新刊情報を取得中...');

    // 複数のキーワードで検索して結果を統合
    const keywords = ['農業', 'AI', 'DX', 'テクノロジー', 'ビジネス', 'スマート農業'];
    const allBooks = [];

    for (const keyword of keywords) {
      try {
        // Google Books APIで新しい書籍を検索
        const response = await axios.get('https://www.googleapis.com/books/v1/volumes', {
          params: {
            q: keyword,
            langRestrict: 'ja', // 日本語のみ
            orderBy: 'newest', // 新しい順
            maxResults: 10, // キーワードごとに10件
            printType: 'books' // 書籍のみ
          },
          timeout: 10000
        });

        if (response.data && response.data.items && response.data.items.length > 0) {
          // Googleのレスポンスを統一フォーマットに変換
          const books = response.data.items.map(item => {
            const volumeInfo = item.volumeInfo;
            const industryIdentifiers = volumeInfo.industryIdentifiers || [];
            const isbn13 = industryIdentifiers.find(id => id.type === 'ISBN_13')?.identifier || '';
            const isbn10 = industryIdentifiers.find(id => id.type === 'ISBN_10')?.identifier || '';

            return {
              source: 'google',
              summary: {
                title: volumeInfo.title || '',
                author: (volumeInfo.authors || []).join(', '),
                publisher: volumeInfo.publisher || '',
                isbn: isbn13 || isbn10,
                pubdate: volumeInfo.publishedDate ? volumeInfo.publishedDate.replace(/-/g, '') : '',
                cover: volumeInfo.imageLinks?.thumbnail || volumeInfo.imageLinks?.smallThumbnail || ''
              },
              onix: {
                CollateralDetail: {
                  TextContent: volumeInfo.description ? [{
                    TextType: '03',
                    Text: volumeInfo.description
                  }] : []
                }
              },
              googleUrl: volumeInfo.infoLink || ''
            };
          });

          allBooks.push(...books);
        }
      } catch (keywordError) {
        console.log(`[New Book] Google Books API (${keyword}) エラー:`, keywordError.message);
      }

      // レート制限を考慮して少し待つ
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`[New Book] Google Books APIから${allBooks.length}件の書籍情報を取得しました`);
    return allBooks;

  } catch (error) {
    console.error('[New Book] Google Books API取得エラー:', error.message);
    return [];
  }
}

/**
 * 複数ソースから取得した書籍を統合し、重複を除去
 * @param {Array} openBDBooks openBDから取得した書籍リスト
 * @param {Array} rakutenBooks 楽天から取得した書籍リスト
 * @param {Array} googleBooks Googleから取得した書籍リスト
 * @returns {Array} 統合された書籍リスト
 */
function mergeBooks(openBDBooks, rakutenBooks, googleBooks) {
  const bookMap = new Map(); // ISBN -> 書籍オブジェクト

  // すべての書籍を統合（ISBNをキーに重複を除去）
  const allBooks = [...openBDBooks, ...rakutenBooks, ...googleBooks];

  for (const book of allBooks) {
    const isbn = book.summary.isbn;
    if (!isbn) continue; // ISBNがない書籍はスキップ

    // すでに同じISBNの書籍がある場合は、より情報が豊富な方を保持
    if (!bookMap.has(isbn)) {
      bookMap.set(isbn, book);
    } else {
      const existing = bookMap.get(isbn);
      // より詳細な情報を持つ書籍を優先（例: カバー画像がある方）
      if (book.summary.cover && !existing.summary.cover) {
        bookMap.set(isbn, book);
      }
    }
  }

  const mergedBooks = Array.from(bookMap.values());
  console.log(`[New Book] ${allBooks.length}件から重複除去後: ${mergedBooks.length}件`);
  return mergedBooks;
}

/**
 * 書籍を発売日でフィルタリング
 * @param {Array} books 書籍リスト
 * @param {number} daysAgo 何日前から（負の値は未来日を含む）
 * @param {boolean} includeFuture 発売予定（未来日）を含めるか
 * @returns {Array} フィルタ済み書籍リスト
 */
function filterBooksByDate(books, daysAgo, includeFuture = false, maxFutureDays = 7) {
  const now = new Date();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysAgo);

  // 未来の最大日付（デフォルト7日後まで）
  const maxFutureDate = new Date();
  maxFutureDate.setDate(maxFutureDate.getDate() + maxFutureDays);

  const filtered = books.filter(book => {
    const pubdate = book.summary.pubdate;
    if (!pubdate) return false;

    // pubdate形式: YYYYMMDD or YYYY-MM-DD or YYYY or YYYYMM
    const dateStr = pubdate.replace(/-/g, '').replace(/\//g, '');
    if (dateStr.length < 4) return false; // 最低4桁（年）が必要

    try {
      let year, month, day;

      if (dateStr.length === 4) {
        // 年のみ（YYYY）→ その年の1月1日として扱う
        year = parseInt(dateStr);
        month = 0;
        day = 1;
      } else if (dateStr.length === 6) {
        // 年月のみ（YYYYMM）→ その月の1日として扱う
        year = parseInt(dateStr.substring(0, 4));
        month = parseInt(dateStr.substring(4, 6)) - 1;
        day = 1;
      } else if (dateStr.length >= 8) {
        // 完全な日付（YYYYMMDD）
        year = parseInt(dateStr.substring(0, 4));
        month = parseInt(dateStr.substring(4, 6)) - 1;
        day = parseInt(dateStr.substring(6, 8));
      } else {
        return false;
      }

      const bookDate = new Date(year, month, day);

      // 無効な日付チェック
      if (isNaN(bookDate.getTime())) return false;

      // 異常な未来日付を除外（1年以上先は除外）
      const oneYearFromNow = new Date();
      oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
      if (bookDate > oneYearFromNow) {
        return false; // 1年以上先の日付は除外
      }

      // 未来日を含める場合
      if (includeFuture) {
        return bookDate >= cutoffDate && bookDate <= maxFutureDate;
      }

      // 過去のみの場合
      return bookDate >= cutoffDate && bookDate <= now;
    } catch (e) {
      console.log(`[Date Filter] 日付解析エラー: ${pubdate}`);
      return false;
    }
  });

  console.log(`[Date Filter] ${books.length}件から${daysAgo}日前〜${includeFuture ? maxFutureDays + '日後' : '今日'}の書籍を${filtered.length}件抽出`);
  return filtered;
}

/**
 * 書籍を発売日でソート（新しい順）
 * @param {Array} books 書籍リスト
 * @returns {Array} ソート済み書籍リスト
 */
function sortBooksByDate(books) {
  return books.sort((a, b) => {
    const dateA = parsePubdate(a.summary?.pubdate);
    const dateB = parsePubdate(b.summary?.pubdate);

    // 日付がない場合は後ろに
    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;

    // 新しい順
    return dateB - dateA;
  });
}

/**
 * 発売日文字列をDateオブジェクトに変換
 * @param {string} pubdate 発売日文字列
 * @returns {Date|null}
 */
function parsePubdate(pubdate) {
  if (!pubdate) return null;

  const dateStr = pubdate.replace(/-/g, '').replace(/\//g, '').replace(/年|月|日/g, '');
  if (dateStr.length < 4) return null;

  try {
    let year, month, day;

    if (dateStr.length === 4) {
      year = parseInt(dateStr);
      month = 0;
      day = 1;
    } else if (dateStr.length === 6) {
      year = parseInt(dateStr.substring(0, 4));
      month = parseInt(dateStr.substring(4, 6)) - 1;
      day = 1;
    } else if (dateStr.length >= 8) {
      year = parseInt(dateStr.substring(0, 4));
      month = parseInt(dateStr.substring(4, 6)) - 1;
      day = parseInt(dateStr.substring(6, 8));
    } else {
      return null;
    }

    const date = new Date(year, month, day);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/**
 * 発売日の新しさに基づくボーナススコアを計算
 * @param {Object} book 書籍オブジェクト
 * @returns {number} ボーナススコア（0-10）
 */
function calculateFreshnessBonus(book) {
  const pubdate = parsePubdate(book.summary?.pubdate);
  if (!pubdate) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffDays = Math.floor((pubdate - today) / (1000 * 60 * 60 * 24));

  // 発売予定（未来日）は最高ボーナス
  if (diffDays > 0 && diffDays <= 30) {
    return 10; // 1ヶ月以内の発売予定
  } else if (diffDays > 30) {
    return 5; // 1ヶ月以上先の発売予定
  }

  // 発売済み（過去）
  const daysSinceRelease = Math.abs(diffDays);

  if (daysSinceRelease <= 7) {
    return 10; // 1週間以内
  } else if (daysSinceRelease <= 14) {
    return 8; // 2週間以内
  } else if (daysSinceRelease <= 30) {
    return 6; // 1ヶ月以内
  } else if (daysSinceRelease <= 60) {
    return 4; // 2ヶ月以内
  } else if (daysSinceRelease <= 90) {
    return 2; // 3ヶ月以内
  } else {
    return 0; // それ以前
  }
}

// 農業技術選定用の除外キーワード（農業に無関係な技術書を除外）
const AGRI_TECH_EXCLUSION_KEYWORDS = [
  'linux', 'リナックス', 'windows', 'java', 'python入門', 'ruby',
  'c++', 'c#', 'php', 'javascript入門', 'html', 'css',
  'ネットワークエンジニア', 'インフラエンジニア', 'webエンジニア',
  '異世界', 'ファンタジー', '小説', '漫画', 'コミック', 'ラノベ',
  '恋愛', 'ホラー', 'ミステリー', '推理', 'レシピ', '料理'
];

// 農業関連の必須キーワード（これらがないと農業技術書籍としてスコアが低くなる）
const AGRI_REQUIRED_KEYWORDS = [
  '農業', '農家', '農産物', '畜産', '酪農', '栽培', '圃場', '収穫',
  '食料', '食糧', 'フード', 'アグリ', '農林', '漁業', '林業',
  'ja', '農協', '農学', '品種', '作物', '肥料', '農薬', '灌漑',
  'スマート農業', 'アグリテック', 'agritech', 'farmtech'
];

/**
 * 書籍をキーワードでスコアリング（農業技術書籍用）
 * @param {Object} book openBDから取得した書籍オブジェクト
 * @returns {Object} スコアとマッチしたカテゴリを含むオブジェクト
 */
function scoreBook(book) {
  if (!book || !book.summary) return { score: 0, categories: [] };

  const title = (book.summary.title || '').toLowerCase();
  const author = (book.summary.author || '').toLowerCase();
  const publisher = (book.summary.publisher || '').toLowerCase();
  const series = (book.summary.series || '').toLowerCase();

  // 全テキストを結合
  const fullText = `${title} ${author} ${publisher} ${series}`;

  let score = 0;
  const matchedCategories = new Set();

  // 除外キーワードチェック（基本）
  for (const keyword of EXCLUSION_KEYWORDS) {
    if (fullText.includes(keyword.toLowerCase())) {
      return { score: -1, categories: ['除外'] };
    }
  }

  // 農業技術用除外キーワードチェック（農業に無関係な技術書）
  for (const keyword of AGRI_TECH_EXCLUSION_KEYWORDS) {
    if (fullText.includes(keyword.toLowerCase())) {
      return { score: -1, categories: ['農業外技術'] };
    }
  }

  // 農業関連キーワードのチェック（必須条件）
  let hasAgriKeyword = false;
  for (const keyword of AGRI_REQUIRED_KEYWORDS) {
    if (fullText.includes(keyword.toLowerCase())) {
      hasAgriKeyword = true;
      break;
    }
  }

  // 農業関連キーワードがない場合はスコアを大幅に下げる
  if (!hasAgriKeyword) {
    score -= 5; // ペナルティ
    matchedCategories.add('農業関連キーワードなし');
  }

  // カテゴリ別スコアリング
  const checkKeywords = (keywords, categoryName, points) => {
    for (const keyword of keywords) {
      if (fullText.includes(keyword.toLowerCase())) {
        score += points;
        matchedCategories.add(categoryName);
        break;
      }
    }
  };

  checkKeywords(CORE_AGRI_KEYWORDS, 'コア農業', 3);
  checkKeywords(TECH_INNOVATION_KEYWORDS, '技術革新', 5);
  checkKeywords(CONSUMER_EXPERIENCE_KEYWORDS, '消費者体験', 5);
  checkKeywords(SOCIAL_SUSTAINABILITY_KEYWORDS, '社会課題', 4);
  checkKeywords(HUMAN_STORY_KEYWORDS, 'ヒト・ストーリー', 4);
  checkKeywords(BUSINESS_POLICY_KEYWORDS, 'ビジネス・政策', 3);
  checkKeywords(BUZZ_KEYWORDS, 'バズワード', 2);

  return {
    score,
    categories: Array.from(matchedCategories)
  };
}

/**
 * 一般新刊（小説・ビジネス書・話題の本）をスコアリング
 * @param {Object} book 書籍オブジェクト
 * @returns {Object} スコアとマッチしたカテゴリを含むオブジェクト
 */
function scorePopularBook(book) {
  if (!book || !book.summary) return { score: -1, categories: ['無効'] };

  const title = (book.summary.title || '').toLowerCase();
  const author = (book.summary.author || '').toLowerCase();
  const publisher = (book.summary.publisher || '').toLowerCase();

  // 全テキストを結合
  const fullText = `${title} ${author} ${publisher}`;

  let score = 0;
  const matchedCategories = new Set();

  // 除外キーワードチェック
  for (const keyword of EXCLUSION_KEYWORDS) {
    if (fullText.includes(keyword.toLowerCase())) {
      return { score: -1, categories: ['除外'] }; // 除外対象
    }
  }

  // ★★★ ライトノベル・Web小説・異世界もの除外キーワード ★★★
  const lightNovelExclusionKeywords = [
    // タイトルパターン
    '異世界', '転生', '追放', '無双', 'チート', '最強', '俺tueee',
    '悪役令嬢', '婚約破棄', '聖女', '魔王', '勇者', '冒険者', 'ギルド',
    'スキル', 'レベル', 'ステータス', '召喚', 'ダンジョン', 'モンスター',
    '成り上がり', 'ハーレム', '奴隷', '従魔', '使い魔', 'テイマー',
    '盗賊', '怪盗', '暗殺者', 'アサシン', 'スローライフ',
    // 出版社（ライトノベル専門）
    '一迅社', '一二三書房', 'オーバーラップ', 'mfブックス', 'カドカワbooks',
    'ファミ通文庫', '電撃文庫', 'ga文庫', 'mf文庫', 'スニーカー文庫',
    'ヒーロー文庫', 'hj文庫', 'ガガガ文庫', 'ダッシュエックス文庫',
    'アルファポリス', 'カクヨム', 'なろう系', 'web小説',
    // その他
    'コミカライズ', '漫画版', 'コミック版'
  ];

  for (const keyword of lightNovelExclusionKeywords) {
    if (fullText.includes(keyword.toLowerCase())) {
      return { score: -1, categories: ['ラノベ除外'] };
    }
  }

  // 一般新刊用のカテゴリ別スコアリング
  const checkKeywords = (keywords, categoryName, points) => {
    for (const keyword of keywords) {
      if (fullText.includes(keyword.toLowerCase())) {
        score += points;
        matchedCategories.add(categoryName);
        break;
      }
    }
  };

  // ビジネス・自己啓発（高スコア）
  const businessKeywords = ['ビジネス', '経営', 'マネジメント', 'リーダーシップ', '起業',
    '自己啓発', '成功', '仕事術', 'キャリア', '働き方', '投資', '資産', '経済学',
    'マーケティング', '戦略', 'イノベーション', 'スタートアップ'];
  checkKeywords(businessKeywords, 'ビジネス', 8);

  // 文芸・純文学（高スコア）
  const literaryKeywords = ['直木賞', '芥川賞', '本屋大賞', '文学賞', '受賞作',
    '純文学', '文藝', '新潮', '文春', '講談社文庫', '角川文庫'];
  checkKeywords(literaryKeywords, '文芸', 10);

  // 話題性・ベストセラー関連（最高スコア）
  const trendingKeywords = ['ベストセラー', '大賞', '受賞', '映画化',
    'ドラマ化', '累計', '万部', '注目', 'テレビ', 'メディア'];
  checkKeywords(trendingKeywords, '話題の本', 12);

  // 実用書・専門書
  const practicalKeywords = ['入門', '図解', '完全ガイド', '教科書',
    '実践', 'ノウハウ', '解説', '専門', '技術', '科学'];
  checkKeywords(practicalKeywords, '実用書', 6);

  // エッセイ・ノンフィクション
  const essayKeywords = ['エッセイ', 'ノンフィクション', '伝記', '回顧録',
    '体験記', 'ルポ', 'ドキュメント', '自伝'];
  checkKeywords(essayKeywords, 'エッセイ', 5);

  // 新書（信頼性の高いジャンル）
  const shinshoKeywords = ['新書', '岩波', '中公', 'ちくま', '講談社現代'];
  checkKeywords(shinshoKeywords, '新書', 7);

  // スコアが0の場合は除外（カテゴリにマッチしない本は推薦しない）
  if (score === 0) {
    return { score: -1, categories: ['カテゴリ外'] };
  }

  return {
    score,
    categories: Array.from(matchedCategories)
  };
}

/**
 * 毎日の新刊投稿処理（農業・Web3・先端技術関連）
 */
async function postDailyNewBook() {
  console.log('[New Book] 農業技術関連新刊紹介タスクを開始します...');

  try {
    // チャンネル取得
    if (!NEW_BOOK_CHANNEL_ID) {
      console.error('[New Book] NEW_BOOK_CHANNEL_IDが設定されていません');
      return;
    }

    const channel = await client.channels.fetch(NEW_BOOK_CHANNEL_ID);
    if (!channel || channel.type !== ChannelType.GuildText) {
      console.error('[New Book] チャンネルが見つからないか、テキストチャンネルではありません');
      return;
    }

    // 農業技術関連書籍を取得（1ヶ月以内）
    const books = await fetchAgriTechBooks();

    if (books.length === 0) {
      console.log('[New Book] すべてのAPIから書籍を取得できませんでした');
      return;
    }

    // 投稿可能な書籍をフィルタ（発売日の新しさも考慮）
    const availableBooks = [];
    for (const book of books) {
      const isbn = book.summary.isbn;
      // ISBNがあり、投稿済みでない書籍
      if (isbn && !postedBookIsbns.has(isbn)) {
        const { score: keywordScore, categories } = scoreBook(book);

        // 除外対象（score = -1）の書籍はスキップ
        if (keywordScore < 0) {
          console.log(`[New Book] 除外: ${book.summary.title} (${categories.join(', ')})`);
          continue;
        }

        const freshnessBonus = calculateFreshnessBonus(book);
        // 最終スコア = キーワードスコア + 発売日ボーナス
        const totalScore = keywordScore + freshnessBonus;
        availableBooks.push({
          book,
          score: totalScore,
          keywordScore,
          freshnessBonus,
          categories
        });
      }
    }

    if (availableBooks.length === 0) {
      console.log('[New Book] 投稿可能な未投稿の書籍がありませんでした');
      // 投稿済みでも最新の書籍を1つ投稿（確実に1日1冊投稿するため）
      if (books.length > 0) {
        console.log('[New Book] 投稿済み書籍から最新の1冊を再投稿します');
        const { score: keywordScore, categories } = scoreBook(books[0]);
        const freshnessBonus = calculateFreshnessBonus(books[0]);
        availableBooks.push({
          book: books[0],
          score: keywordScore + freshnessBonus,
          keywordScore,
          freshnessBonus,
          categories
        });
      } else {
        return;
      }
    }

    // スコアでソート（高い順）- 発売日ボーナスを含む
    availableBooks.sort((a, b) => b.score - a.score);
    console.log(`[New Book] 候補書籍: ${availableBooks.length}件（上位3件: ${availableBooks.slice(0, 3).map(b => `${b.book.summary.title}(${b.score}点)`).join(', ')}）`);

    // 最高スコアの書籍を選択
    const selected = availableBooks[0];
    const bookData = selected.book.summary;
    const onix = selected.book.onix || {};

    // Embed作成
    const embed = new EmbedBuilder()
      .setColor(0xFF6B6B)
      .setTitle(`📚 今日の一冊`)
      .setDescription(`**${bookData.title}**`)
      .setTimestamp();

    // 著者
    if (bookData.author) {
      embed.addFields({ name: '✍️ 著者', value: bookData.author, inline: true });
    }

    // 出版社
    if (bookData.publisher) {
      embed.addFields({ name: '🏢 出版社', value: bookData.publisher, inline: true });
    }

    // 発売日
    if (bookData.pubdate) {
      const pubDate = bookData.pubdate.replace(/(\d{4})(\d{2})(\d{2})/, '$1年$2月$3日');
      embed.addFields({ name: '📅 発売日', value: pubDate, inline: true });
    }

    // マッチカテゴリ
    if (selected.categories.length > 0) {
      embed.addFields({
        name: '🏷️ カテゴリ',
        value: selected.categories.join(' + '),
        inline: false
      });
    }

    // スコア
    embed.addFields({ name: '⭐ スコア', value: `${selected.score}点`, inline: true });

    // ISBN
    if (bookData.isbn) {
      embed.addFields({ name: '📖 ISBN', value: bookData.isbn, inline: true });
    }

    // 書籍の説明（あれば）
    if (onix.CollateralDetail && onix.CollateralDetail.TextContent) {
      const textContent = onix.CollateralDetail.TextContent.find(
        tc => tc.TextType === '03' || tc.TextType === '02'
      );
      if (textContent && textContent.Text) {
        const description = textContent.Text.substring(0, 300);
        embed.addFields({ name: '📝 概要', value: description, inline: false });
      }
    }

    // サムネイル画像（openBDのカバー画像）
    if (bookData.cover) {
      embed.setThumbnail(bookData.cover);
    }

    // 購入リンク
    const purchaseLinks = [];

    // 楽天の直接リンク（楽天Books APIから取得した場合）
    if (selected.book.rakutenUrl) {
      purchaseLinks.push(`[楽天ブックス](${selected.book.rakutenUrl})`);
    } else if (bookData.isbn) {
      // ISBNから楽天の検索リンクを生成
      const isbn = bookData.isbn.replace(/-/g, '');
      purchaseLinks.push(`[楽天ブックス](https://books.rakuten.co.jp/search?sitem=${isbn})`);
    }

    // Amazonリンク
    if (bookData.isbn) {
      const isbn = bookData.isbn.replace(/-/g, '');
      purchaseLinks.push(`[Amazon](https://www.amazon.co.jp/dp/${isbn})`);
    }

    // Google Booksのリンク（Google Books APIから取得した場合）
    if (selected.book.googleUrl) {
      purchaseLinks.push(`[Google Books](${selected.book.googleUrl})`);
    }

    if (purchaseLinks.length > 0) {
      embed.addFields({
        name: '🔗 購入リンク',
        value: purchaseLinks.join(' | '),
        inline: false
      });
    }

    // Discord投稿
    await channel.send({ embeds: [embed] });
    console.log(`[New Book] 新刊を投稿しました: ${bookData.title}`);

    // 投稿済みISBNをキャッシュに追加
    if (bookData.isbn) {
      postedBookIsbns.add(bookData.isbn);
    }

    // Google Sheetsに記録
    await logToSpreadsheet('newBook', {
      title: bookData.title,
      author: bookData.author || '',
      publisher: bookData.publisher || '',
      isbn: bookData.isbn || '',
      pubdate: bookData.pubdate || '',
      score: selected.score,
      categories: selected.categories.join(', '),
      bookType: 'agritech', // 農業・Web3・先端技術関連
      postedDate: new Date().toISOString()
    });

  } catch (error) {
    console.error('[New Book] タスク実行中にエラーが発生しました:', error);
  }
}

/**
 * 毎日の一般新刊投稿処理（小説・ビジネス書・話題の本）
 */
async function postDailyPopularBook() {
  console.log('[Popular Book] 一般新刊紹介タスクを開始します...');

  try {
    // チャンネル取得
    if (!POPULAR_BOOK_CHANNEL_ID) {
      console.error('[Popular Book] POPULAR_BOOK_CHANNEL_IDが設定されていません');
      return;
    }

    const channel = await client.channels.fetch(POPULAR_BOOK_CHANNEL_ID);
    if (!channel || channel.type !== ChannelType.GuildText) {
      console.error('[Popular Book] チャンネルが見つからないか、テキストチャンネルではありません');
      return;
    }

    // 一般新刊書籍を取得（1週間以内、発売予定含む）
    const books = await fetchPopularBooks();

    if (books.length === 0) {
      console.log('[Popular Book] すべてのAPIから書籍を取得できませんでした');
      return;
    }

    // 投稿可能な書籍をフィルタ（発売日の新しさも考慮）
    const availableBooks = [];
    for (const book of books) {
      const isbn = book.summary.isbn;
      // ISBNがあり、投稿済みでない書籍はすべて許容
      if (isbn && !postedBookIsbns.has(isbn)) {
        const { score: keywordScore, categories } = scorePopularBook(book);
        const freshnessBonus = calculateFreshnessBonus(book);
        // 最終スコア = キーワードスコア + 発売日ボーナス
        const totalScore = keywordScore + freshnessBonus;
        availableBooks.push({
          book,
          score: totalScore,
          keywordScore,
          freshnessBonus,
          categories
        });
      }
    }

    if (availableBooks.length === 0) {
      console.log('[Popular Book] 投稿可能な未投稿の書籍がありませんでした');
      // 投稿済みでも最新の書籍を1つ投稿（確実に1日1冊投稿するため）
      if (books.length > 0) {
        console.log('[Popular Book] 投稿済み書籍から最新の1冊を再投稿します');
        const { score: keywordScore, categories } = scorePopularBook(books[0]);
        const freshnessBonus = calculateFreshnessBonus(books[0]);
        availableBooks.push({
          book: books[0],
          score: keywordScore + freshnessBonus,
          keywordScore,
          freshnessBonus,
          categories
        });
      } else {
        return;
      }
    }

    // スコアでソート（高い順）- 発売日ボーナスを含む
    availableBooks.sort((a, b) => b.score - a.score);
    console.log(`[Popular Book] 候補書籍: ${availableBooks.length}件（上位3件: ${availableBooks.slice(0, 3).map(b => `${b.book.summary.title}(${b.score}点)`).join(', ')}）`);

    // 最高スコアの書籍を選択
    const selected = availableBooks[0];
    const bookData = selected.book.summary;
    const onix = selected.book.onix || {};

    // Embed作成
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)  // Discord Blurple
      .setTitle(`📖 今日のおすすめ新刊`)
      .setDescription(`**${bookData.title}**`)
      .setTimestamp();

    // 著者
    if (bookData.author) {
      embed.addFields({ name: '✍️ 著者', value: bookData.author, inline: true });
    }

    // 出版社
    if (bookData.publisher) {
      embed.addFields({ name: '🏢 出版社', value: bookData.publisher, inline: true });
    }

    // 発売日
    if (bookData.pubdate) {
      const pubDate = bookData.pubdate.replace(/(\d{4})(\d{2})(\d{2})/, '$1年$2月$3日');
      embed.addFields({ name: '📅 発売日', value: pubDate, inline: true });
    }

    // マッチカテゴリ
    if (selected.categories.length > 0) {
      embed.addFields({
        name: '🏷️ カテゴリ',
        value: selected.categories.join(' + '),
        inline: false
      });
    }

    // スコア
    embed.addFields({ name: '⭐ スコア', value: `${selected.score}点`, inline: true });

    // ISBN
    if (bookData.isbn) {
      embed.addFields({ name: '📖 ISBN', value: bookData.isbn, inline: true });
    }

    // 書籍の説明（あれば）
    if (onix.CollateralDetail && onix.CollateralDetail.TextContent) {
      const textContent = onix.CollateralDetail.TextContent.find(
        tc => tc.TextType === '03' || tc.TextType === '02'
      );
      if (textContent && textContent.Text) {
        const description = textContent.Text.substring(0, 300);
        embed.addFields({ name: '📝 概要', value: description, inline: false });
      }
    }

    // サムネイル画像
    if (bookData.cover) {
      embed.setThumbnail(bookData.cover);
    }

    // 購入リンク
    const purchaseLinks = [];

    // 楽天の直接リンク
    if (selected.book.rakutenUrl) {
      purchaseLinks.push(`[楽天ブックス](${selected.book.rakutenUrl})`);
    } else if (bookData.isbn) {
      const isbn = bookData.isbn.replace(/-/g, '');
      purchaseLinks.push(`[楽天ブックス](https://books.rakuten.co.jp/search?sitem=${isbn})`);
    }

    // Amazonリンク
    if (bookData.isbn) {
      const isbn = bookData.isbn.replace(/-/g, '');
      purchaseLinks.push(`[Amazon](https://www.amazon.co.jp/dp/${isbn})`);
    }

    // Google Booksのリンク
    if (selected.book.googleUrl) {
      purchaseLinks.push(`[Google Books](${selected.book.googleUrl})`);
    }

    if (purchaseLinks.length > 0) {
      embed.addFields({
        name: '🔗 購入リンク',
        value: purchaseLinks.join(' | '),
        inline: false
      });
    }

    // Discord投稿
    await channel.send({ embeds: [embed] });
    console.log(`[Popular Book] 一般新刊を投稿しました: ${bookData.title}`);

    // 投稿済みISBNをキャッシュに追加
    if (bookData.isbn) {
      postedBookIsbns.add(bookData.isbn);
    }

    // Google Sheetsに記録
    await logToSpreadsheet('newBook', {
      title: bookData.title,
      author: bookData.author || '',
      publisher: bookData.publisher || '',
      isbn: bookData.isbn || '',
      pubdate: bookData.pubdate || '',
      score: selected.score,
      categories: selected.categories.join(', '),
      bookType: 'popular', // 一般新刊
      postedDate: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Popular Book] タスク実行中にエラーが発生しました:', error);
  }
}

// グローバル変数として議論メトリクスをキャッシュ
let cachedDiscussionMetrics = new Map();
let cachedRecentNews = [];
let cachedTrendAnalysis = null;

// 投稿済み書籍のISBNをキャッシュ（重複防止用）
const postedBookIsbns = new Set();

// 書籍データのキャッシュ（API呼び出し削減用）
let cachedBooks = [];
let cachedBooksTimestamp = null;
const BOOK_CACHE_DURATION = 60 * 60 * 1000; // 1時間有効

/**
 * 書籍データを取得（キャッシュ使用）
 * @returns {Promise<Array>} 書籍リスト
 */
async function fetchBooksWithCache() {
  const now = Date.now();

  // キャッシュが有効な場合はキャッシュを返す
  if (cachedBooks.length > 0 && cachedBooksTimestamp && (now - cachedBooksTimestamp < BOOK_CACHE_DURATION)) {
    console.log(`[Book Cache] キャッシュから${cachedBooks.length}件の書籍を返却`);
    return cachedBooks;
  }

  console.log('[Book Cache] 新しい書籍データを取得中...');

  // 複数のソースから新刊情報を並行取得
  const [openBDBooks, rakutenBooks, googleBooks] = await Promise.all([
    fetchNewBooksFromOpenBD(),
    fetchNewBooksFromRakuten(),
    fetchNewBooksFromGoogle()
  ]);

  // 書籍を統合（重複除去）
  const books = mergeBooks(openBDBooks, rakutenBooks, googleBooks);

  // キャッシュを更新
  cachedBooks = books;
  cachedBooksTimestamp = now;

  console.log(`[Book Cache] ${books.length}件の書籍をキャッシュに保存`);
  return books;
}

/**
 * 農業技術関連書籍を取得（複数APIソース＋発売日優先）
 * @returns {Promise<Array>} 農業技術書籍リスト
 */
async function fetchAgriTechBooks() {
  console.log('[AgriTech Books] 農業技術関連書籍を取得中...');

  // 農業×テクノロジーに特化したキーワード
  const agriTechKeywords = [
    'スマート農業',
    'アグリテック',
    '農業 DX',
    '農業 AI',
    '精密農業',
    '農業 IoT',
    '農業技術'
  ];

  const allBooks = [];

  // === 1. 楽天Books API（レートリミット対策版）から取得 ===
  console.log('[AgriTech Books] 楽天Books APIから取得中...');
  const rakutenBooks = await fetchNewBooksFromRakutenEnhanced(agriTechKeywords);
  allBooks.push(...rakutenBooks);
  console.log(`[AgriTech Books] 楽天から${rakutenBooks.length}件取得`);

  // === 2. Google Books APIから取得 ===
  console.log('[AgriTech Books] Google Books APIから取得中...');
  for (const keyword of agriTechKeywords) {
    try {
      const response = await axios.get('https://www.googleapis.com/books/v1/volumes', {
        params: {
          q: keyword,
          langRestrict: 'ja',
          orderBy: 'newest',
          maxResults: 20,
          printType: 'books'
        },
        timeout: 10000
      });

      if (response.data && response.data.items && response.data.items.length > 0) {
        const books = response.data.items.map(item => {
          const volumeInfo = item.volumeInfo;
          const industryIdentifiers = volumeInfo.industryIdentifiers || [];
          const isbn13 = industryIdentifiers.find(id => id.type === 'ISBN_13')?.identifier || '';
          const isbn10 = industryIdentifiers.find(id => id.type === 'ISBN_10')?.identifier || '';

          return {
            source: 'google',
            summary: {
              title: volumeInfo.title || '',
              author: (volumeInfo.authors || []).join(', '),
              publisher: volumeInfo.publisher || '',
              isbn: isbn13 || isbn10,
              pubdate: volumeInfo.publishedDate ? volumeInfo.publishedDate.replace(/-/g, '') : '',
              cover: volumeInfo.imageLinks?.thumbnail || volumeInfo.imageLinks?.smallThumbnail || ''
            },
            onix: {
              CollateralDetail: {
                TextContent: volumeInfo.description ? [{
                  TextType: '03',
                  Text: volumeInfo.description
                }] : []
              }
            },
            googleUrl: volumeInfo.infoLink || ''
          };
        });
        allBooks.push(...books);
      }
    } catch (error) {
      console.log(`[AgriTech Books] Google API (${keyword}) エラー:`, error.message);
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // === 3. NDL Search API（国立国会図書館）から取得 ===
  // 注: NDL APIはXMLパースの問題があるため一時的に無効化
  // console.log('[AgriTech Books] NDL Search APIから取得中...');
  // const ndlKeywords = ['農業', 'スマート農業', 'アグリテック', 'DX'];
  // const ndlBooks = await fetchNewBooksFromNDL(ndlKeywords);
  // allBooks.push(...ndlBooks);
  // console.log(`[AgriTech Books] NDLから${ndlBooks.length}件取得`);

  // === 4. 版元ドットコム（openBD経由）から取得 ===
  console.log('[AgriTech Books] 版元ドットコムAPIから取得中...');
  const hanmotoBooks = await fetchNewBooksFromHanmoto();
  allBooks.push(...hanmotoBooks);
  console.log(`[AgriTech Books] 版元ドットコムから${hanmotoBooks.length}件取得`);

  // === 5. openBDからも取得 ===
  const openBDBooks = await fetchNewBooksFromOpenBD();
  allBooks.push(...openBDBooks);

  console.log(`[AgriTech Books] 全API合計: ${allBooks.length}件`);

  // 重複除去
  const merged = mergeBooks([], allBooks, []);

  // 新刊フィルタ：過去2週間〜未来1ヶ月を優先（より厳しく）
  let filtered = filterBooksByDate(merged, 14, true); // 過去14日〜未来含む

  if (filtered.length < 3) {
    console.log(`[AgriTech Books] 2週間以内の書籍が${filtered.length}件のため、範囲を1ヶ月に拡大します`);
    filtered = filterBooksByDate(merged, 30, true);
  }

  if (filtered.length < 3) {
    console.log(`[AgriTech Books] 1ヶ月以内の書籍が${filtered.length}件のため、範囲を3ヶ月に拡大します`);
    filtered = filterBooksByDate(merged, 90, true);
  }

  if (filtered.length < 3) {
    console.log(`[AgriTech Books] 3ヶ月以内の書籍が${filtered.length}件のため、日付フィルタを無効化します`);
    filtered = merged;
  }

  // 発売日でソート（新しい順）
  const sorted = sortBooksByDate(filtered);

  console.log(`[AgriTech Books] ${sorted.length}件の農業技術関連書籍を取得しました（発売日ソート済み）`);
  return sorted;
}

/**
 * 一般新刊書籍を取得（複数APIソース＋発売日優先）
 * @returns {Promise<Array>} 一般新刊書籍リスト
 */
async function fetchPopularBooks() {
  console.log('[Popular Books] 一般新刊書籍を取得中...');

  // 一般新刊向けキーワード
  const popularKeywords = [
    'ベストセラー',
    '話題の本',
    'ビジネス書',
    '小説',
    '自己啓発',
    '経済'
  ];

  const allBooks = [];

  // === 1. 楽天Books API（レートリミット対策版）から取得 ===
  console.log('[Popular Books] 楽天Books APIから取得中...');
  const rakutenBooks = await fetchNewBooksFromRakutenEnhanced(popularKeywords);
  allBooks.push(...rakutenBooks);
  console.log(`[Popular Books] 楽天から${rakutenBooks.length}件取得`);

  // === 2. Google Books APIから取得 ===
  console.log('[Popular Books] Google Books APIから取得中...');
  for (const keyword of popularKeywords) {
    try {
      const response = await axios.get('https://www.googleapis.com/books/v1/volumes', {
        params: {
          q: keyword,
          langRestrict: 'ja',
          orderBy: 'newest',
          maxResults: 20,
          printType: 'books'
        },
        timeout: 10000
      });

      if (response.data && response.data.items && response.data.items.length > 0) {
        const books = response.data.items.map(item => {
          const volumeInfo = item.volumeInfo;
          const industryIdentifiers = volumeInfo.industryIdentifiers || [];
          const isbn13 = industryIdentifiers.find(id => id.type === 'ISBN_13')?.identifier || '';
          const isbn10 = industryIdentifiers.find(id => id.type === 'ISBN_10')?.identifier || '';

          return {
            source: 'google',
            summary: {
              title: volumeInfo.title || '',
              author: (volumeInfo.authors || []).join(', '),
              publisher: volumeInfo.publisher || '',
              isbn: isbn13 || isbn10,
              pubdate: volumeInfo.publishedDate ? volumeInfo.publishedDate.replace(/-/g, '') : '',
              cover: volumeInfo.imageLinks?.thumbnail || volumeInfo.imageLinks?.smallThumbnail || ''
            },
            onix: {
              CollateralDetail: {
                TextContent: volumeInfo.description ? [{
                  TextType: '03',
                  Text: volumeInfo.description
                }] : []
              }
            },
            googleUrl: volumeInfo.infoLink || ''
          };
        });
        allBooks.push(...books);
      }
    } catch (error) {
      console.log(`[Popular Books] Google API (${keyword}) エラー:`, error.message);
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // === 3. NDL Search API（国立国会図書館）から取得 ===
  // 注: NDL APIはXMLパースの問題があるため一時的に無効化
  // console.log('[Popular Books] NDL Search APIから取得中...');
  // const ndlKeywords = ['小説', 'ビジネス', '経済', '新書'];
  // const ndlBooks = await fetchNewBooksFromNDL(ndlKeywords);
  // allBooks.push(...ndlBooks);
  // console.log(`[Popular Books] NDLから${ndlBooks.length}件取得`);

  // === 4. 版元ドットコム（openBD経由）から取得 ===
  console.log('[Popular Books] 版元ドットコムAPIから取得中...');
  const hanmotoBooks = await fetchNewBooksFromHanmoto();
  allBooks.push(...hanmotoBooks);
  console.log(`[Popular Books] 版元ドットコムから${hanmotoBooks.length}件取得`);

  console.log(`[Popular Books] 全API合計: ${allBooks.length}件`);

  // 重複除去
  const merged = mergeBooks([], allBooks, []);

  // ★★★ 新刊フィルタ：過去7日〜未来7日以内（1週間以内に発売）★★★
  let filtered = filterBooksByDate(merged, 7, true, 7); // 過去7日〜未来7日

  if (filtered.length < 3) {
    console.log(`[Popular Books] 1週間以内の書籍が${filtered.length}件のため、範囲を2週間に拡大します`);
    filtered = filterBooksByDate(merged, 14, true, 14);
  }

  if (filtered.length < 3) {
    console.log(`[Popular Books] 2週間以内の書籍が${filtered.length}件のため、範囲を1ヶ月に拡大します`);
    filtered = filterBooksByDate(merged, 30, true, 30);
  }

  if (filtered.length < 3) {
    console.log(`[Popular Books] 1ヶ月以内の書籍が${filtered.length}件のため、日付フィルタを無効化します`);
    filtered = merged;
  }

  // 発売日でソート（新しい順）
  const sorted = sortBooksByDate(filtered);

  console.log(`[Popular Books] ${sorted.length}件の一般新刊書籍を取得しました（発売日ソート済み）`);
  return sorted;
}

/**
 * GASから投稿済み書籍のISBNリストを取得
 * @returns {Promise<Set>} 投稿済みISBNのSet
 */
async function syncPostedBooksFromSheet() {
  if (!GOOGLE_APPS_SCRIPT_URL) {
    console.log('[Book Sync] GOOGLE_APPS_SCRIPT_URLが設定されていません');
    return;
  }

  try {
    console.log('[Book Sync] GASから投稿済み書籍リストを取得中...');
    // GETリクエストでISBNリストを取得
    const response = await axios.get(GOOGLE_APPS_SCRIPT_URL, {
      params: {
        type: 'getPostedBooks'
      },
      timeout: 10000
    });

    if (response.data && Array.isArray(response.data)) {
      postedBookIsbns.clear();
      response.data.forEach(isbn => {
        if (isbn && isbn.toString().trim() !== '') {
          postedBookIsbns.add(isbn.toString());
        }
      });
      console.log(`[Book Sync] ${postedBookIsbns.size}件の投稿済み書籍を読み込みました`);
    } else {
      console.log('[Book Sync] レスポンスが配列ではありません:', typeof response.data);
    }
  } catch (error) {
    console.error('[Book Sync] 投稿済み書籍の取得エラー:', error.message);
    if (error.response) {
      console.error('[Book Sync] レスポンス:', error.response.data);
    }
  }
}

// Botが起動したときの処理
client.once("ready", async () => {
  console.log(`Bot is ready! Logged in as ${client.user.tag}`);

  // ▼▼▼ この行を追加 ▼▼▼
  await syncPostedUrlsFromSheet();
  await syncPostedBooksFromSheet(); // 投稿済み書籍リストを同期
  cachedDiscussionMetrics = await getDiscussionMetricsFromSheet();
  cachedRecentNews = await getRecentNewsFromSheet();
  cachedTrendAnalysis = extractTrendKeywords(cachedRecentNews);
  // ▲▲▲ ▲▲▲

  // 毎日朝8時 (JST) に実行するcronジョブを設定 ('分 時 日 月 曜日')XXXXXX
  cron.schedule('0 8 * * *', async () => {
    //  cron.schedule('* * * * *', async () => { // テスト用に1分ごとに実行

    console.log('[Daily News] ニュース投稿タスクを開始します...');
    try {
      // ★★★ トレンド分析を毎日リフレッシュ ★★★
      cachedRecentNews = await getRecentNewsFromSheet();
      cachedTrendAnalysis = extractTrendKeywords(cachedRecentNews);
      cachedDiscussionMetrics = await getDiscussionMetricsFromSheet();

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

       // ▼▼▼ ここからが新しい除外処理です ▼▼▼
      const eligibleArticles = recentArticles.filter(article => {
        const content = (article.title + ' ' + (article.contentSnippet || '')).toLowerCase();
        // EXCLUSION_KEYWORDS のいずれかが content に含まれていたら除外 (falseを返す)
        return !EXCLUSION_KEYWORDS.some(keyword => content.includes(keyword));
      });

      console.log(`[Daily News] 除外キーワードに合致したため ${recentArticles.length - eligibleArticles.length} 件の記事を除外しました。`);
      // ▲▲▲ 除外処理ここまで ▲▲▲

      if (eligibleArticles.length === 0) {
        console.log('[Daily News] フィルタリング後、候補となるニュースがありませんでした。');
        return;
      }

      // ★★★ 多段階フィルタリングロジック ★★★
      let articlesToSelectFrom = [];

      // ▼▼▼ ここから下のすべてのフィルタリング対象を "eligibleArticles" に修正 ▼▼▼

      // --- 【最優先】一次産業 + 技術 + 活用事例 ---
      articlesToSelectFrom = eligibleArticles.filter(article => {
        const content = (article.title + ' ' + (article.contentSnippet || '')).toLowerCase();
        const hasPrimary = PRIMARY_INDUSTRY_KEYWORDS.some(key => content.includes(key.toLowerCase()));
        const hasTech = TECH_KEYWORDS.some(key => content.includes(key.toLowerCase()));
        const hasUsecase = USECASE_KEYWORDS.some(key => content.includes(key.toLowerCase()));
        return hasPrimary && hasTech && hasUsecase;
      });

      // --- 【次善】一次産業 + 技術 ---
      if (articlesToSelectFrom.length === 0) {
        console.log('[Daily News] 最優先条件に合致せず。緩和条件1（一次産業+技術）で再検索...');
        articlesToSelectFrom = eligibleArticles.filter(article => { // ← ここも修正
          const content = (article.title + ' ' + (article.contentSnippet || '')).toLowerCase();
          const hasPrimary = PRIMARY_INDUSTRY_KEYWORDS.some(key => content.includes(key.toLowerCase()));
          const hasTech = TECH_KEYWORDS.some(key => content.includes(key.toLowerCase()));
          return hasPrimary && hasTech;
        });
      }

      // --- 【次次善】一次産業 + 活用事例 ---
      if (articlesToSelectFrom.length === 0) {
        console.log('[Daily News] 緩和条件1に合致せず。緩和条件2（一次産業+活用事例）で再検索...');
        articlesToSelectFrom = eligibleArticles.filter(article => { // ← ここも修正
            const content = (article.title + ' ' + (article.contentSnippet || '')).toLowerCase();
            const hasPrimary = PRIMARY_INDUSTRY_KEYWORDS.some(key => content.includes(key.toLowerCase()));
            const hasUsecase = USECASE_KEYWORDS.some(key => content.includes(key.toLowerCase()));
            return hasPrimary && hasUsecase;
        });
      }

      // --- 【次次次善】一次産業のみ ---
      if (articlesToSelectFrom.length === 0) {
        console.log('[Daily News] 緩和条件2に合致せず。最終緩和条件（一次産業のみ）で再検索...');
        articlesToSelectFrom = eligibleArticles.filter(article => { // ← ここも修正
            const content = (article.title + ' ' + (article.contentSnippet || '')).toLowerCase();
            const hasPrimary = PRIMARY_INDUSTRY_KEYWORDS.some(key => content.includes(key.toLowerCase()));
            return hasPrimary;
        });
      }
      
      // ▲▲▲ 修正ここまで ▲▲▲
      
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
      
// === ステップ1: メイン投稿用のEmbedとコンテンツを作成 ===XXXXXX
      const embed = new EmbedBuilder()
        .setColor(0x28a745)
        .setTitle(selectedArticle.title)
        .setURL(selectedArticle.link)
        // 概要の文字数を少し増やして情報量をリッチにします (最大4096文字まで可能)
        .setDescription(selectedArticle.contentSnippet?.substring(0, 400) + '...' || '概要はありません。')
        .setFooter({ text: `Source: ${new URL(selectedArticle.link).hostname}` })
        .setTimestamp(new Date(selectedArticle.isoDate));

      const postContent = `
## 【**Metagri研究所 Daily Insight**】🌱🤖

おはようございます！本日の注目ニュースをお届けします。

🔬 **Metagri研究所より**
${metagriAnalysis.insight}

**▼議論は下のスレッドでどうぞ！▼**
`;

      // === ステップ2: メインメッセージを投稿し、その投稿からスレッドを作成 ===
      const message = await channel.send({ content: postContent, embeds: [embed] });

      const thread = await message.startThread({
        name: `【議論】${selectedArticle.title.substring(0, 80)}`,
        autoArchiveDuration: 1440, // 24時間
        reason: 'デイリーニュースに関する議論のため',
      });
      console.log(`[Daily News] ニュースを投稿し、スレッドを作成しました: ${selectedArticle.title}`);

      // === ステップ3: スレッド内に投稿する議論のテーマと報酬案内を作成 ===
      let discussionQuestions = "**💭 今日の議論テーマ**\n";
      metagriAnalysis.questions.forEach((q, i) => {
        discussionQuestions += `${i + 1}. ${q}\n`;
      });

      const threadPostContent = `
<@&${METAGRI_ROLE_ID}> <@&${BIGNER_ROLE_ID}> の皆さん！

${discussionQuestions}

**【ディスカッションに参加しよう！✨】**
皆さまのご意見をお聞かせください。
現場の声、技術的な考察、未来への提案など、どんな視点も歓迎です！

---
## **<報酬について>**
✅ <@&${METAGRI_ROLE_ID}> はMLTT
✅ <@&${BIGNER_ROLE_ID}> はポイントを
それぞれ1日1回配布します！
⏰ **本日17:00まで**のスレッド内でのご発言が対象となります。
`;

      // === ステップ4: 作成したスレッド内に議論のテーマを投稿 ===
      await thread.send(threadPostContent);
      console.log(`[Daily News] スレッド内に議論のテーマを投稿しました。`);


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


// --- 2. 情報収集ニュース投稿タスク (1日1回：朝6時) ---
// 毎日 AM 6:00 JST に実行し、厳選した5件を届ける
// cron.schedule('* * * * *', async () => { // テスト用に1分ごとに実行
cron.schedule('0 6 * * *', async () => {
  console.log('[Info Gathering] 日刊・情報収集タスクを開始します...');
  try {
    if (!INFO_GATHERING_CHANNEL_ID) { return; }
    const channel = await client.channels.fetch(INFO_GATHERING_CHANNEL_ID);
    if (!channel || channel.type !== ChannelType.GuildText) { return; }

    // Step 0: カテゴリ別に記事を並行取得
    const fetchArticles = async (urls) => {
      const promises = urls.map(async (url) => {
        try {
          const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
          return await parser.parseString(response.data);
        } catch (err) {
          console.error(`RSS取得エラー: ${url}`);
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

    // Step 2: 投稿済みの記事を除外する
    const newAgriArticles = recentAgriArticles.filter(a => !postedArticleUrls.has(a.link));
    const newTechArticles = recentTechArticles.filter(a => !postedArticleUrls.has(a.link));
    console.log(`[Info Gathering] 新規記事候補: 農業関連=${newAgriArticles.length}件, 技術関連=${newTechArticles.length}件`);

    // Step 3: フィルタリングと優先順位付け
    // ▼▼▼ Step 3 & 4: スコアリング方式による新しい選定ロジック ▼▼▼
    console.log('[Info Gathering] スコアリングを開始...');
    const allNewArticles = [...newAgriArticles, ...newTechArticles];
    const scoredArticles = [];
    const uniqueUrls = new Set();
    let excludedCount = 0; // 除外された記事数をカウント

    // すべての新規記事をスコアリング
    for (const article of allNewArticles) {
      if (!article.link || uniqueUrls.has(article.link)) continue;

      const content = (article.title + ' ' + (article.contentSnippet || '')).toLowerCase();
      let score = 0;
      let matchedCategories = new Set();

      // Helper function to check keywords and update score/labels
      const checkKeywords = (keywords, categoryName, points) => {
        if (keywords.some(k => content.includes(k.toLowerCase()))) {
          score += points;
          matchedCategories.add(categoryName);
        }
      };

      // 除外キーワードチェック（誤検出を防止）
      const hasExclusionKeyword = EXCLUSION_KEYWORDS.some(keyword => content.includes(keyword));
      if (hasExclusionKeyword) {
        excludedCount++;
        continue; // 除外キーワードに該当する場合はスキップ
      }

      // 各カテゴリのキーワードをチェックしてスコアを加算
      checkKeywords(CORE_AGRI_KEYWORDS, 'コア農業', 3);
      checkKeywords(TECH_INNOVATION_KEYWORDS, '技術革新', 5);
      checkKeywords(CONSUMER_EXPERIENCE_KEYWORDS, '消費者体験', 4);
      checkKeywords(SOCIAL_SUSTAINABILITY_KEYWORDS, '社会課題', 4);
      checkKeywords(HUMAN_STORY_KEYWORDS, 'ヒト物語', 4);
      checkKeywords(BUSINESS_POLICY_KEYWORDS, 'ビジネス政策', 3);
      checkKeywords(BUZZ_KEYWORDS, 'ボーナス', 2);

      // 「コア農業」カテゴリにマッチしない記事は除外（最低限の関連性を担保）
      if (score > 0 && matchedCategories.has('コア農業')) {
        // ★★★ 動的スコアリングを適用 ★★★
        const dynamicScore = applyDynamicScoring(article, score, matchedCategories, cachedDiscussionMetrics);

        scoredArticles.push({
          ...article,
          baseScore: score,
          score: dynamicScore,
          priorityLabel: Array.from(matchedCategories).join(' + ')
        });
        uniqueUrls.add(article.link);
      }
    }

    console.log(`[Info Gathering] 除外キーワードに該当: ${excludedCount}件, スコアリング対象: ${scoredArticles.length}件`);

    // スコアの高い順、次に日付の新しい順でソート
    scoredArticles.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return new Date(b.isoDate) - new Date(a.isoDate);
    });

    // ★★★ Step 4.5: 類似記事検出と重複除去 ★★★
    console.log('[Info Gathering] 類似記事の検出を開始...');
    const { deduplicated: uniqueArticles, groups: similarGroups } = detectAndGroupSimilarArticles(scoredArticles);

    // Step 5: 最終的に上位3件を抽出
    const finalArticles = uniqueArticles.slice(0, 3);

    if (finalArticles.length === 0) {
      console.log('[Info Gathering] 投稿対象の記事がありませんでした。');
      return;
    }

    console.log('[Info Gathering] 最終選考記事リスト (スコア順):');
    finalArticles.forEach((article, index) => {
      console.log(`  ${index + 1}. [Score: ${article.score}] [${article.priorityLabel}] ${article.title}`);
    });
    // ▲▲▲ 新しいロジックここまで ▲▲▲

    let postContent = `### 🚀 最新情報ヘッドライン（${finalArticles.length}件）\n---\n`;
    const articlesToLog = [];

    finalArticles.forEach((article, index) => {
      postContent += `**${index + 1}. ${article.title}**\n`;
      postContent += `📊 **評点: ${article.score}点** | カテゴリ: \`${article.priorityLabel}\`\n`;
      postContent += `${article.link}\n\n`;
      postedArticleUrls.add(article.link);
      articlesToLog.push({
        url: article.link,
        title: article.title,
        pubDate: article.isoDate,
        priority: article.priorityLabel,
        score: article.score
      });
    });

    await channel.send({ content: postContent });
    console.log(`[Info Gathering] ${finalArticles.length}件の厳選ニュースを投稿しました。`);

    if (articlesToLog.length > 0) {
      await logToSpreadsheet('addArticles', { articles: articlesToLog });
    }

  } catch (error) {
    console.error('[Info Gathering] タスク実行中にエラーが発生しました:', error);
  }
}, {
  timezone: "Asia/Tokyo"
});

// === 3. 新機能：海外文献の収集・翻訳・投稿（1日2回: 朝10時と夕方19時） ===
  // ※ ユーザーリクエストにより無効化（2025年）
  if (false) {
  cron.schedule('10 10,19 * * *', async () => {
    // cron.schedule('* * * * *', async () => { // テスト用に1分ごとに実行
    console.log('[Global Research] 海外文献収集タスクを開始します...');

    if (!GLOBAL_RESEARCH_CHANNEL_ID || GLOBAL_RSS_FEEDS.length === 0) {
      console.log('[Global Research] チャンネルIDまたはRSSフィードが設定されていません。');
      return;
    }

    try {
      const channel = await client.channels.fetch(GLOBAL_RESEARCH_CHANNEL_ID);
      if (!channel || channel.type !== ChannelType.GuildText) {
        console.error('[Global Research] 海外文献投稿用チャンネルが見つかりません。');
        return;
      }

     // 海外RSSフィードから記事を取得 (ヘッダー強化版)
      let allGlobalArticles = [];
      const headers = { // 人間らしいヘッダーを定義
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
        'Accept': 'application/xml,application/xhtml+xml,text/html;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
        'Referer': 'https://www.google.com/'
      };

      const feedPromises = GLOBAL_RSS_FEEDS.map(async (url) => {
        try {
          const response = await axios.get(url, { headers, timeout: 15000 }); // 強化したヘッダーを使用
          return await parser.parseString(response.data);
        } catch (err) {
          console.error(`[Global Research] RSSフィード取得失敗: ${url}`, err.message);
          return null;
        }
      });
      const feeds = await Promise.all(feedPromises);

      for (const feed of feeds) {
        if (feed && feed.items) {
          allGlobalArticles.push(...feed.items);
        }
      }

      if (allGlobalArticles.length === 0) {
        console.log('[Global Research] 海外文献が取得できませんでした。');
        return;
      }

      const fortyEightHoursAgo = new Date();
      fortyEightHoursAgo.setHours(fortyEightHoursAgo.getHours() - 48);

      const recentGlobalArticles = allGlobalArticles.filter(article => {
        const articleDate = new Date(article.isoDate || article.pubDate);
        return articleDate && articleDate >= fortyEightHoursAgo;
      });

      const newGlobalArticles = recentGlobalArticles.filter(a => !postedGlobalArticleUrls.has(a.link));

      if (newGlobalArticles.length === 0) {
        console.log('[Global Research] 新しい海外文献がありません。');
        return;
      }

      const filteredArticles = filterGlobalArticles(newGlobalArticles);

      if (filteredArticles.length === 0) {
        console.log('[Global Research] 条件に合致する海外文献が見つかりませんでした。');
        return;
      }

      const selectedArticles = filteredArticles.slice(0, 3);
      console.log(`[Global Research] ${selectedArticles.length}件の文献を翻訳します...`);

      const translatedArticles = [];
      for (const article of selectedArticles) {
        const translation = await translateAndSummarizeArticle(article);
        if (translation) {
          translatedArticles.push({
            original: article,
            translated: translation
          });
        }
      }

      if (translatedArticles.length === 0) {
        console.log('[Global Research] 翻訳に失敗しました。');
        return;
      }

      // Discord投稿用のメッセージを作成
      const currentHour = new Date().getHours();
      const greeting = currentHour < 12 ? 'おはようございます' : 'こんばんは';

      let postContent = `## 🌍 **Metagri Global Research Digest**\n\n${greeting}！世界の農業技術研究の最新動向をお届けします。\n\n`;
      const embeds = [];

      for (let i = 0; i < translatedArticles.length; i++) {
        const { original, translated } = translatedArticles[i];

        const embed = new EmbedBuilder()
          .setColor(0x4A90E2)
          .setTitle(`${i + 1}. ${translated.titleJa}`)
          .setURL(original.link)
          .addFields(
            { name: '📝 要約', value: translated.summary },
            { name: '🔍 重要ポイント', value: translated.keyPoints.map(p => `• ${p}`).join('\n') },
            { name: '💡 日本の農業への示唆', value: translated.implications }
          )
          .setFooter({ text: `Source: ${new URL(original.link).hostname}` })
          .setTimestamp(new Date(original.isoDate || original.pubDate));

        embeds.push(embed);
        postedGlobalArticleUrls.add(original.link);
      }

      let technicalTermsSection = '\n**📚 今回の専門用語解説**\n';
      const allTerms = {};
      translatedArticles.forEach(({ translated }) => Object.assign(allTerms, translated.technicalTerms));

      if (Object.keys(allTerms).length > 0) {
        Object.entries(allTerms).slice(0, 5).forEach(([en, ja]) => {
          technicalTermsSection += `• **${en}**: ${ja}\n`;
        });
        postContent += technicalTermsSection;
      }

      postContent += `\n**【議論・質問歓迎】**\nこれらの研究成果について、ご意見やご質問があればお気軽にコメントください！🌱`;

      // メッセージを送信
      await channel.send({ content: postContent, embeds: embeds });
      console.log(`[Global Research] ${translatedArticles.length}件の海外文献を投稿しました。`);

      // ログを記録
      for (const { original, translated } of translatedArticles) {
        await logToSpreadsheet('globalResearch', {
          titleOriginal: original.title,
          titleJa: translated.titleJa,
          link: original.link,
          summary: translated.summary,
          keyPoints: translated.keyPoints.join('\n'), // 配列を文字列に
          implications: translated.implications,
          publishDate: original.isoDate || original.pubDate
        });
      }
      // ▲▲▲ 補完ここまで ▲▲▲

    } catch (error) {
      console.error('[Global Research] タスク実行中にエラーが発生しました:', error);
    }
  }, {
    timezone: "Asia/Tokyo"
  }); // ← cron.schedule の閉じ括弧
  } // if (false) の閉じ括弧


   // ▼▼▼ 以下をまるごと追加 ▼▼▼
  // === 4. 新機能：Robloxニュースの収集・投稿（毎日 AM 7:00 JST） ===
  cron.schedule('0 7 * * *', async () => {
    // cron.schedule('* * * * *', async () => { // テスト用に1分ごとに実行
    console.log('[Roblox News] Robloxニュース収集タスクを開始します...');
    
    if (!ROBLOX_NEWS_CHANNEL_ID || ROBLOX_RSS_FEEDS.length === 0) {
      console.log('[Roblox News] チャンネルIDまたはRSSフィードが設定されていません。');
      return;
    }

    try {
      // --- ステップ1: 記事の収集とフィルタリング ---
      let recentArticles = [];
      const timeThreshold = new Date();
      timeThreshold.setHours(timeThreshold.getHours() - 24); // 24時間前の時刻

      const feedPromises = ROBLOX_RSS_FEEDS.map(async (url) => {
        try {
          const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
          const feed = await parser.parseString(response.data);
          return { sourceName: feed.title, items: feed.items };
        } catch (err) {
          console.error(`[Roblox News] RSSフィード取得失敗: ${url}`, err.message);
          return null;
        }
      });
      const feeds = await Promise.all(feedPromises);

      for (const feed of feeds) {
        if (feed && feed.items) {
          for (const item of feed.items) {
            const articleDate = new Date(item.isoDate || item.pubDate);
            if (articleDate && articleDate >= timeThreshold) {
              recentArticles.push({
                source: feed.sourceName,
                title: item.title,
                link: item.link,
                published: articleDate,
  contentSnippet: item.contentSnippet || '', // ★★★ この行を追加 ★★★
              });
            }
          }
        }
      }

       // ▼▼▼ ここからがロジック強化部分です ▼▼▼
      // --- ステップ2: スコアリングによる重要ニュースの厳選 ---
      const scoredArticles = [];
      for (const article of recentArticles) { // ← ここを allArticles から recentArticles に修正
        const content = (article.title + ' ' + article.contentSnippet).toLowerCase();
        let score = 0;
        const matchedCategories = new Set();

        const checkKeywords = (keywords, categoryName, points) => {
          if (keywords.some(k => content.includes(k.toLowerCase()))) {
            score += points;
            matchedCategories.add(categoryName);
          }
        };
        
        checkKeywords(ROBLOX_BUSINESS_KEYWORDS, 'Business/Brand', 5);
        checkKeywords(ROBLOX_PLATFORM_KEYWORDS, 'Platform Update', 5);
        checkKeywords(ROBLOX_FINANCE_KEYWORDS, 'Finance/Market', 4);
        checkKeywords(ROBLOX_TECH_KEYWORDS, 'Tech/Innovation', 3);

        if (score > 0) {
          scoredArticles.push({ ...article, score, label: Array.from(matchedCategories).join(' & ') });
        }
      }

      // スコアの高い順にソートし、最低スコア（例: 5点以上）で足切り
      const MINIMUM_SCORE = 5; 
      // ▼▼▼ 名前を変更 (finalArticles -> finalRobloxArticles) ▼▼▼
      const finalRobloxArticles = scoredArticles 
        .filter(a => a.score >= MINIMUM_SCORE)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5); // 最大5件まで

         if (finalRobloxArticles.length === 0) {
        console.log('[Roblox News] 翻訳対象の重要ニュースはありませんでした。');
        return;
      }
      
      // ▼▼▼ ここからが新しい処理です ▼▼▼
      // --- ステップ3: AIによる翻訳と要約 ---
      console.log(`[Roblox News] ${finalRobloxArticles.length}件の重要ニュースを翻訳します...`);
      const translatedArticles = [];
      for (const article of finalRobloxArticles) {
        const translation = await translateAndSummarizeRobloxArticle(article);
        if (translation) {
          translatedArticles.push({
            original: article,
            translated: translation
          });
        }
      }

      if (translatedArticles.length === 0) {
        console.log('[Roblox News] 翻訳に成功した記事がありませんでした。');
        // この場合、通知はしない
        return;
      }

      // --- ステップ4: Discordへの通知 ---
      const channel = await client.channels.fetch(ROBLOX_NEWS_CHANNEL_ID);
      if (!channel || channel.type !== ChannelType.GuildText) {
        console.error('[Roblox News] 通知用チャンネルが見つかりません。');
        return;
      }
      
      // --- ステップ5: Embedメッセージの作成 ---
      const embed = new EmbedBuilder()
        .setColor(0x00A2FF)
        .setTitle(`🤖 Roblox ビジネス・アップデート速報 (${new Date().toLocaleDateString('ja-JP')})`)
        .setDescription(`**${translatedArticles.length}件**の重要ニュースをAIが翻訳・要約しました。`)
        .setTimestamp();
        
      for (const item of translatedArticles) {
        const { original, translated } = item;
        const escapedTitle = translated.titleJa.replace(/\[/g, '［').replace(/\]/g, '］');
        
   // ▼▼▼ ここからが修正箇所です ▼▼▼
        
        // valueに含める情報を定義
        const summary = translated.summary;
        const linkText = `\n\n[原文を読む](${original.link}) (*Source: ${original.source}*)`;
        
        let valueText = summary + linkText;

        // 文字数制限のチェックと切り詰め処理
        const MAX_VALUE_LENGTH = 1024;
        if (valueText.length > MAX_VALUE_LENGTH) {
          // summary部分を短くして、linkTextが必ず入るように調整
          const availableLength = MAX_VALUE_LENGTH - linkText.length - 4; // "..."とマージン
          const truncatedSummary = summary.substring(0, availableLength) + "...";
          valueText = truncatedSummary + linkText;
        }

        const fieldName = `[${original.score}点 | ${original.label}] ${escapedTitle}`;
        
        embed.addFields({ name: fieldName, value: valueText });
        // ▲▲▲ ▲▲▲
      }
      
      await channel.send({ embeds: [embed] });
      console.log(`[Roblox News] ${translatedArticles.length}件の翻訳済みニュースを投稿しました。`);

    } catch (error) {
      console.error('[Roblox News] タスク実行中にエラーが発生しました:', error);
    }
  }, {
    timezone: "Asia/Tokyo"
  });

  // === 農業・Web3関連新刊紹介タスク（毎日朝10時） ===
  cron.schedule('0 10 * * *', async () => {
    // cron.schedule('* * * * *', async () => { // テスト用に1分ごとに実行
    await postDailyNewBook();
  }, {
    timezone: "Asia/Tokyo"
  });

  // === 一般新刊紹介タスク（毎日朝10時） ===
  cron.schedule('5 10 * * *', async () => {
    // cron.schedule('* * * * *', async () => { // テスト用に1分ごとに実行
    await postDailyPopularBook();
  }, {
    timezone: "Asia/Tokyo"
  });

  // === 農業AI通信タスク（毎日正午12時） ===
  cron.schedule('0 12 * * *', async () => {
    // cron.schedule('* * * * *', async () => { // テスト用に1分ごとに実行
    console.log('[AI Guide] 農業AI通信の配信タスクを開始します...');

    try {
      const channel = await client.channels.fetch(AI_GUIDE_CHANNEL_ID);
      if (!channel || channel.type !== ChannelType.GuildText) {
        console.log('[AI Guide] チャンネルが見つかりません。');
        return;
      }

      // RSSフィードを取得
      const response = await axios.get(AI_GUIDE_RSS_URL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*'
        },
        timeout: 15000
      });
      const feed = await parser.parseString(response.data);

      if (!feed.items || feed.items.length === 0) {
        console.log('[AI Guide] 記事が取得できませんでした。');
        return;
      }

      // 最新の記事を取得
      const latestArticle = feed.items[0];
      const articleDate = new Date(latestArticle.isoDate || latestArticle.pubDate);
      const now = new Date();
      const hoursSincePublished = (now - articleDate) / (1000 * 60 * 60);

      // 48時間以内の記事のみ配信（新しい記事がない場合はスキップ）
      if (hoursSincePublished > 48) {
        console.log('[AI Guide] 48時間以内の新しい記事がありません。');
        return;
      }

      // 記事ページから本文を取得
      let articleContent = latestArticle.contentSnippet || latestArticle.content || '';
      try {
        const articleResponse = await axios.get(latestArticle.link, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          timeout: 15000
        });
        const $ = cheerio.load(articleResponse.data);

        // WordPressの記事本文を取得（一般的なセレクタを試行）
        const selectors = ['.entry-content', '.post-content', 'article .content', '.article-content', 'main article'];
        for (const selector of selectors) {
          const content = $(selector).text().trim();
          if (content && content.length > 200) {
            articleContent = content;
            break;
          }
        }
        console.log(`[AI Guide] 記事本文を取得しました (${articleContent.length}文字)`);
      } catch (scrapeError) {
        console.log('[AI Guide] 記事本文の取得に失敗、RSSの内容を使用します:', scrapeError.message);
      }

      // AIによる要約と要点抽出
      let summary = '';
      let keyPoints = [];

      if (articleContent && OPENAI_API_KEY) {
        try {
          const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: `あなたは農業とAI技術に詳しい専門家です。記事を分析し、以下のJSON形式で出力してください：
{
  "summary": "3〜4文の要約（農業従事者向けに分かりやすく）",
  "keyPoints": ["要点1", "要点2", "要点3"],
  "actionable": "この記事から得られる実践的なヒント（1文）"
}`
              },
              {
                role: 'user',
                content: `以下の記事を分析してください。\n\nタイトル: ${latestArticle.title}\n\n本文: ${articleContent.substring(0, 3000)}`
              }
            ],
            max_tokens: 500,
            temperature: 0.7
          });

          const aiResponse = completion.choices[0].message.content;
          // JSONをパース（マークダウンのコードブロックを除去）
          const jsonStr = aiResponse.replace(/```json\n?|\n?```/g, '').trim();
          const parsed = JSON.parse(jsonStr);
          summary = parsed.summary || '';
          keyPoints = parsed.keyPoints || [];
          const actionable = parsed.actionable || '';

          // Discord投稿を作成（強化版）
          const embed = new EmbedBuilder()
            .setColor(0x00AA00)
            .setTitle(`🌾 ${latestArticle.title}`)
            .setURL(latestArticle.link)
            .setDescription(summary)
            .setFooter({ text: '農業AI通信 | metagri-labo.com' })
            .setTimestamp(articleDate);

          // 要点をフィールドとして追加
          if (keyPoints.length > 0) {
            embed.addFields({
              name: '📌 この記事のポイント',
              value: keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n'),
              inline: false
            });
          }

          // 実践的ヒントを追加
          if (actionable) {
            embed.addFields({
              name: '💡 実践のヒント',
              value: actionable,
              inline: false
            });
          }

          const postContent = `### 📡 農業AI通信 - 本日の記事\n農業×AIの最新情報をお届けします！`;

          await channel.send({ content: postContent, embeds: [embed] });
          console.log(`[AI Guide] 記事を投稿しました: ${latestArticle.title}`);

        } catch (aiError) {
          console.error('[AI Guide] AI要約生成エラー:', aiError.message);
          // フォールバック: シンプルな投稿
          const embed = new EmbedBuilder()
            .setColor(0x00AA00)
            .setTitle(`🌾 ${latestArticle.title}`)
            .setURL(latestArticle.link)
            .setDescription(articleContent.substring(0, 300) + '...')
            .setFooter({ text: '農業AI通信 | metagri-labo.com' })
            .setTimestamp(articleDate);

          await channel.send({ content: `### 📡 農業AI通信 - 本日の記事`, embeds: [embed] });
        }
      } else {
        // OpenAI APIキーがない場合のフォールバック
        const embed = new EmbedBuilder()
          .setColor(0x00AA00)
          .setTitle(`🌾 ${latestArticle.title}`)
          .setURL(latestArticle.link)
          .setDescription(articleContent.substring(0, 300) + '...')
          .setFooter({ text: '農業AI通信 | metagri-labo.com' })
          .setTimestamp(articleDate);

        await channel.send({ content: `### 📡 農業AI通信 - 本日の記事`, embeds: [embed] });
      }

    } catch (error) {
      console.error('[AI Guide] タスク実行中にエラーが発生しました:', error.message);
    }
  }, {
    timezone: "Asia/Tokyo"
  });

  console.log('All scheduled jobs initialized:');
  console.log('- Metagri Daily Insight: 8:00 JST');
  console.log('- Info Gathering: 6:00 JST');
  console.log('- Global Research Digest: 10:00, 19:00 JST');
  console.log('- Roblox News Digest: 7:00 JST');
  console.log('- AgriTech Book Recommendation: 10:00 JST');
  console.log('- Popular Book Recommendation: 10:00 JST');
  console.log('- AI Guide (農業AI通信): 12:00 JST');
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
