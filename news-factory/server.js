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
