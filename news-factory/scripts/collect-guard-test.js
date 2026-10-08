import { collectSkipDecision } from "../lib/collect-guard.js";
let failed = 0;
function check(name, cond) { if (cond) console.log("ok - " + name); else { failed += 1; console.log("FAIL - " + name); } }
const now = Date.parse("2026-10-09T10:00:00Z"), min = 60000;
check("C0 disabled when minDepth is 0", collectSkipDecision({ minDepth: 0, depth: 50, lastCollectAtMs: now - 5 * min, nowMs: now, maxStaleMs: 100 * min }).skip === false);
check("C1 thin queue always collects", collectSkipDecision({ minDepth: 6, depth: 5, lastCollectAtMs: now - 5 * min, nowMs: now, maxStaleMs: 100 * min }).reason === "queue_thin");
check("C2 rich queue + fresh collect skips", collectSkipDecision({ minDepth: 6, depth: 6, lastCollectAtMs: now - 60 * min, nowMs: now, maxStaleMs: 100 * min }).skip === true);
check("C3 stale last collect collects even with a rich queue", collectSkipDecision({ minDepth: 6, depth: 20, lastCollectAtMs: now - 100 * min, nowMs: now, maxStaleMs: 100 * min }).reason === "stale");
check("C4 never collected collects", collectSkipDecision({ minDepth: 6, depth: 20, lastCollectAtMs: NaN, nowMs: now, maxStaleMs: 100 * min }).reason === "never_collected");
check("C5 garbage input never skips", collectSkipDecision({}).skip === false && collectSkipDecision(null).skip === false);
check("C6 infinite stale limit never skips", collectSkipDecision({ minDepth: 6, depth: 20, lastCollectAtMs: now - 5000 * min, nowMs: now, maxStaleMs: Infinity }).skip === false);
check("C7 last collect in the future never skips", collectSkipDecision({ minDepth: 6, depth: 20, lastCollectAtMs: now + 30 * min, nowMs: now, maxStaleMs: 100 * min }).reason === "clock_skew");
check("C8 zero or missing stale limit never skips", collectSkipDecision({ minDepth: 6, depth: 20, lastCollectAtMs: now - min, nowMs: now, maxStaleMs: 0 }).skip === false);
console.log(failed ? "collect-guard tests FAILED" : "collect-guard tests passed");
process.exit(failed ? 1 : 0);
