// v0.66.0: dead sources are removed and never come back; only live sources count.
//   npm run test:source-cleanup
process.env.TZ = "UTC";
import assert from "node:assert/strict";
import { planSourceCleanup, sweepCandidates, applySourceRemoval, REMOVED_LOG_LIMIT } from "../lib/source-cleanup.js";
import { sourceKey, freshCandidates } from "../lib/source-quality.js";
import { loadServer, inWs } from "./dedupe-harness.js";
import { channelStrategy } from "../lib/channel-dna.js";
import { RUBRICS_V055_MIGRATION } from "../lib/channel-rubrics-v055.js";

const NOW = Date.parse("2026-10-08T00:00:00Z");
const ago = (h) => new Date(NOW - h * 3600000).toISOString();
const src = (id, extra) => Object.assign({ id, name: id, url: "https://" + id + ".example/news/", enabled: true, group: "media", type: "web" }, extra || {});
const cases = {};
const test = (n, f) => { cases[n] = f; };

test("S1 plan: switched-off sources are dead; loose ones are separate; live themed sources are kept", () => {
  const groups = new Set(["a", "b"]);
  const p = planSourceCleanup([
    src("live", { rubric: "a" }), src("multi", { rubric: "zzz", rubrics: ["b"] }),
    src("paused", { rubric: "a", enabled: false, autoPaused: { reason: "10 новостей подряд", at: ago(5) } }),
    src("manual-off", { rubric: "a", enabled: false }),
    src("loose-off", { enabled: false }), src("loose-on", {}), null
  ], { groupIds: groups, includeEnabledLoose: true });
  assert.deepEqual(p.dead.map((x) => x.id).sort(), ["loose-off", "manual-off", "paused"]);
  assert.deepEqual(p.looseEnabled.map((x) => x.id), ["loose-on"]);
  assert.equal(p.keepCount, 2);
  assert.ok(/пауза системы/.test(p.dead.find((x) => x.id === "paused").why));
  const p2 = planSourceCleanup([src("loose-on", {})], { groupIds: groups, includeEnabledLoose: false });
  assert.equal(p2.remove.length, 0, "enabled loose kept unless asked"); assert.deepEqual(p2.looseKept.map((x) => x.id), ["loose-on"], "and reported");
  assert.equal(planSourceCleanup([src("x", {})], { groupIds: new Set(), includeEnabledLoose: true }).remove.length, 0, "a channel without groups has no 'loose'");
});

test("S2 sweep: only auto-paused sources older than the grace period; editor-enabled and manual-off are safe", () => {
  const list = [
    src("old", { enabled: false, autoPaused: { reason: "r", at: ago(30) } }),
    src("fresh", { enabled: false, autoPaused: { reason: "r", at: ago(2) } }),
    src("manual", { enabled: false }),
    src("on", { autoPaused: { reason: "r", at: ago(99) } }),
    src("editor", { enabled: false, autoPaused: { reason: "r", at: ago(99) }, editorEnabledAt: ago(24) })
  ];
  assert.deepEqual(sweepCandidates(list, NOW).map((x) => x.id), ["old"]);
});

test("S3 removal blocks the source from coming back  and keeps a bounded log", () => {
  const st = { sources: [src("gone", { rubric: "a" }), src("stay", { rubric: "a" })], sourceBlockedHosts: ["old.example"], sourceStats: {} };
  const n = applySourceRemoval(st, [{ id: "gone", name: "gone", url: "https://gone.example/news/", why: "x" }], [sourceKey], "2026-10-08T00:00:00Z", "тест");
  assert.equal(n, 1); assert.deepEqual(st.sources.map((s) => s.id), ["stay"]);
  assert.ok(st.sourceBlockedHosts.includes("old.example") && st.sourceBlockedHosts.includes(sourceKey("https://gone.example/news/")));
  const again = freshCandidates([{ name: "gone", url: "https://www.gone.example/news/", group: "media" }, { name: "new", url: "https://new.example/", group: "media" }], st.sources, st.sourceBlockedHosts);
  assert.deepEqual(again.map((c) => c.name), ["new"], "a removed source is not offered again");
  assert.equal(st.removedSources[0].rubric, "a");
  const st3 = { sources: [src("k3", { url: "https://www.kommersant.ru/rubric/3" })] };
  applySourceRemoval(st3, [{ id: "k3", name: "k3", url: "https://www.kommersant.ru/rubric/3" }], [sourceKey], "t", "x");
  assert.deepEqual(freshCandidates([{ name: "sibling", url: "https://www.kommersant.ru/rubric/4", group: "media" }, { name: "same", url: "https://www.kommersant.ru/rubric/3", group: "media" }], st3.sources, st3.sourceBlockedHosts).map((c) => c.name), ["sibling"], "a sibling section stays available");
  const many = Array.from({ length: REMOVED_LOG_LIMIT + 50 }, (_, i) => ({ id: "n" + i, name: "n" + i, url: "https://n" + i + ".example/" }));
  const st2 = { sources: many.map((m) => src(m.id)) };
  applySourceRemoval(st2, many, [sourceKey], "t", "x");
  assert.equal(st2.removedSources.length, REMOVED_LOG_LIMIT);
});

const T = "chtotamtravel";
async function travel(env) {
  const t = await loadServer({ fixedNow: "2026-10-08T00:00:00Z", env: env || { SOURCE_DEAD_SWEEP_WARMUP_S: "0" }, state: { [T]: { sources: [], migrations: [RUBRICS_V055_MIGRATION] } } });
  const ws = t.ws(T);
  const rub = channelStrategy("travel").rubrics.map((r) => r.id);
  for (const id of rub) for (let i = 0; i < 6; i++) ws.state.sources.push(src(id + i, { rubric: id }));
  ws.state.sources.push(src("dead-old", { rubric: rub[0], enabled: false, autoPaused: { reason: "10 новостей подряд отсеяны", at: ago(40) } }));
  ws.state.sources.push(src("dead-fresh", { rubric: rub[0], enabled: false, autoPaused: { reason: "10 новостей подряд отсеяны", at: ago(1) } }));
  ws.state.sources.push(src("manual-off", { rubric: rub[1], enabled: false }));
  ws.state.sources.push(src("loose-off", { enabled: false }));
  ws.state.sources.push(src("loose-on", {}));
  return { t, ws, rub };
}

test("S4 server: the automatic sweep removes a day-old auto-pause only, blocks it, and live counts are untouched", async () => {
  const { t, ws, rub } = await travel();
  const before = inWs(t, T, () => t.rubricSourceCounts());
  inWs(t, T, () => t.autoPauseWeakSources());
  const ids = ws.state.sources.map((s) => s.id);
  assert.ok(!ids.includes("dead-old")); assert.ok(ids.includes("dead-fresh")); assert.ok(ids.includes("manual-off"));
  assert.ok(ws.state.sourceBlockedHosts.includes(sourceKey("https://dead-old.example/news/")));
  assert.deepEqual(inWs(t, T, () => t.rubricSourceCounts()), before, "only live sources are counted, removal of dead ones changes nothing");
  assert.equal(before[rub[0]], 6);
});

test("S5 server: one-time clean-up reports without SOURCE_CLEANUP_EXECUTE and removes dead + loose when executed, once", async () => {
  const { t, ws } = await travel();
  const total = ws.state.sources.length;
  const dry = inWs(t, T, () => t.sourceCleanupForCurrentWorkspace(false));
  assert.equal(dry.removed, 0); assert.equal(ws.state.sources.length, total, "dry run changes nothing");
  assert.equal(dry.dead, 4); assert.equal(dry.looseEnabledKept, 1);
  ws.state.sources.push(src("manual-added", { group: "custom" }), src("tg-lane", { group: "blogger", url: "https://t.me/s/somechan" }));
  const done = inWs(t, T, () => t.sourceCleanupForCurrentWorkspace(true));
  assert.equal(done.removed, 4);
  const left = ws.state.sources.map((s) => s.id);
  for (const gone of ["dead-old", "dead-fresh", "manual-off", "loose-off"]) assert.ok(!left.includes(gone), gone);
  for (const live of ["loose-on", "manual-added", "tg-lane"]) assert.ok(left.includes(live), "enabled source kept: " + live);
  assert.ok(!ws.state.sourceBlockedHosts.includes(sourceKey("https://loose-on.example/news/")), "a live source is never blocked");
  assert.equal(ws.state.removedSources.length, 4);
  assert.deepEqual(inWs(t, T, () => t.sourceCleanupForCurrentWorkspace(true)), { skipped: "done" }, "runs once");
});

test("S6 the sweep waits for the start-up restore migrations (warm-up), then works", async () => {
  const { t, ws } = await travel({ SOURCE_DEAD_SWEEP_WARMUP_S: "" }); // default warm-up (15 min): the test process is younger than that
  inWs(t, T, () => t.autoPauseWeakSources());
  assert.ok(ws.state.sources.some((s) => s.id === "dead-old"), "not swept during warm-up");
  assert.ok(!(ws.state.sourceBlockedHosts || []).includes(sourceKey("https://dead-old.example/news/")));
});

async function main() {
  let failed = 0;
  for (const [name, fn] of Object.entries(cases)) {
    try { await fn(); process.stdout.write("ok - " + name + "\n"); } catch (e) { failed++; process.stdout.write("FAIL - " + name + "\n" + (e && e.stack || e) + "\n"); }
  }
  process.stdout.write(failed ? failed + " failed\n" : "source-cleanup tests passed\n");
  process.exit(failed ? 1 : 0);
}
main();
