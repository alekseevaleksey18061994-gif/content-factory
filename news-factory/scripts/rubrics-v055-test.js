// v0.55.0: «по группам» для десяти каналов, удаление Покупок/Науки/Мира, полные названия.
// npm run test:rubrics-v055
process.env.TZ = "UTC";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SOURCES_V055 } from "../lib/channel-sources-v055.js";
import { loadServer, inWs, mkQueueItem } from "./dedupe-harness.js";
import { channelStrategy } from "../lib/channel-dna.js";
import { RUBRIC_PLAN_V055, REMOVED_CHANNELS_V055, CHANNEL_NAME_TAILS_V055, RUBRICS_V055_MIGRATION, classifySourceV055, shouldRestoreAutoPausedV055, isRubricsV055Channel } from "../lib/channel-rubrics-v055.js";

const cases = {};
function test(name, fn) { cases[name] = fn; }
const msk = (hh, mm) => `2026-10-06T${String(hh - 3).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`;
const src = (id, name, url, extra) => Object.assign({ id, name, url, enabled: true, group: "media", type: "web", priority: 2 }, extra || {});
const CHANNELS = [
  ["ai-main", "ai", "Что там у ИИ?"], ["chtotamtech", "tech", "Что там у технологий?"], ["chtotamkino", "kino", "Что там в кино?"],
  ["chtotampokupki", "shopping", "Что там с покупками?"], ["chtotamnauka", "science", "Что там у науки?"], ["chtotamnews", "world", "Что там в интернете?"]
];

test("R1 plan: quotas add up to the slots, ids are unique, min 5 sources, no maximum, no hard slot rubrics", async () => {
  const expected = { ai: 12, tech: 15, games: 14, kino: 14, sport: 16, stars: 14, travel: 14, food: 15, business: 12, crypto: 12, money: 8, home: 10, auto: 15 };
  for (const [ch, n] of Object.entries(expected)) {
    const plan = RUBRIC_PLAN_V055[ch];
    const st = channelStrategy(ch);
    const ids = st.rubrics.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, ch + " ids");
    assert.equal(st.rubrics.reduce((s, r) => s + r.perDay, 0), n, ch + " perDay sum");
    assert.equal(st.slotHours.length, n, ch + " slot hours");
    assert.ok(st.slotHours.every((h) => h >= 8 && h <= 23));
    assert.equal(st.rubricMinSources, 5);
    assert.ok(st.rubricMaxSources >= 500, "no practical maximum");
    assert.equal(st.unifiedSlots, true);
    assert.deepEqual(st.slotRubrics, {}, "soft quotas only");
    assert.deepEqual(Object.keys(st.mix).sort(), ids.slice().sort(), "writer buckets = rubrics");
    if (!["money", "home", "auto"].includes(ch)) assert.ok(CHANNEL_NAME_TAILS_V055[ch], ch + " name tail");
    assert.ok(plan.rubrics.length >= 6);
  }
  // money/home/auto keep their original rubric ids (existing source tags stay valid)
  assert.deepEqual(channelStrategy("money").rubrics.map((r) => r.id), ["cards_banks","deposits","credits_mortgage","taxes","ruble_inflation_cb","income_benefits","financial_scams","money_howto"]);
  assert.equal(channelStrategy("home").rubrics.length, 10);
  assert.equal(channelStrategy("auto").rubrics.length, 8);
  for (const ch of ["shopping", "science", "world"]) assert.equal(isRubricsV055Channel(ch), false);
});

test("R2 classifier: keywords sort sources, bloggers go to the blogger rubric, unknown stay untagged", async () => {
  assert.deepEqual(classifySourceV055("tech", { name: "iPhone новости", url: "https://x.example/iphone", group: "media" })[0], "smartphones");
  assert.deepEqual(classifySourceV055("tech", { name: "Любой блогер", url: "https://youtube.example/c", group: "blogger" }), ["tech_bloggers"]);
  assert.deepEqual(classifySourceV055("tech", { name: "Zzz", url: "https://zzz.example/", group: "media" }), []);
  assert.deepEqual(classifySourceV055("shopping", { name: "iphone", url: "https://x.example/", group: "media" }), []);
  assert.equal(classifySourceV055("sport", { name: "UFC Россия", url: "https://t.me/s/ufc", group: "media" }).includes("ufc_mma"), true);
});

test("R3 restore rule: only recent pauses that were not about the topic", async () => {
  const now = Date.parse(msk(12, 0));
  const mk = (reason, hoursAgo) => ({ enabled: false, autoPaused: { reason, at: new Date(now - hoursAgo * 3600000).toISOString() } });
  assert.equal(shouldRestoreAutoPausedV055(mk("почти все новости отклонены редактором", 20), now, 4 * 86400000), true);
  assert.equal(shouldRestoreAutoPausedV055(mk("не по теме канала (пересборка источников v0.43.0)", 20), now, 4 * 86400000), false);
  assert.equal(shouldRestoreAutoPausedV055(mk("сайт не открывается из нашей сети (5 проверок подряд)", 20), now, 4 * 86400000), false);
  assert.equal(shouldRestoreAutoPausedV055(mk("слабый источник", 24 * 9), now, 4 * 86400000), false, "old pauses stay");
  assert.equal(shouldRestoreAutoPausedV055({ enabled: true, autoPaused: { reason: "x", at: new Date(now).toISOString() } }, now, 4 * 86400000), false);
});

test("R4 migration: removes the three channels (archived), renames, tags, restores; runs once; default channel is safe", async () => {
  const t = await loadServer({ fixedNow: msk(12, 0), channels: CHANNELS, state: {
    "chtotamtech": { sources: [
      src("a", "Apple iPhone", "https://t.me/s/iphone_news"),
      src("b", "Блогер про технику", "https://youtube.example/b", { group: "blogger" }),
      src("c", "Прочее", "https://other.example/"),
      src("p", "Ошибочная пауза", "https://paused.example/", { enabled: false, autoPaused: { reason: "почти все новости отклонены", at: new Date(Date.parse(msk(8, 0))).toISOString() } }),
      src("q", "Не по теме", "https://offtopic.example/", { enabled: false, autoPaused: { reason: "не по теме канала (пересборка источников v0.43.0)", at: new Date(Date.parse(msk(8, 0))).toISOString() } })
    ] }
  } });
  await t.runRubricsV055();
  const ids = t.workspaceStore.workspaces.map((w) => w.id).sort();
  assert.deepEqual(ids.filter((id) => id !== "chtotamtachki"), ["ai-main", "chtotamkino", "chtotamtech"]); // the harness always adds the cars channel
  for (const id of REMOVED_CHANNELS_V055) assert.ok(!t.getWorkspaceById(id));
  const archive = fs.readdirSync(path.join(t.dir, "archive"));
  assert.equal(archive.length, 3, "state archived before removal");
  const tech = t.ws("chtotamtech");
  assert.equal(tech.name, "Что там у технологий? | смартфоны, гаджеты, приложения");
  assert.equal(tech.channelId, "tech");
  assert.ok(tech.state.migrations.includes(RUBRICS_V055_MIGRATION));
  const by = (id) => tech.state.sources.find((s) => s.id === id);
  assert.equal(by("a").rubric, "smartphones");
  assert.equal(by("b").rubric, "tech_bloggers");
  assert.equal(by("c").rubric, undefined, "unknown source keeps working untagged");
  assert.equal(by("c").enabled, true);
  assert.equal(by("p").enabled, true, "falsely paused source is back");
  assert.ok(by("p").recoveredAt);
  assert.equal(by("q").enabled, false, "off-topic pause stays");
  const ai = t.ws("ai-main");
  assert.equal(ai.name, "Что там у ИИ? | нейросети и ИИ");
  // idempotent
  await t.runRubricsV055();
  assert.equal(t.ws("chtotamtech").name, "Что там у технологий? | смартфоны, гаджеты, приложения");
  assert.ok(!t.workspaceStore.workspaces.some((w) => REMOVED_CHANNELS_V055.includes(w.id)));
  // a name that already has a tail is not extended
  const kino = t.ws("chtotamkino");
  assert.equal(kino.name, "Что там в кино? | кино и сериалы");
});

test("R5 gating: before the migration nothing changes; after it channel runs one hourly stream", async () => {
  const t = await loadServer({ fixedNow: msk(12, 0), channels: CHANNELS });
  assert.equal(inWs(t, "chtotamkino", () => t.channelSlotHours()), null);
  assert.equal(inWs(t, "chtotamkino", () => t.channelUnifiedSlots()), false);
  assert.ok(inWs(t, "chtotamkino", () => t.channelExtraLane()), "old kino lane until migrated");
  await t.runRubricsV055();
  assert.equal(inWs(t, "chtotamkino", () => t.channelSlotHours()).length, 14);
  assert.equal(inWs(t, "chtotamkino", () => t.channelUnifiedSlots()), true);
  assert.equal(inWs(t, "chtotamkino", () => t.channelExtraLane()), null);
  assert.equal(inWs(t, "chtotamkino", () => t.channelDailyMax()), 14);
  const sched = inWs(t, "chtotamkino", () => t.ensureScheduleShape(t.state));
  assert.ok(!sched.slots.some((s) => s.kind === "blogger" || s.kind === "russian-ai"), "no :30 lane slots in the calendar");
  assert.equal(sched.slots.length, 14);
});

test("R6 soft quota: a rubric with its daily quota filled waits, but never leaves the slot empty; bloggers compete in regular slots", async () => {
  const t = await loadServer({ fixedNow: msk(14, 0), channels: CHANNELS, state: { chtotamtech: { sources: [src("blog", "Блогер", "https://yt.example/b", { group: "blogger", rubric: "tech_bloggers" })] } } });
  await t.runRubricsV055();
  const ws = t.ws("chtotamtech");
  ws.state.history = [1, 2, 3].map((i) => ({ id: "h" + i, title: "x", publishedAt: msk(9 + i, 2), contentBucket: "smartphones" }));
  ws.state.queue = [
    mkQueueItem({ id: "phone", newsId: "n1", aiScore: 99, contentBucket: "smartphones" }),
    mkQueueItem({ id: "apps", newsId: "n2", aiScore: 60, contentBucket: "apps" })
  ];
  assert.equal(inWs(t, "chtotamtech", () => t.dynamicBestQueueItemRaw("", false)).id, "apps", "smartphones quota (3) is full");
  ws.state.queue = ws.state.queue.filter((q) => q.id === "phone");
  assert.equal(inWs(t, "chtotamtech", () => t.dynamicBestQueueItemRaw("", false)).id, "phone", "never an empty slot");
  // under quota (2 of 3): the stronger smartphone post wins again
  ws.state.history = ws.state.history.slice(0, 2);
  ws.state.queue = [mkQueueItem({ id: "phone", newsId: "n1", aiScore: 99, contentBucket: "smartphones" }), mkQueueItem({ id: "apps", newsId: "n2", aiScore: 60, contentBucket: "apps" })];
  assert.equal(inWs(t, "chtotamtech", () => t.dynamicBestQueueItemRaw("", false)).id, "phone");
  // a blogger post is eligible in a regular slot of a unified channel
  ws.state.queue = [mkQueueItem({ id: "bl", newsId: "n3", aiScore: 80, sourceId: "blog", sourceName: "Блогер" })];
  assert.equal(inWs(t, "chtotamtech", () => t.dynamicBestQueueItemRaw("", false)).id, "bl");
});

test("R7 recovery never brings the removed channels back", async () => {
  const t = await loadServer({ fixedNow: msk(12, 0), channels: CHANNELS });
  await t.runRubricsV055();
  const def = t.getWorkspaceById(t.workspaceStore.defaultWorkspaceId);
  def.state.migrations = def.state.migrations.filter((m) => m !== "v0.46.1-workspace-recovery");
  await t.recoverMissingWorkspaces();
  for (const id of REMOVED_CHANNELS_V055) assert.ok(!t.getWorkspaceById(id), id + " must stay removed");
});

test("R8 classifier does not match inside other words (Washington / method / second)", async () => {
  assert.deepEqual(classifySourceV055("crypto", { name: "Washington Post", url: "https://washingtonpost.example/", group: "media" }), []);
  assert.deepEqual(classifySourceV055("crypto", { name: "X", url: "https://x.example/method-second-section", group: "media" }), []);
  assert.ok(classifySourceV055("crypto", { name: "Ethereum news", url: "https://x.example/", group: "media" }).includes("eth_ton"));
  assert.ok(classifySourceV055("crypto", { name: "Toncoin", url: "https://x.example/", group: "media" }).includes("eth_ton"));
});

test("R9 stale :30 lane reservations are dropped when a channel becomes unified", async () => {
  const t = await loadServer({ fixedNow: msk(10, 0), channels: CHANNELS, state: { chtotamkino: { sources: [src("a", "a", "https://a.example/")] } } });
  const ws = t.ws("chtotamkino");
  ws.state.queue = [mkQueueItem({ id: "x", newsId: "nx", aiScore: 90, reservedFor: "2026-10-06 12:30" })];
  inWs(t, "chtotamkino", () => { const sc = t.ensureScheduleShape(t.state); sc.assignments["2026-10-06"] = { "12:30": "x" }; });
  await t.runRubricsV055();
  inWs(t, "chtotamkino", () => t.ensureScheduleShape(t.state));
  const sc = ws.state.publicationSchedule;
  assert.equal(sc.assignments["2026-10-06"] && sc.assignments["2026-10-06"]["12:30"], undefined);
  assert.equal(ws.state.queue[0].reservedFor, undefined);
  assert.equal(inWs(t, "chtotamkino", () => t.dynamicBestQueueItemRaw("", false)).id, "x", "the post is free again");
});

test("R10 startup survives persisted calendar assignments (TDZ regression: DYNAMIC_ASSIGNMENT_GRACE_MIN)", async () => {
  const t = await loadServer({ fixedNow: msk(12, 0), channels: CHANNELS, state: { chtotamtech: {
    queue: [mkQueueItem({ id: "x", newsId: "nx" })],
    publicationSchedule: { timezone: "Europe/Moscow", assignments: { "2026-10-06": { "13:00": "x", "09:30": "x" }, "2026-10-05": { "10:00": "x" } }, suppressed: {}, slots: [{ time: "13:00", kind: "dynamic" }, { time: "09:30", kind: "blogger" }] }
  } } });
  assert.ok(t.ws("chtotamtech"), "server loaded with persisted assignments");
});

test("R11 starting sources: every rubric of the 10 channels has at least 6 candidates, valid shape, no duplicates", async () => {
  for (const [ch, plan] of Object.entries(RUBRIC_PLAN_V055)) {
    const list = SOURCES_V055[ch];
    assert.ok(list && list.length >= 30, ch + " has candidates");
    const urls = new Set();
    const count = {};
    for (const x of list) {
      assert.ok(/^https:\/\//.test(x.url), x.url);
      assert.ok(x.name && ["media", "creator", "blogger", "official"].includes(x.group));
      assert.ok(x.rubrics.length >= 1 && x.rubrics.length <= 3);
      const key = x.url.replace(/\/+$/, "").toLowerCase();
      assert.ok(!urls.has(key), "duplicate " + x.url); urls.add(key);
      for (const r of x.rubrics) count[r] = (count[r] || 0) + 1;
    }
    for (const item of plan.rubrics) assert.ok((count[item.rubric.id] || 0) >= 6, ch + "/" + item.rubric.id + " has " + (count[item.rubric.id] || 0));
    for (const r of Object.keys(count)) assert.ok(plan.rubrics.some((x) => x.rubric.id === r), "unknown rubric " + r);
  }
});

async function main() {
  const only1 = process.argv[2];
  if (only1) {
    const name = Object.keys(cases).find((n) => n === only1 || n.startsWith(only1 + " "));
    if (!name) throw new Error("unknown case " + only1);
    await cases[name]();
    process.exit(0);
  }
  let failed = 0;
  for (const name of Object.keys(cases)) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name.split(" ")[0]], { env: Object.assign({}, process.env, { TZ: "UTC" }), encoding: "utf8", timeout: 180000 });
    if (r.status === 0) console.log("ok - " + name);
    else { failed += 1; console.log("FAIL - " + name + "\n" + String(r.stderr || r.stdout).split("\n").filter((l) => !/^    at/.test(l)).slice(0, 25).join("\n")); }
  }
  console.log(failed ? failed + " failed" : "rubrics-v055 tests passed");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
