// v0.67.0: enabled sources outside every theme group are attached to the theme they fit.
//   npm run test:source-rubric-assign
process.env.TZ = "UTC";
import assert from "node:assert/strict";
import { buildAssignPrompt, parseAssignResult, tagSource, ASSIGN_MARKER } from "../lib/source-rubric-assign.js";
import { loadServer, inWs } from "./dedupe-harness.js";
import { channelStrategy } from "../lib/channel-dna.js";
import { RUBRICS_V055_MIGRATION } from "../lib/channel-rubrics-v055.js";

const cases = {};
const test = (n, f) => { cases[n] = f; };
const src = (id, extra) => Object.assign({ id, name: id, url: "https://" + id + ".example/news/", enabled: true, group: "media", type: "web" }, extra || {});

test("A1 parse: invalid ids dropped, max 2, duplicates and out-of-range ignored, garbage -> null", () => {
  const valid = new Set(["a", "b", "c"]);
  const m = parseAssignResult('noise {"items":[{"n":1,"rubrics":["a","zzz","b","c"]},{"n":1,"rubrics":["c"]},{"n":2,"rubrics":[]},{"n":9,"rubrics":["a"]},{"n":"x"}]} tail', 3, valid);
  assert.deepEqual(m.get(1), ["a", "b"]); assert.deepEqual(m.get(2), []); assert.ok(!m.has(9) && !m.has(3));
  assert.equal(parseAssignResult("not json", 3, valid), null);
  assert.equal(parseAssignResult('{"x":1}', 3, valid), null);
});

test("A2 prompt lists every theme id and numbers the sources", () => {
  const p = buildAssignPrompt({ channelName: "Канал", topic: "тема", rubrics: [{ id: "r1", label: "Один", hint: "про один" }, { id: "r2", label: "Два" }], sources: [{ name: "S1", url: "https://s1.example/" }, { name: "S2", url: "https://s2.example/", group: "blogger" }] });
  assert.ok(p.includes("r1 — Один: про один") && p.includes("r2 — Два") && p.includes("1. S1 | https://s1.example/") && p.includes("2. S2 | https://s2.example/ | blogger"));
});

test("A2b prompt: newlines in names cannot forge numbered rows", () => {
  const p = buildAssignPrompt({ channelName: "К", topic: "т", rubrics: [{ id: "r1", label: "Один" }], sources: [{ name: "Alpha\n2. Fake Source", url: "https://a.example/" }, { name: "Beta", url: "https://b.example/" }] });
  const rows = p.split("\n").filter((l) => /^\d+\. /.test(l));
  assert.equal(rows.length, 2, rows.join(" | "));
});

test("A3 tagSource sets rubric, rubrics and time; empty list changes nothing", () => {
  const s = src("x"); assert.equal(tagSource(s, [], "t"), false); assert.equal(s.rubric, undefined);
  assert.equal(tagSource(s, ["a", "b"], "t"), true); assert.deepEqual([s.rubric, s.rubrics, s.rubricAssignedAt], ["a", ["a", "b"], "t"]);
  tagSource(s, ["a", "b", "c"], "t"); assert.deepEqual(s.rubrics, ["a", "b"], "never more than 2 themes");
});

const T = "chtotamtravel";
async function travel() {
  const t = await loadServer({ fixedNow: "2026-10-08T00:00:00Z", state: { [T]: { sources: [], migrations: [RUBRICS_V055_MIGRATION] } } });
  const ws = t.ws(T);
  const rub = channelStrategy("travel").rubrics.map((r) => r.id);
  for (const id of rub) for (let i = 0; i < 5; i++) ws.state.sources.push(src(id + i, { rubric: id }));
  ws.state.sources.push(src("skift", { name: "Skift" }), src("ator", { name: "АТОР — Новости" }), src("weird", { name: "Weird Stuff" }), src("tg-blog", { name: "Путевые заметки", group: "blogger", url: "https://t.me/s/putevye" }), src("off", { enabled: false }));
  return { t, ws, rub };
}
function fakeAi(handler) {
  const inner = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.openai.com/v1/responses") && String(JSON.parse(init.body).input || "").startsWith("Ты редактор новостной сети")) {
      const input = JSON.parse(init.body).input; calls.push(input);
      const r = await handler(input);
      return new Response(JSON.stringify(r.body), { status: r.status || 200, headers: { "content-type": "application/json" } });
    }
    return inner(url, init);
  };
  return { calls, restore() { globalThis.fetch = inner; } };
}
const answer = (obj) => ({ body: { output_text: JSON.stringify(obj), usage: {} } });

test("A4 server: loose sources get their theme from the AI, blogger group by rule, unfit stay, once only, dead ones untouched", async () => {
  const { t, ws, rub } = await travel();
  const hotels = rub.find((r) => /hotel/.test(r)) || rub[1];
  const ai = fakeAi((input) => {
    const lines = input.split("\n").filter((l) => /^\d+\. /.test(l));
    return answer({ items: lines.map((l) => { const n = Number(l.split(".")[0]); return { n, rubrics: /Skift/.test(l) ? [hotels, "no_such_theme"] : /АТОР/.test(l) ? [rub[0]] : [] }; }) });
  });
  const before = inWs(t, T, () => t.rubricSourceCounts());
  const r = await inWs(t, T, () => t.assignLooseSourcesForCurrentWorkspace());
  ai.restore();
  const by = (id) => ws.state.sources.find((s) => s.id === id);
  assert.deepEqual([by("skift").rubric, by("skift").rubrics], [hotels, [hotels]], "AI verdict applied, unknown id dropped");
  assert.equal(by("ator").rubric, rub[0]);
  assert.equal(by("weird").rubric, undefined, "nothing fits -> stays as it is"); assert.equal(by("weird").enabled, true);
  assert.ok(by("tg-blog").rubric && /blogger/.test(by("tg-blog").rubric), "blogger group by rule: " + by("tg-blog").rubric);
  assert.ok(!by("tg-blog").rubrics || by("tg-blog").rubrics.length >= 1);
  assert.equal(by("off").rubric, undefined, "switched-off sources are not touched");
  assert.equal(ai.calls.length, 1, "one call for the batch, blogger not sent");
  assert.ok(!ai.calls[0].includes("Путевые заметки"), "rule-tagged source is not sent to the AI");
  const after = inWs(t, T, () => t.rubricSourceCounts());
  assert.equal(after[hotels], before[hotels] + 1); assert.equal(after[rub[0]], before[rub[0]] + 1);
  assert.ok(ws.state.migrations.includes(ASSIGN_MARKER));
  assert.equal(r.byAi, 2); assert.equal(r.unfit, 1);
  const again = await inWs(t, T, () => t.assignLooseSourcesForCurrentWorkspace());
  assert.deepEqual(again, { skipped: "done" });
});

test("A5 server: an AI failure marks nothing and changes nothing; the next run retries", async () => {
  const { t, ws } = await travel();
  let ai = fakeAi(() => ({ status: 500, body: { error: { message: "boom" } } }));
  const origWarn = console.warn; console.warn = () => {};
  const r = await inWs(t, T, () => t.assignLooseSourcesForCurrentWorkspace());
  console.warn = origWarn; ai.restore();
  assert.equal(r.skipped, "ai_error");
  assert.ok(!ws.state.migrations.includes(ASSIGN_MARKER));
  assert.equal(ws.state.sources.find((s) => s.id === "skift").rubric, undefined);
  ai = fakeAi((input) => answer({ items: input.split("\n").filter((l) => /^\d+\. /.test(l)).map((l) => ({ n: Number(l.split(".")[0]), rubrics: [] })) }));
  const r2 = await inWs(t, T, () => t.assignLooseSourcesForCurrentWorkspace());
  ai.restore();
  assert.ok(ws.state.migrations.includes(ASSIGN_MARKER)); assert.equal(r2.unfit, 3);
});

test("A6 server: an empty or incomplete AI answer is a failed call: nothing marked, nothing judged; judged sources are not re-sent", async () => {
  const { t, ws } = await travel();
  let ai = fakeAi(() => answer({ items: [] }));
  const origWarn = console.warn; console.warn = () => {};
  let r = await inWs(t, T, () => t.assignLooseSourcesForCurrentWorkspace());
  console.warn = origWarn; ai.restore();
  assert.equal(r.skipped, "ai_error");
  assert.ok(!ws.state.migrations.includes(ASSIGN_MARKER), "marker not burnt by an empty answer");
  assert.ok(ws.state.sources.every((s) => !s.rubricAssignJudgedAt), "nobody judged");
  // a good run judges the unfit one once; a later partial failure does not re-send it
  ai = fakeAi((input) => answer({ items: input.split("\n").filter((l) => /^\d+\. /.test(l)).map((l) => ({ n: Number(l.split(".")[0]), rubrics: [] })) }));
  r = await inWs(t, T, () => t.assignLooseSourcesForCurrentWorkspace());
  ai.restore();
  assert.equal(r.unfit, 3);
  assert.ok(ws.state.sources.find((s) => s.id === "weird").rubricAssignJudgedAt, "judged once");
  ws.state.migrations = ws.state.migrations.filter((m) => m !== ASSIGN_MARKER); ws.state.sources.push(src("late", { name: "Late One" }));
  ai = fakeAi((input) => answer({ items: input.split("\n").filter((l) => /^\d+\. /.test(l)).map((l) => ({ n: Number(l.split(".")[0]), rubrics: [] })) }));
  await inWs(t, T, () => t.assignLooseSourcesForCurrentWorkspace());
  ai.restore();
  assert.equal(ai.calls.length, 1); assert.ok(ai.calls[0].includes("Late One") && !ai.calls[0].includes("Weird Stuff"), "only the new source is sent");
});

async function main() {
  let failed = 0;
  for (const [name, fn] of Object.entries(cases)) {
    try { await fn(); process.stdout.write("ok - " + name + "\n"); } catch (e) { failed++; process.stdout.write("FAIL - " + name + "\n" + (e && e.stack || e) + "\n"); }
  }
  process.stdout.write(failed ? failed + " failed\n" : "source-rubric-assign tests passed\n");
  process.exit(failed ? 1 : 0);
}
main();
