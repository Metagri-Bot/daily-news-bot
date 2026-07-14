require('dotenv').config();

const axios = require('axios');
const cheerio = require('cheerio');
const Parser = require('rss-parser');
const OpenAI = require('openai');

const parser = new Parser();

const AI_GUIDE_CHANNEL_ID = process.env.AI_GUIDE_CHANNEL_ID || '952206763539714088';
const AI_GUIDE_RSS_URL = process.env.AI_GUIDE_RSS_URL || 'https://metagri-labo.com/ai-guide/feed/';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_UTM_SOURCE = process.env.DISCORD_UTM_SOURCE || 'discord';
const DISCORD_UTM_MEDIUM = process.env.DISCORD_UTM_MEDIUM || 'social';

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`${name} is not set`);
  }
}

function truncate(text, max) {
  const value = String(text || '').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function addDiscordUtm(rawUrl, campaign = 'ai_guide', content = '') {
  if (!rawUrl) return rawUrl;

  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return rawUrl;

    url.searchParams.set('utm_source', DISCORD_UTM_SOURCE);
    url.searchParams.set('utm_medium', DISCORD_UTM_MEDIUM);
    url.searchParams.set('utm_campaign', campaign);

    if (content) {
      url.searchParams.set('utm_content', content);
    }

    return url.toString();
  } catch {
    return rawUrl;
  }
}

function safeJsonParse(text) {
  try {
    const jsonStr = String(text || '').replace(/```json\s*|\s*```/g, '').trim();
    const first = jsonStr.indexOf('{');
    const last = jsonStr.lastIndexOf('}');
    if (first === -1 || last === -1 || last < first) return null;
    return JSON.parse(jsonStr.slice(first, last + 1));
  } catch {
    return null;
  }
}

async function fetchArticleContent(article) {
  let articleContent = article.contentSnippet || article.content || '';

  try {
    const articleResponse = await axios.get(article.link, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 15000
    });

    const $ = cheerio.load(articleResponse.data);
    $('script, style, nav, header, footer, .date, .meta, .tags, .category, .breadcrumb, .social-share, .author-info, time').remove();

    const selectors = ['.entry-content', '.post-content', 'article .content', '.article-content', 'main article'];
    for (const selector of selectors) {
      const content = $(selector).text().trim()
        .replace(/\s+/g, ' ')
        .replace(/\d{4}[年\/\-]\d{1,2}[月\/\-]\d{1,2}日?/g, '')
        .trim();

      if (content && content.length > 200) {
        articleContent = content;
        break;
      }
    }
  } catch (error) {
    console.warn(`[AI Guide Repost] 本文取得に失敗したためRSS本文を使います: ${error.message}`);
  }

  return articleContent;
}

async function summarizeArticle(article, articleContent) {
  const systemPrompt = `あなたは農業とAI技術に詳しい専門家です。
以下の本文に「書かれていることだけ」に基づいて要約してください。

【厳守ルール】
- 本文にない固有名詞・数値・制度名・製品名は作らない
- 不明な場合は推測せず "不明" と書く
- 断定は本文が断定している場合のみ。基本は「〜の可能性があります」「〜が有効な場合があります」
- JSON以外は一切出力しない
- evidence は本文からの短い抜粋を必ず入れる

【出力JSON形式】
{
  "summary": "3〜4文の要約（農業従事者向け）",
  "keyPoints": ["要点1", "要点2", "要点3"],
  "actionable": "実践のヒント（1文・提案口調）",
  "facts": ["本文から直接確認できた事実1", "事実2"],
  "evidence": ["本文抜粋1", "本文抜粋2"]
}`;

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4.1',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `タイトル: ${article.title}\n\n本文: ${String(articleContent || '').slice(0, 3000)}` }
    ],
    temperature: 0.3
  });

  const parsed = safeJsonParse(completion.choices[0].message.content);
  if (!parsed) {
    throw new Error('OpenAI returned invalid JSON');
  }

  return parsed;
}

function buildEmbed(article, articleDate, parsed) {
  const disclaimer = '*※この記事はAIによって要約されています。正確な情報は必ず原文をご確認ください。*';
  const fields = [];

  if (Array.isArray(parsed.facts) && parsed.facts.length > 0) {
    fields.push({
      name: '📊 本文が伝える具体的な事実',
      value: truncate(parsed.facts.map((fact) => `・${fact}`).join('\n'), 1024),
      inline: false
    });
  }

  if (parsed.actionable) {
    fields.push({
      name: '💡 明日から使えるヒント',
      value: truncate(`> ${parsed.actionable}`, 1024),
      inline: false
    });
  }

  if (Array.isArray(parsed.evidence) && parsed.evidence.length > 0) {
    fields.push({
      name: '🧾 記事中の注目キーワード・発言',
      value: truncate(parsed.evidence.map((evidence) => `*「${evidence}」*`).join('\n'), 1024),
      inline: false
    });
  }

  return {
    color: 0x2ECC71,
    title: truncate(`🌾 ${article.title}`, 256),
    url: addDiscordUtm(article.link, 'ai_guide_repost'),
    description: truncate(`${disclaimer}\n\n**【概要】**\n${parsed.summary || '記事の詳細はリンクをご覧ください。'}`, 4096),
    fields,
    footer: { text: '農業AI通信 | metagri-labo.com' },
    timestamp: articleDate.toISOString()
  };
}

async function postToDiscord(article, articleDate, parsed) {
  const content = '### 📡 農業AI通信 - 本日のピックアップ\n農業をアップデートする最新情報をお届けします。';
  const embed = buildEmbed(article, articleDate, parsed);

  await axios.post(
    `https://discord.com/api/v10/channels/${AI_GUIDE_CHANNEL_ID}/messages`,
    { content, embeds: [embed] },
    {
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    }
  );
}

async function logToGas(article, articleDate, parsed) {
  if (!process.env.AI_GUIDE_GAS_URL) {
    console.warn('[AI Guide Repost] AI_GUIDE_GAS_URL が未設定のためGAS記録をスキップします。');
    return;
  }

  const payload = {
    type: 'aiGuide',
    title: article.title,
    url: article.link.split('?utm')[0],
    summary: parsed.summary || '',
    keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.join('\n') : '',
    actionable: parsed.actionable || '',
    facts: Array.isArray(parsed.facts) ? parsed.facts.join('\n') : '',
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.join('\n') : '',
    articleDate: articleDate.toISOString(),
    manualRepost: true
  };

  const response = await axios.post(process.env.AI_GUIDE_GAS_URL, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000
  });

  const result = response.data || {};
  if (result.status !== 'success') {
    throw new Error(`GAS returned non-success response: ${JSON.stringify(result)}`);
  }
}

async function main() {
  requireEnv('DISCORD_BOT_TOKEN', DISCORD_BOT_TOKEN);
  requireEnv('OPENAI_API_KEY', OPENAI_API_KEY);

  console.log('[AI Guide Repost] RSS取得を開始します...');
  const response = await axios.get(AI_GUIDE_RSS_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/rss+xml, application/xml, text/xml, */*'
    },
    timeout: 15000
  });

  const feed = await parser.parseString(response.data);
  if (!feed.items || feed.items.length === 0) {
    throw new Error('RSS feed has no items');
  }

  const article = feed.items[0];
  const articleDate = new Date(article.isoDate || article.pubDate);
  const hoursSincePublished = (Date.now() - articleDate.getTime()) / (1000 * 60 * 60);

  if (!Number.isFinite(articleDate.getTime())) {
    throw new Error(`Invalid article date: ${article.isoDate || article.pubDate}`);
  }

  if (hoursSincePublished > 48) {
    throw new Error(`48時間以内の記事がありません。最新記事: ${article.title} (${articleDate.toISOString()})`);
  }

  console.log(`[AI Guide Repost] 対象記事: ${article.title}`);
  console.log(`[AI Guide Repost] 公開日時: ${articleDate.toISOString()}`);

  const articleContent = await fetchArticleContent(article);
  const parsed = await summarizeArticle(article, articleContent);

  await postToDiscord(article, articleDate, parsed);
  console.log('[AI Guide Repost] Discordへの再投稿が完了しました。');

  await logToGas(article, articleDate, parsed);
  console.log('[AI Guide Repost] GASへの記録が完了しました。');
}

main().catch((error) => {
  if (error.response) {
    console.error(`[AI Guide Repost] HTTP ${error.response.status}:`, error.response.data);
  } else {
    console.error('[AI Guide Repost]', error.message);
  }
  process.exitCode = 1;
});
