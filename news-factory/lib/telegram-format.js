// Extracted from server.js (v0.62.0 module split). Behaviour is unchanged.
import crypto from "node:crypto";
import { normalizePublicPostSources } from "./article-extract.js";

export function newId(prefix) {
  return (prefix || "item") + "_" + Date.now() + "_" + crypto.randomBytes(3).toString("hex");
}

export function escapeTelegramHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeTelegramAttr(value) {
  return escapeTelegramHtml(value).replace(/"/g, "&quot;");
}

export function formatTelegramInline(value) {
  const escaped = escapeTelegramHtml(value);
  const italic = function(part) { return part.replace(/__([^_\n]+)__/g, "<i>$1</i>"); };
  // Bold spans first; italics are applied inside and outside them separately, so
  // "**a __b** c__" can never produce crossed tags (<b>..<i>..</b>..</i>) that Telegram rejects.
  let out = "";
  let last = 0;
  const boldRe = /\*\*([^*\n]+)\*\*/g;
  let m;
  while ((m = boldRe.exec(escaped)) !== null) {
    out += italic(escaped.slice(last, m.index)) + "<b>" + italic(m[1]) + "</b>";
    last = m.index + m[0].length;
  }
  return out + italic(escaped.slice(last));
}

export function formatTelegramBody(value) {
  const lines = String(value || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let quote = [];
  function flushQuote() {
    if (!quote.length) return;
    out.push("<blockquote>" + quote.map(formatTelegramInline).join("\n") + "</blockquote>");
    quote = [];
  }
  for (const raw of lines) {
    const line = String(raw || "");
    if (/^>\s?/.test(line)) {
      quote.push(line.replace(/^>\s?/, ""));
      continue;
    }
    flushQuote();
    out.push(formatTelegramInline(line));
  }
  flushQuote();
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function formatTelegramPost(post) {
  const title = String(post.title || "").trim();
  const text = String(post.text || "").trim();
  const sources = normalizePublicPostSources(post).slice(0, 5);
  let html = "";
  if (title) html += "<b>" + escapeTelegramHtml(title) + "</b>";
  if (text) html += (html ? "\n\n" : "") + formatTelegramBody(text);
  if (sources.length === 1) {
    html += (html ? "\n\n" : "") + '🔗 <a href="' + escapeTelegramAttr(sources[0].url) + '">Источник</a>';
  } else if (sources.length > 1) {
    const links = sources.map(function(source, index) {
      const label = String(source.name || "").trim() && !/^https?:/i.test(String(source.name || ""))
        ? String(source.name).trim()
        : ("Источник " + (index + 1));
      return '<a href="' + escapeTelegramAttr(source.url) + '">' + escapeTelegramHtml(label) + '</a>';
    });
    html += (html ? "\n\n" : "") + "🔗 Источники: " + links.join(" · ");
  }
  return html.trim();
}

