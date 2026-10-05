// v0.53.4: relaxed rating gates so shopping / money posts actually publish.
// npm run test:rating-gates
process.env.TZ = "UTC";
import assert from "node:assert/strict";
import { loadServer, inWs } from "./dedupe-harness.js";
const M = "chtotamdengi", S = "chtotampokupki", C = "chtotamtachki";
let passed = 0;
async function test(n, f) { await f(); passed++; console.log("ok - " + n); }
await test("G1 gates: shopping 55/45, money 70/60, other channels keep the default", async () => {
  const t = await loadServer({ fixedNow: Date.parse("2026-10-05T12:00:00Z") });
  assert.equal(inWs(t, S, () => t.channelRatingMinAuto()), 55);
  assert.equal(inWs(t, S, () => t.channelRatingDropBelow()), 45);
  assert.equal(inWs(t, M, () => t.channelRatingMinAuto()), 70);
  assert.equal(inWs(t, M, () => t.channelRatingDropBelow()), 60);
  const c = inWs(t, C, () => t.channelRatingMinAuto());
  assert.ok(c !== 55 && c !== 70);
  t.restoreConsole();
});
console.log("passed " + passed);
process.exit(0);
