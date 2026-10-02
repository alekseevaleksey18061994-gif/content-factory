// Watchdog for the channel list. Every workspace the app has ever seen is remembered in the workspace_registry
// table; if one of them disappears from the live store (and was not removed on purpose through the admin API),
// the owner gets a Telegram alert instead of the network silently shrinking.

// current: array of workspace ids in the live store; known: rows {id, name} of the registry that are not marked removed.
export function missingWorkspaces(known, current) {
  const live = new Set((current || []).map(String));
  return (known || []).filter(function(row) { return row && row.id && !live.has(String(row.id)); });
}

export function missingAlertText(missing, total) {
  const list = missing.slice(0, 20).map(function(row) { return "• " + (row.name ? row.name + " (" + row.id + ")" : row.id); }).join("\n");
  return "🚨 News Factory: из хранилища пропали каналы (" + missing.length + ").\n" + list +
    "\n\nСейчас в сети " + total + ". Данные не перезаписываются автоматически — проверьте админку и бэкап.";
}

// Throttle: the same set of missing ids is announced at most once per windowMs.
export function createAlertThrottle(windowMs) {
  const sent = new Map();
  return function shouldAlert(key, nowMs) {
    const now = nowMs || Date.now();
    const last = sent.get(key) || 0;
    if (now - last < windowMs) return false;
    sent.set(key, now);
    return true;
  };
}
