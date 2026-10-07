// v0.65.2: the admin shows a multi-theme source in every theme group the server counts it in (was: only its primary theme).
//   npm run test:rubric-groups-ui
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const html = fs.readFileSync(fileURLToPath(new URL("../public/admin.html", import.meta.url)), "utf8");
const m = html.match(/function rubricGroupIdsOf\([\s\S]*?return out\}/);
assert.ok(m, "rubricGroupIdsOf exists in admin.html");
const ctx = {}; vm.createContext(ctx); vm.runInContext(m[0] + "; this.f = rubricGroupIdsOf;", ctx);
const f = ctx.f;
const groups = [{ id: "a" }, { id: "b" }, { id: "c" }];
assert.deepEqual(Array.from(f({ rubric: "a" }, groups)), ["a"]);
assert.deepEqual(Array.from(f({ rubric: "a", rubrics: ["b", "c"] }, groups)), ["a", "b", "c"], "primary + extra themes");
assert.deepEqual(Array.from(f({ rubrics: ["c", "c", "zzz"] }, groups)), ["c"], "dedup, unknown ignored");
assert.deepEqual(Array.from(f({ rubric: "old" }, groups)), [], "no known theme -> «Вне групп»");
assert.deepEqual(Array.from(f(null, groups)), []);
// the grouping loop uses it
assert.ok(/ids\.forEach\(function\(g\)\{\(byGroup\[g\]=byGroup\[g\]\|\|\[\]\)\.push\(s\)\}\)/.test(html), "render uses rubricGroupIdsOf");
// mirrors the server rule (rubricSourceCounts): primary + rubrics[] all count
const src = fs.readFileSync(fileURLToPath(new URL("../server.js", import.meta.url)), "utf8");
assert.ok(/new Set\(\[String\(src\.rubric \|\| ""\)\]\.concat\(Array\.isArray\(src\.rubrics\)/.test(src), "server counting rule unchanged");
process.stdout.write("rubric-groups-ui tests passed\n");
