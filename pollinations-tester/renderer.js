'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let currentImageFile = null;
let currentVideoFile = null;
let currentAudioFile = null;
let audioMode = 'tts';
let transcribeFilePath = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

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
    btn.innerHTML = label || btn.dataset.label;
  }
}

function saveLabel(btnId, label) {
  $(btnId).dataset.label = label;
}

// ─── Keys panel ───────────────────────────────────────────────────────────────
async function loadKeysInfo() {
  $('mainKeyBalance').textContent = '…';
  $('videoKeysBalance').textContent = '…';
  $('mainKeyDot').className = 'key-dot dot-loading';
  $('videoKeysDot').className = 'key-dot dot-loading';

  let info;
  try {
    info = await window.api.getKeysInfo();
  } catch (e) {
    $('mainKeyBalance').textContent = 'ERR';
    $('videoKeysBalance').textContent = 'ERR';
    return;
  }

  // ── Main key pill ──
  const mb = info.main.balance;
  $('mainKeyBalance').textContent = mb !== null ? mb.toFixed(1) : '—';
  $('mainKeyDot').className = 'key-dot ' + (info.main.active ? 'dot-ok' : 'dot-dead');

  // ── Video keys pill ──
  const activeCount = info.video.filter(v => v.active).length;
  const totalCount  = info.video.length;
  $('videoKeysBalance').textContent = `${activeCount}/${totalCount}`;
  $('videoKeysDot').className = 'key-dot ' + (activeCount > 0 ? 'dot-ok' : 'dot-dead');

  // ── Detail bar ──
  updateActiveVideoKey(info.video);
  renderKeysDetail(info);
}

function renderKeysDetail(info) {
  const inner = $('keysDetailInner');

  // Main key card
  const mb = info.main.balance;
  const mainCard = `
    <div class="kd-card ${info.main.active ? '' : 'kd-dead'}">
      <div class="kd-type">Основной</div>
      <div class="kd-key">${info.main.key}</div>
      <div class="kd-balance ${balanceClass(mb)}">
        ${mb !== null ? mb.toFixed(2) : '—'} <span class="kd-unit">pollen</span>
      </div>
      <div class="kd-scope">Текст · Графика · Аудио</div>
    </div>`;

  // Video key cards
  const videoCards = info.video.map(v => {
    const b = v.balance;
    return `
      <div class="kd-card ${v.active ? '' : 'kd-dead'}">
        <div class="kd-type">Видео #${v.index}</div>
        <div class="kd-key">${v.key}</div>
        <div class="kd-balance ${balanceClass(b)}">
          ${b !== null ? b.toFixed(2) : '—'} <span class="kd-unit">pollen</span>
        </div>
        <div class="kd-scope">Только видео</div>
      </div>`;
  }).join('');

  inner.innerHTML = mainCard + videoCards;
}

function balanceClass(b) {
  if (b === null) return 'bal-unknown';
  if (b <= 0)     return 'bal-empty';
  if (b < 5)      return 'bal-low';
  return 'bal-ok';
}

function updateActiveVideoKey(videoKeys) {
  const active = videoKeys
    .filter(v => v.active)
    .sort((a, b) => (b.balance || 0) - (a.balance || 0));
  const best = active[0];
  $('vidActiveKeyVal').textContent = best
    ? `${best.key} (${best.balance?.toFixed(1)} pollen)`
    : 'Нет активных ключей';
  $('vidActiveKeyVal').style.color = best ? 'var(--accent)' : 'var(--danger)';
}

// Toggle detail bar
$('keyStatusWrap').addEventListener('click', () => {
  const bar = $('keysDetailBar');
  bar.classList.toggle('open');
});

$('btnRefresh').addEventListener('click', (e) => {
  e.stopPropagation();
  loadKeysInfo();
});

// ─── Tabs ─────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(s => {
      s.classList.add('hidden');
      s.classList.remove('active');
    });
    tab.classList.add('active');
    const target = $('tab-' + tab.dataset.tab);
    target.classList.remove('hidden');
    target.classList.add('active');
  });
});

// ─── Load models ──────────────────────────────────────────────────────────────
async function loadModels() {
  try {
    const [textModels, imageModels, audioModels] = await Promise.all([
      window.api.getTextModels(),
      window.api.getImageModels(),
      window.api.getAudioModels(),
    ]);

    renderTextModelCards(Array.isArray(textModels) ? textModels : []);
    renderImageModelCards(Array.isArray(imageModels) ? imageModels : []);
    renderAudioModelCards(Array.isArray(audioModels) ? audioModels : []);

    const videoModels = Array.isArray(imageModels)
      ? imageModels.filter(m => {
          const mods = m.outputModalities || m.modalities || [];
          return mods.includes('video') ||
            ['veo','seedance','seedance-pro','wan','grok-video','ltx-2'].includes(m.id);
        })
      : [];
    renderVideoModelCards(videoModels.length ? videoModels : (imageModels || []));
  } catch (e) {
    console.error('Failed to load models', e);
  }
}

// ─── Model card helpers ───────────────────────────────────────────────────────
function makeBadges(model) {
  const badges = [];
  if (model.isNew || model.new) badges.push(`<span class="badge badge-new">NEW</span>`);
  if (model.paidOnly || model.paid_only) badges.push(`<span class="badge badge-paid">PAID</span>`);
  if (model.isAlpha || model.alpha) badges.push(`<span class="badge badge-alpha">ALPHA</span>`);
  if (!model.paidOnly && !model.paid_only) badges.push(`<span class="badge badge-free">FREE</span>`);
  return badges.join('');
}

function renderCards(containerId, models, onSelect) {
  const container = $(containerId);
  if (!models.length) { container.innerHTML = '<div class="loading-dots">Нет данных</div>'; return; }
  container.innerHTML = models.map(m => {
    const name = m.name || m.id || 'Unknown';
    const id   = m.id || '';
    const desc = m.description
      ? `<div class="mc-id" title="${m.description}">${m.description.slice(0, 60)}${m.description.length > 60 ? '…' : ''}</div>`
      : `<div class="mc-id">${id}</div>`;
    return `<div class="model-card" data-id="${id}">
      <div class="mc-name">${name}</div>${desc}
      <div class="mc-badges">${makeBadges(m)}</div>
    </div>`;
  }).join('');
  container.querySelectorAll('.model-card').forEach(card => {
    card.addEventListener('click', () => onSelect(card.dataset.id));
  });
}

function selectOrAdd(selectId, id) {
  const sel = $(selectId);
  let found = false;
  for (const opt of sel.options) { if (opt.value === id) { sel.value = id; found = true; break; } }
  if (!found) { const o = new Option(id, id); sel.add(o); sel.value = id; }
}

function renderTextModelCards(models) {
  renderCards('txt-model-cards', models, id => selectOrAdd('txt-model', id));
}
function renderImageModelCards(models) {
  const imgOnly = models.filter(m => {
    const mods = m.outputModalities || m.modalities || [];
    return !mods.includes('video') &&
      !['veo','seedance','seedance-pro','wan','grok-video','ltx-2'].includes(m.id);
  });
  renderCards('img-model-cards', imgOnly.length ? imgOnly : models, id => selectOrAdd('img-model', id));
}
function renderVideoModelCards(models) {
  renderCards('vid-model-cards', models, id => selectOrAdd('vid-model', id));
}
function renderAudioModelCards(models) {
  renderCards('aud-model-cards', models, id => {
    if (id === 'elevenmusic') switchAudioMode('music');
    else if (id.includes('whisper') || id === 'scribe') switchAudioMode('transcribe');
  });
}

// ─── IMAGE TAB ────────────────────────────────────────────────────────────────
saveLabel('img-generate', '⚡ Сгенерировать');

$('img-generate').addEventListener('click', async () => {
  const prompt = $('img-prompt').value.trim();
  if (!prompt) { setStatus('img-status', '⚠️ Введите промпт', 'error'); return; }

  setLoading('img-generate', true, '⏳ Генерация изображения...');
  setStatus('img-status', '🔄 Отправка запроса...');
  $('img-result').classList.add('hidden');
  $('img-placeholder').classList.remove('hidden');
  $('img-actions').classList.add('hidden');

  try {
    const result = await window.api.generateImage({
      model:          $('img-model').value,
      prompt,
      width:          $('img-width').value,
      height:         $('img-height').value,
      seed:           $('img-seed').value,
      enhance:        $('img-enhance').checked,
      negativePrompt: $('img-neg').value,
    });

    if (result.error) {
      setStatus('img-status', `❌ ${result.error}`, 'error');
    } else {
      currentImageFile = result.file;
      const img = $('img-result');
      img.src = `file://${result.file}?t=${Date.now()}`;
      img.onload = () => {
        $('img-placeholder').classList.add('hidden');
        img.classList.remove('hidden');
        $('img-actions').classList.remove('hidden');
        setStatus('img-status', `✅ Готово! ${result.contentType}`, 'ok');
      };
    }
  } catch (e) {
    setStatus('img-status', `❌ ${e.message}`, 'error');
  }
  setLoading('img-generate', false, '⚡ Сгенерировать');
});

$('img-open').addEventListener('click', () => { if (currentImageFile) window.api.openFile(currentImageFile); });
$('img-save').addEventListener('click', async () => {
  if (currentImageFile) await window.api.saveFile(currentImageFile, 'image.jpg');
});

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
      model:       $('vid-model').value,
      prompt,
      duration:    $('vid-dur').value,
      aspectRatio: $('vid-ratio').value,
      audio:       $('vid-audio').checked,
    });

    if (result.error) {
      setStatus('vid-status', `❌ ${result.error}`, 'error');
    } else {
      currentVideoFile = result.file;
      const vid = $('vid-result');
      vid.src = `file://${result.file}`;
      $('vid-placeholder').classList.add('hidden');
      vid.classList.remove('hidden');
      $('vid-actions').classList.remove('hidden');
      const keyInfo = result.usedKey ? ` · ключ: ${result.usedKey}` : '';
      setStatus('vid-status', `✅ Готово!${keyInfo}`, 'ok');
      // Refresh balances in background after video generation
      loadKeysInfo();
    }
  } catch (e) {
    setStatus('vid-status', `❌ ${e.message}`, 'error');
  }
  setLoading('vid-generate', false, '⚡ Сгенерировать');
});

$('vid-open').addEventListener('click', () => { if (currentVideoFile) window.api.openFile(currentVideoFile); });
$('vid-save').addEventListener('click', async () => {
  if (currentVideoFile) await window.api.saveFile(currentVideoFile, 'video.mp4');
});

// ─── TEXT TAB ─────────────────────────────────────────────────────────────────
saveLabel('txt-generate', '⚡ Отправить');

$('txt-generate').addEventListener('click', async () => {
  const prompt = $('txt-prompt').value.trim();
  if (!prompt) { setStatus('txt-status', '⚠️ Введите промпт', 'error'); return; }

  setLoading('txt-generate', true, '⏳ Отправка...');
  setStatus('txt-status', '🔄 Запрос в процессе...');
  $('txt-result').classList.add('hidden');
  $('txt-placeholder').classList.remove('hidden');
  $('txt-actions').classList.add('hidden');

  try {
    const result = await window.api.generateText({
      model:        $('txt-model').value,
      prompt,
      systemPrompt: $('txt-system').value.trim(),
      temperature:  $('txt-temp').value,
    });

    if (result.error || !result.choices) {
      const errMsg = result.error?.message || result.error || JSON.stringify(result).slice(0, 200);
      setStatus('txt-status', `❌ ${errMsg}`, 'error');
    } else {
      const content = result.choices[0]?.message?.content || '(пустой ответ)';
      const usage   = result.usage || {};
      const resEl   = $('txt-result');
      resEl.textContent = content;
      $('txt-placeholder').classList.add('hidden');
      resEl.classList.remove('hidden');
      $('txt-actions').classList.remove('hidden');
      $('txt-meta').textContent =
        `Модель: ${result.model} · Токены: ${usage.prompt_tokens || 0}↑ ${usage.completion_tokens || 0}↓`;
      setStatus('txt-status', '✅ Готово!', 'ok');
    }
  } catch (e) {
    setStatus('txt-status', `❌ ${e.message}`, 'error');
  }
  setLoading('txt-generate', false, '⚡ Отправить');
});

$('txt-copy').addEventListener('click', () => {
  navigator.clipboard.writeText($('txt-result').textContent).then(() => {
    $('txt-copy').textContent = '✅ Скопировано!';
    setTimeout(() => { $('txt-copy').textContent = '📋 Копировать'; }, 1500);
  });
});

// ─── AUDIO TAB ────────────────────────────────────────────────────────────────
document.querySelectorAll('.seg').forEach(btn => {
  btn.addEventListener('click', () => switchAudioMode(btn.dataset.mode));
});

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

  const model = audioMode === 'music' ? 'elevenmusic' : 'elevenlabs';

  try {
    const result = await window.api.generateAudio({
      model,
      text,
      voice:          $('aud-voice').value,
      responseFormat: $('aud-format').value,
      duration:       audioMode === 'music' ? $('aud-duration').value : undefined,
      instrumental:   audioMode === 'music' ? $('aud-instrumental').checked : false,
    });

    if (result.error) {
      setStatus('aud-status', `❌ ${result.error}`, 'error');
    } else {
      currentAudioFile = result.file;
      $('aud-result').src = `file://${result.file}?t=${Date.now()}`;
      $('aud-placeholder').classList.add('hidden');
      $('aud-player-wrap').classList.remove('hidden');
      $('aud-actions').classList.remove('hidden');
      setStatus('aud-status', `✅ Готово! ${result.contentType}`, 'ok');
    }
  } catch (e) {
    setStatus('aud-status', `❌ ${e.message}`, 'error');
  }
  setLoading('aud-generate', false, '⚡ Сгенерировать');
});

// Transcribe file picker
$('aud-file').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) { transcribeFilePath = file.path; $('aud-file-name').textContent = `📎 ${file.name}`; }
});

const dropZone = $('aud-drop');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.borderColor = 'var(--accent)'; });
dropZone.addEventListener('dragleave', ()  => { dropZone.style.borderColor = ''; });
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.style.borderColor = '';
  const file = e.dataTransfer.files[0];
  if (file) { transcribeFilePath = file.path; $('aud-file-name').textContent = `📎 ${file.name}`; }
});

saveLabel('aud-transcribe', '🎤 Транскрибировать');

$('aud-transcribe').addEventListener('click', async () => {
  if (!transcribeFilePath) { setStatus('aud-status', '⚠️ Выберите аудио файл', 'error'); return; }

  setLoading('aud-transcribe', true, '⏳ Транскрибирование...');
  setStatus('aud-status', '🔄 Отправка файла...');

  try {
    const result = await window.api.transcribeAudio({
      filePath:  transcribeFilePath,
      language:  $('aud-lang').value || 'ru',
      model:     $('aud-whisper-model').value,
    });

    if (result.status !== 200 || result.body?.error) {
      const msg = result.body?.error?.message || result.body?.error || JSON.stringify(result.body).slice(0, 200);
      setStatus('aud-status', `❌ HTTP ${result.status}: ${msg}`, 'error');
    } else {
      const tw = $('aud-transcript-wrap');
      tw.textContent = result.body.text || JSON.stringify(result.body, null, 2);
      $('aud-placeholder').classList.add('hidden');
      tw.classList.remove('hidden');
      $('aud-transcript-actions').classList.remove('hidden');
      setStatus('aud-status', '✅ Готово!', 'ok');
    }
  } catch (e) {
    setStatus('aud-status', `❌ ${e.message}`, 'error');
  }
  setLoading('aud-transcribe', false, '🎤 Транскрибировать');
});

$('aud-open').addEventListener('click', () => { if (currentAudioFile) window.api.openFile(currentAudioFile); });
$('aud-save').addEventListener('click', async () => {
  if (currentAudioFile) {
    const fmt = $('aud-format').value || 'mp3';
    await window.api.saveFile(currentAudioFile, `audio.${fmt}`);
  }
});
$('aud-copy').addEventListener('click', () => {
  navigator.clipboard.writeText($('aud-transcript-wrap').textContent).then(() => {
    $('aud-copy').textContent = '✅ Скопировано!';
    setTimeout(() => { $('aud-copy').textContent = '📋 Копировать'; }, 1500);
  });
});

// ─── Init ─────────────────────────────────────────────────────────────────────
loadKeysInfo();
loadModels();
