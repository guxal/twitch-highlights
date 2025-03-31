import fs from 'fs';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const twitch_client_id = process.env.TWITCH_CLIENT_ID;
const twitch_client_secret = process.env.TWITCH_CLIENT_SECRET;
let TWITCH_CLIENT_TOKEN = '';

// Create a prompt and store a list of entered names
async function getUsernames(filename) {
  let usernames = fs.readFileSync(filename, 'utf8')
    .split('\n')
    .map(u => u.trim())
    .filter(u => u.length > 0); // evita líneas vacías

  console.log("[INFO] Usernames loaded:", usernames);
  return usernames;
}

// Authentication
async function retrieveTwitchClientKey(id, secret){
  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: 'grant_type=client_credentials&client_id=' + id + '&client_secret=' + secret,
    headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
  }});
  return response.json();
}

// Getting user vods by ID
async function getUserID(name){
  const response = await fetch(`https://api.twitch.tv/helix/users?login=${name}`, {
    method: 'GET',
    headers: {
        "Authorization" : `Bearer ${TWITCH_CLIENT_TOKEN}`,
        "Client-Id" : twitch_client_id,
  }});
  return response.json();
}

async function getVods(id){
  const response = await fetch(`https://api.twitch.tv/helix/videos?user_id=${id}`, {
    method: 'GET',
    headers: {
        "Authorization" : `Bearer ${TWITCH_CLIENT_TOKEN}`,
        "Client-Id" : twitch_client_id,
  }});
  return response.json();
}

// Gets users latest vod
async function getUserVideos(name){
  try{
    let response = await getUserID(name);
    let user_id = response.data[0]['id'];
    let data = await getVods(user_id);
    if(data.data.length >  0){
      return (data.data[0]['url']);
    } else {
      console.log(`No recent VoDs available for ${name}`);
    }
  } catch (error) {
    console.log("Error:", name, error.message);
  }
}

async function getChat(vod_id) {
  // Not implemented
}

async function findIntervalEnd(startTime, interval) {
  const timeSplit = startTime.split(':');
  let seconds = Number(timeSplit[2]);
  let minutes = Number(timeSplit[1]);
  let hours = Number(timeSplit[0]);

  seconds += interval;
  if (seconds >= 60) {
    minutes += 1;
    seconds -= 60;
  }
  if (minutes >= 60) {
    hours += 1;
    minutes -= 60;
  }

  let secondsText = String(seconds).padStart(2, '0');
  let minutesText = String(minutes).padStart(2, '0');

  return hours + ":" + minutesText + ":" + secondsText;
}

async function splitChatIntoIntervals(timeActivity, interval) {
  const activityInterval = {};
  let startTime = Object.keys(timeActivity)[0];
  let endTime = "";
  let intervalActivity = 0;

  for (let time in timeActivity) {
    if (intervalActivity == 0) endTime = await findIntervalEnd(startTime, interval);
    if (time <= endTime) {
      intervalActivity += timeActivity[time];
    } else {
      activityInterval[startTime] = intervalActivity;
      startTime = time;
      intervalActivity = 0;
    }
  }

  const minutes = 10;
  let intervalSlices = ((minutes * 60 / interval) >> 0) - 1;
  let count = 0;
  for (let element in activityInterval) {
    if (count <= intervalSlices || count >= Object.entries(activityInterval).length - intervalSlices) {
      delete activityInterval[element];
    }
    count++;
  }

  return activityInterval;
}

async function subtractSeconds(startTime, subtractAmount) {
  const timeSplit = startTime.split(':');
  let seconds = Number(timeSplit[2]);
  let minutes = Number(timeSplit[1]);
  let hours = Number(timeSplit[0]);

  seconds -= subtractAmount;
  if (seconds < 0) {
    minutes -= 1;
    seconds += 60;
  }
  if (minutes < 0) {
    hours -= 1;
    minutes += 60;
  }

  let secondsText = String(seconds).padStart(2, '0');
  let minutesText = String(minutes).padStart(2, '0');

  return hours + ":" + minutesText + ":" + secondsText;
}

async function getHighlights(chatActivity, numberOfHighlights, highlightLength, subtractAmount) {
  const intervals = await splitChatIntoIntervals(chatActivity, highlightLength);
  const highlights = [];
  let count = 0;
  let slice = (Object.keys(intervals).length / numberOfHighlights) >> 0;
  let max = Object.keys(intervals)[0];
  let start = Object.keys(intervals)[0];

  for (let time in intervals) {
    count++;
    if (intervals[time] > intervals[max]) {
      max = time;
    }
    if (count % slice == 0) {
      highlights.push([await subtractSeconds(max, subtractAmount), intervals[max]]);
      max = time;
      start = time;
    }
  }
  return highlights;
}

async function cleanAndAnalyzeChatLog(chatLogFile) {
  const chatLog = fs.readFileSync(chatLogFile, 'utf-8');
  const timeActivity = {};
  const timestampPattern = /\[(\d{1,2}:\d{2}:\d{2})\]/;
  const skipPattern = /\[\d{1,2}:\d{2}:\d{2}\]\s+[^:]+:\s+(yes+|no+|me+|ya+|ye+\d)\s*$/i;
  const subGiftPattern = / gifted a Tier \d sub to /;

  chatLog.split('\n').forEach(line => {
    if (skipPattern.test(line) || subGiftPattern.test(line)) {
      return;
    }
    const match = line.match(timestampPattern);
    if (match) {
      const timestamp = match[1];
      timeActivity[timestamp] = (timeActivity[timestamp] || 0) + 1;
    }
  });
  return timeActivity;
}

async function createLinks(vod_id, highlights) {
  highlights.forEach(time => {
    let timeStamp = time[0].split(':');
    const convertedTimestamp = `${timeStamp[0]}h${timeStamp[1]}m${timeStamp[2]}s`;
    console.log("https://www.twitch.tv/videos/" + vod_id + "?t=" + convertedTimestamp + " (" + time[1] + ")");
  });
}

// Paso 10: Obtener highlights y mostrar links
async function getVodHighlights(vodLink) {
  try {
    const vod_id = vodLink[1].match(/twitch\.tv\/videos\/(\d+)/)[1];
    const chatLogPath = path.join('chatlogs', `${vod_id}.txt`);

    if (!fs.existsSync(chatLogPath)) {
      console.warn(`[WARN] Chat log file not found: ${chatLogPath}`);
      return;
    }

    const chatLog = await cleanAndAnalyzeChatLog(chatLogPath);
    const numberOfHighlights = 10;
    const highlightLength = 10;
    const subtractAmount = 30;
    const highlights = await getHighlights(chatLog, numberOfHighlights, highlightLength, subtractAmount);
    console.log("\n[RESULT] Highlights for:", vodLink[0]);
    await createLinks(vod_id, highlights);
    console.log("");
  } catch (error) {
    console.error(`[ERROR] Failed processing highlights for ${vodLink[0]}:`, error.message);
  }
}

// Paso 11:

async function getVodsList() {
  const streamerslist = await getUsernames("twitch_usernames.txt");
  const vodslist = [];
  for(const streamer of streamerslist){
    let vod = await getUserVideos(streamer);
    console.log(vod);
    let vodarray = [];
    vodarray.push(streamer);
    vodarray.push(vod);
    vodslist.push(vodarray);
  }
  return vodslist;
}

// Paso 12: Procesar todos los VODs y generar sus highlights
async function getAllLinks(vodList) {
  vodList.forEach((vodLink) => {
    getVodHighlights(vodLink);
  });
}

// === EJECUCIÓN PRINCIPAL ===
console.log("[START] Obteniendo token de Twitch...");
TWITCH_CLIENT_TOKEN = (await retrieveTwitchClientKey(twitch_client_id, twitch_client_secret)).access_token;

console.log("[STEP] Obteniendo lista de VODs...");
const vodList = await getVodsList();

console.log("[STEP] Procesando highlights de cada VOD...");
getAllLinks(vodList);
