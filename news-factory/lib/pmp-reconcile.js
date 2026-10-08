// Postmypost publications that were still "in the queue" when we stopped waiting (status 5/2) are remembered here and
// re-checked later, so a post that never reaches VK is seen instead of silently counted as published.
export const PMP_PENDING_CAP = 80;
export const PMP_STUCK_MS = 30 * 60000;      // still not published after 30 min -> alert
export const PMP_FAILED_KEEP_MS = 6 * 3600000; // a failed post stays visible (and alerting) for 6 h
export const PMP_GIVE_UP_MS = 48 * 3600000;  // stop checking after 2 days

export function recordPending(state, entry, nowMs) {
  const list = Array.isArray(state.pmpPending) ? state.pmpPending : [];
  if (!entry || !entry.id || list.some(function(x){ return x && String(x.id) === String(entry.id); })) { state.pmpPending = list; return false; }
  list.push({ id: Number(entry.id), slug: String(entry.slug || ""), postId: String(entry.postId || ""), at: new Date(nowMs).toISOString(), status: Number(entry.status) || 5 });
  state.pmpPending = list.slice(-PMP_PENDING_CAP);
  return true;
}

// pubStatus: Postmypost publication_status (1 published, 3 error, 0 deleted, 2 publishing, 5 pending) or null if unknown.
export function classify(entry, pubStatus, nowMs) {
  const age = nowMs - Date.parse(entry.at);
  if (pubStatus === 1) return "published";
  if (pubStatus === 3 || pubStatus === 0) return "failed";
  if (age >= PMP_GIVE_UP_MS) return "expired";
  return age >= PMP_STUCK_MS ? "stuck" : "waiting";
}

export function summarize(entries, nowMs) {
  const out = { waiting: 0, stuck: 0, failed: 0, oldestMin: 0, examples: [] };
  for (const e of entries || []) {
    if (!e) continue;
    const age = Math.round((nowMs - Date.parse(e.at)) / 60000);
    if (e.failedAt) out.failed += 1;
    else if (age * 60000 >= PMP_STUCK_MS) out.stuck += 1;
    else out.waiting += 1;
    if (!e.failedAt && age > out.oldestMin) out.oldestMin = age;
    if ((e.failedAt || age * 60000 >= PMP_STUCK_MS) && out.examples.length < 3) out.examples.push(e.slug || String(e.id));
  }
  return out;
}

// Applies fetched statuses (Map id -> status|null) to a list; returns { keep, published, failed, expired }.
export function applyStatuses(entries, statuses, nowMs) {
  const keep = [], published = [], failed = [], expired = [];
  for (const e of entries || []) {
    if (!e) continue;
    if (e.failedAt) { if (nowMs - Date.parse(e.failedAt) < PMP_FAILED_KEEP_MS) keep.push(e); continue; }
    const st = statuses.has(e.id) ? statuses.get(e.id) : null;
    const verdict = classify(e, st, nowMs);
    if (verdict === "published") published.push(e);
    else if (verdict === "failed") { e.failedAt = new Date(nowMs).toISOString(); e.status = st; failed.push(e); keep.push(e); }
    else if (verdict === "expired") expired.push(e);
    else { if (st != null) e.status = st; keep.push(e); }
  }
  return { keep: keep, published: published, failed: failed, expired: expired };
}
