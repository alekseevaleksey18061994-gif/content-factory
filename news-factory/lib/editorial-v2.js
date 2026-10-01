// Editorial pipeline v2 for the «Что там…?» channel network.
//
// One prompt file (prompts/chto-tam.md) drives two roles:
//   writer  — selects/filters a story and writes Telegram + VK variants (OpenAI);
//   checker — verifies facts, Russian legal markings and profile bans.
// Verification runs on two independent models (OpenAI GPT and Anthropic Claude).
// The strictest verdict wins; "fix" sends the post back to the writer with notes
// (max EDITORIAL_V2_MAX_FIX_ROUNDS), "reject" or an unavailable checker holds the
// post for manual review instead of auto-publishing.
//
// The module has no dependency on server.js state: everything it needs is passed in,
// which keeps it unit-testable with a mocked fetch.

import fs from "node:fs";

export const CHANNEL_IDS = [
  "ai", "auto", "money", "tech", "games", "kino", "science", "sport",
  "world", "stars", "travel", "shopping", "home", "food", "business", "crypto"
];

const VERDICT_RANK = { pass: 0, fix: 1, reject: 2 };

// ---------------------------------------------------------------------------
// Prompt file parsing and assembly
// ---------------------------------------------------------------------------

export function parsePromptFile(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const header = [];
  const sections = new Map();   // "0".."13" → text (including its "## " heading)
  const profiles = new Map();   // channel id → text (including its "### " heading)
  let profilesIntro = [];
  let current = null;           // { key, lines }
  let currentProfile = null;    // { id, lines }
  let inFence = false;

  function flushProfile() {
    if (currentProfile) profiles.set(currentProfile.id, currentProfile.lines.join("\n").trim());
    currentProfile = null;
  }
  function flushSection() {
    flushProfile();
    if (current) sections.set(current.key, current.lines.join("\n").trim());
    current = null;
  }

  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence;
    const h2 = !inFence && line.match(/^##\s+(.+?)\s*$/);
    if (h2 && !/^###/.test(line)) {
      flushSection();
      const num = h2[1].match(/^(\d+)\./);
      current = { key: num ? num[1] : h2[1].trim(), lines: [line] };
      continue;
    }
    if (!current) { header.push(line); continue; }
    if (current.key === "9" && !inFence) {
      const h3 = line.match(/^###\s+`([a-z_]+)`/);
      if (h3) {
        flushProfile();
        currentProfile = { id: h3[1], lines: [line] };
        continue;
      }
      if (currentProfile) { currentProfile.lines.push(line); continue; }
      profilesIntro.push(line);
      continue;
    }
    current.lines.push(line);
  }
  flushSection();
  return { header: header.join("\n").trim(), sections, profiles, profilesIntro: profilesIntro.join("\n").trim() };
}

function profileBlock(parsed, channelId) {
  const intro = parsed.profilesIntro || "";
  const profile = parsed.profiles.get(channelId);
  const body = profile || "Профиль для этого канала не задан. Действуют общие правила разделов 0–8; тон — живой и понятный, без кликбейта.";
  return ["## 9. Профиль этого канала", intro, body].filter(Boolean).join("\n\n");
}

export function buildSystemPrompt(parsed, role, channelId) {
  const pick = function(keys) {
    return keys.map(function(k){ return parsed.sections.get(k) || ""; }).filter(Boolean);
  };
  // The shared prefix is identical for every channel, the channel profile goes last:
  // this keeps the provider-side prompt cache hot across all channels.
  if (role === "checker") {
    return [parsed.header].concat(pick(["2", "13"]), [profileBlock(parsed, channelId)]).join("\n\n---\n\n");
  }
  return [parsed.header].concat(pick(["0", "1", "2", "3", "4", "5", "6", "7", "8", "10", "11", "12"]), [profileBlock(parsed, channelId)]).join("\n\n---\n\n");
}

let promptCache = { file: "", mtimeMs: 0, parsed: null };
export function loadPrompt(file) {
  const stat = fs.statSync(file);
  if (promptCache.file === file && promptCache.mtimeMs === stat.mtimeMs && promptCache.parsed) return promptCache.parsed;
  const parsed = parsePromptFile(fs.readFileSync(file, "utf8"));
  if (!parsed.sections.get("0") || !parsed.sections.get("13") || !parsed.profiles.size) {
    throw new Error("Промпт " + file + " повреждён: не найдены обязательные разделы");
  }
  promptCache = { file, mtimeMs: stat.mtimeMs, parsed };
  return parsed;
}

// ---------------------------------------------------------------------------
// Channel / time helpers
// ---------------------------------------------------------------------------

const CHANNEL_HINTS = [
  [/(^|[^a-z])ai([^a-z]|$)|(^|[^а-яё])ии([^а-яё]|$)|нейросет/i, "ai"],
  [/тач|авто|car|tachk/i, "auto"],
  [/деньг|money/i, "money"],
  [/технолог|tech/i, "tech"],
  [/игр|game/i, "games"],
  [/кино|kino|movie/i, "kino"],
  [/наук|science/i, "science"],
  [/спорт|sport/i, "sport"],
  [/в мире|world/i, "world"],
  [/звёзд|звезд|stars/i, "stars"],
  [/путешеств|travel/i, "travel"],
  [/покуп|shop/i, "shopping"],
  [/для дома|home/i, "home"],
  [/с едой|food/i, "food"],
  [/бизнес|business/i, "business"],
  [/крипт|crypto/i, "crypto"]
];

export function resolveChannelId(workspace) {
  const ws = workspace || {};
  const explicit = String(ws.channelId || "").trim().toLowerCase();
  if (CHANNEL_IDS.includes(explicit)) return explicit;
  if (ws.id === "ai-main") return "ai";
  if (ws.id === "chtotamtachki") return "auto";
  const hay = [ws.name, ws.slug, ws.telegramPublicUsername, ws.id].filter(Boolean).join(" ");
  for (const [re, id] of CHANNEL_HINTS) if (re.test(hay)) return id;
  return "";
}

// Moscow time slot for the moment the post is expected to go out.
export function timeSlotFor(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const msk = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const hour = msk.getUTCHours();
  if (msk.getUTCDay() === 0 && hour >= 18) return "sunday_digest";
  if (hour >= 7 && hour < 11) return "morning";
  if (hour >= 11 && hour < 18) return "day";
  if (hour >= 18 && hour < 23) return "evening";
  return "morning";
}

// ---------------------------------------------------------------------------
// Model calls
// ---------------------------------------------------------------------------

export function parseJsonLoose(output) {
  const cleaned = String(output || "").replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  if (!cleaned) return null;
  try { return JSON.parse(cleaned); } catch {}
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch {}
  }
  return null;
}

function openAIText(data) {
  if (!data) return "";
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const chunks = [];
  for (const item of (data.output || [])) {
    for (const part of (item.content || [])) if (part && typeof part.text === "string") chunks.push(part.text);
  }
  return chunks.join("\n").trim();
}

function anthropicText(data) {
  return (Array.isArray(data && data.content) ? data.content : [])
    .filter(function(part){ return part && part.type === "text"; })
    .map(function(part){ return part.text; }).join("\n").trim();
}

export function createModelClients(config) {
  const cfg = config || {};
  const fetchImpl = cfg.fetch || globalThis.fetch;

  async function callOpenAI(instructions, input, opts) {
    if (!cfg.openaiApiKey) throw new Error("OPENAI_API_KEY не настроен");
    const models = [cfg.openaiModel, cfg.openaiFallbackModel].filter(function(v, i, a){ return v && a.indexOf(v) === i; });
    let lastError = "";
    for (const model of models) {
      try {
        const response = await fetchImpl("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer " + cfg.openaiApiKey },
          body: JSON.stringify({ model, instructions, input, max_output_tokens: (opts && opts.maxTokens) || 3000 }),
          signal: AbortSignal.timeout(cfg.timeoutMs || 90000)
        });
        const data = await response.json().catch(function(){ return {}; });
        if (!response.ok) { lastError = (data && data.error && data.error.message) || ("OpenAI HTTP " + response.status); continue; }
        const text = openAIText(data);
        const parsed = parseJsonLoose(text);
        if (!parsed) { lastError = "OpenAI вернул не JSON"; continue; }
        return { parsed, model, provider: "openai" };
      } catch (error) {
        lastError = String(error && error.message || error);
      }
    }
    throw new Error(lastError || "OpenAI недоступен");
  }

  async function callAnthropic(system, input, opts) {
    if (!cfg.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY не настроен");
    const model = cfg.anthropicModel || "claude-sonnet-5-5";
    const send = async function(withTemperature) {
      const body = {
        model,
        max_tokens: (opts && opts.maxTokens) || 3000,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: input }]
      };
      if (withTemperature) body.temperature = 0;
      const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": cfg.anthropicApiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(cfg.timeoutMs || 90000)
      });
      const data = await response.json().catch(function(){ return {}; });
      return { response, data };
    };
    let { response, data } = await send(true);
    const errMsg = function(d){ return String(d && d.error && d.error.message || ""); };
    if (!response.ok && response.status === 400 && /temperature/i.test(errMsg(data))) {
      ({ response, data } = await send(false));
    }
    if (!response.ok) throw new Error(errMsg(data) || ("Anthropic HTTP " + response.status));
    const parsed = parseJsonLoose(anthropicText(data));
    if (!parsed) throw new Error("Claude вернул не JSON");
    return { parsed, model, provider: "anthropic" };
  }

  return { callOpenAI, callAnthropic };
}

// ---------------------------------------------------------------------------
// Normalisation of model answers
// ---------------------------------------------------------------------------

function str(v, max) { const s = String(v == null ? "" : v).trim(); return max ? s.slice(0, max) : s; }

export function normalizeWriterResult(raw, channelId) {
  const r = raw && typeof raw === "object" ? raw : {};
  const status = String(r.status || "").toLowerCase() === "skip" ? "skip" : "ok";
  const importanceRaw = Number(r.importance);
  const importance = Number.isFinite(importanceRaw) ? Math.max(1, Math.min(10, Math.round(importanceRaw))) : null;
  const cover = r.cover && typeof r.cover === "object" ? {
    big: str(r.cover.big, 20), caption: str(r.cover.caption, 60),
    sub: r.cover.sub ? str(r.cover.sub, 60) : null, emoji: str(r.cover.emoji, 8)
  } : null;
  const out = {
    status,
    skipReason: str(r.skip_reason, 300),
    titleRu: stripTags(str(r.title_ru, 160)),
    channelId: str(r.channel_id) || channelId,
    importance,
    angle: r.angle ? str(r.angle, 300) : null,
    format: str(r.format, 60),
    hookType: str(r.hook_type, 60),
    endingType: str(r.ending_type, 60),
    titleEmoji: str(r.title_emoji, 8),
    title: stripTags(str(r.title, 160)),
    tgText: str(r.tg_text),
    vkText: stripTags(str(r.vk_text)),
    cover,
    photos: Array.isArray(r.photos) ? r.photos.map(String).slice(0, 5) : [],
    sourcesUsed: Array.isArray(r.sources_used) ? r.sources_used.map(String) : [],
    conflicts: r.conflicts ? str(r.conflicts, 500) : null,
    legalFlags: Array.isArray(r.legal_flags) ? r.legal_flags.map(String).slice(0, 10) : [],
    crosspromoTarget: r.crosspromo_target ? str(r.crosspromo_target, 20) : null,
    entities: Array.isArray(r.entities) ? r.entities.map(function(x){ return str(x, 60); }).filter(Boolean).slice(0, 4) : []
  };
  if (out.status === "ok") {
    if (!out.title || !out.tgText) throw new Error("Автор вернул пост без заголовка или текста");
    if (!out.vkText) out.vkText = stripMarkup(out.tgText);
    out.tgText = removeLeadingTitle(out.tgText, out.title);
    out.vkText = removeLeadingTitle(out.vkText, out.title);
  }
  return out;
}

function stripTags(s) { return String(s || "").replace(/<\/?[a-z][^>]*>/gi, ""); }
function stripMarkup(s) { return stripTags(s).replace(/\*\*(.*?)\*\*/g, "$1").replace(/__(.*?)__/g, "$1").replace(/^>\s?/gm, ""); }
function removeLeadingTitle(text, title) {
  const t = String(text || "").trim();
  const plainTitle = stripMarkup(title).replace(/^[^\p{L}\p{N}]+/u, "").trim().toLowerCase();
  const lines = t.split("\n");
  const first = stripMarkup(lines[0] || "").replace(/^[^\p{L}\p{N}]+/u, "").trim().toLowerCase();
  if (plainTitle && first === plainTitle) return lines.slice(1).join("\n").trim();
  return t;
}

export function normalizeCheckerResult(raw, provider, model) {
  const r = raw && typeof raw === "object" ? raw : {};
  let verdict = String(r.verdict || "").toLowerCase();
  if (!(verdict in VERDICT_RANK)) verdict = "fix";
  const errors = (Array.isArray(r.errors) ? r.errors : []).slice(0, 20).map(function(e) {
    return {
      severity: String(e && e.severity || "minor") === "critical" ? "critical" : "minor",
      type: str(e && e.type, 20) || "fact",
      field: str(e && e.field, 20),
      quote: str(e && e.quote, 160),
      problem: str(e && e.problem, 300),
      fix: str(e && e.fix, 300),
      checker: provider
    };
  });
  if (verdict === "pass" && errors.some(function(e){ return e.severity === "critical"; })) verdict = "fix";
  return { provider, model, verdict, errors, checkedClaims: Number(r.checked_claims) || 0, summary: str(r.summary, 400) };
}

export function mergeVerdicts(results) {
  const ok = results.filter(Boolean);
  let verdict = "pass";
  for (const r of ok) if (VERDICT_RANK[r.verdict] > VERDICT_RANK[verdict]) verdict = r.verdict;
  const seen = new Set();
  const errors = [];
  for (const r of ok) {
    for (const e of r.errors) {
      const key = (e.quote || e.problem).toLowerCase().replace(/\s+/g, " ").slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      errors.push(e);
    }
  }
  return { verdict, errors };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export function createEditorialPipeline(options) {
  const opt = options || {};
  const clients = opt.clients || createModelClients(opt.config);
  const promptFile = opt.promptFile;
  const maxFixRounds = Math.max(0, Math.min(3, Number(opt.maxFixRounds == null ? 2 : opt.maxFixRounds)));
  const requireAllCheckers = opt.requireAllCheckers !== false;
  const useClaude = function(){ return Boolean(opt.config && opt.config.anthropicApiKey) || Boolean(opt.forceClaude); };

  async function runWriter(channelId, request) {
    const parsed = loadPrompt(promptFile);
    const system = buildSystemPrompt(parsed, "writer", channelId);
    const input = JSON.stringify(Object.assign({ role: "writer", channel_id: channelId }, request));
    const res = await clients.callOpenAI(system, input, { maxTokens: 3500 });
    return { result: normalizeWriterResult(res.parsed, channelId), model: res.model };
  }

  async function runCheckers(channelId, post, request) {
    const parsed = loadPrompt(promptFile);
    const system = buildSystemPrompt(parsed, "checker", channelId);
    const input = JSON.stringify({
      role: "checker",
      channel_id: channelId,
      now: request.now,
      post: {
        title: post.title, tg_text: post.tgText, vk_text: post.vkText, cover: post.cover,
        format: post.format, legal_flags: post.legalFlags, has_photo: Boolean(request.has_photo)
      },
      sources: request.sources,
      registry: request.registry
    });
    const jobs = [
      clients.callOpenAI(system, input, { maxTokens: 2500 })
        .then(function(r){ return normalizeCheckerResult(r.parsed, "openai", r.model); })
        .catch(function(error){ return { provider: "openai", failed: true, error: String(error && error.message || error) }; })
    ];
    if (useClaude()) {
      jobs.push(clients.callAnthropic(system, input, { maxTokens: 2500 })
        .then(function(r){ return normalizeCheckerResult(r.parsed, "anthropic", r.model); })
        .catch(function(error){ return { provider: "anthropic", failed: true, error: String(error && error.message || error) }; }));
    }
    const results = await Promise.all(jobs);
    const failed = results.filter(function(r){ return r.failed; });
    const done = results.filter(function(r){ return !r.failed; });
    const merged = mergeVerdicts(done);
    let verdict = merged.verdict;
    if (!done.length || (requireAllCheckers && failed.length)) verdict = "unavailable";
    return { verdict, errors: merged.errors, checkers: results };
  }

  // request: { now, sources, recent_posts, network_recent, network_channels, signature,
  //            posts_today, daily_limit, time_slot, mode, registry, format_stats, has_photo }
  async function run(channelId, request) {
    const log = [];
    let writer = await runWriter(channelId, request);
    log.push({ step: "writer", round: 0, model: writer.model, status: writer.result.status });
    if (writer.result.status === "skip") {
      return { status: "skip", post: writer.result, verdict: "skip", rounds: 0, log, writerModel: writer.model };
    }
    let post = writer.result;
    let check = await runCheckers(channelId, post, request);
    log.push({ step: "check", round: 0, verdict: check.verdict, checkers: summarizeCheckers(check.checkers) });

    let round = 0;
    while (check.verdict === "fix" && round < maxFixRounds) {
      round += 1;
      const fixNotes = check.errors.map(function(e){ return { field: e.field, quote: e.quote, problem: e.problem, fix: e.fix }; });
      writer = await runWriter(channelId, Object.assign({}, request, {
        fix_notes: fixNotes,
        previous_post: { title: post.title, tg_text: post.tgText, vk_text: post.vkText, format: post.format, hook_type: post.hookType, ending_type: post.endingType }
      }));
      log.push({ step: "writer", round, model: writer.model, status: writer.result.status });
      if (writer.result.status === "skip") {
        return { status: "skip", post: writer.result, verdict: "skip", rounds: round, log, writerModel: writer.model };
      }
      post = writer.result;
      check = await runCheckers(channelId, post, request);
      log.push({ step: "check", round, verdict: check.verdict, checkers: summarizeCheckers(check.checkers) });
    }

    const finalVerdict = check.verdict === "fix" ? "fix_exhausted" : check.verdict;
    return {
      status: finalVerdict === "pass" ? "approved" : "hold",
      verdict: finalVerdict,
      post,
      errors: check.errors,
      checkers: check.checkers,
      rounds: round,
      log,
      writerModel: writer.model
    };
  }

  return { run, runWriter, runCheckers };
}

function summarizeCheckers(list) {
  return (list || []).map(function(c) {
    return c.failed
      ? { provider: c.provider, failed: true, error: String(c.error || "").slice(0, 200) }
      : { provider: c.provider, model: c.model, verdict: c.verdict, errors: c.errors.length, checkedClaims: c.checkedClaims };
  });
}

// Maps the 1–10 importance and the check outcome onto the 0–100 scales the
// existing scheduler (aiScore / qualityScore / AUTO_QUALITY_MIN) already uses.
export function legacyScores(outcome, autoQualityMin) {
  const importance = outcome && outcome.post && outcome.post.importance;
  const editorialScore = Number.isFinite(importance) ? importance * 10 : 50;
  const approved = outcome && outcome.status === "approved";
  const min = Number(autoQualityMin) || 72;
  const qualityScore = approved ? Math.min(100, Math.max(min + 6, 80 + (importance || 5))) : Math.min(min - 10, 55);
  return { editorialScore, qualityScore, qcStatus: approved ? "pass" : "hold" };
}
