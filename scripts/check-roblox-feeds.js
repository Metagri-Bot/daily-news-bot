'use strict';

// RSS候補とサイト直接巡回の生存確認。Discord投稿・履歴更新・OpenAI呼び出しは一切しない。
//   node scripts/check-roblox-feeds.js                 設定済みフィードを確認
//   node scripts/check-roblox-feeds.js --candidates    追加候補もまとめて確認
//   node scripts/check-roblox-feeds.js --direct        直接巡回ソースも確認
//   node scripts/check-roblox-feeds.js <URL> [<URL>…]  任意のフィードだけ確認
require('dotenv').config({ quiet: true });
const axios = require('axios');
const Parser = require('rss-parser');
const { getRobloxFeeds, isRobloxScopedFeed, mentionsRoblox } = require('../roblox-news');
const { DIRECT_SOURCES, BROWSER_HEADERS, discoverLinks, parseArticle } = require('../roblox-news-sources');

// 追加候補。外部からは取得できても本番サーバーのIP/UAでは403やレート制限になる媒体が
// あるため（2026-09-18: toybook 403 / licenseglobal 403 / venturebeat 429）、
// 採否は必ずこのスクリプトをサーバー上で流した結果で決める。
const CANDIDATE_FEEDS = [
  'https://www.licenseglobal.com/rss.xml',
  'https://toybook.com/feed/',
  'https://toyworldmag.co.uk/feed/',
  'https://www.marketingdive.com/feeds/news/',
  'https://digiday.com/feed/',
  'https://www.glossy.co/feed/',
  'https://www.modernretail.co/feed/',
  'https://www.retaildive.com/feeds/news/',
  'https://www.gamedeveloper.com/rss.xml',
  'https://naavik.co/feed/',
  'https://www.fashionista.com/.rss/full/',
  'https://venturebeat.com/feed/',
];

const TIMEOUT_MS = 20000;
const HEADERS = BROWSER_HEADERS;
const parser = new Parser();

const fetchText = async url => (await axios.get(url, { timeout: TIMEOUT_MS, headers: HEADERS })).data;

function summarize(url, feed) {
  const items = feed.items || [];
  const direct = items.filter(item => {
    try { return new URL(item.link).hostname !== 'news.google.com'; } catch { return false; }
  }).length;
  const dates = items.map(item => new Date(item.isoDate || item.pubDate || 0).getTime()).filter(Boolean);
  return {
    url,
    scope: isRobloxScopedFeed(url) ? '専用' : '広域',
    items: items.length,
    direct,
    roblox: items.filter(item => mentionsRoblox({ title: item.title, contentSnippet: item.contentSnippet || item.content || '' })).length,
    newest: dates.length ? new Date(Math.max(...dates)).toISOString().slice(0, 10) : '-',
  };
}

async function checkFeed(url) {
  try {
    return { ok: true, ...summarize(url, await parser.parseString(await fetchText(url))) };
  } catch (error) {
    return { ok: false, url, scope: isRobloxScopedFeed(url) ? '専用' : '広域', error: error.message };
  }
}

// 直接巡回は「一覧から記事リンクを拾えるか」と「公開日を読めるか」の両方が要る。
async function checkDirectSource(source) {
  try {
    const links = discoverLinks(await fetchText(source.url), source);
    let dated = 0;
    for (const link of links.slice(0, 3)) {
      try {
        if (parseArticle(await fetchText(link), link, source.name).publicationVerified) dated++;
      } catch { /* 個別記事の失敗は下の表に件数として現れる */ }
    }
    return { ok: true, name: source.name, links: links.length, sampled: Math.min(links.length, 3), dated };
  } catch (error) {
    return { ok: false, name: source.name, error: error.message };
  }
}

function printFeedTable(rows) {
  const width = Math.min(72, Math.max(20, ...rows.map(row => row.url.length)));
  console.log(`${'フィード'.padEnd(width)} 判定 状態   項目 直リンク Roblox 最新`);
  for (const row of rows) {
    if (!row.ok) { console.log(`${row.url.padEnd(width)} ${row.scope} ✗ NG   ${row.error}`); continue; }
    const flag = row.items === 0 ? '△ 空' : '✓ OK';
    console.log(`${row.url.padEnd(width)} ${row.scope} ${flag} ${String(row.items).padStart(4)} ${String(row.direct).padStart(6)} ${String(row.roblox).padStart(6)} ${row.newest}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const explicit = args.filter(arg => /^https?:\/\//i.test(arg));
  const configured = explicit.length ? explicit : getRobloxFeeds(process.env.ROBLOX_RSS_FEEDS || '');
  const targets = [...new Set([...configured, ...(args.includes('--candidates') ? CANDIDATE_FEEDS : [])])];

  const rows = [];
  for (let i = 0; i < targets.length; i += 4) {
    rows.push(...await Promise.all(targets.slice(i, i + 4).map(checkFeed)));
  }
  printFeedTable(rows);

  const dead = rows.filter(row => !row.ok);
  const empty = rows.filter(row => row.ok && row.items === 0);
  const silent = rows.filter(row => row.ok && row.items > 0 && row.roblox === 0);
  console.log(`\n取得成功=${rows.length - dead.length}/${rows.length} 取得失敗=${dead.length} 空=${empty.length} Roblox言及0件=${silent.length}`);
  if (dead.length) console.log(`取得できないフィード（設定から外す候補）:\n  ${dead.map(row => row.url).join('\n  ')}`);
  if (silent.length) console.log(`今回Roblox言及が0件のフィード（数日おいて再確認）:\n  ${silent.map(row => row.url).join('\n  ')}`);
  console.log('※広域フィードは見出し・要約にRobloxが出る項目だけを本収集の対象にします。');

  if (args.includes('--direct')) {
    console.log('\n直接巡回ソース（一覧からのリンク抽出と公開日取得）');
    for (const source of DIRECT_SOURCES) {
      const result = await checkDirectSource(source);
      console.log(result.ok
        ? `  ${result.name.padEnd(16)} ✓ リンク=${result.links} 公開日取得=${result.dated}/${result.sampled}`
        : `  ${result.name.padEnd(16)} ✗ ${result.error}`);
    }
  }

  if (dead.some(row => configured.includes(row.url))) process.exitCode = 1;
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
