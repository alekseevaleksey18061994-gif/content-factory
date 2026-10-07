// Extracted from server.js (v0.62.0 module split). Behaviour is unchanged.
import path from "node:path";
import fs from "node:fs";
import { safeFetch } from "./safe-fetch.js";
import { assertSafeRaster, SAFE_INPUT_PIXELS } from "./image-guard.js";
import sharp from "sharp";
import { BOT_TOKEN, PUBLIC_BASE_URL } from "./env-config.js";
import { localMediaPathFromUrl } from "./article-extract.js";
import { isTelegramFatalError, telegramApi, telegramPlainPayload, telegramRequest } from "./telegram-errors.js";

export function isLocalMediaUrl(value) {
  const url = String(value || "").trim();
  return Boolean(url && PUBLIC_BASE_URL && url.startsWith(PUBLIC_BASE_URL + "/media/"));
}

export function assertTelegramPublishResult(message, target) {
  const chat = message && message.chat;
  if (!chat || chat.id == null) throw new Error("Telegram не вернул чат опубликованного сообщения");
  if (!target || target.chatId == null) throw new Error("Telegram target verification unavailable");
  if (String(chat.id) !== String(target.chatId)) {
    throw new Error("Telegram опубликовал сообщение не в тот канал");
  }
  if (chat.type !== "channel") {
    throw new Error("Telegram публикация ушла не в канал: " + String(chat.type || "unknown"));
  }
  const expected = String(target.username || "").toLowerCase();
  const actual = String(chat.username || "").replace(/^@/, "").toLowerCase();
  if (expected && actual && expected !== actual) {
    throw new Error("Telegram username не совпал после публикации");
  }
  return message;
}

export function telegramUploadMeta(rawUrl, fallbackKind) {
  const value = String(rawUrl || "").trim();
  let ext = fallbackKind === "video" ? "mp4" : "jpg";
  try {
    const u = new URL(value, PUBLIC_BASE_URL);
    const guessed = path.extname(u.pathname).replace(/^\./, "").toLowerCase();
    if (guessed) ext = guessed;
  } catch {}
  let mime = fallbackKind === "video" ? "video/mp4" : "image/jpeg";
  if (ext === "png") mime = "image/png";
  else if (ext === "webp") mime = "image/webp";
  else if (ext === "gif") mime = "image/gif";
  else if (ext === "webm") mime = "video/webm";
  else if (ext === "mov") mime = "video/quicktime";
  else if (ext === "m4v") mime = "video/x-m4v";
  return { ext: ext || (fallbackKind === "video" ? "mp4" : "jpg"), mime: mime };
}

export async function loadTelegramUpload(rawUrl, kind) {
  const sourceUrl = String(rawUrl || "").trim();
  if (!sourceUrl) throw new Error("Telegram media URL is empty");
  const meta = telegramUploadMeta(sourceUrl, kind);
  const localPath = localMediaPathFromUrl(sourceUrl);
  let bytes;
  let mime = meta.mime;
  let ext = meta.ext;

  if (localPath) {
    bytes = fs.readFileSync(localPath);
  } else {
    const absolute = sourceUrl.startsWith("/") ? PUBLIC_BASE_URL + sourceUrl : sourceUrl;
    const response = await safeFetch(absolute, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; NewsFactoryTelegram/1.0)",
        "accept": kind === "video" ? "video/*,*/*;q=0.8" : "image/webp,image/jpeg,image/png,image/gif,image/*;q=0.5"
      },
      timeoutMs: 30000,
      maxBytes: kind === "video" ? 50 * 1024 * 1024 : 20 * 1024 * 1024
    });
    if (!response.ok) throw new Error("Telegram media download HTTP " + response.status);
    mime = String(response.headers.get("content-type") || mime).split(";")[0].trim() || mime;
    bytes = response.body;
    if (kind !== "video" && bytes.length) await assertSafeRaster(bytes); // no SVG / non-raster payloads
  }

  if (!bytes || !bytes.length) throw new Error("Telegram media is empty");
  if (kind === "video") {
    if (bytes.length > 49 * 1024 * 1024) throw new Error("Видео больше лимита Telegram Bot API");
  } else {
    if (bytes.length > 9 * 1024 * 1024 || !/^image\/(jpeg|png|webp|gif)$/i.test(mime)) {
      bytes = await sharp(bytes, { limitInputPixels: SAFE_INPUT_PIXELS })
        .rotate()
        .resize(1800, 1800, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer();
      mime = "image/jpeg";
      ext = "jpg";
    }
  }
  return { bytes: bytes, mime: mime, ext: ext };
}

export async function telegramMultipartApi(method, payload, fieldName, mediaUrl, kind) {
  if (!BOT_TOKEN) throw new Error("Telegram bot token is not configured");
  const media = await loadTelegramUpload(mediaUrl, kind);
  const upload = async function(fields) {
    return telegramRequest(method, function() {
      const form = new FormData();
      Object.entries(fields || {}).forEach(function(entry) {
        const key = entry[0], value = entry[1];
        if (value === undefined || value === null || value === "") return;
        form.append(key, typeof value === "boolean" ? (value ? "true" : "false") : String(value));
      });
      form.append(fieldName, new Blob([media.bytes], { type: media.mime }), "news." + media.ext);
      return { method: "POST", body: form };
    }, kind === "video" ? 180000 : 90000); // a longer wait means fewer "no answer, maybe sent" outcomes
  };
  try {
    return await upload(payload);
  } catch (error) {
    const plain = error && error.telegramParseError ? telegramPlainPayload(payload) : null;
    if (!plain) throw error;
    console.warn("TELEGRAM_HTML_FALLBACK " + JSON.stringify({ method: method, error: error.telegramDescription }));
    return await upload(plain);
  }
}

export async function telegramMediaApi(method, payload, fieldName, mediaUrl, kind) {
  // Our own media: upload the file. With a URL, Telegram has to download it from our server abroad, which
  // regularly takes longer than our timeout — Telegram then posts anyway and the upload fallback posted a second copy.
  if (isLocalMediaUrl(mediaUrl) && localMediaPathFromUrl(mediaUrl)) return telegramMultipartApi(method, payload, fieldName, mediaUrl, kind);
  try {
    return await telegramApi(method, Object.assign({}, payload, { [fieldName]: mediaUrl }));
  } catch (urlError) {
    // The chat rejects us / rate limit: uploading the same file again cannot succeed (and would double the calls).
    if (isTelegramFatalError(urlError)) throw urlError;
    console.warn(method + " URL mode failed, retrying upload:", urlError.message);
    return telegramMultipartApi(method, payload, fieldName, mediaUrl, kind);
  }
}

