// Removal of dead sources (v0.66.0). "Dead" = switched off (paused by the system or by the editor). A channel keeps only
// live sources; sources outside every theme group are not needed either. Removed sources are blocked from coming back.

export const REMOVED_LOG_LIMIT = 600;
export const DEAD_GRACE_MS = 24 * 3600000; // an auto-paused source gets a day before the automatic sweep removes it

function themeIdsOf(source) {
  const ids = [];
  if (source && source.rubric) ids.push(String(source.rubric));
  if (source && Array.isArray(source.rubrics)) for (const id of source.rubrics) ids.push(String(id));
  return ids;
}
export function inAnyGroup(source, groupIds) {
  return themeIdsOf(source).some(function(id){ return groupIds.has(id); });
}

// One-time clean-up the editor asked for: every switched-off source. Enabled sources outside the theme groups are live
// (added by hand, Telegram/lane sources, untagged legacy ones): they are reported (looseKept) and only removed with includeEnabledLoose.
// opts: { groupIds: Set<string>, includeEnabledLoose: boolean }
export function planSourceCleanup(sources, opts) {
  const o = opts || {};
  const groupIds = o.groupIds instanceof Set ? o.groupIds : new Set(o.groupIds || []);
  const dead = [], looseEnabled = [], looseKept = [], keep = [];
  for (const s of (Array.isArray(sources) ? sources : [])) {
    if (!s) continue;
    const off = !s.enabled;
    const loose = groupIds.size > 0 && !inAnyGroup(s, groupIds);
    if (off) dead.push({ id: s.id, name: s.name, url: s.url, why: s.autoPaused ? "пауза системы: " + String(s.autoPaused.reason || "").slice(0, 120) : "выключен вручную" + (loose ? ", вне групп" : "") });
    else if (loose) {
      if (o.includeEnabledLoose) looseEnabled.push({ id: s.id, name: s.name, url: s.url, why: "включён, но вне групп тем" });
      else { looseKept.push({ id: s.id, name: s.name, url: s.url }); keep.push(s); }
    } else keep.push(s);
  }
  return { dead, looseEnabled, looseKept, remove: dead.concat(looseEnabled), keepCount: keep.length };
}

// Ongoing sweep: a source the system paused for junk/errors and nobody switched back on within the grace period.
export function sweepCandidates(sources, nowMs, graceMs) {
  const grace = Number.isFinite(graceMs) ? graceMs : DEAD_GRACE_MS;
  const out = [];
  for (const s of (Array.isArray(sources) ? sources : [])) {
    if (!s || s.enabled || !s.autoPaused) continue;
    const at = Date.parse(s.autoPaused.at || "");
    if (!Number.isFinite(at) || nowMs - at < grace) continue;
    if (s.editorEnabledAt && nowMs - Date.parse(s.editorEnabledAt) < 14 * 86400000) continue;
    out.push({ id: s.id, name: s.name, url: s.url, why: "пауза системы: " + String(s.autoPaused.reason || "").slice(0, 120) });
  }
  return out;
}

// Applies a removal to a state object: drops the sources, blocks their keys, records what was removed.
// keyFns: [sourceKey, legacySourceKey]
export function applySourceRemoval(state, removals, keyFns, nowIso, why) {
  const ids = new Set(removals.map(function(r){ return r.id; }));
  const before = (state.sources || []).length;
  const byId = new Map((state.sources || []).filter(Boolean).map(function(s){ return [s.id, s]; }));
  state.sources = (state.sources || []).filter(function(s){ return !(s && ids.has(s.id)); });
  const blocked = Array.isArray(state.sourceBlockedHosts) ? state.sourceBlockedHosts : [];
  const have = new Set(blocked.map(function(x){ return String(x || "").toLowerCase(); }));
  for (const r of removals) {
    for (const fn of keyFns) {
      const k = String(fn(r.url) || "").toLowerCase();
      if (k && !have.has(k)) { have.add(k); blocked.push(k); }
    }
  }
  state.sourceBlockedHosts = blocked;
  const log = Array.isArray(state.removedSources) ? state.removedSources : [];
  for (const r of removals) {
    const s = byId.get(r.id) || {};
    log.push({ at: nowIso, name: r.name, url: r.url, rubric: s.rubric || "", rubrics: Array.isArray(s.rubrics) ? s.rubrics : undefined, why: why + (r.why ? ": " + r.why : "") });
  }
  state.removedSources = log.slice(-REMOVED_LOG_LIMIT);
  return before - state.sources.length;
}
