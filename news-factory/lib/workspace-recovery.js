// One-time recovery of channel workspaces that were lost from workspaces.json.
//
// On 2026-10-02 a restart overlapped with a write of workspaces.json; the old loader read the half-written file,
// silently created a store with a single channel and overwrote the file. The per-channel state is still in the
// database (app_snapshots keeps the latest snapshots of every workspace), and the channel identities below come
// from the TELEGRAM_TARGET_HEALTH log lines of the last healthy deployment (workspace id, @handle, chat id, title).
//
// The routine is additive and runs once (marker in the default workspace): it only adds channels that are missing
// from the store and never touches an existing one.

export const WORKSPACE_RECOVERY_MIGRATION = "v0.46.1-workspace-recovery";

// id = workspace id, channel = editorial profile pin, handle = configured Telegram channel.
export const RECOVERY_CHANNELS = [
  { id: "chtotamdengi", name: "Что там с деньгами?", handle: "@chtotamdengi", channelId: "money", chatId: -1003261649445 },
  { id: "chtotamtech", name: "Что там у технологий?", handle: "@chtotamtech", channelId: "tech", chatId: -1004322403745 },
  { id: "chtotamigry", name: "Что там у игр?", handle: "@chtotamigry", channelId: "games", chatId: -1004298260114 },
  { id: "chtotamkino", name: "Что там в кино?", handle: "@chtotamvkino", channelId: "kino", chatId: -1004344836709 },
  { id: "chtotamnauka", name: "Что там у науки?", handle: "@chtotamnauka", channelId: "science", chatId: -1004323358894 },
  { id: "chtotamsport", name: "Что там в спорте?", handle: "@chtotamsport", channelId: "sport", chatId: -1004330200471 },
  { id: "chtotamnews", name: "Что там в интернете?", handle: "@chtotaminternet", channelId: "world", chatId: -1003726241045 },
  { id: "chtotamzvezd", name: "Что там у звёзд?", handle: "@chtotamzvezd", channelId: "stars", chatId: -1003727093016 },
  { id: "chtotamtour", name: "Что там в путешествиях?", handle: "@chtotamtour", channelId: "travel", chatId: -1003902646505 },
  { id: "chtotampokupki", name: "Что там с покупками?", handle: "@chtotampokupki", channelId: "shopping", chatId: -1004410550428 },
  { id: "chtotamdom", name: "Что там для дома?", handle: "@chtotamdom", channelId: "home", chatId: -1004379794415 },
  { id: "chtotameda", name: "Что там с едой?", handle: "@chtotameda", channelId: "food", chatId: -1004435978033 },
  { id: "chtotambusiness", name: "Что там у бизнеса?", handle: "@chtotambusiness", channelId: "business", chatId: -1004354775981 },
  { id: "chtotamcrypto", name: "Что там у крипты?", handle: "@chtotamcrypto", channelId: "crypto", chatId: -1004355768399 }
];

// A snapshot is usable when it is a plain object that looks like a workspace state.
export function isUsableSnapshotState(state) {
  return Boolean(state && typeof state === "object" && !Array.isArray(state) &&
    Array.isArray(state.sources) && (Array.isArray(state.queue) || Array.isArray(state.history)));
}

// Workspace record (before normalizeWorkspaceMeta) for a lost channel.
export function recoveredWorkspaceRecord(entry, state, nowIso) {
  return {
    id: entry.id,
    name: entry.name,
    slug: String(entry.handle || "").replace(/^@/, ""),
    telegramChannel: entry.handle,
    telegramPublicUsername: String(entry.handle || "").replace(/^@/, ""),
    channelId: entry.channelId,
    createdAt: nowIso,
    updatedAt: nowIso,
    state: state
  };
}
