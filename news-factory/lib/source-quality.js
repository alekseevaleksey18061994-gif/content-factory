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
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    // Telegram: every channel is its own source (t.me/s/<channel>).
    if (host === "t.me" || host === "telegram.me") return "t.me/" + (segs[0] === "s" ? segs[1] || "" : segs[0] || "");
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
  tech: [
    { name: "iXBT — новости", url: "https://www.ixbt.com/news/", group: "media" },
    { name: "3DNews", url: "https://3dnews.ru/news", group: "media" },
    { name: "Хабр — новости", url: "https://habr.com/ru/news/", group: "media" },
    { name: "CNews", url: "https://www.cnews.ru/news", group: "media" },
    { name: "Ferra.ru", url: "https://www.ferra.ru/news", group: "media" },
    { name: "Wylsacom", url: "https://wylsa.com/", group: "media" },
    { name: "iPhones.ru", url: "https://www.iphones.ru/iNotes", group: "media" },
    { name: "AppleInsider.ru", url: "https://appleinsider.ru/", group: "media" },
    { name: "Rozetked", url: "https://rozetked.me/news", group: "media" },
    { name: "Droider", url: "https://droider.ru/news/", group: "media" },
    { name: "Overclockers", url: "https://overclockers.ru/news", group: "media" },
    { name: "Mobile-review", url: "https://mobile-review.com/all/news/", group: "media" },
    { name: "The Verge — Tech", url: "https://www.theverge.com/tech", group: "media" },
    { name: "Engadget", url: "https://www.engadget.com/news/", group: "media" },
    { name: "9to5Mac", url: "https://9to5mac.com/", group: "media" },
    { name: "9to5Google", url: "https://9to5google.com/", group: "media" },
    { name: "Android Authority", url: "https://www.androidauthority.com/news/", group: "media" },
    { name: "GSMArena", url: "https://www.gsmarena.com/news.php3", group: "media" },
    { name: "MacRumors", url: "https://www.macrumors.com/", group: "media" },
    { name: "Tom's Hardware", url: "https://www.tomshardware.com/news", group: "media" },
    { name: "Ars Technica — Gadgets", url: "https://arstechnica.com/gadgets/", group: "media" },
    { name: "Rozetked (Telegram)", url: "https://t.me/s/rozetked", group: "creator" },
    { name: "iPhones.ru (Telegram)", url: "https://t.me/s/iphonesru", group: "creator" },
    { name: "AppleInsider.ru (Telegram)", url: "https://t.me/s/appleinsiderru", group: "creator" },
    { name: "Wylsacom Red (Telegram)", url: "https://t.me/s/wylsared", group: "creator" },
    { name: "Хор (Telegram)", url: "https://t.me/s/xor_journal", group: "creator" },
    { name: "Эксплойт (Telegram)", url: "https://t.me/s/exploitex", group: "creator" },
    { name: "Mobile-review (Telegram)", url: "https://t.me/s/mobilereviewcom", group: "creator" },
    { name: "Droider (Telegram)", url: "https://t.me/s/droidergram", group: "creator" },
    { name: "iXBT (Telegram)", url: "https://t.me/s/ixbtcom", group: "creator" },
    { name: "Код Дурова (Telegram)", url: "https://t.me/s/d_code", group: "creator" },
    { name: "Техномедиа (Telegram)", url: "https://t.me/s/techmedia", group: "creator" },
  ],
  games: [
    { name: "Игромания", url: "https://www.igromania.ru/news/", group: "media" },
    { name: "Канобу", url: "https://kanobu.ru/news/", group: "media" },
    { name: "DTF — Игры", url: "https://dtf.ru/games", group: "media" },
    { name: "GameGuru", url: "https://www.gameguru.ru/news/", group: "media" },
    { name: "VGTimes", url: "https://vgtimes.ru/news/", group: "media" },
    { name: "Shazoo", url: "https://shazoo.ru/news", group: "media" },
    { name: "PlayGround.ru", url: "https://www.playground.ru/news", group: "media" },
    { name: "Riot Pixels", url: "https://riotpixels.com/", group: "media" },
    { name: "Cybersport.ru", url: "https://www.cybersport.ru/", group: "media" },
    { name: "StopGame.ru", url: "https://stopgame.ru/news", group: "media" },
    { name: "IGN", url: "https://www.ign.com/news", group: "media" },
    { name: "PC Gamer", url: "https://www.pcgamer.com/news/", group: "media" },
    { name: "Eurogamer", url: "https://www.eurogamer.net/news", group: "media" },
    { name: "Gematsu", url: "https://www.gematsu.com/category/news", group: "media" },
    { name: "Polygon", url: "https://www.polygon.com/news", group: "media" },
    { name: "Kotaku", url: "https://kotaku.com/", group: "media" },
    { name: "GameSpot", url: "https://www.gamespot.com/news/", group: "media" },
    { name: "VGC", url: "https://www.videogameschronicle.com/news/", group: "media" },
    { name: "Rock Paper Shotgun", url: "https://www.rockpapershotgun.com/news", group: "media" },
    { name: "PlayStation Blog", url: "https://blog.playstation.com/", group: "official" },
    { name: "Xbox Wire", url: "https://news.xbox.com/en-us/", group: "official" },
    { name: "Steam News", url: "https://store.steampowered.com/news/", group: "official" },
    { name: "StopGame (Telegram)", url: "https://t.me/s/stopgameru", group: "creator" },
    { name: "Игромания (Telegram)", url: "https://t.me/s/igromania", group: "creator" },
    { name: "Канобу (Telegram)", url: "https://t.me/s/kanobu", group: "creator" },
    { name: "VGTimes (Telegram)", url: "https://t.me/s/vgtimes", group: "creator" },
    { name: "PlayGround (Telegram)", url: "https://t.me/s/playgroundru", group: "creator" },
    { name: "DTF (Telegram)", url: "https://t.me/s/dtfru", group: "creator" },
    { name: "Shazoo (Telegram)", url: "https://t.me/s/shazoo", group: "creator" },
    { name: "Cybersport.ru (Telegram)", url: "https://t.me/s/cybersportru", group: "creator" },
    { name: "GameGuru (Telegram)", url: "https://t.me/s/gameguru_ru", group: "creator" },
    { name: "Riot Pixels (Telegram)", url: "https://t.me/s/riotpixels", group: "creator" },
  ],
  kino: [
    { name: "Кинопоиск — новости", url: "https://www.kinopoisk.ru/media/news/", group: "media" },
    { name: "КГ-Портал", url: "https://kg-portal.ru/news/", group: "media" },
    { name: "Film.ru", url: "https://www.film.ru/news", group: "media" },
    { name: "Киноафиша", url: "https://www.kinoafisha.info/news/", group: "media" },
    { name: "Кино-Театр.Ру", url: "https://www.kino-teatr.ru/news/", group: "media" },
    { name: "Бюллетень кинопрокатчика", url: "https://www.kinometro.ru/news/", group: "media" },
    { name: "Канобу — кино", url: "https://kanobu.ru/cinema/", group: "media" },
    { name: "Кино Mail", url: "https://kino.mail.ru/news/", group: "media" },
    { name: "Искусство кино", url: "https://kinoart.ru/news", group: "media" },
    { name: "DTF — кино и сериалы", url: "https://dtf.ru/cinema", group: "media" },
    { name: "Variety — Film", url: "https://variety.com/v/film/news/", group: "media" },
    { name: "Deadline", url: "https://deadline.com/", group: "media" },
    { name: "The Hollywood Reporter", url: "https://www.hollywoodreporter.com/c/movies/movie-news/", group: "media" },
    { name: "IndieWire", url: "https://www.indiewire.com/c/film/", group: "media" },
    { name: "Collider", url: "https://collider.com/movie-news/", group: "media" },
    { name: "Screen Rant", url: "https://screenrant.com/movie-news/", group: "media" },
    { name: "/Film", url: "https://www.slashfilm.com/category/movies/", group: "media" },
    { name: "Empire", url: "https://www.empireonline.com/movies/news/", group: "media" },
    { name: "What's on Netflix", url: "https://www.whats-on-netflix.com/news/", group: "media" },
    { name: "Кинопоиск (Telegram)", url: "https://t.me/s/kinopoisk", group: "creator" },
    { name: "Film.ru (Telegram)", url: "https://t.me/s/filmru", group: "creator" },
    { name: "Киноафиша (Telegram)", url: "https://t.me/s/kinoafisha_info", group: "creator" },
    { name: "КГ-Портал (Telegram)", url: "https://t.me/s/kgportal", group: "creator" },
    { name: "Бюллетень кинопрокатчика (Telegram)", url: "https://t.me/s/kinometro", group: "creator" },
    { name: "Флешфорвард (Telegram)", url: "https://t.me/s/flashforwardmag", group: "creator" },
    { name: "Okko (Telegram)", url: "https://t.me/s/okkotv", group: "creator" },
    { name: "Иви (Telegram)", url: "https://t.me/s/ivi_ru", group: "creator" },
    { name: "Кион (Telegram)", url: "https://t.me/s/kion_ru", group: "creator" },
    { name: "Wink (Telegram)", url: "https://t.me/s/wink_rt", group: "creator" },
    { name: "Канобу (Telegram)", url: "https://t.me/s/kanobu", group: "creator" },
  ],
  science: [
    { name: "N + 1", url: "https://nplus1.ru/news", group: "media" },
    { name: "Naked Science", url: "https://naked-science.ru/article", group: "media" },
    { name: "Индикатор", url: "https://indicator.ru/", group: "media" },
    { name: "Хайтек", url: "https://hightech.fm/", group: "media" },
    { name: "РИА Наука", url: "https://ria.ru/science/", group: "media" },
    { name: "ТАСС Наука", url: "https://nauka.tass.ru/", group: "media" },
    { name: "Элементы — новости науки", url: "https://elementy.ru/novosti_nauki", group: "media" },
    { name: "Научная Россия", url: "https://scientificrussia.ru/news", group: "media" },
    { name: "Популярная механика — наука", url: "https://www.techinsider.ru/science/", group: "media" },
    { name: "Роскосмос", url: "https://www.roscosmos.ru/102/", group: "official" },
    { name: "ScienceAlert", url: "https://www.sciencealert.com/latest", group: "media" },
    { name: "Phys.org", url: "https://phys.org/", group: "media" },
    { name: "ScienceDaily", url: "https://www.sciencedaily.com/news/", group: "media" },
    { name: "New Scientist", url: "https://www.newscientist.com/section/news/", group: "media" },
    { name: "Live Science", url: "https://www.livescience.com/news", group: "media" },
    { name: "Space.com", url: "https://www.space.com/news", group: "media" },
    { name: "NASA", url: "https://www.nasa.gov/news/", group: "official" },
    { name: "ESA", url: "https://www.esa.int/Newsroom", group: "official" },
    { name: "Nature — News", url: "https://www.nature.com/nature/articles?type=news", group: "media" },
    { name: "Science (AAAS) — News", url: "https://www.science.org/news", group: "media" },
    { name: "EurekAlert!", url: "https://www.eurekalert.org/news-releases/browse", group: "media" },
    { name: "N + 1 (Telegram)", url: "https://t.me/s/nplusone", group: "creator" },
    { name: "Naked Science (Telegram)", url: "https://t.me/s/naked_science", group: "creator" },
    { name: "Индикатор (Telegram)", url: "https://t.me/s/indicator_ru", group: "creator" },
    { name: "Хайтек (Telegram)", url: "https://t.me/s/hightech_fm", group: "creator" },
    { name: "Роскосмос (Telegram)", url: "https://t.me/s/roscosmos_gk", group: "creator" },
    { name: "Наука и жизнь (Telegram)", url: "https://t.me/s/nkj_ru", group: "creator" },
    { name: "Элементы (Telegram)", url: "https://t.me/s/elementyru", group: "creator" },
    { name: "Космос просто (Telegram)", url: "https://t.me/s/cosmosprosto", group: "creator" },
    { name: "Популярная механика (Telegram)", url: "https://t.me/s/popmechru", group: "creator" },
  ],
  // Sport: no bookmaker-owned media (the channel profile forbids betting content).
  sport: [
    { name: "Спорт-Экспресс", url: "https://www.sport-express.ru/news/", group: "media" },
    { name: "Sports.ru", url: "https://www.sports.ru/news/", group: "media" },
    { name: "Чемпионат", url: "https://www.championat.com/news/1.html", group: "media" },
    { name: "Советский спорт", url: "https://www.sovsport.ru/news", group: "media" },
    { name: "Матч ТВ", url: "https://matchtv.ru/news", group: "media" },
    { name: "РИА Спорт", url: "https://rsport.ria.ru/", group: "media" },
    { name: "ТАСС Спорт", url: "https://tass.ru/sport", group: "media" },
    { name: "Sport24", url: "https://sport24.ru/news", group: "media" },
    { name: "Газета.Ru — спорт", url: "https://www.gazeta.ru/sport/news/", group: "media" },
    { name: "РБК Спорт", url: "https://sportrbc.ru/news", group: "media" },
    { name: "КХЛ", url: "https://www.khl.ru/news/", group: "official" },
    { name: "РПЛ", url: "https://premierliga.ru/news/", group: "official" },
    { name: "ESPN", url: "https://www.espn.com/", group: "media" },
    { name: "BBC Sport", url: "https://www.bbc.com/sport", group: "media" },
    { name: "Sky Sports", url: "https://www.skysports.com/news-wire", group: "media" },
    { name: "UFC", url: "https://www.ufc.com/news", group: "official" },
    { name: "MMA Fighting", url: "https://www.mmafighting.com/latest-news", group: "media" },
    { name: "NHL", url: "https://www.nhl.com/news/", group: "official" },
    { name: "Матч ТВ (Telegram)", url: "https://t.me/s/matchtv", group: "creator" },
    { name: "Спорт-Экспресс (Telegram)", url: "https://t.me/s/sportexpress", group: "creator" },
    { name: "Sports.ru (Telegram)", url: "https://t.me/s/sportsru", group: "creator" },
    { name: "Чемпионат (Telegram)", url: "https://t.me/s/championat", group: "creator" },
    { name: "Советский спорт (Telegram)", url: "https://t.me/s/sovsport", group: "creator" },
    { name: "РБК Спорт (Telegram)", url: "https://t.me/s/rbc_sport", group: "creator" },
    { name: "РПЛ (Telegram)", url: "https://t.me/s/premierliga", group: "creator" },
    { name: "КХЛ (Telegram)", url: "https://t.me/s/khl_official_telegram", group: "creator" },
    { name: "Sport24 (Telegram)", url: "https://t.me/s/sport24_ru", group: "creator" },
    { name: "Бомбардир (Telegram)", url: "https://t.me/s/bombardir", group: "creator" },
    { name: "ТАСС Спорт (Telegram)", url: "https://t.me/s/tass_sport", group: "creator" },
    { name: "Р-Спорт (Telegram)", url: "https://t.me/s/rsport_ria", group: "creator" },
  ],
  // «Что там в мире?»: необычное, рекорды, культура, курьёзы без политики и жертв.
  // Общие мировые новости и политические ленты сюда не берём — профиль канала их запрещает.
  world: [
    { name: "Guinness World Records — новости", url: "https://www.guinnessworldrecords.com/news", group: "official" },
    { name: "UPI — Odd News", url: "https://www.upi.com/Odd_News/", group: "media" },
    { name: "AP — Oddities", url: "https://apnews.com/hub/oddities", group: "media" },
    { name: "Atlas Obscura", url: "https://www.atlasobscura.com/articles", group: "media" },
    { name: "Oddity Central", url: "https://www.odditycentral.com/", group: "media" },
    { name: "Smithsonian — Smart News", url: "https://www.smithsonianmag.com/smart-news/", group: "media" },
    { name: "Good News Network", url: "https://www.goodnewsnetwork.org/", group: "media" },
    { name: "Mental Floss", url: "https://www.mentalfloss.com/", group: "media" },
    { name: "Neatorama", url: "https://www.neatorama.com/", group: "media" },
    { name: "Ripley's — истории", url: "https://www.ripleys.com/stories", group: "official" },
    { name: "Oddee", url: "https://www.oddee.com/", group: "media" },
    { name: "Live Science", url: "https://www.livescience.com/news", group: "media" },
    { name: "BBC Culture", url: "https://www.bbc.com/culture", group: "media" },
    { name: "BBC Earth", url: "https://www.bbcearth.com/news", group: "media" },
    { name: "National Geographic — Animals", url: "https://www.nationalgeographic.com/animals", group: "media" },
    { name: "Open Culture", url: "https://www.openculture.com/", group: "media" },
    { name: "This Is Colossal", url: "https://www.thisiscolossal.com/", group: "media" },
    { name: "Messy Nessy Chic", url: "https://www.messynessychic.com/", group: "media" },
    { name: "Euronews — Culture", url: "https://www.euronews.com/culture", group: "media" },
    { name: "Metro — Weird", url: "https://metro.co.uk/tag/weird-news/", group: "media" },
    { name: "Вокруг света", url: "https://www.vokrugsveta.ru/news/", group: "media" },
    { name: "National Geographic Россия", url: "https://www.nat-geo.ru/", group: "media" },
    { name: "Лента.ру — Из жизни", url: "https://lenta.ru/rubrics/life/", group: "media" },
    { name: "ТАСС — Культура", url: "https://tass.ru/kultura", group: "media" },
    { name: "Хайтек — наука", url: "https://hightech.fm/", group: "media" },
    { name: "Вокруг света (Telegram)", url: "https://t.me/s/vokrugsvetaru", group: "creator" },
    { name: "National Geographic Россия (Telegram)", url: "https://t.me/s/natgeoru", group: "creator" },
    { name: "Guinness World Records (Telegram)", url: "https://t.me/s/guinnessworldrecords", group: "creator" },
  ],
  // «Что там у звёзд?»: знаменитости, шоу-бизнес, музыка, премьеры, блогеры. Жёлтые и
  // скандальные ленты не берём: профиль канала запрещает слухи, здоровье и травлю.
  stars: [
    { name: "Starhit — новости", url: "https://www.starhit.ru/novosti/", group: "media" },
    { name: "PeopleTalk", url: "https://peopletalk.ru/news/", group: "media" },
    { name: "7Дней — звёзды", url: "https://7days.ru/stars/", group: "media" },
    { name: "Super.ru", url: "https://www.super.ru/news", group: "media" },
    { name: "Экспресс газета — шоу-бизнес", url: "https://www.eg.ru/showbusiness/", group: "media" },
    { name: "Леди Mail.ru — звёзды", url: "https://lady.mail.ru/stars/", group: "media" },
    { name: "Cosmopolitan — звёзды", url: "https://www.cosmo.ru/stars/", group: "media" },
    { name: "Elle — звёзды", url: "https://www.elle.ru/zvezdy/", group: "media" },
    { name: "Harper's Bazaar — знаменитости", url: "https://www.harpersbazaar.ru/celebrity/", group: "media" },
    { name: "Афиша — новости", url: "https://www.afisha.ru/news/", group: "media" },
    { name: "Рамблер — Starlife", url: "https://news.rambler.ru/starlife/", group: "media" },
    { name: "Газета.Ru — культура", url: "https://www.gazeta.ru/culture/news/", group: "media" },
    { name: "Лента.ру — Культура", url: "https://lenta.ru/rubrics/culture/", group: "media" },
    { name: "РИА Новости — Культура", url: "https://ria.ru/culture/", group: "media" },
    { name: "МК — Культура и шоу-бизнес", url: "https://www.mk.ru/culture/", group: "media" },
    { name: "People — Celebrity", url: "https://people.com/celebrity/", group: "media" },
    { name: "Variety", url: "https://variety.com/", group: "media" },
    { name: "Variety — Music", url: "https://variety.com/v/music/", group: "media" },
    { name: "Billboard — Music News", url: "https://www.billboard.com/music/music-news/", group: "media" },
    { name: "The Hollywood Reporter", url: "https://www.hollywoodreporter.com/news/", group: "media" },
    { name: "Deadline", url: "https://deadline.com/", group: "media" },
    { name: "E! Online", url: "https://www.eonline.com/news", group: "media" },
    { name: "Entertainment Weekly", url: "https://ew.com/", group: "media" },
    { name: "Rolling Stone — Music News", url: "https://www.rollingstone.com/music/music-news/", group: "media" },
    { name: "BBC — Entertainment & Arts", url: "https://www.bbc.com/news/entertainment_and_arts", group: "media" },
    { name: "NME — News", url: "https://www.nme.com/news", group: "media" },
    { name: "The Guardian — Culture", url: "https://www.theguardian.com/culture", group: "media" },
    { name: "Pitchfork — News", url: "https://pitchfork.com/news/", group: "media" },
    { name: "Starhit (Telegram)", url: "https://t.me/s/starhit", group: "creator" },
    { name: "PeopleTalk (Telegram)", url: "https://t.me/s/peopletalk", group: "creator" },
    { name: "Super.ru (Telegram)", url: "https://t.me/s/superru", group: "creator" },
  ],
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
    { name: "ПРАЙМ (Telegram)", url: "https://t.me/s/prime1", group: "creator" },
    { name: "Банкста (Telegram)", url: "https://t.me/s/banksta", group: "creator" },
    { name: "Ведомости (Telegram)", url: "https://t.me/s/vedomosti", group: "creator" },
    { name: "Коммерсантъ (Telegram)", url: "https://t.me/s/kommersant", group: "creator" },
    { name: "ФНС России (Telegram)", url: "https://t.me/s/nalog_gov_ru", group: "creator" },
    { name: "Росстат (Telegram)", url: "https://t.me/s/rosstat_official", group: "creator" },
    { name: "Финансовая культура (Telegram)", url: "https://t.me/s/fincult_info", group: "creator" },
    { name: "Социальный фонд (Telegram)", url: "https://t.me/s/sfr_official", group: "creator" },
    { name: "Мосбиржа (Telegram)", url: "https://t.me/s/moex_official", group: "creator" },
    { name: "Сравни (Telegram)", url: "https://t.me/s/sravni_ru", group: "creator" },
    { name: "Финам (Telegram)", url: "https://t.me/s/finamalert", group: "creator" },
    { name: "Твои деньги (Telegram)", url: "https://t.me/s/tvoidengi", group: "creator" },
    // World — only what moves the rouble and prices
    { name: "Investing.com — экономика", url: "https://ru.investing.com/news/economy", group: "media" },
    { name: "Финам — рынки", url: "https://www.finam.ru/publications/section/market/", group: "media" },
    { name: "Интерфакс — мировые рынки", url: "https://www.interfax.ru/world/", group: "media" }
  ]
};
