// services/streamScraper.js
const { BrowserWindow } = require('electron');
const { processSmartChat } = require('./chatFilter');
const { analyzeForClip, resetStreamTimer } = require('./hypeClipDetector');
const { trackViewerChat, trackViewerGift } = require('./viewerManager');

let tiktokWindow = null;
let youtubeWindow = null;
let tiktokPollTimer = null;
let youtubePollTimer = null;
let currentYoutubeUrl = '';
let areSourceWindowsVisible = false;
let isStopping = false;

const recentTiktokFingerprints = new Map();

function extractTikTokUsername(input) {
  if (!input) return '';
  const clean = input.trim();
  const urlMatch = clean.match(/tiktok\.com\/@([a-zA-Z0-9_.-]+)/i);
  if (urlMatch) return urlMatch[1];
  return clean.replace(/^@/, '').split('/')[0].split('?')[0].trim();
}

function extractYouTubeVideoId(url) {
  if (!url) return '';
  const clean = url.trim();
  const regExp = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|live)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
  const match = clean.match(regExp);
  return match ? match[1] : clean;
}

function forwardChatToUI(platform, author, message, io) {
  if (!message || !message.trim()) return;
  const cleanAuthor = (author || 'Penonton').trim();
  const cleanMsg = message.trim();

  // Abaikan teks notifikasi sistem yang bukan komentar
  const ignoreExact = [
    'joined', 'bergabung', 'shared the live', 'membagikan live',
    'followed the host', 'mengikuti host', 'sent', 'mengirim', 'liked the live'
  ];
  if (platform === 'tiktok' && ignoreExact.includes(cleanMsg.toLowerCase())) return;

  if (platform === 'tiktok') {
    const now = Date.now();
    const fp = `${cleanAuthor.toLowerCase()}:${cleanMsg.toLowerCase()}`;
    if (recentTiktokFingerprints.has(fp) && (now - recentTiktokFingerprints.get(fp) < 3500)) {
      return;
    }
    recentTiktokFingerprints.set(fp, now);
  }

  const viewerInfo = trackViewerChat(platform, cleanAuthor, cleanAuthor);
  const processed = processSmartChat({
    platform,
    author: cleanAuthor,
    message: cleanMsg,
    time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }, viewerInfo);

  io.emit('new-chat', processed);

  const clipAlert = analyzeForClip(cleanMsg, currentYoutubeUrl);
  if (clipAlert) io.emit('clip-alert', clipAlert);
}

// ============================================================================
// 1. MESIN PENARIK CHAT TIKTOK (DENGAN PENYIMPAN LOGIN PERMANEN & ANTI-KELUAR)
// ============================================================================
function startTikTokScraper(tiktokInput, io) {
  const uniqueId = extractTikTokUsername(tiktokInput);
  if (!uniqueId) return;

  io.emit('platform-status', {
    platform: 'tiktok',
    state: 'connecting',
    message: `Membuka TikTok @${uniqueId}...`
  });

  // Lebar wajib >= 1024px agar TikTok Web menampilkan panel kolom Live Chat di kanan
  tiktokWindow = new BrowserWindow({
    width: 1050,
    height: 720,
    show: true,
    x: areSourceWindowsVisible ? 80 : -3000,
    y: areSourceWindowsVisible ? 60 : -3000,
    skipTaskbar: !areSourceWindowsVisible,
    autoHideMenuBar: true,
    title: `Jendela Sumber TikTok (@${uniqueId}) - Silakan Login Jika Diminta, Lalu Klik Tombol Cek Jendela Sumber untuk Sembunyikan`,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      partition: 'persist:streamsync'
    }
  });
  tiktokWindow.webContents.setAudioMuted(true);
  tiktokWindow.webContents.setWindowOpenHandler(({ url }) => {
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 520,
        height: 680,
        autoHideMenuBar: true,
        webPreferences: {
          partition: 'persist:streamsync'
        }
      }
    };
  });
  tiktokWindow.on('close', (e) => {
    if (!isStopping) {
      e.preventDefault(); 
      areSourceWindowsVisible = false;
      tiktokWindow.setPosition(-3000, -3000);
      tiktokWindow.setSkipTaskbar(true);
      if (youtubeWindow && !youtubeWindow.isDestroyed()) {
        youtubeWindow.hide();
      }
      io.emit('source-visibility', false);
    }
  });

  const targetUrl = `https://www.tiktok.com/@${uniqueId}/live`;
  tiktokWindow.loadURL(targetUrl, {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  });

  tiktokWindow.webContents.on('did-finish-load', () => {
    io.emit('platform-status', {
      platform: 'tiktok',
      state: 'connected',
      message: `TikTok Terhubung: @${uniqueId}`
    });
  });
  if (tiktokPollTimer) clearInterval(tiktokPollTimer);
  tiktokPollTimer = setInterval(async () => {
    if (!tiktokWindow || tiktokWindow.isDestroyed()) return;
    try {
      const result = await tiktokWindow.webContents.executeJavaScript(`
        (function() {
          const results = [];

          const chatNodes = document.querySelectorAll([
            '[data-e2e="chat-message"]',
            '[data-e2e="chat-item"]',
            '[data-e2e="comment-item"]',
            'div[class*="DivChatMessage"]',
            'div[class*="DivChatItem"]',
            'div[class*="DivCommentItem"]'
          ].join(','));

          chatNodes.forEach(node => {
            if (node.getAttribute('data-ss-read') === '1') return;

            const nameEl = node.querySelector([
              '[data-e2e="message-owner-name"]',
              '[data-e2e="chat-item-username"]',
              'span[class*="SpanNickName"]',
              'a[class*="StyledLink"]',
              'span[class*="NickName"]',
              'span[class*="UserName"]'
            ].join(','));

            const contentEl = node.querySelector([
              '[data-e2e="chat-item-content"]',
              '[data-e2e="comment-content"]',
              'span[class*="SpanChatRoomComment"]',
              'span[class*="SpanComment"]',
              'div[class*="CommentContent"]'
            ].join(','));

            let author = '';
            let comment = '';

            if (nameEl && contentEl && nameEl !== contentEl) {
              author = nameEl.innerText.replace(/[:\\s]+$/, '').trim();
              const cloneContent = contentEl.cloneNode(true);
              cloneContent.querySelectorAll('img').forEach(img => img.replaceWith(img.alt || ''));
              comment = cloneContent.innerText.trim();
            } else if (nameEl) {
              author = nameEl.innerText.replace(/[:\\s]+$/, '').trim();
              const clone = node.cloneNode(true);
              clone.querySelectorAll('[data-e2e="message-owner-name"], [data-e2e="chat-item-username"], span[class*="SpanNickName"], a[class*="StyledLink"], span[class*="NickName"], span[class*="Badge"]').forEach(el => el.remove());
              clone.querySelectorAll('img').forEach(img => img.replaceWith(img.alt || ''));
              comment = clone.innerText.replace(/^[:\\s]+/, '').replace(/\\n+/g, ' ').trim();
            }

            if (author && comment && comment.length > 0) {
              node.setAttribute('data-ss-read', '1');
              results.push({ author, comment });
            }
          });

          return { chats: results };
        })();
      `);

      if (result && Array.isArray(result.chats) && result.chats.length > 0) {
        result.chats.forEach(item => {
          forwardChatToUI('tiktok', item.author, item.comment, io);
        });
      }
    } catch (err) {
    }
  }, 400);
}

function startYouTubeScraper(youtubeInput, io) {
  const videoId = extractYouTubeVideoId(youtubeInput);
  if (!videoId) return;

  io.emit('platform-status', {
    platform: 'youtube',
    state: 'connecting',
    message: `Membuka chat YouTube (${videoId})...`
  });

  youtubeWindow = new BrowserWindow({
    width: 500,
    height: 700,
    show: areSourceWindowsVisible,
    autoHideMenuBar: true,
    title: `Jendela Sumber YouTube Live Chat - ${videoId}`,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      partition: 'persist:streamsync'
    }
  });

  youtubeWindow.webContents.setAudioMuted(true);

  youtubeWindow.on('close', (e) => {
    if (!isStopping) {
      e.preventDefault();
      youtubeWindow.hide();
    }
  });

  const chatUrl = `https://www.youtube.com/live_chat?is_popout=1&v=${videoId}`;
  youtubeWindow.loadURL(chatUrl, {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  });

  youtubeWindow.webContents.on('did-finish-load', () => {
    io.emit('platform-status', {
      platform: 'youtube',
      state: 'connected',
      message: `YouTube Terhubung (${videoId})`
    });
  });

  if (youtubePollTimer) clearInterval(youtubePollTimer);
  youtubePollTimer = setInterval(async () => {
    if (!youtubeWindow || youtubeWindow.isDestroyed()) return;
    try {
      const result = await youtubeWindow.webContents.executeJavaScript(`
        (function() {
          const trigger = document.querySelector('tp-yt-paper-button#label');
          if (trigger && trigger.innerText.toLowerCase().includes('top')) {
            const menuItems = document.querySelectorAll('tp-yt-paper-listbox a.yt-simple-endpoint');
            if (menuItems.length > 1) menuItems[1].click();
          }

          const chats = [];
          const gifts = [];

          const textNodes = document.querySelectorAll('yt-live-chat-text-message-renderer:not([data-ss-done])');
          textNodes.forEach(node => {
            node.setAttribute('data-ss-done', '1');
            const authorEl = node.querySelector('#author-name');
            const msgEl = node.querySelector('#message');
            if (!msgEl) return;

            const author = authorEl ? authorEl.innerText.trim() : 'Penonton YT';
            const clone = msgEl.cloneNode(true);
            clone.querySelectorAll('img').forEach(img => {
              img.replaceWith(img.alt || '');
            });
            const comment = clone.innerText.trim();
            if (comment) chats.push({ author, comment });
          });

          const paidNodes = document.querySelectorAll('yt-live-chat-paid-message-renderer:not([data-ss-done])');
          paidNodes.forEach(node => {
            node.setAttribute('data-ss-done', '1');
            const author = node.querySelector('#author-name')?.innerText.trim() || 'Sultan YT';
            const amount = node.querySelector('#purchase-amount')?.innerText.trim() || 'Rp 50.000';
            const message = node.querySelector('#message')?.innerText.trim() || '';
            gifts.push({ author, amount, message });
          });

          return { chats, gifts };
        })();
      `);

      if (result && Array.isArray(result.chats)) {
        result.chats.forEach(item => {
          forwardChatToUI('youtube', item.author, item.comment, io);
        });
      }

      if (result && Array.isArray(result.gifts)) {
        result.gifts.forEach(g => {
          const numericDigits = parseInt(g.amount.replace(/[^0-9]/g, ''), 10) || 50000;
          const estimatedIdr = g.amount.includes('$') ? numericDigits * 16000 : numericDigits;
          const totalUserDonated = trackViewerGift('youtube', g.author, g.author, estimatedIdr);

          io.emit('new-gift', {
            platform: 'youtube',
            author: g.author,
            giftName: `SuperChat (${g.amount}): "${g.message}"`,
            estimatedIdr,
            totalUserDonated,
            ttsText: `Terima kasih SuperChat dari ${g.author}. ${g.message}`
          });
        });
      }
    } catch (err) {}
  }, 400);
}

function startScraping({ tiktokUrl, youtubeUrl }, io) {
  stopScraping();
  isStopping = false;
  resetStreamTimer();
  currentYoutubeUrl = youtubeUrl || '';

  if (tiktokUrl && tiktokUrl.trim() !== '') {
    startTikTokScraper(tiktokUrl, io);
  }
  if (youtubeUrl && youtubeUrl.trim() !== '') {
    startYouTubeScraper(youtubeUrl, io);
  }
}

function stopScraping() {
  isStopping = true;
  if (tiktokPollTimer) {
    clearInterval(tiktokPollTimer);
    tiktokPollTimer = null;
  }
  if (youtubePollTimer) {
    clearInterval(youtubePollTimer);
    youtubePollTimer = null;
  }
  if (tiktokWindow && !tiktokWindow.isDestroyed()) {
    try { tiktokWindow.destroy(); } catch (e) {}
    tiktokWindow = null;
  }
  if (youtubeWindow && !youtubeWindow.isDestroyed()) {
    try { youtubeWindow.destroy(); } catch (e) {}
    youtubeWindow = null;
  }
}

function toggleSourceWindows() {
  areSourceWindowsVisible = !areSourceWindowsVisible;
  if (tiktokWindow && !tiktokWindow.isDestroyed()) {
    if (areSourceWindowsVisible) {
      tiktokWindow.setSkipTaskbar(false);
      tiktokWindow.center();
      tiktokWindow.focus();
    } else {
      tiktokWindow.setPosition(-3000, -3000);
      tiktokWindow.setSkipTaskbar(true);
    }
  }
  if (youtubeWindow && !youtubeWindow.isDestroyed()) {
    if (areSourceWindowsVisible) {
      youtubeWindow.show();
      youtubeWindow.focus();
    } else {
      youtubeWindow.hide();
    }
  }
  return areSourceWindowsVisible;
}

function getCurrentYoutubeUrl() {
  return currentYoutubeUrl;
}

module.exports = { startScraping, stopScraping, toggleSourceWindows, getCurrentYoutubeUrl };