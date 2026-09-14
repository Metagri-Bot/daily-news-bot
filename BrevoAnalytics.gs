// 農業AI通信: Brevo配信分析（2026-09-10）
// 読み取り専用。GETしか呼ばず、配信要求は一切出さない。
// 依存: BrevoMail.gs の brevoApi_ / brevoConfig_ / brevoCell_ / brevoJobs_
// Optional script property: BREVO_STATS_MAX_CAMPAIGNS（既定300）
const BREVO_STATS_SHEET = 'Brevo配信分析';
const BREVO_WEEKLY_SHEET = 'Brevo週次サマリー';
const BREVO_STATS_HEADER = ['キャンペーンID', '送信日時', '件名', '記事URL', '送信', '到達', '到達率%',
  'ハードバウンス', 'ソフトバウンス', '開封(ユニーク)', '開封率%', 'クリック(ユニーク)', 'クリック率%',
  'CTOR%', '配信停止', '配信停止率%', '苦情', '更新日時'];
const BREVO_WEEKLY_HEADER = ['週開始(土曜)', '配信回数', '送信', '到達', '到達率%', '開封', '開封率%',
  'クリック', 'クリック率%', 'CTOR%', '配信停止', '配信停止率%', 'バウンス計', '苦情',
  '配信リスト件数', '開封率 前週差pt', 'クリック率 前週差pt', '更新日時'];

// 分母が0のときは0%でなく空欄にする。0%と「母数なし」を混同させない。
function brevoRate_(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 10000) / 100 : '';
}

// 日本にサマータイムは無いのでUTC+9の固定オフセットで足りる。
function brevoWeekKey_(date) {
  const jst = new Date(date.getTime() + 9 * 3600000);
  const offset = (jst.getUTCDay() + 1) % 7; // 土曜=0
  const saturday = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - offset * 86400000);
  return saturday.toISOString().slice(0, 10);
}

function brevoPreviousWeekKey_(date) {
  const current = Date.parse(brevoWeekKey_(date) + 'T00:00:00Z');
  return new Date(current - 7 * 86400000).toISOString().slice(0, 10);
}

function brevoSheet_(name, header) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(header);
  }
  brevoFormatSheet_(sheet, header.length);
  return sheet;
}

function brevoFormatSheet_(sheet, columns) {
  sheet.setFrozenRows(1);
  const header = sheet.getRange(1, 1, 1, columns);
  header.setBackground('#f1f3f4').setFontColor('#202124').setFontWeight('bold');
  if (typeof header.setWrap === 'function') header.setWrap(true);
  if (typeof sheet.setColumnWidths === 'function') sheet.setColumnWidths(1, columns, 105);
  if (typeof sheet.setColumnWidth === 'function') {
    sheet.setColumnWidth(1, 120);
    sheet.setColumnWidth(2, 145);
    sheet.setColumnWidth(3, 280);
    if (columns >= 4) sheet.setColumnWidth(4, 280);
    if (columns >= 18) sheet.setColumnWidth(18, 145);
  }
}

// 記事URLは配信管理台帳とアーカイブの両方から拾う。台帳の行は再送のため削除されることがある。
function brevoUrlByCampaign_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const map = {};
  const archive = ss.getSheetByName('アーカイブ');
  if (archive && archive.getLastRow() > 1 && archive.getLastColumn() >= 7) {
    archive.getRange(2, 1, archive.getLastRow() - 1, 7).getValues().forEach(row => {
      if (row[6]) map[String(row[6])] = String(row[2] || '');
    });
  }
  try {
    brevoJobs_().forEach(job => { if (job.campaignId) map[String(job.campaignId)] = job.url; });
  } catch (error) {
    console.log('配信管理台帳を読めませんでした。アーカイブのみで突合します。');
  }
  return map;
}

function brevoFetchSentCampaigns_() {
  const max = Number(SCRIPT_PROPERTIES.getProperty('BREVO_STATS_MAX_CAMPAIGNS') || 300);
  const pageSize = 50;
  const out = [];
  for (let offset = 0; offset < max; offset += pageSize) {
    const res = brevoApi_('get', '/emailCampaigns?type=classic&status=sent&statistics=globalStats&limit=' + pageSize + '&offset=' + offset);
    const page = res.campaigns || [];
    page.forEach(c => out.push(c));
    if (page.length < pageSize) break;
  }
  return out;
}

// 一覧APIが統計を返さない場合だけ個別に取り直す。呼び過ぎないよう上限を切る。
function brevoCampaignStats_(campaign, budget) {
  const stats = (campaign.statistics || {}).globalStats;
  if (stats || budget.left <= 0) return stats || {};
  budget.left--;
  const detail = brevoApi_('get', '/emailCampaigns/' + campaign.id + '?statistics=globalStats');
  return (detail.statistics || {}).globalStats || {};
}

function brevoStatsRow_(campaign, stats, urlMap) {
  const sent = Number(stats.sent || 0);
  const delivered = Number(stats.delivered || 0);
  const views = Number(stats.uniqueViews || 0);
  const clicks = Number(stats.uniqueClicks || 0);
  const unsub = Number(stats.unsubscriptions || 0);
  return [campaign.id, campaign.sentDate ? new Date(campaign.sentDate) : '',
    String(campaign.subject || campaign.name || ''), urlMap[String(campaign.id)] || '',
    sent, delivered, brevoRate_(delivered, sent),
    Number(stats.hardBounces || 0), Number(stats.softBounces || 0),
    views, brevoRate_(views, delivered),
    clicks, brevoRate_(clicks, delivered), brevoRate_(clicks, views),
    unsub, brevoRate_(unsub, delivered), Number(stats.complaints || 0), new Date()];
}

// キャンペーンIDで冪等にupsertする。何度実行しても行は増えない。
function brevoAnalyticsCollect_() {
  const sheet = brevoSheet_(BREVO_STATS_SHEET, BREVO_STATS_HEADER);
  const urlMap = brevoUrlByCampaign_();
  const rowById = {};
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().forEach((row, i) => {
      if (row[0] !== '') rowById[String(row[0])] = i + 2;
    });
  }
  const budget = {left: 20};
  let added = 0, updated = 0;
  brevoFetchSentCampaigns_().forEach(campaign => {
    // このスプレッドシートから配信したキャンペーンだけを対象にし、Brevo上のテスト配信を除外する。
    if (!Object.prototype.hasOwnProperty.call(urlMap, String(campaign.id))) return;
    const values = brevoStatsRow_(campaign, brevoCampaignStats_(campaign, budget), urlMap).map(brevoCell_);
    const at = rowById[String(campaign.id)];
    if (at) {
      sheet.getRange(at, 1, 1, values.length).setValues([values]);
      updated++;
    } else {
      sheet.appendRow(values);
      rowById[String(campaign.id)] = sheet.getLastRow();
      added++;
    }
  });
  SpreadsheetApp.flush();
  return {added: added, updated: updated};
}

function brevoListSize_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('配信リスト');
  if (!sheet || sheet.getLastRow() < 2) return '';
  return new Set(sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues()
    .flat().map(v => String(v).trim().toLowerCase()).filter(Boolean)).size;
}

// 週次は明細から毎回作り直す。過去週に記録済みの配信リスト件数だけは引き継ぐ。
function brevoAnalyticsSummarize_() {
  const stats = brevoSheet_(BREVO_STATS_SHEET, BREVO_STATS_HEADER);
  const weekly = brevoSheet_(BREVO_WEEKLY_SHEET, BREVO_WEEKLY_HEADER);
  const knownSize = {};
  if (weekly.getLastRow() > 1) {
    weekly.getRange(2, 1, weekly.getLastRow() - 1, 15).getValues().forEach(row => {
      if (row[0] && row[14] !== '') knownSize[String(row[0])] = row[14];
    });
  }
  const buckets = {};
  if (stats.getLastRow() > 1) {
    stats.getRange(2, 1, stats.getLastRow() - 1, 17).getValues().forEach(row => {
      if (!(row[1] instanceof Date) || !isFinite(row[1].getTime())) return;
      const key = brevoWeekKey_(row[1]);
      const b = buckets[key] || (buckets[key] = {count: 0, sent: 0, delivered: 0, hard: 0, soft: 0, views: 0, clicks: 0, unsub: 0, complaints: 0});
      b.count++; b.sent += Number(row[4] || 0); b.delivered += Number(row[5] || 0);
      b.hard += Number(row[7] || 0); b.soft += Number(row[8] || 0);
      b.views += Number(row[9] || 0); b.clicks += Number(row[11] || 0);
      b.unsub += Number(row[14] || 0); b.complaints += Number(row[16] || 0);
    });
  }
  const now = arguments.length ? arguments[0] : new Date();
  const currentWeek = brevoWeekKey_(now);
  const completedWeek = brevoPreviousWeekKey_(now);
  const liveSize = brevoListSize_();
  // 土曜朝の実行時点で締まった前週（土〜金）までを出す。進行中の週は次回まで確定させない。
  const keys = Object.keys(buckets).filter(key => key < currentWeek).sort();
  const rows = keys.map((key, i) => {
    const b = buckets[key];
    const openRate = brevoRate_(b.views, b.delivered);
    const clickRate = brevoRate_(b.clicks, b.delivered);
    const prev = i > 0 ? buckets[keys[i - 1]] : null;
    const prevOpen = prev ? brevoRate_(prev.views, prev.delivered) : '';
    const prevClick = prev ? brevoRate_(prev.clicks, prev.delivered) : '';
    const diff = (now, before) => (now === '' || before === '') ? '' : Math.round((now - before) * 100) / 100;
    const size = key === completedWeek ? liveSize : (knownSize[key] !== undefined ? knownSize[key] : '');
    return [key, b.count, b.sent, b.delivered, brevoRate_(b.delivered, b.sent),
      b.views, openRate, b.clicks, clickRate, brevoRate_(b.clicks, b.views),
      b.unsub, brevoRate_(b.unsub, b.delivered), b.hard + b.soft, b.complaints,
      size, diff(openRate, prevOpen), diff(clickRate, prevClick), new Date()].map(brevoCell_);
  });
  if (weekly.getLastRow() > 1) {
    weekly.getRange(2, 1, weekly.getLastRow() - 1, BREVO_WEEKLY_HEADER.length).clearContent();
  }
  if (rows.length) weekly.getRange(2, 1, rows.length, BREVO_WEEKLY_HEADER.length).setValues(rows);
  brevoBuildWeeklyChart_(weekly, rows.length);
  SpreadsheetApp.flush();
  return rows.length;
}

function brevoBuildWeeklyChart_(sheet, rowCount) {
  if (typeof sheet.getCharts !== 'function' || typeof sheet.newChart !== 'function') return;
  sheet.getCharts().forEach(chart => sheet.removeChart(chart));
  if (rowCount < 1) return;
  const endRow = rowCount + 1;
  const chart = sheet.newChart()
    .setChartType(Charts.ChartType.LINE)
    .addRange(sheet.getRange(1, 1, endRow, 1))
    .addRange(sheet.getRange(1, 7, endRow, 1))
    .addRange(sheet.getRange(1, 9, endRow, 1))
    .addRange(sheet.getRange(1, 12, endRow, 1))
    .setMergeStrategy(Charts.ChartMergeStrategy.MERGE_COLUMNS)
    .setNumHeaders(1)
    .setOption('title', 'Brevo週次 KPI推移（完了週のみ）')
    .setOption('legend', {position: 'bottom'})
    .setOption('hAxis', {title: '週開始（土曜）'})
    .setOption('vAxis', {title: '率（%）', viewWindow: {min: 0}})
    .setOption('colors', ['#1a73e8', '#34a853', '#ea4335'])
    .setPosition(2, 20, 0, 0)
    .build();
  sheet.insertChart(chart);
}

// メニュー「7」と週次トリガーの入口。送信はしない。
function brevoAnalyticsWeekly() {
  brevoConfig_(); // APIキーの有無だけ確認する。BREVO_ENABLED=false でも分析は回す。
  const collected = brevoAnalyticsCollect_();
  const weeks = brevoAnalyticsSummarize_();
  const message = 'Brevo配信分析を更新しました。明細 追加' + collected.added + '件／更新' + collected.updated + '件、週次 ' + weeks + '週。';
  console.log(message);
  return message;
}

function showBrevoAnalytics() {
  SpreadsheetApp.getUi().alert(brevoAnalyticsWeekly());
}

// 初回のみ実行。シートと毎週土曜8時（JST）のトリガーを作り、その場で1回集計する。
function setupBrevoAnalytics() {
  brevoConfig_();
  brevoSheet_(BREVO_STATS_SHEET, BREVO_STATS_HEADER);
  brevoSheet_(BREVO_WEEKLY_SHEET, BREVO_WEEKLY_HEADER);
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'brevoAnalyticsWeekly')) {
    ScriptApp.newTrigger('brevoAnalyticsWeekly').timeBased()
      .inTimezone(AUTOMATION_TIMEZONE)
      .onWeekDay(ScriptApp.WeekDay.SATURDAY).atHour(8).create();
  }
  console.log(brevoAnalyticsWeekly());
}
