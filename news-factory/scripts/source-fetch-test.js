// Sources that do not open from the server abroad: browser headers, IPv4 retry, Russian proxy fallback,
// RSS fallback for blocked pages, Telegram/RSS text when the article page is blocked, source trial period.
//   npm run test:source-fetch
process.env.TZ = "UTC";
import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createSourceFetcher, classifySourceFailure, parseFeed, discoverFeedUrl, guessFeedUrls, looksLikeFeed, BROWSER_HEADERS } from "../lib/source-fetch.js";
import { createSafeFetch, parseProxyUrl, networkErrorText, SafeFetchError } from "../lib/safe-fetch.js";
import { autoPauseReason } from "../lib/source-quality.js";
import { loadServer, inWs, net, articleHtml, listHtml, LONG } from "./dedupe-harness.js";

const cases = {};
function test(name, fn) { cases[name] = fn; }
const resp = (status, body = "ok", type = "text/html") => new Response(body, { status, headers: { "content-type": type } });

test("F1 classify: 403/429/5xx/timeout -> blocked, reset/AggregateError -> network, 404 -> none", async () => {
  assert.equal(classifySourceFailure({ response: { status: 403 } }), "blocked");
  assert.equal(classifySourceFailure({ response: { status: 503 } }), "blocked");
  assert.equal(classifySourceFailure({ response: { status: 404 } }), "");
  assert.equal(classifySourceFailure({ response: { status: 200 } }), "");
  assert.equal(classifySourceFailure({ error: new SafeFetchError("timeout", "Таймаут запроса (15000 мс)") }), "blocked");
  assert.equal(classifySourceFailure({ error: new SafeFetchError("network", "connect failed (ETIMEDOUT, ENETUNREACH)") }), "network");
  assert.equal(classifySourceFailure({ error: new SafeFetchError("blocked_address", "Хост запрещён") }), "", "SSRF refusals are final");
  const agg = new AggregateError([Object.assign(new Error("x"), { code: "ETIMEDOUT" }), Object.assign(new Error("y"), { code: "ENETUNREACH" })], "");
  assert.equal(networkErrorText(agg), "connect failed (ETIMEDOUT, ENETUNREACH)");
});

test("F2 fetcher: browser headers; 403 without proxy is returned as is; network error retried over IPv4", async () => {
  const calls = [];
  let mode = "403";
  const f = createSourceFetcher({ fetch: async (url, init) => {
    calls.push({ url, init });
    if (mode === "403") return resp(403);
    if (mode === "net" && init.family !== 4) throw new SafeFetchError("network", "connect failed (ETIMEDOUT)");
    return resp(200, "<html>ok</html>");
  } });
  const r = await f.fetch("https://iz.ru/rubric/ekonomika", { timeoutMs: 1000, headers: { accept: "x/y" } });
  assert.equal(r.status, 403);
  assert.equal(calls.length, 1, "no proxy -> no extra request for a refusal");
  assert.equal(calls[0].init.headers["user-agent"], BROWSER_HEADERS["user-agent"]);
  assert.equal(calls[0].init.headers.accept, "x/y", "caller headers win");
  assert.match(calls[0].init.headers["accept-language"], /^ru-RU/);
  assert.ok(!/bot/i.test(calls[0].init.headers["user-agent"]));
  mode = "net"; calls.length = 0;
  const r2 = await f.fetch("https://t.me/s/prime1", {});
  assert.equal(r2.status, 200); assert.equal(r2.route, "ipv4");
  assert.deepEqual(calls.map((c) => c.init.family || 0), [0, 4]);
});

test("F3 fetcher with proxy: blocked host goes through the proxy, is remembered, sticky expires", async () => {
  let now = 1000000;
  const calls = [];
  const f = createSourceFetcher({ proxy: { host: "p", port: 1, label: "p:1" }, now: () => now, stickyMs: 60000, fetch: async (url, init) => {
    calls.push(init.proxy ? "proxy" : "direct");
    if (init.proxy) return resp(200, "<html>via proxy</html>");
    return resp(403);
  } });
  let r = await f.fetch("https://www.iz.ru/a", {});
  assert.equal(r.status, 200); assert.equal(r.route, "proxy");
  assert.deepEqual(calls, ["direct", "proxy"]);
  calls.length = 0;
  r = await f.fetch("https://iz.ru/b", {});
  assert.deepEqual(calls, ["proxy"], "remembered host goes straight to the proxy (www. ignored)");
  now += 61000; calls.length = 0;
  await f.fetch("https://iz.ru/c", {});
  assert.deepEqual(calls, ["direct", "proxy"], "after the sticky window the direct route is tried again");
  const st = f.stats();
  assert.equal(st.proxy, 3); assert.equal(st.proxy_enabled, true);
});

test("F4 fetcher with proxy: proxy also fails -> original 403 / error is what the caller sees", async () => {
  const f = createSourceFetcher({ proxy: { host: "p", port: 1 }, fetch: async (url, init) => {
    if (init.proxy) throw new SafeFetchError("proxy", "Прокси отказал: HTTP 407");
    return resp(403);
  } });
  const r = await f.fetch("https://x.ru/", {});
  assert.equal(r.status, 403);
  const g = createSourceFetcher({ proxy: { host: "p", port: 1 }, fetch: async (url, init) => {
    if (init.proxy) return resp(502);
    throw new SafeFetchError("timeout", "Таймаут запроса (15000 мс)");
  } });
  await assert.rejects(() => g.fetch("https://y.ru/", {}), /Таймаут/);
});

test("F5 RSS and Atom parsing, feed discovery prefers the section feed, guesses", async () => {
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>X</title>
    <item><title><![CDATA[Ozon меняет правила возврата]]></title><link>https://x.ru/news/1</link><pubDate>Sat, 03 Oct 2026 10:00:00 +0300</pubDate>
    <description>&lt;p&gt;Подробности &amp;amp; детали&lt;/p&gt;</description><enclosure url="https://x.ru/i.jpg" type="image/jpeg" length="1"/></item>
    <item><title>Старая</title><link>/news/0</link><pubDate>Fri, 02 Oct 2026 10:00:00 +0300</pubDate></item>
    <item><title>Плохая ссылка</title><link>javascript:alert(1)</link></item></channel></rss>`;
  assert.ok(looksLikeFeed(rss));
  const items = parseFeed(rss, "https://x.ru/rss");
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Ozon меняет правила возврата"); assert.equal(items[0].url, "https://x.ru/news/1");
  assert.equal(items[0].publishedAt, "2026-10-03T07:00:00.000Z"); assert.equal(items[0].imageUrl, "https://x.ru/i.jpg");
  assert.match(items[0].text, /Подробности & детали/);
  assert.equal(items[1].url, "https://x.ru/news/0", "relative links resolved");
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>A</title><link rel="alternate" href="https://y.ru/a"/><updated>2026-10-03T05:00:00Z</updated><summary>S</summary></entry></feed>`;
  assert.ok(looksLikeFeed(atom));
  assert.deepEqual(parseFeed(atom, "https://y.ru/").map((x) => x.url), ["https://y.ru/a"]);
  assert.ok(!looksLikeFeed("<html><body>no</body></html>"));
  const page = `<link rel="alternate" type="application/rss+xml" href="/rss/all"><link rel="alternate" type="application/rss+xml" href="/rubric/ekonomika/rss">`;
  assert.equal(discoverFeedUrl(page, "https://iz.ru/rubric/ekonomika"), "https://iz.ru/rubric/ekonomika/rss");
  assert.equal(discoverFeedUrl("<html></html>", "https://iz.ru/"), "");
  assert.deepEqual(guessFeedUrls("https://www.retail.ru/news/").slice(0, 2), ["https://www.retail.ru/news/rss", "https://www.retail.ru/news/feed"]);
});

test("F6 safeFetch through a real HTTP proxy: absolute URL, Proxy-Authorization, CONNECT refused -> clear error", async () => {
  const seen = [];
  const target = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<html>target " + req.url + "</html>"); });
  await new Promise((r) => target.listen(0, "127.0.0.1", r));
  const tport = target.address().port;
  const proxy = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, auth: req.headers["proxy-authorization"] || "" });
    const u = new URL(req.url);
    http.get({ host: u.hostname, port: u.port, path: u.pathname + u.search }, (up) => { res.writeHead(up.statusCode, up.headers); up.pipe(res); });
  });
  proxy.on("connect", (req, socket) => { seen.push({ method: "CONNECT", url: req.url }); socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); });
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  const pport = proxy.address().port;
  try {
    const sf = createSafeFetch({ ipFilter: () => false, allowedPorts: [tport, 443, 80] });
    const p = parseProxyUrl("http://user:p%40ss@127.0.0.1:" + pport);
    assert.equal(p.label, "127.0.0.1:" + pport);
    const r = await sf("http://127.0.0.1:" + tport + "/page?x=1", { proxy: p, timeoutMs: 3000 });
    assert.equal(r.status, 200);
    assert.match(await r.text(), /target \/page\?x=1/);
    assert.equal(seen[0].url, "http://127.0.0.1:" + tport + "/page?x=1");
    assert.equal(seen[0].auth, "Basic " + Buffer.from("user:p@ss").toString("base64"));
    await assert.rejects(() => sf("https://example.com/", { proxy: p, timeoutMs: 3000 }), (e) => e.code === "proxy" && /403/.test(e.message));
    assert.equal(seen[1].method, "CONNECT"); assert.equal(seen[1].url, "example.com:443");
    await assert.rejects(() => sf("http://127.0.0.1:" + tport + "/", { proxy: "socks5://x:1" }), (e) => e.code === "bad_proxy");
    const strict = createSafeFetch({ allowedPorts: [tport] });
    await assert.rejects(() => strict("http://127.0.0.1:" + tport + "/", { proxy: p }), (e) => e.code === "blocked_address", "IP literals are still refused through the proxy");
  } finally { target.close(); proxy.close(); }
});

test("F8 HTTPS through the proxy: CONNECT tunnel + end-to-end TLS to the target", async () => {
  const fs = await import("node:fs"); const os = await import("node:os"); const path = await import("node:path"); const https = await import("node:https"); const netm = await import("node:net");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-tls-"));
  const r0 = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", dir + "/k.pem", "-out", dir + "/c.pem", "-days", "1", "-subj", "/CN=nf-target.invalid", "-addext", "subjectAltName=DNS:nf-target.invalid"], { encoding: "utf8" });
  if (r0.status !== 0) { console.log("skip: no openssl"); return; }
  const target = https.createServer({ key: fs.readFileSync(dir + "/k.pem"), cert: fs.readFileSync(dir + "/c.pem") }, (req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<html>secure " + req.url + " " + (req.headers["user-agent"] || "") + "</html>"); });
  await new Promise((r) => target.listen(0, "127.0.0.1", r));
  const tport = target.address().port;
  const tunnels = [];
  const proxy = http.createServer((req, res) => { res.writeHead(405); res.end(); });
  const openSockets = new Set();
  proxy.on("connect", (req, socket, head) => {
    openSockets.add(socket); socket.on("close", () => openSockets.delete(socket));
    tunnels.push({ url: req.url, auth: req.headers["proxy-authorization"] || "" });
    const [h, p] = req.url.split(":");
    const up = netm.connect(Number(p), h === "nf-target.invalid" ? "127.0.0.1" : h, () => { socket.write("HTTP/1.1 200 Connection Established\r\n\r\n"); if (head && head.length) up.write(head); up.pipe(socket); socket.pipe(up); });
    up.on("error", () => socket.destroy());
  });
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // self-signed test certificate only
  try {
    // nf-target.invalid does not resolve: the request can ONLY succeed through the tunnel (a direct connection
    // would fail DNS). Before the fix the "proxied" request silently went direct.
    const sf = createSafeFetch({ ipFilter: () => false, allowedPorts: [tport] });
    const p = parseProxyUrl("http://u:p@127.0.0.1:" + proxy.address().port);
    const r2 = await sf("https://nf-target.invalid:" + tport + "/via?x=2", { proxy: p, timeoutMs: 5000, headers: { "user-agent": "UA-TEST" } });
    assert.equal(r2.status, 200);
    assert.match(await r2.text(), /secure \/via\?x=2 UA-TEST/);
    assert.equal(tunnels.at(-1).url, "nf-target.invalid:" + tport);
    assert.equal(tunnels.at(-1).auth, "Basic " + Buffer.from("u:p").toString("base64"));
    await assert.rejects(() => sf("https://nf-target.invalid:" + tport + "/", { timeoutMs: 3000 }), "without the proxy the host is unreachable");
    // certificate is still verified against the target name through the tunnel
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    await assert.rejects(() => sf("https://nf-target.invalid:" + tport + "/", { proxy: p, timeoutMs: 3000 }), /self-signed|certificate/i);
    // no tunnel sockets left open
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(openSockets.size, 0, "tunnels are closed after use");
  } finally { target.close(); proxy.close(); }
});

test("F9 hostile feeds parse in linear time; section pages never fall back to the site-wide feed", async () => {
  for (const evil of ["<item>".repeat(400000), "<rss><item><title>x</title><link>https://a.b/1</link><description>" + "<script".repeat(200000) + "</description></item></rss>", "<![CDATA[".repeat(300000), "<".repeat(2000000), "<rss><item><title " + "a".repeat(1000000)]) {
    const t0 = Date.now(); parseFeed(evil, "https://a.b/"); discoverFeedUrl(evil, "https://a.b/x/y");
    assert.ok(Date.now() - t0 < 500, "took " + (Date.now() - t0) + " ms for " + evil.slice(0, 20));
  }
  assert.equal(discoverFeedUrl('<link rel="alternate" type="application/rss+xml" href="/rss">', "https://iz.ru/rubric/ekonomika"), "", "section page: no site-wide feed");
  assert.equal(discoverFeedUrl('<link rel="alternate" type="application/rss+xml" href="/rss">', "https://www.retail.ru/news/"), "https://www.retail.ru/rss");
  assert.deepEqual(guessFeedUrls("https://iz.ru/rubric/ekonomika"), ["https://iz.ru/rubric/ekonomika/rss", "https://iz.ru/rubric/ekonomika/feed"]);
});

test("F7 trial period: an auto-added source with no useful news is paused after the trial; editor's sources are not", async () => {
  const past = new Date(Date.now() - 3600e3).toISOString();
  const future = new Date(Date.now() + 3600e3).toISOString();
  const src = (extra) => Object.assign({ id: "s", enabled: true, url: "https://x.ru/" }, extra);
  assert.match(autoPauseReason(src({ probationUntil: past }), { checks: 20 }, 10), /пробный срок/);
  assert.equal(autoPauseReason(src({ probationUntil: past }), { checks: 20, useful: 1 }, 10), "");
  assert.equal(autoPauseReason(src({ probationUntil: future }), { checks: 20 }, 10), "", "still on trial");
  assert.equal(autoPauseReason(src({}), { checks: 20 }, 10), "", "no trial for sources added before / by the editor");
  assert.equal(autoPauseReason(src({ probationUntil: past }), { checks: 20 }, 4), "", "minimum per group kept");
});

const ART = "https://www.retail.ru/news/ozon-vozvrat-2026";
const TITLE = "Ozon сократит срок возврата денег покупателям до трёх дней";
const BODY = "Ozon сообщил, что с 15 октября деньги за возвращённые товары будут приходить покупателям за три дня вместо семи. Изменение касается всех способов оплаты." + LONG;
const shopSrc = (extra) => Object.assign({ id: "retail", name: "Retail.ru", url: "https://www.retail.ru/news/", enabled: true, group: "media", type: "web", priority: 2 }, extra || {});

test("C1 collector: source page 403 -> news taken from its RSS feed, feed remembered", async () => {
  const t = await loadServer({ fixedNow: "2026-10-03T09:00:00Z", env: { CROSS_CHANNEL_DEDUPE_ENABLED: "false" }, state: { chtotampokupki: { sources: [shopSrc()] } } });
  net.pages.set("https://www.retail.ru/news/", () => resp(403, "Forbidden"));
  net.pages.set("https://www.retail.ru/news/rss", () => resp(200, `<rss><channel><item><title>${TITLE}</title><link>${ART}</link><pubDate>Sat, 03 Oct 2026 08:00:00 +0300</pubDate><description>${BODY}</description></item></channel></rss>`, "application/rss+xml"));
  net.pages.set(ART, articleHtml({ title: TITLE, date: "2026-10-03T08:00:00+03:00", body: BODY }));
  const r = await inWs(t, "chtotampokupki", () => t.collectOnce("slot-prep"));
  assert.equal(r.viaFeed, 1, JSON.stringify(r));
  assert.equal(t.ws("chtotampokupki").state.sources[0].feedUrl, "https://www.retail.ru/news/rss");
  assert.ok(t.ws("chtotampokupki").state.queue.some((q) => /три дня|трёх дней/i.test(q.title + q.text)) || r.queued >= 1, JSON.stringify(r));
});

test("C2 collector: article page blocked -> RSS item text is used instead of losing the news", async () => {
  const t = await loadServer({ fixedNow: "2026-10-03T09:00:00Z", env: { CROSS_CHANNEL_DEDUPE_ENABLED: "false" }, state: { chtotampokupki: { sources: [shopSrc({ feedUrl: "https://www.retail.ru/news/rss" })] } } });
  net.pages.set("https://www.retail.ru/news/", () => resp(403, "Forbidden"));
  net.pages.set("https://www.retail.ru/news/rss", () => resp(200, `<rss><channel><item><title>${TITLE}</title><link>${ART}</link><pubDate>Sat, 03 Oct 2026 08:00:00 +0300</pubDate><description>${BODY}</description></item></channel></rss>`, "application/rss+xml"));
  net.pages.set(ART, () => resp(403, "Forbidden"));
  const r = await inWs(t, "chtotampokupki", () => t.collectOnce("slot-prep"));
  assert.equal(r.fromLinkText, 1, JSON.stringify(r));
  assert.ok(r.queued >= 1, JSON.stringify(r));
});

test("C3 collector: page that opens records its feed for later", async () => {
  const t = await loadServer({ fixedNow: "2026-10-03T09:00:00Z", env: { CROSS_CHANNEL_DEDUPE_ENABLED: "false" }, state: { chtotampokupki: { sources: [shopSrc()] } } });
  net.pages.set("https://www.retail.ru/news/", '<html><head><link rel="alternate" type="application/rss+xml" href="/news/rss"></head><body>' + listHtml([{ href: ART, text: TITLE }]) + "</body></html>");
  net.pages.set(ART, articleHtml({ title: TITLE, date: "2026-10-03T08:00:00+03:00", body: BODY }));
  await inWs(t, "chtotampokupki", () => t.collectOnce("slot-prep"));
  assert.equal(t.ws("chtotampokupki").state.sources[0].feedUrl, "https://www.retail.ru/news/rss");
});

test("C4 collector: removed article (HTTP 410) is NOT rebuilt from the feed text", async () => {
  const t = await loadServer({ fixedNow: "2026-10-03T09:00:00Z", env: { CROSS_CHANNEL_DEDUPE_ENABLED: "false" }, state: { chtotampokupki: { sources: [shopSrc({ feedUrl: "https://www.retail.ru/news/rss" })] } } });
  net.pages.set("https://www.retail.ru/news/", () => resp(403, "Forbidden"));
  net.pages.set("https://www.retail.ru/news/rss", () => resp(200, `<rss><channel><item><title>${TITLE}</title><link>${ART}</link><pubDate>Sat, 03 Oct 2026 08:00:00 +0300</pubDate><description>${BODY}</description></item></channel></rss>`, "application/rss+xml"));
  net.pages.set(ART, () => resp(410, "Gone"));
  const r = await inWs(t, "chtotampokupki", () => t.collectOnce("slot-prep"));
  assert.ok(!r.fromLinkText, JSON.stringify(r));
  assert.equal(r.queued, 0);
});

test("C5 starving channel: two empty preparations -> up to 15 new sources (Telegram allowed) beyond the target", async () => {
  const many = Array.from({ length: 45 }, (_, i) => shopSrc({ id: "s" + i, name: "S" + i, url: "https://site" + i + ".ru/news/" }));
  const t = await loadServer({ fixedNow: "2026-10-03T09:00:00Z", env: { CROSS_CHANNEL_DEDUPE_ENABLED: "false", SOURCES_MIN_ACTIVE: "40" }, state: { chtotampokupki: { sources: many } } });
  for (let i = 0; i < 45; i++) net.pages.set("https://site" + i + ".ru/news/", listHtml([]));
  const cands = Array.from({ length: 20 }, (_, i) => ({ name: "Новый " + i, url: i % 2 ? "https://t.me/s/mp_news" + i : "https://new" + i + ".ru/news/", group: "media", why: "по теме" }));
  for (const c of cands) {
    if (c.url.includes("t.me")) net.pages.set(c.url, "<html>" + [1, 2, 3, 4].map((n) => `<div class="tgme_widget_message_wrap"><div data-post="${c.url.split("/s/")[1]}/${n}"><div class="tgme_widget_message_text">Ozon и Wildberries меняют правила для покупателей номер ${n}</div><time datetime="2026-10-03T06:00:00+00:00"></time></div></div>`).join("") + "</html>");
    else net.pages.set(c.url, listHtml(Array.from({ length: 8 }, (_, n) => ({ href: c.url + "item-" + n, text: "Маркетплейс объявил новые правила возврата товаров номер " + n }))));
  }
  const inner = globalThis.fetch;
  let discoveryAsked = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.openai.com/v1/responses")) {
      const body = JSON.parse(init.body);
      if (String(body.input || "").startsWith("Подбери новые источники")) { discoveryAsked += 1; assert.match(body.input, /t\.me\/s\//); return new Response(JSON.stringify({ output_text: JSON.stringify({ sources: cands }), usage: {} }), { status: 200, headers: { "content-type": "application/json" } }); }
    }
    return inner(url, init);
  };
  const r0 = await inWs(t, "chtotampokupki", () => t.replenishSources("below_target"));
  assert.equal(r0.need, 0, "45 sources >= target 40: nothing to add while the channel still finds news");
  await inWs(t, "chtotampokupki", () => t.collectOnce("slot-prep"));
  await inWs(t, "chtotampokupki", () => t.collectOnce("slot-prep"));
  assert.equal(t.ws("chtotampokupki").state.sourceStarvingRuns, 2);
  // the collector tops up in the background after the second empty preparation
  for (let i = 0; i < 100 && t.ws("chtotampokupki").state.sources.length < 60; i++) await new Promise((r) => setTimeout(r, 30));
  assert.ok(discoveryAsked >= 1);
  const added = t.ws("chtotampokupki").state.sources.filter((x) => x.autoAdded && x.autoAdded.reason === "starving");
  assert.equal(added.length, 15);
  assert.ok(added.some((x) => x.group === "creator" && /t\.me\/s\//.test(x.url)), "Telegram channels are added as creator sources");
  assert.ok(added.every((x) => x.probationUntil), "all on trial");
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
  console.log(failed ? failed + " failed" : "source-fetch tests passed");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
