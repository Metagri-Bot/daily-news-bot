'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildJsonCompletionParams, isReasoningModel } = require('../openai-chat');

test('GPT-5.6 Luna uses its supported Chat Completions parameters', () => {
  const params = buildJsonCompletionParams({
    model: 'gpt-5.6-luna',
    messages: [{ role: 'user', content: 'JSONを返して' }],
    maxTokens: 2048,
    temperature: 0.3
  });

  assert.equal(isReasoningModel(params.model), true);
  assert.equal(params.max_completion_tokens, 2048);
  assert.equal(params.reasoning_effort, 'low');
  assert.deepEqual(params.response_format, { type: 'json_object' });
  assert.equal('temperature' in params, false);
  assert.equal('max_tokens' in params, false);
});

test('non-reasoning models keep temperature and max_tokens', () => {
  const params = buildJsonCompletionParams({
    model: 'gpt-4.1-mini',
    messages: [],
    maxTokens: 500,
    temperature: 0.2
  });

  assert.equal(params.max_tokens, 500);
  assert.equal(params.temperature, 0.2);
  assert.equal('max_completion_tokens' in params, false);
  assert.equal('reasoning_effort' in params, false);
});
