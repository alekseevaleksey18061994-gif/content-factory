// Fixes from the 2026-10-03 health check:
//  - "pmp-…" Postmypost ids must not go into the BIGINT vk_post_id column (whole news_items update failed);
//  - state snapshots with a lone surrogate / \u0000 were rejected by PostgreSQL json ("invalid input syntax for type json");
//  - Postmypost storage upload retries "fetch failed" / 5xx with a fresh upload slot;
//  - catch-up of an empty channel logs once per slot instead of every 30 s.
//   npm run test:health-fixes        (S* cases need a local PostgreSQL)
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPostmypostClient } from "../lib/postmypost.js";
import { foreignLinks, normalizeCheckerResult } from "../lib/editorial-v2.js";
import { visibleLength } from "../lib/telegram-caption.js";
import { readJsonBody } from "../lib/http-body.js";
import { Readable } from "node:stream";
import fs from "node:fs";
import { loadServer, inWs, startTempPostgres, dbRows } from "./dedupe-harness.js";

const cases = {};
function test(name, fn) { cases[name] = fn; }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const LONE = "🤖".slice(0, 1); // high surrogate alone: what .slice() leaves when it cuts an emoji in half

async function bootDb(env) {
  const t = await loadServer({ db: true, channels: [["ai-main", "ai", "Что там у ИИ?"]], fixedNow: "2026-10-03T13:10:00Z", env: Object.assign({ TELEGRAM_BOT_TOKEN: "" }, env || {}) });
  for (let i = 0; i < 200 && !t.dbReadyFlag; i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(t.dbReadyFlag, "db ready");
  return t;
}

test("U1 vkPostIdForDb keeps only plain numeric VK ids", async () => {
  const t = await loadServer({ channels: [["ai-main", "ai", "Что там у ИИ?"]] });
  assert.equal(t.vkPostIdForDb("pmp-32539480"), null);
  assert.equal(t.vkPostIdForDb(25), "25");
  assert.equal(t.vkPostIdForDb(" 123 "), "123");
  assert.equal(t.vkPostIdForDb(null), null);
  assert.equal(t.vkPostIdForDb(""), null);
  assert.equal(t.vkPostIdForDb("12abc"), null);
  assert.equal(t.vkPostIdForDb("9".repeat(25)), null, "out of BIGINT range");
});

test("U2 pgJsonString repairs lone surrogates and drops NUL, keeps normal emoji", async () => {
  const t = await loadServer({ channels: [["ai-main", "ai", "Что там у ИИ?"]] });
  const out = t.pgJsonString({ a: "ok " + LONE, b: ["x\u0000y", "🤖 целый"], c: 5, d: null, e: { f: "\uDC00tail" } });
  assert.ok(!/\\ud[89ab][0-9a-f]{2}(?!\\udc)/i.test(out), out);
  const back = JSON.parse(out);
  assert.equal(back.a, "ok �"); assert.equal(back.b[0], "xy"); assert.equal(back.b[1], "🤖 целый"); assert.equal(back.c, 5); assert.equal(back.d, null);
  assert.equal(back.e.f, "\uFFFDtail");
  // keys are repaired too; literal backslash-u text typed by a human stays untouched
  const k = JSON.parse(t.pgJsonString({ ["тема " + LONE]: 1, ["n\u0000k"]: 2, lit: "C:\\ud83d and \\u0000" }));
  assert.deepEqual(Object.keys(k), ["тема \uFFFD", "nk", "lit"]);
  assert.equal(k.lit, "C:\\ud83d and \\u0000");
  assert.equal(t.pgJsonString(undefined), undefined);
});

test("S1 snapshot of a state with a cut emoji is stored (was: invalid input syntax for type json)", async () => {
  const t = await bootDb();
  await inWs(t, "ai-main", async () => {
    t.state.lastPublishError = "Ошибка: " + LONE;
    t.state.note = "a\u0000b";
    t.state.editorialLearning = { byTopic: { ["Илон " + LONE]: { n: 1 } } };
    await t.saveStateSnapshot();
  });
  const rows = await dbRows("select state->>'lastPublishError' as e, state->>'note' as n from app_snapshots where workspace_id='ai-main' order by id desc limit 1");
  assert.equal(rows.length, 1, "snapshot row written");
  assert.equal(rows[0].e, "Ошибка: �"); assert.equal(rows[0].n, "ab");
  // proof the old serialization is what PostgreSQL refused
  await assert.rejects(() => dbRows("select " + "'" + JSON.stringify({ x: LONE }).replace(/'/g, "''") + "'::jsonb"), /json/i);
});

test("S2 news item with a Postmypost id saves; numeric VK id still lands in vk_post_id", async () => {
  const t = await bootDb();
  await inWs(t, "ai-main", async () => {
    const base = { sourceId: "s1", sourceName: "S1", sourceUrl: "https://s", originalTitle: "T", originalText: "X", contentHash: "h", status: "published", metadata: { title: "🤖 " + LONE } };
    await t.saveNewsItem(Object.assign({ id: "n_pmp", originalUrl: "https://s/a", vkPostId: "pmp-32539480" }, base));
    await t.saveNewsItem(Object.assign({ id: "n_vk", originalUrl: "https://s/b", vkPostId: 25 }, base));
    await t.saveNewsItem(Object.assign({}, base, { id: "n_nul", originalUrl: "https://s/c", originalText: "до\u0000после", originalTitle: "🤖" + LONE }));
  });
  const rows = await dbRows("select id, vk_post_id::text as v from news_items order by id");
  assert.deepEqual(rows.map((r) => [r.id, r.v]), [["n_nul", null], ["n_pmp", null], ["n_vk", "25"]]);
  const nul = await dbRows("select original_text from news_items where id='n_nul'");
  assert.equal(nul[0].original_text, "допосле");
});

function storageFlaky(failures) {
  const seen = { inits: 0, storage: 0 };
  const handler = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith("https://storage.pmp.test/")) {
      seen.storage += 1;
      const f = failures.shift();
      if (f === "net") throw new TypeError("fetch failed");
      if (typeof f === "number") return new Response("<Error/>", { status: f });
      return new Response(null, { status: 204 });
    }
    const path = new URL(u).pathname.replace("/v4.1", "");
    if (path === "/upload/init") { seen.inits += 1; return json({ id: 9000 + seen.inits, status: 5, action: "https://storage.pmp.test/up", fields: [{ key: "key", value: "k" + seen.inits }] }); }
    if (path === "/upload/complete") return json({ status: 1, file_id: 4242 });
    return json({}, 404);
  };
  return { seen, handler };
}

test("U3 Postmypost storage: fetch failed / 5xx are retried with a fresh upload slot; 4xx and exhaustion fail", async () => {
  const bytes = Buffer.alloc(100, 1);
  let f = storageFlaky(["net", 503]);
  let c = createPostmypostClient({ token: "t", fetch: f.handler, pollMs: 1, storageRetryMs: 0 });
  assert.equal(await c.uploadFile(77, bytes, "a.jpg", "image/jpeg"), 4242);
  assert.equal(f.seen.storage, 3); assert.equal(f.seen.inits, 3, "every try asks for a new presigned slot");

  f = storageFlaky([403]);
  c = createPostmypostClient({ token: "t", fetch: f.handler, pollMs: 1, storageRetryMs: 0 });
  await assert.rejects(() => c.uploadFile(77, bytes, "a.jpg"), (e) => e.pmpCode === "storage_403");
  assert.equal(f.seen.storage, 1, "a refusal is not retried");

  f = storageFlaky(["net", "net", "net", "net"]);
  c = createPostmypostClient({ token: "t", fetch: f.handler, pollMs: 1, storageRetryMs: 0 });
  await assert.rejects(() => c.uploadFile(77, bytes, "a.jpg"), (e) => e.pmpCode === "storage_network" && e.pmpAttempts === 3);
  assert.equal(f.seen.storage, 3);

  f = storageFlaky(["net", "net"]);
  c = createPostmypostClient({ token: "t", fetch: f.handler, pollMs: 1, storageRetryMs: 0, storageRetryWindowMs: 0 });
  await assert.rejects(() => c.uploadFile(77, bytes, "a.jpg"), (e) => e.pmpCode === "storage_network");
  assert.equal(f.seen.storage, 1, "past the retry window (a long hang) no more tries");

  f = storageFlaky(["net"]);
  c = createPostmypostClient({ token: "t", fetch: f.handler, pollMs: 1, storageRetryMs: 0, storageTries: 1 });
  await assert.rejects(() => c.uploadFile(77, bytes, "a.jpg"), (e) => e.pmpCode === "storage_network");
});

test("U5 Postmypost /upload/init without an upload address: retried; finished-file answer used; error shows the shape", async () => {
  const bytes = Buffer.alloc(50, 1);
  let n = 0;
  const mk = (answers) => async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith("https://storage.pmp.test/")) return new Response(null, { status: 204 });
    const path = new URL(u).pathname.replace("/v4.1", "");
    if (path === "/upload/init") { n += 1; const a = answers.shift(); return json(a); }
    if (path === "/upload/complete") return json({ status: 1, file_id: 4242 });
    return json({}, 404);
  };
  n = 0;
  let c = createPostmypostClient({ token: "t", fetch: mk([{ id: 0, status: 5 }, { id: 9001, status: 5, action: "https://storage.pmp.test/up", fields: [] }]), pollMs: 1, storageRetryMs: 0 });
  assert.equal(await c.uploadFile(77, bytes, "a.jpg"), 4242); assert.equal(n, 2, "retried once");
  c = createPostmypostClient({ token: "t", fetch: mk([{ id: 9002, status: 1, file_id: 777 }]), pollMs: 1, storageRetryMs: 0 });
  assert.equal(await c.uploadFile(77, bytes, "a.jpg"), 777, "already uploaded file is reused");
  c = createPostmypostClient({ token: "t", fetch: mk([{ data: { id: 9003, action: "https://storage.pmp.test/up", fields: [] } }]), pollMs: 1, storageRetryMs: 0 });
  assert.equal(await c.uploadFile(77, bytes, "a.jpg"), 4242, "wrapped answer understood");
  c = createPostmypostClient({ token: "t", fetch: mk([{ status: 2, message: "x" }, { status: 2 }, { status: 2 }]), pollMs: 1, storageRetryMs: 0 });
  await assert.rejects(() => c.uploadFile(77, bytes, "a.jpg"), (e) => e.pmpCode === "upload_no_action" && /status=2/.test(e.message) && e.pmpAttempts === 3);
});

test("U4 catch-up of an empty channel logs START/RESULT once per slot, not every 30 s", async () => {
  const t = await loadServer({ channels: [["chtotampokupki", "shop", "Что там с покупками?"]], fixedNow: "2026-10-03T13:05:00Z", env: { AUTO_PUBLISH_ENABLED: "true", TELEGRAM_BOT_TOKEN: "123:test" } });
  t.ws("chtotampokupki").state.mode = "AUTO";
  t.ws("chtotampokupki").state.queue = [];
  const lines = [];
  const ow = console.warn, ol = console.log;
  console.warn = (...a) => { lines.push(a.join(" ")); };
  console.log = (...a) => { lines.push(a.join(" ")); };
  try {
    for (let i = 0; i < 4; i++) await t.catchUpCurrentRegularSlotAllWorkspaces();
  } finally { console.warn = ow; console.log = ol; }
  assert.equal(lines.filter((l) => l.startsWith("SCHEDULER_CATCHUP_START") && l.includes("chtotampokupki")).length, 1, lines.join("\n"));
  assert.equal(lines.filter((l) => l.startsWith("SCHEDULER_CATCHUP_RESULT") && l.includes("chtotampokupki")).length, 1, lines.join("\n"));
});

test("U6 coalesced store writes: 50 saves -> 1-2 file writes, file has the last change, compact JSON", async () => {
  const fs = await import("node:fs");
  const t = await loadServer({ channels: [["ai-main", "ai", "Что там у ИИ?"]], env: { STATE_SAVE_DEBOUNCE_MS: "150", STATE_SAVE_MAX_WAIT_MS: "1000" } });
  const before = t.storeFlushStats.writes;
  await inWs(t, "ai-main", async () => { for (let i = 0; i < 50; i++) { t.state.note = "v" + i; t.saveState(); } });
  assert.equal(t.storeFlushStats.writes, before, "nothing written synchronously");
  await new Promise((r) => setTimeout(r, 400));
  const writes = t.storeFlushStats.writes - before;
  assert.ok(writes >= 1 && writes <= 2, "writes: " + writes);
  const raw = fs.readFileSync(t.dir + "/workspaces.json", "utf8");
  assert.ok(!raw.includes("\n  "), "compact JSON");
  assert.equal(JSON.parse(raw).workspaces.find((w) => w.id === "ai-main").state.note, "v49");
});

test("U7 SIGTERM flushes pending changes before exit", async () => {
  const fs = await import("node:fs"); const os = await import("node:os"); const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-sigterm-"));
  const appDir = fileURLToPath(new URL("..", import.meta.url));
  const child = spawn(process.execPath, ["server.js"], { cwd: appDir, stdio: ["ignore", "pipe", "pipe"], env: Object.assign({}, process.env, { PORT: "0", DATA_DIR: dir, DATABASE_URL: "", ADMIN_UI_PASSWORD: "x", COLLECTOR_ENABLED: "false", AUTO_PUBLISH_ENABLED: "false", TELEGRAM_BOT_TOKEN: "", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", STATE_SAVE_DEBOUNCE_MS: "600000", STATE_SAVE_MAX_WAIT_MS: "600000" }) });
  let out = ""; child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { out += d; });
  for (let i = 0; i < 100 && !/listening/.test(out); i++) await new Promise((r) => setTimeout(r, 100));
  assert.match(out, /listening/);
  const code = await new Promise((resolve) => { child.on("exit", resolve); child.kill("SIGTERM"); });
  assert.equal(code, 0, out.slice(-500));
  assert.match(out, /GRACEFUL_SHUTDOWN_START SIGTERM/);
  assert.match(out, /STATE_FLUSHED_ON_SIGTERM/);
  assert.match(out, /GRACEFUL_SHUTDOWN_DONE SIGTERM/);
  const parsed = JSON.parse(fs.readFileSync(path.join(dir, "workspaces.json"), "utf8"));
  assert.ok(parsed.workspaces.length >= 1);
});

test("U9 JSON body keeps Cyrillic when UTF-8 bytes are split across chunks", async () => {
  const payload = JSON.stringify({ title: "Привет, мир 🤖", text: "Кириллица не должна ломаться" });
  const buf = Buffer.from(payload, "utf8");
  const split = buf.indexOf(Buffer.from("р", "utf8")) + 1; // split inside a 2-byte Cyrillic character
  const req = Readable.from([buf.subarray(0, split), buf.subarray(split)]);
  const parsed = await readJsonBody(req, 1024 * 1024);
  assert.equal(parsed.title, "Привет, мир 🤖");
  assert.equal(parsed.text, "Кириллица не должна ломаться");

  const tooBig = Readable.from([Buffer.alloc(1100, 1)]);
  await assert.rejects(() => readJsonBody(tooBig, 1024), /request too large/);
});

test("U10 startup media repair runs after HTTP listen, not before health readiness", async () => {
  const src = fs.readFileSync(fileURLToPath(new URL("../server.js", import.meta.url)), "utf8");
  const listen = src.indexOf('server.listen(PORT, "0.0.0.0"');
  const repairCall = src.indexOf("repairBalancedQueueMediaAllWorkspaces().catch", listen);
  assert.ok(listen > 0 && repairCall > listen, "media repair must start only after server.listen");
  const betweenDbAndListen = src.slice(src.indexOf("await initDb();"), listen);
  assert.ok(!betweenDbAndListen.includes("await repairBalancedQueueMedia()"), "network image repair must not block readiness");
});

test("U11 graceful shutdown closes HTTP, waits boundedly, flushes state, then closes DB", async () => {
  const src = fs.readFileSync(fileURLToPath(new URL("../server.js", import.meta.url)), "utf8");
  const start = src.indexOf("async function gracefulShutdown(signal)");
  const end = src.indexOf('server.listen(PORT, "0.0.0.0"', start);
  const block = src.slice(start, end);
  assert.ok(block.includes("server.close(done)"), "stop accepting new HTTP work");
  assert.ok(block.includes("criticalWorkInFlight()"), "wait for critical background work");
  assert.ok(block.includes("flushWorkspaceStoreNow()"), "flush durable state");
  assert.ok(block.includes("await db.end()"), "close PostgreSQL pool cleanly");
  assert.ok(block.indexOf("flushWorkspaceStoreNow()") < block.indexOf("process.exit(0)"), "flush before exit");
});

test("U8 review bots: foreign links hold a post; prototype verdicts / 'Critical' never pass; UTF-16 caption length", async () => {
  const req = { signature: "@chtotamai", network_channels: [{ signature: "@chtotamdengi" }] };
  assert.deepEqual(foreignLinks({ title: "T", tgText: "Текст.\n\n#ии\n@chtotamai", vkText: "" }, req), []);
  assert.deepEqual(foreignLinks({ title: "T", tgText: "Читайте @chtotamdengi и ozon.ru без ссылки", vkText: "" }, req), []);
  const bad = foreignLinks({ title: "T", tgText: "Бесплатный доступ: https://free-gpt-promo.example/ref=x и бот @free_gpt_promo_bot, t.me/joinchat/abc", vkText: "www.scam.ru" }, req);
  assert.ok(bad.includes("@free_gpt_promo_bot") && bad.some((x) => /free-gpt-promo/.test(x)) && bad.some((x) => /t\.me\/joinchat/.test(x)) && bad.some((x) => /www\.scam\.ru/.test(x)), JSON.stringify(bad));
  for (const v of ["constructor", "__proto__", "hasOwnProperty", "toString"]) assert.equal(normalizeCheckerResult({ verdict: v, errors: [] }, "openai", "m").verdict, "fix", v);
  assert.equal(normalizeCheckerResult({ verdict: "pass", errors: [{ severity: "Critical", problem: "x" }] }, "openai", "m").verdict, "fix");
  assert.equal(visibleLength("🤖 ок"), 5, "emoji counts as 2 UTF-16 units");
  assert.equal(visibleLength("<b>а&amp;б</b>"), 3);
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
      else { failed += 1; console.log("FAIL - " + name + "\n" + String(r.stderr || r.stdout).split("\n").filter((l) => !/^    at/.test(l)).slice(0, 20).join("\n")); }
    }
  } finally { if (pgInst) pgInst.stop(); }
  console.log(failed ? failed + " failed" : "health-fixes tests passed");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
