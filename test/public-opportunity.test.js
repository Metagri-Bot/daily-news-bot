'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canonicalUrl,
  hasMaterialChange,
  opportunityId,
  opportunitySignature,
  parseJapaneseDate,
  extractDeadline,
  daysUntil,
  exclusionReason,
  scoreOpportunity,
  rankFromScore,
  qualifiesForNotification,
  emptyState,
  selectNewOpportunities,
  recordNotified,
  pruneState,
  buildOpportunityEmbed
} = require('../public-opportunity');

const {
  harvestLinks,
  looksLikeCall,
  shouldRecheck,
  extractBody
} = require('../public-opportunity-monitor');

const NOW = new Date('2026-07-30T07:30:00+09:00');

const IDEAL_CASE = {
  title: 'AI×「農山漁村」インパクト創出ソリューション実装プログラムの参加者公募について',
  organization: '農林水産省',
  url: 'https://www.maff.go.jp/j/press/kanbo/anpo/260727.html',
  deadline: '2026-08-29T17:00:00+09:00',
  body:
    '本プログラムは、生成AIを活用して農山漁村の地域課題を解決するソリューションの社会実装を支援します。' +
    '応募できる者は法人格を有する民間事業者又はコンソーシアムとし、自治体との共創実績を評価します。' +
    '現場実装に必要な人件費等の経費を補助し、優良事例は全国展開に向けて広報・事例化します。' +
    '応募締切は令和8年8月29日17時00分までとします。'
};

// --- URL正規化・同一性 ---

test('canonicalUrl removes utm parameters, fragments and trailing slash', () => {
  const url = 'HTTPS://WWW.MAFF.GO.JP/j/press/index.html/?utm_source=x&id=3#section';
  assert.equal(canonicalUrl(url), 'https://www.maff.go.jp/j/press/index.html?id=3');
});

test('opportunityId is stable across tracking parameters', () => {
  const a = { url: 'https://example.go.jp/kobo/a.html' };
  const b = { url: 'https://example.go.jp/kobo/a.html?utm_campaign=mail' };
  assert.equal(opportunityId(a), opportunityId(b));
});

test('opportunitySignature changes when the deadline changes', () => {
  const before = opportunitySignature(IDEAL_CASE);
  const after = opportunitySignature({ ...IDEAL_CASE, deadline: '2026-09-30T17:00:00+09:00' });
  assert.notEqual(before, after);
});

// --- 日付処理 ---

test('parseJapaneseDate handles 令和 with time', () => {
  const parsed = parseJapaneseDate('令和8年8月29日17時00分');
  assert.equal(parsed.toISOString(), new Date('2026-08-29T17:00:00+09:00').toISOString());
});

test('parseJapaneseDate falls back to end of day when no time is given', () => {
  const parsed = parseJapaneseDate('2026年8月29日');
  assert.equal(parsed.toISOString(), new Date('2026-08-29T23:59:59+09:00').toISOString());
});

test('parseJapaneseDate rejects non-date text', () => {
  assert.equal(parseJapaneseDate('随時受付'), null);
  assert.equal(parseJapaneseDate(''), null);
});

test('extractDeadline picks the later date of a range near the label', () => {
  const text = '公募期間 令和8年7月27日から令和8年8月29日17時00分まで。事業期間は令和9年3月まで。';
  const parsed = extractDeadline(text);
  assert.equal(parsed.toISOString(), new Date('2026-08-29T17:00:00+09:00').toISOString());
});

test('daysUntil returns negative values for past deadlines', () => {
  assert.ok(daysUntil('2026-07-01T00:00:00+09:00', NOW) < 0);
  assert.equal(daysUntil(null, NOW), null);
});

// --- 除外判定 ---

test('exclusionReason rejects pages that are not calls for applications', () => {
  const reason = exclusionReason(
    { title: '令和8年度農業予算の概要について', body: '予算の内訳を説明します。' },
    NOW
  );
  assert.equal(reason, '公募・募集の告知ではない');
});

test('exclusionReason rejects award results and tenders', () => {
  assert.match(
    exclusionReason(
      { title: 'スマート農業実証事業の採択結果について', body: '公募の結果を公表します。' },
      NOW
    ),
    /対象外の種別/
  );
  assert.match(
    exclusionReason(
      { title: '庁舎空調設備工事の一般競争入札の公告', body: '入札公告を掲示します。' },
      NOW
    ),
    /対象外の種別/
  );
});

test('exclusionReason rejects producer-only programs', () => {
  const reason = exclusionReason(
    {
      title: 'スマート農業機械導入支援事業の募集',
      body: '応募できるのは認定農業者に限ります。機械購入費を補助します。'
    },
    NOW
  );
  assert.ok(reason);
});

test('exclusionReason rejects expired calls', () => {
  const reason = exclusionReason(
    { ...IDEAL_CASE, deadline: '2026-07-01T17:00:00+09:00' },
    NOW
  );
  assert.equal(reason, '締切済み');
});

// --- 採点 ---

test('scoreOpportunity ranks the reference MAFF program as S', () => {
  const result = scoreOpportunity(IDEAL_CASE, NOW);
  assert.equal(result.excluded, false);
  assert.equal(result.breakdown.theme, 25);
  assert.equal(result.breakdown.eligibility, 15);
  assert.ok(result.score >= 80, `score was ${result.score}`);
  assert.equal(result.rank, 'S');
  assert.ok(qualifiesForNotification(result));
});

test('scoreOpportunity keeps a thin DX call below the notification threshold', () => {
  const result = scoreOpportunity(
    {
      title: '窓口業務DX推進に関する提案募集',
      organization: '某市',
      url: 'https://example.lg.jp/dx.html',
      deadline: '2026-10-31T17:00:00+09:00',
      body: 'デジタル技術を用いた窓口業務の効率化について提案を募集します。'
    },
    NOW
  );
  assert.ok(result.score < 65, `score was ${result.score}`);
  assert.ok(!qualifiesForNotification(result));
});

test('scoreOpportunity gives an unknown deadline a lower feasibility and urgency score', () => {
  const withDeadline = scoreOpportunity(IDEAL_CASE, NOW);
  const withoutDeadline = scoreOpportunity({ ...IDEAL_CASE, deadline: null }, NOW);
  assert.ok(withoutDeadline.score < withDeadline.score);
});

test('rankFromScore follows the documented rubric boundaries', () => {
  assert.equal(rankFromScore(80), 'S');
  assert.equal(rankFromScore(79), 'A');
  assert.equal(rankFromScore(65), 'A');
  assert.equal(rankFromScore(64), 'B');
  assert.equal(rankFromScore(49), 'C');
});

// --- 重複除外 ---

test('selectNewOpportunities reports new items and suppresses unchanged ones', () => {
  const scored = { ...IDEAL_CASE, rank: 'S', score: 90 };
  const first = selectNewOpportunities([scored], emptyState());
  assert.equal(first.length, 1);
  assert.equal(first[0].updated, false);

  const state = recordNotified(emptyState(), first, NOW.toISOString());
  assert.equal(selectNewOpportunities([scored], state).length, 0);
});

test('selectNewOpportunities re-notifies when the deadline is updated', () => {
  const scored = { ...IDEAL_CASE, rank: 'S', score: 90 };
  const state = recordNotified(
    emptyState(),
    selectNewOpportunities([scored], emptyState()),
    NOW.toISOString()
  );

  const updated = selectNewOpportunities(
    [{ ...scored, deadline: '2026-09-30T17:00:00+09:00' }],
    state
  );
  assert.equal(updated.length, 1);
  assert.equal(updated[0].updated, true);
});

test('タイトルだけが変わった場合は再通知しない（AI表現の揺れ・セル書式対策）', () => {
  const scored = { ...IDEAL_CASE, rank: 'S', score: 90 };
  const state = recordNotified(
    emptyState(),
    selectNewOpportunities([scored], emptyState()),
    NOW.toISOString()
  );

  const retitled = { ...scored, title: 'AI×農山漁村 実装プログラム（第2回公募）' };
  assert.equal(selectNewOpportunities([retitled], state).length, 0);
});

test('締切が読めない状態が続く案件を毎回再通知しない', () => {
  const noDeadline = { ...IDEAL_CASE, deadline: null, rank: 'A', score: 70 };
  const state = recordNotified(
    emptyState(),
    selectNewOpportunities([noDeadline], emptyState()),
    NOW.toISOString()
  );

  const nextRun = { ...noDeadline, title: `${noDeadline.title}（詳細）`, summary: '別の抜粋' };
  assert.equal(selectNewOpportunities([nextRun], state).length, 0);
});

test('hasMaterialChange は締切の時刻だけを見る', () => {
  const previous = { deadline: '2026-08-29T17:00:00+09:00' };
  assert.equal(hasMaterialChange(previous, { deadline: '2026-08-29T08:00:00Z' }), false, '同じ時刻の別表記は変化なし');
  assert.equal(hasMaterialChange(previous, { deadline: '2026-09-30T17:00:00+09:00' }), true);
  assert.equal(hasMaterialChange(previous, { deadline: null }), true, '締切が消えた場合は要通知');
  assert.equal(hasMaterialChange({ deadline: null }, { deadline: null }), false);
  assert.equal(hasMaterialChange({ deadline: '不明' }, { deadline: '要確認' }), false, '解釈不能同士は変化なし');
});

test('selectNewOpportunities de-duplicates within a single run', () => {
  const scored = { ...IDEAL_CASE, rank: 'S', score: 90 };
  const duplicate = { ...scored, url: `${scored.url}?utm_source=discord` };
  assert.equal(selectNewOpportunities([scored, duplicate], emptyState()).length, 1);
});

test('pruneState drops entries older than the retention window', () => {
  const state = recordNotified(
    emptyState(),
    selectNewOpportunities([{ ...IDEAL_CASE, rank: 'S', score: 90 }], emptyState()),
    '2024-01-01T00:00:00+09:00'
  );
  assert.equal(Object.keys(pruneState(state, NOW).seen).length, 0);
});

// --- 表示 ---

test('buildOpportunityEmbed renders rank, deadline countdown and fields', () => {
  const evaluation = scoreOpportunity(IDEAL_CASE, NOW);
  const embed = buildOpportunityEmbed(
    {
      ...IDEAL_CASE,
      ...evaluation,
      fit_reasons: ['白井市のAIコンテスト運営実績', 'Metagri研究所の農家1,300人ネットワーク'],
      use_cases: ['予算', '広報'],
      action: '公募要領を確認して事務局へ参加要件を照会する'
    },
    { now: NOW }
  );

  assert.match(embed.title, /^【S・\d+点】/);
  assert.equal(embed.url, canonicalUrl(IDEAL_CASE.url));
  assert.match(embed.fields[0].value, /残り約30日/);
  assert.match(embed.fields[1].value, /• 白井市/);
  assert.equal(embed.fields[2].value, '予算 / 広報');
});

test('buildOpportunityEmbed marks updated items with a prefix', () => {
  const embed = buildOpportunityEmbed(
    { ...IDEAL_CASE, rank: 'A', score: 70 },
    { updated: true, now: NOW }
  );
  assert.match(embed.title, /^更新｜【A・70点】/);
});

test('buildOpportunityEmbed falls back to 要確認 when the deadline is missing', () => {
  const embed = buildOpportunityEmbed(
    { ...IDEAL_CASE, deadline: null, rank: 'A', score: 70 },
    { now: NOW }
  );
  assert.match(embed.fields[0].value, /要確認/);
});

// --- 収集ロジック ---

test('looksLikeCall requires both a call word and a theme word', () => {
  assert.ok(looksLikeCall('スマート農業技術活用促進の公募について'));
  assert.ok(!looksLikeCall('入札公告'));
  assert.ok(!looksLikeCall('職員採用のお知らせ'));
});

test('harvestLinks keeps same-host call links and skips navigation noise', () => {
  const html = `
    <html><body>
      <a href="/j/press/kanbo/260727.html">生成AIを活用した農山漁村の課題解決に関する公募について</a>
      <a href="/j/press/kanbo/result.html">お問い合わせ</a>
      <a href="https://other.example.com/j/press/x.html">農業AI公募のお知らせ</a>
      <a href="/j/supply/kobo.pdf">スマート農業実証の公募要領</a>
    </body></html>`;

  const links = harvestLinks(html, {
    id: 'maff-press',
    organization: '農林水産省',
    url: 'https://www.maff.go.jp/j/press/index.html',
    linkFilter: /^\/j\//i
  });

  assert.equal(links.length, 2);
  assert.equal(links[0].url, 'https://www.maff.go.jp/j/press/kanbo/260727.html');
  assert.equal(links[1].is_document, true);
});

test('extractBody strips navigation and returns readable text', () => {
  const filler = 'この公募は農業分野における生成AIの社会実装を支援するものです。'.repeat(12);
  const body = extractBody(`
    <html><body>
      <nav>グローバルナビ</nav>
      <main><p>${filler}</p></main>
      <footer>フッター</footer>
    </body></html>`);

  assert.ok(body.includes('生成AI'));
  assert.ok(!body.includes('グローバルナビ'));
  assert.ok(!body.includes('フッター'));
});

test('shouldRecheck waits for the interval and skips expired calls', () => {
  const recent = { last_checked_at: '2026-07-28T07:30:00+09:00', deadline: '2026-09-01T00:00:00+09:00' };
  const stale = { last_checked_at: '2026-07-01T07:30:00+09:00', deadline: '2026-09-01T00:00:00+09:00' };
  const expired = { last_checked_at: '2026-07-01T07:30:00+09:00', deadline: '2026-07-10T00:00:00+09:00' };

  assert.equal(shouldRecheck(recent, NOW), false);
  assert.equal(shouldRecheck(stale, NOW), true);
  assert.equal(shouldRecheck(expired, NOW), false);
});
