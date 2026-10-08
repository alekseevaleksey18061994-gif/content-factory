import { moscowRangeBounds, COST_RANGE_MAX_DAYS } from "../lib/costs.js";
let failed = 0;
function check(name, cond) { if (cond) console.log("ok - " + name); else { failed += 1; console.log("FAIL - " + name); } }
const now = new Date("2026-10-09T01:00:00+03:00"); // 9 Oct 01:00 Moscow
const one = moscowRangeBounds("2026-10-08", "2026-10-08", now);
check("R0 one past day = Moscow midnight to midnight", one && one.start.toISOString() === "2026-10-07T21:00:00.000Z" && one.end.toISOString() === "2026-10-08T21:00:00.000Z");
check("R1 label for one day", one && one.label === "8 окт 2026");
check("R2 previous period has the same length right before", one && one.previousEnd.getTime() === one.start.getTime() && one.previousStart.getTime() === one.start.getTime() - 86400000);
const multi = moscowRangeBounds("2026-10-01", "2026-10-08", now);
check("R3 range of 8 days", multi && (multi.end - multi.start) === 8 * 86400000 && multi.label === "1 окт 2026 – 8 окт 2026");
const today = moscowRangeBounds("2026-10-09", "2026-10-09", now);
check("R4 today ends at now, not at the future midnight", today && today.end.getTime() === now.getTime());
check("R5 only 'from' means one day", moscowRangeBounds("2026-10-08", "", now).label === "8 окт 2026");
check("R6 future day rejected", moscowRangeBounds("2026-10-10", "2026-10-10", now) === null);
check("R7 reversed range rejected", moscowRangeBounds("2026-10-08", "2026-10-01", now) === null);
check("R8 garbage rejected", ["", "abc", "2026-13-01", "2026-02-30", "2026-10-8", "'; DROP TABLE x;--"].every(function(v){ return moscowRangeBounds(v, v, now) === null; }));
check("R9 longer than the limit rejected", moscowRangeBounds("2025-01-01", "2026-10-08", now) === null && COST_RANGE_MAX_DAYS === 366);
console.log(failed ? "cost-range tests FAILED" : "cost-range tests passed");
process.exit(failed ? 1 : 0);
