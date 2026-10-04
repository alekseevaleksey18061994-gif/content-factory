// «Что там для дома?» (2026-10-04): 10 themes, one post a day each, 10 own hours, sources per theme with a theme-by-theme
// search, source scorecard. npm run test:home-rubrics
process.env.TZ = "UTC";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadServer, inWs, net, mkQueueItem, listHtml, setNow } from "./dedupe-harness.js";
import { HOME_RUBRIC_SOURCES_V0513, channelStrategy } from "../lib/channel-dna.js";

const cases = {};
function test(name, fn) { cases[name] = fn; }
const H = "chtotamhome"; // the harness id of «Что там для дома?» (production: chtotamdom)
const src = (id, url, extra) => Object.assign({ id, name: id, url, enabled: true, group: "media", type: "web", priority: 2 }, extra || {});
const msk = (hh, mm) => `2026-10-04T${String(hh - 3).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`;
function quiet(fn) {
  const lines = []; const o = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a) => lines.push(a.join(" "));
  return Promise.resolve().then(fn).finally(() => Object.assign(console, o)).then(() => lines);
}

test("H1 home: 10 themes, 10 own hours, daily max 10; other channels keep 08–23", async () => {
  const st = channelStrategy("home");
  assert.equal(st.rubrics.length, 10);
  assert.equal(Object.keys(st.mix).length, 10);
  assert.deepEqual(st.rubrics.map((r) => r.id).sort(), Object.keys(st.mix).sort(), "themes = writer's buckets");
  const t = await loadServer({ fixedNow: msk(9, 0) });
  assert.equal(inWs(t, H, () => t.channelDailyMax()), 10);
  assert.equal(inWs(t, H, () => t.isChannelSlotHour(11)), false);
  assert.equal(inWs(t, H, () => t.isChannelSlotHour(12)), true);
  assert.equal(inWs(t, "chtotamtech", () => t.channelSlotHours()), null);
  assert.equal(inWs(t, "chtotamtech", () => t.isChannelSlotHour(11)), true);
});

test("H2 one post per theme a day: an untouched theme beats a stronger post of a theme already posted today; excluded buckets never", async () => {
  const t = await loadServer({ fixedNow: msk(14, 0) });
  const ws = t.ws(H);
  ws.state.history = [{ id: "h1", title: "x", publishedAt: msk(10, 2), contentBucket: "marketplace_finds" }];
  ws.state.queue = [
    mkQueueItem({ id: "rep", newsId: "n1", aiScore: 99, contentBucket: "marketplace_finds" }),
    mkQueueItem({ id: "new", newsId: "n2", aiScore: 55, contentBucket: "storage" }),
    mkQueueItem({ id: "re", newsId: "n3", aiScore: 100, contentBucket: "real_estate" })
  ];
  assert.equal(inWs(t, H, () => t.dynamicBestQueueItemRaw("", false)).id, "new");
  // only the repeat is left -> it still fills the slot
  ws.state.queue = ws.state.queue.filter((q) => q.id !== "new");
  assert.equal(inWs(t, H, () => t.dynamicBestQueueItemRaw("", false)).id, "rep");
  ws.state.queue = ws.state.queue.filter((q) => q.id === "re");
  assert.equal(inWs(t, H, () => t.dynamicBestQueueItemRaw("", false)), null, "real estate never in home");
});

test("H3 theme of a post falls back to its source's theme when the writer gave a non-theme bucket", async () => {
  const t = await loadServer({ fixedNow: msk(14, 0), state: { [H]: { sources: [src("k1", "https://kitchen.example/", { rubric: "kitchen" })] } } });
  const it = mkQueueItem({ id: "q", sourceId: "k1", contentBucket: "news" });
  assert.equal(inWs(t, H, () => t.itemRubric(it)), "kitchen");
  assert.equal(inWs(t, H, () => t.itemRubric(mkQueueItem({ contentBucket: "diy_repair", sourceId: "k1" }))), "diy_repair");
  assert.equal(inWs(t, "chtotamtech", () => t.itemRubric(it)), "", "no themes in other channels");
});

test("H4 scheduler: home prepares and posts only in its own hours (no 11:00 post, 12:00 yes)", async () => {
  const t = await loadServer({ fixedNow: msk(10, 50), env: { AUTO_PUBLISH_ENABLED: "true" }, state: { [H]: { mode: "AUTO", sources: [src("a", "https://a.example/")] } } });
  net.pages.set("https://a.example/", listHtml([]));
  setNow(msk(10, t.prepMinuteFor(H)));
  let lines = await quiet(() => inWs(t, H, () => t.dynamicSchedulerTick()));
  assert.ok(!lines.some((l) => l.startsWith("Dynamic scheduler prepare " + H)), "no preparation for 11:00: " + lines.join("\n").slice(0, 300));
  setNow(msk(11, t.prepMinuteFor(H)));
  lines = await quiet(() => inWs(t, H, () => t.dynamicSchedulerTick()));
  assert.ok(lines.some((l) => l.startsWith("Dynamic scheduler prepare " + H)), lines.join("\n").slice(0, 300));
  setNow(msk(11, t.publishMinuteFor(H)));
  const r = await quiet(() => inWs(t, H, () => t.publishDynamicSlot())).then(() => null);
  const res = await inWs(t, H, () => t.publishDynamicSlot());
  assert.equal(res.skipped, "not_channel_slot");
  // catch-up skips home at 11:xx
  setNow(msk(11, 20));
  lines = await quiet(() => t.catchUpCurrentRegularSlotAllWorkspaces());
  assert.ok(!lines.some((l) => l.includes("SCHEDULER_CATCHUP_START") && l.includes(H)));
});

test("H5 theme search: the theme with the fewest sources gets its own discovery; new sources carry the theme", async () => {
  const t = await loadServer({ fixedNow: msk(14, 0), state: { [H]: { sources: [], migrations: ["v0.51.3-home-rubrics"] } } });
  const ws = t.ws(H);
  // every theme has 5 sources except kitchen (1)
  for (const r of channelStrategy("home").rubrics) {
    const n = r.id === "kitchen" ? 1 : 5;
    for (let i = 0; i < n; i++) ws.state.sources.push(src(r.id + i, "https://" + r.id + i + ".example/", { rubric: r.id }));
  }
  const cands = Array.from({ length: 10 }, (_, i) => ({ name: "Kitchen " + i, url: "https://kitchensite" + i + ".ru/news/", group: "media" }));
  for (const c of cands) net.pages.set(c.url, listHtml(Array.from({ length: 8 }, (_, n) => ({ href: c.url + "n" + n, text: "Кухонный гаджет и посуда: новинка для кухни номер " + n }))));
  const inner = globalThis.fetch; const asked = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.openai.com/v1/responses")) {
      const input = String(JSON.parse(init.body).input || "");
      if (input.startsWith("Подбери")) { asked.push(input); return new Response(JSON.stringify({ output_text: JSON.stringify({ sources: cands }), usage: {} }), { status: 200, headers: { "content-type": "application/json" } }); }
    }
    return inner(url, init);
  };
  // before the theme migration ran nothing is searched (the start-up race)
  ws.state.migrations = [];
  await quiet(() => inWs(t, H, () => t.replenishSources("startup")));
  assert.equal(asked.length, 0, "waits for the migration");
  ws.state.migrations = ["v0.51.3-home-rubrics"];
  ws.state.sourceReplenish = Object.assign({}, ws.state.sourceReplenish, { lastAt: "" });
  const lines = await quiet(() => inWs(t, H, () => t.replenishSources("below_target")));
  assert.ok(asked.some((x) => /Кухня и посуда/.test(x)), asked.join("\n").slice(0, 400));
  const counts = inWs(t, H, () => t.rubricSourceCounts());
  assert.equal(counts.kitchen, 6, JSON.stringify(counts) + "\n" + lines.join("\n").slice(0, 400));
  const ks = ws.state.sources.filter((x) => /kitchensite/.test(x.url));
  assert.ok(ks.every((x) => x.rubric === "kitchen"), JSON.stringify(ks.map((x) => [x.url, x.rubric, x.autoAdded && x.autoAdded.from])) + lines.join("\n").slice(0, 600));
});

test("H6 source migration: off-topic paused + blocked, existing kept sources get their theme, new ones are tagged", async () => {
  const t = await loadServer({ fixedNow: msk(14, 0), state: { [H]: { sources: [
    src("re", "https://realty.rbc.ru/news/"), src("zh", "https://gkhnews.ru/"), src("salon", "https://www.salon.ru/news")
  ] } } });
  const add = HOME_RUBRIC_SOURCES_V0513.add.slice(0, 2);
  for (const c of add) net.pages.set(c.url, "<html>" + [1, 2, 3, 4].map((n) => `<div class="tgme_widget_message_wrap"><div data-post="x/${n}"><div class="tgme_widget_message_text">Находка для дома номер ${n}: удобная вещь для кухни и хранения</div><time datetime="2026-10-04T06:00:00+00:00"></time></div></div>`).join("") + "</html>");
  const plan = Object.assign({}, HOME_RUBRIC_SOURCES_V0513, { add });
  const r = await quiet(() => inWs(t, H, () => t.reworkChannelSources(t.ws(H), plan, "v0.51.3"))).then(() => null);
  const st = t.ws(H).state;
  assert.equal(st.sources.find((x) => x.id === "re").enabled, false);
  assert.equal(st.sources.find((x) => x.id === "zh").enabled, false, "ЖКХ is out");
  assert.equal(st.sources.find((x) => x.id === "salon").rubric, "interior_trends");
  const added = st.sources.filter((x) => add.some((a) => a.url === x.url));
  assert.equal(added.length, 2);
  assert.ok(added.every((x) => x.rubric === "marketplace_finds"));
});

test("H7 scorecard: good / weak verdicts; a weak themed source is replaced only after 2 weeks, one per run, never below the theme minimum", async () => {
  const t = await loadServer({ fixedNow: msk(14, 0), state: { [H]: { sources: [] } } });
  const ws = t.ws(H);
  const ago = (d) => new Date(Date.parse(msk(14, 0)) - d * 86400000).toISOString();
  const s6 = ["good", "w1", "w2", "w3", "w4", "w5"].map((id) => src(id, "https://" + id + ".example/", { rubric: "storage", autoAdded: { at: ago(20), from: "ai" } }));
  ws.state.sources = s6.concat([
    src("fresh", "https://fresh.example/", { rubric: "kitchen", autoAdded: { at: msk(12, 0), from: "ai" } }),
    src("nodate", "https://nodate.example/", { rubric: "kitchen" })
  ]);
  ws.state.sourceStats = { good: { useful: 8, junk: 4, mediaGood: 9, mediaBad: 1 }, w1: { useful: 1, junk: 12 } };
  ws.state.history = [1, 2, 3].map((n) => ({ id: "h" + n, publishedAt: msk(10, n), sourceId: "good", contentBucket: "storage", views: 1000 + n }));
  const rows = inWs(t, H, () => t.buildSourceRankings());
  const card = (id) => rows.find((r) => r.id === id).scorecard;
  assert.equal(card("good").verdict, "Хороший");
  assert.equal(card("good").topicHit, 1);
  assert.equal(card("good").avgViews, 1002);
  assert.equal(card("w1").verdict, "Слабый");
  assert.equal(card("fresh").verdict, "Собираем данные");
  assert.equal(card("nodate").verdict, "Собираем данные", "a source of unknown age is never judged");
  const off = () => ws.state.sources.filter((x) => !x.enabled).map((x) => x.id);
  await quiet(() => inWs(t, H, () => t.autoPauseWeakSources()));
  assert.equal(off().length, 1, "one per run: " + off());
  for (let i = 0; i < 5; i++) await quiet(() => inWs(t, H, () => t.autoPauseWeakSources()));
  const storageLeft = ws.state.sources.filter((x) => x.enabled && x.rubric === "storage").length;
  assert.equal(storageLeft, 5, "never below the theme minimum (5)");
  assert.ok(ws.state.sources.find((x) => x.id === "good").enabled);
});

test("H8 the editor re-enables a theme-paused source: it stays on (14 days)", async () => {
  const t = await loadServer({ fixedNow: msk(14, 0), state: { [H]: { sources: [] } } });
  const ws = t.ws(H);
  const ago = new Date(Date.parse(msk(14, 0)) - 20 * 86400000).toISOString();
  ws.state.sources = ["a", "b", "c", "d", "e", "f"].map((id) => src(id, "https://" + id + ".example/", { rubric: "storage", autoAdded: { at: ago, from: "ai" } }));
  await quiet(() => inWs(t, H, () => t.autoPauseWeakSources()));
  const paused = ws.state.sources.find((x) => !x.enabled);
  assert.ok(paused);
  paused.enabled = true; paused.editorEnabledAt = new Date(Date.parse(msk(14, 0))).toISOString(); delete paused.autoPaused;
  for (let i = 0; i < 3; i++) await quiet(() => inWs(t, H, () => t.autoPauseWeakSources()));
  assert.ok(paused.enabled, "the editor's choice wins");
});

test("H9 theme search: one miss counter for all themes (3 empty searches -> rest); a starving theme channel grows its thinnest theme", async () => {
  const t = await loadServer({ fixedNow: msk(14, 0), env: { SOURCE_REPLENISH_INTERVAL_MINUTES: "1" }, state: { [H]: { sources: [], migrations: ["v0.51.3-home-rubrics"] } } });
  const ws = t.ws(H);
  for (const r of channelStrategy("home").rubrics) for (let i = 0; i < 5; i++) ws.state.sources.push(src(r.id + i, "https://" + r.id + i + ".example/", { rubric: r.id }));
  const inner = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.openai.com/v1/responses") && String(JSON.parse(init.body).input || "").startsWith("Подбери")) { calls++; return new Response(JSON.stringify({ output_text: JSON.stringify({ sources: [] }), usage: {} }), { status: 200, headers: { "content-type": "application/json" } }); }
    return inner(url, init);
  };
  // all themes at or above the minimum: no search
  await quiet(() => inWs(t, H, () => t.replenishSources("below_target")));
  assert.equal(calls, 0);
  // starving: make kitchen the thinnest theme (4 active); empty answers rest after 3
  ws.state.sources.find((x) => x.rubric === "kitchen").enabled = false;
  ws.state.sourceStarvingRuns = 5;
  for (let i = 0; i < 6; i++) { ws.state.sourceReplenish = Object.assign({}, ws.state.sourceReplenish, { lastAt: "" }); await quiet(() => inWs(t, H, () => t.replenishSources("starving"))); }
  assert.equal(calls, 3, "shared counter: " + calls);
});

test("H10 calendar offers home only its 10 hours; curated sources are not put on trial by the notes step", async () => {
  const t = await loadServer({ fixedNow: msk(14, 0), state: { [H]: { sources: [src("cur", "https://t.me/s/alexis_home", { autoAdded: { at: msk(12, 0), from: "dna" } }), src("ai1", "https://ai1.example/", { autoAdded: { at: msk(12, 0), from: "ai" } })], migrations: ["v0.50.0-channel-notes", "v0.51.2-channel-notes"] } } });
  const sch = inWs(t, H, () => t.ensureScheduleShape(t.ws(H).state));
  const hourly = (sch.slots || []).filter((x) => /:00$/.test(x.time) && x.kind !== "blogger" && x.kind !== "russian-ai").map((x) => Number(x.time.slice(0, 2)));
  assert.deepEqual(hourly, [9, 10, 12, 13, 15, 17, 18, 19, 21, 22]);
  const other = inWs(t, "chtotamtech", () => t.ensureScheduleShape(t.ws("chtotamtech").state));
  assert.equal((other.slots || []).filter((x) => /:00$/.test(x.time)).length, 16);
  const r = t.applyChannelNotes(t.ws(H));
  assert.equal(r.migration, "v0.51.3-channel-notes");
  assert.equal(t.ws(H).state.sources.find((x) => x.id === "cur").probationUntil, undefined, "curated list stays");
  assert.ok(t.ws(H).state.sources.find((x) => x.id === "ai1").probationUntil);
  assert.equal(t.ws(H).state.sourceBoostRemaining, 0, "no generic boost for home");
});

test("H11 per-group minimum: the editor's limit drives the theme search, auto-pause and validation; the ceiling follows it", async () => {
  const t = await loadServer({ fixedNow: msk(14, 0), env: { SOURCE_REPLENISH_INTERVAL_MINUTES: "1" }, state: { [H]: { sources: [], migrations: ["v0.51.3-home-rubrics"] } } });
  const ws = t.ws(H);
  for (const r of channelStrategy("home").rubrics) for (let i = 0; i < 5; i++) ws.state.sources.push(src(r.id + i, "https://" + r.id + i + ".example/", { rubric: r.id }));
  const call = (fn) => inWs(t, H, fn);
  assert.equal(call(() => t.rubricMinFor("storage")), 5, "default");
  // validation
  assert.equal(call(() => t.setRubricLimit("nope", 5)).ok, false);
  assert.equal(call(() => t.setRubricLimit("storage", 0)).ok, false);
  assert.equal(call(() => t.setRubricLimit("storage", 21)).ok, false);
  assert.equal(call(() => t.setRubricLimit("storage", "abc")).ok, false);
  assert.equal(ws.state.rubricLimits, undefined, "bad input stores nothing");
  // raise storage to 8: the ceiling (6) rises with it, the group shows up as short and is searched
  ws.state.sourceReplenish = { lastAt: new Date().toISOString(), misses: { rubric: { count: 0, until: new Date(Date.now() + 86400000).toISOString() } } };
  assert.equal(call(() => t.setRubricLimit("storage", 8)).ok, true);
  assert.equal(call(() => t.rubricMinFor("storage")), 8);
  assert.equal(call(() => t.rubricMaxFor("storage")), 8, "ceiling never below the minimum");
  assert.equal(call(() => t.rubricMaxFor("kitchen")), 6, "other groups untouched");
  assert.equal(ws.state.sourceReplenish.lastAt, "", "throttle cleared by the editor's change");
  assert.equal(ws.state.sourceReplenish.misses.rubric, undefined, "rest cleared by the editor's change");
  const asked = []; const inner = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.openai.com/v1/responses") && String(JSON.parse(init.body).input || "").startsWith("Подбери")) { asked.push(String(JSON.parse(init.body).input)); return new Response(JSON.stringify({ output_text: JSON.stringify({ sources: [] }), usage: {} }), { status: 200, headers: { "content-type": "application/json" } }); }
    return inner(url, init);
  };
  await quiet(() => call(() => t.replenishSources("rubric_limit_changed")));
  assert.equal(asked.length, 1);
  assert.ok(/Хранение/.test(asked[0]), "the short group is searched: " + asked[0].slice(0, 200));
  // groups info for the admin
  const info = call(() => t.rubricGroupsInfo());
  const st = info.find((x) => x.id === "storage");
  assert.deepEqual([st.active, st.min, st.max, st.custom], [5, 8, 8, true]);
  assert.equal(info.find((x) => x.id === "kitchen").custom, false);
  assert.equal(info.length, 10);
  // lowering a minimum never switches anything off; auto-pause may now trim down to the lower minimum but not below
  assert.equal(call(() => t.setRubricLimit("kitchen", 2)).ok, true);
  assert.equal(ws.state.sources.filter((x) => x.enabled && x.rubric === "kitchen").length, 5);
  const ago = new Date(Date.parse(msk(14, 0)) - 20 * 86400000).toISOString();
  for (const x of ws.state.sources.filter((y) => y.rubric === "kitchen")) x.autoAdded = { at: ago, from: "ai" };
  for (let i = 0; i < 8; i++) await quiet(() => call(() => t.autoPauseWeakSources()));
  assert.equal(ws.state.sources.filter((x) => x.enabled && x.rubric === "kitchen").length, 2, "stops at the editor's minimum, not at 4");
  // a raised minimum protects the group: storage (min 8, 5 active) is never trimmed
  for (const x of ws.state.sources.filter((y) => y.rubric === "storage")) x.autoAdded = { at: ago, from: "ai" };
  for (let i = 0; i < 4; i++) await quiet(() => call(() => t.autoPauseWeakSources()));
  assert.equal(ws.state.sources.filter((x) => x.enabled && x.rubric === "storage").length, 5);
});

test("H13 v0.52.4 source cleanup: active untagged source is quarantined, known URL is assigned, all rubric floors become 5", async () => {
  const t = await loadServer({ fixedNow: msk(14, 0), state: { [H]: {
    sources: [
      src("unknown", "https://generic.example/news"),
      src("salon", "https://www.salon.ru/news"),
      src("ok", "https://ok.example/", { rubric: "storage" })
    ],
    rubricLimits: { storage: { min: 4 }, kitchen: { min: 7 } }
  } } });
  const ws = t.ws(H);
  const result = inWs(t, H, () => t.normalizeHomeRubricSourcesV0524(ws));

  assert.ok(result.paused.includes("unknown"));
  assert.equal(ws.state.sources.find((x) => x.id === "unknown").enabled, false, "untagged source cannot stay active");
  assert.equal(ws.state.sources.find((x) => x.id === "salon").rubric, "interior_trends", "known source gets its exact rubric");
  assert.equal(ws.state.sources.find((x) => x.id === "ok").enabled, true);
  assert.equal(inWs(t, H, () => t.rubricMinFor("storage")), 5, "old lower custom minimum is lifted");
  assert.equal(inWs(t, H, () => t.rubricMinFor("kitchen")), 7, "higher editor minimum is preserved");
  for (const r of channelStrategy("home").rubrics) assert.ok(inWs(t, H, () => t.rubricMinFor(r.id)) >= 5, r.id);
});

test("H12 review fixes: groups take turns (an unfillable group does not starve the others); the same limit or a rapid re-save triggers no extra paid search", async () => {
  const t = await loadServer({ fixedNow: msk(14, 0), env: { SOURCE_REPLENISH_INTERVAL_MINUTES: "1" }, state: { [H]: { sources: [], migrations: ["v0.51.3-home-rubrics"] } } });
  const ws = t.ws(H);
  for (const r of channelStrategy("home").rubrics) for (let i = 0; i < (r.id === "kitchen" ? 0 : 10); i++) ws.state.sources.push(src(r.id + i, "https://" + r.id + i + ".example/", { rubric: r.id }));
  const call = (fn) => inWs(t, H, fn);
  assert.equal(call(() => t.setRubricLimit("storage", 20)).ok, true);
  const asked = []; const inner = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.openai.com/v1/responses") && String(JSON.parse(init.body).input || "").startsWith("Подбери")) { asked.push(String(JSON.parse(init.body).input)); return new Response(JSON.stringify({ output_text: JSON.stringify({ sources: [] }), usage: {} }), { status: 200, headers: { "content-type": "application/json" } }); }
    return inner(url, init);
  };
  // storage (min 20, 10 active) and kitchen (min 5, 0 active) are both short: they alternate instead of storage winning forever
  for (let i = 0; i < 2; i++) { ws.state.sourceReplenish = Object.assign({}, ws.state.sourceReplenish, { lastAt: "", misses: {} }); await quiet(() => call(() => t.replenishSources("below_target"))); }
  assert.equal(asked.length, 2);
  assert.ok(asked.some((x) => /Кухня и посуда/.test(x)), "kitchen got its turn: " + asked.map((x) => x.slice(0, 60)).join(" | "));
  assert.ok(asked.some((x) => /Хранение/.test(x)), "storage too");
  // an unchanged limit: no reset, no search
  const same = call(() => t.setRubricLimit("storage", 20));
  assert.deepEqual([same.ok, same.changed, same.search], [true, false, false]);
  // a changed limit searches once, a second change within 10 minutes does not search again
  ws.state.sourceReplenish.editorSearchAt = "";
  const a = call(() => t.setRubricLimit("storage", 12));
  assert.deepEqual([a.changed, a.search], [true, true]);
  const b = call(() => t.setRubricLimit("storage", 13));
  assert.deepEqual([b.changed, b.search], [true, false], "cooldown: saved, but no extra paid search");
  assert.equal(call(() => t.rubricMinFor("storage")), 13);
  // a hostile id never lands in the limits
  for (const bad of ["__proto__", "constructor", "toString"]) assert.equal(call(() => t.setRubricLimit(bad, 5)).ok, false);
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
    else { failed += 1; console.log("FAIL - " + name + "\n" + String(r.stderr || r.stdout).split("\n").filter((l) => !/^    at/.test(l)).slice(0, 20).join("\n")); }
  }
  console.log(failed ? failed + " failed" : "home-rubrics tests passed");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
