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
    "claude-haiku-4-5": { input: 1.00, cacheRead: 0.10, cacheWrite: 1.25, output: 5.00 },
    "claude-haiku-4-5-20251001": { input: 1.00, cacheRead: 0.10, cacheWrite: 1.25, output: 5.00 }
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

function priceNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : NaN;
  if (typeof value === "string" && value.trim() !== "") { const n = Number(value.trim()); return Number.isFinite(n) && n >= 0 ? n : NaN; }
  return NaN;
}

// Keeps only finite, non-negative numeric prices; every rejected value is reported in `warnings`.
function sanitizeRateMap(section, override, warnings) {
  const out = {};
  if (!override || typeof override !== "object" || Array.isArray(override)) return out;
  for (const model of Object.keys(override)) {
    const rate = override[model];
    if (!rate || typeof rate !== "object" || Array.isArray(rate)) { warnings.push(section + "." + model + ": ожидался объект с ценами, пропущено"); continue; }
    const clean = {};
    for (const field of Object.keys(rate)) {
      const n = priceNumber(rate[field]);
      if (Number.isNaN(n)) warnings.push(section + "." + model + "." + field + ": недопустимая цена " + JSON.stringify(rate[field]) + " (нужно число >= 0), пропущено");
      else clean[field] = n;
    }
    if (Object.keys(clean).length) out[model] = clean;
    else warnings.push(section + "." + model + ": нет ни одной допустимой цены, модель пропущена");
  }
  return out;
}

export function resolveCostPricing(rawJson) {
  const pricing = cloneJson(BUILTIN_COST_PRICING);
  const raw = String(rawJson || "").trim();
  if (!raw) {
    return { pricing, updatedAt: BUILTIN_COST_PRICING_UPDATED_AT, overridden: false, error: "", warnings: [] };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("ожидался JSON-объект");
    const warnings = [];
    for (const section of ["openaiText", "openaiImage", "anthropic"]) {
      if (parsed[section] && typeof parsed[section] === "object" && !Array.isArray(parsed[section])) {
        pricing[section] = mergeRateMaps(pricing[section], sanitizeRateMap(section, parsed[section], warnings));
      }
    }
    if (parsed.railway && typeof parsed.railway === "object" && !Array.isArray(parsed.railway)) {
      const railway = {};
      for (const key of Object.keys(parsed.railway)) {
        const n = priceNumber(parsed.railway[key]);
        if (Number.isNaN(n)) warnings.push("railway." + key + ": недопустимая цена " + JSON.stringify(parsed.railway[key]) + " (нужно число >= 0), пропущено");
        else railway[key] = n;
      }
      pricing.railway = Object.assign({}, pricing.railway, railway);
    }
    return {
      pricing,
      updatedAt: String(parsed.updatedAt || parsed.pricingUpdatedAt || BUILTIN_COST_PRICING_UPDATED_AT).slice(0, 40),
      overridden: true,
      error: "",
      warnings
    };
  } catch (error) {
    return {
      pricing,
      updatedAt: BUILTIN_COST_PRICING_UPDATED_AT,
      overridden: false,
      error: String(error && error.message || error),
      warnings: []
    };
  }
}

function usageNum(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Never lets a NaN/negative/infinite cost escape (a poisoned price would otherwise be written into rows).
// Resolve a rate for a model id that may not be in the table verbatim.
// 1) exact id; 2) dated/suffixed id of a known base ("claude-sonnet-5-5-20261001",
//    "gpt-6-luna-2026-09-01") -> base price, still "known";
// 3) otherwise the most expensive rate of the matching family (or of the whole
//    section) so unknown models are never counted as $0 — flagged estimated.
const RATE_WEIGHT_KEYS = ["output", "input", "imageInput", "textInput"];
function rateWeight(rate) {
  let w = 0;
  for (const k of RATE_WEIGHT_KEYS) w += Number(rate && rate[k]) || 0;
  return w;
}
export function resolveModelRate(table, model) {
  const map = table && typeof table === "object" ? table : {};
  const m = String(model || "").trim().toLowerCase();
  const keys = Object.keys(map).filter((k) => map[k] && typeof map[k] === "object");
  if (!keys.length) return { rate: null, known: false, estimated: false, matched: "" };
  if (m && Object.prototype.hasOwnProperty.call(map, m) && map[m] && typeof map[m] === "object") {
    return { rate: map[m], known: true, estimated: false, matched: m };
  }
  const exactCase = keys.find((k) => k.toLowerCase() === m);
  if (m && exactCase) return { rate: map[exactCase], known: true, estimated: false, matched: exactCase };
  // Suffix only: date stamps / "-latest" / "@version".
  const prefix = keys
    .filter((k) => {
      const kl = k.toLowerCase();
      if (!m.startsWith(kl) || m.length === kl.length) return false;
      const rest = m.slice(kl.length);
      return /^(?:[-@_](?:\d{4}-?\d{2}-?\d{2}|\d{8}|latest|v\d+(?:\.\d+)*))+$/.test(rest);
    })
    .sort((a, b) => b.length - a.length)[0];
  if (prefix) return { rate: map[prefix], known: true, estimated: false, matched: prefix };
  const families = ["opus", "sonnet", "haiku", "luna", "sunburst", "mini", "nano"];
  const fam = families.find((f) => m.includes(f));
  let pool = fam ? keys.filter((k) => k.toLowerCase().includes(fam)) : [];
  if (!pool.length) pool = keys;
  const top = pool.slice().sort((a, b) => rateWeight(map[b]) - rateWeight(map[a]))[0];
  return { rate: map[top], known: false, estimated: true, matched: top };
}

export function calculateUsageCost(provider, model, usage, endpoint, pricingInput) {
  const result = calculateUsageCostRaw(provider, model, usage, endpoint, pricingInput);
  if (!Number.isFinite(result.costUsd) || result.costUsd < 0) {
    return Object.assign({}, result, { costUsd: 0, pricingKnown: false });
  }
  return result;
}

function calculateUsageCostRaw(provider, model, usage, endpoint, pricingInput) {
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
    const resolved = resolveModelRate(pricing.openaiImage, m);
    const rate = resolved.rate;
    if (!resolved.known) pricingKnown = false;
    if (resolved.estimated) estimated = true;
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
    const resolved = resolveModelRate(pricing.anthropic, m);
    const rate = resolved.rate;
    if (!resolved.known) pricingKnown = false;
    if (resolved.estimated) estimated = true;
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
    const resolved = resolveModelRate(pricing.openaiText, m);
    const rate = resolved.rate;
    if (!resolved.known) pricingKnown = false;
    if (resolved.estimated) estimated = true;
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

// ---- Остаток предоплаченного баланса API (OpenAI / Anthropic) -------------
// Ни OpenAI, ни Anthropic не отдают остаток баланса по обычному API-ключу, поэтому
// пользователь вводит остаток из консоли провайдера, а дальше он уменьшается на
// расходы, которые News Factory записала в cost_events после этого момента.
export const BALANCE_PROVIDERS = Object.freeze(["openai", "anthropic"]);
export const BALANCE_DEFAULT_LOW_USD = 5;
const BALANCE_MAX_USD = 10000000;

function parseBalanceNumber(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : NaN;
  if (typeof raw !== "string") return NaN;
  const text = raw.trim().replace(",", ".");
  return /^\d+(\.\d+)?$/.test(text) ? Number(text) : NaN;
}

const BALANCE_MIN_ASOF_MS = Date.UTC(2020, 0, 1);

export function normalizeBalanceInput(provider, body, previous, nowInput) {
  const id = typeof provider === "string" ? provider.toLowerCase() : "";
  if (!BALANCE_PROVIDERS.includes(id)) return { ok: false, error: "Неизвестный провайдер" };
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput || Date.now());
  const b = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  if (b.clear === true) return { ok: true, provider: id, clear: true };
  const amount = parseBalanceNumber(b.amountUsd);
  if (!Number.isFinite(amount)) return { ok: false, error: "Укажите остаток в долларах числом" };
  if (amount < 0 || amount > BALANCE_MAX_USD) return { ok: false, error: "Остаток должен быть от 0 до " + BALANCE_MAX_USD };
  let asOf = now;
  if (b.asOf !== undefined && b.asOf !== null && b.asOf !== "") {
    if (typeof b.asOf !== "string") return { ok: false, error: "Некорректная дата остатка" };
    asOf = new Date(b.asOf);
    if (!Number.isFinite(asOf.getTime())) return { ok: false, error: "Некорректная дата остатка" };
    if (asOf.getTime() > now.getTime() + 5 * 60 * 1000) return { ok: false, error: "Дата остатка не может быть в будущем" };
    if (asOf.getTime() < BALANCE_MIN_ASOF_MS) return { ok: false, error: "Дата остатка слишком давняя" };
  }
  let lowUsd = previous && Number.isFinite(Number(previous.lowUsd)) ? Number(previous.lowUsd) : BALANCE_DEFAULT_LOW_USD;
  if (b.lowUsd !== undefined && b.lowUsd !== null && b.lowUsd !== "") {
    const low = parseBalanceNumber(b.lowUsd);
    if (!Number.isFinite(low) || low < 0 || low > BALANCE_MAX_USD) return { ok: false, error: "Порог предупреждения должен быть числом от 0" };
    lowUsd = low;
  }
  return { ok: true, provider: id, value: { amountUsd: amount, asOf: asOf.toISOString(), lowUsd: lowUsd, updatedAt: now.toISOString() } };
}

export function computeApiBalance(config, spentUsd, recentUsd, nowInput, retentionDays) {
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput || Date.now());
  const asOfMs = new Date(config.asOf).getTime();
  const amount = Number(config.amountUsd || 0);
  const lowUsd = Number(config.lowUsd || 0);
  const spent = Math.max(0, Number(spentUsd || 0));
  const remaining = amount - spent;
  const sinceMs = Math.max(0, now.getTime() - asOfMs);
  const windowDays = Math.min(7, Math.max(1, sinceMs / 86400000));
  const avgDailyUsd = Math.max(0, Number(recentUsd || 0)) / windowDays;
  const daysLeft = remaining > 0 && avgDailyUsd > 0 ? remaining / avgDailyUsd : null;
  const status = remaining <= 0 ? "empty" : remaining <= lowUsd ? "low" : "ok";
  const retention = Number(retentionDays || 0);
  return {
    amountUsd: amount,
    asOf: new Date(asOfMs).toISOString(),
    lowUsd: lowUsd,
    spentUsd: spent,
    remainingUsd: remaining,
    avgDailyUsd: avgDailyUsd,
    daysLeft: daysLeft,
    status: status,
    spendIncomplete: retention > 0 && sinceMs > retention * 86400000
  };
}
