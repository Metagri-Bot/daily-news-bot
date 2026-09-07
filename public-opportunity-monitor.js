'use strict';

/**
 * 官公庁・自治体 公募案件モニター（収集〜評価〜通知まで自動）。
 *
 * 流れ:
 *   1. 監視先の一覧ページ／RSSから公募っぽいリンクを収穫
 *   2. 通知履歴と突き合わせ、未取得のものだけ詳細ページを取得
 *   3. 締切・応募資格を抽出し、100点ルーブリックで採点
 *   4. S・Aランクかつ閾値以上のみOpenAIで要約・接続理由・次の一手を生成
 *   5. 新規／更新案件だけDiscordへ投稿し、履歴を更新
 *
 * 該当が0件の日は何も投稿しない（SKILL.mdの運用と同じ）。
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { buildJsonCompletionParams } = require('./openai-chat');

const {
  MIN_NOTIFY_SCORE,
  canonicalUrl,
  opportunityId,
  extractDeadline,
  daysUntil,
  scoreOpportunity,
  qualifiesForNotification,
  emptyState,
  selectNewOpportunities,
  recordNotified,
  pruneState,
  buildOpportunityEmbed,
  normalizeText,
  CALL_KEYWORDS,
  DOMAIN_KEYWORDS,
  TECH_KEYWORDS
} = require('./public-opportunity');

const { activeSources } = require('./public-opportunity-sources');

const {
  fetchRemoteHistory,
  pushRemoteHistory,
  mergeHistories,
  buildRecords
} = require('./public-opportunity-store');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const STATE_DIR = path.join(__dirname, 'state');
const STATE_FILE = path.join(STATE_DIR, 'public-opportunities.json');
const CANDIDATES_FILE = path.join(STATE_DIR, 'public-opportunity-candidates.json');

const LIMITS = {
  linksPerSource: 15, // 一覧ページから拾う候補リンク数の上限
  detailFetches: 40, // 1回の実行で詳細ページを開く上限
  recheckPerRun: 5, // 締切変更の確認のため再取得する既知案件の上限
  recheckIntervalDays: 6,
  aiEnrichments: 8, // OpenAIで整形する件数の上限（コスト制御）
  requestDelayMs: 800,
  // 省庁サイトは応答が細切れに届くことがあり、axiosのtimeoutだけでは止まらない。
  // 1リクエストごとにハードタイムアウトを掛ける
  fetchTimeoutMs: 25000,
  // 収集フェーズ全体の時間予算。超えたら残りは次回実行に回す
  collectBudgetMs: 8 * 60 * 1000
};

const LOG_PREFIX = '[Public Opportunity]';

// 既定のOpenAIモデル（環境変数 PUBLIC_OPPORTUNITY_OPENAI_MODEL で上書き可）
const DEFAULT_AI_MODEL = process.env.PUBLIC_OPPORTUNITY_OPENAI_MODEL || 'gpt-5.6-luna';

// --- 小さなユーティリティ -------------------------------------------------

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function log(message) {
  console.log(`${LOG_PREFIX} ${message}`);
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (error) {
    console.error(`${LOG_PREFIX} 状態ファイルの読み込みに失敗しました: ${error.message}`);
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, filePath);
}

function loadState(stateFile = STATE_FILE) {
  return readJsonFile(stateFile, emptyState());
}

function saveState(state, stateFile = STATE_FILE) {
  writeJsonFile(stateFile, state);
}

// --- 収集 -----------------------------------------------------------------

/**
 * 指定時間で必ず終わらせるラッパー。
 * axiosのtimeoutは「無通信時間」の上限なので、データが細切れに届き続けると
 * いつまでも終わらない。実行時間そのものに上限を掛ける。
 */
function withHardTimeout(promise, ms, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} がタイムアウトしました（${ms}ms）`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

async function defaultFetchText(url) {
  const request = axios.get(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    timeout: 20000,
    maxRedirects: 5,
    responseType: 'text',
    maxContentLength: 8 * 1024 * 1024,
    maxBodyLength: 8 * 1024 * 1024
  });

  const response = await withHardTimeout(request, LIMITS.fetchTimeoutMs, `取得(${url})`);
  return typeof response.data === 'string' ? response.data : String(response.data || '');
}

// テストやオフライン検証で差し替えられるようにしておく
let fetchText = defaultFetchText;

/** リンクテキストが「公募っぽいか」を粗く判定して詳細取得を絞る */
function looksLikeCall(text) {
  const normalized = normalizeText(text);
  if (normalized.length < 6) return false;
  const hasCall = CALL_KEYWORDS.some(keyword => normalized.includes(normalizeText(keyword)));
  if (!hasCall) return false;
  const hasTheme = [...DOMAIN_KEYWORDS, ...TECH_KEYWORDS].some(keyword =>
    normalized.includes(normalizeText(keyword))
  );
  return hasTheme;
}

/**
 * 一覧ページからリンクを収穫する。
 * セレクタ依存を避け、アンカーテキストとパス条件だけで判定する。
 */
function harvestLinks(html, source) {
  const $ = cheerio.load(html);
  const base = new URL(source.url);
  const found = new Map();

  $('a[href]').each((_, element) => {
    if (found.size >= LIMITS.linksPerSource) return;

    const rawHref = String($(element).attr('href') || '').trim();
    const text = $(element).text().replace(/\s+/g, ' ').trim();
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) return;
    if (!looksLikeCall(text)) return;

    let absolute;
    try {
      absolute = new URL(rawHref, base);
    } catch (error) {
      return;
    }
    if (!/^https?:$/.test(absolute.protocol)) return;
    if (absolute.hostname !== base.hostname) return;
    if (source.linkFilter && !source.linkFilter.test(absolute.pathname)) return;
    if (/\.(pdf|xlsx?|docx?|zip|csv)$/i.test(absolute.pathname)) {
      // PDF直リンクは本文抽出できないため、要確認フラグ付きで拾う
      found.set(canonicalUrl(absolute.toString()), {
        url: absolute.toString(),
        title: text,
        organization: source.organization,
        source_id: source.id,
        is_document: true
      });
      return;
    }

    found.set(canonicalUrl(absolute.toString()), {
      url: absolute.toString(),
      title: text,
      organization: source.organization,
      source_id: source.id,
      is_document: false
    });
  });

  return [...found.values()];
}

async function collectFromSource(source) {
  try {
    const html = await fetchText(source.url);
    if (!html) {
      log(`${source.organization}（${source.label}）から本文を取得できませんでした`);
      return [];
    }
    const links = harvestLinks(html, source);
    log(`${source.organization}（${source.label}）候補 ${links.length}件`);
    return links;
  } catch (error) {
    console.error(
      `${LOG_PREFIX} ${source.organization}（${source.label}）の取得に失敗: ${error.message}`
    );
    return [];
  }
}

/** 詳細ページから本文テキストを抽出する */
function extractBody(html) {
  const $ = cheerio.load(html);
  $('script, style, nav, header, footer, .breadcrumb, .sitemap, .globalnav, aside').remove();

  const selectors = [
    'main',
    '#main',
    '.contents',
    '#contents',
    '.entry-content',
    'article',
    '.detail',
    'body'
  ];

  for (const selector of selectors) {
    const text = $(selector).text().replace(/\s+/g, ' ').trim();
    if (text.length > 300) return text.slice(0, 12000);
  }
  return $('body').text().replace(/\s+/g, ' ').trim().slice(0, 12000);
}

function pageTitle(html, fallback) {
  try {
    const $ = cheerio.load(html);
    const title = ($('h1').first().text() || $('title').first().text() || '')
      .replace(/\s+/g, ' ')
      .trim();
    return title || fallback;
  } catch (error) {
    return fallback;
  }
}

async function fetchDetail(candidate) {
  if (candidate.is_document) {
    // PDF等は本文を読めないので、リンクテキストのみで評価する
    return { ...candidate, body: candidate.title, deadline: null, needs_manual_check: true };
  }

  const html = await fetchText(candidate.url);
  const body = extractBody(html);
  const title = pageTitle(html, candidate.title);
  const deadline = extractDeadline(body);

  return {
    ...candidate,
    title,
    body,
    summary: body.slice(0, 400),
    deadline: deadline ? deadline.toISOString() : null,
    needs_manual_check: !deadline
  };
}

// --- OpenAIによる整形（通知対象のみ） ------------------------------------

const AI_SYSTEM_PROMPT = `あなたは株式会社農情人（農業×生成AI・web3の事業会社／Metagri研究所を運営）の公募担当者です。
公募ページの本文から、応募判断に必要な事実だけを抽出します。本文に書かれていない事実は決して創作せず、不明な項目はnullまたは「要確認」と書きます。`;

function buildAiPrompt(item) {
  return `# 公募ページ情報
【タイトル】${item.title}
【所管】${item.organization}
【URL】${item.url}
【抽出済み締切】${item.deadline || '不明'}
【本文抜粋】
${String(item.body || '').slice(0, 6000)}

# 農情人の実績（接続理由に使えるもの）
- 農家支援コミュニティ「Metagri研究所」運営（Discord 1,300人超）
- 農業AI通信（農家向けAI活用メディア）、note連続更新、Kindle著書8冊
- 白井市PR動画AIコンテスト、農業AI実態調査、農家取材、酪農DX、農業AIハッカソン
- 自治体・農林水産省・大学・金融機関・農業関連企業との連携・登壇実績
- React/Next.js開発、NFT発行・ガスレス交換等のweb3実装

# 出力（JSONのみ。前後に説明文を書かない）
{
  "relevant": true または false（公募告知でない／締切済み／農情人に役割がない場合はfalse）,
  "irrelevant_reason": relevantがfalseのときのみ理由を1文。それ以外はnull,
  "title": "公募の正式名称（本文から）",
  "deadline": "YYYY-MM-DDTHH:MM:SS+09:00 形式。不明ならnull",
  "summary": "事実だけの2文の要約",
  "eligibility": "応募できる主体の記載をそのまま短く。不明なら要確認",
  "support": "支援内容・金額。不明なら要確認",
  "fit_reasons": ["農情人の既存実績と公募要件の具体的な接続を2〜3件"],
  "use_cases": ["予算", "広報", "パートナー", "実装機会" から該当するもの"],
  "action": "次に取る具体的な行動を1文",
  "caution": "応募資格・体制・自己負担の注意点を1文。直接応募可否が不明な場合は必ず明記"
}`;
}

function safeJsonParse(text) {
  try {
    const cleaned = String(text || '')
      .replace(/```json\s*|\s*```/g, '')
      .trim();
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first === -1 || last === -1) return null;
    return JSON.parse(cleaned.slice(first, last + 1));
  } catch (error) {
    return null;
  }
}

/**
 * モデル世代ごとのパラメータ差を吸収する。
 * GPT-5系（reasoningトークンを使うモデル）は temperature 非対応で、
 * 出力上限は max_completion_tokens。reasoningの消費分を見込んで枠を広く取る。
 */
function buildCompletionParams(model, messages) {
  return buildJsonCompletionParams({
    model,
    messages,
    maxTokens: /^(gpt-5|gpt-6|o[1-9])/i.test(String(model)) ? 4000 : 1200,
    temperature: 0.2
  });
}

/** 未対応パラメータで400が返った場合に、最小構成で1回だけ再試行する */
async function createCompletion(openai, model, messages) {
  try {
    return await openai.chat.completions.create(buildCompletionParams(model, messages));
  } catch (error) {
    const status = error?.status || error?.response?.status;
    if (status !== 400) throw error;
    console.error(`${LOG_PREFIX} パラメータ非対応の可能性があるため最小構成で再試行します: ${error.message}`);
    return openai.chat.completions.create({ model, messages });
  }
}

async function enrichWithAi(item, openai, model) {
  if (!openai) return { ...item, ai_enriched: false };

  try {
    const response = await createCompletion(openai, model, [
      { role: 'system', content: AI_SYSTEM_PROMPT },
      { role: 'user', content: buildAiPrompt(item) }
    ]);

    const parsed = safeJsonParse(response.choices?.[0]?.message?.content);
    if (!parsed) return { ...item, ai_enriched: false };

    if (parsed.relevant === false) {
      return {
        ...item,
        ai_enriched: true,
        ai_rejected: true,
        ai_reject_reason: parsed.irrelevant_reason || 'AI判定で対象外'
      };
    }

    const cautionParts = [
      parsed.caution,
      parsed.eligibility ? `応募資格: ${parsed.eligibility}` : null,
      item.needs_manual_check ? '締切を公募要領で要確認' : null
    ].filter(Boolean);

    return {
      ...item,
      ai_enriched: true,
      title: parsed.title || item.title,
      deadline: parsed.deadline || item.deadline,
      summary: parsed.summary || item.summary,
      support: parsed.support || null,
      fit_reasons: Array.isArray(parsed.fit_reasons) ? parsed.fit_reasons : [],
      use_cases: Array.isArray(parsed.use_cases) ? parsed.use_cases : [],
      action: parsed.action || null,
      caution: cautionParts.join(' / ')
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} AI整形に失敗（キーワード評価のみで継続）: ${error.message}`);
    return { ...item, ai_enriched: false };
  }
}

// --- 既知案件の再確認 -----------------------------------------------------

function shouldRecheck(entry, now) {
  const lastChecked = new Date(entry.last_checked_at || entry.last_notified_at || 0).getTime();
  if (Number.isNaN(lastChecked)) return true;

  const elapsedDays = (new Date(now).getTime() - lastChecked) / (24 * 60 * 60 * 1000);
  if (elapsedDays < LIMITS.recheckIntervalDays) return false;

  const remaining = daysUntil(entry.deadline, now);
  return remaining === null || remaining >= 0; // 締切切れは再確認しない
}

// --- 本体 -----------------------------------------------------------------

/**
 * 公募モニターを1回実行する。
 *
 * @param {object} options
 * @param {import('discord.js').Client} [options.client] Discordクライアント
 * @param {string} [options.channelId] 投稿先チャンネルID
 * @param {object} [options.openai] OpenAIクライアント（未指定ならキーワード評価のみ）
 * @param {string} [options.model] OpenAIモデル（既定 gpt-5.6-luna）
 * @param {boolean} [options.dryRun] trueならDiscord投稿と履歴更新を行わない
 * @param {number} [options.minScore] 通知の下限点
 * @param {number} [options.maxPriority] 監視先の優先度上限（1〜3）
 * @param {function} [options.fetchTextImpl] HTTP取得の差し替え（テスト用）
 * @param {Array} [options.sources] 監視先の差し替え（テスト用）
 * @param {string} [options.stateFile] 履歴ファイルの差し替え（テスト用）
 * @param {string} [options.candidatesFile] 候補ファイルの差し替え（テスト用）
 * @returns {Promise<object>} 実行サマリ
 */
async function runMonitorOnce(options = {}) {
  const {
    client = null,
    channelId = null,
    openai = null,
    model = DEFAULT_AI_MODEL,
    dryRun = false,
    minScore = MIN_NOTIFY_SCORE,
    maxPriority = 3,
    fetchTextImpl = null,
    sources: sourceOverride = null,
    stateFile = STATE_FILE,
    candidatesFile = CANDIDATES_FILE,
    requestDelayMs = LIMITS.requestDelayMs,
    gasUrl = process.env.GOOGLE_APPS_SCRIPT_URL || null,
    storePostImpl = null
  } = options;

  const now = new Date();
  const localState = pruneState(loadState(stateFile), now);
  const localCount = Object.keys(localState.seen).length;

  // 重複判定の正はスプレッドシート。ローカルJSONはその写しとして扱う
  const storeOptions = storePostImpl ? { postImpl: storePostImpl } : {};
  const remote = await fetchRemoteHistory(gasUrl, storeOptions);

  // 通信自体が失敗し、かつローカル履歴も空＝過去の通知内容が分からない状態。
  // ここで投稿すると過去案件を再通知してしまうため、投稿せずに中断する。
  if (remote.status === 'unavailable' && localCount === 0) {
    throw new Error(
      '通知履歴を取得できませんでした（スプレッドシートへの通信失敗・ローカル履歴も空）。' +
        '過去案件の再通知を避けるため今回の投稿を中止します。GASのURLと疎通を確認してください。'
    );
  }

  const state =
    remote.status === 'ok' ? pruneState(mergeHistories(localState, remote), now) : localState;

  if (remote.status === 'ok') {
    log(
      `履歴を統合しました（ローカル${localCount}件 + シート${Object.keys(remote.seen).length}件 → ${Object.keys(state.seen).length}件）`
    );
  } else if (remote.status === 'not_deployed') {
    log(
      `⚠ GASが履歴APIに未対応のため、ローカル履歴${localCount}件のみで重複判定します（Apps Scriptの再デプロイが必要）`
    );
  } else if (remote.status === 'unavailable') {
    log(`⚠ シート履歴が取得できないため、ローカル履歴${localCount}件のみで重複判定します`);
  }

  const sources = sourceOverride || activeSources(maxPriority);

  log(`監視先 ${sources.length}件の収集を開始します（dryRun=${dryRun}）`);

  // 1. 候補リンクの収穫
  const harvested = new Map();
  for (const source of sources) {
    const links = await collectFromSource(source);
    links.forEach(link => {
      const key = canonicalUrl(link.url);
      if (!harvested.has(key)) harvested.set(key, link);
    });
    await sleep(requestDelayMs);
  }

  // 2. 未取得のものと、再確認対象を選ぶ
  const unseen = [];
  const recheck = [];
  for (const candidate of harvested.values()) {
    let id;
    try {
      id = opportunityId(candidate);
    } catch (error) {
      continue;
    }
    const entry = state.seen[id];
    if (!entry) unseen.push(candidate);
    else if (shouldRecheck(entry, now) && recheck.length < LIMITS.recheckPerRun) {
      recheck.push(candidate);
    }
  }

  const targets = [...unseen, ...recheck].slice(0, LIMITS.detailFetches);
  log(`収穫 ${harvested.size}件 / 詳細取得 ${targets.length}件（新規${unseen.length}・再確認${recheck.length}）`);

  // 3. 詳細取得と採点
  const scored = [];
  const collectDeadline = now.getTime() + LIMITS.collectBudgetMs;
  let inspected = 0;
  for (const candidate of targets) {
    if (Date.now() > collectDeadline) {
      // 未処理分は履歴に残らないため、次回実行で改めて取得される
      log(`⏱ 収集の時間予算を超えたため、残り${targets.length - inspected}件は次回に回します`);
      break;
    }
    inspected += 1;
    if (inspected % 10 === 0) {
      log(`詳細取得 ${inspected}/${targets.length}件を処理しました`);
    }
    try {
      const detail = await fetchDetail(candidate);
      const evaluation = scoreOpportunity(detail, now);
      scored.push({
        ...detail,
        score: evaluation.score,
        rank: evaluation.rank,
        breakdown: evaluation.breakdown,
        excluded: evaluation.excluded,
        exclusion_reason: evaluation.exclusion_reason,
        remaining_days: evaluation.remaining_days
      });
    } catch (error) {
      console.error(`${LOG_PREFIX} 詳細取得に失敗: ${candidate.url} - ${error.message}`);
    }
    await sleep(requestDelayMs);
  }

  // 4. 通知候補のみAIで整形し、再採点
  const shortlist = scored
    .filter(item => !item.excluded && qualifiesForNotification(item, minScore))
    .sort((a, b) => b.score - a.score)
    .slice(0, LIMITS.aiEnrichments);

  const qualified = [];
  for (const item of shortlist) {
    const enriched = await enrichWithAi(item, openai, model);
    if (enriched.ai_rejected) {
      log(`AI判定で除外: ${enriched.title}（${enriched.ai_reject_reason}）`);
      continue;
    }
    const reEvaluated = scoreOpportunity(enriched, now);
    if (reEvaluated.excluded || !qualifiesForNotification(reEvaluated, minScore)) {
      log(`再採点で基準未達: ${enriched.title}（${reEvaluated.score}点）`);
      continue;
    }
    qualified.push({
      ...enriched,
      score: reEvaluated.score,
      rank: reEvaluated.rank,
      breakdown: reEvaluated.breakdown,
      remaining_days: reEvaluated.remaining_days
    });
  }

  // 5. 重複除外
  const fresh = selectNewOpportunities(qualified, state);
  const summary = {
    ran_at: now.toISOString(),
    harvested: harvested.size,
    inspected: scored.length,
    qualified: qualified.length,
    notified: 0,
    dry_run: dryRun
  };

  writeJsonFile(candidatesFile, {
    generated_at: now.toISOString(),
    min_score: minScore,
    candidates: qualified.map(item => ({
      title: item.title,
      organization: item.organization,
      url: item.url,
      deadline: item.deadline,
      rank: item.rank,
      score: item.score,
      summary: item.summary,
      fit_reasons: item.fit_reasons || [],
      use_cases: item.use_cases || [],
      action: item.action || null,
      caution: item.caution || null,
      breakdown: item.breakdown
    }))
  });

  if (fresh.length === 0) {
    log('通知対象の新規・更新案件はありません（投稿なし）');
    if (!dryRun) {
      saveState({ ...state, last_run_at: now.toISOString(), last_result: summary }, stateFile);
    }
    return summary;
  }

  const embeds = fresh.map(({ item, updated }) => buildOpportunityEmbed(item, { updated, now }));

  if (dryRun) {
    log(`dry-run: ${fresh.length}件を投稿対象として検出しました`);
    console.log(JSON.stringify(embeds, null, 2));
    return { ...summary, notified: fresh.length };
  }

  // 6. Discord投稿（Embedは1メッセージ10件まで）
  if (!client || !channelId) {
    throw new Error('DiscordクライアントまたはチャンネルIDが未設定です');
  }

  const channel = await client.channels.fetch(channelId);
  if (!channel || typeof channel.send !== 'function') {
    throw new Error(`投稿先チャンネルを取得できません: ${channelId}`);
  }

  for (let offset = 0; offset < embeds.length; offset += 10) {
    await channel.send({
      content: '📣 **高親和性の公募案件を検知しました**',
      embeds: embeds.slice(offset, offset + 10),
      allowedMentions: { parse: [] }
    });
  }

  // 7. 履歴更新（再確認した案件のチェック日時も記録）
  const notifiedAt = now.toISOString();
  const nextState = recordNotified(state, fresh, notifiedAt);
  const touchedIds = new Set(fresh.map(entry => entry.id));
  for (const item of scored) {
    try {
      const id = opportunityId(item);
      if (nextState.seen[id]) {
        nextState.seen[id].last_checked_at = notifiedAt;
        touchedIds.add(id);
      }
    } catch (error) {
      // URL不正は無視
    }
  }

  // 8. スプレッドシートへ記録（ここが重複判定の正）
  const records = buildRecords(nextState.seen, [...touchedIds]);
  const stored = gasUrl ? await pushRemoteHistory(gasUrl, records, storeOptions) : false;
  summary.notified = fresh.length;
  summary.stored_to_sheet = stored;
  nextState.last_result = summary;
  saveState(nextState, stateFile);

  if (gasUrl && !stored) {
    console.error(
      `${LOG_PREFIX} ⚠ スプレッドシートへ記録できませんでした。` +
        'ローカル履歴のみ更新済みです（state/public-opportunities.json）。GASのデプロイ状態を確認してください。'
    );
  }

  log(`投稿完了: ${fresh.length}件（収穫${summary.harvested}・精査${summary.inspected}）`);
  return summary;
}

/**
 * 公募モニターを1回実行する（HTTP取得の差し替えを安全に戻すラッパー）。
 */
async function runPublicOpportunityMonitor(options = {}) {
  const previousFetch = fetchText;
  if (options.fetchTextImpl) fetchText = options.fetchTextImpl;
  try {
    return await runMonitorOnce(options);
  } finally {
    fetchText = previousFetch;
  }
}

module.exports = {
  runPublicOpportunityMonitor,
  buildCompletionParams,
  DEFAULT_AI_MODEL,
  harvestLinks,
  looksLikeCall,
  shouldRecheck,
  extractBody,
  STATE_FILE,
  CANDIDATES_FILE,
  LIMITS
};
