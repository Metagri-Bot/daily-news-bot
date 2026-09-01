'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  discoverListingUrls,
  fetchTextWithRetry,
  isRetryableFetchError
} = require('../chiba-tender-radar');

test('鎌ケ谷市：親ページに募集中リンクがある場合だけ子ページを発見する', () => {
  const source = {
    url: 'https://www.city.kamagaya.chiba.jp/jigyosha/nyuusatu_menu/proposal/index.html',
    listingLinkPattern:
      /\/jigyosha\/nyuusatu_menu\/proposal\/poropo_boshu(?:\/index\.html|\/)?$/i
  };
  const html = `
    <a href="/jigyosha/nyuusatu_menu/proposal/poropo_boshu/index.html">募集中</a>
    <a href="/jigyosha/nyuusatu_menu/proposal/poropo_kekka/index.html">結果</a>
    <a href="https://example.com/jigyosha/nyuusatu_menu/proposal/poropo_boshu/index.html">外部</a>
  `;

  assert.deepStrictEqual(discoverListingUrls(html, source), [
    'https://www.city.kamagaya.chiba.jp/jigyosha/nyuusatu_menu/proposal/poropo_boshu/index.html'
  ]);
  assert.deepStrictEqual(discoverListingUrls('<a href="/other.html">結果のみ</a>', source), []);
});

test('HTTP取得：socket hang upは成功するまで最大3回再試行する', async () => {
  let calls = 0;
  const result = await fetchTextWithRetry('https://www.city.inzai.lg.jp/example.html', {
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) {
        const error = new Error('socket hang up');
        error.code = 'ECONNRESET';
        throw error;
      }
      return '<html>ok</html>';
    },
    attempts: 3,
    delayMs: 0,
    logRetry: false
  });

  assert.strictEqual(result, '<html>ok</html>');
  assert.strictEqual(calls, 3);
});

test('HTTP取得：404は恒久エラーとして再試行しない', async () => {
  let calls = 0;
  const error = new Error('Request failed with status code 404');
  error.response = { status: 404 };

  await assert.rejects(
    fetchTextWithRetry('https://example.com/missing.html', {
      fetchImpl: async () => {
        calls += 1;
        throw error;
      },
      attempts: 3,
      delayMs: 0,
      logRetry: false
    }),
    /404/
  );
  assert.strictEqual(calls, 1);
});

test('HTTP取得：再試行対象のHTTPステータスを限定する', () => {
  assert.strictEqual(isRetryableFetchError({ response: { status: 429 } }), true);
  assert.strictEqual(isRetryableFetchError({ response: { status: 503 } }), true);
  assert.strictEqual(isRetryableFetchError({ response: { status: 403 } }), false);
});
