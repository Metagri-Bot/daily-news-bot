'use strict';

function isReasoningModel(model) {
  return /^(gpt-5|gpt-6|o[1-9])/i.test(String(model || ''));
}

/**
 * Build parameters for JSON-only Chat Completions across model families.
 * GPT-5.6 Luna rejects custom temperature values and uses
 * max_completion_tokens instead of max_tokens.
 */
function buildJsonCompletionParams({
  model,
  messages,
  maxTokens = 2048,
  temperature = 0.3,
  reasoningEffort = 'low'
}) {
  const params = {
    model,
    messages,
    response_format: { type: 'json_object' }
  };

  if (isReasoningModel(model)) {
    return {
      ...params,
      max_completion_tokens: maxTokens,
      reasoning_effort: reasoningEffort
    };
  }

  return {
    ...params,
    max_tokens: maxTokens,
    temperature
  };
}

module.exports = { buildJsonCompletionParams, isReasoningModel };
