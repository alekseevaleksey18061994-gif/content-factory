import assert from "node:assert/strict";
import fs from "node:fs";
import {
  channelStrategy,
  AUTO_RUBRIC_SOURCES_V0530,
  SHOPPING_RUBRIC_SOURCES_V0530
} from "../lib/channel-dna.js";
import { channelFreshnessHours } from "../lib/editorial-v2.js";

function counts(slots) {
  const out = {};
  for (const slot of slots || []) out[slot.rubric] = (out[slot.rubric] || 0) + 1;
  return out;
}
function coverage(plan) {
  const out = {};
  for (const src of plan.add || []) {
    for (const rubric of src.rubrics || (src.rubric ? [src.rubric] : [])) {
      out[rubric] = (out[rubric] || 0) + 1;
    }
  }
  return out;
}

const auto = channelStrategy("auto");
assert.deepEqual(auto.rubrics.map(r => r.id), [
  "premieres","russia_market","china","ev_hybrid","auto_tech","bloggers_tests","viral_unusual","driver_important"
]);
assert.equal(auto.slotSchedule.length, 15);
assert.deepEqual(auto.slotSchedule.map(s => s.time), [
  "08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00","20:00","21:00","22:00"
]);
assert.deepEqual(counts(auto.slotSchedule), {
  driver_important: 1,
  russia_market: 3,
  premieres: 3,
  china: 2,
  bloggers_tests: 2,
  ev_hybrid: 1,
  viral_unusual: 2,
  auto_tech: 1
});
const autoCoverage = coverage(AUTO_RUBRIC_SOURCES_V0530);
for (const id of auto.rubrics.map(r => r.id)) assert.ok((autoCoverage[id] || 0) >= 5, "auto source floor " + id);
for (const handle of ["ildar_auto_podbor","bulkin_live","miheevpavlov_pro","sashatyman","academeg_true_original","klubniy_servis","garage54official","dubrovskiy_444","ivanzenkevich0","denismehanik"]) {
  assert.ok(AUTO_RUBRIC_SOURCES_V0530.add.some(s => s.url.includes(handle)), "approved blogger missing: " + handle);
}

const shopping = channelStrategy("shopping");
assert.deepEqual(shopping.rubrics.map(r => r.id), ["wildberries","ozon","yandex_market","aliexpress","viral_products"]);
assert.equal(shopping.slotSchedule.length, 20);
assert.deepEqual(shopping.slotSchedule.map(s => s.time), [
  "08:00","08:45","09:30","10:15","11:00","11:45","12:30","13:15","14:00","14:45",
  "15:30","16:15","17:00","17:45","18:30","19:15","20:00","20:45","21:30","22:15"
]);
assert.deepEqual(counts(shopping.slotSchedule), {
  viral_products: 4,
  wildberries: 5,
  ozon: 5,
  yandex_market: 3,
  aliexpress: 3
});
const minByRubric = Object.fromEntries(shopping.rubrics.map(r => [r.id, r.minSources]));
assert.deepEqual(minByRubric, { wildberries: 5, ozon: 5, yandex_market: 5, aliexpress: 5, viral_products: 7 });
const shoppingCoverage = coverage(SHOPPING_RUBRIC_SOURCES_V0530);
for (const [id, floor] of Object.entries(minByRubric)) assert.ok((shoppingCoverage[id] || 0) >= floor, "shopping source floor " + id);
assert.ok(SHOPPING_RUBRIC_SOURCES_V0530.add.some(s => /pepper\.ru/.test(s.url) && s.rubrics.length === 5), "Pepper must feed all shopping rubrics");

assert.equal(channelFreshnessHours("auto", 24), 72);
assert.equal(channelFreshnessHours("shopping", 24), 72);

const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
assert.match(server, /!\["money","auto","shopping"\]\.includes\(editorialChannelId\(\)\)/);
assert.match(server, /if \(editorialChannelId\(\) === "shopping"\) return \[\];/);
assert.match(server, /function shoppingHasRealProductMedia\(item\)/);
assert.match(server, /AI-перерисовка товара запрещена/);
assert.match(server, /channelId === "shopping" && !shoppingHasRealProductMedia\(item\)/);
assert.match(server, /async function structuredRubricSchedulerTick\(\)/);
assert.match(server, /publishDynamicSlot\(undefined, due\.slot\.time\)/);
assert.match(server, /const requiredRubric = !kind \? channelRubricForTime\(time\) : "";/);
assert.match(server, /if \(requiredRubric && itemTheme !== requiredRubric\) return false;/);
assert.match(server, /if \(channelSlotSchedule\(\)\) return false;/);
assert.match(server, /v0\.53\.0-auto-rubrics/);
assert.match(server, /v0\.53\.0-shopping-rubrics/);
assert.match(server, /function rubricDefaultMinFor\(/);

const prompt = fs.readFileSync(new URL("../prompts/chto-tam.md", import.meta.url), "utf8");
for (const id of auto.rubrics.map(r => r.id)) assert.ok(prompt.includes("\`" + id + "\`"), "auto prompt rubric " + id);
for (const id of shopping.rubrics.map(r => r.id)) assert.ok(prompt.includes("\`" + id + "\`"), "shopping prompt rubric " + id);
assert.match(prompt, /Для \x60shopping\x60, рекламный пост можно использовать как сырьё/);
assert.match(prompt, /В публичном тексте НЕ указывай цену, рейтинг товара, число отзывов/);
assert.match(prompt, /в \x60tg_text\x60 и \x60vk_text\x60 не должно быть ссылки на товар, ссылки на источник/);

console.log("Auto + shopping rubric tests: OK");
