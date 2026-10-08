import assert from "node:assert/strict";
import { recordPending, classify, applyStatuses, summarize, PMP_STUCK_MS } from "../lib/pmp-reconcile.js";
import { vkSlotState, channelDay } from "../lib/network-day.js";
import { evaluateHealth } from "../lib/health-alerts.js";
const now = Date.parse("2026-10-08T10:00:00Z");
try {
  const st = {};
  assert.equal(recordPending(st, { id: 1, slug: "a" }, now - 40 * 60000), true);
  assert.equal(recordPending(st, { id: 1, slug: "a" }, now), false, "no duplicates");
  recordPending(st, { id: 2, slug: "b" }, now - 5 * 60000);
  recordPending(st, { id: 3, slug: "c" }, now - 50 * 60000);
  console.log("ok - P1 record + dedupe");
  assert.equal(classify(st.pmpPending[0], 1, now), "published");
  assert.equal(classify(st.pmpPending[0], 3, now), "failed");
  assert.equal(classify(st.pmpPending[0], 5, now), "stuck");
  assert.equal(classify(st.pmpPending[1], 5, now), "waiting");
  assert.equal(classify(st.pmpPending[0], null, now), "stuck", "unknown status stays pending, never 'published'");
  console.log("ok - P2 classify");
  const r = applyStatuses(st.pmpPending, new Map([[1, 1], [3, 3]]), now);
  assert.equal(r.published.length, 1); assert.equal(r.failed.length, 1);
  assert.deepEqual(r.keep.map(function(x){ return x.id; }).sort(), [2, 3]);
  console.log("ok - P3 apply");
  const sum = summarize(r.keep, now);
  assert.equal(sum.failed, 1); assert.equal(sum.waiting, 1); assert.equal(sum.stuck, 0);
  const sum2 = summarize([{ id: 9, slug: "x", at: new Date(now - PMP_STUCK_MS - 60000).toISOString() }], now);
  assert.equal(sum2.stuck, 1);
  console.log("ok - P4 summarize");
  const snap = { nowMs: now, channels: [], pmpPending: sum };
  let h = evaluateHealth(snap, {});
  assert.equal(h.send.length, 0, "needs 2 ticks");
  h = evaluateHealth(snap, h.next);
  assert.equal(h.send.length, 1); assert.match(h.send[0].text, /Посты в VK не вышли/);
  const ok = evaluateHealth({ nowMs: now, channels: [], pmpPending: { stuck: 0, failed: 0 } }, h.next);
  assert.equal(ok.recovered.length, 1);
  console.log("ok - P5 health alert + recovery");
  const t0 = new Date(now - 10 * 60000).toISOString(), t1 = new Date(now - 90 * 60000).toISOString();
  assert.equal(vkSlotState({ vkPostId: "pmp-1", publishedAt: t1 }, now), "ok", "legacy confirmed/unknown mode stays ok");
  assert.equal(vkSlotState({ vkPostId: "pmp-1", vkMode: "postmypost", publishedAt: t1 }, now), "ok");
  assert.equal(vkSlotState({ vkPostId: "pmp-1", vkMode: "postmypost_pending", publishedAt: t0 }, now), "wait");
  assert.equal(vkSlotState({ vkPostId: "pmp-1", vkMode: "postmypost_pending", publishedAt: t1 }, now), "bad", "queued > 30 min is red");
  assert.equal(vkSlotState({ vkPostId: "pmp-1", vkStatus: "pmp_failed", vkError: "x", publishedAt: t0 }, now), "bad");
  assert.equal(vkSlotState({ vkStatus: "failed", vkError: "boom", publishedAt: t0 }, now), "bad");
  assert.equal(vkSlotState({ publishedAt: t0 }, now), "none");
  console.log("ok - P6 vkSlotState");
  const hist = [
    { publishedAt: "2026-10-08T06:03:00Z", messageId: 1, vkPostId: "pmp-1", title: "A" },
    { publishedAt: "2026-10-08T07:04:00Z", messageId: 2, vkError: "boom", title: "B" }
  ];
  const day = channelDay({ id: "x", name: "X", history: hist, slots: ["09:00", "10:00", "11:00", "12:00", "20:00"] }, "2026-10-08", Date.parse("2026-10-08T09:50:00Z"));
  assert.equal(day.slots.length, 5, "all slots listed");
  assert.deepEqual(day.slots.map(function(x){ return x.vk; }), ["ok", "bad", "bad", "bad", "future"], "ok, failed, 2 missed (due), 1 future");
  assert.deepEqual(day.slots.map(function(x){ return x.tg; }), ["ok", "ok", "bad", "bad", "future"]);
  console.log("ok - P7 every planned slot of the day is listed");
  let h2 = evaluateHealth({ nowMs: now, channels: [], tgMissed: { count: 1, channels: ["Спорт (1)"] } }, {});
  h2 = evaluateHealth({ nowMs: now, channels: [], tgMissed: { count: 1, channels: ["Спорт (1)"] } }, h2.next);
  assert.equal(h2.send.length, 1); assert.match(h2.send[0].text, /В Telegram не дошло/);
  console.log("ok - P8 Telegram missed alert");
  console.log("pmp-reconcile tests passed");
} catch (e) { console.error(e); process.exit(1); }
