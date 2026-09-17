'use strict';

// Roblox速報の実行レポート。収集→公開日検証→スコア→AI審査→投稿のどの段で
// 0件になったかを1行に残し、「該当なし」と「故障」を沈黙で同一視しない。
function buildRobloxNewsSummary(stats = {}) {
  const count = key => stats[key] ?? 0;
  return [
    `収集=${count('collected')}`,
    `7日以内=${count('fresh')}`,
    `公開日検証OK=${count('verified')}`,
    `GoogleNews解決=${count('relayResolved')}`,
    `解決失敗=${count('relayUnresolved')}`,
    `解決上限超過=${count('relaySkipped')}`,
    `7日超=${count('outdated')}`,
    `公開日不明=${count('unverified')}`,
    `一次候補=${count('eligible')}`,
    `未投稿話題=${count('unseen')}`,
    `AI審査=${count('evaluated')}`,
    `重要度${stats.threshold ?? 70}以上=${count('selected')}`,
    `翻訳成功=${count('translated')}`,
    `投稿=${count('posted')}`
  ].join(' / ');
}

function describeRobloxNewsRun(stats = {}, error = null) {
  const description = buildRobloxNewsSummary(stats);
  if (error) {
    return { title: 'Robloxビジネス速報の実行に失敗しました', description, level: 'error',
      details: `${error.message || error}\n${error.stack || ''}`.trim() };
  }
  if ((stats.posted ?? 0) > 0) {
    return { title: 'Robloxビジネス速報を配信しました', description, level: 'info', details: null };
  }
  return { title: 'Robloxビジネス速報：本日の配信は0件です',
    description: `${description}\n※どの段で0件になったかは内訳を確認してください。`, level: 'warn', details: null };
}

module.exports = { buildRobloxNewsSummary, describeRobloxNewsRun };
