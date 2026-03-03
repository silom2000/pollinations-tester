# 🌸 Pollinations Model Tester

Десктопное приложение на базе **Electron** для тестирования всех AI-моделей сервиса [Pollinations.ai](https://pollinations.ai).  
Ключи API читаются автоматически из файла `.env` — поле ввода ключа отсутствует.

---

## 📁 Структура проекта

```
Pollinations_test/
├── .env                        ← API-ключи (не входит в git)
├── api.yaml                    ← OpenAPI-спецификация Pollinations
└── pollinations-tester/
    ├── main.js                 ← Electron main process
    ├── preload.js              ← Context bridge (IPC-мост)
    ├── renderer.js             ← Логика UI
    ├── index.html              ← Разметка интерфейса
    ├── styles.css              ← Тёмная тема оформления
    ├── run.bat                 ← Быстрый запуск (двойной клик)
    ├── package.json
    └── node_modules/
```

---

## ⚙️ Настройка `.env`

Файл `.env` находится **в корне проекта** (на уровень выше `pollinations-tester/`).  
Приложение читает его автоматически при старте через Node.js `fs` — без сторонних библиотек типа `dotenv`.

### Поддерживаемые переменные

| Переменная | Назначение |
|---|---|
| `POLLINATIONS_API_KEY` | Основной ключ — используется для **текста, графики, аудио** |
| `POLLINATIONS_VIDEO_KEYS` | Пул ключей для **видео** — через запятую, без пробелов |

### Пример `.env`

```env
POLLINATIONS_API_KEY=sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Видео-ключи (несколько через запятую)
POLLINATIONS_VIDEO_KEYS=sk_key1,sk_key2,sk_key3,sk_key4
```

> **Важно:** строки начинающиеся с `#` — это комментарии, они игнорируются.  
> Пустые строки тоже игнорируются.

---

## 🚀 Запуск

### Способ 1 — двойной клик
Откройте `pollinations-tester/run.bat`

### Способ 2 — терминал
```powershell
cd pollinations-tester
node_modules\.bin\electron .
```

### Способ 3 — npm
```powershell
cd pollinations-tester
npm start
```

---

## 🏗️ Архитектура приложения

### Electron: процессная модель

```
┌─────────────────────────────────────────────────┐
│                  MAIN PROCESS                    │
│  main.js                                         │
│  • Читает .env и парсит ключи                   │
│  • Хранит keyStates (баланс каждого ключа)      │
│  • Делает все HTTP-запросы к Pollinations API    │
│  • Реализует IPC-обработчики                    │
│  • Ключи НИКОГДА не передаются в renderer        │
└────────────────┬────────────────────────────────┘
                 │ IPC (contextBridge)
                 │ preload.js — безопасный мост
                 │
┌────────────────▼────────────────────────────────┐
│               RENDERER PROCESS                   │
│  renderer.js + index.html + styles.css           │
│  • Управляет UI (вкладки, кнопки, результаты)   │
│  • Вызывает window.api.* для запросов           │
│  • Отображает балансы ключей                    │
│  • НЕ имеет доступа к файловой системе          │
└─────────────────────────────────────────────────┘
```

### Безопасность ключей
- `contextIsolation: true` — renderer изолирован от Node.js
- `nodeIntegration: false` — renderer не может вызывать Node API
- Все API-запросы выполняются **только в main process**
- В renderer передаётся только замаскированный вид ключа: `sk_tLygXd...jlZR`
- Транскрипция аудио тоже идёт через main process (IPC `transcribe-audio`)

---

## 🔑 Система управления ключами

### Логика работы

При запуске и при нажатии **↻** приложение параллельно проверяет баланс каждого ключа через `GET /account/balance`.

```
Запуск приложения
      │
      ▼
checkBalance(mainKey)          → баланс основного ключа
checkBalance(videoKey[0..N])   → балансы всех видео-ключей (параллельно)
      │
      ▼
keyStates[] = [{ key, balance, active }]
      │
      ├── active = true   если balance > 0
      └── active = false  если balance = null или 0
```

### Выбор видео-ключа (`pickVideoKey`)

```
Из keyStates берём только active && balance > 0
      ↓
Сортируем по убыванию баланса
      ↓
Берём ключ с максимальным балансом
      ↓
После успешной генерации: balance -= 1 (оптимистичное уменьшение)
```

Если активных ключей нет — используется первый ключ из списка как fallback.

### Индикаторы в шапке

| Элемент | Значение |
|---|---|
| 🟢 зелёная точка | Ключ активен, баланс > 0 |
| 🔴 красная точка | Ключ мёртв (баланс 0 или ошибка авторизации) |
| 🟡 мигающая точка | Идёт проверка баланса |
| `Основной: 42.5 pollen` | Баланс основного ключа |
| `Видео-ключи: 7/9 активных` | Активных / всего видео-ключей |

### Раскрывающаяся панель ключей

Клик по строке ключей в шапке открывает детальную панель со всеми ключами:

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ ОСНОВНОЙ        │  │ ВИДЕО #1        │  │ ВИДЕО #2 (dead) │
│ sk_tLyg...jlZR  │  │ sk_uW14...G0l   │  │ sk_Hu7i...qlCp  │
│ 42.50 pollen   │  │ 15.00 pollen   │  │ 0.00 pollen    │
│ Текст·Граф·Ауд │  │ Только видео    │  │ Только видео    │
└─────────────────┘  └─────────────────┘  └─ (затемнён) ───┘
```

Цветовая индикация баланса:
- 🟢 `>5 pollen` — зелёный (достаточно)
- 🟡 `1–5 pollen` — жёлтый (мало)
- 🔴 `0 pollen` — красный (исчерпан)
- ⚪ `null` — серый (ошибка авторизации)

---

## 🖼️ Вкладка «Графика»

**Endpoint:** `GET /image/{prompt}`  
**Ключ:** `POLLINATIONS_API_KEY`

### Параметры

| Поле | Описание | По умолчанию |
|---|---|---|
| Модель | ID модели из списка | `zimage` |
| Промпт | Текстовое описание изображения | — |
| Негативный промпт | Что исключить из изображения | `worst quality, blurry` |
| Ширина | Ширина в пикселях (256–2048, шаг 64) | `1024` |
| Высота | Высота в пикселях (256–2048, шаг 64) | `1024` |
| Seed | Зерно генерации (-1 = случайный) | `-1` |
| Качество | low / medium / high / hd (только gptimage) | `medium` |
| Enhance | AI-улучшение промпта | выключено |

### Доступные модели

| Модель | Описание |
|---|---|
| `flux` | Flux Schnell — быстрый, бесплатный |
| `zimage` | Z-Image Turbo — быстрый, бесплатный |
| `klein` | FLUX.2 Klein 4B |
| `klein-large` | FLUX.2 Klein 9B |
| `gptimage` | GPT Image 1 Mini |
| `gptimage-large` | GPT Image 1.5 (PAID) |
| `kontext` | FLUX.1 Kontext — редактирование (PAID) |
| `seedream` | Seedream 4.0 (PAID) |
| `seedream-pro` | Seedream 4.5 Pro (PAID) |
| `nanobanana` | NanoBanana (PAID) |
| `nanobanana-2` | NanoBanana 2 (PAID) |
| `nanobanana-pro` | NanoBanana Pro (PAID) |
| `imagen-4` | Imagen 4 от Google (ALPHA) |
| `grok-imagine` | Grok Imagine (ALPHA) |

### Как формируется запрос

```
GET https://gen.pollinations.ai/image/{prompt}
  ?model=flux
  &width=1920
  &height=1080
  &seed=-1
  &enhance=true
  &negative_prompt=worst+quality,+blurry
Authorization: Bearer sk_...
```

Ответ — бинарный JPEG/PNG. Сохраняется во временный файл `%TEMP%/poll_img_*.jpg`, затем отображается в UI.  
Поддерживаются HTTP-редиректы 301/302/307/308 (важно для разных разрешений).

---

## 🎬 Вкладка «Видео»

**Endpoint:** `GET /video/{prompt}`  
**Ключ:** автоматически выбирается из `POLLINATIONS_VIDEO_KEYS` (с максимальным балансом)

### Параметры

| Поле | Описание | По умолчанию |
|---|---|---|
| Модель | ID видео-модели | `wan` |
| Промпт | Текстовое описание видео | — |
| Длительность | Длина видео в секундах (1–15) | `4` |
| Соотношение сторон | `16:9` или `9:16` | `16:9` |
| Аудиодорожка | Генерировать звук к видео | выключено |

### Доступные модели

| Модель | Особенности |
|---|---|
| `grok-video` | Grok Video alpha, бесплатный |
| `ltx-2` | LTX-2 (PAID) |
| `seedance-pro` | Seedance Pro-Fast (PAID) |
| `seedance` | Seedance Lite (PAID) |
| `wan` | Wan 2.6 (PAID) |
| `veo` | Veo 3.1 Fast (PAID) |

### Индикатор активного ключа

На вкладке видно какой именно ключ будет использован:
```
Активный ключ: sk_uW14CB...G0l (15.0 pollen)
```

После генерации баланс этого ключа уменьшается на 1 (`оптимистичное списание`), а по завершении запускается полная перепроверка балансов.

---

## ✍️ Вкладка «Текст»

**Endpoint:** `POST /v1/chat/completions` (совместим с OpenAI SDK)  
**Ключ:** `POLLINATIONS_API_KEY`

### Параметры

| Поле | Описание | По умолчанию |
|---|---|---|
| Модель | ID текстовой модели | `openai` |
| Системный промпт | Инструкция для модели (необязательно) | — |
| Запрос | Сообщение пользователя | — |
| Temperature | Степень случайности ответа (0.0–2.0) | `1.0` |

### Доступные модели

| Модель | Провайдер |
|---|---|
| `openai` | OpenAI GPT-4o |
| `openai-fast` | OpenAI GPT-5 Nano |
| `openai-large` | OpenAI GPT-5.2 (PAID) |
| `gemini` | Google Gemini 2.5 Pro |
| `gemini-fast` | Google Gemini 2.5 Flash Lite |
| `gemini-search` | Gemini с поиском |
| `claude` | Anthropic Claude |
| `claude-fast` | Claude Haiku 4.5 |
| `claude-large` | Claude (большой) |
| `deepseek` | DeepSeek V3.2 |
| `grok` | xAI Grok 4 Fast (PAID) |
| `mistral` | Mistral Small 3.2 |
| `qwen-coder` | Qwen3 Coder 30B |
| `qwen-safety` | Qwen3Guard 8B |
| `perplexity-fast` | Perplexity Sonar |
| `perplexity-reasoning` | Perplexity Sonar Reasoning |
| `minimax` | MiniMax M2.5 |
| `kimi` | Moonshot Kimi K2.5 |
| `nova-fast` | Amazon Nova Micro |
| `midijourney` | MIDIjourney |

### Результат

Отображается ответ модели + метаданные:
```
Модель: openai · Токены: 12↑ 48↓
```

---

## 🔊 Вкладка «Аудио»

Три режима работы переключаются сегментированным контролом.

### Режим 1: Речь (TTS)

**Endpoint:** `GET /audio/{text}`  
**Модель:** `elevenlabs`  
**Ключ:** `POLLINATIONS_API_KEY`

| Поле | Описание |
|---|---|
| Текст | Текст для озвучки (до 4096 символов) |
| Голос | 34 голоса: alloy, echo, nova, rachel, domi, bella и др. |
| Формат | mp3, opus, aac, flac, wav |

Голоса ElevenLabs (rachel, domi, bella, elli и др.) и OpenAI (alloy, echo, fable, onyx, nova, shimmer).

### Режим 2: Музыка

**Endpoint:** `GET /audio/{description}`  
**Модель:** `elevenmusic`  
**Ключ:** `POLLINATIONS_API_KEY`

| Поле | Описание |
|---|---|
| Описание | Жанр / инструменты / настроение |
| Длительность | 3–300 секунд |
| Инструментал | Без вокала |

### Режим 3: Транскрипция

**Endpoint:** `POST /v1/audio/transcriptions`  
**Ключ:** `POLLINATIONS_API_KEY`  
Файл передаётся через **main process** по IPC — ключ никогда не попадает в renderer.

| Поле | Описание |
|---|---|
| Файл | Перетащить или выбрать (mp3, wav, m4a, webm…) |
| Язык | ISO-639-1 код (ru, en, de…) |
| Модель | `whisper-large-v3` или `scribe` (ElevenLabs, 90+ языков) |

---

## 🗂️ Карточки моделей

На каждой вкладке внизу отображаются карточки моделей, загружаемые с API:

- `GET /text/models` — текстовые модели
- `GET /image/models` — графические и видео модели  
- `GET /audio/models` — аудио модели

Клик по карточке — автоматически выбирает модель в селекте.

Бейджи на карточках:
- 🟢 **FREE** — бесплатно в рамках тарифа
- 🟣 **PAID** — требует платного тарифа
- 🔵 **NEW** — новая модель
- 🟡 **ALPHA** — нестабильная, экспериментальная

---

## 🌐 API Endpoints (справка)

Все запросы идут на `https://gen.pollinations.ai`

| Метод | Endpoint | Назначение |
|---|---|---|
| `GET` | `/text/models` | Список текстовых моделей |
| `GET` | `/image/models` | Список графических/видео моделей |
| `GET` | `/audio/models` | Список аудио моделей |
| `POST` | `/v1/chat/completions` | Генерация текста (OpenAI-совместимо) |
| `GET` | `/image/{prompt}` | Генерация изображения |
| `GET` | `/video/{prompt}` | Генерация видео |
| `GET` | `/audio/{text}` | TTS или музыка |
| `POST` | `/v1/audio/transcriptions` | Транскрипция аудио |
| `GET` | `/account/balance` | Баланс ключа (pollen) |

---

## 📦 Зависимости

```json
{
  "devDependencies": {
    "electron": "^36.x"
  },
  "dependencies": {
    "form-data": "^4.x"
  }
}
```

- **electron** — фреймворк для десктопных приложений
- **form-data** — формирование `multipart/form-data` для транскрипции в main process
- Встроенные Node.js модули: `https`, `http`, `fs`, `path`, `os` — без дополнительных зависимостей

---

## 🔄 Жизненный цикл запросов

```
Пользователь нажимает "Сгенерировать"
         │
         ▼
renderer.js → window.api.generateImage(params)
         │
         ▼ IPC (contextBridge)
preload.js → ipcRenderer.invoke('generate-image', params)
         │
         ▼ Main process
main.js: ipcMain.handle('generate-image')
  • Собирает URL с параметрами
  • Подставляет mainKey из ENV (ключ не покидает main process)
  • fetchBinary() → HTTPS-запрос с редиректами
  • Сохраняет результат в %TEMP%/poll_img_*.jpg
  • Возвращает { file: tmpPath, contentType }
         │
         ▼ IPC response
renderer.js получает путь к файлу
  • img.src = "file:///C:/Users/.../poll_img_123.jpg"
  • Отображает изображение
```

---

## 🛠️ Отладка

Для открытия DevTools раскомментируйте строку в `main.js`:

```js
// mainWindow.webContents.openDevTools();
```

---

## 🔒 Безопасность

| Угроза | Защита |
|---|---|
| Утечка ключей в renderer | `contextIsolation: true` + все запросы в main |
| XSS в renderer | `nodeIntegration: false` |
| Ключи в логах | В UI показывается только `sk_tLygXd...jlZR` |
| Ключи в git | `.env` должен быть в `.gitignore` |

---

## 📝 Добавление новых ключей

Просто добавьте ключ в `.env` и перезапустите приложение:

```env
# Добавить к основному ключу — нельзя (один основной)
POLLINATIONS_API_KEY=sk_новый_ключ

# Добавить видео-ключ — просто добавьте через запятую:
POLLINATIONS_VIDEO_KEYS=sk_key1,sk_key2,sk_key3,sk_НОВЫЙ_KEY
```

После перезапуска баланс нового ключа появится в панели автоматически.

Как обновлять репозиторий в будущем
Когда внесёте изменения в код — три команды:


git add .
git commit -m "Описание что изменили"
git push
