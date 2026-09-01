'use strict';

/**
 * 千葉県自治体案件レーダーの監視先定義。
 *
 * 要件定義: 03_output/2026-09-01_千葉県自治体案件レーダー_要件定義書_v1.md
 *
 * ■ ちば電子調達システムを監視しない理由（2026-09-01 実測・本人確認）
 *   1. 2026-05-07 の新システム移行で受注者ポータルが SPA になり、
 *      axios + cheerio では「ロード中...」しか取得できない。
 *   2. 株式会社農情人は入札参加資格者名簿（物品・委託）に登載していないため、
 *      電子調達システムに載る案件にはそもそも応募できない。
 *   → レイヤー1（共通調達）は監視対象から完全に外す。
 *      狙うのは千葉県が「電子調達システム対象外」と明記している企画提案（レイヤー2）。
 *
 * ■ linkFilter を使わない理由
 *   千葉県の企画提案は所管課ごとにパスがばらばら（/kankou/ /seisan/ /ryuhan/ …）で、
 *   パスでは絞れない。代わりに「リンクテキストが公募タイトルか」で判定する
 *   （chiba-tender-score.js の isCallTitle / titleExclusionReason）。
 *
 * type:
 *   'html' … 一覧ページのリンクを収穫し、詳細ページを読む
 * priority:
 *   1 … 既存接点があり最優先（白井市・千葉県）
 *   2 … 近隣自治体
 */

const SOURCES = [
  // --- 優先度1：既存接点あり ---
  {
    id: 'chiba-pref-koukoku',
    organization: '千葉県',
    label: '現在公告中の案件（企画提案）',
    type: 'html',
    // 「入札等の公告」直下ではなく、あえて "現在公告中" のページを見る。
    // 終了案件は /shuuryou/、選定結果は /nyuusatsukekka/ に分かれているため、
    // このURLを選ぶだけで「締切済み案件の誤通知」が構造的にゼロになる。
    url: 'https://www.pref.chiba.lg.jp/nyuu-kei/buppin-itaku/nyuusatsukoukoku/koukoku/index.html',
    priority: 1,
    enabled: true
  },
  {
    id: 'shiroi-nyusatsu',
    organization: '白井市',
    label: '入札・契約情報',
    type: 'html',
    // 白井市は担当課配下（/soshiki/somu/ /soshiki/kankyo/ …）に個別掲載されるが、
    // このページに全件が集約されていることを 2026-09-01 に実測で確認済み。
    url: 'https://www.city.shiroi.chiba.jp/sangyo/nyusatsu/n05/index.html',
    priority: 1,
    enabled: true
  },

  // --- 優先度2：近隣自治体 ---
  {
    id: 'inzai-nyusatsu',
    organization: '印西市',
    label: '入札・契約・検査に関するお知らせ',
    type: 'html',
    url: 'https://www.city.inzai.lg.jp/category/2-16-1-0-0.html',
    priority: 2,
    enabled: true
  },
  {
    id: 'funabashi-proposal',
    organization: '船橋市',
    label: '各課のプロポーザル情報',
    type: 'html',
    // 募集中と終了が同一ページに混在する。終了は
    // 「【受託候補者を特定しました】」等の接頭辞で判別できる（score側で除外）。
    url: 'https://www.city.funabashi.lg.jp/jigyou/nyusatsu/001/index.html',
    priority: 2,
    enabled: true
  },
  {
    id: 'kamagaya-proposal',
    organization: '鎌ケ谷市',
    label: 'プロポーザル情報（募集中）',
    type: 'html',
    // 募集中が0件になると /poropo_boshu/index.html 自体が404になる（2026-09-02実測）。
    // 常設の親ページを起点にし、「募集中」ページが現れた時だけ1階層追跡する。
    url: 'https://www.city.kamagaya.chiba.jp/jigyosha/nyuusatu_menu/proposal/index.html',
    listingLinkPattern:
      /\/jigyosha\/nyuusatu_menu\/proposal\/poropo_boshu(?:\/index\.html|\/)?$/i,
    emptyExpected: true,
    priority: 2,
    enabled: true
  },
  {
    id: 'kashiwa-proposal',
    organization: '柏市',
    label: 'プロポーザル（募集中）',
    type: 'html',
    // 「募集中」ページだが、終了案件が末尾「(終了しました)」付きで残ることがある。
    url: 'https://www.city.kashiwa.lg.jp/jigyosha/tender_contract/proposal/boshuchu/index.html',
    priority: 2,
    enabled: true
  },
  {
    id: 'yachiyo-proposal',
    organization: '八千代市',
    label: 'プロポーザル',
    type: 'html',
    // ⚠ ドメインは city.yachiyo.lg.jp。city.yachiyo.chiba.jp は存在しない（DNS未解決）。
    url: 'https://www.city.yachiyo.lg.jp/life/2/23/114/',
    priority: 2,
    enabled: true
  }
];

/**
 * 自動収集しない監視先。月1回、人が目視で確認する。
 * （フェーズ2「更新案件レーダー」の一次データ源もここに置く）
 */
const MANUAL_SOURCES = [
  {
    organization: '千葉県',
    label: '入札・随意契約の結果',
    url: 'https://www.pref.chiba.lg.jp/nyuu-kei/buppin-itaku/nyuusatsukekka/index.html',
    reason: 'フェーズ2（更新案件レーダー）の一次データ源。フェーズ1では収集しない'
  },
  {
    organization: '千葉県',
    label: '54市町村一覧',
    url: 'https://www.pref.chiba.lg.jp/kouhou/ichiran.html',
    reason: 'フェーズ3の拡張元'
  }
];

/**
 * 千葉県の所管課をURLパスから推定するための対応表。
 * 詳細ページ本文に「○○課」が無い場合のフォールバックとして使う。
 */
const CHIBA_PREF_DEPARTMENTS = [
  { pattern: /\/seisan\//i, department: '農林水産部 生産振興課' },
  { pattern: /\/noushin\//i, department: '農林水産部 農地・農村振興課' },
  { pattern: /\/ryuhan\//i, department: '農林水産部 流通販売課' },
  { pattern: /\/(suisan|lab-suisan)\//i, department: '農林水産部 水産課' },
  { pattern: /\/(kankou|chiba-nature|promo)\//i, department: '商工労働部 観光政策課' },
  { pattern: /\/keisei\//i, department: '商工労働部 経済政策課' },
  { pattern: /\/kouhou\//i, department: '総合企画部 報道広報課' },
  { pattern: /\/kanzai\//i, department: '総務部 管財課' }
];

function activeSources(maxPriority = 2) {
  return SOURCES.filter(source => source.enabled && source.priority <= maxPriority);
}

module.exports = { SOURCES, MANUAL_SOURCES, CHIBA_PREF_DEPARTMENTS, activeSources };
