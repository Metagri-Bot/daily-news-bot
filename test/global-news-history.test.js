'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { recoverGlobalHistory } = require('../global-news-history');

test('海外記事の投稿履歴をページ送りし、Botの投稿だけURLを正規化する', async () => {
  const now = new Date('2026-11-24T10:00:00Z');
  const entry = (id, author, content, url) => ({ id, author: { id: author }, timestamp: now.toISOString(), content, embeds: [{ url }] });
  const header = '## 🌍 **Metagri Global Research Digest**';
  const first = Array.from({ length: 100 }, (_, i) => entry(String(i), 'other', header, 'https://example.com/no'));
  first[0] = entry('0', 'bot', header, 'https://example.com/article?utm_source=rss');
  const second = [entry('100', 'bot', header, 'https://example.com/another'), entry('101', 'bot', '別の投稿', 'https://example.com/no')];
  const calls = [];
  const result = await recoverGlobalHistory(async before => { calls.push(before); return before ? second : first; }, 'bot', now);
  assert.deepEqual([...result], ['example.com/article', 'example.com/another']);
  assert.deepEqual(calls, [undefined, '99']);
});

test('履歴取得エラーを呼び出し元に伝える', async () => {
  await assert.rejects(recoverGlobalHistory(async () => { throw new Error('権限不足'); }, 'bot'), /権限不足/);
});
