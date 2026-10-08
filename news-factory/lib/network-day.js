// "Итоги дня" for the network dashboard: what every channel published on a chosen Moscow date.
// Pure functions (no I/O) so they can be tested offline.

const MSK_OFFSET_MS = 3 * 3600000;

export function isDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function moscowDayKey(ms) {
  return new Date(Number(ms) + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

function hhmm(ms) {
  const d = new Date(ms + MSK_OFFSET_MS);
  return String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0");
}

function vkFailed(h) {
  const status = String(h.vkStatus || "").toLowerCase();
  return Boolean(h.vkError) || /fail|error|media_failed/.test(status);
}

export const VK_STUCK_MS = 30 * 60000;
// What really happened to the VK copy of a published post:
// ok = confirmed on the wall, wait = Postmypost still has it queued (< 30 min), bad = failed / stuck / never sent, none = VK not used.
export function vkSlotState(h, nowMs) {
  const hasId = Boolean(h && h.vkPostId);
  if (hasId && h.vkStatus !== "pmp_failed" && !vkFailed(h)) {
    if (h.vkMode !== "postmypost_pending") return "ok";
    const age = nowMs - Date.parse(h.publishedAt);
    return age >= VK_STUCK_MS ? "bad" : "wait";
  }
  if (hasId || vkFailed(h) || Number(h && h.vkAttempts) > 0) return "bad";
  return "none";
}

// Every planned slot of the day with what happened in it. A post belongs to the latest slot that is not later than it
// (10 min tolerance); posts outside the grid get their own entry. state: ok | wait | bad | future | none (VK not used).
export function daySlots(ws, dateKey, posts, nowMs) {
  const times = Array.from(new Set((Array.isArray(ws.slots) ? ws.slots : []).filter(function(t){ return /^\d{2}:\d{2}$/.test(String(t)); }))).sort();
  const toMin = function(t){ return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)); };
  const dayStartMs = Date.parse(dateKey + "T00:00:00Z") - MSK_OFFSET_MS;
  const dueMs = function(t){ return dayStartMs + toMin(t) * 60000 + 5 * 60000; };
  const bySlot = new Map();
  const extra = [];
  for (const p of posts) {
    const m = toMin(p.time);
    let slot = null;
    for (const t of times) { if (toMin(t) <= m + 10 && !bySlot.has(t)) slot = t; }
    if (slot) bySlot.set(slot, p); else extra.push(p);
  }
  const out = [];
  for (const t of times) {
    const p = bySlot.get(t);
    const due = nowMs >= dueMs(t);
    out.push({ time: t, title: p ? p.title : "", tg: p ? (p.tg ? "ok" : "bad") : (due ? "bad" : "future"), vk: p ? (p.vkState === "none" ? "bad" : p.vkState) : (due ? "bad" : "future"), posted: Boolean(p), postTime: p ? p.time : "" });
  }
  for (const p of extra) out.push({ time: p.time, title: p.title, tg: p.tg ? "ok" : "bad", vk: p.vkState === "none" ? "bad" : p.vkState, posted: true, postTime: p.time, extra: true });
  return out.sort(function(a, b){ return a.time.localeCompare(b.time); });
}

// ws: { id, name, handle, autoPublish, mode, plannedPerDay, queue, history }
export function channelDay(ws, dateKey, nowMs) {
  nowMs = Number(nowMs) || Date.now();
  const posts = [];
  const hours = new Array(24).fill(0);
  for (const h of Array.isArray(ws.history) ? ws.history : []) {
    if (!h || !h.publishedAt || h.publicationOrigin === "test") continue;
    const t = Date.parse(h.publishedAt);
    if (!Number.isFinite(t) || moscowDayKey(t) !== dateKey) continue;
    const tg = Boolean(h.messageId) && !h.telegramUncertain;
    const vkState = vkSlotState(h, nowMs);
    const vk = vkState === "ok";
    posts.push({ ms: t, time: hhmm(t), title: String(h.title || "Публикация").slice(0, 140), source: String(h.sourceName || "").slice(0, 60), tg: tg, tgUncertain: Boolean(h.telegramUncertain), vk: vk, vkState: vkState, vkFailed: vkState === "bad", origin: String(h.publicationOrigin || "") });
    hours[new Date(t + MSK_OFFSET_MS).getUTCHours()] += 1;
  }
  posts.sort(function(a, b){ return a.ms - b.ms; });
  const slots = daySlots(ws, dateKey, posts, nowMs);
  const planned = Math.max(0, Number(ws.plannedPerDay) || 0);
  return {
    id: ws.id, name: ws.name, handle: ws.handle || "",
    autoPublish: Boolean(ws.autoPublish), paused: String(ws.mode || "").toUpperCase() === "PAUSED",
    published: posts.length, planned: planned,
    tg: posts.filter(function(p){ return p.tg; }).length,
    vk: posts.filter(function(p){ return p.vk; }).length,
    vkFailed: posts.filter(function(p){ return p.vkFailed; }).length,
    vkWait: posts.filter(function(p){ return p.vkState === "wait"; }).length,
    firstAt: posts.length ? posts[0].time : "", lastAt: posts.length ? posts[posts.length - 1].time : "",
    queue: Number(ws.queue) || 0,
    hours: hours,
    slots: slots,
    posts: posts.map(function(p){ return { time: p.time, title: p.title, source: p.source, tg: p.tg, tgUncertain: p.tgUncertain, vk: p.vk, vkState: p.vkState, vkFailed: p.vkFailed }; })
  };
}

export function networkDay(workspaces, dateKey, nowMs) {
  const rows = (workspaces || []).map(function(ws){ return channelDay(ws, dateKey, nowMs); });
  const today = moscowDayKey(nowMs || Date.now());
  return {
    date: dateKey, isToday: dateKey === today, isFuture: dateKey > today,
    totals: {
      channels: rows.length,
      published: rows.reduce(function(a, r){ return a + r.published; }, 0),
      planned: rows.reduce(function(a, r){ return a + r.planned; }, 0),
      tg: rows.reduce(function(a, r){ return a + r.tg; }, 0),
      vk: rows.reduce(function(a, r){ return a + r.vk; }, 0),
      vkFailed: rows.reduce(function(a, r){ return a + r.vkFailed; }, 0),
      vkWait: rows.reduce(function(a, r){ return a + r.vkWait; }, 0),
      silentChannels: rows.filter(function(r){ return r.published === 0; }).length
    },
    rows: rows
  };
}
