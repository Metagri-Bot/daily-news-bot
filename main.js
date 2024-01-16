const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
const client = new Client({
  intents: Object.values(GatewayIntentBits).reduce((a, b) => a | b)
});
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GAS_API_URL = process.env.GAS_API_URL;
const BIGNER_ROLE_ID = process.env.BIGNER_ROLE_ID;

const TARGET_CHANNEL_IDS = [
  process.env.GREETING_CHANNEL_ID,
  process.env.TALK_CHANNEL_ID,
  process.env.FOOD_CHANNEL_ID,
  process.env.NEWS_CHANNEL_ID,
  process.env.BOOK_CHANNEL_ID,
  process.env.SNS_CHANNEL_ID,
  process.env.SEMINAR_CHANNEL_ID,
  process.env.OFF_LINE_MEETING_CHANNEL_ID
]

client.once("ready", () => {
  console.log('Bot is ready!');
});
client.login(DISCORD_BOT_TOKEN);

client.on("messageCreate", async message => {
  if(message.author.bot) return;
  if(message.member.roles.cache.has(BIGNER_ROLE_ID)){
    auto(message);
  }
  else if(message.member.roles.cache.has(BIGNER_ROLE_ID)){
    manual(message);
  }
});

const auto = (message) =>{
  let workNum = 0;
  const userId = message.author.id;
  const userName = message.author.tag;
  const content = message.content;
  const channelId = message.channel.id;
  const file = message.attachments.first();
  const isAuto = true;
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
    
  const data={
    workNum: workNum,
    userId: userId,
    userName: userName,
    content: content,
    isAuto: isAuto
  }
  
  post(data);
}

const manual = (message) =>{
  const userId = message.author.id;
  const userName = message.author.tag;
  const content = message.content;
  const isAuto = false;
  
  if (!message.mentions.has(BOT_ID) || message.mentions.everyone) {
    return;
  }
  message.mentions.users.forEach(user => console.log(user.username));
  
  client.channels.cache.get(message.channel).send("MetaGreenSeedsポイントがnumポイント配布されました");
  
  const data={
    userId: userId,
    userName: userName,
    numPoint: numPoint,
    content: content,
    isAuto: isAuto
  }
}

const post = (data) =>{
  axios
    .post(GAS_API_URL, data)
    .then((response) => {
      console.log(response.data);
    })
    .catch((err) => {
      console.error("err:" + err);
    });
}