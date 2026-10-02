// Offline tests for the editorial v2 pipeline: no network, OpenAI and Anthropic are mocked.
// Run: npm run test:editorial
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  parsePromptFile, buildSystemPrompt, loadPrompt, createEditorialPipeline, createModelClients,
  normalizeWriterResult, normalizeCheckerResult, mergeVerdicts, legacyScores, resolveChannelId, timeSlotFor
} from "../lib/editorial-v2.js";
import {
  COST_STATE_MIGRATION_ID, collectLegacyCostRows, stripLegacyCostEvents,
  calculateUsageCost, resolveCostPricing, moscowCostDateKey, moscowPeriodBounds, monthForecastCost
} from "../lib/costs.js";

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

await test("album flag: defaults to single photo, true only when explicit", function() {
  assert.equal(normalizeWriterResult(WRITER_OK, "auto").album, false);
  assert.equal(normalizeWriterResult(Object.assign({}, WRITER_OK, { album: true }), "auto").album, true);
  assert.equal(normalizeWriterResult(Object.assign({}, WRITER_OK, { album: "yes" }), "auto").album, false);
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
  assert.equal(seen[1].body.output_config.format.type, "json_schema");
  assert.equal(seen[1].body.output_config.format.schema.properties.verdict.type, "string");
  assert.equal(seen[2].body.temperature, undefined);
  assert.equal(seen[2].body.output_config.format.type, "json_schema");
  assert.equal(seen[2].body.system[0].cache_control.type, "ephemeral");
});

await test("Claude falls back when structured outputs are unavailable", async function() {
  const seen = [];
  let calls = 0;
  const fakeFetch = async function(url, init) {
    const body = JSON.parse(init.body);
    seen.push(body);
    calls += 1;
    if (calls === 1) {
      return {
        ok: false,
        status: 400,
        json: async function(){ return { error: { message: "output_config.format is not supported for this model" } }; }
      };
    }
    return {
      ok: true,
      status: 200,
      json: async function(){ return { content: [{ type: "text", text: JSON.stringify(PASS) }] }; }
    };
  };
  const clients = createModelClients({
    fetch: fakeFetch,
    anthropicApiKey: "k2",
    anthropicModel: "claude-test"
  });
  const result = await clients.callAnthropic("SYS", "{}", {});
  assert.equal(result.parsed.verdict, "pass");
  assert.equal(result.structured, false);
  assert.equal(seen[0].output_config.format.type, "json_schema");
  assert.equal(seen[1].output_config, undefined);
});

await test("costs: Anthropic cache tokens are additive, not subtracted from input", function() {
  const config = resolveCostPricing("").pricing;
  const result = calculateUsageCost("anthropic", "claude-sonnet-5-5", {
    input_tokens: 1000,
    cache_read_input_tokens: 5000,
    cache_creation_input_tokens: 0,
    output_tokens: 300
  }, "messages", config);
  assert.equal(Number(result.costUsd.toFixed(6)), 0.006);
  assert.equal(result.reportInputTokens, 6000);
  assert.equal(result.pricingKnown, true);
});

await test("costs: unknown OpenAI model is estimated and not pricing-known", function() {
  const config = resolveCostPricing("").pricing;
  const result = calculateUsageCost("openai", "future-gpt-unknown", {
    input_tokens: 1000, output_tokens: 100
  }, "responses", config);
  assert.equal(result.estimated, true);
  assert.equal(result.pricingKnown, false);
  assert.ok(result.costUsd > 0);
});

await test("costs: pricing JSON overrides built-ins and price date", function() {
  const resolved = resolveCostPricing(JSON.stringify({
    updatedAt: "2026-10-03",
    anthropic: { "claude-sonnet-5-5": { input: 3 } }
  }));
  assert.equal(resolved.overridden, true);
  assert.equal(resolved.updatedAt, "2026-10-03");
  assert.equal(resolved.pricing.anthropic["claude-sonnet-5-5"].input, 3);
  assert.equal(resolved.pricing.anthropic["claude-sonnet-5-5"].output, 10);
  assert.equal(resolved.pricing.anthropic["claude-opus-5-5"].output, 20);
});

await test("costs: Moscow day handles UTC date boundary", function() {
  assert.equal(moscowCostDateKey(new Date("2026-10-01T22:30:00.000Z")), "2026-10-02");
});

await test("costs: month forecast uses elapsed Moscow calendar days", function() {
  const now = new Date("2026-10-10T09:00:00.000Z");
  assert.equal(monthForecastCost(100, now), 310);
});

await test("costs: today starts at Moscow midnight, not UTC midnight", function() {
  const now = new Date("2026-10-01T22:30:00.000Z");
  const bounds = moscowPeriodBounds("today", now, 1);
  assert.equal(bounds.start.toISOString(), "2026-10-01T21:00:00.000Z");
  assert.equal(bounds.label, "Сегодня");
});

await test("cost migration: legacy state events are idempotent and removed after transfer", function() {
  const workspaces = [{
    id: "ai-main",
    state: {
      migrations: [],
      costTracking: {
        startedAt: "2026-10-01T00:00:00.000Z",
        events: [{
          id: "cost_legacy_1",
          at: "2026-10-01T12:00:00.000Z",
          workspaceId: "ai-main",
          provider: "openai",
          model: "gpt-x",
          operation: "test",
          endpoint: "responses",
          kind: "text",
          inputTokens: 10,
          outputTokens: 3,
          costUsd: 0.001,
          pricingKnown: true,
          estimated: false,
          extra: {}
        }]
      }
    }
  }];
  const first = collectLegacyCostRows(workspaces, COST_STATE_MIGRATION_ID);
  const second = collectLegacyCostRows(workspaces, COST_STATE_MIGRATION_ID);
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(first[0].id, second[0].id);
  const fakeDb = new Set();
  first.concat(second).forEach(function(row){ fakeDb.add(row.id); });
  assert.equal(fakeDb.size, 1, "ON CONFLICT(id) equivalent remains idempotent");
  const stripped = stripLegacyCostEvents(workspaces, COST_STATE_MIGRATION_ID);
  assert.equal(stripped.workspaces, 1);
  assert.equal(workspaces[0].state.costTracking.events, undefined);
  assert.ok(workspaces[0].state.migrations.includes(COST_STATE_MIGRATION_ID));
  assert.equal(collectLegacyCostRows(workspaces, COST_STATE_MIGRATION_ID).length, 0);
});

await test("Claude checker schema uses only keywords supported by structured outputs", async function() {
  const mod = await import("../lib/editorial-v2.js");
  const banned = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "minItems", "maxItems", "pattern", "multipleOf"];
  const walk = function(node, path) {
    if (!node || typeof node !== "object") return;
    for (const key of Object.keys(node)) {
      assert.ok(!banned.includes(key), "unsupported keyword " + key + " at " + path);
      walk(node[key], path + "." + key);
    }
    if (node.type === "object") assert.equal(node.additionalProperties, false, "additionalProperties must be false at " + path);
  };
  walk(mod.CHECKER_OUTPUT_SCHEMA, "schema");
});

await test("admin page script parses (guards against broken admin UI deploys)", async function() {
  const fs = await import("node:fs");
  const html = fs.readFileSync(fileURLToPath(new URL("../public/admin.html", import.meta.url)), "utf8");
  const scripts = Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)).map(function(m){ return m[1]; });
  assert.ok(scripts.length >= 1);
  for (const code of scripts) new Function(code);
  assert.equal((html.match(/<\/html>/g) || []).length, 1, "exactly one </html>");
});

await test("collector checks duplicates before media preparation and LLM calls", async function() {
  const fs = await import("node:fs");
  const src = fs.readFileSync(fileURLToPath(new URL("../server.js", import.meta.url)), "utf8");
  const start = src.indexOf("async function collectOnce(");
  assert.ok(start > 0);
  const body = src.slice(start, start + 60000);
  const pre = body.indexOf("storyPrecheck = await classifyPublishedStoryRelationship(");
  const media = body.indexOf("await prepareMediaDirector(");
  const writer = body.indexOf("await runEditorialV2(");
  assert.ok(pre > 0 && media > 0 && writer > 0);
  assert.ok(pre < media && pre < writer, "precheck must run before media and writer");
});

await test("post rating is out of 100 and its parts add up", async function() {
  const fs = await import("node:fs");
  const html = fs.readFileSync(fileURLToPath(new URL("../public/admin.html", import.meta.url)), "utf8");
  const start = html.indexOf("function postRating(");
  const end = html.indexOf("function statusRu(");
  assert.ok(start > 0 && end > start);
  const esc = function(v){ return String(v || ""); };
  const lib = new Function("esc", html.slice(start, end) + "; return { postRating: postRating, ratingBoxHtml: ratingBoxHtml };")(esc);
  const best = lib.postRating({ editorialV2: { status: "approved", verdict: "pass", importance: 10, rounds: 0 }, articlePublishedAt: "2026-10-01T10:00:00Z", foundAt: "2026-10-01T11:00:00Z", mediaKind: "video", sourceRole: "official_primary" });
  assert.equal(best.total, 100);
  const parts = best.parts.reduce(function(a, p){ return a + p.max; }, 0);
  assert.equal(parts, 100);
  const typical = lib.postRating({ editorialV2: { status: "approved", verdict: "pass", importance: 7, rounds: 1 }, articlePublishedAt: "2026-10-01T10:00:00Z", foundAt: "2026-10-01T14:00:00Z", mediaKind: "photo", sourceRole: "media_context" });
  assert.equal(typical.total, 28 + 21 + 12 + 8 + 7);
  const skipped = lib.postRating({ editorialV2: { status: "skip", importance: 1, skipReason: "реклама" }, status: "editorial_skip", mediaKind: "photo", sourceRole: "author_opinion" });
  assert.equal(skipped.parts[1].got, 0);
  assert.ok(skipped.total < 50 && skipped.grade.label === "Слабо");
  const legacy = lib.postRating({ aiScore: 80, qcStatus: "pass", mediaKind: "generated" });
  assert.equal(legacy.parts[0].got, 32);
  assert.ok(/из 100/.test(lib.ratingBoxHtml(typical)));
});

await test("feed explains why a news item was skipped", async function() {
  const fs = await import("node:fs");
  const html = fs.readFileSync(fileURLToPath(new URL("../public/admin.html", import.meta.url)), "utf8");
  const start = html.indexOf("function feedStatusReason(");
  const end = html.indexOf("function statusRu(");
  const fn = new Function(html.slice(start, end) + "; return feedStatusReason;")();
  const skip = fn({ aiScoreReason: "Пропущено редакцией: промо собственного видео", metadata: { editorialSkipReason: "промо собственного видео" } }, "editorial_skip");
  assert.equal(skip.title, "Почему пропущено:");
  assert.equal(skip.text, "Промо собственного видео");
  const dup = fn({ metadata: { storyRelation: { relation: "duplicate", publishedTitle: "BMW M5" } } }, "duplicate_story");
  assert.ok(/BMW M5/.test(dup.text));
  assert.equal(fn({ metadata: {} }, "queued"), null);
});

await test("source quality: stale year, prefilter parsing, auto pause", async function() {
  const sq = await import("../lib/source-quality.js");
  const now = new Date("2026-10-02T01:00:00Z");
  assert.equal(sq.staleYearInTitle("IAA Mobility 2025 — новости Volkswagen", false, now), true);
  assert.equal(sq.staleYearInTitle("IAA Mobility 2025 — новости Volkswagen", true, now), false);
  assert.equal(sq.staleYearInTitle("Новая Camry 2027 модельного года", false, now), false);
  assert.equal(sq.staleYearInTitle("BMW показала новую тройку", false, now), false);

  const prompt = sq.buildPrefilterPrompt({ channelName: "Что там у тачек?", topic: "автомобили", today: "2026-10-02", items: [{ source: "Drom", group: "media", title: "BMW X4 продаётся за 8,5 млн" }] });
  assert.ok(/объявления о продаже/.test(prompt) && /2026-10-02/.test(prompt) && /BMW X4/.test(prompt));

  const parsed = sq.parsePrefilterResult('```json\n{"items":[{"n":1,"keep":false,"score":1,"reason":"реклама"},{"n":2,"keep":true,"score":8}]}\n```', 3);
  assert.equal(parsed.get(1).keep, false);
  assert.equal(parsed.get(2).score, 8);
  assert.equal(parsed.get(3).keep, true, "items the model forgot are kept");
  assert.equal(sq.parsePrefilterResult("not json", 2), null);

  const stat = {};
  for (let i = 0; i < 9; i += 1) sq.recordOutcome(stat, "junk");
  const src = { id: "b1", enabled: true, group: "blogger" };
  assert.equal(sq.autoPauseReason(src, stat, 10), "");
  sq.recordOutcome(stat, "junk");
  assert.ok(/10 новостей подряд/.test(sq.autoPauseReason(src, stat, 10)));
  assert.equal(sq.autoPauseReason(src, stat, 4), "", "keeps a minimum of sources per group");
  sq.recordOutcome(stat, "ok");
  assert.equal(sq.autoPauseReason(src, stat, 10), "", "one useful item resets the streak");
  assert.ok(/не открывается/.test(sq.autoPauseReason(src, { errorStreak: 12 }, 10)));
  assert.equal(sq.outcomeForStatus("editorial_skip"), "junk");
  assert.equal(sq.outcomeForStatus("queued"), "ok");
  assert.equal(sq.outcomeForStatus("duplicate_story"), "");
});

await test("collector pre-filters headlines before processing candidates", async function() {
  const fs = await import("node:fs");
  const src = fs.readFileSync(fileURLToPath(new URL("../server.js", import.meta.url)), "utf8");
  const start = src.indexOf("async function collectOnce(");
  const body = src.slice(start, start + 60000);
  const pre = body.indexOf("await prefilterCandidates(ordered, summary)");
  const loop = body.indexOf("for (const candidate of ordered)");
  assert.ok(pre > 0 && loop > pre);
});

await test("source replenishment helpers", async function() {
  const sq = await import("../lib/source-quality.js");
  const sources = [
    { url: "https://www.motortrend.com/news/", enabled: true },
    { url: "https://blog.google/technology/ai/", enabled: false },
    { url: "https://example.com/a", enabled: true }
  ];
  assert.equal(sq.sourcesNeeded(sources, 40), 38);
  assert.equal(sq.sourcesNeeded(sources, 2), 0);
  const fresh = sq.freshCandidates([
    { name: "MT", url: "https://motortrend.com/news/" },
    { name: "Google Cloud", url: "https://blog.google/products/cloud/" },
    { name: "Blocked", url: "https://www.bad.ru/news" },
    { name: "Dup", url: "https://new.ru/news" },
    { name: "Dup2", url: "https://www.new.ru/news/" },
    { name: "No url", url: "ftp://x" }
  ], sources, ["bad.ru"]);
  assert.deepEqual(fresh.map(function(x){ return x.name; }), ["Google Cloud", "Dup"]);
  assert.ok(sq.RESERVE_SOURCES.auto.length >= 10 && sq.RESERVE_SOURCES.ai.length >= 10);
  const found = sq.parseDiscoveryResult('{"sources":[{"name":"За рулём","url":"https://www.zr.ru/","group":"media","why":"рынок РФ"},{"name":"","url":"https://x.ru"},{"name":"Bad","url":"javascript:1"}]}');
  assert.equal(found.length, 1);
  assert.equal(found[0].group, "media");
  assert.ok(/уже подключённые сайты: zr\.ru/.test(sq.buildDiscoveryPrompt({ channelName: "Тачки", topic: "авто", count: 3, existingHosts: ["zr.ru"] })));
});

await test("server and admin post ratings are identical", async function() {
  const fs = await import("node:fs");
  const html = fs.readFileSync(fileURLToPath(new URL("../public/admin.html", import.meta.url)), "utf8");
  const admin = new Function("esc", html.slice(html.indexOf("function postRating("), html.indexOf("// Compact rating under the status badge")) + "; return postRating;")(function(v){ return String(v || ""); });
  const lib = await import("../lib/post-rating.js");
  const samples = [
    { editorialV2: { status: "approved", verdict: "pass", importance: 8, rounds: 1 }, createdAt: "2026-10-01T11:00:00Z", articlePublishedAt: "2026-10-01T09:30:00Z", imageUrl: "/media/a.jpg", sourceRole: "media_context" },
    { editorialV2: { status: "approved", verdict: "unavailable", importance: 4 }, qcStatus: "hold", videoUrl: "v.mp4", storySources: [1, 2, 3] },
    { aiScore: 61, qcStatus: "pass", generatedImageUrl: "/g.png", sourceRole: "author_opinion" },
    {}
  ];
  for (const q of samples) {
    const input = lib.queueItemRatingInput(q);
    assert.deepEqual(lib.postRating(input), admin(input));
  }
  assert.equal(lib.postRating(lib.queueItemRatingInput(samples[0])).total, 32 + 21 + 15 + 8 + 7);
});

await test("Claude retries with a bigger budget when the JSON is cut off", async function() {
  const bodies = [];
  const fakeFetch = async function(url, init) {
    const body = JSON.parse(init.body);
    bodies.push(body);
    const cut = bodies.length === 1;
    const data = cut
      ? { stop_reason: "max_tokens", content: [{ type: "text", text: '{"verdict":"fix","errors":[{"severity":"minor","type":"tech","fi' }] }
      : { stop_reason: "end_turn", content: [{ type: "text", text: '{"verdict":"pass","errors":[],"checked_claims":5,"summary":"ok"}' }] };
    return { ok: true, status: 200, json: async function(){ return data; } };
  };
  const c = createModelClients({ fetch: fakeFetch, anthropicApiKey: "k2", anthropicModel: "claude-sonnet-5-5" });
  const a = await c.callAnthropic("SYS", "{}", {});
  assert.equal(a.parsed.verdict, "pass");
  assert.equal(bodies.length, 2);
  assert.ok(bodies[1].max_tokens >= 8000);
  assert.equal(bodies[1].output_config.format.type, "json_schema");
});

await test("insights: digest selection, weights and daily report text", async function() {
  const ins = await import("../lib/insights.js");
  const now = new Date("2026-10-02T18:30:00Z"); // 21:30 MSK
  const history = [
    { title: "A", publishedAt: "2026-10-02T07:00:00Z", performanceScore: 1 },
    { title: "B", publishedAt: "2026-10-02T09:00:00Z", performanceScore: 5, editorialV2: { format: "Цифра", hookType: "Цифра" } },
    { title: "Old", publishedAt: "2026-10-01T09:00:00Z", performanceScore: 9 },
    { title: "Digest", publishedAt: "2026-10-02T10:00:00Z", isDigest: true },
    { title: "Late night yesterday MSK", publishedAt: "2026-10-01T20:59:00Z" }
  ];
  assert.deepEqual(ins.pickDigestPosts(history, "evening", now).map(function(h){ return h.title; }), ["A", "B"]);
  assert.equal(ins.pickDigestPosts(history, "sunday", now)[0].title, "Old");
  assert.equal(ins.historyFormat(history[1]), "Цифра");
  assert.equal(ins.moscowParts("2026-10-02T18:30:00Z").hhmm, "21:30");
  const w = ins.bucketWeights({ "Цифра": { performance: 8, samples: 4 }, "Молния": { performance: -16, samples: 5 }, "Мало": { performance: 9, samples: 1 } }, 3);
  assert.deepEqual(w, { "Цифра": 1.5, "Молния": 0.5 });
  const text = ins.buildDailyReportText({ date: "02.10.2026", spendRub: 412.4, budgetRub: 1000, channels: [{ name: "Что там у тачек?", published: 9, digest: true, queueReady: 4, queueReserve: 2, filtered: { prefilter: 30, editorial: 6, duplicate: 3, autoRejected: 1 }, topReasons: ["реклама (5)"], best: { title: "BMW", views: 1520 }, sourcesPaused: ["Bulkin Drive"], sourcesAdded: [], problems: ["ждут повторной проверки нейросетью: 1"] }] });
  assert.ok(/Вышло постов: 9 \+ дайджест/.test(text));
  assert.ok(/Отсеяно: 40/.test(text));
  assert.ok(/1\s?520 просмотров/.test(text));
  assert.ok(/412 ₽ из 1\s?000 ₽/.test(text));
  assert.ok(ins.topReasons(["Реклама", "реклама", "старое"], 2)[0].startsWith("реклама (2)"));
});

console.log("\n" + passed + " tests passed" + (process.exitCode ? " (with failures)" : ""));
