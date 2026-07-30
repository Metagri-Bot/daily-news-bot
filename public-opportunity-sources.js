'use strict';

/**
 * 公募モニターの監視先定義。
 * Scheduled/public-opportunity-monitor/references/sources.md を移植。
 *
 * type:
 *   'rss'  … RSS/Atomフィードを直接読む
 *   'html' … 一覧ページのリンクを収穫し、詳細ページを読む
 *
 * linkFilter … 一覧ページから拾うリンクのパス条件（正規表現）
 * enabled   … false にすると収集対象から外れる（URL廃止時の一時停止用）
 *
 * 一覧ページのHTML構造は省庁側の改修で変わるため、セレクタ指定ではなく
 * 「リンクテキスト＋パス条件」で汎用的に収穫する方式にしている。
 */

const SOURCES = [
  // --- 優先度1：国の主要機関 ---
  {
    id: 'maff-hozyo',
    organization: '農林水産省',
    label: '補助事業参加者の公募',
    type: 'html',
    url: 'https://www.maff.go.jp/j/supply/hozyo/index.html',
    linkFilter: /^\/j\//i,
    priority: 1,
    enabled: true
  },
  {
    id: 'maff-press',
    organization: '農林水産省',
    label: '報道発表資料',
    type: 'html',
    url: 'https://www.maff.go.jp/j/press/index.html',
    linkFilter: /^\/j\/press\//i,
    priority: 1,
    enabled: true
  },
  {
    id: 'meti-kobo',
    organization: '経済産業省',
    label: '公募情報',
    type: 'html',
    url: 'https://www.meti.go.jp/information/publicoffer/kobo.html',
    linkFilter: /(information|press|policy)/i,
    priority: 1,
    enabled: true
  },
  {
    id: 'digital-news',
    organization: 'デジタル庁',
    label: '新着情報',
    type: 'html',
    url: 'https://www.digital.go.jp/news',
    linkFilter: /^\/(news|procurement)/i,
    priority: 1,
    enabled: true
  },
  {
    id: 'digital-procurement',
    organization: 'デジタル庁',
    label: '調達情報',
    type: 'html',
    url: 'https://www.digital.go.jp/procurement',
    linkFilter: /^\/procurement/i,
    priority: 1,
    enabled: true
  },
  {
    id: 'kankocho-kobo',
    organization: '観光庁',
    label: '募集中一覧',
    type: 'html',
    url: 'https://www.mlit.go.jp/kankocho/kobo_boshu.html',
    linkFilter: /kankocho/i,
    priority: 1,
    enabled: true
  },

  // --- 優先度2：技術・中小企業・地域 ---
  {
    id: 'nedo-koubo',
    organization: 'NEDO',
    label: '公募情報',
    type: 'html',
    url: 'https://www.nedo.go.jp/koubo/index.html',
    linkFilter: /koubo/i,
    priority: 2,
    enabled: true
  },
  {
    id: 'ipa-kobo',
    organization: 'IPA',
    label: '公募情報',
    // 旧 /about/kobo/ は廃止。2026-07-30時点の現行URLは /choutatsu/koubo/
    type: 'html',
    url: 'https://www.ipa.go.jp/choutatsu/koubo/index.html',
    linkFilter: /\/choutatsu\//i,
    priority: 2,
    enabled: true
  },
  {
    id: 'smrj-solicitation',
    organization: '中小企業基盤整備機構',
    label: '公募・調達情報',
    type: 'html',
    url: 'https://www.smrj.go.jp/org/info/solicitation/index.html',
    linkFilter: /\/org\/info\//i,
    priority: 2,
    enabled: true
  },
  {
    id: 'soumu-kobo',
    organization: '総務省',
    label: '公募・報道資料',
    type: 'html',
    url: 'https://www.soumu.go.jp/menu_news/s-news/index.html',
    linkFilter: /menu_news/i,
    priority: 2,
    enabled: true
  },
  {
    id: 'chisou-news',
    organization: '内閣府 地方創生',
    label: '新着情報',
    type: 'html',
    url: 'https://www.chisou.go.jp/sousei/index.html',
    linkFilter: /sousei/i,
    priority: 2,
    enabled: true
  },

  // --- 優先度3：自治体（千葉県・東京都を優先） ---
  {
    id: 'chiba-pref',
    organization: '千葉県',
    label: '報道発表一覧',
    // 旧 /happyou/ は廃止。2026-07-30時点の現行URLは /cate/kt/kouhou/houdou/ichiran/
    type: 'html',
    url: 'https://www.pref.chiba.lg.jp/cate/kt/kouhou/houdou/ichiran/index.html',
    linkFilter: /^\//i,
    priority: 3,
    enabled: true
  },
  {
    id: 'tokyo-metro',
    organization: '東京都',
    label: '報道発表',
    type: 'html',
    url: 'https://www.metro.tokyo.lg.jp/tosei/hodohappyo/index.html',
    linkFilter: /^\/(tosei|smph)/i,
    priority: 3,
    enabled: true
  }
];

/**
 * JavaScriptレンダリングが必要で、このBotでは収集できない監視先。
 * 週次のCoworkスキル側（public-opportunity-monitor）で人が確認する。
 */
const MANUAL_SOURCES = [
  {
    organization: 'Jグランツ',
    url: 'https://www.jgrants-portal.go.jp/',
    reason: '検索結果がJavaScript描画のため、Bot側では取得できない'
  },
  {
    organization: '全国自治体（site:lg.jp 横断）',
    url: 'https://www.google.com/search?q=site:lg.jp+%E5%85%AC%E5%8B%9F',
    reason: '検索エンジン横断はスキル側の担当'
  }
];

function activeSources(maxPriority = 3) {
  return SOURCES.filter(source => source.enabled && source.priority <= maxPriority);
}

module.exports = { SOURCES, MANUAL_SOURCES, activeSources };
