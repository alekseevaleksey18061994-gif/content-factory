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

function installTelegram() {
  const sent = [];
  let mid = 100;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith("https://api.telegram.org/")) {
      const method = u.split("/").pop();
      let body = {};
      if (init.body && typeof init.body === "string") body = JSON.parse(init.body);
      else if (init.body && typeof init.body.get === "function") body = { caption: init.body.get("caption") || "", text: init.body.get("text") || "" };
      if (method === "getChat") return json({ ok: true, result: { id: -100123, type: "channel", username: "chtotamai", title: "Что там у ИИ?" } });
      const text = String(body.text || body.caption || "");
      if (/FAILME/.test(text)) throw new Error("fetch failed");
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
  assert.equal(sent.filter((x) => /good/.test(x.text)).length >= 1, true); assert.equal(sent.some((x) => /FAILME/.test(x.text)), false);
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
  assert.ok(sent.length >= 1 && sent.every((x) => !/FAILME/.test(x.text)));
});

test("N3 the number of posts tried per slot is limited (SLOT_PUBLISH_TRIES)", async () => {
  const t = await boot({ SLOT_PUBLISH_TRIES: "2" });
  const sent = installTelegram();
  t.ws("ai-main").state.queue = [item("b1", 99, true), item("b2", 95, true), item("ok", 70)];
  t.ws("ai-main").state.mode = "AUTO";
  await assert.rejects(() => inWs(t, "ai-main", () => t.publishDynamicSlot()));
  assert.equal(sent.filter((x) => x.method !== "getChat").length, 0);
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
