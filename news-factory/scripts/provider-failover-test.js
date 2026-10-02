// Provider failover: OpenAI or Claude out of money must not stop publishing; the other one takes over completely.
//   npm run test:provider-failover
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  classifyProviderFailure, failoverKind, tripsBreaker, createProviderBreaker, responsesRequestToClaude, cleanJsonAnswer,
  createResponsesFailover, callClaudeMessages, claudeAnswerAsResponses
} from "../lib/llm-failover.js";
import { createModelClients, createEditorialPipeline } from "../lib/editorial-v2.js";
import { loadServer } from "./dedupe-harness.js";

const cases = {};
function test(name, fn) { cases[name] = fn; }
const PROMPT = fileURLToPath(new URL("../prompts/chto-tam.md", import.meta.url));

const WRITER_OK = {
  status: "ok", channel_id: "auto", importance: 8, format: "Цифра", hook_type: "Цифра", ending_type: "что дальше",
  title_emoji: "🚘", title: "🚘 Hongqi H5 подорожал на 200 000 ₽",
  tg_text: "Hongqi H5 подорожал на 200 000 ₽\n\nОбновлённый **H5** приехал в Россию.\n\n💰 Цена — 4 480 000 ₽\n\n#новинки\n@chtotamtachki",
  vk_text: "<b>Обновлённый H5</b> приехал в Россию.\n\n💰 Цена — 4 480 000 ₽",
  cover: { big: "4 480 000 ₽", caption: "Hongqi H5", sub: null, emoji: "🚘" },
  legal_flags: [], crosspromo_target: null, entities: ["Hongqi", "H5"]
};
const PASS = { verdict: "pass", errors: [], checked_claims: 4, summary: "ok" };
const REQUEST = { now: "2026-10-02T09:00:00+03:00", sources: [{ name: "Src", url: "https://x", text: "Hongqi H5 стоит 4 480 000 ₽" }], recent_posts: [], registry: { banned_orgs: [], foreign_agents: [] } };

const OPENAI_NO_MONEY = { error: { message: "You exceeded your current quota, please check your plan and billing details.", type: "insufficient_quota" } };
const CLAUDE_NO_MONEY = { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." } };
const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const claudeOk = (text, usage) => json(200, { id: "msg_1", type: "message", role: "assistant", content: [{ type: "text", text }], stop_reason: "end_turn", usage: usage || { input_tokens: 100, output_tokens: 50 } });
const openaiOk = (text) => json(200, { id: "resp_1", output_text: text, output: [], usage: { input_tokens: 10, output_tokens: 5 } });

// A fake network that records every call. handlers: { openai(body,url), anthropic(body) } return a Response.
function fakeNet(handlers) {
  const calls = { openai: [], anthropic: [] };
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? JSON.parse(init.body) : {};
    if (u.startsWith("https://api.openai.com/")) { calls.openai.push({ url: u, body }); return handlers.openai(body, u); }
    if (u.startsWith("https://api.anthropic.com/")) { calls.anthropic.push({ url: u, body, headers: init.headers }); return handlers.anthropic(body); }
    return json(200, {});
  };
  return { calls, fetch: fetchImpl };
}
// Claude fake that answers like the real thing depending on the role in the user message.
function smartClaude(opts = {}) {
  return (body) => {
    const content = body.messages && body.messages[0] && body.messages[0].content;
    let role = "";
    try { role = JSON.parse(typeof content === "string" ? content : "{}").role; } catch {}
    if (opts.fail) return opts.fail();
    if (role === "writer") return claudeOk(opts.fenced ? "```json\n" + JSON.stringify(WRITER_OK) + "\n```" : JSON.stringify(WRITER_OK));
    if (role === "checker") return claudeOk(JSON.stringify(opts.checker || PASS));
    return claudeOk(opts.text || "{\"ok\":true}");
  };
}

// ---------------------------------------------------------------- pure units

test("F1 classifier: money/key/outage trigger a switch, rate limit and bad requests do not", async () => {
  const k = (status, message) => classifyProviderFailure({ status, message });
  assert.equal(k(429, "You exceeded your current quota, please check your plan and billing details"), "billing", "OpenAI reports no money as 429 insufficient_quota");
  assert.equal(k(400, "Your credit balance is too low to access the Anthropic API"), "billing");
  assert.equal(k(402, ""), "billing");
  assert.equal(k(200, "no credits remaining"), "billing");
  assert.equal(k(401, "Incorrect API key provided"), "auth");
  assert.equal(k(403, "invalid x-api-key"), "auth");
  assert.equal(k(429, "Rate limit reached for requests"), "rate_limit");
  assert.equal(k(500, "boom"), "outage");
  assert.equal(k(529, "Overloaded"), "outage");
  assert.equal(k(0, "fetch failed"), "outage");
  assert.equal(k(0, "The operation was aborted due to timeout"), "outage");
  assert.equal(k(400, "temperature is not supported"), "other");
  assert.equal(k(0, "OpenAI вернул не JSON"), "other", "no status and no network words is NOT an outage");
  assert.equal(k(0, ""), "other");
  assert.ok(failoverKind("billing") && failoverKind("auth") && failoverKind("outage"));
  assert.ok(!failoverKind("rate_limit") && !failoverKind("other"));
  assert.ok(tripsBreaker("billing") && tripsBreaker("auth") && !tripsBreaker("outage") && !tripsBreaker("rate_limit"));
});

test("F2 breaker: open for the cooldown, one retry after it, recovery reported once", async () => {
  let t = 1000; const events = [];
  const b = createProviderBreaker({ cooldownMs: 60000, now: () => t, onTrip: (p, r, k) => events.push("trip:" + p + ":" + k), onRecover: (p) => events.push("recover:" + p) });
  assert.equal(b.isOpen("openai"), false);
  b.trip("openai", "no money", "billing");
  b.trip("openai", "no money again", "billing");
  assert.equal(b.isOpen("openai"), true); assert.equal(b.isOpen("anthropic"), false);
  assert.deepEqual(events, ["trip:openai:billing"], "onTrip only on the first trip of a window");
  assert.equal(b.reason("openai"), "no money again");
  t += 59000; assert.equal(b.isOpen("openai"), true);
  t += 2000; assert.equal(b.isOpen("openai"), false, "cooldown over: one call may try again");
  b.trip("openai", "still no money", "billing");
  assert.equal(events.filter((e) => e.startsWith("trip")).length, 2);
  b.recordSuccess("openai"); b.recordSuccess("openai");
  assert.deepEqual(events.slice(2), ["recover:openai"]);
  assert.equal(b.isOpen("openai"), false);
  assert.deepEqual(b.snapshot(), {});
});


test("F2b breaker: billing/auth cool down longer than a transient outage", async () => {
  let t = 1000;
  const b = createProviderBreaker({
    cooldownMs: 10000,
    cooldownByKind: { billing: 60000, auth: 120000, outage: 5000 },
    now: () => t
  });
  b.trip("openai", "no money", "billing");
  t += 59000; assert.equal(b.isOpen("openai"), true);
  t += 2000; assert.equal(b.isOpen("openai"), false);
  b.trip("openai", "temporary outage", "outage");
  t += 6000; assert.equal(b.isOpen("openai"), false);
  b.trip("anthropic", "bad key", "auth");
  t += 119000; assert.equal(b.isOpen("anthropic"), true);
  t += 2000; assert.equal(b.isOpen("anthropic"), false);
});

test("F3 Responses request -> Claude request", async () => {
  assert.deepEqual(responsesRequestToClaude({ model: "m", input: "привет", max_output_tokens: 900 }), { system: "", messages: [{ role: "user", content: "привет" }], maxTokens: 900, temperature: undefined, expectsJson: false });
  const j = responsesRequestToClaude({ input: "дай json", max_output_tokens: 8000, text: { format: { type: "json_object" } } });
  assert.equal(j.expectsJson, true); assert.match(j.system, /JSON/);
  const r = responsesRequestToClaude({
    instructions: "Будь краток", temperature: 0.3, max_output_tokens: 10,
    input: [{ role: "system", content: "SYS" }, { role: "developer", content: [{ type: "input_text", text: "DEV" }] }, { role: "user", content: [{ type: "input_text", text: "A" }] }, { role: "user", content: "B" }, { role: "assistant", content: [{ type: "output_text", text: "C" }] }, { role: "user", content: "D" }]
  });
  assert.equal(r.system, "Будь краток\n\nSYS\n\nDEV");
  assert.deepEqual(r.messages.map((m) => m.role), ["user", "assistant", "user"], "consecutive user turns are merged");
  assert.deepEqual(r.messages[0].content, [{ type: "text", text: "A" }, { type: "text", text: "B" }]);
  assert.equal(r.maxTokens, 256, "clamped up to a sane minimum"); assert.equal(r.temperature, 0.3);
  assert.equal(responsesRequestToClaude({ input: "x", max_output_tokens: 999999 }).maxTokens, 16000);
  assert.equal(responsesRequestToClaude({ input: "x", tools: [{ type: "web_search" }] }), null, "tools cannot be expressed for Claude");
  assert.equal(responsesRequestToClaude({ input: "x", stream: true }), null);
  assert.equal(responsesRequestToClaude({ input: [] }), null);
  assert.equal(responsesRequestToClaude(null), null);
  const img = responsesRequestToClaude({ input: [{ role: "user", content: [{ type: "input_text", text: "что тут?" }, { type: "input_image", image_url: "data:image/png;base64,QUJD" }] }] });
  assert.deepEqual(img.messages[0].content[1], { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } });
});

test("F4 cleanJsonAnswer strips fences and chatter, leaves non-JSON alone", async () => {
  assert.equal(cleanJsonAnswer("```json\n{\"a\":1}\n```"), "{\"a\":1}");
  assert.equal(cleanJsonAnswer("Вот ответ: {\"a\":{\"b\":2}} Надеюсь, помог."), "{\"a\":{\"b\":2}}");
  assert.equal(cleanJsonAnswer("{\"a\":1}"), "{\"a\":1}");
  assert.equal(cleanJsonAnswer("просто текст"), "просто текст");
  const resp = claudeAnswerAsResponses("{\"a\":1}", "claude-x");
  assert.equal(resp.output_text, "{\"a\":1}"); assert.equal(resp.output[0].content[0].text, "{\"a\":1}");
});

test("F5 Responses failover: OpenAI ok -> untouched; no money -> Claude answers in Responses shape; breaker skips OpenAI", async () => {
  let net = fakeNet({ openai: () => openaiOk("{\"x\":1}"), anthropic: () => claudeOk("не должен вызываться") });
  let f = createResponsesFailover({ fetch: net.fetch, anthropicApiKey: "ak", anthropicModel: "claude-haiku-4-5" });
  let res = await f("https://api.openai.com/v1/responses", { method: "POST", body: JSON.stringify({ model: "m", input: "hi" }) });
  assert.equal((await res.json()).output_text, "{\"x\":1}"); assert.equal(net.calls.anthropic.length, 0);

  const usage = [];
  net = fakeNet({ openai: () => json(429, OPENAI_NO_MONEY), anthropic: () => claudeOk("```json\n{\"scores\":[1,2]}\n```") });
  const breaker = createProviderBreaker();
  f = createResponsesFailover({ fetch: net.fetch, anthropicApiKey: "ak", anthropicModel: "claude-haiku-4-5", breaker, onUsage: (e) => usage.push(e) });
  const body = JSON.stringify({ model: "gpt", input: "оцени", max_output_tokens: 2000, text: { format: { type: "json_object" } } });
  res = await f("https://api.openai.com/v1/responses", { method: "POST", body });
  assert.equal(res.ok, true);
  const data = await res.json();
  assert.equal(data.output_text, "{\"scores\":[1,2]}", "fences removed, as json_object mode would");
  assert.equal(net.calls.openai.length, 1); assert.equal(net.calls.anthropic.length, 1);
  assert.equal(net.calls.anthropic[0].body.model, "claude-haiku-4-5");
  assert.equal(breaker.isOpen("openai"), true);
  assert.equal(usage.length, 1); assert.equal(usage[0].provider, "anthropic"); assert.equal(usage[0].usage.output_tokens, 50);
  // second call: OpenAI is not even asked
  res = await f("https://api.openai.com/v1/responses", { method: "POST", body });
  assert.equal(res.ok, true); assert.equal(net.calls.openai.length, 1, "no wasted request to a provider without money"); assert.equal(net.calls.anthropic.length, 2);
});

test("F6 Responses failover: what must NOT switch", async () => {
  const body = JSON.stringify({ model: "gpt", input: "hi" });
  // rate limit is temporary, not money
  let net = fakeNet({ openai: () => json(429, { error: { message: "Rate limit reached for gpt in organization" } }), anthropic: () => claudeOk("x") });
  let f = createResponsesFailover({ fetch: net.fetch, anthropicApiKey: "ak", anthropicModel: "c", breaker: createProviderBreaker() });
  let res = await f("https://api.openai.com/v1/responses", { method: "POST", body });
  assert.equal(res.status, 429); assert.equal(net.calls.anthropic.length, 0);
  // a bad request is our bug, not an outage
  net = fakeNet({ openai: () => json(400, { error: { message: "Unsupported parameter" } }), anthropic: () => claudeOk("x") });
  f = createResponsesFailover({ fetch: net.fetch, anthropicApiKey: "ak", anthropicModel: "c", breaker: createProviderBreaker() });
  res = await f("https://api.openai.com/v1/responses", { method: "POST", body });
  assert.equal(res.status, 400); assert.equal(net.calls.anthropic.length, 0);
  // web_search request cannot be answered by Claude: the original OpenAI error comes back
  net = fakeNet({ openai: () => json(429, OPENAI_NO_MONEY), anthropic: () => claudeOk("x") });
  f = createResponsesFailover({ fetch: net.fetch, anthropicApiKey: "ak", anthropicModel: "c", breaker: createProviderBreaker() });
  res = await f("https://api.openai.com/v1/responses", { method: "POST", body: JSON.stringify({ input: "найди", tools: [{ type: "web_search" }] }) });
  assert.equal(res.status, 429); assert.equal(net.calls.anthropic.length, 0);
  // no Anthropic key: nothing changes
  net = fakeNet({ openai: () => json(429, OPENAI_NO_MONEY), anthropic: () => claudeOk("x") });
  f = createResponsesFailover({ fetch: net.fetch, anthropicApiKey: "", breaker: createProviderBreaker() });
  res = await f("https://api.openai.com/v1/responses", { method: "POST", body });
  assert.equal(res.status, 429); assert.equal(net.calls.anthropic.length, 0);
});

test("F7 Responses failover: both out of money -> original error; a top-up is noticed immediately, not after the cooldown", async () => {
  let t = 0;
  const breaker = createProviderBreaker({ cooldownMs: 600000, now: () => t });
  let openaiPaid = false;
  const net = fakeNet({ openai: () => openaiPaid ? openaiOk("{\"ok\":1}") : json(429, OPENAI_NO_MONEY), anthropic: () => json(400, CLAUDE_NO_MONEY) });
  const f = createResponsesFailover({ fetch: net.fetch, anthropicApiKey: "ak", anthropicModel: "c", breaker });
  const body = JSON.stringify({ model: "gpt", input: "hi" });
  let res = await f("https://api.openai.com/v1/responses", { method: "POST", body });
  assert.equal(res.ok, false); assert.equal(res.status, 429, "the caller still sees an error and handles it as before");
  assert.equal(breaker.isOpen("openai"), true); assert.equal(breaker.isOpen("anthropic"), true);
  const claudeCalls = net.calls.anthropic.length;
  res = await f("https://api.openai.com/v1/responses", { method: "POST", body });
  assert.equal(res.status, 429); assert.equal(net.calls.anthropic.length, claudeCalls, "Claude is not asked while it is switched off");
  openaiPaid = true; t += 1000;
  res = await f("https://api.openai.com/v1/responses", { method: "POST", body });
  assert.equal(res.ok, true, "OpenAI was topped up: it is asked again at once because Claude cannot take over"); assert.equal((await res.json()).output_text, "{\"ok\":1}");
  assert.equal(breaker.isOpen("openai"), false);
});

test("F8 Responses failover: network error to OpenAI also falls back; Claude temperature rejection is retried", async () => {
  let attempts = 0;
  const net = fakeNet({ openai: () => { throw new Error("fetch failed"); }, anthropic: (b) => { attempts += 1; return attempts === 1 && typeof b.temperature === "number" ? json(400, { error: { message: "temperature: not supported for this model" } }) : claudeOk("ответ"); } });
  const f = createResponsesFailover({ fetch: net.fetch, anthropicApiKey: "ak", anthropicModel: "c", breaker: createProviderBreaker() });
  const res = await f("https://api.openai.com/v1/responses", { method: "POST", body: JSON.stringify({ input: "hi", temperature: 0.5 }) });
  assert.equal(res.ok, true); assert.equal((await res.json()).output_text, "ответ");
  assert.equal(attempts, 2); assert.equal("temperature" in net.calls.anthropic[1].body, false);
});

// ---------------------------------------------------------------- clients and pipeline with a fake network

test("F9 clients: no money stops at once (second OpenAI model not tried), then OpenAI is skipped without a request", async () => {
  const net = fakeNet({ openai: () => json(429, OPENAI_NO_MONEY), anthropic: () => claudeOk("{}") });
  const clients = createModelClients({ fetch: net.fetch, openaiApiKey: "k", openaiModel: "gpt-6-luna", openaiFallbackModel: "gpt-5", anthropicApiKey: "ak" });
  await assert.rejects(() => clients.callOpenAI("s", "{}", { maxTokens: 10 }), (e) => e.failureKind === "billing" && /exceeded your current quota/.test(e.message));
  assert.equal(net.calls.openai.length, 1, "the fallback OpenAI model would fail the same way");
  assert.equal(clients.breaker.isOpen("openai"), true);
  await assert.rejects(() => clients.callOpenAI("s", "{}", { maxTokens: 10 }), (e) => e.providerDown === "openai");
  assert.equal(net.calls.openai.length, 1);
});

test("F10 clients: ordinary failures (rate limit, bad JSON) still use the second model and do not trip the breaker", async () => {
  let n = 0;
  const net = fakeNet({ openai: () => { n += 1; return n === 1 ? json(429, { error: { message: "Rate limit reached" } }) : openaiOk(JSON.stringify(PASS)); }, anthropic: () => claudeOk("{}") });
  const clients = createModelClients({ fetch: net.fetch, openaiApiKey: "k", openaiModel: "m1", openaiFallbackModel: "m2" });
  const out = await clients.callOpenAI("s", "{}", { maxTokens: 10 });
  assert.equal(out.model, "m2"); assert.equal(clients.breaker.isOpen("openai"), false);
});

test("F11 clients: Claude writer returns parsed JSON from fenced text, uses the writer model, records usage", async () => {
  const usage = [];
  const net = fakeNet({ openai: () => json(429, OPENAI_NO_MONEY), anthropic: smartClaude({ fenced: true }) });
  const clients = createModelClients({ fetch: net.fetch, openaiApiKey: "k", openaiModel: "m1", anthropicApiKey: "ak", anthropicModel: "claude-haiku-4-5", anthropicWriterModel: "claude-sonnet-5-5", onUsage: (e) => usage.push(e) });
  const out = await clients.callAnthropicWriter("SYSTEM", JSON.stringify({ role: "writer" }), { maxTokens: 3500, temperature: 0.7, purpose: "editorial_writer" });
  assert.equal(out.provider, "anthropic"); assert.equal(out.model, "claude-sonnet-5-5"); assert.equal(out.parsed.title, WRITER_OK.title);
  const sent = net.calls.anthropic[0].body;
  assert.equal(sent.model, "claude-sonnet-5-5"); assert.equal(sent.temperature, 0.7); assert.equal(sent.output_config, undefined, "no checker schema forced on a post");
  assert.match(sent.system, /^SYSTEM/); assert.match(sent.system, /JSON/);
  assert.equal(usage[0].provider, "anthropic"); assert.match(usage[0].purpose, /editorial_writer_failover/);
});

test("F12 clients: Claude out of money trips ITS breaker, OpenAI side stays up", async () => {
  const net = fakeNet({ openai: () => openaiOk(JSON.stringify(PASS)), anthropic: () => json(400, CLAUDE_NO_MONEY) });
  const clients = createModelClients({ fetch: net.fetch, openaiApiKey: "k", openaiModel: "m1", anthropicApiKey: "ak" });
  await assert.rejects(() => clients.callAnthropic("s", "{}", { maxTokens: 10 }), (e) => e.failureKind === "billing");
  assert.equal(clients.breaker.isOpen("anthropic"), true); assert.equal(clients.breaker.isOpen("openai"), false);
  const before = net.calls.anthropic.length;
  await assert.rejects(() => clients.callAnthropic("s", "{}", { maxTokens: 10 }), (e) => e.providerDown === "anthropic");
  assert.equal(net.calls.anthropic.length, before);
  await assert.rejects(() => clients.callAnthropicWriter("s", "{}", {}), (e) => e.providerDown === "anthropic");
  assert.equal((await clients.callOpenAI("s", "{}", { maxTokens: 10 })).provider, "openai");
});

async function pipeline(handlers, extra) {
  const net = fakeNet(handlers);
  const config = Object.assign({ fetch: net.fetch, openaiApiKey: "k", openaiModel: "m1", openaiFallbackModel: "m2", anthropicApiKey: "ak", anthropicModel: "claude-haiku-4-5", anthropicWriterModel: "claude-sonnet-5-5" }, (extra && extra.config) || {});
  const p = createEditorialPipeline(Object.assign({ promptFile: PROMPT, config }, extra && extra.opt || {}));
  return { net, p };
}

test("F13 full pipeline, real clients: OpenAI has no money -> Claude writes and checks, the post is approved", async () => {
  const { net, p } = await pipeline({ openai: () => json(429, OPENAI_NO_MONEY), anthropic: smartClaude() });
  const out = await p.run("auto", REQUEST);
  assert.equal(out.status, "approved"); assert.equal(out.verdict, "pass");
  assert.equal(out.writerProvider, "anthropic"); assert.equal(out.failoverChecker, "anthropic");
  assert.equal(net.calls.openai.length, 1, "OpenAI is asked once, then the breaker keeps everything off it");
  // second post: OpenAI not touched at all
  const out2 = await p.run("auto", REQUEST);
  assert.equal(out2.status, "approved"); assert.equal(net.calls.openai.length, 1);
});

test("F14 full pipeline, real clients: Claude has no money -> OpenAI does everything alone (degraded)", async () => {
  const { net, p } = await pipeline({
    openai: (b) => { const role = JSON.parse(b.input).role; return openaiOk(JSON.stringify(role === "writer" ? WRITER_OK : PASS)); },
    anthropic: () => json(400, CLAUDE_NO_MONEY)
  });
  const out = await p.run("auto", REQUEST);
  assert.equal(out.status, "approved"); assert.equal(out.degraded, true); assert.equal(out.writerProvider, "openai");
  const out2 = await p.run("auto", REQUEST);
  assert.equal(out2.status, "approved");
  assert.equal(net.calls.anthropic.length, 1, "Claude is asked once, then skipped for the cooldown");
});

test("F15 full pipeline, real clients: both have no money -> the writer error surfaces (post stays queued), nothing invented", async () => {
  const { p } = await pipeline({ openai: () => json(429, OPENAI_NO_MONEY), anthropic: () => json(400, CLAUDE_NO_MONEY) });
  await assert.rejects(() => p.run("auto", REQUEST), /OpenAI: .*quota.*Claude: .*credit balance/s);
});

test("F16 full pipeline: failover flag off restores the old strictness", async () => {
  const { net, p } = await pipeline({ openai: () => json(429, OPENAI_NO_MONEY), anthropic: smartClaude() }, { opt: { providerFailover: false } });
  await assert.rejects(() => p.run("auto", REQUEST));
  assert.equal(net.calls.anthropic.length, 0);
});

test("F17 Claude as checker still catches errors when it is the only checker", async () => {
  const bad = { verdict: "reject", errors: [{ severity: "critical", type: "fact", field: "title", quote: "x", problem: "выдумка", fix: "" }] };
  const { p } = await pipeline({ openai: () => json(429, OPENAI_NO_MONEY), anthropic: smartClaude({ checker: bad }) });
  const out = await p.run("auto", REQUEST);
  assert.equal(out.status, "hold"); assert.equal(out.verdict, "reject");
});

// ---------------------------------------------------------------- regressions from the adversarial review

test("R1 only money/key/outage switch providers: 429 rate limit, 400 and bad JSON from OpenAI never bring Claude in", async () => {
  for (const [status, data] of [[429, { error: { message: "Rate limit reached for gpt in organization org-1" } }], [400, { error: { message: "Unsupported parameter: x" } }]]) {
    const { net, p } = await pipeline({ openai: () => json(status, data), anthropic: smartClaude() });
    await assert.rejects(() => p.run("auto", REQUEST), /Rate limit|Unsupported/);
    assert.equal(net.calls.anthropic.length, 0, "writer: HTTP " + status);
  }
  // writer fine, OpenAI checker answers 200 with non-JSON: unavailable, Claude is not a replacement for a broken answer
  const { net, p } = await pipeline({
    openai: (b) => { const role = JSON.parse(b.input).role; return role === "writer" ? openaiOk(JSON.stringify(WRITER_OK)) : openaiOk("это не json"); },
    anthropic: smartClaude()
  });
  const out = await p.run("auto", REQUEST);
  assert.equal(out.verdict, "unavailable"); assert.equal(out.status, "hold"); assert.equal(net.calls.anthropic.length, 0);
});

test("R2 a provider with no alternative is never skipped: a top-up is noticed on the very next call", async () => {
  for (const cfg of [{ anthropicApiKey: "" }, { anthropicApiKey: "ak", providerFailover: false }]) {
    let paid = false;
    const net = fakeNet({ openai: () => paid ? openaiOk(JSON.stringify(PASS)) : json(429, OPENAI_NO_MONEY), anthropic: () => claudeOk("{}") });
    const clients = createModelClients(Object.assign({ fetch: net.fetch, openaiApiKey: "k", openaiModel: "m1" }, cfg));
    await assert.rejects(() => clients.callOpenAI("s", "{}", {}), /quota/);
    paid = true;
    assert.equal((await clients.callOpenAI("s", "{}", {})).provider, "openai");
    assert.equal(net.calls.openai.length, 2);
    // Responses shim, flag off / no key
    const f = createResponsesFailover({ fetch: net.fetch, anthropicApiKey: cfg.providerFailover === false ? "" : cfg.anthropicApiKey, breaker: createProviderBreaker() });
    paid = false;
    assert.equal((await f("https://api.openai.com/v1/responses", { method: "POST", body: JSON.stringify({ input: "x" }) })).status, 429);
    paid = true;
    assert.equal((await f("https://api.openai.com/v1/responses", { method: "POST", body: JSON.stringify({ input: "x" }) })).ok, true);
  }
});

test("R3 Anthropic spend-limit message counts as no money", async () => {
  assert.equal(classifyProviderFailure({ status: 400, message: "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC." }), "billing");
  assert.equal(classifyProviderFailure({ status: 400, message: "Your workspace has reached its API usage limits" }), "billing");
  assert.equal(classifyProviderFailure({ status: 429, message: "Number of request tokens has exceeded your per-minute rate limit" }), "rate_limit");
});

test("R4 adapter hands over clean JSON even when the call site did not ask for json_object", async () => {
  const net = fakeNet({ openai: () => json(429, OPENAI_NO_MONEY), anthropic: () => claudeOk("Конечно! Вот оценки:\n```json\n{\"scores\":[{\"id\":\"a\"}]}\n```\nНадеюсь, помогло.") });
  const f = createResponsesFailover({ fetch: net.fetch, anthropicApiKey: "ak", anthropicModel: "c", breaker: createProviderBreaker() });
  const res = await f("https://api.openai.com/v1/responses", { method: "POST", body: JSON.stringify({ model: "gpt", input: "оцени", max_output_tokens: 2200 }) });
  assert.equal((await res.json()).output_text, "{\"scores\":[{\"id\":\"a\"}]}");
  const plain = fakeNet({ openai: () => json(429, OPENAI_NO_MONEY), anthropic: () => claudeOk("Просто текст без json") });
  const f2 = createResponsesFailover({ fetch: plain.fetch, anthropicApiKey: "ak", anthropicModel: "c", breaker: createProviderBreaker() });
  assert.equal((await (await f2("https://api.openai.com/v1/responses", { method: "POST", body: JSON.stringify({ input: "x" }) })).json()).output_text, "Просто текст без json");
});

test("R5 breaker snapshot lists only providers that are switched off right now", async () => {
  let t = 0;
  const b = createProviderBreaker({ cooldownMs: 1000, now: () => t });
  b.trip("openai", "no money", "billing");
  assert.deepEqual(Object.keys(b.snapshot()), ["openai"]);
  t += 5000;
  assert.deepEqual(b.snapshot(), {}, "expired entries are not shown as switched off");
});

// ---------------------------------------------------------------- the real server.js

function installNet(handlers) {
  const calls = { openaiResponses: [], openaiImages: [], anthropic: [], telegram: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const body = init.body && typeof init.body === "string" && init.body[0] === "{" ? JSON.parse(init.body) : {};
    if (u === "https://api.openai.com/v1/responses") { calls.openaiResponses.push(body); return handlers.responses(body); }
    if (u === "https://api.openai.com/v1/images/generations") { calls.openaiImages.push(body); return handlers.images(body); }
    if (u.startsWith("https://api.anthropic.com/")) { calls.anthropic.push(body); return handlers.anthropic(body); }
    if (u.startsWith("https://api.telegram.org/")) { calls.telegram.push(body); return json(200, { ok: true, result: { message_id: 1 } }); }
    return json(200, {});
  };
  return calls;
}
const twoCh = [["ai-main", "ai", "Что там у ИИ?"], ["chtotamtachki", "auto", "Что там у тачек?"]];

test("S1 server: helper-model calls switch to Claude when OpenAI has no money, and stay switched", async () => {
  const t = await loadServer({ channels: twoCh, env: { ANTHROPIC_MODEL: "claude-haiku-4-5" } });
  const calls = installNet({ responses: () => json(429, OPENAI_NO_MONEY), images: () => json(429, OPENAI_NO_MONEY), anthropic: () => claudeOk("```json\n{\"items\":[]}\n```") });
  const body = JSON.stringify({ model: "gpt-6-luna", input: "переведи", max_output_tokens: 900, text: { format: { type: "json_object" } } });
  const res = await t.llmResponsesFetch("https://api.openai.com/v1/responses", { method: "POST", headers: {}, body });
  assert.equal(res.ok, true); assert.equal((await res.json()).output_text, "{\"items\":[]}");
  assert.equal(calls.anthropic[0].model, "claude-haiku-4-5");
  assert.equal(t.providerBreaker.isOpen("openai"), true);
  await t.llmResponsesFetch("https://api.openai.com/v1/responses", { method: "POST", headers: {}, body });
  assert.equal(calls.openaiResponses.length, 1);
});

test("S2 server: no money for covers -> local text card instead of a failed cover (MEDIA_REQUIRED does not block the post)", async () => {
  const t = await loadServer({ channels: twoCh, env: { GENERATE_COVER_IF_MISSING: "true" } });
  const calls = installNet({ responses: () => json(200, {}), images: () => json(429, OPENAI_NO_MONEY), anthropic: () => claudeOk("{}") });
  const cover = await t.generateNewsCover({ id: "x1", title: "Hongqi H5 подорожал на 200 000 ₽", text: "текст" });
  assert.equal(cover.model, "local-branded-card-v2"); assert.ok(cover.url);
  assert.equal(calls.openaiImages.length, 1, "one failed attempt, no retry with the second image model");
  const again = await t.generateNewsCover({ id: "x2", title: "Другая новость", text: "текст" });
  assert.equal(again.model, "local-branded-card-v2"); assert.equal(calls.openaiImages.length, 1, "OpenAI is not asked again while switched off");
});

test("S3 server: cover fallback can be switched off (error as before)", async () => {
  const t = await loadServer({ channels: twoCh, env: { GENERATE_COVER_IF_MISSING: "true", PROVIDER_FAILOVER_COVER_CARD: "false" } });
  installNet({ responses: () => json(200, {}), images: () => json(429, OPENAI_NO_MONEY), anthropic: () => claudeOk("{}") });
  await assert.rejects(() => t.generateNewsCover({ id: "x1", title: "t", text: "t" }), /quota/i);
});

test("S4 server: owner is told in Telegram what happened and that publishing continues", async () => {
  const t = await loadServer({ channels: twoCh, env: { TELEGRAM_BOT_TOKEN: "123:abc", TELEGRAM_ALERT_CHAT_ID: "42" } });
  const calls = installNet({ responses: () => json(200, {}), images: () => json(200, {}), anthropic: () => claudeOk("{}") });
  t.providerBreaker.trip("openai", "You exceeded your current quota", "billing");
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls.telegram.length, 1);
  assert.match(calls.telegram[0].text, /OpenAI/); assert.match(calls.telegram[0].text, /Публикация не остановилась/); assert.match(calls.telegram[0].text, /Claude/);
  t.providerBreaker.trip("anthropic", "Your credit balance is too low", "billing");
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls.telegram.length, 2);
  assert.match(calls.telegram[1].text, /Второй сервис тоже недоступен/);
  t.providerBreaker.trip("openai", "again", "billing");
  assert.equal(calls.telegram.length, 2, "throttled");
});

test("S5 server: real editorial pipeline writes AND checks with Claude when OpenAI has no money", async () => {
  const t = await loadServer({ channels: twoCh, env: { ANTHROPIC_MODEL: "claude-haiku-4-5" } });
  const calls = installNet({
    responses: () => json(429, OPENAI_NO_MONEY), images: () => json(429, OPENAI_NO_MONEY), anthropic: smartClaude()
  });
  const out = await t.editorialPipeline().run("auto", REQUEST);
  assert.equal(out.status, "approved"); assert.equal(out.writerProvider, "anthropic"); assert.equal(out.failoverChecker, "anthropic");
  assert.equal(calls.openaiResponses.length, 1);
  assert.equal(calls.anthropic.some((b) => b.model === "claude-sonnet-5-5"), true, "writer uses the stronger fallback writer model");
  assert.equal(calls.anthropic.some((b) => b.model === "claude-haiku-4-5"), true, "checker uses the cheap model");
});

test("S6 server: EDITORIAL_V2_PROVIDER_FAILOVER=false keeps the old behaviour", async () => {
  const t = await loadServer({ channels: twoCh, env: { EDITORIAL_V2_PROVIDER_FAILOVER: "false" } });
  const calls = installNet({ responses: () => json(429, OPENAI_NO_MONEY), images: () => json(429, OPENAI_NO_MONEY), anthropic: smartClaude() });
  await assert.rejects(() => t.editorialPipeline().run("auto", REQUEST));
  const res = await t.llmResponsesFetch("https://api.openai.com/v1/responses", { method: "POST", headers: {}, body: JSON.stringify({ input: "x" }) });
  assert.equal(res.ok, false); assert.equal(calls.anthropic.length, 0);
});

test("S7 every OpenAI text call in server.js goes through the failover wrapper", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(fileURLToPath(new URL("../server.js", import.meta.url)), "utf8");
  const all = src.match(/https:\/\/api\.openai\.com\/v1\/responses/g) || [];
  const wrapped = src.match(/await llmResponsesFetch\("https:\/\/api\.openai\.com\/v1\/responses"/g) || [];
  assert.ok(wrapped.length >= 10, "expected the ten helper-model call sites, got " + wrapped.length);
  assert.equal(all.length, wrapped.length, "a raw fetch to /v1/responses bypasses the failover");
});

test("S8 server: Claude-answered helper call leaves no phantom OpenAI cost row; cover card is honest and obeys the failover flag", async () => {
  const t = await loadServer({ channels: twoCh, env: { GENERATE_COVER_IF_MISSING: "true" } });
  installNet({ responses: () => json(200, {}), images: () => json(429, OPENAI_NO_MONEY), anthropic: () => claudeOk("{}") });
  assert.equal(t.recordOpenAIResponseUsage("gpt-6-luna", "x", { failover: { provider: "anthropic" }, usage: { input_tokens: 0, output_tokens: 0 } }, "responses"), null);
  const cover = await t.generateNewsCover({ id: "c1", title: "Заголовок", text: "t" });
  const fs = await import("node:fs");
  const names = fs.readdirSync(t.dir + "/media").filter((n) => /\.webp$/.test(n));
  assert.ok(names.length >= 1);
  const sharp = (await import("sharp")).default;
  const meta = await sharp(t.dir + "/media/" + names[0]).metadata();
  assert.equal(meta.width, 1536);
  assert.equal(cover.model, "local-branded-card-v2");
});

test("S9 server: failover flag off -> no cover card, no Claude, errors as before", async () => {
  const t = await loadServer({ channels: twoCh, env: { GENERATE_COVER_IF_MISSING: "true", EDITORIAL_V2_PROVIDER_FAILOVER: "false" } });
  installNet({ responses: () => json(200, {}), images: () => json(429, OPENAI_NO_MONEY), anthropic: () => claudeOk("{}") });
  await assert.rejects(() => t.generateNewsCover({ id: "x1", title: "t", text: "t" }), /quota/i);
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
    else { failed += 1; console.log("FAIL - " + name + "\n" + String(r.stderr || r.stdout).split("\n").slice(0, 18).join("\n")); }
  }
  console.log(failed ? failed + " failed" : "provider-failover tests passed");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
