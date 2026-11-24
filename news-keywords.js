'use strict';

function normalizeNewsText(value = '') {
  return String(value)
    .replace(/<(?:br|\/p|\/li)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/https?:\/\/[^\s<]+/gi, ' ')
    .normalize('NFKC')
    .toLowerCase();
}

function includesNewsKeyword(text, keyword) {
  const word = keyword.toLowerCase();
  if (/^[a-z0-9]{2,4}$/.test(word)) {
    return new RegExp(`(?<![a-z0-9])${word}(?![a-z0-9])`, 'u').test(text);
  }
  return text.includes(word);
}

module.exports = { normalizeNewsText, includesNewsKeyword };
