'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

let currentImageFile = null;
let currentVideoFile = null;
let currentAudioFile = null;
let audioMode = 'tts';
let transcribeFilePath = null;

// Chat state
let chatId       = null;   // ID текущего чата (имя файла без .json)
let chatMessages = [];     // [{role, content}, ...]
let chatTotalUp  = 0;
let chatTotalDown= 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setStatus(id, msg, type = '') {
  const el = $(id);
  el.textContent = msg;
  el.className = 'status-bar' + (type ? ' ' + type : '');
}

function setLoading(btnId, loading, label) {
  const btn = $(btnId);
  if (loading) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>${label || 'Генерация...'}`;
  } else {
    btn.disabled = false;
    btn.innerHTML = label || btn.dataset.label || label;
  }
}

function saveLabel(btnId, label) { $(btnId).dataset.label = label; }
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ─── Keys panel ───────────────────────────────────────────────────────────────
async function loadKeysInfo() {
  $('mainKeyBalance').textContent = '…';
  $('videoKeysBalance').textContent = '…';
  $('mainKeyDot').className = 'key-dot dot-loading';
  $('videoKeysDot').className = 'key-dot dot-loading';

  let info;
  try { info = await window.api.getKeysInfo(); }
  catch { $('mainKeyBalance').textContent = 'ERR'; $('videoKeysBalance').textContent = 'ERR'; return; }

  const mb = info.main.balance;
  $('mainKeyBalance').textContent = mb !== null ? mb.toFixed(1) : '—';
  $('mainKeyDot').className = 'key-dot ' + (info.main.active ? 'dot-ok' : 'dot-dead');

  const activeCount = info.video.filter(v => v.active).length;
  $('videoKeysBalance').textContent = `${activeCount}/${info.video.length}`;
  $('videoKeysDot').className = 'key-dot ' + (activeCount > 0 ? 'dot-ok' : 'dot-dead');

  updateActiveVideoKey(info.video);
  renderKeysDetail(info);
}

function balanceClass(b) {
  if (b === null) return 'bal-unknown';
  if (b <= 0)    return 'bal-empty';
  if (b < 5)     return 'bal-low';
  return 'bal-ok';
}

function renderKeysDetail(info) {
  const mb = info.main.balance;
  const mainCard = `
    <div class="kd-card ${info.main.active ? '' : 'kd-dead'}">
      <div class="kd-type">Основной</div>
      <div class="kd-key">${info.main.key}</div>
      <div class="kd-balance ${balanceClass(mb)}">${mb !== null ? mb.toFixed(2) : '—'} <span class="kd-unit">pollen</span></div>
      <div class="kd-scope">Текст · Графика · Аудио</div>
    </div>`;
  const videoCards = info.video.map(v => {
    const b = v.balance;
    return `
      <div class="kd-card ${v.active ? '' : 'kd-dead'}">
        <div class="kd-type">Видео #${v.index}</div>
        <div class="kd-key">${v.key}</div>
        <div class="kd-balance ${balanceClass(b)}">${b !== null ? b.toFixed(2) : '—'} <span class="kd-unit">pollen</span></div>
        <div class="kd-scope">Только видео</div>
      </div>`;
  }).join('');
  $('keysDetailInner').innerHTML = mainCard + videoCards;
}

function updateActiveVideoKey(videoKeys) {
  const active = videoKeys.filter(v => v.active).sort((a, b) => (b.balance || 0) - (a.balance || 0));
  const best = active[0];
  $('vidActiveKeyVal').textContent = best
    ? `${best.key} (${best.balance?.toFixed(1)} pollen)`
    : 'Нет активных ключей';
  $('vidActiveKeyVal').style.color = best ? 'var(--accent)' : 'var(--danger)';
}

$('keyStatusWrap').addEventListener('click', () => $('keysDetailBar').classList.toggle('open'));
$('btnRefresh').addEventListener('click', e => { e.stopPropagation(); loadKeysInfo(); });

// ─── Tabs ─────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(s => { s.classList.add('hidden'); s.classList.remove('active'); });
    tab.classList.add('active');
    const target = $('tab-' + tab.dataset.tab);
    target.classList.remove('hidden');
    target.classList.add('active');
  });
});

// ─── Load models ──────────────────────────────────────────────────────────────
function selectOrAdd(selectId, id) {
  const sel = $(selectId);
  for (const opt of sel.options) { if (opt.value === id) { sel.value = id; return; } }
  const o = new Option(id, id); sel.add(o); sel.value = id;
}

function makeBadges(m) {
  const b = [];
  if (m.isNew || m.new)            b.push(`<span class="badge badge-new">NEW</span>`);
  if (m.paidOnly || m.paid_only)   b.push(`<span class="badge badge-paid">PAID</span>`);
  if (m.isAlpha || m.alpha)        b.push(`<span class="badge badge-alpha">ALPHA</span>`);
  if (!m.paidOnly && !m.paid_only) b.push(`<span class="badge badge-free">FREE</span>`);
  return b.join('');
}

function renderCards(containerId, models, onSelect) {
  const el = $(containerId);
  if (!models.length) { el.innerHTML = '<div class="loading-dots">Нет данных</div>'; return; }
  el.innerHTML = models.map(m => {
    const name = m.name || m.id || 'Unknown';
    const desc = m.description
      ? `<div class="mc-id" title="${m.description}">${m.description.slice(0,60)}${m.description.length>60?'…':''}</div>`
      : `<div class="mc-id">${m.id}</div>`;
    return `<div class="model-card" data-id="${m.id}"><div class="mc-name">${name}</div>${desc}<div class="mc-badges">${makeBadges(m)}</div></div>`;
  }).join('');
  el.querySelectorAll('.model-card').forEach(card => card.addEventListener('click', () => onSelect(card.dataset.id)));
}

// Строгие списки моделей по типу
const VIDEO_MODEL_IDS = ['veo', 'seedance', 'seedance-pro', 'wan', 'grok-video', 'ltx-2'];
const IMAGE_MODEL_IDS = ['flux', 'zimage', 'klein', 'klein-large', 'gptimage', 'gptimage-large',
  'kontext', 'seedream', 'seedream-pro', 'nanobanana', 'nanobanana-2', 'nanobanana-pro',
  'imagen-4', 'grok-imagine'];

async function loadModels() {
  try {
    const [textModels, imageModels, audioModels] = await Promise.all([
      window.api.getTextModels(), window.api.getImageModels(), window.api.getAudioModels(),
    ]);

    const allImages = imageModels || [];

    // Только чистые image-модели — строго по списку IMAGE_MODEL_IDS
    const imgOnly = allImages.filter(m => IMAGE_MODEL_IDS.includes(m.id));

    // Только video-модели — строго по списку VIDEO_MODEL_IDS
    const vidOnly = allImages.filter(m => VIDEO_MODEL_IDS.includes(m.id));

    // Если API не вернул видео-модели через фильтр — создаём список вручную с правильными мета-данными
    const VIDEO_META = {
      'grok-video':   { name: 'Grok Video',      paidOnly: false, isNew: true,  isAlpha: true  },
      'ltx-2':        { name: 'LTX-2',            paidOnly: true,  isNew: true,  isAlpha: false },
      'seedance-pro': { name: 'Seedance Pro-Fast', paidOnly: true,  isNew: false, isAlpha: false },
      'seedance':     { name: 'Seedance Lite',     paidOnly: true,  isNew: false, isAlpha: false },
      'wan':          { name: 'Wan 2.6',           paidOnly: true,  isNew: true,  isAlpha: false },
      'veo':          { name: 'Veo 3.1 Fast',      paidOnly: true,  isNew: false, isAlpha: false },
    };

    // Патчим данные из API правильными badge-флагами
    const vidPatched = (vidOnly.length ? vidOnly : VIDEO_MODEL_IDS.map(id => ({ id }))).map(m => ({
      ...m,
      ...(VIDEO_META[m.id] || {}),
    }));

    const vidFinal = vidPatched;

    renderCards('img-model-cards', imgOnly.length ? imgOnly : allImages, id => selectOrAdd('img-model', id));
    renderCards('vid-model-cards', vidFinal, id => selectOrAdd('vid-model', id));
    renderCards('aud-model-cards', audioModels || [], id => {
      if (id === 'elevenmusic') switchAudioMode('music');
      else if (id.includes('whisper') || id === 'scribe') switchAudioMode('transcribe');
    });

    // Добавить текстовые модели в селект чата
    if (Array.isArray(textModels)) {
      textModels.forEach(m => selectOrAdd('chat-model', m.id));
    }
  } catch(e) { console.error('loadModels', e); }
}

// ─── IMAGE TAB ────────────────────────────────────────────────────────────────
saveLabel('img-generate', '⚡ Сгенерировать');

$('img-generate').addEventListener('click', async () => {
  const prompt = $('img-prompt').value.trim();
  if (!prompt) { setStatus('img-status', '⚠️ Введите промпт', 'error'); return; }
  setLoading('img-generate', true, '⏳ Генерация...');
  setStatus('img-status', '🔄 Отправка запроса...');
  $('img-result').classList.add('hidden');
  $('img-placeholder').classList.remove('hidden');
  $('img-actions').classList.add('hidden');
  try {
    const result = await window.api.generateImage({
      model: $('img-model').value, prompt,
      width: $('img-width').value, height: $('img-height').value,
      seed: $('img-seed').value, enhance: $('img-enhance').checked,
      negativePrompt: $('img-neg').value,
    });
    if (result.error) { setStatus('img-status', `❌ ${result.error}`, 'error'); }
    else {
      currentImageFile = result.file;
      const img = $('img-result');
      img.src = `file://${result.file}?t=${Date.now()}`;
      img.onload = () => {
        $('img-placeholder').classList.add('hidden');
        img.classList.remove('hidden');
        $('img-actions').classList.remove('hidden');
        $('img-saved').textContent = `✅ images/${result.savedAs}`;
        setStatus('img-status', `✅ Сохранено: images/${result.savedAs}`, 'ok');
      };
    }
  } catch(e) { setStatus('img-status', `❌ ${e.message}`, 'error'); }
  setLoading('img-generate', false, '⚡ Сгенерировать');
});

$('img-open').addEventListener('click',   () => currentImageFile && window.api.openFile(currentImageFile));
$('img-save').addEventListener('click',   async () => currentImageFile && await window.api.saveFile(currentImageFile, 'image.jpg'));
$('img-folder').addEventListener('click', () => window.api.openFolder('images'));

// ─── VIDEO TAB ────────────────────────────────────────────────────────────────
saveLabel('vid-generate', '⚡ Сгенерировать');

$('vid-generate').addEventListener('click', async () => {
  const prompt = $('vid-prompt').value.trim();
  if (!prompt) { setStatus('vid-status', '⚠️ Введите промпт', 'error'); return; }
  setLoading('vid-generate', true, '⏳ Генерация видео...');
  setStatus('vid-status', '🔄 Запрос отправлен. Это может занять 1–5 минут...');
  $('vid-result').classList.add('hidden');
  $('vid-placeholder').classList.remove('hidden');
  $('vid-actions').classList.add('hidden');
  try {
    const result = await window.api.generateVideo({
      model: $('vid-model').value, prompt,
      duration: $('vid-dur').value, aspectRatio: $('vid-ratio').value, audio: $('vid-audio').checked,
    });
    if (result.error) { setStatus('vid-status', `❌ ${result.error}`, 'error'); }
    else {
      currentVideoFile = result.file;
      $('vid-result').src = `file://${result.file}`;
      $('vid-placeholder').classList.add('hidden');
      $('vid-result').classList.remove('hidden');
      $('vid-actions').classList.remove('hidden');
      $('vid-saved').textContent = `✅ videos/${result.savedAs}`;
      setStatus('vid-status', `✅ Сохранено: videos/${result.savedAs} · ключ: ${result.usedKey}`, 'ok');
      loadKeysInfo();
    }
  } catch(e) { setStatus('vid-status', `❌ ${e.message}`, 'error'); }
  setLoading('vid-generate', false, '⚡ Сгенерировать');
});

$('vid-open').addEventListener('click',   () => currentVideoFile && window.api.openFile(currentVideoFile));
$('vid-save').addEventListener('click',   async () => currentVideoFile && await window.api.saveFile(currentVideoFile, 'video.mp4'));
$('vid-folder').addEventListener('click', () => window.api.openFolder('videos'));

// ─── CHAT TAB ─────────────────────────────────────────────────────────────────

// Системный промпт — раскрытие
$('chatSystemToggle').addEventListener('click', () => {
  const ta = $('chat-system');
  const ch = $('systemChevron');
  const hidden = ta.classList.toggle('hidden');
  ch.textContent = hidden ? '▶' : '▼';
});

// Авто-resize textarea
$('chatInput').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 160) + 'px';
});

// Enter — отправить, Shift+Enter — перенос
$('chatInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
});
$('btnSend').addEventListener('click', sendChatMessage);

// Новый чат
$('btnNewChat').addEventListener('click', () => newChat());

// Удалить чат
$('btnDeleteChat').addEventListener('click', async () => {
  if (!chatId) return;
  if (!confirm('Удалить этот чат?')) return;
  await window.api.chatDelete(chatId);
  newChat();
  loadChatList();
});

// Переименовать чат
$('btnRenameChat').addEventListener('click', async () => {
  if (!chatId) return;
  const title = prompt('Новое название:', $('chatCurrentTitle').textContent);
  if (!title || !title.trim()) return;
  await window.api.chatRename({ id: chatId, title: title.trim() });
  $('chatCurrentTitle').textContent = title.trim();
  loadChatList();
});

// Очистить историю
$('btnClearChat').addEventListener('click', () => {
  if (!confirm('Очистить историю сообщений?')) return;
  chatMessages = [];
  chatTotalUp = 0; chatTotalDown = 0;
  $('chatTokens').textContent = 'Токены: 0↑ 0↓';
  renderMessages();
  if (chatId) saveChatToDisk();
});

function newChat() {
  chatId = genId();
  chatMessages = [];
  chatTotalUp = 0; chatTotalDown = 0;
  $('chatCurrentTitle').textContent = 'Новый чат';
  $('chatTokens').textContent = 'Токены: 0↑ 0↓';
  renderMessages();
  // Снять выделение в сайдбаре
  document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
}

async function loadChatList() {
  const list = await window.api.chatList();
  const container = $('chatList');
  if (!list.length) {
    container.innerHTML = '<div class="chat-list-empty">Нет сохранённых чатов</div>';
    return;
  }
  container.innerHTML = list.map(c => `
    <div class="chat-item ${c.id === chatId ? 'active' : ''}" data-id="${c.id}">
      <div class="chat-item-title">${escHtml(c.title)}</div>
      <div class="chat-item-meta">${c.model || ''} · ${formatDate(c.updatedAt)}</div>
    </div>`).join('');
  container.querySelectorAll('.chat-item').forEach(el => {
    el.addEventListener('click', () => loadChat(el.dataset.id));
  });
}

async function loadChat(id) {
  const data = await window.api.chatLoad(id);
  if (!data) return;
  chatId       = data.id;
  chatMessages = data.messages || [];
  $('chatCurrentTitle').textContent = data.title || 'Без названия';
  if (data.model) selectOrAdd('chat-model', data.model);
  renderMessages();
  loadChatList();
  // Перечитать счётчик токенов из последнего сообщения (приблизительно — не хранится)
  $('chatTokens').textContent = `Сообщений: ${chatMessages.length}`;
}

async function saveChatToDisk() {
  if (!chatId) chatId = genId();
  const title = $('chatCurrentTitle').textContent;
  const model = $('chat-model').value;
  await window.api.chatSave({ id: chatId, title, model, messages: chatMessages });
}

async function sendChatMessage() {
  const input = $('chatInput');
  const text  = input.value.trim();
  if (!text) return;

  // Добавить системный промпт если есть и это первое сообщение
  if (chatMessages.length === 0) {
    const sys = $('chat-system').value.trim();
    if (sys) chatMessages.push({ role: 'system', content: sys });
    // Сгенерировать название из первого запроса
    $('chatCurrentTitle').textContent = text.slice(0, 40) + (text.length > 40 ? '…' : '');
  }

  chatMessages.push({ role: 'user', content: text });
  input.value = '';
  input.style.height = 'auto';
  renderMessages();
  scrollToBottom();

  // Показать индикатор набора
  appendTypingIndicator();

  $('btnSend').disabled = true;

  try {
    const result = await window.api.chatSend({
      model:       $('chat-model').value,
      messages:    chatMessages,
      temperature: parseFloat($('chat-temp').value) || 1,
    });

    removeTypingIndicator();

    if (result.error || !result.choices) {
      const msg = result.error?.message || result.error || JSON.stringify(result).slice(0, 200);
      appendErrorBubble(msg);
    } else {
      const reply = result.choices[0]?.message?.content || '(пустой ответ)';
      const usage = result.usage || {};
      chatMessages.push({ role: 'assistant', content: reply });
      chatTotalUp   += usage.prompt_tokens || 0;
      chatTotalDown += usage.completion_tokens || 0;
      $('chatTokens').textContent = `Токены: ${chatTotalUp}↑ ${chatTotalDown}↓`;
      renderMessages();
      scrollToBottom();
      await saveChatToDisk();
      loadChatList();
    }
  } catch(e) {
    removeTypingIndicator();
    appendErrorBubble(e.message);
  }

  $('btnSend').disabled = false;
  input.focus();
}

function renderMessages() {
  const container = $('chatMessages');
  const msgs = chatMessages.filter(m => m.role !== 'system');
  if (!msgs.length) {
    container.innerHTML = `
      <div class="chat-welcome">
        <div class="chat-welcome-icon">💬</div>
        <div class="chat-welcome-text">Начните диалог — модель запомнит весь контекст беседы</div>
      </div>`;
    return;
  }
  container.innerHTML = msgs.map(m => {
    const isUser = m.role === 'user';
    return `
      <div class="chat-bubble-row ${isUser ? 'user' : 'assistant'}">
        <div class="chat-bubble ${isUser ? 'bubble-user' : 'bubble-assistant'}">
          <div class="bubble-role">${isUser ? '👤 Вы' : '🤖 Модель'}</div>
          <div class="bubble-text">${escHtml(m.content)}</div>
        </div>
      </div>`;
  }).join('');
}

function appendTypingIndicator() {
  const container = $('chatMessages');
  const el = document.createElement('div');
  el.className = 'chat-bubble-row assistant';
  el.id = 'typingIndicator';
  el.innerHTML = `
    <div class="chat-bubble bubble-assistant">
      <div class="bubble-role">🤖 Модель</div>
      <div class="typing-dots"><span></span><span></span><span></span></div>
    </div>`;
  container.appendChild(el);
  scrollToBottom();
}

function removeTypingIndicator() {
  const el = $('typingIndicator');
  if (el) el.remove();
}

function appendErrorBubble(msg) {
  const container = $('chatMessages');
  const el = document.createElement('div');
  el.className = 'chat-bubble-row assistant';
  el.innerHTML = `
    <div class="chat-bubble bubble-error">
      <div class="bubble-role">⚠️ Ошибка</div>
      <div class="bubble-text">${escHtml(msg)}</div>
    </div>`;
  container.appendChild(el);
  scrollToBottom();
}

function scrollToBottom() {
  const c = $('chatMessages');
  c.scrollTop = c.scrollHeight;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\n/g,'<br>');
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit' })
      + ' ' + d.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
  } catch { return ''; }
}

// ─── AUDIO TAB ────────────────────────────────────────────────────────────────
document.querySelectorAll('.seg').forEach(btn => btn.addEventListener('click', () => switchAudioMode(btn.dataset.mode)));

function switchAudioMode(mode) {
  audioMode = mode;
  document.querySelectorAll('.seg').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  $('audio-gen-panel').classList.toggle('hidden', mode === 'transcribe');
  $('audio-transcribe-panel').classList.toggle('hidden', mode !== 'transcribe');
  $('tts-options').classList.toggle('hidden', mode === 'music');
  $('music-options').classList.toggle('hidden', mode !== 'music');
  $('aud-player-wrap').classList.add('hidden');
  $('aud-transcript-wrap').classList.add('hidden');
  $('aud-actions').classList.add('hidden');
  $('aud-transcript-actions').classList.add('hidden');
  $('aud-placeholder').classList.remove('hidden');
  setStatus('aud-status', '');
}

saveLabel('aud-generate', '⚡ Сгенерировать');

$('aud-generate').addEventListener('click', async () => {
  const text = $('aud-text').value.trim();
  if (!text) { setStatus('aud-status', '⚠️ Введите текст', 'error'); return; }
  setLoading('aud-generate', true, '⏳ Генерация...');
  setStatus('aud-status', '🔄 Запрос отправлен...');
  $('aud-player-wrap').classList.add('hidden');
  $('aud-placeholder').classList.remove('hidden');
  $('aud-actions').classList.add('hidden');
  try {
    const result = await window.api.generateAudio({
      model: audioMode === 'music' ? 'elevenmusic' : 'elevenlabs',
      text,
      voice: $('aud-voice').value,
      responseFormat: $('aud-format').value,
      duration: audioMode === 'music' ? $('aud-duration').value : undefined,
      instrumental: audioMode === 'music' ? $('aud-instrumental').checked : false,
    });
    if (result.error) { setStatus('aud-status', `❌ ${result.error}`, 'error'); }
    else {
      currentAudioFile = result.file;
      $('aud-result').src = `file://${result.file}?t=${Date.now()}`;
      $('aud-placeholder').classList.add('hidden');
      $('aud-player-wrap').classList.remove('hidden');
      $('aud-actions').classList.remove('hidden');
      $('aud-saved').textContent = `✅ audio/${result.savedAs}`;
      setStatus('aud-status', `✅ Сохранено: audio/${result.savedAs}`, 'ok');
    }
  } catch(e) { setStatus('aud-status', `❌ ${e.message}`, 'error'); }
  setLoading('aud-generate', false, '⚡ Сгенерировать');
});

// Drag & drop файл для транскрипции
$('aud-file').addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) { transcribeFilePath = f.path; $('aud-file-name').textContent = `📎 ${f.name}`; }
});
const dz = $('aud-drop');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.style.borderColor = 'var(--accent)'; });
dz.addEventListener('dragleave', () => { dz.style.borderColor = ''; });
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.style.borderColor = '';
  const f = e.dataTransfer.files[0];
  if (f) { transcribeFilePath = f.path; $('aud-file-name').textContent = `📎 ${f.name}`; }
});

saveLabel('aud-transcribe', '🎤 Транскрибировать');

$('aud-transcribe').addEventListener('click', async () => {
  if (!transcribeFilePath) { setStatus('aud-status', '⚠️ Выберите аудио файл', 'error'); return; }
  setLoading('aud-transcribe', true, '⏳ Транскрибирование...');
  setStatus('aud-status', '🔄 Отправка файла...');
  try {
    const result = await window.api.transcribeAudio({
      filePath: transcribeFilePath,
      language: $('aud-lang').value || 'ru',
      model:    $('aud-whisper-model').value,
    });
    if (result.status !== 200 || result.body?.error) {
      const msg = result.body?.error?.message || result.body?.error || JSON.stringify(result.body).slice(0, 200);
      setStatus('aud-status', `❌ HTTP ${result.status}: ${msg}`, 'error');
    } else {
      $('aud-transcript-wrap').textContent = result.body.text || JSON.stringify(result.body, null, 2);
      $('aud-placeholder').classList.add('hidden');
      $('aud-transcript-wrap').classList.remove('hidden');
      $('aud-transcript-actions').classList.remove('hidden');
      setStatus('aud-status', '✅ Готово!', 'ok');
    }
  } catch(e) { setStatus('aud-status', `❌ ${e.message}`, 'error'); }
  setLoading('aud-transcribe', false, '🎤 Транскрибировать');
});

$('aud-open').addEventListener('click',   () => currentAudioFile && window.api.openFile(currentAudioFile));
$('aud-save').addEventListener('click',   async () => currentAudioFile && await window.api.saveFile(currentAudioFile, `audio.${$('aud-format').value||'mp3'}`));
$('aud-folder').addEventListener('click', () => window.api.openFolder('audio'));
$('aud-copy').addEventListener('click',   () => {
  navigator.clipboard.writeText($('aud-transcript-wrap').textContent).then(() => {
    $('aud-copy').textContent = '✅ Скопировано!';
    setTimeout(() => { $('aud-copy').textContent = '📋 Копировать'; }, 1500);
  });
});

// ─── Init ─────────────────────────────────────────────────────────────────────
newChat();
loadKeysInfo();
loadModels();
loadChatList();
