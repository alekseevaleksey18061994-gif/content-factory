// Source quality helpers: cheap headline pre-filter and automatic pausing of
// sources that only bring junk or keep failing. Pure functions, no I/O, so the
// rules can be tested offline.

export const RECENT_OUTCOMES = 10;
export const AUTO_PAUSE_JUNK_STREAK = 10;
export const AUTO_PAUSE_ERROR_STREAK = 12;
export const MIN_ENABLED_PER_GROUP = 4;

// A candidate without a publication date whose title names a past year
// ("IAA Mobility 2025" in 2026) is an old press release, not news.
export function staleYearInTitle(title, hasDate, now) {
  if (hasDate) return false;
  const year = (now instanceof Date ? now : new Date()).getUTCFullYear();
  const years = String(title || "").match(/\b(19|20)\d{2}\b/g) || [];
  if (!years.length) return false;
  const latest = Math.max.apply(null, years.map(Number));
  return latest < year;
}

export function buildPrefilterPrompt(options) {
  const channel = options.channelName || "новостной канал";
  const topic = options.topic || "";
  const today = options.today || new Date().toISOString().slice(0, 10);
  const items = (options.items || []).map(function(item, index) {
    return {
      n: index + 1,
      source: item.source || "",
      type: item.group === "blogger" || item.group === "creator" ? "блогер" : (item.group === "official" ? "официальный сайт" : "СМИ"),
      date: item.date || "неизвестна",
      title: String(item.title || "").slice(0, 220),
      text: item.text ? String(item.text).slice(0, 280) : undefined
    };
  });
  return [
    "Ты выпускающий редактор Telegram-канала «" + channel + "»" + (topic ? " (тема: " + topic + ")" : "") + ".",
    "Сегодня " + today + ". Ниже заголовки свежих ссылок с сайтов-источников.",
    "Для каждой ссылки реши, стоит ли тратить на неё работу редакции.",
    "Отсеивай (keep=false):",
    "- рекламу, розыгрыши, промо банков и сервисов, самопиар автора («вышло моё видео», «записывайтесь на подбор»);",
    "- объявления о продаже конкретной машины, прайсы, страницы каталога и конфигуратора;",
    "- старые новости: события, отчёты и выставки прошлых месяцев и лет; если дата неизвестна, а речь о прошедшем событии — тоже отсеивай;",
    "- не по теме канала;",
    "- служебные страницы: о компании, контакты, вакансии, подписка, рубрики.",
    "Оставляй (keep=true) настоящие новости по теме канала и дай им оценку важности score от 1 до 10.",
    "Ответь строго JSON без пояснений: {\"items\":[{\"n\":1,\"keep\":true,\"score\":7,\"reason\":\"коротко по-русски\"}]}.",
    "ITEMS: " + JSON.stringify(items)
  ].join("\n");
}

export function parsePrefilterResult(text, count) {
  const raw = String(text || "").replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { parsed = JSON.parse(m[0]); } catch { return null; }
  }
  const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.items) ? parsed.items : null);
  if (!list) return null;
  const out = new Map();
  for (const row of list) {
    const n = Number(row && row.n);
    if (!Number.isInteger(n) || n < 1 || n > count) continue;
    const score = Math.max(1, Math.min(10, Math.round(Number(row.score) || 5)));
    out.set(n, { keep: row.keep !== false, score: score, reason: String(row.reason || "").slice(0, 160) });
  }
  // Items the model forgot are kept: the pre-filter may only remove what it judged.
  for (let n = 1; n <= count; n += 1) if (!out.has(n)) out.set(n, { keep: true, score: 5, reason: "" });
  return out;
}

export function recordOutcome(stat, outcome) {
  if (!stat) return;
  stat.recent = Array.isArray(stat.recent) ? stat.recent : [];
  stat.recent.push(outcome);
  if (stat.recent.length > RECENT_OUTCOMES) stat.recent = stat.recent.slice(-RECENT_OUTCOMES);
  if (outcome === "junk") stat.junk = Number(stat.junk || 0) + 1;
  if (outcome === "ok") stat.useful = Number(stat.useful || 0) + 1;
}

// Returns a Russian reason when the source should be paused, otherwise "".
export function autoPauseReason(source, stat, enabledInGroup) {
  if (!source || !source.enabled || !stat) return "";
  if (source.autoPauseExempt) return "";
  if (Number(enabledInGroup || 0) <= MIN_ENABLED_PER_GROUP) return "";
  if (Number(stat.errorStreak || 0) >= AUTO_PAUSE_ERROR_STREAK) {
    return "сайт не открывается " + stat.errorStreak + " проверок подряд";
  }
  const recent = Array.isArray(stat.recent) ? stat.recent : [];
  if (recent.length >= AUTO_PAUSE_JUNK_STREAK && recent.slice(-AUTO_PAUSE_JUNK_STREAK).every(function(x){ return x === "junk"; })) {
    return AUTO_PAUSE_JUNK_STREAK + " новостей подряд отсеяны: реклама, старьё или не по теме";
  }
  return "";
}

// Map a stored news item status to a source outcome (for bootstrapping from history).
export function outcomeForStatus(status) {
  const s = String(status || "");
  if (s === "editorial_skip" || s === "prefilter_skip") return "junk";
  if (s === "queued" || s === "published" || s === "scheduled") return "ok";
  return "";
}

// ---------------------------------------------------------------------------
// Keeping the number of active sources at a target: when sources are paused,
// replacements come first from a reserve list and then from AI discovery.
// Every candidate is validated by the server (page opens, has article links)
// before it is enabled, and then lives under the same auto-pause rules.

export const DEFAULT_SOURCE_TARGET = 40;
export const MAX_SOURCES_ADDED_PER_RUN = 5;

export function sourceHost(url) {
  try { return new URL(String(url || "")).hostname.replace(/^www\./i, "").toLowerCase(); }
  catch { return ""; }
}

// Same host + same first path segment counts as the same source; different
// sections of one big site (e.g. blog.google/technology/ai) stay distinct.
export function sourceKey(url) {
  try {
    const u = new URL(String(url || ""));
    const segs = u.pathname.split("/").filter(Boolean).map(function(x){ return x.toLowerCase(); });
    // Locale prefixes (/ru/, /en/) are not a section: habr.com/ru/hubs/... and
    // habr.com/ru/companies/... are different sections.
    const section = segs[0] && /^[a-z]{2}(-[a-z]{2})?$/.test(segs[0]) ? segs.slice(0, 3).join("/") : (segs[0] || "");
    return u.hostname.replace(/^www\./i, "").toLowerCase() + "/" + section;
  } catch { return ""; }
}

export function activeSourceCount(sources) {
  return (sources || []).filter(function(s){ return s && s.enabled; }).length;
}

export function sourcesNeeded(sources, target) {
  const t = Number(target);
  const want = target === null || target === undefined || target === "" || !Number.isFinite(t) ? DEFAULT_SOURCE_TARGET : Math.max(0, t);
  return Math.max(0, want - activeSourceCount(sources));
}

// Candidates not yet present (by host+section) and not blocked by the editor.
export function freshCandidates(candidates, sources, blockedHosts) {
  const keys = new Set((sources || []).map(function(s){ return sourceKey(s && s.url); }).filter(Boolean));
  // A site already connected by its main page covers its news sections too.
  const rootHosts = new Set((sources || []).filter(function(s){ return s && sourceKey(s.url).endsWith("/"); }).map(function(s){ return sourceHost(s.url); }));
  const blocked = new Set((blockedHosts || []).map(function(h){ return String(h || "").toLowerCase(); }));
  const out = [];
  for (const c of (candidates || [])) {
    if (!c || !/^https?:\/\//i.test(c.url || "")) continue;
    const key = sourceKey(c.url);
    const host = sourceHost(c.url);
    if (!key || keys.has(key) || blocked.has(host) || blocked.has(key) || rootHosts.has(host)) continue;
    keys.add(key);
    out.push(c);
  }
  return out;
}

export const RESERVE_SOURCES = {
  money: [
    { name: "Газета.ру — Бизнес", url: "https://www.gazeta.ru/business/news/", group: "media" },
    { name: "Банкиру", url: "https://bankiros.ru/news", group: "media" },
    { name: "Финмаркет", url: "https://www.finmarket.ru/news/", group: "media" },
    { name: "Российская газета — Экономика", url: "https://rg.ru/tema/ekonomika", group: "media" },
    { name: "Лента.ру — Экономика", url: "https://lenta.ru/rubrics/economics/", group: "media" }
  ],
  auto: [
    { name: "Motor Trend", url: "https://www.motortrend.com/news/", group: "media" },
    { name: "Road & Track", url: "https://www.roadandtrack.com/news/", group: "media" },
    { name: "Autoweek", url: "https://www.autoweek.com/news/", group: "media" },
    { name: "Autoblog", url: "https://www.autoblog.com/news", group: "media" },
    { name: "CarBuzz", url: "https://carbuzz.com/news/", group: "media" },
    { name: "Automotive News", url: "https://www.autonews.com/", group: "media" },
    { name: "electrive", url: "https://www.electrive.com/", group: "media" },
    { name: "CarExpert", url: "https://www.carexpert.com.au/car-news", group: "media" },
    { name: "АвтоВзгляд", url: "https://www.avtovzglyad.ru/news/", group: "media" },
    { name: "Газета.ру Авто", url: "https://www.gazeta.ru/auto/news/", group: "media" },
    { name: "110km.ru", url: "https://110km.ru/novosti/", group: "media" },
    { name: "Автоновости дня", url: "https://avtonovostidnya.ru/", group: "media" }
  ],
  ai: [
    { name: "AI News", url: "https://www.artificialintelligence-news.com/", group: "media" },
    { name: "MarkTechPost", url: "https://www.marktechpost.com/", group: "media" },
    { name: "Unite.AI", url: "https://www.unite.ai/", group: "media" },
    { name: "AI Business", url: "https://aibusiness.com/", group: "media" },
    { name: "ZDNET AI", url: "https://www.zdnet.com/topic/artificial-intelligence/", group: "media" },
    { name: "The Register AI", url: "https://www.theregister.com/software/ai_ml/", group: "media" },
    { name: "InfoQ AI", url: "https://www.infoq.com/ai-ml-data-eng/", group: "media" },
    { name: "Synced", url: "https://syncedreview.com/", group: "media" },
    { name: "Хабр: ИИ", url: "https://habr.com/ru/hubs/artificial_intelligence/news/", group: "media" },
    { name: "Engadget AI", url: "https://www.engadget.com/ai/", group: "media" },
    { name: "Axios AI", url: "https://www.axios.com/technology/artificial-intelligence", group: "media" },
    { name: "SiliconANGLE AI", url: "https://siliconangle.com/category/ai/", group: "media" }
  ]
};

export function buildDiscoveryPrompt(options) {
  const existing = (options.existingHosts || []).slice(0, 120);
  return [
    "Подбери новые источники новостей для Telegram-канала «" + (options.channelName || "") + "» (тема: " + (options.topic || "новости") + ").",
    "Нужны " + (options.count || 5) + " сайтов с ежедневно обновляемой лентой новостей по этой теме: крупные СМИ, отраслевые издания, официальные пресс-центры компаний.",
    "Желательно часть русскоязычных, если они пишут о российском рынке.",
    "Дай прямую ссылку именно на страницу-ленту новостей (не на главную, если лента отдельная), без RSS и без Telegram.",
    "Не предлагай агрегаторы, форумы, доски объявлений, сайты с платным доступом ко всем статьям и эти уже подключённые сайты: " + existing.join(", ") + ".",
    "Ответь строго JSON без пояснений: {\"sources\":[{\"name\":\"Название\",\"url\":\"https://…\",\"group\":\"media|official\",\"why\":\"коротко\"}]}"
  ].join("\n");
}

export function parseDiscoveryResult(text) {
  const raw = String(text || "").replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  let parsed = null;
  try { parsed = JSON.parse(raw); }
  catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch { parsed = null; } }
  }
  const list = parsed && Array.isArray(parsed.sources) ? parsed.sources : (Array.isArray(parsed) ? parsed : []);
  return list.map(function(x){
    return {
      name: String(x && x.name || "").trim().slice(0, 80),
      url: String(x && x.url || "").trim(),
      group: x && x.group === "official" ? "official" : "media",
      why: String(x && x.why || "").trim().slice(0, 160)
    };
  }).filter(function(x){ return x.name && /^https?:\/\//i.test(x.url); });
}

// Starter source lists for new channels of the network. Every entry is
// validated by the server (page opens, has fresh items) before it is added.
export const SEED_SOURCES = {
  money: [
    // Official: rates, taxes, laws
    { name: "Банк России", url: "https://www.cbr.ru/news/", group: "official" },
    { name: "Банк России (Telegram)", url: "https://t.me/s/centralbank_russia", group: "creator" },
    { name: "Минфин России", url: "https://minfin.gov.ru/ru/press-center/", group: "official" },
    { name: "Минфин (Telegram)", url: "https://t.me/s/minfin", group: "creator" },
    { name: "ФНС России", url: "https://www.nalog.gov.ru/rn77/news/activities_fts/", group: "official" },
    { name: "Росстат", url: "https://rosstat.gov.ru/folder/313/document/", group: "official" },
    { name: "Мосбиржа", url: "https://www.moex.com/ru/news/", group: "official" },
    { name: "АСВ (страхование вкладов)", url: "https://www.asv.org.ru/news/", group: "official" },
    { name: "Госдума", url: "http://duma.gov.ru/news/", group: "official" },
    { name: "Социальный фонд России", url: "https://sfr.gov.ru/press_center/news/", group: "official" },
    // Business media
    { name: "Интерфакс — экономика", url: "https://www.interfax.ru/business/", group: "media" },
    { name: "ПРАЙМ", url: "https://1prime.ru/", group: "media" },
    { name: "Коммерсантъ — экономика", url: "https://www.kommersant.ru/rubric/3", group: "media" },
    { name: "РБК Финансы", url: "https://www.rbc.ru/finances/", group: "media" },
    { name: "Ведомости — Финансы", url: "https://www.vedomosti.ru/finance", group: "media" },
    { name: "Известия — Экономика", url: "https://iz.ru/rubric/ekonomika", group: "media" },
    { name: "ТАСС — Экономика", url: "https://tass.ru/ekonomika", group: "media" },
    { name: "РИА Новости — Экономика", url: "https://ria.ru/economy/", group: "media" },
    { name: "Frank Media", url: "https://frankmedia.ru/", group: "media" },
    { name: "Банки.ру — новости", url: "https://www.banki.ru/news/lenta/", group: "media" },
    { name: "Сравни — новости", url: "https://www.sravni.ru/novost/", group: "media" },
    // Personal finance
    { name: "Т—Ж", url: "https://journal.tbank.ru/news/", group: "media" },
    { name: "Финансовая культура (ЦБ)", url: "https://fincult.info/news/", group: "official" },
    { name: "Выберу.ру — новости", url: "https://www.vbr.ru/news/", group: "media" },
    // Telegram: faster than sites
    { name: "Банки.ру (Telegram)", url: "https://t.me/s/bankiru", group: "creator" },
    { name: "Т—Ж (Telegram)", url: "https://t.me/s/tinkoffjournal", group: "creator" },
    { name: "Frank Media (Telegram)", url: "https://t.me/s/frank_media", group: "creator" },
    { name: "MMI (Telegram)", url: "https://t.me/s/russianmacro", group: "creator" },
    { name: "РБК (Telegram)", url: "https://t.me/s/rbc_news", group: "creator" },
    { name: "Интерфакс (Telegram)", url: "https://t.me/s/interfaxonline", group: "creator" },
    // World — only what moves the rouble and prices
    { name: "Investing.com — экономика", url: "https://ru.investing.com/news/economy", group: "media" },
    { name: "Финам — рынки", url: "https://www.finam.ru/publications/section/market/", group: "media" },
    { name: "Интерфакс — мировые рынки", url: "https://www.interfax.ru/world/", group: "media" }
  ]
};
