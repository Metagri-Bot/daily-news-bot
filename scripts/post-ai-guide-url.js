require('dotenv').config();

const axios = require('axios');
const cheerio = require('cheerio');
const OpenAI = require('openai');
const { buildJsonCompletionParams } = require('../openai-chat');
const { normalizeAiGuideResult } = require('../ai-guide-content');

const TARGET_URL = process.argv[2] || process.env.AI_GUIDE_TARGET_URL;
const AI_GUIDE_CHANNEL_ID = process.env.AI_GUIDE_CHANNEL_ID || '952206763539714088';
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
const DISCORD_UTM_SOURCE = process.env.DISCORD_UTM_SOURCE || 'discord';
const DISCORD_UTM_MEDIUM = process.env.DISCORD_UTM_MEDIUM || 'social';

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

function requireValue(name, value) {
  if (!value) throw new Error(`${name} is not set`);
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
    const source = String(text || '').replace(/```json\s*|\s*```/g, '').trim();
    const first = source.indexOf('{');
    const last = source.lastIndexOf('}');
    if (first < 0 || last < first) return null;
    return JSON.parse(source.slice(first, last + 1));
  } catch {
    return null;
  }
}

function extractDate($) {
  const candidates = [
    $('meta[property="article:published_time"]').attr('content'),
    $('meta[name="date"]').attr('content'),
    $('time[datetime]').first().attr('datetime'),
    $('time').first().text()
  ].filter(Boolean);

  for (const candidate of candidates) {
    const date = new Date(candidate);
    if (Number.isFinite(date.getTime())) return date;
  }

  return new Date();
}

function extractTitle($) {
  return (
    $('meta[property="og:title"]').attr('content') ||
    $('h1').first().text() ||
    $('title').text() ||
    '農業AI通信'
  ).trim();
}

function extractContent($) {
  $('script, style, nav, header, footer, .date, .meta, .tags, .category, .breadcrumb, .social-share, .author-info, time').remove();
  const selectors = ['.entry-content', '.post-content', 'article .content', '.article-content', 'main article', 'article', 'main'];

  for (const selector of selectors) {
    const content = $(selector).text().trim()
      .replace(/\s+/g, ' ')
      .replace(/\d{4}[年\/\-]\d{1,2}[月\/\-]\d{1,2}日?/g, '')
      .trim();
    if (content.length > 200) return content;
  }

  return $('body').text().trim().replace(/\s+/g, ' ');
}

async function fetchArticle(url) {
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    timeout: 20000
  });

  const $ = cheerio.load(response.data);
  return {
    title: extractTitle($),
    link: url,
    articleDate: extractDate($),
    content: extractContent($)
  };
}

async function summarizeArticle(article) {
  const systemPrompt = `あなたは農業とAI技術に詳しい専門家です。
以下の本文に「書かれていることだけ」に基づいて要約してください。

【厳守ルール】
- 本文にない固有名詞・数値・制度名・製品名は作らない
- 不明な場合は推測せず "不明" と書く
- 断定は本文が断定している場合のみ。基本は「〜の可能性があります」「〜が有効な場合があります」
- JSON以外は一切出力しない
- evidence は重要度の高いものを原則2件、最大2件に絞る
- evidence は単独で読んでも意味が分かる発言・事実を選び、数値や数量だけの項目（例: "約9000坪"）は含めない
- evidence の文字列には外側の括弧・引用符（「」『』など）を付けない

【出力JSON形式】
{
  "summary": "3〜4文の要約（農業従事者向け）",
  "keyPoints": ["要点1", "要点2", "要点3"],
  "actionable": "実践のヒント（1文・提案口調）",
  "facts": ["本文から直接確認できた事実1", "事実2"],
  "evidence": ["本文抜粋1", "本文抜粋2"]
}`;

  const completion = await openai.chat.completions.create(buildJsonCompletionParams({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `タイトル: ${article.title}\nURL: ${article.link}\n\n本文: ${article.content.slice(0, 3000)}` }
    ],
    maxTokens: 2048
  }));

  const parsed = safeJsonParse(completion.choices[0].message.content);
  if (!parsed) throw new Error('OpenAI returned invalid JSON');
  return normalizeAiGuideResult(parsed);
}

function buildEmbed(article, parsed) {
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
    url: addDiscordUtm(article.link, 'ai_guide_manual'),
    description: truncate(`*※この記事はAIによって要約されています。正確な情報は必ず原文をご確認ください。*\n\n**【概要】**\n${parsed.summary || '記事の詳細はリンクをご覧ください。'}`, 4096),
    fields,
    footer: { text: '農業AI通信 | metagri-labo.com' },
    timestamp: article.articleDate.toISOString()
  };
}

async function postToDiscord(article, parsed) {
  const content = '### 📡 農業AI通信 - 本日のピックアップ\n農業をアップデートする最新情報をお届けします。';
  const embed = buildEmbed(article, parsed);
  const response = await axios.post(
    `https://discord.com/api/v10/channels/${AI_GUIDE_CHANNEL_ID}/messages`,
    { content, embeds: [embed] },
    {
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 20000
    }
  );

  return response.data;
}

async function logToGas(article, parsed) {
  if (!process.env.AI_GUIDE_GAS_URL) {
    console.warn('[AI Guide URL Post] AI_GUIDE_GAS_URL が未設定のためGAS記録をスキップします。');
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
    articleDate: article.articleDate.toISOString(),
    manualPost: true
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
  requireValue('AI_GUIDE_TARGET_URL or first argument', TARGET_URL);
  requireValue('DISCORD_BOT_TOKEN', DISCORD_BOT_TOKEN);
  requireValue('OPENAI_API_KEY', OPENAI_API_KEY);

  console.log(`[AI Guide URL Post] Fetching article: ${TARGET_URL}`);
  const article = await fetchArticle(TARGET_URL);
  console.log(`[AI Guide URL Post] Title: ${article.title}`);
  console.log(`[AI Guide URL Post] Article date: ${article.articleDate.toISOString()}`);

  const parsed = await summarizeArticle(article);
  const message = await postToDiscord(article, parsed);
  console.log(`[AI Guide URL Post] Discord posted: https://discord.com/channels/${message.guild_id}/${message.channel_id}/${message.id}`);

  await logToGas(article, parsed);
  console.log('[AI Guide URL Post] GAS logged.');
}

main().catch((error) => {
  if (error.response) {
    console.error(`[AI Guide URL Post] HTTP ${error.response.status}:`, error.response.data);
  } else {
    console.error('[AI Guide URL Post]', error.message);
  }
  process.exitCode = 1;
});
