// Offline tests for the network "Итоги дня" summary. Run: npm run test:network-day
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { isDateKey, moscowDayKey, channelDay, networkDay } from "../lib/network-day.js";
let n = 0; const ok = (m) => { n++; console.log("ok - " + m); };
const at = (day, h, m = 0) => new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), h - 3, m)).toISOString(); // Moscow time

assert.equal(isDateKey("2026-10-08"), true); assert.equal(isDateKey("2026-02-30"), false); assert.equal(isDateKey("08.10.2026"), false); assert.equal(isDateKey("2026-10-8"), false); assert.equal(isDateKey(""), false);
ok("date validation accepts only real YYYY-MM-DD");
assert.equal(moscowDayKey(Date.parse("2026-10-07T21:30:00Z")), "2026-10-08"); ok("21:30 UTC is already the next Moscow day");

const ws = { id: "a", name: "Канал А", plannedPerDay: 8, autoPublish: true, mode: "AUTO", queue: 3, history: [
  { title: "Утро", publishedAt: at("2026-10-08", 9, 5), messageId: 11, vkPostId: 5, sourceName: "S1" },
  { title: "День", publishedAt: at("2026-10-08", 14, 40), messageId: 12, vkStatus: "failed", vkError: "x" },
  { title: "Поздно", publishedAt: at("2026-10-08", 23, 59), messageId: 13 },
  { title: "Вчера", publishedAt: at("2026-10-07", 23, 59), messageId: 10 },
  { title: "Полночь", publishedAt: at("2026-10-09", 0, 0), messageId: 14 },
  { title: "Тест", publishedAt: at("2026-10-08", 10, 0), publicationOrigin: "test", messageId: 1 },
  { title: "Неясно", publishedAt: at("2026-10-08", 12, 0), messageId: 15, telegramUncertain: true },
  { title: "Битая дата", publishedAt: "not-a-date" }, null
] };
const r = channelDay(ws, "2026-10-08");
assert.equal(r.published, 4); ok("only posts of the chosen Moscow day count (edges 23:59 / 00:00, tests and bad dates ignored)");
assert.deepEqual(r.posts.map((p) => p.time), ["09:05", "12:00", "14:40", "23:59"]); ok("posts are sorted by time");
assert.equal(r.firstAt, "09:05"); assert.equal(r.lastAt, "23:59"); ok("first/last time");
assert.equal(r.tg, 3); assert.equal(r.vk, 1); assert.equal(r.vkFailed, 1); ok("Telegram / VK / VK-failed counters (uncertain TG is not counted as sent)");
assert.equal(r.hours[9], 1); assert.equal(r.hours[23], 1); assert.equal(r.hours.reduce((a, b) => a + b, 0), 4); ok("hourly buckets");
const empty = channelDay({ id: "b", name: "Б", plannedPerDay: 8, history: [] }, "2026-10-08");
assert.equal(empty.published, 0); assert.equal(empty.firstAt, ""); ok("empty day");

const day = networkDay([ws, { id: "b", name: "Б", plannedPerDay: 8, history: [] }], "2026-10-08", Date.parse("2026-10-08T12:00:00Z"));
assert.equal(day.isToday, true); assert.equal(day.totals.published, 4); assert.equal(day.totals.planned, 16); assert.equal(day.totals.silentChannels, 1); assert.equal(day.totals.vkFailed, 1); ok("network totals");
assert.equal(networkDay([], "2026-10-09", Date.parse("2026-10-08T12:00:00Z")).isFuture, true); ok("future date flagged");

// admin.html: every inline <script> parses, and the date controls are wired to existing helpers
const html = fs.readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
assert.ok(scripts.length > 0);
for (const code of scripts) new vm.Script(code);
ok("admin.html inline scripts parse");
for (const id of ["networkDayInput", "networkDayRows", "networkDayTotals", "networkDayNote"]) assert.ok(html.includes('id="' + id + '"'), id);
for (const fn of ["netDayShift", "netDaySet", "netDayToday", "netDayLoad", "renderNetworkDay", "addCalendarDays", "prettyCalendarDate", "moscowDateKey"]) assert.ok(new RegExp("function " + fn + "\\b").test(html), fn);
ok("date controls and helpers exist");
console.log(n + " passed");
