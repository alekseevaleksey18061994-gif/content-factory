from pathlib import Path

path = Path("news-factory/server.js")
c = path.read_text(encoding="utf-8")

def rep(old, new, label):
    global c
    if old not in c:
        raise RuntimeError("patch anchor missing: " + label)
    c = c.replace(old, new, 1)

rep(
'''import { channelTopic, channelFocus, channelStrategy, SOURCE_REWORK_V0430, INTERNET_SOURCE_FIX_V0451, HOME_RUBRIC_SOURCES_V0513, MONEY_RUBRIC_SOURCES_V0526 } from "./lib/channel-dna.js";''',
'''import { channelTopic, channelFocus, channelStrategy, SOURCE_REWORK_V0430, INTERNET_SOURCE_FIX_V0451, HOME_RUBRIC_SOURCES_V0513, MONEY_RUBRIC_SOURCES_V0526, AUTO_RUBRIC_SOURCES_V0530, SHOPPING_RUBRIC_SOURCES_V0530 } from "./lib/channel-dna.js";''',
"imports")

rep(
'''const CHANNEL_SOURCE_PLANS = {
  home: { refresh: true, boost: 0, hint: "находки и подборки товаров для дома, до/после обычных квартир, хранение, уборка, ремонт своими руками, тренды интерьера, кухня; НЕ рынок недвижимости, НЕ ЖКХ, НЕ IT-новости, НЕ городские новости" },
  shopping: { refresh: true, boost: 15, hint: "новости для покупателей, а не для продавцов: скидки и распродажи, цены в магазинах, новинки и вирусные товары, возвраты и доставка на Ozon, Wildberries, Яндекс Маркете и Авито, права потребителей, мошенники; Telegram-каналы и сайты для покупателей" },''',
'''const CHANNEL_SOURCE_PLANS = {
  auto: { refresh: true, boost: 8, hint: "автомобильное медиа: премьеры, авторынок России, китайские авто, электро и гибриды, автотехнологии, сильные тесты и блогеры, вирусные автоистории, важное водителю; лучше сильный материал, чем слабая свежая новость" },
  home: { refresh: true, boost: 0, hint: "находки и подборки товаров для дома, до/после обычных квартир, хранение, уборка, ремонт своими руками, тренды интерьера, кухня; НЕ рынок недвижимости, НЕ ЖКХ, НЕ IT-новости, НЕ городские новости" },
  shopping: { refresh: true, boost: 15, hint: "товарные находки Wildberries, Ozon, Яндекс Маркета, AliExpress и вирусные товары; рекламные посты допустимы как источник конкретного товара; НЕ новости для продавцов, НЕ корпоративные новости маркетплейсов" },''',
"source plans")

rep(
'''function rubricMinFor(rubricId, ws) {
  const st = ws && ws.state ? ws.state : state;
  const base = Math.max(1, channelStrategy(resolveChannelId(ws || currentWorkspace())).rubricMinSources || 1);
  const own = st.rubricLimits && st.rubricLimits[rubricId] && Number(st.rubricLimits[rubricId].min);
  return Number.isFinite(own) && own >= RUBRIC_MIN_LIMIT ? Math.round(own) : base;
}''',
'''function rubricDefaultMinFor(rubricId, ws) {
  const strat = channelStrategy(resolveChannelId(ws || currentWorkspace()));
  const rubric = Array.isArray(strat.rubrics) ? strat.rubrics.find(function(r){ return r && r.id === rubricId; }) : null;
  return Math.max(1, Number(rubric && rubric.minSources || strat.rubricMinSources || 1) || 1);
}
function rubricMinFor(rubricId, ws) {
  const st = ws && ws.state ? ws.state : state;
  const base = rubricDefaultMinFor(rubricId, ws);
  const own = st.rubricLimits && st.rubricLimits[rubricId] && Number(st.rubricLimits[rubricId].min);
  return Number.isFinite(own) && own >= RUBRIC_MIN_LIMIT ? Math.round(own) : base;
}''',
"rubric minimum")

rep(
'''  const base = Math.max(1, channelStrategy(resolveChannelId(ws || currentWorkspace())).rubricMinSources || 1);
  return channelRubrics(ws).map(function(r){
    return { id: r.id, label: r.label, hint: r.hint || "", active: counts[r.id] || 0, min: rubricMinFor(r.id, ws), defaultMin: base, max: rubricMaxFor(r.id, ws),''',
'''  return channelRubrics(ws).map(function(r){
    const base = rubricDefaultMinFor(r.id, ws);
    return { id: r.id, label: r.label, hint: r.hint || "", active: counts[r.id] || 0, min: rubricMinFor(r.id, ws), defaultMin: base, max: rubricMaxFor(r.id, ws),''',
"rubric info")

rep(
'''function channelSlotHours(ws) {
  const hours = channelStrategy(resolveChannelId(ws || currentWorkspace())).slotHours;
  return Array.isArray(hours) && hours.length ? hours : null;
}
function isChannelSlotHour(hour, ws) {
  const hours = channelSlotHours(ws);
  return hours ? hours.includes(Number(hour)) : (hour >= DYNAMIC_SLOT_START_HOUR && hour <= DYNAMIC_SLOT_END_HOUR);
}
function channelDailyMax(ws) {
  const hours = channelSlotHours(ws);
  return hours ? Math.min(DYNAMIC_DAILY_MAX, hours.length) : DYNAMIC_DAILY_MAX;
}''',
'''function channelSlotPlan(ws) {
  const plan = channelStrategy(resolveChannelId(ws || currentWorkspace())).slotPlan;
  return Array.isArray(plan) ? plan : [];
}
function channelSlotTimes(ws) {
  const strat = channelStrategy(resolveChannelId(ws || currentWorkspace()));
  const times = Array.isArray(strat.slotTimes) && strat.slotTimes.length ? strat.slotTimes : null;
  return times ? times.map(String) : null;
}
function channelSlotRubric(time, ws) {
  const row = channelSlotPlan(ws).find(function(x){ return x && String(x.time) === String(time); });
  return row && row.rubric ? String(row.rubric) : "";
}
function channelSlotHours(ws) {
  const hours = channelStrategy(resolveChannelId(ws || currentWorkspace())).slotHours;
  return Array.isArray(hours) && hours.length ? hours : null;
}
function isChannelSlotHour(hour, ws) {
  if (channelSlotTimes(ws)) return false;
  const hours = channelSlotHours(ws);
  return hours ? hours.includes(Number(hour)) : (hour >= DYNAMIC_SLOT_START_HOUR && hour <= DYNAMIC_SLOT_END_HOUR);
}
function isChannelSlotTime(time, ws) {
  const times = channelSlotTimes(ws);
  if (times) return times.includes(String(time));
  const m = /^(\\d{2}):00$/.exec(String(time || ""));
  return m ? isChannelSlotHour(Number(m[1]), ws) : false;
}
function channelDailyMax(ws) {
  const times = channelSlotTimes(ws);
  if (times) return Math.min(24, times.length);
  const hours = channelSlotHours(ws);
  return hours ? Math.min(24, hours.length) : DYNAMIC_DAILY_MAX;
}''',
"slot helpers")

rep(
'''function bloggerSlotsFor() { const lane = channelExtraLane(); return lane ? lane.slots : BLOGGER_SLOTS; }
function bloggerTargetFor() { const lane = channelExtraLane(); return lane ? Math.max(0, Number(lane.targetPerDay == null ? lane.slots.length : lane.targetPerDay)) : BLOGGER_DAILY_TARGET; }''',
'''function bloggerSlotsFor() {
  if (editorialChannelId() === "auto" && channelRubrics().length) return [];
  const lane = channelExtraLane();
  return lane ? lane.slots : BLOGGER_SLOTS;
}
function bloggerTargetFor() {
  if (editorialChannelId() === "auto" && channelRubrics().length) return 0;
  const lane = channelExtraLane();
  return lane ? Math.max(0, Number(lane.targetPerDay == null ? lane.slots.length : lane.targetPerDay)) : BLOGGER_DAILY_TARGET;
}''',
"legacy blogger lane")

rep(
'''  const ownHours = ownerWs ? channelSlotHours(ownerWs) : null;
  if (ownHours && Array.isArray(schedule.slots)) {
    schedule.slots = schedule.slots.filter(function(slot){
      if (!slot || slot.kind === "blogger" || slot.kind === "russian-ai" || slot.kind === "money-emergency" || !/^\\d{2}:00$/.test(String(slot.time || ""))) return true;
      return ownHours.includes(Number(String(slot.time).slice(0, 2)));
    });
    schedule.maxPerDay = Math.min(Number(schedule.maxPerDay || ownHours.length), ownHours.length);
    schedule.targetPerDay = Math.min(Number(schedule.targetPerDay || ownHours.length), ownHours.length);
  }''',
'''  const ownTimes = ownerWs ? channelSlotTimes(ownerWs) : null;
  const ownHours = ownerWs ? channelSlotHours(ownerWs) : null;
  if (ownTimes && Array.isArray(schedule.slots)) {
    const wanted = new Set(ownTimes);
    schedule.slots = schedule.slots.filter(function(slot){
      if (!slot) return false;
      if (slot.kind === "russian-ai" || slot.kind === "money-emergency") return true;
      if (slot.kind === "blogger") return false;
      return wanted.has(String(slot.time || ""));
    });
    const have = new Set(schedule.slots.map(function(slot){ return String(slot && slot.time || ""); }));
    for (const time of ownTimes) if (!have.has(time)) schedule.slots.push({ time: time, kind: "dynamic", label: "Динамическое окно" });
    schedule.slots.sort(function(a,b){ return String(a.time || "").localeCompare(String(b.time || "")); });
    schedule.maxPerDay = ownTimes.length;
    schedule.targetPerDay = ownTimes.length;
  } else if (ownHours && Array.isArray(schedule.slots)) {
    schedule.slots = schedule.slots.filter(function(slot){
      if (!slot) return false;
      if (ownerWs && resolveChannelId(ownerWs) === "auto" && slot.kind === "blogger") return false;
      if (slot.kind === "blogger" || slot.kind === "russian-ai" || slot.kind === "money-emergency" || !/^\\d{2}:00$/.test(String(slot.time || ""))) return true;
      return ownHours.includes(Number(String(slot.time).slice(0, 2)));
    });
    schedule.maxPerDay = ownHours.length;
    schedule.targetPerDay = ownHours.length;
  }''',
"calendar shape")

rep(
'''function dynamicBestQueueItem(kind) {
  // Posts at or above the rating threshold first; reserve posts only when none is available.
  const best = dynamicBestQueueItemRaw(kind, true);
  return best || dynamicBestQueueItemRaw(kind, false);
}

function dynamicBestQueueItemRaw(kind, onlyAboveThreshold) {''',
'''function dynamicBestQueueItem(kind, requiredRubric) {
  const best = dynamicBestQueueItemRaw(kind, true, requiredRubric);
  const reserve = best || dynamicBestQueueItemRaw(kind, false, requiredRubric);
  if (reserve || !requiredRubric || editorialChannelId() !== "auto") return reserve;
  const urgent = dynamicBestQueueItemRaw(kind, true, "");
  if (!urgent) return null;
  const importance = Number(urgent.editorialV2 && urgent.editorialV2.importance);
  return queueItemRating(urgent) >= 90 && Number.isFinite(importance) && importance >= 9 ? urgent : null;
}

function dynamicBestQueueItemRaw(kind, onlyAboveThreshold, requiredRubric) {''',
"rubric picker")

rep(
'''      const itemTheme = itemRubric(item, themes);
      if (channelId === "money") {''',
'''      const itemTheme = itemRubric(item, themes);
      if (requiredRubric && itemTheme !== requiredRubric) return false;
      if (channelId === "money") {''',
"rubric filter")

rep(
'''      if (wantsBlogger) return isBloggerSource(item) || Boolean(anySourceLane && !isRussianAISource(item));
      if (wantsRussianAi) return isRussianAISource(item);
      return !isBloggerSource(item) && !isRussianAISource(item);''',
'''      if (wantsBlogger) return isBloggerSource(item) || Boolean(anySourceLane && !isRussianAISource(item));
      if (wantsRussianAi) return isRussianAISource(item);
      if (channelId === "auto") return !isRussianAISource(item);
      return !isBloggerSource(item) && !isRussianAISource(item);''',
"auto blogger regular")

rep(
'''function dynamicAssignBest(day, time, kind) {
  const item = dynamicBestQueueItem(kind);''',
'''function dynamicAssignBest(day, time, kind, requiredRubric) {
  const item = dynamicBestQueueItem(kind, requiredRubric || channelSlotRubric(time));''',
"assignment")

rep(
'''async function prepareDynamicSlot() {''',
'''async function prepareExactChannelSlot(time) {
  const day = moscowDateKey(new Date());
  if (!isChannelSlotTime(time)) return { ok: true, skipped: "not_channel_slot" };
  if (dynamicDailyPublishedCount(day) >= channelDailyMax()) return { ok: true, skipped: "daily_max" };
  const schedule = ensureScheduleShape(state);
  if (schedule.suppressed[day] && schedule.suppressed[day][time]) return { ok: true, skipped: "suppressed" };
  const collector = await collectOnce("exact-slot-prep");
  await refreshEditorialLearning(false).catch(function(error){ console.warn("Editorial learning refresh failed:", error.message); });
  const rubric = channelSlotRubric(time);
  const item = dynamicAssignBest(day, time, undefined, rubric);
  return { ok: true, slot: time, rubric: rubric, collector: collector, prepared: item ? item.id : null, title: item ? item.title : "" };
}

async function prepareDynamicSlot() {''',
"exact preparation")

rep(
'''    const ready = dynamicAssignBest(day, time);
    if (ready) return { ok: true, slot: time, collector: { ok: true, skipped: "staggered_collect_done" }, prepared: ready.id, title: ready.title };''',
'''    const ready = dynamicAssignBest(day, time, undefined, channelSlotRubric(time));
    if (ready) return { ok: true, slot: time, collector: { ok: true, skipped: "staggered_collect_done" }, prepared: ready.id, title: ready.title };''',
"hourly prepared pick")

rep(
'''  const item = dynamicAssignBest(day, time);
  return {''',
'''  const item = dynamicAssignBest(day, time, undefined, channelSlotRubric(time));
  return {''',
"hourly final pick")

rep(
'''async function publishDynamicSlot(kind) {
  let lastError = null;''',
'''async function publishDynamicSlot(kind, forcedTime) {
  let lastError = null;''',
"publish signature")

rep(
'''      const result = await publishDynamicSlotOnce(kind, { noRescue: attempt > 1 });''',
'''      const result = await publishDynamicSlotOnce(kind, { noRescue: attempt > 1 }, forcedTime);''',
"publish call")

rep(
'''async function publishDynamicSlotOnce(kind, opts) {
  const publishKind = kind === "blogger" ? "blogger" : (kind === "russian-ai" ? "russian-ai" : (kind === "money-emergency" ? "money-emergency" : "regular"));
  const now = new Date();
  const nowMinutes = moscowMinutes(now);
  const hour = Math.floor(nowMinutes / 60);''',
'''async function publishDynamicSlotOnce(kind, opts, forcedTime) {
  const publishKind = kind === "blogger" ? "blogger" : (kind === "russian-ai" ? "russian-ai" : (kind === "money-emergency" ? "money-emergency" : "regular"));
  const now = new Date();
  const nowMinutes = moscowMinutes(now);
  const forced = /^\\d{2}:\\d{2}$/.test(String(forcedTime || "")) ? String(forcedTime) : "";
  const hour = forced ? Number(forced.slice(0, 2)) : Math.floor(nowMinutes / 60);''',
"publish exact time")

rep(
'''  const time = String(hour).padStart(2, "0") + ((publishKind === "blogger" || publishKind === "russian-ai" || publishKind === "money-emergency") ? ":30" : ":00");''',
'''  const time = forced || (String(hour).padStart(2, "0") + ((publishKind === "blogger" || publishKind === "russian-ai" || publishKind === "money-emergency") ? ":30" : ":00"));''',
"publish slot")

rep(
'''  if (publishKind === "regular" && !isChannelSlotHour(hour)) return { ok: true, skipped: "not_channel_slot" };''',
'''  if (publishKind === "regular" && !(forced ? isChannelSlotTime(time) : isChannelSlotHour(hour))) return { ok: true, skipped: "not_channel_slot" };''',
"publish exact guard")

start = c.index("async function publishDynamicSlotOnce")
end = c.index("\nasync function dynamicSchedulerTick", start)
if start < 0 or end < 0:
    raise RuntimeError("publish block bounds missing")
block = c[start:end].replace(
    "dynamicAssignBest(day, time, laneKind)",
    'dynamicAssignBest(day, time, laneKind, publishKind === "regular" ? channelSlotRubric(time) : "")'
)
c = c[:start] + block + c[end:]

rep(
'''async function dynamicSchedulerTick() {''',
'''async function exactChannelSchedulerTick() {
  if (isCollectorRunning()) return;
  const times = channelSlotTimes();
  if (!times || !times.length) return;
  const now = new Date();
  const nowMinutes = moscowMinutes(now);
  const day = moscowDateKey(now);
  let action = "", slotTime = "";
  for (const time of times) {
    const sm = slotMinutes(time);
    if (nowMinutes >= sm && nowMinutes < sm + SCHEDULER_SLOT_WINDOW_MINUTES) { action = "exact_publish"; slotTime = time; break; }
  }
  if (!action) {
    for (const time of times) {
      const prep = slotMinutes(time) - 15;
      if (nowMinutes >= prep && nowMinutes < prep + SCHEDULER_SLOT_WINDOW_MINUTES) { action = "exact_prepare"; slotTime = time; break; }
    }
  }
  if (!action) return;
  state.dynamicScheduler = state.dynamicScheduler || {};
  const key = day + "-" + slotTime + "-" + action;
  if (state.dynamicScheduler.lastTickKey === key) return;
  state.dynamicScheduler.lastAttemptedTickKey = key;
  state.dynamicScheduler.lastAttemptedTickAt = new Date().toISOString();
  try {
    const work = action === "exact_prepare" ? prepareExactChannelSlot(slotTime) : publishDynamicSlot(undefined, slotTime);
    const result = action === "exact_prepare"
      ? await withDeadline(work, SCHEDULER_PREPARE_TIMEOUT_MS, "scheduler " + action)
      : await work;
    state.dynamicScheduler.lastTickKey = key;
    state.dynamicScheduler.lastTickCompletedAt = new Date().toISOString();
    saveState();
    console.log("Exact scheduler " + action + " " + currentWorkspaceId() + ": " + JSON.stringify(result));
  } catch (error) {
    console.error("Exact scheduler " + action + " " + currentWorkspaceId() + " failed:", error.message);
  }
}

async function dynamicSchedulerTick() {''',
"exact scheduler")

rep(
'''async function dynamicSchedulerTick() {
  if (isCollectorRunning()) return;''',
'''async function dynamicSchedulerTick() {
  if (channelSlotTimes()) return exactChannelSchedulerTick();
  if (isCollectorRunning()) return;''',
"exact scheduler branch")

rep(
'''shopping: "маркетплейсы и покупатели: правила Ozon, Wildberries и Яндекс Маркета, доставка, возвраты, новые товары и тренды; без рекламных подборок, промокодов и скидок"''',
'''shopping: "товарные находки Wildberries, Ozon, Яндекс Маркета, AliExpress и вирусные товары; рекламный исходник допустим, если в нём есть конкретный интересный товар"''',
"shopping prefilter topic")

anchor = "// v0.52.8: the first production pass showed two money rubrics below the five-source floor"
if anchor not in c:
    raise RuntimeError("migration anchor missing")

migration = r'''// v0.53.0: approved rebuilds for cars and shopping; old data is preserved.
function normalizeApprovedRubricSourcesV0530(ws, plan, quarantineUnknown) {
  const valid = rubricIds(ws), now = new Date().toISOString();
  const normUrl = function(u) {
    try {
      const x = new URL(String(u || ""));
      return (x.hostname.replace(/^www\./i, "") + x.pathname.replace(/\/+$/, "") + x.search).toLowerCase();
    } catch { return ""; }
  };
  const planned = new Map();
  for (const cand of (plan.add || [])) {
    const many = (Array.isArray(cand.rubrics) ? cand.rubrics : (cand.rubric ? [cand.rubric] : []))
      .map(String).filter(function(id){ return valid.has(id); });
    if (many.length) planned.set(normUrl(cand.url), many);
  }
  const assigned = [], paused = [];
  for (const src of (state.sources || [])) {
    if (!src || !src.enabled) continue;
    const exact = planned.get(normUrl(src.url));
    if (exact && exact.length) {
      src.rubric = exact[0];
      src.rubrics = exact.slice();
      src.rubricAssignedAt = now;
      assigned.push(src.name || src.url || src.id);
      continue;
    }
    const known = new Set([String(src.rubric || "")].concat(Array.isArray(src.rubrics) ? src.rubrics.map(String) : []));
    const keep = Array.from(known).filter(function(id){ return valid.has(id); });
    if (keep.length) {
      src.rubric = keep[0];
      src.rubrics = keep;
      continue;
    }
    if (quarantineUnknown) {
      src.enabled = false;
      src.autoPaused = { reason: "не входит в утверждённые рубрики канала (v0.53.0)", at: now };
      paused.push(src.name || src.url || src.id);
    }
  }
  state.rubricLimits = state.rubricLimits && typeof state.rubricLimits === "object" && !Array.isArray(state.rubricLimits)
    ? state.rubricLimits : {};
  for (const r of channelRubrics(ws)) {
    const floor = rubricDefaultMinFor(r.id, ws);
    const current = state.rubricLimits[r.id] && Number(state.rubricLimits[r.id].min);
    if (!Number.isFinite(current) || current < floor) {
      state.rubricLimits[r.id] = { min: floor, at: now, migration: "v0.53.0-approved-rubrics" };
    }
  }
  state.sourceReplenish = state.sourceReplenish && typeof state.sourceReplenish === "object" ? state.sourceReplenish : {};
  state.sourceReplenish.lastAt = "";
  if (state.sourceReplenish.misses) delete state.sourceReplenish.misses.rubric;
  return { assigned: assigned, paused: paused, rubrics: rubricSourceCounts(ws) };
}

setTimeout(function runApprovedAutoShoppingV0530() {
  (async function(){
    for (const ws of workspaceStore.workspaces) {
      if (!ws || !ws.state) continue;
      const channelId = resolveChannelId(ws);
      if (channelId !== "auto" && channelId !== "shopping") continue;
      const migrationKey = "v0.53.0-approved-" + channelId;
      ws.state.migrations = Array.isArray(ws.state.migrations) ? ws.state.migrations : [];
      if (ws.state.migrations.includes(migrationKey)) continue;

      await workspaceContext.run({ workspaceId: ws.id }, async function(){
        const plan = channelId === "auto" ? AUTO_RUBRIC_SOURCES_V0530 : SHOPPING_RUBRIC_SOURCES_V0530;
        const sourceResult = await reworkChannelSources(ws, plan, "v0.53.0");
        const normalized = normalizeApprovedRubricSourcesV0530(ws, plan, channelId === "shopping");
        const schedule = ensureScheduleShape(state);

        if (channelId === "auto") {
          schedule.slots = (schedule.slots || []).filter(function(slot){ return slot && slot.kind !== "blogger"; });
          state.bloggerScheduler = Object.assign({}, state.bloggerScheduler || {}, { targetPerDay: 0, lastPublishedSlot: "" });
        }

        const topups = [];
        const tries = channelId === "shopping" ? 12 : 8;
        for (let i = 0; i < tries; i++) {
          const counts = rubricSourceCounts(ws);
          const short = channelRubrics(ws).filter(function(r){ return (counts[r.id] || 0) < rubricMinFor(r.id, ws); });
          if (!short.length) break;
          state.sourceReplenish.lastAt = "";
          if (state.sourceReplenish.misses) delete state.sourceReplenish.misses.rubric;
          const result = await replenishSources(channelId + "_rubric_balance");
          topups.push({
            attempt: i + 1,
            added: result && Array.isArray(result.added) ? result.added.length : 0,
            after: rubricSourceCounts(ws)
          });
        }

        if (!ws.channelId) ws.channelId = channelId;
        ws.updatedAt = new Date().toISOString();
        persistWorkspaceStore();
        state.migrations.push(migrationKey);
        saveState();

        console.log("APPROVED_CHANNEL_RUBRICS " + JSON.stringify({
          workspace: ws.id,
          channel: channelId,
          rubrics: rubricSourceCounts(ws),
          assigned: normalized.assigned.length,
          paused: normalized.paused.length,
          sourceAdded: sourceResult && sourceResult.added || [],
          topups: topups,
          slots: (schedule.slots || []).map(function(x){ return x.time; })
        }));
      });
    }
  })().catch(function(error){ console.warn("Approved auto/shopping migration failed:", error.message); });
}, 118000);

'''
c = c.replace(anchor, migration + anchor, 1)

path.write_text(c, encoding="utf-8")
print("Applied v0.53 runtime patch")
