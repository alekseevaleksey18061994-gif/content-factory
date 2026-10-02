// Authentication helpers: constant-time comparison, per-IP failure limiter with exponential
// lockout, proxy-aware client IP, optional salted scrypt password hashes, session epoch.
import crypto from "node:crypto";
import fs from "node:fs";

// Constant-time string comparison: both sides are hashed to a fixed length first, so neither the
// content nor the length of the secret leaks through timing.
export function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a == null ? "" : a)).digest();
  const hb = crypto.createHash("sha256").update(String(b == null ? "" : b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Client IP behind a reverse proxy (Railway). X-Forwarded-For is appended to by every proxy, so the
// entry added by OUR trusted proxy is the n-th from the right; anything to its left is client-controlled
// and must not be used (spoofing it would give an attacker a fresh rate-limit bucket on every request).
export function clientIp(req, trustedHops) {
  const hops = Math.max(0, Number(trustedHops == null ? 1 : trustedHops));
  const socketIp = String(req.socket && req.socket.remoteAddress || "unknown").replace(/^::ffff:/, "");
  if (!hops) return socketIp;
  const xff = String(req.headers && req.headers["x-forwarded-for"] || "").split(",").map(function(x) { return x.trim(); }).filter(Boolean);
  if (!xff.length) return socketIp;
  const picked = xff[Math.max(0, xff.length - hops)];
  return String(picked || socketIp).replace(/^::ffff:/, "").slice(0, 64);
}

// Failure limiter: after `maxFailures` failures inside `windowMs` the key is locked for
// baseLockMs * 2^(extra failures), capped at maxLockMs. Successful auth clears the key.
export function createFailureLimiter(config) {
  const c = Object.assign({ maxFailures: 8, windowMs: 15 * 60 * 1000, baseLockMs: 30 * 1000, maxLockMs: 15 * 60 * 1000, maxKeys: 5000, now: function() { return Date.now(); } }, config || {});
  const entries = new Map();
  function prune(now) {
    if (entries.size < c.maxKeys) return;
    for (const [key, e] of entries) if (now - e.last > c.windowMs && now >= e.lockUntil) entries.delete(key);
    while (entries.size >= c.maxKeys) entries.delete(entries.keys().next().value); // oldest first
  }
  return {
    check: function(key) {
      const now = c.now();
      const e = entries.get(key);
      if (e && now < e.lockUntil) return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((e.lockUntil - now) / 1000)) };
      return { allowed: true, retryAfterSec: 0 };
    },
    fail: function(key) {
      const now = c.now();
      prune(now);
      let e = entries.get(key);
      if (!e || (now - e.last > c.windowMs && now >= e.lockUntil)) e = { count: 0, last: now, lockUntil: 0 };
      e.count += 1;
      e.last = now;
      if (e.count >= c.maxFailures) e.lockUntil = now + Math.min(c.maxLockMs, c.baseLockMs * Math.pow(2, e.count - c.maxFailures));
      entries.delete(key);
      entries.set(key, e);
      return { locked: now < e.lockUntil, failures: e.count };
    },
    success: function(key) { entries.delete(key); },
    size: function() { return entries.size; }
  };
}

// Optional salted password hash: "scrypt$<saltHex>$<hashHex>" (N=16384, r=8, p=1, 64 bytes).
export function hashPasswordScrypt(password, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, "hex") : crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return "scrypt$" + salt.toString("hex") + "$" + hash.toString("hex");
}

export function verifyPasswordScrypt(password, stored) {
  const m = String(stored || "").trim().match(/^scrypt\$([a-f0-9]{16,128})\$([a-f0-9]{128})$/i);
  if (!m) return false;
  try {
    const hash = crypto.scryptSync(String(password), Buffer.from(m[1], "hex"), 64, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(hash, Buffer.from(m[2], "hex"));
  } catch { return false; }
}

// Session epoch: bumping it invalidates every issued cookie. Epoch 0 (the default, nothing stored)
// keeps the legacy token, so existing sessions survive a deploy.
export function createSessionEpochStore(file) {
  let epoch = 0;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (raw && Number.isInteger(raw.epoch) && raw.epoch > 0) epoch = raw.epoch;
  } catch {}
  return {
    get: function() { return epoch; },
    bump: function() {
      epoch += 1;
      try { fs.writeFileSync(file, JSON.stringify({ epoch: epoch, updatedAt: new Date().toISOString() }), "utf8"); } catch (error) { console.warn("session epoch not persisted:", error.message); }
      return epoch;
    }
  };
}

export function sessionTokenFor(adminKey, epoch) {
  const label = epoch > 0 ? "news-factory-admin:epoch:" + epoch : "news-factory-admin";
  return crypto.createHmac("sha256", adminKey).update(label).digest("hex");
}
