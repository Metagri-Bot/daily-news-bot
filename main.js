const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
const client = new Client({
  intents: Object.values(GatewayIntentBits).reduce((a, b) => a | b)
});
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GAS_API_URL = process.env.GAS_API_URL;
const GUILD_ID = process.env.GUILD_ID;
const TARGET_CHANNEL_IDS = [
  process.env.GREETING_CHANNEL_ID,  // 0
  process.env.TALK_CHANNEL_ID,
  process.env.FOOD_CHANNEL_ID,
  process.env.NEWS_CHANNEL_ID,
  process.env.BOOK_CHANNEL_ID,
  process.env.SNS_CHANNEL_ID,
  process.env.SEMINAR_CHANNEL_ID,
  process.env.OFF_LINE_MEETING_CHANNEL_ID,
  process.env.VOICE_CHANNEL_ID,
  process.env.SELF_INTRODUCTION_CHANNEL_ID,
  process.env.METAVERSE_CHANNEL_ID           // 10 (新規追加)
]
const BIGNER_ROLE_ID = process.env.BIGNER_ROLE_ID;
const MANAGER_ID = process.env.MANAGER_ID;
const INTERN_ROLE_ID = process.env.INTERN_ROLE_ID; //202410/4 インターンロール追加
const BOT_ID = process.env.BOT_ID;
const METAGRIST_ROLE_ID = process.env.METAGRIST_ROLE_ID;

let pretimeDict = new Map();

client.once("ready", () => {});
client.login(DISCORD_BOT_TOKEN);

//202410/4 インターンロール追加
client.on("messageCreate", async message => {
  if(message.author.bot) return;
  const member = message.member;
  
  if(member.roles.cache.has(BIGNER_ROLE_ID)){
    auto(message);
  }
  else if(member.roles.cache.has(MANAGER_ID) || member.roles.cache.has(INTERN_ROLE_ID)){
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
  else if(channelId == TARGET_CHANNEL_IDS[9]){
    workNum = 13;
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
  if(!message.mentions.has(BOT_ID) || message.mentions.everyone) {
    return;
  }
  const isAuto = false;
  const users = message.mentions.users;
  const userIds = [];
  users.forEach(user => userIds.push(user.id));
  const targetIds = userIds.filter(function(x){return x != BOT_ID});
  //正規表現で発行枚数を取得
  const regex = /(\d+)ポイント/; // 「枚」の直前の数字の1回以上の繰り返しを表す正規表現
  const matches = message.content.match(regex);
  const integerPart = matches ? parseInt(matches[0]) : null;//最初に検出された数字
  let issue = integerPart || 1;//発行枚数が検出されなければ１
  for(let i = 0; i < targetIds.length; i++){
  //client.channels.cache.get(message.channelId).send(`${targetIds[i]}さんにMetaGreenSeedsポイントが${issue}ポイント配布されました`);
    let data={
      userId: targetIds[i],
      userName: client.users.cache.get(targetIds[i]).username,
      numPoint: issue,
      content: message.content,
      isAuto: isAuto
    }
    console.log(data);
    post(data);
  }
}

client.on('voiceStateUpdate', (oldState, newState) => {
  // 入室検知
  if (!oldState.channelId && newState.channelId === TARGET_CHANNEL_IDS[8]) {
    pretimeDict.set(newState.member.id, Date.now());
  }
  // 退室検知
  if (oldState.channelId === TARGET_CHANNEL_IDS[8] && !newState.channelId) {
    const joinTime = pretimeDict.get(newState.member.id);
    if (joinTime) {
      const durationTime = Date.now() - joinTime;
      pretimeDict.delete(newState.member.id);
      // ロールのチェック
      const hasRole = (member, roleId) => member.roles.cache.has(roleId);
      if (!hasRole(newState.member, BIGNER_ROLE_ID)) return;
      // 長時間滞在用メッセージ送信
      const durationSeconds = Math.floor(durationTime / 1000);
      if (durationSeconds >= 2) {
        const data={
          workNum: 11,
          userId: newState.member.id,
          userName: client.users.cache.get(newState.member.id).username,
          content: "",
          isAuto: true
        }
        post(data);
      }
    }
  }
});

client.on('guildMemberAdd', member => {
  const guild = client.guilds.cache.get(GUILD_ID)
  const bignerRole = guild.roles.cache.get(BIGNER_ROLE_ID);
  member.roles.add(bignerRole);
  
  const data={
    workNum: 12,
    userId: member.id,
    userName: client.users.cache.get(member.id).username,
    content: "",
    isAuto: true
  }
  console.log(data);
  post(data);
});

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