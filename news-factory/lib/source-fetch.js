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
  const stats = { direct: 0, ipv4: 0, proxy: 0, failed: 0 };

  async function attempt(url, init, extra) {
    try { return { response: await fetchImpl(url, Object.assign({}, init, extra)) }; }
    catch (error) { return { error: error }; }
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

function decodeEntities(text) {
  return String(text || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, function(m, n) { const c = Number(n); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ""; })
    .replace(/&#x([0-9a-f]+);/gi, function(m, n) { const c = parseInt(n, 16); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ""; })
    .replace(/&amp;/g, "&");
}

function stripTags(html) {
  // feeds carry escaped HTML: decode once to get the markup, drop the tags, then decode the text entities
  return decodeEntities(decodeEntities(String(html || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"))
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/&nbsp;| /g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

function tag(block, name) {
  const m = block.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + name + ">", "i"));
  return m ? m[1] : "";
}

export function looksLikeFeed(text) {
  const head = String(text || "").slice(0, 2000);
  return /<rss[\s>]|<feed[\s>][\s\S]*?xmlns=["']http:\/\/www\.w3\.org\/2005\/Atom|<rdf:RDF/i.test(head);
}

// -> [{url, title, text, publishedAt, imageUrl}], newest first, http(s) links only.
export function parseFeed(xml, baseUrl) {
  const src = String(xml || "");
  const out = [];
  const blocks = src.match(/<item[\s>][\s\S]*?<\/item>/gi) || src.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const block of blocks) {
    let link = stripTags(tag(block, "link"));
    if (!link) {
      const alt = block.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) || block.match(/<link\b[^>]*href=["']([^"']+)["']/i);
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
    const img = block.match(/<enclosure\b[^>]*url=["']([^"']+)["'][^>]*type=["']image\//i) || block.match(/<enclosure\b[^>]*type=["']image\/[^"']*["'][^>]*url=["']([^"']+)["']/i) ||
      block.match(/<media:content\b[^>]*url=["']([^"']+)["']/i) || block.match(/<media:thumbnail\b[^>]*url=["']([^"']+)["']/i);
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
  const re = /<link\b[^>]*>/gi;
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
  return found.slice().sort(function(a, b) { return score(b) - score(a); })[0];
}

// Common feed locations tried when the page itself is blocked and no feed is known yet.
export function guessFeedUrls(pageUrl) {
  try {
    const u = new URL(pageUrl);
    const origin = u.origin;
    const list = [origin + "/rss", origin + "/rss.xml", origin + "/feed", origin + "/feed/"];
    const path = u.pathname.replace(/\/+$/, "");
    if (path && path !== "/") list.unshift(origin + path + "/rss", origin + path + "/feed");
    return Array.from(new Set(list));
  } catch { return []; }
}
