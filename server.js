// 必要なモジュールのインポート
const { Client, GatewayIntentBits } = require("discord.js");
const http = require("http");
require("dotenv").config();

// 環境変数の取得
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const MSG_SEND_CHANNEL_ID = process.env.MSG_SEND_CHANNEL_ID;
const BIGNER_ROLE_ID = process.env.BIGNER_ROLE_ID;
const NFT_ROLE_ID = process.env.NFT_ROLE_ID; // ← 20250810を追加
const ROLES = [
  process.env.PER_30_ROLE_ID,
  process.env.PER_60_ROLE_ID,
  process.env.PER_100_ROLE_ID,
];
const URLS = [
  process.env.PER_30_URL,
  process.env.PER_60_URL,
  process.env.PER_100_URL,
  process.env.PER_10_URL, // ← 20250810を追加
];
const INVITE_CODE = process.env.INVITE_CODE;
const ROBLOX_ROLE_ID = process.env.ROBLOX_ROLE_ID;
const ROBLOX_MEMBER_ROLE_ID = process.env.ROBLOX_MEMBER_ROLE_ID;
const EXCLUDED_ROLES = [process.env.MANAGER_ID];

// Discordクライアントの設定
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
});

const invitesCache = new Map();
require("./main.js")(client);

client.once("ready", async () => {
  console.log("Bot is ready!");

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const invites = await guild.invites.fetch();
    invites.each((inv) => invitesCache.set(inv.code, inv.uses));
    console.log("Invite cache initialized.");
  } catch (error) {
    console.error("Error during ready handler:", error);
  }
});

client.on("guildMemberAdd", async (member) => {
  if (member.guild.id !== GUILD_ID) return;

  try {
    const newInvites = await member.guild.invites.fetch();
    const usedInvite = newInvites.find(
      (inv) => inv.uses > (invitesCache.get(inv.code) || 0)
    );
    newInvites.each((inv) => invitesCache.set(inv.code, inv.uses));

    if (usedInvite?.code === INVITE_CODE) {
      const robloxRole = member.guild.roles.cache.get(ROBLOX_ROLE_ID);
      if (robloxRole) await member.roles.add(robloxRole);

      const bignerRole = member.guild.roles.cache.get(BIGNER_ROLE_ID);
      if (bignerRole && member.roles.cache.has(bignerRole.id)) {
        await member.roles.remove(bignerRole);
      }
    }

    if (member.roles.cache.has(ROBLOX_MEMBER_ROLE_ID)) {
      const robloxRole = member.guild.roles.cache.get(ROBLOX_ROLE_ID);
      if (robloxRole) await member.roles.remove(robloxRole);
    }
  } catch (error) {
    console.error(`guildMemberAdd error for ${member.user.tag}:`, error);
  }
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  if (newMember.guild.id !== GUILD_ID) return;

  const hadRoblox = oldMember.roles.cache.has(ROBLOX_ROLE_ID);
  const hasRoblox = newMember.roles.cache.has(ROBLOX_ROLE_ID);
  const hadRobloxMember = oldMember.roles.cache.has(ROBLOX_MEMBER_ROLE_ID);
  const hasRobloxMember = newMember.roles.cache.has(ROBLOX_MEMBER_ROLE_ID);

  try {
    if (!hadRobloxMember && hasRobloxMember && hasRoblox) {
      await newMember.roles.remove(ROBLOX_ROLE_ID);
    }
    if (!hadRoblox && hasRoblox && newMember.roles.cache.has(BIGNER_ROLE_ID)) {
      await newMember.roles.remove(BIGNER_ROLE_ID);
    }
  } catch (err) {
    console.error("guildMemberUpdate error:", err);
  }
});

client.login(DISCORD_BOT_TOKEN).then(() => {
  console.log("Discord bot login successful");

  http
    .createServer(async (req, res) => {
      if (req.method !== "POST") return res.end("Only POST allowed");

      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          let parsed;
          try {
            parsed = JSON.parse(body);
            console.log("受信データ:", parsed);
          } catch (e) {
            console.error("JSON parse error:", e, body);
            res.writeHead(400);
            return res.end("Invalid JSON");
          }
          const postData = parsed.postData;
          if (!Array.isArray(postData)) {
            console.error("postData is not an array or missing:", postData);
            res.writeHead(400);
            return res.end("Invalid postData");
          }
          const guild = await client.guilds.fetch(GUILD_ID);
          const channel = await client.channels.fetch(MSG_SEND_CHANNEL_ID);

          for (const { userId, works, totalPoint, overPoint } of postData) {
            let member = guild.members.cache.get(userId);
            if (!member) {
              try {
                member = await guild.members.fetch({ user: userId, cache: true });
              } catch (err) {
                console.error(`メンバー取得失敗: ${userId}`, err);
                continue; // 取得できない場合はスキップ
              }
            }
            let msg = `<@${userId}> さん\n本日のMetaGreenSeedsポイントを配布します。\n\n内訳：\n`;
            msg += works.join("\n") + `\n\n現在の合計MetaGreenSeedsポイントは ${totalPoint} ポイントです。`;

             // ★★★ 達成ポイントの処理を統一 ★★★ 20250810更新
 if ([10, 30, 60, 100].includes(overPoint)) {
              let roleToAssign;
              let urlToShow;
              let announcementMsg;

              if (overPoint === 10) {
                roleToAssign = NFT_ROLE_ID; // 10ポイント達成時は専用ロールIDを使用
                urlToShow = URLS[3]; // URLS配列の4番目 (インデックス3)
                announcementMsg = `\n\n**【🎉NFT獲得！】**\n10ポイント達成おめでとうございます！参加賞NFTを手に入れる権利が解放されました！\n詳細は こちら ${urlToShow} をご確認ください。`;
              } else {
                const roleIndex = [30, 60, 100].indexOf(overPoint);
                roleToAssign = ROLES[roleIndex]; // 30/60/100pt は既存のROLES配列から
                urlToShow = URLS[roleIndex];     // URLS配列の1〜3番目
                announcementMsg = `\n【お知らせ】MetaGreenSeedsポイントが${overPoint}ポイント溜まってます。\nこちら ${urlToShow} をご確認ください。`;
              }

              // ロール付与とメッセージ追記
              try {
                if (roleToAssign) {
                  const role = guild.roles.cache.get(roleToAssign);
                  if(role) await member.roles.add(role);
                }
                msg += announcementMsg;
              } catch (e) {
                console.error(`${overPoint}ポイント達成特典の処理中にエラー: ${userId}`, e);
              }
            }
            
            // 最終的な通知メッセージを送信
            await channel.send(msg);
          }
            
          //   if ([30, 60, 100].includes(overPoint)) {
          //     await member.roles.add(ROLES[[30, 60, 100].indexOf(overPoint)]);
          //     msg += `\n【お知らせ】MetaGreenSeedsポイントが${overPoint}ポイント溜まってます。\nこちら ${URLS[[30, 60, 100].indexOf(overPoint)]} をご確認ください。`;
          //   }
          //   await channel.send(msg);
          // }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "Data received and API is active now." }));
        } catch (e) {
          console.error("POST handling error:", e);
          res.writeHead(500);
          res.end("Internal Server Error");
        }
      });
    })
    .listen(3000, () => console.log("Server running on port 3000"));
});
