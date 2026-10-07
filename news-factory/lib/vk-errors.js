// Extracted from server.js (v0.62.0 module split). Behaviour is unchanged.
import { escapeHtml } from "./article-extract.js";
import { VK_ACCESS_TOKEN, VK_API_VERSION, VK_GROUP_ID } from "./env-config.js";

export function vkOAuthCallbackHtml(ok, message) {
  const cls = ok ? "ok" : "bad";
  const title = ok ? "VK подключён" : "Ошибка подключения VK";
  const safeMessage = escapeHtml(String(message || ""));
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>VK OAuth — News Factory</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0b0f17;color:#fff;margin:0;padding:28px}
.card{max-width:620px;margin:8vh auto;background:#111722;border:1px solid #293347;border-radius:22px;padding:24px}
h2{margin:0 0 12px}.muted{color:#9aa7ba;line-height:1.5}.ok{color:#71e0a7}.bad{color:#ff8d8d}
a{color:#8db0ff}
</style>
</head>
<body>
<div class="card">
<h2>${title}</h2>
<p class="${cls}">${safeMessage}</p>
<p class="muted">Эту вкладку можно закрыть и вернуться в ChatGPT.</p>
<p><a href="/admin#social">Вернуться в News Factory</a></p>
</div>
</body>
</html>`;
}

export function vkPostContext(post, extra) {
  const p = post || {};
  return Object.assign({
    topicId: String(p.topicId || p.topic_id || "default"),
    postId: String(p.postId || p.id || p.newsId || "unknown"),
    slug: String(p.slug || p.previewSlug || p.vkPreviewSlug || "")
  }, extra || {});
}

export function vkErrorPayload(method, errorCode, errorMsg, context) {
  const ctx = context || {};
  return {
    method: String(method || ""),
    error_code: errorCode == null ? null : errorCode,
    error_msg: String(errorMsg || ""),
    topic_id: String(ctx.topicId || "default"),
    post_id: String(ctx.postId || "unknown"),
    slug: String(ctx.slug || ""),
    attempt: Number(ctx.attempt || 0) || undefined,
    token_kind: String(ctx.tokenKind || "")
  };
}

export function logVkError(method, errorCode, errorMsg, context) {
  const payload = vkErrorPayload(method, errorCode, errorMsg, context);
  console.error("VK_API_ERROR " + JSON.stringify(payload));
}

export function createVkError(method, errorCode, errorMsg, context) {
  const error = new Error("VK " + method + " " + (errorCode == null ? "error" : errorCode) + ": " + String(errorMsg || "unknown error"));
  error.vkMethod = method;
  error.vkErrorCode = errorCode;
  error.vkErrorMsg = String(errorMsg || "");
  error.vkContext = context || {};
  return error;
}

export async function vkApi(method, params, options) {
  const opts = options || {};
  const token = String(opts.token || VK_ACCESS_TOKEN || "").trim();
  const tokenKind = String(opts.tokenKind || (opts.token ? "custom" : "community"));
  const context = Object.assign({}, opts.context || {}, { tokenKind: tokenKind });
  if (!token || !VK_GROUP_ID) {
    logVkError(method, "config_missing", "VK token or group ID is missing", context);
    throw createVkError(method, "config_missing", "VK token or group ID is missing", context);
  }

  const body = new URLSearchParams();
  Object.entries(params || {}).forEach(function(entry) {
    const key = entry[0], value = entry[1];
    if (value !== undefined && value !== null && value !== "") body.set(key, String(value));
  });
  body.set("access_token", token);
  body.set("v", VK_API_VERSION);

  let response;
  let data = {};
  try {
    response = await fetch("https://api.vk.com/method/" + method, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(20000)
    });
    data = await response.json().catch(function(){ return {}; });
  } catch (error) {
    logVkError(method, "network", error && error.message || error, context);
    throw createVkError(method, "network", error && error.message || error, context);
  }

  if (!response.ok || data.error) {
    const err = data && data.error;
    const code = err ? err.error_code : response.status;
    const msg = err ? err.error_msg : ("HTTP " + response.status);
    // A caller that handles a known code itself (e.g. wall.get 27 with a community token) keeps it out of the error log.
    if (!(Array.isArray(opts.quietCodes) && opts.quietCodes.map(String).includes(String(code)))) logVkError(method, code, msg, context);
    throw createVkError(method, code, msg, context);
  }

  console.log("VK_API_RESULT " + JSON.stringify(vkErrorPayload(method, null, "", context)));
  return data.response;
}

