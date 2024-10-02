// 必要なモジュールのインポート
const http = require("http");
const { Client, GatewayIntentBits } = require("discord.js");
require('dotenv').config(); // dotenv を使用している場合

// 環境変数の取得
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const MSG_SEND_CHANNEL_ID = process.env.MSG_SEND_CHANNEL_ID;
const BIGNER_ROLE_ID = process.env.BIGNER_ROLE_ID;
const ROLES = [
  process.env.PER_30_ROLE_ID,
  process.env.PER_60_ROLE_ID,
  process.env.PER_100_ROLE_ID 
];
const URLS = [
  process.env.PER_30_URL,
  process.env.PER_60_URL,
  process.env.PER_100_URL 
];
const INVITE_CODE = process.env.INVITE_CODE;
const ROBLOX_ROLE_ID = process.env.ROBLOX_ROLE_ID;
const EXCLUDED_ROLES = [process.env.MANAGER_ID];

// Discordクライアントの設定
const client = new Client({
  intents: Object.values(GatewayIntentBits).reduce((a, b) => a | b)
});

// 招待キャッシュを保持するMap
const invitesCache = new Map();

// ボットが準備完了したときの処理
client.once("ready", async () => {
  console.log('Bot is ready!');

  // ギルドの招待リンクをフェッチしてキャッシュに保存
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    console.error(`Guild with ID ${GUILD_ID} not found.`);
    return;
  }

  try {
    const invites = await guild.invites.fetch();
    invites.each(inv => invitesCache.set(inv.code, inv.uses));
    console.log('Invite cache initialized.');
  } catch (error) {
    console.error('Error fetching invites:', error);
  }
});

// 新規メンバーが参加したときの処理
client.on('guildMemberAdd', async (member) => {
  if (member.guild.id !== GUILD_ID) return;

  const guild = member.guild;

  try {
    // 現在の招待リンクをフェッチ
    const newInvites = await guild.invites.fetch();
    // 招待キャッシュと比較して使用された招待リンクを特定
    const usedInvite = newInvites.find(inv => {
      const cachedUses = invitesCache.get(inv.code) || 0;
      return inv.uses > cachedUses;
    });

    // キャッシュを更新
    newInvites.each(inv => invitesCache.set(inv.code, inv.uses));

    if (usedInvite && usedInvite.code === INVITE_CODE) {
      const role = guild.roles.cache.get(ROBLOX_ROLE_ID);
      if (role) {
        await member.roles.add(role);
        console.log(`Assigned ROBLOX_ROLE_ID to ${member.user.tag} via invite code ${INVITE_CODE}.`);
      } else {
        console.error(`Role with ID ${ROBLOX_ROLE_ID} not found.`);
      }
    } else {
      console.log(`Member ${member.user.tag} joined using invite code: ${usedInvite ? usedInvite.code : 'Unknown'}`);
    }
  } catch (error) {
    console.error(`Error processing guildMemberAdd for ${member.user.tag}:`, error);
  }
});


http
  .createServer((request, response) => {
    console.log("post from gas");

  //--会員ロール調査--
    // 付与対象から除外するロールIDを列挙
    const EXCLUDED_ROLES = [process.env.MANAGER_ID];
  
    const guild = client.guilds.cache.get(GUILD_ID);
    const bignerRole = guild.roles.cache.get(BIGNER_ROLE_ID); // 新たに付与するロールを取得

    guild.members.fetch().then((members) => {
      members.each((member) => {
        if (!member.user.bot) {
          
          // メンバーのロールリストを取得
          const memberRoles = member.roles.cache;

          // メンバーのロールが除外ロールリストに含まれているかチェック
          const hasExcludedRole = memberRoles.some(role => EXCLUDED_ROLES.includes(role.id));

          if (hasExcludedRole && memberRoles.has(BIGNER_ROLE_ID)) {
            try {
              member.roles.remove(bignerRole);
              console.log(`Removed role from ${member.user.username}`);
            }
            catch (error) {
              console.error(`Failed to remove role from ${member.user.username}: `, error);
            }
          }
        }
      });
    }).catch(console.error);
    //--会員ロール調査終了--

  
    // リクエストヘッダーのコンテンツタイプをチェック
    if (request.headers["content-type"] === "application/json") {
      let requestBody = "";

      // リクエストデータを受信する際に発生する 'data' イベントのハンドラを設定
      request.on("data", (chunk) => {
        requestBody += chunk.toString();
      });

      // リクエストデータの受信が完了した際に発生する 'end' イベントのハンドラを設定
      request.on("end", () => {
        const guild = client.guilds.cache.get(GUILD_ID);
        const channel = client.channels.cache.get(MSG_SEND_CHANNEL_ID);
        const data = JSON.parse(requestBody);
        const userData = data.postData;
        
        for(let i = 0; i < userData.length; i++){
          let userId = userData[i].userId;
          let works = userData[i].works;
          let numPoint = userData[i].numPoint;
          let totalPoint = userData[i].totalPoint;
          let overPoint = userData[i].overPoint;
          let message =`<@${userId}> さん\n本日のMetaGreenSeedsポイントを配布します。\n\n内訳：\n`;
          for(let j = 0; j < works.length; j++){
            message = message + `${works[j]}\n`
          } 
          message = message + `\n現在の合計MetaGreenSeedsポイントは ${totalPoint} ポイントです。\n`;
          if(overPoint == 30){
            guild.members.fetch();
            guild.members.cache.get(userId).roles.add(ROLES[0]);
            message = message + `\n【お知らせ】MetaGreenSeedsポイントが30ポイント溜ってます。\nこちら ${URLS[0]} をご確認ください。`;
          }
          if(overPoint == 60){
            guild.members.fetch();
            guild.members.cache.get(userId).roles.add(ROLES[1]);
            message = message + `\n【お知らせ】MetaGreenSeedsポイントが60ポイント溜ってます。\nこちら ${URLS[1]} をご確認ください。`;
          }
          if(overPoint == 100){
            guild.members.fetch();
            guild.members.cache.get(userId).roles.add(ROLES[2]);
            message = message + `\n【お知らせ】MetaGreenSeedsポイントが100ポイント溜ってます。\nこちら ${URLS[2]} をご確認ください。`;
          }
          channel.send(message);
        }
      });

      // レスポンスを設定して200 OKを返す
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.statusCode = 200;
      const responseBody = { message: "Data received and API is active now." };
      response.write(JSON.stringify(responseBody));
      response.end();
    } else {
      // リクエストのコンテンツタイプが不正な場合、400 Bad Requestを返す
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.statusCode = 400; // Bad Request
      const responseBody = {
        error: "Invalid content type. Expected application/json.",
      };
      response.write(JSON.stringify(responseBody));
      response.end();
    }
  })
  .listen(3000);

require("./main.js");