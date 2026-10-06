// v0.54.3: queue posts that only got the local text card (OpenAI had no credits) get an AI cover once OpenAI is back.
// npm run test:text-card-upgrade
process.env.TZ = "UTC";
import assert from "node:assert/strict";
import { loadServer, inWs, mkQueueItem, net } from "./dedupe-harness.js";
const W = "chtotamtech";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
let passed = 0, imageCalls = 0;
async function test(n, f) { await f(); passed++; console.log("ok - " + n); }
const cardItem = (o) => mkQueueItem(Object.assign({ imageUrl: "", generatedImageUrl: "/media/budget_card_x.webp", mediaOrigin: "local_branded_card", mediaStatus: "local_card", generatedBy: "local-branded-card-v2", mediaType: "generated" }, o || {}));
net.pages.set("https://api.openai.com/v1/images/generations", () => {
  imageCalls++;
  return new Response(JSON.stringify({ data: [{ b64_json: PNG }], usage: {} }), { status: 200, headers: { "content-type": "application/json" } });
});
const t = await loadServer({ fixedNow: Date.parse("2026-10-06T09:00:00Z"), env: { GENERATE_COVER_IF_MISSING: "true", TEXT_CARD_POSTS_ALLOWED: "false" } });
await test("U1 text-card post gets an AI cover and is no longer blocked", async () => {
  const item = cardItem();
  inWs(t, W, () => { t.state.queue = [item]; });
  assert.equal(inWs(t, W, () => t.isTextCardOnly(item)), true);
  const r = await t.upgradeTextCardCoversAllWorkspaces();
  assert.equal(r.upgraded, 1, JSON.stringify(r));
  assert.equal(imageCalls, 1);
  const cur = inWs(t, W, () => t.state.queue[0]);
  assert.equal(cur.mediaOrigin, "ai_generated");
  assert.match(cur.generatedImageUrl, /cover_/);
  assert.equal(inWs(t, W, () => t.isTextCardOnly(cur)), false);
});
await test("U2 already upgraded post is not drawn again", async () => {
  const before = imageCalls;
  const r = await t.upgradeTextCardCoversAllWorkspaces();
  assert.equal(r.upgraded, 0);
  assert.equal(imageCalls, before);
});
await test("U3 nothing happens while the OpenAI breaker is open", async () => {
  const item = cardItem();
  inWs(t, W, () => { t.state.queue = [item]; });
  t.providerBreaker.trip("openai", "You have no credits remaining", "billing");
  const before = imageCalls;
  const r = await t.upgradeTextCardCoversAllWorkspaces();
  assert.equal(r.upgraded, 0);
  assert.equal(imageCalls, before);
  assert.equal(inWs(t, W, () => t.isTextCardOnly(t.state.queue[0])), true);
});
await test("U4 per-item attempts are capped", async () => {
  const item = cardItem({ textCardUpgradeAttempts: 3 });
  inWs(t, W, () => { t.state.queue = [item]; });
  const r = await t.upgradeTextCardCoversAllWorkspaces();
  assert.equal(r.upgraded + r.failed + r.skipped, 0);
});
t.restoreConsole();
console.log("passed " + passed);
process.exit(0);
