// Telegram caption length helpers.
//
// Telegram limits a caption to 1024 *visible* characters (after entity parsing):
// tags and link URLs do not count. The old code compared the HTML string length with
// 900, so any post above ~800 visible characters was sent to a second GPT rewrite
// (after the fact-check!) which could drop legal marks, hashtags and the signature.
//
// Everything here is pure: the HTML formatter lives in server.js and is passed in.

// Hard Telegram limit is 1024; keep a small margin for entity edge cases.
export const CAPTION_VISIBLE_LIMIT = 1000;
export const TELEGRAM_CAPTION_HARD_LIMIT = 1024;

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

// Length of the text Telegram actually shows for an HTML string (tags stripped,
// entities decoded; link URLs live in attributes and are not counted).
export function visibleLength(html) {
  const plain = String(html || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, function(m){ return ENTITIES[m]; });
  return Array.from(plain).length;
}

export function captionFits(html, limit) {
  return visibleLength(html) <= Number(limit || CAPTION_VISIBLE_LIMIT);
}

// ---------------------------------------------------------------------------
// Protected parts: legal marks, hashtags, signature, cross-promo line
// ---------------------------------------------------------------------------

const LEGAL_MARK_RE = /иноагент|экстремистск|террористическ|запрещ[её]н[а-яё]*\s+в\s+(?:РФ|России)|признан[а-яё]*\s+(?:иноагент|экстремист|террорист)/i;
const HASHTAG_RE = /(^|\s)#[\p{L}\p{N}_]+/u;

function isHashtagLine(line) {
  const s = String(line || "").trim();
  if (!s) return false;
  return s.split(/\s+/).every(function(tok){ return /^#[\p{L}\p{N}_]+$/u.test(tok) || /^@[A-Za-z0-9_]{3,}$/.test(tok); }) && HASHTAG_RE.test(" " + s);
}
function isSignatureLine(line) {
  return /^@[A-Za-z0-9_]{3,}$/.test(String(line || "").trim());
}
function isCrosspromoLine(line) {
  return /^👉\s/.test(String(line || "").trim());
}
function isTailLine(line) {
  return isHashtagLine(line) || isSignatureLine(line) || isCrosspromoLine(line);
}

// Splits post text into { body, tail }: the tail is the trailing block of lines that are
// cross-promo / hashtags / signature. They must survive any shortening.
export function splitTail(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  let end = lines.length;
  while (end > 0 && (isTailLine(lines[end - 1]) || !lines[end - 1].trim())) end -= 1;
  // keep only the lines that really are tail lines (drop blank separators between them)
  const tailLines = lines.slice(end).filter(function(l){ return l.trim(); });
  return { body: lines.slice(0, end).join("\n").trim(), tail: tailLines.join("\n") };
}

export function protectedParts(text) {
  const src = String(text || "");
  const parts = { legal: [], hashtags: [], signature: [] };
  for (const sentence of splitSentences(src)) if (LEGAL_MARK_RE.test(sentence)) parts.legal.push(sentence.trim());
  for (const m of src.matchAll(/#[\p{L}\p{N}_]+/gu)) parts.hashtags.push(m[0].toLowerCase());
  for (const line of src.split("\n")) if (isSignatureLine(line)) parts.signature.push(line.trim());
  return parts;
}

// Which protected parts of `original` are missing from `candidate`.
export function missingProtected(original, candidate) {
  const o = protectedParts(original);
  const c = String(candidate || "");
  const lower = c.toLowerCase();
  const missing = [];
  for (const tag of new Set(o.hashtags)) if (!lower.includes(tag)) missing.push(tag);
  for (const sig of new Set(o.signature)) if (!c.includes(sig)) missing.push(sig);
  for (const sentence of o.legal) {
    const mark = sentence.match(/\([^)]*(?:иноагент|экстремист|террорист|запрещ)[^)]*\)/i);
    const needle = (mark ? mark[0] : sentence).toLowerCase().replace(/\s+/g, " ");
    if (!lower.replace(/\s+/g, " ").includes(needle)) missing.push(needle.slice(0, 80));
  }
  return missing;
}

function splitSentences(text) {
  return String(text || "").split(/(?<=[.!?…])\s+|\n+/).filter(function(s){ return s.trim(); });
}

// ---------------------------------------------------------------------------
// Deterministic trimming: cut the body, never the tail
// ---------------------------------------------------------------------------

const SEP_RANK = { "": 0, " ": 1, "\n": 2, "\n\n": 3 };

function bodyUnits(body) {
  const units = [];
  const paragraphs = String(body || "").split(/\n{2,}/);
  paragraphs.forEach(function(par, pi) {
    par.split("\n").forEach(function(line, li) {
      const sentences = line.split(/(?<=[.!?…])\s+/).filter(function(s){ return s.trim(); });
      sentences.forEach(function(sentence, si) {
        const sep = !units.length ? "" : (si > 0 ? " " : (li > 0 ? "\n" : "\n\n"));
        units.push({ text: sentence.trim(), sep: pi === 0 && li === 0 && si === 0 ? "" : sep });
      });
    });
  });
  return units;
}

function joinUnits(units) {
  return units.map(function(u, i){ return (i ? u.sep : "") + u.text; }).join("");
}

function balanceMarkup(text) {
  let out = String(text || "");
  for (const mark of ["**", "__"]) {
    if ((out.split(mark).length - 1) % 2 === 1) {
      const i = out.lastIndexOf(mark);
      out = out.slice(0, i) + out.slice(i + mark.length);
    }
  }
  return out;
}

function assemble(body, tail) {
  return [balanceMarkup(body).trim(), tail].filter(Boolean).join("\n\n");
}

// Shortens post.text until the formatted caption fits in `limit` visible characters.
// Whole sentences are dropped from the end of the body (sentences that carry a legal mark
// are kept); hashtags, cross-promo line and signature are never touched. As a last resort
// the longest unprotected sentence is cut with an ellipsis.
// format(post) must return the Telegram HTML for the post.
export function trimPostPreservingTail(post, limit, format) {
  const max = Number(limit || CAPTION_VISIBLE_LIMIT);
  const out = Object.assign({}, post);
  const fits = function(text) { return visibleLength(format(Object.assign({}, out, { text: text }))) <= max; };
  const original = String(out.text || "").trim();
  if (fits(original)) return out;

  const { body, tail } = splitTail(original);
  let units = bodyUnits(body);
  const isProtected = function(u) { return LEGAL_MARK_RE.test(u.text); };

  // 1) drop unprotected sentences from the end, keeping the lead (first unit)
  let guard = 0;
  while (!fits(assemble(joinUnits(units), tail)) && guard++ < 500) {
    let idx = -1;
    for (let i = units.length - 1; i >= 1; i -= 1) if (!isProtected(units[i])) { idx = i; break; }
    if (idx < 0) break;
    const removed = units[idx];
    units.splice(idx, 1);
    const next = units[idx];
    if (next && SEP_RANK[removed.sep] > SEP_RANK[next.sep]) next.sep = removed.sep;
  }

  // 2) still too long: shorten the lead unit (or the longest unprotected one) with an ellipsis
  guard = 0;
  while (!fits(assemble(joinUnits(units), tail)) && guard++ < 200) {
    let idx = -1, longest = 0;
    units.forEach(function(u, i){ if (!isProtected(u) && u.text.length > longest) { longest = u.text.length; idx = i; } });
    if (idx < 0 || longest <= 40) break;
    const over = visibleLength(format(Object.assign({}, out, { text: assemble(joinUnits(units), tail) }))) - max;
    const keep = Math.max(30, longest - over - 5);
    let cut = units[idx].text.slice(0, keep).trim();
    const sp = cut.lastIndexOf(" ");
    if (sp > keep * 0.6) cut = cut.slice(0, sp);
    units[idx].text = cut.replace(/[\s,;:–—-]+$/g, "") + "…";
  }

  out.text = assemble(joinUnits(units), tail);
  return out;
}
