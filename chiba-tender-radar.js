'use strict';

/**
 * 千葉県自治体案件レーダー（火・金 8:50 JST）
 *
 * 千葉県＋近隣6市の企画提案（プロポーザル）・公募を収集し、
 * 農情人との親和性を100点で採点してDiscordへ通知する。
 *
 * 既存の public-opportunity-monitor.js（省庁・全国／平日7:30）とは別モジュール。
 * 監視先・除外ロジック・採点軸・通知形式・履歴シートがすべて異なるため、
 * 既存を拡張せず並列に置いている。
 *
 * 要件定義: 03_output/2026-09-01_千葉県自治体案件レーダー_要件定義書_v1.md
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { buildJsonCompletionParams } = require('./openai-chat');

const {
  MIN_NOTIFY_SCORE,
  ALERT_SCORE,
  shouldHarvest,
  scoreTender,
  qualifiesForNotification,
  emptyState,
  selectNewTenders,
  recordNotified,
  recordLedgerOnly,
  pruneState,
  computeNextRunAt,
  reminderTargets,
  markReminded,
  extractDepartment,
  extractTenderDeadline,
  extractQuestionDeadline,
  buildTenderEmbed,
  buildDigestEmbed,
  buildReminderEmbed,
  buildHeartbeatLine
} = require('./chiba-tender-score');

const { canonicalUrl, opportunityId } = require('./public-opportunity');
const { activeSources } = require('./chiba-tender-sources');
const {
  fetchRemoteLedger,
  pushRemoteLedger,
  mergeLedgers,
  buildRecords
} = require('./chiba-tender-store');

// 既存モニターの履歴も読む。同じ千葉県案件が両方から通知されるのを防ぐため
// （既存 sources の chiba-pref は無効化済みだが、過去に通知した分が残っている）。
const { fetchRemoteHistory } = require('./public-opportunity-store');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const STATE_DIR = path.join(__dirname, 'state');
const STATE_FILE = path.join(STATE_DIR, 'chiba-tenders.json');
const CANDIDATES_FILE = path.join(STATE_DIR, 'chiba-tender-candidates.json');

const LIMITS = {
  // 印西市・八千代市は1ページに過去案件まで並ぶため上限に張り付きやすい。
  // 上限に当たった場合は警告を出す（新しい案件を取り逃がしている可能性がある）。
  linksPerSource: 40,
  detailFetches: 40,
  recheckPerRun: 6,
  recheckIntervalDays: 5,
  aiEnrichments: 8,
  requestDelayMs: 800,
  fetchTimeoutMs: 25000,
  fetchAttempts: 3,
  fetchRetryDelayMs: 750,
  collectBudgetMs: 6 * 60 * 1000
};

const LOG_PREFIX = '[Chiba Tender]';
const DEFAULT_AI_MODEL = process.env.PUBLIC_OPPORTUNITY_OPENAI_MODEL || 'gpt-5.6-luna';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function log(message) {
  console.log(`${LOG_PREFIX} ${message}`);
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(`${LOG_PREFIX} ${filePath} の読み込みに失敗: ${error.message}`);
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
  } catch (error) {
    console.error(`${LOG_PREFIX} ${filePath} の書き込みに失敗: ${error.message}`);
  }
}

function loadState(stateFile = STATE_FILE) {
  const state = readJsonFile(stateFile, emptyState());
  return { ...emptyState(), ...state, seen: state.seen || {} };
}

function saveState(state, stateFile = STATE_FILE) {
  writeJsonFile(stateFile, state);
}

// --- 収集 -----------------------------------------------------------------

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

let fetchText = defaultFetchText;

/** 一時的な通信障害だけを再試行する。URL不正などの4xxは即時失敗させる。 */
function isRetryableFetchError(error) {
  const status = Number(error?.response?.status || error?.status || 0);
  if (status) return status === 408 || status === 425 || status === 429 || status >= 500;

  const code = String(error?.code || '').toUpperCase();
  if (
    [
      'ECONNRESET',
      'ECONNABORTED',
      'ETIMEDOUT',
      'ESOCKETTIMEDOUT',
      'EAI_AGAIN',
      'ENETUNREACH',
      'EHOSTUNREACH',
      'EPIPE'
    ].includes(code)
  ) {
    return true;
  }

  return /socket hang up|timed?\s*out|connection reset/i.test(String(error?.message || ''));
}

/** 指数バックオフ付きHTTP取得。テストでは fetchImpl と delayMs を差し替えられる。 */
async function fetchTextWithRetry(url, options = {}) {
  const {
    fetchImpl = fetchText,
    attempts = LIMITS.fetchAttempts,
    delayMs = LIMITS.fetchRetryDelayMs,
    logRetry = true
  } = options;

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchImpl(url);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableFetchError(error)) throw error;

      const waitMs = delayMs * 2 ** (attempt - 1);
      if (logRetry) {
        log(
          `一時的な通信障害のため再試行します（${attempt + 1}/${attempts}、${waitMs}ms後）: ` +
            `${url} - ${error.message}`
        );
      }
      if (waitMs > 0) await sleep(waitMs);
    }
  }
  throw lastError;
}

/**
 * 一覧ページからリンクを収穫する。
 *
 * 既存モニターと違い linkFilter は使わない。千葉県の企画提案は所管課ごとに
 * パスがばらばら（/kankou/ /seisan/ /ryuhan/ …）でパスでは絞れないため、
 * リンクテキスト（＝案件名）だけで判定する。
 * ここで終了・種別・対象外を落とすので、詳細ページを無駄に開かない。
 */
function harvestLinks(html, source) {
  const $ = cheerio.load(html);
  const base = new URL(source.url);
  const found = new Map();
  const skipped = [];

  $('a[href]').each((_, element) => {
    if (found.size >= LIMITS.linksPerSource) return;

    const rawHref = String($(element).attr('href') || '').trim();
    const text = $(element).text().replace(/\s+/g, ' ').trim();
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) return;
    if (!shouldHarvest(text)) {
      if (text.length >= 8) skipped.push(text);
      return;
    }

    let absolute;
    try {
      absolute = new URL(rawHref, base);
    } catch (error) {
      return;
    }
    if (!/^https?:$/.test(absolute.protocol)) return;
    if (absolute.hostname !== base.hostname) return;

    const isDocument = /\.(pdf|xlsx?|docx?|zip|csv)$/i.test(absolute.pathname);
    found.set(canonicalUrl(absolute.toString()), {
      url: absolute.toString(),
      title: text,
      organization: source.organization,
      source_id: source.id,
      type: /プロポーザル/.test(text) ? 'プロポーザル' : '公募',
      is_document: isDocument
    });
  });

  return { links: [...found.values()], skipped };
}

/** 親ページから、案件一覧を載せる子ページのURLを同一ホスト内で見つける。 */
function discoverListingUrls(html, source, pageUrl = source.url) {
  if (!source.listingLinkPattern) return [];

  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const found = new Set();

  $('a[href]').each((_, element) => {
    const rawHref = String($(element).attr('href') || '').trim();
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) return;

    try {
      const absolute = new URL(rawHref, base);
      if (!/^https?:$/.test(absolute.protocol) || absolute.hostname !== base.hostname) return;
      source.listingLinkPattern.lastIndex = 0;
      if (source.listingLinkPattern.test(absolute.pathname)) {
        found.add(canonicalUrl(absolute.toString()));
      }
    } catch (error) {
      /* 不正なリンクは無視 */
    }
  });

  return [...found];
}

async function collectFromSource(source) {
  try {
    const html = await fetchTextWithRetry(source.url);
    if (!html) {
      log(`${source.organization}（${source.label}）から本文を取得できませんでした`);
      return [];
    }

    const found = new Map();
    harvestLinks(html, source).links.forEach(link => found.set(canonicalUrl(link.url), link));

    const listingUrls = discoverListingUrls(html, source);
    for (const listingUrl of listingUrls) {
      try {
        const listingHtml = await fetchTextWithRetry(listingUrl);
        harvestLinks(listingHtml, { ...source, url: listingUrl }).links.forEach(link =>
          found.set(canonicalUrl(link.url), link)
        );
      } catch (error) {
        console.error(
          `${LOG_PREFIX} ${source.organization}（${source.label}）の子ページ取得に失敗: ` +
            `${listingUrl} - ${error.message}`
        );
      }
    }

    const links = [...found.values()].slice(0, LIMITS.linksPerSource);
    log(`${source.organization}（${source.label}）候補 ${links.length}件`);
    if (links.length >= LIMITS.linksPerSource) {
      log(
        `⚠ ${source.organization}（${source.label}）は収穫上限${LIMITS.linksPerSource}件に達しました。` +
          '新しい案件を取り逃がしている可能性があります（linksPerSource の引き上げを検討）'
      );
    }
    return links;
  } catch (error) {
    console.error(
      `${LOG_PREFIX} ${source.organization}（${source.label}）の取得に失敗: ${error.message}`
    );
    return [];
  }
}

function extractBody(html) {
  const $ = cheerio.load(html);
  $('script, style, nav, header, footer, .breadcrumb, .pankuzu, .sitemap, .globalnav, aside').remove();

  const selectors = [
    'main',
    '#main',
    '#tmp_contents',
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
    // PDF直リンクは本文を読めない。フェーズ1では本文まで取りに行かず、
    // リンクテキストだけで評価して「要確認」を立てる。
    return { ...candidate, body: candidate.title, deadline: null, needs_manual_check: true };
  }

  const html = await fetchTextWithRetry(candidate.url);
  const body = extractBody(html);
  const rawTitle = pageTitle(html, candidate.title);
  const deadline = extractTenderDeadline(body);
  const questionDeadline = extractQuestionDeadline(body);

  // 一覧のリンクテキストのほうが案件名として正確なことが多い
  // （詳細ページの<title>は「◯◯市公式ホームページ」等が付く）。
  const title = candidate.title && candidate.title.length >= 10 ? candidate.title : rawTitle;

  const detail = {
    ...candidate,
    title,
    body,
    summary: body.slice(0, 400),
    deadline: deadline ? deadline.toISOString() : null,
    question_deadline: questionDeadline ? questionDeadline.toISOString() : null,
    needs_manual_check: !deadline
  };

  detail.department = extractDepartment(detail);
  return detail;
}

// --- OpenAIによる整形（通知候補のみ） -------------------------------------

const AI_SYSTEM_PROMPT = `あなたは株式会社農情人（農業×生成AI・web3の事業会社／Metagri研究所を運営／千葉県船橋市）の公共調達担当者です。
自治体の企画提案（プロポーザル）ページの本文から、応募判断に必要な事実だけを抽出します。
本文に書かれていない事実は決して創作せず、不明な項目はnullまたは「要確認」と書きます。`;

function buildAiPrompt(item) {
  return `# 案件ページ情報
【案件名】${item.title}
【発注者】${item.organization}${item.department ? ` ${item.department}` : ''}
【URL】${item.url}
【抽出済み締切】${item.deadline || '不明'}
【抽出済み上限額】${item.budget_upper === null || item.budget_upper === undefined ? '不明' : `${item.budget_upper}円`}
【本文抜粋】
${String(item.body || '').slice(0, 6000)}

# 農情人の実績（接続理由に使えるもの）
- 白井市PR動画AIコンテスト（全31作品・28クリエイター・毎日新聞→Yahoo!転載・GPは市公式PR動画に採用）
- 農家支援コミュニティ「Metagri研究所」運営（Discord 1,300人超・2022年3月〜）
- 農業AI通信（農家向けAI活用メディア）、note 1,200本超、Kindle著書8冊、商業出版2冊
- 農業AI実態調査（2回・プレスリリース配信）、農家取材、酪農DXサミット、農業AIハッカソン
- 自治体・農林水産省・大学・金融機関・農業関連企業との連携・登壇実績（100回超）
- React/Next.js開発、NFT発行・ガスレス交換、Roblox等のweb3・メタバース実装
- 動画・セミナー・調査レポート・コミュニティ運営という「完成した成果物」を保有

# 重要な制約
- 農情人は「ちば電子調達システムの入札参加資格者名簿（物品・委託）」に登載していない。
  名簿登載が参加要件に含まれる場合は、cautionに必ずその旨を書く。

# 出力（JSONのみ。前後に説明文を書かない）
{
  "relevant": true または false（公募告知でない／締切済み／農情人が担えない業務ならfalse）,
  "irrelevant_reason": relevantがfalseのときのみ理由を1文。それ以外はnull,
  "title": "案件の正式名称（本文から）",
  "deadline": "YYYY-MM-DDTHH:MM:SS+09:00 形式。参加表明ではなく提案書の締切を優先。不明ならnull",
  "budget_upper": 上限額を円の数値で。不明ならnull,
  "summary": "何を発注する業務かを事実だけで2文",
  "eligibility": "参加資格の記載をそのまま短く。不明なら要確認",
  "fit_reasons": ["農情人の既存実績と仕様の具体的な接続を2〜3件。実績名を必ず入れる"],
  "action": "次に取る具体的な行動を1文（日付を含める）",
  "caution": "参加資格・体制・自己負担の注意点を1文"
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

/** GPT-5系はtemperature非対応・max_completion_tokens＋reasoning_effort */
function buildCompletionParams(model, messages) {
  return buildJsonCompletionParams({
    model,
    messages,
    maxTokens: /^(gpt-5|gpt-6|o[1-9])/i.test(String(model)) ? 4000 : 1200,
    temperature: 0.2
  });
}

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
      parsed.eligibility ? `参加資格: ${parsed.eligibility}` : null,
      item.needs_manual_check ? '締切を募集要項で要確認' : null
    ].filter(Boolean);

    return {
      ...item,
      ai_enriched: true,
      title: parsed.title || item.title,
      deadline: parsed.deadline || item.deadline,
      budget_upper:
        parsed.budget_upper === null || parsed.budget_upper === undefined
          ? item.budget_upper
          : Number(parsed.budget_upper),
      summary: parsed.summary || item.summary,
      fit_reasons: Array.isArray(parsed.fit_reasons) ? parsed.fit_reasons : [],
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

  const deadline = entry.deadline ? new Date(entry.deadline).getTime() : null;
  if (deadline === null || Number.isNaN(deadline)) return true;
  return deadline >= new Date(now).getTime(); // 締切切れは再確認しない
}

// --- 本体 -----------------------------------------------------------------

/**
 * レーダーを1回実行する。
 *
 * @param {object} options
 * @param {import('discord.js').Client} [options.client]
 * @param {string} [options.channelId]
 * @param {object} [options.openai]
 * @param {string} [options.model]
 * @param {boolean} [options.dryRun] trueならDiscord投稿と履歴更新を行わない
 * @param {number} [options.minScore] 通知の下限点（既定60）
 * @param {number} [options.alertScore] 個別Embedにする下限点（既定80）
 * @param {number} [options.maxPriority] 監視先の優先度上限
 * @param {function} [options.fetchTextImpl] HTTP取得の差し替え（テスト用）
 * @param {Array} [options.sources] 監視先の差し替え（テスト用）
 * @returns {Promise<object>} 実行サマリ
 */
async function runRadarOnce(options = {}) {
  const {
    client = null,
    channelId = null,
    openai = null,
    model = DEFAULT_AI_MODEL,
    dryRun = false,
    minScore = MIN_NOTIFY_SCORE,
    alertScore = ALERT_SCORE,
    maxPriority = 2,
    sources: sourceOverride = null,
    stateFile = STATE_FILE,
    candidatesFile = CANDIDATES_FILE,
    requestDelayMs = LIMITS.requestDelayMs,
    gasUrl = process.env.GOOGLE_APPS_SCRIPT_URL || null,
    storePostImpl = null,
    now: nowOverride = null
  } = options;

  const now = nowOverride ? new Date(nowOverride) : new Date();
  const localState = pruneState(loadState(stateFile), now);
  const localCount = Object.keys(localState.seen).length;

  const storeOptions = storePostImpl ? { postImpl: storePostImpl } : {};
  const remote = await fetchRemoteLedger(gasUrl, storeOptions);

  // シートもローカルも読めない＝過去に何を通知したか分からない状態。
  // ここで投稿すると過去案件を再通知するため、投稿せず中断する。
  if (remote.status === 'unavailable' && localCount === 0) {
    throw new Error(
      '案件台帳を取得できませんでした（スプレッドシートへの通信失敗・ローカル履歴も空）。' +
        '過去案件の再通知を避けるため今回の投稿を中止します。GASのURLと疎通を確認してください。'
    );
  }

  const state =
    remote.status === 'ok' ? pruneState(mergeLedgers(localState, remote), now) : localState;

  if (remote.status === 'ok') {
    log(
      `台帳を統合しました（ローカル${localCount}件 + シート${Object.keys(remote.seen).length}件 → ${Object.keys(state.seen).length}件）`
    );
  } else if (remote.status === 'not_deployed') {
    log(
      `⚠ GASが Chiba_Tenders に未対応のため、ローカル台帳${localCount}件のみで重複判定します（Apps Scriptの再デプロイが必要）`
    );
  } else if (remote.status === 'unavailable') {
    log(`⚠ シート台帳が取得できないため、ローカル台帳${localCount}件のみで重複判定します`);
  }

  // 既存モニター（Public_Opportunities）で通知済みのIDは通知しない。
  // 読み取りだけで、こちらから書き込むことはしない。
  let crossKnownIds = new Set();
  try {
    const crossHistory = await fetchRemoteHistory(gasUrl, storeOptions);
    if (crossHistory.status === 'ok') {
      crossKnownIds = new Set(Object.keys(crossHistory.seen));
      log(`既存公募モニターの履歴 ${crossKnownIds.size}件を二重通知の防止に使います`);
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} 既存モニター履歴の参照に失敗（続行）: ${error.message}`);
  }

  const sources = sourceOverride || activeSources(maxPriority);
  log(`監視先 ${sources.length}件の収集を開始します（dryRun=${dryRun}）`);

  // 1. 候補リンクの収穫（タイトル除外はここで済んでいる）
  const harvested = new Map();
  for (const source of sources) {
    const links = await collectFromSource(source);
    links.forEach(link => {
      const key = canonicalUrl(link.url);
      if (!harvested.has(key)) harvested.set(key, link);
    });
    await sleep(requestDelayMs);
  }

  // 2. 未取得と再確認の選別
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
  log(
    `収穫 ${harvested.size}件 / 詳細取得 ${targets.length}件（新規${unseen.length}・再確認${recheck.length}）`
  );

  // 3. 詳細取得と採点
  const scored = [];
  const collectDeadline = now.getTime() + LIMITS.collectBudgetMs;
  let inspected = 0;
  for (const candidate of targets) {
    if (Date.now() > collectDeadline) {
      log(`⏱ 収集の時間予算を超えたため、残り${targets.length - inspected}件は次回に回します`);
      break;
    }
    inspected += 1;
    try {
      const detail = await fetchDetail(candidate);
      const evaluation = scoreTender(detail, now);
      scored.push({ ...detail, ...evaluation });
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
    const reEvaluated = scoreTender(enriched, now);
    if (reEvaluated.excluded || !qualifiesForNotification(reEvaluated, minScore)) {
      log(`再採点で基準未達: ${enriched.title}（${reEvaluated.score}点）`);
      continue;
    }
    qualified.push({ ...enriched, ...reEvaluated });
  }

  // 5. 重複除外（既存モニターで通知済みのIDも落とす）
  const fresh = selectNewTenders(qualified, state).filter(entry => {
    if (!crossKnownIds.has(entry.id)) return true;
    log(`既存公募モニターで通知済みのためスキップ: ${entry.item.title}`);
    return false;
  });

  const alerts = fresh.filter(({ item }) => item.score >= alertScore);
  const digest = fresh.filter(({ item }) => item.score < alertScore);

  // 6. 締切リマインド（次回実行までに線を跨ぐ案件）
  const nextRunAt = computeNextRunAt(now);
  const reminders = reminderTargets(state, { now, nextRunAt });

  const summary = {
    ran_at: now.toISOString(),
    next_run_at: nextRunAt.toISOString(),
    sources: sources.length,
    harvested: harvested.size,
    inspected: scored.length,
    qualified: qualified.length,
    alerts: alerts.length,
    digest: digest.length,
    reminders: reminders.length,
    notified: fresh.length,
    dry_run: dryRun
  };

  writeJsonFile(candidatesFile, {
    generated_at: now.toISOString(),
    min_score: minScore,
    alert_score: alertScore,
    candidates: qualified.map(item => ({
      title: item.title,
      organization: item.organization,
      department: item.department || null,
      url: item.url,
      deadline: item.deadline,
      rank: item.rank,
      score: item.score,
      budget_upper: item.budget_upper,
      multi_year: item.multi_year,
      gate_warnings: item.gate_warnings || [],
      summary: item.summary,
      fit_reasons: item.fit_reasons || [],
      action: item.action || null,
      caution: item.caution || null,
      breakdown: item.breakdown
    })),
    excluded: scored
      .filter(item => item.excluded)
      .map(item => ({ title: item.title, url: item.url, reason: item.exclusion_reason }))
  });

  // 7. Embedの組み立て
  const embeds = [];
  alerts.forEach(({ item, updated }) => embeds.push(buildTenderEmbed(item, { updated, now })));
  if (digest.length > 0) embeds.push(buildDigestEmbed(digest, { now }));
  if (reminders.length > 0) embeds.push(buildReminderEmbed(reminders, { now }));

  const heartbeat = embeds.length === 0 ? buildHeartbeatLine(summary, now) : null;

  if (dryRun) {
    log(
      `dry-run: 個別${alerts.length}件・ダイジェスト${digest.length}件・リマインド${reminders.length}件`
    );
    if (heartbeat) console.log(heartbeat);
    console.log(JSON.stringify(embeds, null, 2));
    return summary;
  }

  if (!client || !channelId) {
    throw new Error('DiscordクライアントまたはチャンネルIDが未設定です');
  }

  const channel = await client.channels.fetch(channelId);
  if (!channel || typeof channel.send !== 'function') {
    throw new Error(`投稿先チャンネルを取得できません: ${channelId}`);
  }

  // 8. Discord投稿
  if (heartbeat) {
    // 週2回運用では「沈黙＝故障」と区別できないため、0件でも1行だけ出す
    await channel.send({ content: heartbeat, allowedMentions: { parse: [] } });
  } else {
    for (let offset = 0; offset < embeds.length; offset += 10) {
      await channel.send({
        content:
          offset === 0 ? '🏙️ **千葉県の自治体案件（企画提案・公募）を検知しました**' : undefined,
        embeds: embeds.slice(offset, offset + 10),
        allowedMentions: { parse: [] }
      });
    }
  }

  // 9. 台帳の更新
  const stamp = now.toISOString();
  let nextState = recordNotified(state, fresh, stamp);
  // 通知しなかった案件（59点以下・対象外）も台帳には残す。
  // フェーズ2の更新予測は、落とした案件の履歴があってはじめて成立する。
  const notifiedIds = new Set(fresh.map(entry => entry.id));
  const ledgerOnly = scored.filter(item => {
    try {
      return !notifiedIds.has(opportunityId(item));
    } catch (error) {
      return false;
    }
  });
  nextState = recordLedgerOnly(nextState, ledgerOnly, stamp);
  nextState = markReminded(nextState, reminders);

  const touchedIds = new Set(fresh.map(entry => entry.id));
  ledgerOnly.forEach(item => {
    try {
      touchedIds.add(opportunityId(item));
    } catch (error) {
      /* URL不正は無視 */
    }
  });
  reminders.forEach(({ id }) => touchedIds.add(id));

  // 10. スプレッドシートへ記録（ここが重複判定の正）
  const records = buildRecords(nextState.seen, [...touchedIds]);
  const stored = gasUrl ? await pushRemoteLedger(gasUrl, records, storeOptions) : false;
  summary.stored_to_sheet = stored;
  nextState.last_result = summary;
  saveState(nextState, stateFile);

  if (gasUrl && !stored && records.length > 0) {
    console.error(
      `${LOG_PREFIX} ⚠ スプレッドシートへ記録できませんでした。` +
        'ローカル台帳のみ更新済みです（state/chiba-tenders.json）。GASのデプロイ状態を確認してください。'
    );
  }

  log(
    `投稿完了: 個別${alerts.length}・ダイジェスト${digest.length}・リマインド${reminders.length}（収穫${summary.harvested}・精査${summary.inspected}）`
  );
  return summary;
}

/** HTTP取得の差し替えを安全に戻すラッパー */
async function runChibaTenderRadar(options = {}) {
  const previousFetch = fetchText;
  if (options.fetchTextImpl) fetchText = options.fetchTextImpl;
  try {
    return await runRadarOnce(options);
  } finally {
    fetchText = previousFetch;
  }
}

module.exports = {
  runChibaTenderRadar,
  buildCompletionParams,
  DEFAULT_AI_MODEL,
  harvestLinks,
  discoverListingUrls,
  fetchTextWithRetry,
  isRetryableFetchError,
  extractBody,
  shouldRecheck,
  STATE_FILE,
  CANDIDATES_FILE,
  LIMITS
};
