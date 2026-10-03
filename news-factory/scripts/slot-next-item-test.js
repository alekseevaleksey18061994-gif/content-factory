// A slot whose post fails moves on to the NEXT post from the queue right away, until one is published.
//   npm run test:slot-next-item
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadServer, inWs, mkQueueItem, advance } from "./dedupe-harness.js";

const cases = {};
function test(name, fn) { cases[name] = fn; }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const CH = [["ai-main", "ai", "Что там у ИИ?"]];

// mode for "FAILME" posts: "post" (Bad Request for this post only), "kicked" (403), "flood" (429), "network" (no answer)
function installTelegram(mode = "post") {
  const sent = [];
  let mid = 100;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith("https://api.telegram.org/")) {
      const method = u.split("/").pop();
      let body = {};
      if (init.body && typeof init.body === "string") body = JSON.parse(init.body);
      else if (init.body && typeof init.body.get === "function") body = { caption: init.body.get("caption") || "", text: init.body.get("text") || "", multipart: true };
      if (method === "getChat") return json({ ok: true, result: { id: -100123, type: "channel", username: "chtotamai", title: "Что там у ИИ?" } });
      const text = String(body.text || body.caption || "");
      if (/FAILME/.test(text) || mode === "kicked-all") {
        sent.push({ method, text, failed: true, multipart: Boolean(body.multipart) });
        if (mode === "network") throw new Error("fetch failed");
        if (mode === "timeout") { const e = new Error("The operation was aborted due to timeout"); e.name = "TimeoutError"; throw e; }
        if (mode === "refused") { const e = new TypeError("fetch failed"); e.cause = { code: "ECONNREFUSED" }; throw e; }
        if (mode === "kicked" || mode === "kicked-all") return json({ ok: false, error_code: 403, description: "Forbidden: bot was kicked from the channel chat" }, 403);
        if (mode === "flood") return json({ ok: false, error_code: 429, description: "Too Many Requests: retry after 600", parameters: { retry_after: 600 } }, 429);
        return json({ ok: false, error_code: 400, description: "Bad Request: MESSAGE_EMPTY" }, 400);
      }
      sent.push({ method, text });
      return json({ ok: true, result: { message_id: ++mid, chat: { id: -100123, type: "channel", username: "chtotamai", title: "Что там у ИИ?" } } });
    }
    return new Response("not found", { status: 404 });
  };
  return sent;
}
async function boot(env) {
  return withCover(await loadServer({ verbose: Boolean(process.env.DEBUG_SLOT), fixedNow: "2026-10-02T09:00:00Z", channels: CH, env: Object.assign({ AUTO_PUBLISH_ENABLED: "true", TELEGRAM_BOT_TOKEN: "123:test", MEDIA_REQUIRED: "false", GENERATE_COVER_IF_MISSING: "false", SLOT_PUBLISH_TRIES: "", PUBLISH_FAILURE_MAX: "", PUBLISH_RETRY_COOLDOWN_MIN: "", VK_AUTO_RETRY_MAX: "", POSTMYPOST_TOKEN: "", NEWS_FACTORY_PUBLIC_URL: BASE }, env || {}) }));
}
const BASE = "https://nf.example.test";
const item = (id, score, bad) => mkQueueItem({ id, newsId: "n_" + id, aiScore: score, qualityScore: 90,
  imageUrl: BASE + "/media/cover_test.jpg", generatedImageUrl: BASE + "/media/cover_test.jpg", mediaType: "generated", mediaOrigin: "generated", mediaLicense: "owned",
  title: (bad ? "FAILME " : "") + "Заголовок " + id, text: "Текст поста " + id + " с подробностями события." });
async function withCover(t) {
  const fs = await import("node:fs");
  const sharp = (await import("sharp")).default;
  fs.mkdirSync(t.dir + "/media", { recursive: true });
  await sharp({ create: { width: 1200, height: 630, channels: 3, background: "#336699" } }).jpeg().toFile(t.dir + "/media/cover_test.jpg");
  return t;
}

test("N1 the best post fails -> the next post from the queue goes out in the SAME slot", async () => {
  const t = await boot();
  const sent = installTelegram();
  t.ws("ai-main").state.queue = [item("bad", 99, true), item("good", 80)];
  t.ws("ai-main").state.mode = "AUTO";
  const r = await inWs(t, "ai-main", () => t.publishDynamicSlot());
  if (process.env.DEBUG_SLOT) console.error("RESULT", JSON.stringify(r));
  assert.equal(r.published, true);
  assert.equal(r.slotAttempts, 2); assert.deepEqual(r.failedBefore, ["bad"]);
  assert.equal(sent.filter((x) => !x.failed && /good/.test(x.text)).length >= 1, true); assert.equal(sent.some((x) => !x.failed && /FAILME/.test(x.text)), false);
  const bad = t.ws("ai-main").state.queue.find((q) => q.id === "bad");
  assert.ok(bad, "the failed post stays in the queue for a later try");
  assert.notEqual(bad.status, "publish_failed");
  assert.ok(Date.parse(bad.publishRetryAfter) > Date.now(), "it rests for the cooldown");
  assert.equal(t.ws("ai-main").state.queue.some((q) => q.id === "good"), false, "the published post left the queue");
});

test("N2 several failing posts in a row: the slot keeps going until one is published", async () => {
  const t = await boot();
  const sent = installTelegram();
  t.ws("ai-main").state.queue = [item("b1", 99, true), item("b2", 95, true), item("b3", 90, true), item("ok", 70)];
  t.ws("ai-main").state.mode = "AUTO";
  const r = await inWs(t, "ai-main", () => t.publishDynamicSlot());
  assert.equal(r.published, true); assert.deepEqual(r.failedBefore, ["b1", "b2", "b3"]);
  assert.ok(sent.some((x) => !x.failed) && sent.filter((x) => !x.failed).every((x) => !/FAILME/.test(x.text)));
});

test("N3 the number of posts tried per slot is limited (SLOT_PUBLISH_TRIES)", async () => {
  const t = await boot({ SLOT_PUBLISH_TRIES: "2" });
  const sent = installTelegram();
  t.ws("ai-main").state.queue = [item("b1", 99, true), item("b2", 95, true), item("ok", 70)];
  t.ws("ai-main").state.mode = "AUTO";
  await assert.rejects(() => inWs(t, "ai-main", () => t.publishDynamicSlot()));
  assert.equal(sent.filter((x) => !x.failed).length, 0);
  // next tick: both failed posts rest, the good one goes out
  const r = await inWs(t, "ai-main", () => t.publishDynamicSlot());
  assert.equal(r.published, true); assert.ok(sent.some((x) => /Заголовок ok/.test(x.text)));
});

test("N4 a resting post comes back after the cooldown; PUBLISH_FAILURE_MAX failures -> publish_failed for good", async () => {
  const t = await boot({ PUBLISH_FAILURE_MAX: "2", PUBLISH_RETRY_COOLDOWN_MIN: "30", SLOT_PUBLISH_TRIES: "1" });
  installTelegram();
  t.ws("ai-main").state.queue = [item("bad", 99, true)];
  t.ws("ai-main").state.mode = "AUTO";
  await assert.rejects(() => inWs(t, "ai-main", () => t.publishDynamicSlot()));
  const bad = () => t.ws("ai-main").state.queue.find((q) => q.id === "bad");
  assert.equal(inWs(t, "ai-main", () => t.dynamicBestQueueItemRaw(undefined, false)), null, "resting: not a candidate");
  advance(31 * 60000);
  assert.equal(inWs(t, "ai-main", () => t.dynamicBestQueueItemRaw(undefined, false)).id, "bad", "back after the cooldown");
  await assert.rejects(() => inWs(t, "ai-main", () => t.publishDynamicSlot()));
  assert.equal(bad().status, "publish_failed");
});

test("N5 Telegram out, VK failed: VK is not re-sent for the same post (the next post goes to VK)", async () => {
  const t = await boot({ POSTMYPOST_TOKEN: "pmp" });
  t.ws("ai-main").state.topicSettings.default.auto_publish_vk = true;
  assert.equal(inWs(t, "ai-main", () => t.pendingAutoTargets(mkQueueItem({ id: "y", newsId: "ny" }))).vk, true, "VK is a target at all");
  const done = mkQueueItem({ id: "x", newsId: "nx", telegramPublished: true, vkAttempts: 1 });
  const pending = inWs(t, "ai-main", () => t.pendingAutoTargets(done));
  assert.equal(pending.vk, false);
  assert.equal(pending.telegram, false);
});

// ---- regressions from the adversarial review ----
test("R1 bot kicked (403): ONE post tried, slot stops, the post is NOT burned, the rest of the queue untouched", async () => {
  const t = await boot();
  const sent = installTelegram("kicked-all");
  t.ws("ai-main").state.queue = [item("a", 99), item("b", 95), item("c", 90)];
  t.ws("ai-main").state.mode = "AUTO";
  await assert.rejects(() => inWs(t, "ai-main", () => t.publishDynamicSlot()));
  assert.equal(sent.filter((x) => x.failed).length, 1, "no other posts thrown at a dead chat");
  const q = t.ws("ai-main").state.queue;
  assert.equal(q.filter((x) => x.status === "publish_failed").length, 0);
  assert.equal(q.filter((x) => x.publishRetryAfter).length, 0);
});

test("R2 flood limit (429): the slot stops after one post", async () => {
  const t = await boot();
  const sent = installTelegram("flood");
  t.ws("ai-main").state.queue = [item("a", 99, true), item("b", 95), item("c", 90)];
  t.ws("ai-main").state.mode = "AUTO";
  await assert.rejects(() => inWs(t, "ai-main", () => t.publishDynamicSlot()));
  assert.equal(sent.filter((x) => !x.failed).length, 0, "no next post sent into the flood limit");
});

test("R3 no answer from Telegram (network): counted as published (uncertain) — no second copy, no other post", async () => {
  const t = await boot();
  const sent = installTelegram("network");
  t.ws("ai-main").state.queue = [item("a", 99, true), item("b", 95)];
  t.ws("ai-main").state.mode = "AUTO";
  const r = await inWs(t, "ai-main", () => t.publishDynamicSlot());
  assert.equal(r.published, true, JSON.stringify(r));
  assert.equal(sent.filter((x) => x.failed).length, 1, "exactly one send attempt: " + JSON.stringify(sent));
  assert.equal(sent.some((x) => !x.failed && /Заголовок b/.test(x.text)), false, "no different post in the same slot");
  assert.equal(t.ws("ai-main").state.queue.some((x) => x.id === "a"), false, "the post is not sent again later");
  assert.ok(t.ws("ai-main").state.queue.some((x) => x.id === "b"));
});

test("R4 Telegram timeout on a photo (the 18:00 duplicates): one request only, our media uploaded directly, slot done", async () => {
  const t = await boot();
  const sent = installTelegram("timeout");
  t.ws("ai-main").state.queue = [item("a", 99, true), item("b", 95)];
  t.ws("ai-main").state.mode = "AUTO";
  const r = await inWs(t, "ai-main", () => t.publishDynamicSlot());
  assert.equal(r.published, true);
  const attempts = sent.filter((x) => x.failed);
  assert.equal(attempts.length, 1, "no URL->upload / cover / repair re-sends: " + JSON.stringify(sent.map((x) => x.method)));
  assert.equal(attempts[0].multipart, true, "local cover is uploaded, not passed as a URL Telegram must fetch from us");
  const again = await inWs(t, "ai-main", () => t.catchUpCurrentRegularSlotAllWorkspaces());
  assert.equal(sent.filter((x) => !x.failed).length, 0, "catch-up does not publish another post into the same slot");
  void again;
});

test("R5 connection refused (request never reached Telegram): not counted as published; slot stops, post kept", async () => {
  const t = await boot();
  const sent = installTelegram("refused");
  t.ws("ai-main").state.queue = [item("a", 99, true), item("b", 95)];
  t.ws("ai-main").state.mode = "AUTO";
  await assert.rejects(() => inWs(t, "ai-main", () => t.publishDynamicSlot()));
  assert.equal(sent.filter((x) => !x.failed).length, 0, "Telegram unreachable: no other post thrown at it");
  const a = t.ws("ai-main").state.queue.find((x) => x.id === "a");
  assert.ok(a && !a.telegramPublished, "not marked as published");
  assert.ok(!a.publishRetryAfter, "not penalised: it was not the post's fault");
});

test("R6 which failures count as 'maybe sent'", async () => {
  const t = await boot();
  const f = t.telegramErrorIsAmbiguous;
  const te = new Error("x"); te.name = "TimeoutError";
  const c = (code) => { const e = new TypeError("fetch failed"); e.cause = { code }; return e; };
  assert.deepEqual([f(te), f(c("ECONNRESET")), f(c("UND_ERR_SOCKET")), f(c("ECONNREFUSED")), f(c("ENOTFOUND")), f(c("UND_ERR_CONNECT_TIMEOUT"))], [true, true, true, false, false, false]);
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
    else { failed += 1; console.log("FAIL - " + name + "\n" + String(r.stderr || r.stdout).split("\n").filter((l) => !/^    at/.test(l)).slice(0, 16).join("\n")); }
  }
  console.log(failed ? failed + " failed" : "slot-next-item tests passed");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
