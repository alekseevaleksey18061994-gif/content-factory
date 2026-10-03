// Data-safety helpers: atomic JSON persistence with backup/recovery, per-key
// debounce, bounded retry, advisory locking, CBR rate parsing, FX fallback and
// de-duplicated budget alerts. Pure (no globals from server.js) so that they can
// be tested offline: see scripts/data-safety-test.js.
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Atomic file writes
// ---------------------------------------------------------------------------

function fsyncDirBestEffort(dir) {
  let fd = null;
  try {
    fd = fs.openSync(dir, "r");
    fs.fsyncSync(fd);
  } catch {
    // Some platforms/filesystems do not allow fsync on directories.
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch {} }
  }
}

// temp file in the same directory + fsync + rename: a crash or ENOSPC mid-write
// leaves the previous file untouched instead of a truncated one.
export function atomicWriteFileSync(file, data) {
  const dir = path.dirname(file);
  const tmp = file + "." + process.pid + "." + Date.now() + "." + Math.random().toString(36).slice(2, 8) + ".tmp";
  let fd = null;
  try {
    fd = fs.openSync(tmp, "w");
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
    let offset = 0;
    while (offset < buffer.length) offset += fs.writeSync(fd, buffer, offset, buffer.length - offset);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, file);
  } catch (error) {
    if (fd !== null) { try { fs.closeSync(fd); } catch {} }
    try { fs.unlinkSync(tmp); } catch {}
    throw error;
  }
  fsyncDirBestEffort(dir);
}

function readAndValidate(file, validate) {
  const raw = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(raw);
  if (validate && !validate(parsed)) throw new Error("validation failed: unexpected structure");
  return { raw, parsed };
}

export class StoreCorruptError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "StoreCorruptError";
    this.details = details || {};
  }
}

// Load a JSON store with recovery. Never overwrites a damaged file with fresh data.
//  - main file is fine                      -> { status: "ok", data }
//  - main damaged, .bak fine                -> main is renamed to <file>.corrupt-<ts>,
//                                              restored from .bak: { status: "restored", data, corruptFile }
//  - main missing, .bak fine                -> restored from .bak
//  - main missing, no .bak (first start)    -> { status: "missing" } (caller bootstraps)
//  - main damaged, .bak unusable            -> throws StoreCorruptError (file kept as corrupt copy)
export function loadJsonStoreWithRecovery(options) {
  const file = options.file;
  const bakFile = options.bakFile || file + ".bak";
  const validate = options.validate;
  const log = options.log || console;
  const stamp = String(options.now || new Date().toISOString()).replace(/[:.]/g, "-");

  let mainExists = true;
  let mainError = null;
  try {
    const ok = readAndValidate(file, validate);
    return { status: "ok", data: ok.parsed };
  } catch (error) {
    if (error && error.code === "ENOENT") mainExists = false;
    else if (error && error.code && !(error instanceof SyntaxError)) {
      // EACCES/EIO/...: do not touch the file, do not guess.
      throw new StoreCorruptError("cannot read " + file + ": " + error.code + " " + error.message, { file });
    } else mainError = error;
  }

  let corruptFile = "";
  if (mainExists) {
    corruptFile = file + ".corrupt-" + stamp;
    try {
      fs.renameSync(file, corruptFile);
    } catch (renameError) {
      try { fs.copyFileSync(file, corruptFile); } catch (copyError) {
        throw new StoreCorruptError("cannot preserve damaged " + file + " (" + copyError.message + "); refusing to continue", { file });
      }
    }
    log.error("[data-safety] " + path.basename(file) + " is unreadable (" + String(mainError && mainError.message || mainError) + "); damaged copy kept as " + path.basename(corruptFile));
  }

  let backup = null;
  try { backup = readAndValidate(bakFile, validate); } catch (error) {
    if (!(error && error.code === "ENOENT")) {
      log.error("[data-safety] backup " + path.basename(bakFile) + " is not usable: " + String(error && error.message || error));
    }
  }
  if (backup) {
    atomicWriteFileSync(file, backup.raw);
    log.error("[data-safety] " + path.basename(file) + " restored from " + path.basename(bakFile) + (mainExists ? " (changes since the last backup are lost; the damaged file is kept for manual recovery)" : " (main file was missing)"));
    return { status: "restored", data: backup.parsed, corruptFile };
  }
  if (!mainExists) return { status: "missing" };
  const message = path.basename(file) + " is corrupt and no usable backup exists. The damaged file was kept as " + corruptFile + ". Refusing to start with an empty store: restore the file manually (or from a volume snapshot) and restart.";
  log.error("[data-safety] FATAL: " + message);
  throw new StoreCorruptError(message, { file, corruptFile });
}

// Writer with last-good .bak rotation. The previous file is only copied to .bak
// after it has been parsed and validated, so .bak is always a usable copy.
export function createAtomicStoreWriter(options) {
  const file = options.file;
  const bakFile = options.bakFile || file + ".bak";
  const validate = options.validate;
  const intervalMs = Number.isFinite(options.backupIntervalMs) ? options.backupIntervalMs : 60000;
  const log = options.log || console;
  const nowFn = options.nowMs || Date.now;
  let lastBackupAt = 0;
  let lastWritten = null; // content of our own last successful write: already valid, no need to re-read and re-parse
  return {
    backupNow() {
      let previous = null;
      try { previous = readAndValidate(file, validate); } catch { return false; }
      try {
        atomicWriteFileSync(bakFile, previous.raw);
        lastBackupAt = nowFn();
        return true;
      } catch (error) {
        log.warn("[data-safety] cannot rotate " + path.basename(bakFile) + ": " + error.message);
        return false;
      }
    },
    write(content) {
      if (nowFn() - lastBackupAt >= intervalMs) {
        if (lastWritten != null) {
          try { atomicWriteFileSync(bakFile, lastWritten); lastBackupAt = nowFn(); }
          catch (error) { log.warn("[data-safety] cannot rotate " + path.basename(bakFile) + ": " + error.message); }
        } else {
          this.backupNow();
        }
      }
      atomicWriteFileSync(file, content);
      lastWritten = content;
    }
  };
}

// ---------------------------------------------------------------------------
// Per-key debounce (one timer per workspace instead of one global timer)
// ---------------------------------------------------------------------------

export function createKeyedDebouncer(delayMs, run, hooks) {
  const h = hooks || {};
  const setTimer = h.setTimer || setTimeout;
  const clearTimer = h.clearTimer || clearTimeout;
  const timers = new Map();
  return {
    schedule(key) {
      const k = String(key);
      const previous = timers.get(k);
      if (previous) clearTimer(previous);
      const timer = setTimer(function () {
        timers.delete(k);
        try {
          const result = run(k);
          if (result && typeof result.catch === "function") result.catch(function (error) { console.error("Debounced task failed for " + k + ":", error && error.message || error); });
        } catch (error) {
          console.error("Debounced task failed for " + k + ":", error && error.message || error);
        }
      }, delayMs);
      timers.set(k, timer);
    },
    pending() { return Array.from(timers.keys()); }
  };
}

// ---------------------------------------------------------------------------
// Bounded retry with exponential backoff, advisory lock
// ---------------------------------------------------------------------------

export async function retryWithBackoff(fn, options) {
  const o = options || {};
  const attempts = Math.max(1, Math.floor(Number(o.attempts) || 1));
  const baseMs = Math.max(0, Number(o.baseMs) || 0);
  const maxMs = Math.max(baseMs, Number(o.maxMs) || baseMs);
  const sleep = o.sleep || function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      const delay = Math.min(maxMs, baseMs * Math.pow(2, attempt - 1));
      if (o.onRetry) o.onRetry(error, attempt, delay);
      await sleep(delay);
    }
  }
  throw lastError;
}

// Session-level advisory lock on a dedicated connection. Released in finally
// (or implicitly by PostgreSQL if the connection dies).
export async function withAdvisoryLock(db, key, fn) {
  const client = await db.connect();
  let locked = false;
  let broken = false;
  try {
    await client.query("SELECT pg_advisory_lock($1)", [key]);
    locked = true;
    return await fn();
  } finally {
    if (locked) {
      try { await client.query("SELECT pg_advisory_unlock($1)", [key]); } catch { broken = true; }
    }
    // A client whose unlock failed is destroyed so the lock cannot leak into the pool.
    try { client.release(broken ? true : undefined); } catch {}
  }
}

// ---------------------------------------------------------------------------
// CBR USD/RUB
// ---------------------------------------------------------------------------

function parseCbrNumber(text) {
  return Number(String(text == null ? "" : text).trim().replace(/\s+/g, "").replace(",", "."));
}

// Finds the <Valute> block whose CharCode is exactly USD (not the first block in
// the document) and returns Value / Nominal.
export function parseCbrUsdRate(xml) {
  const text = String(xml || "");
  const blockRe = /<Valute\b[^>]*>([\s\S]*?)<\/Valute>/gi;
  let match;
  while ((match = blockRe.exec(text)) !== null) {
    const body = match[1];
    const code = body.match(/<CharCode>\s*([^<]*?)\s*<\/CharCode>/i);
    if (!code || code[1].toUpperCase() !== "USD") continue;
    const nominalMatch = body.match(/<Nominal>([^<]*)<\/Nominal>/i);
    const valueMatch = body.match(/<Value>([^<]*)<\/Value>/i);
    const nominal = nominalMatch ? parseCbrNumber(nominalMatch[1]) : 1;
    const value = valueMatch ? parseCbrNumber(valueMatch[1]) : NaN;
    if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(nominal) || nominal <= 0) throw new Error("bad CBR USD rate");
    return value / nominal;
  }
  throw new Error("USD not found in CBR response");
}

export const DEFAULT_USD_RUB_RATE = 90;

// Rate to use when CBR is unreachable: last good CBR value (even if stale),
// then the configured constant (COST_USD_RUB_RATE), then a built-in constant.
// Never 0, so budgets/economy mode do not silently switch off.
export function resolveUsdRubFallback(input) {
  const i = input || {};
  const last = Number(i.lastGood && i.lastGood.value);
  if (Number.isFinite(last) && last > 0) return { rate: last, source: "last_known", at: i.lastGood.at || 0 };
  const configured = Number(i.configured);
  if (Number.isFinite(configured) && configured > 0) return { rate: configured, source: "configured", at: 0 };
  const dflt = Number(i.defaultRate);
  return { rate: Number.isFinite(dflt) && dflt > 0 ? dflt : DEFAULT_USD_RUB_RATE, source: "default", at: 0 };
}

// ---------------------------------------------------------------------------
// Budget alerts: claim the dedupe key BEFORE the await
// ---------------------------------------------------------------------------

// alerts: persisted map ({last80Day, last100Day, ...}). Concurrent callers see the
// claimed key synchronously and skip. If sending throws (Telegram 403/timeouts)
// the claim is rolled back but a cool-down stops retries every few seconds.
export async function dispatchBudgetAlerts(options) {
  const alerts = options.alerts;
  const day = options.day;
  const nowMs = options.nowMs != null ? options.nowMs : Date.now();
  const retryMs = options.retryMs != null ? options.retryMs : 30 * 60 * 1000;
  let dirty = false;
  for (const threshold of options.thresholds) {
    if (!options.reached(threshold)) continue;
    const key = "last" + threshold + "Day";
    const retryKey = "retry" + threshold + "At";
    if (alerts[key] === day) continue;
    if (Number(alerts[retryKey] || 0) > nowMs) continue;
    const previous = alerts[key];
    alerts[key] = day; // claim before any await
    let sent = false;
    try {
      sent = await options.send(threshold);
    } catch (error) {
      if (previous === undefined) delete alerts[key]; else alerts[key] = previous;
      alerts[retryKey] = nowMs + retryMs;
      dirty = true;
      if (options.onError) options.onError(error, threshold);
      continue;
    }
    if (sent) {
      delete alerts[retryKey];
      dirty = true;
    } else {
      // nothing to send (no chat configured, nothing above threshold): release the claim
      if (previous === undefined) delete alerts[key]; else alerts[key] = previous;
    }
  }
  return dirty;
}
