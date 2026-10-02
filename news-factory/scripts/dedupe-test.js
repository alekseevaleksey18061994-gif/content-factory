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
