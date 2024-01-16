const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GAS_API_URL = process.env.GAS_API_URL;
const client = new Client({
  intents: Object.values(GatewayIntentBits).reduce((a, b) => a | b)
});

const TARGET_ROLE_ID = "1144596048803791019";
const TARGET_CHANNEL_IDS = [1195186452691177582,1195186471708131409,1195186490607685743,1195186507321966633,1195186524258578513,1195186542545748088,1195186544064077944,1195186560547692605]

client.once("ready", () => {
  console.log('Bot is ready!');
});
client.login(DISCORD_BOT_TOKEN);

client.on("messageCreate", async message => {
  if(message.author.bot) return;
  if (!message.member.roles.cache.has(TARGET_ROLE_ID)) return;
  let workNum = 0;
  const userId = message.author.id;
  const userName = message.author.tag;
  const content = message.content;
  const channelId = message.channel.id;
  const file = message.attachments.first();
  let isInImageFile = false; 
  
  // 添付ファイルの有無を調べる
  if(file){
      // 添付ファイルが画像ファイルか調べる
    if (file.height && file.width){
      isInImageFile = true;
    }
  }
  
  const isReplay = message.reference;
  
  if(channelId == TARGET_CHANNEL_IDS[0]){
    workNum = 0;
  }
  else if(channelId == TARGET_CHANNEL_IDS[1] && isReplay){
    workNum = 1;
  }
  else if(channelId == TARGET_CHANNEL_IDS[2]){
    if(isInImageFile){
      workNum = 2;
    }
    else if(isReplay){
      workNum = 3;
    }
    else{
      return;
    }
  }
  else if(channelId == TARGET_CHANNEL_IDS[3]){
    if(isReplay){
      workNum = 5;
    }
    else{
      workNum = 4;
    }
  }
  else if(channelId == TARGET_CHANNEL_IDS[4]){
    if(isReplay){
      workNum = 7;
    }
    else{
      workNum = 6;
    }
  }
  else if(channelId == TARGET_CHANNEL_IDS[5]){
    workNum = 8;
  }
  else if(channelId == TARGET_CHANNEL_IDS[6]){
    workNum = 9;
  }
  else if(channelId == TARGET_CHANNEL_IDS[7]){
    workNum = 10;
  }
  else{
    return;
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