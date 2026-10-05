// SSRF-safe HTTP client for third-party URLs (news sources, article media, uploads).
//
// Never use it for the fixed trusted hosts (api.telegram.org, api.vk.com, LLM APIs):
// those stay on plain fetch(). Everything whose URL is controlled by a news source or an
// operator-supplied value goes through safeFetch().
//
// What it enforces:
//   * only http: / https:, no credentials in the URL, ports 80/443 by default
//     (override: SAFE_FETCH_ALLOWED_PORTS="80,443,8080");
//   * the hostname is resolved by OUR lookup hook and every returned address must be a public
//     unicast address; that same validated address is the one the socket connects to, so a
//     DNS-rebinding answer between "check" and "connect" cannot redirect the request;
//   * IP literals are normalised by the WHATWG URL parser first (decimal 2130706433, octal
//     0177.0.0.1, hex 0x7f.1 all become 127.0.0.1), then checked, IPv4-mapped / NAT64 / 6to4
//     IPv6 forms are unwrapped and checked as IPv4;
//   * redirects are followed manually (max 3) and each hop is re-validated from scratch;
//   * overall timeout and a hard streaming cap on the (decompressed) body: no unbounded
//     response.text() / arrayBuffer().
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import zlib from "node:zlib";
import tls from "node:tls";

export class SafeFetchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
  }
}

// ---------------------------------------------------------------- address classification

function ipv4ToInt(ip) {
  const p = ip.split(".").map(Number);
  return (((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3]) >>> 0;
}

// [network, prefixLength]
const BLOCKED_V4 = [
  ["0.0.0.0", 8],        // "this" network
  ["10.0.0.0", 8],       // RFC1918
  ["100.64.0.0", 10],    // CGNAT
  ["127.0.0.0", 8],      // loopback
  ["169.254.0.0", 16],   // link-local, cloud metadata (169.254.169.254)
  ["172.16.0.0", 12],    // RFC1918
  ["192.0.0.0", 24],     // IETF protocol assignments
  ["192.0.2.0", 24],     // TEST-NET-1
  ["192.88.99.0", 24],   // 6to4 relay anycast
  ["192.168.0.0", 16],   // RFC1918
  ["198.18.0.0", 15],    // benchmarking
  ["198.51.100.0", 24],  // TEST-NET-2
  ["203.0.113.0", 24],   // TEST-NET-3
  ["224.0.0.0", 4],      // multicast
  ["240.0.0.0", 4]       // reserved + broadcast
].map(function(entry) {
  const bits = entry[1];
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { net: (ipv4ToInt(entry[0]) & mask) >>> 0, mask: mask };
});

export function isBlockedIPv4(ip) {
  if (!net.isIPv4(ip)) return true;
  const n = ipv4ToInt(ip);
  for (const r of BLOCKED_V4) if (((n & r.mask) >>> 0) === r.net) return true;
  return false;
}

// Parse any IPv6 text (including "::", "::ffff:1.2.3.4") into 8 16-bit groups, or null.
function parseIPv6(input) {
  let s = String(input).split("%")[0].toLowerCase();
  if (!net.isIPv6(s)) return null;
  let tailGroups = [];
  const m = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    const v4 = m[2].split(".").map(Number);
    s = m[1] + ((v4[0] << 8) | v4[1]).toString(16) + ":" + ((v4[2] << 8) | v4[3]).toString(16);
  }
  const halves = s.split("::");
  const head = halves[0] ? halves[0].split(":") : [];
  tailGroups = halves.length > 1 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tailGroups.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const groups = head.concat(halves.length > 1 ? new Array(missing).fill("0") : [], tailGroups).map(function(g) { return parseInt(g || "0", 16); });
  return groups.length === 8 && groups.every(function(g) { return Number.isInteger(g) && g >= 0 && g <= 0xffff; }) ? groups : null;
}

function v4FromGroups(hi, lo) {
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
}

export function isBlockedIPv6(ip) {
  const g = parseIPv6(ip);
  if (!g) return true;
  const allZeroUpTo = function(n) { for (let i = 0; i < n; i++) if (g[i] !== 0) return false; return true; };
  if (allZeroUpTo(5) && g[5] === 0xffff) return isBlockedIPv4(v4FromGroups(g[6], g[7])); // ::ffff:a.b.c.d (IPv4-mapped)
  if (allZeroUpTo(6)) return true;                                                      // ::, ::1 and IPv4-compatible ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) return isBlockedIPv4(v4FromGroups(g[6], g[7])); // NAT64 64:ff9b::/96
  if (g[0] === 0x2002) return isBlockedIPv4(v4FromGroups(g[1], g[2]));                  // 6to4 2002::/16 embeds an IPv4
  if ((g[0] & 0xe000) !== 0x2000) return true;                                          // only global unicast 2000::/3 is allowed
  if (g[0] === 0x2001 && g[1] < 0x0200) return true;                                    // 2001::/23 IETF assignments, Teredo, ORCHID
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;                                  // documentation
  if (g[0] === 0x3fff && g[1] < 0x1000) return true;                                    // documentation 3fff::/20
  return false;                                                                         // note: fc00::/7 ULA, fe80::/10, ff00::/8 are outside 2000::/3
}

// True when the address must never be contacted from the server.
export function isBlockedIp(ip) {
  const s = String(ip || "").trim().replace(/^\[|\]$/g, "");
  if (net.isIPv4(s)) return isBlockedIPv4(s);
  if (net.isIPv6(s)) return isBlockedIPv6(s);
  return true; // not an IP at all: refuse
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home.arpa", ".railway.internal"];

export function isBlockedHostname(hostname) {
  const h = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h === "metadata" || h === "metadata.google.internal") return true;
  return BLOCKED_HOST_SUFFIXES.some(function(sfx) { return h.endsWith(sfx); });
}

// ---------------------------------------------------------------- URL validation

function allowedPortsFromEnv() {
  const raw = String(process.env.SAFE_FETCH_ALLOWED_PORTS || "80,443");
  const ports = raw.split(",").map(function(x) { return Number(x.trim()); }).filter(function(n) { return Number.isInteger(n) && n > 0 && n < 65536; });
  return ports.length ? ports : [80, 443];
}

// Returns a parsed URL or throws SafeFetchError. Does not touch the network.
export function validateUrl(rawUrl, opts) {
  const o = opts || {};
  const ipFilter = o.ipFilter || isBlockedIp;
  let u;
  try { u = new URL(String(rawUrl || "").trim()); } catch { throw new SafeFetchError("bad_url", "Некорректный URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new SafeFetchError("bad_scheme", "Разрешены только http/https URL");
  if (u.username || u.password) throw new SafeFetchError("bad_url", "URL с логином/паролем не разрешён");
  const ports = o.allowedPorts || allowedPortsFromEnv();
  const port = u.port ? Number(u.port) : (u.protocol === "https:" ? 443 : 80);
  if (!ports.includes(port)) throw new SafeFetchError("bad_port", "Порт " + port + " не разрешён");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (ipFilter(host)) throw new SafeFetchError("blocked_address", "Адрес запрещён: " + host);
  } else if (!o.skipHostnameBlocklist && isBlockedHostname(host)) {
    throw new SafeFetchError("blocked_address", "Хост запрещён: " + host);
  }
  return u;
}

// ---------------------------------------------------------------- the client

function makeLookup(ipFilter, resolver) {
  return function safeLookup(hostname, options, callback) {
    if (typeof options === "function") { callback = options; options = {}; }
    const wantAll = Boolean(options && options.all);
    const family = options && options.family ? Number(options.family) : 0;
    Promise.resolve(resolver(hostname)).then(function(list) {
      let addrs = (Array.isArray(list) ? list : [list]).map(function(a) {
        return typeof a === "string" ? { address: a, family: net.isIPv6(a) ? 6 : 4 } : { address: a.address, family: a.family || (net.isIPv6(a.address) ? 6 : 4) };
      });
      if (!addrs.length) throw new SafeFetchError("dns", "DNS не вернул адресов для " + hostname);
      // Strict: if ANY returned address is internal the whole name is refused (split-horizon / rebinding answers).
      const bad = addrs.find(function(a) { return ipFilter(a.address); });
      if (bad) throw new SafeFetchError("blocked_address", "Хост " + hostname + " указывает на запрещённый адрес");
      if (family) addrs = addrs.filter(function(a) { return a.family === family; });
      if (!addrs.length) throw new SafeFetchError("dns", "Нет адресов нужного семейства для " + hostname);
      if (wantAll) callback(null, addrs);
      else callback(null, addrs[0].address, addrs[0].family);
    }).catch(function(error) { callback(error); });
  };
}

function defaultResolver(hostname) {
  return dns.promises.lookup(hostname, { all: true, verbatim: true });
}

function headersFromRaw(raw) {
  const h = new Headers();
  for (let i = 0; i + 1 < raw.length; i += 2) { try { h.append(raw[i], raw[i + 1]); } catch {} }
  return h;
}

function decoderFor(encoding) {
  const e = String(encoding || "").toLowerCase().trim();
  if (e === "gzip" || e === "x-gzip") return zlib.createGunzip();
  if (e === "deflate") return zlib.createInflate();
  if (e === "br") return zlib.createBrotliDecompress();
  return null;
}

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

// Error text for socket failures. Happy-eyeballs (several addresses tried) fails with an AggregateError whose
// message is empty, which reached the logs as a bare "AggregateError".
export function networkErrorText(error) {
  if (!error) return "network error";
  if (Array.isArray(error.errors) && error.errors.length) {
    const parts = error.errors.map(function(e) { return (e && (e.code || e.message)) || String(e); });
    return "connect failed (" + Array.from(new Set(parts)).join(", ") + ")";
  }
  return String(error.message || error.code || error);
}

// Parses an operator-supplied HTTP proxy URL (http://user:pass@host:port). The proxy is a trusted, fixed value
// from the environment; target URLs are still validated by validateUrl() before going through it.
export function parseProxyUrl(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  let u;
  try { u = new URL(text); } catch { throw new SafeFetchError("bad_proxy", "Некорректный адрес прокси"); }
  if (u.protocol !== "http:") throw new SafeFetchError("bad_proxy", "Поддерживается только http:// прокси");
  const auth = u.username ? "Basic " + Buffer.from(decodeURIComponent(u.username) + ":" + decodeURIComponent(u.password || "")).toString("base64") : "";
  return { host: u.hostname.replace(/^\[|\]$/g, ""), port: Number(u.port || 80), auth: auth, label: u.hostname + ":" + (u.port || 80) };
}

// Opens a CONNECT tunnel through the proxy to host:port. Resolves with the raw socket.
function openProxyTunnel(proxy, host, port, deadline) {
  return new Promise(function(resolve, reject) {
    const headers = { host: host + ":" + port };
    if (proxy.auth) headers["proxy-authorization"] = proxy.auth;
    const req = http.request({ host: proxy.host, port: proxy.port, method: "CONNECT", path: host + ":" + port, headers: headers, agent: false });
    const timer = setTimeout(function() { req.destroy(); reject(new SafeFetchError("timeout", "Прокси не ответил вовремя")); }, Math.max(1, deadline - Date.now()));
    req.on("connect", function(res, socket) {
      clearTimeout(timer);
      if (res.statusCode !== 200) { socket.destroy(); reject(new SafeFetchError("proxy", "Прокси отказал: HTTP " + res.statusCode)); return; }
      resolve(socket);
    });
    req.on("error", function(error) { clearTimeout(timer); reject(new SafeFetchError("proxy", "Прокси недоступен: " + networkErrorText(error))); });
    req.end();
  });
}

// One hop. Resolves with { status, headers, location, body } where body is only read for non-redirects.
async function requestOnce(u, o) {
  let tunnel = null;
  if (o.proxy && u.protocol === "https:") tunnel = await openProxyTunnel(o.proxy, u.hostname.replace(/^\[|\]$/g, ""), Number(u.port || 443), o.deadline);
  try {
    return await requestOnceRaw(u, o, tunnel);
  } finally {
    // The body is fully buffered before requestOnceRaw resolves, so the tunnel is never needed afterwards.
    if (tunnel) tunnel.destroy();
  }
}

// One-shot agent whose only connection is TLS over the already opened CONNECT tunnel. (A request-level
// createConnection is ignored when agent:false, which silently sent "proxied" HTTPS straight to the target.)
function tunnelAgent(tunnel, servername) {
  const agent = new https.Agent({ keepAlive: false, maxSockets: 1 });
  agent.createConnection = function(options) {
    // certificate verification stays on (default rejectUnauthorized), checked against the target host name
    const tlsOptions = { socket: tunnel, servername: servername, host: options.host };
    if (options.rejectUnauthorized === false) tlsOptions.rejectUnauthorized = false; // never set by our callers
    return tls.connect(tlsOptions);
  };
  return agent;
}

function requestOnceRaw(u, o, tunnel) {
  return new Promise(function(resolve, reject) {
    const lib = u.protocol === "https:" ? https : http;
    const headers = Object.assign({ "accept-encoding": "gzip, deflate, br" }, o.headers || {});
    let settled = false;
    let req;
    const finish = function(fn, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (o.signal) o.signal.removeEventListener("abort", onAbort);
      fn(value);
    };
    const fail = function(error) { try { req && req.destroy(); } catch {} finish(reject, error); };
    const timer = setTimeout(function() { fail(new SafeFetchError("timeout", "Таймаут запроса (" + o.timeoutMs + " мс)")); }, Math.max(1, o.deadline - Date.now()));
    const onAbort = function() { fail(new SafeFetchError("timeout", "Запрос отменён")); };
    if (o.signal) { if (o.signal.aborted) return onAbort(); o.signal.addEventListener("abort", onAbort); }

    const targetHost = u.hostname.replace(/^\[|\]$/g, "");
    let reqOptions;
    if (tunnel) {
      // HTTPS through the proxy: TLS runs end-to-end over the CONNECT tunnel (the proxy sees only ciphertext).
      reqOptions = { protocol: "https:", hostname: targetHost, port: u.port || 443, path: u.pathname + u.search, method: o.method, headers: headers,
        agent: tunnelAgent(tunnel, net.isIP(targetHost) ? undefined : targetHost), servername: net.isIP(targetHost) ? undefined : targetHost,
        lookup: function(host, lookupOptions, callback) { (typeof lookupOptions === "function" ? lookupOptions : callback)(new SafeFetchError("blocked_address", "direct connection is not allowed for a proxied request")); } };
    } else if (o.proxy) {
      // plain HTTP through the proxy: absolute URL in the request line
      const h = Object.assign({}, headers, { host: u.host });
      if (o.proxy.auth) h["proxy-authorization"] = o.proxy.auth;
      reqOptions = { protocol: "http:", hostname: o.proxy.host, port: o.proxy.port, path: u.href, method: o.method, headers: h, agent: false };
    } else {
      reqOptions = { protocol: u.protocol, hostname: targetHost, port: u.port || (u.protocol === "https:" ? 443 : 80), path: u.pathname + u.search, method: o.method, headers: headers, lookup: o.lookup, agent: false };
      if (o.family === 4 || o.family === 6) { reqOptions.family = o.family; reqOptions.autoSelectFamily = false; }
    }
    req = (tunnel ? https : (o.proxy ? http : lib)).request(reqOptions, function(res) {
      const status = res.statusCode || 0;
      const rawHeaders = headersFromRaw(res.rawHeaders || []);
      if (REDIRECT_CODES.has(status)) {
        res.resume();
        return finish(resolve, { status: status, headers: rawHeaders, location: String(res.headers.location || ""), body: Buffer.alloc(0) });
      }
      const declared = Number(res.headers["content-length"] || 0);
      const encoding = String(res.headers["content-encoding"] || "").toLowerCase();
      if (!encoding && declared > o.maxBytes) {
        res.destroy();
        return finish(reject, new SafeFetchError("too_large", "Ответ больше лимита " + o.maxBytes + " байт"));
      }
      if (o.validateResponse) {
        try { o.validateResponse({ status: status, headers: rawHeaders, url: u.href }); } catch (error) { res.destroy(); return finish(reject, error); }
      }
      if (o.method === "HEAD" || status === 204 || status === 304) {
        res.resume();
        return finish(resolve, { status: status, headers: rawHeaders, location: "", body: Buffer.alloc(0) });
      }
      let stream = res;
      if (encoding && encoding !== "identity") {
        const dec = decoderFor(encoding);
        if (!dec) { res.destroy(); return finish(reject, new SafeFetchError("network", "Неподдерживаемое Content-Encoding: " + encoding)); }
        dec.on("error", function(error) { fail(new SafeFetchError("network", "Ошибка распаковки: " + error.message)); });
        res.on("error", function(error) { fail(new SafeFetchError("network", error.message)); });
        stream = res.pipe(dec);
      }
      const chunks = [];
      let total = 0;
      stream.on("data", function(chunk) {
        total += chunk.length;
        if (total > o.maxBytes) { fail(new SafeFetchError("too_large", "Ответ больше лимита " + o.maxBytes + " байт")); return; }
        chunks.push(chunk);
      });
      stream.on("end", function() { finish(resolve, { status: status, headers: rawHeaders, location: "", body: Buffer.concat(chunks, total) }); });
      stream.on("error", function(error) { fail(error instanceof SafeFetchError ? error : new SafeFetchError("network", error.message)); });
      res.on("aborted", function() { fail(new SafeFetchError("network", "Соединение прервано")); });
    });
    req.on("error", function(error) { fail(error instanceof SafeFetchError ? error : (error && error.code && /^(blocked_address|dns)$/.test(error.code) ? error : new SafeFetchError("network", networkErrorText(error)))); });
    req.end();
  });
}

// Factory so tests can inject a resolver / address filter. Production code uses the default export below.
export function createSafeFetch(config) {
  const cfg = config || {};
  const ipFilter = cfg.ipFilter || isBlockedIp;
  const resolver = cfg.resolver || defaultResolver;
  const lookup = makeLookup(ipFilter, resolver);

  return async function safeFetch(rawUrl, options) {
    const opts = options || {};
    const method = String(opts.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") throw new SafeFetchError("bad_method", "safeFetch поддерживает только GET/HEAD");
    const maxBytes = Math.max(1, Number(opts.maxBytes || 5 * 1024 * 1024));
    const maxRedirects = opts.maxRedirects == null ? 3 : Math.max(0, Number(opts.maxRedirects));
    const timeoutMs = Math.max(1, Number(opts.timeoutMs || 15000));
    const deadline = Date.now() + timeoutMs;
    const allowedPorts = cfg.allowedPorts || opts.allowedPorts || allowedPortsFromEnv();

    // opts.proxy: parsed proxy (parseProxyUrl) or a URL string. Through an external proxy our own network is out of
    // reach, but every hop is still validated (scheme, port, IP literals, blocked host names).
    const proxy = opts.proxy ? (typeof opts.proxy === "string" ? parseProxyUrl(opts.proxy) : opts.proxy) : null;
    let current = String(rawUrl || "").trim();
    let redirected = false;
    // v0.54.1: cookies set by a redirect are sent back to the SAME host on the next hop (per call, never stored).
    // Some shops (Pepper) redirect in a loop until the visitor returns the cookie they were just given.
    const jar = new Map();
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const u = validateUrl(current, { ipFilter: ipFilter, allowedPorts: allowedPorts, skipHostnameBlocklist: cfg.skipHostnameBlocklist });
      let hopHeaders = opts.headers;
      const hostJar = jar.get(u.hostname);
      if (hostJar && hostJar.size) {
        const own = Array.from(hostJar.entries()).map(function(e){ return e[0] + "=" + e[1]; }).join("; ");
        hopHeaders = Object.assign({}, opts.headers || {});
        const key = Object.keys(hopHeaders).find(function(k){ return k.toLowerCase() === "cookie"; });
        if (key) hopHeaders[key] = String(hopHeaders[key]) + "; " + own; else hopHeaders.cookie = own;
      }
      const r = await requestOnce(u, { method: method, headers: hopHeaders, maxBytes: maxBytes, timeoutMs: timeoutMs, deadline: deadline, signal: opts.signal, lookup: lookup, validateResponse: opts.validateResponse, proxy: proxy, family: opts.family });
      if (REDIRECT_CODES.has(r.status) && r.location) {
        if (hop >= maxRedirects) throw new SafeFetchError("too_many_redirects", "Слишком много редиректов");
        try {
          const setCookies = r.headers && typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [];
          for (const sc of setCookies) {
            const first = String(sc || "").split(";")[0];
            const eq = first.indexOf("=");
            if (eq <= 0) continue;
            if (!jar.has(u.hostname)) jar.set(u.hostname, new Map());
            const name = first.slice(0, eq).trim(), value = first.slice(eq + 1).trim();
            if (/;\s*max-age=0/i.test(sc) || !value) jar.get(u.hostname).delete(name); else jar.get(u.hostname).set(name, value);
          }
        } catch {}
        try { current = new URL(r.location, u).href; } catch { throw new SafeFetchError("bad_url", "Некорректный redirect Location"); }
        redirected = true;
        continue;
      }
      const body = r.body;
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        url: u.href,
        redirected: redirected,
        headers: r.headers,
        body: body,
        text: async function() { return body.toString("utf8"); },
        arrayBuffer: async function() { return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength); }
      };
    }
    throw new SafeFetchError("too_many_redirects", "Слишком много редиректов");
  };
}

export const safeFetch = createSafeFetch();
