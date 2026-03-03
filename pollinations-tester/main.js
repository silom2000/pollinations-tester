const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');
const os = require('os');

let mainWindow;

// ─── Load .env from parent directory ─────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return {};
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    env[key] = val;
  }
  return env;
}

const ENV = loadEnv();

// ─── Key registry ─────────────────────────────────────────────────────────────
// mainKey  — used for text / image / audio
// videoKeys — pool for video, rotated by balance
const mainKey = ENV.POLLINATIONS_API_KEY || '';
const videoKeys = (ENV.POLLINATIONS_VIDEO_KEYS || '')
  .split(',')
  .map(k => k.trim())
  .filter(Boolean);

// Runtime state: { key, balance, active }
const keyStates = [];  // filled after balance check

function buildKeyStates(keys) {
  return keys.map(key => ({ key, balance: null, active: true }));
}

// Pick the video key with the highest balance that is still active
function pickVideoKey() {
  const active = keyStates.filter(s => s.active && s.balance > 0);
  if (!active.length) return keyStates[0]?.key || mainKey; // fallback
  active.sort((a, b) => b.balance - a.balance);
  return active[0].key;
}

// ─── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'default',
    title: 'Pollinations Model Tester',
  });
  mainWindow.loadFile('index.html');
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function fetchBinary(url, headers = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 10) return reject(new Error('Too many redirects'));
    const lib = url.startsWith('https') ? https : http;
    const chunks = [];
    lib.get(url, { headers }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        const loc = res.headers.location;
        const redirectUrl = loc.startsWith('http') ? loc : new URL(loc, url).href;
        resolve(fetchBinary(redirectUrl, headers, redirectCount + 1));
        return;
      }
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        contentType: res.headers['content-type'],
        buffer: Buffer.concat(chunks),
      }));
    }).on('error', reject);
  });
}

// ─── Balance checker ──────────────────────────────────────────────────────────
async function checkBalance(apiKey) {
  try {
    const r = await fetchJSON('https://gen.pollinations.ai/account/balance', {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (r.status === 200 && typeof r.body?.balance === 'number') {
      return r.body.balance;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── IPC: get all key info for UI ─────────────────────────────────────────────
ipcMain.handle('get-keys-info', async () => {
  // Check main key
  const mainBalance = await checkBalance(mainKey);

  // Check all video keys (parallel)
  const videoBalances = await Promise.all(videoKeys.map(k => checkBalance(k)));

  // Update keyStates
  keyStates.length = 0;
  videoKeys.forEach((k, i) => {
    const balance = videoBalances[i];
    keyStates.push({
      key: k,
      balance,
      active: balance !== null && balance > 0,
    });
  });

  return {
    main: {
      key: mainKey ? `${mainKey.slice(0, 8)}...${mainKey.slice(-4)}` : '(не задан)',
      balance: mainBalance,
      active: mainBalance !== null && mainBalance > 0,
    },
    video: keyStates.map((s, i) => ({
      index: i + 1,
      key: `${s.key.slice(0, 8)}...${s.key.slice(-4)}`,
      balance: s.balance,
      active: s.active,
    })),
  };
});

// ─── IPC: re-check balances ───────────────────────────────────────────────────
ipcMain.handle('refresh-balances', async () => {
  return ipcMain.emit('get-keys-info'); // reuse handler
});

// ─── IPC: models ─────────────────────────────────────────────────────────────
ipcMain.handle('get-text-models', async () => {
  const r = await fetchJSON('https://gen.pollinations.ai/text/models');
  return r.body;
});
ipcMain.handle('get-image-models', async () => {
  const r = await fetchJSON('https://gen.pollinations.ai/image/models');
  return r.body;
});
ipcMain.handle('get-audio-models', async () => {
  const r = await fetchJSON('https://gen.pollinations.ai/audio/models');
  return r.body;
});

// ─── IPC: Text ────────────────────────────────────────────────────────────────
ipcMain.handle('generate-text', async (_e, { model, prompt, systemPrompt, temperature }) => {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });
  const body = JSON.stringify({ model, messages, temperature: parseFloat(temperature) || 1 });
  const r = await fetchJSON('https://gen.pollinations.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mainKey}`,
    },
    body,
  });
  return r.body;
});

// ─── IPC: Image ───────────────────────────────────────────────────────────────
ipcMain.handle('generate-image', async (_e, { model, prompt, width, height, seed, enhance, negativePrompt }) => {
  const params = new URLSearchParams();
  params.set('model', model);
  params.set('width',  String(parseInt(width,  10) || 1024));
  params.set('height', String(parseInt(height, 10) || 1024));
  params.set('seed',   String(parseInt(seed,   10)));
  if (enhance) params.set('enhance', 'true');
  if (negativePrompt) params.set('negative_prompt', negativePrompt);
  const url = `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?${params}`;
  const r = await fetchBinary(url, { Authorization: `Bearer ${mainKey}` });
  if (r.status !== 200 || !r.contentType?.startsWith('image/')) {
    return { error: `HTTP ${r.status}: ${r.buffer.toString().slice(0, 300)}` };
  }
  const tmpFile = path.join(os.tmpdir(), `poll_img_${Date.now()}.jpg`);
  fs.writeFileSync(tmpFile, r.buffer);
  return { file: tmpFile, contentType: r.contentType };
});

// ─── IPC: Video ───────────────────────────────────────────────────────────────
ipcMain.handle('generate-video', async (_e, { model, prompt, duration, aspectRatio, audio }) => {
  const chosenKey = pickVideoKey();
  const params = new URLSearchParams();
  params.set('model', model);
  if (duration)    params.set('duration', String(duration));
  if (aspectRatio) params.set('aspectRatio', aspectRatio);
  if (audio)       params.set('audio', 'true');
  const url = `https://gen.pollinations.ai/video/${encodeURIComponent(prompt)}?${params}`;
  const r = await fetchBinary(url, { Authorization: `Bearer ${chosenKey}` });
  if (r.status !== 200 || !r.contentType?.startsWith('video/')) {
    return { error: `HTTP ${r.status}: ${r.buffer.toString().slice(0, 300)}` };
  }
  // Decrease balance optimistically so next call picks different key if needed
  const state = keyStates.find(s => s.key === chosenKey);
  if (state && state.balance !== null) state.balance = Math.max(0, state.balance - 1);

  const tmpFile = path.join(os.tmpdir(), `poll_vid_${Date.now()}.mp4`);
  fs.writeFileSync(tmpFile, r.buffer);
  return { file: tmpFile, contentType: r.contentType, usedKey: `${chosenKey.slice(0,8)}...${chosenKey.slice(-4)}` };
});

// ─── IPC: Audio ───────────────────────────────────────────────────────────────
ipcMain.handle('generate-audio', async (_e, { model, text, voice, responseFormat, duration, instrumental }) => {
  const params = new URLSearchParams();
  params.set('model', model);
  params.set('voice', voice || 'nova');
  params.set('response_format', responseFormat || 'mp3');
  if (duration)     params.set('duration', String(duration));
  if (instrumental) params.set('instrumental', 'true');
  const url = `https://gen.pollinations.ai/audio/${encodeURIComponent(text)}?${params}`;
  const r = await fetchBinary(url, { Authorization: `Bearer ${mainKey}` });
  if (r.status !== 200 || !r.contentType?.startsWith('audio/')) {
    return { error: `HTTP ${r.status}: ${r.buffer.toString().slice(0, 300)}` };
  }
  const ext = responseFormat || 'mp3';
  const tmpFile = path.join(os.tmpdir(), `poll_aud_${Date.now()}.${ext}`);
  fs.writeFileSync(tmpFile, r.buffer);
  return { file: tmpFile, contentType: r.contentType };
});

// ─── IPC: Transcribe audio ────────────────────────────────────────────────────
ipcMain.handle('transcribe-audio', async (_e, { filePath, language, model }) => {
  const FormData = require('form-data');
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath), path.basename(filePath));
  form.append('model', model || 'whisper-large-v3');
  if (language) form.append('language', language);

  return new Promise((resolve) => {
    const headers = {
      ...form.getHeaders(),
      Authorization: `Bearer ${mainKey}`,
    };
    const u = new URL('https://gen.pollinations.ai/v1/audio/transcriptions');
    const opts = {
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers,
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: { text: data } }); }
      });
    });
    req.on('error', e => resolve({ status: 0, body: { error: e.message } }));
    form.pipe(req);
  });
});

// ─── IPC: File ops ────────────────────────────────────────────────────────────
ipcMain.handle('open-file', async (_e, filePath) => {
  await shell.openPath(filePath);
});

ipcMain.handle('save-file', async (_e, { srcPath, defaultName }) => {
  const { dialog } = require('electron');
  const result = await dialog.showSaveDialog(mainWindow, { defaultPath: defaultName });
  if (!result.canceled && result.filePath) {
    fs.copyFileSync(srcPath, result.filePath);
    return result.filePath;
  }
  return null;
});
