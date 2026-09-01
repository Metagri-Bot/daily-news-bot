#!/usr/bin/env node
'use strict';

/**
 * 監視先URLの生存確認。自治体サイトはリニューアルでURLが変わるため、
 * 月1回の実行を推奨する（実測でも鎌ケ谷市は2018年のリニューアルで旧URLを失っている）。
 *
 *   node scripts/check-chiba-tender-sources.js
 *
 * HTTPステータスだけでなく「候補を何件収穫できたか」も出す。
 * 200を返しながら中身が変わって0件になる壊れ方が、いちばん気づきにくいため。
 */

const axios = require('axios');

const { SOURCES, MANUAL_SOURCES } = require('../chiba-tender-sources');
const { harvestLinks, discoverListingUrls } = require('../chiba-tender-radar');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function check(source) {
  const started = Date.now();
  try {
    const response = await axios.get(source.url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 25000,
      maxRedirects: 5,
      responseType: 'text',
      validateStatus: () => true
    });

    const elapsed = Date.now() - started;
    const html = typeof response.data === 'string' ? response.data : '';
    let harvested = 0;
    let samples = [];
    let followed = 0;
    const nestedErrors = [];

    if (response.status === 200 && html) {
      const found = new Map();
      harvestLinks(html, source).links.forEach(link => found.set(link.url, link));

      const listingUrls = discoverListingUrls(html, source);
      followed = listingUrls.length;
      for (const listingUrl of listingUrls) {
        try {
          const listingResponse = await axios.get(listingUrl, {
            headers: { 'User-Agent': USER_AGENT },
            timeout: 25000,
            maxRedirects: 5,
            responseType: 'text',
            validateStatus: () => true
          });
          if (listingResponse.status !== 200) {
            nestedErrors.push(`${listingUrl}: HTTP ${listingResponse.status}`);
            continue;
          }
          harvestLinks(String(listingResponse.data || ''), { ...source, url: listingUrl }).links.forEach(
            link => found.set(link.url, link)
          );
        } catch (error) {
          nestedErrors.push(`${listingUrl}: ${error.message}`);
        }
      }

      const links = [...found.values()];
      harvested = links.length;
      samples = links.slice(0, 3).map(link => link.title);
    }

    return {
      id: source.id,
      organization: source.organization,
      label: source.label,
      status: response.status,
      bytes: html.length,
      elapsed_ms: elapsed,
      harvested,
      followed,
      nested_errors: nestedErrors,
      samples,
      empty_expected: Boolean(source.emptyExpected),
      ok: response.status === 200 && html.length > 1000 && nestedErrors.length === 0
    };
  } catch (error) {
    return {
      id: source.id,
      organization: source.organization,
      label: source.label,
      status: 'ERROR',
      error: error.message,
      harvested: 0,
      samples: [],
      ok: false
    };
  }
}

async function main() {
  console.log('=== 千葉県自治体案件レーダー 監視先チェック ===\n');

  const results = [];
  for (const source of SOURCES) {
    const result = await check(source);
    results.push(result);

    const mark = result.ok ? '✅' : '❌';
    const harvest = result.harvested === 0 && result.ok && !result.empty_expected ? ' ⚠ 収穫0件' : '';
    const followed = result.followed ? `／子ページ${result.followed}件` : '';
    console.log(
      `${mark} [${result.status}] ${result.organization}（${result.label}）` +
        ` 収穫${result.harvested}件${followed}${harvest}`
    );
    if (result.error) console.log(`   エラー: ${result.error}`);
    (result.nested_errors || []).forEach(error => console.log(`   子ページエラー: ${error}`));
    result.samples.forEach(sample => console.log(`   例: ${sample}`));
    console.log(`   ${source.url}\n`);
  }

  const dead = results.filter(result => !result.ok);
  const empty = results.filter(
    result => result.ok && result.harvested === 0 && !result.empty_expected
  );

  console.log('--- まとめ ---');
  console.log(`監視先 ${results.length}件／到達不能 ${dead.length}件／収穫0件 ${empty.length}件`);

  if (empty.length > 0) {
    console.log(
      '\n⚠ 収穫0件のソースは、URLが生きていてもページ構造が変わった可能性があります。' +
        '\n  「その週に公募が無かっただけ」との区別がつかないため、2回連続なら実物を目視してください。'
    );
  }

  console.log('\n--- 自動収集しない監視先（月1回 目視） ---');
  MANUAL_SOURCES.forEach(source => {
    console.log(`・${source.organization}（${source.label}）: ${source.url}`);
    console.log(`  理由: ${source.reason}`);
  });

  process.exitCode = dead.length > 0 ? 1 : 0;
}

main().catch(error => {
  console.error('チェックに失敗:', error.message);
  process.exitCode = 1;
});
