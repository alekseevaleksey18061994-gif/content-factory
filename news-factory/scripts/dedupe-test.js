// Offline regression tests for the dedupe / freshness / stuck-source audit fixes.
// Each case runs in its own process (the server module keeps global state). Cases that need PostgreSQL use a
// throw-away local cluster (TEST_DATABASE_URL overrides it) and are skipped when none can be started.
//   npm run test:dedupe            all cases
//   node scripts/dedupe-test.js A1 run one case
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
        env: Object.assign({}, process.env, pgInst ? { TEST_DATABASE_URL: pgInst.url } : {}), encoding: "utf8", timeout: 180000
      });
      if (r.status === 0) console.log("ok - " + name);
      else { failed += 1; console.log("FAIL - " + name + "\n" + String(r.stderr || r.stdout).split("\n").filter((l) => !/^(HEADLINE_|EDITORIAL_V2|NOTICE|DETAIL)/.test(l)).slice(-14).join("\n")); }
    }
  } finally { if (pgInst) pgInst.stop(); }
  console.log(failed ? failed + " failed" : "dedupe tests passed" + (skipped ? " (" + skipped + " skipped)" : ""));
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
