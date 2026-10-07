// Unified, READ-ONLY view of one channel assembled from every place that knows about it
// (workspaces.json, the recovery manifest, editorial profiles, the VK/Postmypost map, sources) plus a consistency check.
// It changes no behaviour: it only reports where the sources of truth disagree.

const MIN_SOURCES = 15;

// ctx: { profiles: string[], resolveChannelId(ws), recovery: [{id,handle,channelId}], removed: string[],
//        vkMap: { [workspaceId]: { accountName? } } | null (null = VK via Postmypost off), defaultWorkspaceId }
export function buildChannelConfig(workspaces, ctx) {
  const c = ctx || {};
  const profiles = new Set(c.profiles || []);
  const recovery = new Map((c.recovery || []).map(function(r){ return [r.id, r]; }));
  const removed = new Set(c.removed || []);
  const list = Array.isArray(workspaces) ? workspaces : [];
  const handleOwners = new Map(), profileOwners = new Map();
  const norm = function(v){ return String(v || "").trim().replace(/^@/, "").toLowerCase(); };

  const rows = list.map(function(ws) {
    const st = ws && ws.state && typeof ws.state === "object" ? ws.state : {};
    const sources = Array.isArray(st.sources) ? st.sources : [];
    const enabled = sources.filter(function(s){ return s && s.enabled; }).length;
    const topic = st.topicSettings && st.topicSettings.default || {};
    const handle = norm(ws.telegramChannel), username = norm(ws.telegramPublicUsername);
    const channelId = (typeof c.resolveChannelId === "function" ? c.resolveChannelId(ws) : "") || "";
    const rec = recovery.get(ws.id) || null;
    const vk = c.vkMap ? c.vkMap[ws.id] || null : null;
    const issues = [];
    const add = function(level, code, text) { issues.push({ level, code, text }); };

    if (!handle) add("error", "no_telegram", "не задан Telegram-канал");
    if (handle && username && handle !== username) add("warn", "handle_mismatch", "Telegram-канал @" + handle + " не совпадает с публичным именем @" + username);
    if (!channelId) add("error", "no_profile", "нет редакторского профиля");
    else if (profiles.size && !profiles.has(channelId)) add("error", "unknown_profile", "профиль «" + channelId + "» неизвестен");
    if (removed.has(ws.id)) add("warn", "removed_channel_present", "канал числится удалённым, но есть в хранилище");
    if (rec && handle && norm(rec.handle) !== handle) add("warn", "recovery_drift", "в списке восстановления @" + norm(rec.handle) + ", в хранилище @" + handle);
    if (rec && rec.channelId && channelId && rec.channelId !== channelId) add("warn", "recovery_profile_drift", "в списке восстановления профиль «" + rec.channelId + "», в хранилище «" + channelId + "»");
    if (!rec && ws.id !== c.defaultWorkspaceId) add("info", "not_restorable", "канала нет в списке восстановления: при потере хранилища его не вернуть автоматически");
    if (c.vkMap && !vk) add("warn", "no_vk", "нет привязки VK (Postmypost)");
    if (enabled < MIN_SOURCES) add("warn", "few_sources", "мало активных источников: " + enabled + " из " + MIN_SOURCES);
    if (!String(ws.avatarUrl || "").trim()) add("info", "no_avatar", "нет аватара");

    if (handle) handleOwners.set(handle, (handleOwners.get(handle) || []).concat(ws.id));
    if (channelId) profileOwners.set(channelId, (profileOwners.get(channelId) || []).concat(ws.id));
    return {
      id: ws.id, name: ws.name, telegram: ws.telegramChannel || "", username: ws.telegramPublicUsername || "",
      profile: channelId, vk: c.vkMap ? Boolean(vk) : null,
      mode: String(st.mode || ""), autoPublishTelegram: topic.auto_publish_telegram !== false, autoPublishVk: topic.auto_publish_vk === true,
      sources: { enabled, total: sources.length }, inRecovery: Boolean(rec), issues
    };
  });

  for (const row of rows) {
    const h = norm(row.telegram), p = row.profile;
    if (h && handleOwners.get(h).length > 1) row.issues.push({ level: "error", code: "duplicate_handle", text: "тот же Telegram-канал у: " + handleOwners.get(h).filter(function(x){ return x !== row.id; }).join(", ") });
    if (p && profileOwners.get(p).length > 1) row.issues.push({ level: "error", code: "duplicate_profile", text: "тот же профиль у: " + profileOwners.get(p).filter(function(x){ return x !== row.id; }).join(", ") });
  }
  const count = function(level) { return rows.reduce(function(n, r){ return n + r.issues.filter(function(i){ return i.level === level; }).length; }, 0); };
  const knownIds = new Set(rows.map(function(r){ return r.id; }));
  const orphanRecovery = (c.recovery || []).filter(function(r){ return !knownIds.has(r.id) && !removed.has(r.id); }).map(function(r){ return r.id; });
  return { channels: rows, errors: count("error"), warnings: count("warn"), infos: count("info"), orphanRecovery };
}
