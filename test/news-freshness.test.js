'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  NEWS_FRESHNESS_DAYS,
  getArticlePublishedDate,
  isNewsWithinFreshness
} = require('../news-freshness');

const NOW = new Date('2026-07-30T00:00:00.000Z');

test('ニュース鮮度の標準期間は7日', () => {
  assert.equal(NEWS_FRESHNESS_DAYS, 7);
});

test('公開から7日以内の記事を対象にする', () => {
  assert.equal(
    isNewsWithinFreshness(
      { isoDate: '2026-07-23T00:00:00.000Z' },
      NOW
    ),
    true
  );
  assert.equal(
    isNewsWithinFreshness(
      { pubDate: '2026-07-29T12:00:00.000Z' },
      NOW
    ),
    true
  );
});

test('7日を1ミリ秒でも超えた記事を除外する', () => {
  assert.equal(
    isNewsWithinFreshness(
      { isoDate: '2026-07-22T23:59:59.999Z' },
      NOW
    ),
    false
  );
});

test('日時不明・不正・未来日の記事を除外する', () => {
  assert.equal(isNewsWithinFreshness({}, NOW), false);
  assert.equal(isNewsWithinFreshness({ isoDate: 'invalid' }, NOW), false);
  assert.equal(
    isNewsWithinFreshness(
      { isoDate: '2026-07-30T00:00:00.001Z' },
      NOW
    ),
    false
  );
});

test('RSSで使われる複数の日付フィールドを解釈する', () => {
  assert.equal(
    getArticlePublishedDate({ published: '2026-07-29T00:00:00.000Z' })
      .toISOString(),
    '2026-07-29T00:00:00.000Z'
  );
});
