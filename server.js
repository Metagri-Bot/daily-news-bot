// 必要なモジュールのインポート
const http = require("http");
const { Client, Intents } = require("discord.js");
require('dotenv').config();

// const http = require("http");
// const { Client, Intents } = require("discord.js"); // v13ではIntentsを使用
// require('dotenv').config();

// 環境変数の取得（変更なし）
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
const ROBLOX_MEMBER_ROLE_ID = process.env.ROBLOX_MEMBER_ROLE_ID;
const EXCLUDED_ROLES = [process.env.MANAGER_ID];


// Discordクライアントの設定（v13用に変更）
const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MEMBERS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILD_INVITES
  ]
});
  
// 招待キャッシュを保持するMap
const invitesCache = new Map();


// main.js をインポートし、クライアントを渡す
require('./main.js')(client); // ここで main.js が client を受け取るようにする




// ボットが準備完了したときの処理
client.once("ready", async () => {
  console.log('Bot is ready!');

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
    const newInvites = await guild.invites.fetch();
    const usedInvite = newInvites.find(inv => {
      const cachedUses = invitesCache.get(inv.code) || 0;
      return inv.uses > cachedUses;
    });

    newInvites.each(inv => invitesCache.set(inv.code, inv.uses));

    if (usedInvite) {
      console.log(`Used invite code: ${usedInvite.code}`);
      console.log(`Configured INVITE_CODE: ${INVITE_CODE}`);
    } else {
      console.log(`Used invite code: Unknown`);
    }

    if (usedInvite && usedInvite.code === INVITE_CODE) {
      const robloxRole = guild.roles.cache.get(ROBLOX_ROLE_ID);
      if (robloxRole) {
        await member.roles.add(robloxRole);
        console.log(`Assigned ROBLOX_ROLE_ID to ${member.user.tag} via invite code ${INVITE_CODE}.`);

        if (member.roles.cache.has(BIGNER_ROLE_ID)) {
          const bignerRole = guild.roles.cache.get(BIGNER_ROLE_ID);
          if (bignerRole) {
            await member.roles.remove(bignerRole);
            console.log(`Removed BIGNER_ROLE_ID from ${member.user.tag} as they have ROBLOX_ROLE_ID.`);
          } else {
            console.error(`Role with ID ${BIGNER_ROLE_ID} not found.`);
          }
        }
      } else {
        console.error(`Role with ID ${ROBLOX_ROLE_ID} not found.`);
      }
    } else {
      console.log(`Member ${member.user.tag} joined using invite code: ${usedInvite ? usedInvite.code : 'Unknown'}`);
    }

    if (member.roles.cache.has(ROBLOX_MEMBER_ROLE_ID)) {
      const robloxRole = guild.roles.cache.get(ROBLOX_ROLE_ID);
      if (robloxRole) {
        await member.roles.remove(robloxRole);
        console.log(`Removed ROBLOX_ROLE_ID from ${member.user.tag} because they have ROBLOX_MEMBER_ROLE_ID.`);
      } else {
        console.error(`Role with ID ${ROBLOX_ROLE_ID} not found.`);
      }
    }

  } catch (error) {
    console.error(`Error processing guildMemberAdd for ${member.user.tag}:`, error);
  }
});

// メンバーのロールが更新されたときの処理
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  if (newMember.guild.id !== GUILD_ID) return;

  const hadRobloxMemberRole = oldMember.roles.cache.has(ROBLOX_MEMBER_ROLE_ID);
  const hasRobloxMemberRole = newMember.roles.cache.has(ROBLOX_MEMBER_ROLE_ID);

  if (!hadRobloxMemberRole && hasRobloxMemberRole) {
    console.log(`ROBLOX_MEMBER_ROLE_ID has been added to ${newMember.user.tag}.`);

    if (newMember.roles.cache.has(ROBLOX_ROLE_ID)) {
      const robloxRole = newMember.guild.roles.cache.get(ROBLOX_ROLE_ID);
      if (robloxRole) {
        try {
          await newMember.roles.remove(robloxRole);
          console.log(`Removed ROBLOX_ROLE_ID from ${newMember.user.tag} after ROBLOX_MEMBER_ROLE_ID was added.`);
        } catch (error) {
          console.error(`Failed to remove ROBLOX_ROLE_ID from ${newMember.user.tag}:`, error);
        }
      } else {
        console.error(`Role with ID ${ROBLOX_ROLE_ID} not found.`);
      }
    }
  }

  const hadRobloxRole = oldMember.roles.cache.has(ROBLOX_ROLE_ID);
  const hasRobloxRole = newMember.roles.cache.has(ROBLOX_ROLE_ID);

  if (!hadRobloxRole && hasRobloxRole) {
    console.log(`ROBLOX_ROLE_ID has been added to ${newMember.user.tag}.`);

    if (newMember.roles.cache.has(BIGNER_ROLE_ID)) {
      const bignerRole = newMember.guild.roles.cache.get(BIGNER_ROLE_ID);
      if (bignerRole) {
        try {
          await newMember.roles.remove(bignerRole);
          console.log(`Removed BIGNER_ROLE_ID from ${newMember.user.tag} as they have ROBLOX_ROLE_ID.`);
        } catch (error) {
          console.error(`Failed to remove BIGNER_ROLE_ID from ${newMember.user.tag}:`, error);
        }
      } else {
        console.error(`Role with ID ${BIGNER_ROLE_ID} not found.`);
      }
    }
  }
});

// Discordボットのログイン
console.log('Starting Discord bot login...');
client.login(DISCORD_BOT_TOKEN)
  .then(() => {
    console.log('Discord bot login successful');
  
     // HTTPサーバーの起動（ログイン成功後に開始）
http
  .createServer(async (request, response) => {  // async を追加
    console.log("post from gas");

    try {  // エラーハンドリングを追加
      const guild = await client.guilds.fetch(GUILD_ID);  // fetch を使用
      if (!guild) {
        console.error(`Guild with ID ${GUILD_ID} not found.`);
        response.statusCode = 500;
        response.end("Guild not found.");
        return;
      }

      const bignerRole = guild.roles.cache.get(BIGNER_ROLE_ID);
      if (!bignerRole) {
        console.error(`Role with ID ${BIGNER_ROLE_ID} not found.`);
        response.statusCode = 500;
        response.end("Role not found.");
        return;
      }

      // メンバー処理部分も非同期で処理
      const members = await guild.members.fetch();
      members.each((member) => {
        if (!member.user.bot) {
          const memberRoles = member.roles.cache;
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

      if (request.headers["content-type"] === "application/json") {
        let requestBody = "";

        request.on("data", (chunk) => {
          requestBody += chunk.toString();
        });

        request.on("end", async () => {  // async を追加
          try {
            const data = JSON.parse(requestBody);
            const userData = data.postData;
            const channel = await client.channels.fetch(MSG_SEND_CHANNEL_ID);  // fetch を使用
            
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
              let message = `<@${userId}> さん\n本日のMetaGreenSeedsポイントを配布します。\n\n内訳：\n`;
              
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

            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.statusCode = 200;
            const responseBody = { message: "Data received and API is active now." };
            response.write(JSON.stringify(responseBody));
            response.end();

          } catch (error) {
            console.error('Error processing request:', error);
            response.statusCode = 500;
            response.end("Internal Server Error");
          }
        });
      } else {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.statusCode = 400;
        const responseBody = {
          error: "Invalid content type. Expected application/json.",
        };
        response.write(JSON.stringify(responseBody));
        response.end();
      }

    } catch (error) {
      console.error('Error:', error);
      response.statusCode = 500;
      response.end("Internal Server Error");
    }
  })
  .listen(3000, () => {
    console.log('Server is running on port 3000');
  });
   
    // main.jsの読み込みを削除
    // require('./main.js'); // この行を削除します
  })
  .catch(error => {
    console.error('Discord bot login failed:', error);
    process.exit(1);
  });

// clientをエクスポート
module.exports = client;