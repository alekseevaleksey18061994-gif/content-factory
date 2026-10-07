// Offline tests for lib/health-alerts.js. Run: npm run test:health-alerts
import assert from "node:assert/strict";
import { evaluateHealth, silentChannels, REPEAT_MS } from "../lib/health-alerts.js";
let n = 0; const ok = (m) => { n++; console.log("ok - " + m); };
const msk = (h, m = 0) => Date.UTC(2026, 9, 8, h - 3, m); // 2026-10-08 hh:mm Moscow
const ch = (id, lastH, extra) => Object.assign({ id, name: "Канал " + id, autoPublish: true, paused: false, lastPublishedMs: lastH == null ? 0 : msk(lastH) }, extra || {});

// silence is counted from 09:00 MSK, never over the night
assert.deepEqual(silentChannels([ch("a", 23 - 24)], msk(8, 30), 5), []); ok("before 09:00 MSK nothing is silent");
assert.deepEqual(silentChannels([ch("a", 8)], msk(10, 0), 5), []); ok("night gap is not silence in the morning");
assert.equal(silentChannels([ch("a", 8)], msk(14, 30), 5).length, 1); ok("5.5 h since the 09:00 window start is silence");
assert.equal(silentChannels([ch("a", 13)], msk(14, 30), 5).length, 0); ok("a channel that posted recently is fine");
assert.equal(silentChannels([ch("a", null)], msk(20, 0), 5).length, 0); ok("a channel that never posted is skipped");
assert.equal(silentChannels([ch("a", 8, { paused: true }), ch("b", 8, { autoPublish: false })], msk(20, 0), 5).length, 0); ok("paused / manual channels are skipped");

// two consecutive checks, then one message; repeats only after 6 h; recovery once
const snap = (extra) => Object.assign({ nowMs: msk(15), channels: [ch("a", 9)], silenceHours: 5 }, extra || {});
let r = evaluateHealth(snap(), {});
assert.equal(r.send.length, 0); ok("first sighting does not alert");
r = evaluateHealth(snap(), r.next);
assert.equal(r.send.length, 1); assert.match(r.send[0].text, /Канал a/); ok("second sighting alerts");
r = evaluateHealth(snap({ nowMs: msk(16) }), r.next);
assert.equal(r.send.length, 0); ok("no repeat within 6 h");
r = evaluateHealth(snap({ nowMs: msk(15) + REPEAT_MS + 60000 }), r.next);
assert.equal(r.send.length, 1); ok("repeat after 6 h while still bad");
r = evaluateHealth(snap({ channels: [ch("a", 15)] }), r.next);
assert.equal(r.recovered.length, 1); assert.equal(Object.keys(r.next).length, 0); ok("recovery message once and state cleared");

// many silent channels are grouped into one message
const many = [ch("a", 9), ch("b", 9), ch("c", 9), ch("d", 9)];
r = evaluateHealth(snap({ channels: many }), evaluateHealth(snap({ channels: many }), {}).next);
assert.equal(r.send.length, 1); assert.match(r.send[0].text, /Молчат 4 каналов/); ok("4 silent channels -> one grouped alert");

// infrastructure problems
const infra = { channels: [], postmypostError: "HTTP 401", botConfigured: true, botOk: false, proxyConfigured: true, proxyOk: false, dbConfigured: true, dbReady: false };
r = evaluateHealth(Object.assign({ nowMs: msk(12) }, infra), evaluateHealth(Object.assign({ nowMs: msk(12) }, infra), {}).next);
assert.deepEqual(r.send.map(x => x.key).sort(), ["bot", "db", "postmypost", "proxy"]); ok("postmypost / bot / proxy / db problems are reported");
assert.ok(!r.send.some(x => /token|secret|Bearer/i.test(x.text.replace(/POSTMYPOST_TOKEN/g, "")))); ok("alert texts carry no secrets");
console.log(n + " passed");
