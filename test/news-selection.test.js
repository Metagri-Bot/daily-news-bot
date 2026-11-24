'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { getHeadlineFeedUrls, readHeadlineHistory } = require('../news-headline-feeds');
const { recoverHeadlineHistory } = require('../news-headline-history');
const { newsUrlKey, selectNewsHeadlines } = require('../news-selection');

const now = new Date('2026-11-24T06:00:00+09:00');
const date = '2026-11-23T08:00:00+09:00';
const observed = (title, link, fields = {}) => ({ title, link, pubDate: date, ...fields });

test('旧農水省RSSを差し替え、両方の設定にあるURLを一度だけ取得する', () => {
  const maff = 'https://www.maff.go.jp/rss.xml';
  const defaults = getHeadlineFeedUrls();
  assert.ok(defaults.includes('https://www.jfa.maff.go.jp/rss.xml'));
  assert.deepEqual(getHeadlineFeedUrls(` https://www.maff.go.jp/j/new/rss.xml,${maff}`, `${maff}, ,`), [maff, ...defaults]);
});

test('投稿履歴は旧APIのURL配列と新APIの日時・タイトル付き配列を読める', async () => {
  const url = 'https://example.org/news/1';
  const entry = { url, title: '農家がAIを導入して作業記録を改善', postedAt: date };
  for (const history of [[url], [entry]]) {
    const result = await readHeadlineHistory('https://example.org/history', async (_, options) => {
      assert.equal(options.params.type, 'getPostedNewsArticles');
      return { data: history };
    });
    assert.deepEqual(result, history[0] === url ? [{ url }] : history);
  }
  await assert.rejects(readHeadlineHistory('https://example.org/history', async () => ({ data: {} })), /投稿履歴/);
});

test('農業の接点が薄い告知を落とし、公式発表と現場事例を残す', () => {
  const retail = observed('三千個売れた濃厚抹茶バターサンドを数量限定で再販', 'https://prtimes.jp/news/1');
  const flavor = observed('農園カフェで季節限定の新メニューが登場', 'https://www.atpress.ne.jp/news/1', {
    contentSnippet: '地域の高校生と連携し、予約販売を開始しました。'
  });
  const official = observed('鳥インフルエンザ確認に伴い防疫対策本部を開催', 'https://www.maff.go.jp/j/press/1');
  const ai = observed('ブルーベリー農家、ChatGPTを活用して販促物を作成', 'https://local.example/news/1');
  const { selected, rejected } = selectNewsHeadlines([retail, flavor, official, ai], { now });
  assert.deepEqual(selected.map(article => article.link), [ai.link, official.link]);
  assert.equal(rejected['商品・イベントの販促'], 1);
  assert.equal(rejected['農業・現場との関連が薄い'], 1);
  assert.equal(selected[0].isFarmerAiUseCase, true);
  assert.equal(selected[0].isoDate, new Date(date).toISOString());
});

test('48時間以内を優先し、広域PR配信は1枠までにする', () => {
  const pr1 = observed('農業法人が新品種を育成し契約栽培の実証を開始', 'https://prtimes.jp/news/1');
  const pr2 = observed('農家が選果ロボットを導入し人手不足対策を開始', 'https://www.atpress.ne.jp/news/2');
  const local = observed('地方の農協が稲作の省力化に向け水田にセンサーを導入', 'https://local.example/news/1');
  const older = observed('農家がAIを活用して作業記録を改善、農園と大学が連携', 'https://old.example/news/1', {
    pubDate: '2026-11-20T06:00:00+09:00'
  });
  const outside = { ...older, title: '別の農家がAIを活用して作業記録を改善', link: 'https://old.example/news/2', pubDate: '2026-11-16T06:00:00+09:00' };
  const futures = { ...older, link: 'https://old.example/news/3', pubDate: '2026-11-24T06:00:01+09:00' };
  const { selected, rejected } = selectNewsHeadlines([older, local, pr1, pr2, outside, futures], { now });
  assert.equal(selected.length, 3);
  assert.equal(selected.filter(article => article.press).length, 1);
  assert.equal(selected.at(-1).link, older.link);
  assert.equal(rejected['公開日が期間外・不明'], 2);
});

test('過去の現URLと追跡パラメータ違い、過去7日の転載、同じ回の重複を省く', () => {
  const article = observed('農家が選果ロボットを導入、作業人数を半分に削減', 'https://example.org/news/1/?id=9&utm_source=rss#news');
  const reprint = observed(`${article.title}（日本農業新聞）`, 'https://example.net/news/1');
  const two = observed('農園が病害虫対策にドローンを導入し作業時間の削減を実証', 'https://sample.org/news/2');
  const twoReprint = { ...two, link: 'https://sample.net/news/2' };
  const history = [
    'https://example.org/news/1?id=9',
    { url: 'https://original.example/article/1', title: article.title, postedAt: date }
  ];
  const { selected, rejected } = selectNewsHeadlines([article, reprint, two, twoReprint], { history, now });
  assert.equal(newsUrlKey(article.link), newsUrlKey(history[0]));
  assert.notEqual(newsUrlKey('https://example.org/news/1?id=10'), newsUrlKey(history[0]));
  assert.equal(rejected['投稿済み'], 2);
  assert.equal(rejected['同じ回の重複'], 1);
  assert.equal(selected.length, 1);
});

test('配信版の見出しが編集されても既出を省き、同型の別事例は残す', () => {
  const reprints = [
    observed('各務原にんじん　クラフトコーラ誕生　ＪＡぎふ栽培指導　地元大学生の思い実る', 'https://www.agrinews.co.jp/society/index/420562'),
    observed('青蜜柑マーマレード人気　真鶴町・矢島農園　摘果丸ごと活用', 'https://www.agrinews.co.jp/society/index/419693'),
    observed('静岡県が育成プロジェクト　自衛官を担い手に　退職予定者の就農支援', 'https://www.agrinews.co.jp/society/index/419696')
  ];
  const update = observed('愛知県における高病原性鳥インフルエンザの疑似患畜の確認（国内4例目）及び防疫対策本部の開催', 'https://www.maff.go.jp/j/press/4');
  const history = [
    { title: '各務原にんじんでコーラ　地元大学生の思い実る(日本農業新聞)', postedAt: date },
    { title: '「青蜜柑マーマレード」人気　真鶴町・矢島農園　摘果ミカンを丸ごと活用(日本農業新聞)', postedAt: date },
    { title: '自衛官を農業〝担い手〟に　静岡県が育成プロジェクト　退職予定者の就農支援(日本農業新聞)', postedAt: date },
    { title: '愛知県における高病原性鳥インフルエンザの疑似患畜の確認（国内3例目）及び防疫対策本部の開催', postedAt: date }
  ];
  const { selected, rejected } = selectNewsHeadlines([...reprints, update], { history, now });
  assert.equal(rejected['投稿済み'], 3);
  assert.deepEqual(selected.map(article => article.link), [update.link]);
});

test('Discordの最近のBot本人のヘッドラインからだけURLとタイトルを回復する', async () => {
  const content = '### 🚀 最新情報ヘッドライン（1件）\n---\n**1. 選果ロボットを導入**\n✨ **厳選理由:** 現場技術\nhttps://local.example/news/1';
  const recent = { author: { id: 'bot' }, timestamp: date, content };
  const entries = await recoverHeadlineHistory(async () => [
    recent,
    { ...recent, author: { id: 'someone' } },
    { ...recent, content: '**1. 別の記事**\nhttps://local.example/news/2' },
    { ...recent, timestamp: '2026-11-01T00:00:00+09:00' }
  ], 'bot', now);
  assert.deepEqual(entries, [{ title: '選果ロボットを導入', url: 'https://local.example/news/1', postedAt: new Date(date).toISOString() }]);
});

test('GASはシートの旧形式、現形式、URLだけの履歴を読み取る', () => {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(resolve(__dirname, '../.gascode'), 'utf8'), context);
  const rows = [
    ['https://example.com/legacy', '旧形式', new Date(date)],
    [new Date(date), 'https://example.com/current', '現形式'],
    ['https://example.com/url-only', '', ''],
    ['日付', 'URLではない', 'その他']
  ];
  const sheet = { getLastRow: () => rows.length + 1, getRange: () => ({ getValues: () => rows }) };
  const entries = JSON.parse(JSON.stringify(context.readPostedNewsArticles_(sheet)));
  assert.deepEqual(entries, [
    { url: rows[0][0], title: '旧形式', postedAt: new Date(date).toISOString() },
    { url: rows[1][1], title: '現形式', postedAt: new Date(date).toISOString() },
    { url: rows[2][0], title: '', postedAt: null }
  ]);
});

test('農林水産の技術実証と現場でのAI利用を拾い、一般AI記事や講習案内には加点しない', () => {
  const titles = ['森林組合がLiDARで立木を計測', '漁協が機械学習で漁場を予測', '乳牛の行動を画像認識で推定'];
  const articles = titles.map((title, i) => observed(title, 'https://local.example/' + i));
  const other = ['生成AIで広告を自動化', '森林組合のドローン導入セミナー', '漁協がメールの運用を開始'];
  const { selected } = selectNewsHeadlines([...articles, ...other.map((title, i) =>
    observed(title, 'https://local.example/other/' + i))], { now });
  assert.deepEqual(new Set(selected.map(a => a.title)), new Set(titles));
  assert.deepEqual(new Set(selected.map(a => a.priorityLabel)),
    new Set(['林業の先端技術', '水産のAI活用・研究', '農業のAI活用・研究']));
});
