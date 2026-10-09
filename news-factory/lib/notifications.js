// In-app notifications (bell in the admin) + Web Push to the owner's devices.
// The feed lives in memory (last MAX_ITEMS) and, when a database is available, in app_notifications; push
// subscriptions live in push_subscriptions. Everything here is best effort: a failing notification must never
// break publishing.
export const MAX_ITEMS = 200;
export const KIND_EMOJI = { publish_failed: "❌", billing: "💸", empty_queue: "📭", deploy: "🚀", health: "⚠️" };
export const KINDS = ["publish_failed", "billing", "empty_queue", "deploy", "health"];

export function classifyAlertText(text) {
  const t = String(text || "");
  if (/^\s*✅/.test(t)) return { kind: "health", severity: "info" };
  if (/деньги|кредит|баланс|ключ не принят|закончил/i.test(t)) return { kind: "billing", severity: "critical" };
  return { kind: "health", severity: "warn" };
}

export function splitAlertText(text) {
  const lines = String(text || "").split("\n").map(function(s) { return s.trim(); }).filter(Boolean);
  const title = (lines.shift() || "News Factory").replace(/^[^\p{L}\p{N}]+/u, "").replace(/^News Factory:\s*/i, "").slice(0, 140) || "News Factory";
  return { title: title, body: lines.join("\n").slice(0, 600) };
}

// Browsers hand out subscriptions on their vendor's push service only; the server must not POST to arbitrary hosts.
export const PUSH_HOST_RE = /^(?:[a-z0-9-]+\.)*(?:googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/i;
export function allowedPushEndpoint(endpoint) {
  try { const u = new URL(endpoint); return u.protocol === "https:" && !u.port && PUSH_HOST_RE.test(u.hostname); } catch { return false; }
}
const SEND_TIMEOUT_MS = 10000;
const RETENTION_DAYS = 30;

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
      await db.query("DELETE FROM app_notifications WHERE at < NOW() - ($1 || ' days')::interval", [String(RETENTION_DAYS)]);
      const rows = (await db.query("SELECT * FROM app_notifications ORDER BY at DESC, id DESC LIMIT $1", [MAX_ITEMS])).rows;
      const memoryOnly = items.filter(function(i) { return /^m\d/.test(i.id); }); // raised before the database was ready
      items.length = 0;
      memoryOnly.concat(rows.map(toRow)).forEach(function(r) { items.push(r); });
      items.sort(function(a, b) { return Date.parse(b.at) - Date.parse(a.at); });
      if (items.length > MAX_ITEMS) items.length = MAX_ITEMS;
      const subs = (await db.query("SELECT endpoint, keys, prefs FROM push_subscriptions")).rows;
      subs.forEach(function(s) { memorySubs.set(s.endpoint, { endpoint: s.endpoint, keys: s.keys, prefs: s.prefs || {} }); });
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
    if (key) {
      lastByKey.set(key, now());
      if (lastByKey.size > 500) { const cut = now() - 24 * 3600000; for (const [k, v] of lastByKey) if (v < cut) lastByKey.delete(k); }
    }
    const item = {
      id: "m" + (++seq) + "_" + now(), at: new Date(now()).toISOString(),
      kind: KINDS.indexOf(x.kind) >= 0 ? x.kind : "health",
      severity: ["critical", "warn", "info"].indexOf(x.severity) >= 0 ? x.severity : "info",
      title: String(x.title || "News Factory").slice(0, 160), body: String(x.body || "").slice(0, 700),
      workspace: String(x.workspace || ""), read: false
    };
    items.unshift(item);
    if (items.length > MAX_ITEMS) items.length = MAX_ITEMS;
    const db = getDb();
    if (db) {
      try {
        const r = await withTimeout(db.query("INSERT INTO app_notifications(at, kind, severity, title, body, workspace_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id", [item.at, item.kind, item.severity, item.title, item.body, item.workspace]), 4000);
        if (r.rows[0]) item.id = String(r.rows[0].id);
      } catch (error) { (o.logger || console).warn("NOTIFICATION_STORE_FAILED " + String(error && error.message || error).slice(0, 200)); }
    }
    if (x.push !== false) pushAll(item).catch(function() {}); // never blocks the caller
    return item;
  }

  function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise(function(_, reject) { timer = setTimeout(function() { reject(new Error("timeout")); }, ms); if (timer.unref) timer.unref(); });
    return Promise.race([promise, timeout]).finally(function() { clearTimeout(timer); });
  }

  // Every device in parallel, each bounded: one dead endpoint must not delay the others.
  async function pushAll(item) {
    if (!sendPush || !memorySubs.size) return 0;
    const payload = JSON.stringify({ title: (KIND_EMOJI[item.kind] ? KIND_EMOJI[item.kind] + " " : "") + item.title, body: item.body, tag: item.kind, severity: item.severity, url: "/admin" });
    const targets = Array.from(memorySubs.values()).filter(function(sub) { return !sub.prefs || sub.prefs[item.kind] !== false; });
    const results = await Promise.all(targets.map(async function(sub) {
      try { await withTimeout(Promise.resolve(sendPush(sub, payload)), SEND_TIMEOUT_MS); return 1; }
      catch (error) {
        const code = Number(error && error.statusCode || 0);
        if (code === 404 || code === 410) await unsubscribe(sub.endpoint);
        else (o.logger || console).warn("PUSH_FAILED " + JSON.stringify({ code: code, error: String(error && error.message || error).slice(0, 120) }));
        return 0;
      }
    }));
    return results.reduce(function(a, b) { return a + b; }, 0);
  }

  function list(limit) { return items.slice(0, Math.max(1, Math.min(MAX_ITEMS, Number(limit) || 50))); }
  function unread() { return items.filter(function(i) { return !i.read; }).length; }

  async function markRead(ids) {
    const all = ids === null || ids === undefined;
    if (!all && !Array.isArray(ids)) return;
    const set = new Set((ids || []).map(String).filter(function(v) { return v.length <= 40; }));
    items.forEach(function(i) { if (all || set.has(i.id)) i.read = true; });
    const db = getDb();
    if (db) {
      try {
        if (all) await db.query("UPDATE app_notifications SET read_at=NOW() WHERE read_at IS NULL");
        else await db.query("UPDATE app_notifications SET read_at=NOW() WHERE read_at IS NULL AND id = ANY($1::bigint[])", [Array.from(set).filter(function(v) { return /^\d{1,15}$/.test(v); })]);
      } catch (error) { (o.logger || console).warn("NOTIFICATION_READ_FAILED " + String(error && error.message || error).slice(0, 200)); }
    }
  }

  function validSubscription(sub) {
    return Boolean(sub && typeof sub.endpoint === "string" && sub.endpoint.length < 1000 && allowedPushEndpoint(sub.endpoint) &&
      sub.keys && typeof sub.keys.p256dh === "string" && typeof sub.keys.auth === "string");
  }

  function cleanPrefs(prefs) {
    const out = {};
    KINDS.forEach(function(k) { if (prefs && typeof prefs === "object" && prefs[k] === false) out[k] = false; });
    return out;
  }

  async function subscribe(sub, userAgent, prefs) {
    if (!validSubscription(sub)) return false;
    if (!memorySubs.has(sub.endpoint) && memorySubs.size >= 20) return false;
    const clean = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, prefs: cleanPrefs(prefs || (memorySubs.get(sub.endpoint) || {}).prefs) };
    memorySubs.set(clean.endpoint, clean);
    const db = getDb();
    if (db) {
      try { await db.query("INSERT INTO push_subscriptions(endpoint, keys, user_agent, prefs) VALUES($1,$2::jsonb,$3,$4::jsonb) ON CONFLICT (endpoint) DO UPDATE SET keys=EXCLUDED.keys, user_agent=EXCLUDED.user_agent, prefs=EXCLUDED.prefs", [clean.endpoint, JSON.stringify(clean.keys), String(userAgent || "").slice(0, 200), JSON.stringify(clean.prefs)]); }
      catch (error) { (o.logger || console).warn("PUSH_SUBSCRIBE_STORE_FAILED " + String(error && error.message || error).slice(0, 200)); }
    }
    return true;
  }

  async function setPrefs(endpoint, prefs) {
    const sub = memorySubs.get(String(endpoint || ""));
    if (!sub) return false;
    sub.prefs = cleanPrefs(prefs);
    const db = getDb();
    if (db) { try { await db.query("UPDATE push_subscriptions SET prefs=$2::jsonb WHERE endpoint=$1", [sub.endpoint, JSON.stringify(sub.prefs)]); } catch {} }
    return true;
  }

  // One device only (the "Проверить" button): ignores the type choice.
  async function pushTo(endpoint, item) {
    const sub = memorySubs.get(String(endpoint || ""));
    if (!sub || !sendPush) return false;
    try { await withTimeout(Promise.resolve(sendPush(sub, JSON.stringify({ title: (KIND_EMOJI[item.kind] || "") + " " + item.title, body: item.body, tag: "test", url: "/admin" }))), SEND_TIMEOUT_MS); return true; }
    catch (error) { if (Number(error && error.statusCode) === 410 || Number(error && error.statusCode) === 404) await unsubscribe(sub.endpoint); return false; }
  }

  async function unsubscribe(endpoint) {
    memorySubs.delete(String(endpoint || ""));
    const db = getDb();
    if (db) { try { await db.query("DELETE FROM push_subscriptions WHERE endpoint=$1", [String(endpoint || "")]); } catch {} }
  }

  return { add, list, unread, markRead, subscribe, unsubscribe, setPrefs, pushTo, devicePrefs: function(endpoint) { const s = memorySubs.get(String(endpoint || "")); return s ? Object.assign({}, s.prefs) : null; }, load, pushAll, subscriptionCount: function() { return memorySubs.size; } };
}
