const http = require("http");
const { Client, GatewayIntentBits } = require("discord.js");
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const client = new Client({
  intents: Object.values(GatewayIntentBits).reduce((a, b) => a | b)
});

const CHANNEL_ID = "1189073026164203610";
const ROLES = ["30","60","100"];
const PER_30_URL = "https://discord.com/channels/951780348465909820/1189073026164203610";
const PER_60_URL = "https://discord.com/channels/951780348465909820/1189073026164203610";
const PER_100_URL = "https://discord.com/channels/951780348465909820/1189073026164203610";

client.once("ready", () => {
  console.log('Bot is ready!');
});
client.login(DISCORD_BOT_TOKEN);

http
  .createServer((request, response) => {
    console.log("post from gas");

    // リクエストヘッダーのコンテンツタイプをチェック
    if (request.headers["content-type"] === "application/json") {
      let requestBody = "";

      // リクエストデータを受信する際に発生する 'data' イベントのハンドラを設定
      request.on("data", (chunk) => {
        requestBody += chunk.toString();
      });

      // リクエストデータの受信が完了した際に発生する 'end' イベントのハンドラを設定
      request.on("end", () => {
        const guild = client.guilds.cache.get("1107480974343815299");
        const channel = client.channels.cache.get(CHANNEL_ID);
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
            message = message + `\n【お知らせ】MetaGreenSeedsポイントが30ポイント溜ってます。\nこちら ${PER_30_URL} をご確認ください。`;
          }
          if(overPoint == 60){
            guild.members.fetch();
            guild.members.cache.get(userId).roles.add(ROLES[1]);
            message = message + `\n【お知らせ】MetaGreenSeedsポイントが60ポイント溜ってます。\nこちら ${PER_60_URL} をご確認ください。`;
          }
          if(overPoint == 100){
            guild.members.fetch();
            guild.members.cache.get(userId).roles.add(ROLES[2]);
            message = message + `\n【お知らせ】MetaGreenSeedsポイントが100ポイント溜ってます。\nこちら ${PER_100_URL} をご確認ください。`;
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