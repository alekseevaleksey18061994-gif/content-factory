// v0.53.3 (2026-10-05): "needs an official source" skips do not count against a source; money core sources that were
// auto-paused by that are restored; shopping dateless catalogs and failing hosts are switched off.
// npm run test:policy-recovery
process.env.TZ = "UTC";
import assert from "node:assert/strict";
import { loadServer, inWs } from "./dedupe-harness.js";
import { isPolicySkipReason } from "../lib/source-quality.js";

const M = "chtotamdengi", S = "chtotampokupki";
const NOW = "2026-10-05T12:00:00Z";
const src = (id, url, extra) => Object.assign({ id, name: id, url, enabled: true, group: "media", type: "web", priority: 2 }, extra || {});
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("ok - " + name); }

await test("P1 classifier: confirmation rules are the editors', dates / ads / off-topic stay the source's", async () => {
  for (const r of ["недостаточно надёжных источников для подтверждения предупреждения МВД", "изменение правил пособия подтверждено только одним неофициальным источником",
    "срок уплаты налога подтверждён только одним вторичным источником", "нужен официальный источник или два независимых", "правило подтверждено только одним СМИ"]) assert.equal(isPolicySkipReason(r), true, r);
  for (const r of ["не подтверждена свежесть предложения: дата источника отсутствует", "старая новость", "реклама", "не по теме канала", "низкая важность для канала", "слабая находка: рекламная подборка без подтверждения интереса", ""]) assert.equal(isPolicySkipReason(r), false, r);
  // review findings: rumours, clickbait, fakes, partner posts and SEO are the source's fault; "старт" / "дата-центр" are not stale / dateless
  for (const r of ["ненадёжный источник, слухи без подтверждения", "кликбейт, фактов не подтверждено", "фейк: официальный источник опровергает", "партнёрский материал под видом новости; подтверждения нет", "SEO-спам, нет первоисточника", "слишком мелкая новость, не подтверждена"]) assert.equal(isPolicySkipReason(r), false, r);
  for (const r of ["новость про старт продаж, подтверждена только одним СМИ", "дата-центр: нет официального источника", "старая новость, подтверждена только одним СМИ".replace("старая новость, ", "")]) assert.equal(isPolicySkipReason(r), true, r);
  assert.equal(isPolicySkipReason("старая: подтверждена только одним СМИ"), false, "stale wins");
});

await test("P2 noteSourceEvent: a policy skip is not junk; ten of them never pause the source, a real junk still counts", async () => {
  const t = await loadServer({ fixedNow: NOW, state: { [M]: { sources: [src("a", "https://a.example/")] } } });
  t.restoreConsole();
  const ws = t.ws(M);
  inWs(t, M, () => { for (let i = 0; i < 12; i++) t.noteSourceEvent(ws.state.sources[0], "junk", { reason: "изменение подтверждено только одним неофициальным источником" }); });
  const stat = ws.state.sourceStats && Object.values(ws.state.sourceStats)[0] || inWs(t, M, () => t.ensureSourceStat(ws.state.sources[0]));
  assert.equal((stat.recent || []).length, 0, "nothing recorded as outcome");
  assert.equal(Number(stat.junk || 0), 0);
  assert.equal(stat.policySkips, 12);
  inWs(t, M, () => { for (let i = 0; i < 3; i++) t.noteSourceEvent(ws.state.sources[0], "junk", { reason: "реклама" }); });
  assert.equal(inWs(t, M, () => t.ensureSourceStat(ws.state.sources[0])).recent.length, 3);
});

await test("P2b policy skips alone cannot keep a source forever: 30 in a row pause it, a useful news resets the count", async () => {
  const t = await loadServer({ fixedNow: NOW, state: { chtotamtachki: { sources: [src("z", "https://z.example/", { group: "creator" }), src("y", "https://y.example/"), src("x", "https://x.example/"), src("w", "https://w.example/"), src("v", "https://v.example/"), src("u", "https://u.example/")] } } });
  t.restoreConsole();
  const ws = t.ws("chtotamtachki");
  const z = ws.state.sources[0];
  inWs(t, "chtotamtachki", () => { for (let i = 0; i < 29; i++) t.noteSourceEvent(z, "junk", { reason: "слух без источника подтверждения нет".replace("слух без источника ", "недостаточно подтверждений: ") }); });
  assert.equal(inWs(t, "chtotamtachki", () => t.autoPauseWeakSources()).length, 0, "29 is still fine");
  inWs(t, "chtotamtachki", () => { t.noteSourceEvent(z, "useful"); for (let i = 0; i < 29; i++) t.noteSourceEvent(z, "junk", { reason: "недостаточно подтверждений: нужен официальный источник" }); });
  assert.equal(inWs(t, "chtotamtachki", () => t.autoPauseWeakSources()).length, 0, "a useful news resets the streak");
  inWs(t, "chtotamtachki", () => { t.noteSourceEvent(z, "junk", { reason: "подтверждено только одним неофициальным источником" }); });
  const paused = inWs(t, "chtotamtachki", () => t.autoPauseWeakSources());
  assert.equal(paused.length, 1);
  assert.match(paused[0].reason, /30 новостей подряд пропущены/);
});

await test("P3 money: curated sources paused by the 10-junk rule in the last 48 h come back; AI-added, old and other pauses stay off", async () => {
  const fresh = new Date(Date.parse(NOW) - 6 * 3600000).toISOString();
  const old = new Date(Date.parse(NOW) - 5 * 86400000).toISOString();
  const pauseJunk = (at) => ({ reason: "10 новостей подряд отсеяны: реклама, старьё или не по теме", at });
  const t = await loadServer({ fixedNow: NOW, state: { [M]: { sources: [
    src("seedA", "https://a.example/", { enabled: false, autoPaused: pauseJunk(fresh), autoAdded: { from: "seed", at: old } }),
    src("noAdd", "https://b.example/", { enabled: false, autoPaused: pauseJunk(fresh) }),
    src("aiX", "https://c.example/", { enabled: false, autoPaused: pauseJunk(fresh), autoAdded: { from: "ai-rubric", at: fresh } }),
    src("oldP", "https://d.example/", { enabled: false, autoPaused: pauseJunk(old) }),
    src("errP", "https://e.example/", { enabled: false, autoPaused: { reason: "сайт не открывается 12 проверок подряд", at: fresh } }),
    src("on", "https://f.example/")
  ] } } });
  t.restoreConsole();
  const ws = t.ws(M);
  inWs(t, M, () => { for (const s of ws.state.sources) t.ensureSourceStat(s).recent = ["junk", "junk"]; });
  const r = inWs(t, M, () => t.recoverPolicyPausedSourcesV0533(ws));
  assert.deepEqual(r.restored.sort(), ["noAdd", "seedA"]);
  const on = (id) => ws.state.sources.find((x) => x.id === id).enabled;
  assert.deepEqual(["seedA", "noAdd", "aiX", "oldP", "errP", "on"].map(on), [true, true, false, false, false, true]);
  assert.equal(inWs(t, M, () => t.ensureSourceStat(ws.state.sources[0])).recent.length, 0, "streak reset");
  assert.equal(ws.state.sources[0].autoPaused, undefined);
  // idempotent: a second run restores nothing
  assert.deepEqual(inWs(t, M, () => t.recoverPolicyPausedSourcesV0533(ws)).restored, []);
  assert.ok(ws.state.sources[0].recoveredAt, "grace marker for the theme rule");
});

await test("P4 shopping: the dateless catalog and failing hosts are switched off; healthy ones, Telegram and other channels are untouched", async () => {
  const t = await loadServer({ fixedNow: NOW, state: { [S]: { sources: [
    src("kl", "https://kladskidok.ru/"),
    src("pep", "https://www.pepper.ru/search?q=ozon"),
    src("pepok", "https://www.pepper.ru/search?q=wb"),
    src("bf", "https://www.buzzfeed.com/shopping"),
    src("tg", "https://t.me/s/nashlawb"),
    src("other", "https://shop.example/news")
  ] }, [M]: { sources: [src("kl2", "https://kladskidok.ru/")] } } });
  t.restoreConsole();
  const ws = t.ws(S);
  inWs(t, S, () => { t.ensureSourceStat(ws.state.sources[1]).errorStreak = 30; t.ensureSourceStat(ws.state.sources[3]).errorStreak = 9; t.ensureSourceStat(ws.state.sources[2]).errorStreak = 1; });
  const r = inWs(t, S, () => t.recoverPolicyPausedSourcesV0533(ws));
  assert.deepEqual(r.paused.sort(), ["bf", "kl", "pep"]);
  assert.deepEqual(ws.state.sources.map((x) => x.enabled), [false, false, true, false, true, true]);
  assert.ok(ws.state.sourceBlockedHosts.includes("kladskidok.ru"));
  assert.ok(ws.state.sourceBlockedHosts.includes("pepper.ru") && ws.state.sourceBlockedHosts.includes("buzzfeed.com"), "failing hosts are not re-discovered");
  assert.ok(!ws.state.sourceBlockedHosts.includes("trendhunter.com"), "only hosts that were actually paused");
  // another channel is never touched
  const m = t.ws(M);
  assert.deepEqual(inWs(t, M, () => t.recoverPolicyPausedSourcesV0533(m)).paused, []);
  assert.equal(m.state.sources[0].enabled, true);
});

await test("P5 v0.54.2: paused Pepper sources are re-enabled and unblocked; other paused sources stay off", async () => {
  const t = await loadServer({ fixedNow: NOW, state: { [S]: { sourceBlockedHosts: ["pepper.ru", "kladskidok.ru"], sources: [
    src("pep1", "https://www.pepper.ru/search?q=ozon", { enabled: false, autoPaused: { reason: "сайт не открывается", at: NOW } }),
    src("pep2", "https://www.pepper.ru/search?q=aliexpress", { enabled: false, autoPaused: { reason: "x", at: NOW } }),
    src("klad", "https://kladskidok.ru/", { enabled: false, autoPaused: { reason: "каталог без дат", at: NOW } }),
    src("tg", "https://t.me/s/ozonru")
  ] } } });
  t.restoreConsole();
  const ws = t.ws(S);
  const restored = inWs(t, S, () => t.restorePepperSourcesV0542());
  assert.deepEqual(restored.sort(), ["pep1", "pep2"]);
  const on = (id) => ws.state.sources.find((x) => x.id === id).enabled;
  assert.deepEqual(["pep1", "pep2", "klad", "tg"].map(on), [true, true, false, true]);
  assert.deepEqual(ws.state.sourceBlockedHosts, ["kladskidok.ru"]);
  assert.ok(ws.state.sources[0].recoveredAt);
  assert.deepEqual(inWs(t, S, () => t.restorePepperSourcesV0542()), [], "second run restores nothing");
});

console.log("policy-recovery tests passed (" + passed + ")");
process.exit(0);
