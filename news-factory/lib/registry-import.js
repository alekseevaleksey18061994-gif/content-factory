// Register of foreign agents (Ministry of Justice, RF): text extraction from the
// official PDF, name parsing and tolerant matching in news texts.

export async function extractPdfText(buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = buffer instanceof Uint8Array ? new Uint8Array(buffer) : new Uint8Array(Buffer.from(buffer));
  const doc = await pdfjs.getDocument({ data: data, isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Keep line structure: a new line when the item ends a text line.
    let line = "";
    const lines = [];
    for (const item of content.items) {
      line += item.str;
      if (item.hasEOL) { lines.push(line); line = ""; } else line += " ";
    }
    if (line.trim()) lines.push(line);
    pages.push(lines.join("\n"));
  }
  await doc.destroy();
  return pages.join("\n");
}

const PATRONYMIC = "(?:вич|вна|ична|чна|ич|оглы|кызы)";
const PERSON_RE = new RegExp("([А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?)\\s+([А-ЯЁ][а-яё]+)\\s+([А-ЯЁ][а-яё]+" + PATRONYMIC + ")(?![а-яё])", "g");
const QUOTED_RE = /[«"“]([^«»"“”\n]{2,90})[»"”]/g;
const ORG_NOISE = /^(?:ООО|АНО|АО|ЗАО|НКО|общество|фонд|автономная|некоммерческая|организация|региональная|межрегиональная|общественная)$/i;

// Persons: "Фамилия Имя Отчество" (patronymic required — keeps precision high).
// Organisations and projects: names in quotes.
export function extractRegistryNames(text) {
  const src = String(text || "").replace(/ /g, " ");
  const persons = new Set();
  const orgs = new Set();
  let m;
  PERSON_RE.lastIndex = 0;
  while ((m = PERSON_RE.exec(src))) persons.add(m[1] + " " + m[2] + " " + m[3]);
  QUOTED_RE.lastIndex = 0;
  while ((m = QUOTED_RE.exec(src))) {
    const name = m[1].replace(/\s+/g, " ").trim();
    if (name.length < 2 || ORG_NOISE.test(name) || /^\d+$/.test(name)) continue;
    orgs.add(name);
  }
  return { persons: Array.from(persons), orgs: Array.from(orgs) };
}

function stem(word) {
  const w = String(word || "").toLowerCase();
  if (w.length <= 4) return w;
  return w.slice(0, w.length - (w.length > 6 ? 2 : 1));
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// True when the registry entry is mentioned in the (lowercased) text.
// Persons match "Имя Фамилия", "Фамилия Имя" in any case form, or the full name;
// other entries match as a whole word / phrase.
export function registryNameMentioned(name, hayLower) {
  const n = String(name || "").trim();
  if (n.length < 3) return false;
  const hay = String(hayLower || "");
  const parts = n.split(/\s+/);
  const isPerson = parts.length === 3 && new RegExp(PATRONYMIC + "$", "i").test(parts[2]) && /^[А-ЯЁ]/.test(parts[0]);
  if (!isPerson) {
    const low = n.toLowerCase();
    if (!hay.includes(low)) return false;
    return new RegExp("(^|[^\\p{L}\\p{N}])" + escapeRe(low) + "($|[^\\p{L}\\p{N}])", "u").test(hay);
  }
  const surname = stem(parts[0]);
  const first = stem(parts[1]);
  if (!hay.includes(surname)) return false;
  const word = "[\\p{L}-]*";
  const a = new RegExp("(^|[^\\p{L}])" + escapeRe(first) + word + "\\s+" + escapeRe(surname) + word, "u");
  const b = new RegExp("(^|[^\\p{L}])" + escapeRe(surname) + word + "\\s+" + escapeRe(first) + word, "u");
  return a.test(hay) || b.test(hay);
}
