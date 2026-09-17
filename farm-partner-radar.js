'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const axios = require('axios');
const cheerio = require('cheerio');

const STATE_FILE = path.join(__dirname, 'state', 'farm-partner-radar.json');
const SKILL_API = 'https://www.skill-shift.com/api/v1/jobs';
const FURUSATO_LIST = 'https://www.furusatokengyo.jp/project/case/search/typeA2';
const YOSOMON_LIST = 'https://yosomon.etic.or.jp/projects';
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
const pause = () => new Promise(resolve => setTimeout(resolve, 250));

async function get(url, params) {
  return (await axios.get(url, { params, timeout: 20000, signal: AbortSignal.timeout(25000),
    maxContentLength: 5 * 1024 * 1024, headers: { 'User-Agent': 'Metagri-FarmPartnerRadar/1.0' } })).data;
}

function normalizeSkill(j) {
  if (!j || !Number.isInteger(j.job_id) || !j.position) throw new Error('Skill Shift detail schema changed');
  const status = j.is_applicable === true && j.expire === false && j.disabled === false && j.suspended === false
    ? 'open' : j.is_applicable === false || j.expire === true || j.disabled === true || j.suspended === true ? 'closed' : 'unknown';
  const body = clean(j.business_content);
  // 4 is the site's sentinel for "詳細は本文に記載", not four yen.
  const pay = Number(j.salary) >= 1000 ? `${Number(j.salary).toLocaleString('ja-JP')}円/月（税区分は原文）`
    : '本文記載・要確認';
  return { id: `skill:${j.job_id}`, source: 'Skill Shift', url: `https://www.skill-shift.com/jobs/${j.job_id}`,
    title: clean(j.position), company: clean(j.company_name), location: clean(j.location),
    industry: clean(j.industries), body, conditions: clean(j.applicant_condition),
    style: clean(j.side_job_style), pay, applicants: j.applicant_quantity ?? null,
    publishedAt: j.created_at, deadline: null, status };
}

function parseFurusato(html, url, fallbackTitle, now = new Date()) {
  const $ = cheerio.load(html);
  $('script,style,nav,header,footer,noscript').remove();
  const rows = {};
  $('tr').each((i, e) => { const key = clean($(e).find('th').text()); if (key) rows[key] = clean($(e).find('td').text()); });
  if (!rows['プロジェクトについて'] || !rows['企業・団体名']) throw new Error('Furusato detail schema changed');
  const deadline = rows['募集終了日']?.match(/\d{4}-\d{2}-\d{2}/)?.[0] || null;
  const title = clean(fallbackTitle || $('h1').text());
  const expired = deadline && Date.parse(`${deadline}T23:59:59+09:00`) < now.getTime();
  const closed = /募集(?:を)?終了|受付終了/.test(title) || expired;
  const apply = $('a,button').toArray().some(e => /応募する|エントリーする/.test($(e).text()) && !$(e).attr('disabled'));
  return { id: `furusato:${new URL(url).pathname.split('/').pop()}`, source: 'ふるさと兼業', url, title,
    company: rows['企業・団体名'], location: rows['都道府県'] || '', industry: rows['テーマ別カテゴリ'] || '',
    body: rows['プロジェクトについて'], conditions: rows['求める人材'] || rows['求める人材像'] || '',
    style: rows['活動条件'] || '', pay: rows['報酬／待遇'] || '要確認', deadline, applicants: null,
    status: closed ? 'closed' : deadline && apply ? 'open' : 'unknown' };
}

function parseYosomon(html, url) {
  const $ = cheerio.load(html);
  const title = clean($('.project-head__title').first().text());
  const company = clean($('.project-head__org').first().text());
  const statusText = clean($('.project-head .cat-list').first().text());
  if (!title || !company || !/募集(?:中|終了)/.test(statusText) || !$('table.project-table').length) {
    throw new Error('YOSOMON detail schema changed');
  }
  const rows = {};
  $('table.project-table tr').each((i, e) => {
    const key = clean($(e).find('th').first().text());
    if (key) rows[key] = clean($(e).find('td').first().text());
  });
  const entry = $('a[href$="/entry/new"]').length > 0;
  const status = /募集終了/.test(statusText) ? 'closed'
    : /マッチングイベント|説明会/.test(title) ? 'unknown'
      : /募集中/.test(statusText) && entry ? 'open' : 'unknown';
  const body = clean($('.project-body__copy, .project-body__description').map((i, e) => $(e).text()).get().join(' '));
  return { id: `yosomon:${new URL(url).pathname.split('/').pop()}`, source: 'YOSOMON!', url,
    title, company, location: clean($('.project-head .cat-list__item').first().text()).replace(/募集(?:中|終了)/g, '').trim(),
    industry: rows['事業のテーマ'] || '', body, conditions: rows['募集する人材像、スキル'] || '',
    style: rows['勤務スタイル'] || '', pay: rows['謝礼'] || rows['謝礼の詳細'] || '要確認',
    deadline: null, applicants: null, status };
}

function scoreJob(j) {
  const t = [j.title, j.company, j.industry, j.body].join(' ');
  const direct = /農園|農場|養鶏|農業・林業|水産・農林業/.test(j.company + j.industry)
    || /自社農園|自社農場|農家です|梅農家|果樹園を運営/.test(j.body);
  const food = direct || /食品|食肉|製菓|和菓子|お茶|茶葉|ホルモン|醤油|米飯|農産|農林水産|農・食|食・ライフスタイル/.test(j.title + j.company + j.industry);
  const task = j.title + ' ' + j.conditions;
  const ai = /生成AI|ChatGPT|AI活用|AIツール|自動化|DX|データ抽出/i.test(task);
  const digital = /EC|SNS|Web|ウェブ|マーケティング|販促|リーフレット|ブランディング|ブランド|PR戦略/i.test(task);
  const remote = /リモート|オンライン/.test(j.style);
  const specialist = /AutoCAD|Shopify|輸出|輸入|海外販路|賞味期限延長|食品検査|食品衛生|空間.*デザイン/.test(task);
  const sales = /受注まで|法人営業経験|営業経験|クロージング/.test(j.conditions);
  const design = /リーフレット制作を行った|パッケージデザインの実務/.test(j.conditions);
  const relevant = food && (ai || digital || /販路|営業|新規事業/.test(task));
  const axes = { farmerConnection: direct ? 30 : food ? 12 : 0,
    skillFit: ai ? 30 : digital ? 25 : /販路|営業/.test(t) ? 16 : 8,
    editorialPotential: ai ? 20 : digital && direct ? 17 : digital ? 13 : 8,
    feasibility: specialist ? 0 : sales ? 5 : design ? 8 : 10,
    continuity: remote ? 10 : 5 };
  const rawScore = Object.values(axes).reduce((a, b) => a + b, 0);
  const score = relevant ? Math.min(rawScore, specialist ? 59 : sales ? 64 : 100) : 0;
  const checks = [];
  if (specialist) checks.push('CAD・Shopify・輸出入・食品技術等の専門実績を要確認（通知対象外）');
  if (sales) checks.push('法人営業／受注までの実務経験を要確認');
  if (design) checks.push('印刷物・デザインの制作実績と入稿範囲を要確認');
  if (/個人名義|個人.*契約|法人名義.*不可/.test(j.conditions)) checks.push('個人契約条件あり');
  checks.push('工数上限・成果物・記事化の許諾を面談で確認');
  return { ...j, score, axes, relevant, checks,
    farmerConnection: direct ? '生産者との直接接点が期待できる' : '食品事業者経由。農家紹介の可否を確認',
    editorialAngle: ai ? 'AI導入前後の作業時間と、担当者が自走するまでの工夫'
      : digital ? '農産物の魅力をAIで言語化し、販促・EC導線を改善する実証（提案）'
        : 'AIを使った販売先調査・提案資料づくりの実証（提案）' };
}

// Applicant counts and crawl time deliberately do not cause notifications.
function fingerprint(j) {
  return hash([j.title, j.company, j.body, j.conditions, j.style, j.pay, j.deadline, j.status]);
}

async function collectJobs({ fetchJson = get, now = new Date(), skillPages = 4, furusatoPages = 3, yosomonPages = 3 } = {}) {
  const jobs = [], errors = [], candidates = new Map();
  const stats = { skillListed: 0, furusatoListed: 0, yosomonListed: 0,
    skillDetails: 0, furusatoDetails: 0, yosomonDetails: 0 };
  for (let page = 1; page <= skillPages; page++) {
    try {
      const data = await fetchJson(SKILL_API, { sort: 'new_arrival', per_page: 100, page });
      if (!Array.isArray(data.jobs) || !data.meta?.pagination) throw new Error('list schema changed');
      stats.skillListed += data.jobs.length;
      for (const raw of data.jobs) {
        const j = normalizeSkill(raw);
        if (j.status === 'open' && scoreJob(j).relevant) candidates.set(raw.job_id, j);
      }
      if (page >= data.meta.pagination.total_pages) break;
    } catch (e) { errors.push(`Skill Shift list page ${page}: ${e.message}`); break; }
    await pause();
  }
  for (const [id] of [...candidates].slice(0, 40)) {
    try { jobs.push(normalizeSkill((await fetchJson(`${SKILL_API}/${id}`)).job)); stats.skillDetails++; }
    catch (e) { errors.push(`Skill Shift detail ${id}: ${e.message}`); }
    await pause();
  }
  const links = new Map();
  for (let page = 1; page <= furusatoPages; page++) {
    try {
      const html = await fetchJson(FURUSATO_LIST, { page });
      const $ = cheerio.load(html);
      const entries = $('a[href*="/project/case/info/"]');
      if (!entries.length) throw new Error('No project links; source may have changed');
      stats.furusatoListed += entries.length;
      entries.each((i, e) => {
        const text = clean($(e).text());
        const title = clean($(e).find('h1,h2,h3,h4,.title').first().text()) || text.slice(0, 180);
        const url = new URL($(e).attr('href'), FURUSATO_LIST);
        if (url.origin !== new URL(FURUSATO_LIST).origin) return;
        if (!/募集(?:を)?終了|受付終了/.test(text) && /農|食品|食文化|茶葉|畜産/.test(text)) links.set(url.href, title);
      });
    } catch (e) { errors.push(`Furusato list page ${page}: ${e.message}`); break; }
    await pause();
  }
  for (const [url, title] of [...links].slice(0, 20)) {
    try { jobs.push(parseFurusato(await fetchJson(url), url, title, now)); stats.furusatoDetails++; }
    catch (e) { errors.push(`Furusato detail: ${e.message}`); }
    await pause();
  }
  const yosomonLinks = new Set();
  for (let page = 1; page <= yosomonPages; page++) {
    try {
      const html = await fetchJson(YOSOMON_LIST, { 'q[only_recruiting]': 'true', page });
      const $ = cheerio.load(html);
      const cards = $('.project-card a[href^="/projects/"]').filter((i, e) => !$(e).closest('.prj-btn-list').length);
      if (!cards.length && page === 1) throw new Error('No project cards; source may have changed');
      stats.yosomonListed += cards.length;
      cards.each((i, e) => {
        const url = new URL($(e).attr('href'), YOSOMON_LIST);
        if (url.origin === new URL(YOSOMON_LIST).origin && /^\/projects\/\d+$/.test(url.pathname)) yosomonLinks.add(url.href);
      });
      if (!cards.length || !$('a[href*="page="]').length) break;
    } catch (e) { errors.push(`YOSOMON list page ${page}: ${e.message}`); break; }
    await pause();
  }
  for (const url of [...yosomonLinks].slice(0, 30)) {
    try { jobs.push(parseYosomon(await fetchJson(url), url)); stats.yosomonDetails++; }
    catch (e) { errors.push(`YOSOMON detail ${url}: ${e.message}`); }
    await pause();
  }
  return { checkedAt: now.toISOString(), stats, errors, jobs: jobs.map(scoreJob).sort((a, b) => b.score - a.score) };
}

function readState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (s.version !== 1 || !s.notified || typeof s.notified !== 'object' || Array.isArray(s.notified)) throw new Error('invalid schema');
    return s;
  } catch (e) {
    if (e.code === 'ENOENT') return { version: 1, notified: {} };
    throw new Error(`Farm partner history unreadable; refusing duplicate delivery: ${e.message}`);
  }
}
function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2));
  fs.renameSync(temp, file);
}
function buildMessage(j, updated = false) {
  const fp = fingerprint(j);
  return { allowedMentions: { parse: [] }, nonce: hash([j.id, fp]), enforceNonce: true,
    embeds: [{ title: `${updated ? '更新' : '新規'}｜農家・食品パートナー ${j.score}点｜${j.title}`.slice(0, 256),
      url: j.url, color: 0x3b8b51,
      description: `${j.company}／${j.location}\n募集受付可を詳細で確認（通知時点）\n${j.body.slice(0, 450)}`,
      fields: [
        { name: '報酬・働き方', value: `${j.pay}\n${j.style || '要確認'}`.slice(0, 1000) },
        { name: '農家との接点', value: j.farmerConnection },
        { name: '農業AI通信の切り口（こちらからの提案）', value: `${j.editorialAngle}\n公開は先方の許諾・原稿確認後。掲載可否は未確認。` },
        { name: '応募前の確認', value: j.checks.join('\n').slice(0, 1000) },
        { name: '期限・応募人数', value: `${j.deadline || '明示なし・掲載先で確認'}／${j.applicants ?? '不明'}名` }
      ], footer: { text: `farm-partner:${j.id}:${fp} | 自動仮評価・要件適合は本人確認` } }] };
}

const activeFiles = new Set();
async function runRadar({ send, recover = async () => [], collect = collectJobs, file = STATE_FILE,
  dryRun = false, minScore = 65, maxPosts = 5, now = new Date() } = {}) {
  if (activeFiles.has(file)) return { skipped: 'already-running' };
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 100 || !Number.isInteger(maxPosts) || maxPosts < 1) throw new Error('Invalid radar limits');
  activeFiles.add(file);
  try {
    const state = readState(file);
    const result = await collect({ now });
    if (dryRun) return { ...result, eligible: result.jobs.filter(j => j.status === 'open' && j.score >= minScore) };
    if (typeof send !== 'function') throw new Error('Discord sender required');
    // Recover recent sent fingerprints if a process died between Discord acknowledgement and disk write.
    const recovered = await recover();
    for (const footer of recovered) {
      const m = /^farm-partner:((?:skill|furusato|yosomon):[^:]+):([a-f0-9]{24})/.exec(footer);
      if (m && !state.notified[m[1]]) state.notified[m[1]] = { fingerprint: m[2], recovered: true };
    }
    let sent = 0;
    const delivered = new Set(recovered);
    for (const j of result.jobs) {
      if (sent >= maxPosts) break;
      if (j.status !== 'open' || j.score < minScore) continue;
      const fp = fingerprint(j), previous = state.notified[j.id];
      const message = buildMessage(j, !!previous);
      if (previous?.fingerprint === fp) continue;
      if (!delivered.has(message.embeds[0].footer.text)) {
        await send(message);
        sent++;
      }
      state.notified[j.id] = { fingerprint: fp, notifiedAt: now.toISOString(), url: j.url };
      saveState(file, state);
    }
    state.lastRun = { checkedAt: result.checkedAt, stats: result.stats, errors: result.errors, sent };
    saveState(file, state);
    return { ...result, sent };
  } finally { activeFiles.delete(file); }
}

module.exports = { normalizeSkill, parseFurusato, parseYosomon, scoreJob, fingerprint, collectJobs, readState, saveState, buildMessage, runRadar, STATE_FILE };
