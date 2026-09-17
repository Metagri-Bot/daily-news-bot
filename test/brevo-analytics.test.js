const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const autoMail = fs.readFileSync('auto-mail.gs', 'utf8');
const code = (autoMail.includes('function brevoConfig_') ? autoMail : autoMail + '\n' + fs.readFileSync('BrevoMail.gs', 'utf8'))
  + '\n' + fs.readFileSync('BrevoAnalytics.gs', 'utf8');

const CAMPAIGN = (id, sentDate, stats, subject) => ({
  id, sentDate, subject: subject || ('件名' + id), type: 'classic', status: 'sent',
  statistics: stats ? {globalStats: stats} : undefined
});

function harness(options = {}) {
  const defaultArchive = [['送信日時', '件名', '記事URL', '配信数', '本文', 'X', 'BrevoキャンペーンID'],
    ...(options.campaigns || []).map(c => [new Date(c.sentDate), c.subject, 'https://example.com/' + c.id, 0, '', '', c.id])];
  const data = {
    原稿作成: [['article', 'Subject'], ['https://metagri-labo.com/ai-guide/new/', '<p>Original</p>'], ['', ''], ['', 'X']],
    設定: [[''], ['', '農業AI通信']],
    配信リスト: [['メール'], ['one@example.com'], ['TWO@example.com'], [' two@example.com '], ['']],
    アーカイブ: defaultArchive,
    ...(options.data || {})
  };
  const props = {BREVO_API_KEY: 'test-key', BREVO_ENABLED: 'true', BREVO_FOLDER_ID: '2', ...(options.props || {})};
  const requests = [], triggers = [];
  const sheets = {};
  function sheet(name) {
    if (sheets[name]) return sheets[name];
    const rows = data[name];
    return sheets[name] = {
      getLastRow: () => rows.length,
      getLastColumn: () => Math.max(0, ...rows.map(r => r.length)),
      appendRow: row => rows.push([...row]),
      setFrozenRows() {},
      getRange(r, c, nr = 1, nc = 1) {
        if (typeof r === 'string') { const m = r.match(/^([A-Z])(\d+)$/); c = m[1].charCodeAt(0) - 64; r = +m[2]; }
        const range = {
          getValues: () => Array.from({length: nr}, (_, i) => Array.from({length: nc}, (_, j) => rows[r + i - 1]?.[c + j - 1] ?? '')),
          getValue: () => rows[r - 1]?.[c - 1] ?? '',
          setValues(values) { values.forEach((row, i) => { rows[r + i - 1] ||= []; row.forEach((v, j) => rows[r + i - 1][c + j - 1] = v); }); return range; },
          setValue(v) { return range.setValues([[v]]); },
          clearContent() { for (let i = 0; i < nr; i++) { if (rows[r + i - 1]) for (let j = 0; j < nc; j++) rows[r + i - 1][c + j - 1] = ''; } return range; },
          setBackground() { return range; }, setFontColor() { return range; }, setFontWeight() { return range; }, setWrap() { return range; }
        };
        return range;
      }
    };
  }
  const ss = {
    getSheetByName: name => data[name] ? sheet(name) : null,
    insertSheet(name) { data[name] = []; return sheet(name); },
    getUrl: () => 'https://docs.google.com/spreadsheets/d/test'
  };
  const alerts = [];
  const context = vm.createContext({
    Date, console: {log() {}, error() {}},
    PropertiesService: {getScriptProperties: () => ({getProperty: k => props[k] ?? null, setProperty: (k, v) => props[k] = v, deleteProperty: k => delete props[k]})},
    LockService: {getScriptLock: () => ({waitLock() {}, tryLock: () => true, releaseLock() {}})},
    SpreadsheetApp: {getActiveSpreadsheet: () => ss, flush() {}, getUi: () => ({alert: m => alerts.push(m)})},
    Utilities: {getUuid: () => 'job-x', sleep() {}},
    ScriptApp: {
      WeekDay: {MONDAY: 'MONDAY', SATURDAY: 'SATURDAY'},
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1),
      newTrigger(handler) {
        const t = {getHandlerFunction: () => handler, timezone: '', weekDay: '', hour: null};
        const b = {timeBased: () => b, everyMinutes: () => b, at: () => b,
          inTimezone: v => { t.timezone = v; return b; },
          onWeekDay: v => { t.weekDay = v; return b; },
          atHour: v => { t.hour = v; return b; }, create: () => { triggers.push(t); return t; }};
        return b;
      }
    },
    GmailApp: {sendEmail() { throw new Error('Gmail must not be used'); }},
    UrlFetchApp: {
      fetch(url, request) {
        const path = url.replace('https://api.brevo.com/v3', '');
        requests.push({path, method: request.method});
        const custom = options.api?.(path);
        if (custom) return {getResponseCode: () => 200, getContentText: () => JSON.stringify(custom)};
        if (path.startsWith('/emailCampaigns?')) {
          const offset = Number(path.match(/offset=(\d+)/)[1]);
          return {getResponseCode: () => 200, getContentText: () => JSON.stringify({campaigns: offset === 0 ? (options.campaigns || []) : []})};
        }
        return {getResponseCode: () => 200, getContentText: () => JSON.stringify({})};
      }
    }
  });
  vm.runInContext(code, context);
  return {c: context, data, props, requests, triggers, alerts,
    stats: () => data['Brevo配信分析'] || [], weekly: () => data['Brevo週次サマリー'] || []};
}

test('analytics only ever issues GET requests — never a send', () => {
  const h = harness({campaigns: [CAMPAIGN(1, '2026-09-08T11:00:00.000Z', {sent: 100, delivered: 98, uniqueViews: 40, uniqueClicks: 10, unsubscriptions: 1, hardBounces: 1, softBounces: 1, complaints: 0})]});
  h.c.brevoAnalyticsWeekly();
  assert.ok(h.requests.length > 0);
  assert.ok(h.requests.every(r => r.method === 'get'), 'every request must be a GET');
  assert.equal(h.requests.filter(r => /sendNow|smtp/.test(r.path)).length, 0);
});

test('rates are computed from the right denominators and 0/0 stays blank', () => {
  const h = harness({campaigns: [
    CAMPAIGN(1, '2026-09-08T11:00:00.000Z', {sent: 100, delivered: 80, uniqueViews: 40, uniqueClicks: 10, unsubscriptions: 4}),
    CAMPAIGN(2, '2026-09-09T11:00:00.000Z', {sent: 0, delivered: 0, uniqueViews: 0, uniqueClicks: 0})
  ]});
  h.c.brevoAnalyticsWeekly();
  const [, first, second] = h.stats();
  assert.equal(first[6], 80);   // 到達率 = 80/100
  assert.equal(first[10], 50);  // 開封率 = 40/80（送信数ではなく到達数が母数）
  assert.equal(first[12], 12.5); // クリック率 = 10/80
  assert.equal(first[13], 25);  // CTOR = 10/40
  assert.equal(first[15], 5);   // 配信停止率 = 4/80
  assert.equal(second[6], '');  // 母数0は0%でなく空欄
  assert.equal(second[10], '');
});

test('re-running never duplicates rows and refreshes changing numbers', () => {
  const first = CAMPAIGN(1, '2026-09-08T11:00:00.000Z', {sent: 100, delivered: 98, uniqueViews: 10, uniqueClicks: 2});
  const h = harness({campaigns: [first]});
  h.c.brevoAnalyticsWeekly();
  assert.equal(h.stats().length, 2); // ヘッダ + 1件
  first.statistics.globalStats.uniqueViews = 30; // 開封は後から増える
  h.c.brevoAnalyticsWeekly();
  h.c.brevoAnalyticsWeekly();
  assert.equal(h.stats().length, 2, 'campaign id is the key — rows must not accumulate');
  assert.equal(h.stats()[1][9], 30);
});

test('weeks start on Saturday in JST and only completed weeks are summarized', () => {
  const h = harness({campaigns: [
    // 2026-09-05(土) 08:00 JST — UTCでは金曜だがJSTでは土曜
    CAMPAIGN(1, '2026-09-04T23:00:00.000Z', {sent: 50, delivered: 50, uniqueViews: 10, uniqueClicks: 2}),
    CAMPAIGN(2, '2026-09-11T11:00:00.000Z', {sent: 50, delivered: 50, uniqueViews: 20, uniqueClicks: 4}),
    // 2026-09-12(土) = 進行中の翌週
    CAMPAIGN(3, '2026-09-12T02:00:00.000Z', {sent: 40, delivered: 40, uniqueViews: 4, uniqueClicks: 1})
  ]});
  h.c.brevoAnalyticsCollect_();
  h.c.brevoAnalyticsSummarize_(new Date('2026-09-14T00:00:00.000Z'));
  const weeks = h.weekly().slice(1).filter(r => r[0]);
  assert.deepEqual(weeks.map(r => r[0]), ['2026-09-05']);
  assert.equal(weeks[0][1], 2);   // 配信回数
  assert.equal(weeks[0][3], 100); // 到達合計
  assert.equal(weeks[0][6], 30);  // 開封率 30/100
});

test('summary is rebuilt from the detail sheet, so stale weeks disappear', () => {
  const h = harness({campaigns: [CAMPAIGN(1, '2026-09-08T11:00:00.000Z', {sent: 10, delivered: 10})]});
  h.c.brevoAnalyticsWeekly();
  h.data['Brevo週次サマリー'].push(['2020-01-06', 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, new Date()]);
  h.c.brevoAnalyticsWeekly();
  const weeks = h.weekly().slice(1).filter(r => r[0]);
  assert.deepEqual(weeks.map(r => r[0]), ['2026-09-05']);
});

test('article URL is recovered from the archive even after the ledger row is deleted', () => {
  const url = 'https://metagri-labo.com/ai-guide/gpt-image-2-5-farm-review/';
  const h = harness({
    campaigns: [CAMPAIGN(2, '2026-09-10T11:06:00.000Z', {sent: 94, delivered: 92})],
    data: {アーカイブ: [['送信日時', '件名', '記事URL', '配信数', '本文', 'X', 'BrevoキャンペーンID'],
      [new Date(), '件名', url, 94, '<p>x</p>', '', 2]]}
  });
  h.c.brevoAnalyticsWeekly();
  assert.equal(h.stats()[1][3], url);
});

test('list size is recorded against the most recently completed Saturday-Friday week', () => {
  const h = harness({campaigns: [CAMPAIGN(1, '2026-09-08T11:00:00.000Z', {sent: 1, delivered: 1})]});
  h.c.brevoAnalyticsCollect_();
  h.c.brevoAnalyticsSummarize_(new Date('2026-09-12T00:00:00.000Z'));
  const completed = h.weekly().slice(1).find(r => r[0] === '2026-09-05');
  assert.equal(completed[14], 2); // one@ と two@（大文字・前後空白・空行は同一視/除外）
});

test('campaigns not recorded in this spreadsheet are excluded as Brevo-side tests', () => {
  const managed = CAMPAIGN(2, '2026-09-08T11:00:00.000Z', {sent: 94, delivered: 92});
  const testCampaign = CAMPAIGN(1, '2026-09-08T10:00:00.000Z', {sent: 1, delivered: 1});
  const h = harness({campaigns: [managed, testCampaign], data: {
    アーカイブ: [['送信日時', '件名', '記事URL', '配信数', '本文', 'X', 'BrevoキャンペーンID'],
      [new Date(), '本番', 'https://example.com/2', 94, '', '', 2]]
  }});
  h.c.brevoAnalyticsCollect_();
  assert.deepEqual(h.stats().slice(1).map(r => r[0]), [2]);
});

test('analytics still runs when sending is disabled, but not without an API key', () => {
  const h = harness({props: {BREVO_ENABLED: 'false'}, campaigns: [CAMPAIGN(1, '2026-09-08T11:00:00.000Z', {sent: 5, delivered: 5})]});
  h.c.brevoAnalyticsWeekly();
  assert.equal(h.stats().length, 2);
  const h2 = harness({campaigns: []});
  delete h2.props.BREVO_API_KEY;
  assert.throws(() => h2.c.brevoAnalyticsWeekly(), /BREVO_API_KEY/);
  assert.equal(h2.requests.length, 0);
});

test('setup creates the weekly trigger once and is safe to re-run', () => {
  const h = harness({campaigns: []});
  h.c.setupBrevoAnalytics();
  h.c.setupBrevoAnalytics();
  const weekly = h.triggers.filter(t => t.getHandlerFunction() === 'brevoAnalyticsWeekly');
  assert.equal(weekly.length, 1);
  assert.equal(weekly[0].weekDay, 'SATURDAY');
  assert.equal(weekly[0].hour, 8);
  assert.equal(weekly[0].timezone, 'Asia/Tokyo');
});

test('missing statistics fall back to a per-campaign read, with a capped budget', () => {
  const detail = {statistics: {globalStats: {sent: 7, delivered: 7, uniqueViews: 7}}};
  const h = harness({
    campaigns: [CAMPAIGN(1, '2026-09-08T11:00:00.000Z', null)],
    api: path => path === '/emailCampaigns/1?statistics=globalStats' ? detail : null
  });
  h.c.brevoAnalyticsWeekly();
  assert.equal(h.stats()[1][4], 7);
  assert.ok(h.requests.some(r => r.path === '/emailCampaigns/1?statistics=globalStats'));
});

test('campaign list explicitly requests global statistics', () => {
  const h = harness({campaigns: []});
  h.c.brevoAnalyticsCollect_();
  assert.ok(h.requests.some(r => r.path.includes('statistics=globalStats')));
});
