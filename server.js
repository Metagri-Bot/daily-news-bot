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
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessages,
    // 必要なインテントのみを追加
  ]
});

// 招待キャッシュを保持するMap
const invitesCache = new Map();

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
    invites.each(inv => {
      invitesCache.set(inv.code, inv.uses);
      console.log(`Cached invite: Code=${inv.code}, Uses=${inv.uses}`);
    });
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

    // キャッシュを更新
    newInvites.each(inv => invitesCache.set(inv.code, inv.uses));

    if (usedInvite) {
      console.log(`Used invite code: ${usedInvite.code}`);
      console.log(`Configured INVITE_CODE: ${INVITE_CODE}`);
    } else {
      console.log(`Used invite code: Unknown`);
    }

    if (usedInvite && usedInvite.code === INVITE_CODE) {
      console.log(`Invite code matches INVITE_CODE (${INVITE_CODE}). Proceeding to assign roles.`);
      const robloxRole = guild.roles.cache.get(ROBLOX_ROLE_ID);
      if (robloxRole) {
        try {
          await member.roles.add(robloxRole);
          console.log(`Assigned ROBLOX_ROLE_ID to ${member.user.tag} via invite code ${INVITE_CODE}.`);

          // 「BIGNER_ROLE_ID」を削除
          if (member.roles.cache.has(BIGNER_ROLE_ID)) {
            const bignerRole = guild.roles.cache.get(BIGNER_ROLE_ID);
            if (bignerRole) {
              await member.roles.remove(bignerRole);
              console.log(`Removed BIGNER_ROLE_ID from ${member.user.tag} as they have ROBLOX_ROLE_ID.`);
            } else {
              console.error(`Role with ID ${BIGNER_ROLE_ID} not found.`);
            }
          }
        } catch (error) {
          console.error(`Failed to assign ROBLOX_ROLE_ID to ${member.user.tag}:`, error);
        }
      } else {
        console.error(`Role with ID ${ROBLOX_ROLE_ID} not found.`);
      }
    } else {
      console.log(`Member ${member.user.tag} joined using invite code: ${usedInvite ? usedInvite.code : 'Unknown'}`);
    }

    // **追加部分: ROBLOX_MEMBER_ROLE_ID を持っている場合、ROBLOX_ROLE_ID を削除**
    if (member.roles.cache.has(ROBLOX_MEMBER_ROLE_ID)) {
      const robloxRole = guild.roles.cache.get(ROBLOX_ROLE_ID);
      if (robloxRole) {
        try {
          await member.roles.remove(robloxRole);
          console.log(`Removed ROBLOX_ROLE_ID from ${member.user.tag} because they have ROBLOX_MEMBER_ROLE_ID.`);
        } catch (error) {
          console.error(`Failed to remove ROBLOX_ROLE_ID from ${member.user.tag}:`, error);
        }
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

  // **追加部分: ROBLOX_MEMBER_ROLE_ID が追加された場合、ROBLOX_ROLE_ID を削除**
  const hadRobloxMemberRole = oldMember.roles.cache.has(ROBLOX_MEMBER_ROLE_ID);
  const hasRobloxMemberRole = newMember.roles.cache.has(ROBLOX_MEMBER_ROLE_ID);

  if (!hadRobloxMemberRole && hasRobloxMemberRole) {
    console.log(`ROBLOX_MEMBER_ROLE_ID has been added to ${newMember.user.tag}.`);

    // ROBLOX_ROLE_ID を削除
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

  // **既存の処理: ROBLOX_ROLE_ID が追加された場合の処理を保持**
  const hadRobloxRole = oldMember.roles.cache.has(ROBLOX_ROLE_ID);
  const hasRobloxRole = newMember.roles.cache.has(ROBLOX_ROLE_ID);

  if (!hadRobloxRole && hasRobloxRole) {
    console.log(`ROBLOX_ROLE_ID has been added to ${newMember.user.tag}.`);

    // 「BIGNER_ROLE_ID」を削除
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
client.login(DISCORD_BOT_TOKEN);

// HTTPサーバーの設定
http
  .createServer((request, response) => {
    console.log("post from gas");

    //--会員ロール調査--
    // 付与対象から除外するロールIDを列挙（グローバルに定義済みのEXCLUDED_ROLESを使用）
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
      console.error(`Guild with ID ${GUILD_ID} not found.`);
      return;
    }

    const bignerRole = guild.roles.cache.get(BIGNER_ROLE_ID); // 新たに付与するロールを取得
    if (!bignerRole) {
      console.error(`Role with ID ${BIGNER_ROLE_ID} not found.`);
      return;
    }

    guild.members.fetch().then((members) => {
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
      request.on("end", async () => { // async を追加
        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) {
          console.error(`Guild with ID ${GUILD_ID} not found.`);
          return;
        }

        const channel = client.channels.cache.get(MSG_SEND_CHANNEL_ID);
        if (!channel) {
          console.error(`Channel with ID ${MSG_SEND_CHANNEL_ID} not found.`);
          return;
        }

        let data;
        try {
          data = JSON.parse(requestBody);
        } catch (error) {
          console.error('Invalid JSON received:', error);
          response.statusCode = 400;
          response.write(JSON.stringify({ error: "Invalid JSON format." }));
          response.end();
          return;
        }

        const userData = data.postData;

        for (let i = 0; i < userData.length; i++) {
          let userId = userData[i].userId;
          let works = userData[i].works;
          let numPoint = userData[i].numPoint;
          let totalPoint = userData[i].totalPoint;
          let overPoint = userData[i].overPoint;
          let message = `<@${userId}> さん\n本日のMetaGreenSeedsポイントを配布します。\n\n内訳：\n`;
          for (let j = 0; j < works.length; j++) {
            message += `${works[j]}\n`;
          }
          message += `\n現在の合計MetaGreenSeedsポイントは ${totalPoint} ポイントです。\n`;

          try {
            if (overPoint === 30) {
              await guild.members.fetch(userId);
              const member = guild.members.cache.get(userId);
              if (member) {
                await member.roles.add(ROLES[0]);
                message += `\n【お知らせ】MetaGreenSeedsポイントが30ポイント溜ってます。\nこちら ${URLS[0]} をご確認ください。`;
              } else {
                console.error(`Member with ID ${userId} not found.`);
              }
            }
            if (overPoint === 60) {
              await guild.members.fetch(userId);
              const member = guild.members.cache.get(userId);
              if (member) {
                await member.roles.add(ROLES[1]);
                message += `\n【お知らせ】MetaGreenSeedsポイントが60ポイント溜ってます。\nこちら ${URLS[1]} をご確認ください。`;
              } else {
                console.error(`Member with ID ${userId} not found.`);
              }
            }
            if (overPoint === 100) {
              await guild.members.fetch(userId);
              const member = guild.members.cache.get(userId);
              if (member) {
                await member.roles.add(ROLES[2]);
                message += `\n【お知らせ】MetaGreenSeedsポイントが100ポイント溜ってます。\nこちら ${URLS[2]} をご確認ください。`;
              } else {
                console.error(`Member with ID ${userId} not found.`);
              }
            }
            await channel.send(message);
          } catch (error) {
            console.error(`Failed to process user data for user ID ${userId}:`, error);
          }
        }

        // レスポンスを設定して200 OKを返す
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.statusCode = 200;
        const responseBody = { message: "Data received and API is active now." };
        response.write(JSON.stringify(responseBody));
        response.end();
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
  .listen(3000);

require("./main.js");
