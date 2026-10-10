// Extracted from server.js (v0.62.0 module split). Behaviour is unchanged.
import { BOT_TOKEN, TELEGRAM_API_TIMEOUT_MS, TELEGRAM_RETRY_AFTER_MAX_SECONDS } from "./env-config.js";

// Telegram errors carry the Bot API error_code / description so callers can tell
// "the channel will never accept this" (permanent) from "try again / fix the media".
export const TELEGRAM_PERMANENT_DESCRIPTION = /chat not found|chat_id is empty|peer_id_invalid|bot was kicked|bot is not a member|bot was blocked|not enough rights|have no rights|need administrator rights|chat_admin_required|chat_write_forbidden|channel_private|chat_restricted|user is deactivated|group chat was upgraded|bot can't initiate|forbidden/i;

export function classifyTelegramError(errorCode, description) {
  const code = Number(errorCode) || 0;
  const text = String(description || "");
  return {
    parseError: code === 400 && /can't parse entities|can't find end tag|unsupported start tag|unmatched end tag/i.test(text),
    // 401 = bad token, 403 = forbidden / kicked / blocked, 404 = unknown bot token or method.
    permanent: code === 401 || code === 403 || code === 404 || (code === 400 && TELEGRAM_PERMANENT_DESCRIPTION.test(text))
  };
}

export function createTelegramError(method, httpStatus, data, fallbackMessage) {
  const body = data && typeof data === "object" ? data : {};
  const code = Number(body.error_code) || Number(httpStatus) || 0;
  const description = String(body.description || fallbackMessage || "Telegram API error");
  const params = body.parameters && typeof body.parameters === "object" ? body.parameters : {};
  const retryAfter = Number(params.retry_after);
  const kind = classifyTelegramError(code, description);
  const error = new Error(description);
  error.telegram = true;
  error.telegramMethod = method;
  error.telegramErrorCode = code;
  error.telegramDescription = description;
  error.telegramRetryAfter = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 0;
  error.telegramRateLimited = code === 429;
  error.telegramPermanent = kind.permanent;
  error.telegramParseError = kind.parseError;
  return error;
}

// Errors where another attempt (URL -> upload, generated cover, repair loop) cannot help:
// the chat rejects us, or Telegram told us to slow down.
export function isTelegramFatalError(error) {
  return Boolean(error && ((error.telegram && (error.telegramPermanent || error.telegramRateLimited)) || error.telegramAmbiguous));
}

// No Telegram answer although the request may have reached it. Connection never made (DNS, refused, connect
// timeout) is safe to retry; a timeout or a reset after sending is not.
export function telegramErrorIsAmbiguous(error) {
  if (!error) return false;
  const name = String(error.name || "");
  if (name === "TimeoutError" || name === "AbortError") return true;
  const cause = error.cause || {};
  const code = String(cause.code || error.code || "");
  if (/^(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|UND_ERR_CONNECT_TIMEOUT|ENETUNREACH|EHOSTUNREACH)$/.test(code)) return false;
  // TLS refused before any request byte was sent (certificate problems, handshake failure)
  if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO|HANDSHAKE/i.test(code)) return false;
  return true;
}

export function stripTelegramHtml(html) {
  return String(html || "")
    .replace(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, function(_m, href, label) {
      const url = String(href).replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      const text = String(label).replace(/<[^>]*>/g, "");
      return text && text !== url ? text + " (" + url + ")" : url;
    })
    .replace(/<\/?(?:b|strong|i|em|u|ins|s|strike|del|code|pre|blockquote|tg-spoiler|span|tg-emoji)(?:\s[^>]*)?>/gi, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

// The same call without HTML parsing: used when Telegram answers "can't parse entities".
export function telegramPlainPayload(payload) {
  const out = Object.assign({}, payload || {});
  let changed = false;
  if (String(out.parse_mode || "").toUpperCase() === "HTML") {
    delete out.parse_mode;
    changed = true;
    ["caption", "text"].forEach(function(key) { if (typeof out[key] === "string") out[key] = stripTelegramHtml(out[key]); });
  }
  if (Array.isArray(out.media)) {
    out.media = out.media.map(function(item) {
      if (!item || String(item.parse_mode || "").toUpperCase() !== "HTML") return item;
      changed = true;
      const copy = Object.assign({}, item);
      delete copy.parse_mode;
      if (typeof copy.caption === "string") copy.caption = stripTelegramHtml(copy.caption);
      return copy;
    });
  }
  return changed ? out : null;
}

// Retry only failures that cannot duplicate a post: read-only Bot API methods, or
// send requests where the connection demonstrably failed before any payload was sent.
// An ambiguous send MUST NOT be retried: Telegram may already have published it.
export function telegramTransportRetrySafe(method, error) {
  if (!error || error.telegramAmbiguous || error.telegramPermanent || error.telegramRateLimited) return false;
  const name = String(error.name || "");
  const causeCode = String(error.cause && error.cause.code || error.code || "");
  const detail = String(error.message || "");
  const transportFailure = /fetch failed|network|timeout|timed out|socket|connection|ECONN|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH/i.test(detail) ||
    /^(TimeoutError|AbortError|TypeError)$/.test(name) || Boolean(causeCode);
  if (!transportFailure) return false;
  const action = String(method || "");
  const sending = /^(send|copy|forward)/i.test(action);
  // Only get* Bot API methods are read-only. set/delete/pin/unpin may have side effects.
  return /^get/i.test(action) || (sending && !telegramErrorIsAmbiguous(error));
}

// Network failures with no posting risk are retried with bounded backoff.
// HTTP 429 retains its separate retry_after handling.
export async function telegramRequest(method, makeInit, timeoutMs) {
  const endpoint = "https://api.telegram.org/bot" + BOT_TOKEN + "/" + method;
  for (let attempt = 0; ; attempt += 1) {
    const init = makeInit();
    init.signal = AbortSignal.timeout(timeoutMs);
    let response;
    try {
      response = await fetch(endpoint, init);
    } catch (networkError) {
      // Only retry pre-send connection failures or safe read-only calls such as getChat.
      // A send that timed out after transmission might already be live: never repeat it.
      networkError.telegramAmbiguous = /^(send|copy|forward)/i.test(method) && telegramErrorIsAmbiguous(networkError);
      networkError.telegramMethod = method;
      networkError.telegramTransport = true;
      if (attempt < 2 && telegramTransportRetrySafe(method, networkError)) {
        console.warn("TELEGRAM_TRANSPORT_RETRY " + JSON.stringify({
          method: method, attempt: attempt + 1,
          code: String(networkError.cause && networkError.cause.code || networkError.code || ""),
          error: String(networkError.message || "").slice(0, 160)
        }));
        await sleepMs(500 * (attempt + 1));
        continue;
      }
      throw networkError;
    }
    const data = await response.json().catch(function(){ return null; });
    if (response.ok && data && data.ok) return data.result;
    const error = createTelegramError(method, response.status, data, "Telegram " + method + " HTTP " + response.status);
    if (error.telegramRateLimited && attempt === 0 && error.telegramRetryAfter > 0 && error.telegramRetryAfter <= TELEGRAM_RETRY_AFTER_MAX_SECONDS) {
      console.warn("TELEGRAM_RATE_LIMITED " + JSON.stringify({ method: method, retry_after: error.telegramRetryAfter }));
      await sleepMs(error.telegramRetryAfter * 1000 + 250);
      continue;
    }
    throw error;
  }
}

export async function telegramApi(method, payload) {
  if (!BOT_TOKEN) throw new Error("Telegram bot token is not configured");
  try {
    return await telegramRequest(method, function() {
      return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) };
    }, TELEGRAM_API_TIMEOUT_MS);
  } catch (error) {
    // Invalid markup (e.g. crossed tags) must not keep a post from going out: send it as plain text.
    const plain = error && error.telegramParseError ? telegramPlainPayload(payload) : null;
    if (!plain) throw error;
    console.warn("TELEGRAM_HTML_FALLBACK " + JSON.stringify({ method: method, error: error.telegramDescription }));
    return await telegramRequest(method, function() {
      return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(plain) };
    }, TELEGRAM_API_TIMEOUT_MS);
  }
}

export function sleepMs(ms) {
  return new Promise(function(resolve){ setTimeout(resolve, ms); });
}

