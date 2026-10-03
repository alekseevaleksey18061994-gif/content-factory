// Offline harness for scripts/dedupe-test.js.
// Loads a transformed copy of server.js (collector scheduler disabled, internals exported as __t)
// against a temp DATA_DIR with a fake clock, a fake fetch (OpenAI / Anthropic / source sites) and,
// optionally, a throw-away local PostgreSQL. Nothing touches the network or production data.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));

export const CH = [
  ["ai-main", "ai", "Что там у ИИ?"], ["chtotamtachki", "auto", "Что там у тачек?"], ["chtotamdengi", "money", "Что там у денег?"],
  ["chtotamtech", "tech", "Что там у технологий?"], ["chtotamgames", "games", "Что там у игр?"], ["chtotamkino", "kino", "Что там у кино?"],
  ["chtotamscience", "science", "Что там у науки?"], ["chtotamsport", "sport", "Что там у спорта?"], ["chtotamworld", "world", "Что там в мире?"],
  ["chtotamstars", "stars", "Что там у звёзд?"], ["chtotamtravel", "travel", "Что там в путешествиях?"], ["chtotampokupki", "shopping", "Что там у покупок?"],
  ["chtotamhome", "home", "Что там для дома?"], ["chtotamfood", "food", "Что там с едой?"], ["chtotambusiness", "business", "Что там у бизнеса?"],
  ["chtotamcrypto", "crypto", "Что там у крипты?"]
];

const RealDate = Date;
export const clock = { fixed: null };
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(FakeDate.now()); else super(...a); }
  static now() { return clock.fixed != null ? clock.fixed : RealDate.now(); }
}
export function setNow(iso) { clock.fixed = new RealDate(iso).getTime(); }
export function advance(ms) { clock.fixed = (clock.fixed != null ? clock.fixed : RealDate.now()) + ms; }

export const net = { log: [], llm: {}, pages: new Map() };

function jsonResp(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

net.llm.writer = function (req) {
  const s = req.sources[0];
  return { status: "ok", channel_id: req.channel_id, importance: 8, format: "Цифра", hook_type: "Цифра", ending_type: "что дальше", title_emoji: "📰",
    title: "📰 " + s.title, tg_text: "Пост по теме: " + String(s.text).slice(0, 200) + "\n\n" + req.signature, vk_text: "Пост: " + String(s.text).slice(0, 200), cover: null, entities: [] };
};
net.llm.checker = function () { return { verdict: "pass", errors: [], checked_claims: 3, summary: "ok" }; };
net.llm.relation = function () { return { relation: "new_story", new_fact: "", reason: "mock" }; };
net.llm.prefilter = function (items) { return { items: items.map((x) => ({ n: x.n, keep: true, score: 7, reason: "" })) }; };

async function fakeFetch(url, init) {
  url = String(url && url.url ? url.url : url);
  const body = init && init.body ? (() => { try { return JSON.parse(init.body); } catch { return null; } })() : null;
  net.log.push({ url, role: body && body.instructions ? (JSON.parse(body.input).role) : undefined });
  if (url.startsWith("https://api.openai.com/v1/responses")) {
    if (body.instructions) {
      const inp = JSON.parse(body.input);
      if (inp.role === "writer") {
        try { const out = await net.llm.writer(inp); return jsonResp({ output_text: JSON.stringify(out), usage: {} }); }
        catch (e) { return jsonResp({ error: { message: String(e && e.message || e) } }, 429); }
      }
      if (inp.role === "checker") { const out = await net.llm.checker(inp, "openai"); return jsonResp({ output_text: JSON.stringify(out), usage: {} }); }
    }
    const input = String(body.input || "");
    if (input.startsWith("Сравни новую новость")) {
      const n = JSON.parse(input.split("NEW: ")[1].split("\nPUBLISHED: ")[0]);
      const p = JSON.parse(input.split("PUBLISHED: ")[1]);
      net.log.push({ url, role: "relation", published: p.title });
      const out = await net.llm.relation(n, p);
      return jsonResp({ output_text: JSON.stringify(out), usage: {} });
    }
    if (input.includes("ITEMS: ") && input.includes("Для каждой ссылки реши")) {
      const items = JSON.parse(input.split("ITEMS: ")[1]);
      return jsonResp({ output_text: JSON.stringify(await net.llm.prefilter(items)), usage: {} });
    }
    return jsonResp({ output_text: "{}", usage: {} });
  }
  if (url.startsWith("https://api.anthropic.com/v1/messages")) {
    const inp = JSON.parse(body.messages[0].content);
    const out = await net.llm.checker(inp, "anthropic");
    return jsonResp({ content: [{ type: "text", text: JSON.stringify(out) }], usage: {}, stop_reason: "end_turn" });
  }
  if (net.pages.has(url)) {
    const p = net.pages.get(url);
    const v = typeof p === "function" ? p() : p;
    if (v instanceof Response) return v;
    return new Response(v, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }
  return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
}

export function articleHtml({ title, date, body, image }) {
  return `<html><head><title>${title}</title><meta property="og:title" content="${title}">` +
    (date ? `<meta property="article:published_time" content="${date}">` : "") +
    (image ? `<meta property="og:image" content="${image}">` : "") +
    `</head><body><article><h1>${title}</h1><p>${body}</p></article></body></html>`;
}
export function listHtml(links) {
  return "<html><body>" + links.map((l) => `<a href="${l.href}">${l.text}</a>`).join("\n") + "</body></html>";
}
export const LONG = " Подробности события: представители ведомства подтвердили решение, детали будут опубликованы в ближайшие дни, эксперты отмечают значимость новости для рынка и участников отрасли. ".repeat(3);

const EXPORT_NAMES = [
  "db", "state", "workspaceStore", "workspaceContext", "getWorkspaceById", "currentWorkspaceId", "collectOnce", "classifyPublishedStoryRelationship",
  "tryMergeStoryQueueItem", "storySimilarity", "findStoryClusterCandidate", "runEditorialV2", "editorialNetworkRecent", "pruneQueueItems",
  "dynamicBestQueueItem", "dynamicBestQueueItemRaw", "dynamicAssignBest", "publishDynamicSlot", "autoResolveQueue", "autoRejectReason", "dedupeQueueOnce",
  "saveState", "normalizeDate", "extractPublishedAt", "saveNewsItem", "seenOriginalUrl", "dynamicItemAgeMs", "dynamicSchedulerTick",
  "ensureScheduleShape", "moscowDateKey", "dynamicItemMaxAgeMs", "articleMaxAgeMs", "bumpSkipAttempt",
  "normalizeArticleUrl", "itemArticleKeys", "crossChannelIndex", "editorialRecentPosts", "crossChannelConflict", "channelFreshnessHours", "isApprovedQueueItem", "queueMaxAgeHoursFor", "dbReadyFlag",
  "recoverMissingWorkspaces", "persistWorkspaceStore", "pendingAutoTargets", "acquirePublishLock", "currentWorkspace", "dynamicUsedQueueIds", "enforceCopyrightSafeMedia", "server",
  "runOffsiteBackup", "workspaceWatchdogTick", "readBackupStatus", "buildBackupPayload",
  "providerBreaker", "llmResponsesFetch", "generateNewsCover", "maybeBillingAlert", "editorialPipeline", "recordOpenAIResponseUsage", "publishVkPost", "logPostmypostStatus", "workspaceVkPublishingAllowed", "refreshPostmypostMap", "sendMultiPlatformPost",
  "saveStateSnapshot", "vkPostIdForDb", "pgJsonString", "catchUpCurrentRegularSlotAllWorkspaces", "replenishSources", "renderEconomyTextCard", "sendTelegramPost", "telegramErrorIsAmbiguous", "applyChannelNotes", "flushWorkspaceStoreNow", "storeFlushStats", "bloggerSlotsFor", "bloggerTargetFor", "bloggerLaneActive", "channelExtraLane"
];

function bin(name) {
  const dirs = [];
  try { for (const v of fs.readdirSync("/usr/lib/postgresql")) dirs.push(path.join("/usr/lib/postgresql", v, "bin")); } catch {}
  for (const d of dirs.sort().reverse()) if (fs.existsSync(path.join(d, name))) return path.join(d, name);
  return "";
}

// Starts a throw-away PostgreSQL (TEST_DATABASE_URL wins). Returns { url, stop } or null when unavailable.
export function startTempPostgres() {
  if (process.env.TEST_DATABASE_URL) return { url: process.env.TEST_DATABASE_URL, stop() {} };
  const initdb = bin("initdb"), pgctl = bin("pg_ctl");
  if (!initdb || !pgctl) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-dedupe-pg-"));
  const port = 56000 + Math.floor(Math.random() * 3000);
  const root = typeof process.getuid === "function" && process.getuid() === 0;
  const run = (cmd, args) => root
    ? execFileSync("su", ["postgres", "-s", "/bin/bash", "-c", [cmd].concat(args).map((x) => "'" + String(x).replace(/'/g, "'\\''") + "'").join(" ")], { stdio: "pipe" })
    : execFileSync(cmd, args, { stdio: "pipe" });
  try {
    if (root) execFileSync("chown", ["postgres", dir]);
    run(initdb, ["-D", dir + "/data", "-A", "trust", "-U", "postgres"]);
    run(pgctl, ["-D", dir + "/data", "-o", `-p ${port} -c listen_addresses=127.0.0.1 -k ${dir}`, "-l", dir + "/log", "-w", "start"]);
  } catch (error) {
    console.warn("temp PostgreSQL unavailable: " + String(error.message).split("\n")[0]);
    return null;
  }
  return {
    url: `postgres://postgres@127.0.0.1:${port}/postgres`,
    stop() { try { run(pgctl, ["-D", dir + "/data", "-m", "immediate", "stop"]); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
  };
}

export async function loadServer(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-dedupe-"));
  const appDir = path.join(dir, "app");
  fs.mkdirSync(appDir);
  for (const name of ["lib", "prompts", "public", "migrations", "node_modules", "package.json"]) {
    const src = path.join(APP_DIR, name);
    if (fs.existsSync(src)) fs.symlinkSync(src, path.join(appDir, name));
  }
  // NF_SERVER_SRC lets a test run against another copy of server.js (e.g. the pre-fix version) to prove it fails there.
  let src = fs.readFileSync(process.env.NF_SERVER_SRC || path.join(APP_DIR, "server.js"), "utf8");
  // Third-party fetches go through safeFetch (real sockets); the harness serves them from the fake fetch instead.
  const SAFE_IMPORT = 'import { safeFetch, validateUrl as validateFetchUrl, parseProxyUrl } from "./lib/safe-fetch.js";';
  const OLD_SAFE_IMPORT = 'import { safeFetch, validateUrl as validateFetchUrl } from "./lib/safe-fetch.js";';
  if (src.includes(SAFE_IMPORT)) src = src.replace(SAFE_IMPORT, 'import { validateUrl as validateFetchUrl, parseProxyUrl } from "./lib/safe-fetch.js";\nconst safeFetch = (u, o) => globalThis.fetch(u, o);');
  else if (src.includes(OLD_SAFE_IMPORT)) src = src.replace(OLD_SAFE_IMPORT, 'import { validateUrl as validateFetchUrl } from "./lib/safe-fetch.js";\nconst safeFetch = (u, o) => globalThis.fetch(u, o);');
  else throw new Error("harness: safe-fetch import line changed in server.js");
  src = src.replace(/^startCollectorScheduler\(\);$/m, "/* startCollectorScheduler(); disabled in harness */");
  src += "\nexport const __t = (function(){ const o = {}; for (const n of " + JSON.stringify(EXPORT_NAMES) +
    ") { Object.defineProperty(o, n, { enumerable: true, get() { try { return n === 'dbReadyFlag' ? dbReady : eval(n); } catch { return undefined; } } }); } return o; })();\n";
  const file = path.join(appDir, "server.mjs");
  fs.writeFileSync(file, src);

  const channels = opts.channels || CH;
  const workspaces = channels.map(([id, channelId, name]) => ({
    id, name, slug: id, channelId, telegramChannel: "@" + id, telegramPublicUsername: id, initials: "NF",
    createdAt: new RealDate().toISOString(), updatedAt: new RealDate().toISOString(),
    state: Object.assign({ mode: "AUTO", sources: [], queue: [], history: [], migrations: ["v0.40.3-auto-publish"], topicSettings: { default: { auto_publish_telegram: true, auto_publish_vk: false } } }, (opts.state && opts.state[id]) || {})
  }));
  fs.writeFileSync(path.join(dir, "workspaces.json"), JSON.stringify({ version: 1, defaultWorkspaceId: workspaces[0].id, workspaces }));
  Object.assign(process.env, {
    PORT: "0", DATA_DIR: dir, DATABASE_URL: "", ADMIN_UI_PASSWORD: "x", COLLECTOR_ENABLED: "true", AUTO_PUBLISH_ENABLED: opts.autoPublish ? "true" : "false",
    TELEGRAM_BOT_TOKEN: "", OPENAI_API_KEY: "sk-test", ANTHROPIC_API_KEY: "ak-test", MEDIA_REQUIRED: "false", GENERATE_COVER_IF_MISSING: "false",
    IMAGE_ENHANCEMENT_ENABLED: "false", AUTO_ENHANCE_SOURCE_IMAGES: "false", HEADLINE_PREFILTER_ENABLED: "true", SOURCE_AUTO_PAUSE_ENABLED: "true",
    STATE_SAVE_DEBOUNCE_MS: "0" // tests read the files right after a save; the coalesced writer has its own test
  }, opts.env || {});
  if (opts.db) {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error("db requested but TEST_DATABASE_URL is not set");
    const pg = (await import(pathToFileURL(path.join(APP_DIR, "node_modules/pg/lib/index.js")).href)).default;
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    await c.query("drop schema public cascade; create schema public;");
    await c.end();
    process.env.DATABASE_URL = url;
    process.chdir(appDir);
  }
  if (opts.fixedNow) setNow(opts.fixedNow);
  globalThis.Date = FakeDate;
  globalThis.fetch = fakeFetch;
  const st = globalThis.setTimeout, si = globalThis.setInterval;
  globalThis.setTimeout = function (fn, ms, ...a) { if (ms >= 1000) return { unref() {}, ref() {} }; return st(fn, ms, ...a); };
  globalThis.setInterval = function () { return { unref() {}, ref() {} }; };
  const origLog = console.log, origWarn = console.warn;
  if (!opts.verbose) { console.log = function () {}; console.warn = function () {}; }
  const mod = await import(pathToFileURL(file).href);
  globalThis.setTimeout = function (fn, ms, ...a) { return ms >= 100000 ? { unref() {}, ref() {} } : st(fn, ms, ...a); };
  globalThis.setInterval = si;
  console.log = origLog; console.warn = origWarn;
  if (!opts.verbose) { console.log = function () {}; console.warn = function () {}; }
  return Object.assign({ dir, ws: (id) => mod.__t.workspaceStore.workspaces.find((w) => w.id === id), quiet(v) { if (v) { console.log = function () {}; console.warn = function () {}; } else { console.log = origLog; console.warn = origWarn; } }, restoreConsole() { console.log = origLog; console.warn = origWarn; } }, mod.__t);
}

export function inWs(t, id, fn) { return t.workspaceContext.run({ workspaceId: id }, fn); }

export function mkQueueItem(over) {
  const id = "q_" + Math.random().toString(36).slice(2, 8);
  return Object.assign({ id, newsId: "news_" + id, title: "Заголовок", text: "Текст поста", createdAt: new RealDate(FakeDate.now()).toISOString(), sourceId: "s1", sourceName: "S1",
    aiScore: 80, qualityScore: 90, qcStatus: "pass", editorialV2: { status: "approved", verdict: "pass", importance: 8 }, imageUrl: "https://x/i.jpg" }, over || {});
}

export async function dbRows(sql) {
  const pg = (await import(pathToFileURL(path.join(APP_DIR, "node_modules/pg/lib/index.js")).href)).default;
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await c.connect();
  try { return (await c.query(sql)).rows; } finally { await c.end(); }
}
