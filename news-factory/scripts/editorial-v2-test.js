// Offline tests for the editorial v2 pipeline: no network, OpenAI and Anthropic are mocked.
// Run: npm run test:editorial
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  parsePromptFile, buildSystemPrompt, loadPrompt, createEditorialPipeline, createModelClients,
  normalizeWriterResult, normalizeCheckerResult, mergeVerdicts, legacyScores, resolveChannelId, timeSlotFor
} from "../lib/editorial-v2.js";

const PROMPT = fileURLToPath(new URL("../prompts/chto-tam.md", import.meta.url));
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log("ok  -", name); }
  catch (error) { console.error("FAIL -", name); console.error(error); process.exitCode = 1; }
}

const WRITER_OK = {
  status: "ok", channel_id: "auto", importance: 8, format: "Цифра", hook_type: "Цифра", ending_type: "что дальше",
  title_emoji: "🚘", title: "🚘 Hongqi H5 подорожал на 200 000 ₽",
  tg_text: "Hongqi H5 подорожал на 200 000 ₽\n\nОбновлённый **H5** приехал в Россию.\n\n💰 Цена — 4 480 000 ₽\n\n#новинки\n@chtotamtachki",
  vk_text: "<b>Обновлённый H5</b> приехал в Россию.\n\n💰 Цена — 4 480 000 ₽",
  cover: { big: "4 480 000 ₽", caption: "Hongqi H5", sub: null, emoji: "🚘" },
  legal_flags: [], crosspromo_target: null, entities: ["Hongqi", "H5"]
};
const PASS = { verdict: "pass", errors: [], checked_claims: 4, summary: "ok" };
const FIX = { verdict: "fix", errors: [{ severity: "critical", type: "fact", field: "tg_text", quote: "4 680 000 ₽", problem: "в источнике 4 480 000 ₽", fix: "заменить" }], checked_claims: 4 };
const REJECT = { verdict: "reject", errors: [{ severity: "critical", type: "fact", field: "title", quote: "x", problem: "выдумка", fix: "" }] };

function mockClients(script) {
  const calls = { openai: [], anthropic: [] };
  const next = function(provider, system, input) {
    const role = JSON.parse(input).role;
    calls[provider].push({ role, input: JSON.parse(input), system });
    const queue = script[provider + ":" + role];
    const answer = Array.isArray(queue) ? (queue.length > 1 ? queue.shift() : queue[0]) : queue;
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve({ parsed: structuredClone(answer), model: provider + "-model", provider });
  };
  return {
    calls,
    clients: {
      callOpenAI: function(system, input){ return next("openai", system, input); },
      callAnthropic: function(system, input){ return next("anthropic", system, input); }
    }
  };
}

const REQUEST = { now: "2026-10-02T09:00:00+03:00", sources: [{ name: "Src", url: "https://x", text: "Hongqi H5 стоит 4 480 000 ₽" }], recent_posts: [], registry: { banned_orgs: [], foreign_agents: [] } };
const withClaude = { anthropicApiKey: "test" };

await test("prompt parses into all sections and 16 profiles", function() {
  const parsed = loadPrompt(PROMPT);
  for (const k of ["0","1","2","3","4","5","6","7","8","9","10","11","12","13"]) assert.ok(parsed.sections.get(k), "section " + k);
  assert.equal(parsed.profiles.size, 16);
});

await test("writer prompt has only its own channel profile and no checker section", function() {
  const parsed = loadPrompt(PROMPT);
  const w = buildSystemPrompt(parsed, "writer", "auto");
  assert.ok(w.includes("### `auto`"));
  assert.ok(!w.includes("### `ai`"));
  assert.ok(!w.includes("## 13."));
  assert.ok(!w.includes("@________"));
  const c = buildSystemPrompt(parsed, "checker", "stars");
  assert.ok(c.includes("## 13.") && c.includes("### `stars`") && c.includes("2в"));
  assert.ok(!c.includes("## 5."));
});

await test("writer prompt shared prefix is identical across channels (prompt cache)", function() {
  const parsed = loadPrompt(PROMPT);
  const a = buildSystemPrompt(parsed, "writer", "ai");
  const b = buildSystemPrompt(parsed, "writer", "crypto");
  const cut = a.indexOf("## 9. Профиль этого канала");
  assert.ok(cut > 10000);
  assert.equal(a.slice(0, cut), b.slice(0, cut));
});

await test("unknown channel falls back to generic profile", function() {
  const parsed = parsePromptFile("head\n## 0. Роль\nx\n## 9. Профили\nintro\n### `ai` — x\nai text\n## 13. Корректор\ny");
  const w = buildSystemPrompt(parsed, "writer", "");
  assert.ok(w.includes("Профиль для этого канала не задан"));
});

await test("writer result: title not repeated in body, VK has no tags", function() {
  const r = normalizeWriterResult(WRITER_OK, "auto");
  assert.ok(!r.tgText.startsWith("Hongqi H5 подорожал"));
  assert.ok(!/<b>/.test(r.vkText));
  assert.equal(r.importance, 8);
  assert.deepEqual(r.entities, ["Hongqi", "H5"]);
});

await test("writer result without title/text is rejected", function() {
  assert.throws(function(){ normalizeWriterResult({ status: "ok", title: "" }, "auto"); });
});

await test("checker: pass with a critical error is downgraded to fix", function() {
  const r = normalizeCheckerResult({ verdict: "pass", errors: FIX.errors }, "openai", "m");
  assert.equal(r.verdict, "fix");
});

await test("merge: strictest verdict wins, duplicate errors collapsed", function() {
  const a = normalizeCheckerResult(FIX, "openai", "m");
  const b = normalizeCheckerResult(FIX, "anthropic", "m");
  const m = mergeVerdicts([a, b, normalizeCheckerResult(PASS, "x", "m")]);
  assert.equal(m.verdict, "fix");
  assert.equal(m.errors.length, 1);
  assert.equal(mergeVerdicts([a, normalizeCheckerResult(REJECT, "anthropic", "m")]).verdict, "reject");
});

await test("pipeline: both checkers pass → approved, Claude really called", async function() {
  const mock = mockClients({ "openai:writer": WRITER_OK, "openai:checker": PASS, "anthropic:checker": PASS });
  const p = createEditorialPipeline({ promptFile: PROMPT, clients: mock.clients, config: withClaude });
  const out = await p.run("auto", REQUEST);
  assert.equal(out.status, "approved");
  assert.equal(mock.calls.anthropic.length, 1);
  assert.equal(mock.calls.openai.filter(function(c){ return c.role === "checker"; }).length, 1);
  assert.ok(mock.calls.anthropic[0].system.includes("## 13."));
});

await test("pipeline: Claude finds an error → writer fixes with notes → approved", async function() {
  const mock = mockClients({ "openai:writer": WRITER_OK, "openai:checker": PASS, "anthropic:checker": [FIX, PASS] });
  const p = createEditorialPipeline({ promptFile: PROMPT, clients: mock.clients, config: withClaude });
  const out = await p.run("auto", REQUEST);
  assert.equal(out.status, "approved");
  assert.equal(out.rounds, 1);
  const writerCalls = mock.calls.openai.filter(function(c){ return c.role === "writer"; });
  assert.equal(writerCalls.length, 2);
  assert.equal(writerCalls[1].input.fix_notes[0].quote, "4 680 000 ₽");
  assert.ok(writerCalls[1].input.previous_post.title);
});

await test("pipeline: errors persist after max rounds → hold", async function() {
  const mock = mockClients({ "openai:writer": WRITER_OK, "openai:checker": FIX, "anthropic:checker": PASS });
  const p = createEditorialPipeline({ promptFile: PROMPT, clients: mock.clients, config: withClaude, maxFixRounds: 2 });
  const out = await p.run("auto", REQUEST);
  assert.equal(out.status, "hold");
  assert.equal(out.verdict, "fix_exhausted");
  assert.equal(out.rounds, 2);
});

await test("pipeline: reject → hold without extra rewrites", async function() {
  const mock = mockClients({ "openai:writer": WRITER_OK, "openai:checker": PASS, "anthropic:checker": REJECT });
  const p = createEditorialPipeline({ promptFile: PROMPT, clients: mock.clients, config: withClaude });
  const out = await p.run("auto", REQUEST);
  assert.equal(out.status, "hold");
  assert.equal(out.verdict, "reject");
  assert.equal(mock.calls.openai.filter(function(c){ return c.role === "writer"; }).length, 1);
});

await test("pipeline: Claude configured but failing → hold (no silent single check)", async function() {
  const mock = mockClients({ "openai:writer": WRITER_OK, "openai:checker": PASS, "anthropic:checker": new Error("overloaded") });
  const p = createEditorialPipeline({ promptFile: PROMPT, clients: mock.clients, config: withClaude });
  const out = await p.run("auto", REQUEST);
  assert.equal(out.status, "hold");
  assert.equal(out.verdict, "unavailable");
});

await test("pipeline: no Anthropic key → GPT-only check", async function() {
  const mock = mockClients({ "openai:writer": WRITER_OK, "openai:checker": PASS });
  const p = createEditorialPipeline({ promptFile: PROMPT, clients: mock.clients, config: {} });
  const out = await p.run("auto", REQUEST);
  assert.equal(out.status, "approved");
  assert.equal(mock.calls.anthropic.length, 0);
});

await test("pipeline: writer skip → no checkers called", async function() {
  const mock = mockClients({ "openai:writer": { status: "skip", skip_reason: "низкая важность", importance: 3 } });
  const p = createEditorialPipeline({ promptFile: PROMPT, clients: mock.clients, config: withClaude });
  const out = await p.run("auto", REQUEST);
  assert.equal(out.status, "skip");
  assert.equal(mock.calls.anthropic.length, 0);
});

await test("legacy score mapping keeps the scheduler thresholds meaningful", function() {
  const approved = legacyScores({ status: "approved", post: { importance: 8 } }, 72);
  assert.equal(approved.editorialScore, 80);
  assert.ok(approved.qualityScore >= 72 && approved.qcStatus === "pass");
  const hold = legacyScores({ status: "hold", post: { importance: 9 } }, 72);
  assert.ok(hold.qualityScore < 72 && hold.qcStatus === "hold");
});

await test("channel resolution and time slots", function() {
  assert.equal(resolveChannelId({ id: "ai-main" }), "ai");
  assert.equal(resolveChannelId({ id: "chtotamtachki" }), "auto");
  assert.equal(resolveChannelId({ id: "x", channelId: "crypto" }), "crypto");
  assert.equal(resolveChannelId({ id: "x", name: "Что там у крипты?" }), "crypto");
  assert.equal(timeSlotFor(new Date("2026-10-02T05:30:00Z")), "morning");
  assert.equal(timeSlotFor(new Date("2026-10-02T16:30:00Z")), "evening");
});

await test("HTTP clients: correct endpoints/headers, Claude temperature retry", async function() {
  const seen = [];
  let anthropicCalls = 0;
  const fakeFetch = async function(url, init) {
    const body = JSON.parse(init.body);
    seen.push({ url, headers: init.headers, body });
    if (url.includes("openai")) {
      return { ok: true, status: 200, json: async function(){ return { output_text: JSON.stringify(PASS) }; } };
    }
    anthropicCalls += 1;
    if (anthropicCalls === 1) return { ok: false, status: 400, json: async function(){ return { error: { message: "temperature is not supported" } }; } };
    return { ok: true, status: 200, json: async function(){ return { content: [{ type: "text", text: "```json\n" + JSON.stringify(FIX) + "\n```" }] }; } };
  };
  const c = createModelClients({ fetch: fakeFetch, openaiApiKey: "k1", openaiModel: "gpt-x", anthropicApiKey: "k2", anthropicModel: "claude-sonnet-5-5" });
  const o = await c.callOpenAI("SYS", "{}", {});
  assert.equal(o.parsed.verdict, "pass");
  assert.equal(seen[0].url, "https://api.openai.com/v1/responses");
  assert.equal(seen[0].body.instructions, "SYS");
  const a = await c.callAnthropic("SYS", "{}", {});
  assert.equal(a.parsed.verdict, "fix");
  assert.equal(seen[1].url, "https://api.anthropic.com/v1/messages");
  assert.equal(seen[1].headers["anthropic-version"], "2023-06-01");
  assert.equal(seen[1].headers["x-api-key"], "k2");
  assert.equal(seen[1].body.temperature, 0);
  assert.equal(seen[2].body.temperature, undefined);
  assert.equal(seen[2].body.system[0].cache_control.type, "ephemeral");
});

console.log("\n" + passed + " tests passed" + (process.exitCode ? " (with failures)" : ""));
