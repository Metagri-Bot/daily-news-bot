'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, '..', 'MorningPodcast.gs'), 'utf8');

function loadPodcast(services = {}) {
  const runtime = vm.createContext({ console: { log() {}, warn() {} }, ...services });
  vm.runInContext(source, runtime);
  return runtime;
}

function wav(seconds) {
  const bytes = Buffer.alloc(54 + seconds * 48000);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt32LE(48000, 28);
  bytes.write('JUNK', 36);
  bytes.writeUInt32LE(1, 40);
  bytes.write('data', 46);
  bytes.writeUInt32LE(seconds * 48000, 50);
  return bytes;
}

test('WAVの尺を実測し、3分と5分の境界を含めて判定する', () => {
  const gas = loadPodcast();
  for (const seconds of [179, 180, 234, 300, 301]) {
    const bytes = wav(seconds);
    assert.equal(gas.podcastWavSeconds_(bytes), seconds);
    assert.equal(gas.podcastDurationOk_(seconds), seconds >= 180 && seconds <= 300);
    assert.throws(() => gas.podcastWavSeconds_(bytes.subarray(0, bytes.length - 1)), /WAV/);
  }
});

test('URLの追跡パラメーターや転載見出しで同じ話題を照合する', () => {
  const gas = loadPodcast();
  const title = 'JA帯広かわにし ロボットトラクターでナガイモ収穫の省人化を実証';
  const past = { url: 'https://Example.jp/article/1/?utm_source=rss#head', title };
  assert.equal(gas.podcastUrlKey_(past.url), 'example.jp/article/1');
  assert(gas.podcastIsDuplicate_({ url: 'https://example.jp/article/1', title: '別の見出し' }, [past]));
  assert(gas.podcastIsDuplicate_({ url: 'https://other.jp/a/7', title: title + '（日本農業新聞）' }, [past]));
  assert(!gas.podcastIsDuplicate_({ url: 'https://example.jp/article/1?id=2', title: '別の話題' }, [past]));
  assert(!gas.podcastIsDuplicate_({ title: '北海道における鳥インフルエンザ疑似患畜の確認（国内4例目）' },
    [{ title: '北海道における鳥インフルエンザ疑似患畜の確認（国内5例目）' }]));
});

test('記事にない数値が紹介文や台本に入ったときに保留する', () => {
  const gas = loadPodcast();
  const sources = Array.from({ length: 4 }, (_, i) => ({
    id: i + 1, url: 'https://example.jp/articles/' + i, title: '農業ニュース' + i, evidence: '対象は１,２３４戸。',
  }));
  const draft = {
    headline: '地域農業の取り組み',
    intro: 'おはようございます。毎日ニュースです。',
    closing: '以上、今日のニュースをお届けしました。',
    stories: sources.map(source => ({
      id: source.id, event: '地域で始まった取り組み' + source.id, summary: '対象は1234戸。',
      turns: [
        { speaker: 'Host', text: '確認'.repeat(50) },
        { speaker: 'Analyst', text: '確認'.repeat(source.id === 1 ? 150 : 95) },
      ],
    })),
  };
  assert.equal(gas.podcastValidateScript_(draft, sources, []).stories.length, 4);
  draft.stories[0].summary = '対象は1235戸。';
  assert.throws(() => gas.podcastValidateScript_(draft, sources, []), /出典で確認できない数値/);
});

test('通常回の尺が短いときは保留し、同じ台本で再試行して1通だけ通知する', () => {
  const files = new Map();
  const properties = new Map([['GEMINI_API_KEY', 'test-key'], ['PODCAST_FOLDER_ID', 'test-folder']]);
  const calls = { text: 0, audio: [], mail: [] };
  const props = { getProperty: key => properties.get(key), setProperty: (key, value) => properties.set(key, value) };
  const folder = {
    getFilesByName: name => ({ hasNext: () => files.has(name), next: () => files.get(name) }),
    createFile: (name, content) => {
      if (typeof name !== 'string') ({ name, content } = name);
      const file = {
        getBlob: () => ({ getDataAsString: () => content }),
        getUrl: () => 'https://drive.example.com/file',
        setContent: updated => { content = updated; },
      };
      files.set(name, file);
      return file;
    },
    getUrl: () => 'https://drive.example.com/folder',
  };
  const gas = loadPodcast({
    PropertiesService: { getScriptProperties: () => props },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    DriveApp: { getFolderById: () => folder },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
    MailApp: { getRemainingDailyQuota: () => 9, sendEmail: (...args) => calls.mail.push(args) },
    Utilities: { newBlob: (content, type, name) => ({ content, type, name }) },
  });
  const stories = Array.from({ length: 4 }, (_, i) => ({ title: '記事' + i, url: 'https://example.com/' + i, summary: '概要' }));
  gas.podcastSelectSources_ = () => ({ sources: stories, history: [] });
  gas.podcastWriteScript_ = () => {
    calls.text++;
    return { version: 3, headline: '農業ニュース', stories, turns: [] };
  };
  gas.podcastSpeak_ = (key, turns, test, rejectedSeconds) => {
    calls.audio.push(rejectedSeconds);
    return wav(rejectedSeconds ? 234 : 90);
  };
  const date = '2026-11-25';
  gas.podcastRun_(date, 'daily');
  assert.deepEqual([...files.keys()], [date + '_農業ニュース.json']);
  assert.equal(calls.mail.length, 0);

  gas.podcastRun_(date, 'daily');
  gas.podcastRun_(date, 'daily');
  assert.equal(calls.text, 1);
  assert.deepEqual(calls.audio, [undefined, 90]);
  assert.equal(calls.mail.length, 1);
  assert.match(calls.mail[0][2], /3分54秒・4件/);
  assert(files.has(date + '_農業ニュース.wav'));
});
