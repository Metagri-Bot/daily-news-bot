const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GAS_API_URL = process.env.GAS_API_URL;
const client = new Client({
  intents: Object.values(GatewayIntentBits).reduce((a, b) => a | b)
});

const TARGET_ROLE_ID = "1144596048803791019";
const TARGET_CHANNEL_IDS = [1144601492570001488,952209559802507264,1163368521808490676,952206763539714088,1155062710808096839,1179240392047202315,9,10]

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