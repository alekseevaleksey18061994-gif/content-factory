import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHANNEL = process.env.TELEGRAM_CHANNEL || "";
const ADMIN_KEY = process.env.ADMIN_KEY || crypto.randomBytes(32).toString("hex");
const ADMIN_UI_PASSWORD = process.env.ADMIN_UI_PASSWORD || "";
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || "/data";
const STATE_FILE = path.join(DATA_DIR, "state.json");
const PUBLIC_DIR = path.join(process.cwd(), "public");

const defaultState = {
  mode: "REVIEW",
  sources: [
    { id: "openai", name: "OpenAI News", type: "web", url: "https://openai.com/news/", enabled: true },
    { id: "anthropic", name: "Anthropic News", type: "web", url: "https://www.anthropic.com/news", enabled: true },
    { id: "google-ai", name: "Google AI", type: "web", url: "https://blog.google/technology/ai/", enabled: true },
    { id: "meta-ai", name: "Meta AI", type: "web", url: "https://ai.meta.com/blog/", enabled: true },
    { id: "microsoft-ai", name: "Microsoft AI", type: "web", url: "https://blogs.microsoft.com/ai/", enabled: true }
  ],
  queue: [],
  history: [],
  stats: { discovered: 0, rewritten: 0, published: 0, skipped: 0 },
  updatedAt: new Date().toISOString()
};

function ensureDataDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}

function loadState() {
  ensureDataDir();
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const saved = JSON.parse(raw);
    return Object.assign({}, structuredClone(defaultState), saved);
  } catch {
    return structuredClone(defaultState);
  }
}

let state = loadState();

function saveState() {
  state.updatedAt = new Date().toISOString();
  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function sendJson(res, status, payload, headers) {
  const h = Object.assign({ "content-type": "application/json; charset=utf-8" }, headers || {});
  res.writeHead(status, h);
  res.end(JSON.stringify(payload));
}

function sendHtmlFile(res, fileName) {
  const file = path.join(PUBLIC_DIR, fileName);
  try {
    const body = fs.readFileSync(file, "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(body);
  } catch {
    sendJson(res, 500, { ok: false, error: "UI file missing" });
  }
}

function redirect(res, location) {
  res.writeHead(302, { location: location });
  res.end();
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1024 * 1024) throw new Error("request too large");
  }
  if (!body) return {};
  return JSON.parse(body);
}

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const out = {};
  raw.split(";").forEach(function(part) {
    const trimmed = part.trim();
    if (!trimmed) return;
    const i = trimmed.indexOf("=");
    if (i === -1) return;
    out[trimmed.slice(0, i)] = decodeURIComponent(trimmed.slice(i + 1));
  });
  return out;
}

function sessionToken() {
  return crypto.createHmac("sha256", ADMIN_KEY).update("news-factory-admin").digest("hex");
}

function isAuthed(req) {
  return parseCookies(req).nf_session === sessionToken();
}

function requireAuth(req, res) {
  if (!isAuthed(req)) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return false;
  }
  return true;
}

function newId(prefix) {
  return (prefix || "item") + "_" + Date.now() + "_" + crypto.randomBytes(3).toString("hex");
}

async function sendTelegram(text) {
  if (!BOT_TOKEN || !CHANNEL) throw new Error("Telegram configuration is incomplete");
  const endpoint = "https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: CHANNEL,
      text: text,
      disable_web_page_preview: true
    })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error((data && data.description) || "Telegram API error");
  return data.result;
}


let statusCache = { at: 0, value: null };

async function telegramProbe(method, params) {
  if (!BOT_TOKEN) return { ok: false, error: "Токен не задан" };
  try {
    const endpoint = "https://api.telegram.org/bot" + BOT_TOKEN + "/" + method;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params || {}),
      signal: AbortSignal.timeout(5000)
    });
    const data = await response.json();
    if (!response.ok || !data.ok) return { ok: false, error: (data && data.description) || "Telegram API error" };
    return { ok: true, result: data.result };
  } catch (error) {
    return { ok: false, error: String(error && error.message || error) };
  }
}

function hasEnv() {
  for (const key of arguments) if (!process.env[key]) return false;
  return true;
}

async function buildSystemStatus(force) {
  const now = Date.now();
  if (!force && statusCache.value && now - statusCache.at < 30000) return statusCache.value;

  let storageOk = false;
  let storageDetail = "";
  try {
    ensureDataDir();
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
    storageOk = true;
    storageDetail = "Том /data доступен для записи";
  } catch (error) {
    storageDetail = "Нет записи в " + DATA_DIR;
  }

  const botProbe = BOT_TOKEN ? await telegramProbe("getMe") : { ok: false, error: "TELEGRAM_BOT_TOKEN не задан" };
  const chatProbe = BOT_TOKEN && CHANNEL ? await telegramProbe("getChat", { chat_id: CHANNEL }) : { ok: false, error: "Канал или токен не заданы" };

  const railwayConnected = Boolean(
    process.env.RAILWAY_PROJECT_ID ||
    process.env.RAILWAY_SERVICE_ID ||
    process.env.RAILWAY_ENVIRONMENT_ID ||
    process.env.RAILWAY_PUBLIC_DOMAIN
  );
  const gitConnected = Boolean(process.env.RAILWAY_GIT_COMMIT_SHA || process.env.RAILWAY_GIT_REPO_NAME);

  const details = {
    railway: {
      state: railwayConnected ? "connected" : "partial",
      description: railwayConnected ? "Production запущен в Railway" : "Сервис работает, системные переменные Railway не найдены",
      detail: process.env.RAILWAY_ENVIRONMENT_NAME ? "Окружение: " + process.env.RAILWAY_ENVIRONMENT_NAME : "Environment: production",
      next: railwayConnected ? "" : "Проверить Railway runtime variables"
    },
    github: {
      state: gitConnected ? "connected" : "partial",
      description: gitConnected ? "Деплой идёт из GitHub" : "Исходники есть в GitHub, runtime не отдал commit metadata",
      detail: process.env.RAILWAY_GIT_COMMIT_SHA ? "Commit: " + process.env.RAILWAY_GIT_COMMIT_SHA.slice(0, 8) : "Repo: content-factory/news-factory",
      next: gitConnected ? "" : "Проверить source connection в Railway"
    },
    telegramBot: {
      state: botProbe.ok ? "connected" : (BOT_TOKEN ? "partial" : "missing"),
      description: botProbe.ok ? "Бот отвечает через Telegram API" : "Бот не подтверждён API",
      detail: botProbe.ok && botProbe.result ? "@" + (botProbe.result.username || "bot") : String(botProbe.error || ""),
      next: botProbe.ok ? "" : "Проверить TELEGRAM_BOT_TOKEN"
    },
    telegramChannel: {
      state: chatProbe.ok ? "connected" : (CHANNEL ? "partial" : "missing"),
      description: chatProbe.ok ? "Канал доступен боту" : "Доступ к каналу не подтверждён",
      detail: chatProbe.ok && chatProbe.result ? ((chatProbe.result.title || CHANNEL) + " · " + CHANNEL) : String(chatProbe.error || CHANNEL || ""),
      next: chatProbe.ok ? "" : "Проверить права бота и TELEGRAM_CHANNEL"
    },
    storage: {
      state: storageOk ? "connected" : "missing",
      description: storageOk ? "Постоянное хранилище подключено" : "Хранилище недоступно",
      detail: storageDetail,
      next: storageOk ? "" : "Проверить Railway volume /data"
    },
    adminUi: {
      state: ADMIN_UI_PASSWORD ? "connected" : "missing",
      description: ADMIN_UI_PASSWORD ? "Приватная админка защищена входом" : "Пароль админки не задан",
      detail: ADMIN_UI_PASSWORD ? "Сессия HttpOnly + Secure" : "",
      next: ADMIN_UI_PASSWORD ? "" : "Добавить ADMIN_UI_PASSWORD"
    },
    openai: {
      state: hasEnv("OPENAI_API_KEY") ? "connected" : "missing",
      description: hasEnv("OPENAI_API_KEY") ? "OpenAI API настроен" : "AI rewrite пока не подключён",
      detail: hasEnv("OPENAI_API_KEY") ? "Ключ найден в environment" : "OPENAI_API_KEY отсутствует",
      next: hasEnv("OPENAI_API_KEY") ? "" : "Подключить OpenAI API для переписывания новостей"
    },
    supabase: {
      state: hasEnv("SUPABASE_URL") && (hasEnv("SUPABASE_SERVICE_ROLE_KEY") || hasEnv("SUPABASE_ANON_KEY")) ? "connected" : "missing",
      description: hasEnv("SUPABASE_URL") ? "Supabase указан" : "База Supabase ещё не подключена",
      detail: hasEnv("SUPABASE_URL") ? "URL найден в environment" : "Сейчас MVP хранит state.json на /data",
      next: hasEnv("SUPABASE_URL") ? "" : "Подключить Supabase/PostgreSQL для multi-channel"
    },
    vk: {
      state: hasEnv("VK_ACCESS_TOKEN") && hasEnv("VK_OWNER_ID") ? "connected" : "missing",
      description: hasEnv("VK_ACCESS_TOKEN") ? "VK частично настроен" : "Автопубликация VK ещё не подключена",
      detail: hasEnv("VK_OWNER_ID") ? "Owner ID найден" : "",
      next: hasEnv("VK_ACCESS_TOKEN") && hasEnv("VK_OWNER_ID") ? "" : "Подключить VK API"
    },
    collector: {
      state: "partial",
      description: "Источники добавляются, автоматический сборщик ещё не запущен",
      detail: String((state.sources || []).filter(function(x){ return x.enabled; }).length) + " активных источников",
      next: "Добавить RSS/Web/Telegram ingestion и Fetch Now"
    },
    scheduler: {
      state: "missing",
      description: "Автоматический планировщик пока не включён",
      detail: state.mode === "AUTO" ? "AUTO выбран, но collector/scheduler ещё не реализованы" : "Текущий режим: " + state.mode,
      next: "Запустить scheduler после News Collector"
    }
  };

  const values = Object.values(details);
  const summary = {
    connected: values.filter(function(x){ return x.state === "connected"; }).length,
    partial: values.filter(function(x){ return x.state === "partial"; }).length,
    missing: values.filter(function(x){ return x.state === "missing"; }).length,
    total: values.length
  };

  const result = {
    ok: true,
    checkedAt: new Date().toISOString(),
    environment: process.env.RAILWAY_ENVIRONMENT_NAME || "production",
    service: "news-factory-api",
    mode: state.mode,
    summary: summary,
    details: details
  };
  statusCache = { at: now, value: result };
  return result;
}

const server = http.createServer(async function(req, res) {
  try {
    const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
    const p = url.pathname;

    if (req.method === "GET" && p === "/health") {
      return sendJson(res, 200, {
        ok: true,
        service: "news-factory",
        telegramConfigured: Boolean(BOT_TOKEN && CHANNEL),
        uiConfigured: Boolean(ADMIN_UI_PASSWORD)
      });
    }

    if (req.method === "GET" && p === "/") return redirect(res, "/admin");
    if (req.method === "GET" && p === "/login") {
      if (isAuthed(req)) return redirect(res, "/admin");
      return sendHtmlFile(res, "login.html");
    }
    if (req.method === "GET" && p === "/admin") {
      if (!isAuthed(req)) return redirect(res, "/login");
      return sendHtmlFile(res, "admin.html");
    }

    if (req.method === "POST" && p === "/api/login") {
      const body = await readJson(req);
      if (!ADMIN_UI_PASSWORD || body.password !== ADMIN_UI_PASSWORD) {
        return sendJson(res, 401, { ok: false, error: "invalid password" });
      }
      return sendJson(res, 200, { ok: true }, {
        "set-cookie": "nf_session=" + sessionToken() + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000"
      });
    }

    if (req.method === "POST" && p === "/api/logout") {
      return sendJson(res, 200, { ok: true }, {
        "set-cookie": "nf_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
      });
    }

    if (p.startsWith("/api/") && !requireAuth(req, res)) return;

    if (req.method === "GET" && p === "/api/dashboard") {
      return sendJson(res, 200, { ok: true, state: state });
    }

    if (req.method === "GET" && p === "/api/status") {
      const force = url.searchParams.get("refresh") === "1";
      const status = await buildSystemStatus(force);
      return sendJson(res, 200, status);
    }

    if (req.method === "POST" && p === "/api/mode") {
      const body = await readJson(req);
      const mode = String(body.mode || "");
      if (!["AUTO", "REVIEW", "PAUSED"].includes(mode)) {
        return sendJson(res, 400, { ok: false, error: "invalid mode" });
      }
      state.mode = mode;
      saveState();
      return sendJson(res, 200, { ok: true, mode: mode });
    }

    if (req.method === "POST" && p === "/api/test") {
      const marker = crypto.randomBytes(3).toString("hex");
      const result = await sendTelegram("✅ News Factory подключён\n\nАвтопубликация в AI Pulse работает.\nТест: " + marker);
      state.history.unshift({ id: newId("hist"), title: "Тест News Factory", messageId: result.message_id, publishedAt: new Date().toISOString() });
      state.history = state.history.slice(0, 100);
      state.stats.published += 1;
      saveState();
      return sendJson(res, 200, { ok: true, messageId: result.message_id });
    }

    if (req.method === "POST" && p === "/api/publish") {
      const body = await readJson(req);
      const text = String(body.text || "").trim();
      if (!text) return sendJson(res, 400, { ok: false, error: "Введите текст" });
      const result = await sendTelegram(text);
      state.history.unshift({
        id: newId("hist"),
        title: String(body.title || "Публикация"),
        text: text,
        messageId: result.message_id,
        publishedAt: new Date().toISOString()
      });
      state.history = state.history.slice(0, 100);
      state.stats.published += 1;
      saveState();
      return sendJson(res, 200, { ok: true, messageId: result.message_id });
    }

    if (req.method === "POST" && p === "/api/sources") {
      const body = await readJson(req);
      const name = String(body.name || "").trim();
      const sourceUrl = String(body.url || "").trim();
      if (!name || !sourceUrl) return sendJson(res, 400, { ok: false, error: "Заполните название и ссылку" });
      state.sources.push({ id: newId("src"), name: name, type: "web", url: sourceUrl, enabled: true });
      saveState();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && p === "/api/sources/toggle") {
      const body = await readJson(req);
      const src = state.sources.find(function(x){ return x.id === body.id; });
      if (!src) return sendJson(res, 404, { ok: false, error: "Источник не найден" });
      src.enabled = !src.enabled;
      saveState();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && p === "/api/sources/remove") {
      const body = await readJson(req);
      state.sources = state.sources.filter(function(x){ return x.id !== body.id; });
      saveState();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && p === "/api/queue") {
      const body = await readJson(req);
      const text = String(body.text || "").trim();
      if (!text) return sendJson(res, 400, { ok: false, error: "Нужен текст" });
      state.queue.unshift({
        id: newId("q"),
        title: String(body.title || "Черновик"),
        text: text,
        createdAt: new Date().toISOString()
      });
      saveState();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && p === "/api/queue/remove") {
      const body = await readJson(req);
      state.queue = state.queue.filter(function(x){ return x.id !== body.id; });
      saveState();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && p === "/api/queue/publish") {
      const body = await readJson(req);
      const item = state.queue.find(function(x){ return x.id === body.id; });
      if (!item) return sendJson(res, 404, { ok: false, error: "Черновик не найден" });
      const result = await sendTelegram(item.text);
      state.queue = state.queue.filter(function(x){ return x.id !== body.id; });
      state.history.unshift({
        id: newId("hist"),
        title: item.title,
        text: item.text,
        messageId: result.message_id,
        publishedAt: new Date().toISOString()
      });
      state.history = state.history.slice(0, 100);
      state.stats.published += 1;
      saveState();
      return sendJson(res, 200, { ok: true, messageId: result.message_id });
    }

    if (req.method === "POST" && p === "/publish") {
      if (req.headers["x-admin-key"] !== ADMIN_KEY) return sendJson(res, 401, { ok: false, error: "unauthorized" });
      const body = await readJson(req);
      const text = String(body.text || "").trim();
      if (!text) return sendJson(res, 400, { ok: false, error: "text is required" });
      const result = await sendTelegram(text);
      return sendJson(res, 200, { ok: true, messageId: result.message_id });
    }

    return sendJson(res, 404, { ok: false, error: "not found" });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: error.message });
  }
});

server.listen(PORT, "0.0.0.0", function() {
  console.log("News Factory listening on :" + PORT);
});
