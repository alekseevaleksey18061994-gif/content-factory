import http from "node:http";
import crypto from "node:crypto";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL = process.env.TELEGRAM_CHANNEL;
const ADMIN_KEY = process.env.ADMIN_KEY;
const PORT = Number(process.env.PORT || 3000);

if (!BOT_TOKEN) console.warn("TELEGRAM_BOT_TOKEN is not set");
if (!CHANNEL) console.warn("TELEGRAM_CHANNEL is not set");
if (!ADMIN_KEY) console.warn("ADMIN_KEY is not set");

async function sendTelegram(text) {
  if (!BOT_TOKEN || !CHANNEL) throw new Error("Telegram configuration is incomplete");
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: CHANNEL,
      text,
      disable_web_page_preview: true
    })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data?.description || "Telegram API error");
  return data.result;
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return sendJson(res, 200, {
        ok: true,
        service: "news-factory",
        telegramConfigured: Boolean(BOT_TOKEN && CHANNEL)
      });
    }

    if (req.method === "POST" && req.url === "/publish") {
      if (!ADMIN_KEY || req.headers["x-admin-key"] !== ADMIN_KEY) {
        return sendJson(res, 401, { ok: false, error: "unauthorized" });
      }

      let body = "";
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body || "{}");
      const text = String(parsed.text || "").trim();
      if (!text) return sendJson(res, 400, { ok: false, error: "text is required" });

      const result = await sendTelegram(text);
      return sendJson(res, 200, { ok: true, messageId: result.message_id });
    }

    if (req.method === "POST" && req.url === "/test") {
      if (!ADMIN_KEY || req.headers["x-admin-key"] !== ADMIN_KEY) {
        return sendJson(res, 401, { ok: false, error: "unauthorized" });
      }

      const marker = crypto.randomBytes(3).toString("hex");
      const result = await sendTelegram(
        `✅ News Factory подключён\n\nАвтопубликация в AI Pulse работает.\nТест: ${marker}`
      );
      return sendJson(res, 200, { ok: true, messageId: result.message_id });
    }

    sendJson(res, 404, { ok: false, error: "not found" });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`News Factory listening on :${PORT}`);
});
