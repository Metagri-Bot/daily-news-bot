/*
// 環境変数
const ss = SpreadsheetApp.getActiveSpreadsheet();
const WORK_SHEET = ss.getSheetByName("活動一覧");
const MEMBER_SHEET = ss.getSheetByName("メンバー一覧");
const EXCLUDE_USER_SHEET = ss.getSheetByName("除外メンバー");
const DISTRIBUTE_POINT_DAILY_SHEET = ss.getSheetByName("日間配布");
const DISTRIBUTE_POINT_WEEKLY_SHEET = ss.getSheetByName("週間配布");
const ELSE_SHEET = ss.getSheetByName("定義外");
const LOG_SHEET = ss.getSheetByName("配布ログ");
const FIRST_SHEET = ss.getSheetByName("初回参加");
const SELF_INTRODUCTION_SHEET = ss.getSheetByName("自己紹介投稿");


const GLITCH_URL = PropertiesService.getScriptProperties().getProperty
('GLITCH_URL');

let allWorkInfo = [];

// 文字列をカンマ区切りの配列にする
const parseStringToArray = (str) =>{
  if (str.includes(',')) {
    return str.split(',');
  } else {
    return [str];
  }
}

// 活動シート値取得
for(let i = 0; i < WORK_SHEET.getLastRow() - 1; i++){
  let workNum = WORK_SHEET.getRange(i + 2, 1).getValue();
  let workName = WORK_SHEET.getRange(i + 2, 2).getValue();
  let numPoint = WORK_SHEET.getRange(i + 2, 3).getValue();
  let cycle = WORK_SHEET.getRange(i + 2, 4).getValue();
  let regex = parseStringToArray(WORK_SHEET.getRange(i + 2, 5).getValue());
  allWorkInfo.push({workNum: workNum, workName: workName, numPoint: numPoint, cycle: cycle, regex: regex});
}

// 入力部(main)
const doPost = (e) => {

  const data = JSON.parse(e.postData.contents); // POSTデータをJSONとして解析
  const workNum = data.workNum;
  const userId = data.userId;
  const userName = data.userName;
  const content = data.content;
  const isAuto = data.isAuto;

  if(isAuto && checkExcludeUser(userId) && checkRegex(workNum, content)){
    const workName = allWorkInfo[workNum].workName;
    const numPoint = allWorkInfo[workNum].numPoint;
    const cycle = allWorkInfo[workNum].cycle;
    updateAutoSheet(workName, userId, userName, numPoint, cycle);
  }
  else if(!isAuto){
    const numPoint = data.numPoint;
    setValueLastRow(ELSE_SHEET, 1, [[userId, userName, numPoint, new Date(), data.content]]);
    setValueLastRow(DISTRIBUTE_POINT_WEEKLY_SHEET, 1, [[userId, userName, "自動配布定義外", numPoint, new Date()]]);
  }

  return ContentService.createTextOutput('POST request received successfully'); // 成功メッセージを返す
}

// 除外メンバーチェック
const checkExcludeUser = (userId) => {
  if(EXCLUDE_USER_SHEET.getRange(2, 1).getValue() == "") return true;

  let excludeUsers = EXCLUDE_USER_SHEET.getRange(2, 1, EXCLUDE_USER_SHEET.getLastRow() - 1, 1).getValues();

  // 除外対象者なら処理をしない
  for(let i = 0; i < excludeUsers.length; i++){
    if(excludeUsers[i] == userId){
      return false;
    }
  }
  return true;
}

// 正規表現チェック
const checkRegex = (workNum, content) =>{
  for(let i = 0; i < allWorkInfo.length; i++){
    if(i == workNum){
      if(i == 4 || i == 6 || i == 8){
        for (let j = 0; j < allWorkInfo[i].regex.length; j++) {
          if (content.includes(allWorkInfo[i].regex[j])) {
            return true;
          }
        }
        return false;
      }
      return true;
    }
  }
 }

// 配布シート更新
const updateAutoSheet = (workName, userId, userName, numPoint, cycle) => {
  let sheet;
  const now = new Date();

  if(cycle == 1){
    sheet = DISTRIBUTE_POINT_DAILY_SHEET;
  }
  else if(cycle == 7){
    sheet = DISTRIBUTE_POINT_WEEKLY_SHEET;
  }
  else if(cycle == 0){
    if(workName == "初回参加"){
      if(FIRST_SHEET.getRange(2, 1).getValue() != ""){
        const userIds = FIRST_SHEET.getRange(2, 1, FIRST_SHEET.getLastRow() - 1, 1).getValues().flat();
        for(let i = 0; i < userIds.length; i++){
          if(userIds[i] == userId){
            return;
          }
        }
      }
      setValueLastRow(FIRST_SHEET, 1, [[userId, userName, now]]);
      sheet = DISTRIBUTE_POINT_DAILY_SHEET;
    }
    else if(workName == "自己紹介投稿"){
      if(SELF_INTRODUCTION_SHEET.getRange(2, 1).getValue() != ""){
        const userIds = SELF_INTRODUCTION_SHEET.getRange(2, 1, SELF_INTRODUCTION_SHEET.getLastRow() - 1, 1).getValues().flat();
        for(let i = 0; i < userIds.length; i++){
          if(userIds[i] == userId){
            return;
          }
        }
      }
      setValueLastRow(SELF_INTRODUCTION_SHEET, 1, [[userId, userName, now]]);
      sheet = DISTRIBUTE_POINT_DAILY_SHEET;
    }
  }

  if(sheet.getRange(2, 1).getValue() == ""){
    setValueLastRow(sheet, 1, [[userId, userName, workName, numPoint, now]]);
    return;
  }
  
  const workAndUserId = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  
  for(let i = 0; i < workAndUserId.length; i++){
    if(workAndUserId[i][2] == workName && workAndUserId[i][0] == userId){
      return;
    }
  }

  setValueLastRow(sheet, 1, [[userId, userName, workName, numPoint, now]]);
}

// 配布シートを集計する
const aggregateSheet = () => {
  
  if(DISTRIBUTE_POINT_DAILY_SHEET.getLastRow() == 1 && DISTRIBUTE_POINT_WEEKLY_SHEET.getLastRow() == 1){
    return [];
  }
  
  if((new Date).getDay() == 5 && !(DISTRIBUTE_POINT_WEEKLY_SHEET.getLastRow() == 1)){
    const tmp = DISTRIBUTE_POINT_WEEKLY_SHEET.getRange(2, 1, DISTRIBUTE_POINT_WEEKLY_SHEET.getLastRow() - 1, DISTRIBUTE_POINT_WEEKLY_SHEET.getLastColumn()).getValues();
    setValueLastRow(DISTRIBUTE_POINT_DAILY_SHEET, tmp.length, tmp);
    DISTRIBUTE_POINT_WEEKLY_SHEET.deleteRows(2, DISTRIBUTE_POINT_WEEKLY_SHEET.getLastRow() - 1);
  }

  if(DISTRIBUTE_POINT_DAILY_SHEET.getLastRow() == 1){
    return [];
  }

  setValueLastRow(LOG_SHEET, DISTRIBUTE_POINT_DAILY_SHEET.getLastRow() - 1, DISTRIBUTE_POINT_DAILY_SHEET.getRange(2, 1, DISTRIBUTE_POINT_DAILY_SHEET.getLastRow() - 1, DISTRIBUTE_POINT_DAILY_SHEET.getLastColumn()).getValues());

  const userIds =  DISTRIBUTE_POINT_DAILY_SHEET.getRange(2, 1, DISTRIBUTE_POINT_DAILY_SHEET.getLastRow() - 1, 1).getValues().flat();
  const userNames =  DISTRIBUTE_POINT_DAILY_SHEET.getRange(2, 2, DISTRIBUTE_POINT_DAILY_SHEET.getLastRow() - 1, 1).getValues().flat();
  const workNames = DISTRIBUTE_POINT_DAILY_SHEET.getRange(2, 3, DISTRIBUTE_POINT_DAILY_SHEET.getLastRow() - 1, 1).getValues().flat();
  const points = DISTRIBUTE_POINT_DAILY_SHEET.getRange(2, 4, DISTRIBUTE_POINT_DAILY_SHEET.getLastRow() - 1, 1).getValues().flat();

  users = [
    {userId: userIds[0], userName: userNames[0], works: [workNames[0]], numPoint: points[0]}
  ];

  for(let i = 1; i < DISTRIBUTE_POINT_DAILY_SHEET.getLastRow() - 1; i++){
    let f = true;
    for(let j = 0; j < users.length; j++){
      if (users[j].userId == userIds[i]){
        users[j].works.push(workNames[i]);
        users[j].numPoint += points[i];
        f = false;
        break;
      }
    }
    if(f){
      users.push({userId: userIds[i], userName: userNames[i], works: [workNames[i]], numPoint: points[i]});
    }
  }
  
  DISTRIBUTE_POINT_DAILY_SHEET.deleteRows(2, DISTRIBUTE_POINT_DAILY_SHEET.getLastRow() - 1);

  return users;
}

// 配布する
const distributePoint = () =>{
  
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(18, 0, 0);

  delTrigger("distributePoint");
  setTrigger("distributePoint", date);

  // メンバーシート値取得
  const getMemberheet = () =>{
    let allMemberInfo = [];
    for(let i = 0; i < MEMBER_SHEET.getLastRow() - 1; i++){
      let userId = MEMBER_SHEET.getRange(i + 2, 1).getValue();
      let userName = MEMBER_SHEET.getRange(i + 2, 2).getValue();
      let totalPoint = MEMBER_SHEET.getRange(i + 2, 3).getValue();
      let per30 = MEMBER_SHEET.getRange(i + 2, 4).getValue();
      let per60 = MEMBER_SHEET.getRange(i + 2, 5).getValue();
      let per90 = MEMBER_SHEET.getRange(i + 2, 6).getValue();

      allMemberInfo.push({userId: userId, userName: userName, totalPoint: totalPoint, 
      per30: per30, per60: per60, per90: per90});
    }
    return allMemberInfo;
  }

  const allMemberInfoBeforeUpdate = getMemberheet();
  const users = aggregateSheet();
  let firstFlag = false;

  if(users == []) return;

  if(MEMBER_SHEET.getLastRow() == 1){
    let tmp = [];
    firstFlag = true;
    for(let i = 0; i < users.length; i++){
      tmp.push([users[i].userId, users[i].userName, users[i].numPoint, false, false, false]);
    }
    setValueLastRow(MEMBER_SHEET, users.length, tmp);
  }

  if(!firstFlag){
    for(let i = 0; i < users.length; i++){
      let f = true;
      for(let j = 0; j < allMemberInfoBeforeUpdate.length; j++){
        if (users[i].userId == allMemberInfoBeforeUpdate[j].userId){
          MEMBER_SHEET.getRange(j + 2, 3).setValue(users[i].numPoint + allMemberInfoBeforeUpdate[j].totalPoint);
          f = false;
          break;
        }
      }
      if(f){
        setValueLastRow(MEMBER_SHEET, 1, [[users[i].userId, users[i].userName, users[i].numPoint, false, false, false]]);
      }
    }
  }

  const allMemberInfoAfterUpdate = getMemberheet();
  const postData = users;

  for(let i = 0; i < postData.length; i++){
    postData[i].overPoint = 0;
  }

  for(let i = 0; i < allMemberInfoAfterUpdate.length; i++){
    for(let j = 0; j < postData.length; j++){
      if(allMemberInfoAfterUpdate[i].userId == postData[j].userId){
        postData[j].totalPoint = allMemberInfoAfterUpdate[i].totalPoint;
        if(!allMemberInfoAfterUpdate[i].per30 && allMemberInfoAfterUpdate[i].totalPoint >= 30 && allMemberInfoAfterUpdate[i].totalPoint < 60){
          postData[i].overPoint = 30;
          MEMBER_SHEET.getRange(i + 2, 4).setValue(true);
        }
        else if(!allMemberInfoAfterUpdate[i].per60 && allMemberInfoAfterUpdate[i].   totalPoint >= 60 && allMemberInfoAfterUpdate[i].totalPoint < 100){
          postData[i].overPoint = 60;
          MEMBER_SHEET.getRange(i + 2, 4).setValue(true);
          MEMBER_SHEET.getRange(i + 2, 5).setValue(true);
        }
        else if(!allMemberInfoAfterUpdate[i].per100 && allMemberInfoAfterUpdate[i].totalPoint >= 100){
          postData[i].overPoint = 100;
          MEMBER_SHEET.getRange(i + 2, 4).setValue(true);
          MEMBER_SHEET.getRange(i + 2, 5).setValue(true);
          MEMBER_SHEET.getRange(i + 2, 6).setValue(true);
        }
      }
    }
  }
  
  console.log(postData);
  postToGlitch(postData);
}

// 最終行に追加
const setValueLastRow = (sheet, row, list) => {
  sheet.getRange(sheet.getLastRow() + 1, 1, row, sheet.getLastColumn()).setValues(list);
}

// トリガー更新
const setTrigger = (triggerName, nextDate) => {
  ScriptApp.newTrigger(triggerName).timeBased().at(nextDate).create();
}

// トリガー削除
const delTrigger = (triggerName) => {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() == triggerName) {
      ScriptApp.deleteTrigger(trigger); // トリガーを削除
    }
  }
}

// 空データ送信
const retainGlitch = () => {

  const data = {}; // 空のデータオブジェクトを作成
  const headers = {
    'Content-Type': 'application/json; charset=UTF-8'
  }
  const params = {
    method: 'post', // POSTリクエストを送信
    payload: JSON.stringify(data), // 空データをJSON文字列に変換
    headers: headers,
    muteHttpExceptions: true
  }
  response = UrlFetchApp.fetch(GLITCH_URL, params); // Glitchにデータを送信
}

// Glitchにpost
const postToGlitch = (postData) => {

  // POSTデータを作成
  const payload = {
    'postData': postData,
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    // データをJSON文字列に変換
    payload: JSON.stringify(payload),
    // 例外をミュートしてエラーレスポンスを取得
    muteHttpExceptions: true
  };

  // データをGlitchに送信
  UrlFetchApp.fetch(GLITCH_URL, options); 
}
*/