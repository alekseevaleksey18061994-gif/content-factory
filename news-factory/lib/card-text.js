// Text helpers for the locally rendered economy cover card (DejaVu Sans Bold).

// Keep only scripts the bundled DejaVu font can draw; everything else
// (emoji, CJK, Hangul, Thai, Devanagari, private use…) rendered as boxes.
const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;
const UNSUPPORTED_RE = /[^\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Common}\p{Script=Inherited}]/gu;
const CONTROL_RE = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\u{FFFD}]/gu;

export function cardSafeText(value) {
  return String(value == null ? "" : value)
    .replace(EMOJI_RE, "")
    .replace(UNSUPPORTED_RE, "")
    .replace(CONTROL_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

function chunkWord(word, maxChars) {
  const chars = Array.from(word);
  if (chars.length <= maxChars) return [word];
  const parts = [];
  for (let i = 0; i < chars.length; i += maxChars - 1) {
    const piece = chars.slice(i, i + maxChars - 1).join("");
    parts.push(i + maxChars - 1 < chars.length ? piece + "-" : piece);
  }
  return parts;
}

// Wrap into at most maxLines lines of at most maxChars characters.
// Long words are hyphen-split; text that does not fit ends with "…".
export function wrapCardLines(text, maxChars = 26, maxLines = 4) {
  const limit = Math.max(4, Number(maxChars) || 26);
  const linesMax = Math.max(1, Number(maxLines) || 4);
  const words = [];
  for (const w of String(text || "").split(/\s+/).filter(Boolean)) words.push(...chunkWord(w, limit));
  const lines = [];
  let line = "";
  let truncated = false;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const next = line ? line + " " + word : word;
    if (Array.from(next).length <= limit) { line = next; continue; }
    lines.push(line);
    line = word;
    if (lines.length >= linesMax) { truncated = true; line = ""; break; }
  }
  if (line) lines.push(line);
  if (lines.length > linesMax) { lines.length = linesMax; truncated = true; }
  if (truncated && lines.length) {
    let last = lines[lines.length - 1].replace(/[-\s.,:;]+$/u, "");
    while (Array.from(last + "…").length > limit) {
      const cut = last.lastIndexOf(" ");
      last = cut > 0 ? last.slice(0, cut) : Array.from(last).slice(0, limit - 1).join("");
    }
    lines[lines.length - 1] = last.replace(/[-\s.,:;]+$/u, "") + "…";
  }
  return lines;
}
