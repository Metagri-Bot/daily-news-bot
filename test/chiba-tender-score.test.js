'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  titleExclusionReason,
  isCallTitle,
  shouldHarvest,
  scoreTender,
  extractTenderDeadline,
  extractQuestionDeadline,
  extractBudgetUpper,
  extractContractPeriod,
  detectGateFlags,
  computeNextRunAt,
  reminderTargets,
  markReminded,
  emptyState,
  selectNewTenders,
  recordNotified,
  buildTenderEmbed,
  buildDigestEmbed,
  buildHeartbeatLine
} = require('../chiba-tender-score');

const NOW = new Date('2026-09-01T08:30:00+09:00');
const DEADLINE_30D = '2026-10-01T17:00:00+09:00';

/** 実際の詳細ページ本文に近い長さ・語彙のダミー本文を作る */
function body(text) {
  return (
    `${text} 提案書の提出期限は令和8年10月1日午後5時までとします。` +
    '参加を希望する事業者は、企画提案書及び見積書を提出してください。' +
    '本業務は令和8年度の業務委託であり、契約期間は契約締結の日から令和9年3月31日までとします。'
  );
}

// ========================================================================
// 回帰テスト：要件定義書 §12 の「通るべき4件」
// 実測（2026-09-01）で千葉県が公告していた実在案件のタイトルを使う。
// ========================================================================

const SHOULD_PASS = [
  {
    title: '令和８年度「千葉県園芸スマート農業推進プラットフォーム」に係る運営業務委託の企画提案募集について',
    organization: '千葉県',
    url: 'https://www.pref.chiba.lg.jp/seisan/nyuu-kei/buppin-itaku/nyuusatsukoukoku/r8sumanoupf-bosyuu.html',
    body: body(
      '千葉県では、園芸農家のスマート農業の導入を推進するため、生産者・企業・大学等が参加するプラットフォームの運営業務を委託します。' +
        'デジタル技術やAIを活用した事例の情報発信、セミナーの企画運営、会員のマッチング支援、実態調査の実施を行います。上限額は8,000,000円とします。'
    )
  },
  {
    title: '令和８年度地域における農業参入受入れ体制サポート事業に係る企画提案募集について',
    organization: '千葉県',
    url: 'https://www.pref.chiba.lg.jp/noushin/nyuu-kei/buppin-itaku/nyuusatsukoukoku/r8kigyousannyu-support.html',
    body: body(
      '農業参入を目指す企業と地域をつなぐため、相談対応、専門家による伴走支援、セミナーの開催、地域の受入れ体制づくりに関する調査を行う事業者を募集します。' +
        '応募できるのは法人その他の団体とし、コンソーシアムによる共同提案も可能です。'
    )
  },
  {
    title: '位置情報データを活用した観光プロモーション業務に係る企画提案の募集について',
    organization: '千葉県',
    url: 'https://www.pref.chiba.lg.jp/kankou/digi-make/r7digi-make_boshu.html',
    body: body(
      '位置情報データを活用し、県内の観光地の魅力発信を行うプロモーション業務です。' +
        'データ分析に基づく動画・SNSコンテンツの制作、効果測定レポートの作成を含みます。上限額は12,000,000円です。'
    )
  },
  {
    title: 'ちばの「海と夕陽」を活用した観光プロモーション事業に係る企画提案の募集について',
    organization: '千葉県',
    url: 'https://www.pref.chiba.lg.jp/kankou/chiba-nature/r8chiba-sea-sunset.html',
    body: body(
      '県内の海岸線の地域資源を活かした観光プロモーションとして、動画・映像コンテンツの制作、SNSでの情報発信、地域事業者との連携企画の実施を委託します。' +
        '民間事業者、法人その他の団体が応募できます。'
    )
  }
];

test('回帰：農情人と接続する実在案件はA以上（60点以上）で通る', () => {
  SHOULD_PASS.forEach(sample => {
    const item = { ...sample, deadline: DEADLINE_30D };
    const result = scoreTender(item, NOW);

    assert.strictEqual(
      result.excluded,
      false,
      `除外されてはいけない: ${sample.title}（理由: ${result.exclusion_reason}）`
    );
    assert.ok(
      result.score >= 60,
      `60点以上であるべき: ${sample.title} → ${result.score}点 ${JSON.stringify(result.breakdown)}`
    );
    assert.ok(['S', 'A'].includes(result.rank), `S/Aであるべき: ${sample.title} → ${result.rank}`);
  });
});

// ========================================================================
// 回帰テスト：要件定義書 §12 の「通ってはいけない5件」
// ========================================================================

const SHOULD_FAIL = [
  {
    label: '一般競争入札（物品購入）',
    title: 'ちばアクアラインマラソン2026給水・給食関連物資（消耗品）の購入に係る一般競争入札について'
  },
  {
    label: '土地の一般競争入札',
    title: '千葉県企業局保有土地（印西市武西）の一般競争入札による譲受人の募集について'
  },
  {
    label: '受託候補者が決まった案件',
    title: '【受託候補者を特定しました】船橋市防犯灯設置管理業務に関するプロポーザルを実施します'
  },
  {
    label: '企画提案の選定結果',
    title: '「千葉県介護予防・日常生活圏域ニーズ調査分析事業」業務委託に係る企画提案の選定結果'
  },
  {
    label: '市民公募委員の募集',
    title: '白井市産業振興ネットワークの市民公募委員を募集します'
  }
];

test('回帰：入札・結果公表・対象外業務はタイトルだけで除外される', () => {
  SHOULD_FAIL.forEach(sample => {
    const reason = titleExclusionReason(sample.title);
    assert.ok(reason, `除外されるべき（${sample.label}）: ${sample.title}`);
    assert.strictEqual(shouldHarvest(sample.title), false, `収穫すべきでない: ${sample.title}`);
  });
});

test('回帰：終了マーカーは自治体ごとの書き方の違いを吸収する', () => {
  const finished = [
    '【受託候補者を決定しました】船橋市成人式企画運営業務に関するプロポーザルを実施します',
    // 2026-09-01 の実測で見つかった漏れ。船橋市は同じ一覧の中で
    // 「受託候補者を特定しました」と「最優秀提案者を選定しました」を混在させていた。
    '【最優秀提案者を選定しました】船橋市移動販売支援事業補助金に関するプロポーザルを実施します',
    '【優先交渉権者を決定しました】観光プロモーション業務に関するプロポーザル',
    '令和8年度高柳駅東口まちづくり検討業務委託に係る公募型プロポーザルの実施(終了しました)',
    '【終了】病児・病後児保育事業委託（西部）に係る公募型プロポーザルの実施',
    '白井市保健福祉センタートレーニングルーム利用事業者の再公募の結果について'
  ];
  finished.forEach(title => {
    assert.ok(titleExclusionReason(title), `終了として除外されるべき: ${title}`);
  });
});

test('回帰：ナビゲーションのリンクを案件として拾わない', () => {
  // 2026-09-01 の実測で、鎌ケ谷市の「プロポーザル情報」と柏市の「プロポーザル」
  // というメニューのリンクを収穫してしまった。案件名は必ず対象業務を含むので
  // 12文字を下回らない、という下限で切っている。
  const navigation = ['プロポーザル', 'プロポーザル情報', '募集中', '入札・契約', '公募情報'];
  navigation.forEach(text => {
    assert.strictEqual(isCallTitle(text), false, `ナビとして落とすべき: ${text}`);
    assert.strictEqual(shouldHarvest(text), false, text);
  });
});

// ========================================================================
// 設計の要：除外はタイトルにだけ当てる（本文全文には当てない）
// ========================================================================

test('設計：本文に「入札公告」があっても企画提案は除外されない', () => {
  // 千葉県の企画提案ページは例外なく「入札等の公告」配下にあり、
  // パンくず・ナビに入札関連語が常在する。既存モニターの
  // exclusionReason() をそのまま流用すると、ここで全滅する。
  const item = {
    title: '令和８年度「千葉県園芸スマート農業推進プラットフォーム」に係る運営業務委託の企画提案募集について',
    organization: '千葉県',
    url: 'https://www.pref.chiba.lg.jp/seisan/nyuu-kei/buppin-itaku/nyuusatsukoukoku/r8sumanoupf-bosyuu.html',
    deadline: DEADLINE_30D,
    body:
      'ホーム 県政情報 入札・契約 入札等の公告(物品・委託等) 一般競争入札 入札結果 ' +
      body('スマート農業の推進に向けたプラットフォームの運営業務です。AIとデジタル技術の活用事例を発信します。')
  };

  const result = scoreTender(item, NOW);
  assert.strictEqual(result.excluded, false, `除外されてはいけない（理由: ${result.exclusion_reason}）`);
  assert.ok(result.score >= 60, `${result.score}点`);
});

// ========================================================================
// 採点軸
// ========================================================================

test('採点：白井市は既存接点10点、近隣市は2点', () => {
  const base = {
    title: '観光プロモーション動画制作業務委託に係る公募型プロポーザル',
    deadline: DEADLINE_30D,
    body: body('地域の魅力発信のための動画制作とSNS運用を委託します。')
  };

  const shiroi = scoreTender({ ...base, organization: '白井市', url: 'https://www.city.shiroi.chiba.jp/a.html' }, NOW);
  const kashiwa = scoreTender({ ...base, organization: '柏市', url: 'https://www.city.kashiwa.lg.jp/a.html' }, NOW);

  assert.strictEqual(shiroi.breakdown.contact, 10);
  assert.strictEqual(kashiwa.breakdown.contact, 2);
  assert.ok(shiroi.score > kashiwa.score, '同じ案件なら白井市のほうが高い');
});

test('採点：千葉県は所管課（URLパス）で接点の点数が変わる', () => {
  const base = {
    organization: '千葉県',
    title: '業務委託に係る企画提案の募集について',
    deadline: DEADLINE_30D,
    body: body('農産物の販路開拓に関する調査と情報発信を行います。')
  };

  const nourin = scoreTender({ ...base, url: 'https://www.pref.chiba.lg.jp/ryuhan/x.html' }, NOW);
  const other = scoreTender({ ...base, url: 'https://www.pref.chiba.lg.jp/kenfuku/x.html' }, NOW);

  assert.strictEqual(nourin.breakdown.contact, 7);
  assert.strictEqual(other.breakdown.contact, 3);
});

test('採点：上限額が取れないときは0点でなく中央値扱いにする', () => {
  const text = '本業務の上限額は記載していません。';
  assert.strictEqual(extractBudgetUpper(text), null);

  const item = {
    title: '農産物のプロモーション業務に係る企画提案の募集',
    organization: '千葉県',
    url: 'https://www.pref.chiba.lg.jp/ryuhan/x.html',
    deadline: DEADLINE_30D,
    body: body('農産物の魅力発信を行います。')
  };
  const result = scoreTender(item, NOW);
  assert.ok(result.breakdown.scale >= 4, '抽出できないことを「小さい案件」と読み替えない');
});

// ========================================================================
// 締切の抽出
// 2026-09-01 に本番ページで見つかった、いちばん危険な欠陥の回帰テスト。
// 「開いている案件を閉じたと誤判定する」のは、レーダーにとって最悪の失敗。
// ========================================================================

test('締切：期間表記では開始日でなく終了日を採る（本番で誤判定した実例）', () => {
  // 千葉県立病院経営改善業務委託の実際の本文。
  // 既存の extractDeadline() は「提出期限」ラベルを先に見つけて 9/7 を、
  // さらに前段の「応募期間 8/25から」の 8/25 を返してしまい、
  // まだ公告中の案件を「締切済み」として静かに捨てていた。
  const body =
    '6.応募期限・方法等 (1)参加意向届出書の提出期限、提出先及び提出方法 ' +
    '提出期限 令和8年9月7日(月曜日)午後5時必着 提出方法 FAXまたはメール ' +
    '(2)企画提案書等の提出 応募期間 令和8年8月25日(火曜日)から令和8年9月14日(月曜日)まで 午後5時必着';

  const deadline = extractTenderDeadline(body);
  assert.ok(deadline, '締切が取れること');
  assert.strictEqual(deadline.toISOString().slice(0, 10), '2026-09-14', '期間の終了日を採る');
});

test('締切：質問の期限を提案書の締切と取り違えない', () => {
  const body =
    '7.質問の受付 質問書の提出期限は令和8年8月25日(月曜日)正午までとします。' +
    '8.応募 企画提案書の提出期限は令和8年9月30日(火曜日)午後5時必着です。';

  assert.strictEqual(extractTenderDeadline(body).toISOString().slice(0, 10), '2026-09-30');
  assert.strictEqual(extractQuestionDeadline(body).toISOString().slice(0, 10), '2026-08-25');
});

test('締切：契約期間の年度末を締切として拾わない', () => {
  const body =
    '応募期限 令和8年9月10日(木曜日)午後5時必着 ' +
    '契約期間 契約締結の日から令和9年3月31日まで';

  assert.strictEqual(extractTenderDeadline(body).toISOString().slice(0, 10), '2026-09-10');
});

test('締切：取れないときは null（＝締切要確認）にして除外しない', () => {
  const body = '本業務の詳細は募集要項をご覧ください。応募方法は持参または郵送とします。';
  assert.strictEqual(extractTenderDeadline(body), null);

  const item = {
    title: '観光プロモーション動画制作業務に係る企画提案の募集について',
    organization: '千葉県',
    url: 'https://www.pref.chiba.lg.jp/kankou/x.html',
    deadline: null,
    body
  };
  const result = scoreTender(item, NOW);
  assert.strictEqual(result.excluded, false, '締切不明を「締切済み」として捨てない');
});

test('抽出：上限額は円と万円の両方を読む', () => {
  assert.strictEqual(extractBudgetUpper('上限額 8,000,000円'), 8000000);
  assert.strictEqual(extractBudgetUpper('予定価格は800万円とする'), 8000000);
  assert.strictEqual(extractBudgetUpper('委託料の上限は１，２００万円'), 12000000);
  assert.strictEqual(extractBudgetUpper('特に記載なし'), null);
});

test('抽出：【債】と債務負担行為を複数年度として拾う', () => {
  assert.strictEqual(extractContractPeriod('【債】白井市公共施設LED照明器具賃貸借').multiYear, true);
  assert.strictEqual(extractContractPeriod('債務負担行為による契約とする').multiYear, true);
  assert.strictEqual(extractContractPeriod('単年度の委託です').multiYear, false);
});

test('ゲート：名簿登載の要件を検出する（点数には影響させない）', () => {
  const withRoster = {
    title: '観光プロモーション業務委託に係る公募型プロポーザル',
    organization: '柏市',
    url: 'https://www.city.kashiwa.lg.jp/a.html',
    deadline: DEADLINE_30D,
    body: body('本市の入札参加資格者名簿に登載されていることを参加要件とします。動画制作と情報発信を行います。')
  };
  const withoutRoster = { ...withRoster, body: body('動画制作と情報発信を行います。') };

  const a = scoreTender(withRoster, NOW);
  const b = scoreTender(withoutRoster, NOW);

  assert.strictEqual(a.gate_flags.roster, true);
  assert.strictEqual(b.gate_flags.roster, false);
  assert.ok(a.gate_warnings.some(warning => /名簿/.test(warning)));
  // 農情人は名簿未登載だが、公告後に随時申請できる自治体もあるため減点しない
  assert.strictEqual(a.score, b.score, '名簿要件は警告であって減点ではない');
});

test('ゲート：県内営業所・同種実績も検出する', () => {
  const flags = detectGateFlags(
    '市内に本店を有する者であること。過去5年以内に同種の業務の実績を有すること。'
  );
  assert.strictEqual(flags.local_office, true);
  assert.strictEqual(flags.track_record, true);
});

test('採点：締切済みは除外される', () => {
  const item = {
    title: '観光プロモーション業務に係る企画提案の募集について',
    organization: '千葉県',
    url: 'https://www.pref.chiba.lg.jp/kankou/x.html',
    deadline: '2026-08-01T17:00:00+09:00',
    body: body('動画制作を行います。')
  };
  const result = scoreTender(item, NOW);
  assert.strictEqual(result.excluded, true);
  assert.strictEqual(result.exclusion_reason, '締切済み');
});

// ========================================================================
// 締切リマインド：週2回運用で線を跨ぐかで判定する
// ========================================================================

test('リマインド：次回実行日は火・金 8:30 JSTになる', () => {
  // 2026-09-01 は火曜。8:30ちょうどに実行しているので、次は金曜 9/4 08:30 JST
  const next = computeNextRunAt(new Date('2026-09-01T08:30:00+09:00'));
  assert.strictEqual(next.toISOString(), '2026-09-03T23:30:00.000Z'); // = 2026-09-04 08:30 JST

  const jst = new Date(next.getTime() + 9 * 60 * 60 * 1000);
  assert.strictEqual(jst.getUTCDay(), 5, '金曜');
  assert.strictEqual(jst.getUTCHours(), 8);
  assert.strictEqual(jst.getUTCMinutes(), 30);

  // 金曜の実行なら次は火曜（土日をまたぐ）
  const afterFriday = computeNextRunAt(new Date('2026-09-04T08:30:00+09:00'));
  const afterJst = new Date(afterFriday.getTime() + 9 * 60 * 60 * 1000);
  assert.strictEqual(afterJst.getUTCDay(), 2, '火曜');
  assert.strictEqual(afterJst.getUTCDate(), 8);
});

test('リマインド：日単位でなく「次回実行までに線を跨ぐか」で拾う', () => {
  // 締切 9/8。9/1(火)時点で残り7日、次回9/4(金)時点で残り4日。
  // 「今日がちょうど7日前か」で判定すると拾えるが、7日前が水曜の案件は永久に飛ばない。
  // 線を跨ぐ判定なら、9/1 の実行で 7日前の線を跨ぐ案件として拾える。
  const state = {
    ...emptyState(),
    seen: {
      a1: {
        signature: 'sig_a',
        title: '観光プロモーション業務委託',
        url: 'https://www.pref.chiba.lg.jp/kankou/a.html',
        organization: '千葉県',
        rank: 'A',
        deadline: '2026-09-06T17:00:00+09:00',
        reminded_days: []
      }
    }
  };

  const targets = reminderTargets(state, { now: NOW });
  assert.strictEqual(targets.length, 1);
  assert.ok(targets[0].lines.includes(7) || targets[0].lines.includes(3), JSON.stringify(targets[0].lines));
});

test('リマインド：一度出した線は二度出さない', () => {
  const state = {
    ...emptyState(),
    seen: {
      a1: {
        signature: 'sig_a',
        title: 'テスト案件',
        url: 'https://www.pref.chiba.lg.jp/kankou/a.html',
        organization: '千葉県',
        rank: 'A',
        deadline: '2026-09-06T17:00:00+09:00',
        reminded_days: []
      }
    }
  };

  const first = reminderTargets(state, { now: NOW });
  assert.ok(first.length > 0);

  const marked = markReminded(state, first);
  const second = reminderTargets(marked, { now: NOW });
  assert.strictEqual(second.length, 0, '同じ線を再送しない');
});

test('リマインド：B・Cランクの案件は対象にしない', () => {
  const state = {
    ...emptyState(),
    seen: {
      b1: {
        signature: 'sig_b',
        title: '低スコア案件',
        url: 'https://www.pref.chiba.lg.jp/x/b.html',
        organization: '千葉県',
        rank: 'B',
        deadline: '2026-09-06T17:00:00+09:00',
        reminded_days: []
      }
    }
  };
  assert.strictEqual(reminderTargets(state, { now: NOW }).length, 0);
});

// ========================================================================
// 重複制御
// ========================================================================

test('重複：同じURL・同じ締切なら再通知しない', () => {
  const item = {
    title: '観光プロモーション業務に係る企画提案の募集について',
    url: 'https://www.pref.chiba.lg.jp/kankou/x.html?utm_source=test',
    organization: '千葉県',
    deadline: DEADLINE_30D,
    score: 72,
    rank: 'A'
  };

  const first = selectNewTenders([item], emptyState());
  assert.strictEqual(first.length, 1);

  const state = recordNotified(emptyState(), first, NOW.toISOString());
  const second = selectNewTenders([item], state);
  assert.strictEqual(second.length, 0);
});

test('重複：締切が変わったときだけ「更新」として再通知する', () => {
  const item = {
    title: '観光プロモーション業務に係る企画提案の募集について',
    url: 'https://www.pref.chiba.lg.jp/kankou/x.html',
    organization: '千葉県',
    deadline: DEADLINE_30D,
    score: 72,
    rank: 'A'
  };

  const state = recordNotified(emptyState(), selectNewTenders([item], emptyState()), NOW.toISOString());
  const extended = { ...item, deadline: '2026-10-15T17:00:00+09:00' };
  const result = selectNewTenders([extended], state);

  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].updated, true);
});

test('重複：トラッキングパラメータ違いは同じ案件として扱う', () => {
  const a = {
    title: '観光プロモーション業務に係る企画提案の募集について',
    url: 'https://www.pref.chiba.lg.jp/kankou/x.html',
    organization: '千葉県',
    deadline: DEADLINE_30D
  };
  const b = { ...a, url: 'https://www.pref.chiba.lg.jp/kankou/x.html?utm_source=discord#top' };

  const state = recordNotified(emptyState(), selectNewTenders([a], emptyState()), NOW.toISOString());
  assert.strictEqual(selectNewTenders([b], state).length, 0);
});

// ========================================================================
// 表示
// ========================================================================

test('表示：個別Embedに規模・接点・採点内訳・警告が入る', () => {
  const item = {
    title: '千葉県園芸スマート農業推進プラットフォーム 運営業務委託',
    url: 'https://www.pref.chiba.lg.jp/seisan/x.html',
    organization: '千葉県',
    department: '農林水産部 生産振興課',
    deadline: DEADLINE_30D,
    score: 86,
    rank: 'S',
    budget_upper: 8000000,
    multi_year: false,
    contact_label: '千葉県 農林水産部（農業AI調査・スマート農業の接点）',
    gate_warnings: ['入札参加資格者名簿への登載が必要（農情人は未登載）'],
    fit_reasons: ['Metagri研究所1,300人の運営実績を当てられる'],
    action: '9/5までに参加表明の要否を判断する',
    breakdown: { theme: 30, assets: 22, scale: 10, eligibility: 8, feasibility: 8, contact: 8 }
  };

  const embed = buildTenderEmbed(item, { now: NOW });
  const names = embed.fields.map(field => field.name);

  assert.match(embed.title, /【S・86点】/);
  assert.ok(names.includes('規模'));
  assert.ok(names.includes('⚠ 要確認'));
  assert.ok(names.includes('既存接点'));
  assert.ok(names.includes('採点内訳'));
  assert.match(embed.fields.find(field => field.name === '規模').value, /800万円/);
});

test('表示：ダイジェストは1件のEmbedにまとまる', () => {
  const entries = [
    {
      updated: false,
      item: {
        title: 'A業務委託',
        url: 'https://www.city.kashiwa.lg.jp/a.html',
        organization: '柏市',
        score: 64,
        remaining_days: 20,
        budget_upper: null
      }
    },
    {
      updated: true,
      item: {
        title: 'B業務委託',
        url: 'https://www.city.inzai.lg.jp/b.html',
        organization: '印西市',
        score: 61,
        remaining_days: 9,
        budget_upper: 3000000
      }
    }
  ];

  const embed = buildDigestEmbed(entries, { now: NOW });
  assert.match(embed.title, /2件/);
  assert.match(embed.description, /A業務委託/);
  assert.match(embed.description, /B業務委託/);
  assert.match(embed.description, /🔁/, '更新は区別して出す');
});

test('表示：0件でもハートビートの1行を出す（週2回運用のため）', () => {
  const line = buildHeartbeatLine(
    { sources: 7, harvested: 42, inspected: 12 },
    NOW
  );
  assert.match(line, /千葉県レーダー/);
  assert.match(line, /7ソース/);
  assert.match(line, /通知該当0件/);
});

// ========================================================================
// 収穫のふるい
// ========================================================================

test('収穫：公募タイトルでないリンクは拾わない', () => {
  const noise = [
    'サイトマップ',
    'このページに関するお問い合わせ',
    '入札・契約情報',
    '本文へ',
    'ページの先頭へ'
  ];
  noise.forEach(text => assert.strictEqual(shouldHarvest(text), false, text));
});

test('収穫：公募タイトルは拾う', () => {
  const hits = [
    '令和8年度観光プロモーション業務委託｜公募型プロポーザル',
    '白井市中心都市拠点づくり基礎検討業務委託｜公募型プロポーザル',
    'ちばの「海と夕陽」を活用した観光プロモーション事業に係る企画提案の募集について'
  ];
  hits.forEach(text => {
    assert.strictEqual(isCallTitle(text), true, text);
    assert.strictEqual(shouldHarvest(text), true, text);
  });
});
