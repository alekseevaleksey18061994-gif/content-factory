// Offline regression tests for the security audit fixes (no network, no database).
// Run: npm run test:security
import assert from "node:assert/strict";
import http from "node:http";
import zlib from "node:zlib";
import sharp from "sharp";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isBlockedIp, isBlockedHostname, validateUrl, createSafeFetch, safeFetch, SafeFetchError } from "../lib/safe-fetch.js";
import { assertSafeRaster, sniffRasterFormat } from "../lib/image-guard.js";
import { safeEqual, clientIp, createFailureLimiter, hashPasswordScrypt, verifyPasswordScrypt, sessionTokenFor, createSessionEpochStore } from "../lib/auth-guard.js";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
const pending = [];
function test(name, fn) { pending.push({ name, fn }); }
async function rejectsWith(promise, code, label) {
  try { await promise; } catch (e) { assert.equal(e && e.code, code, (label || "") + " expected " + code + ", got " + (e && (e.code || e.message))); return; }
  assert.fail((label || "") + " expected rejection " + code);
}

// ---------------------------------------------------------------- F-1: address classification
test("F-1 blocks private / loopback / link-local / metadata / CGNAT IPv4", () => {
  for (const ip of ["127.0.0.1", "127.1.2.3", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "100.127.255.255", "0.0.0.0", "192.0.0.1", "198.18.0.1", "224.0.0.1", "255.255.255.255"]) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "100.128.0.1", "169.255.0.1", "11.0.0.1"]) {
    assert.equal(isBlockedIp(ip), false, ip);
  }
});

test("F-1 blocks IPv6 loopback / ULA / link-local / mapped / embedded forms", () => {
  for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "::ffff:10.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::1", "2002:a9fe:a9fe::", "::127.0.0.1", "2001:db8::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "[::1]"]) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
  for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8", "2002:0808:0808::1"]) {
    assert.equal(isBlockedIp(ip), false, ip);
  }
  assert.equal(isBlockedIp("not-an-ip"), true);
  assert.equal(isBlockedIp(""), true);
});

test("F-1 URL validation: scheme, port, credentials, decimal/octal/hex/IPv6 literal forms", () => {
  const bad = [
    ["file:///etc/passwd", "bad_scheme"], ["ftp://example.com/x", "bad_scheme"], ["gopher://example.com/", "bad_scheme"], ["javascript:alert(1)", "bad_scheme"],
    ["http://127.0.0.1/", "blocked_address"], ["http://2130706433/", "blocked_address"], ["http://0x7f000001/", "blocked_address"],
    ["http://0177.0.0.1/", "blocked_address"], ["http://127.1/", "blocked_address"], ["http://0/", "blocked_address"],
    ["http://[::1]/", "blocked_address"], ["http://[::ffff:127.0.0.1]/", "blocked_address"], ["http://[fd00::1]/", "blocked_address"],
    ["http://169.254.169.254/latest/meta-data/", "blocked_address"], ["http://2852039166/", "blocked_address"],
    ["http://localhost/", "blocked_address"], ["http://LOCALHOST./", "blocked_address"], ["http://foo.localhost/", "blocked_address"],
    ["http://db.railway.internal/", "blocked_address"], ["http://metadata.google.internal/", "blocked_address"],
    ["http://example.com:22/", "bad_port"], ["https://example.com:6379/", "bad_port"], ["http://example.com:8080/", "bad_port"],
    ["http://user:pass@example.com/", "bad_url"], ["not a url", "bad_url"], ["", "bad_url"]
  ];
  for (const [url, code] of bad) {
    try { validateUrl(url); assert.fail("should reject " + url); } catch (e) { assert.equal(e.code, code, url + " -> " + (e.code || e.message)); }
  }
  assert.equal(validateUrl("https://example.com/a?b=1").hostname, "example.com");
  assert.equal(validateUrl("http://example.com:80/").port, "");
  assert.equal(validateUrl("https://example.com:443/").hostname, "example.com");
});

test("F-1 env override of allowed ports", () => {
  const prev = process.env.SAFE_FETCH_ALLOWED_PORTS;
  try {
    process.env.SAFE_FETCH_ALLOWED_PORTS = "80,443,8080";
    assert.equal(validateUrl("http://example.com:8080/").port, "8080");
    assert.throws(() => validateUrl("http://example.com:9090/"), /не разрешён/);
  } finally {
    if (prev === undefined) delete process.env.SAFE_FETCH_ALLOWED_PORTS; else process.env.SAFE_FETCH_ALLOWED_PORTS = prev;
  }
});

test("F-1 hostname blocklist helper", () => {
  assert.equal(isBlockedHostname("localhost"), true);
  assert.equal(isBlockedHostname("api.internal"), true);
  assert.equal(isBlockedHostname("printer.local"), true);
  assert.equal(isBlockedHostname("example.com"), false);
});

// ---------------------------------------------------------------- F-1: client behaviour against local mock servers
// The mock servers listen on 127.0.0.1, so the address filter is disabled for those tests only; the
// DNS-level and redirect-level checks are exercised through the injected resolver.
function listen(handler) {
  return new Promise(function(resolve) {
    const srv = http.createServer(handler);
    srv.listen(0, "127.0.0.1", function() { resolve({ srv, port: srv.address().port }); });
  });
}

test("F-1 safeFetch default filter refuses loopback targets without any request", async () => {
  let hits = 0;
  const { srv, port } = await listen(function(req, res) { hits++; res.end("secret"); });
  try {
    await rejectsWith(safeFetch("http://127.0.0.1:" + port + "/", { timeoutMs: 2000 }), "bad_port", "port");
    const withPort = createSafeFetch({ allowedPorts: [port] });
    await rejectsWith(withPort("http://127.0.0.1:" + port + "/", { timeoutMs: 2000 }), "blocked_address", "literal");
    await rejectsWith(withPort("http://localhost:" + port + "/", { timeoutMs: 2000 }), "blocked_address", "localhost");
    assert.equal(hits, 0);
  } finally { srv.close(); }
});

test("F-1 DNS answers pointing inside are refused, connection uses the validated address", async () => {
  let hits = 0;
  const { srv, port } = await listen(function(req, res) { hits++; res.end("ok-body"); });
  try {
    // resolver answers a private address for evil.test -> must be refused before connecting
    const evil = createSafeFetch({ allowedPorts: [port], resolver: async function() { return [{ address: "127.0.0.1", family: 4 }]; } });
    await rejectsWith(evil("http://evil.test:" + port + "/", { timeoutMs: 2000 }), "blocked_address", "dns private");
    // mixed answer (public + private) is refused as well
    const mixed = createSafeFetch({ allowedPorts: [port], resolver: async function() { return [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.5", family: 4 }]; } });
    await rejectsWith(mixed("http://mixed.test:" + port + "/", { timeoutMs: 2000 }), "blocked_address", "dns mixed");
    // IPv4-mapped IPv6 answer
    const mapped = createSafeFetch({ allowedPorts: [port], resolver: async function() { return [{ address: "::ffff:7f00:1", family: 6 }]; } });
    await rejectsWith(mapped("http://mapped.test:" + port + "/", { timeoutMs: 2000 }), "blocked_address", "dns mapped");
    assert.equal(hits, 0);
    // a "public" answer: the filter is relaxed only for the loopback address that stands in for it
    const fine = createSafeFetch({ allowedPorts: [port], ipFilter: function(ip) { return ip !== "127.0.0.1"; }, resolver: async function() { return [{ address: "127.0.0.1", family: 4 }]; } });
    const r = await fine("http://pinned.test:" + port + "/", { timeoutMs: 2000 });
    assert.equal(r.status, 200);
    assert.equal(await r.text(), "ok-body");
    assert.equal(hits, 1);
  } finally { srv.close(); }
});

test("F-1 rebinding: resolver flips between calls, every connection is validated at connect time", async () => {
  const { srv, port } = await listen(function(req, res) { res.end("x"); });
  try {
    let calls = 0;
    const flip = createSafeFetch({ allowedPorts: [port], ipFilter: function(ip) { return ip === "10.0.0.5"; }, resolver: async function() { calls++; return [{ address: calls === 1 ? "127.0.0.1" : "10.0.0.5", family: 4 }]; } });
    assert.equal((await flip("http://rebind.test:" + port + "/", { timeoutMs: 2000 })).status, 200);
    await rejectsWith(flip("http://rebind.test:" + port + "/", { timeoutMs: 2000 }), "blocked_address", "second answer");
  } finally { srv.close(); }
});

test("F-1 redirects: followed manually, each hop re-validated, max 3", async () => {
  let secretHits = 0;
  const secret = await listen(function(req, res) { secretHits++; res.end("SECRET"); });
  const front = await listen(function(req, res) {
    if (req.url === "/ok") { res.writeHead(200, { "content-type": "text/plain" }); return res.end("final"); }
    if (req.url === "/r1") { res.writeHead(302, { location: "/r2" }); return res.end(); }
    if (req.url === "/r2") { res.writeHead(301, { location: "/r3" }); return res.end(); }
    if (req.url === "/r3") { res.writeHead(307, { location: "/ok" }); return res.end(); }
    if (req.url === "/r4") { res.writeHead(302, { location: "/r1" }); return res.end(); }
    if (req.url === "/loop") { res.writeHead(302, { location: "/loop" }); return res.end(); }
    if (req.url === "/to-meta") { res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }); return res.end(); }
    if (req.url === "/to-decimal") { res.writeHead(302, { location: "http://2130706433:" + secret.port + "/" }); return res.end(); }
    if (req.url === "/to-file") { res.writeHead(302, { location: "file:///etc/passwd" }); return res.end(); }
    if (req.url === "/to-secret") { res.writeHead(302, { location: "http://secret.test:" + secret.port + "/" }); return res.end(); }
    res.writeHead(404); res.end();
  });
  try {
    const allowed = [front.port, secret.port, 80];
    const resolver = async function(host) { return [{ address: host === "secret.test" ? "10.9.9.9" : "127.0.0.1", family: 4 }]; };
    // front host looks public (127.0.0.1 allowed); "secret" resolves to 10.9.9.9 which is blocked; the dial would be refused first.
    const sf = createSafeFetch({ allowedPorts: allowed, ipFilter: function(ip) { return ip !== "127.0.0.1"; }, resolver, skipHostnameBlocklist: true });
    const base = "http://front.test:" + front.port;
    assert.equal(await (await sf(base + "/r1", { timeoutMs: 3000 })).text(), "final"); // 3 redirects: allowed
    await rejectsWith(sf(base + "/r4", { timeoutMs: 3000 }), "too_many_redirects", "4 hops");
    await rejectsWith(sf(base + "/loop", { timeoutMs: 3000 }), "too_many_redirects", "loop");
    await rejectsWith(sf(base + "/to-meta", { timeoutMs: 3000 }), "blocked_address", "metadata hop");
    await rejectsWith(sf(base + "/to-file", { timeoutMs: 3000 }), "bad_scheme", "file hop");
    await rejectsWith(sf(base + "/to-secret", { timeoutMs: 3000 }), "blocked_address", "internal dns hop");
    assert.equal(secretHits, 0);
  } finally { secret.srv.close(); front.srv.close(); }
});

test("F-1 response size cap is enforced while streaming (declared, undeclared, compressed)", async () => {
  const big = Buffer.alloc(2 * 1024 * 1024, 97);
  const gz = zlib.gzipSync(Buffer.alloc(8 * 1024 * 1024, 98)); // 8 MB of 'b' compresses to a few KB: zip bomb shape
  let streamed = 0;
  const { srv, port } = await listen(function(req, res) {
    if (req.url === "/declared") { res.writeHead(200, { "content-length": big.length }); return res.end(big); }
    if (req.url === "/chunked") {
      res.writeHead(200);
      const iv = setInterval(function() { streamed += 65536; if (!res.write(Buffer.alloc(65536, 99)) ) {} if (res.destroyed || streamed > 50 * 1024 * 1024) { clearInterval(iv); res.end(); } }, 1);
      res.on("close", function() { clearInterval(iv); });
      return;
    }
    if (req.url === "/bomb") { res.writeHead(200, { "content-encoding": "gzip" }); return res.end(gz); }
    if (req.url === "/small") { res.writeHead(200, { "content-type": "text/html" }); return res.end("<html>ok</html>"); }
    if (req.url === "/small-gz") { res.writeHead(200, { "content-encoding": "gzip", "content-type": "text/html" }); return res.end(zlib.gzipSync("<html>gz ok</html>")); }
    if (req.url === "/hang") { res.writeHead(200); res.write("start"); return; }
    res.writeHead(404); res.end();
  });
  try {
    const sf = createSafeFetch({ allowedPorts: [port], ipFilter: function() { return false; } });
    const b = "http://127.0.0.1:" + port;
    await rejectsWith(sf(b + "/declared", { maxBytes: 1024 * 1024 }), "too_large", "declared");
    await rejectsWith(sf(b + "/chunked", { maxBytes: 1024 * 1024 }), "too_large", "chunked");
    assert.ok(streamed < 20 * 1024 * 1024, "server must be cut off long before 50MB, streamed " + streamed);
    await rejectsWith(sf(b + "/bomb", { maxBytes: 1024 * 1024 }), "too_large", "gzip bomb");
    assert.equal(await (await sf(b + "/small", { maxBytes: 1024 })).text(), "<html>ok</html>");
    assert.equal(await (await sf(b + "/small-gz", { maxBytes: 1024 })).text(), "<html>gz ok</html>");
    const t0 = Date.now();
    await rejectsWith(sf(b + "/hang", { timeoutMs: 300 }), "timeout", "stalled body");
    assert.ok(Date.now() - t0 < 2000);
    const r404 = await sf(b + "/nothing");
    assert.equal(r404.ok, false);
    assert.equal(r404.status, 404);
  } finally { srv.close(); }
});

// ---------------------------------------------------------------- F-2: image guard
test("F-2 only raster formats pass; SVG and garbage are refused before sharp decodes them", async () => {
  const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#f00" } }).png().toBuffer();
  const jpg = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#0f0" } }).jpeg().toBuffer();
  const webp = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#00f" } }).webp().toBuffer();
  const gif = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#ff0" } }).gif().toBuffer();
  for (const [name, buf] of [["png", png], ["jpeg", jpg], ["webp", webp], ["gif", gif]]) {
    assert.equal(sniffRasterFormat(buf), name);
    assert.equal((await assertSafeRaster(buf)).width, 20, name);
  }
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="100"><text x="5" y="50" font-size="30">' + "a".repeat(5000) + "</text></svg>");
  await assert.rejects(assertSafeRaster(svg), /растров/);
  await assert.rejects(assertSafeRaster(Buffer.from('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><text>&x;</text></svg>')), /растров/);
  await assert.rejects(assertSafeRaster(Buffer.from("<html>not an image at all</html>")), /растров/);
  await assert.rejects(assertSafeRaster(Buffer.alloc(0)), /растров/);
  // truncated PNG header: right magic, undecodable body
  await assert.rejects(assertSafeRaster(png.subarray(0, 20)));
});

test("F-2 pixel limit is enforced", async () => {
  const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#123456" } }).png().toBuffer();
  await assert.rejects(assertSafeRaster(png, { maxPixels: 100000 }));
  assert.equal((await assertSafeRaster(png, { maxPixels: 200000 })).height, 300);
});


// ---------------------------------------------------------------- F-3: auth helpers
test("F-3 safeEqual is correct for equal / different / different-length / empty inputs", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual("", ""), true);
  assert.equal(safeEqual(undefined, "x"), false);
  assert.equal(safeEqual(null, null), true);
});

test("F-3 clientIp takes the proxy-appended (rightmost) X-Forwarded-For entry, ignoring spoofed prefixes", () => {
  const mk = function(xff, remote) { return { headers: xff == null ? {} : { "x-forwarded-for": xff }, socket: { remoteAddress: remote || "10.1.1.1" } }; };
  assert.equal(clientIp(mk("1.2.3.4"), 1), "1.2.3.4");
  assert.equal(clientIp(mk("6.6.6.6, 1.2.3.4"), 1), "1.2.3.4");
  assert.equal(clientIp(mk("6.6.6.6, 7.7.7.7, 1.2.3.4"), 1), "1.2.3.4");
  assert.equal(clientIp(mk("6.6.6.6, 1.2.3.4"), 2), "6.6.6.6");
  assert.equal(clientIp(mk(null, "::ffff:9.9.9.9"), 1), "9.9.9.9");
  assert.equal(clientIp(mk("1.2.3.4"), 0), "10.1.1.1");
});

test("F-3 failure limiter: lockout after N failures, exponential backoff, reset on success, bounded memory", () => {
  let now = 1000000;
  const lim = createFailureLimiter({ maxFailures: 3, windowMs: 60000, baseLockMs: 1000, maxLockMs: 8000, maxKeys: 50, now: function() { return now; } });
  assert.equal(lim.check("a").allowed, true);
  lim.fail("a"); lim.fail("a");
  assert.equal(lim.check("a").allowed, true);
  lim.fail("a"); // 3rd -> lock 1s
  assert.equal(lim.check("a").allowed, false);
  assert.equal(lim.check("a").retryAfterSec, 1);
  assert.equal(lim.check("b").allowed, true, "other IPs unaffected");
  now += 1001;
  assert.equal(lim.check("a").allowed, true);
  lim.fail("a"); // 4th -> lock 2s
  assert.equal(lim.check("a").retryAfterSec, 2);
  now += 2001; lim.fail("a"); now += 4001; lim.fail("a"); // 5th: 4s, 6th: 8s, 7th capped at 8s
  lim.fail("a");
  assert.ok(lim.check("a").retryAfterSec <= 8);
  now += 9000;
  lim.success("a");
  assert.equal(lim.check("a").allowed, true);
  lim.fail("a"); lim.fail("a");
  assert.equal(lim.check("a").allowed, true, "counter restarted after success");
  for (let i = 0; i < 500; i++) lim.fail("k" + i);
  assert.ok(lim.size() <= 50, "map stays bounded: " + lim.size());
});

test("F-3 scrypt hash round trip, salted, wrong password and garbage rejected", () => {
  const h1 = hashPasswordScrypt("correct horse"), h2 = hashPasswordScrypt("correct horse");
  assert.notEqual(h1, h2);
  assert.equal(verifyPasswordScrypt("correct horse", h1), true);
  assert.equal(verifyPasswordScrypt("wrong", h1), false);
  assert.equal(verifyPasswordScrypt("x", "scrypt$zz$zz"), false);
  assert.equal(verifyPasswordScrypt("x", ""), false);
});

test("F-3 session token: legacy at epoch 0, rotates with epoch, epoch persists", () => {
  const legacy = crypto.createHmac("sha256", "k").update("news-factory-admin").digest("hex");
  assert.equal(sessionTokenFor("k", 0), legacy, "existing cookies stay valid after deploy");
  assert.notEqual(sessionTokenFor("k", 1), legacy);
  assert.notEqual(sessionTokenFor("k", 1), sessionTokenFor("k", 2));
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "epoch-")), "e.json");
  const st = createSessionEpochStore(file);
  assert.equal(st.get(), 0);
  st.bump(); st.bump();
  assert.equal(createSessionEpochStore(file).get(), 2);
});

// ---------------------------------------------------------------- server integration harness (no DB, no network)
const PASSWORD = "audit-pass-123";
const ADMIN_KEY_FOR_TESTS = "test-admin-key-0123456789";
async function startApp(extraEnv) {
  const port = 41000 + Math.floor(Math.random() * 2000);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-sec-"));
  const env = Object.assign({}, process.env, {
    PORT: String(port), DATA_DIR: dataDir, DATABASE_URL: "", ADMIN_UI_PASSWORD: PASSWORD, ADMIN_UI_PASSWORD_SHA256: "", ADMIN_UI_PASSWORD_SCRYPT: "",
    ADMIN_KEY: ADMIN_KEY_FOR_TESTS, COLLECTOR_ENABLED: "false", AUTO_PUBLISH_ENABLED: "false", TELEGRAM_BOT_TOKEN: "", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "",
    VK_APP_ID: "", NEWS_FACTORY_PUBLIC_URL: "http://127.0.0.1:" + port
  }, extraEnv || {});
  const child = spawn(process.execPath, ["server.js"], { cwd: APP_DIR, env, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  child.stdout.on("data", function(x) { logs += x; });
  child.stderr.on("data", function(x) { logs += x; });
  const base = "http://127.0.0.1:" + port;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(base + "/health")).ok) break; } catch {}
    await new Promise(function(r) { setTimeout(r, 150); });
    if (i === 119) { child.kill("SIGKILL"); throw new Error("server did not start: " + logs.slice(-800)); }
  }
  let ipCounter = 0;
  const api = {
    base, dataDir, logs: function() { return logs; }, stop: function() { child.kill("SIGKILL"); },
    // each call gets its own fake client IP unless one is given, so tests do not trip over each other's lockouts
    nextIp: function() { ipCounter++; return "203.0.113." + (ipCounter % 250 + 1); },
    async login(ip) {
      const r = await fetch(base + "/api/login", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip || api.nextIp() }, body: JSON.stringify({ password: PASSWORD }) });
      return { status: r.status, cookie: String(r.headers.get("set-cookie") || "").split(";")[0] };
    },
    async req(method, url, o) {
      const opts = o || {};
      const headers = Object.assign({ "x-forwarded-for": opts.ip || api.nextIp() }, opts.cookie ? { cookie: opts.cookie } : {}, opts.headers || {});
      const body = opts.raw != null ? opts.raw : (opts.json !== undefined ? JSON.stringify(opts.json) : undefined);
      if (body !== undefined && !headers["content-type"]) headers["content-type"] = "application/json";
      const r = await fetch(base + url, { method, headers, body, redirect: "manual" });
      const text = await r.text();
      let json = null; try { json = JSON.parse(text); } catch {}
      return { status: r.status, headers: r.headers, text, json };
    }
  };
  return api;
}
async function withApp(extraEnv, fn) {
  const app = await startApp(extraEnv);
  try { return await fn(app); } finally { app.stop(); }
}

// ---------------------------------------------------------------- F-3: auth against the real server
test("F-3 login: wrong passwords are locked out per IP (429 + Retry-After), other IPs and the right password still work", async () => {
  await withApp({ AUTH_MAX_FAILURES: "5" }, async function(app) {
    const ip = "198.51.100.7";
    const bad = function() { return app.req("POST", "/api/login", { ip, json: { password: "nope" } }); };
    for (let i = 0; i < 5; i++) assert.equal((await bad()).status, 401, "attempt " + i);
    const locked = await bad();
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers.get("retry-after")) >= 1);
    // even the correct password is refused while locked
    assert.equal((await app.req("POST", "/api/login", { ip, json: { password: PASSWORD } })).status, 429);
    // a spoofed left-most X-Forwarded-For entry does not give a fresh bucket
    assert.equal((await app.req("POST", "/api/login", { ip: "1.1.1.1, " + ip, json: { password: "nope" } })).status, 429);
    // a different client is unaffected
    assert.equal((await app.login("198.51.100.8")).status, 200);
    // 300 attempts from one client never get more than the allowed number of checks
    let checked = 0;
    for (let i = 0; i < 300; i++) if ((await app.req("POST", "/api/login", { ip: "198.51.100.9", json: { password: "x" + i } })).status !== 429) checked++;
    assert.ok(checked <= 5, "only 5 guesses allowed, got " + checked);
  });
});

test("F-3 x-admin-key: constant-time check, failures count towards the same per-IP lockout", async () => {
  await withApp({ AUTH_MAX_FAILURES: "4" }, async function(app) {
    const ip = "198.51.100.20";
    for (let i = 0; i < 4; i++) {
      const r = await app.req("POST", "/publish", { ip, headers: { "x-admin-key": "guess" + i }, json: { text: "x" } });
      assert.equal(r.status, 401);
    }
    const r = await app.req("POST", "/publish", { ip, headers: { "x-admin-key": ADMIN_KEY_FOR_TESTS }, json: { text: "x" } });
    assert.equal(r.status, 429, "locked even with the right key");
    // other IP with the right key passes the auth gate (empty text -> 400, never 401/429)
    const ok = await app.req("POST", "/publish", { ip: "198.51.100.21", headers: { "x-admin-key": ADMIN_KEY_FOR_TESTS }, json: {} });
    assert.equal(ok.status, 400);
  });
});

test("F-3 session: existing cookie format survives, logout everywhere invalidates every cookie", async () => {
  await withApp({}, async function(app) {
    const legacy = "nf_session=" + crypto.createHmac("sha256", ADMIN_KEY_FOR_TESTS).update("news-factory-admin").digest("hex");
    assert.equal((await app.req("GET", "/api/workspaces", { cookie: legacy })).status, 200, "pre-existing cookie valid at epoch 0");
    const a = await app.login(), b = await app.login();
    assert.equal(a.cookie, legacy, "login still issues the legacy token until the epoch is rotated");
    assert.equal((await app.req("POST", "/api/logout", { cookie: a.cookie, json: {} })).status, 200);
    assert.equal((await app.req("GET", "/api/workspaces", { cookie: b.cookie })).status, 200, "plain logout only clears the cookie");
    await app.req("POST", "/api/logout", { json: { everywhere: true } });
    assert.equal((await app.req("GET", "/api/workspaces", { cookie: b.cookie })).status, 200, "anonymous logout-everywhere is a no-op");
    const r = await app.req("POST", "/api/logout", { cookie: b.cookie, json: { everywhere: true } });
    assert.equal(r.json.everywhere, true);
    assert.equal((await app.req("GET", "/api/workspaces", { cookie: a.cookie })).status, 401);
    assert.equal((await app.req("GET", "/api/workspaces", { cookie: b.cookie })).status, 401);
    const fresh = await app.login();
    assert.notEqual(fresh.cookie, a.cookie);
    assert.equal((await app.req("GET", "/api/workspaces", { cookie: fresh.cookie })).status, 200);
  });
});

test("F-3 password modes: scrypt preferred, legacy SHA-256 still works", async () => {
  const sha = crypto.createHash("sha256").update("legacy-pass").digest("hex");
  await withApp({ ADMIN_UI_PASSWORD: "", ADMIN_UI_PASSWORD_SHA256: sha }, async function(app) {
    assert.equal((await app.req("POST", "/api/login", { json: { password: "nope" } })).status, 401);
    assert.equal((await app.req("POST", "/api/login", { json: { password: "legacy-pass" } })).status, 200);
  });
  await withApp({ ADMIN_UI_PASSWORD: "", ADMIN_UI_PASSWORD_SCRYPT: hashPasswordScrypt("scrypt-pass") }, async function(app) {
    assert.equal((await app.req("POST", "/api/login", { json: { password: "nope" } })).status, 401);
    assert.equal((await app.req("POST", "/api/login", { json: { password: "scrypt-pass" } })).status, 200);
  });
});

// ---------------------------------------------------------------- runner
(async function main() {
  let failed = 0;
  for (const t of pending) {
    try { await t.fn(); passed++; console.log("ok   - " + t.name); }
    catch (error) { failed++; console.log("FAIL - " + t.name + "\n       " + String(error && error.stack || error).split("\n").slice(0, 6).join("\n       ")); }
  }
  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
})();
