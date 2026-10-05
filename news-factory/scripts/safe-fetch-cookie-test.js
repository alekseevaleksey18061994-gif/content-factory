// v0.54.1: redirects that hand out a cookie and loop until it comes back (Pepper) are followed; no cookie leaks to other hosts.
// npm run test:safe-fetch-cookie
import assert from "node:assert/strict";
import http from "node:http";
import { createSafeFetch } from "../lib/safe-fetch.js";

let hits = 0;
const server = http.createServer((req, res) => {
  hits++;
  if (req.url === "/loop") {
    if (!String(req.headers.cookie || "").includes("sid=abc")) { res.writeHead(302, { location: "/loop", "set-cookie": "sid=abc; Path=/; HttpOnly" }); return res.end(); }
    res.writeHead(200, { "content-type": "text/plain" }); return res.end("ok " + req.headers.cookie);
  }
  if (req.url === "/endless") { res.writeHead(302, { location: "/endless" }); return res.end(); }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const sf = createSafeFetch({ ipFilter: () => false, allowedPorts: [port], skipHostnameBlocklist: true });
let passed = 0;
async function test(n, f) { await f(); passed++; console.log("ok - " + n); }

await test("K1 cookie handed out by a redirect is returned on the next hop", async () => {
  const r = await sf("http://127.0.0.1:" + port + "/loop");
  assert.equal(r.status, 200); assert.match(await r.text(), /sid=abc/);
});
await test("K2 an endless redirect without cookies still stops with too_many_redirects", async () => {
  await assert.rejects(() => sf("http://127.0.0.1:" + port + "/endless"), /редиректов/);
});
console.log("safe-fetch-cookie tests passed (" + passed + ")");
server.close();
process.exit(0);
