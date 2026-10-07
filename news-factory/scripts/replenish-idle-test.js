// v0.65.1: a theme channel whose search is resting says WHY it does nothing (SOURCE_REPLENISH_IDLE), at most once per 6 h.
//   npm run test:replenish-idle
process.env.TZ = "UTC";
import assert from "node:assert/strict";
import { loadServer, inWs } from "./dedupe-harness.js";
import { channelStrategy } from "../lib/channel-dna.js";
import { RUBRICS_V055_MIGRATION } from "../lib/channel-rubrics-v055.js";

const T = "chtotamtravel";
const src = (id, url, extra) => Object.assign({ id, name: id, url, enabled: true, group: "media", type: "web", priority: 2 }, extra || {});
function quiet(fn) {
  const lines = []; const o = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a) => lines.push(a.join(" "));
  return Promise.resolve().then(fn).finally(() => Object.assign(console, o)).then(() => lines);
}
async function main() {
  const t = await loadServer({ fixedNow: "2026-10-07T20:00:00Z", state: { [T]: { sources: [], migrations: [RUBRICS_V055_MIGRATION] } } });
  const ws = t.ws(T);
  for (const r of channelStrategy("travel").rubrics) for (let i = 0; i < (r.id === "travel_bloggers" ? 0 : 6); i++) ws.state.sources.push(src(r.id + i, "https://" + r.id + i + ".example/", { rubric: r.id }));
  // the shared "rubric" search is resting for 24 h
  ws.state.sourceReplenish = { misses: { rubric: { count: 0, until: "2026-10-08T12:00:00.000Z" } } };
  let lines = await quiet(() => inWs(t, T, () => t.replenishSources("replace_paused")));
  const idle = lines.find((l) => l.startsWith("SOURCE_REPLENISH_IDLE"));
  assert.ok(idle, "idle reason is logged: " + lines.join("\n").slice(0, 300));
  const j = JSON.parse(idle.slice("SOURCE_REPLENISH_IDLE ".length));
  assert.equal(j.rubricSearchAllowed, false);
  assert.equal(j.restUntil, "2026-10-08T12:00:00.000Z");
  assert.ok(j.belowMin.includes("travel_bloggers"), JSON.stringify(j));
  // once per 6 h
  ws.state.sourceReplenish.lastAt = "";
  lines = await quiet(() => inWs(t, T, () => t.replenishSources("replace_paused")));
  assert.ok(!lines.some((l) => l.startsWith("SOURCE_REPLENISH_IDLE")), "not logged again within 6 h");
}
main().then(() => { process.stdout.write("replenish-idle tests passed\n"); process.exit(0); }).catch((e) => { process.stderr.write(String(e && e.stack || e) + "\n"); process.exit(1); });
