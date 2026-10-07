// SQL migration runner (moved out of server.js, v0.64.0): applies migrations/*.sql once each, in order,
// each in its own transaction; records a checksum so an edited, already-applied file is reported (never re-run).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function checksumOf(sql) {
  return crypto.createHash("sha256").update(String(sql).replace(/\r\n/g, "\n")).digest("hex");
}

// Migrations must be additive and re-runnable (CLAUDE.md). Returns a list of problems; empty = fine.
export function lintMigration(sql) {
  // strip comments and string literals (a COMMENT text must not trip the rules), then collapse whitespace
  const text = String(sql).replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/'(?:[^']|'')*'/g, "''").replace(/\s+/g, " ");
  const problems = [];
  const rules = [
    [/\bDROP (TABLE|COLUMN|SCHEMA|DATABASE)\b/i, "destructive: DROP"],
    [/\bTRUNCATE\b/i, "destructive: TRUNCATE"],
    [/\bDELETE\s+FROM\b/i, "destructive: DELETE FROM"],
    [/\bALTER\s+TABLE\b[^;]*\bRENAME\b/i, "not backward compatible: RENAME"],
    [/\bCREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i, "not idempotent: CREATE TABLE without IF NOT EXISTS"],
    [/\bCREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)(?!CONCURRENTLY\s+IF\s+NOT\s+EXISTS)/i, "not idempotent: CREATE INDEX without IF NOT EXISTS"],
    [/\bADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)/i, "not idempotent: ADD COLUMN without IF NOT EXISTS"]
  ];
  for (const [re, msg] of rules) if (re.test(text)) problems.push(msg);
  return problems;
}

// Pure planning step: which files are pending, which applied ones changed on disk or vanished.
export function planMigrations(files, applied) {
  const byVersion = new Map(applied.map(function(r){ return [r.version, r]; }));
  const pending = [], drift = [], backfill = [];
  const seen = new Set();
  for (const f of files) {
    const version = f.name.replace(/\.sql$/i, "");
    seen.add(version);
    const row = byVersion.get(version);
    if (!row) { pending.push(f); continue; }
    const sum = checksumOf(f.sql);
    if (!row.checksum) backfill.push({ version, checksum: sum });
    else if (row.checksum !== sum) drift.push(version);
  }
  const missingFiles = applied.map(function(r){ return r.version; }).filter(function(v){ return !seen.has(v); });
  return { pending, drift, backfill, missingFiles };
}

let lastStatus = { ranAt: null, applied: 0, total: 0, pending: 0, drift: [], missingFiles: [], lint: [], error: "" };
export function migrationStatus() { return lastStatus; }

export async function runMigrations(db, opts) {
  if (!db) return lastStatus;
  const o = opts || {};
  const dir = o.dir || path.join(process.cwd(), "migrations");
  const log = o.log || console;
  await db.query("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await db.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT");

  let names = [];
  try {
    names = fs.readdirSync(dir).filter(function(n){ return /\.sql$/i.test(n); }).sort();
  } catch (error) {
    if (error && error.code === "ENOENT") {
      log.error("DB migrations directory not found, no migrations were applied: " + dir);
      lastStatus = Object.assign({}, lastStatus, { ranAt: new Date().toISOString(), error: "каталог migrations не найден" });
      return lastStatus;
    }
    throw error;
  }
  const files = names.map(function(n){ return { name: n, sql: fs.readFileSync(path.join(dir, n), "utf8") }; });
  const rows = (await db.query("SELECT version, checksum FROM schema_migrations")).rows;
  const plan = planMigrations(files, rows);

  for (const b of plan.backfill) await db.query("UPDATE schema_migrations SET checksum=$2 WHERE version=$1 AND checksum IS NULL", [b.version, b.checksum]);
  for (const v of plan.drift) log.error("DB_MIGRATION_DRIFT " + JSON.stringify({ version: v, note: "applied migration file was edited; it is NOT re-run, add a new migration instead" }));
  for (const v of plan.missingFiles) log.error("DB_MIGRATION_FILE_MISSING " + JSON.stringify({ version: v }));

  for (const f of plan.pending) {
    const version = f.name.replace(/\.sql$/i, "");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(f.sql);
      await client.query("INSERT INTO schema_migrations(version, checksum) VALUES($1,$2)", [version, checksumOf(f.sql)]);
      await client.query("COMMIT");
      log.log("DB migration applied:", version);
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }
  lastStatus = {
    ranAt: new Date().toISOString(), applied: files.length, total: files.length, pending: 0,
    newlyApplied: plan.pending.map(function(f){ return f.name.replace(/\.sql$/i, ""); }),
    drift: plan.drift, missingFiles: plan.missingFiles,
    lint: files.map(function(f){ return { v: f.name, p: lintMigration(f.sql) }; }).filter(function(x){ return x.p.length; }),
    error: ""
  };
  return lastStatus;
}
