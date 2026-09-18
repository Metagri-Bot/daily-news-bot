'use strict';

// Roblox速報の実行レポート。収集→公開日検証→スコア→AI審査→投稿のどの段で
// 0件になったかを1行に残し、「該当なし」と「故障」を沈黙で同一視しない。
function buildRobloxNewsSummary(stats = {}) {
  const count = key => stats[key] ?? 0;
  return [
    `フィード=${count('feeds')}`,
    `収集=${count('collected')}`,
    `事前除外=${count('prefiltered')}`,
    `7日以内=${count('fresh')}`,
    `公開日検証OK=${count('verified')}`,
    `GoogleNews解決=${count('relayResolved')}`,
    `うち公開日あり=${count('relayVerified')}`,
    `解決失敗=${count('relayUnresolved')}`,
    `解決上限超過=${count('relaySkipped')}`,
    `7日超=${count('outdated')}`,
    `公開日不明=${count('unverified')}`,
    `一次候補=${count('eligible')}`,
    `未投稿話題=${count('unseen')}`,
    `AI審査=${count('evaluated')}`,
    `重要度${stats.threshold ?? 70}以上=${count('selected')}`,
    `既出除外=${count('duplicateSkipped')}`,
    `翻訳成功=${count('translated')}`,
    `投稿=${count('posted')}`
  ].join(' / ');
}

function describeRobloxNewsRun(stats = {}, error = null) {
  const description = buildRobloxNewsSummary(stats);
  // 設定値の事故は、配信の有無より先に知らせる。気付かないまま収集源が消える。
  if ((stats.feedsInvalid ?? 0) > 0) {
    return { title: `Robloxビジネス速報：RSS設定に無効な値が${stats.feedsInvalid}件あります`, description, level: 'error',
      details: `ROBLOX_RSS_FEEDS からURLでない値を無視しました。設定を確認してください。\n${(stats.invalidFeedSamples || []).join('\n')}` };
  }
  if (error) {
    return { title: 'Robloxビジネス速報の実行に失敗しました', description, level: 'error',
      details: `${error.message || error}\n${error.stack || ''}`.trim() };
  }
  if ((stats.posted ?? 0) > 0) {
    return { title: 'Robloxビジネス速報を配信しました', description, level: 'info', details: null };
  }
  // 審査で落ちた候補を、既出と重要度不足に分けて添える。前者だけが並ぶ日は「その話題は
  // 配信済み」であり正常、後者に70点近くが並ぶ日は閾値の見直しを検討する材料になる。
  const format = miss => `[重要度${miss.importance}] ${miss.title}\n  → ${miss.reason}`;
  const sections = [];
  if (stats.nearMiss?.length) sections.push(`■ 重要度が届かなかった候補\n${stats.nearMiss.map(format).join('\n')}`);
  if (stats.duplicateMiss?.length) sections.push(`■ 既出として見送った候補\n${stats.duplicateMiss.map(format).join('\n')}`);
  const allDuplicates = !stats.nearMiss?.length && stats.duplicateMiss?.length;
  return {
    title: allDuplicates ? 'Robloxビジネス速報：今週の話題は配信済みのため0件です' : 'Robloxビジネス速報：本日の配信は0件です',
    description: `${description}\n※どの段で0件になったかは内訳を確認してください。`, level: 'warn',
    details: sections.join('\n\n') || null };
}

module.exports = { buildRobloxNewsSummary, describeRobloxNewsRun };
