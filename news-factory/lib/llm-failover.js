// Provider failover for the text models (OpenAI <-> Claude).
//
// Goal: when one provider has no money (or is down), publishing keeps going on the other one instead of stopping.
//  * classifyProviderFailure(): tells "no money / bad key" (billing, auth) and "provider is down" (5xx, network)
//    from ordinary errors (rate limit, bad request) which must NOT trigger a switch.
//  * createProviderBreaker(): after a billing/auth error a provider is considered down for a cooldown, so the next
//    calls skip it at once (no wasted requests, no log storm). After the cooldown one call is tried again.
//  * createResponsesFailover(): a drop-in for fetch("https://api.openai.com/v1/responses", ...). If OpenAI cannot
//    answer, the same request is sent to Claude and the answer is returned in the Responses API shape, so every
//    existing call site (headline pre-filter, scoring, translation, ...) keeps working unchanged.
//
// No new dependencies; the Claude call is a plain Messages API request.

export const BILLING_PATTERN = /no credits remaining|insufficient[_ ]quota|exceeded your current quota|credit balance is too low|billing[_ ]hard[_ ]limit|billing hard limit|payment required|insufficient funds|out of credits|plans & billing|account is not active|account has been deactivated|reached (?:your|its|the) (?:specified )?(?:api )?usage limits?|usage limits? (?:have been|has been) reached/i;
const AUTH_PATTERN = /invalid[_ ]api[_ ]key|incorrect api key|invalid x-api-key|authentication[_ ]error|api key.*(revoked|disabled|expired)|permission[_ ]error|organization.*disabled/i;

// -> "billing" | "auth" | "outage" | "rate_limit" | "other"
export function classifyProviderFailure(input) {
  const status = Number(input && input.status || 0);
  const message = String(input && input.message || "");
  if (status === 402 || BILLING_PATTERN.test(message)) return "billing";
  if (status === 401 || AUTH_PATTERN.test(message)) return "auth";
  if (status === 429) return "rate_limit";
  if (status >= 500 || /fetch failed|network|timeout|timed out|aborted|ECONNRESET|ECONNREFUSED|ENOTFOUND|overloaded/i.test(message)) return "outage";
  return "other";
}

// The kind of a failure carried by an error / checker result: explicit failureKind first, otherwise from status + text.
export function failureKindOf(error) {
  if (!error) return "other";
  if (error.failureKind) return error.failureKind;
  return classifyProviderFailure({ status: error.status, message: error.message || error.error });
}

// Kinds that justify switching to the other provider.
export function failoverKind(kind) { return kind === "billing" || kind === "auth" || kind === "outage"; }
// Kinds that keep a provider switched off for the cooldown (an outage may be a one-off, money does not come back by itself).
export function tripsBreaker(kind) { return kind === "billing" || kind === "auth"; }

export function createProviderBreaker(options) {
  const opt = options || {};
  const cooldownMs = Math.max(1000, Number(opt.cooldownMs || 10 * 60 * 1000));
  const now = typeof opt.now === "function" ? opt.now : function() { return Date.now(); };
  const state = new Map();
  return {
    cooldownMs: cooldownMs,
    trip: function(provider, reason, kind) {
      const prev = state.get(provider);
      const wasOpen = Boolean(prev && prev.until > now());
      state.set(provider, { until: now() + cooldownMs, reason: String(reason || ""), kind: kind || "billing", since: wasOpen ? prev.since : now() });
      if (!wasOpen && typeof opt.onTrip === "function") { try { opt.onTrip(provider, String(reason || ""), kind || "billing"); } catch {} }
    },
    isOpen: function(provider) { const s = state.get(provider); return Boolean(s && s.until > now()); },
    reason: function(provider) { const s = state.get(provider); return s ? s.reason : ""; },
    kind: function(provider) { const s = state.get(provider); return s ? s.kind : ""; },
    recordSuccess: function(provider) {
      const s = state.get(provider);
      if (!s) return;
      state.delete(provider);
      if (typeof opt.onRecover === "function") { try { opt.onRecover(provider); } catch {} }
    },
    snapshot: function() {
      const out = {};
      for (const [provider, s] of state) if (s.until > now()) out[provider] = { open: s.until > now(), kind: s.kind, reason: s.reason.slice(0, 200), retryAt: new Date(s.until).toISOString() };
      return out;
    }
  };
}

// An error to throw instead of calling a provider that is switched off.
export function breakerError(provider, breaker) {
  const error = new Error(breaker.reason(provider) || (provider + " временно отключён"));
  error.providerDown = provider;
  error.failureKind = breaker.kind(provider) || "billing";
  return error;
}

// ---------------------------------------------------------------------------
// Claude Messages API (plain, no structured outputs)
// ---------------------------------------------------------------------------

export function claudeText(data) {
  const blocks = Array.isArray(data && data.content) ? data.content : [];
  return blocks.filter(function(b) { return b && b.type === "text" && typeof b.text === "string"; }).map(function(b) { return b.text; }).join("\n").trim();
}

export async function callClaudeMessages(params) {
  const p = params || {};
  const fetchImpl = p.fetch || globalThis.fetch;
  const send = function(withTemperature) {
    const body = { model: p.model, max_tokens: p.maxTokens || 4000, messages: p.messages };
    if (p.system) body.system = p.system;
    if (withTemperature && typeof p.temperature === "number") body.temperature = Math.max(0, Math.min(1, p.temperature));
    return fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": p.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(p.timeoutMs || 90000)
    });
  };
  let response = await send(true);
  let data = await response.json().catch(function() { return {}; });
  const msg = function(d) { return String(d && d.error && d.error.message || ""); };
  if (!response.ok && response.status === 400 && typeof p.temperature === "number" && /temperature/i.test(msg(data))) {
    response = await send(false);
    data = await response.json().catch(function() { return {}; });
  }
  if (!response.ok) {
    const error = new Error(msg(data) || ("Anthropic HTTP " + response.status));
    error.status = response.status;
    throw error;
  }
  return { data: data, text: claudeText(data), usage: data && data.usage || {}, model: p.model };
}

// ---------------------------------------------------------------------------
// Responses API request -> Claude, Claude answer -> Responses API shape
// ---------------------------------------------------------------------------

function partsToClaude(content) {
  if (typeof content === "string") return content;
  const out = [];
  for (const part of Array.isArray(content) ? content : []) {
    if (!part || typeof part !== "object") continue;
    if (typeof part.text === "string" && /^(input_text|output_text|text)$/.test(String(part.type || "text"))) { out.push({ type: "text", text: part.text }); continue; }
    if (part.type === "input_image" && part.image_url) {
      const url = typeof part.image_url === "string" ? part.image_url : String(part.image_url.url || "");
      const m = /^data:([^;,]+);base64,(.+)$/s.exec(url);
      if (m) out.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
      else if (/^https?:\/\//i.test(url)) out.push({ type: "image", source: { type: "url", url: url } });
    }
  }
  return out.length ? out : "";
}

// Returns null when the request cannot be expressed for Claude (tools, streaming, nothing to say).
export function responsesRequestToClaude(body) {
  if (!body || typeof body !== "object") return null;
  if ((Array.isArray(body.tools) && body.tools.length) || body.stream) return null;
  const systemParts = [];
  if (typeof body.instructions === "string" && body.instructions.trim()) systemParts.push(body.instructions.trim());
  const messages = [];
  const push = function(role, content) {
    if (!content || (Array.isArray(content) && !content.length)) return;
    const last = messages[messages.length - 1];
    if (last && last.role === role) {
      const a = typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content;
      const b = typeof content === "string" ? [{ type: "text", text: content }] : content;
      last.content = a.concat(b);
    } else messages.push({ role: role, content: content });
  };
  if (typeof body.input === "string") push("user", body.input);
  else if (Array.isArray(body.input)) {
    for (const item of body.input) {
      if (!item || typeof item !== "object") continue;
      const role = String(item.role || "user");
      const content = partsToClaude(item.content);
      if (role === "system" || role === "developer") {
        const text = typeof content === "string" ? content : (content || []).map(function(c) { return c.text || ""; }).join("\n");
        if (text.trim()) systemParts.push(text.trim());
      } else push(role === "assistant" ? "assistant" : "user", content);
    }
  }
  if (!messages.length || messages[0].role !== "user") return null;
  const format = body.text && body.text.format;
  let expectsJson = false;
  if (format && format.type === "json_object") {
    expectsJson = true;
    systemParts.push("Ответь только одним валидным JSON-объектом без markdown, без пояснений до и после.");
  } else if (format && format.type === "json_schema" && format.schema) {
    expectsJson = true;
    systemParts.push("Ответь только одним валидным JSON-объектом без markdown и пояснений, строго по этой JSON-схеме:\n" + JSON.stringify(format.schema));
  }
  const maxTokens = Math.max(256, Math.min(16000, Number(body.max_output_tokens) || 4000));
  const temperature = typeof body.temperature === "number" && body.temperature >= 0 && body.temperature <= 1 ? body.temperature : undefined;
  return { system: systemParts.join("\n\n"), messages: messages, maxTokens: maxTokens, temperature: temperature, expectsJson: expectsJson };
}

// Claude likes to wrap JSON in ```json fences or add a sentence; the OpenAI json_object mode never does.
export function cleanJsonAnswer(text) {
  const raw = String(text || "").trim();
  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try { JSON.parse(unfenced); return unfenced; } catch {}
  const first = unfenced.indexOf("{"), last = unfenced.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const slice = unfenced.slice(first, last + 1);
    try { JSON.parse(slice); return slice; } catch {}
  }
  return raw;
}

export function claudeAnswerAsResponses(text, model) {
  return {
    id: "resp_failover_" + Math.random().toString(36).slice(2, 12),
    object: "response",
    status: "completed",
    model: model,
    output_text: text,
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: text }] }],
    // Real usage is recorded as an Anthropic cost event by the failover itself; zero here avoids a second, wrong price.
    usage: { input_tokens: 0, output_tokens: 0 },
    failover: { provider: "anthropic" }
  };
}

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), { status: status, headers: { "content-type": "application/json" } });
}

// Drop-in for fetch(OpenAI /v1/responses): OpenAI first, Claude when OpenAI has no money / is down.
export function createResponsesFailover(config) {
  const cfg = config || {};
  // Resolved on every call, so a later replacement of the global fetch (tests, instrumentation) is honoured.
  const fetchImpl = function(url, init) { return (cfg.fetch || globalThis.fetch)(url, init); };
  const breaker = cfg.breaker || createProviderBreaker();
  const claudeAvailable = function() { return Boolean(cfg.anthropicApiKey) && !breaker.isOpen("anthropic"); };

  async function viaClaude(translated, why) {
    try {
      const result = await callClaudeMessages({
        fetch: fetchImpl, apiKey: cfg.anthropicApiKey, model: cfg.anthropicModel,
        system: translated.system, messages: translated.messages, maxTokens: translated.maxTokens,
        temperature: translated.temperature, timeoutMs: cfg.timeoutMs || 45000
      });
      breaker.recordSuccess("anthropic");
      if (typeof cfg.onUsage === "function") {
        try { cfg.onUsage({ provider: "anthropic", model: cfg.anthropicModel, purpose: "failover_responses", usage: result.usage, endpoint: "messages", newsId: "", extra: { failover_from: "openai", why: why } }); } catch {}
      }
      // Claude likes fences or a lead-in sentence; every caller of this adapter parses JSON, so hand over clean JSON
      // whenever the answer contains one (plain-text answers stay untouched).
      const cleaned = cleanJsonAnswer(result.text);
      let isJson = false;
      try { JSON.parse(cleaned); isJson = true; } catch {}
      const text = translated.expectsJson || isJson ? cleaned : result.text;
      if (typeof cfg.onFailover === "function") { try { cfg.onFailover({ from: "openai", to: "anthropic", why: why }); } catch {} }
      return jsonResponse(200, claudeAnswerAsResponses(text, cfg.anthropicModel));
    } catch (error) {
      const kind = classifyProviderFailure({ status: error && error.status, message: error && error.message });
      if (tripsBreaker(kind)) breaker.trip("anthropic", error.message, kind);
      return null;
    }
  }

  return async function responsesFetch(url, init) {
    let translated = null;
    let wantsClaude = false;
    if (cfg.anthropicApiKey && init && typeof init.body === "string") {
      try { translated = responsesRequestToClaude(JSON.parse(init.body)); } catch { translated = null; }
    }
    wantsClaude = Boolean(translated);

    // OpenAI is switched off (no money): go straight to Claude. Only when Claude can really answer; otherwise OpenAI
    // is still asked, so a top-up is noticed at once instead of after the cooldown.
    if (breaker.isOpen("openai") && wantsClaude && claudeAvailable()) {
      const viaC = await viaClaude(translated, "openai_switched_off");
      if (viaC) return viaC;
    }

    let response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      if (wantsClaude && claudeAvailable()) {
        const viaC = await viaClaude(translated, "openai_unreachable");
        if (viaC) return viaC;
      }
      throw error;
    }
    if (response.ok) { breaker.recordSuccess("openai"); return response; }

    let message = "";
    try { const data = await response.clone().json(); message = String(data && data.error && data.error.message || ""); } catch {}
    const kind = classifyProviderFailure({ status: response.status, message: message });
    if (tripsBreaker(kind)) breaker.trip("openai", message || ("HTTP " + response.status), kind);
    if (failoverKind(kind) && wantsClaude && claudeAvailable()) {
      const viaC = await viaClaude(translated, "openai_" + kind);
      if (viaC) return viaC;
    }
    return response;
  };
}
