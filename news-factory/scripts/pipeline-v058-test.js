// v0.58.0: ранний шлюз ёмкости, проверка фото на подготовке слота, пауза шумных источников, добор источников Дома.
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import * as sq from "../lib/source-quality.js";
import { SOURCES_TOPUP_V058, SOURCES_V055 } from "../lib/channel-sources-v055.js";
import { RUBRIC_PLAN_V055 } from "../lib/channel-rubrics-v055.js";

const src = fs.readFileSync(fileURLToPath(new URL("../server.js", import.meta.url)), "utf8");

// P1/P2: the capacity gate runs BEFORE the article page is downloaded.
{
  const loop = src.indexOf("const earlyCapacity = capacityGateDecision(candidate, trigger);");
  const fetchAt = src.indexOf("articleHtml = await fetchText(url, 15000);", loop);
  assert.ok(loop > 0, "early capacity gate missing");
  assert.ok(fetchAt > loop, "early gate must come before the page fetch");
  assert.ok(/earlyCapacity\.allow[\s\S]{0,400}continue;/.test(src), "a deferred link must be skipped, not fetched");
  assert.ok(/capacityGateDecision\(candidate, trigger\);\s*\n\s*if \(!capacity\.allow\)/.test(src), "the later gate stays as a safety net");
  console.log("ok P1/P2 early capacity gate");
}

// P3: the slot's photo is checked at preparation, and both prepare paths use it.
{
  assert.ok(/async function refreshBestWithPhotoCheck\(/.test(src));
  const prep = src.slice(src.indexOf("async function prepareDynamicSlot()"), src.indexOf("async function prepareBloggerSlot("));
  assert.equal((prep.match(/refreshBestWithPhotoCheck\(day, time\)/g) || []).length, 2, "both prepare paths must check the photo");
  assert.ok(!/dynamicRefreshBest\(day, time\)/.test(prep), "no unchecked pick left in prepareDynamicSlot");
  const fn = src.slice(src.indexOf("async function refreshBestWithPhotoCheck("), src.indexOf("async function prepareDynamicSlot()"));
  assert.ok(/refreshed\.manual/.test(fn), "a hand-picked post must not be touched");
  assert.ok(/error\.code === "NO_PHOTO"/.test(fn), "only NO_PHOTO is handled here");
  assert.ok(/item\.status = "publish_failed"/.test(fn), "a photo-less post must leave the queue pool");
  assert.ok(/SLOT_PHOTO_PRECHECK_ENABLED/.test(fn), "kill switch");
  console.log("ok P3 photo precheck");
}

// P4: a mostly-noise source is paused even without a 10-in-a-row streak; improved or small-sample sources are not.
{
  const source = { enabled: true };
  const noisy = { junk: 60, useful: 6, published: 2, recent: ["junk","junk","ok","junk","junk","junk","junk","junk","junk","junk"] };
  assert.ok(/почти всё отсеяно/.test(sq.autoPauseReason(source, noisy, 10)), "noisy source is paused");
  assert.equal(sq.autoPauseReason(source, noisy, 4), "", "group minimum is kept");
  assert.equal(sq.autoPauseReason(source, Object.assign({}, noisy, { junk: 20, useful: 2, published: 1 }), 10), "", "small sample is left alone");
  assert.equal(sq.autoPauseReason(source, Object.assign({}, noisy, { recent: ["ok","ok","ok","junk","ok","ok","junk","ok","ok","ok"] }), 10), "", "an improved source is left alone");
  assert.equal(sq.autoPauseReason(source, { junk: 40, useful: 40, published: 10, recent: new Array(10).fill("junk") }, 10).includes("подряд"), true, "streak rule still works");
  assert.equal(sq.autoPauseReason(source, { junk: 30, useful: 20, published: 5, recent: ["junk","ok","junk","ok","junk","ok","junk","ok","junk","ok"] }, 10), "", "a mixed source (55% junk) is not paused");
  assert.equal(sq.autoPauseReason(source, { junk: 170, useful: 15, published: 15, recent: ["junk","junk","junk","junk","ok","junk","junk","junk","junk","junk"] }, 10), "", "a productive noisy source (15 published) is left alone");
  // never below a rubric's minimum, and the photo dry run renders no card
  assert.ok(/\^сайт не открывается[\s\S]{0,700}rubricMinFor\(id\)/.test(src), "junk-share pause must respect the rubric minimum");
  assert.ok(/__photoPrecheck: true/.test(src) && /dryRun \? Promise\.resolve/.test(src), "photo precheck must be a dry run");
  assert.equal((src.match(/await renderCard\(/g) || []).length, 2, "both card renders go through the dry-run switch");
  console.log("ok P4 junk share rule");
}

// P5: the top-up list uses real home rubric ids, no duplicates with the main list, and is wired into the loader once.
{
  const homeIds = new Set(RUBRIC_PLAN_V055.home ? RUBRIC_PLAN_V055.home.rubrics.map(function(r){ return r.rubric.id; }) : []);
  assert.ok(homeIds.has("home_appliances") && homeIds.has("interior_trends"));
  const known = new Set((SOURCES_V055.home || []).map(function(x){ return x.url; }));
  const seen = new Set();
  for (const c of SOURCES_TOPUP_V058.home) {
    assert.ok(c.rubrics.every(function(id){ return homeIds.has(id); }), c.name + ": unknown rubric");
    assert.ok(/^https:\/\//.test(c.url), c.name + ": https only");
    assert.ok(!known.has(c.url), c.name + ": already in the main list");
    assert.ok(!seen.has(c.url), c.name + ": duplicate");
    seen.add(c.url);
  }
  const ids = new Set(SOURCES_TOPUP_V058.home.flatMap(function(c){ return c.rubrics; }));
  assert.ok(ids.has("home_appliances") && ids.has("interior_trends"), "both weak rubrics are covered");
  assert.ok(/SOURCES_TOPUP_MARKER_V058 = "v0\.58\.0-rubric-topup"/.test(src));
  assert.ok(/ws\.state\.migrations\.includes\(load\.marker\)/.test(src), "loader is idempotent per marker");
  assert.ok(/marker === SOURCES_TOPUP_MARKER_V058[\s\S]{0,400}have\.has\(sourceKey/.test(src), "top-up must skip sources the channel already has");
  console.log("ok P5 home top-up");
}
console.log("pipeline-v058 tests passed");
