// In-app notifications (bell in the admin) + Web Push to the owner's devices.
// The feed lives in memory (last MAX_ITEMS) and, when a database is available, in app_notifications; push
// subscriptions live in push_subscriptions. Everything here is best effort: a failing notification must never
// break publishing.
export const MAX_ITEMS = 200;
export const KINDS = ["publish_failed", "billing", "empty_queue", "deploy", "health"];

export function classifyAlertText(text) {
  const t = String(text || "");
  if (/деньги|кредит|баланс|ключ не принят|закончил/i.test(t)) return { kind: "billing", severity: "critical" };
  if (/✅/.test(t)) return { kind: "health", severity: "info" };
  return { kind: "health", severity: "warn" };
}

export function splitAlertText(text) {
  const lines = String(text || "").split("\n").map(function(s) { return s.trim(); }).filter(Boolean);
  const title = (lines.shift() || "News Factory").replace(/^[^\p{L}\p{N}]+/u, "").replace(/^News Factory:\s*/i, "").slice(0, 140) || "News Factory";
  return { title: title, body: lines.join("\n").slice(0, 600) };
}

export function createNotifier(options) {
  const o = options || {};
  const now = o.now || Date.now;
  const getDb = o.getDb || function() { return null; };
  const sendPush = o.sendPush || null; // async (subscription, payloadString) -> void; throws {statusCode}
  const items = [];
  const lastByKey = new Map();
  let seq = 0;
  const memorySubs = new Map();

  function toRow(row) {
    return { id: String(row.id), at: new Date(row.at).toISOString(), kind: row.kind, severity: row.severity, title: row.title, body: row.body || "", workspace: row.workspace_id || "", read: Boolean(row.read_at) };
  }

  async function load() {
    const db = getDb();
    if (!db) return;
    try {
      const rows = (await db.query("SELECT * FROM app_notifications ORDER BY at DESC, id DESC LIMIT $1", [MAX_ITEMS])).rows;
      items.length = 0;
      rows.forEach(function(r) { items.push(toRow(r)); });
      const subs = (await db.query("SELECT endpoint, keys FROM push_subscriptions")).rows;
      subs.forEach(function(s) { memorySubs.set(s.endpoint, { endpoint: s.endpoint, keys: s.keys }); });
    } catch (error) { (o.logger || console).warn("NOTIFICATIONS_LOAD_FAILED " + String(error && error.message || error).slice(0, 200)); }
  }

  // add({ key, kind, severity, title, body, workspace, throttleMs, push }) -> the stored item, or null when throttled.
  async function add(n) {
    const x = n || {};
    const key = String(x.key || "");
    const throttleMs = Number(x.throttleMs || 0);
    if (key && throttleMs > 0) {
      if (lastByKey.has(key) && now() - lastByKey.get(key) < throttleMs) return null;
    }
    if (key) lastByKey.set(key, now());
    const item = {
      id: "m" + (++seq) + "_" + now(), at: new Date(now()).toISOString(),
      kind: KINDS.indexOf(x.kind) >= 0 ? x.kind : "health",
      severity: ["critical", "warn", "info"].indexOf(x.severity) >= 0 ? x.severity : "info",
      title: String(x.title || "News Factory").slice(0, 160), body: String(x.body || "").slice(0, 700),
      workspace: String(x.workspace || ""), read: false
    };
    const db = getDb();
    if (db) {
      try {
        const r = await db.query("INSERT INTO app_notifications(at, kind, severity, title, body, workspace_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id", [item.at, item.kind, item.severity, item.title, item.body, item.workspace]);
        if (r.rows[0]) item.id = String(r.rows[0].id);
      } catch (error) { (o.logger || console).warn("NOTIFICATION_STORE_FAILED " + String(error && error.message || error).slice(0, 200)); }
    }
    items.unshift(item);
    if (items.length > MAX_ITEMS) items.length = MAX_ITEMS;
    if (x.push !== false) await pushAll(item).catch(function() {});
    return item;
  }

  async function pushAll(item) {
    if (!sendPush || !memorySubs.size) return 0;
    const payload = JSON.stringify({ title: item.title, body: item.body, tag: item.kind, severity: item.severity, url: "/admin" });
    let sent = 0;
    for (const sub of Array.from(memorySubs.values())) {
      try { await sendPush(sub, payload); sent += 1; }
      catch (error) {
        const code = Number(error && error.statusCode || 0);
        if (code === 404 || code === 410) await unsubscribe(sub.endpoint);
        else (o.logger || console).warn("PUSH_FAILED " + JSON.stringify({ code: code, error: String(error && error.message || error).slice(0, 120) }));
      }
    }
    return sent;
  }

  function list(limit) { return items.slice(0, Math.max(1, Math.min(MAX_ITEMS, Number(limit) || 50))); }
  function unread() { return items.filter(function(i) { return !i.read; }).length; }

  async function markRead(ids) {
    const all = !Array.isArray(ids) || !ids.length;
    const set = new Set((ids || []).map(String));
    items.forEach(function(i) { if (all || set.has(i.id)) i.read = true; });
    const db = getDb();
    if (db) {
      try {
        if (all) await db.query("UPDATE app_notifications SET read_at=NOW() WHERE read_at IS NULL");
        else await db.query("UPDATE app_notifications SET read_at=NOW() WHERE read_at IS NULL AND id = ANY($1::bigint[])", [Array.from(set).filter(function(v) { return /^\d+$/.test(v); })]);
      } catch (error) { (o.logger || console).warn("NOTIFICATION_READ_FAILED " + String(error && error.message || error).slice(0, 200)); }
    }
  }

  function validSubscription(sub) {
    return Boolean(sub && typeof sub.endpoint === "string" && /^https:\/\//.test(sub.endpoint) && sub.endpoint.length < 1000 &&
      sub.keys && typeof sub.keys.p256dh === "string" && typeof sub.keys.auth === "string");
  }

  async function subscribe(sub, userAgent) {
    if (!validSubscription(sub)) return false;
    const clean = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
    memorySubs.set(clean.endpoint, clean);
    const db = getDb();
    if (db) {
      try { await db.query("INSERT INTO push_subscriptions(endpoint, keys, user_agent) VALUES($1,$2::jsonb,$3) ON CONFLICT (endpoint) DO UPDATE SET keys=EXCLUDED.keys, user_agent=EXCLUDED.user_agent", [clean.endpoint, JSON.stringify(clean.keys), String(userAgent || "").slice(0, 200)]); }
      catch (error) { (o.logger || console).warn("PUSH_SUBSCRIBE_STORE_FAILED " + String(error && error.message || error).slice(0, 200)); }
    }
    return true;
  }

  async function unsubscribe(endpoint) {
    memorySubs.delete(String(endpoint || ""));
    const db = getDb();
    if (db) { try { await db.query("DELETE FROM push_subscriptions WHERE endpoint=$1", [String(endpoint || "")]); } catch {} }
  }

  return { add, list, unread, markRead, subscribe, unsubscribe, load, pushAll, subscriptionCount: function() { return memorySubs.size; } };
}
