export const COST_STATE_MIGRATION_ID = "v0.34.2-cost-events-postgres";

function num(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function normalizeLegacyCostRow(event, workspaceId) {
  const e = event && typeof event === "object" ? event : {};
  const extra = e.extra && typeof e.extra === "object" ? e.extra : {};
  const id = String(e.id || "").trim();
  if (!id) return null;
  const at = new Date(e.at || 0);
  if (!Number.isFinite(at.getTime())) return null;
  return {
    id: id,
    at: at.toISOString(),
    workspaceId: String(e.workspaceId || workspaceId || "ai-main"),
    provider: String(e.provider || "unknown").toLowerCase(),
    model: String(e.model || "unknown"),
    operation: String(e.operation || e.purpose || "api_call").slice(0, 80),
    endpoint: String(e.endpoint || ""),
    kind: String(e.kind || "text"),
    inputTokens: num(e.inputTokens),
    outputTokens: num(e.outputTokens),
    cachedInputTokens: num(e.cachedInputTokens),
    cacheReadTokens: num(e.cacheReadTokens),
    cacheWriteTokens: num(e.cacheWriteTokens),
    imageInputTokens: num(e.imageInputTokens),
    imageOutputTokens: num(e.imageOutputTokens),
    costUsd: num(e.costUsd),
    pricingKnown: e.pricingKnown !== false,
    estimated: Boolean(e.estimated),
    newsId: String(e.newsId || extra.news_id || extra.newsId || "").trim() || null,
    extra: extra
  };
}

export function collectLegacyCostRows(workspaces, migrationId) {
  const marker = String(migrationId || COST_STATE_MIGRATION_ID);
  const rows = [];
  for (const ws of (Array.isArray(workspaces) ? workspaces : [])) {
    const state = ws && ws.state && typeof ws.state === "object" ? ws.state : {};
    const migrations = Array.isArray(state.migrations) ? state.migrations : [];
    if (migrations.includes(marker)) continue;
    const events = state.costTracking && Array.isArray(state.costTracking.events) ? state.costTracking.events : [];
    for (const event of events) {
      const row = normalizeLegacyCostRow(event, ws && ws.id);
      if (row) rows.push(row);
    }
  }
  return rows;
}

export function stripLegacyCostEvents(workspaces, migrationId) {
  const marker = String(migrationId || COST_STATE_MIGRATION_ID);
  let changed = 0;
  let removedEvents = 0;
  for (const ws of (Array.isArray(workspaces) ? workspaces : [])) {
    if (!ws || !ws.state || typeof ws.state !== "object") continue;
    if (!Array.isArray(ws.state.migrations)) ws.state.migrations = [];
    if (ws.state.migrations.includes(marker)) continue;
    if (!ws.state.costTracking || typeof ws.state.costTracking !== "object") {
      ws.state.costTracking = { version: 2, startedAt: new Date().toISOString() };
    }
    if (Array.isArray(ws.state.costTracking.events)) {
      removedEvents += ws.state.costTracking.events.length;
      delete ws.state.costTracking.events;
    }
    ws.state.costTracking.version = 2;
    ws.state.migrations.push(marker);
    ws.updatedAt = new Date().toISOString();
    changed += 1;
  }
  return { workspaces: changed, removedEvents: removedEvents };
}


export const BUILTIN_COST_PRICING_UPDATED_AT = "2026-10-02";
export const BUILTIN_COST_PRICING = Object.freeze({
  openaiText: {
    "gpt-6-luna": { input: 0.10, cachedInput: 0.01, output: 0.50 },
    "gpt-5.6-luna": { input: 0.20, cachedInput: 0.02, output: 1.20 }
  },
  openaiImage: {
    "gpt-image-2.5-sunburst": { textInput: 5.00, imageInput: 8.00, cachedImageInput: 2.00, output: 30.00 },
    "gpt-image-2": { textInput: 5.00, imageInput: 8.00, cachedImageInput: 2.00, output: 30.00 }
  },
  anthropic: {
    "claude-sonnet-5-5": { input: 2.00, cacheRead: 0.20, cacheWrite: 2.50, output: 10.00 },
    "claude-opus-5-5": { input: 4.00, cacheRead: 0.20, cacheWrite: 5.00, output: 20.00 },
    "claude-haiku-4-5": { input: 1.00, cacheRead: 0.10, cacheWrite: 1.25, output: 5.00 }
  },
  railway: {
    memoryGbMonth: 10.00,
    cpuVcpuMonth: 20.00,
    volumeGbMonth: 0.15,
    egressGb: 0.05
  }
});

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeRateMaps(base, override) {
  const out = cloneJson(base || {});
  if (!override || typeof override !== "object" || Array.isArray(override)) return out;
  for (const key of Object.keys(override)) {
    const incoming = override[key];
    if (incoming && typeof incoming === "object" && !Array.isArray(incoming) &&
        out[key] && typeof out[key] === "object" && !Array.isArray(out[key])) {
      out[key] = Object.assign({}, out[key], incoming);
    } else {
      out[key] = incoming;
    }
  }
  return out;
}

export function resolveCostPricing(rawJson) {
  const pricing = cloneJson(BUILTIN_COST_PRICING);
  const raw = String(rawJson || "").trim();
  if (!raw) {
    return { pricing, updatedAt: BUILTIN_COST_PRICING_UPDATED_AT, overridden: false, error: "" };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("ожидался JSON-объект");
    for (const section of ["openaiText", "openaiImage", "anthropic"]) {
      if (parsed[section] && typeof parsed[section] === "object" && !Array.isArray(parsed[section])) {
        pricing[section] = mergeRateMaps(pricing[section], parsed[section]);
      }
    }
    if (parsed.railway && typeof parsed.railway === "object" && !Array.isArray(parsed.railway)) {
      pricing.railway = Object.assign({}, pricing.railway, parsed.railway);
    }
    return {
      pricing,
      updatedAt: String(parsed.updatedAt || parsed.pricingUpdatedAt || BUILTIN_COST_PRICING_UPDATED_AT).slice(0, 40),
      overridden: true,
      error: ""
    };
  } catch (error) {
    return {
      pricing,
      updatedAt: BUILTIN_COST_PRICING_UPDATED_AT,
      overridden: false,
      error: String(error && error.message || error)
    };
  }
}

function usageNum(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function calculateUsageCost(provider, model, usage, endpoint, pricingInput) {
  const pricing = pricingInput && pricingInput.openaiText ? pricingInput : BUILTIN_COST_PRICING;
  const u = usage && typeof usage === "object" ? usage : {};
  const p = String(provider || "").toLowerCase();
  const m = String(model || "");
  const ep = String(endpoint || "");
  const input = usageNum(u.input_tokens != null ? u.input_tokens : u.prompt_tokens);
  const output = usageNum(u.output_tokens != null ? u.output_tokens : u.completion_tokens);
  const inputDetails = u.input_tokens_details && typeof u.input_tokens_details === "object"
    ? u.input_tokens_details
    : (u.prompt_tokens_details && typeof u.prompt_tokens_details === "object" ? u.prompt_tokens_details : {});
  const cached = usageNum(inputDetails.cached_tokens);
  const cacheRead = usageNum(u.cache_read_input_tokens);
  const cacheWrite = usageNum(u.cache_creation_input_tokens);
  let costUsd = 0;
  let pricingKnown = true;
  let estimated = false;
  let kind = "text";

  if (p === "openai" && ep === "images") {
    kind = "image";
    const rate = pricing.openaiImage && pricing.openaiImage[m];
    if (!rate) pricingKnown = false;
    const imageInput = usageNum(inputDetails.image_tokens);
    let textInput = usageNum(inputDetails.text_tokens);
    if (!textInput && !imageInput && input) textInput = input;
    const cachedImage = usageNum(inputDetails.cached_tokens);
    const imageOutput = output;
    if (rate) {
      costUsd = ((textInput * Number(rate.textInput || 0)) +
        (Math.max(0, imageInput - cachedImage) * Number(rate.imageInput || 0)) +
        (cachedImage * Number(rate.cachedImageInput || 0)) +
        (imageOutput * Number(rate.output || 0))) / 1000000;
    }
    return {
      kind, inputTokens: input, outputTokens: output, cachedInputTokens: cachedImage,
      cacheReadTokens: 0, cacheWriteTokens: 0, imageInputTokens: imageInput,
      imageOutputTokens: imageOutput, textInputTokens: textInput, reportInputTokens: input,
      costUsd, pricingKnown, estimated
    };
  }

  if (p === "anthropic") {
    const rate = pricing.anthropic && pricing.anthropic[m];
    if (!rate) pricingKnown = false;
    // Anthropic input_tokens excludes cache creation/read tokens. Do NOT subtract them.
    if (rate) {
      costUsd = ((input * Number(rate.input || 0)) +
        (cacheRead * Number(rate.cacheRead || 0)) +
        (cacheWrite * Number(rate.cacheWrite || 0)) +
        (output * Number(rate.output || 0))) / 1000000;
    }
    return {
      kind, inputTokens: input, outputTokens: output, cachedInputTokens: 0,
      cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite,
      imageInputTokens: 0, imageOutputTokens: 0, textInputTokens: input,
      reportInputTokens: input + cacheRead + cacheWrite,
      costUsd, pricingKnown, estimated
    };
  }

  if (p === "openai") {
    let rate = pricing.openaiText && pricing.openaiText[m];
    if (!rate) {
      rate = pricing.openaiText && pricing.openaiText["gpt-6-luna"];
      estimated = true;
      pricingKnown = false;
    }
    if (rate) {
      const normalInput = Math.max(0, input - cached);
      costUsd = ((normalInput * Number(rate.input || 0)) +
        (cached * Number(rate.cachedInput || 0)) +
        (output * Number(rate.output || 0))) / 1000000;
    }
    return {
      kind, inputTokens: input, outputTokens: output, cachedInputTokens: cached,
      cacheReadTokens: 0, cacheWriteTokens: 0,
      imageInputTokens: 0, imageOutputTokens: 0, textInputTokens: input,
      reportInputTokens: input, costUsd, pricingKnown, estimated
    };
  }

  return {
    kind, inputTokens: input, outputTokens: output, cachedInputTokens: cached,
    cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite,
    imageInputTokens: 0, imageOutputTokens: 0, textInputTokens: input,
    reportInputTokens: input + cacheRead + cacheWrite,
    costUsd: 0, pricingKnown: false, estimated: false
  };
}

export function moscowCostDateKey(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(d);
  const map = {};
  for (const part of parts) map[part.type] = part.value;
  return map.year + "-" + map.month + "-" + map.day;
}


const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function moscowParts(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const shifted = new Date(d.getTime() + MOSCOW_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds()
  };
}

function moscowMidnightUtc(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day, -3, 0, 0, 0));
}

export function moscowPeriodBounds(period, nowInput, fallbackDays) {
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput || Date.now());
  const p = moscowParts(now);
  const key = String(period || "").toLowerCase();
  let start;
  let label;
  if (key === "today") {
    start = moscowMidnightUtc(p.year, p.month, p.day);
    label = "Сегодня";
  } else if (key === "month") {
    start = moscowMidnightUtc(p.year, p.month, 1);
    label = "Этот месяц";
  } else if (key === "year") {
    start = moscowMidnightUtc(p.year, 1, 1);
    label = "Этот год";
  } else if (key === "7" || key === "30") {
    const days = Number(key);
    start = new Date(moscowMidnightUtc(p.year, p.month, p.day).getTime() - (days - 1) * DAY_MS);
    label = days + " дней";
  } else {
    const days = Math.max(1, Number(fallbackDays || 30));
    start = new Date(now.getTime() - days * DAY_MS);
    label = days + " дней";
  }
  const duration = Math.max(1, now.getTime() - start.getTime());
  return {
    period: key || "custom",
    label,
    start,
    end: now,
    previousStart: new Date(start.getTime() - duration),
    previousEnd: start,
    moscowYear: p.year,
    moscowMonth: p.month,
    moscowDay: p.day,
    daysInMonth: new Date(Date.UTC(p.year, p.month, 0)).getUTCDate()
  };
}

export function monthForecastCost(monthToDate, nowInput) {
  const value = Number(monthToDate || 0);
  const p = moscowParts(nowInput instanceof Date ? nowInput : new Date(nowInput || Date.now()));
  const daysInMonth = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
  return value / Math.max(1, p.day) * daysInMonth;
}

export function percentChange(current, previous) {
  const a = Number(current || 0);
  const b = Number(previous || 0);
  if (!b) return a ? null : 0;
  return (a - b) / Math.abs(b) * 100;
}
