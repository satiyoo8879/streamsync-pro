// main.js
const { app, BrowserWindow } = require('electron');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const { startScraping, stopScraping, toggleSourceWindows, getCurrentYoutubeUrl } = require('./services/streamScraper');
const { createClipRecord, getChatVelocity } = require('./services/hypeClipDetector');

// PENTING: Mencegah TikTok mendeteksi aplikasi sebagai bot saat Anda melakukan Login
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

const expressApp = express();
const server = http.createServer(expressApp);
const io = new Server(server);
const PORT = 4567;

let mainWindow;

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

expressApp.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  socket.emit('server-info', {
    obsUrl: `http://localhost:${PORT}`,
    mobileUrl: `http://${getLocalIpAddress()}:${PORT}`
  });

  socket.on('start-stream', (urls) => {
    startScraping(urls, io);
  });

  socket.on('stop-stream', () => {
    stopScraping();
    io.emit('platform-status', { platform: 'tiktok', state: 'idle', message: 'TikTok Dihentikan' });
    io.emit('platform-status', { platform: 'youtube', state: 'idle', message: 'YouTube Dihentikan' });
  });

  socket.on('toggle-source', () => {
    const isVisible = toggleSourceWindows();
    io.emit('source-visibility', isVisible);
  });

  socket.on('manual-clip', () => {
    const clip = createClipRecord('🎬 Klip Manual Streamer/Clipper', getChatVelocity(), getCurrentYoutubeUrl(), 'Ditandai secara manual');
    io.emit('clip-alert', clip);
  });

  socket.on('toggle-pin', (isPinned) => {
    if (mainWindow) mainWindow.setAlwaysOnTop(isPinned, 'screen-saver');
  });

  socket.on('set-opacity', (opacityValue) => {
    if (mainWindow) {
      const val = Math.max(0.35, Math.min(1, Number(opacityValue) / 100));
      mainWindow.setOpacity(val);
    }
  });
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 420,
    minHeight: 500,
    title: 'StreamSync Pro - Semua Chat YouTube & TikTok',
    autoHideMenuBar: true,
    backgroundColor: '#090D16',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.on('closed', () => {
    stopScraping();
    app.quit();
  });
}

app.whenReady().then(() => {
  server.listen(PORT, () => {
    createWindow();
  }).on('error', () => {
    // Jika port sudah dipakai, tetap buka jendela
    createWindow();
  });
});

app.on('window-all-closed', () => {
  stopScraping();
  if (process.platform !== 'darwin') app.quit();
});