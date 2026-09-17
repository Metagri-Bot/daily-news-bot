const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const autoMail = fs.readFileSync('auto-mail.gs', 'utf8');
// 本番の auto-mail.gs は Brevo 予約配信を統合済み。統合前の構成のときだけ BrevoMail.gs を足す
const code = autoMail.includes('function brevoConfig_') ? autoMail : autoMail + '\n' + fs.readFileSync('BrevoMail.gs', 'utf8');

function harness(options = {}) {
  const data = {
    原稿作成: [['article', 'Subject'], ['https://metagri-labo.com/ai-guide/new/', '<p>Original</p>'], ['', new Date(Date.now() + 3600000)], ['', 'X']],
    設定: [[''], ['', '農業AI通信']], 配信リスト: [['メール'], ['one@example.com'], ['two@example.com']]
  };
  const props = {BREVO_API_KEY: 'test-key', BREVO_ENABLED: 'true', BREVO_FOLDER_ID: '2',
    AI_GUIDE_DRAFT_URL: 'https://metagri-labo.com/ai-guide/new/'};
  const requests = [], triggers = [];
  const sheets = {};
  function sheet(name) {
    if (sheets[name]) return sheets[name];
    const rows = data[name];
    return sheets[name] = {
      getLastRow: () => rows.length, getLastColumn: () => Math.max(0, ...rows.map(r => r.length)),
      appendRow: row => rows.push([...row]), setFrozenRows() {},
      getRange(r, c, nr = 1, nc = 1) {
        if (typeof r === 'string') { const match = r.match(/^([A-Z])(\d+)$/); c = match[1].charCodeAt(0) - 64; r = +match[2]; }
        const range = {
          getValues: () => Array.from({length: nr}, (_, i) => Array.from({length: nc}, (_, j) => rows[r + i - 1]?.[c + j - 1] ?? '')),
          getValue: () => rows[r - 1]?.[c - 1] ?? '',
          setValues(values) { values.forEach((row, i) => { rows[r + i - 1] ||= []; row.forEach((v, j) => rows[r + i - 1][c + j - 1] = v); }); return range; },
          setValue(v) { return range.setValues([[v]]); }, setBackground() { return range; }, setFontWeight() { return range; }
        }; return range;
      }
    };
  }
  const ss = {getSheetByName: name => data[name] ? sheet(name) : null,
    insertSheet(name) { data[name] = []; return sheet(name); }, getUrl: () => 'https://docs.google.com/spreadsheets/d/test'};
  let nextId = 1;
  const context = vm.createContext({Date, console: {log() {}, error() {}},
    PropertiesService: {getScriptProperties: () => ({getProperty: k => props[k] || null, setProperty: (k,v) => props[k] = v, deleteProperty: k => delete props[k]})},
    LockService: {getScriptLock: () => ({waitLock() {}, tryLock: () => true, releaseLock() {}})},
    SpreadsheetApp: {getActiveSpreadsheet: () => ss, flush() {}, getUi: () => ({alert() {}})},
    Utilities: {getUuid: () => 'job-' + nextId++, sleep() {}},
    ScriptApp: {getProjectTriggers: () => triggers.slice(), deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1),
      newTrigger(handler) { const t = {getHandlerFunction: () => handler}; const b = {timeBased: () => b, everyMinutes: () => b, everyHours: h => { t.hours = h; return b; }, at: () => b, create: () => {triggers.push(t);return t;}}; return b;}},
    GmailApp: {sendEmail() { throw new Error('Gmail must not be used'); }},
    UrlFetchApp: {fetch(url, request) {
      const path = url.replace('https://api.brevo.com/v3', '');
      const item = {path, method: request.method, body: request.payload ? JSON.parse(request.payload) : undefined};
      requests.push(item);
      const custom = options.api?.(item, context);
      if (custom instanceof Error) throw custom;
      const result = custom || (path === '/contacts/lists' ? {body: {id: 10}} : path === '/emailCampaigns' ? {body: {id: 20}} :
        path === '/emailCampaigns/20' ? {body: {status: options.remoteStatus || 'sent', statistics: {globalStats: {sent: 2, delivered: 1}}}} : {body: {}});
      return {getResponseCode: () => result.status || 200, getContentText: () => JSON.stringify(result.body || {})};
    }}
  });
  vm.runInContext(code, context);
  return {c: context, data, props, requests, triggers, jobs: () => context.brevoJobs_(),
    reserve: when => context.brevoReserve_(when || new Date(Date.now() - 1)),
    sends: () => requests.filter(r => r.path.endsWith('/sendNow'))};
}

test('reservation freezes content; timers use snapshot and confirm before archive', () => {
  const h = harness(); h.reserve();
  assert.equal(h.sends().length, 0);
  h.data.原稿作成[0][1] = 'Changed'; h.data.原稿作成[1][1] = '<p>Changed</p>';
  h.data.原稿作成[1][0] = 'https://metagri-labo.com/ai-guide/another/';
  h.c.brevoWorker({triggerUid: 'timer'});
  assert.equal(h.sends().length, 1);
  const payload = h.requests.find(r => r.path === '/emailCampaigns').body;
  assert.equal(payload.subject, 'Subject'); assert.match(payload.htmlContent, /Original/);
  assert.match(payload.htmlContent, /\{\{ unsubscribe \}\}/);
  assert.equal(h.data.アーカイブ, undefined);
  h.c.brevoWorker(); h.c.brevoWorker();
  assert.equal(h.sends().length, 1); assert.equal(h.jobs()[0].state, 'SENT');
  assert.equal(h.data.アーカイブ.length, 2); assert.equal(h.data.アーカイブ[1][3], 2);
});

test('future reservations never dispatch early', () => {
  const h = harness(); h.reserve(new Date(Date.now() + 600000)); h.c.brevoWorker();
  assert.equal(h.sends().length, 0); assert.equal(h.jobs()[0].state, 'READY');
});

test('cancellation prevents dispatch from remaining worker triggers', () => {
  const h = harness(); h.reserve(); h.c.cancelSchedule(true); h.c.scheduledBroadcast();
  assert.equal(h.jobs()[0].state, 'CANCELLED'); assert.equal(h.sends().length, 0);
});

test('missing configuration never falls back to Gmail or creates a reservation', () => {
  const h = harness(); delete h.props.BREVO_API_KEY;
  assert.throws(() => h.reserve(), /BREVO_API_KEY/); assert.equal(h.requests.length, 0);
});

test('mismatched article and historical partial send block only the affected article', () => {
  const h = harness(); h.props.AI_GUIDE_DRAFT_URL = 'different';
  assert.throws(() => h.reserve(), /一致/);
  h.props.AI_GUIDE_DRAFT_URL = h.data.原稿作成[1][0];
  h.props.AI_GUIDE_SEND_IN_FLIGHT = JSON.stringify({url: h.data.原稿作成[1][0]});
  assert.throws(() => h.reserve(), /部分送信/);
  h.props.AI_GUIDE_SEND_IN_FLIGHT = JSON.stringify({url: 'https://metagri-labo.com/ai-guide/old/'});
  h.reserve(); assert.equal(h.jobs()[0].state, 'READY');
});

test('send timeout is persisted before network call; reconciliation never resends', () => {
  let attempted = false;
  const h = harness({api: (r, c) => {
    if (r.path.endsWith('/sendNow')) {
      assert.equal(c.brevoJobs_()[0].state, 'SENDING'); attempted = true; return new Error('timeout');
    }
  }});
  h.reserve(); h.c.brevoWorker(); assert.ok(attempted);
  assert.equal(h.jobs()[0].state, 'SENDING');
  h.c.brevoWorker(); assert.equal(h.sends().length, 1); assert.equal(h.jobs()[0].state, 'SENT');
});

test('credit rejection remains visible and cannot silently resend', () => {
  const h = harness({remoteStatus: 'draft', api: r => r.path.endsWith('/sendNow') ? {status: 402} : null});
  h.reserve(); h.c.brevoWorker(); h.c.brevoWorker();
  assert.equal(h.sends().length, 1); assert.equal(h.jobs()[0].state, 'SENDING');
  assert.throws(() => h.reserve(), /配信記録/); assert.equal(h.data.アーカイブ, undefined);
});

test('campaign creation ambiguity never dispatches or creates a second campaign', () => {
  const h = harness({api: r => r.path === '/emailCampaigns' ? new Error('timeout') : null});
  h.reserve(); h.c.brevoWorker(); h.c.brevoWorker();
  assert.equal(h.jobs()[0].state, 'REVIEW'); assert.equal(h.sends().length, 0);
  assert.equal(h.requests.filter(r => r.path === '/emailCampaigns').length, 1);
});

test('contact failure prevents a partial campaign from being sent', () => {
  const h = harness({api: r => r.path === '/contacts' && r.body.email === 'two@example.com' ? {status: 429} : null});
  h.reserve(); h.c.brevoWorker();
  assert.equal(h.jobs()[0].state, 'FAILED'); assert.equal(h.sends().length, 0);
});

test('sheet unsubscribe is removed from job list before send and blacklists are never reset', () => {
  const h = harness(); h.reserve(); h.data.配信リスト.pop(); h.c.brevoWorker();
  const removal = h.requests.find(r => r.path.endsWith('/contacts/remove'));
  assert.deepEqual(removal.body.emails, ['two@example.com']);
  assert.ok(h.requests.indexOf(removal) < h.requests.indexOf(h.sends()[0]));
  for (const r of h.requests.filter(r => r.path === '/contacts')) assert.equal(Object.hasOwn(r.body, 'emailBlacklisted'), false);
});

test('duplicate/case-varied emails are deduplicated; invalid rows are rejected', () => {
  const h = harness(); h.data.配信リスト.push([' ONE@example.com ']); h.reserve();
  assert.equal(h.jobs()[0].emails.length, 2);
  const h2 = harness(); h2.data.配信リスト.push(['bad@example.com,other@example.com']);
  assert.throws(() => h2.reserve(), /無効/);
});

test('recipient ceiling is enforced before any contact upload', () => {
  const h = harness(); h.props.BREVO_MAX_RECIPIENTS = '1';
  assert.throws(() => h.reserve(), /超え/); assert.equal(h.requests.length, 0);
});

test('archive recovery is idempotent and never causes resend', () => {
  const h = harness(); h.reserve(); h.c.brevoWorker(); h.c.brevoWorker();
  const job = h.jobs()[0]; job.state = 'ACCEPTED'; h.c.brevoSave_(job);
  h.c.brevoWorker(); assert.equal(h.data.アーカイブ.length, 2); assert.equal(h.sends().length, 1);
});

test('test preview goes only to owner through Brevo and does not reserve campaign', () => {
  const h = harness(); h.c.sendManualTest(false, true);
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].path, '/smtp/email');
  assert.deepEqual(h.requests[0].body.to, [{email: 'yuichiro.kai@noujoujin.com'}]);
  assert.equal(h.sends().length, 0);
});

test('API errors do not expose provider response bodies', () => {
  const h = harness({api: () => ({status: 401, body: {message: 'private-address-secret'}})});
  assert.throws(() => h.c.brevoApi_('get', '/account'), e => /HTTP 401/.test(e.message) && !e.message.includes('private-address'));
});

test('member list contacts are merged; blacklisted and list-unsubscribed members are excluded', () => {
  const h = harness({api: item => item.path.startsWith('/contacts/lists/7/contacts') ? {body: {contacts: [
    {email: 'Member@Example.com', emailBlacklisted: false, listUnsubscribed: []},
    {email: 'two@example.com', emailBlacklisted: false},
    {email: 'blocked@example.com', emailBlacklisted: true},
    {email: 'left@example.com', emailBlacklisted: false, listUnsubscribed: [7]}
  ]}} : undefined});
  h.props.BREVO_MEMBER_LIST_ID = '7';
  assert.deepEqual([...h.c.brevoEmails_()], ['one@example.com', 'two@example.com', 'member@example.com']);
});

test('without BREVO_MEMBER_LIST_ID the sheet stays the only source and Brevo is not queried', () => {
  const h = harness();
  assert.deepEqual([...h.c.brevoEmails_()], ['one@example.com', 'two@example.com']);
  assert.equal(h.requests.length, 0);
});

test('member list fetch failure stops instead of silently dropping members', () => {
  const h = harness({api: item => item.path.startsWith('/contacts/lists/7') ? {status: 500} : undefined});
  h.props.BREVO_MEMBER_LIST_ID = '7';
  assert.throws(() => h.c.brevoEmails_(), /Brevo HTTP 500/);
});

test('members only (empty sheet) is still a valid audience', () => {
  const h = harness({api: item => item.path.startsWith('/contacts/lists/7/contacts') ? {body: {contacts: [{email: 'm@example.com'}]}} : undefined});
  h.data.配信リスト.length = 1; h.props.BREVO_MEMBER_LIST_ID = '7';
  assert.deepEqual([...h.c.brevoEmails_()], ['m@example.com']);
});

test('form unsubscribe also blocks the address in Brevo', () => {
  const h = harness({api: item => item.method === 'put' ? {status: 404} : undefined});
  h.data.配信リスト[0] = ['メール'];
  h.data.配信リスト.forEach(r => r.length = 1);
  const sheet = h.c.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('配信リスト');
  sheet.getDataRange = () => ({getValues: () => h.data.配信リスト.map(r => [...r])});
  sheet.deleteRow = i => h.data.配信リスト.splice(i - 1, 1);
  h.c.autoDeleteSubscriber({namedValues: {'メールアドレス': ['two@example.com']}});
  assert.equal(h.data.配信リスト.length, 2);
  const put = h.requests.find(r => r.method === 'put');
  assert.equal(put.path, '/contacts/two%40example.com'); assert.deepEqual(put.body, {emailBlacklisted: true});
  assert.deepEqual(h.requests.find(r => r.method === 'post').body, {email: 'two@example.com', emailBlacklisted: true});
});

test('member sheet keeps every row and flags stops, withdrawals and removals instead of deleting', () => {
  let contacts = [{email: 'b@example.com'}, {email: 'a@example.com'}, {email: 'x@example.com', emailBlacklisted: true}];
  const h = harness({api: item => item.path.startsWith('/contacts/lists/7/contacts') ? {body: {contacts}} : undefined});
  h.props.BREVO_MEMBER_LIST_ID = '7';
  h.c.setupWpMemberSync();
  const rows = h.data['会員（WordPress）'];
  const view = () => Object.fromEntries(rows.slice(1).map(r => [r[0], [r[1], r[2]]]));
  assert.deepEqual(view(), {'b@example.com': ['配信中', true], 'a@example.com': ['配信中', true], 'x@example.com': ['配信停止', false]});
  assert.equal(h.triggers.filter(t => t.getHandlerFunction() === 'syncWpMembersToSheet').length, 1);
  assert.equal(h.triggers.find(t => t.getHandlerFunction() === 'syncWpMembersToSheet').hours, 6);
  contacts = [{email: 'b@example.com', emailBlacklisted: true, attributes: {WP_MEMBER_STATUS: '退会申請', WP_WITHDRAW_REASON: '記事を読み終えたため'}},
    {email: 'x@example.com'}, {email: 'c@example.com', emailBlacklisted: true, attributes: {WP_MEMBER_STATUS: '配信中'}}];
  h.c.setupWpMemberSync();
  assert.equal(h.triggers.filter(t => t.getHandlerFunction() === 'syncWpMembersToSheet').length, 1);
  assert.deepEqual(view(), {'b@example.com': ['退会申請', false], 'a@example.com': ['リスト外', false],
    'x@example.com': ['配信中', true], 'c@example.com': ['配信停止', false]});
  assert.equal(rows.length, 5);
  assert.equal(rows.find(r => r[0] === 'b@example.com')[6], '記事を読み終えたため');
  assert.equal(rows.find(r => r[0] === 'x@example.com')[6], '');
  assert.equal(rows[0][6], '退会理由');
  assert.deepEqual([...h.c.brevoEmails_()], ['one@example.com', 'two@example.com', 'x@example.com']);
  assert.equal(h.data.配信リスト.length, 3);
});

test('legacy 3-column member sheet is upgraded in place without losing rows', () => {
  const h = harness({api: item => item.path.startsWith('/contacts/lists/7/contacts') ? {body: {contacts: [{email: 'a@example.com'}]}} : undefined});
  h.props.BREVO_MEMBER_LIST_ID = '7';
  h.data['会員（WordPress）'] = [['メール', '連携元', '最終同期'], ['a@example.com', 'WordPress会員', 'old'], ['gone@example.com', 'WordPress会員', 'old']];
  h.c.syncWpMembersToSheet();
  const rows = h.data['会員（WordPress）'];
  assert.deepEqual(rows[0], ['メール', '状態', '配信対象', '初回登録', '状態変更', '最終同期', '退会理由']);
  assert.deepEqual(rows.slice(1).map(r => [r[0], r[1], r[2]]), [['a@example.com', '配信中', true], ['gone@example.com', 'リスト外', false]]);
});

test('member sync does nothing without BREVO_MEMBER_LIST_ID', () => {
  const h = harness(); h.c.syncWpMembersToSheet();
  assert.equal(h.data['会員（WordPress）'], undefined); assert.equal(h.requests.length, 0);
});
