const http = require("http");
const { Client, GatewayIntentBits } = require("discord.js");
const client = new Client({
  intents: Object.values(GatewayIntentBits).reduce((a, b) => a | b)
});

const CHANNEL_ID = 1181411208419606640;
const CHANNEL = client.channels.cache.get(CHANNEL_ID);

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
        const data = JSON.parse(requestBody);
        const userData = data.postData;
        
        for(let i = 0; i < userData.length; i++){
          let userId = userData[i].userId;
          let works = userData[i].works;
          let numPoint = userData[i].numPoint;
          let totalPoint = userData[i].totalPoint;
          let addMessage = userData[i].addMessage;
          
          let message =`${userId}さん\n本日のMetaGreenSeedsポイントを配布します。\n\n内訳：\n`;
          for(let j = 0; j < works.length; j++){
            message = message + `${works[j]}\n`
          } 
          message = message + `\n現在の合計MetaGreenSeedsポイントは ${totalPoint} ポイントです。\n`;
          message = message + `\n${addMessage}`;
          CHANNEL.send(message);
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