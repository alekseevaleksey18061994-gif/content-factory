// Editor's notes per channel (2026-10-03): +3 posts a day for stars, a film-meme lane for kino, Telegram
// channels for games, source refresh for money/tech/science/internet, more varied sport sources.
//   npm run test:channel-notes
process.env.TZ = "UTC";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadServer, inWs, net, mkQueueItem, listHtml } from "./dedupe-harness.js";
import { normalizeTelegramUrl, parseDiscoveryResult } from "../lib/source-quality.js";

const cases = {};
function test(name, fn) { cases[name] = fn; }
const src = (id, url, extra) => Object.assign({ id, name: id, url, enabled: true, group: "media", type: "web", priority: 2 }, extra || {});

test("L1 stars: extra lane 12:30/18:30/21:30 from ANY source, 3 a day; tachki uses regular rubric slots, not the old :30 lane", async () => {
  const t = await loadServer({ fixedNow: "2026-10-03T09:00:00Z", state: { chtotamstars: { sources: [src("s1", "https://stars.ru/news/")] } } });
  assert.deepEqual(inWs(t, "chtotamstars", () => t.bloggerSlotsFor()), ["12:30", "18:30", "21:30"]);
  assert.equal(inWs(t, "chtotamstars", () => t.bloggerTargetFor()), 3);
  assert.equal(inWs(t, "chtotamstars", () => t.bloggerLaneActive()), true, "no blogger sources needed");
  assert.deepEqual(inWs(t, "chtotamtachki", () => t.bloggerSlotsFor()), []);
  // a regular queue item is a candidate for the stars extra lane
  const item = mkQueueItem({ id: "q1", newsId: "n1", sourceId: "s1" });
  t.ws("chtotamstars").state.queue = [item];
  const best = inWs(t, "chtotamstars", () => t.dynamicBestQueueItemRaw("blogger", false));
  assert.equal(best && best.id, "q1");
  // ...but not for a channel without any extra lane
  t.ws("chtotamtech").state.queue = [mkQueueItem({ id: "q2", newsId: "n2" })];
  assert.equal(inWs(t, "chtotamtech", () => t.dynamicBestQueueItemRaw("blogger", false)), null);
});

test("L3 stars at 12:15 MSK: the scheduler prepares the extra slot (no blogger sources needed); 10:15 does nothing extra", async () => {
  const t = await loadServer({ fixedNow: "2026-10-03T09:15:00Z", env: { AUTO_PUBLISH_ENABLED: "true" }, state: { chtotamstars: { sources: [src("s1", "https://stars.ru/news/")] } } });
  net.pages.set("https://stars.ru/news/", listHtml([]));
  const lines = []; const ol = console.log; console.log = (...a) => lines.push(a.join(" "));
  try { await inWs(t, "chtotamstars", () => t.dynamicSchedulerTick()); } finally { console.log = ol; }
  assert.ok(lines.some((l) => l.startsWith("Dynamic scheduler blogger_prepare chtotamstars")), lines.join("\n").slice(0, 500));
});

test("L2 kino: meme lane only once it has meme (blogger) sources; slots 12:30/16:30/20:30", async () => {
  const t = await loadServer({ fixedNow: "2026-10-03T09:00:00Z", state: { chtotamkino: { sources: [src("k1", "https://kino.ru/news/")] } } });
  assert.equal(inWs(t, "chtotamkino", () => t.bloggerLaneActive()), false);
  t.ws("chtotamkino").state.sources.push(src("m1", "https://t.me/s/kinomemes", { group: "blogger" }));
  assert.equal(inWs(t, "chtotamkino", () => t.bloggerLaneActive()), true);
  assert.deepEqual(inWs(t, "chtotamkino", () => t.bloggerSlotsFor()), ["12:30", "16:30", "20:30"]);
  const news = mkQueueItem({ id: "news", newsId: "nn", sourceId: "k1" });
  t.ws("chtotamkino").state.queue = [news];
  assert.equal(inWs(t, "chtotamkino", () => t.dynamicBestQueueItemRaw("blogger", false)), null, "news items stay in the hourly lane");
});

test("P1 channel notes: weak channels' auto sources go on a 24h trial + boost; once only; others untouched", async () => {
  const auto = (id) => src(id, "https://" + id + ".ru/", { autoAdded: { from: "ai" } });
  const t = await loadServer({ fixedNow: "2026-10-03T09:00:00Z", state: {
    chtotamdengi: { sources: [auto("a"), auto("b"), src("manual", "https://manual.ru/"), src("seed1", "https://seed1.ru/", { autoAdded: { from: "seed" } })] },
    chtotamsport: { sources: [auto("c")] },
    chtotamtour: undefined
  } });
  const r = t.applyChannelNotes(t.ws("chtotamdengi"));
  assert.equal(r.trial, 2); assert.equal(r.boost, 15);
  const st = t.ws("chtotamdengi").state;
  assert.ok(st.sources.find((x) => x.id === "a").probationUntil);
  assert.ok(!st.sources.find((x) => x.id === "manual").probationUntil, "editor's own sources are not put on trial");
  assert.ok(!st.sources.find((x) => x.id === "seed1").probationUntil, "starter (seed) sources are not put on trial");
  const a = Date.parse(st.sources.find((x) => x.id === "a").probationUntil), b = Date.parse(st.sources.find((x) => x.id === "b").probationUntil);
  assert.notEqual(a, b, "trials end at different hours (no mass pause in one run)");
  assert.ok(st.sourceBoostUntil, "boost has an end");
  assert.equal(t.applyChannelNotes(t.ws("chtotamdengi")), null, "applied once");
  const sp = t.applyChannelNotes(t.ws("chtotamsport"));
  assert.equal(sp.trial, 0, "sport: no refresh, only more sources"); assert.equal(sp.boost, 15);
  const ai = t.applyChannelNotes(t.ws("ai-main"));
  assert.equal(ai.trial, 0); assert.equal(ai.boost, 0);
});

function fakeDiscovery(t, answers) {
  const inner = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.openai.com/v1/responses")) {
      const body = JSON.parse(init.body);
      const input = String(body.input || "");
      if (input.startsWith("Подбери")) {
        asked.push(input);
        const list = answers(input);
        return new Response(JSON.stringify({ output_text: JSON.stringify({ sources: list }), usage: {} }), { status: 200, headers: { "content-type": "application/json" } });
      }
    }
    return inner(url, init);
  };
  return asked;
}
function tgPage(handle) {
  return "<html>" + [1, 2, 3, 4].map((n) => `<div class="tgme_widget_message_wrap"><div data-post="${handle}/${n}"><div class="tgme_widget_message_text">Свежий пост номер ${n} канала про игры и кино с подписью</div><time datetime="2026-10-03T06:00:00+00:00"></time></div></div>`).join("") + "</html>";
}

test("P2 games: up to 12 Telegram channels via a Telegram-only discovery; kino: meme channels join the lane as blogger", async () => {
  const many = (prefix, n) => Array.from({ length: n }, (_, i) => src(prefix + i, "https://" + prefix + i + ".ru/news/"));
  const t = await loadServer({ fixedNow: "2026-10-03T09:00:00Z", env: { SOURCES_MIN_ACTIVE: "10" }, state: { chtotamgames: { sources: many("g", 12) }, chtotamkino: { sources: many("k", 12) } } });
  const tgCands = Array.from({ length: 16 }, (_, i) => ({ name: "TG " + i, url: "https://t.me/s/chan" + i, group: "media" }));
  for (const c of tgCands) net.pages.set(c.url, tgPage(c.url.split("/s/")[1]));
  const asked = fakeDiscovery(t, () => tgCands);
  const r = await inWs(t, "chtotamgames", () => t.replenishSources("below_target"));
  assert.ok(asked.some((x) => /публичные Telegram-каналы/.test(x) && /игровые новостные Telegram-каналы/.test(x)), asked[0]);
  const games = t.ws("chtotamgames").state.sources.filter((x) => /t\.me\/s\//.test(x.url));
  assert.equal(games.length, 12, JSON.stringify(r).slice(0, 300));
  assert.ok(games.every((x) => x.group === "creator" && x.probationUntil));
  const k = await inWs(t, "chtotamkino", () => t.replenishSources("below_target"));
  const lane = t.ws("chtotamkino").state.sources.filter((x) => x.group === "blogger");
  assert.equal(lane.length, 6, JSON.stringify(k).slice(0, 300));
  assert.ok(asked.some((x) => /мемами и юмором про кино/.test(x)));
  assert.equal(inWs(t, "chtotamkino", () => t.bloggerLaneActive()), true, "the meme lane switches on");
});

test("P3 sport boost: 15 new sources beyond the target, hint about different sports in the prompt", async () => {
  const many = Array.from({ length: 45 }, (_, i) => src("s" + i, "https://s" + i + ".ru/news/"));
  const t = await loadServer({ fixedNow: "2026-10-03T09:00:00Z", env: { SOURCES_MIN_ACTIVE: "40" }, state: { chtotamsport: { sources: many } } });
  const cands = Array.from({ length: 30 }, (_, i) => ({ name: "Спорт " + i, url: "https://sport" + i + ".ru/news/", group: "media" }));
  for (const c of cands) net.pages.set(c.url, listHtml(Array.from({ length: 8 }, (_, n) => ({ href: c.url + "n" + n, text: "Хоккей КХЛ: результаты матча и главные моменты игры номер " + n }))));
  const asked = fakeDiscovery(t, () => cands);
  t.applyChannelNotes(t.ws("chtotamsport"));
  const r = await inWs(t, "chtotamsport", () => t.replenishSources("startup"));
  assert.equal(r.added.length, 15, JSON.stringify(r).slice(0, 200));
  assert.ok(asked.some((x) => /хоккей \(КХЛ, НХЛ\)/.test(x)));
  assert.equal(t.ws("chtotamsport").state.sourceBoostRemaining, 0);
});

test("P4 Telegram links from the model are normalised; 3 empty discoveries -> 24h rest (no paid loop)", async () => {
  assert.equal(normalizeTelegramUrl("https://t.me/kinomemes"), "https://t.me/s/kinomemes");
  assert.equal(normalizeTelegramUrl("t.me/s/kinomemes?before=10"), "https://t.me/s/kinomemes");
  assert.equal(normalizeTelegramUrl("@kino_memes"), "https://t.me/s/kino_memes");
  assert.equal(normalizeTelegramUrl("https://telegram.me/kinomemes/"), "https://t.me/s/kinomemes");
  assert.equal(normalizeTelegramUrl("https://example.ru/news"), "https://example.ru/news");
  assert.equal(parseDiscoveryResult(JSON.stringify({ sources: [{ name: "x", url: "https://t.me/abcd_memes" }] }))[0].url, "https://t.me/s/abcd_memes");
  const t = await loadServer({ fixedNow: "2026-10-03T09:00:00Z", env: { SOURCES_MIN_ACTIVE: "1" }, state: { chtotamgames: { sources: [src("g0", "https://g0.ru/news/")] } } });
  const asked = fakeDiscovery(t, () => []);
  for (let i = 0; i < 6; i++) { t.ws("chtotamgames").state.sourceReplenish = Object.assign({}, t.ws("chtotamgames").state.sourceReplenish, { lastAt: "" }); await inWs(t, "chtotamgames", () => t.replenishSources("below_target")); }
  assert.equal(asked.length, 3, "after 3 empty answers the Telegram discovery rests: " + asked.length);
});

test("P5 v0.51.2: money and shopping get a second source refresh once, even after the v0.50.0 notes ran", async () => {
  const auto = (id) => src(id, "https://" + id + ".ru/", { autoAdded: { from: "ai" } });
  const t = await loadServer({ fixedNow: "2026-10-04T09:00:00Z", state: {
    chtotampokupki: { sources: [auto("p1"), auto("p2")], migrations: ["v0.50.0-channel-notes"] },
    chtotamdengi: { sources: [auto("d1")], migrations: ["v0.50.0-channel-notes"] },
    chtotamsport: { sources: [auto("s1")], migrations: ["v0.50.0-channel-notes"] }
  } });
  const r = t.applyChannelNotes(t.ws("chtotampokupki"));
  assert.equal(r.trial, 2); assert.equal(r.boost, 15); assert.equal(r.migration, "v0.51.2-channel-notes");
  assert.equal(t.applyChannelNotes(t.ws("chtotampokupki")), null, "once");
  assert.equal(t.applyChannelNotes(t.ws("chtotamdengi")).trial, 1);
  assert.equal(t.applyChannelNotes(t.ws("chtotamsport")), null, "other channels untouched");
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
  console.log(failed ? failed + " failed" : "channel-notes tests passed");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
