// v0.54.0: «Что там у тачек?» — each theme group has its own sources (one panel = one theme), min 3 each.
// npm run test:cars-rubrics
import assert from "node:assert/strict";
import { normalizeAutoRubricSources } from "../lib/channel-rubric-migrations.js";
import { APPROVED_AUTO_BLOGGER_SOURCES } from "../lib/channel-curated-sources.js";
import { channelStrategy } from "../lib/channel-dna.js";

const IDS = ["tesla","byd","geely","chery","nio","xpeng","zeekr","gwm","toyota","vw","bmw","mercedes","reuters","carnewschina","cnevpost","gasgoo","electrek","insideevs","motor1","carscoops","autocar","topgear","caranddriver","thedrive","jalopnik","autonews-ru","motor-ru","drom","quto","autoevolution","zr","autostat","kolesa","autoreview"];
const state = { sources: IDS.map((x) => ({ id: "cars-" + x, name: x, url: "https://" + x + ".example", enabled: true, group: "media" })), sourceReplenish: {} };
normalizeAutoRubricSources(state, APPROVED_AUTO_BLOGGER_SOURCES, [], "2026-10-05T00:00:00Z");
const rubrics = channelStrategy("auto").rubrics.map((r) => r.id);
const count = {};
for (const r of rubrics) count[r] = state.sources.filter((s) => s.enabled && (s.rubrics || []).includes(r)).length;
let passed = 0;
function test(n, f) { f(); passed++; console.log("ok - " + n); }
test("C1 every car theme group has at least 3 sources", () => { for (const r of rubrics) assert.ok(count[r] >= 3, r + " has " + count[r]); });
test("C2 groups are separate: no source sits in more than 2 groups, and 'premieres' is not a catch-all", () => {
  for (const s of state.sources) assert.ok((s.rubrics || []).length <= 2, s.id + " in " + s.rubrics);
  assert.ok(count.premieres <= 8, "premieres=" + count.premieres);
  assert.ok(count.viral_unusual <= 6, "viral=" + count.viral_unusual);
});
test("C3 China sources are not in 'Russian market' and Russian ones are not in 'China'", () => {
  const by = (id) => state.sources.find((s) => s.id === id).rubrics;
  assert.ok(!by("cars-byd").includes("russia_market")); assert.ok(!by("cars-autonews-ru").includes("china_cars"));
});
test("C4 bloggers stay in tests group", () => { assert.ok(state.sources.filter((s) => s.group === "blogger").every((s) => s.rubric === "bloggers_tests")); });
console.log("cars-rubrics tests passed (" + passed + ") " + JSON.stringify(count));
