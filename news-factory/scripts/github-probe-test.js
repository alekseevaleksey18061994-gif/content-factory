// 2026-10-09 «Подключения → Разработка и AI»: "Claude Code / GitHub Actions" showed «Не подключено · HTTP 403» (shared-IP rate limit
// of api.github.com) and "Anthropic API" followed it although the key works.
//   npm run test:github-probe
import assert from "node:assert/strict";
import { loadServer } from "./dedupe-harness.js";

let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log("ok - " + name); }

const realFetch = globalThis.fetch;
function mockGithub(mode, counter) {
  globalThis.fetch = async (url, opts) => {
    if (!String(url).startsWith("https://api.github.com/")) return realFetch(url, opts);
    counter.n += 1;
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body, headers: new Map() });
    if (mode.v === "limited") return json(403, { message: "API rate limit exceeded" });
    if (String(url).includes("/actions/workflows/")) return json(200, { workflow_runs: [{ run_number: 104, status: "completed", conclusion: "success" }] });
    return json(200, {});
  };
}

await test("G1 a good answer is cached for 10 minutes (no GitHub request per status refresh)", async () => {
  const t = await loadServer({ fixedNow: "2026-10-09T08:50:00Z" });
  const counter = { n: 0 }, mode = { v: "ok" };
  mockGithub(mode, counter);
  const a = await t.githubAutomationProbe();
  const after = counter.n;
  const b = await t.githubAutomationProbe();
  assert.equal(a.workflowOk, true);
  assert.equal(b.workflowOk, true);
  assert.equal(counter.n, after, "second call served from cache");
  t.restoreConsole();
});
await test("G2 rate limit (403) after a good answer: the last good result is kept and marked stale", async () => {
  const t = await loadServer({ fixedNow: "2026-10-09T08:50:00Z" });
  const counter = { n: 0 }, mode = { v: "ok" };
  mockGithub(mode, counter);
  await t.githubAutomationProbe();
  mode.v = "limited";
  t.githubProbeCache.at = 0; // cache expired
  const r = await t.githubAutomationProbe();
  assert.equal(r.workflowOk, true);
  assert.equal(r.stale, true);
  assert.equal(r.latestConclusion, "success");
  t.restoreConsole();
});
await test("G3 rate limit with no earlier good answer is reported as such (error kept)", async () => {
  const t = await loadServer({ fixedNow: "2026-10-09T08:50:00Z" });
  const counter = { n: 0 }, mode = { v: "limited" };
  mockGithub(mode, counter);
  const r = await t.githubAutomationProbe();
  assert.equal(r.workflowOk, false);
  assert.match(r.error, /HTTP 403/);
  t.restoreConsole();
});
globalThis.fetch = realFetch;
console.log("github-probe tests passed (" + passed + ")");
process.exit(0);
