// Offline regression tests for the dedupe / freshness / stuck-source audit fixes.
// Each case runs in its own process (the server module keeps global state). Cases that need PostgreSQL use a
// throw-away local cluster (TEST_DATABASE_URL overrides it) and are skipped when none can be started.
//   npm run test:dedupe            all cases
//   node scripts/dedupe-test.js A1 run one case
process.env.TZ = "UTC";   // production runs in UTC; naive-timestamp cases depend on it
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadServer, inWs, net, articleHtml, listHtml, LONG, mkQueueItem, dbRows, startTempPostgres, CH, setNow } from "./dedupe-harness.js";

const ART = "https://www.rbc.ru/business/02/10/2026/abc123";
const TITLE = "Роспатент отменил товарный знак «Балерина Капучино»";
const BODY = "Роспатент признал недействительной регистрацию товарного знака «Балерина Капучино» после иска правообладателей. Решение вступило в силу, производители товаров с таким названием обязаны сменить бренд." + LONG;
const src = (id, url, extra) => Object.assign({ id, name: id, url: url || "https://www.rbc.ru/business/", enabled: true, group: "media", type: "web", priority: 2 }, extra || {});
const iso = (hAgo) => new Date(Date.now() - hAgo * 3600e3).toISOString();
const collect = (t, ws, trig) => inWs(t, ws, () => t.collectOnce(trig || "slot-prep"));
const writerCalls = () => net.log.filter((x) => x.role === "writer").length;

const cases = {};
function test(name, opts, fn) { cases[name] = { opts, fn }; }

// ---------------------------------------------------------------------------------------------------------------
// A. news_items.id collides across workspaces
test("A1 same article in two channels: second insert does not hit news_items_pkey, nothing loops", { db: true }, async () => {
  const t = await loadServer({ db: true, fixedNow: "2026-10-02T09:00:00Z", env: { CROSS_CHANNEL_DEDUPE_ENABLED: "false" },
    state: { chtotampokupki: { sources: [src("rbc-shop")] }, chtotambusiness: { sources: [src("rbc-biz")] } } });
  net.pages.set("https://www.rbc.ru/business/", listHtml([{ href: ART, text: TITLE + " — РБК" }]));
  net.pages.set(ART, articleHtml({ title: TITLE, date: "2026-10-02T06:00:00+03:00", body: BODY }));
  const r1 = await collect(t, "chtotampokupki");
  const r2 = await collect(t, "chtotambusiness");
  assert.deepEqual(r1.errors, []);
  assert.deepEqual(r2.errors, [], "second channel must not fail with a pkey conflict: " + JSON.stringify(r2.errors));
  const rows = await dbRows("select workspace_id, id, status from news_items order by workspace_id");
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].id, rows[1].id, "ids are scoped to the workspace");
  const before = t.ws("chtotambusiness").state.queue.length;
  await collect(t, "chtotambusiness"); await collect(t, "chtotambusiness");
  assert.equal(t.ws("chtotambusiness").state.queue.length, before, "no copies pile up on later ticks");
  assert.equal(before, 1);
});

test("A2 failed news_items write: nothing is queued", { db: true }, async () => {
  const t = await loadServer({ db: true, fixedNow: "2026-10-02T09:00:00Z", env: { CROSS_CHANNEL_DEDUPE_ENABLED: "false" }, state: { chtotampokupki: { sources: [src("rbc-shop")] } } });
  net.pages.set("https://www.rbc.ru/business/", listHtml([{ href: ART, text: TITLE + " — РБК" }]));
  net.pages.set(ART, articleHtml({ title: TITLE, date: "2026-10-02T06:00:00+03:00", body: BODY }));
  const orig = t.db.query.bind(t.db);
  let fail = true;
  t.db.query = (sql, ...a) => (fail && /INSERT INTO news_items/.test(String(sql))) ? Promise.reject(Object.assign(new Error("boom"), { code: "23505" })) : orig(sql, ...a);
  for (let i = 0; i < 5; i++) await collect(t, "chtotampokupki");
  assert.equal(t.ws("chtotampokupki").state.queue.length, 0, "post must not be queued without its DB row");
  assert.ok(writerCalls() <= 3, "retries are bounded (writer calls: " + writerCalls() + ")");
});

// ---------------------------------------------------------------------------------------------------------------
// B. deterministic cross-channel dedupe
const twoChannelState = () => ({ chtotampokupki: { sources: [src("rbc-shop")] }, chtotambusiness: { sources: [src("rbc-biz")] } });
function twoChannelPages() {
  net.pages.set("https://www.rbc.ru/business/", listHtml([{ href: ART, text: TITLE + " — РБК" }]));
  net.pages.set(ART, articleHtml({ title: TITLE, date: "2026-10-02T06:00:00+03:00", body: BODY }));
}

test("B1 same article already queued by another channel is skipped, writer not called", { db: true }, async () => {
  const t = await loadServer({ db: true, fixedNow: "2026-10-02T09:00:00Z", state: twoChannelState() });
  twoChannelPages();
  await collect(t, "chtotampokupki");
  const calls = writerCalls();
  const r2 = await collect(t, "chtotambusiness"); await collect(t, "chtotambusiness");
  assert.equal(t.ws("chtotambusiness").state.queue.length, 0, "second channel must not queue the same article");
  assert.equal(writerCalls(), calls, "no writer/checker spend on the duplicate");
  assert.equal(t.ws("chtotampokupki").state.queue.length, 1);
  assert.equal(r2.found, 0);
  assert.deepEqual((await dbRows("select workspace_id from news_items")).map((r) => r.workspace_id), ["chtotampokupki"]);
});

test("B2 two channels processing the same article in parallel: only one wins", {}, async () => {
  const t = await loadServer({ fixedNow: "2026-10-02T09:00:00Z", state: twoChannelState() });
  twoChannelPages();
  const w0 = net.llm.writer;
  net.llm.writer = async (r) => { await new Promise((res) => setTimeout(res, 120)); return w0(r); };
  await Promise.all([collect(t, "chtotampokupki"), collect(t, "chtotambusiness")]);
  const total = t.ws("chtotampokupki").state.queue.length + t.ws("chtotambusiness").state.queue.length;
  assert.equal(total, 1, "exactly one channel gets the article, got " + total);
});

test("B3 same content under a different URL is caught by the content hash", {}, async () => {
  const t = await loadServer({ fixedNow: "2026-10-02T09:00:00Z", state: {
    chtotampokupki: { sources: [src("a", "https://a.example/")] }, chtotambusiness: { sources: [src("b", "https://b.example/")] } } });
  net.pages.set("https://a.example/", listHtml([{ href: "https://a.example/news/1", text: TITLE + " — A" }]));
  net.pages.set("https://b.example/", listHtml([{ href: "https://b.example/other/2", text: TITLE + " — B" }]));
  net.pages.set("https://a.example/news/1", articleHtml({ title: TITLE, date: iso(2), body: BODY }));
  net.pages.set("https://b.example/other/2", articleHtml({ title: TITLE, date: iso(2), body: BODY }));
  await collect(t, "chtotampokupki"); await collect(t, "chtotambusiness");
  assert.equal(t.ws("chtotampokupki").state.queue.length, 1);
  assert.equal(t.ws("chtotambusiness").state.queue.length, 0);
});

test("B4 published elsewhere: recorded as seen; queued copy is never published", { db: true }, async () => {
  const t = await loadServer({ db: true, autoPublish: true, fixedNow: "2026-10-02T09:00:00Z", state: {
    chtotampokupki: { history: [{ id: "h1", title: "x", text: "y", publishedAt: iso(3), sourceUrl: ART + "?utm_source=tg" }] },
    chtotambusiness: { sources: [src("rbc-biz")] } } });
  twoChannelPages();
  await collect(t, "chtotambusiness");
  assert.equal(t.ws("chtotambusiness").state.queue.length, 0);
  const rows = await dbRows("select status, metadata->>'autoPublishBlocked' b from news_items where workspace_id='chtotambusiness'");
  assert.deepEqual(rows, [{ status: "duplicate_story", b: "cross_channel_duplicate" }], "recorded as seen so it is not re-fetched");
  // a copy that was queued before the check existed
  const q = mkQueueItem({ id: "q_copy", sourceUrl: ART, title: "copy", articlePublishedAt: iso(3) });
  t.ws("chtotambusiness").state.queue = [q];
  assert.equal(await inWs(t, "chtotambusiness", async () => t.dynamicBestQueueItem()), null, "not selectable for a slot");
  const day = t.moscowDateKey(new Date());
  const sched = await inWs(t, "chtotambusiness", async () => t.ensureScheduleShape(t.state));
  sched.assignments[day] = { "12:00": "q_copy" };
  const r = await inWs(t, "chtotambusiness", () => t.publishDynamicSlot());
  assert.equal(r.skipped, "cross_channel_duplicate");
  assert.equal(t.ws("chtotambusiness").state.queue.length, 0);
});

test("B5 network_recent shows every other channel (per-channel cap) and approved queue items", {}, async () => {
  const t = await loadServer({ fixedNow: "2026-10-02T12:00:00Z" });
  for (const [id] of CH) {
    t.ws(id).state.history = Array.from({ length: 6 }, (_, i) => ({ id: id + i, title: "Пост " + id + " №" + i, text: "x", publishedAt: iso(i + 1) }));
  }
  t.ws("chtotamcrypto").state.queue = [mkQueueItem({ title: "В очереди крипта" }), mkQueueItem({ title: "Отклонён", qcStatus: "hold", editorialV2: { status: "hold", verdict: "reject" } })];
  for (const me of ["chtotambusiness", "chtotampokupki", "chtotamcrypto", "ai-main"]) {
    const out = await inWs(t, me, async () => t.editorialNetworkRecent());
    const seen = new Set(out.map((x) => x.channel_id));
    const missing = CH.map((c) => c[1]).filter((c) => c !== CH.find((x) => x[0] === me)[1] && !seen.has(c));
    assert.deepEqual(missing, [], me + " must see every other channel");
    if (me !== "chtotamcrypto") {
      assert.ok(out.some((x) => x.title === "В очереди крипта" && x.status === "queued"), "approved queue item listed");
      assert.ok(!out.some((x) => x.title === "Отклонён"), "held item is not a published-to-be twin");
    }
  }
});

test("B6 URL normalization and the off switch", {}, async () => {
  const t = await loadServer({ fixedNow: "2026-10-02T09:00:00Z" });
  const n = t.normalizeArticleUrl;
  assert.equal(n("https://www.RBC.ru/a/b/?utm_source=x&fbclid=1#top"), n("http://rbc.ru/a/b"));
  assert.notEqual(n("https://rbc.ru/a/b?id=1"), n("https://rbc.ru/a/b?id=2"));
  assert.equal(n("mailto:x@y.z"), "");
});

test("B7 CROSS_CHANNEL_DEDUPE_ENABLED=false keeps the old behaviour (own angle per channel)", {}, async () => {
  const t = await loadServer({ fixedNow: "2026-10-02T09:00:00Z", env: { CROSS_CHANNEL_DEDUPE_ENABLED: "false" }, state: twoChannelState() });
  twoChannelPages();
  await collect(t, "chtotampokupki"); await collect(t, "chtotambusiness");
  assert.equal(t.ws("chtotambusiness").state.queue.length, 1);
});

// ---------------------------------------------------------------------------------------------------------------
// C. a stale / short / dead link must not shadow the fresh links behind it
const FRESH_T = "Аэрофлот открыл рейсы в Дубай из трёх новых городов";
test("C1 stale first link is recorded as seen and the fresh link behind it opens in the same run", { db: true }, async () => {
  const t = await loadServer({ db: true, fixedNow: "2026-10-02T12:00:00Z", state: { chtotamtravel: { sources: [src("t1", "https://travel.example/")] } } });
  const STALE = "https://travel.example/news/pinned-old", FRESH = "https://travel.example/news/fresh-today";
  net.pages.set("https://travel.example/", listHtml([{ href: STALE, text: "Главный материал недели: итоги прошлогоднего сезона отпусков" }, { href: FRESH, text: FRESH_T }]));
  const fetched = [];
  net.pages.set(STALE, () => { fetched.push("STALE"); return articleHtml({ title: "Итоги прошлогоднего сезона", date: iso(60), body: "Старый материал. " + LONG }); });
  net.pages.set(FRESH, () => { fetched.push("FRESH"); return articleHtml({ title: FRESH_T, date: iso(2), body: FRESH_T + ". " + LONG }); });
  const r1 = await collect(t, "chtotamtravel");
  assert.equal(t.ws("chtotamtravel").state.queue.length, 1, "fresh story queued in the first run: " + JSON.stringify(r1));
  await collect(t, "chtotamtravel"); await collect(t, "chtotamtravel");
  assert.equal(fetched.filter((x) => x === "STALE").length, 1, "stale page is fetched once, then recorded as seen");
  const rows = await dbRows("select status, metadata->>'skipReason' r from news_items order by status");
  assert.ok(rows.some((r) => r.r === "stale_article"), JSON.stringify(rows));
});

test("C2 short page and dead link are recorded, next links open", { db: true }, async () => {
  const t = await loadServer({ db: true, fixedNow: "2026-10-02T12:00:00Z", state: { chtotamfood: { sources: [src("f1", "https://food.example/")] }, chtotamhome: { sources: [src("h1", "https://home.example/")] } } });
  net.pages.set("https://food.example/", listHtml([{ href: "https://food.example/news/gone", text: "Рецепт недели: утка по-пекински в домашних условиях" }, { href: "https://food.example/news/ok", text: "В Москве открылся новый ресторан грузинской кухни" }]));
  net.pages.set("https://food.example/news/gone", () => new Response("gone", { status: 404, headers: { "content-type": "text/html" } }));
  net.pages.set("https://food.example/news/ok", articleHtml({ title: "ok", date: iso(2), body: LONG }));
  net.pages.set("https://home.example/", listHtml([{ href: "https://home.example/news/gallery", text: "Фотогалерея: интерьеры недели в скандинавском стиле" }, { href: "https://home.example/news/ok", text: "Как выбрать робот-пылесос для квартиры с животными" }]));
  net.pages.set("https://home.example/news/gallery", articleHtml({ title: "Галерея", date: iso(1), body: "Фото." }));
  net.pages.set("https://home.example/news/ok", articleHtml({ title: "ok2", date: iso(2), body: LONG }));
  await collect(t, "chtotamfood"); await collect(t, "chtotamhome");
  assert.equal(t.ws("chtotamfood").state.queue.length, 1);
  assert.equal(t.ws("chtotamhome").state.queue.length, 1);
  const rows = await dbRows("select metadata->>'skipReason' r from news_items where metadata->>'skipReason' is not null order by 1");
  assert.deepEqual(rows.map((r) => r.r), ["fetch_failed", "too_short"]);
});

test("C3 transient download failure is retried a bounded number of times", {}, async () => {
  const t = await loadServer({ fixedNow: "2026-10-02T12:00:00Z", state: { chtotamtravel: { sources: [src("t1", "https://travel.example/")] } } });
  const U = "https://travel.example/news/flaky";
  net.pages.set("https://travel.example/", listHtml([{ href: U, text: "Аэрофлот открыл рейсы в Дубай из трёх новых городов" }]));
  net.pages.set(U, () => new Response("err", { status: 503, headers: { "content-type": "text/html" } }));
  await collect(t, "chtotamtravel"); await collect(t, "chtotamtravel");
  assert.equal(await inWs(t, "chtotamtravel", () => t.seenOriginalUrl(U)), false, "still retried after two failures");
  await collect(t, "chtotamtravel");
  assert.equal(await inWs(t, "chtotamtravel", () => t.seenOriginalUrl(U)), true, "given up after SKIP_RETRY_MAX attempts");
});

// E. a transient writer error must not lose the article
test("E1 writer outage: article is retried on later ticks, lost only after the retry budget", { db: true }, async () => {
  const t = await loadServer({ db: true, fixedNow: "2026-10-02T09:00:00Z", state: { chtotamcrypto: { sources: [src("x", "https://x.example/")] } } });
  net.pages.set("https://x.example/", listHtml([{ href: "https://x.example/n1", text: "Крупнейшая биржа запустила торговлю новым токеном на спотовом рынке" }]));
  net.pages.set("https://x.example/n1", articleHtml({ title: "Биржа запустила торговлю токеном", date: "2026-10-02T07:00:00Z", body: LONG }));
  let fail = true; const ok = net.llm.writer;
  net.llm.writer = (req) => { if (fail) throw new Error("429 Rate limit reached (TPM)"); return ok(req); };
  await collect(t, "chtotamcrypto"); await collect(t, "chtotamcrypto");
  assert.deepEqual(await dbRows("select 1 from news_items"), [], "not recorded as lost after transient errors");
  fail = false;
  const r3 = await collect(t, "chtotamcrypto");
  assert.equal(r3.queued, 1, "article is processed once the writer is healthy again");
  assert.equal(t.ws("chtotamcrypto").state.queue.length, 1);
});

test("E2 persistent writer error ends as rewrite_error after the retry budget", { db: true }, async () => {
  const t = await loadServer({ db: true, fixedNow: "2026-10-02T09:00:00Z", state: { chtotamcrypto: { sources: [src("x", "https://x.example/")] } } });
  net.pages.set("https://x.example/", listHtml([{ href: "https://x.example/n1", text: "Крупнейшая биржа запустила торговлю новым токеном на спотовом рынке" }]));
  net.pages.set("https://x.example/n1", articleHtml({ title: "Биржа запустила торговлю токеном", date: "2026-10-02T07:00:00Z", body: LONG }));
  net.llm.writer = () => { throw new Error("boom"); };
  for (let i = 0; i < 5; i++) await collect(t, "chtotamcrypto");
  assert.deepEqual((await dbRows("select status from news_items")).map((r) => r.status), ["rewrite_error"]);
  assert.equal(writerCalls() <= 3 * 4, true, "bounded: " + writerCalls());
});

// F. freshness
test("F1 72-hour channels accept 30h-old articles, 24-hour channels do not", {}, async () => {
  const t = await loadServer({ fixedNow: "2026-10-02T12:00:00Z", state: { chtotamworld: { sources: [src("w", "https://world.example/")] }, chtotamtech: { sources: [src("a", "https://a.example/")] } } });
  const T1 = "Учёные нашли древний город под песками пустыни Гоби";
  net.pages.set("https://world.example/", listHtml([{ href: "https://world.example/news/old", text: T1 }]));
  net.pages.set("https://world.example/news/old", articleHtml({ title: T1, date: iso(30), body: T1 + ". " + LONG }));
  const T2 = "Apple представила новый iPad Pro с чипом M6";
  net.pages.set("https://a.example/", listHtml([{ href: "https://a.example/news/x", text: T2 }]));
  net.pages.set("https://a.example/news/x", articleHtml({ title: T2, date: iso(30), body: T2 + ". " + LONG }));
  await collect(t, "chtotamworld"); await collect(t, "chtotamtech");
  assert.equal(t.ws("chtotamworld").state.queue.length, 1, "world: 30h < 72h");
  assert.equal(t.ws("chtotamtech").state.queue.length, 0, "tech: 30h > 24h");
  const item = t.ws("chtotamworld").state.queue[0];
  assert.ok(await inWs(t, "chtotamworld", async () => t.dynamicBestQueueItem()), "30h-old item is still selectable for a slot in a 72h channel");
  t.ws("chtotamtech").state.queue = [Object.assign({}, item, { id: "q_t", newsId: "news_t" })];
  assert.equal(await inWs(t, "chtotamtech", async () => t.dynamicBestQueueItem()), null, "same item is stale for a 24h channel");
  // queue life scales too: a 20h-old queue entry survives in world, not in tech
  const old = (id) => mkQueueItem({ id, createdAt: iso(20), articlePublishedAt: iso(21) });
  t.ws("chtotamworld").state.queue = [old("w1")]; t.ws("chtotamtech").state.queue = [old("t1")];
  await inWs(t, "chtotamworld", async () => t.pruneQueueItems(t.state)); await inWs(t, "chtotamtech", async () => t.pruneQueueItems(t.state));
  assert.equal(t.ws("chtotamworld").state.queue.length, 1); assert.equal(t.ws("chtotamtech").state.queue.length, 0);
});

test("F2 naive timestamps of Russian sites are Moscow time", {}, async () => {
  const t = await loadServer({ fixedNow: "2026-10-02T10:00:00Z", state: { chtotamtech: { sources: [src("a", "https://a.ru/")] } } });
  assert.equal(t.normalizeDate("2026-10-01T11:30:00", { assumeMoscow: true }), "2026-10-01T08:30:00.000Z");
  assert.equal(t.normalizeDate("2026-10-01T11:30:00+05:00", { assumeMoscow: true }), "2026-10-01T06:30:00.000Z", "explicit offsets win");
  assert.equal(t.normalizeDate("2026-10-01T11:30:00"), "2026-10-01T11:30:00.000Z", "non-Russian sites keep the old reading");
  const T = "Apple представила новый iPad Pro с чипом M6";
  net.pages.set("https://a.ru/", listHtml([{ href: "https://a.ru/news/x1", text: T }]));
  net.pages.set("https://a.ru/news/x1", articleHtml({ title: T, date: "2026-10-01T11:30:00", body: T + ". " + LONG }));   // really 25.5h old
  await collect(t, "chtotamtech");
  assert.equal(t.ws("chtotamtech").state.queue.length, 0, "25.5h-old article is stale for a 24h channel");
});

test("F3 undated articles: stale year dropped, others kept short and flagged", {}, async () => {
  const t = await loadServer({ fixedNow: "2026-10-02T10:00:00Z", state: { chtotamkino: { sources: [src("k", "https://k.example/")] } } });
  const OSCAR = "Итоги кинопремии «Оскар 2024»: полный список победителей";
  net.pages.set("https://k.example/", listHtml([{ href: "https://k.example/news/y1", text: OSCAR }, { href: "https://k.example/news/y2", text: "Вышел первый трейлер нового сезона популярного сериала" }]));
  net.pages.set("https://k.example/news/y1", articleHtml({ title: OSCAR, date: "", body: OSCAR + LONG }));
  const T2 = "Вышел первый трейлер нового сезона популярного сериала";
  net.pages.set("https://k.example/news/y2", articleHtml({ title: T2, date: "", body: T2 + ". " + LONG }));
  const w = []; const w0 = net.llm.writer; net.llm.writer = (r) => { w.push(r.sources[0].title + "|" + r.sources[0].date); return w0(r); };
  await collect(t, "chtotamkino");
  const q = t.ws("chtotamkino").state.queue;
  assert.equal(q.length, 1);
  assert.ok(!/Оскар/.test(w.join()), "the 2024 page never reaches the writer");
  assert.equal(q[0].articleDateUnknown, true);
  assert.ok(t.dynamicItemMaxAgeMs(q[0]) <= 12 * 3600e3, "undated item gets a short life");
  q[0].createdAt = iso(13);
  assert.equal(await inWs(t, "chtotamkino", async () => t.dynamicBestQueueItem()), null, "13h-old undated item is no longer used");
});

// ---------------------------------------------------------------------------------------------------------------
// D. merge / twin handling
const SEC_T = "SEC предложила новые правила хранения криптоактивов кастодианами";
function approvedSec(over) {
  return mkQueueItem(Object.assign({ id: "q_approved", newsId: "news_Q", title: "🔐 SEC предложила новые правила хранения криптовалют", text: "Текст одобренного поста про SEC и правила хранения криптовалют.",
    sourceOriginalTitle: "SEC предложила новые правила хранения криптовалют", sourceOriginalText: "SEC предложила новые правила хранения криптовалют кастодианами 60 дней комментарии.", sourceName: "Forklog", sourceId: "fl",
    sourceUrl: "https://forklog.example/a", articlePublishedAt: "2026-10-02T06:00:00Z", qualityScore: 90, qcStatus: "pass" }, over || {}));
}
const incomingSec = () => mkQueueItem({ id: "q_new", newsId: "news_N", title: "SEC предложила новые правила хранения криптоактивов", text: "SEC предложила новые правила хранения криптоактивов кастодианами.",
  sourceName: "RBC", sourceId: "rb", sourceUrl: "https://rbc.example/b", sourceOriginalTitle: "SEC предложила новые правила хранения криптоактивов", sourceOriginalText: "SEC предложила новые правила хранения криптоактивов кастодианами.", articlePublishedAt: "2026-10-02T06:30:00Z" });

test("D1 failed merge never overwrites or removes the approved queue item", {}, async () => {
  const t = await loadServer({ fixedNow: "2026-10-02T09:00:00Z" });
  const Q = approvedSec(); t.ws("chtotamcrypto").state.queue = [Q];
  const snapshot = JSON.stringify(Q);
  net.llm.checker = () => ({ verdict: "reject", errors: [{ severity: "critical", type: "fact", field: "tg_text", quote: "60 дней", problem: "источники расходятся", fix: "" }], checked_claims: 2, summary: "x" });
  const merged = await inWs(t, "chtotamcrypto", () => t.tryMergeStoryQueueItem(incomingSec()));
  assert.equal(merged, null);
  assert.equal(JSON.stringify(Q), snapshot, "the approved post is untouched");
  assert.deepEqual(await inWs(t, "chtotamcrypto", () => t.autoResolveQueue()), { removed: 0 });
  assert.equal(t.ws("chtotamcrypto").state.queue.length, 1);
});

test("D2 a held / rejected twin in the queue does not swallow a good article", {}, async () => {
  const bad = mkQueueItem({ id: "q_bad", newsId: "news_bad", title: "🔐 SEC предложила новые правила хранения криптоактивов", text: "SEC предложила новые правила хранения криптоактивов кастодианами. Ошибка в цифре.", qcStatus: "hold", qualityScore: 55,
    editorialV2: { status: "hold", verdict: "reject", importance: 8 }, sourceId: "fl", sourceName: "Forklog", sourceUrl: "https://forklog.example/a", articlePublishedAt: "2026-10-02T05:00:00Z" });
  const t = await loadServer({ fixedNow: "2026-10-02T09:00:00Z", state: { chtotamcrypto: { sources: [src("rb", "https://rbc.example/", { name: "RBC" })], queue: [bad] } } });
  net.pages.set("https://rbc.example/", listHtml([{ href: "https://rbc.example/sec-rules", text: SEC_T }]));
  net.pages.set("https://rbc.example/sec-rules", articleHtml({ title: SEC_T, date: "2026-10-02T06:00:00Z", body: SEC_T + ". " + LONG }));
  net.llm.relation = () => ({ relation: "duplicate", new_fact: "", reason: "те же факты" });
  const r = await collect(t, "chtotamcrypto");
  assert.equal(r.queued, 1, "good article is queued: " + JSON.stringify(r));
  await inWs(t, "chtotamcrypto", () => t.autoResolveQueue());
  const q = t.ws("chtotamcrypto").state.queue;
  assert.equal(q.length, 1);
  assert.equal(q[0].newsId === "news_bad", false, "the held twin is gone, the good one stays");
});

test("D3 a queued post's 'update' is merged, not dropped by the precheck", {}, async () => {
  const t = await loadServer({ fixedNow: "2026-10-02T09:00:00Z", state: { chtotamcrypto: { sources: [src("rb", "https://rbc.example/", { name: "RBC" })], queue: [approvedSec()] } } });
  net.pages.set("https://rbc.example/", listHtml([{ href: "https://rbc.example/sec-rules", text: SEC_T }]));
  net.pages.set("https://rbc.example/sec-rules", articleHtml({ title: SEC_T, date: "2026-10-02T06:00:00Z", body: SEC_T + ". " + LONG }));
  net.llm.relation = () => ({ relation: "update", new_fact: "срок комментариев 90 дней", reason: "новая цифра" });
  const r = await collect(t, "chtotamcrypto");
  const q = t.ws("chtotamcrypto").state.queue;
  assert.equal(q.length, 1, "one post: " + JSON.stringify(r));
  assert.equal((q[0].storySources || []).length, 2, "the second source was merged into the queued post");
  assert.equal(r.queued, 1);
});

test("D4 any writer skip in merge mode keeps the posts separate (no source absorbed)", {}, async () => {
  const t = await loadServer({ fixedNow: "2026-10-02T09:00:00Z" });
  const Q = approvedSec(); t.ws("chtotamcrypto").state.queue = [Q];
  const snapshot = JSON.stringify(Q);
  net.llm.writer = () => ({ status: "skip", skip_reason: "реклама: партнёрская подборка", importance: 2, title_ru: "" });
  assert.equal(await inWs(t, "chtotamcrypto", () => t.tryMergeStoryQueueItem(incomingSec())), null);
  assert.equal(JSON.stringify(Q), snapshot, "an ad source is not attached to the approved post");
});

// G. classifier compares more than the top-1 candidate and the source text
test("G1 top-3 candidates are judged, not only the highest Jaccard", {}, async () => {
  const t = await loadServer({ fixedNow: "2026-10-02T09:00:00Z" });
  const mk = (id, title, text) => ({ id, title, text, publishedAt: iso(3), sourceId: "x" + id, sourceName: "X" + id });
  t.ws("chtotamcrypto").state.history = [
    mk("h1", "SEC предложила новые правила хранения криптоактивов", "SEC предложила новые правила хранения криптоактивов кастодианами банками"),
    mk("h2", "SEC обновила требования к хранению криптоактивов у кастодианов", "SEC обновила требования к хранению криптоактивов у кастодианов, срок 60 дней"),
    mk("h3", "Погода в Москве", "Дождь и ветер") ];
  net.llm.relation = (n, p) => p.title.startsWith("SEC предложила") ? { relation: "new_story", new_fact: "", reason: "другое" } : { relation: "duplicate", new_fact: "", reason: "то же" };
  const item = { id: "i", newsId: "n", title: SEC_T, text: "SEC предложила новые правила хранения криптоактивов кастодианами, срок 60 дней", sourceId: "s", sourceName: "S" };
  const rel = await inWs(t, "chtotamcrypto", () => t.classifyPublishedStoryRelationship(item));
  assert.equal(rel.relation, "duplicate", JSON.stringify(rel));
  assert.ok(net.log.filter((x) => x.role === "relation").length >= 2, "more than one comparison");
});

test("G2 a foreign-language source is compared with the source text of queued posts", {}, async () => {
  const t = await loadServer({ fixedNow: "2026-10-02T09:00:00Z" });
  t.ws("chtotamcrypto").state.queue = [mkQueueItem({ id: "q1", newsId: "n1", title: "SEC предложила правила хранения крипты", text: "Регулятор США хочет изменить порядок", sourceId: "fl", sourceName: "Forklog",
    sourceOriginalTitle: "SEC proposes custody rules for crypto assets held by custodians", sourceOriginalText: "SEC proposes custody rules for crypto assets held by custodians with a 60 day comment period" })];
  net.llm.relation = () => ({ relation: "duplicate", new_fact: "", reason: "то же" });
  const item = { id: "i", newsId: "n", title: "SEC proposes custody rules for crypto assets held by custodians", text: "SEC proposes custody rules for crypto assets held by custodians with a 60 day comment period", sourceId: "cd", sourceName: "CoinDesk" };
  const rel = await inWs(t, "chtotamcrypto", () => t.classifyPublishedStoryRelationship(item));
  assert.equal(rel.relation, "duplicate", JSON.stringify(rel));
});

// H. queue overflow keeps the post that can actually be published
test("H1 pruneQueueItems does not drop an approved ready post for held ones with higher AI scores", { env: { QUEUE_MAX_AUTO_ITEMS: "5" } }, async () => {
  const t = await loadServer({ fixedNow: "2026-10-02T09:00:00Z", env: { QUEUE_MAX_AUTO_ITEMS: "5" } });
  const held = Array.from({ length: 5 }, (_, i) => mkQueueItem({ id: "h" + i, newsId: "nh" + i, aiScore: 95, qcStatus: "hold", editorialV2: { status: "hold", verdict: "reject" } }));
  const ready = mkQueueItem({ id: "ready", newsId: "nready", aiScore: 60 });
  const stale = mkQueueItem({ id: "stale", newsId: "nstale", aiScore: 99, articlePublishedAt: iso(30) });
  t.ws("chtotamcrypto").state.queue = held.concat([stale, ready]);
  await inWs(t, "chtotamcrypto", async () => t.pruneQueueItems(t.state));
  const ids = t.ws("chtotamcrypto").state.queue.map((q) => q.id);
  assert.ok(ids.includes("ready"), "approved ready post survives: " + ids);
  assert.equal(ids.length, 5);
  assert.ok(ids.indexOf("stale") === -1 || ids.indexOf("ready") !== -1);
});

// ---------------------------------------------------------------------------------------------------------------
async function main() {
  const only = process.argv[2];
  if (only) {
    const entry = Object.entries(cases).find(([name]) => name === only || name.startsWith(only + " "));
    if (!entry) throw new Error("unknown case " + only);
    await entry[1].fn();
    process.exit(0);
  }
  const needsDb = Object.values(cases).some((c) => c.opts && c.opts.db);
  const pgInst = needsDb ? startTempPostgres() : null;
  let failed = 0, skipped = 0;
  try {
    for (const [name, c] of Object.entries(cases)) {
      if (c.opts && c.opts.db && !pgInst) { console.log("skip - " + name + " (no PostgreSQL available)"); skipped += 1; continue; }
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name.split(" ")[0]], {
        env: Object.assign({}, process.env, { TZ: "UTC" }, pgInst ? { TEST_DATABASE_URL: pgInst.url } : {}), encoding: "utf8", timeout: 180000
      });
      if (r.status === 0) console.log("ok - " + name);
      else { failed += 1; console.log("FAIL - " + name + "\n" + String(r.stderr || r.stdout).split("\n").filter((l) => !/^(HEADLINE_|EDITORIAL_V2|NOTICE|DETAIL)/.test(l)).slice(-14).join("\n")); }
    }
  } finally { if (pgInst) pgInst.stop(); }
  console.log(failed ? failed + " failed" : "dedupe tests passed" + (skipped ? " (" + skipped + " skipped)" : ""));
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
