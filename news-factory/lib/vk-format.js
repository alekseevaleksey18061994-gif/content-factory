// VK-specific post layout helpers (pure functions, no state).
// VK shows no bold/links markup, so the body is made readable with line breaks, and the Telegram "@handle"
// signature (not clickable in VK) becomes a real t.me link.

const HANDLE_RE = /(^|[^\w@/.])@([A-Za-z][A-Za-z0-9_]{3,31})\b/g;

export function sourceDomain(url) {
  try {
    const host = new URL(String(url || "")).hostname.replace(/^www\./i, "").replace(/^m\./i, "");
    return host || "";
  } catch { return ""; }
}

// "@handle" -> "t.me/handle" everywhere in the text.
export function handlesToTmeLinks(text) {
  return String(text || "").replace(HANDLE_RE, function(_m, pre, name) { return pre + "t.me/" + name; });
}

// Remove a trailing line that is only the channel's own signature ("@handle").
export function stripOwnSignatureLine(text, handle) {
  const h = String(handle || "").replace(/^@/, "").toLowerCase();
  if (!h) return String(text || "");
  const lines = String(text || "").split("\n");
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length && lines[lines.length - 1].trim().replace(/^@/, "").toLowerCase() === h) lines.pop();
  return lines.join("\n").replace(/\s+$/, "");
}

function splitSentences(paragraph) {
  const parts = paragraph.match(/[^.!?…]+[.!?…]+(?:["»)]+)?\s*|[^.!?…]+$/g);
  return parts ? parts.map(function(s) { return s.trim(); }).filter(Boolean) : [paragraph];
}

// A paragraph longer than `max` chars without line breaks is split into groups of at most 2 sentences.
export function breakWallOfText(text, max) {
  const limit = Math.max(120, Number(max) || 260);
  return String(text || "").split(/\n{2,}/).map(function(par) {
    if (par.includes("\n") || par.length <= limit) return par;
    const sentences = splitSentences(par);
    if (sentences.length < 3) return par;
    const groups = [];
    for (let i = 0; i < sentences.length; i += 2) groups.push(sentences.slice(i, i + 2).join(" "));
    return groups.join("\n\n");
  }).join("\n\n");
}

export function adaptVkBody(text, options) {
  const opts = options || {};
  let out = String(text || "").trim();
  out = stripOwnSignatureLine(out, opts.handle);
  out = breakWallOfText(out, opts.maxParagraph);
  out = handlesToTmeLinks(out);
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

export function vkTail(options) {
  const opts = options || {};
  const lines = [];
  const h = String(opts.handle || "").replace(/^@/, "");
  if (h) lines.push("Мы в Telegram: t.me/" + h);
  const sources = Array.isArray(opts.sources) ? opts.sources : [];
  const domains = [];
  for (const s of sources) {
    const d = sourceDomain(s && s.url);
    if (d && !domains.includes(d)) domains.push(d);
  }
  if (domains.length === 1) lines.push("Источник: " + domains[0]);
  else if (domains.length > 1) lines.push("Источники: " + domains.slice(0, 3).join(", "));
  return lines.join("\n");
}
