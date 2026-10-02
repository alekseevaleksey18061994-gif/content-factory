// Registry of organisations/persons that Russian law requires to be marked
// (banned organisations, foreign agents) and the matcher that decides which entries are
// relevant for a given set of source texts.
//
// The old matcher was a lower-case substring test of the nominative name, so
// «Meta Platforms» was not found in «компания Meta», and «Павла Лобкова» was not found
// for «Лобков Павел». This matcher normalises case/ё, compares whole words, applies a
// light Russian stemmer to names of 5+ letters and knows aliases of the same entity.

// Minimal built-in list. It is merged with whatever the administrator stored via
// /api/editorial/registry. It is NOT exhaustive and is NOT updated from official registers.
// Each entry: canonical name (shown to the model) + extra spellings.
export const BUILTIN_BANNED_ORGS = [
  { name: "Meta Platforms", aliases: ["Meta", "Meta Platforms", "Facebook", "Instagram", "Фейсбук", "Инстаграм", "Мета Платформс"] },
  { name: "Международное общественное движение ЛГБТ", aliases: ["ЛГБТ-движение", "движение ЛГБТ", "ЛГБТ"] },
  { name: "Исламское государство (ИГИЛ)", aliases: ["ИГИЛ", "Исламское государство", "Islamic State"] },
  { name: "Аль-Каида", aliases: ["Аль-Каида", "Al-Qaeda", "Al Qaeda"] },
  { name: "Свидетели Иеговы", aliases: ["Свидетели Иеговы"] },
  { name: "Правый сектор", aliases: ["Правый сектор"] },
  { name: "Фонд борьбы с коррупцией (ФБК)", aliases: ["ФБК", "Фонд борьбы с коррупцией"] }
];

// Names of one entity that must trigger each other: banning Instagram means a Meta mention
// needs a mark too (the law marks the company and its networks the same way).
const ALIAS_GROUPS = [
  ["meta platforms", "meta", "facebook", "instagram", "фейсбук", "инстаграм", "мета платформс"]
];

export function builtinBannedNames() {
  return BUILTIN_BANNED_ORGS.map(function(x){ return x.name; });
}

export function normalizeWords(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

const ENDINGS = ["ыми", "ими", "ого", "его", "ому", "ему", "ами", "ями", "ах", "ях", "ов", "ев", "ей", "ой", "ий", "ый", "ая", "яя", "ое", "ее", "ые", "ие", "ую", "юю", "ым", "им", "ом", "ем", "ам", "ям", "а", "я", "у", "ю", "ы", "и", "е", "о", "ь", "й"];

// Light stemmer for Cyrillic words: strips up to two case endings, keeps at least 4 letters
// («Лобкова» and «Лобков» both give «лобк»).
export function stemRu(word) {
  let w = String(word || "");
  if (!/[а-я]/.test(w)) return w;
  for (let pass = 0; pass < 2; pass += 1) {
    const end = ENDINGS.find(function(e){ return w.length - e.length >= 4 && w.endsWith(e); });
    if (!end) break;
    w = w.slice(0, w.length - end.length);
  }
  return w;
}

function tokenKey(word) {
  return /[а-я]/.test(word) && word.length >= 5 ? stemRu(word) : word;
}

// Two keys are the same word: equal, or (Cyrillic, 4+ letters) differing only in the last
// letter or a dropped vowel: «павл» ~ «павел».
function sameKey(a, b) {
  if (a === b) return true;
  if (!/[а-я]/.test(a) || !/[а-я]/.test(b) || a.length < 4 || b.length < 4) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i >= Math.max(3, Math.min(a.length, b.length) - 1) && Math.abs(a.length - b.length) <= 1;
}

function buildIndex(words) {
  const keys = words.map(tokenKey);
  const byPrefix = new Map();
  keys.forEach(function(k, pos) {
    const p = k.slice(0, 3);
    if (!byPrefix.has(p)) byPrefix.set(p, []);
    byPrefix.get(p).push(pos);
  });
  return { keys: keys, byPrefix: byPrefix };
}

// Positions in the haystack where `key` occurs.
function positionsOf(index, key) {
  const list = index.byPrefix.get(key.slice(0, 3)) || [];
  return list.filter(function(pos){ return sameKey(key, index.keys[pos]); });
}

// words: normalized words of one name variant. Single word: whole-word (stem) match.
// Several words: all of them within a short window in any order; names of 3+ words
// (full name + patronymic) also match on any two adjacent distinct words.
function variantMatches(words, index) {
  const keys = words.map(tokenKey);
  if (!keys.length) return false;
  const pos = keys.map(function(k){ return positionsOf(index, k); });
  if (keys.length === 1) return pos[0].length > 0;
  if (pos.every(function(list){ return list.length > 0; })) {
    const window = Math.max(keys.length + 3, 6);
    for (const start of pos[0]) {
      const ok = pos.every(function(list){ return list.some(function(q){ return Math.abs(q - start) < window; }); });
      if (ok) return true;
    }
  }
  if (keys.length >= 3) {
    const at = new Map();
    pos.forEach(function(list, ki){ list.forEach(function(q){ if (!at.has(q)) at.set(q, []); at.get(q).push(ki); }); });
    for (const [q, kis] of at) {
      const next = at.get(q + 1);
      if (next && kis.some(function(i){ return next.some(function(j){ return i !== j; }); })) return true;
    }
  }
  return false;
}

function variantsFor(name, aliasesByName) {
  const words = normalizeWords(name);
  const joined = words.join(" ");
  const variants = [words];
  for (const group of ALIAS_GROUPS) {
    if (group.includes(joined)) for (const alias of group) variants.push(normalizeWords(alias));
  }
  for (const alias of (aliasesByName && aliasesByName.get(joined)) || []) variants.push(normalizeWords(alias));
  // Parenthesised abbreviation, e.g. «Исламское государство (ИГИЛ)»: also match the part
  // without the brackets and the abbreviation itself.
  const m = String(name || "").match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (m) { variants.push(normalizeWords(m[1])); variants.push(normalizeWords(m[2])); }
  return variants.filter(function(v){ return v.length && v.join("").length >= 3; });
}

function builtinAliasMap() {
  const map = new Map();
  for (const item of BUILTIN_BANNED_ORGS) map.set(normalizeWords(item.name).join(" "), item.aliases);
  return map;
}

function nameMatchesIndex(name, index, aliasesByName) {
  if (!index.keys.length) return false;
  return variantsFor(name, aliasesByName).some(function(words) { return variantMatches(words, index); });
}

export function nameMatchesText(name, text, aliasesByName) {
  return nameMatchesIndex(name, buildIndex(normalizeWords(text)), aliasesByName);
}

// registry: { banned_orgs: [...], foreign_agents: [...] } (administrator's lists).
// Returns only the entries found in sourceText; built-in banned organisations are always checked.
export function matchRegistry(registry, sourceText) {
  const reg = registry || {};
  const aliases = builtinAliasMap();
  const index = buildIndex(normalizeWords(sourceText));
  const banned = [];
  for (const name of builtinBannedNames().concat(Array.isArray(reg.banned_orgs) ? reg.banned_orgs : [])) {
    const n = String(name || "").trim();
    if (!n || banned.some(function(x){ return normalizeWords(x).join(" ") === normalizeWords(n).join(" "); })) continue;
    if (nameMatchesIndex(n, index, aliases)) banned.push(n);
  }
  const agents = [];
  for (const name of (Array.isArray(reg.foreign_agents) ? reg.foreign_agents : [])) {
    const n = String(name || "").trim();
    if (n && !agents.includes(n) && nameMatchesIndex(n, index, aliases)) agents.push(n);
  }
  return { banned_orgs: banned, foreign_agents: agents };
}
