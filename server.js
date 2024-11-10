// 必要なモジュールのインポート
const http = require("http");
const { Client, GatewayIntentBits } = require("discord.js");
require('dotenv').config(); // dotenv を使用して環境変数をロード

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
const ROBLOX_MEMBER_ROLE_ID = process.env.ROBLOX_MEMBER_ROLE_ID; // 2024/10/7 新規追加
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

  // HTTPサーバーの起動
  http.createServer(async (request, response) => {
      console.log("post from gas");

      //--会員ロール調査--
      // 付与対象から除外するロールIDを列挙
      const excludedRoles = EXCLUDED_ROLES; // 大文字から小文字に変更（オプション）
    
      // ギルドを取得（既に宣言済みのguild変数を使用）
      if (!guild) {
        console.error(`Guild with ID ${GUILD_ID} not found.`);
        response.statusCode = 500;
        response.end("Guild not found.");
        return;
      }

      // ロールを取得
      const bignerRole = guild.roles.cache.get(BIGNER_ROLE_ID); // 新たに付与するロールを取得
      if (!bignerRole) {
        console.error(`Role with ID ${BIGNER_ROLE_ID} not found.`);
        response.statusCode = 500;
        response.end("Role not found.");
        return;
      }

      // メンバーをフェッチ
      try {
        const members = await guild.members.fetch();
        members.each((member) => {
          if (!member.user.bot) {
            // メンバーのロールリストを取得
            const memberRoles = member.roles.cache;

            // メンバーのロールが除外ロールリストに含まれているかチェック
            const hasExcludedRole = memberRoles.some(role => excludedRoles.includes(role.id));

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
      } catch (error) {
        console.error('Error fetching members:', error);
      }
      //--会員ロール調査終了--

      // リクエストヘッダーのコンテンツタイプをチェック
      if (request.headers["content-type"] === "application/json") {
        let requestBody = "";

        // データを受信
        request.on("data", (chunk) => {
          requestBody += chunk.toString();
        });

        // データ受信完了
        request.on("end", async () => {
          try {
            const data = JSON.parse(requestBody);
            const userData = data.postData;
            const channel = client.channels.cache.get(MSG_SEND_CHANNEL_ID);

            if (!channel) {
              console.error(`Channel with ID ${MSG_SEND_CHANNEL_ID} not found.`);
              response.statusCode = 500;
              response.end("Channel not found.");
              return;
            }

            for(let i = 0; i < userData.length; i++){
              let userId = userData[i].userId;
              let works = userData[i].works;
              let numPoint = userData[i].numPoint;
              let totalPoint = userData[i].totalPoint;
              let overPoint = userData[i].overPoint;
              let message =`<@${userId}> さん\n本日のMetaGreenSeedsポイントを配布します。\n\n内訳：\n`;
              for(let j = 0; j < works.length; j++){
                message += `${works[j]}\n`;
              } 
              message += `\n現在の合計MetaGreenSeedsポイントは ${totalPoint} ポイントです。\n`;
              if(overPoint == 30){
                const member = await guild.members.fetch(userId);
                await member.roles.add(ROLES[0]);
                message += `\n【お知らせ】MetaGreenSeedsポイントが30ポイント溜ってます。\nこちら ${URLS[0]} をご確認ください。`;
              }
              if(overPoint == 60){
                const member = await guild.members.fetch(userId);
                await member.roles.add(ROLES[1]);
                message += `\n【お知らせ】MetaGreenSeedsポイントが60ポイント溜ってます。\nこちら ${URLS[1]} をご確認ください。`;
              }
              if(overPoint == 100){
                const member = await guild.members.fetch(userId);
                await member.roles.add(ROLES[2]);
                message += `\n【お知らせ】MetaGreenSeedsポイントが100ポイント溜ってます。\nこちら ${URLS[2]} をご確認ください。`;
              }
              await channel.send(message);
            }

            // レスポンスを設定して200 OKを返す
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.statusCode = 200;
            const responseBody = { message: "Data received and API is active now." };
            response.write(JSON.stringify(responseBody));
            response.end();
          } catch (error) {
            console.error('Error processing request:', error);
            response.statusCode = 500;
            response.end("Internal Server Error.");
          }
        });

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
    .listen(3000, () => {
      console.log('HTTP server is listening on port 3000');
    });
});

// Discordボットのログイン
client.login(DISCORD_BOT_TOKEN)
  .then(() => {
    console.log('Login successful.');
  })
  .catch(error => {
    console.error('Failed to login:', error);
  });

require("./code.js")
require("./comand.js")
require("./main.js");
