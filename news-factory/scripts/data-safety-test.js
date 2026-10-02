// Offline regression tests for the data-safety fixes (audit). No network, no real PostgreSQL:
// the server is started with a fake `pg` module and a stubbed fetch where needed.
// Run: npm run test:data-safety
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  atomicWriteFileSync,
  loadJsonStoreWithRecovery,
  createAtomicStoreWriter,
  createKeyedDebouncer,
  retryWithBackoff,
  withAdvisoryLock,
  parseCbrUsdRate,
  resolveUsdRubFallback,
  dispatchBudgetAlerts,
  StoreCorruptError
} from "../lib/data-safety.js";
import { resolveCostPricing, calculateUsageCost, BUILTIN_COST_PRICING } from "../lib/costs.js";

const appDir = fileURLToPath(new URL("..", import.meta.url));
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "news-factory-data-safety-"));
let portCounter = 39400 + Math.floor(Math.random() * 400);
const quietLog = { error() {}, warn() {}, log() {} };
const sleep = function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };

const sections = [];
function section(name, fn) { sections.push({ name, fn }); }
function mkdir(name) { const dir = path.join(tmpRoot, name + "-" + Math.random().toString(36).slice(2, 7)); fs.mkdirSync(dir, { recursive: true }); return dir; }
function listFiles(dir) { return fs.readdirSync(dir).sort(); }

function makeStore(count) {
  const workspaces = [];
  for (let i = 0; i < count; i += 1) {
    workspaces.push({ id: i === 0 ? "ai-main" : "chan-" + i, name: "Channel " + i, slug: i === 0 ? "chtotamai" : "chan_" + i, telegramChannel: "@chan_" + i + "_x", telegramPublicUsername: "chan_" + i + "_x", state: { sources: [], queue: [], history: [], migrations: [] } });
  }
  // keep the car channel present so ensureConfiguredWorkspaces does not add one
  workspaces.push({ id: "chtotamtachki", name: "Что там у тачек?", slug: "chtotamtachki", telegramChannel: "@chtotamtachki", telegramPublicUsername: "chtotamtachki", state: { sources: [], queue: [], history: [], migrations: [] } });
  return { version: 1, defaultWorkspaceId: "ai-main", workspaces };
}

// ---- server runner (fake pg through a loader hook; fetch stub) --------------------------------
const hooksFile = path.join(tmpRoot, "hooks.mjs");
const fakePgFile = path.join(tmpRoot, "fake-pg.mjs");
const preloadFile = path.join(tmpRoot, "preload.mjs");
fs.writeFileSync(hooksFile, 'export async function resolve(spec, ctx, next) { if (spec === "pg") return { url: "file://' + fakePgFile.replace(/\\/g, "/") + '", shortCircuit: true }; return next(spec, ctx); }\n');
fs.writeFileSync(fakePgFile, `
import fs from "node:fs";
import { EventEmitter } from "node:events";
const LOG = process.env.FAKE_PG_LOG || "";
const FAIL_FIRST = Number(process.env.FAKE_PG_FAIL_FIRST || 0);
const EMIT_ERROR_MS = Number(process.env.FAKE_PG_EMIT_ERROR_MS || 0);
let failed = 0;
function rec(kind, sql, params) { if (LOG) fs.appendFileSync(LOG, JSON.stringify({ t: Date.now(), kind, sql: String(sql).replace(/\\s+/g, " ").slice(0, 160), p0: params && params[0] !== undefined ? String(params[0]).slice(0, 60) : null }) + "\\n"); }
function result(sql) { return { rows: /RETURNING id/i.test(sql) ? [{ id: 1 }] : [], rowCount: 0 }; }
class Client { constructor(pool) { this.pool = pool; } async query(sql, p) { rec("client", sql, p); return result(sql); } release(destroy) { rec("release", "release destroy=" + String(destroy), null); } }
class Pool extends EventEmitter {
  constructor(opts) { super(); rec("pool", "new Pool", null); if (EMIT_ERROR_MS) setTimeout(() => { rec("emit", "emit error", null); this.emit("error", new Error("Connection terminated unexpectedly")); }, EMIT_ERROR_MS); }
  async query(sql, p) {
    rec("pool", sql, p);
    if (failed < FAIL_FIRST) { failed += 1; throw new Error("fake pg: connection refused (attempt " + failed + ")"); }
    return result(sql);
  }
  async connect() { return new Client(this); }
}
export default { Pool };
export { Pool };
`);
fs.writeFileSync(preloadFile, `
import { register } from "node:module";
import fs from "node:fs";
register("file://${hooksFile.replace(/\\/g, "/")}");
globalThis.fetch = async function (input, init) {
  const url = typeof input === "string" ? input : (input && input.url) || String(input);
  if (process.env.FETCH_LOG) fs.appendFileSync(process.env.FETCH_LOG, JSON.stringify({ url, body: init && init.body ? String(init.body).slice(0, 300) : null }) + "\\n");
  const host = new URL(url).hostname;
  if (host === "www.cbr.ru") {
    if (process.env.CBR_XML_FILE && fs.existsSync(process.env.CBR_XML_FILE)) return new Response(fs.readFileSync(process.env.CBR_XML_FILE, "utf8"), { status: 200 });
    return new Response("unavailable", { status: 503 });
  }
  if (host === "api.telegram.org") {
    if (process.env.TG_MODE === "403") return new Response(JSON.stringify({ ok: false, error_code: 403, description: "Forbidden: bot was blocked" }), { status: 403, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1, chat: { id: 1 } } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response("offline", { status: 503 });
};
`);

function startServer(dataDir, extraEnv, cwd) {
  const port = portCounter++;
  const env = Object.assign({}, process.env, {
    PORT: String(port), DATA_DIR: dataDir, DATABASE_URL: "", ADMIN_UI_PASSWORD: "local-smoke-password", ADMIN_UI_PASSWORD_SHA256: "",
    COLLECTOR_ENABLED: "false", AUTO_PUBLISH_ENABLED: "false", TELEGRAM_BOT_TOKEN: "", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "",
    TELEGRAM_ALERT_CHAT_ID: "", COST_USD_RUB_RATE: ""
  }, extraEnv || {});
  const child = spawn(process.execPath, ["--import", preloadFile, "server.js"], { cwd: cwd || appDir, env, stdio: ["ignore", "pipe", "pipe"] });
  const out = [];
  child.stdout.on("data", function (x) { out.push(String(x)); });
  child.stderr.on("data", function (x) { out.push(String(x)); });
  const handle = {
    port, child,
    output() { return out.join(""); },
    exited: new Promise(function (resolve) { child.on("exit", function (code, signal) { handle.exitCode = code === null ? signal : code; resolve(handle.exitCode); }); }),
    async waitHealthy(timeoutMs) {
      const until = Date.now() + (timeoutMs || 20000);
      while (Date.now() < until) {
        if (handle.exitCode !== undefined) throw new Error("server exited early (" + handle.exitCode + "): " + handle.output().slice(-800));
        try { const r = await fetch("http://127.0.0.1:" + port + "/health"); if (r.ok) return; } catch {}
        await sleep(100);
      }
      throw new Error("server did not become healthy: " + handle.output().slice(-800));
    },
    async stop() { if (handle.exitCode === undefined) { child.kill("SIGKILL"); await handle.exited; } }
  };
  return handle;
}

// =================================================================================================
// 1. workspaces.json: atomic writes, .bak rotation, no silent re-creation
// =================================================================================================
section("atomicWriteFileSync leaves the old file intact on failure and no temp files behind", async function () {
  const dir = mkdir("atomic");
  const file = path.join(dir, "a.json");
  atomicWriteFileSync(file, '{"v":1}');
  assert.equal(fs.readFileSync(file, "utf8"), '{"v":1}');
  atomicWriteFileSync(file, '{"v":2}');
  assert.equal(fs.readFileSync(file, "utf8"), '{"v":2}');
  assert.deepEqual(listFiles(dir), ["a.json"], "no .tmp files left");
  // rename onto a directory fails -> the error propagates, temp file is removed
  const dirTarget = path.join(dir, "target");
  fs.mkdirSync(dirTarget);
  assert.throws(function () { atomicWriteFileSync(dirTarget, "x"); });
  assert.deepEqual(listFiles(dir), ["a.json", "target"], "temp file cleaned up after failure");
});

section("loadJsonStoreWithRecovery: ok / restore from .bak / missing / fatal", async function () {
  const validate = function (p) { return p && Array.isArray(p.workspaces) && p.workspaces.length > 0; };
  const store = JSON.stringify(makeStore(16));
  // ok
  let dir = mkdir("load-ok"); let file = path.join(dir, "workspaces.json");
  fs.writeFileSync(file, store);
  assert.equal(loadJsonStoreWithRecovery({ file, validate, log: quietLog }).status, "ok");
  // first start: nothing exists
  dir = mkdir("load-missing"); file = path.join(dir, "workspaces.json");
  assert.equal(loadJsonStoreWithRecovery({ file, validate, log: quietLog }).status, "missing");
  assert.equal(fs.existsSync(file), false, "loader must not create a file by itself");
  // truncated main + good .bak -> restored, damaged copy kept
  dir = mkdir("load-restore"); file = path.join(dir, "workspaces.json");
  fs.writeFileSync(file, store.slice(0, 1234));
  fs.writeFileSync(file + ".bak", store);
  const restored = loadJsonStoreWithRecovery({ file, validate, log: quietLog, now: "2026-10-02T10:00:00.000Z" });
  assert.equal(restored.status, "restored");
  assert.equal(restored.data.workspaces.length, 17);
  assert.equal(fs.readFileSync(file, "utf8"), store, "main restored byte-for-byte from .bak");
  const corrupt = listFiles(dir).filter(function (n) { return n.includes(".corrupt-"); });
  assert.equal(corrupt.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, corrupt[0]), "utf8"), store.slice(0, 1234), "damaged bytes preserved");
  // main missing + .bak -> restored
  dir = mkdir("load-missing-bak"); file = path.join(dir, "workspaces.json");
  fs.writeFileSync(file + ".bak", store);
  assert.equal(loadJsonStoreWithRecovery({ file, validate, log: quietLog }).status, "restored");
  // valid JSON but empty workspaces list is not a usable store either
  dir = mkdir("load-empty"); file = path.join(dir, "workspaces.json");
  fs.writeFileSync(file, JSON.stringify({ version: 1, workspaces: [] }));
  fs.writeFileSync(file + ".bak", store);
  assert.equal(loadJsonStoreWithRecovery({ file, validate, log: quietLog }).status, "restored");
  // damaged main, no .bak -> fatal, nothing is overwritten
  dir = mkdir("load-fatal"); file = path.join(dir, "workspaces.json");
  fs.writeFileSync(file, store.slice(0, 500));
  assert.throws(function () { loadJsonStoreWithRecovery({ file, validate, log: quietLog }); }, StoreCorruptError);
  assert.equal(fs.existsSync(file), false, "damaged file moved aside, not replaced with a fresh store");
  assert.equal(listFiles(dir).filter(function (n) { return n.includes(".corrupt-"); }).length, 1);
  // damaged main AND damaged .bak -> fatal
  dir = mkdir("load-fatal2"); file = path.join(dir, "workspaces.json");
  fs.writeFileSync(file, "{broken"); fs.writeFileSync(file + ".bak", "{also broken");
  assert.throws(function () { loadJsonStoreWithRecovery({ file, validate, log: quietLog }); }, StoreCorruptError);
});

section("createAtomicStoreWriter rotates a validated .bak and never copies garbage into it", async function () {
  const validate = function (p) { return p && Array.isArray(p.workspaces) && p.workspaces.length > 0; };
  const dir = mkdir("writer"); const file = path.join(dir, "workspaces.json");
  let now = 1000000;
  const writer = createAtomicStoreWriter({ file, validate, backupIntervalMs: 60000, log: quietLog, nowMs: function () { return now; } });
  const v = function (n) { return JSON.stringify({ workspaces: [{ id: "w" + n }] }); };
  writer.write(v(1));
  assert.equal(fs.existsSync(file + ".bak"), false, "no previous file, nothing to back up");
  now += 61000; writer.write(v(2));
  assert.equal(fs.readFileSync(file + ".bak", "utf8"), v(1), ".bak holds the previous good copy");
  assert.equal(fs.readFileSync(file, "utf8"), v(2));
  now += 1000; writer.write(v(3)); // inside the interval: .bak not rotated
  assert.equal(fs.readFileSync(file + ".bak", "utf8"), v(1));
  // main gets damaged externally; next rotation must not poison .bak
  fs.writeFileSync(file, "{truncated");
  now += 120000; writer.write(v(4));
  assert.equal(fs.readFileSync(file + ".bak", "utf8"), v(1), "garbage never copied over the good backup");
  assert.equal(fs.readFileSync(file, "utf8"), v(4));
  assert.deepEqual(listFiles(dir), ["workspaces.json", "workspaces.json.bak"]);
});

section("server: truncated workspaces.json + good .bak restores all channels (no 16 -> 1 reset)", async function () {
  const dir = mkdir("srv-restore");
  const store = JSON.stringify(makeStore(16), null, 2);
  fs.writeFileSync(path.join(dir, "workspaces.json"), store.slice(0, Math.floor(store.length / 2)));
  fs.writeFileSync(path.join(dir, "workspaces.json.bak"), store);
  const srv = startServer(dir);
  try {
    await srv.waitHealthy();
    const after = JSON.parse(fs.readFileSync(path.join(dir, "workspaces.json"), "utf8"));
    assert.ok(after.workspaces.length >= 17, "all channels kept, got " + after.workspaces.length);
    assert.ok(after.workspaces.some(function (w) { return w.id === "chan-15"; }));
    assert.ok(listFiles(dir).some(function (n) { return n.startsWith("workspaces.json.corrupt-"); }), "damaged file preserved");
    assert.match(srv.output(), /restored from workspaces\.json\.bak/);
  } finally { await srv.stop(); }
});

section("server: corrupt workspaces.json without usable .bak refuses to start and keeps the data", async function () {
  const dir = mkdir("srv-fatal");
  const store = JSON.stringify(makeStore(16), null, 2);
  const broken = store.slice(0, Math.floor(store.length / 3));
  fs.writeFileSync(path.join(dir, "workspaces.json"), broken);
  const srv = startServer(dir);
  try {
    const code = await Promise.race([srv.exited, sleep(15000).then(function () { return "timeout"; })]);
    assert.notEqual(code, "timeout", "process must exit");
    assert.notEqual(code, 0, "non-zero exit code");
    assert.equal(fs.existsSync(path.join(dir, "workspaces.json")), false, "no fresh store written over the damaged one");
    const kept = listFiles(dir).filter(function (n) { return n.startsWith("workspaces.json.corrupt-"); });
    assert.equal(kept.length, 1);
    assert.equal(fs.readFileSync(path.join(dir, kept[0]), "utf8"), broken, "original bytes preserved");
    assert.match(srv.output(), /corrupt and no usable backup/);
  } finally { await srv.stop(); }
});

section("server: healthy start writes workspaces.json atomically and creates .bak", async function () {
  const dir = mkdir("srv-ok");
  fs.writeFileSync(path.join(dir, "workspaces.json"), JSON.stringify(makeStore(3), null, 2));
  const srv = startServer(dir);
  try {
    await srv.waitHealthy();
    assert.ok(fs.existsSync(path.join(dir, "workspaces.json.bak")), ".bak created from the known-good file at boot");
    assert.equal(listFiles(dir).filter(function (n) { return n.endsWith(".tmp"); }).length, 0, "no temp files left");
    JSON.parse(fs.readFileSync(path.join(dir, "workspaces.json"), "utf8"));
  } finally { await srv.stop(); }
});

// =================================================================================================
// 2-4, 10. DB: per-workspace snapshot debounce, pool error handler, init retry + advisory lock,
//          missing migrations directory
// =================================================================================================
const FAKE_DB_URL = "postgres://nfuser:s3cretpw-do-not-log@db.invalid:5432/nf";

function readPgLog(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(function (l) { return JSON.parse(l); });
}
async function waitForOutput(srv, re, timeoutMs) {
  const until = Date.now() + (timeoutMs || 10000);
  while (Date.now() < until && !re.test(srv.output())) await sleep(100);
}

section("createKeyedDebouncer: one timer per key, same key coalesces", async function () {
  const fired = [];
  const d = createKeyedDebouncer(40, function (key) { fired.push(key); });
  d.schedule("a"); d.schedule("b"); d.schedule("c");
  d.schedule("a"); d.schedule("a"); // coalesced
  assert.deepEqual(d.pending().sort(), ["a", "b", "c"]);
  await sleep(150);
  assert.deepEqual(fired.slice().sort(), ["a", "b", "c"], "every workspace fires exactly once; none is dropped by another");
  assert.deepEqual(d.pending(), []);
});

section("retryWithBackoff is bounded and backs off exponentially", async function () {
  const delays = [];
  let calls = 0;
  const value = await retryWithBackoff(async function () { calls += 1; if (calls < 3) throw new Error("boom"); return "ok"; }, { attempts: 5, baseMs: 100, maxMs: 1000, sleep: async function (ms) { delays.push(ms); } });
  assert.equal(value, "ok"); assert.equal(calls, 3); assert.deepEqual(delays, [100, 200]);
  calls = 0;
  await assert.rejects(retryWithBackoff(async function () { calls += 1; throw new Error("always"); }, { attempts: 4, baseMs: 10, maxMs: 25, sleep: async function (ms) { delays.push(ms); } }), /always/);
  assert.equal(calls, 4, "gives up after the configured attempts");
  assert.deepEqual(delays.slice(2), [10, 20, 25], "delay is capped at maxMs");
});

section("withAdvisoryLock releases the lock in finally (success, failure, failed unlock)", async function () {
  function fakeDb(unlockFails) {
    const log = [];
    return { log, async connect() { return { async query(sql, p) { log.push(sql.replace(/\s+/g, " ") + (p ? " " + p[0] : "")); if (unlockFails && /unlock/.test(sql)) throw new Error("conn lost"); return { rows: [] }; }, release(destroy) { log.push("release:" + String(destroy)); } }; } };
  }
  let db = fakeDb(false);
  assert.equal(await withAdvisoryLock(db, 42, async function () { db.log.push("work"); return 7; }), 7);
  assert.deepEqual(db.log, ["SELECT pg_advisory_lock($1) 42", "work", "SELECT pg_advisory_unlock($1) 42", "release:undefined"]);
  db = fakeDb(false);
  await assert.rejects(withAdvisoryLock(db, 42, async function () { throw new Error("migration failed"); }), /migration failed/);
  assert.deepEqual(db.log, ["SELECT pg_advisory_lock($1) 42", "SELECT pg_advisory_unlock($1) 42", "release:undefined"], "unlocked even though fn threw");
  db = fakeDb(true);
  await withAdvisoryLock(db, 42, async function () {});
  assert.equal(db.log[db.log.length - 1], "release:true", "client with a failed unlock is destroyed, not returned to the pool");
});

section("server: pg pool 'error' event does not kill the process and the DB URL is never logged", async function () {
  const dir = mkdir("srv-poolerr"); const pgLog = path.join(dir, "pg.jsonl");
  fs.writeFileSync(path.join(dir, "workspaces.json"), JSON.stringify(makeStore(2)));
  const srv = startServer(dir, { DATABASE_URL: FAKE_DB_URL, FAKE_PG_LOG: pgLog, FAKE_PG_EMIT_ERROR_MS: "1500" });
  try {
    await srv.waitHealthy();
    await sleep(2500);
    assert.ok(readPgLog(pgLog).some(function (r) { return r.kind === "emit"; }), "fake pool emitted an error");
    assert.equal(srv.exitCode, undefined, "process still alive after the pool error");
    await srv.waitHealthy(3000);
    assert.match(srv.output(), /PostgreSQL pool error \(idle client\): Connection terminated unexpectedly/);
    assert.ok(!srv.output().includes("s3cretpw"), "no secrets in logs");
  } finally { await srv.stop(); }
});

section("server: initDb retries with backoff and takes/releases the advisory lock around every attempt", async function () {
  const dir = mkdir("srv-initretry"); const pgLog = path.join(dir, "pg.jsonl");
  fs.writeFileSync(path.join(dir, "workspaces.json"), JSON.stringify(makeStore(2)));
  const srv = startServer(dir, { DATABASE_URL: FAKE_DB_URL, FAKE_PG_LOG: pgLog, FAKE_PG_FAIL_FIRST: "2", DB_INIT_RETRY_BASE_MS: "50" });
  try {
    await srv.waitHealthy();
    assert.match(srv.output(), /PostgreSQL init attempt 1 failed/);
    assert.match(srv.output(), /PostgreSQL init attempt 2 failed/);
    assert.match(srv.output(), /PostgreSQL ready/, "third attempt succeeds, dbReady becomes true");
    const rows = readPgLog(pgLog);
    const locks = rows.filter(function (r) { return /pg_advisory_lock/.test(r.sql); }).length;
    const unlocks = rows.filter(function (r) { return /pg_advisory_unlock/.test(r.sql); }).length;
    assert.equal(locks, 3, "one lock per attempt");
    assert.equal(unlocks, 3, "every lock released (also after the failed attempts)");
    const firstLock = rows.findIndex(function (r) { return /pg_advisory_lock/.test(r.sql); });
    const firstCreate = rows.findIndex(function (r) { return /CREATE TABLE IF NOT EXISTS news_items/.test(r.sql); });
    assert.ok(firstLock >= 0 && firstLock < firstCreate, "schema bootstrap runs under the lock");
    const migIdx = rows.findIndex(function (r) { return /INSERT INTO schema_migrations/.test(r.sql); });
    const lastUnlock = rows.map(function (r) { return /pg_advisory_unlock/.test(r.sql); }).lastIndexOf(true);
    assert.ok(migIdx >= 0 && migIdx < lastUnlock, "migrations are applied before the lock is released");
  } finally { await srv.stop(); }
});

section("server: initDb gives up after bounded attempts, keeps serving and recovers in the background", async function () {
  const dir = mkdir("srv-initgiveup"); const pgLog = path.join(dir, "pg.jsonl");
  fs.writeFileSync(path.join(dir, "workspaces.json"), JSON.stringify(makeStore(2)));
  const srv = startServer(dir, { DATABASE_URL: FAKE_DB_URL, FAKE_PG_LOG: pgLog, FAKE_PG_FAIL_FIRST: "4", DB_INIT_MAX_ATTEMPTS: "3", DB_INIT_RETRY_BASE_MS: "20", DB_INIT_RECOVERY_MS: "1500" });
  try {
    await srv.waitHealthy();
    assert.match(srv.output(), /PostgreSQL init failed/);
    await waitForOutput(srv, /PostgreSQL ready/, 10000);
    assert.match(srv.output(), /PostgreSQL ready/, "background retry round brings the DB up (dbReady no longer stuck false)");
  } finally { await srv.stop(); }
});

section("server: missing migrations directory is logged as an error", async function () {
  const copy = mkdir("srv-nomigrations");
  for (const name of ["server.js", "package.json", "lib", "prompts", "public"]) {
    if (fs.existsSync(path.join(appDir, name))) fs.cpSync(path.join(appDir, name), path.join(copy, name), { recursive: true });
  }
  fs.symlinkSync(path.join(appDir, "node_modules"), path.join(copy, "node_modules"), "dir");
  const dir = mkdir("srv-nomigrations-data");
  fs.writeFileSync(path.join(dir, "workspaces.json"), JSON.stringify(makeStore(2)));
  const srv = startServer(dir, { DATABASE_URL: FAKE_DB_URL }, copy);
  try {
    await srv.waitHealthy();
    assert.match(srv.output(), /DB migrations directory not found/);
  } finally { await srv.stop(); }
});

section("server: per-workspace snapshot debounce keeps every workspace's snapshot", async function () {
  const dir = mkdir("srv-snap"); const pgLog = path.join(dir, "pg.jsonl");
  fs.writeFileSync(path.join(dir, "workspaces.json"), JSON.stringify(makeStore(4)));
  const srv = startServer(dir, { DATABASE_URL: FAKE_DB_URL, FAKE_PG_LOG: pgLog });
  try {
    await srv.waitHealthy();
    await waitForOutput(srv, /PostgreSQL ready/, 10000);
    await sleep(2000);
    const login = await fetch("http://127.0.0.1:" + srv.port + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "local-smoke-password" }) });
    const cookie = String(login.headers.get("set-cookie") || "").split(";")[0];
    fs.writeFileSync(pgLog, "");
    const ids = ["chan-1", "chan-2", "chan-3"];
    const rs = await Promise.all(ids.map(function (id) {
      return fetch("http://127.0.0.1:" + srv.port + "/api/sources", { method: "POST", headers: { "content-type": "application/json", cookie, "x-workspace-id": id }, body: JSON.stringify({ name: "s-" + id, url: "https://x-" + id + ".example.com/news" }) });
    }));
    for (const r of rs) assert.equal(r.status, 200, "source added");
    await sleep(3500);
    const inserted = readPgLog(pgLog).filter(function (r) { return /INSERT INTO app_snapshots/.test(r.sql); }).map(function (r) { return r.p0; });
    for (const id of ids) assert.ok(inserted.includes(id), "snapshot saved for " + id + ", got " + JSON.stringify(inserted));
  } finally { await srv.stop(); }
});

section("history trimming is consistent (300) in every handler", async function () {
  const src = fs.readFileSync(path.join(appDir, "server.js"), "utf8");
  assert.ok(!/history\s*=\s*state\.history\.slice\(0,\s*100\)/.test(src), "no history.slice(0, 100) left");
  assert.ok((src.match(/state\.history\s*=\s*state\.history\.slice\(0,\s*300\)/g) || []).length >= 6);
});

// =================================================================================================
// 5, 6, 8. USD/RUB parsing + fallback, budget alert de-duplication
// =================================================================================================
const CBR_XML = '<?xml version="1.0" encoding="windows-1251"?><ValCurs Date="02.10.2026" name="Foreign Currency Market">\n' +
  '<Valute ID="R01010"><NumCode>036</NumCode><CharCode>AUD</CharCode><Nominal>1</Nominal><Name>Австралийский доллар</Name><Value>52,5000</Value><VunitRate>52,5</VunitRate></Valute>\n' +
  '<Valute ID="R01020A"><NumCode>944</NumCode><CharCode>AZN</CharCode><Nominal>1</Nominal><Name>Азербайджанский манат</Name><Value>47,0000</Value><VunitRate>47</VunitRate></Valute>\n' +
  '<Valute ID="R01235"><NumCode>840</NumCode><CharCode>USD</CharCode><Nominal>1</Nominal><Name>Доллар США</Name><Value>80,1234</Value><VunitRate>80,1234</VunitRate></Valute>\n' +
  '<Valute ID="R01820"><NumCode>392</NumCode><CharCode>JPY</CharCode><Nominal>100</Nominal><Name>Японских иен</Name><Value>55,0000</Value><VunitRate>0,55</VunitRate></Valute>\n</ValCurs>';

section("parseCbrUsdRate picks the USD block even when AUD/JPY come first", async function () {
  assert.equal(parseCbrUsdRate(CBR_XML), 80.1234, "was 52.5 (AUD) with the old regex");
  const jpyFirst = CBR_XML.replace("<CharCode>AUD</CharCode><Nominal>1</Nominal>", "<CharCode>JPY</CharCode><Nominal>100</Nominal>");
  assert.equal(parseCbrUsdRate(jpyFirst), 80.1234);
  const usdNominal = CBR_XML.replace("<CharCode>USD</CharCode><Nominal>1</Nominal>", "<CharCode>USD</CharCode><Nominal>10</Nominal>").replace("80,1234</Value>", "801,2340</Value>");
  assert.ok(Math.abs(parseCbrUsdRate(usdNominal) - 80.1234) < 1e-9, "Value / Nominal");
  assert.throws(function () { parseCbrUsdRate(CBR_XML.replace(/USD/g, "USX")); }, /USD not found/);
  assert.throws(function () { parseCbrUsdRate(CBR_XML.replace("80,1234</Value>", "abc</Value>")); }, /bad CBR/);
  assert.throws(function () { parseCbrUsdRate(""); });
});

section("resolveUsdRubFallback: last known -> configured -> built-in constant, never 0", async function () {
  assert.deepEqual(resolveUsdRubFallback({ lastGood: { value: 79, at: 5 }, configured: "95" }), { rate: 79, source: "last_known", at: 5 });
  assert.equal(resolveUsdRubFallback({ configured: "95" }).source, "configured");
  assert.equal(resolveUsdRubFallback({ configured: "95" }).rate, 95);
  for (const bad of [undefined, "", "0", "-3", "abc", NaN]) {
    const r = resolveUsdRubFallback({ configured: bad, lastGood: { value: bad }, defaultRate: 90 });
    assert.equal(r.source, "default"); assert.equal(r.rate, 90);
  }
});

section("dispatchBudgetAlerts: concurrent evaluations send once; failures do not spam", async function () {
  // slow Telegram, 8 concurrent evaluations
  let sends = 0;
  const alerts = {};
  const run = function (send) { return dispatchBudgetAlerts({ alerts, day: "2026-10-02", thresholds: [80, 100], reached: function (t) { return t === 80; }, send, nowMs: 1000, retryMs: 60000, onError() {} }); };
  await Promise.all(Array.from({ length: 8 }, function () { return run(async function () { sends += 1; await sleep(50); return true; }); }));
  assert.equal(sends, 1, "key claimed before the await: exactly one send, not 6-8");
  assert.equal(alerts.last80Day, "2026-10-02");
  await run(async function () { sends += 1; return true; });
  assert.equal(sends, 1, "same day: no resend");
  // Telegram 403: one attempt per cool-down window, claim rolled back so the alert is retried later
  sends = 0;
  const alerts2 = {};
  const fail = function (nowMs) { return dispatchBudgetAlerts({ alerts: alerts2, day: "2026-10-02", thresholds: [100], reached: function () { return true; }, send: async function () { sends += 1; await sleep(20); throw new Error("403 Forbidden"); }, nowMs, retryMs: 30 * 60 * 1000, onError() {} }); };
  await Promise.all(Array.from({ length: 8 }, function () { return fail(1000); }));
  assert.equal(sends, 1, "8 concurrent evaluations + 403 -> a single attempt");
  await fail(1000 + 5 * 60 * 1000);
  assert.equal(sends, 1, "no retry inside the cool-down");
  assert.equal(alerts2.last100Day, undefined, "failed alert is not marked as delivered");
  await fail(1000 + 31 * 60 * 1000);
  assert.equal(sends, 2, "retried after the cool-down");
  // nothing to send (no chat configured) releases the claim
  const alerts3 = {};
  await dispatchBudgetAlerts({ alerts: alerts3, day: "d", thresholds: [80], reached: function () { return true; }, send: async function () { return false; } });
  assert.equal(alerts3.last80Day, undefined);
});

section("server: CBR XML with AUD first -> USD rate used and persisted as last known good", async function () {
  const dir = mkdir("srv-cbr"); const xml = path.join(dir, "cbr.xml");
  fs.writeFileSync(xml, CBR_XML);
  fs.writeFileSync(path.join(dir, "workspaces.json"), JSON.stringify(makeStore(2)));
  const srv = startServer(dir, { CBR_XML_FILE: xml });
  try {
    await srv.waitHealthy();
    const login = await fetch("http://127.0.0.1:" + srv.port + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "local-smoke-password" }) });
    const cookie = String(login.headers.get("set-cookie") || "").split(";")[0];
    const r = await fetch("http://127.0.0.1:" + srv.port + "/api/costs/budget", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ dailyRub: 500 }) });
    const json = await r.json();
    assert.equal(json.budget.fxSource, "cbr");
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "workspaces.json"), "utf8"));
    assert.equal(saved.workspaces[0].state.costBudget.lastUsdRub.value, 80.1234);
  } finally { await srv.stop(); }
});

section("server: CBR down -> economy/budget keep a non-zero rate (last known, then env constant, then built-in)", async function () {
  async function budgetFx(extraEnv, lastUsdRub) {
    const dir = mkdir("srv-fx");
    const store = makeStore(2);
    if (lastUsdRub) store.workspaces[0].state.costBudget = { monthlyRub: 0, dailyRub: 0, economyMode: true, economyReason: "daily", alerts: {}, updatedAt: "", lastUsdRub };
    fs.writeFileSync(path.join(dir, "workspaces.json"), JSON.stringify(store));
    const srv = startServer(dir, extraEnv);
    try {
      await srv.waitHealthy();
      const login = await fetch("http://127.0.0.1:" + srv.port + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "local-smoke-password" }) });
      const cookie = String(login.headers.get("set-cookie") || "").split(";")[0];
      const r = await fetch("http://127.0.0.1:" + srv.port + "/api/costs/budget", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ dailyRub: 500 }) });
      const json = await r.json();
      return { budget: json.budget, output: srv.output() };
    } finally { await srv.stop(); }
  }
  let r = await budgetFx({}, { value: 77.5, at: "2026-10-01T10:00:00.000Z" });
  assert.equal(r.budget.fxAvailable, true); assert.equal(r.budget.fxSource, "last_known");
  assert.match(r.output, /using last_known rate 77\.5/);
  r = await budgetFx({ COST_USD_RUB_RATE: "95" }, null);
  assert.equal(r.budget.fxSource, "configured"); assert.match(r.output, /using configured rate 95/);
  r = await budgetFx({}, null);
  assert.equal(r.budget.fxSource, "default"); assert.equal(r.budget.fxAvailable, true);
  assert.equal((r.output.match(/USD\/RUB: CBR unavailable/g) || []).length, 1, "logged once, not on every call");
});

// =================================================================================================
// 7. COST_PRICING_JSON validation
// =================================================================================================
section("COST_PRICING_JSON: NaN/negative/garbage prices are rejected with warnings and never produce NaN costs", async function () {
  const bad = JSON.stringify({
    anthropic: { "claude-sonnet-5-5": { input: "2,0", output: -5, cacheRead: 0.3 }, "claude-new": { input: "oops" }, "claude-ok": { input: 3, output: "15" } },
    openaiText: { "gpt-6-luna": { output: null, input: Infinity } },
    railway: { cpuVcpuMonth: -1, memoryGbMonth: "abc", volumeGbMonth: 0.2 }
  });
  const r = resolveCostPricing(bad);
  assert.ok(Array.isArray(r.warnings) && r.warnings.length >= 6, "warnings: " + JSON.stringify(r.warnings));
  const sonnet = r.pricing.anthropic["claude-sonnet-5-5"];
  assert.equal(sonnet.input, BUILTIN_COST_PRICING.anthropic["claude-sonnet-5-5"].input, "invalid override ignored, builtin kept");
  assert.equal(sonnet.output, BUILTIN_COST_PRICING.anthropic["claude-sonnet-5-5"].output);
  assert.equal(sonnet.cacheRead, 0.3, "valid override applied");
  assert.equal(r.pricing.anthropic["claude-new"], undefined, "new model without any valid rate is skipped");
  assert.deepEqual(r.pricing.anthropic["claude-ok"], { input: 3, output: 15 }, "numeric strings are accepted as numbers");
  assert.equal(r.pricing.railway.cpuVcpuMonth, BUILTIN_COST_PRICING.railway.cpuVcpuMonth);
  assert.equal(r.pricing.railway.volumeGbMonth, 0.2);
  for (const sec of ["openaiText", "openaiImage", "anthropic"]) for (const rate of Object.values(r.pricing[sec])) for (const v of Object.values(rate)) assert.ok(Number.isFinite(v) && v >= 0, sec + " value " + v);
  const cost = calculateUsageCost("anthropic", "claude-sonnet-5-5", { input_tokens: 1000, output_tokens: 100 }, "messages", r.pricing);
  assert.ok(Number.isFinite(cost.costUsd) && cost.costUsd > 0);
  // defence in depth: even a hand-built pricing object with a garbage string yields 0 + unknown, never NaN
  const poisoned = JSON.parse(JSON.stringify(BUILTIN_COST_PRICING));
  poisoned.anthropic["claude-sonnet-5-5"].input = "2,0";
  const c2 = calculateUsageCost("anthropic", "claude-sonnet-5-5", { input_tokens: 1000, output_tokens: 100 }, "messages", poisoned);
  assert.equal(c2.costUsd, 0); assert.equal(c2.pricingKnown, false);
  // valid JSON unchanged, no warnings
  const good = resolveCostPricing(JSON.stringify({ anthropic: { "claude-sonnet-5-5": { input: 2.5 } } }));
  assert.equal(good.pricing.anthropic["claude-sonnet-5-5"].input, 2.5); assert.deepEqual(good.warnings || [], []);
});

// =================================================================================================
const only = process.argv[2] ? new RegExp(process.argv[2], "i") : null;
let failures = 0;
for (const s of sections) {
  if (only && !only.test(s.name)) continue;
  try { await s.fn(); console.log("ok   - " + s.name); } catch (error) { failures += 1; console.error("FAIL - " + s.name + "\n" + (error && error.stack || error)); }
}
try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
if (failures) { console.error(failures + " data-safety test(s) failed"); process.exit(1); }
console.log("data-safety tests passed");
