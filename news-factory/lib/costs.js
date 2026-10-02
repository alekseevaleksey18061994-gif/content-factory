export const COST_STATE_MIGRATION_ID = "v0.34.2-cost-events-postgres";

function num(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function normalizeLegacyCostRow(event, workspaceId) {
  const e = event && typeof event === "object" ? event : {};
  const extra = e.extra && typeof e.extra === "object" ? e.extra : {};
  const id = String(e.id || "").trim();
  if (!id) return null;
  const at = new Date(e.at || 0);
  if (!Number.isFinite(at.getTime())) return null;
  return {
    id: id,
    at: at.toISOString(),
    workspaceId: String(e.workspaceId || workspaceId || "ai-main"),
    provider: String(e.provider || "unknown").toLowerCase(),
    model: String(e.model || "unknown"),
    operation: String(e.operation || e.purpose || "api_call").slice(0, 80),
    endpoint: String(e.endpoint || ""),
    kind: String(e.kind || "text"),
    inputTokens: num(e.inputTokens),
    outputTokens: num(e.outputTokens),
    cachedInputTokens: num(e.cachedInputTokens),
    cacheReadTokens: num(e.cacheReadTokens),
    cacheWriteTokens: num(e.cacheWriteTokens),
    imageInputTokens: num(e.imageInputTokens),
    imageOutputTokens: num(e.imageOutputTokens),
    costUsd: num(e.costUsd),
    pricingKnown: e.pricingKnown !== false,
    estimated: Boolean(e.estimated),
    newsId: String(e.newsId || extra.news_id || extra.newsId || "").trim() || null,
    extra: extra
  };
}

export function collectLegacyCostRows(workspaces, migrationId) {
  const marker = String(migrationId || COST_STATE_MIGRATION_ID);
  const rows = [];
  for (const ws of (Array.isArray(workspaces) ? workspaces : [])) {
    const state = ws && ws.state && typeof ws.state === "object" ? ws.state : {};
    const migrations = Array.isArray(state.migrations) ? state.migrations : [];
    if (migrations.includes(marker)) continue;
    const events = state.costTracking && Array.isArray(state.costTracking.events) ? state.costTracking.events : [];
    for (const event of events) {
      const row = normalizeLegacyCostRow(event, ws && ws.id);
      if (row) rows.push(row);
    }
  }
  return rows;
}

export function stripLegacyCostEvents(workspaces, migrationId) {
  const marker = String(migrationId || COST_STATE_MIGRATION_ID);
  let changed = 0;
  let removedEvents = 0;
  for (const ws of (Array.isArray(workspaces) ? workspaces : [])) {
    if (!ws || !ws.state || typeof ws.state !== "object") continue;
    if (!Array.isArray(ws.state.migrations)) ws.state.migrations = [];
    if (ws.state.migrations.includes(marker)) continue;
    if (!ws.state.costTracking || typeof ws.state.costTracking !== "object") {
      ws.state.costTracking = { version: 2, startedAt: new Date().toISOString() };
    }
    if (Array.isArray(ws.state.costTracking.events)) {
      removedEvents += ws.state.costTracking.events.length;
      delete ws.state.costTracking.events;
    }
    ws.state.costTracking.version = 2;
    ws.state.migrations.push(marker);
    ws.updatedAt = new Date().toISOString();
    changed += 1;
  }
  return { workspaces: changed, removedEvents: removedEvents };
}
