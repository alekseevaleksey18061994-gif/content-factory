// Tests for lib/db-migrations.js (checksums, drift detection, additive lint) and the repo's migration files.
//   npm run test:db-migrations
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checksumOf, lintMigration, planMigrations, runMigrations, migrationStatus } from "../lib/db-migrations.js";

const LEGACY_NOT_LINTED = new Set(["20261001_004_workspaces.sql"]); // applied in production long ago; editing it would be drift

// Minimal in-memory stand-in for pg: only the statements the runner issues.
function fakeDb(initialRows, failOn) {
  const rows = new Map((initialRows || []).map((r) => [r.version, Object.assign({ checksum: null }, r)]));
  const executed = [];
  const handle = (sql, p) => {
    const q = String(sql).trim();
    if (/^SELECT version, checksum/i.test(q)) return { rows: [...rows.values()] };
    if (/^UPDATE schema_migrations SET checksum/i.test(q)) { const r = rows.get(p[0]); if (r && !r.checksum) r.checksum = p[1]; return { rows: [] }; }
    if (/^INSERT INTO schema_migrations/i.test(q)) { rows.set(p[0], { version: p[0], checksum: p[1] }); return { rows: [] }; }
    if (/^(CREATE TABLE IF NOT EXISTS schema_migrations|ALTER TABLE schema_migrations|BEGIN|COMMIT|ROLLBACK)/i.test(q)) return { rows: [] };
    if (failOn && q.includes(failOn)) throw new Error("boom");
    executed.push(q); return { rows: [] };
  };
  return { rows, executed, query: async (s, p) => handle(s, p), connect: async () => ({ query: async (s, p) => handle(s, p), release() {} }) };
}
const silent = { log() {}, error() { silent.errors.push([...arguments].join(" ")); }, errors: [] };
const tmpDir = (files) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "mig-")); for (const [n, s] of Object.entries(files)) fs.writeFileSync(path.join(d, n), s); return d; };

const cases = {
  "M1 checksum ignores CRLF and differs on content"() {
    assert.equal(checksumOf("a\r\nb"), checksumOf("a\nb"));
    assert.notEqual(checksumOf("a"), checksumOf("b"));
  },
  "M2 lint flags destructive and non-idempotent SQL, ignores comments"() {
    assert.deepEqual(lintMigration("-- DROP TABLE x\nCREATE TABLE IF NOT EXISTS t(id int);"), []);
    assert.ok(lintMigration("DROP TABLE t;").length);
    assert.ok(lintMigration("TRUNCATE t;").length);
    assert.ok(lintMigration("DELETE FROM t;").length);
    assert.ok(lintMigration("CREATE TABLE t(id int);").length);
    assert.ok(lintMigration("CREATE UNIQUE INDEX i ON t(id);").length);
    assert.ok(lintMigration("ALTER TABLE t ADD COLUMN c int;").length);
    assert.ok(lintMigration("ALTER TABLE t RENAME TO u;").length);
    assert.deepEqual(lintMigration("ALTER TABLE t ADD COLUMN IF NOT EXISTS c int;CREATE INDEX IF NOT EXISTS i ON t(c);"), []);
  },
  "M2b lint has no false positives on spacing, newlines, CRLF, string literals, DROP INDEX/CONSTRAINT IF EXISTS"() {
    for (const ok of [
      "CREATE TABLE  IF NOT EXISTS t(id int);",
      "ALTER TABLE t ADD COLUMN\n  IF NOT EXISTS c int;",
      "CREATE INDEX\r\n IF NOT EXISTS i ON t(c);",
      "CREATE UNIQUE INDEX IF   NOT EXISTS i ON t(c);",
      "DROP INDEX IF EXISTS old_idx;",
      "ALTER TABLE t DROP CONSTRAINT IF EXISTS c;",
      "COMMENT ON TABLE t IS 'we never DELETE FROM it, DROP TABLE x';"
    ]) assert.deepEqual(lintMigration(ok), [], ok);
    assert.ok(lintMigration("DROP TABLE IF EXISTS t;").length, "DROP TABLE stays flagged");
    assert.ok(lintMigration("ALTER TABLE t DROP COLUMN c;").length, "DROP COLUMN stays flagged");
  },
  "M3 plan: pending, drift, backfill of old rows, missing files"() {
    const files = [{ name: "001_a.sql", sql: "A" }, { name: "002_b.sql", sql: "B" }, { name: "003_c.sql", sql: "C" }];
    const p = planMigrations(files, [{ version: "001_a", checksum: checksumOf("A") }, { version: "002_b", checksum: checksumOf("OTHER") }, { version: "000_gone", checksum: null }]);
    assert.deepEqual(p.pending.map((f) => f.name), ["003_c.sql"]);
    assert.deepEqual(p.drift, ["002_b"]);
    assert.deepEqual(p.missingFiles, ["000_gone"]);
    const old = planMigrations(files.slice(0, 1), [{ version: "001_a", checksum: null }]);
    assert.deepEqual(old.backfill, [{ version: "001_a", checksum: checksumOf("A") }]);
    assert.deepEqual(old.drift, []);
  },
  async "M4 runner applies pending once, in order, stores checksum; second run is a no-op"() {
    const dir = tmpDir({ "002_b.sql": "SELECT 2;", "001_a.sql": "SELECT 1;" });
    const db = fakeDb();
    const s1 = await runMigrations(db, { dir, log: silent });
    assert.deepEqual(db.executed, ["SELECT 1;", "SELECT 2;"]);
    assert.deepEqual(s1.newlyApplied, ["001_a", "002_b"]);
    assert.equal(db.rows.get("001_a").checksum, checksumOf("SELECT 1;"));
    const s2 = await runMigrations(db, { dir, log: silent });
    assert.equal(db.executed.length, 2);
    assert.deepEqual(s2.newlyApplied, []);
    assert.deepEqual(migrationStatus().drift, []);
  },
  async "M5 an edited applied file is reported, not re-run; old rows get a checksum"() {
    const dir = tmpDir({ "001_a.sql": "SELECT 1;", "002_b.sql": "SELECT 2;" });
    const db = fakeDb([{ version: "001_a", checksum: checksumOf("SELECT 1;") }, { version: "002_b", checksum: null }]);
    fs.writeFileSync(path.join(dir, "001_a.sql"), "SELECT 'edited';");
    silent.errors.length = 0;
    const s = await runMigrations(db, { dir, log: silent });
    assert.deepEqual(db.executed, []);
    assert.deepEqual(s.drift, ["001_a"]);
    assert.equal(db.rows.get("002_b").checksum, checksumOf("SELECT 2;"));
    assert.ok(silent.errors.some((e) => e.includes("DB_MIGRATION_DRIFT") && e.includes("001_a")));
  },
  async "M6 a failing migration rolls back, is not recorded, and stops startup"() {
    const dir = tmpDir({ "001_a.sql": "SELECT broken;" });
    const db = fakeDb([], "broken");
    await assert.rejects(() => runMigrations(db, { dir, log: silent }), /boom/);
    assert.equal(db.rows.size, 0);
  },
  async "M7 missing directory does not crash"() {
    const s = await runMigrations(fakeDb(), { dir: path.join(os.tmpdir(), "no-such-mig-dir"), log: silent });
    assert.ok(s.error);
  },
  "M8 repo migrations: unique ordered names, additive and idempotent (legacy 004 excepted)"() {
    const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "migrations");
    const names = fs.readdirSync(dir).filter((n) => n.endsWith(".sql")).sort();
    assert.ok(names.length >= 8);
    const nums = names.map((n) => { const m = n.match(/^(\d{8})_(\d{3})_[a-z0-9_]+\.sql$/); assert.ok(m, "bad name " + n); return m[2]; });
    assert.equal(new Set(nums).size, nums.length, "duplicate migration numbers");
    nums.forEach((n, i) => assert.equal(Number(n), i + 1, "gap or disorder at " + names[i]));
    for (const n of names) {
      if (LEGACY_NOT_LINTED.has(n)) continue;
      assert.deepEqual(lintMigration(fs.readFileSync(path.join(dir, n), "utf8")), [], n);
    }
  }
};

let failed = 0;
for (const [name, fn] of Object.entries(cases)) {
  try { await fn(); console.log("ok - " + name); } catch (e) { failed++; console.log("FAIL - " + name + "\n" + (e && e.stack || e)); }
}
console.log(failed ? failed + " failed" : "db-migrations tests passed");
process.exit(failed ? 1 : 0);
