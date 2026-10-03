import assert from "node:assert/strict";
import { cardSafeText, wrapCardLines } from "../lib/card-text.js";
import { calculateUsageCost, resolveModelRate, BUILTIN_COST_PRICING } from "../lib/costs.js";

let n = 0;
function t(name, fn) { fn(); n++; console.log("ok", name); }

// --- card text
t("K1 strips emoji/CJK/Hangul/controls, keeps Cyrillic/Latin/digits/punct", () => {
  assert.equal(cardSafeText("🚀 Рост 5% 中文 한국어 test​ — «ok»!"), "Рост 5% test — «ok»!");
});
t("K2 no line exceeds the limit, long words are split", () => {
  const lines = wrapCardLines("Электроэнергетическаясуперкорпорацияроссии получила", 26, 4);
  assert.ok(lines.length >= 2);
  for (const l of lines) assert.ok(Array.from(l).length <= 26, l);
  assert.ok(lines[0].endsWith("-"));
});
t("K3 overflow ends with an ellipsis and stays within 4 lines", () => {
  const lines = wrapCardLines("один два три четыре пять шесть семь восемь девять десять одиннадцать двенадцать тринадцать четырнадцать пятнадцать", 26, 4);
  assert.equal(lines.length, 4);
  assert.ok(lines[3].endsWith("…"));
  for (const l of lines) assert.ok(Array.from(l).length <= 26, l);
});
t("K4 short text untouched, empty gives []", () => {
  assert.deepEqual(wrapCardLines("Короткий заголовок", 26, 4), ["Короткий заголовок"]);
  assert.deepEqual(wrapCardLines("", 26, 4), []);
});
t("K5 exactly-fitting text gets no ellipsis", () => {
  const lines = wrapCardLines("aaaa bbbb cccc dddd", 9, 2);
  assert.deepEqual(lines, ["aaaa bbbb", "cccc dddd"]);
});

// --- pricing
const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000 };
t("P1 exact ids unchanged", () => {
  const r = calculateUsageCost("anthropic", "claude-sonnet-5-5", usage, "messages");
  assert.equal(r.costUsd, 12); assert.equal(r.pricingKnown, true); assert.equal(r.estimated, false);
});
t("P2 dated anthropic id uses base price and counts as known", () => {
  const r = calculateUsageCost("anthropic", "claude-opus-5-5-20261001", usage, "messages");
  assert.equal(r.costUsd, 24); assert.equal(r.pricingKnown, true); assert.equal(r.estimated, false);
});
t("P3 unknown anthropic model is never $0 — family top rate, estimated", () => {
  const r = calculateUsageCost("anthropic", "claude-sonnet-6", usage, "messages");
  assert.equal(r.costUsd, 12); assert.equal(r.pricingKnown, false); assert.equal(r.estimated, true);
  const r2 = calculateUsageCost("anthropic", "claude-mystery", usage, "messages");
  assert.equal(r2.costUsd, 24); assert.equal(r2.estimated, true);
});
t("P4 unknown openai text model priced at the most expensive text rate", () => {
  const r = calculateUsageCost("openai", "gpt-7", usage, "responses");
  assert.equal(r.costUsd, 1.4); assert.equal(r.pricingKnown, false); assert.equal(r.estimated, true);
  const d = calculateUsageCost("openai", "gpt-6-luna-2026-09-01", usage, "responses");
  assert.equal(d.costUsd, 0.6); assert.equal(d.pricingKnown, true);
});
t("P5 unknown image model is priced (estimated), not $0", () => {
  const r = calculateUsageCost("openai", "gpt-image-3", { input_tokens: 0, output_tokens: 1_000_000 }, "images");
  assert.equal(r.costUsd, 30); assert.equal(r.estimated, true); assert.equal(r.pricingKnown, false);
});
t("P6 a suffix that is not a date/version does not borrow a cheaper base", () => {
  const res = resolveModelRate(BUILTIN_COST_PRICING.anthropic, "claude-haiku-4-5-pro");
  assert.equal(res.known, false);
});
t("P7 empty tables / missing model are safe", () => {
  assert.equal(resolveModelRate({}, "x").rate, null);
  const r = calculateUsageCost("anthropic", "", usage, "messages");
  assert.ok(r.costUsd > 0 && r.estimated);
  const z = calculateUsageCost("unknown", "x", usage, "x");
  assert.equal(z.costUsd, 0); assert.equal(z.pricingKnown, false);
});
console.log(`cards-pricing: ${n} passed`);
