const { Client, GatewayIntentBits } = require("discord.js");
const http = require("http");
const axios = require("axios");
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GAS_API_URL = process.env.GAS_API_URL;
const MESSAGE_SEND_CHANNEL_ID = process.env.MESSAGE_SEND_CHANNEL_ID;
const client = new Client({
  intents: Object.values(GatewayIntentBits).reduce((a, b) => a | b)
});

const TARGET_ROLE_ID = process.env.ROLE_ID;



client.once("ready", () => {
  console.log('Bot is ready!');
});
client.login(DISCORD_BOT_TOKEN);



client.on("messageCreate", async message => {
  if(message.author.bot) return;
  if (! message.member.roles.cache.has(TARGET_ROLE_ID)) return;
  
  let workNum = 0;
  const userId = message.author.id;
  const userName = message.author.tag;
  const content = message.content;
  const channelId = message.channel.id;
  const file = message.attachments.first();
  let inImageFile = false; 
  
  // 添付ファイルの有無を調べる
  if(file){
      // 添付ファイルが画像ファイルか調べる
    if (file.height && file.width){
      inImageFile = true;
    }
  }
  
  if(channelId == 0){
    workNum = 0;
  }
  else if(channelId == 0){
    workNum = 2;
  }
  else if(channelId == 0){
    workNum = 4;
  }
  else if(channelId == 0){
    workNum = 6;
  }
  else if(channelId == 0){
    workNum = 8;
  }
  else if(channelId == 0){
    workNum = 9;
  }
  else if(channelId == 0){
    workNum = 10;
  }
  
  let isAuto = true;
  const data={
    workNum: workNum,
    userId: userId,
    userName: userName,
    content: content,
    isAuto: isAuto
  }
  
  axios
    .post(GAS_API_URL, data)
    .then((response) => {
      console.log(response.data);
    })
    .catch((err) => {
      console.error("err:" + err);
    });
});