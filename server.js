const http = require("http");
const { Client, GatewayIntentBits } = require("discord.js");
const client = new Client({
  intents: Object.values(GatewayIntentBits).reduce((a, b) => a | b)
});
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

client.once("ready", () => {
  console.log('Bot is ready!');
});
client.login(DISCORD_BOT_TOKEN);

http
  .createServer((request, response) => {
    console.log("post from gas");
  
    // 付与対象から除外するロールIDを列挙
    const EXCLUDED_ROLES = [
      '1057168094671425546',
      '1008002904151576576',
      '1091525998782201997',
      '1018319208989339658',
      '1099129007888408586',
      '985360194680787024',
      '1030643947875356696',
      '1025360923805876235',
      '1062992277645037649',
      '1083627275670523934',
      '1060445908275298355',
      '1153308394199982130',
      '1153308134748733470',
      '1115455932239986738'
    ];
  
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