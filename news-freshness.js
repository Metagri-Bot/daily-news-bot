'use strict';

const NEWS_FRESHNESS_DAYS = 7;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function getArticlePublishedDate(article = {}) {
  const rawDate =
    article.isoDate ||
    article.pubDate ||
    article.pubdate ||
    article.published;

  if (!rawDate) return null;

  const publishedDate = new Date(rawDate);
  return Number.isNaN(publishedDate.getTime()) ? null : publishedDate;
}

/**
 * 記事の公開日時が、実行時点から指定日数以内かを判定する。
 * 日時不明・不正・未来日の記事は対象外。
 */
function isNewsWithinFreshness(
  article,
  now = new Date(),
  maxAgeDays = NEWS_FRESHNESS_DAYS
) {
  const publishedDate = getArticlePublishedDate(article);
  const referenceDate = new Date(now);

  if (
    !publishedDate ||
    Number.isNaN(referenceDate.getTime()) ||
    !Number.isFinite(maxAgeDays) ||
    maxAgeDays < 0
  ) {
    return false;
  }

  const publishedAt = publishedDate.getTime();
  const referenceAt = referenceDate.getTime();
  const cutoffAt = referenceAt - maxAgeDays * MILLISECONDS_PER_DAY;

  return publishedAt >= cutoffAt && publishedAt <= referenceAt;
}

module.exports = {
  NEWS_FRESHNESS_DAYS,
  getArticlePublishedDate,
  isNewsWithinFreshness
};
