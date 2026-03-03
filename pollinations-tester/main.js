const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');

let mainWindow;

// ─── Папки проекта ────────────────────────────────────────────────────────────
const ROOT = path.join(__dirname, '..');
const DIRS = {
  images: path.join(ROOT, 'images'),
  videos: path.join(ROOT, 'videos'),
  audio:  path.join(ROOT, 'audio'),
  chats:  path.join(ROOT, 'chats'),
};
Object.values(DIRS).forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ─── Логгер ───────────────────────────────────────────────────────────────────
function ts() { return new Date().toTimeString().slice(0, 8); }
function log(tag, msg)  { console.log(`\x1b[36m[${ts()}]\x1b[0m \x1b[32m${tag}\x1b[0m ${msg}`); }
function logOk(tag, msg){ console.log(`\x1b[36m[${ts()}]\x1b[0m \x1b[32m✔ ${tag}\x1b[0m ${msg}`); }
function logErr(tag, msg){ console.error(`\x1b[36m[${ts()}]\x1b[0m \x1b[31m✖ ${tag}\x1b[0m ${msg}`); }
function logWarn(tag, msg){ console.warn(`\x1b[36m[${ts()}]\x1b[0m \x1b[33m⚠ ${tag}\x1b[0m ${msg}`); }
function sep(label) { console.log(`\x1b[90m${'─'.repeat(60)}\x1b[0m \x1b[35m${label}\x1b[0m`); }

// ─── .env ─────────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) { logErr('ENV', '.env не найден!'); return {}; }
  const env = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx === -1) continue;
    env[t.slice(0, idx).trim()] = t.slice(idx + 1).trim();
  }
  return env;
}

const ENV       = loadEnv();
const mainKey   = ENV.POLLINATIONS_API_KEY || '';
const videoKeys = (ENV.POLLINATIONS_VIDEO_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
const keyStates = [];

// Вывод конфигурации при старте
sep('STARTUP');
log('ENV',  `.env загружен из ${path.join(ROOT, '.env')}`);
log('KEY',  `Основной ключ: ${mainKey ? mainKey.slice(0,8) + '...' + mainKey.slice(-4) : '(не задан!)'}`);
log('KEY',  `Видео-ключей: ${videoKeys.length}`);
videoKeys.forEach((k, i) => log('KEY', `  [${i+1}] ${k.slice(0,8)}...${k.slice(-4)}`));
log('DIR',  `images → ${DIRS.images}`);
log('DIR',  `videos → ${DIRS.videos}`);
log('DIR',  `audio  → ${DIRS.audio}`);
log('DIR',  `chats  → ${DIRS.chats}`);
sep('');

function pickVideoKey() {
  const active = keyStates.filter(s => s.active && s.balance > 0);
  if (!active.length) {
    logWarn('VIDEO', 'Нет активных видео-ключей, используем первый как fallback');
    return keyStates[0]?.key || mainKey;
  }
  return active.sort((a, b) => b.balance - a.balance)[0].key;
}

// ─── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 960, minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Pollinations Model Tester',
  });
  mainWindow.loadFile('index.html');
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  log('APP', 'Electron готов, открываем окно...');
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => {
  log('APP', 'Все окна закрыты, выходим');
  if (process.platform !== 'darwin') app.quit();
});

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
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
    if (redirectCount === 0) log('HTTP', `GET ${url.slice(0, 100)}${url.length > 100 ? '…' : ''}`);
    lib.get(url, { headers }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        const loc = res.headers.location;
        log('HTTP', `↳ Redirect [${res.statusCode}] → ${loc.slice(0, 80)}`);
        return resolve(fetchBinary(
          loc.startsWith('http') ? loc : new URL(loc, url).href,
          headers, redirectCount + 1
        ));
      }
      const chunks2 = [];
      res.on('data', c => chunks2.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks2);
        log('HTTP', `↳ HTTP ${res.statusCode} | Content-Type: ${res.headers['content-type']} | Size: ${(buf.length/1024).toFixed(1)} KB`);
        resolve({ status: res.statusCode, contentType: res.headers['content-type'], buffer: buf });
      });
    }).on('error', reject);
  });
}

// ─── Balances ─────────────────────────────────────────────────────────────────
async function checkBalance(apiKey) {
  try {
    const r = await fetchJSON('https://gen.pollinations.ai/account/balance', {
      method: 'GET', headers: { Authorization: `Bearer ${apiKey}` },
    });
    return (r.status === 200 && typeof r.body?.balance === 'number') ? r.body.balance : null;
  } catch (e) { logErr('BALANCE', e.message); return null; }
}

ipcMain.handle('get-keys-info', async () => {
  sep('BALANCE CHECK');
  log('BALANCE', 'Проверяем балансы всех ключей...');

  const mainBalance   = await checkBalance(mainKey);
  const videoBalances = await Promise.all(videoKeys.map(k => checkBalance(k)));

  keyStates.length = 0;
  videoKeys.forEach((k, i) => {
    const balance = videoBalances[i];
    keyStates.push({ key: k, balance, active: balance !== null && balance > 0 });
    const short = `${k.slice(0,8)}...${k.slice(-4)}`;
    if (balance === null) logErr('BALANCE', `  Видео #${i+1} [${short}] → ошибка авторизации`);
    else if (balance <= 0) logWarn('BALANCE', `  Видео #${i+1} [${short}] → 0 pollen (исчерпан)`);
    else logOk('BALANCE', `  Видео #${i+1} [${short}] → ${balance.toFixed(2)} pollen`);
  });

  const mainShort = mainKey ? `${mainKey.slice(0,8)}...${mainKey.slice(-4)}` : '(не задан)';
  if (mainBalance === null) logErr('BALANCE', `Основной [${mainShort}] → ошибка авторизации`);
  else logOk('BALANCE', `Основной [${mainShort}] → ${mainBalance?.toFixed(2)} pollen`);
  sep('');

  return {
    main: { key: mainShort, balance: mainBalance, active: mainBalance !== null && mainBalance > 0 },
    video: keyStates.map((s, i) => ({
      index: i + 1,
      key: `${s.key.slice(0,8)}...${s.key.slice(-4)}`,
      balance: s.balance, active: s.active,
    })),
  };
});

// ─── Models ───────────────────────────────────────────────────────────────────
ipcMain.handle('get-text-models', async () => {
  log('MODELS', 'Загружаем текстовые модели...');
  const r = await fetchJSON('https://gen.pollinations.ai/text/models');
  logOk('MODELS', `Текстовых моделей: ${Array.isArray(r.body) ? r.body.length : '?'}`);
  return r.body;
});
ipcMain.handle('get-image-models', async () => {
  log('MODELS', 'Загружаем графические модели...');
  const r = await fetchJSON('https://gen.pollinations.ai/image/models');
  logOk('MODELS', `Графических моделей: ${Array.isArray(r.body) ? r.body.length : '?'}`);
  return r.body;
});
ipcMain.handle('get-audio-models', async () => {
  log('MODELS', 'Загружаем аудио модели...');
  const r = await fetchJSON('https://gen.pollinations.ai/audio/models');
  logOk('MODELS', `Аудио моделей: ${Array.isArray(r.body) ? r.body.length : '?'}`);
  return r.body;
});

// ─── Chat ─────────────────────────────────────────────────────────────────────
ipcMain.handle('chat-send', async (_e, { model, messages, temperature }) => {
  sep('CHAT');
  log('CHAT', `Модель: ${model} | temp: ${temperature} | сообщений в истории: ${messages.length}`);
  const lastMsg = messages[messages.length - 1];
  log('CHAT', `Последнее сообщение [${lastMsg.role}]: ${String(lastMsg.content).slice(0, 100)}…`);

  const body = JSON.stringify({ model, messages, temperature: parseFloat(temperature) || 1 });
  const r = await fetchJSON('https://gen.pollinations.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mainKey}` },
    body,
  });

  if (r.body?.choices) {
    const reply = r.body.choices[0]?.message?.content || '';
    const usage = r.body.usage || {};
    logOk('CHAT', `Ответ получен | токены: ${usage.prompt_tokens}↑ ${usage.completion_tokens}↓`);
    log('CHAT', `Ответ: ${reply.slice(0, 120)}${reply.length > 120 ? '…' : ''}`);
  } else {
    logErr('CHAT', `Ошибка: ${JSON.stringify(r.body).slice(0, 200)}`);
  }
  sep('');
  return r.body;
});

// ─── Chat persistence ─────────────────────────────────────────────────────────
ipcMain.handle('chat-list', () => {
  try {
    return fs.readdirSync(DIRS.chats)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(DIRS.chats, f), 'utf8'));
          return { id: d.id, title: d.title || 'Без названия', updatedAt: d.updatedAt, model: d.model };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  } catch { return []; }
});

ipcMain.handle('chat-load', (_e, id) => {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(DIRS.chats, `${id}.json`), 'utf8'));
    log('CHAT', `Загружен чат: "${d.title}" (${d.messages.length} сообщений)`);
    return d;
  } catch { return null; }
});

ipcMain.handle('chat-save', (_e, { id, title, model, messages }) => {
  const data = { id, title, model, messages, updatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(DIRS.chats, `${id}.json`), JSON.stringify(data, null, 2), 'utf8');
  log('CHAT', `Сохранён чат: "${title}" (${messages.length} сообщений) → chats/${id}.json`);
  return data;
});

ipcMain.handle('chat-delete', (_e, id) => {
  try { fs.unlinkSync(path.join(DIRS.chats, `${id}.json`)); logOk('CHAT', `Удалён чат: ${id}`); return true; }
  catch (e) { logErr('CHAT', e.message); return false; }
});

ipcMain.handle('chat-rename', (_e, { id, title }) => {
  const fp = path.join(DIRS.chats, `${id}.json`);
  try {
    const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
    d.title = title; d.updatedAt = new Date().toISOString();
    fs.writeFileSync(fp, JSON.stringify(d, null, 2), 'utf8');
    logOk('CHAT', `Переименован чат ${id} → "${title}"`);
    return true;
  } catch (e) { logErr('CHAT', e.message); return false; }
});

// ─── Image → /images/ ────────────────────────────────────────────────────────
ipcMain.handle('generate-image', async (_e, { model, prompt, width, height, seed, enhance, negativePrompt }) => {
  sep('IMAGE');
  log('IMAGE', `Модель: ${model}`);
  log('IMAGE', `Промпт: ${prompt.slice(0, 80)}`);
  log('IMAGE', `Размер: ${width}×${height} | seed: ${seed} | enhance: ${enhance}`);

  const params = new URLSearchParams();
  params.set('model', model);
  params.set('width',  String(parseInt(width,  10) || 1024));
  params.set('height', String(parseInt(height, 10) || 1024));
  params.set('seed',   String(parseInt(seed,   10)));
  if (enhance)        params.set('enhance', 'true');
  if (negativePrompt) params.set('negative_prompt', negativePrompt);

  const url = `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?${params}`;
  const r   = await fetchBinary(url, { Authorization: `Bearer ${mainKey}` });

  if (r.status !== 200 || !r.contentType?.startsWith('image/')) {
    const errText = r.buffer.toString().slice(0, 500);
    logErr('IMAGE', `HTTP ${r.status}: ${errText}`);
    return { error: `HTTP ${r.status}: ${errText}` };
  }

  const ext   = r.contentType.includes('png') ? 'png' : 'jpg';
  const fname = `${Date.now()}_${model}.${ext}`;
  const saved = path.join(DIRS.images, fname);
  fs.writeFileSync(saved, r.buffer);
  logOk('IMAGE', `Сохранено: images/${fname} (${(r.buffer.length/1024).toFixed(1)} KB)`);
  sep('');
  return { file: saved, contentType: r.contentType, savedAs: fname };
});

// ─── Video → /videos/ ────────────────────────────────────────────────────────
ipcMain.handle('generate-video', async (_e, { model, prompt, duration, aspectRatio, audio }) => {
  sep('VIDEO');
  const chosenKey = pickVideoKey();
  const chosenShort = `${chosenKey.slice(0,8)}...${chosenKey.slice(-4)}`;

  log('VIDEO', `Модель: ${model}`);
  log('VIDEO', `Промпт: ${prompt.slice(0, 80)}`);
  log('VIDEO', `Длительность: ${duration}с | Соотношение: ${aspectRatio} | Аудио: ${audio}`);
  log('VIDEO', `Ключ: ${chosenShort}`);
  log('VIDEO', `Ожидайте — генерация может занять несколько минут...`);

  const params = new URLSearchParams();
  params.set('model', model);
  if (duration)    params.set('duration', String(duration));
  if (aspectRatio) params.set('aspectRatio', aspectRatio);
  if (audio)       params.set('audio', 'true');

  const url = `https://gen.pollinations.ai/video/${encodeURIComponent(prompt)}?${params}`;
  const startTime = Date.now();

  const r = await fetchBinary(url, { Authorization: `Bearer ${chosenKey}` });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (r.status !== 200 || !r.contentType?.startsWith('video/')) {
    const errText = r.buffer.toString().slice(0, 500);
    logErr('VIDEO', `HTTP ${r.status} (${elapsed}с): ${errText}`);
    sep('');
    return { error: `HTTP ${r.status}: ${errText}` };
  }

  // Оптимистично уменьшаем баланс ключа
  const state = keyStates.find(s => s.key === chosenKey);
  if (state && state.balance !== null) state.balance = Math.max(0, state.balance - 1);

  const fname = `${Date.now()}_${model}.mp4`;
  const saved = path.join(DIRS.videos, fname);
  fs.writeFileSync(saved, r.buffer);
  logOk('VIDEO', `Готово за ${elapsed}с! Сохранено: videos/${fname} (${(r.buffer.length/1024/1024).toFixed(1)} MB)`);
  sep('');

  return {
    file: saved,
    contentType: r.contentType,
    savedAs: fname,
    usedKey: chosenShort,
  };
});

// ─── Audio → /audio/ ─────────────────────────────────────────────────────────
ipcMain.handle('generate-audio', async (_e, { model, text, voice, responseFormat, duration, instrumental }) => {
  sep('AUDIO');
  log('AUDIO', `Модель: ${model} | голос: ${voice} | формат: ${responseFormat}`);
  log('AUDIO', `Текст: ${String(text).slice(0, 80)}${text.length > 80 ? '…' : ''}`);

  const params = new URLSearchParams();
  params.set('model', model);
  params.set('voice', voice || 'nova');
  params.set('response_format', responseFormat || 'mp3');
  if (duration)     params.set('duration', String(duration));
  if (instrumental) params.set('instrumental', 'true');

  const url = `https://gen.pollinations.ai/audio/${encodeURIComponent(text)}?${params}`;
  const r   = await fetchBinary(url, { Authorization: `Bearer ${mainKey}` });

  if (r.status !== 200 || !r.contentType?.startsWith('audio/')) {
    const errText = r.buffer.toString().slice(0, 500);
    logErr('AUDIO', `HTTP ${r.status}: ${errText}`);
    return { error: `HTTP ${r.status}: ${errText}` };
  }

  const ext   = responseFormat || 'mp3';
  const fname = `${Date.now()}_${model}.${ext}`;
  const saved = path.join(DIRS.audio, fname);
  fs.writeFileSync(saved, r.buffer);
  logOk('AUDIO', `Сохранено: audio/${fname} (${(r.buffer.length/1024).toFixed(1)} KB)`);
  sep('');
  return { file: saved, contentType: r.contentType, savedAs: fname };
});

// ─── Transcribe ───────────────────────────────────────────────────────────────
ipcMain.handle('transcribe-audio', async (_e, { filePath, language, model }) => {
  sep('TRANSCRIBE');
  log('TRANSCRIBE', `Файл: ${filePath}`);
  log('TRANSCRIBE', `Модель: ${model} | Язык: ${language}`);

  const FormData = require('form-data');
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath), path.basename(filePath));
  form.append('model', model || 'whisper-large-v3');
  if (language) form.append('language', language);

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'gen.pollinations.ai',
      path: '/v1/audio/transcriptions',
      method: 'POST',
      headers: { ...form.getHeaders(), Authorization: `Bearer ${mainKey}` },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const body = JSON.parse(data);
          logOk('TRANSCRIBE', `HTTP ${res.statusCode} | текст: ${String(body.text || '').slice(0, 100)}…`);
          sep('');
          resolve({ status: res.statusCode, body });
        } catch {
          logErr('TRANSCRIBE', `HTTP ${res.statusCode} | не JSON: ${data.slice(0, 200)}`);
          sep('');
          resolve({ status: res.statusCode, body: { text: data } });
        }
      });
    });
    req.on('error', e => { logErr('TRANSCRIBE', e.message); sep(''); resolve({ status: 0, body: { error: e.message } }); });
    form.pipe(req);
  });
});

// ─── File ops ─────────────────────────────────────────────────────────────────
ipcMain.handle('open-file',   async (_e, filePath) => {
  log('FILE', `Открываем: ${filePath}`);
  await shell.openPath(filePath);
});

ipcMain.handle('open-folder', async (_e, type) => {
  const dir = DIRS[type] || DIRS.images;
  log('FILE', `Открываем папку: ${dir}`);
  await shell.openPath(dir);
});

ipcMain.handle('save-file', async (_e, { srcPath, defaultName }) => {
  const { dialog } = require('electron');
  const result = await dialog.showSaveDialog(mainWindow, { defaultPath: defaultName });
  if (!result.canceled && result.filePath) {
    fs.copyFileSync(srcPath, result.filePath);
    logOk('FILE', `Сохранено как: ${result.filePath}`);
    return result.filePath;
  }
  return null;
});
