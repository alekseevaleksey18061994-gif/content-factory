// 2026-10-04: every channel collected at :45 at once. Each channel now collects at its own minute (:10–:40) and
// :45 only picks the post from the queue.
//   npm run test:staggered-collection
process.env.TZ = "UTC";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadServer, inWs, net, listHtml, mkQueueItem, setNow } from "./dedupe-harness.js";

const cases = {};
function test(name, fn) { cases[name] = fn; }
const src = (id, url) => ({ id, name: id, url, enabled: true, group: "media", type: "web", priority: 2 });
const WS = "chtotamtech";
const mskToUtc = (hh, mm) => `2026-10-04T${String(hh - 3).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`;
function quiet(fn) {
  const lines = []; const o = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a) => lines.push(a.join(" "));
  return Promise.resolve().then(fn).finally(() => Object.assign(console, o)).then(() => lines);
}

test("S1 every channel gets its own minute in :10–:40, spread out and stable", async () => {
  const t = await loadServer({ fixedNow: mskToUtc(9, 0) });
  const ids = t.workspaceStore.workspaces.map((w) => w.id);
  assert.ok(ids.length >= 10, "network loaded: " + ids.length);
  const minutes = ids.map((id) => t.collectionMinuteFor(id));
  for (const m of minutes) assert.ok(m >= 10 && m <= 40, String(m));
  const sorted = ids.slice().sort();
  assert.equal(t.collectionMinuteFor(sorted[0]), 10);
  assert.equal(t.collectionMinuteFor(sorted[sorted.length - 1]), 40);
  // at most 2 channels share a minute
  const counts = {}; minutes.forEach((m) => { counts[m] = (counts[m] || 0) + 1; });
  assert.ok(Math.max(...Object.values(counts)) <= 2, JSON.stringify(counts));
  assert.deepEqual(ids.map((id) => t.collectionMinuteFor(id)), minutes, "stable");
});

test("S2 the scheduler collects once at the channel's own minute and nowhere else; slot keys untouched", async () => {
  const t = await loadServer({ fixedNow: mskToUtc(9, 0), env: { AUTO_PUBLISH_ENABLED: "true" }, state: { [WS]: { sources: [src("a", "https://a.example/")], mode: "AUTO" } } });
  let fetches = 0;
  net.pages.set("https://a.example/", () => { fetches += 1; return listHtml([]); });
  const m = t.collectionMinuteFor(WS);
  const other = m >= 20 ? m - 5 : m + 9;
  setNow(mskToUtc(9, other));
  await quiet(() => inWs(t, WS, () => t.dynamicSchedulerTick()));
  assert.equal(fetches, 0, "not this channel's minute (" + other + " vs " + m + ")");
  setNow(mskToUtc(9, m));
  const before = JSON.stringify({ k: t.ws(WS).state.dynamicScheduler && t.ws(WS).state.dynamicScheduler.lastTickKey });
  const lines = await quiet(() => inWs(t, WS, () => t.dynamicSchedulerTick()));
  assert.equal(fetches, 1, lines.join("\n").slice(0, 400));
  assert.ok(lines.some((l) => l.startsWith("STAGGERED_COLLECT ")), lines.join("\n").slice(0, 400));
  const ds = t.ws(WS).state.dynamicScheduler;
  assert.equal(ds.lastCollectKey, "2026-10-04-09-collect");
  assert.equal(JSON.stringify({ k: ds.lastTickKey }), before, "lastTickKey not touched");
  setNow(mskToUtc(9, m + 2));
  await quiet(() => inWs(t, WS, () => t.dynamicSchedulerTick()));
  assert.equal(fetches, 1, "once per hour");
  setNow(mskToUtc(10, m));
  await quiet(() => inWs(t, WS, () => t.dynamicSchedulerTick()));
  assert.equal(fetches, 2, "again next hour");
});

test("S3 at :45 a channel that already collected this hour picks from the queue without collecting; an empty queue still collects", async () => {
  const t = await loadServer({ fixedNow: mskToUtc(9, 45), state: { [WS]: { sources: [src("a", "https://a.example/")], mode: "AUTO" } } });
  let fetches = 0;
  net.pages.set("https://a.example/", () => { fetches += 1; return listHtml([]); });
  const st = t.ws(WS).state;
  st.dynamicScheduler = { lastCollectKey: "2026-10-04-09-collect" };
  st.queue = [mkQueueItem({ id: "q1", newsId: "n1" })];
  const r = await quiet(() => inWs(t, WS, () => t.prepareDynamicSlot())).then(() => null);
  const prepared = await inWs(t, WS, async () => t.ensureScheduleShape(t.ws(WS).state).assignments["2026-10-04"]["10:00"]);
  assert.equal(prepared, "q1");
  assert.equal(fetches, 0, "no collection at :45");
  // nothing usable in the queue -> falls back to collecting
  st.queue = [];
  await quiet(() => inWs(t, WS, () => t.prepareDynamicSlot()));
  assert.equal(fetches, 1);
  // a channel whose staggered run did not happen this hour collects at :45 as before
  st.dynamicScheduler = { lastCollectKey: "2026-10-04-08-collect" };
  st.queue = [mkQueueItem({ id: "q2", newsId: "n2" })];
  await quiet(() => inWs(t, WS, () => t.prepareDynamicSlot()));
  assert.equal(fetches, 2);
});

test("S4 no staggered collection outside slot hours, in PAUSED mode, or when disabled", async () => {
  const t = await loadServer({ fixedNow: mskToUtc(9, 0), state: { [WS]: { sources: [src("a", "https://a.example/")], mode: "AUTO" } } });
  let fetches = 0;
  net.pages.set("https://a.example/", () => { fetches += 1; return listHtml([]); });
  const m = t.collectionMinuteFor(WS);
  setNow(`2026-10-04T00:${String(m).padStart(2, "0")}:00Z`); // 03:xx MSK
  await quiet(() => inWs(t, WS, () => t.staggeredCollectTick("2026-10-04", 3, m)));
  t.ws(WS).state.mode = "PAUSED";
  await quiet(() => inWs(t, WS, () => t.staggeredCollectTick("2026-10-04", 9, m)));
  assert.equal(fetches, 0);
  const t2 = await loadServer({ fixedNow: mskToUtc(9, 0), env: { COLLECTION_STAGGER_ENABLED: "false" }, state: { [WS]: { sources: [src("a", "https://a.example/")], mode: "AUTO" } } });
  await quiet(() => inWs(t2, WS, () => t2.staggeredCollectTick("2026-10-04", 9, t2.collectionMinuteFor(WS))));
  assert.equal(fetches, 0);
});

test("S5 picking is spread over :41–:57 and posting over :00–:10, same channel order; collect < pick each hour", async () => {
  const t = await loadServer({ fixedNow: mskToUtc(9, 0) });
  const ids = t.workspaceStore.workspaces.map((w) => w.id).sort();
  let prevPub = -1;
  for (const id of ids) {
    const c = t.collectionMinuteFor(id), p = t.prepMinuteFor(id), u = t.publishMinuteFor(id);
    assert.ok(p >= 41 && p <= 57, id + " pick " + p);
    assert.ok(u >= 0 && u <= 10, id + " post " + u);
    assert.ok(c + 8 <= p, id + ": collection window ends before picking (" + c + "/" + p + ")");
    assert.ok(c >= u + 10, id + ": collection after its own post window (" + u + "/" + c + ")");
    assert.ok(u >= prevPub, "same order"); prevPub = u;
  }
  assert.equal(t.publishMinuteFor(ids[0]), 0);
  assert.equal(t.publishMinuteFor(ids[ids.length - 1]), 10);
  assert.equal(t.prepMinuteFor(ids[0]), 41);
  assert.equal(t.prepMinuteFor(ids[ids.length - 1]), 57);
});

test("S6 a late channel does not post at :00: neither the tick nor the catch-up publishes before its own minute", async () => {
  const t0 = await loadServer({ fixedNow: mskToUtc(10, 0) });
  const ids = t0.workspaceStore.workspaces.map((w) => w.id).sort();
  const late = ids[ids.length - 1];
  const t = await loadServer({ fixedNow: mskToUtc(10, 0), env: { AUTO_PUBLISH_ENABLED: "true" }, autoPublish: true, state: { [late]: { mode: "AUTO", queue: [mkQueueItem({ id: "q1", newsId: "n1" })] } } });
  const at0 = (await quiet(() => inWs(t, late, () => t.dynamicSchedulerTick()))).concat(await quiet(() => t.catchUpCurrentRegularSlotAllWorkspaces()));
  assert.ok(!at0.some((l) => l.includes("publish " + late) || (l.startsWith("SCHEDULER_CATCHUP") && l.includes(late))), "nothing for " + late + " at :00 (its minute is " + t.publishMinuteFor(late) + "):\n" + at0.join("\n").slice(0, 500));
  assert.ok(!t.ws(late).state.history || !t.ws(late).state.history.length, "nothing published at :00");
  setNow(mskToUtc(10, t.publishMinuteFor(late)));
  const lines = await quiet(() => inWs(t, late, () => t.dynamicSchedulerTick()));
  assert.ok(lines.some((l) => l.startsWith("Dynamic scheduler publish " + late)), lines.join("\n").slice(0, 500));
});

test("S7 catch-up still recovers a missed post up to :44, also for a channel that picks at :41", async () => {
  const t0 = await loadServer({ fixedNow: mskToUtc(10, 42) });
  const first = t0.workspaceStore.workspaces.map((w) => w.id).sort()[0];
  assert.equal(t0.prepMinuteFor(first), 41);
  const t = await loadServer({ fixedNow: mskToUtc(10, 42), env: { AUTO_PUBLISH_ENABLED: "true" }, autoPublish: true, state: { [first]: { mode: "AUTO", queue: [mkQueueItem({ id: "q1", newsId: "n1" })] } } });
  const lines = await quiet(() => t.catchUpCurrentRegularSlotAllWorkspaces());
  assert.ok(lines.some((l) => l.startsWith("SCHEDULER_CATCHUP_START") && l.includes(first)), lines.join("\n").slice(0, 500));
});

async function main() {
  const only1 = process.argv[2];
  if (only1) {
    const name = Object.keys(cases).find((n) => n === only1 || n.startsWith(only1 + " "));
    if (!name) throw new Error("unknown case " + only1);
    await cases[name]();
    process.exit(0);
  }
  let failed = 0;
  for (const name of Object.keys(cases)) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name.split(" ")[0]], { env: Object.assign({}, process.env, { TZ: "UTC" }), encoding: "utf8", timeout: 180000 });
    if (r.status === 0) console.log("ok - " + name);
    else { failed += 1; console.log("FAIL - " + name + "\n" + String(r.stderr || r.stdout).split("\n").filter((l) => !/^    at/.test(l)).slice(0, 20).join("\n")); }
  }
  console.log(failed ? failed + " failed" : "staggered-collection tests passed");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
