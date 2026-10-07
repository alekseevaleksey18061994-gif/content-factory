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

// ws: { id, name, handle, autoPublish, mode, plannedPerDay, queue, history }
export function channelDay(ws, dateKey) {
  const posts = [];
  const hours = new Array(24).fill(0);
  for (const h of Array.isArray(ws.history) ? ws.history : []) {
    if (!h || !h.publishedAt || h.publicationOrigin === "test") continue;
    const t = Date.parse(h.publishedAt);
    if (!Number.isFinite(t) || moscowDayKey(t) !== dateKey) continue;
    const tg = Boolean(h.messageId) && !h.telegramUncertain;
    const vk = Boolean(h.vkPostId);
    posts.push({ ms: t, time: hhmm(t), title: String(h.title || "Публикация").slice(0, 140), source: String(h.sourceName || "").slice(0, 60), tg: tg, tgUncertain: Boolean(h.telegramUncertain), vk: vk, vkFailed: !vk && vkFailed(h), origin: String(h.publicationOrigin || "") });
    hours[new Date(t + MSK_OFFSET_MS).getUTCHours()] += 1;
  }
  posts.sort(function(a, b){ return a.ms - b.ms; });
  const planned = Math.max(0, Number(ws.plannedPerDay) || 0);
  return {
    id: ws.id, name: ws.name, handle: ws.handle || "",
    autoPublish: Boolean(ws.autoPublish), paused: String(ws.mode || "").toUpperCase() === "PAUSED",
    published: posts.length, planned: planned,
    tg: posts.filter(function(p){ return p.tg; }).length,
    vk: posts.filter(function(p){ return p.vk; }).length,
    vkFailed: posts.filter(function(p){ return p.vkFailed; }).length,
    firstAt: posts.length ? posts[0].time : "", lastAt: posts.length ? posts[posts.length - 1].time : "",
    queue: Number(ws.queue) || 0,
    hours: hours,
    posts: posts.map(function(p){ return { time: p.time, title: p.title, source: p.source, tg: p.tg, tgUncertain: p.tgUncertain, vk: p.vk, vkFailed: p.vkFailed }; })
  };
}

export function networkDay(workspaces, dateKey, nowMs) {
  const rows = (workspaces || []).map(function(ws){ return channelDay(ws, dateKey); });
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
      silentChannels: rows.filter(function(r){ return r.published === 0; }).length
    },
    rows: rows
  };
}
