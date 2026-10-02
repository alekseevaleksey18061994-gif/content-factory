// Offline regression tests for the prompt-vs-code audit fixes (npm run test:prompts-code).
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parsePromptFile, buildSystemPrompt, createEditorialPipeline, createModelClients,
  resolveChannelId, timeSlotFor, moscowIso, CHANNEL_IDS
} from "../lib/editorial-v2.js";
import { visibleLength, trimPostPreservingTail, missingProtected, splitTail, CAPTION_VISIBLE_LIMIT } from "../lib/telegram-caption.js";
import { matchRegistry, builtinBannedNames } from "../lib/editorial-registry.js";

const PROMPT_FILE = fileURLToPath(new URL("../prompts/chto-tam.md", import.meta.url));
const SERVER_FILE = fileURLToPath(new URL("../server.js", import.meta.url));
const promptText = fs.readFileSync(PROMPT_FILE, "utf8");
const parsed = parsePromptFile(promptText);
const serverSrc = fs.readFileSync(SERVER_FILE, "utf8");

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log("ok  - " + name); }
  catch (error) { console.error("FAIL - " + name); throw error; }
}

// Real formatter from server.js (the module starts a server on import, so extract the functions).
function grab(name) {
  const i = serverSrc.indexOf("function " + name + "(");
  assert.ok(i >= 0, "server.js has " + name);
  let j = serverSrc.indexOf("{", i), depth = 0;
  for (; j < serverSrc.length; j += 1) {
    if (serverSrc[j] === "{") depth += 1;
    else if (serverSrc[j] === "}") { depth -= 1; if (!depth) { j += 1; break; } }
  }
  return serverSrc.slice(i, j);
}
const { formatTelegramPost } = new Function(
  ["escapeTelegramHtml", "escapeTelegramAttr", "formatTelegramInline", "formatTelegramBody", "normalizePublicPostSources", "formatTelegramPost"].map(grab).join("\n") +
  "\nreturn { formatTelegramPost };")();

const URL_LONG = "https://motor.ru/news/2026/10/02/hongqi-h5-new-price-and-specs-for-russian-market-and-more-words/";
const TITLE = "🚘 Hongqi H5 подорожал на 200 000 ₽ — теперь 4 480 000 ₽";
const TAIL = "#новинки #авторынок #китайцы\n@chtotamtachki";
function bigBody(sentences) {
  const parts = [];
  for (let i = 0; i < sentences; i += 1) parts.push("Предложение номер " + (i + 1) + " рассказывает о новом **Hongqi H5**: мотор 2.0T, 224 л.с., разгон за 7,1 с.");
  return parts.join(" ") + "\n\n" + TAIL;
}

// --- P1 ---------------------------------------------------------------------
await test("P1: caption limit counts visible characters, not HTML length", function() {
  const post = { title: TITLE, text: bigBody(7), sources: [{ name: "Источник", url: URL_LONG }] };
  const html = formatTelegramPost(post);
  const visible = visibleLength(html);
  assert.ok(html.length > 900 && visible <= CAPTION_VISIBLE_LIMIT, "html " + html.length + " visible " + visible);
  const out = trimPostPreservingTail(post, CAPTION_VISIBLE_LIMIT, formatTelegramPost);
  assert.equal(out.text, post.text, "a post that fits visibly must not be touched");
  assert.equal(visibleLength("<b>a&amp;b</b> <a href=\"https://x.ru/very/long\">Источник</a>"), 12);
});

await test("P1: trimming keeps legal mark, hashtags and signature, cuts the body", function() {
  const legal = "Компания Meta (Meta признана экстремистской и запрещена в РФ) представила Llama 5.";
  const body = [legal].concat(Array.from({ length: 12 }, function(_, i){ return "Дополнительная подробность номер " + i + " о моделях и сроках выхода."; })).join(" ");
  const post = { title: "🧠 Meta выпустила Llama 5", text: body + "\n\nЧто делать: пробовать.\n\n" + TAIL, sources: [{ name: "Источник", url: URL_LONG }] };
  const out = trimPostPreservingTail(post, 500, formatTelegramPost);
  assert.ok(visibleLength(formatTelegramPost(out)) <= 500, "fits");
  assert.ok(out.text.includes("Meta признана экстремистской и запрещена в РФ"), "legal mark kept");
  assert.ok(out.text.endsWith(TAIL), "hashtags and signature kept at the end: " + JSON.stringify(out.text.slice(-80)));
  assert.deepEqual(missingProtected(post.text, out.text), []);
  assert.ok(out.text.length < post.text.length);
});

await test("P1: legal mark in a late sentence survives, unbalanced markup is repaired", function() {
  const filler = Array.from({ length: 10 }, function(_, i){ return "Факт " + i + " про рынок и цены на ближайший квартал."; }).join(" ");
  const post = { title: "🔥 Заголовок", text: "**Главное. Вторая часть выделения.** " + filler + " Блогер Иван Иванов (признан иноагентом в РФ) прокомментировал.\n\n#тест\n@chtotamai", sources: [] };
  const out = trimPostPreservingTail(post, 300, formatTelegramPost);
  assert.ok(out.text.includes("(признан иноагентом в РФ)"));
  assert.ok(out.text.endsWith("#тест\n@chtotamai"));
  assert.equal((out.text.match(/\*\*/g) || []).length % 2, 0);
  assert.ok(visibleLength(formatTelegramPost(out)) <= 300);
});

await test("P1: a GPT rewrite that lost hashtags/signature/legal mark is detected", function() {
  const original = "Meta (Meta признана экстремистской и запрещена в РФ) запустила модель.\n\n#нейросети #модели\n@chtotamai";
  assert.deepEqual(missingProtected(original, original), []);
  const lost = missingProtected(original, "Meta запустила модель.");
  assert.ok(lost.some(function(x){ return x.includes("#нейросети"); }) && lost.includes("@chtotamai") && lost.some(function(x){ return x.includes("запрещена"); }));
  assert.deepEqual(splitTail(original), { body: "Meta (Meta признана экстремистской и запрещена в РФ) запустила модель.", tail: "#нейросети #модели\n@chtotamai" });
});

await test("P1: server.js uses visible-length checks, not html.length, for captions", function() {
  assert.ok(!/html\.length\s*[<>]=?\s*(900|950|1000)/.test(serverSrc), "no html.length caption comparisons left");
  assert.ok(!/formatTelegramPost\([a-z]+\)\.length\s*<=\s*900/.test(serverSrc));
});

// --- P2 ---------------------------------------------------------------------
await test("P2: registry matching handles aliases, inflections and word order", function() {
  const reg = { banned_orgs: ["Meta Platforms", "Instagram", "Facebook"], foreign_agents: ["Иванов Иван Иванович", "Dmitry Gordon", "Лобков Павел", "Земфира"] };
  const hit = function(text) { return matchRegistry(reg, text); };
  assert.ok(hit("Компания Meta запустила нейросеть Llama").banned_orgs.includes("Meta Platforms"));
  assert.ok(hit("в Инстаграме вышло обновление").banned_orgs.includes("Instagram"));
  assert.ok(hit("Фейсбук объявил о скидках").banned_orgs.includes("Facebook"));
  assert.deepEqual(hit("Павла Лобкова процитировали в эфире").foreign_agents, ["Лобков Павел"]);
  assert.deepEqual(hit("Иван Иванов заявил").foreign_agents, ["Иванов Иван Иванович"]);
  assert.deepEqual(hit("Ивана Иванова вызвали в суд").foreign_agents, ["Иванов Иван Иванович"]);
  assert.deepEqual(hit("Земфиру спросили о гастролях").foreign_agents, ["Земфира"]);
  assert.deepEqual(hit("Dmitry Gordon said").foreign_agents, ["Dmitry Gordon"]);
  // no false positives on look-alike words
  const none = hit("Метаданные, мета-анализ и метаморфозы; Игры и игра; Иван и Пётр");
  assert.deepEqual(none, { banned_orgs: [], foreign_agents: [] });
});

await test("P2: built-in banned list works with an empty administrator list", function() {
  const empty = { banned_orgs: [], foreign_agents: [] };
  assert.ok(matchRegistry(empty, "Meta Platforms объявила").banned_orgs.length);
  assert.ok(matchRegistry(empty, "ЛГБТ-движение признано экстремистским").banned_orgs.some(function(x){ return /ЛГБТ/.test(x); }));
  assert.ok(matchRegistry(empty, "членов ИГИЛ задержали").banned_orgs.length);
  assert.ok(matchRegistry(empty, "Свидетелей Иеговы").banned_orgs.length);
  assert.deepEqual(matchRegistry(empty, "Ozon запустил новую доставку"), { banned_orgs: [], foreign_agents: [] });
});

await test("P2: prompt names every built-in banned organisation and no longer promises auto-updates", function() {
  const legal = parsed.sections.get("2");
  for (const name of builtinBannedNames()) {
    const abbr = name.match(/\(([^)]+)\)$/);
    const head = name.replace(/\s*\(.*\)$/, "");
    const probe = abbr ? abbr[1] : /ЛГБТ/.test(head) ? "ЛГБТ" : head.split(" ")[0];
    assert.ok(legal.includes(probe), "section 2 mentions " + probe);
  }
  assert.ok(!/обновляет из официальных реестров/.test(promptText));
  assert.ok(/вручную загружает администратор/.test(promptText));
});

// --- P3 / P5 / P6 / P7 / P8 (prompt text vs code) ---------------------------------
await test("P3: digests are exempt from the writer filter and aligned with the checker length", function() {
  const w = buildSystemPrompt(parsed, "writer", "auto");
  assert.ok(/Дайджест \(`mode: "digest"`\)\.[^\n]*не применяются/.test(w));
  assert.ok(/не больше 900 символов/.test(w.slice(w.indexOf("Правила дайджеста"))));
  const c = buildSystemPrompt(parsed, "checker", "auto");
  assert.ok(/Дайджест \(`mode: "digest"`\) — не длиннее 900/.test(c));
});

await test("P6: prompt matches code about rejected posts (auto-removed, no manual review)", function() {
  assert.ok(!/очередь ручной проверки/.test(promptText));
  assert.ok(/auto_rejected/.test(promptText) && /автоматически удаляется/.test(promptText));
  assert.ok(/auto_rejected/.test(serverSrc) && /fix_exhausted/.test(serverSrc));
  const header = fs.readFileSync(fileURLToPath(new URL("../lib/editorial-v2.js", import.meta.url)), "utf8").slice(0, 900);
  assert.ok(!/holds the\s+post for manual review/.test(header));
});

await test("P7: tech profile does not demand an invented ruble price", function() {
  const tech = parsed.profiles.get("tech");
  assert.ok(!/цена в валюте и рублях/.test(tech));
  assert.ok(/только если она есть в источнике/.test(tech));
});

await test("P8: '===' separator is not promised; now/recent_posts contract is met", function() {
  assert.ok(!/`===`/.test(promptText));
  assert.equal(moscowIso(new Date("2026-10-02T06:00:00Z")), "2026-10-02T09:00:00+03:00");
  assert.equal(moscowIso(new Date("2026-10-02T22:30:15.123Z")), "2026-10-03T01:30:15+03:00");
  assert.ok(/now: moscowIso\(new Date\(\)\)/.test(serverSrc));
  assert.ok(/text: stripHtml\(String\(item\.text/.test(serverSrc), "recent_posts carry a text snippet");
});

// --- P4 ---------------------------------------------------------------------
await test("P4: time slots follow the prompt; sunday_digest only for the digest itself", function() {
  const msk = function(s){ return new Date(s + "+03:00"); };
  const expect = {
    "2026-10-02T06:59": "morning", "2026-10-02T07:00": "morning", "2026-10-02T10:59": "morning",
    "2026-10-02T11:00": "day", "2026-10-02T17:59": "day", "2026-10-02T18:00": "evening",
    "2026-10-02T22:59": "evening", "2026-10-02T23:00": "evening", "2026-10-02T23:45": "evening",
    "2026-10-03T00:30": "morning", "2026-10-03T03:00": "morning",
    // Sunday 2026-10-04: ordinary posts are NOT digests
    "2026-10-04T09:00": "morning", "2026-10-04T17:59": "day", "2026-10-04T18:00": "evening",
    "2026-10-04T19:00": "evening", "2026-10-04T23:30": "evening", "2026-10-05T00:30": "morning"
  };
  for (const [time, slot] of Object.entries(expect)) assert.equal(timeSlotFor(msk(time)), slot, time);
  assert.equal(timeSlotFor(msk("2026-10-04T20:15"), { digest: "sunday" }), "sunday_digest");
});

// --- P5 / P10: checker input ------------------------------------------------
function mockClients(log) {
  return {
    callOpenAI: async function(system, input, opts) { log.push({ system, input: JSON.parse(input), opts }); return { parsed: { verdict: "pass", errors: [], checked_claims: 1, summary: "ok" }, model: "m", provider: "openai" }; },
    callAnthropic: async function(system, input, opts) { log.push({ system, input: JSON.parse(input), opts }); return { parsed: { verdict: "pass", errors: [], checked_claims: 1, summary: "ok" }, model: "c", provider: "anthropic" }; }
  };
}
const POST = { title: "T", tgText: "Текст", vkText: "VK текст", cover: null, format: "Молния", legalFlags: [] };

await test("P5: vk_text is sent to the checker only when VK publishing is enabled", async function() {
  for (const [vkEnabled, mode, expectVk] of [[false, "post", null], [true, "post", "VK текст"], [true, "digest", null], [undefined, "post", null]]) {
    const log = [];
    const p = createEditorialPipeline({ clients: mockClients(log), promptFile: PROMPT_FILE, forceClaude: true });
    await p.runCheckers("auto", POST, { now: "x", mode, vk_enabled: vkEnabled, sources: [], registry: {} });
    assert.equal(log.length, 2);
    for (const call of log) {
      assert.equal(call.input.post.vk_text, expectVk, "vk=" + vkEnabled + " mode=" + mode);
      assert.equal(call.input.vk_enabled, vkEnabled === true && mode !== "digest");
      assert.equal(call.input.mode, mode);
    }
  }
  assert.ok(/vk_enabled: VK_PUBLISH_ENABLED && workspaceVkPublishingAllowed\(currentWorkspace\(\)\)/.test(serverSrc));
});

await test("P10: checker prompt contains only the legal subsection of the filter", function() {
  const c = buildSystemPrompt(parsed, "checker", "money");
  assert.ok(c.includes("### 2в.") && c.includes("## 13.") && c.includes("### `money`"));
  assert.ok(!c.includes("Фильтр проходит по шагам") && !c.includes("### 2а.") && !c.includes("### 2б."));
  const w = buildSystemPrompt(parsed, "writer", "money");
  assert.ok(w.includes("Фильтр проходит по шагам") && w.includes("### 2в."));
});

await test("P10: OpenAI temperature per role, retried without it when the model rejects it", async function() {
  const seen = [];
  let rejectFirst = true;
  const fetchImpl = async function(url, init) {
    const body = JSON.parse(init.body);
    seen.push(body);
    if ("temperature" in body && rejectFirst && body.model === "m-reasoning") {
      rejectFirst = false;
      return { ok: false, status: 400, json: async function(){ return { error: { message: "Unsupported parameter: 'temperature'" } }; } };
    }
    return { ok: true, status: 200, json: async function(){ return { output_text: "{\"verdict\":\"pass\"}" }; } };
  };
  const c = createModelClients({ fetch: fetchImpl, openaiApiKey: "k", openaiModel: "m-reasoning" });
  await c.callOpenAI("S", "{}", { temperature: 0.7 });
  assert.equal(seen[0].temperature, 0.7);
  assert.equal("temperature" in seen[1], false, "retry without temperature");
  await c.callOpenAI("S", "{}", {});
  assert.equal("temperature" in seen[2], false, "no temperature unless asked");

  const log = [];
  const p = createEditorialPipeline({ clients: mockClients(log), promptFile: PROMPT_FILE });
  const WRITER = { status: "ok", title: "T", tg_text: "x", importance: 7 };
  const clients = mockClients(log);
  clients.callOpenAI = async function(system, input, opts) { log.push({ opts }); return { parsed: WRITER, model: "m", provider: "openai" }; };
  const p2 = createEditorialPipeline({ clients, promptFile: PROMPT_FILE });
  await p2.runWriter("auto", { sources: [] });
  assert.equal(log[log.length - 1].opts.temperature, 0.7);
  await p.runCheckers("auto", POST, { sources: [] });
  assert.ok(log.some(function(l){ return l.opts && l.opts.temperature === 0.1; }));
});

// --- P9 ---------------------------------------------------------------------
await test("P9: all 16 channels resolve from name, id, slug, username and pin", function() {
  // names and known handles come from the signature table in the prompt
  const rows = [...promptText.matchAll(/^\| (\w+) \| (.+?) \| (@\S+) \|$/gm)].map(function(m){ return { id: m[1], name: m[2], handle: m[3].replace(/^@/, "") }; });
  assert.equal(rows.length, 16);
  assert.deepEqual(rows.map(function(r){ return r.id; }).sort(), CHANNEL_IDS.slice().sort());
  for (const r of rows) {
    assert.equal(resolveChannelId({ id: "workspace-x", name: r.name }), r.id, "name " + r.name);
    assert.equal(resolveChannelId({ id: "workspace-x", name: r.name.replace(/^\S+\s/, "") }), r.id, "name w/o emoji " + r.name);
    assert.equal(resolveChannelId({ id: "workspace-x", name: "Новый канал", channelId: r.id }), r.id, "pin " + r.id);
    if (!/^_+$/.test(r.handle)) {
      assert.equal(resolveChannelId({ id: "workspace-x", name: "Новый канал", telegramPublicUsername: r.handle }), r.id, "username " + r.handle);
      assert.equal(resolveChannelId({ id: "workspace-x", name: "Новый канал", slug: r.handle }), r.id, "slug " + r.handle);
      assert.equal(resolveChannelId({ id: r.handle, name: "Новый канал" }), r.id, "id " + r.handle);
    }
  }
  // the eight channels whose handles are not in the prompt yet: conventional «chtotam…» handles
  const guessed = { world: "chtotamnews", stars: "chtotamzvezd", travel: "chtotamtour", shopping: "chtotampokupki", home: "chtotamdom", food: "chtotameda", business: "chtotambusiness", crypto: "chtotamcrypto" };
  for (const [id, handle] of Object.entries(guessed)) {
    assert.equal(resolveChannelId({ id: "workspace-x", name: "Новый канал", telegramPublicUsername: handle }), id, handle);
    assert.equal(resolveChannelId({ id: handle, name: "Новый канал", slug: handle, telegramChannel: "@" + handle }), id, "id+slug " + handle);
  }
  assert.equal(resolveChannelId({ id: "ai-main", name: "x" }), "ai");
  assert.equal(resolveChannelId({ id: "workspace-17", name: "Новый канал", slug: "", telegramPublicUsername: "" }), "");
  // a pin always wins over what the name suggests
  assert.equal(resolveChannelId({ name: "Что там у игр?", channelId: "kino" }), "kino");
});

console.log(passed + " tests passed");
