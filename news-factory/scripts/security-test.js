// Offline regression tests for the security audit fixes (no network, no database).
// Run: npm run test:security
import assert from "node:assert/strict";
import http from "node:http";
import zlib from "node:zlib";
import sharp from "sharp";
import { isBlockedIp, isBlockedHostname, validateUrl, createSafeFetch, safeFetch, SafeFetchError } from "../lib/safe-fetch.js";
import { assertSafeRaster, sniffRasterFormat } from "../lib/image-guard.js";

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
