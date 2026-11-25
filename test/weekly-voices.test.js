'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

function loadWeeklyVoices(services = {}) {
  const context = vm.createContext({ console: { log() {}, warn() {} }, ...services });
  for (const file of ['MorningPodcast.gs', 'WeeklyVoices.gs']) {
    vm.runInContext(readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  }
  return context;
}

test('号の日付は日本時間の日付を基準に火曜へ揃える', () => {
  const gas = loadWeeklyVoices();
  assert.equal(gas.weeklyVoicesIssueDate_('2026-11-24'), '2026-11-24');
  assert.equal(gas.weeklyVoicesIssueDate_('2026-11-25'), '2026-11-24');
  assert.equal(gas.weeklyVoicesIssueDate_('2026-11-30'), '2026-11-24');
  assert.equal(gas.weeklyVoicesIssueDate_('2026-12-01'), '2026-12-01');
  assert.equal(gas.weeklyVoicesIssueDate_('2026-12-02'), '2026-12-01');
});

test('独立した5件で台本と概要を作り、グリをSpeaker 1、メタをSpeaker 2にする', () => {
  const gas = loadWeeklyVoices();
  const sources = Array.from({ length: 5 }, (_, index) => ({
    id: index + 1, title: '独立した記事' + index, url: 'https://example.jp/news/' + index, evidence: '資料の本文',
  }));
  const draft = {
    headline: '水田管理の変化',
    overviewLead: '水位センサーを使った水田の見回りを取り上げます。',
    openingQuestion: '田んぼの見回りはどう変わるんですか？',
    takeaway: '見回りに何分かかるか、一度測ってみませんか？',
    stories: sources.map(source => ({
      id: source.id, event: '別の出来事' + source.id, summary: '出典の要約',
      turns: [
        { speaker: 'Analyst', text: (source.id === 2 ? '五つ目は、' : '') + '確認した話題について説明する文章です。'.repeat(8) },
        { speaker: 'Host', text: '具体的に確かめたい内容についての質問です。'.repeat(8) },
      ],
    })),
  };
  const period = '2026-11-19〜2026-11-25';
  const plan = gas.weeklyVoicesValidate_(draft, sources, [], period);
  assert.equal(plan.stories.length, 5);
  assert.match(gas.weeklyVoicesTranscript_(plan), /^Speaker 1:\nこの放送は[^\n]+\n\nSpeaker 2:\nはい、どうも〜！ メタです！/u);
  assert.match(gas.weeklyVoicesTranscript_(plan), /Speaker 2:\nまた火曜日に。バイバーイ！$/u);
  const openings = plan.turns.filter(turn => turn.speaker === 'Analyst' && turn.text.includes('確認した話題'));
  assert.deepEqual(Array.from(openings, turn => turn.text.split('確認した話題')[0]), [
    '', '二つ目は、', '三つ目は、', '四つ目は、', '最後は、',
  ]);
  const notes = gas.weeklyVoicesShowNotes_(plan);
  assert.equal(notes, [
    '【週刊農業ニュース5本】水田管理の変化', '',
    '水位センサーを使った水田の見回りを取り上げます。メタとグリが今週の農業ニュース5本をお届けします🌾',
    '対象期間：2026年11月19日〜25日', '',
    sources.map((source, index) => [
      (index + 1) + '. ' + source.title, '出典の要約', source.url,
    ].join('\n')).join('\n\n'), '',
    '出演 グリ・メタ（AI音声） ／ 制作 Metagri研究所',
    'BGM オリジナル（週刊農業ニュース）',
  ].join('\n'));
  assert.equal(gas.weeklyVoicesValidate_({ ...draft, stories: draft.stories.slice(0, 4) }, sources, [], period), null);
  assert.throws(() => gas.weeklyVoicesValidate_(draft, sources, [sources[0]], period), /すでに紹介/);
});

test('既存の概要データでも、年・月をまたぐ期間と出典URLを表示できる', () => {
  const gas = loadWeeklyVoices();
  const plan = {
    headline: '冬の農業ニュース',
    period: '2026-12-29〜2027-01-04',
    stories: [{ title: '冬の話題', summary: '概要です。', url: '\u2060https://example.jp/winter\u2060' }],
  };
  const notes = gas.weeklyVoicesShowNotes_(plan);
  assert.match(notes, /対象期間：2026年12月29日〜2027年1月4日/u);
  assert.match(notes, /概要です。\nhttps:\/\/example\.jp\/winter\n\n出演/u);
  assert.equal(gas.weeklyVoicesDisplayPeriod_('2026-11-29〜2026-12-05'), '2026年11月29日〜12月5日');
});

test('候補と別記事の要約・根拠が紐づく場合は拒否する', () => {
  const gas = loadWeeklyVoices();
  const source = {
    id: 4, url: 'https://example.jp/news/4', title: '水位センサーで水田管理を見直す',
    evidence: '水位センサーを使って離れた圃場の水位を確認する取り組みです。',
  };
  const story = {
    id: 4, sourceUrl: source.url, anchor: '水位センサー', factQuote: '離れた圃場の水位を確認する取り組みです',
    summary: '水位センサーで移動の負担を減らせるか検討する。',
    turns: [{ speaker: 'Analyst', text: '水位センサーを実際に使った事例です。' }],
  };
  assert.doesNotThrow(() => gas.weeklyVoicesCheckBindings_([story], [source]));
  assert.throws(() => gas.weeklyVoicesCheckBindings_([{ ...story, summary: 'トラクターの事例です。' }], [source]), /記事の根拠/);
  assert.throws(() => gas.weeklyVoicesCheckBindings_([{ ...story, factQuote: '別の農場で報告された取り組みです。' }], [source]), /記事の根拠/);
});

test('旧水曜の週刊トリガーを火曜に置き換え、再インストールでも重複を作らない', () => {
  const properties = new Map([['GEMINI_API_KEY', 'test-key'], ['WEEKLY_VOICES_FOLDER_ID', 'test-folder']]);
  const props = { getProperty: key => properties.get(key), setProperty: (key, value) => properties.set(key, value) };
  const clock = 'clock';
  const daily = { getHandlerFunction: () => 'runMorningPodcast', getTriggerSource: () => clock };
  const oldRun = { getHandlerFunction: () => 'runWeeklyVoices', getTriggerSource: () => clock, getUniqueId: () => 'old-run' };
  const oldRetry = { getHandlerFunction: () => 'retryWeeklyVoices', getTriggerSource: () => clock, getUniqueId: () => 'old-retry' };
  const triggers = [daily, oldRun, oldRetry];
  const deleted = [];
  properties.set('WEEKLY_VOICES_TRIGGER_SCHEDULE', JSON.stringify({
    runWeeklyVoices: { id: 'old-run', schedule: 'Asia/Tokyo WEDNESDAY 12:20' },
    retryWeeklyVoices: { id: 'old-retry', schedule: 'Asia/Tokyo WEDNESDAY 13:20' },
  }));
  const gas = loadWeeklyVoices({
    PropertiesService: { getScriptProperties: () => props },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    DriveApp: { getFolderById: () => ({}) },
    ScriptApp: {
      TriggerSource: { CLOCK: clock }, WeekDay: { TUESDAY: 'Tuesday' },
      getProjectTriggers: () => [...triggers],
      newTrigger: handler => ({
        timeBased() { return this; },
        everyWeeks(count) { assert.equal(count, 1); return this; },
        onWeekDay(day) { assert.equal(day, 'Tuesday'); return this; },
        atHour(hour) { assert.equal(hour, handler === 'runWeeklyVoices' ? 8 : 9); return this; },
        nearMinute(minute) { assert.equal(minute, 20); return this; },
        inTimezone(timezone) { assert.equal(timezone, 'Asia/Tokyo'); return this; },
        create() {
          const trigger = { getHandlerFunction: () => handler, getTriggerSource: () => clock, getUniqueId: () => handler };
          triggers.push(trigger);
          return trigger;
        },
      }),
      deleteTrigger(trigger) {
        assert([oldRun, oldRetry].includes(trigger));
        triggers.splice(triggers.indexOf(trigger), 1);
        deleted.push(trigger);
      },
    },
  });
  gas.installWeeklyVoices();
  gas.installWeeklyVoices();
  assert.deepEqual(deleted, [oldRun, oldRetry]);
  assert.deepEqual(triggers.map(trigger => trigger.getHandlerFunction()), ['runMorningPodcast', 'runWeeklyVoices', 'retryWeeklyVoices']);
});

test('週刊音声の有料予備はGeminiが無料の日次枠または利用可能枠ゼロを返した場合に限る', () => {
  const day = '2026-11-24';
  const quota = (quotaId, quotaMetric = 'generate_content_free_tier_requests', quotaValue = '4') => ({
    status: 429, body: { error: { status: 'RESOURCE_EXHAUSTED', details: [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId, quotaMetric, quotaValue }] },
    ] } },
  });
  const daily429 = quota('GenerateRequestsPerDayPerProjectPerModel-FreeTier');
  const minute429 = quota('GenerateRequestsPerMinutePerProjectPerModel-FreeTier');
  const success = { status: 200, body: { success: true } };
  function run(responses, { state, kind = 'audio', scope = 'WEEKLY_VOICES', probe = false, backup = 'test-backup' } = {}) {
    const stateKey = scope + '_API_' + kind.toUpperCase();
    const properties = new Map([['GEMINI_API_KEY_bk', backup], [stateKey, JSON.stringify(state || {})]]);
    const calls = [];
    const gas = loadWeeklyVoices({
      PropertiesService: { getScriptProperties: () => ({
        getProperty: key => properties.get(key),
        setProperty: (key, value) => properties.set(key, value),
      }) },
      Utilities: { formatDate: () => day },
      UrlFetchApp: { fetch: (_url, options) => {
        calls.push(options.headers['x-goog-api-key']);
        const response = responses.shift();
        assert.ok(response, '想定外のGeminiリクエスト');
        return { getResponseCode: () => response.status, getContentText: () => JSON.stringify(response.body) };
      } },
    });
    const data = gas.podcastRequest_('test-free', 'interactions', kind, {}, true, scope, probe);
    return { calls, data, state: JSON.parse(properties.get(stateKey)) };
  }
  assert.deepEqual(run([success]).calls, ['test-free']);
  assert.deepEqual(run([daily429, success]).calls, ['test-free', 'test-backup']);
  assert.deepEqual(run([quota('Unspecified', 'generate_content_free_tier_requests', '0'), success]).calls,
    ['test-free', 'test-backup']);
  assert.deepEqual(run([minute429]).calls, ['test-free']);
  assert.deepEqual(run([{ status: 429, body: { error: { status: 'RESOURCE_EXHAUSTED' } } }]).calls, ['test-free']);
  assert.deepEqual(run([quota('GenerateRequestsPerDayPerProject', 'paid_requests')]).calls, ['test-free']);
  assert.deepEqual(run([daily429], { backup: '' }).calls, ['test-free']);
  assert.deepEqual(run([daily429], { backup: 'test-free' }).calls, ['test-free']);
  assert.deepEqual(run([daily429], { scope: 'PODCAST' }).calls, ['test-free']);
  assert.deepEqual(run([daily429], { kind: 'text' }).calls, ['test-free']);
  assert.deepEqual(run([], { state: { date: day, count: 4 } }).calls, []);
  const verified = run([success], { state: { date: day, count: 4, limited: true }, probe: true });
  assert.deepEqual(verified.calls, ['test-free']);
  assert.equal(verified.state.freeQuotaProbeUsed, true);
  assert.deepEqual(run([], { state: verified.state, probe: true }).calls, []);
  const exhausted = run([daily429, success], { state: { date: day, count: 4 }, probe: true });
  assert.equal(exhausted.state.freeDailyQuotaExhausted, true);
  assert.deepEqual(run([success], { state: exhausted.state }).calls, ['test-backup']);
  assert.deepEqual(run([success], { state: { ...exhausted.state, date: '2026-11-23' } }).calls, ['test-free']);
});
