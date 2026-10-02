// Tests for the channel-list watchdog and the off-site backup (lib/workspace-watchdog.js, lib/offsite-backup.js).
//   npm run test:data-protection
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadServer, dbRows, startTempPostgres } from "./dedupe-harness.js";
import { backupConfig, backupConfigProblem, packBackup, unpackBackup, encryptBuffer, decryptBuffer, backupObjectKey, signS3Put, uploadBackup, backupDue } from "../lib/offsite-backup.js";
import { missingWorkspaces, missingAlertText, createAlertThrottle } from "../lib/workspace-watchdog.js";

const cases = {};
function test(name, fn) { cases[name] = fn; }
const KEY = "correct horse battery staple 123";
const S3ENV = { BACKUP_S3_ENDPOINT: "https://s3.example.test", BACKUP_S3_BUCKET: "nf-backups", BACKUP_S3_ACCESS_KEY_ID: "AKTEST", BACKUP_S3_SECRET_ACCESS_KEY: "SKTEST", BACKUP_ENCRYPTION_KEY: KEY, BACKUP_ALLOW_UNENCRYPTED: "", BACKUP_ENABLED: "", BACKUP_S3_PREFIX: "", BACKUP_S3_REGION: "" };
const three = [["ai-main", "ai", "Что там у ИИ?"], ["chtotamtachki", "auto", "Что там у тачек?"], ["chtotamcrypto", "crypto", "Что там у крипты?"]];

function installFakeNetwork(opts = {}) {
  const calls = { s3: [], telegram: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith("https://s3.example.test/")) {
      calls.s3.push({ url: u, method: init.method, headers: init.headers, body: init.body });
      if (opts.s3Status && opts.s3Status !== 200) return new Response("<Error>AccessDenied</Error>", { status: opts.s3Status });
      return new Response("", { status: 200, headers: { etag: "\"abc\"" } });
    }
    if (u.startsWith("https://api.telegram.org/")) {
      calls.telegram.push({ url: u, body: JSON.parse(init.body || "{}") });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 200 });
  };
  return calls;
}

test("P1 encryption round trip; wrong key and tampering are rejected", async () => {
  const payload = { a: 1, text: "привет" };
  const packed = packBackup(payload, KEY);
  assert.equal(packed.encrypted, true);
  assert.equal(packed.ext, "json.gz.enc");
  assert.deepEqual(unpackBackup(packed.buffer, KEY), payload);
  assert.throws(() => unpackBackup(packed.buffer, "another passphrase 456789"));
  const tampered = Buffer.from(packed.buffer); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => unpackBackup(tampered, KEY));
  assert.throws(() => unpackBackup(packed.buffer, ""), /passphrase/);
  const plain = packBackup(payload, "");
  assert.equal(plain.encrypted, false);
  assert.deepEqual(unpackBackup(plain.buffer, ""), payload);
  assert.notEqual(packed.buffer.toString("latin1").indexOf("привет"), 0);
  assert.equal(packed.buffer.includes(Buffer.from("привет")), false, "ciphertext must not contain clear text");
  assert.deepEqual(JSON.parse(decryptBuffer(encryptBuffer(Buffer.from("{\"x\":2}"), KEY), KEY).toString()), { x: 2 });
});

test("P2 config: opt-in, encrypted by default, clamped interval", async () => {
  assert.equal(backupConfig({}), null);
  assert.equal(backupConfig({ BACKUP_S3_ENDPOINT: "https://x", BACKUP_S3_BUCKET: "b" }), null, "incomplete -> disabled");
  const base = { BACKUP_S3_ENDPOINT: "https://s3.example.test/", BACKUP_S3_BUCKET: "b", BACKUP_S3_ACCESS_KEY_ID: "a", BACKUP_S3_SECRET_ACCESS_KEY: "s" };
  const cfg = backupConfig(base);
  assert.equal(cfg.endpoint, "https://s3.example.test");
  assert.equal(cfg.prefix, "news-factory/");
  assert.equal(cfg.intervalHours, 24);
  assert.equal(backupConfigProblem(cfg), "encryption_key_missing");
  assert.equal(backupConfigProblem(backupConfig(Object.assign({ BACKUP_ENCRYPTION_KEY: "short" }, base))), "encryption_key_too_short");
  assert.equal(backupConfigProblem(backupConfig(Object.assign({ BACKUP_ENCRYPTION_KEY: KEY }, base))), "");
  assert.equal(backupConfigProblem(backupConfig(Object.assign({ BACKUP_ALLOW_UNENCRYPTED: "true" }, base))), "");
  assert.equal(backupConfig(Object.assign({ BACKUP_ENABLED: "false", BACKUP_ENCRYPTION_KEY: KEY }, base)), null);
  assert.equal(backupConfig(Object.assign({ BACKUP_INTERVAL_HOURS: "0" }, base)).intervalHours, 24);
  assert.equal(backupConfig(Object.assign({ BACKUP_INTERVAL_HOURS: "9999" }, base)).intervalHours, 168);
  assert.equal(backupDue("", 24, Date.parse("2026-10-02T00:00:00Z")), true);
  assert.equal(backupDue("2026-10-01T12:00:00Z", 24, Date.parse("2026-10-02T00:00:00Z")), false);
  assert.equal(backupDue("2026-10-01T00:00:00Z", 24, Date.parse("2026-10-02T00:00:01Z")), true);
  assert.equal(backupObjectKey("p/", new Date("2026-10-02T03:04:05Z"), "json.gz.enc"), "p/2026/10/02/news-factory-20261002T030405Z.json.gz.enc");
});

test("P3 SigV4 request is well formed and sensitive to every input", async () => {
  const cfg = backupConfig({ BACKUP_S3_ENDPOINT: "https://s3.example.test", BACKUP_S3_BUCKET: "b", BACKUP_S3_ACCESS_KEY_ID: "AK", BACKUP_S3_SECRET_ACCESS_KEY: "SK", BACKUP_ENCRYPTION_KEY: KEY, BACKUP_S3_REGION: "eu-west-1" });
  const now = new Date("2026-10-02T03:04:05Z");
  const a = signS3Put(cfg, "news-factory/2026/10/02/x.json.gz.enc", Buffer.from("body"), now);
  assert.equal(a.url, "https://s3.example.test/b/news-factory/2026/10/02/x.json.gz.enc");
  assert.equal(a.headers["x-amz-date"], "20261002T030405Z");
  assert.match(a.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=AK\/20261002\/eu-west-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.equal(a.headers["x-amz-content-sha256"], "230d8358dc8e8890b4c58deeb62912ee2f20357ae92a5cc861b98e68fe31acb5");
  assert.equal(signS3Put(cfg, "news-factory/2026/10/02/x.json.gz.enc", Buffer.from("body"), now).headers.Authorization, a.headers.Authorization, "deterministic");
  const sig = (c, k, b, d) => signS3Put(c, k, Buffer.from(b), d).headers.Authorization.split("Signature=")[1];
  const base = sig(cfg, "k", "body", now);
  assert.notEqual(base, sig(cfg, "k2", "body", now));
  assert.notEqual(base, sig(cfg, "k", "body2", now));
  assert.notEqual(base, sig(cfg, "k", "body", new Date("2026-10-02T03:04:06Z")));
  assert.notEqual(base, sig(Object.assign({}, cfg, { secretAccessKey: "other" }), "k", "body", now));
  assert.equal(JSON.stringify(a).includes("SK"), false, "secret never leaves the signer");
});

test("P4 upload: PUT with signed headers; HTTP errors surface", async () => {
  const cfg = backupConfig({ BACKUP_S3_ENDPOINT: "https://s3.example.test", BACKUP_S3_BUCKET: "b", BACKUP_S3_ACCESS_KEY_ID: "AK", BACKUP_S3_SECRET_ACCESS_KEY: "SK", BACKUP_ENCRYPTION_KEY: KEY });
  const seen = [];
  const ok = await uploadBackup(cfg, "a/b.bin", Buffer.from("zz"), async (url, init) => { seen.push({ url, init }); return new Response("", { status: 200, headers: { etag: "\"e\"" } }); });
  assert.equal(ok.bytes, 2); assert.equal(ok.etag, "\"e\"");
  assert.equal(seen[0].init.method, "PUT");
  assert.match(seen[0].init.headers.Authorization, /^AWS4-HMAC-SHA256/);
  await assert.rejects(uploadBackup(cfg, "a/b.bin", Buffer.from("zz"), async () => new Response("<Error>AccessDenied</Error>", { status: 403 })), /HTTP 403 .*AccessDenied/);
  await assert.rejects(uploadBackup(cfg, "a/b.bin", Buffer.from("zz"), async () => { throw new Error("network down"); }), /network down/);
});

test("P5 watchdog helpers", async () => {
  const known = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }];
  assert.deepEqual(missingWorkspaces(known, ["a", "c"]).map((r) => r.id), ["b"]);
  assert.deepEqual(missingWorkspaces(known, ["a", "b", "c", "d"]), []);
  assert.deepEqual(missingWorkspaces([], []), []);
  assert.match(missingAlertText([{ id: "b", name: "B" }], 2), /B \(b\)/);
  const th = createAlertThrottle(1000);
  assert.equal(th("k", 5000), true);
  assert.equal(th("k", 5500), false);
  assert.equal(th("other", 5500), true);
  assert.equal(th("k", 6100), true);
});

test("P6 server backup: encrypted upload with every channel, status file, single-flight, refuses unencrypted", async () => {
  const t = await loadServer({ db: true, fixedNow: "2026-10-02T20:00:00Z", channels: three, env: Object.assign({}, S3ENV, { WORKSPACE_RECOVERY_ENABLED: "false" }) });
  const calls2 = installFakeNetwork();
  await new Promise((r) => setTimeout(r, 1500));
  await dbRows("INSERT INTO app_snapshots(workspace_id,state) VALUES('chtotamcrypto','{\"sources\":[],\"queue\":[],\"history\":[]}'::jsonb) RETURNING 1");
  const [r1, r2] = await Promise.all([t.runOffsiteBackup("test"), t.runOffsiteBackup("test")]);
  const ok = [r1, r2].filter((r) => r.ok), skipped = [r1, r2].filter((r) => r.skipped);
  assert.equal(ok.length, 1, JSON.stringify([r1, r2])); assert.equal(skipped.length, 1); assert.equal(skipped[0].skipped, "running");
  assert.equal(calls2.s3.length, 1);
  const put = calls2.s3[0];
  assert.equal(put.method, "PUT");
  assert.match(put.url, /^https:\/\/s3\.example\.test\/nf-backups\/news-factory\/2026\/10\/02\/news-factory-20261002T200000Z\.json\.gz\.enc$/);
  const payload = unpackBackup(Buffer.from(put.body), KEY);
  assert.equal(payload.workspaceStore.workspaces.length, 3);
  assert.equal(payload.snapshots.some((s) => s.workspaceId === "chtotamcrypto"), true);
  assert.throws(() => unpackBackup(Buffer.from(put.body), "wrong wrong wrong wrong"));
  const status = t.readBackupStatus();
  assert.equal(status.consecutiveFailures, 0); assert.equal(status.workspaces, 3); assert.equal(status.encrypted, true);
  assert.equal(JSON.stringify(status).includes("SKTEST"), false);
  // unencrypted upload is refused unless explicitly allowed
  process.env.BACKUP_ENCRYPTION_KEY = "";
  const before = calls2.s3.length;
  const refused = await t.runOffsiteBackup("test");
  assert.equal(refused.skipped, "encryption_key_missing");
  assert.equal(calls2.s3.length, before);
});

test("P7 server backup failure: counted, owner alerted on the second failure, recovers after", async () => {
  const t = await loadServer({ db: true, fixedNow: "2026-10-02T20:00:00Z", channels: three, env: Object.assign({}, S3ENV, { TELEGRAM_BOT_TOKEN: "tok", TELEGRAM_ALERT_CHAT_ID: "-100123", WORKSPACE_RECOVERY_ENABLED: "false" }) });
  await new Promise((r) => setTimeout(r, 1500));
  let calls = installFakeNetwork({ s3Status: 403 });
  const f1 = await t.runOffsiteBackup("test");
  assert.match(f1.error, /HTTP 403/);
  assert.equal(calls.telegram.length, 0, "no alert on the first failure");
  const f2 = await t.runOffsiteBackup("test");
  assert.match(f2.error, /HTTP 403/);
  assert.equal(calls.telegram.length, 1);
  assert.equal(calls.telegram[0].body.chat_id, "-100123");
  assert.match(calls.telegram[0].body.text, /бэкап не удался 2/);
  assert.equal(t.readBackupStatus().consecutiveFailures, 2);
  calls = installFakeNetwork();
  const ok = await t.runOffsiteBackup("test");
  assert.equal(ok.ok, true);
  assert.equal(t.readBackupStatus().consecutiveFailures, 0);
  assert.equal(t.readBackupStatus().lastError, "");
});

test("P8 server watchdog: a vanished channel raises one alert; a deliberately removed one does not", async () => {
  const t = await loadServer({ db: true, fixedNow: "2026-10-02T20:00:00Z", channels: three, env: Object.assign({}, S3ENV, { TELEGRAM_BOT_TOKEN: "tok", TELEGRAM_ALERT_CHAT_ID: "-100123", WORKSPACE_RECOVERY_ENABLED: "false" }) });
  await new Promise((r) => setTimeout(r, 1500));
  const calls = installFakeNetwork();
  const first = await t.workspaceWatchdogTick();
  assert.deepEqual(first.missing, []); assert.equal(first.live, 3);
  assert.equal((await dbRows("SELECT count(*)::int AS n FROM workspace_registry"))[0].n, 3);
  assert.equal(calls.telegram.length, 0);
  // the channel vanishes from the store without an admin removal (the 2026-10-02 incident)
  t.workspaceStore.workspaces = t.workspaceStore.workspaces.filter((w) => w.id !== "chtotamcrypto");
  const second = await t.workspaceWatchdogTick();
  assert.deepEqual(second.missing, ["chtotamcrypto"]);
  assert.equal(calls.telegram.length, 1);
  assert.match(calls.telegram[0].body.text, /Что там у крипты\?/);
  const third = await t.workspaceWatchdogTick();
  assert.deepEqual(third.missing, ["chtotamcrypto"]);
  assert.equal(calls.telegram.length, 1, "throttled: same set is announced once");
  // deliberate removal (what /api/workspaces/remove does) silences it
  await dbRows("UPDATE workspace_registry SET removed_at=NOW() WHERE id='chtotamcrypto' RETURNING 1");
  const fourth = await t.workspaceWatchdogTick();
  assert.deepEqual(fourth.missing, []);
  // coming back clears the removed flag
  assert.equal((await dbRows("SELECT count(*)::int AS n FROM workspace_registry WHERE removed_at IS NULL"))[0].n, 2);
});

test("P9 watchdog without a database is a no-op", async () => {
  const t = await loadServer({ fixedNow: "2026-10-02T20:00:00Z", channels: three, env: Object.assign({}, S3ENV, { WORKSPACE_RECOVERY_ENABLED: "false" }) });
  assert.equal((await t.workspaceWatchdogTick()).skipped, "db_not_ready");
  assert.equal(fs.existsSync(t.dir + "/offsite-backup-status.json"), false);
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
      const needsDb = /^P[678]/.test(name);
      if (needsDb && !pgInst) { console.log("skip - " + name + " (no PostgreSQL available)"); continue; }
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name.split(" ")[0]], { env: Object.assign({}, process.env, { TZ: "UTC" }, pgInst ? { TEST_DATABASE_URL: pgInst.url } : {}), encoding: "utf8", timeout: 180000 });
      if (r.status === 0) console.log("ok - " + name);
      else { failed += 1; console.log("FAIL - " + name + "\n" + String(r.stderr || r.stdout).split("\n").slice(0, 16).join("\n")); }
    }
  } finally { if (pgInst) pgInst.stop(); }
  console.log(failed ? failed + " failed" : "data-protection tests passed");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
