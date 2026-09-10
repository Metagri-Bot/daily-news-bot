const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../scripts/post-ai-guide-url.js'), 'utf8');

async function run(args, env) {
  const calls = [], logs = [], errors = [];
  const selection = { attr: () => undefined, first() { return this; }, text: () => 'Article content '.repeat(30), remove() {} };
  const context = {
    process: { argv: ['node', 'script', 'https://metagri-labo.com/ai-guide/example/', ...args], env },
    console: { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error: (...a) => errors.push(a.join(' ')) },
    URL,
    require(name) {
      if (name === 'dotenv') return { config() {} };
      if (name === 'axios') return {
        get: async () => { calls.push('fetch'); return { data: '<article>test</article>' }; },
        post: async (url) => { calls.push(url); return { data: { status: 'success', id: '1', channel_id: '2' } }; }
      };
      if (name === 'cheerio') return { load: () => () => selection };
      if (name === 'openai') return class { constructor() { this.chat = { completions: { create: async () => ({ choices: [{ message: { content: '{"summary":"test"}' } }] }) } }; } };
      if (name === '../openai-chat') return { buildJsonCompletionParams: p => p };
      if (name === '../ai-guide-content') return { normalizeAiGuideResult: p => p };
      throw new Error(name);
    }
  };
  await vm.runInNewContext(source, context);
  return { calls, logs, errors, exitCode: context.process.exitCode };
}

test('GAS-only succeeds without Discord token and never posts to Discord', async () => {
  const result = await run(['--gas-only'], { OPENAI_API_KEY: 'mock', AI_GUIDE_GAS_URL: 'https://gas.example' });
  assert.equal(result.exitCode, undefined);
  assert.deepEqual(result.calls, ['fetch', 'https://gas.example']);
  assert.ok(result.logs.some(s => s.includes('GAS logged.')));
});

test('GAS-only rejects missing GAS configuration before fetching or summarizing', async () => {
  const result = await run(['--gas-only'], { OPENAI_API_KEY: 'mock' });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.calls, []);
  assert.match(result.errors.join(' '), /AI_GUIDE_GAS_URL is not set/);
});

test('normal posting still requires Discord credentials', async () => {
  const result = await run([], { OPENAI_API_KEY: 'mock' });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.calls, []);
  assert.match(result.errors.join(' '), /DISCORD_BOT_TOKEN is not set/);
});

test('optional GAS skip does not report successful transfer', async () => {
  const result = await run([], { OPENAI_API_KEY: 'mock', DISCORD_BOT_TOKEN: 'mock' });
  assert.equal(result.exitCode, undefined);
  assert.equal(result.calls.length, 2);
  assert.ok(result.calls[1].startsWith('https://discord.com/'));
  assert.ok(!result.logs.some(s => s.includes('GAS logged.')));
});
