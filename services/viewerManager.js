// services/viewerManager.js
const fs = require('fs');
const path = require('path');

// Gunakan process.cwd() agar tidak error saat dibungkus menjadi .exe
const DB_PATH = path.join(process.cwd(), 'viewers_db.json');
let viewers = {};

if (fs.existsSync(DB_PATH)) {
  try {
    viewers = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch (e) {
    viewers = {};
  }
}

function saveDb() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(viewers, null, 2));
  } catch (e) {
    console.error('Gagal menyimpan database penonton:', e.message);
  }
}

function trackViewerChat(platform, uniqueId, nickname) {
  const key = `${platform}:${uniqueId}`;
  const today = new Date().toISOString().slice(0, 10);
  let isFirstTime = false;

  if (!viewers[key]) {
    isFirstTime = true;
    viewers[key] = {
      nickname,
      platform,
      messageCount: 1,
      totalDonatedIdr: 0,
      lastSeenDate: today,
      streakDays: 1
    };
  } else {
    viewers[key].nickname = nickname;
    viewers[key].messageCount += 1;
    if (viewers[key].lastSeenDate !== today) {
      viewers[key].streakDays += 1;
      viewers[key].lastSeenDate = today;
    }
  }

  if (viewers[key].messageCount % 10 === 0 || isFirstTime) saveDb();

  const v = viewers[key];
  let priorityBadge = null;
  let priorityLevel = 'normal';

  if (v.totalDonatedIdr >= 10000) {
    priorityBadge = `👑 Sultan (Rp ${v.totalDonatedIdr.toLocaleString('id-ID')})`;
    priorityLevel = 'vip';
  } else if (isFirstTime) {
    priorityBadge = '🌟 Penonton Baru';
    priorityLevel = 'new';
  } else if (v.streakDays >= 2 || v.messageCount >= 15) {
    priorityBadge = `🔥 Loyal (${v.messageCount} chat)`;
    priorityLevel = 'loyal';
  }

  return {
    isFirstTime,
    priorityBadge,
    priorityLevel,
    totalDonatedIdr: v.totalDonatedIdr
  };
}

function trackViewerGift(platform, uniqueId, nickname, estimatedIdr) {
  const key = `${platform}:${uniqueId}`;
  const today = new Date().toISOString().slice(0, 10);

  if (!viewers[key]) {
    viewers[key] = {
      nickname,
      platform,
      messageCount: 0,
      totalDonatedIdr: estimatedIdr,
      lastSeenDate: today,
      streakDays: 1
    };
  } else {
    viewers[key].totalDonatedIdr += estimatedIdr;
  }
  saveDb();
  return viewers[key].totalDonatedIdr;
}

module.exports = { trackViewerChat, trackViewerGift };