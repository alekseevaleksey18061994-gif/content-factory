// Regression tests for the publishing audit fixes: a failing VK must not stall a channel, one publish of a post
// at a time, unknown workspace ids are rejected (and removed channels stay isolated from the default one),
// stale slot assignments do not reserve the best post, source media in an album obeys the copyright filter.
//   npm run test:publish-guards
import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadServer, inWs, mkQueueItem } from "./dedupe-harness.js";

const cases = {};
function test(name, fn) { cases[name] = fn; }

function req(t, method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port: t.server.address().port, method, path, headers: Object.assign({ "content-type": "application/json" }, headers || {}) }, (res) => {
      let data = ""; res.on("data", (c) => { data += c; }); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on("error", reject); if (body) r.write(JSON.stringify(body)); r.end();
  });
}
async function login(t) {
  await new Promise((r) => setTimeout(r, 300));
  const r = await req(t, "POST", "/api/login", {}, { password: "x" });
  assert.equal(r.status, 200, "login: " + r.body);
  return String(r.headers["set-cookie"] || "").split(";")[0];
}

test("P1 a post already on Telegram whose VK failed is not a slot candidate any more", async () => {
  const t = await loadServer({ fixedNow: "2026-10-02T09:00:00Z", env: { VK_AUTO_RETRY_MAX: "2" } });
  const ws = "chtotamcrypto";
  const stuck = mkQueueItem({ id: "stuck", newsId: "nstuck", aiScore: 99, telegramPublished: true, vkAttempts: 2 });
  const fresh = mkQueueItem({ id: "fresh", newsId: "nfresh", aiScore: 60 });
  t.ws(ws).state.queue = [stuck, fresh];
  const best = inWs(t, ws, () => t.dynamicBestQueueItemRaw(undefined, false));
  assert.equal(best && best.id, "fresh", "stuck post must not be chosen");
  const pending = inWs(t, ws, () => t.pendingAutoTargets(stuck));
  assert.deepEqual(pending, { telegram: false, vk: false });
});

test("P2 only one publish of the same post can be in flight", async () => {
  const t = await loadServer({ fixedNow: "2026-10-02T09:00:00Z" });
  const a = inWs(t, "chtotamcrypto", () => t.acquirePublishLock("q1"));
  const b = inWs(t, "chtotamcrypto", () => t.acquirePublishLock("q1"));
  const other = inWs(t, "chtotamtravel" in {} ? "x" : "chtotamstars", () => t.acquirePublishLock("q1"));
  assert.equal(typeof a, "function");
  assert.equal(b, null, "second acquire is refused");
  assert.equal(typeof other, "function", "same post id in another channel is independent");
  a();
  assert.equal(typeof inWs(t, "chtotamcrypto", () => t.acquirePublishLock("q1")), "function", "released lock can be taken again");
});

test("P3 unknown X-Workspace-Id -> 404, known id works, workspace list tolerates a stale id", async () => {
  const t = await loadServer({ fixedNow: "2026-10-02T09:00:00Z" });
  const cookie = await login(t);
  const bad = await req(t, "GET", "/api/dashboard", { cookie, "x-workspace-id": "no-such-channel" });
  assert.equal(bad.status, 404);
  assert.equal(JSON.parse(bad.body).code, "unknown_workspace");
  const badPost = await req(t, "POST", "/api/queue/publish", { cookie, "x-workspace-id": "no-such-channel" }, { id: "x" });
  assert.equal(badPost.status, 404, "a publish must never fall back to the default channel");
  const good = await req(t, "GET", "/api/dashboard", { cookie, "x-workspace-id": "chtotamcrypto" });
  assert.equal(good.status, 200);
  const list = await req(t, "GET", "/api/workspaces", { cookie, "x-workspace-id": "no-such-channel" });
  assert.equal(list.status, 200, "the cabinet list repairs a stale selection");
  const noHeader = await req(t, "GET", "/api/dashboard", { cookie });
  assert.equal(noHeader.status, 200, "no header keeps the default behaviour");
});

test("P4 a background task of a removed channel is isolated from the default channel", async () => {
  const t = await loadServer({ fixedNow: "2026-10-02T09:00:00Z" });
  const defId = t.workspaceStore.defaultWorkspaceId;
  const before = JSON.stringify(t.workspaceStore.workspaces.find((w) => w.id === defId).state.sources);
  await inWs(t, "ghost-channel", async () => {
    assert.equal(t.currentWorkspace().orphan, true);
    assert.equal(t.currentWorkspace().telegramChannel, "");
    t.state.sources = [{ id: "leak", name: "leak", url: "https://x.example/", enabled: true }];
    t.state.queue.push({ id: "leakq" });
  });
  const def = t.workspaceStore.workspaces.find((w) => w.id === defId).state;
  assert.equal(JSON.stringify(def.sources), before, "default channel sources untouched");
  assert.ok(!(def.queue || []).some((q) => q.id === "leakq"), "default channel queue untouched");
});

test("P5 a missed or REVIEW-mode slot assignment stops reserving the best post", async () => {
  const t = await loadServer({ fixedNow: "2026-10-02T15:00:00Z" }); // 18:00 Moscow
  const ws = "chtotamcrypto";
  const best = mkQueueItem({ id: "best", newsId: "nbest", aiScore: 99 });
  const other = mkQueueItem({ id: "other", newsId: "nother", aiScore: 50 });
  t.ws(ws).state.queue = [best, other];
  await inWs(t, ws, async () => {
    const schedule = t.ensureScheduleShape(t.state);
    schedule.assignments["2026-10-01"] = { "12:00": "best" };           // yesterday
    schedule.assignments["2026-10-02"] = { "10:00": "best" };           // today, long past
    assert.equal(t.dynamicUsedQueueIds().has("best"), false, "expired assignments are ignored");
    schedule.assignments["2026-10-02"] = { "18:00": "best" };           // current slot
    assert.equal(t.dynamicUsedQueueIds().has("best"), true, "current slot assignment still reserves");
    schedule.assignments["2026-10-03"] = { "09:00": "other" };          // tomorrow (manual calendar)
    assert.equal(t.dynamicUsedQueueIds().has("other"), true, "future assignment still reserves");
  });
});

test("P6 REVIEW mode: the slot is released instead of locking the best post", async () => {
  const t = await loadServer({ fixedNow: "2026-10-02T09:00:00Z", env: { AUTO_PUBLISH_ENABLED: "true" } }); // 12:00 Moscow
  const ws = "chtotamcrypto";
  const item = mkQueueItem({ id: "best", newsId: "nbest", aiScore: 99 });
  t.ws(ws).state.queue = [item];
  t.ws(ws).state.mode = "REVIEW";
  const r = await inWs(t, ws, async () => {
    const schedule = t.ensureScheduleShape(t.state);
    schedule.assignments["2026-10-02"] = { "12:00": "best" };
    return await t.publishDynamicSlot();
  });
  assert.equal(r.skipped, "auto_disabled");
  const schedule = t.ws(ws).state.dynamicScheduler;
  assert.ok(schedule && schedule.lastPublishedSlot === "2026-10-02 12:00");
  assert.equal(inWs(t, ws, () => t.dynamicUsedQueueIds().has("best")), false);
});

test("P7 blocked source media does not leak through the album pack", async () => {
  const t = await loadServer({ fixedNow: "2026-10-02T09:00:00Z", env: { GENERATE_COVER_IF_MISSING: "false", MEDIA_REQUIRED: "false" } });
  const out = await inWs(t, "chtotamcrypto", () => t.enforceCopyrightSafeMedia({
    id: "p", title: "t", text: "x", imageUrl: "https://third.example/a.jpg", mediaPackUrls: ["https://third.example/a.jpg", "https://third.example/b.jpg"], mediaLicense: "forbidden", sourceName: "S"
  }));
  assert.deepEqual(out.mediaPackUrls, [], "third-party album photos must be dropped with the main image");
  assert.equal(out.imageUrl, "");
});

async function main() {
  const only = process.argv[2];
  if (only) {
    const name = Object.keys(cases).find((n) => n === only || n.startsWith(only + " "));
    if (!name) throw new Error("unknown case " + only);
    await cases[name]();
    process.exit(0);
  }
  let failed = 0;
  for (const name of Object.keys(cases)) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name.split(" ")[0]], { env: Object.assign({}, process.env, { TZ: "UTC" }), encoding: "utf8", timeout: 120000 });
    if (r.status === 0) console.log("ok - " + name);
    else { failed += 1; console.log("FAIL - " + name + "\n" + String(r.stderr || r.stdout).split("\n").slice(0, 14).join("\n")); }
  }
  console.log(failed ? failed + " failed" : "publish-guards tests passed");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
