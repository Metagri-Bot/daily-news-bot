'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveMonitoringWebhookUrl } = require('../monitoring-webhook');

test('accepts a complete Discord webhook URL without adding another prefix', () => {
  const url = 'https://discord.com/api/webhooks/123456789/token_value';
  assert.equal(resolveMonitoringWebhookUrl(url), url);
});

test('supports the legacy id/token setting', () => {
  assert.equal(
    resolveMonitoringWebhookUrl('123456789/token_value'),
    'https://discord.com/api/webhooks/123456789/token_value'
  );
});

test('rejects empty, malformed, insecure, or non-Discord URLs', () => {
  assert.equal(resolveMonitoringWebhookUrl(''), null);
  assert.equal(resolveMonitoringWebhookUrl('not-a-webhook'), null);
  assert.equal(resolveMonitoringWebhookUrl('http://discord.com/api/webhooks/123/token'), null);
  assert.equal(resolveMonitoringWebhookUrl('https://example.com/api/webhooks/123/token'), null);
});
