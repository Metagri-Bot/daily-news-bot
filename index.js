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
const INFO_GATHERING_CHANNEL_ID = process.env.INFO_GATHERING_CHANNEL_ID;

// === 海外文献用の新しい環境変数 ===
const GLOBAL_RESEARCH_CHANNEL_ID = process.env.GLOBAL_RESEARCH_CHANNEL_ID;
const GLOBAL_RSS_FEEDS = process.env.GLOBAL_RSS_FEEDS ? process.env.GLOBAL_RSS_FEEDS.split(',') : [];

// === Robloxニュース用の新しい環境変数 ===
const ROBLOX_NEWS_CHANNEL_ID = process.env.ROBLOX_NEWS_CHANNEL_ID;
const ROBLOX_RSS_FEEDS = process.env.ROBLOX_RSS_FEEDS ? process.env.ROBLOX_RSS_FEEDS.split(',') : [];

// OpenAI API設定（.envに追加が必要）
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ロールIDを読み込む
const BIGNER_ROLE_ID = process.env.BIGNER_ROLE_ID;
const METAGRI_ROLE_ID = process.env.METAGRI_ROLE_ID;

// === キーワード定義（旧） ===
const TECH_KEYWORDS = [ 'Web3', 'ブロックチェーン', 'NFT', 'DAO', 'メタバース', '生成AI', 'LLM', 'ChatGPT', 'AI', '人工知能', 'IoT', 'ドローン', 'DX', 'デジタル', 'ロボット', '自動化', '衛星', 'ソリューション', 'プラットフォーム', 'システム' ];
const PRIMARY_INDUSTRY_KEYWORDS = [ '農業', '農家', '農産物', 'アグリ', 'Agri', '畜産', '漁業', '林業', '酪農', '栽培', '養殖', 'スマート農業', 'フードテック', '農林水産', '一次産業', '圃場', '収穫', '品種', 'JGAP' ];
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
  '野菜', '農業', '農家', '農産物', 'アグリ', 'Agri', '畜産', '漁業', '林業', '酪農', '栽培', '養殖', '収穫', '品種', '圃場', '水産',
  // 新農法・技術
  '乾田直播', '不耕起', 'リジェネラティブ農業', '環境再生型', '陸上養殖', '植物工場', 'バイオ炭', 'バイオスティミュラント'
];

// 【2. テクノロジー・革新キーワード】（+5点） - Metagriらしさ
const TECH_INNOVATION_KEYWORDS = [
  // AI / 生成AI 関連
  'AI', '人工知能', '生成AI', 'LLM', 'ChatGPT',  'Gemini', 'Claude', 'エージェント', 'Vibe Coding', '動画生成AI', '画像生成AI', '3Dモデル',

  // Web3 / ブロックチェーン 関連
  'Web3', 'ブロックチェーン', 'NFT', 'DAO', 'メタバース','ウォレット', 'RWA', 'DeFi', 'スマートコントラクト', 'トークンエコノミー', 'トークン', 'デジタルツイン', 'デジタルツイン農業',

  // スマート農業 / IoT 関連
  'スマート農業', 'IoT', 'ドローン', 'ロボット', '自動化', '衛星', 'DX', 'デジタル', 'フードテック', 'アグリテック', '農業DX', '精密農業', 'センサー', 'コンピュータビジョン', 'データ解析', '気象予測', 'リモートセンシング', '画像解析', '農業用ドローン', '農業用ロボット',

  // バイオ・環境技術 関連
  'カーボンクレジット', 'ゲノム編集', 'フードテック', '培養肉', '代替肉','バイオ炭',

  // その他（概念・手法）
  'VR', 'ソリューション', 'プラットフォーム', 'システム'
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
  
  'オーガニック',  '食料危機', '規格外', '食品ロス', 'ゼロ廃棄', '環境再生型', 'サステナブル', '熱中症対策' , 'サステナブル', '有機農業', '環境保全', 'SDGs', '食料危機', '食料安全保障', '食料自給率',
  '食品ロス', 'フードロス', '食料廃棄', '鳥獣害', '病害虫', '気候変動', '中山間地域', '過疎地域', '限界集落', '地域活性化', '地方創生',
// 現場の課題
  '人手不足', '規格外', '古米', '耕作放棄地', '高齢化', '後継者不足', '労働力不足', '担い手不足', '農地集約', '農地中間管理機構', '農業従事者', '農業労働力', '農業就業人口'
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
const EXCLUSION_KEYWORDS = ['metagri', '農情人', 'metagri研究所', '農業aiハッカソン2025']; // キーワードは小文字で定義

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

// Botが起動したときの処理
client.once("ready", async () => {
  console.log(`Bot is ready! Logged in as ${client.user.tag}`);

  // ▼▼▼ この行を追加 ▼▼▼
  await syncPostedUrlsFromSheet();
  // ▲▲▲ ▲▲▲

  // 毎日朝8時 (JST) に実行するcronジョブを設定 ('分 時 日 月 曜日')XXXXXX
  cron.schedule('0 8 * * *', async () => {
    //  cron.schedule('* * * * *', async () => { // テスト用に1分ごとに実行

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
      // ▼▼▼ Step 3 & 4: スコアリング方式による新しい選定ロジック ▼▼▼
console.log('[Info Gathering] スコアリングを開始...');
const allNewArticles = [...newAgriArticles, ...newTechArticles];
const scoredArticles = [];
const uniqueUrls = new Set();

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

  // 各カテゴリのキーワードをチェックしてスコアを加算
  checkKeywords(CORE_AGRI_KEYWORDS, 'コア農業', 2);
  checkKeywords(TECH_INNOVATION_KEYWORDS, '技術革新', 5);
  checkKeywords(CONSUMER_EXPERIENCE_KEYWORDS, '消費者体験', 3);
  checkKeywords(SOCIAL_SUSTAINABILITY_KEYWORDS, '社会課題', 3);
  checkKeywords(HUMAN_STORY_KEYWORDS, 'ヒト物語', 4);
  checkKeywords(BUSINESS_POLICY_KEYWORDS, 'ビジネス政策', 3);
  checkKeywords(BUZZ_KEYWORDS, 'ボーナス', 2);

  // 「コア農業」カテゴリにマッチしない記事は除外（最低限の関連性を担保）
  if (score > 0 && matchedCategories.has('コア農業')) {
    scoredArticles.push({
      ...article,
      score: score,
      priorityLabel: Array.from(matchedCategories).join(' + ')
    });
    uniqueUrls.add(article.link);
  }
}

// スコアの高い順、次に日付の新しい順でソート
scoredArticles.sort((a, b) => {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  return new Date(b.isoDate) - new Date(a.isoDate);
});

// Step 5: 最終的に上位3件を抽出
const finalArticles = scoredArticles.slice(0, 3);

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
        postContent += `**${index + 1}. ${article.title}**\n${article.link}\n\n`;
        postedArticleUrls.add(article.link);
        articlesToLog.push({
          url: article.link,
          title: article.title,
          pubDate: article.isoDate,
          priority: article.priorityLabel,
          score: article.score // ▼▼▼ この行を追加 ▼▼▼
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

// === 3. 新機能：海外文献の収集・翻訳・投稿（1日2回: 朝10時と夕方19時） ===
  cron.schedule('0 10,19 * * *', async () => {
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
  }); // ← 抜けていた閉じ括弧


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
      const finalArticles = scoredArticles
        .filter(a => a.score >= MINIMUM_SCORE)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3); // 最大3件まで

         if (finalArticles.length === 0) {
        console.log('[Roblox News] 翻訳対象の重要ニュースはありませんでした。');
        return;
      }
      
      // ▼▼▼ ここからが新しい処理です ▼▼▼
      // --- ステップ3: AIによる翻訳と要約 ---
      console.log(`[Roblox News] ${finalArticles.length}件の重要ニュースを翻訳します...`);
      const translatedArticles = [];
      for (const article of finalArticles) {
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
  
  console.log(' - Roblox News Digest: 7:00 JST');
  console.log('All scheduled jobs initialized:');
  console.log('- Metagri Daily Insight: 8:00 JST');
  console.log('- Info Gathering: 6:00-18:00 JST (every 3h)');
  console.log('- Global Research Digest: 10:00, 19:00 JST');
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
