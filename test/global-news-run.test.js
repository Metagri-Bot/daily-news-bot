'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');

test('海外文献の手動配信は通常と同じ処理だけを実行し、ほかのジョブを起動しない', async () => {
  const calls = [];
  const start = source.indexOf("client.once('clientReady'");
  const end = source.indexOf('  // ▼▼▼ この行を追加 ▼▼▼', start);
  let ready;
  const context = {
    process: { env: { GLOBAL_NEWS_RUN_ONCE: 'true' } },
    console: { log() {}, error() {} },
    client: {
      user: { tag: 'test' },
      once: (_, callback) => { ready = callback; },
      destroy: () => calls.push('disconnect'),
    },
    runGlobalResearch: async () => {
      calls.push('global-digest');
      return { posted: 1 };
    },
  };
  vm.runInNewContext(source.slice(start, end) + "throw new Error('Other jobs must not initialize');\n});", context);
  await ready();
  assert.deepEqual(calls, ['global-digest', 'disconnect']);
  assert.equal(context.process.exitCode, undefined);
});

test('別プロセスで海外文献を配信中は、手動・定期ともに重ねて送信しない', async () => {
  const start = source.indexOf('  async function runGlobalResearch()');
  const end = source.indexOf("  cron.schedule('10 10,19 * * *'", start);
  const context = {
    GLOBAL_RESEARCH_CHANNEL_ID: 'test-channel',
    GLOBAL_RSS_FEEDS: ['https://example.com/feeds'],
    OPENAI_API_KEY: 'test-key',
    GLOBAL_NEWS_RUN_LOCK_FILE: 'test-state/global-news-run.lock',
    acquireAiGuideRunLock: async path => {
      assert.equal(path, 'test-state/global-news-run.lock');
      return null;
    },
    client: { channels: { fetch: () => assert.fail('Discord must be untouched while another run holds the lock') } },
  };
  const result = await vm.runInNewContext(source.slice(start, end) + '\nrunGlobalResearch();', context);
  assert.equal(result.posted, 0);
  assert.equal(result.reason, 'already-running');
});

test('公開RSSは短いdescriptionよりもHTML付きの抄録を優先する', () => {
  const start = source.indexOf('function getGlobalNewsRssText(');
  const end = source.indexOf('// === 海外文献の翻訳・要約関数 ===', start);
  const readRssText = vm.runInNewContext(source.slice(start, end) + '\ngetGlobalNewsRssText;', {
    cheerio: require('cheerio'),
  });
  const abstract = 'We compared methods for tracking stored crop quality across multiple conditions. '.repeat(4).trim();
  const article = {
    'content:encoded': '<h3>Abstract</h3><p>' + abstract + '</p><br><p>Conclusion.</p><script>ignore this code</script>',
    contentSnippet: 'Follow this link to download the article.',
  };
  assert.equal(readRssText(article), 'Abstract ' + abstract + ' Conclusion.');
  assert.equal(readRssText({ 'content:encoded': '<p>Short</p>', summary: abstract }), abstract);
  assert.equal(readRssText({ contentSnippet: article.contentSnippet }), '');
});
