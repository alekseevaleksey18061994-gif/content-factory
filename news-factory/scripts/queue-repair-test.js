// 2026-10-09 Every restart replaced queue posts with remote source photos by a text card (remote URLs cannot be
// fingerprinted -> "broken"), then the AI upgrade paid to redraw them again and again.
//   npm run test:queue-repair
import assert from "node:assert/strict";
import { loadServer, mkQueueItem, inWs } from "./dedupe-harness.js";

let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log("ok - " + name); }
const CHAN = "chtotamtachki";

async function load(items) {
  const t = await loadServer({ fixedNow: "2026-10-09T08:50:00Z", state: { [CHAN]: { migrations: ["v0.53.0-car-rubrics"], sources: [] } } });
  t.ws(CHAN).state.queue = items;
  return t;
}

await test("P1 a remote source photo is left alone", async () => {
  const item = mkQueueItem({ id: "a", newsId: "n_a", imageUrl: "https://example.com/photo.jpg" });
  const t = await load([item]);
  const r = await inWs(t, CHAN, () => t.repairBrokenQueueImages());
  assert.equal(r.fixed || 0, 0);
  assert.equal(t.ws(CHAN).state.queue[0].imageUrl, "https://example.com/photo.jpg");
  assert.ok(!t.ws(CHAN).state.queue[0].generatedImageUrl);
  t.restoreConsole();
});
await test("P2 a missing local /media file is still replaced by a card", async () => {
  const base = "https://news-factory-api-production.up.railway.app";
  const item = mkQueueItem({ id: "b", newsId: "n_b", imageUrl: base + "/media/does_not_exist_123.jpg" });
  const t = await load([item]);
  const r = await inWs(t, CHAN, () => t.repairBrokenQueueImages());
  assert.equal(r.fixed, 1);
  assert.equal(t.ws(CHAN).state.queue[0].imageUrl, "");
  assert.ok(t.ws(CHAN).state.queue[0].generatedImageUrl);
  t.restoreConsole();
});
await test("P3 boot media repair does not restore a weak source photo over a generated cover", async () => {
  const gen = "https://news-factory-api-production.up.railway.app/media/cover_x_1.png";
  const item = mkQueueItem({ id: "c", newsId: "n_c", imageUrl: "", generatedImageUrl: gen, mediaOrigin: "ai_generated", originalImageUrl: "https://example.invalid/weak.jpg" });
  const t = await load([item]);
  let calls = 0;
  const r = await inWs(t, CHAN, () => t.repairBalancedQueueMedia());
  const q = t.ws(CHAN).state.queue[0];
  assert.equal(q.imageUrl, "");
  assert.equal(q.generatedImageUrl, gen);
  assert.equal((r.repaired || 0) + (r.failed || 0), 0, "item must not even be attempted");
  t.restoreConsole();
});
console.log(passed + " passed");
process.exit(0);
