// v0.59.0: защита минимума рубрики для всех правил автопаузы; wall.get 27 не спамит лог каждый час.
import assert from "node:assert/strict";
import { readServerSource } from "./server-source.js";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import * as sq from "../lib/source-quality.js";

const src = readServerSource();

// G1: every quality reason is guarded by the rubric minimum; only a dead site is paused regardless.
{
  const fn = src.slice(src.indexOf("function autoPauseWeakSources()"), src.indexOf("// Theme channels: a source that gives its theme"));
  assert.ok(/if \(!\/\^сайт не открывается\/\.test\(reason\)\) \{[\s\S]{0,700}rubricMinFor\(id\); \}\)\) continue;/.test(fn), "guard must cover all reasons except a dead site");
  const source = { enabled: true };
  const reasons = [
    sq.autoPauseReason(source, { recent: new Array(10).fill("junk"), junk: 10 }, 10),
    sq.autoPauseReason(source, { policyStreak: 30 }, 10),
    sq.autoPauseReason({ enabled: true, probationUntil: new Date(Date.now() - 1000).toISOString() }, { useful: 0, published: 0, selected: 0 }, 10),
    sq.autoPauseReason(source, { errorStreak: 99 }, 10)
  ];
  assert.ok(/подряд отсеяны/.test(reasons[0]) && /нечем подтвердить/.test(reasons[1]) && /пробный срок/.test(reasons[2]) && /^сайт не открывается/.test(reasons[3]), "reason texts the guard relies on");
  console.log("ok G1 rubric minimum guard");
}

// G2: wall.get error 27 is handled once a day and kept out of the error log.
{
  assert.ok(/let vkWallGetBlockedUntil = 0;/.test(src));
  assert.ok(/quietCodes: \[27\]/.test(src) && /opts\.quietCodes/.test(src), "vkApi supports quiet codes");
  const fn = src.slice(src.indexOf("async function fetchVkAnalytics()"), src.indexOf("const statusCache = new Map();"));
  assert.ok(/Date\.now\(\) >= vkWallGetBlockedUntil/.test(fn) && /vkWallGetBlockedUntil = Date\.now\(\) \+ 24 \* 3600 \* 1000/.test(fn), "24h back-off");
  assert.ok(/String\(wallError && wallError\.vkErrorCode\) !== "27"\) throw wallError/.test(fn), "other errors still surface");
  console.log("ok G2 wall.get back-off");
}
