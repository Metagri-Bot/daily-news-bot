#!/usr/bin/env node
'use strict';

/**
 * 監視先URLの生存確認スクリプト。
 * 省庁・自治体はページ改修でURLが変わるため、定期的にこれを実行して
 * 「取得できない監視先」を public-opportunity-sources.js で修正・無効化する。
 *
 *   node scripts/check-public-opportunity-sources.js
 */

const axios = require('axios');
const { SOURCES, MANUAL_SOURCES } = require('../public-opportunity-sources');
const { harvestLinks } = require('../public-opportunity-monitor');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function check(source) {
  try {
    const response = await axios.get(source.url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 20000,
      responseType: 'text'
    });
    const links = harvestLinks(String(response.data || ''), source);
    return {
      id: source.id,
      organization: source.organization,
      status: response.status,
      candidates: links.length,
      result: links.length > 0 ? 'OK' : 'リンク0件（要確認）'
    };
  } catch (error) {
    return {
      id: source.id,
      organization: source.organization,
      status: error.response ? error.response.status : '-',
      candidates: 0,
      result: `失敗: ${error.message}`
    };
  }
}

async function main() {
  const rows = [];
  for (const source of SOURCES) {
    if (!source.enabled) {
      rows.push({ id: source.id, organization: source.organization, status: '-', candidates: 0, result: '無効化中' });
      continue;
    }
    rows.push(await check(source));
    await new Promise(resolve => setTimeout(resolve, 800));
  }

  console.table(rows);
  console.log('\nBotでは収集できない監視先（スキル側で人が確認）:');
  MANUAL_SOURCES.forEach(source => {
    console.log(`- ${source.organization}: ${source.url}（${source.reason}）`);
  });
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
