'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeSkill, parseFurusato, scoreJob, fingerprint, buildMessage, runRadar, readState } = require('../farm-partner-radar');
const raw = overrides => ({ job_id: 1, position: '農家のSNS・EC販促支援', company_name: '試験農園',
  industries: '農業・林業', business_content: '自社農園の直販改善', applicant_condition: 'SNS運用経験',
  side_job_style: 'リモート', salary: 30000, is_applicable: true, expire: false, disabled: false, suspended: false, ...overrides });
const job = overrides => scoreJob(normalizeSkill(raw(overrides)));
function stateFile(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-radar-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return path.join(dir, 'state.json'); }
const collection = jobs => async () => ({ checkedAt: new Date().toISOString(), jobs, errors: [], stats: {} });

test('closed, suspended and unknown listings cannot be eligible; salary sentinel is not money', () => {
  assert.equal(job({ is_applicable: false }).status, 'closed');
  assert.equal(job({ suspended: true }).status, 'closed');
  assert.equal(job({ is_applicable: undefined }).status, 'unknown');
  assert.equal(job({ salary: 4 }).pay, '本文記載・要確認');
});
test('score gates reject incidental farm mentions and specialist roles', () => {
  assert.equal(job({ company_name: '宿泊会社', industries: '宿泊', position: '古民家HP制作', business_content: '農家古民家の宿泊施設' }).score, 0);
  assert.ok(job({ position: '洋菓子の品質向上・賞味期限延長', applicant_condition: '食品衛生と食品検査の実務経験' }).score < 65);
  assert.ok(job({ applicant_condition: 'Shopify経験' }).score < 65);
  assert.ok(job({ applicant_condition: '法人営業経験・受注まで担当' }).score < 65);
  assert.ok(job().score >= 65);
});
test('fingerprint ignores applicants but detects material changes', () => {
  assert.equal(fingerprint(job({ applicant_quantity: 1 })), fingerprint(job({ applicant_quantity: 20 })));
  assert.notEqual(fingerprint(job()), fingerprint(job({ salary: 50000 })));
  assert.notEqual(fingerprint(job()), fingerprint(job({ applicant_condition: '週40時間' })));
});
test('furusato requires a future deadline plus application control', () => {
  const html = date => `<table><tr><th>プロジェクトについて</th><td>農家EC</td></tr><tr><th>企業・団体名</th><td>農園</td></tr><tr><th>募集終了日</th><td>${date}</td></tr></table><a href='/apply'>応募する</a>`;
  const parse = (h, title = '農家EC支援') => parseFurusato(h, 'https://www.furusatokengyo.jp/project/case/info/test', title, new Date('2026-09-17T12:00:00Z'));
  assert.equal(parse(html('2025-07-26')).status, 'closed');
  assert.equal(parse(html('2026-09-17')).status, 'open');
  assert.equal(parse(html('2026-10-01'), '【募集終了】農家EC').status, 'closed');
  assert.equal(parse(html('')).status, 'unknown');
  assert.equal(parse(html('2026-10-01').replace('応募する', 'ログイン')).status, 'unknown');
  assert.throws(() => parse('<html>ログイン</html>'), /schema/);
});
test('dry run never sends or writes state', async t => {
  const file = stateFile(t);
  await runRadar({ file, dryRun: true, collect: collection([job()]), send: () => assert.fail() });
  assert.equal(fs.existsSync(file), false);
});
test('only new/material updates send; closed candidates are silent', async t => {
  const file = stateFile(t), messages = [];
  const run = jobs => runRadar({ file, collect: collection(jobs), send: async m => messages.push(m) });
  await run([job(), job({ job_id: 2, is_applicable: false })]);
  await run([job({ applicant_quantity: 90 })]);
  assert.equal(messages.length, 1);
  await run([job({ salary: 50000 })]);
  assert.equal(messages.length, 2);
  assert.match(messages[1].embeds[0].title, /^更新/);
  assert.deepEqual(messages[0].allowedMentions, { parse: [] });
});
test('failed send remains retryable and already sent items survive a partial failure', async t => {
  const file = stateFile(t), jobs = [job(), job({ job_id: 2 })];
  let attempts = 0;
  await assert.rejects(runRadar({ file, collect: collection(jobs), send: async () => { if (++attempts === 2) throw new Error('network'); } }));
  assert.ok(readState(file).notified['skill:1']);
  assert.equal(readState(file).notified['skill:2'], undefined);
  let retries = 0;
  await runRadar({ file, collect: collection(jobs), send: async () => retries++ });
  assert.equal(retries, 1);
});
test('recent Discord history recovers send-before-save crashes', async t => {
  const file = stateFile(t), j = job();
  await runRadar({ file, collect: collection([j]), recover: async () => [buildMessage(j).embeds[0].footer.text], send: () => assert.fail() });
  assert.equal(readState(file).notified[j.id].fingerprint, fingerprint(j));
});
test('corrupt history and failed recovery fail closed', async t => {
  const file = stateFile(t);
  fs.writeFileSync(file, '{broken');
  await assert.rejects(runRadar({ file, collect: collection([job()]), send: () => assert.fail() }), /unreadable/);
  fs.writeFileSync(file, JSON.stringify({ version: 1, notified: {} }));
  await assert.rejects(runRadar({ file, collect: collection([job()]), recover: async () => { throw new Error('permission'); }, send: () => assert.fail() }), /permission/);
});
test('per-run cap and overlapping-run protection', async t => {
  const file = stateFile(t);
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const first = runRadar({ file, collect: async () => { await blocked; return collection([job(), job({ job_id: 2 })])(); }, maxPosts: 1, send: async () => {} });
  assert.equal((await runRadar({ file })).skipped, 'already-running');
  release();
  assert.equal((await first).sent, 1);
  assert.equal(Object.keys(readState(file).notified).length, 1);
});
