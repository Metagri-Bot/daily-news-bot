'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  extractUrls,
  isPrivateAddress,
  collectLinkInfos,
  buildLinkSupplementSection,
  buildTrendSupplementSection,
  buildDiaryDraftSupplement
} = require('../diary-supplement');

test('extractUrls: 本文からURLを拾い、Discord自身のリンクと重複は除く', () => {
  const content = [
    '見てください https://example.com/a?utm_source=ig 。',
    'こっちも https://example.com/a?utm_source=ig 重複。',
    'これはリンクじゃない https://discord.com/channels/1/2/3',
    '（括弧の中 https://example.com/b）'
  ].join('\n');

  const urls = extractUrls(content);
  assert.deepStrictEqual(urls, ['https://example.com/a?utm_source=ig', 'https://example.com/b']);
});

test('extractUrls: http/https以外・不正なURLは無視する', () => {
  assert.deepStrictEqual(extractUrls('javascript:alert(1) と ftp://example.com/x'), []);
  assert.deepStrictEqual(extractUrls(''), []);
  assert.deepStrictEqual(extractUrls(null), []);
});

test('isPrivateAddress: プライベート/ループバック/リンクローカルを弾く', () => {
  assert.strictEqual(isPrivateAddress('127.0.0.1'), true);
  assert.strictEqual(isPrivateAddress('10.0.0.5'), true);
  assert.strictEqual(isPrivateAddress('172.16.0.1'), true);
  assert.strictEqual(isPrivateAddress('192.168.1.1'), true);
  assert.strictEqual(isPrivateAddress('169.254.169.254'), true);   // クラウドのメタデータエンドポイント
  assert.strictEqual(isPrivateAddress('::1'), true);
  assert.strictEqual(isPrivateAddress('fe80::1'), true);
  assert.strictEqual(isPrivateAddress('8.8.8.8'), false);
  assert.strictEqual(isPrivateAddress('93.184.216.34'), false);
});

test('collectLinkInfos: URLが無ければfetchLinkInfoを一度も呼ばない', async () => {
  let called = 0;
  const result = await collectLinkInfos(
    [{ content: 'URLなしの投稿' }],
    { fetchLinkInfo: async () => { called++; return {}; } }
  );
  assert.strictEqual(result.length, 0);
  assert.strictEqual(called, 0);
});

test('collectLinkInfos: 複数行にまたがるURLも重複排除しつつ取得する', async () => {
  const seen = [];
  const rows = [
    { content: '参考: https://a.example/1' },
    { content: 'もう一度同じの https://a.example/1 と https://b.example/2' }
  ];
  const result = await collectLinkInfos(rows, {
    fetchLinkInfo: async url => { seen.push(url); return { url, title: `title:${url}`, description: null }; }
  });

  assert.strictEqual(seen.length, 2);
  assert.deepStrictEqual(result.map(r => r.url).sort(), ['https://a.example/1', 'https://b.example/2']);
});

test('collectLinkInfos: 1件が失敗しても他の取得を止めない', async () => {
  const rows = [{ content: 'https://ok.example/1 https://ng.example/2' }];
  const result = await collectLinkInfos(rows, {
    fetchLinkInfo: async url => {
      if (url.includes('ng')) throw new Error('timeout');
      return { url, title: 'OK', description: null };
    },
    logger: { error: () => {} }
  });

  const ok = result.find(r => r.url.includes('ok'));
  const ng = result.find(r => r.url.includes('ng'));
  assert.strictEqual(ok.title, 'OK');
  assert.ok(ng.error);
});

test('buildLinkSupplementSection: タイトル・説明を箇条書きにし、取得失敗は別枠にまとめる', () => {
  const lines = buildLinkSupplementSection([
    { url: 'https://a.example', title: 'Aのタイトル', description: 'Aの説明' },
    { url: 'https://b.example', title: null, description: null, error: 'timeout' }
  ]);

  const text = lines.join('\n');
  assert.match(text, /### 🔗 投稿内リンクの実情報/);
  assert.match(text, /- https:\/\/a\.example/);
  assert.match(text, /タイトル: Aのタイトル/);
  assert.match(text, /説明: Aの説明/);
  assert.match(text, /🔴 取得できなかったリンク.*https:\/\/b\.example/);
});

test('buildLinkSupplementSection: 何もなければ空配列（新しい区切りを生まない）', () => {
  assert.deepStrictEqual(buildLinkSupplementSection([]), []);
});

test('buildTrendSupplementSection: 過去平均より今日が少ない日にだけ「薄い日」フラグを出す', () => {
  const dailyCounts = [
    { date: '2026-09-10', channelId: '1', channelName: 'A', count: 10 },
    { date: '2026-09-11', channelId: '1', channelName: 'A', count: 10 },
    { date: '2026-09-12', channelId: '1', channelName: 'A', count: 10 },
    // 対象日（9/17）は除外対象。混ざっていても平均計算から外れることを確認する
    { date: '2026-09-17', channelId: '1', channelName: 'A', count: 999 }
  ];

  const lines = buildTrendSupplementSection({
    dailyCounts,
    sourceChannelIds: ['1'],
    perChannelToday: [{ channelId: '1', count: 1 }],
    fromText: '2026-09-17'
  });

  const text = lines.join('\n');
  assert.match(text, /過去3日平均: 10\.0件\/日 → 今日: 1件/);
  assert.match(text, /🔵 平均より少なめです/);
  assert.doesNotMatch(text, /999/);   // 対象日ぶんが平均に混ざっていない
});

test('buildTrendSupplementSection: 平均並みなら「薄い日」フラグは出さない', () => {
  const dailyCounts = [
    { date: '2026-09-10', channelId: '1', channelName: 'A', count: 5 },
    { date: '2026-09-11', channelId: '1', channelName: 'A', count: 5 }
  ];
  const lines = buildTrendSupplementSection({
    dailyCounts,
    sourceChannelIds: ['1'],
    perChannelToday: [{ channelId: '1', count: 5 }],
    fromText: '2026-09-17'
  });
  assert.doesNotMatch(lines.join('\n'), /薄い日/);
});

test('buildTrendSupplementSection: 普段投稿があるのに今日0件のチャンネルを指摘する', () => {
  const dailyCounts = [
    { date: '2026-09-14', channelId: '9', channelName: 'quiet', count: 1 },
    { date: '2026-09-15', channelId: '9', channelName: 'quiet', count: 1 },
    { date: '2026-09-16', channelId: '9', channelName: 'quiet', count: 1 }
  ];
  const lines = buildTrendSupplementSection({
    dailyCounts,
    sourceChannelIds: ['9'],
    perChannelToday: [{ channelId: '9', count: 0 }],
    fromText: '2026-09-17'
  });
  assert.match(lines.join('\n'), /<#9> は過去3日平均1\.0件\/日ですが、今日は0件/);
});

test('buildTrendSupplementSection: データが無ければ空配列', () => {
  assert.deepStrictEqual(buildTrendSupplementSection({ dailyCounts: [], fromText: '2026-09-17' }), []);
});

test('buildDiaryDraftSupplement: リンク取得・傾向取得のどちらか一方が失敗しても投稿全体は止まらない', async () => {
  const supplement = await buildDiaryDraftSupplement({
    rows: [{ content: 'https://a.example' }],
    sourceChannelIds: ['1'],
    perChannelToday: [{ channelId: '1', count: 1 }],
    fromText: '2026-09-17',
    dailyCounts: [{ date: '2026-09-10', channelId: '1', channelName: 'A', count: 4 }],
    fetchLinkInfo: async () => { throw new Error('network down'); },
    logger: { error: () => {} }
  });

  // リンク取得は失敗扱いで「取得できなかった」欄に残り、傾向メモは生成される
  assert.match(supplement, /🔴 取得できなかったリンク/);
  assert.match(supplement, /過去との比較/);
});

test('buildDiaryDraftSupplement: 両方無効なら空文字', async () => {
  const supplement = await buildDiaryDraftSupplement({
    rows: [{ content: 'https://a.example' }],
    dailyCounts: [{ date: '2026-09-10', channelId: '1', channelName: 'A', count: 4 }],
    enableLinkSupplement: false,
    enableTrendSupplement: false
  });
  assert.strictEqual(supplement, '');
});
