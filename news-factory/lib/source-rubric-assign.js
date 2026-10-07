// v0.67.0: enabled sources that belong to no theme group get attached to the theme(s) they fit (or stay as they are).
export const ASSIGN_BATCH = 40;
export const ASSIGN_MARKER = "v0.67.0-loose-assign";
export const ASSIGN_MIN_ANSWERED = 0.8; // an answer that covers fewer rows than this is treated as a failed call (retried later)
const oneLine = function(v, n){ return String(v == null ? "" : (typeof v === "object" ? "" : v)).replace(/\s+/g, " ").trim().slice(0, n); };

export function buildAssignPrompt(input) {
  const rubrics = (input.rubrics || []).map(function(r){ return r.id + " — " + r.label + (r.hint ? ": " + String(r.hint).slice(0, 140) : ""); }).join("\n");
  const items = (input.sources || []).map(function(s, i){ return (i + 1) + ". " + oneLine(s.name, 90) + " | " + oneLine(s.url, 120) + (s.group ? " | " + oneLine(s.group, 20) : ""); }).join("\n");
  return [
    "Ты редактор новостной сети Telegram-каналов. Канал: «" + String(input.channelName || "") + "» (" + String(input.topic || "") + ").",
    "У канала есть темы (рубрики). Для каждого источника ниже выбери от 1 до 2 тем, о которых этот источник обычно пишет. Если ни одна тема не подходит, верни пустой список — не подгоняй.",
    "Темы (id — название: описание):",
    rubrics,
    "",
    "Источники (номер. название | адрес | тип):",
    items,
    "",
    "Ответь строго JSON-объектом: {\"items\":[{\"n\":1,\"rubrics\":[\"id\"]}, ...]} — по одной записи на каждый номер. В rubrics только id из списка тем."
  ].join("\n");
}

// Returns Map(n -> rubric ids) with only valid ids (max 2) or null when the answer cannot be read at all.
export function parseAssignResult(text, count, validIds) {
  let data;
  try {
    const raw = String(text || "");
    const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
    data = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw);
  } catch { return null; }
  const list = data && Array.isArray(data.items) ? data.items : null;
  if (!list) return null;
  const valid = validIds instanceof Set ? validIds : new Set(validIds || []);
  const out = new Map();
  for (const it of list) {
    const n = Number(it && it.n);
    if (!Number.isInteger(n) || n < 1 || n > count || out.has(n)) continue;
    const ids = [];
    for (const id of (Array.isArray(it.rubrics) ? it.rubrics : [])) {
      const s = String(id || "");
      if (valid.has(s) && !ids.includes(s)) ids.push(s);
    }
    out.set(n, ids.slice(0, 2));
  }
  return out;
}

// Tags a source in place; returns true when something changed.
export function tagSource(source, ids, nowIso) {
  if (!source || !ids.length) return false;
  const two = ids.slice(0, 2);
  source.rubric = two[0];
  source.rubrics = two;
  source.rubricAssignedAt = nowIso;
  return true;
}
