'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');

async function report(result, error, pending = []) {
  const calls = [];
  const start = source.indexOf('const reportAiGuideRun =');
  const end = source.indexOf('// === Robloxビジネス速報の実行レポート ===', start);
  const context = { aiGuideDelivery: { pendingGasTransfers: () => pending },
    sendMonitoringNotification: async (...args) => calls.push(args), result, error };
  await vm.runInNewContext(source.slice(start, end) + '\nreportAiGuideRun({}, result.discordUrl || result.gasUrl, error, result);', context);
  return calls[0];
}

test('busy monitoring confirms the new Discord post while preserving the pending GAS warning', async () => {
  const notice = await report({ discordUrl: 'https://example.com/new/' }, { code: 'AI_GUIDE_GAS_BUSY', message: 'busy' },
    [{ url: 'https://example.com/old/', status: 'pending' }]);
  assert.match(notice[1], /今回のDiscord投稿は完了しました/);
  assert.match(notice[1], /https:\/\/example.com\/new\//);
  assert.equal(notice[2], 'warn');
  assert.match(notice[3], /https:\/\/example.com\/old\//);
});

test('GAS-only recovery never reports a new Discord post', async () => {
  const notice = await report({ discordUrl: null, gasUrl: 'https://example.com/old/' });
  assert.match(notice[1], /Discord新規投稿はありません/);
  assert.match(notice[1], /スプレッドシート転送が完了/);
  assert.equal(notice[2], 'info');
});

test('monitoring reports different Discord and GAS article URLs independently', async () => {
  const notice = await report({ discordUrl: 'https://example.com/new/', gasUrl: 'https://example.com/old/' });
  assert.match(notice[1], /https:\/\/example.com\/new\//);
  assert.match(notice[1], /https:\/\/example.com\/old\//);
});

async function oneShot(env, outcome) {
  const calls = [];
  const start = source.indexOf("client.once('clientReady'");
  const end = source.indexOf('  // ▼▼▼ この行を追加 ▼▼▼', start);
  let ready;
  const context = { process: { env }, console: { log() {}, error() {} },
    client: { user: { tag: 'test' }, once: (_, fn) => { ready = fn; }, destroy: () => calls.push('destroy') },
    runAiGuideTask: async () => { calls.push('deliver'); return outcome; } };
  vm.runInNewContext(source.slice(start, end) + "throw new Error('Other jobs must not initialize');\n});", context);
  await ready();
  return { calls, exitCode: context.process.exitCode };
}

test('one-shot uses the normal delivery task and disconnects before initializing other jobs', async () => {
  const result = await oneShot({ AI_GUIDE_RUN_ONCE: 'true' }, { result: { discordUrl: 'new' }, error: null });
  assert.deepEqual(result.calls, ['deliver', 'destroy']);
  assert.equal(result.exitCode, undefined);
});

test('one-shot respects disabled delivery and reports incomplete transfers as failure', async () => {
  const disabled = await oneShot({ AI_GUIDE_RUN_ONCE: 'true', DISABLE_AI_GUIDE: 'true' }, {});
  assert.deepEqual(disabled.calls, ['destroy']);
  assert.equal(disabled.exitCode, 1);
  const failed = await oneShot({ AI_GUIDE_RUN_ONCE: 'true' }, { result: { discordUrl: 'new' }, error: new Error('busy') });
  assert.deepEqual(failed.calls, ['deliver', 'destroy']);
  assert.equal(failed.exitCode, 1);
});
