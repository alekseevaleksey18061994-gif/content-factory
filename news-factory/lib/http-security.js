// Security headers and the Origin check for state-changing requests.

// The admin UI is one large page with inline <script>, inline on* handlers and inline styles, so
// 'unsafe-inline' is required for script/style; the policy still pins everything else: no framing, no
// plugins, no foreign <base>/form targets, XHR/fetch only to the same origin (blocks exfiltration from
// injected script), Google Fonts as the only third-party origins.
export const ADMIN_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' https: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

const PRIVATE_PATH = /^\/(admin|login|api|internal|publish)(\/|$)/;

export function isPrivatePath(pathname) {
  return PRIVATE_PATH.test(String(pathname || ""));
}

// Headers that go on every response (setHeader before the handler; route-specific writeHead values override).
export function baseSecurityHeaders(pathname) {
  const h = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "strict-transport-security": "max-age=15552000"
  };
  if (isPrivatePath(pathname)) h["x-frame-options"] = "DENY";
  return h;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Returns true when the request may proceed. Non-browser clients (curl, the Railway cron, other services)
// send no Origin and are accepted; a browser always sends Origin on cross-site POSTs, and it must name this site.
export function originAllowed(req, extraHosts) {
  if (SAFE_METHODS.has(String(req.method || "GET").toUpperCase())) return true;
  const origin = req.headers && req.headers.origin;
  const fetchSite = String(req.headers && req.headers["sec-fetch-site"] || "").toLowerCase();
  if (origin === undefined || origin === "") return fetchSite !== "cross-site";
  let originHost;
  try { originHost = new URL(String(origin)).host.toLowerCase(); } catch { return false; } // "null" and garbage
  const allowed = new Set();
  const add = function(h) { if (h) allowed.add(String(h).split(",")[0].trim().toLowerCase()); };
  add(req.headers.host);
  add(req.headers["x-forwarded-host"]);
  (extraHosts || []).forEach(add);
  return allowed.has(originHost);
}
