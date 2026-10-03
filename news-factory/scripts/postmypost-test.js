// VK through Postmypost (photo that readers see) + fallback to direct VK.
//   npm run test:postmypost        (server cases need a local PostgreSQL)
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPostmypostClient, resolvePostmypostTarget } from "../lib/postmypost.js";
import { loadServer, inWs, startTempPostgres } from "./dedupe-harness.js";

const cases = {};
function test(name, fn) { cases[name] = fn; }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const PMP = "https://api.postmypost.io/v4.1";
const BASE = "https://nf.example.test";
const TOKEN = "pmp-test-token-xyz";

// Fake Postmypost. opts: { uploadStatuses: [...], pubStatuses: [...], createStatus, createThrows, accounts }
function fakePmp(opts = {}) {
  const calls = [];
  const up = (opts.uploadStatuses || [5, 3, 1]).slice();
  const pub = (opts.pubStatuses || [5, 2, 1]).slice();
  const handler = async (url, init = {}) => {
    if (String(url).startsWith("https://storage.pmp.test/")) {
      const form = init.body;
      const keys = []; let file = null;
      for (const [k, v] of form.entries()) { keys.push(k); if (k === "file") file = v; }
      calls.push({ method: "POST", path: "STORAGE", keys, fileSize: file ? file.size : 0, fileName: file ? file.name : "", fileType: file ? file.type : "" });
      if (opts.storageStatus) return new Response("<Error>Denied</Error>", { status: opts.storageStatus });
      return new Response(null, { status: 204 });
    }
    const u = new URL(String(url));
    const path = u.pathname.replace("/v4.1", "");
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method || "GET", path, query: Object.fromEntries(u.searchParams), body, auth: (init.headers || {}).authorization });
    if (path === "/projects") return json({ data: [{ id: 77, name: "Новости" }], pages: { page: 1, total_pages: 1 } });
    if (path === "/channels") return json({ data: [{ id: 5, code: "vk", name: "ВКонтакте" }, { id: 9, code: "telegram", name: "Telegram" }] });
    if (path === "/accounts") return json({ data: opts.accounts || [
      { id: 501, chanel_id: 9, external_id: "-1004220646926", name: "Что там у ИИ? TG", connection_status: 1 },
      { id: 502, chanel_id: 5, external_id: "241910449", name: "Что там у ИИ? VK", connection_status: 1 }
    ] });
    if (path === "/upload/init" && body && body.url) {
      if (opts.urlStatus) return json({ message: "Не удалось загрузить файл по ссылке." }, opts.urlStatus);
      return json({ id: 9001, status: up.shift() ?? 1, url: body.url });
    }
    if (path === "/upload/init") return json({ id: 9001, status: 5, name: body.name, size: body.size, action: "https://storage.pmp.test/upload", fields: [{ key: "key", value: "u/9001.jpg" }, { key: "policy", value: "pol" }, { key: "x-amz-signature", value: "sig" }] });
    if (path === "/upload/complete") return json({ id: Number(u.searchParams.get("id")), status: up.length ? up.shift() : 1 });
    if (path === "/upload/status") { const st = up.length ? up.shift() : 1; return json({ id: 9001, status: st, file_id: st === 1 ? 4242 : undefined }); }
    if (path === "/publications" && (init.method || "GET") === "POST") {
      if (opts.createThrows) throw new Error("socket hang up");
      if (opts.createStatus) return json({ message: "Validation failed", errors: [{ field: "post_at", message: "bad" }] }, opts.createStatus);
      return json({ id: 31337, publication_status: 5 });
    }
    if (path === "/publications/31337") return json({ id: 31337, publication_status: pub.length ? pub.shift() : 1 });
    return json({}, 404);
  };
  return { calls, handler };
}

// ---------------------------------------------------------------- client units
test("C1 client: Bearer auth, upload by URL waits for status 1, returns file id", async () => {
  const f = fakePmp();
  const c = createPostmypostClient({ token: TOKEN, fetch: f.handler, pollMs: 1 });
  assert.equal(await c.uploadByUrl(77, "https://x/img.jpg"), 4242);
  assert.ok(f.calls.every((x) => x.auth === "Bearer " + TOKEN));
  assert.deepEqual(f.calls[0].body, { project_id: 77, url: "https://x/img.jpg" });
  assert.equal(f.calls.filter((x) => x.path === "/upload/status").length, 2);
  assert.equal(f.calls[1].query.id, "9001");
});

test("C5 client: file upload sends storage fields BEFORE the file, completes, waits for the file id", async () => {
  const f = fakePmp({ uploadStatuses: [3, 1] });
  const c = createPostmypostClient({ token: TOKEN, fetch: f.handler, pollMs: 1 });
  const bytes = Buffer.alloc(1234, 7);
  assert.equal(await c.uploadFile(77, bytes, "vk_preview_x.jpg", "image/jpeg"), 4242);
  const init = f.calls.find((x) => x.path === "/upload/init");
  assert.deepEqual(init.body, { project_id: 77, name: "vk_preview_x.jpg", size: 1234 });
  const st = f.calls.find((x) => x.path === "STORAGE");
  assert.deepEqual(st.keys, ["key", "policy", "x-amz-signature", "file"]);
  assert.equal(st.fileSize, 1234); assert.equal(st.fileName, "vk_preview_x.jpg"); assert.equal(st.fileType, "image/jpeg");
  const complete = f.calls.find((x) => x.path === "/upload/complete");
  assert.equal(complete.query.id, "9001"); assert.equal(complete.auth, "Bearer " + TOKEN);
  assert.equal(st.auth, undefined, "no Postmypost token sent to the storage");
  const bad = createPostmypostClient({ token: TOKEN, fetch: fakePmp({ storageStatus: 403 }).handler, pollMs: 1 });
  await assert.rejects(() => bad.uploadFile(77, bytes, "a.jpg"), (e) => e.pmpCode === "storage_403");
  await assert.rejects(() => c.uploadFile(77, Buffer.alloc(0), "a.jpg"), (e) => e.pmpCode === "upload_empty");
});

test("C2 client: upload error and timeout are reported", async () => {
  let c = createPostmypostClient({ token: TOKEN, fetch: fakePmp({ uploadStatuses: [5, 2] }).handler, pollMs: 1 });
  await assert.rejects(() => c.uploadByUrl(77, "u"), (e) => e.pmpCode === "upload_error");
  c = createPostmypostClient({ token: TOKEN, fetch: fakePmp({ uploadStatuses: Array(999).fill(3) }).handler, pollMs: 5 });
  await assert.rejects(() => c.uploadByUrl(77, "u", 50), (e) => e.pmpCode === "upload_timeout");
});

test("C3 client: publication body has the right shape; HTTP errors carry status and message", async () => {
  const f = fakePmp();
  const c = createPostmypostClient({ token: TOKEN, fetch: f.handler, pollMs: 1 });
  await c.createPublication({ projectId: 77, accountId: 502, content: "Текст", fileIds: [4242], postAt: "2026-10-03T01:00:00.000Z" });
  assert.deepEqual(f.calls[0].body, { project_id: 77, post_at: "2026-10-03T01:00:00.000Z", account_ids: [502], publication_status: 5,
    details: [{ account_id: 502, publication_type: 1, content: "Текст", file_ids: [4242] }] });
  const bad = createPostmypostClient({ token: TOKEN, fetch: fakePmp({ createStatus: 422 }).handler });
  await assert.rejects(() => bad.createPublication({ projectId: 1, accountId: 2, content: "x", fileIds: [], postAt: "t" }), (e) => e.pmpStatus === 422 && /post_at: bad/.test(e.message) && !e.message.includes(TOKEN));
  const none = createPostmypostClient({ token: "" });
  await assert.rejects(() => none.listProjects(), (e) => e.pmpCode === "config_missing");
});

test("C4 target: VK account matched by group id; Telegram account ignored; explicit id wins; re-auth is reported", async () => {
  const c = createPostmypostClient({ token: TOKEN, fetch: fakePmp().handler });
  let t = await resolvePostmypostTarget(c, {}, 241910449);
  assert.equal(t.accountId, 502); assert.equal(t.projectId, 77);
  t = await resolvePostmypostTarget(c, { accountId: 502 }, 0);
  assert.equal(t.accountId, 502);
  const two = createPostmypostClient({ token: TOKEN, fetch: fakePmp({ accounts: [
    { id: 1, chanel_id: 5, external_id: "111", name: "A", connection_status: 1 }, { id: 2, chanel_id: 5, external_id: "222", name: "B", connection_status: 1 }] }).handler });
  await assert.rejects(() => resolvePostmypostTarget(two, {}, 333), (e) => e.pmpCode === "target_not_found" && /POSTMYPOST_ACCOUNT_ID/.test(e.message) && e.candidates.length === 2);
  const reauth = createPostmypostClient({ token: TOKEN, fetch: fakePmp({ accounts: [{ id: 3, chanel_id: 5, external_id: "241910449", name: "VK", connection_status: 2 }] }).handler });
  await assert.rejects(() => resolvePostmypostTarget(reauth, { accountId: 3 }, 241910449), (e) => e.pmpCode === "account_auth_required");
});

// ---------------------------------------------------------------- the real server.js
function installNet(t, pmp, vk) {
  const calls = { vk: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith(PMP) || u.startsWith("https://storage.pmp.test/")) return pmp.handler(url, init);
    if (u.startsWith("https://api.vk.com/method/")) {
      const method = u.slice("https://api.vk.com/method/".length);
      calls.vk.push({ method, params: Object.fromEntries(new URLSearchParams(String(init.body || ""))) });
      return json(vk ? vk(method) : { response: { post_id: 55 } });
    }
    if (u === "https://upload.vk.test/msg") return json({ server: 1, photo: "[1]", hash: "h".repeat(32) });
    if (u.startsWith(BASE + "/p/")) {
      const slug = decodeURIComponent(u.slice((BASE + "/p/").length));
      return new Response(init.method === "HEAD" ? null : '<meta property="og:image" content="' + BASE + "/media/vk_preview_" + slug + '.jpg">', { status: 200, headers: { "content-type": "text/html" } });
    }
    if (u.startsWith(BASE + "/media/")) {
      const bytes = fs.readFileSync(t.dir + "/media/" + u.slice((BASE + "/media/").length));
      return new Response(init.method === "HEAD" ? null : bytes, { status: 200, headers: { "content-type": "image/jpeg", "content-length": String(bytes.length) } });
    }
    return json({});
  };
  return calls;
}
const vkDirect = (m) => {
  if (m === "photos.getMessagesUploadServer") return { response: { upload_url: "https://upload.vk.test/msg" } };
  if (m === "photos.saveMessagesPhoto") return { response: [{ id: 456, owner_id: -241910449 }] };
  if (m === "wall.post") return { response: { post_id: 55 } };
  return { response: {} };
};
async function boot(env) {
  const t = await loadServer({ db: true, channels: [["ai-main", "ai", "Что там у ИИ?"]], env: Object.assign({
    VK_PUBLISH_ENABLED: "true", VK_ACCESS_TOKEN: "vk-test", VK_GROUP_ID: "241910449", VK_OWNER_ID: "", NEWS_FACTORY_PUBLIC_URL: BASE,
    POSTMYPOST_TOKEN: TOKEN, VK_VIA_POSTMYPOST: "", POSTMYPOST_POLL_MS: "10", POSTMYPOST_WAIT_MS: "", POSTMYPOST_PROJECT_ID: "", POSTMYPOST_ACCOUNT_ID: "",
    VK_MEDIA_ORDER: "", VK_LINK_CARD_RETRY_DELAYS_MS: ""
  }, env || {}) });
  for (let i = 0; i < 200 && !t.dbReadyFlag; i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(t.dbReadyFlag);
  return t;
}
const post = () => ({ id: "q_pmp_1", title: "🎨 Что папа римский считает главным отличием искусства от ИИ?", text: "Текст поста.", sourceName: "TechCrunch", sourceUrl: "https://techcrunch.com/x" });
const wallPosts = (calls) => calls.vk.filter((c) => c.method === "wall.post");

test("S1 VK post goes through Postmypost with the 1200x630 picture; direct VK wall.post is not used", async () => {
  const t = await boot();
  const pmp = fakePmp();
  const calls = installNet(t, pmp, vkDirect);
  const res = await inWs(t, "ai-main", () => t.publishVkPost(post()));
  assert.equal(res.mediaMode, "postmypost"); assert.equal(res.post_id, "pmp-31337");
  const init = pmp.calls.find((c) => c.path === "/upload/init");
  assert.equal(init.body.url, undefined, "the picture is pushed as a file, not given as a Railway URL");
  assert.match(init.body.name, /^vk_preview_.*\.jpg$/); assert.ok(init.body.size > 1000);
  const st = pmp.calls.find((c) => c.path === "STORAGE");
  assert.equal(st.fileSize, init.body.size);
  const create = pmp.calls.find((c) => c.path === "/publications" && c.method === "POST");
  assert.equal(create.body.account_ids[0], 502); assert.deepEqual(create.body.details[0].file_ids, [4242]);
  assert.match(create.body.details[0].content, /папа римский/);
  assert.ok(Date.parse(create.body.post_at) > Date.now() - 60000);
  assert.equal(wallPosts(calls).length, 0);
});

test("S8 production case: Postmypost cannot download our URL (422) but the file upload works", async () => {
  const t = await boot();
  const pmp = fakePmp({ urlStatus: 422 });
  const calls = installNet(t, pmp, vkDirect);
  const res = await inWs(t, "ai-main", () => t.publishVkPost(post()));
  assert.equal(res.mediaMode, "postmypost"); assert.equal(wallPosts(calls).length, 0);
});

test("S2 Postmypost refuses (4xx) before the post exists -> direct VK posts as before", async () => {
  const t = await boot();
  const calls = installNet(t, fakePmp({ createStatus: 402 }), vkDirect);
  const res = await inWs(t, "ai-main", () => t.publishVkPost(post()));
  assert.equal(res.mediaMode, "link_photo"); assert.equal(wallPosts(calls).length, 1);
});

test("S3 network error while creating the publication stops: no direct post (could be a duplicate)", async () => {
  const t = await boot();
  const calls = installNet(t, fakePmp({ createThrows: true }), vkDirect);
  await assert.rejects(() => inWs(t, "ai-main", () => t.publishVkPost(post())), (e) => e.mediaFailed === true);
  assert.equal(wallPosts(calls).length, 0);
});

test("S4 publication ends with error status -> direct VK fallback", async () => {
  const t = await boot();
  const calls = installNet(t, fakePmp({ pubStatuses: [5, 3] }), vkDirect);
  const res = await inWs(t, "ai-main", () => t.publishVkPost(post()));
  assert.equal(res.mediaMode, "link_photo"); assert.equal(wallPosts(calls).length, 1);
});

test("S5 still pending when the wait ends -> reported as sent, NO direct fallback", async () => {
  const t = await boot({ POSTMYPOST_WAIT_MS: "150" });
  const calls = installNet(t, fakePmp({ pubStatuses: Array(999).fill(5) }), vkDirect);
  const res = await inWs(t, "ai-main", () => t.publishVkPost(post()));
  assert.equal(res.mediaMode, "postmypost_pending"); assert.equal(wallPosts(calls).length, 0);
});

test("S6 VK_VIA_POSTMYPOST=false or no token -> direct VK only, Postmypost never called", async () => {
  for (const env of [{ VK_VIA_POSTMYPOST: "false" }, { POSTMYPOST_TOKEN: "" }]) {
    const t = await boot(env);
    const pmp = fakePmp();
    const calls = installNet(t, pmp, vkDirect);
    const res = await inWs(t, "ai-main", () => t.publishVkPost(post()));
    assert.equal(res.mediaMode, "link_photo"); assert.equal(pmp.calls.length, 0); assert.equal(wallPosts(calls).length, 1);
  }
});

test("S7 boot diagnostics name the chosen account and never print the token", async () => {
  const t = await boot();
  installNet(t, fakePmp(), vkDirect);
  const lines = [];
  const orig = console.log; console.log = (...a) => lines.push(a.join(" "));
  const info = await t.logPostmypostStatus();
  console.log = orig;
  assert.equal(info.ok, true); assert.equal(info.accountId, 502);
  const line = lines.find((l) => l.startsWith("POSTMYPOST_STATUS "));
  assert.ok(line); assert.ok(!line.includes(TOKEN));
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
  let failed = 0;
  try {
    for (const name of Object.keys(cases)) {
      if (name.startsWith("S") && !pgInst) { console.log("skip - " + name + " (no PostgreSQL)"); continue; }
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name.split(" ")[0]], { env: Object.assign({}, process.env, { TZ: "UTC" }, pgInst ? { TEST_DATABASE_URL: pgInst.url } : {}), encoding: "utf8", timeout: 180000 });
      if (r.status === 0) console.log("ok - " + name);
      else { failed += 1; console.log("FAIL - " + name + "\n" + String(r.stderr || r.stdout).split("\n").filter((l) => !/^VK_|^    at/.test(l)).slice(0, 14).join("\n")); }
    }
  } finally { if (pgInst) pgInst.stop(); }
  console.log(failed ? failed + " failed" : "postmypost tests passed");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
