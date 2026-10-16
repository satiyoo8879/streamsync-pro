
const fs = require('fs');
const path = require('path');

let streamStartTime = Date.now();
let chatWindow = [];
let lastClipTime = 0;

const funnyWords = ['wkwk', 'haha', 'ngakak', 'bengek', 'lucu', 'kocak', '🤣', '😂', '😭'];
const hypeWords = ['gg', 'ggwp', 'kaget', 'anjir', 'gila', 'kelas', 'clutch', 'rata', 'montage', '😱', '🔥'];

function resetStreamTimer() {
  streamStartTime = Date.now();
  chatWindow = [];
  lastClipTime = 0;
}

function formatDuration(seconds) {
  const hrs = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const mins = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const secs = String(seconds % 60).padStart(2, '0');
  return `${hrs}:${mins}:${secs}`;
}

function createClipRecord(category, chatCount, activeYoutubeUrl, customNote = '') {
  const now = Date.now();
  const startSec = Math.max(0, Math.floor((now - streamStartTime) / 1000) - 25);
  const endSec = startSec + 45;

  const startTimeStr = formatDuration(startSec);
  const endTimeStr = formatDuration(endSec);

  const ytCommand = activeYoutubeUrl
    ? `yt-dlp --download-sections "*${startTimeStr}-${endTimeStr}" -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]" "${activeYoutubeUrl}" -o "clip_${startTimeStr.replace(/:/g, '-')}.mp4"`
    : `Potong rekaman OBS pada menit ${startTimeStr} sampai ${endTimeStr}`;

  const clipData = {
    id: `clip-${now}`,
    startTime: startTimeStr,
    endTime: endTimeStr,
    category,
    chatCount,
    note: customNote || `Lonjakan ${chatCount} chat/15dtk`,
    ytDlpCommand: ytCommand,
    createdAt: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  };

  try {
    const logLine = `[${clipData.startTime} - ${clipData.endTime}] ${clipData.category} (${clipData.note}) | Command: ${clipData.ytDlpCommand}\n`;
    fs.appendFileSync(path.join(process.cwd(), 'daftar_momen_clip.txt'), logLine);
  } catch (e) {}

  return clipData;
}

function analyzeForClip(chatMessage, activeYoutubeUrl = '') {
  const now = Date.now();
  const text = (chatMessage || '').toLowerCase();

  chatWindow.push({ time: now, text });
  chatWindow = chatWindow.filter(item => now - item.time <= 15000);

  let funnyHits = 0;
  let hypeHits = 0;
  chatWindow.forEach(item => {
    if (funnyWords.some(w => item.text.includes(w))) funnyHits++;
    if (hypeWords.some(w => item.text.includes(w))) hypeHits++;
  });

  const isTriggered = (chatWindow.length >= 12 || (funnyHits + hypeHits >= 6)) && (now - lastClipTime > 45000);

  if (isTriggered) {
    lastClipTime = now;
    const category = funnyHits >= hypeHits ? '😂 Momen Ngakak / Lucu' : '🔥 Momen Hype / Clutch / Kaget';
    return createClipRecord(category, chatWindow.length, activeYoutubeUrl);
  }

  return null;
}

function getChatVelocity() {
  const now = Date.now();
  chatWindow = chatWindow.filter(item => now - item.time <= 15000);
  return chatWindow.length;
}

module.exports = { analyzeForClip, createClipRecord, resetStreamTimer, getChatVelocity };