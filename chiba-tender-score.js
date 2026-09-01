'use strict';

/**
 * 千葉県自治体案件レーダーの判定・採点・表示。
 *
 * 既存の public-opportunity.js とは「除外の当て方」が根本的に違う。
 *
 *   public-opportunity.js … 省庁の報道発表が対象。1件1ページなので
 *                           本文全文に除外語を当ててよい。
 *   chiba-tender-score.js … 自治体の入札ページが対象。パンくず・ナビに
 *                           「入札公告」「一般競争入札」が常在するため、
 *                           本文全文に当てると狙いの企画提案が全滅する。
 *
 * → 除外は「案件名（タイトル）」にだけ当てる。加点だけ本文全文で行う。
 *
 * 要件定義: 03_output/2026-09-01_千葉県自治体案件レーダー_要件定義書_v1.md §2-4 / §7
 */

const {
  normalizeText,
  canonicalUrl,
  opportunityId,
  parseJapaneseDate,
  daysUntil
} = require('./public-opportunity');

const { CHIBA_PREF_DEPARTMENTS } = require('./chiba-tender-sources');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// 母集団が小さい（週あたり数件〜十数件）ため、既存モニターの65点より低く取る。
const MIN_NOTIFY_SCORE = 60;
// この点以上は個別Embedで立てる。それ未満はダイジェストへまとめる。
const ALERT_SCORE = 80;
const NOTIFY_RANKS = ['S', 'A'];

// リマインドを出す日数の線（暦日）。営業日にしないのは祝日データの保守を避けるため。
const REMINDER_DAYS = [14, 7, 3];

// --- タイトル除外 ---------------------------------------------------------

/**
 * 既に終わっている案件（結果公表・受託者決定）。
 *
 * ⚠ 自治体ごとに書き方が違い、しかも増える。
 * 2026-09-01 の実測では船橋市が「【受託候補者を特定しました】」と
 * 「【最優秀提案者を選定しました】」を混在させていた。
 * 個別の言い回しを並べるのではなく、
 * 「【…〜しました】という角括弧の見出しが付いていたら終わり」を先に当てる。
 */
const FINISHED_PATTERNS = [
  // 【○○を特定しました】【最優秀提案者を選定しました】【受託者を決定しました】…を一括で拾う
  /【[^】]{0,30}(しました|済み|完了)】/,
  /(受託候補者|受託者|最優秀提案者|優先交渉権者|事業者)を?(特定|決定|選定)しま?し?た?/,
  /【\s*終了\s*】/,
  /終了しました/,
  /(選定|審査|選考|採択|評価)結果/,
  /結果について/,
  /結果の公表/,
  /結果を?公表/,
  /中止(について|します|しました)/
];

/** 種別として対象外（価格競争・手続き案内） */
const TYPE_PATTERNS = [
  /一般競争入札/,
  /指名競争入札/,
  /(制限|条件)付き?一般競争/,
  /事後審査型/,
  /開札/,
  /落札/,
  /入札結果/,
  /随意契約/,
  /見積(依頼|合わせ|書)/,
  /オープンカウンター/,
  /売払/,
  /譲受人/,
  /発注(予定|見通し)/,
  /質問(に対する)?回答/,
  /入札参加資格/,
  /資格者?名簿/,
  /指名停止/
];

/** 業務内容として対象外（農情人が担えない領域） */
const OUT_OF_SCOPE_PATTERNS = [
  /工事/,
  /修繕/,
  /舗装/,
  /橋梁/,
  /解体/,
  /保守(点検|管理)?業務/,
  /清掃/,
  /警備/,
  /賃貸借/,
  /物品の?購入/,
  /消耗品/,
  /給食/,
  /指定管理者/,
  /職員(採用|募集)/,
  /会計年度任用/,
  /委員の?(募集|公募)/,
  /公募委員/,
  /空調設備/,
  /led照明/i,
  /電話(導入|設備)/,
  /窓口業務/,
  /徴収等?業務/,
  /健(康|診)診断/
];

/**
 * 公募タイトルらしさ。これが無いものは詳細ページを開かない。
 */
const CALL_PATTERNS = [
  /公募/,
  /募集/,
  /企画提案/,
  /プロポーザル/,
  /事業者(の)?選定/,
  /受託者を?(選定|募集)/,
  /コンテスト/,
  /アワード/,
  /参加者を?募/
];

/**
 * タイトルだけを見て除外理由を返す。null なら除外しない。
 * 本文は見ない（このファイル冒頭の設計意図を参照）。
 */
function titleExclusionReason(rawTitle) {
  const title = String(rawTitle || '').replace(/\s+/g, '');
  if (!title) return 'タイトルが空';

  const finished = FINISHED_PATTERNS.find(pattern => pattern.test(title));
  if (finished) return '終了・結果公表済み';

  const type = TYPE_PATTERNS.find(pattern => pattern.test(title));
  if (type) return `対象外の種別（${title.match(type)[0]}）`;

  const scope = OUT_OF_SCOPE_PATTERNS.find(pattern => pattern.test(title));
  if (scope) return `対象外の業務（${title.match(scope)[0]}）`;

  return null;
}

/**
 * タイトルが公募の告知か。
 *
 * ⚠ 12文字の下限は必須。2026-09-01 の実測で、鎌ケ谷市の「プロポーザル情報」（8文字）と
 * 柏市の「プロポーザル」（6文字）というナビゲーションのリンクを拾ってしまった。
 * 案件名は必ず対象業務を含むので12文字を下回らない。
 */
function isCallTitle(rawTitle) {
  const title = String(rawTitle || '').replace(/\s+/g, '');
  if (title.length < 12) return false;
  return CALL_PATTERNS.some(pattern => pattern.test(title));
}

/**
 * 一覧ページから拾うかどうか。除外理由が付くものは詳細ページを開かない。
 */
function shouldHarvest(rawTitle) {
  if (!isCallTitle(rawTitle)) return false;
  return titleExclusionReason(rawTitle) === null;
}

// --- 加点用の辞書（本文全文に当てる） -------------------------------------

const DOMAIN_KEYWORDS = [
  '農業', '農林水産', '農産物', '農家', '生産者', '就農', '営農', 'スマート農業',
  '園芸', '畜産', '酪農', '水産', '林業', '特産品', '販路', '6次産業', '六次産業',
  '食品', '食文化', '直売', 'ふるさと納税', '返礼品',
  '地域', '地方創生', '移住', '定住', '関係人口', '中山間', '集落',
  '観光', 'シティプロモーション', 'まちづくり', '交流', '地域資源', '地域事業者'
];

const TECH_KEYWORDS = [
  'ai', '人工知能', '生成ai', 'llm', 'dx', 'デジタル', 'データ活用', 'ict', 'iot',
  'ドローン', 'ロボット', 'web3', 'nft', 'dao', 'ブロックチェーン', 'メタバース', 'xr',
  'ec', 'オンライン', 'システム導入', 'アプリ', 'ダッシュボード', 'オープンデータ',
  '動画', '映像', 'sns', 'ウェブサイト', 'webサイト', 'ホームページ', 'lp', 'コンテンツ制作'
];

const BRIDGE_KEYWORDS = [
  '情報発信', '魅力発信', 'プロモーション', 'ブランディング', '広報',
  '課題解決', '官民連携', '官民共創', '共創', 'イノベーション',
  '担い手', '人材育成', '実証実験', '実証事業', 'ワークショップ', '研修',
  '伴走', '調査', '支援業務', 'プラットフォーム', 'コミュニティ'
];

/** 農情人の既存実績・成果物が当てられるか */
const ASSET_KEYWORDS = [
  '動画', '映像', 'コンテスト', 'アワード', 'クリエイター', '作品',
  'セミナー', '講師', '研修', '講演', 'ワークショップ', '体験',
  '調査', '実態調査', 'アンケート', 'レポート', '報告書',
  'コミュニティ', 'discord', '会員', '取材', 'インタビュー', 'メディア', '記事',
  '発信', 'sns', 'instagram', 'youtube', 'note',
  'nft', 'web3', 'dao', 'メタバース', 'ハッカソン', '生成ai', 'ai活用',
  '農業', '酪農', '農産物', '運営', '事務局', '伴走', 'マッチング', '情報集約'
];

/** 応募主体として開かれているか */
const OPEN_APPLICANT_KEYWORDS = [
  '法人', '民間事業者', '民間企業', '企業', '事業者', '団体',
  'コンソーシアム', '共同提案', '共同企業体', 'グループ', 'スタートアップ'
];

/** 実行可能性の減点 */
const BURDEN_KEYWORDS = [
  '自己負担', '自己資金', '常駐', '専任', '週5日', '毎日常駐'
];

// --- 参加資格ゲート（点数と別に警告として出す） ---------------------------
//
// 株式会社農情人は「ちば電子調達システムの入札参加資格者名簿（物品・委託）」に
// 未登載（2026-09-01 本人確認）。名簿登載を要件にする案件は、点数が高くても
// そのままでは応募できない。ただし公告後に随時申請できる自治体もあるため、
// 減点はせず「⚠ 要確認」として必ず表示する。
const GATE_RULES = [
  {
    key: 'roster',
    label: '入札参加資格者名簿への登載が必要（農情人は未登載）',
    patterns: [/入札参加資格者?名簿/, /名簿に登載/, /入札参加資格(審査)?申請/, /有資格者名簿/]
  },
  {
    key: 'local_office',
    label: '県内・市内に本店または営業所が必要',
    patterns: [/市内に本店/, /県内に本店/, /(市|県)内に営業所/, /市内業者/, /準市内/, /本店を有する/]
  },
  {
    key: 'track_record',
    label: '同種業務の実績が必要',
    patterns: [/同種(の)?業務(の)?実績/, /同規模(の)?実績/, /類似業務の実績/, /過去[0-9０-９]+年(以内|間)に.{0,20}実績/]
  }
];

// --- 発注者との既存接点 ---------------------------------------------------
//
// 企画案の「千葉県内の地理・ネットワーク優位性15点」は廃止した。
// このレーダーは千葉県内の案件しか集めないため、全件が同点になり
// 順位付けに1点も寄与しないため。差がつくのは「話したことがあるか」。
const CONTACT_RULES = [
  {
    points: 10,
    label: '白井市（PR動画コンテスト・継続案件で担当課と接点あり）',
    match: item => /白井/.test(String(item.organization || ''))
  },
  {
    points: 7,
    label: '千葉県 農林水産部（農業AI調査・スマート農業の接点）',
    match: item =>
      /千葉県/.test(String(item.organization || '')) &&
      /\/(seisan|noushin|ryuhan|suisan|lab-suisan|nourin|chikusan)\//i.test(String(item.url || ''))
  },
  {
    points: 6,
    label: '印西市（白井市の隣接自治体・同一生活圏）',
    match: item => /印西/.test(String(item.organization || ''))
  },
  {
    points: 5,
    label: '千葉県 観光・広報部局（動画／発信の実績を当てやすい）',
    match: item =>
      /千葉県/.test(String(item.organization || '')) &&
      /\/(kankou|chiba-nature|promo|kouhou|keisei)\//i.test(String(item.url || ''))
  },
  {
    points: 3,
    label: '千葉県（その他部局）',
    match: item => /千葉県/.test(String(item.organization || ''))
  },
  {
    points: 2,
    label: '近隣市（船橋・鎌ケ谷・柏・八千代）',
    match: item => /(船橋|鎌ケ谷|鎌ヶ谷|柏|八千代)/.test(String(item.organization || ''))
  }
];

// --- 文字列ユーティリティ -------------------------------------------------

function tenderText(item = {}) {
  return normalizeText(
    [item.title, item.summary, item.body, item.organization, item.department]
      .filter(Boolean)
      .join(' ')
  );
}

function matchedKeywords(text, keywords) {
  return keywords.filter(keyword => text.includes(normalizeText(keyword)));
}

function includesAny(text, keywords) {
  return keywords.some(keyword => text.includes(normalizeText(keyword)));
}

// --- 抽出 -----------------------------------------------------------------

const FULLWIDTH_DIGITS = /[０-９]/g;

/**
 * 全角数字・全角カンマ・全角円記号を半角へ寄せる。
 * 自治体ページは「１，２００万円」のように全角混じりで書かれることが多く、
 * 数字だけ半角化してもカンマが残って金額を取り逃がす。
 */
function toHalfWidthDigits(value) {
  return String(value || '')
    .replace(FULLWIDTH_DIGITS, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[，､、]/g, ',')
    .replace(/[．]/g, '.');
}

/**
 * 予算上限額を円で返す。見つからなければ null。
 * 「上限額 8,000,000円」「予定価格 800万円」の両方に対応する。
 */
function extractBudgetUpper(rawText) {
  const text = toHalfWidthDigits(String(rawText || '')).replace(/\s+/g, '');
  if (!text) return null;

  const labels = '(?:上限額?|上限|予定価格|委託料|業務委託料|契約限度額|提案上限額|事業費)';
  const patterns = [
    new RegExp(`${labels}[^0-9]{0,12}([0-9,]+)\\s*万円`),
    new RegExp(`${labels}[^0-9]{0,12}([0-9,]+)\\s*円`)
  ];

  for (let index = 0; index < patterns.length; index += 1) {
    const found = text.match(patterns[index]);
    if (!found) continue;
    const digits = Number(found[1].replace(/,/g, ''));
    if (!Number.isFinite(digits) || digits <= 0) continue;
    return index === 0 ? digits * 10000 : digits;
  }
  return null;
}

// --- 締切の抽出 -----------------------------------------------------------
//
// 🔴 public-opportunity.js の extractDeadline() は千葉県の案件では使えない。
//
// あちらは「ラベル配列を順に見て、最初に日付が取れたラベルの日付を返す」実装で、
// 省庁の報道発表（1件1ページ・締切の記載は1か所）なら正しく動く。
// しかし自治体の募集要項は1ページに締切が何度も出てくる。
//
// 2026-09-01 の実測: 千葉県立病院経営改善業務委託は
//   「質問書の提出期限 令和8年8月25日」→ こちらが先に当たる
//   「参加意向届出書の提出期限 令和8年9月7日」→ こちらが本当の締切
// となり、まだ公告中の案件が「締切済み」として静かに捨てられていた。
//
// 設計方針:
//   1. すべてのラベル・すべての出現箇所から候補日を集め、【最も遅い日】を採る
//   2. 「質問」「回答」の文脈にある日付は除く（質問期限は必ず提案書より早い）
//   3. 「契約期間」「履行期間」の文脈にある日付も除く（年度末が混入するため）
//
// この向きにしているのは、レーダーにとって
// 「開いている案件を閉じたと誤判定する」ほうが「閉じた案件を1件通す」より
// はるかに高くつくからです。

const DEADLINE_LABELS = [
  '提出期限',
  '応募期限',
  '申込期限',
  '申請期限',
  '応募締切',
  '申請締切',
  '受付期限',
  '締切',
  '締め切り',
  '必着',
  '受付期間',
  '応募受付期間',
  '公募期間',
  '募集期間',
  '提出期間',
  '応募期間'
];

// ラベルの手前にこれがあれば、その日付は提案書の締切ではない
const NOT_A_DEADLINE_CONTEXT = /(質問|問合せ|問い合わせ|照会|回答|契約期間|履行期間|業務期間|委託期間|公告日|更新日|掲載日)/;

// ラベルの後ろでこの語が出てきたら、そこから先は別の話題。
// 90文字の窓は「応募期限 令和8年9月10日 …… 契約期間 令和9年3月31日まで」を
// まるごと飲み込むため、窓の中でも打ち切りが要る。
const WINDOW_STOP_WORDS = /(契約期間|履行期間|業務期間|委託期間|質問|説明会|開札|審査|選定|公表|問合せ|問い合わせ)/;

const DATE_PATTERNS = [
  /(令和|平成)\s*(?:元|\d{1,2})\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*(?:午前|午後)?\s*\d{1,2}\s*[:時]\s*\d{1,2}?\s*分?)?/g,
  /\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*(?:午前|午後)?\s*\d{1,2}\s*[:時]\s*\d{1,2}?\s*分?)?/g,
  /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s*\d{1,2}:\d{1,2})?/g
];

function datesInWindow(text) {
  const found = [];
  for (const pattern of DATE_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match) {
      const parsed = parseJapaneseDate(match[0]);
      if (parsed) found.push(parsed);
      match = pattern.exec(text);
    }
  }
  return found;
}

/**
 * 募集要項の本文から提案書の締切を推定する。
 * 候補のうち最も遅い日付を返す。1件も取れなければ null（＝締切要確認）。
 */
function extractTenderDeadline(rawText) {
  const text = String(rawText || '').normalize('NFKC');
  if (!text) return null;

  const candidates = [];

  for (const label of DEADLINE_LABELS) {
    let index = text.indexOf(label);
    while (index !== -1) {
      // ラベルの手前30文字に「質問」「契約期間」等があれば、この出現は無視する
      const before = text.slice(Math.max(0, index - 30), index);
      if (!NOT_A_DEADLINE_CONTEXT.test(before)) {
        let window = text.slice(index, index + 90);
        // ラベル自身を飛ばしたうえで、別の話題が始まる手前で窓を打ち切る
        const rest = window.slice(label.length);
        const stop = rest.search(WINDOW_STOP_WORDS);
        if (stop !== -1) window = window.slice(0, label.length + stop);
        candidates.push(...datesInWindow(window));
      }
      index = text.indexOf(label, index + label.length);
    }
  }

  if (candidates.length === 0) return null;
  return candidates.reduce((latest, date) => (date.getTime() > latest.getTime() ? date : latest));
}

/** 質問受付の期限。締切とは別に台帳へ持つ */
function extractQuestionDeadline(rawText) {
  const text = String(rawText || '').normalize('NFKC');
  const match = text.match(/質問[^。]{0,40}?(期限|期間|受付)[^。]{0,60}/);
  if (!match) return null;
  const dates = datesInWindow(match[0]);
  if (dates.length === 0) return null;
  return dates.reduce((latest, date) => (date.getTime() > latest.getTime() ? date : latest));
}

/** 契約期間と複数年度かどうか */
function extractContractPeriod(rawText) {
  const text = String(rawText || '').replace(/\s+/g, ' ');
  const multiYear =
    /債務負担行為/.test(text) ||
    /【債】/.test(text) ||
    /複数年度/.test(text) ||
    /長期継続契約/.test(text) ||
    /(令和|平成)[0-9０-９]+年度から(令和|平成)[0-9０-９]+年度/.test(text);

  const found = text.match(/契約期間[^。\n]{0,60}/);
  return { text: found ? found[0].trim() : null, multiYear };
}

/** 所管課。本文の「○○課」を優先し、無ければURLパスから推定する */
function extractDepartment(item) {
  const body = String(item.body || '');
  // 「◯◯部◯◯課」の形で切り出す。文字数だけで区切ると
  // 「防災危機管理部危機管理政策課」→「災危機管理部危機管理政策課」のように頭が欠ける。
  const found = body.match(/((?:[一-龥]{2,8}部)?[一-龥]{2,8}(?:課|室|センター|事務局))/);
  if (found) return found[1];

  const url = String(item.url || '');
  const rule = CHIBA_PREF_DEPARTMENTS.find(entry => entry.pattern.test(url));
  return rule ? rule.department : null;
}

/** 参加資格ゲートの検出。点数には影響させず、警告として表示する */
function detectGateFlags(rawText) {
  const text = String(rawText || '');
  const flags = {};
  GATE_RULES.forEach(rule => {
    flags[rule.key] = rule.patterns.some(pattern => pattern.test(text));
  });
  return flags;
}

function gateWarnings(flags) {
  if (!flags) return [];
  return GATE_RULES.filter(rule => flags[rule.key]).map(rule => rule.label);
}

// --- 採点（100点） --------------------------------------------------------

/** 事業テーマ適合（30点） */
function scoreTheme(text) {
  const hasDomain = includesAny(text, DOMAIN_KEYWORDS);
  const hasTech = includesAny(text, TECH_KEYWORDS);
  const hasBridge = includesAny(text, BRIDGE_KEYWORDS);

  if (hasDomain && hasTech) return 30;
  if (hasDomain && hasBridge) return 24;
  if (hasDomain) return 20;
  if (hasTech && hasBridge) return 12;
  if (hasTech) return 10;
  if (hasBridge) return 6;
  return 0;
}

/** 既存実績・成果物の転用（25点） */
function scoreAssets(text) {
  const hits = matchedKeywords(text, ASSET_KEYWORDS).length;
  return Math.min(hits * 3, 25);
}

/**
 * 契約規模・複数年度・更新可能性（15点）
 * 上限額が取れないときは0点ではなく中央値扱い（4点）にする。
 * 「抽出できなかった」を「小さい案件だ」と読み替えないため。
 */
function scoreScale(text, { budgetUpper, multiYear }) {
  let score = 0;
  if (budgetUpper === null || budgetUpper === undefined) score += 4;
  else if (budgetUpper >= 10000000) score += 8;
  else if (budgetUpper >= 3000000) score += 6;
  else if (budgetUpper >= 1000000) score += 4;
  else score += 2;

  if (multiYear) score += 4;
  // 年度事業＝翌年度も同じ公募が出る可能性が高い＝更新案件レーダーの母数になる
  if (/(令和|平成)[0-9０-９]+年度/.test(text)) score += 3;

  return Math.min(score, 15);
}

/** 応募・参画可能性（10点） */
function scoreEligibility(text) {
  let score = includesAny(text, OPEN_APPLICANT_KEYWORDS) ? 8 : 5;
  if (/(コンソーシアム|共同提案|共同企業体)/.test(text)) score += 2;
  return Math.min(score, 10);
}

/** 準備期間・実行可能性（10点） */
function scoreFeasibility(text, remainingDays) {
  let score;
  if (remainingDays === null || remainingDays === undefined) score = 5;
  else if (remainingDays >= 30) score = 10;
  else if (remainingDays >= 14) score = 8;
  else if (remainingDays >= 7) score = 5;
  else if (remainingDays >= 3) score = 3;
  else score = 1;

  const burdens = matchedKeywords(text, BURDEN_KEYWORDS).length;
  return Math.max(0, score - Math.min(burdens * 2, 4));
}

/** 発注者との既存接点（10点） */
function scoreContact(item) {
  const rule = CONTACT_RULES.find(entry => entry.match(item));
  return rule ? { points: rule.points, label: rule.label } : { points: 0, label: null };
}

function rankFromScore(score) {
  if (score >= 80) return 'S';
  if (score >= 60) return 'A';
  if (score >= 40) return 'B';
  return 'C';
}

/**
 * 案件を100点で採点する。
 * 除外判定はタイトルにのみ当て、加点は本文全文に当てる。
 */
function scoreTender(item, now = new Date()) {
  const remainingDays = daysUntil(item.deadline, now);
  const titleReason = titleExclusionReason(item.title);
  const notACall = !isCallTitle(item.title);

  const baseResult = {
    score: 0,
    rank: 'C',
    breakdown: {},
    matched: {},
    gate_flags: {},
    gate_warnings: [],
    budget_upper: null,
    contract_period: null,
    multi_year: false,
    contact_label: null,
    excluded: true,
    exclusion_reason: null,
    remaining_days: remainingDays
  };

  if (titleReason) return { ...baseResult, exclusion_reason: titleReason };
  if (notACall) return { ...baseResult, exclusion_reason: '公募・募集の告知ではない' };
  if (remainingDays !== null && remainingDays < 0) {
    return { ...baseResult, exclusion_reason: '締切済み' };
  }

  const text = tenderText(item);
  const rawText = [item.title, item.body, item.summary].filter(Boolean).join(' ');
  const budgetUpper = item.budget_upper !== undefined && item.budget_upper !== null
    ? item.budget_upper
    : extractBudgetUpper(rawText);
  const period = extractContractPeriod(rawText);
  const contact = scoreContact(item);
  const gateFlags = detectGateFlags(rawText);

  const breakdown = {
    theme: scoreTheme(text),
    assets: scoreAssets(text),
    scale: scoreScale(text, { budgetUpper, multiYear: period.multiYear }),
    eligibility: scoreEligibility(text),
    feasibility: scoreFeasibility(text, remainingDays),
    contact: contact.points
  };

  const score = Object.values(breakdown).reduce((total, value) => total + value, 0);

  return {
    score,
    rank: rankFromScore(score),
    breakdown,
    matched: {
      domain: matchedKeywords(text, DOMAIN_KEYWORDS).slice(0, 6),
      tech: matchedKeywords(text, TECH_KEYWORDS).slice(0, 6),
      assets: matchedKeywords(text, ASSET_KEYWORDS).slice(0, 6)
    },
    gate_flags: gateFlags,
    gate_warnings: gateWarnings(gateFlags),
    budget_upper: budgetUpper,
    contract_period: period.text,
    multi_year: period.multiYear,
    contact_label: contact.label,
    excluded: false,
    exclusion_reason: null,
    remaining_days: remainingDays
  };
}

function qualifiesForNotification(item, minScore = MIN_NOTIFY_SCORE) {
  return NOTIFY_RANKS.includes(String(item.rank).toUpperCase()) && Number(item.score) >= minScore;
}

// --- 重複判定 -------------------------------------------------------------

/** 案件の同一性はURL、内容の変化はタイトル＋締切で見る（既存モニターと同じ考え方） */
function tenderSignature(item) {
  const base = `${String(item.title || '').trim()}|${String(item.deadline || '').trim()}`;
  let hash = 0;
  for (let index = 0; index < base.length; index += 1) {
    hash = (hash * 31 + base.charCodeAt(index)) | 0;
  }
  return `sig_${(hash >>> 0).toString(16)}`;
}

function emptyState() {
  return { version: 1, seen: {}, last_run_at: null, last_result: {} };
}

function selectNewTenders(items, state = emptyState()) {
  const seen = state.seen || {};
  const results = [];
  const usedIds = new Set();

  for (const item of items) {
    let id;
    try {
      id = opportunityId(item);
    } catch (error) {
      continue;
    }
    if (usedIds.has(id)) continue;

    const signature = tenderSignature(item);
    const previous = seen[id];

    if (!previous) {
      usedIds.add(id);
      results.push({ id, item: { ...item, signature }, updated: false });
      continue;
    }
    if (previous.signature !== signature) {
      usedIds.add(id);
      results.push({ id, item: { ...item, signature }, updated: true });
    }
  }
  return results;
}

function recordNotified(state, entries, notifiedAt = new Date().toISOString()) {
  const seen = { ...(state.seen || {}) };

  entries.forEach(({ id, item }) => {
    const previous = seen[id] || {};
    seen[id] = {
      ...previous,
      signature: item.signature || tenderSignature(item),
      source_id: item.source_id || previous.source_id || '',
      organization: item.organization || previous.organization || '',
      department: item.department || previous.department || '',
      title: item.title || previous.title || '',
      url: item.url || previous.url || '',
      type: item.type || previous.type || 'プロポーザル',
      deadline: item.deadline || previous.deadline || null,
      budget_upper: item.budget_upper === undefined ? previous.budget_upper || null : item.budget_upper,
      contract_period: item.contract_period || previous.contract_period || '',
      multi_year: Boolean(item.multi_year),
      score: item.score === undefined ? previous.score ?? null : item.score,
      rank: item.rank || previous.rank || '',
      gate_flags: item.gate_flags || previous.gate_flags || {},
      status: item.status || '公告中',
      summary: item.summary || previous.summary || '',
      action: item.action || previous.action || '',
      first_notified_at: previous.first_notified_at || notifiedAt,
      last_notified_at: notifiedAt,
      last_checked_at: notifiedAt,
      reminded_days: previous.reminded_days || []
    };
  });

  return { ...state, seen, last_run_at: notifiedAt };
}

/** 台帳にだけ残す（通知しない）案件を記録する */
function recordLedgerOnly(state, items, checkedAt = new Date().toISOString()) {
  const seen = { ...(state.seen || {}) };

  items.forEach(item => {
    let id;
    try {
      id = opportunityId(item);
    } catch (error) {
      return;
    }
    const previous = seen[id];
    // 既に通知済みの案件は上書きしない（通知履歴のほうが情報量が多い）
    if (previous && previous.first_notified_at) {
      seen[id] = { ...previous, last_checked_at: checkedAt };
      return;
    }
    seen[id] = {
      ...(previous || {}),
      signature: tenderSignature(item),
      source_id: item.source_id || '',
      organization: item.organization || '',
      department: item.department || '',
      title: item.title || '',
      url: item.url || '',
      type: item.type || 'プロポーザル',
      deadline: item.deadline || null,
      budget_upper: item.budget_upper ?? null,
      contract_period: item.contract_period || '',
      multi_year: Boolean(item.multi_year),
      score: item.score ?? null,
      rank: item.rank || '',
      gate_flags: item.gate_flags || {},
      status: item.excluded ? '対象外' : '公告中',
      summary: item.summary || '',
      action: '',
      first_notified_at: previous?.first_notified_at || null,
      last_notified_at: previous?.last_notified_at || null,
      last_checked_at: checkedAt,
      reminded_days: previous?.reminded_days || []
    };
  });

  return { ...state, seen };
}

function pruneState(state, now = new Date(), keepDays = 400) {
  const seen = {};
  const limit = new Date(now).getTime() - keepDays * MS_PER_DAY;

  Object.entries((state && state.seen) || {}).forEach(([id, entry]) => {
    const stamp = new Date(entry.last_checked_at || entry.last_notified_at || 0).getTime();
    if (!Number.isFinite(stamp) || stamp >= limit) seen[id] = entry;
  });

  return { ...emptyState(), ...state, seen };
}

// --- 締切リマインド -------------------------------------------------------

/**
 * 次回の実行時刻を返す。
 * 週2回運用では「今日がちょうど7日前か」で判定するとリマインドの大半が
 * 構造的に欠落する（7日前が水曜なら永久に飛ばない）。
 * そこで「次回実行までに線を跨ぐか」で判定する。
 */
function computeNextRunAt(now = new Date(), { days = [2, 5], hour = 8, minute = 30 } = {}) {
  const base = new Date(now);
  for (let offset = 0; offset <= 8; offset += 1) {
    const candidate = new Date(base.getTime() + offset * MS_PER_DAY);
    // JSTで判定する（サーバーのTZに依存させない）
    const jst = new Date(candidate.getTime() + 9 * 60 * 60 * 1000);
    if (!days.includes(jst.getUTCDay())) continue;
    const runAt = new Date(
      Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), hour - 9, minute, 0)
    );
    if (runAt.getTime() > base.getTime()) return runAt;
  }
  return new Date(base.getTime() + 3 * MS_PER_DAY);
}

/**
 * 次回実行までに 14／7／3日前の線を跨ぐ案件を返す。
 * 一度出した線は `reminded_days` に記録して二度出さない。
 */
function reminderTargets(state, { now = new Date(), nextRunAt = null } = {}) {
  const next = nextRunAt || computeNextRunAt(now);
  const targets = [];

  Object.entries((state && state.seen) || {}).forEach(([id, entry]) => {
    if (!entry || !entry.deadline) return;
    if (!NOTIFY_RANKS.includes(String(entry.rank).toUpperCase())) return;

    const daysNow = daysUntil(entry.deadline, now);
    const daysNext = daysUntil(entry.deadline, next);
    if (daysNow === null || daysNext === null || daysNow < 0) return;

    const already = new Set(entry.reminded_days || []);
    const crossed = REMINDER_DAYS.filter(
      line => !already.has(line) && daysNext < line && line <= daysNow
    );
    if (crossed.length === 0) return;

    targets.push({ id, entry, lines: crossed, remaining_days: daysNow });
  });

  return targets.sort((a, b) => a.remaining_days - b.remaining_days);
}

function markReminded(state, targets) {
  const seen = { ...(state.seen || {}) };
  targets.forEach(({ id, lines }) => {
    if (!seen[id]) return;
    const already = new Set(seen[id].reminded_days || []);
    lines.forEach(line => already.add(line));
    seen[id] = { ...seen[id], reminded_days: [...already].sort((a, b) => b - a) };
  });
  return { ...state, seen };
}

// --- 表示 -----------------------------------------------------------------

function clip(value, limit) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function bulletList(values, fallback = '—') {
  if (!Array.isArray(values)) return clip(values, 900) || fallback;
  const lines = values
    .filter(value => String(value || '').trim())
    .slice(0, 3)
    .map(value => `• ${clip(value, 260)}`);
  return lines.join('\n') || fallback;
}

function formatYen(value) {
  if (value === null || value === undefined) return '記載なし';
  if (value >= 100000000) return `${(value / 100000000).toFixed(1)}億円`;
  if (value >= 10000) return `${Math.round(value / 10000).toLocaleString('ja-JP')}万円`;
  return `${Number(value).toLocaleString('ja-JP')}円`;
}

function deadlineLabel(deadline, now = new Date()) {
  if (!deadline) return '要確認';
  const target = deadline instanceof Date ? deadline : new Date(deadline);
  if (Number.isNaN(target.getTime())) return clip(deadline, 100);

  const remaining = daysUntil(target, now);
  const formatted = target.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
  const urgent = remaining !== null && remaining <= 14 ? ' 🚨' : '';
  const days = remaining === null ? '' : `（残り約${Math.max(0, remaining)}日）`;
  return `${formatted}${days}${urgent}`;
}

/** 80点以上の案件を1件ずつ立てるEmbed */
function buildTenderEmbed(item, { updated = false, now = new Date() } = {}) {
  const rank = String(item.rank || '').toUpperCase();
  const prefix = updated ? '更新｜' : '';
  const owner = [item.organization, item.department].filter(Boolean).join(' ');
  const scale = [
    formatYen(item.budget_upper),
    item.multi_year ? '複数年度' : '単年度',
    item.contract_period ? clip(item.contract_period, 60) : null
  ]
    .filter(Boolean)
    .join(' ／ ');

  const fields = [
    {
      name: '発注者・締切',
      value: `${clip(owner, 200) || '要確認'}\n${deadlineLabel(item.deadline, now)}`,
      inline: false
    },
    { name: '規模', value: scale || '要確認', inline: false },
    { name: '農情人との接続', value: bulletList(item.fit_reasons), inline: false },
    {
      name: '次の一手',
      value:
        clip(item.action, 900) || '募集要項で応募資格・締切・再委託の可否を確認する',
      inline: false
    }
  ];

  const warnings = [...(item.gate_warnings || []), item.caution].filter(Boolean);
  if (warnings.length > 0) {
    fields.push({ name: '⚠ 要確認', value: bulletList(warnings), inline: false });
  }

  if (item.contact_label) {
    fields.push({ name: '既存接点', value: clip(item.contact_label, 200), inline: false });
  }

  if (item.breakdown) {
    const parts = [
      `テーマ${item.breakdown.theme}/30`,
      `実績転用${item.breakdown.assets}/25`,
      `規模${item.breakdown.scale}/15`,
      `参画${item.breakdown.eligibility}/10`,
      `実行${item.breakdown.feasibility}/10`,
      `接点${item.breakdown.contact}/10`
    ];
    fields.push({ name: '採点内訳', value: parts.join(' ・ '), inline: false });
  }

  return {
    title: clip(`${prefix}【${rank}・${item.score}点】${item.title}`, 256),
    url: canonicalUrl(item.url),
    description: clip(item.summary, 1200),
    color: rank === 'S' ? 0xe74c3c : 0xf39c12,
    fields,
    footer: { text: '株式会社農情人｜千葉県自治体案件レーダー' },
    timestamp: new Date(now).toISOString()
  };
}

/** 60〜79点をまとめる1件のダイジェストEmbed */
function buildDigestEmbed(entries, { now = new Date() } = {}) {
  const lines = entries.slice(0, 12).map(({ item, updated }) => {
    const owner = [item.organization, item.department].filter(Boolean).join(' ');
    const remaining =
      item.remaining_days === null || item.remaining_days === undefined
        ? '締切要確認'
        : `残り${Math.max(0, item.remaining_days)}日`;
    const flag = updated ? '🔁' : '🆕';
    return `${flag} **[${item.score}点]** [${clip(item.title, 90)}](${canonicalUrl(item.url)})\n　${clip(owner, 60)}／${remaining}／${formatYen(item.budget_upper)}`;
  });

  return {
    title: `📋 検討候補 ${entries.length}件（60〜79点）`,
    description: lines.join('\n') || '—',
    color: 0xf1c40f,
    footer: { text: '株式会社農情人｜千葉県自治体案件レーダー' },
    timestamp: new Date(now).toISOString()
  };
}

/** 締切リマインドのEmbed */
function buildReminderEmbed(targets, { now = new Date() } = {}) {
  const lines = targets.slice(0, 15).map(({ entry, lines: crossed, remaining_days: remaining }) => {
    const owner = [entry.organization, entry.department].filter(Boolean).join(' ');
    return `⏰ **${Math.min(...crossed)}日前** [${clip(entry.title, 90)}](${canonicalUrl(entry.url)})\n　${clip(owner, 60)}／締切 ${deadlineLabel(entry.deadline, now)}／残り${Math.max(0, remaining)}日`;
  });

  return {
    title: `⏳ 締切が近づいている案件 ${targets.length}件`,
    description: lines.join('\n') || '—',
    color: 0x9b59b6,
    footer: { text: '次回実行までに14日／7日／3日前を迎える案件' },
    timestamp: new Date(now).toISOString()
  };
}

/**
 * 該当0件でも出す1行。
 * 週2回運用では、沈黙が「該当なし」なのか「壊れている」のか区別できないため、
 * 既存モニター（毎日実行・0件なら無投稿）とは方針を変えている。
 */
function buildHeartbeatLine(summary, now = new Date()) {
  const stamp = new Date(now).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
  return `🔎 千葉県レーダー｜${stamp} 巡回：${summary.sources}ソース／収穫${summary.harvested}件／精査${summary.inspected}件／通知該当0件`;
}

module.exports = {
  MIN_NOTIFY_SCORE,
  ALERT_SCORE,
  NOTIFY_RANKS,
  REMINDER_DAYS,
  DOMAIN_KEYWORDS,
  TECH_KEYWORDS,
  ASSET_KEYWORDS,
  titleExclusionReason,
  isCallTitle,
  shouldHarvest,
  extractTenderDeadline,
  extractQuestionDeadline,
  extractBudgetUpper,
  extractContractPeriod,
  extractDepartment,
  detectGateFlags,
  gateWarnings,
  scoreTender,
  rankFromScore,
  qualifiesForNotification,
  tenderSignature,
  emptyState,
  selectNewTenders,
  recordNotified,
  recordLedgerOnly,
  pruneState,
  computeNextRunAt,
  reminderTargets,
  markReminded,
  deadlineLabel,
  formatYen,
  buildTenderEmbed,
  buildDigestEmbed,
  buildReminderEmbed,
  buildHeartbeatLine
};
