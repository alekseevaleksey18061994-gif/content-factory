// In-app notifications (bell) + Web Push.  npm run test:notifications
import assert from "node:assert/strict";
import fs from "node:fs";
import { createNotifier, classifyAlertText, splitAlertText } from "../lib/notifications.js";

let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log("ok - " + name); }
const quiet = { warn() {}, log() {} };
function fakeDb() {
  const rows = [], subs = new Map();
  return {
    rows, subs,
    async query(sql, args) {
      if (/INSERT INTO app_notifications/.test(sql)) { rows.push({ id: rows.length + 1, at: args[0], kind: args[1], severity: args[2], title: args[3], body: args[4], workspace_id: args[5], read_at: null }); return { rows: [{ id: rows.length }] }; }
      if (/UPDATE app_notifications/.test(sql)) { rows.forEach((r) => { r.read_at = r.read_at || new Date(); }); return { rows: [] }; }
      if (/SELECT \* FROM app_notifications/.test(sql)) return { rows: rows.slice().reverse() };
      if (/INSERT INTO push_subscriptions/.test(sql)) { subs.set(args[0], JSON.parse(args[1])); return { rows: [] }; }
      if (/DELETE FROM push_subscriptions/.test(sql)) { subs.delete(args[0]); return { rows: [] }; }
      if (/SELECT endpoint, keys FROM push_subscriptions/.test(sql)) return { rows: Array.from(subs, ([endpoint, keys]) => ({ endpoint, keys })) };
      return { rows: [] };
    }
  };
}
const SUB = (n) => ({ endpoint: "https://push.example/" + n, keys: { p256dh: "p", auth: "a" } });

await test("N1 add / list / unread / markRead", async () => {
  const n = createNotifier({ logger: quiet });
  await n.add({ kind: "deploy", title: "A" });
  await n.add({ kind: "billing", severity: "critical", title: "B" });
  assert.equal(n.list()[0].title, "B");
  assert.equal(n.unread(), 2);
  await n.markRead([n.list()[0].id]);
  assert.equal(n.unread(), 1);
  await n.markRead();
  assert.equal(n.unread(), 0);
});
await test("N2 the same key is throttled", async () => {
  let t = 1000;
  const n = createNotifier({ now: () => t, logger: quiet });
  assert.ok(await n.add({ key: "k", title: "x", throttleMs: 5000 }));
  assert.equal(await n.add({ key: "k", title: "x", throttleMs: 5000 }), null);
  t += 6000;
  assert.ok(await n.add({ key: "k", title: "x", throttleMs: 5000 }));
  assert.equal(n.list().length, 2);
});
await test("N3 push goes to every device; a gone device (410) is removed; other errors keep it", async () => {
  const sent = [];
  const n = createNotifier({ logger: quiet, sendPush: async (sub, payload) => { if (sub.endpoint.endsWith("/gone")) { const e = new Error("gone"); e.statusCode = 410; throw e; } if (sub.endpoint.endsWith("/flaky")) throw new Error("net"); sent.push(JSON.parse(payload)); } });
  await n.subscribe(SUB("ok")); await n.subscribe(SUB("gone")); await n.subscribe(SUB("flaky"));
  assert.equal(n.subscriptionCount(), 3);
  await n.add({ kind: "publish_failed", title: "Пост не вышел" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, "Пост не вышел");
  assert.equal(n.subscriptionCount(), 2);
});
await test("N4 invalid subscriptions are rejected", async () => {
  const n = createNotifier({ logger: quiet });
  assert.equal(await n.subscribe({ endpoint: "http://insecure/x", keys: { p256dh: "p", auth: "a" } }), false);
  assert.equal(await n.subscribe({ endpoint: "https://x/y" }), false);
  assert.equal(await n.subscribe(null), false);
  assert.equal(n.subscriptionCount(), 0);
});
await test("N5 a failing push never breaks add()", async () => {
  const n = createNotifier({ logger: quiet, sendPush: async () => { throw new Error("boom"); } });
  await n.subscribe(SUB("x"));
  assert.ok(await n.add({ title: "still stored" }));
  assert.equal(n.list().length, 1);
});
await test("N6 database persistence + reload", async () => {
  const db = fakeDb();
  const a = createNotifier({ getDb: () => db, logger: quiet });
  await a.add({ kind: "empty_queue", severity: "warn", title: "Очередь пуста", workspace: "chtotamsport" });
  await a.subscribe(SUB("p"), "ua");
  const b = createNotifier({ getDb: () => db, logger: quiet });
  await b.load();
  assert.equal(b.list().length, 1);
  assert.equal(b.list()[0].workspace, "chtotamsport");
  assert.equal(b.subscriptionCount(), 1);
  await b.markRead();
  assert.ok(db.rows[0].read_at);
});
await test("N7 owner-alert text is turned into title/body/kind", async () => {
  const text = "🚨 News Factory: у OpenAI закончились деньги (или ключ не принят).\nПополните баланс: https://x";
  const parts = splitAlertText(text);
  assert.equal(parts.title, "у OpenAI закончились деньги (или ключ не принят).");
  assert.match(parts.body, /Пополните/);
  assert.deepEqual(classifyAlertText(text), { kind: "billing", severity: "critical" });
  assert.equal(classifyAlertText("✅ News Factory: OpenAI снова отвечает").severity, "info");
  assert.equal(classifyAlertText("⚠️ канал молчит 6 часов").severity, "warn");
});
await test("N8 app shell files and server routes exist", async () => {
  for (const f of ["sw.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"]) assert.ok(fs.existsSync(new URL("../public/" + f, import.meta.url)), f);
  const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  for (const r of ['"/api/notifications"', '"/api/notifications/read"', '"/api/push/subscribe"', '"/api/push/unsubscribe"', '"/sw.js"']) assert.ok(server.includes(r), r);
  assert.ok(!/VAPID_PRIVATE_KEY[^\n]*(console|JSON\.stringify)/.test(server), "private key must never be logged");
  const mig = fs.readFileSync(new URL("../migrations/20261010_009_app_notifications.sql", import.meta.url), "utf8");
  assert.ok(/CREATE TABLE IF NOT EXISTS app_notifications/.test(mig) && !/DROP|DELETE|TRUNCATE/i.test(mig), "migration must be additive");
});
console.log(passed + " passed");
process.exit(0);
