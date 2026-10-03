// Fetching news-source pages from a server abroad (Railway, US): many Russian sites answer 403, time out, or
// refuse unknown bots, and t.me intermittently fails to connect. This wrapper around safeFetch:
//   1. sends browser-like headers instead of a "bot" user agent;
//   2. after a dropped connection retries once over IPv4 only (happy-eyeballs AggregateError);
//   3. when SOURCE_PROXY_URL is set (an HTTP proxy in Russia), retries blocked / timed-out requests through it
//      and remembers hosts that only open through the proxy, so their next requests go there first.
// Pure logic with injected fetch / clock: tested offline in scripts/source-fetch-test.js.

export const BROWSER_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "ru-RU,ru;q=0.9,en-US;q=0.7,en;q=0.6",
  "cache-control": "no-cache",
  "upgrade-insecure-requests": "1"
};

const BLOCKED_STATUSES = new Set([401, 403, 407, 429, 451, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526]);

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

// "network": the connection itself failed (reset, refused, AggregateError) — worth an IPv4-only retry.
// "blocked": the site answered with a refusal / overload, or did not answer in time — worth the proxy.
export function classifySourceFailure(outcome) {
  if (!outcome) return "";
  if (outcome.response) return BLOCKED_STATUSES.has(Number(outcome.response.status)) ? "blocked" : "";
  const e = outcome.error || {};
  const code = String(e.code || "");
  const msg = String(e.message || e || "");
  if (code === "timeout" || /Таймаут|timeout|timed out/i.test(msg)) return "blocked";
  if (code === "network" || /AggregateError|connect failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|socket hang up|Соединение прервано|fetch failed/i.test(msg)) return "network";
  return "";
}

export function createSourceFetcher(options) {
  const opt = options || {};
  const fetchImpl = opt.fetch;
  const proxy = opt.proxy || null; // parsed proxy object or URL string, passed through to fetchImpl
  const now = opt.now || Date.now;
  const stickyMs = Number(opt.stickyMs == null ? 24 * 3600000 : opt.stickyMs);
  const sticky = new Map(); // host -> until (ms): opens only through the proxy
  const stats = { direct: 0, ipv4: 0, proxy: 0, failed: 0, waiting: 0, peak: 0 };
  // All channels collect at the same minute, each opening every source at once: a thousand parallel requests
  // made almost every one of them time out. A global limit keeps requests fast; each one's timeout starts only
  // when it gets its turn.
  const maxConcurrent = Math.max(1, Math.floor(Number(opt.maxConcurrent == null ? 24 : opt.maxConcurrent) || 24));
  let active = 0;
  const queue = [];
  function acquire() {
    if (active < maxConcurrent) { active += 1; stats.peak = Math.max(stats.peak, active); return Promise.resolve(); }
    stats.waiting += 1;
    return new Promise(function(resolve) { queue.push(resolve); });
  }
  function release() {
    const next = queue.shift();
    if (next) { stats.waiting -= 1; next(); } else active -= 1;
  }

  async function attempt(url, init, extra) {
    await acquire();
    try { return { response: await fetchImpl(url, Object.assign({}, init, extra)) }; }
    catch (error) { return { error: error }; }
    finally { release(); }
  }

  function done(outcome, route) {
    if (outcome.response) {
      const counted = classifySourceFailure(outcome) ? "failed" : route;
      stats[counted] = Number(stats[counted] || 0) + 1;
      try { Object.defineProperty(outcome.response, "route", { value: route, enumerable: false, configurable: true }); } catch {}
      return outcome.response;
    }
    stats.failed += 1;
    throw outcome.error;
  }

  async function sourceFetch(url, init) {
    const base = Object.assign({}, init || {});
    base.headers = Object.assign({}, BROWSER_HEADERS, base.headers || {});
    const host = hostOf(url);
    const until = sticky.get(host) || 0;
    if (proxy && until > now()) {
      const viaProxy = await attempt(url, base, { proxy: proxy });
      if (viaProxy.response && !classifySourceFailure(viaProxy)) return done(viaProxy, "proxy");
      // the proxy stopped helping for this host: forget it and fall through to the normal path
      sticky.delete(host);
    } else if (until) {
      sticky.delete(host);
    }

    let outcome = await attempt(url, base, {});
    let kind = classifySourceFailure(outcome);
    if (!kind) return done(outcome, "direct");

    if (kind === "network") {
      const v4 = await attempt(url, base, { family: 4 });
      const v4kind = classifySourceFailure(v4);
      if (!v4kind) return done(v4, "ipv4");
      outcome = v4; kind = v4kind;
    }

    if (proxy) {
      const viaProxy = await attempt(url, base, { proxy: proxy });
      if (viaProxy.response && !classifySourceFailure(viaProxy)) {
        if (viaProxy.response && viaProxy.response.ok) sticky.set(host, now() + stickyMs);
        return done(viaProxy, "proxy");
      }
    }
    // Return the original answer (e.g. 403) so callers keep their "HTTP 403" handling; throw the original error.
    return done(outcome, "direct");
  }

  return {
    fetch: sourceFetch,
    stats: function() { return Object.assign({ stickyHosts: sticky.size, proxy_enabled: Boolean(proxy) }, stats); },
    stickyHosts: function() { return Array.from(sticky.keys()); },
    proxyEnabled: Boolean(proxy)
  };
}

// ---------------------------------------------------------------- RSS / Atom

// All parsing below is linear in the input: a hostile feed (thousands of unclosed <item>/<script>/CDATA) used
// to make lazy [\s\S]*? patterns quadratic and freeze the whole server for minutes.
const MAX_FEED_CHARS = 3000000;
const MAX_FEED_ITEMS = 100;
const MAX_FIELD_CHARS = 20000;

// Calls onBlock(inner, outerStart, outerEnd) for every open..close pair; stops at the first open without a close.
function eachBlock(src, openRe, closeRe, onBlock) {
  openRe.lastIndex = 0;
  let m;
  while ((m = openRe.exec(src))) {
    const innerStart = m.index + m[0].length;
    closeRe.lastIndex = innerStart;
    const c = closeRe.exec(src);
    if (!c) return;
    if (onBlock(src.slice(innerStart, c.index), m.index, c.index + c[0].length) === false) return;
    openRe.lastIndex = c.index + c[0].length;
  }
}

function replaceBlocks(src, openRe, closeRe, replacer) {
  let out = "";
  let pos = 0;
  let cut = -1;
  eachBlock(src, openRe, closeRe, function(inner, a, b) { out += src.slice(pos, a) + replacer(inner); pos = b; });
  // an unclosed opener: drop everything after it (it is never a well-formed field anyway)
  openRe.lastIndex = pos;
  const tail = openRe.exec(src);
  if (tail) cut = tail.index;
  return out + src.slice(pos, cut >= 0 ? cut : src.length);
}

function unwrapCdata(text) {
  return replaceBlocks(String(text || ""), /<!\[CDATA\[/g, /\]\]>/g, function(inner) { return inner; });
}

function decodeEntities(text) {
  return unwrapCdata(text)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d{1,7});/g, function(m, n) { const c = Number(n); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ""; })
    .replace(/&#x([0-9a-f]{1,6});/gi, function(m, n) { const c = parseInt(n, 16); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ""; })
    .replace(/&amp;/g, "&");
}

function stripTags(html) {
  // feeds carry escaped HTML: decode once to get the markup, drop the tags, then decode the text entities
  let markup = decodeEntities(String(html || "").slice(0, MAX_FIELD_CHARS));
  markup = replaceBlocks(markup, /<script\b/gi, /<\/script>/gi, function() { return " "; });
  markup = replaceBlocks(markup, /<style\b/gi, /<\/style>/gi, function() { return " "; });
  markup = markup.replace(/<br\s{0,10}\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^<>]{0,2000}>/g, " ");
  return decodeEntities(markup)
    .replace(/&nbsp;|\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

function escapeRe(text) { return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function tag(block, name) {
  let found = "";
  eachBlock(block, new RegExp("<" + escapeRe(name) + "(?:\\s[^<>]{0,300})?>", "gi"), new RegExp("<\\/" + escapeRe(name) + ">", "gi"), function(inner) { found = inner; return false; });
  return found;
}

export function looksLikeFeed(text) {
  const head = String(text || "").slice(0, 2000);
  return /<rss[\s>]|<feed[\s>][\s\S]*?xmlns=["']http:\/\/www\.w3\.org\/2005\/Atom|<rdf:RDF/i.test(head);
}

// -> [{url, title, text, publishedAt, imageUrl}], newest first, http(s) links only.
export function parseFeed(xml, baseUrl) {
  const src = String(xml || "").slice(0, MAX_FEED_CHARS);
  const out = [];
  let blocks = [];
  eachBlock(src, /<item[\s>]/gi, /<\/item>/gi, function(inner) { blocks.push(inner); return blocks.length < MAX_FEED_ITEMS; });
  if (!blocks.length) eachBlock(src, /<entry[\s>]/gi, /<\/entry>/gi, function(inner) { blocks.push(inner); return blocks.length < MAX_FEED_ITEMS; });
  for (const block of blocks) {
    let link = stripTags(tag(block, "link"));
    if (!link) {
      const alt = block.match(/<link\b[^<>]{0,500}rel=["']alternate["'][^<>]{0,500}href=["']([^"'<>]{1,2000})["']/i) || block.match(/<link\b[^<>]{0,500}href=["']([^"'<>]{1,2000})["']/i);
      link = alt ? decodeEntities(alt[1]) : "";
    }
    if (!link) link = stripTags(tag(block, "guid"));
    let url = "";
    try { url = new URL(link.trim(), baseUrl).href; } catch { continue; }
    if (!/^https?:\/\//i.test(url)) continue;
    const title = stripTags(tag(block, "title")).replace(/\s+/g, " ").trim();
    if (!title) continue;
    const body = tag(block, "content:encoded") || tag(block, "description") || tag(block, "summary") || tag(block, "content") || tag(block, "yandex:full-text");
    const text = stripTags(body).slice(0, 6000);
    const dateRaw = stripTags(tag(block, "pubDate") || tag(block, "published") || tag(block, "updated") || tag(block, "dc:date"));
    const t = dateRaw ? Date.parse(dateRaw) : NaN;
    const A = "[^<>]{0,500}";
    const U = "[\"']([^\"'<>]{1,2000})[\"']";
    const img = block.match(new RegExp("<enclosure\\b" + A + "url=" + U + A + "type=[\"']image\\/", "i")) || block.match(new RegExp("<enclosure\\b" + A + "type=[\"']image\\/[^\"'<>]{0,50}[\"']" + A + "url=" + U, "i")) ||
      block.match(new RegExp("<media:content\\b" + A + "url=" + U, "i")) || block.match(new RegExp("<media:thumbnail\\b" + A + "url=" + U, "i"));
    let imageUrl = "";
    if (img) { try { imageUrl = new URL(decodeEntities(img[1]), baseUrl).href; } catch {} }
    out.push({ url: url, title: title.length > 220 ? title.slice(0, 217) + "…" : title, text: text, publishedAt: Number.isFinite(t) ? new Date(t).toISOString() : "", imageUrl: /^https?:\/\//i.test(imageUrl) ? imageUrl : "" });
  }
  return out.sort(function(a, b) { return (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0); });
}

// <link rel="alternate" type="application/rss+xml|atom+xml" href> from a page; the one whose path is closest to
// the source page (a section feed) wins over a site-wide feed.
export function discoverFeedUrl(html, pageUrl) {
  const found = [];
  const re = /<link\b[^<>]{0,2000}>/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const t = m[0];
    if (!/rel=["'][^"']*alternate/i.test(t) || !/type=["']application\/(rss|atom)\+xml["']/i.test(t)) continue;
    const href = t.match(/href=["']([^"']+)["']/i);
    if (!href) continue;
    try {
      const u = new URL(decodeEntities(href[1]), pageUrl);
      if (/^https?:$/.test(u.protocol)) found.push(u.href);
    } catch {}
  }
  if (!found.length) return "";
  let pagePath = "";
  try { pagePath = new URL(pageUrl).pathname.replace(/\/+$/, ""); } catch {}
  const segs = pagePath.split("/").filter(Boolean);
  const score = function(u) {
    let p = "";
    try { p = new URL(u).pathname; } catch {}
    return segs.filter(function(s) { return s.length > 2 && p.includes(s); }).length;
  };
  const best = found.slice().sort(function(a, b) { return score(b) - score(a); })[0];
  // A section page (/rubric/ekonomika) must not silently turn into the whole site's feed: off-topic floods.
  if (isSectionPage(pageUrl) && score(best) === 0) return "";
  return best;
}

// More than one meaningful path segment (e.g. /rubric/ekonomika, /business/consumer): a section of a site.
export function isSectionPage(pageUrl) {
  try {
    const segs = new URL(pageUrl).pathname.split("/").filter(function(s) { return s && !/^(news|novosti|lenta|all|ru|en)$/i.test(s); });
    return segs.length >= 1;
  } catch { return false; }
}

// Common feed locations tried when the page itself is blocked and no feed is known yet.
export function guessFeedUrls(pageUrl) {
  try {
    const u = new URL(pageUrl);
    const origin = u.origin;
    const path = u.pathname.replace(/\/+$/, "");
    const list = [];
    if (path && path !== "/") list.push(origin + path + "/rss", origin + path + "/feed");
    // site-wide feeds only for a site's main / news page, never for a section (off-topic floods)
    if (!isSectionPage(pageUrl)) list.push(origin + "/rss", origin + "/rss.xml", origin + "/feed", origin + "/feed/");
    return Array.from(new Set(list));
  } catch { return []; }
}
