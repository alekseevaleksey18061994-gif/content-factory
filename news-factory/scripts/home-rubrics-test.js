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
  const t = await loadServer({ fixedNow: msk(14, 0), state: { [H]: { sources: [] } } });
  const ws = t.ws(H);
  // every theme has 4 sources except kitchen (1)
  for (const r of channelStrategy("home").rubrics) {
    const n = r.id === "kitchen" ? 1 : 4;
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

test("H7 scorecard: good / weak verdicts; a weak themed source older than 7 days is replaced (max 2 per run)", async () => {
  const t = await loadServer({ fixedNow: msk(14, 0), state: { [H]: { sources: [] } } });
  const ws = t.ws(H);
  const old = new Date(Date.parse(msk(14, 0)) - 10 * 86400000).toISOString();
  ws.state.sources = [
    src("good", "https://good.example/", { rubric: "storage", autoAdded: { at: old, from: "ai" } }),
    src("w1", "https://w1.example/", { rubric: "storage", autoAdded: { at: old, from: "ai" } }),
    src("w2", "https://w2.example/", { rubric: "kitchen", autoAdded: { at: old, from: "ai" } }),
    src("w3", "https://w3.example/", { rubric: "kitchen", autoAdded: { at: old, from: "ai" } }),
    src("fresh", "https://fresh.example/", { rubric: "kitchen", autoAdded: { at: msk(12, 0), from: "ai" } })
  ];
  ws.state.sourceStats = { good: { useful: 8, junk: 4, mediaGood: 9, mediaBad: 1 }, w1: { useful: 1, junk: 12 }, w2: { useful: 0, junk: 0 }, w3: { useful: 0, junk: 0 }, fresh: {} };
  ws.state.history = [1, 2, 3].map((n) => ({ id: "h" + n, publishedAt: msk(10, n), sourceId: "good", contentBucket: "storage", views: 1000 + n }));
  const rows = inWs(t, H, () => t.buildSourceRankings());
  const card = (id) => rows.find((r) => r.id === id).scorecard;
  assert.equal(card("good").verdict, "Хороший");
  assert.equal(card("good").topicHit, 1);
  assert.equal(card("good").avgViews, 1002);
  assert.equal(card("w1").verdict, "Слабый");
  assert.equal(card("fresh").verdict, "Собираем данные");
  const paused = await quiet(() => inWs(t, H, () => t.autoPauseWeakSources())).then(() => ws.state.sources.filter((x) => !x.enabled).map((x) => x.id));
  assert.equal(paused.length, 2, JSON.stringify(paused));
  assert.ok(!paused.includes("good") && !paused.includes("fresh"));
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
