// VK media order: link card (og:image snippet) first, then the old messages-photo mode, then text.
//   npm run test:link-card-vk       (needs a local PostgreSQL, like the other DB suites)
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadServer, inWs, startTempPostgres } from "./dedupe-harness.js";

const cases = {};
function test(name, fn) { cases[name] = fn; }
const BASE = "https://nf.example.test";
const NO_PHOTO = { error_code: 100, error_msg: "One of the parameters specified was missing or invalid: Violated: link_photo_sizing_rule. No photo given" };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// vk: function(method, params) -> {response} | {error} | throws; returns call log.
function installVk(t, vk) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith("https://api.vk.com/method/")) {
      const method = u.slice("https://api.vk.com/method/".length);
      const params = Object.fromEntries(new URLSearchParams(String(init.body || "")));
      calls.push({ method, params });
      const out = await vk(method, params, calls);
      return json(out);
    }
    if (u === "https://upload.vk.test/msg") { calls.push({ method: "upload" }); return json({ server: 1, photo: "[{\"p\":1}]", hash: "h".repeat(32) }); }
    if (u.startsWith(BASE + "/p/")) {
      const slug = decodeURIComponent(u.slice((BASE + "/p/").length));
      const html = '<html><head><meta property="og:image" content="' + BASE + "/media/vk_preview_" + slug + '.jpg"></head></html>';
      return new Response(init.method === "HEAD" ? null : html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (u.startsWith(BASE + "/media/")) {
      const bytes = fs.readFileSync(t.dir + "/media/" + u.slice((BASE + "/media/").length));
      return new Response(init.method === "HEAD" ? null : bytes, { status: 200, headers: { "content-type": "image/jpeg", "content-length": String(bytes.length) } });
    }
    return json({});
  };
  return calls;
}
const wallPosts = (calls) => calls.filter((c) => c.method === "wall.post");
const okPost = (id) => ({ response: { post_id: id } });
const messagesPhoto = (method) => {
  if (method === "photos.getMessagesUploadServer") return { response: { upload_url: "https://upload.vk.test/msg" } };
  if (method === "photos.saveMessagesPhoto") return { response: [{ id: 456, owner_id: -241910449, access_key: "k" }] };
  return null;
};

async function boot(env, state) {
  const t = await loadServer({ db: true, channels: [["ai-main", "ai", "Что там у ИИ?"]], state, env: Object.assign({
    VK_PUBLISH_ENABLED: "true", VK_ACCESS_TOKEN: "vk-test-token", VK_GROUP_ID: "241910449", VK_OWNER_ID: "",
    NEWS_FACTORY_PUBLIC_URL: BASE, VK_LINK_CARD_RETRY_DELAYS_MS: "10,10", VK_MEDIA_ORDER: ""
  }, env || {}) });
  for (let i = 0; i < 200 && !t.dbReadyFlag; i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(t.dbReadyFlag, "db ready");
  return t;
}
const post = (id) => ({ id: id || "q_test_1", title: "🤖 5 000 устройств и SDK для самодельных ИИ-гаджетов", text: "Текст поста про устройства.", sourceName: "Unite.AI", sourceUrl: "https://www.unite.ai/x" });

test("L1 link card works at once: one wall.post with the public page link, no photo upload", async () => {
  const t = await boot();
  const calls = installVk(t, (m) => m === "wall.post" ? okPost(17) : (messagesPhoto(m) || { response: {} }));
  const res = await inWs(t, "ai-main", () => t.publishVkPost(post()));
  assert.equal(res.mediaMode, "link_preview"); assert.equal(res.post_id, 17);
  const posts = wallPosts(calls);
  assert.equal(posts.length, 1);
  assert.match(posts[0].params.attachments, new RegExp("^" + BASE + "/p/"));
  assert.equal(posts[0].params.owner_id, "-241910449"); assert.equal(posts[0].params.from_group, "1");
  assert.equal(calls.some((c) => c.method.startsWith("photos.")), false);
});

test("L2 'No photo given' is retried after a pause and the card goes out on a later attempt", async () => {
  const t = await boot();
  let n = 0;
  const calls = installVk(t, (m) => m === "wall.post" ? (++n < 3 ? { error: NO_PHOTO } : okPost(18)) : (messagesPhoto(m) || { response: {} }));
  const res = await inWs(t, "ai-main", () => t.publishVkPost(post()));
  assert.equal(res.mediaMode, "link_preview"); assert.equal(wallPosts(calls).length, 3);
  assert.equal(new Set(wallPosts(calls).map((c) => c.params.guid)).size, 1, "same guid on every retry: VK deduplicates");
  assert.equal(calls.some((c) => c.method.startsWith("photos.")), false);
});

test("L3 card never gets a picture -> old messages-photo mode, post is published", async () => {
  const t = await boot();
  const calls = installVk(t, (m, p) => m === "wall.post" ? (String(p.attachments || "").startsWith("photo") ? okPost(19) : { error: NO_PHOTO }) : (messagesPhoto(m) || { response: {} }));
  const res = await inWs(t, "ai-main", () => t.publishVkPost(post()));
  assert.equal(res.mediaMode, "photo_upload");
  assert.equal(wallPosts(calls).length, 4, "3 link attempts + 1 photo post");
  assert.equal(wallPosts(calls)[3].params.attachments, "photo-241910449_456_k");
});

test("L4 other link errors are not retried", async () => {
  const t = await boot();
  const calls = installVk(t, (m, p) => m === "wall.post" ? (String(p.attachments || "").startsWith("photo") ? okPost(20) : { error: { error_code: 214, error_msg: "Access to adding post denied" } }) : (messagesPhoto(m) || { response: {} }));
  const res = await inWs(t, "ai-main", () => t.publishVkPost(post()));
  assert.equal(res.mediaMode, "photo_upload"); assert.equal(wallPosts(calls).length, 2);
});

test("L5 network error on the link wall.post stops everything (no duplicate post)", async () => {
  const t = await boot();
  const calls = installVk(t, (m) => { if (m === "wall.post") throw new Error("socket hang up"); return messagesPhoto(m) || { response: {} }; });
  await assert.rejects(() => inWs(t, "ai-main", () => t.publishVkPost(post())), (e) => e.vkErrorCode === "network");
  assert.equal(wallPosts(calls).length, 1);
  assert.equal(calls.some((c) => c.method.startsWith("photos.")), false);
});

test("L6 VK_MEDIA_ORDER=photo,link restores the old order", async () => {
  const t = await boot({ VK_MEDIA_ORDER: "photo,link" });
  const calls = installVk(t, (m) => m === "wall.post" ? okPost(21) : (messagesPhoto(m) || { response: {} }));
  const res = await inWs(t, "ai-main", () => t.publishVkPost(post()));
  assert.equal(res.mediaMode, "photo_upload"); assert.equal(wallPosts(calls).length, 1);
  assert.match(wallPosts(calls)[0].params.attachments, /^photo/);
});

test("L7 everything fails: text fallback only when the topic allows it", async () => {
  const allow = { "ai-main": { topicSettings: { default: { auto_publish_telegram: true, auto_publish_vk: true, allow_text_fallback: true } } } };
  let t = await boot({}, allow);
  let calls = installVk(t, (m, p) => {
    if (m === "wall.post") return p.attachments ? { error: NO_PHOTO } : okPost(22);
    if (m === "photos.getMessagesUploadServer") return { error: { error_code: 901, error_msg: "Can't send messages for users without permission" } };
    return { response: {} };
  });
  const res = await inWs(t, "ai-main", () => t.publishVkPost(post()));
  assert.equal(res.mediaMode, "text_fallback"); assert.equal(wallPosts(calls).at(-1).params.attachments, undefined);
});

test("L8 everything fails and text fallback is not allowed -> error, no text post", async () => {
  const t = await boot();
  const calls = installVk(t, (m, p) => {
    if (m === "wall.post") return p.attachments ? { error: NO_PHOTO } : okPost(23);
    if (m === "photos.getMessagesUploadServer") return { error: { error_code: 901, error_msg: "Can't send messages for users without permission" } };
    return { response: {} };
  });
  await assert.rejects(() => inWs(t, "ai-main", () => t.publishVkPost(post())), (e) => e.mediaFailed === true);
  assert.equal(wallPosts(calls).filter((c) => !c.params.attachments).length, 0);
});

async function main() {
  const only1 = process.argv[2];
  if (only1) {
    const name = Object.keys(cases).find((n) => n === only1 || n.startsWith(only1 + " "));
    if (!name) throw new Error("unknown case " + only1);
    await cases[name]();
    process.exit(0);
  }
  const pgInst = startTempPostgres();
  if (!pgInst) { console.log("skip - vk-link-card tests (no PostgreSQL available)"); process.exit(0); }
  let failed = 0;
  try {
    for (const name of Object.keys(cases)) {
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name.split(" ")[0]], { env: Object.assign({}, process.env, { TZ: "UTC", TEST_DATABASE_URL: pgInst.url }), encoding: "utf8", timeout: 180000 });
      if (r.status === 0) console.log("ok - " + name);
      else { failed += 1; console.log("FAIL - " + name + "\n" + String(r.stderr || r.stdout).split("\n").slice(0, 16).join("\n")); }
    }
  } finally { pgInst.stop(); }
  console.log(failed ? failed + " failed" : "vk-link-card tests passed");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
