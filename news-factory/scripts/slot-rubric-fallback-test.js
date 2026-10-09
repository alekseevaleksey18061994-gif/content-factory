// 2026-10-09 12:00 «Что там у тачек?»: the slot needs a bloggers_tests post, the queue had 16 posts of other rubrics -> slot stayed empty.
//   npm run test:slot-rubric-fallback
import assert from "node:assert/strict";
import { loadServer, inWs, mkQueueItem } from "./dedupe-harness.js";

let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log("ok - " + name); }
const CHAN = "chtotamtachki";
const item = (id, bucket) => mkQueueItem({ id, newsId: "n_" + id, contentBucket: bucket, editorialV2: { channelId: "auto", status: "approved", verdict: "pass", importance: 8, contentBucket: bucket } });

async function load(env) {
  Object.assign(process.env, { SLOT_RUBRIC_FALLBACK: "true" }, env || {});
  const t = await loadServer({ fixedNow: "2026-10-09T08:50:00Z", state: { [CHAN]: { migrations: ["v0.53.0-car-rubrics"], sources: [] } } });
  return t;
}

await test("F1 strict first: an off-rubric queue gives nothing for the 12:00 slot (prepare keeps the owner's rule)", async () => {
  const t = await load();
  t.ws(CHAN).state.queue = [item("a", "russia_market"), item("b", "premieres")];
  assert.equal(inWs(t, CHAN, () => t.dynamicBestQueueItem("", "12:00")), null);
  t.restoreConsole();
});
await test("F2 at publish time the slot is relaxed and takes the best post of another rubric", async () => {
  const t = await load();
  t.ws(CHAN).state.queue = [item("a", "russia_market"), item("b", "premieres")];
  assert.equal(inWs(t, CHAN, () => t.relaxSlotRubric("12:00")), true);
  assert.ok(inWs(t, CHAN, () => t.dynamicBestQueueItem("", "12:00")), "slot is no longer empty");
  t.restoreConsole();
});
await test("F3 relaxing one slot does not relax another slot or another channel", async () => {
  const t = await load();
  t.ws(CHAN).state.queue = [item("a", "russia_market")];
  inWs(t, CHAN, () => t.relaxSlotRubric("12:00"));
  assert.equal(inWs(t, CHAN, () => t.slotRubricIsRelaxed("13:00")), false);
  assert.equal(inWs(t, CHAN, () => t.slotRubricIsRelaxed("12:00")), true);
  assert.equal(inWs(t, "chtotamkino", () => t.slotRubricIsRelaxed("12:00")), false);
  t.restoreConsole();
});
await test("F4 a post of the slot's own rubric still wins when one exists", async () => {
  const t = await load();
  t.ws(CHAN).state.queue = [item("a", "russia_market"), item("own", "bloggers_tests")];
  assert.equal(inWs(t, CHAN, () => t.dynamicBestQueueItem("", "12:00")).id, "own");
  t.restoreConsole();
});
await test("F5 SLOT_RUBRIC_FALLBACK=false keeps the old strict behaviour", async () => {
  const t = await load({ SLOT_RUBRIC_FALLBACK: "false" });
  t.ws(CHAN).state.queue = [item("a", "russia_market")];
  assert.equal(inWs(t, CHAN, () => t.relaxSlotRubric("12:00")), false);
  assert.equal(inWs(t, CHAN, () => t.dynamicBestQueueItem("", "12:00")), null);
  t.restoreConsole();
});
await test("F6 excluded/unusable posts are still not taken even when relaxed", async () => {
  const t = await load();
  t.ws(CHAN).state.queue = [Object.assign(item("bad", "russia_market"), { status: "publish_failed" })];
  inWs(t, CHAN, () => t.relaxSlotRubric("12:00"));
  assert.equal(inWs(t, CHAN, () => t.dynamicBestQueueItem("", "12:00")), null);
  t.restoreConsole();
});
await test("F7 relaxation is scoped: after the selection the strict rule is back (no leak to tomorrow's slot of the same time)", async () => {
  const t = await load();
  t.ws(CHAN).state.queue = [item("a", "russia_market")];
  inWs(t, CHAN, () => { t.relaxSlotRubric("12:00"); try { assert.ok(t.dynamicBestQueueItem("", "12:00")); } finally { t.unrelaxSlotRubric("12:00"); } });
  assert.equal(inWs(t, CHAN, () => t.slotRubricIsRelaxed("12:00")), false);
  assert.equal(inWs(t, CHAN, () => t.dynamicBestQueueItem("", "12:00")), null);
  t.restoreConsole();
});
console.log("slot-rubric-fallback tests passed (" + passed + ")");
process.exit(0);
