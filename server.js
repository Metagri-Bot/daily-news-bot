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

// ロール追加・削除の関数化
async function addRole(member, roleId, logPrefix = '') {
  const role = member.guild.roles.cache.get(roleId);
  if (role) {
    try {
      await member.roles.add(role);
      console.log(`${logPrefix} Added role ${roleId} to ${member.user.tag}`);
    } catch (error) {
      console.error(`${logPrefix} Failed to add role ${roleId} to ${member.user.tag}:`, error);
    }
  } else {
    console.error(`${logPrefix} Role with ID ${roleId} not found.`);
  }
}

async function removeRole(member, roleId, logPrefix = '') {
  const role = member.guild.roles.cache.get(roleId);
  if (role && member.roles.cache.has(roleId)) {
    try {
      await member.roles.remove(role);
      console.log(`${logPrefix} Removed role ${roleId} from ${member.user.tag}`);
    } catch (error) {
      console.error(`${logPrefix} Failed to remove role ${roleId} from ${member.user.tag}:`, error);
    }
  } else {
    console.error(`${logPrefix} Role with ID ${roleId} not found or member does not have the role.`);
  }
}

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

    if (usedInvite) {
      console.log(`Used invite code: ${usedInvite.code}`);
      console.log(`Configured INVITE_CODE: ${INVITE_CODE}`);
    } else {
      console.log(`Used invite code: Unknown`);
    }

    if (usedInvite && usedInvite.code === INVITE_CODE) {
      const robloxRole = guild.roles.cache.get(ROBLOX_ROLE_ID);
      // ROBLOX_MEMBER_ROLE_ID は別のBotで付与されているため、ここでは扱わない
      if (robloxRole) {
        await addRole(member, ROBLOX_ROLE_ID, '[guildMemberAdd]');
        await removeRole(member, BIGNER_ROLE_ID, '[guildMemberAdd]');
      } else {
        console.error(`Role with ID ${ROBLOX_ROLE_ID} not found.`);
      }
    } else {
      console.log(`Member ${member.user.tag} joined using invite code: ${usedInvite ? usedInvite.code : 'Unknown'}`);
    }

    // **追加部分: 何もロールが付いていない場合にBIGNER_ROLE_IDを付与**
    if (member.roles.cache.size === 1) { // @everyoneのみ
      await addRole(member, BIGNER_ROLE_ID, '[guildMemberAdd]');
    }

    // **既存の追加部分: ROBLOX_MEMBER_ROLE_ID を持っている場合、ROBLOX_ROLE_ID を削除**
    if (member.roles.cache.has(ROBLOX_MEMBER_ROLE_ID)) {
      await removeRole(member, ROBLOX_ROLE_ID, '[guildMemberAdd]');
    }

  } catch (error) {
    console.error(`Error processing guildMemberAdd for ${member.user.tag}:`, error);
  }
});

// メンバーのロールが更新されたときの処理
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  // 対象ギルドのみ処理
  if (newMember.guild.id !== GUILD_ID) return;

  // **既存の処理: ROBLOX_MEMBER_ROLE_ID が追加された場合、ROBLOX_ROLE_ID を削除**
  const hadRobloxMemberRole = oldMember.roles.cache.has(ROBLOX_MEMBER_ROLE_ID);
  const hasRobloxMemberRole = newMember.roles.cache.has(ROBLOX_MEMBER_ROLE_ID);

  if (!hadRobloxMemberRole && hasRobloxMemberRole) {
    console.log(`ROBLOX_MEMBER_ROLE_ID has been added to ${newMember.user.tag}.`);
    await removeRole(newMember, ROBLOX_ROLE_ID, '[guildMemberUpdate]');
  }

  // **既存の処理: ROBLOX_ROLE_ID が追加された場合の処理を保持**
  const hadRobloxRole = oldMember.roles.cache.has(ROBLOX_ROLE_ID);
  const hasRobloxRole = newMember.roles.cache.has(ROBLOX_ROLE_ID);

  if (!hadRobloxRole && hasRobloxRole) {
    console.log(`ROBLOX_ROLE_ID has been added to ${newMember.user.tag}.`);
    await removeRole(newMember, BIGNER_ROLE_ID, '[guildMemberUpdate]');
  }

  // **追加部分: メンバーが全てのロールを失った場合にBIGNER_ROLE_IDとROBLOX_MEMBER_ROLE_IDを付与**
  if (
    newMember.roles.cache.size === 1 &&
    !newMember.roles.cache.has(BIGNER_ROLE_ID) &&
    !newMember.roles.cache.has(ROBLOX_MEMBER_ROLE_ID)
  ) { // @everyoneのみ
    await addRole(newMember, BIGNER_ROLE_ID, '[guildMemberUpdate]');
    await addRole(newMember, ROBLOX_MEMBER_ROLE_ID, '[guildMemberUpdate]');
  }
});

// Discordボットのログイン
client.login(DISCORD_BOT_TOKEN);

// HTTPサーバーの設定
http
  .createServer(async (request, response) => {
    console.log("Received a request from external source.");

    //--会員ロール調査--
    // 付与対象から除外するロールIDを列挙は既にEXCLUDED_ROLESとして定義済み

    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
      console.error(`Guild with ID ${GUILD_ID} not found.`);
      response.statusCode = 500;
      response.end(JSON.stringify({ error: "Guild not found." }));
      return;
    }

    const bignerRole = guild.roles.cache.get(BIGNER_ROLE_ID); // 新たに付与するロールを取得
    if (!bignerRole) {
      console.error(`BIGNER_ROLE_ID with ID ${BIGNER_ROLE_ID} not found.`);
      response.statusCode = 500;
      response.end(JSON.stringify({ error: "Bigner role not found." }));
      return;
    }

    try {
      const members = await guild.members.fetch();
      const rolePromises = [];

      members.each((member) => {
        if (!member.user.bot) {
          const memberRoles = member.roles.cache;
          const hasExcludedRole = memberRoles.some(role => EXCLUDED_ROLES.includes(role.id));

          if (hasExcludedRole && memberRoles.has(BIGNER_ROLE_ID)) {
            rolePromises.push(
              removeRole(member, BIGNER_ROLE_ID, '[HTTP Server]')
            );
          }

          // **追加部分: 何もロールが付いていないメンバーにBIGNER_ROLE_IDを付与**
          if (memberRoles.size === 1 && !memberRoles.has(BIGNER_ROLE_ID)) { // @everyoneのみ
            rolePromises.push(
              addRole(member, BIGNER_ROLE_ID, '[HTTP Server]')
            );
          }
        }
      });

      await Promise.all(rolePromises);
      console.log("Completed role removal and assignment process from HTTP server.");
    } catch (error) {
      console.error("Error during role removal and assignment in HTTP server:", error);
    }
    //--会員ロール調査終了--

    // リクエストヘッダーのコンテンツタイプをチェック
    if (request.headers["content-type"] === "application/json") {
      let requestBody = "";

      // リクエストデータを受信する際に発生する 'data' イベントのハンドラを設定
      request.on("data", (chunk) => {
        requestBody += chunk.toString();
      });

      // リクエストデータの受信が完了した際に発生する 'end' イベントのハンドラを設定
      request.on("end", async () => {
        try {
          const data = JSON.parse(requestBody);
          const userData = data.postData;

          if (!userData || !Array.isArray(userData)) {
            throw new Error("Invalid postData format.");
          }

          const channel = client.channels.cache.get(MSG_SEND_CHANNEL_ID);
          if (!channel) {
            console.error(`Channel with ID ${MSG_SEND_CHANNEL_ID} not found.`);
            response.statusCode = 500;
            response.end(JSON.stringify({ error: "Channel not found." }));
            return;
          }

          await guild.members.fetch(); // メンバーのキャッシュを更新

          const messagePromises = userData.map(async (user) => {
            const { userId, works, numPoint, totalPoint, overPoint } = user;
            const member = guild.members.cache.get(userId);
            if (!member) {
              console.warn(`Member with ID ${userId} not found.`);
              return;
            }

            let message = `<@${userId}> さん\n本日のMetaGreenSeedsポイントを配布します。\n\n内訳：\n`;
            works.forEach(work => {
              message += `${work}\n`;
            });
            message += `\n現在の合計MetaGreenSeedsポイントは ${totalPoint} ポイントです。\n`;

            if (overPoint === 30) {
              await addRole(member, ROLES[0], '[HTTP Server]');
              message += `\n【お知らせ】MetaGreenSeedsポイントが30ポイント溜ってます。\nこちら ${URLS[0]} をご確認ください。`;
            }
            if (overPoint === 60) {
              await addRole(member, ROLES[1], '[HTTP Server]');
              message += `\n【お知らせ】MetaGreenSeedsポイントが60ポイント溜ってます。\nこちら ${URLS[1]} をご確認ください。`;
            }
            if (overPoint === 100) {
              await addRole(member, ROLES[2], '[HTTP Server]');
              message += `\n【お知らせ】MetaGreenSeedsポイントが100ポイント溜ってます。\nこちら ${URLS[2]} をご確認ください。`;
            }

            await channel.send(message);
          });

          await Promise.all(messagePromises);

          // レスポンスを設定して200 OKを返す
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.statusCode = 200;
          const responseBody = { message: "Data received and API is active now." };
          response.write(JSON.stringify(responseBody));
          response.end();
        } catch (error) {
          console.error("Error processing HTTP request:", error);
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.statusCode = 400;
          response.end(JSON.stringify({ error: error.message }));
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
    console.log("HTTP server is listening on port 3000.");
  });

require("./main.js");