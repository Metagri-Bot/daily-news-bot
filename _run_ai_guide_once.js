require('dotenv').config();
const cheerio = require('cheerio');
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ChannelType } = require('discord.js');
const Parser = require('rss-parser');
const parser = new Parser();
const axios = require('axios');
const OpenAI = require('openai');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const AI_GUIDE_CHANNEL_ID = '952206763539714088';
const AI_GUIDE_RSS_URL = 'https://metagri-labo.com/ai-guide/feed/';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DISCORD_UTM_SOURCE = process.env.DISCORD_UTM_SOURCE || 'discord';
const DISCORD_UTM_MEDIUM = process.env.DISCORD_UTM_MEDIUM || 'social';
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

function addDiscordUtm(rawUrl, campaign = 'ai_guide_once', content = '') {
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

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

client.once('ready', async () => {
  console.log(`[AI Guide] Logged in as ${client.user.tag}`);
  try {
    const channel = await client.channels.fetch(AI_GUIDE_CHANNEL_ID);
    if (!channel || channel.type !== ChannelType.GuildText) {
      console.log('[AI Guide] チャンネルが見つかりません。');
      process.exit(1);
    }

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
      process.exit(1);
    }

    const latestArticle = feed.items[0];
    const articleDate = new Date(latestArticle.isoDate || latestArticle.pubDate);
    const now = new Date();
    const hoursSincePublished = (now - articleDate) / (1000 * 60 * 60);
    console.log(`[AI Guide] Latest article: ${latestArticle.title} (${hoursSincePublished.toFixed(1)}h ago)`);

    let articleContent = latestArticle.contentSnippet || latestArticle.content || '';
    try {
      const articleResponse = await axios.get(latestArticle.link, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
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
    } catch (e) {
      console.log('[AI Guide] 本文取得失敗、RSSを使用');
    }

    if (articleContent && OPENAI_API_KEY) {
      const safeJsonParse = (text) => {
        try {
          const jsonStr = text.replace(/```json\s*|\s*```/g, '').trim();
          const first = jsonStr.indexOf('{');
          const last = jsonStr.lastIndexOf('}');
          return JSON.parse(jsonStr.slice(first, last + 1));
        } catch { return null; }
      };

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

      try {
        const completion = await openai.chat.completions.create({
          model: 'gpt-5.6-luna',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `タイトル: ${latestArticle.title}\n\n本文: ${articleContent.substring(0, 3000)}` }
          ],
          temperature: 0.3
        });

        const parsed = safeJsonParse(completion.choices[0].message.content);
        if (!parsed) throw new Error('Invalid JSON');

        const disclaimer = '*※この記事はAIによって要約されています。正確な情報は必ず原文をご確認ください。*';
        const embed = new EmbedBuilder()
          .setColor(0x2ECC71)
          .setTitle(`🌾 ${latestArticle.title}`)
          .setURL(addDiscordUtm(latestArticle.link, 'ai_guide_once'))
          .setDescription(`${disclaimer}\n\n**【概要】**\n${parsed.summary || '記事の詳細はリンクをご覧ください。'}`)
          .setFooter({ text: '農業AI通信 | metagri-labo.com', iconURL: client.user.displayAvatarURL() })
          .setTimestamp(articleDate);

        if (parsed.facts?.length > 0) {
          embed.addFields({ name: '📊 本文が伝える具体的な事実', value: parsed.facts.map(f => `・${f}`).join('\n'), inline: false });
        }
        if (parsed.actionable) {
          embed.addFields({ name: '💡 明日から使えるヒント', value: `> ${parsed.actionable}`, inline: false });
        }
        if (parsed.evidence?.length > 0) {
          embed.addFields({ name: '🧾 記事中の注目キーワード・発言', value: parsed.evidence.map(e => `*「${e}」*`).join('\n'), inline: false });
        }

        const postContent = `### 📡 農業AI通信 - 本日のピックアップ\n農業をアップデートする最新情報をお届けします。`;
        const sentMsg = await channel.send({ content: postContent, embeds: [embed] });
        console.log(`[AI Guide] Discord投稿完了: ${sentMsg.url}`);

        if (process.env.AI_GUIDE_GAS_URL) {
          try {
            const payload = {
              type: 'aiGuide',
              title: latestArticle.title,
              url: latestArticle.link.split('?utm')[0],
              summary: parsed.summary || '',
              keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.join('\n') : '',
              actionable: parsed.actionable || '',
              facts: Array.isArray(parsed.facts) ? parsed.facts.join('\n') : '',
              evidence: Array.isArray(parsed.evidence) ? parsed.evidence.join('\n') : '',
              articleDate: articleDate.toISOString()
            };
            const gasResponse = await axios.post(process.env.AI_GUIDE_GAS_URL, payload, {
              headers: { 'Content-Type': 'application/json' },
              timeout: 10000
            });
            const gasResult = gasResponse.data || {};
            console.log(`[AI Guide] GAS記録: ${JSON.stringify(gasResult)}`);
          } catch (logError) {
            console.error('[AI Guide] GAS記録失敗:', logError.message);
          }
        }
      } catch (aiError) {
        console.error('[AI Guide] AI解析エラー、フォールバック実行:', aiError.message);
        const fallbackEmbed = new EmbedBuilder()
          .setColor(0x00AA00)
          .setTitle(`🌾 ${latestArticle.title}`)
          .setURL(addDiscordUtm(latestArticle.link, 'ai_guide_once'))
          .setDescription(latestArticle.contentSnippet?.substring(0, 300) + '...')
          .setFooter({ text: '農業AI通信（要約エラー時）' });
        const sentMsg = await channel.send({ embeds: [fallbackEmbed] });
        console.log(`[AI Guide] Discord投稿完了(フォールバック): ${sentMsg.url}`);
      }
    } else {
      console.log('[AI Guide] 本文またはAPIキーがないため要約なしで投稿します。');
      const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle(`🌾 ${latestArticle.title}`)
        .setURL(addDiscordUtm(latestArticle.link, 'ai_guide_once'))
        .setDescription(latestArticle.contentSnippet?.substring(0, 500) || '');
      const sentMsg = await channel.send({ embeds: [embed] });
      console.log(`[AI Guide] Discord投稿完了: ${sentMsg.url}`);
    }

    process.exit(0);
  } catch (error) {
    console.error('[AI Guide] タスク実行エラー:', error.message);
    process.exit(1);
  }
});

client.login(DISCORD_BOT_TOKEN);
