// 2026-10-04: every channel's 07:45 preparation hung on a step that never settled; the per-channel scheduler lock
// stayed taken and the 08:00/09:00/10:00 posts never went out until a restart. These cases pin the watchdog.
//   npm run test:scheduler-watchdog
process.env.TZ = "UTC";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadServer, inWs, net, listHtml, articleHtml, advance, setNow, LONG } from "./dedupe-harness.js";

const cases = {};
function test(name, fn) { cases[name] = fn; }
const src = (id, url) => ({ id, name: id, url, enabled: true, group: "media", type: "web", priority: 2 });
function captureLogs() {
  const lines = [];
  const o = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a) => lines.push(a.join(" "));
  return { lines, restore() { Object.assign(console, o); } };
}

test("W1 withDeadline: a promise that never settles is cut off with code DEADLINE; a normal one passes through", async () => {
  const t = await loadServer({ fixedNow: "2026-10-04T07:00:00Z" });
  await assert.rejects(t.withDeadline(new Promise(() => {}), 40, "x"), (e) => e.code === "DEADLINE");
  assert.equal(await t.withDeadline(Promise.resolve(7), 1000, "y"), 7);
  await assert.rejects(t.withDeadline(Promise.reject(new Error("boom")), 1000, "z"), /boom/);
});

test("W2 stuck collectors: an old run is released (flag cleared, logged with its step); fresh and publishing runs are kept", async () => {
  const t = await loadServer({ fixedNow: "2026-10-04T07:00:00Z" });
  const now = Date.now();
  const mk = (startedAgoMin, step, stepAgoMin) => ({ token: Symbol(), trigger: "slot-prep", startedAt: now - startedAgoMin * 60000, step, stepAt: now - (stepAgoMin == null ? startedAgoMin : stepAgoMin) * 60000 });
  t.collectorRuns.set("old", mk(50, "editorial", 30)); t.collectorRunningWorkspaces.add("old");
  t.collectorRuns.set("fresh", mk(5, "media")); t.collectorRunningWorkspaces.add("fresh");
  t.collectorRuns.set("moving", mk(50, "article:x", 2)); t.collectorRunningWorkspaces.add("moving");
  t.collectorRuns.set("sending", mk(90, "publish")); t.collectorRunningWorkspaces.add("sending");
  const c = captureLogs();
  let released;
  try { released = t.releaseStuckCollectors(now); t.releaseStuckCollectors(now); } finally { c.restore(); }
  assert.deepEqual(released, ["old"]);
  assert.equal(t.collectorRunningWorkspaces.has("old"), false);
  assert.equal(t.collectorRunningWorkspaces.has("fresh"), true);
  assert.equal(t.collectorRunningWorkspaces.has("moving"), true, "a run still moving between steps is slow, not stuck");
  assert.equal(t.collectorRunningWorkspaces.has("sending"), true, "a run that is sending a post is never released");
  const stuck = c.lines.filter((l) => l.startsWith("COLLECTOR_STUCK"));
  assert.ok(stuck.some((l) => /"workspace":"old".*"released":true.*"step":"editorial"/.test(l)), stuck.join("\n"));
  assert.equal(stuck.filter((l) => /"workspace":"sending"/.test(l)).length, 1, "logged once");
});

test("W3 collectOnce clears only its own registration: a newer run that took over after a release keeps its flag", async () => {
  const t = await loadServer({ fixedNow: "2026-10-04T07:00:00Z", state: { chtotampokupki: { sources: [src("a", "https://a.example/")] } } });
  let newer;
  net.pages.set("https://a.example/", () => {
    // the watchdog released this run and another run started meanwhile
    newer = Symbol("newer");
    t.collectorRuns.set("chtotampokupki", { token: newer, trigger: "manual", startedAt: Date.now(), step: "start", stepAt: Date.now() });
    return listHtml([]);
  });
  await inWs(t, "chtotampokupki", () => t.collectOnce("slot-prep"));
  assert.equal(t.collectorRuns.get("chtotampokupki").token, newer);
  assert.equal(t.collectorRunningWorkspaces.has("chtotampokupki"), true);

  // a normal run leaves nothing behind
  t.collectorRuns.clear(); t.collectorRunningWorkspaces.clear();
  net.pages.set("https://a.example/", listHtml([]));
  await inWs(t, "chtotampokupki", () => t.collectOnce("slot-prep"));
  assert.equal(t.collectorRuns.size, 0);
  assert.equal(t.isCollectorRunning("chtotampokupki"), false);
});

test("W4 a collection that runs past COLLECTOR_MAX_RUN_MINUTES stops cleanly before the next article", async () => {
  const t = await loadServer({ fixedNow: "2026-10-04T04:45:00Z", env: { COLLECTOR_MAX_RUN_MINUTES: "5", CROSS_CHANNEL_DEDUPE_ENABLED: "false" }, state: { chtotampokupki: { sources: [src("a", "https://a.example/")] } } });
  net.pages.set("https://a.example/", () => { advance(6 * 60000); return listHtml([{ href: "https://a.example/n/1", text: "Ozon сократит срок возврата денег до трёх дней для всех покупателей" }]); });
  net.pages.set("https://a.example/n/1", articleHtml({ title: "Ozon сократит срок возврата денег", date: "2026-10-04T04:00:00Z", body: "Текст новости." + LONG }));
  const c = captureLogs();
  let r;
  try { r = await inWs(t, "chtotampokupki", () => t.collectOnce("slot-prep")); } finally { c.restore(); }
  assert.equal(r.timedOut, true, JSON.stringify(r));
  assert.equal(r.found, 0);
  assert.ok(c.lines.some((l) => l.startsWith("COLLECTOR_RUN_LIMIT")), c.lines.join("\n").slice(0, 400));
  assert.equal(t.isCollectorRunning("chtotampokupki"), false);
});

test("W5 a hung 07:45 preparation is cut off: the tick returns, logs where it hung, and does not mark the slot done", async () => {
  const t = await loadServer({ fixedNow: "2026-10-04T04:45:00Z", env: { SCHEDULER_PREPARE_TIMEOUT_MINUTES: "0.02", AUTO_PUBLISH_ENABLED: "true" }, state: { chtotampokupki: { sources: [src("a", "https://a.example/")] } } });
  net.pages.set("https://a.example/", () => new Promise(() => {})); // never answers
  setNow("2026-10-04T04:" + String(t.prepMinuteFor("chtotampokupki")).padStart(2, "0") + ":00Z"); // its own picking minute
  const c = captureLogs();
  const started = performance.now();
  try { await inWs(t, "chtotampokupki", () => t.dynamicSchedulerTick()); } finally { c.restore(); }
  assert.ok(performance.now() - started < 20000, "tick returned");
  const line = c.lines.find((l) => l.startsWith("SCHEDULER_TICK_TIMEOUT"));
  assert.ok(line, c.lines.join("\n").slice(0, 600));
  assert.match(line, /"action":"prepare"/);
  assert.match(line, /"step":"sources:1"/, "the log names the hung step");
  assert.notEqual(t.ws("chtotampokupki").state.dynamicScheduler.lastTickKey, t.ws("chtotampokupki").state.dynamicScheduler.lastAttemptedTickKey, "slot not marked done");
});

test("W6 a released (zombie) run that wakes up stops instead of queueing next to the new run: the article is queued once", async () => {
  const WS = "chtotampokupki", URL1 = "https://a.example/n/1";
  const t = await loadServer({ fixedNow: "2026-10-04T04:45:00Z", env: { CROSS_CHANNEL_DEDUPE_ENABLED: "false" }, state: { [WS]: { sources: [src("a", "https://a.example/")] } } });
  net.pages.set("https://a.example/", listHtml([{ href: URL1, text: "Ozon сократит срок возврата денег до трёх дней для всех покупателей" }]));
  const art = articleHtml({ title: "Ozon сократит срок возврата денег", date: "2026-10-04T04:00:00Z", body: "Текст новости." + LONG });
  const gates = [];
  net.pages.set(URL1, () => new Promise((res) => gates.push(() => res(art))));
  const until = async (f) => { for (let i = 0; i < 500 && !f(); i++) await new Promise((r) => setTimeout(r, 10)); assert.ok(f(), "timeout waiting"); };
  const c = captureLogs();
  try {
    const A = inWs(t, WS, () => t.collectOnce("slot-prep"));
    await until(() => gates.length === 1);
    advance(41 * 60000);
    assert.deepEqual(t.releaseStuckCollectors(), [WS]);
    const B = inWs(t, WS, () => t.collectOnce("manual"));
    await until(() => gates.length === 2);
    const tokB = t.collectorRuns.get(WS).token;
    gates[0]();
    const rA = await A;
    assert.equal(rA.released, true, JSON.stringify(rA));
    assert.equal(t.collectorRuns.get(WS).token, tokB, "the zombie did not touch the new run's record");
    assert.match(t.collectorRuns.get(WS).step, /^article:/);
    gates[1]();
    const rB = await B;
    assert.equal(rB.queued, 1, JSON.stringify(rB));
  } finally { c.restore(); }
  assert.equal(t.ws(WS).state.queue.filter((x) => x && x.sourceUrl === URL1).length, 1);
  assert.ok(c.lines.some((l) => l.startsWith("COLLECTOR_ZOMBIE_STOPPED")));
  assert.equal(t.isCollectorRunning(WS), false);
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
  console.log(failed ? failed + " failed" : "scheduler-watchdog tests passed");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
