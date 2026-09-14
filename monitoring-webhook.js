'use strict';

const DISCORD_WEBHOOK_BASE_URL = 'https://discord.com/api/webhooks/';

/**
 * Accept either Discord's complete webhook URL or the legacy `id/token` form.
 * Returning null keeps monitoring optional when the setting is empty or invalid.
 */
function resolveMonitoringWebhookUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  if (!/^https?:\/\//i.test(raw)) {
    return /^\d+\/[A-Za-z0-9._-]+$/.test(raw)
      ? `${DISCORD_WEBHOOK_BASE_URL}${raw}`
      : null;
  }

  try {
    const url = new URL(raw);
    const allowedHosts = new Set([
      'discord.com',
      'canary.discord.com',
      'ptb.discord.com',
      'discordapp.com',
      'canary.discordapp.com',
      'ptb.discordapp.com'
    ]);

    if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname.toLowerCase())) {
      return null;
    }

    return /^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/.test(url.pathname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

module.exports = { resolveMonitoringWebhookUrl };
