'use strict';

const OUTER_QUOTE_PAIRS = [
  ['「', '」'],
  ['『', '』'],
  ['“', '”'],
  ['‘', '’'],
  ['"', '"'],
  ["'", "'"]
];

function stripOuterQuotes(value) {
  let text = String(value || '').trim().replace(/^\*+|\*+$/g, '').trim();
  let changed = true;

  while (changed && text.length >= 2) {
    changed = false;
    for (const [open, close] of OUTER_QUOTE_PAIRS) {
      if (text.startsWith(open) && text.endsWith(close)) {
        text = text.slice(open.length, -close.length).trim();
        changed = true;
        break;
      }
    }
  }

  return text;
}

function isContextlessQuantity(value) {
  const text = String(value || '').replace(/\s+/g, '');
  return /^(?:約|およそ)?[0-9０-９,.，]+(?:万|億|千|百)?(?:坪|ha|ヘクタール|㎡|平方メートル|m2|km2|平方キロメートル|円|万円|億円|人|戸|羽|頭|台|件|回|年|か月|ヶ月|月|日|時間|分|秒|%|％)$/i.test(text);
}

function normalizeEvidence(items, limit = 2) {
  if (!Array.isArray(items)) return [];

  const normalized = [];
  const seen = new Set();

  for (const item of items) {
    const text = stripOuterQuotes(item);
    if (!text || isContextlessQuantity(text) || seen.has(text)) continue;

    seen.add(text);
    normalized.push(text);
    if (normalized.length >= limit) break;
  }

  return normalized;
}

function normalizeAiGuideResult(result) {
  return {
    ...result,
    evidence: normalizeEvidence(result?.evidence)
  };
}

module.exports = {
  isContextlessQuantity,
  normalizeAiGuideResult,
  normalizeEvidence,
  stripOuterQuotes
};
