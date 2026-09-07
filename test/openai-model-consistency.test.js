'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('本番のOpenAI呼び出しは既定でgpt-5.6-lunaを使う', () => {
  const source = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  assert.match(source, /const DEFAULT_OPENAI_MODEL = process\.env\.OPENAI_MODEL \|\| 'gpt-5\.6-luna'/);
  assert.doesNotMatch(source, /model:\s*['"]gpt-4/);
});

test('index.jsのJSON生成はすべてLuna対応ヘルパーを通す', () => {
  const source = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  const calls = [...source.matchAll(/openai\.chat\.completions\.create\(([^\n]*)/g)];

  assert.ok(calls.length > 0);
  for (const call of calls) {
    assert.match(call[1], /^buildJsonCompletionParams\(\{/);
  }
});

test('公募系のLunaパラメータはStructured Outputsを有効にする', () => {
  for (const file of ['public-opportunity-monitor.js', 'chiba-tender-radar.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, /buildJsonCompletionParams\(\{/);
  }
});
