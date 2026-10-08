// v0.70.0: skip a channel's hourly news collection when its queue already holds enough ready posts (saves LLM calls).
// Collection stays mandatory when the queue is thin or the last real collection is older than maxStaleMs, so fresh news
// is never held back for more than about two hours. 0 disables the skip.
export const COLLECT_SKIP_MIN_QUEUE_DEFAULT = 6;
export const COLLECT_SKIP_MAX_STALE_MIN_DEFAULT = 100;

export function collectSkipDecision(input) {
  const i = input || {};
  const minDepth = Math.max(0, Math.floor(Number(i.minDepth) || 0));
  if (!minDepth) return { skip: false, reason: "disabled" };
  const depth = Math.max(0, Number(i.depth) || 0);
  if (depth < minDepth) return { skip: false, reason: "queue_thin" };
  const last = Number(i.lastCollectAtMs);
  const now = Number(i.nowMs);
  const maxStale = Number(i.maxStaleMs);
  if (!Number.isFinite(last) || last <= 0 || !Number.isFinite(now)) return { skip: false, reason: "never_collected" };
  if (!Number.isFinite(maxStale) || maxStale <= 0) return { skip: false, reason: "bad_max_stale" };
  if (last > now) return { skip: false, reason: "clock_skew" };
  if (now - last >= maxStale) return { skip: false, reason: "stale" };
  return { skip: true, reason: "queue_ready" };
}
