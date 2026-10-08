// Health alerts for the owner (Telegram). Pure decision logic: given a snapshot of the system and what was already
// reported, say which alerts to send now, which problems are over, and the state to keep.
//
// Rules: a problem must be seen on 2 consecutive checks (no alert for a blip); while it lasts it is repeated at most
// every REPEAT_MS; when it disappears one "recovered" message is sent. A silent channel is judged from 09:00 Moscow
// time of the current day so the quiet night is never counted as silence.

export const REPEAT_MS = 6 * 3600000;
export const CONFIRM_TICKS = 2;
const MSK_OFFSET_MS = 3 * 3600000;

function mskParts(ms) {
  const d = new Date(ms + MSK_OFFSET_MS);
  return { minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), dayStartMs: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - MSK_OFFSET_MS };
}

// channels: [{ id, name, autoPublish, paused, lastPublishedMs }]
export function silentChannels(channels, nowMs, silenceHours) {
  const t = mskParts(nowMs);
  if (t.minutes < 9 * 60) return [];
  const windowStart = t.dayStartMs + 9 * 3600000;
  const out = [];
  for (const ch of channels || []) {
    if (!ch || !ch.autoPublish || ch.paused) continue;
    if (!ch.lastPublishedMs) continue; // a brand-new channel that never posted is not "silent"
    const ref = Math.max(Number(ch.lastPublishedMs), windowStart);
    const hours = (nowMs - ref) / 3600000;
    if (hours >= silenceHours) out.push({ id: ch.id, name: ch.name, hours: Math.floor(hours) });
  }
  return out;
}

// snapshot: { nowMs, channels, silenceHours, postmypostError, botOk, botConfigured, proxyConfigured, proxyOk, dbConfigured, dbReady }
// prev: { [key]: { ticks, lastSentMs, active } }
export function evaluateHealth(snapshot, prev) {
  const now = Number(snapshot.nowMs) || Date.now();
  const bad = {}; // key -> text
  const silent = silentChannels(snapshot.channels, now, Number(snapshot.silenceHours) || 5);
  if (silent.length >= 3) {
    bad["silent:many"] = "🔕 Молчат " + silent.length + " каналов: " + silent.slice(0, 6).map(function(c){ return c.name + " (" + c.hours + " ч)"; }).join(", ") + (silent.length > 6 ? " и ещё " + (silent.length - 6) : "") + ".\nПроверьте «Подключения» и очередь в админке.";
  } else {
    for (const c of silent) bad["silent:" + c.id] = "🔕 Канал «" + c.name + "» не публикует уже " + c.hours + " ч (с 09:00 МСК).\nПроверьте очередь и источники в админке.";
  }
  if (snapshot.postmypostError) bad["postmypost"] = "⚠️ Postmypost не отвечает — посты в VK могут не уходить.\n" + String(snapshot.postmypostError).slice(0, 160) + "\nПроверьте POSTMYPOST_TOKEN и доступ к postmypost.io.";
  const pp = snapshot.pmpPending;
  if (pp && (pp.stuck || pp.failed)) bad["pmp:stuck"] = "⚠️ Посты в VK не вышли: Postmypost принял, но не опубликовал — зависло " + pp.stuck + ", с ошибкой " + pp.failed + (pp.oldestMin ? " (самому старому " + pp.oldestMin + " мин)" : "") + ".\nОткройте кабинет Postmypost: проверьте подключение VK-групп и очередь публикаций.";
  const tm = snapshot.tgMissed;
  if (tm && tm.count) bad["tg:missed"] = "⚠️ В Telegram не дошло постов: " + tm.count + " (" + (tm.channels || []).slice(0, 4).join(", ") + ").\nВ слотах дня они красные; причина в логах: TELEGRAM_PUBLISH_FAILED.";
  if (snapshot.botConfigured && snapshot.botOk === false) bad["bot"] = "⚠️ Telegram-бот не отвечает на проверку — возможно, токен отозван. Публикация в Telegram может не работать.";
  if (snapshot.proxyConfigured && snapshot.proxyOk === false) bad["proxy"] = "⚠️ Российский прокси не отвечает — российские источники перестанут собираться. Проверьте оплату прокси.";
  if (snapshot.dbConfigured && snapshot.dbReady === false) bad["db"] = "🚨 База данных PostgreSQL недоступна. Часть функций остановлена.";

  const next = {};
  const send = [];
  const recovered = [];
  const keys = new Set(Object.keys(bad).concat(Object.keys(prev || {})));
  for (const key of keys) {
    const before = (prev && prev[key]) || { ticks: 0, lastSentMs: 0, active: false };
    if (bad[key]) {
      const ticks = before.ticks + 1;
      let lastSentMs = before.lastSentMs;
      let active = before.active;
      if (ticks >= CONFIRM_TICKS && (!active || now - lastSentMs >= REPEAT_MS)) {
        send.push({ key: key, text: bad[key] });
        lastSentMs = now;
        active = true;
      }
      next[key] = { ticks: ticks, lastSentMs: lastSentMs, active: active };
    } else if (before.active) {
      recovered.push({ key: key, text: "✅ Снова в порядке: " + describeKey(key, snapshot) });
    }
  }
  return { send: send, recovered: recovered, next: next, silent: silent };
}

function describeKey(key, snapshot) {
  if (key === "postmypost") return "Postmypost отвечает.";
  if (key === "pmp:stuck") return "посты в VK выходят.";
  if (key === "tg:missed") return "посты доходят в Telegram.";
  if (key === "bot") return "Telegram-бот отвечает.";
  if (key === "proxy") return "российский прокси работает.";
  if (key === "db") return "база данных доступна.";
  if (key === "silent:many") return "каналы снова публикуют.";
  if (key.startsWith("silent:")) {
    const id = key.slice(7);
    const ch = (snapshot.channels || []).find(function(c){ return c.id === id; });
    return "канал «" + (ch ? ch.name : id) + "» снова публикует.";
  }
  return key;
}
