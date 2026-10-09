// 2026-10-09 QA page: travel/crypto showed 57% "Ошибка" because the editor skipped the control material
// (daily limit / repeat) -> bucket, Channel Score, fact-check stayed empty and turned red.
//   npm run test:qa-skip
import assert from "node:assert/strict";
import { loadServer, mkQueueItem } from "./dedupe-harness.js";

let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log("ok - " + name); }
const CHAN = "chtotamtachki";
const SIGNALS = { virality: 5, utility: 5, discussion: 5, visual: 5, wow: 5, local: 5, deal: 5 };
const qItem = (id) => mkQueueItem({ id, newsId: "n_" + id, sourceOriginalTitle: "Title " + id, sourceOriginalText: "Text of the source " + id + " ".repeat(5) });

async function load() {
  const t = await loadServer({ fixedNow: "2026-10-09T08:50:00Z", state: { [CHAN]: { migrations: ["v0.53.0-car-rubrics"], sources: [] } } });
  t.ws(CHAN).state.queue = [qItem("a"), qItem("b"), qItem("c"), qItem("d")];
  return t;
}
function stubPipeline(t, plan) {
  const calls = [];
  t.editorialPipeline().run = async (channelId, request) => {
    calls.push({ posts_today: request.posts_today });
    const kind = plan[Math.min(calls.length - 1, plan.length - 1)];
    if (kind === "skip") return { status: "skip", verdict: "skip", rounds: 0, errors: [], checkers: [], post: { importance: 6, skipReason: "низкая важность при достигнутом дневном лимите" } };
    return { status: "approved", verdict: "pass", rounds: 0, errors: [], checkers: [], post: { importance: 7, contentBucket: Object.keys(t.channelStrategy(channelId).mix)[0], channelSignals: SIGNALS, title: "Заголовок", tgText: "Текст поста" } };
  };
  return calls;
}

await test("Q1 the control run ignores the daily limit (posts_today = 0)", async () => {
  const t = await load();
  t.ws(CHAN).state.history = Array.from({ length: 30 }, (_, i) => ({ id: "h" + i, title: "x", publishedAt: "2026-10-09T05:00:00Z" }));
  const calls = stubPipeline(t, ["pass"]);
  await t.runEditorialQaForWorkspace(t.ws(CHAN));
  assert.equal(calls[0].posts_today, 0);
  t.restoreConsole();
});
await test("Q2 a skipped first candidate is replaced by the next one and the channel is not marked as failing", async () => {
  const t = await load();
  const calls = stubPipeline(t, ["skip", "pass"]);
  const r = await t.runEditorialQaForWorkspace(t.ws(CHAN));
  assert.equal(calls.length, 2);
  const bad = r.checks.filter((c) => c.required !== false && !c.pass).map((c) => c.key);
  assert.ok(!bad.includes("bucket") && !bad.includes("signals") && !bad.includes("qc"), "failed: " + bad.join(","));
  t.restoreConsole();
});
await test("Q3 every probe skipped: the three draft checks are not counted, no false error", async () => {
  const t = await load();
  const calls = stubPipeline(t, ["skip"]);
  const r = await t.runEditorialQaForWorkspace(t.ws(CHAN));
  assert.equal(calls.length, 3, "at most 3 probes");
  for (const key of ["bucket", "signals", "qc", "style"]) assert.equal(r.checks.find((c) => c.key === key).required, false, key);
  assert.equal(r.status, "pass");
  assert.equal(r.percent, 100);
  t.restoreConsole();
});
console.log("qa-skip tests passed (" + passed + ")");
process.exit(0);
