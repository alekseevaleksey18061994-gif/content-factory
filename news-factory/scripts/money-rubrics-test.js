import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { CHANNEL_DNA, MONEY_RUBRIC_SOURCES_V0530, channelStrategy } from "../lib/channel-dna.js";
import { channelFreshnessHours } from "../lib/editorial-v2.js";
import { classifyContentBucket, channelFit } from "../lib/channel-strategy.js";

const RUBRICS = [
  "cards_banks",
  "deposits_savings",
  "loans_mortgage",
  "taxes",
  "ruble_inflation_cbr",
  "income_benefits",
  "financial_scams",
  "money_knowhow"
];

const strategy = channelStrategy("money");
assert.deepEqual(strategy.rubrics.map(function(r){ return r.id; }), RUBRICS, "money has exactly the agreed 8 rubrics");
assert.deepEqual(Object.keys(CHANNEL_DNA.money.mix), RUBRICS, "mix uses the same 8 rubrics");
assert.ok(Object.values(CHANNEL_DNA.money.mix).every(function(v){ return v === 0.125; }), "each rubric has equal daily target");
assert.equal(strategy.rubricMinSources, 5);
assert.equal(strategy.rubricMaxSources, 6);
assert.deepEqual(strategy.slotHours, [9, 11, 13, 16, 18, 20], "six hourly windows; 14:30/21:30 are the extra lane");
assert.equal(strategy.strictOnePerRubric, true);
assert.equal(strategy.qualityMin, 80);
assert.equal(strategy.qualityFallbackMin, 70);
assert.equal(strategy.emergencyMin, 95);
assert.equal(channelFreshnessHours("money", 24), 72, "collector retains the longest money candidates");

const counts = Object.fromEntries(RUBRICS.map(function(id){ return [id, 0]; }));
for (const source of MONEY_RUBRIC_SOURCES_V0530.add) {
  assert.ok(RUBRICS.includes(source.rubric), "unknown source rubric: " + source.rubric);
  counts[source.rubric] += 1;
}
for (const id of RUBRICS) assert.ok(counts[id] >= 5, id + " has at least five seed candidates");

assert.equal(classifyContentBucket("money", { title: "Новая схема мошенников с банковской картой" }), "financial_scams");
assert.equal(classifyContentBucket("money", { title: "ФНС изменила порядок налогового вычета" }), "taxes");
assert.equal(classifyContentBucket("money", { title: "Банк поднял ставку по вкладам" }), "deposits_savings");
assert.equal(classifyContentBucket("money", { title: "Социальный фонд проиндексировал пенсии" }), "income_benefits");

const fit = channelFit("money", {
  sourceClass: "OFFICIAL",
  channelSignals: { utility: 10, impact: 8, reliability: 6, freshness: 4, specificity: 2, interest: 0 }
});
assert.equal(fit.score, 6.6, "money score follows 30/20/20/15/10/5 weights");

const creator = channelFit("money", {
  sourceClass: "CREATOR",
  channelSignals: { utility: 10, impact: 10, reliability: 10, freshness: 10, specificity: 10, interest: 10 }
});
assert.equal(creator.signals.reliability, 6, "single creator cannot self-award official reliability");

const multi = channelFit("money", {
  sourceClass: "CREATOR",
  storySources: [{ url: "https://a.example/x" }, { url: "https://b.example/y" }],
  channelSignals: { utility: 10, impact: 10, reliability: 10, freshness: 10, specificity: 10, interest: 10 }
});
assert.equal(multi.signals.reliability, 9, "two independent sources raise evidence reliability");

const server = fs.readFileSync(fileURLToPath(new URL("../server.js", import.meta.url)), "utf8");
assert.match(server, /money:\s*\{\s*slots:\s*\["14:30",\s*"21:30",\s*"22:30"\][\s\S]*emergencySlots:\s*\["22:30"\]/);
assert.match(server, /\(rubric === "taxes" \|\| rubric === "money_knowhow"\) \? 72 : 48/);
assert.match(server, /strategyCfg\.strictOnePerRubric[\s\S]*themesToday\.has\(rubric\)/);
assert.match(server, /moneyVerificationEligible\(item, rubric\)/);
assert.match(server, /rubric === "money_knowhow"\) return true/);
assert.match(server, /cls === "OFFICIAL"\) return true/);
assert.match(server, /count >= 2/);
assert.match(server, /v0\.53\.0-money-rubrics/);
assert.match(server, /Что там с деньгами\? \| Личные финансы/);

const prompt = fs.readFileSync(fileURLToPath(new URL("../prompts/chto-tam.md", import.meta.url)), "utf8");
const start = prompt.indexOf("### `money`");
const end = prompt.indexOf("### `tech`", start);
const moneyProfile = prompt.slice(start, end);
for (const id of RUBRICS) assert.ok(moneyProfile.includes("`" + id + "`"), "prompt names " + id);
assert.match(moneyProfile, /официальный первоисточник ИЛИ два независимых надёжных источника/);
assert.match(moneyProfile, /обычно до 48 часов/);
assert.match(moneyProfile, /до 72 часов/);
assert.match(moneyProfile, /что произошло → кого касается → сколько в ₽\/%/);

console.log("money-rubrics checks: OK");
