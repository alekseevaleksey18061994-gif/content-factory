// Audience learning, digests and the owner's daily report: pure helpers.

export function moscowParts(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const msk = new Date(d.getTime() + 3 * 3600000);
  return {
    day: msk.toISOString().slice(0, 10),
    hour: msk.getUTCHours(),
    minute: msk.getUTCMinutes(),
    weekday: msk.getUTCDay(),
    hhmm: String(msk.getUTCHours()).padStart(2, "0") + ":" + String(msk.getUTCMinutes()).padStart(2, "0")
  };
}

export function historyFormat(h) {
  const v2 = h && h.editorialV2 || {};
  return String(v2.format || (h && (h.contentFormatLabel || h.contentFormat)) || "").trim();
}

export function historyHook(h) {
  const v2 = h && h.editorialV2 || {};
  return String(v2.hookType || "").trim();
}

// Weights around 1.0 from learning buckets ({performance -10..10, samples}).
export function bucketWeights(map, minSamples) {
  const out = {};
  for (const [key, bucket] of Object.entries(map || {})) {
    if (!key || !bucket || Number(bucket.samples || 0) < (minSamples || 3)) continue;
    const perf = Number(bucket.performance || 0);
    if (!Number.isFinite(perf)) continue;
    out[key] = Math.round(Math.max(0.5, Math.min(1.5, 1 + perf / 16)) * 100) / 100;
  }
  return Object.keys(out).length ? out : null;
}

// Best and worst publication hours (Moscow) by performance, for the writer and the report.
export function bestHours(byHour, minSamples) {
  const rows = Object.entries(byHour || {})
    .filter(function(e){ return e[1] && Number(e[1].samples || 0) >= (minSamples || 3); })
    .map(function(e){ return { hour: Number(e[0]), performance: Number(e[1].performance || 0), samples: Number(e[1].samples || 0) }; })
    .sort(function(a, b){ return b.performance - a.performance; });
  return rows;
}

export function isDigestHistory(h) {
  return Boolean(h && (h.isDigest || (h.editorialV2 && h.editorialV2.format === "Дайджест")));
}

// Posts for a digest. evening: today's posts (Moscow day); sunday: last 7 days,
// best by audience performance first.
export function pickDigestPosts(history, kind, now) {
  const nowDate = now instanceof Date ? now : new Date(now || Date.now());
  const today = moscowParts(nowDate).day;
  const weekAgo = nowDate.getTime() - 7 * 24 * 3600000;
  const posts = (history || []).filter(function(h) {
    if (!h || !h.publishedAt || isDigestHistory(h)) return false;
    if (kind === "sunday") return new Date(h.publishedAt).getTime() >= weekAgo;
    return moscowParts(h.publishedAt).day === today;
  });
  if (kind === "sunday") {
    posts.sort(function(a, b){ return Number(b.performanceScore || 0) - Number(a.performanceScore || 0) || Number(b.views || 0) - Number(a.views || 0); });
    return posts.slice(0, 10);
  }
  return posts.slice(0, 12);
}

function n(v) { return Math.round(Number(v || 0)).toLocaleString("ru-RU"); }

// data: { date, channels: [{ name, published, digest, queueReady, queueReserve,
//   filtered: { prefilter, editorial, duplicate, autoRejected }, topReasons: [..],
//   best: { title, views, url }, sourcesPaused: [..], sourcesAdded: [..], problems: [..] }],
//   spendRub, spendUsd, budgetRub }
export function buildDailyReportText(data) {
  const d = data || {};
  const lines = ["📊 News Factory — итоги дня " + (d.date || "")];
  // Spend goes first so it is never cut off by the Telegram length limit.
  if (d.spendRub != null || d.spendUsd != null) {
    lines.push("💸 Расходы на нейросети за сегодня: " + (d.spendRub != null ? n(d.spendRub) + " ₽" : "$" + Number(d.spendUsd || 0).toFixed(2)) + (d.budgetRub ? " из " + n(d.budgetRub) + " ₽ дневного бюджета" : ""));
  }
  for (const ch of (d.channels || [])) {
    lines.push("");
    lines.push("📣 " + ch.name);
    lines.push("Вышло постов: " + n(ch.published) + (ch.digest ? " + дайджест" : "") + " · в очереди: " + n(ch.queueReady) + (ch.queueReserve ? " (+" + n(ch.queueReserve) + " запасных)" : ""));
    const f = ch.filtered || {};
    const filteredTotal = Number(f.prefilter || 0) + Number(f.editorial || 0) + Number(f.duplicate || 0) + Number(f.autoRejected || 0);
    if (filteredTotal) {
      lines.push("Отсеяно: " + n(filteredTotal) + " — по заголовку " + n(f.prefilter) + ", редакцией " + n(f.editorial) + ", дубли " + n(f.duplicate) + (f.autoRejected ? ", не прошли проверку " + n(f.autoRejected) : ""));
    }
    if (ch.topReasons && ch.topReasons.length) lines.push("Частые причины: " + ch.topReasons.slice(0, 3).join("; "));
    if (ch.best && ch.best.title) lines.push("🏆 Лучший пост: «" + String(ch.best.title).slice(0, 90) + "»" + (ch.best.views ? " — " + n(ch.best.views) + " просмотров" : ""));
    if (ch.sourcesPaused && ch.sourcesPaused.length) lines.push("⏸ Отключены источники: " + ch.sourcesPaused.slice(0, 5).join(", "));
    if (ch.sourcesAdded && ch.sourcesAdded.length) lines.push("➕ Добавлены источники: " + ch.sourcesAdded.slice(0, 5).join(", "));
    for (const p of (ch.problems || []).slice(0, 3)) lines.push("⚠️ " + p);
  }
  const LIMIT = 3900;
  let out = "";
  for (const line of lines) {
    if ((out + "\n" + line).length > LIMIT - 40) { out += "\n…остальное не поместилось, полный отчёт — в админке"; break; }
    out += (out ? "\n" : "") + line;
  }
  return out;
}

// Top reasons from a list of reason strings, most frequent first.
export function topReasons(reasons, limit) {
  const counts = new Map();
  for (const r of (reasons || [])) {
    const key = String(r || "").replace(/^Пропущено редакцией:\s*/i, "").trim().toLowerCase().slice(0, 60);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries()).sort(function(a, b){ return b[1] - a[1]; }).slice(0, limit || 3).map(function(e){ return e[0] + " (" + e[1] + ")"; });
}
