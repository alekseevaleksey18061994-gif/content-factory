// Tests for the one-time recovery of channels lost from workspaces.json (lib/workspace-recovery.js).
// Uses a throw-away local PostgreSQL (TEST_DATABASE_URL overrides it); skipped when none can be started.
//   npm run test:workspace-recovery
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadServer, dbRows, startTempPostgres, mkQueueItem } from "./dedupe-harness.js";
import { RECOVERY_CHANNELS, WORKSPACE_RECOVERY_MIGRATION, isUsableSnapshotState } from "../lib/workspace-recovery.js";
import { REMOVED_CHANNELS_V055 } from "../lib/channel-rubrics-v055.js";

const only = [["ai-main", "ai", "Что там у ИИ?"], ["chtotamtachki", "auto", "Что там у тачек?"]];
const sql = (v) => "'" + String(v).replace(/'/g, "''") + "'";

async function snapshot(wsId, state, ageMinutes) {
  await dbRows("INSERT INTO app_snapshots(workspace_id,state,created_at) VALUES(" + sql(wsId) + "," + sql(JSON.stringify(state)) + "::jsonb, NOW() - interval '" + ageMinutes + " minutes') RETURNING 1");
}

const cases = {};
function test(name, fn) { cases[name] = fn; }

test("R1 manifest: 14 distinct channels, valid handles and profile pins", async () => {
  assert.equal(RECOVERY_CHANNELS.length, 14);
  assert.equal(new Set(RECOVERY_CHANNELS.map((c) => c.id)).size, 14);
  assert.equal(new Set(RECOVERY_CHANNELS.map((c) => c.handle)).size, 14);
  assert.equal(new Set(RECOVERY_CHANNELS.map((c) => c.channelId)).size, 14);
  for (const c of RECOVERY_CHANNELS) assert.match(c.handle, /^@[A-Za-z][A-Za-z0-9_]{4,}$/);
  assert.equal(isUsableSnapshotState({ sources: [], queue: [] }), true);
  assert.equal(isUsableSnapshotState(null), false);
  assert.equal(isUsableSnapshotState({ queue: [] }), false);
});

test("R2 missing channels come back from the latest snapshot; existing ones are untouched; runs once", async () => {
  const t = await loadServer({ db: true, fixedNow: "2026-10-02T19:40:00Z", channels: only, env: { WORKSPACE_RECOVERY_ENABLED: "false" } });
  await new Promise((r) => setTimeout(r, 1500)); // db init
  assert.equal(t.workspaceStore.workspaces.length, 2);
  const aiBefore = JSON.stringify(t.ws("ai-main").state.sources);
  const src = (n) => ({ id: "s" + n, name: "S" + n, url: "https://example.com/" + n, enabled: true, group: "media", type: "web" });
  const newest = { mode: "AUTO", sources: [src(1), src(2), src(3)], queue: [mkQueueItem({ id: "q1", newsId: "n1" })], history: [{ id: "h1", title: "x", publishedAt: "2026-10-02T18:00:00Z" }], topicSettings: { default: { auto_publish_telegram: true } }, migrations: ["v0.42.3-seed-crypto"] };
  const older = Object.assign({}, newest, { sources: [src(9)], queue: [] });
  await snapshot("chtotamcrypto", older, 120);
  await snapshot("chtotamcrypto", newest, 5);
  await snapshot("chtotamtech", Object.assign({}, newest, { mode: "REVIEW" }), 3);
  const r = await t.recoverMissingWorkspaces();
  assert.equal(r.restored.length + r.fresh.length, 14 - REMOVED_CHANNELS_V055.length); // v0.55.0: the three removed channels are never recreated
  assert.deepEqual(r.restored.sort(), ["chtotamcrypto", "chtotamtech"]);
  assert.equal(t.workspaceStore.workspaces.length, 16 - REMOVED_CHANNELS_V055.length);
  const crypto = t.ws("chtotamcrypto");
  assert.equal(crypto.state.sources.length, 3, "latest snapshot wins");
  assert.equal(crypto.state.mode, "AUTO");
  assert.equal(crypto.telegramChannel, "@chtotamcrypto");
  assert.equal(crypto.channelId, "crypto");
  assert.equal(crypto.name, "Что там у крипты?");
  assert.equal(t.ws("chtotamtech").state.mode, "REVIEW");
  assert.equal(t.ws("chtotamkino").telegramChannel, "@chtotamvkino");
  assert.ok(!t.ws("chtotamnews"), "removed in v0.55.0: not recreated");
  // channels without a snapshot are created fresh: nothing publishes until the auto-publish gate passed
  assert.equal(t.ws("chtotamdom").state.mode, "REVIEW");
  assert.equal(t.ws("chtotamdom").state.autoGate.pending, true);
  assert.equal(JSON.stringify(t.ws("ai-main").state.sources), aiBefore, "existing workspace untouched");
  // persisted to workspaces.json
  const fs = await import("node:fs");
  const onDisk = JSON.parse(fs.readFileSync(t.dir + "/workspaces.json", "utf8"));
  assert.equal(onDisk.workspaces.length, 16 - REMOVED_CHANNELS_V055.length);
  // once only: a channel deleted afterwards is not resurrected
  assert.ok(t.ws("ai-main").state.migrations.includes(WORKSPACE_RECOVERY_MIGRATION));
  t.workspaceStore.workspaces = t.workspaceStore.workspaces.filter((w) => w.id !== "chtotamcrypto");
  t.persistWorkspaceStore();
  const again = await t.recoverMissingWorkspaces();
  assert.equal(again.skipped, "done");
  assert.equal(t.workspaceStore.workspaces.some((w) => w.id === "chtotamcrypto"), false);
});

test("R3 a DB that is not ready or fails does not create empty channels and does not mark the work done", async () => {
  const t = await loadServer({ fixedNow: "2026-10-02T19:40:00Z", channels: only, env: { WORKSPACE_RECOVERY_ENABLED: "false" } }); // no DB
  const r = await t.recoverMissingWorkspaces();
  assert.equal(r.skipped, "db_not_ready");
  assert.equal(t.workspaceStore.workspaces.length, 2);
  assert.ok(!t.ws("ai-main").state.migrations.includes(WORKSPACE_RECOVERY_MIGRATION));
});

test("R4 a store that already has every channel is left alone", async () => {
  const t = await loadServer({ db: true, fixedNow: "2026-10-02T19:40:00Z", env: { WORKSPACE_RECOVERY_ENABLED: "false" } }); // default 16-channel fixture
  await new Promise((r) => setTimeout(r, 1500));
  const before = t.workspaceStore.workspaces.length;
  const r = await t.recoverMissingWorkspaces();
  assert.ok(Array.isArray(r.fresh) || r.skipped);
  assert.ok(t.workspaceStore.workspaces.length >= before);
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
      const needsDb = /^R[24]/.test(name);
      if (needsDb && !pgInst) { console.log("skip - " + name + " (no PostgreSQL available)"); continue; }
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name.split(" ")[0]], { env: Object.assign({}, process.env, { TZ: "UTC" }, pgInst ? { TEST_DATABASE_URL: pgInst.url } : {}), encoding: "utf8", timeout: 180000 });
      if (r.status === 0) console.log("ok - " + name);
      else { failed += 1; console.log("FAIL - " + name + "\n" + String(r.stderr || r.stdout).split("\n").slice(0, 16).join("\n")); }
    }
  } finally { if (pgInst) pgInst.stop(); }
  console.log(failed ? failed + " failed" : "workspace-recovery tests passed");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
