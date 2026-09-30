import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHANNEL = process.env.TELEGRAM_CHANNEL || "";
const TELEGRAM_PUBLIC_USERNAME = String(process.env.TELEGRAM_PUBLIC_USERNAME || CHANNEL || "").replace(/^@/, "").trim();
const ADMIN_KEY = process.env.ADMIN_KEY || crypto.randomBytes(32).toString("hex");
const ADMIN_UI_PASSWORD = process.env.ADMIN_UI_PASSWORD || "";
const ADMIN_UI_PASSWORD_SHA256 = String(process.env.ADMIN_UI_PASSWORD_SHA256 || "").trim().toLowerCase();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-6-luna";
const OPENAI_FALLBACK_MODEL = "gpt-5.6-luna";
const DATABASE_URL = process.env.DATABASE_URL || "";
const MEDIA_REQUIRED = String(process.env.MEDIA_REQUIRED || "true").toLowerCase() !== "false";
const GENERATE_COVER_IF_MISSING = String(process.env.GENERATE_COVER_IF_MISSING || "true").toLowerCase() !== "false";
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-sunburst";
const OPENAI_IMAGE_QUALITY = process.env.OPENAI_IMAGE_QUALITY || "low";
const PUBLIC_BASE_URL = (process.env.NEWS_FACTORY_PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN : "https://news-factory-api-production.up.railway.app")).replace(/\/$/, "");
const COLLECTOR_ENABLED = String(process.env.COLLECTOR_ENABLED || "true").toLowerCase() !== "false";
const AUTO_PUBLISH_ENABLED = String(process.env.AUTO_PUBLISH_ENABLED || "false").toLowerCase() === "true";
const AUTO_PUBLISH_MIN_INTERVAL_MINUTES = Math.max(10, Number(process.env.AUTO_PUBLISH_MIN_INTERVAL_MINUTES || 30));
const POLL_INTERVAL_MINUTES = Math.max(5, Number(process.env.POLL_INTERVAL_MINUTES || 5));
const MAX_ITEMS_PER_RUN = Math.max(1, Math.min(10, Number(process.env.MAX_ITEMS_PER_RUN || 5)));
const ARTICLE_MAX_AGE_HOURS = Math.max(6, Math.min(168, Number(process.env.ARTICLE_MAX_AGE_HOURS || 24)));
const QUEUE_MAX_AGE_HOURS = Math.max(2, Math.min(72, Number(process.env.QUEUE_MAX_AGE_HOURS || 12)));
const QUEUE_MAX_AUTO_ITEMS = Math.max(5, Math.min(50, Number(process.env.QUEUE_MAX_AUTO_ITEMS || 20)));
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || "/data";
const STATE_FILE = path.join(DATA_DIR, "state.json");
const MEDIA_DIR = path.join(DATA_DIR, "media");
const PUBLIC_DIR = path.join(process.cwd(), "public");
let APP_VERSION = "0.0.0";
try {
  APP_VERSION = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")).version || APP_VERSION;
} catch {}

const CURATED_SOURCES = [
  { id: "openai", name: "OpenAI News", type: "web", group: "official", priority: 1, url: "https://openai.com/news/", enabled: true },
  { id: "anthropic", name: "Anthropic News", type: "web", group: "official", priority: 1, url: "https://www.anthropic.com/news", enabled: true },
  { id: "google-deepmind", name: "Google DeepMind", type: "web", group: "official", priority: 1, url: "https://deepmind.google/blog/", enabled: true },
  { id: "google-ai", name: "Google AI", type: "web", group: "official", priority: 1, url: "https://blog.google/technology/ai/", enabled: true },
  { id: "meta-ai", name: "Meta AI", type: "web", group: "official", priority: 1, url: "https://ai.meta.com/blog/", enabled: true },
  { id: "microsoft-ai", name: "Microsoft AI", type: "web", group: "official", priority: 1, url: "https://blogs.microsoft.com/ai/", enabled: true },
  { id: "nvidia-ai", name: "NVIDIA AI", type: "web", group: "official", priority: 1, url: "https://blogs.nvidia.com/blog/category/generative-ai/", enabled: true },
  { id: "xai", name: "xAI News", type: "web", group: "official", priority: 1, url: "https://x.ai/news", enabled: true },
  { id: "mistral", name: "Mistral AI", type: "web", group: "official", priority: 1, url: "https://mistral.ai/news/", enabled: true },
  { id: "huggingface", name: "Hugging Face", type: "web", group: "official", priority: 1, url: "https://huggingface.co/blog", enabled: true },
  { id: "perplexity", name: "Perplexity", type: "web", group: "official", priority: 1, url: "https://www.perplexity.ai/hub/blog", enabled: true },
  { id: "stability-ai", name: "Stability AI", type: "web", group: "official", priority: 1, url: "https://stability.ai/news-updates", enabled: true },

  { id: "techcrunch-ai", name: "TechCrunch AI", type: "web", group: "media", priority: 2, url: "https://techcrunch.com/category/artificial-intelligence/", enabled: true },
  { id: "the-verge-ai", name: "The Verge AI", type: "web", group: "media", priority: 2, url: "https://www.theverge.com/ai-artificial-intelligence", enabled: true },
  { id: "ars-ai", name: "Ars Technica AI", type: "web", group: "media", priority: 2, url: "https://arstechnica.com/ai/", enabled: true },
  { id: "venturebeat-ai", name: "VentureBeat AI", type: "web", group: "media", priority: 2, url: "https://venturebeat.com/category/ai/", enabled: true },
  { id: "wired-ai", name: "WIRED AI", type: "web", group: "media", priority: 2, url: "https://www.wired.com/category/artificial-intelligence/", enabled: true },
  { id: "mit-tech-ai", name: "MIT Technology Review AI", type: "web", group: "media", priority: 2, url: "https://www.technologyreview.com/topic/artificial-intelligence/", enabled: true },
  { id: "the-decoder", name: "The Decoder", type: "web", group: "media", priority: 2, url: "https://the-decoder.com/", enabled: true },
  { id: "the-batch", name: "DeepLearning.AI — The Batch", type: "web", group: "media", priority: 2, url: "https://www.deeplearning.ai/the-batch", enabled: true }
];

const defaultState = {
  mode: "REVIEW",
  sources: structuredClone(CURATED_SOURCES),
  sourceCursor: 0,
  queuePolicy: {
    articleMaxAgeHours: ARTICLE_MAX_AGE_HOURS,
    queueMaxAgeHours: QUEUE_MAX_AGE_HOURS,
    queueMaxAutoItems: QUEUE_MAX_AUTO_ITEMS
  },
  publicationSchedule: {
    timezone: "Europe/Moscow",
    targetPerDay: 10,
    maxPerDay: 12,
    minIntervalMinutes: 60,
    assignments: {},
    suppressed: {},
    slots: [
      { time: "00:00", kind: "reserve", label: "Резервное окно" },
      { time: "03:00", kind: "reserve", label: "Резервное окно" },
      { time: "08:00", kind: "regular", label: "Плановая публикация" },
      { time: "10:00", kind: "regular", label: "Плановая публикация" },
      { time: "12:00", kind: "regular", label: "Плановая публикация" },
      { time: "14:00", kind: "regular", label: "Плановая публикация" },
      { time: "16:00", kind: "regular", label: "Плановая публикация" },
      { time: "18:00", kind: "regular", label: "Плановая публикация" },
      { time: "20:00", kind: "regular", label: "Плановая публикация" },
      { time: "22:00", kind: "regular", label: "Плановая публикация" }
    ]
  },
  queue: [],
  history: [],
  stats: { discovered: 0, rewritten: 0, published: 0, skipped: 0, expired: 0 },
  migrations: [],
  updatedAt: new Date().toISOString()
};

function ensureDataDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
  try { fs.mkdirSync(MEDIA_DIR, { recursive: true }); } catch {}
}

function normalizeDate(value) {
  if (!value) return "";
  const d = new Date(String(value).trim());
  if (!Number.isFinite(d.getTime())) return "";
  if (d.getTime() > Date.now() + 24 * 60 * 60 * 1000) return "";
  return d.toISOString();
}

function moscowDateKey(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date || new Date());
  const map = {};
  parts.forEach(function(p){ map[p.type] = p.value; });
  return map.year + "-" + map.month + "-" + map.day;
}

function moscowMinutes(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date || new Date());
  const map = {};
  parts.forEach(function(p){ map[p.type] = p.value; });
  return Number(map.hour || 0) * 60 + Number(map.minute || 0);
}

function slotMinutes(time) {
  const parts = String(time || "00:00").split(":").map(Number);
  return Number(parts[0] || 0) * 60 + Number(parts[1] || 0);
}

function ensureScheduleShape(targetState) {
  if (!targetState.publicationSchedule) targetState.publicationSchedule = structuredClone(defaultState.publicationSchedule);
  const schedule = targetState.publicationSchedule;
  if (!schedule.assignments || typeof schedule.assignments !== "object") schedule.assignments = {};
  if (!schedule.suppressed || typeof schedule.suppressed !== "object") schedule.suppressed = {};
  return schedule;
}

function cleanupScheduleAssignments(targetState) {
  const schedule = ensureScheduleShape(targetState);
  const validIds = new Set((targetState.queue || []).map(function(item){ return item && item.id; }).filter(Boolean));
  Object.keys(schedule.assignments).forEach(function(day) {
    const byTime = schedule.assignments[day];
    if (!byTime || typeof byTime !== "object") {
      delete schedule.assignments[day];
      return;
    }
    Object.keys(byTime).forEach(function(time) {
      if (!validIds.has(byTime[time])) delete byTime[time];
    });
    if (!Object.keys(byTime).length) delete schedule.assignments[day];
  });

  const today = moscowDateKey(new Date());
  Object.keys(schedule.suppressed).forEach(function(day) {
    if (day < today) delete schedule.suppressed[day];
  });
}

function ensureScheduleAssignments(targetState, dayKey) {
  const schedule = ensureScheduleShape(targetState);
  cleanupScheduleAssignments(targetState);
  const today = moscowDateKey(new Date());
  const day = dayKey || today;
  if (day !== today) return 0;

  if (!schedule.assignments[day]) schedule.assignments[day] = {};
  if (!schedule.suppressed[day]) schedule.suppressed[day] = {};

  const used = new Set();
  Object.keys(schedule.assignments).forEach(function(d) {
    Object.values(schedule.assignments[d] || {}).forEach(function(id){ if (id) used.add(id); });
  });

  const candidates = (targetState.queue || [])
    .filter(function(item){ return item && item.id && item.newsId && !used.has(item.id); })
    .sort(function(a,b){ return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(); });

  const nowMin = moscowMinutes(new Date());
  let assigned = 0;
  (schedule.slots || []).filter(function(slot){ return slot.kind === "regular"; }).forEach(function(slot) {
    if (schedule.suppressed[day][slot.time]) return;
    if (schedule.assignments[day][slot.time]) return;
    if (slotMinutes(slot.time) < nowMin - 30) return;
    const next = candidates.shift();
    if (!next) return;
    schedule.assignments[day][slot.time] = next.id;
    used.add(next.id);
    assigned += 1;
  });
  return assigned;
}

function removeQueueIdFromSchedule(targetState, queueId) {
  const schedule = ensureScheduleShape(targetState);
  Object.keys(schedule.assignments).forEach(function(day) {
    Object.keys(schedule.assignments[day] || {}).forEach(function(time) {
      if (schedule.assignments[day][time] === queueId) delete schedule.assignments[day][time];
    });
    if (!Object.keys(schedule.assignments[day] || {}).length) delete schedule.assignments[day];
  });
}


function pruneQueueItems(targetState) {
  if (!targetState || !Array.isArray(targetState.queue)) return { removed: 0, expired: 0, overflow: 0 };
  const cutoff = Date.now() - QUEUE_MAX_AGE_HOURS * 60 * 60 * 1000;
  let expired = 0;
  let overflow = 0;
  const manual = [];
  const automatic = [];

  for (const item of targetState.queue) {
    if (!item || !item.newsId) {
      manual.push(item);
      continue;
    }
    const createdAt = new Date(item.createdAt || 0).getTime();
    if (createdAt && createdAt < cutoff) {
      expired += 1;
      continue;
    }
    automatic.push(item);
  }

  automatic.sort(function(a, b) {
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  });

  if (automatic.length > QUEUE_MAX_AUTO_ITEMS) {
    overflow = automatic.length - QUEUE_MAX_AUTO_ITEMS;
    automatic.length = QUEUE_MAX_AUTO_ITEMS;
  }

  const kept = automatic.concat(manual);
  kept.sort(function(a, b) {
    return new Date(b && b.createdAt || 0).getTime() - new Date(a && a.createdAt || 0).getTime();
  });
  targetState.queue = kept;

  const removed = expired + overflow;
  if (removed) {
    targetState.stats = targetState.stats || {};
    targetState.stats.expired = Number(targetState.stats.expired || 0) + removed;
  }
  targetState.queuePolicy = {
    articleMaxAgeHours: ARTICLE_MAX_AGE_HOURS,
    queueMaxAgeHours: QUEUE_MAX_AGE_HOURS,
    queueMaxAutoItems: QUEUE_MAX_AUTO_ITEMS
  };
  cleanupScheduleAssignments(targetState);
  ensureScheduleAssignments(targetState);
  return { removed: removed, expired: expired, overflow: overflow };
}


function loadState() {
  ensureDataDir();
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const saved = JSON.parse(raw);
    const loaded = Object.assign({}, structuredClone(defaultState), saved);
    loaded.sources = Array.isArray(saved.sources) ? saved.sources : structuredClone(defaultState.sources);
    loaded.migrations = Array.isArray(saved.migrations) ? saved.migrations : [];
    loaded.stats = Object.assign({ discovered: 0, rewritten: 0, published: 0, skipped: 0, expired: 0 }, saved.stats || {});
    loaded.queue = Array.isArray(saved.queue) ? saved.queue : [];

    const migrationId = "v0.3.2-restore-openai-source";
    if (!loaded.migrations.includes(migrationId)) {
      const hasOpenAi = loaded.sources.some(function(src) {
        return src && (src.id === "openai" || String(src.url || "").includes("openai.com/news"));
      });
      if (!hasOpenAi) loaded.sources.unshift(structuredClone(defaultState.sources[0]));
      loaded.migrations.push(migrationId);
    }

    const curatedMigrationId = "v0.8.0-curated-sources-20";
    if (!loaded.migrations.includes(curatedMigrationId)) {
      loaded.sources = structuredClone(CURATED_SOURCES);
      loaded.sourceCursor = 0;
      loaded.migrations.push(curatedMigrationId);
    }

    const freshnessMigrationId = "v0.10.0-freshness-engine";
    if (!loaded.migrations.includes(freshnessMigrationId)) {
      loaded.queuePolicy = structuredClone(defaultState.queuePolicy);
      loaded.migrations.push(freshnessMigrationId);
    }

    const dashboardCalendarMigrationId = "v0.11.0-dashboard-calendar-actions";
    if (!loaded.migrations.includes(dashboardCalendarMigrationId)) {
      ensureScheduleShape(loaded);
      loaded.migrations.push(dashboardCalendarMigrationId);
    }

    pruneQueueItems(loaded);

    const scheduleMigrationId = "v0.9.0-publication-calendar";
    if (!loaded.migrations.includes(scheduleMigrationId)) {
      loaded.publicationSchedule = structuredClone(defaultState.publicationSchedule);
      loaded.migrations.push(scheduleMigrationId);
    } else if (!loaded.publicationSchedule) {
      loaded.publicationSchedule = structuredClone(defaultState.publicationSchedule);
    }

    fs.writeFileSync(STATE_FILE, JSON.stringify(loaded, null, 2), "utf8");
    return loaded;
  } catch {
    const fresh = structuredClone(defaultState);
    fresh.migrations.push("v0.3.2-restore-openai-source");
    fresh.migrations.push("v0.8.0-curated-sources-20");
    fresh.migrations.push("v0.9.0-publication-calendar");
    fresh.migrations.push("v0.10.0-freshness-engine");
    fresh.migrations.push("v0.11.0-dashboard-calendar-actions");
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(fresh, null, 2), "utf8"); } catch {}
    return fresh;
  }
}

let state = loadState();
const db = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL, max: 4, idleTimeoutMillis: 30000 }) : null;
let dbReady = false;
let collectorRunning = false;
let collectorTimer = null;
let lastCollectorRun = null;
let snapshotTimer = null;

function saveState() {
  pruneQueueItems(state);
  state.updatedAt = new Date().toISOString();
  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  scheduleStateSnapshot();
}

async function initDb() {
  if (!db) return false;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS news_items (
        id TEXT PRIMARY KEY,
        source_id TEXT,
        source_name TEXT,
        source_url TEXT,
        original_url TEXT UNIQUE,
        original_title TEXT,
        original_text TEXT,
        content_hash TEXT,
        detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        rewritten_title TEXT,
        rewritten_text TEXT,
        confidence TEXT,
        status TEXT NOT NULL DEFAULT 'discovered',
        telegram_message_id BIGINT,
        published_at TIMESTAMPTZ,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE INDEX IF NOT EXISTS news_items_detected_idx ON news_items(detected_at DESC);
      CREATE INDEX IF NOT EXISTS news_items_status_idx ON news_items(status);
      CREATE INDEX IF NOT EXISTS news_items_hash_idx ON news_items(content_hash);

      CREATE TABLE IF NOT EXISTS collector_runs (
        id BIGSERIAL PRIMARY KEY,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'running',
        found_count INTEGER NOT NULL DEFAULT 0,
        queued_count INTEGER NOT NULL DEFAULT 0,
        published_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        error_text TEXT
      );

      CREATE TABLE IF NOT EXISTS app_snapshots (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        state JSONB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS app_snapshots_created_idx ON app_snapshots(created_at DESC);
    `);
    dbReady = true;
    await saveStateSnapshot();
    console.log("PostgreSQL ready");
    return true;
  } catch (error) {
    dbReady = false;
    console.error("PostgreSQL init failed:", error.message);
    return false;
  }
}

async function saveStateSnapshot() {
  if (!db || !dbReady) return;
  try {
    await db.query("INSERT INTO app_snapshots(state) VALUES($1::jsonb)", [JSON.stringify(state)]);
    await db.query("DELETE FROM app_snapshots WHERE id NOT IN (SELECT id FROM app_snapshots ORDER BY created_at DESC LIMIT 200)");
  } catch (error) {
    console.error("State snapshot failed:", error.message);
  }
}

function scheduleStateSnapshot() {
  if (!db || !dbReady) return;
  clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(function(){ saveStateSnapshot(); }, 1500);
}

function canonicalizeUrl(raw, base) {
  try {
    const u = new URL(raw, base);
    u.hash = "";
    ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","fbclid","gclid"].forEach(function(k){ u.searchParams.delete(k); });
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
  } catch {
    return "";
  }
}

function htmlDecode(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, function(_, n){ return String.fromCharCode(Number(n)); });
}

function stripHtml(html) {
  return htmlDecode(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
  ).trim();
}

function extractTitle(html) {
  const og = String(html || "").match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
             String(html || "").match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["'][^>]*>/i);
  if (og && og[1]) return stripHtml(og[1]).slice(0, 300);
  const m = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripHtml(m[1]).slice(0, 300) : "";
}

function extractPublishedAt(html) {
  const source = String(html || "");
  const patterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["'][^>]*>/i,
    /<meta[^>]+name=["'](?:date|pubdate|publish-date|published_time)["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["'](?:date|pubdate|publish-date|published_time)["'][^>]*>/i,
    /<time[^>]+datetime=["']([^"']+)["'][^>]*>/i,
    /["']datePublished["']\s*:\s*["']([^"']+)["']/i
  ];
  for (const re of patterns) {
    const m = source.match(re);
    if (!m || !m[1]) continue;
    const normalized = normalizeDate(htmlDecode(m[1]));
    if (normalized) return normalized;
  }
  return "";
}

function extractMetaImage(html, pageUrl) {
  const source = String(html || "");
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["'][^>]*>/i
  ];
  for (const re of patterns) {
    const m = source.match(re);
    if (!m || !m[1]) continue;
    const url = canonicalizeUrl(htmlDecode(m[1]), pageUrl);
    if (url && /^https?:\/\//i.test(url)) return url;
  }
  return "";
}

function extractMetaVideo(html, pageUrl) {
  const source = String(html || "");
  const patterns = [
    /<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::secure_url)?["'][^>]*>/i,
    /<video[^>]+src=["']([^"']+)["'][^>]*>/i,
    /<source[^>]+src=["']([^"']+)["'][^>]*type=["']video\/[^"']+["'][^>]*>/i
  ];
  for (const re of patterns) {
    const m = source.match(re);
    if (!m || !m[1]) continue;
    const url = canonicalizeUrl(htmlDecode(m[1]), pageUrl);
    if (url && /^https?:\/\//i.test(url) && /\.(mp4|mov|m4v|webm)(\?|$)/i.test(url)) return url;
  }
  return "";
}

function mediaPublicUrl(fileName) {
  return PUBLIC_BASE_URL + "/media/" + encodeURIComponent(fileName);
}

async function generateNewsCover(payload) {
  if (!OPENAI_API_KEY || !GENERATE_COVER_IF_MISSING) {
    throw new Error("Генерация обложек отключена");
  }

  const prompt = [
    "Create a premium editorial technology news image for the Telegram channel AI Pulse.",
    "Topic: " + String(payload.title || "AI technology news"),
    "Context: " + String(payload.text || "").slice(0, 1800),
    "Visual direction: dark graphite premium technology editorial, realistic or polished cinematic illustration, strong central subject, clean composition, high contrast, modern AI/technology atmosphere.",
    "No text, no captions, no watermarks, no fake UI, no invented logos, no random letters.",
    "If a real company/product is mentioned, do not invent a different product design or fabricated branding.",
    "Landscape 3:2 composition suitable for a Telegram news post."
  ].join("\n");

  const candidates = [OPENAI_IMAGE_MODEL, "gpt-image-2"].filter(function(v, i, a){ return v && a.indexOf(v) === i; });
  let lastError = "";

  for (const model of candidates) {
    try {
      const response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          authorization: "Bearer " + OPENAI_API_KEY,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: model,
          prompt: prompt,
          size: "1536x1024",
          quality: OPENAI_IMAGE_QUALITY
        }),
        signal: AbortSignal.timeout(120000)
      });
      const data = await response.json().catch(function(){ return {}; });
      if (!response.ok) {
        lastError = (data && data.error && data.error.message) || ("OpenAI Images HTTP " + response.status);
        continue;
      }
      const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
      if (!b64) {
        lastError = "OpenAI Images не вернул изображение";
        continue;
      }
      ensureDataDir();
      const safeId = String(payload.id || crypto.randomBytes(8).toString("hex")).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
      const fileName = "cover_" + safeId + ".png";
      const filePath = path.join(MEDIA_DIR, fileName);
      fs.writeFileSync(filePath, Buffer.from(b64, "base64"));
      return { url: mediaPublicUrl(fileName), model: model, fileName: fileName };
    } catch (error) {
      lastError = String(error && error.message || error);
    }
  }
  throw new Error(lastError || "Не удалось сгенерировать обложку");
}

async function ensureMediaForNews(payload) {
  const imageUrl = String(payload.imageUrl || "").trim();
  const videoUrl = String(payload.videoUrl || "").trim();
  if (videoUrl) {
    return { videoUrl: videoUrl, imageUrl: imageUrl, generatedImageUrl: "", mediaType: "video", mediaStatus: "found" };
  }
  if (imageUrl) {
    return { videoUrl: "", imageUrl: imageUrl, generatedImageUrl: "", mediaType: "photo", mediaStatus: "found" };
  }

  if (GENERATE_COVER_IF_MISSING) {
    try {
      const generated = await generateNewsCover(payload);
      return {
        videoUrl: "",
        imageUrl: "",
        generatedImageUrl: generated.url,
        mediaType: "generated",
        mediaStatus: "generated",
        generatedBy: generated.model
      };
    } catch (error) {
      return {
        videoUrl: "",
        imageUrl: "",
        generatedImageUrl: "",
        mediaType: "none",
        mediaStatus: "generation_error",
        mediaError: error.message
      };
    }
  }

  return { videoUrl: "", imageUrl: "", generatedImageUrl: "", mediaType: "none", mediaStatus: "missing" };
}

function hasPublishableMedia(item) {
  return Boolean(item && (item.videoUrl || item.imageUrl || item.generatedImageUrl || (item.metadata && (item.metadata.videoUrl || item.metadata.imageUrl || item.metadata.generatedImageUrl))));
}


function extractArticleLinks(html, sourceUrl) {
  const base = new URL(sourceUrl);
  const out = new Map();
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const url = canonicalizeUrl(m[1], sourceUrl);
    const text = stripHtml(m[2]).replace(/\s+/g, " ").trim();
    if (!url || text.length < 18 || text.length > 220) continue;
    let u;
    try { u = new URL(url); } catch { continue; }
    if (u.hostname !== base.hostname && !u.hostname.endsWith("." + base.hostname.replace(/^www\./, ""))) continue;
    if (/\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|mp3)$/i.test(u.pathname)) continue;
    if (u.pathname === "/" || u.pathname.split("/").filter(Boolean).length < 1) continue;
    const score =
      (/news|blog|article|stories|technology|ai|research|product|updates/i.test(u.pathname) ? 4 : 0) +
      (u.pathname.split("/").filter(Boolean).length >= 2 ? 2 : 0) +
      (text.length >= 35 ? 1 : 0);
    const prev = out.get(url);
    if (!prev || score > prev.score) out.set(url, { url: url, title: text, score: score });
  }
  return Array.from(out.values()).sort(function(a,b){ return b.score - a.score; }).slice(0, 12);
}

async function fetchText(url, timeoutMs) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; NewsFactoryBot/0.6; +https://news-factory-api-production.up.railway.app)"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs || 15000)
  });
  if (!response.ok) throw new Error("HTTP " + response.status + " " + url);
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html") && !type.includes("application/xhtml")) throw new Error("Unsupported content type: " + type);
  return await response.text();
}

async function seenOriginalUrl(url) {
  if (db && dbReady) {
    const r = await db.query("SELECT 1 FROM news_items WHERE original_url=$1 LIMIT 1", [url]);
    return r.rowCount > 0;
  }
  state.seenUrls = Array.isArray(state.seenUrls) ? state.seenUrls : [];
  return state.seenUrls.includes(url);
}

async function saveNewsItem(item) {
  if (db && dbReady) {
    await db.query(
      `INSERT INTO news_items
      (id, source_id, source_name, source_url, original_url, original_title, original_text, content_hash, rewritten_title, rewritten_text, confidence, status, telegram_message_id, published_at, metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
      ON CONFLICT (original_url) DO UPDATE SET
        rewritten_title=COALESCE(EXCLUDED.rewritten_title, news_items.rewritten_title),
        rewritten_text=COALESCE(EXCLUDED.rewritten_text, news_items.rewritten_text),
        confidence=COALESCE(EXCLUDED.confidence, news_items.confidence),
        status=EXCLUDED.status,
        telegram_message_id=COALESCE(EXCLUDED.telegram_message_id, news_items.telegram_message_id),
        published_at=COALESCE(EXCLUDED.published_at, news_items.published_at),
        metadata=EXCLUDED.metadata`,
      [
        item.id, item.sourceId, item.sourceName, item.sourceUrl, item.originalUrl, item.originalTitle,
        item.originalText, item.contentHash, item.rewrittenTitle || null, item.rewrittenText || null,
        item.confidence || null, item.status, item.telegramMessageId || null, item.publishedAt || null,
        JSON.stringify(item.metadata || {})
      ]
    );
  }
  state.seenUrls = Array.isArray(state.seenUrls) ? state.seenUrls : [];
  if (!state.seenUrls.includes(item.originalUrl)) {
    state.seenUrls.push(item.originalUrl);
    state.seenUrls = state.seenUrls.slice(-5000);
    saveState();
  }
}

async function listNewsItems(limit) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit || 30)));
  if (db && dbReady) {
    const r = await db.query(
      `SELECT id, source_id AS "sourceId", source_name AS "sourceName", source_url AS "sourceUrl",
      original_url AS "originalUrl", original_title AS "originalTitle", detected_at AS "detectedAt",
      rewritten_title AS "rewrittenTitle", rewritten_text AS "rewrittenText", confidence, status,
      telegram_message_id AS "telegramMessageId", published_at AS "publishedAt", metadata
      FROM news_items ORDER BY detected_at DESC LIMIT $1`, [safeLimit]
    );
    return r.rows;
  }
  return [];
}

async function getCollectorRuns(limit) {
  if (!db || !dbReady) return [];
  const r = await db.query(
    'SELECT id, started_at AS "startedAt", finished_at AS "finishedAt", status, found_count AS "foundCount", queued_count AS "queuedCount", published_count AS "publishedCount", skipped_count AS "skippedCount", error_text AS "errorText" FROM collector_runs ORDER BY id DESC LIMIT $1',
    [Math.max(1, Math.min(50, Number(limit || 10)))]
  );
  return r.rows;
}

async function collectOnce(trigger) {
  if (!COLLECTOR_ENABLED) return { ok: false, error: "Collector disabled" };
  if (collectorRunning) return { ok: false, error: "Collector already running" };
  collectorRunning = true;
  const startedAt = new Date().toISOString();
  const summary = { ok: true, trigger: trigger || "scheduler", startedAt: startedAt, found: 0, queued: 0, published: 0, skipped: 0, errors: [] };
  let runId = null;
  try {
    const cleanupBeforeRun = pruneQueueItems(state);
    if (cleanupBeforeRun.removed) {
      summary.expired = cleanupBeforeRun.removed;
      saveState();
    }

    if (db && dbReady) {
      const r = await db.query("INSERT INTO collector_runs(status) VALUES('running') RETURNING id");
      runId = r.rows[0].id;
    }

    if (state.mode === "PAUSED" && trigger !== "manual") {
      summary.skipped += 1;
      return summary;
    }

    const enabledSources = (state.sources || []).filter(function(src){ return src.enabled && /^https?:\/\//i.test(src.url || ""); });
    const ordered = [];
    const selectedUrls = new Set();

    const cursor = enabledSources.length ? Math.abs(Number(state.sourceCursor || 0)) % enabledSources.length : 0;
    const rotatedSources = enabledSources.length
      ? enabledSources.slice(cursor).concat(enabledSources.slice(0, cursor))
      : [];

    const sourceResults = await Promise.all(rotatedSources.map(async function(source) {
      try {
        const html = await fetchText(source.url, 15000);
        const links = extractArticleLinks(html, source.url).slice(0, 12);
        for (const link of links) {
          if (selectedUrls.has(link.url)) continue;
          if (await seenOriginalUrl(link.url)) {
            summary.skipped += 1;
            continue;
          }
          selectedUrls.add(link.url);
          return { source: source, link: link };
        }
        return null;
      } catch (error) {
        summary.errors.push(source.name + ": " + error.message);
        return null;
      }
    }));

    for (const candidate of sourceResults) {
      if (candidate) ordered.push(candidate);
    }

    if (enabledSources.length) {
      state.sourceCursor = (cursor + Math.max(1, MAX_ITEMS_PER_RUN)) % enabledSources.length;
      saveState();
    }

    for (const candidate of ordered) {
      if (summary.found >= MAX_ITEMS_PER_RUN) break;
      const source = candidate.source;
      const url = candidate.link.url;

      try {
        const articleHtml = await fetchText(url, 15000);
        const originalTitle = extractTitle(articleHtml) || candidate.link.title;
        const articlePublishedAt = extractPublishedAt(articleHtml);
        if (articlePublishedAt && (Date.now() - new Date(articlePublishedAt).getTime()) > ARTICLE_MAX_AGE_HOURS * 60 * 60 * 1000) {
          summary.skipped += 1;
          continue;
        }
        const imageUrl = extractMetaImage(articleHtml, url);
        const videoUrl = extractMetaVideo(articleHtml, url);
        const raw = stripHtml(articleHtml);
        const originalText = raw.slice(0, 14000);
        if (originalText.length < 250) {
          summary.skipped += 1;
          continue;
        }
        const contentHash = crypto.createHash("sha256").update(originalTitle + "\n" + originalText.slice(0, 6000)).digest("hex");
        const id = "news_" + contentHash.slice(0, 20);
        const media = await ensureMediaForNews({
          id: id,
          title: originalTitle,
          text: originalText,
          sourceName: source.name,
          imageUrl: imageUrl,
          videoUrl: videoUrl
        });
        const baseItem = {
          id: id,
          sourceId: source.id,
          sourceName: source.name,
          sourceUrl: source.url,
          originalUrl: url,
          originalTitle: originalTitle,
          originalText: originalText,
          contentHash: contentHash,
          status: "discovered",
          metadata: {
            trigger: trigger || "scheduler",
            articlePublishedAt: articlePublishedAt || "",
            imageUrl: media.imageUrl || "",
            videoUrl: media.videoUrl || "",
            generatedImageUrl: media.generatedImageUrl || "",
            mediaType: media.mediaType,
            mediaStatus: media.mediaStatus,
            mediaError: media.mediaError || "",
            generatedBy: media.generatedBy || ""
          }
        };
        summary.found += 1;
        state.stats.discovered += 1;

        if (MEDIA_REQUIRED && !hasPublishableMedia(baseItem)) {
          baseItem.status = "missing_media";
          await saveNewsItem(baseItem);
          summary.skipped += 1;
          summary.errors.push(originalTitle + ": не удалось подготовить фото или видео");
          continue;
        }

        let rewrite;
        try {
          rewrite = await callOpenAIRewrite({ title: originalTitle, sourceUrl: url, text: originalText });
          state.stats.rewritten += 1;
        } catch (error) {
          baseItem.status = "rewrite_error";
          baseItem.metadata.rewriteError = error.message;
          await saveNewsItem(baseItem);
          summary.errors.push(originalTitle + ": " + error.message);
          continue;
        }

        baseItem.rewrittenTitle = rewrite.title;
        baseItem.rewrittenText = rewrite.text;
        baseItem.confidence = rewrite.confidence;
        baseItem.metadata.model = rewrite.model;
        baseItem.metadata.notes = rewrite.notes;

        const postText = rewrite.text;

        const lastPublished = (state.history || []).find(function(x){ return x && x.publishedAt; });
        const lastPublishedAt = lastPublished ? new Date(lastPublished.publishedAt).getTime() : 0;
        const enoughTimePassed = !lastPublishedAt || (Date.now() - lastPublishedAt) >= AUTO_PUBLISH_MIN_INTERVAL_MINUTES * 60 * 1000;
        const canAutoPublish =
          state.mode === "AUTO" &&
          AUTO_PUBLISH_ENABLED &&
          enoughTimePassed &&
          summary.published < 1;

        if (canAutoPublish) {
          const tg = await sendTelegramPost({
            title: rewrite.title,
            text: rewrite.text,
            sourceUrl: url,
            imageUrl: media.imageUrl,
            generatedImageUrl: media.generatedImageUrl,
            videoUrl: media.videoUrl
          });
          baseItem.status = "published";
          baseItem.telegramMessageId = tg.message_id;
          baseItem.publishedAt = new Date().toISOString();
          state.history.unshift({
            id: newId("hist"),
            title: rewrite.title || originalTitle,
            text: postText,
            messageId: tg.message_id,
            publishedAt: baseItem.publishedAt,
            sourceUrl: url,
            imageUrl: media.imageUrl || "",
            generatedImageUrl: media.generatedImageUrl || "",
            videoUrl: media.videoUrl || "",
            mediaType: media.mediaType,
            mediaStatus: media.mediaStatus
          });
          state.history = state.history.slice(0, 300);
          state.stats.published += 1;
          summary.published += 1;
        } else {
          baseItem.status = "queued";
          baseItem.metadata.autoPublishBlocked = state.mode === "AUTO" ? (
            !AUTO_PUBLISH_ENABLED ? "disabled" :
            !enoughTimePassed ? "rate_limited" :
            "run_limit"
          ) : "review_mode";
          state.queue.unshift({
            id: newId("q"),
            title: rewrite.title || originalTitle,
            text: postText,
            createdAt: new Date().toISOString(),
            articlePublishedAt: articlePublishedAt || "",
            sourceUrl: url,
            imageUrl: media.imageUrl || "",
            generatedImageUrl: media.generatedImageUrl || "",
            videoUrl: media.videoUrl || "",
            mediaType: media.mediaType,
            mediaStatus: media.mediaStatus,
            sourceName: source.name,
            newsId: id
          });
          pruneQueueItems(state);
          summary.queued += 1;
        }

        await saveNewsItem(baseItem);
        saveState();
      } catch (error) {
        summary.errors.push(url + ": " + error.message);
      }
    }

    summary.finishedAt = new Date().toISOString();
    lastCollectorRun = summary;
    if (db && dbReady && runId) {
      await db.query(
        "UPDATE collector_runs SET finished_at=NOW(), status=$2, found_count=$3, queued_count=$4, published_count=$5, skipped_count=$6, error_text=$7 WHERE id=$1",
        [runId, summary.errors.length ? "completed_with_errors" : "success", summary.found, summary.queued, summary.published, summary.skipped, summary.errors.slice(0, 20).join("\n") || null]
      );
    }
    saveState();
    return summary;
  } catch (error) {
    summary.ok = false;
    summary.error = error.message;
    summary.finishedAt = new Date().toISOString();
    lastCollectorRun = summary;
    if (db && dbReady && runId) {
      try {
        await db.query("UPDATE collector_runs SET finished_at=NOW(), status='failed', error_text=$2 WHERE id=$1", [runId, error.message]);
      } catch {}
    }
    return summary;
  } finally {
    collectorRunning = false;
  }
}

function startCollectorScheduler() {
  if (!COLLECTOR_ENABLED || collectorTimer) return;
  const everyMs = POLL_INTERVAL_MINUTES * 60 * 1000;
  collectorTimer = setInterval(function(){
    collectOnce("scheduler").catch(function(error){ console.error("Collector run failed:", error.message); });
  }, everyMs);
  console.log("Collector scheduler started every " + POLL_INTERVAL_MINUTES + " min");
}

function sendJson(res, status, payload, headers) {
  const h = Object.assign({ "content-type": "application/json; charset=utf-8" }, headers || {});
  res.writeHead(status, h);
  res.end(JSON.stringify(payload));
}

function sendHtmlFile(res, fileName) {
  const file = path.join(PUBLIC_DIR, fileName);
  try {
    const body = fs.readFileSync(file, "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(body);
  } catch {
    sendJson(res, 500, { ok: false, error: "UI file missing" });
  }
}

function redirect(res, location) {
  res.writeHead(302, { location: location });
  res.end();
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1024 * 1024) throw new Error("request too large");
  }
  if (!body) return {};
  return JSON.parse(body);
}

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const out = {};
  raw.split(";").forEach(function(part) {
    const trimmed = part.trim();
    if (!trimmed) return;
    const i = trimmed.indexOf("=");
    if (i === -1) return;
    out[trimmed.slice(0, i)] = decodeURIComponent(trimmed.slice(i + 1));
  });
  return out;
}

function sessionToken() {
  return crypto.createHmac("sha256", ADMIN_KEY).update("news-factory-admin").digest("hex");
}

function isAuthed(req) {
  return parseCookies(req).nf_session === sessionToken();
}

function requireAuth(req, res) {
  if (!isAuthed(req)) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return false;
  }
  return true;
}

function newId(prefix) {
  return (prefix || "item") + "_" + Date.now() + "_" + crypto.randomBytes(3).toString("hex");
}

function escapeTelegramHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeTelegramAttr(value) {
  return escapeTelegramHtml(value).replace(/"/g, "&quot;");
}

function formatTelegramInline(value) {
  let out = escapeTelegramHtml(value);
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  out = out.replace(/__([^_\n]+)__/g, "<i>$1</i>");
  return out;
}

function formatTelegramBody(value) {
  const lines = String(value || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let quote = [];
  function flushQuote() {
    if (!quote.length) return;
    out.push("<blockquote>" + quote.map(formatTelegramInline).join("\n") + "</blockquote>");
    quote = [];
  }
  for (const raw of lines) {
    const line = String(raw || "");
    if (/^>\s?/.test(line)) {
      quote.push(line.replace(/^>\s?/, ""));
      continue;
    }
    flushQuote();
    out.push(formatTelegramInline(line));
  }
  flushQuote();
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function formatTelegramPost(post) {
  const title = String(post.title || "").trim();
  const text = String(post.text || "").trim();
  const sourceUrl = String(post.sourceUrl || "").trim();
  let html = "";
  if (title) html += "<b>" + escapeTelegramHtml(title) + "</b>";
  if (text) html += (html ? "\n\n" : "") + formatTelegramBody(text);
  if (sourceUrl) html += (html ? "\n\n" : "") + '🔗 <a href="' + escapeTelegramAttr(sourceUrl) + '">Источник</a>';
  return html.trim();
}

async function telegramApi(method, payload) {
  if (!BOT_TOKEN || !CHANNEL) throw new Error("Telegram configuration is incomplete");
  const endpoint = "https://api.telegram.org/bot" + BOT_TOKEN + "/" + method;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error((data && data.description) || "Telegram API error");
  return data.result;
}

async function sendTelegramPost(post) {
  const html = formatTelegramPost(post);
  const imageUrl = String(post.generatedImageUrl || post.imageUrl || "").trim();
  const videoUrl = String(post.videoUrl || "").trim();

  if (MEDIA_REQUIRED && !imageUrl && !videoUrl) {
    throw new Error("Публикация запрещена: у новости нет фото или видео");
  }

  if (videoUrl) {
    try {
      return await telegramApi("sendVideo", {
        chat_id: CHANNEL,
        video: videoUrl,
        caption: html.length <= 1000 ? html : (post.title ? "<b>" + escapeTelegramHtml(post.title) + "</b>" : undefined),
        parse_mode: "HTML",
        supports_streaming: true
      });
    } catch (error) {
      console.warn("sendVideo failed:", error.message);
      if (!imageUrl) throw error;
    }
  }

  if (imageUrl && html.length <= 950) {
    try {
      return await telegramApi("sendPhoto", {
        chat_id: CHANNEL,
        photo: imageUrl,
        caption: html,
        parse_mode: "HTML"
      });
    } catch (error) {
      console.warn("sendPhoto failed:", error.message);
      if (MEDIA_REQUIRED) throw error;
    }
  }

  if (imageUrl) {
    const photo = await telegramApi("sendPhoto", {
      chat_id: CHANNEL,
      photo: imageUrl,
      caption: post.title ? "<b>" + escapeTelegramHtml(post.title) + "</b>" : undefined,
      parse_mode: "HTML"
    });
    if (html && html.length > 950) {
      await telegramApi("sendMessage", {
        chat_id: CHANNEL,
        text: html,
        parse_mode: "HTML",
        disable_web_page_preview: true
      });
    }
    return photo;
  }

  throw new Error("Публикация запрещена: медиа не подготовлено");
}

async function sendTelegram(text) {
  return telegramApi("sendMessage", {
    chat_id: CHANNEL,
    text: String(text || ""),
    disable_web_page_preview: true
  });
}


let statusCache = { at: 0, value: null };
let analyticsCache = { at: 0, value: null };

function parseCompactNumber(value) {
  const raw = stripHtml(String(value || "")).replace(/\s+/g, "").replace(",", ".").toUpperCase();
  const m = raw.match(/([0-9]+(?:\.[0-9]+)?)([KMBКММЛН]*)/);
  if (!m) return 0;
  let n = Number(m[1] || 0);
  const suffix = m[2] || "";
  if (suffix === "K" || suffix === "К") n *= 1e3;
  else if (suffix === "M" || suffix === "М" || suffix === "МЛН") n *= 1e6;
  else if (suffix === "B") n *= 1e9;
  return Math.round(n);
}

function metricFromChunk(chunk, classPattern) {
  const re = new RegExp(
    '<(?:span|div|a)[^>]+class=["\\\'][^"\\\']*' + classPattern + '[^"\\\']*["\\\'][^>]*>([\\s\\S]*?)<\\/(?:span|div|a)>',
    'ig'
  );
  let total = 0;
  let matched = false;
  let m;
  while ((m = re.exec(chunk))) {
    matched = true;
    const text = stripHtml(m[1]);
    const nums = text.match(/[0-9]+(?:[.,][0-9]+)?\s*[KMBКМ]?/ig) || [];
    if (nums.length) total += parseCompactNumber(nums[nums.length - 1]);
  }
  return matched ? total : null;
}

function parseTelegramPreview(html) {
  const source = String(html || "");
  const posts = [];
  const parts = source.split(/<div[^>]+class=["'][^"']*tgme_widget_message_wrap[^"']*["'][^>]*>/i).slice(1);
  for (const chunk of parts) {
    const idMatch = chunk.match(/data-post=["'][^"']+\/(\d+)["']/i);
    if (!idMatch) continue;
    const messageId = Number(idMatch[1]);
    const viewsMatch = chunk.match(/class=["'][^"']*tgme_widget_message_views[^"']*["'][^>]*>([^<]+)</i);
    const dateMatch = chunk.match(/<time[^>]+datetime=["']([^"']+)["']/i);
    const reactions = metricFromChunk(chunk, 'tgme_widget_message_reaction\\b');
    let comments = metricFromChunk(chunk, 'tgme_widget_message_comments\\b');
    if (comments == null) comments = metricFromChunk(chunk, 'tgme_widget_message_repl(?:y|ies)\\b');
    posts.push({
      messageId: messageId,
      views: viewsMatch ? parseCompactNumber(viewsMatch[1]) : 0,
      reactions: reactions == null ? 0 : reactions,
      comments: comments == null ? 0 : comments,
      forwards: null,
      publishedAt: dateMatch ? normalizeDate(dateMatch[1]) : ""
    });
  }
  const subsMatch = source.match(/class=["'][^"']*tgme_header_counter[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
  const beforeMatch = source.match(/data-before=["'](\d+)["']/i) || source.match(/[?&]before=(\d+)/i);
  return {
    posts: posts,
    subscribers: subsMatch ? parseCompactNumber(subsMatch[1]) : null,
    before: beforeMatch ? Number(beforeMatch[1]) : null
  };
}

async function fetchTelegramAnalytics(force) {
  if (!TELEGRAM_PUBLIC_USERNAME) {
    return {
      connected: false,
      available: false,
      platform: "telegram",
      error: "Публичный Telegram-канал не настроен",
      totals: { posts: 0, views: 0, reactions: 0, comments: 0, forwards: null, subscribers: null, avgViews: 0, engagementRate: 0 },
      posts: []
    };
  }

  const historyById = new Map((state.history || []).map(function(h){ return [Number(h.messageId), h]; }).filter(function(x){ return Number.isFinite(x[0]); }));
  const wanted = new Set(Array.from(historyById.keys()));
  const collected = new Map();
  let subscribers = null;
  let before = null;
  let lastError = "";

  for (let page = 0; page < 5; page += 1) {
    let url = "https://t.me/s/" + encodeURIComponent(TELEGRAM_PUBLIC_USERNAME);
    if (before) url += "?before=" + encodeURIComponent(before);
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; NewsFactoryAnalytics/1.0; +https://t.me/" + TELEGRAM_PUBLIC_USERNAME + ")",
          "accept-language": "ru,en;q=0.8"
        },
        signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) throw new Error("Telegram HTTP " + response.status);
      const html = await response.text();
      const parsed = parseTelegramPreview(html);
      if (subscribers == null && parsed.subscribers != null) subscribers = parsed.subscribers;
      for (const post of parsed.posts) collected.set(post.messageId, post);
      if (wanted.size && Array.from(wanted).every(function(id){ return collected.has(id); })) break;
      if (!parsed.before || parsed.before === before || !parsed.posts.length) break;
      before = parsed.before;
    } catch (error) {
      lastError = String(error && error.message || error);
      break;
    }
  }

  const posts = Array.from(collected.values())
    .filter(function(p){ return !wanted.size || wanted.has(Number(p.messageId)); })
    .map(function(p) {
      const h = historyById.get(Number(p.messageId));
      return Object.assign({}, p, {
        title: h && h.title ? h.title : "Публикация #" + p.messageId,
        url: "https://t.me/" + TELEGRAM_PUBLIC_USERNAME + "/" + p.messageId
      });
    })
    .sort(function(a,b){ return Number(b.messageId) - Number(a.messageId); });

  const views = posts.reduce(function(sum,p){ return sum + Number(p.views || 0); }, 0);
  const reactions = posts.reduce(function(sum,p){ return sum + Number(p.reactions || 0); }, 0);
  const comments = posts.reduce(function(sum,p){ return sum + Number(p.comments || 0); }, 0);
  const avgViews = posts.length ? Math.round(views / posts.length) : 0;
  const engagementRate = views > 0 ? Number((((reactions + comments) / views) * 100).toFixed(2)) : 0;

  return {
    connected: true,
    available: posts.length > 0 || !lastError,
    platform: "telegram",
    channel: "@" + TELEGRAM_PUBLIC_USERNAME,
    channelUrl: "https://t.me/" + TELEGRAM_PUBLIC_USERNAME,
    source: "public_web_preview",
    checkedAt: new Date().toISOString(),
    error: posts.length ? "" : lastError,
    totals: {
      posts: posts.length,
      views: views,
      reactions: reactions,
      comments: comments,
      forwards: null,
      subscribers: subscribers,
      avgViews: avgViews,
      engagementRate: engagementRate
    },
    posts: posts.slice(0, 100),
    note: "Просмотры, реакции и доступные комментарии считываются из открытой веб-версии Telegram. Для полной статистики пересылок и глубокой истории позже подключим Telegram API (MTProto)."
  };
}

async function buildPlatformAnalytics(force) {
  const now = Date.now();
  if (!force && analyticsCache.value && now - analyticsCache.at < 5 * 60 * 1000) return analyticsCache.value;
  const telegram = await fetchTelegramAnalytics(force);
  const vkConfigured = Boolean(process.env.VK_ACCESS_TOKEN || process.env.VK_TOKEN || process.env.VK_GROUP_ID || process.env.VK_OWNER_ID);
  const value = {
    ok: true,
    generatedAt: new Date().toISOString(),
    telegram: telegram,
    vk: {
      connected: vkConfigured,
      available: false,
      platform: "vk",
      totals: { posts: 0, views: null, likes: null, comments: null, reposts: null, subscribers: null, avgViews: null, engagementRate: null },
      posts: [],
      note: vkConfigured ? "VK подключён частично: модуль аналитики ждёт идентификатор сообщества и права статистики." : "VK пока не подключён. После подключения сообщества здесь появятся просмотры, лайки, комментарии, репосты и статистика по каждому посту."
    }
  };
  analyticsCache = { at: now, value: value };
  return value;
}


async function telegramProbe(method, params) {
  if (!BOT_TOKEN) return { ok: false, error: "Токен не задан" };
  try {
    const endpoint = "https://api.telegram.org/bot" + BOT_TOKEN + "/" + method;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params || {}),
      signal: AbortSignal.timeout(5000)
    });
    const data = await response.json();
    if (!response.ok || !data.ok) return { ok: false, error: (data && data.description) || "Telegram API error" };
    return { ok: true, result: data.result };
  } catch (error) {
    return { ok: false, error: String(error && error.message || error) };
  }
}


async function openAIModelProbe() {
  if (!OPENAI_API_KEY) return { ok: false, error: "OPENAI_API_KEY не задан" };
  const candidates = [OPENAI_MODEL, OPENAI_FALLBACK_MODEL].filter(function(v, i, a){ return v && a.indexOf(v) === i; });
  let lastError = "";
  for (const model of candidates) {
    try {
      const response = await fetch("https://api.openai.com/v1/models/" + encodeURIComponent(model), {
        headers: { authorization: "Bearer " + OPENAI_API_KEY },
        signal: AbortSignal.timeout(7000)
      });
      const data = await response.json().catch(function(){ return {}; });
      if (response.ok) return { ok: true, model: model, result: data };
      lastError = (data && data.error && data.error.message) || ("HTTP " + response.status);
    } catch (error) {
      lastError = String(error && error.message || error);
    }
  }
  return { ok: false, error: lastError || "OpenAI API недоступен" };
}

function extractOpenAIText(data) {
  if (!data) return "";
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const chunks = [];
  for (const item of (data.output || [])) {
    for (const part of (item.content || [])) {
      if (part && typeof part.text === "string") chunks.push(part.text);
    }
  }
  return chunks.join("\n").trim();
}

async function callOpenAIRewrite(payload) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY не настроен");
  const sourceText = String(payload.text || "").trim();
  if (!sourceText) throw new Error("Нужен исходный текст новости");
  const title = String(payload.title || "").trim();
  const sourceUrl = String(payload.sourceUrl || "").trim();
  const prompt = [
    "Ты редактор Telegram-канала AI Pulse | Новости нейросетей.",
    "Твоя задача — не просто пересказать новость, а сделать живой фирменный Telegram-пост: человечный, быстрый, умный и узнаваемый.",
    "",
    "ГЛАВНОЕ:",
    "- используй только факты из исходного текста;",
    "- ничего не придумывай: даты, цены, характеристики, цитаты, сравнения и цифры нельзя добавлять от себя;",
    "- если факт не подтверждён исходником — не используй его;",
    "- не копируй формулировки источника дословно длинными кусками;",
    "- не копируй стиль конкурентов один в один: у AI Pulse должен быть собственный голос;",
    "- для политических, трагических, медицинских и других чувствительных тем — нейтрально, без шуток и оценочных призывов;",
    "",
    "ГОЛОС AI PULSE:",
    "- живой русский язык, как будто умный человек рассказал важную новость другу;",
    "- меньше канцелярита и фраз вроде «компания сообщила», если можно сказать проще;",
    "- допускается лёгкая ирония или короткая шутка из мира нейросетей, но только если тема реально подходит;",
    "- юмор не должен искажать факт и не должен быть в каждом посте;",
    "- можно использовать 2–4 уместных emoji на весь пост, а не украшать каждую строку;",
    "- иногда можно закончить коротким вопросом аудитории или реакцией в духе «Как вам такой расклад?»;",
    "",
    "СТРУКТУРА — ЧЕРЕДУЙ ФОРМАТЫ, ЧТОБЫ ЛЕНТА НЕ БЫЛА ОДИНАКОВОЙ:",
    "Формат A — быстрый релиз: сильный заголовок → короткий хук → 2 абзаца сути → один вывод/вопрос.",
    "Формат B — разбор: заголовок → что произошло → > отдельной строкой выдели один важный факт → что это меняет.",
    "Формат C — живой: заголовок → человеческий хук → 2–3 коротких абзаца → одна emoji-строка с главным выводом → вопрос.",
    "Выбери только один формат под конкретную новость.",
    "",
    "ФОРМАТИРОВАНИЕ TELEGRAM:",
    "- заголовок короткий, живой, 1 emoji максимум в начале;",
    "- в text разрешено использовать **жирное** только для 1–3 ключевых фраз;",
    "- строка, начинающаяся с > , будет показана как визуальная цитата/выделение; используй её максимум один раз и только для факта, который прямо следует из исходника;",
    "- можно использовать одну короткую строку с emoji как акцент, например «🧠 Главное: ...»;",
    "- не используй таблицы, хэштеги, markdown-ссылки, служебные подписи и фразу «Источник» — ссылку добавит система;",
    "- не используй капслок целыми фразами;",
    "",
    "ДЛИНА:",
    "- text примерно 550–780 знаков, максимум около 850 знаков;",
    "- 4–6 коротких визуальных блоков/абзацев, чтобы пост читался с телефона;",
    "- не растягивай текст ради объёма;",
    "",
    "Тон: современно, уверенно, без холодного пресс-релиза. Читатель должен понять новость за 20–30 секунд и захотеть дочитать.",
    "",
    "Верни СТРОГО JSON без кодового блока:",
    "{\"title\":\"...\",\"text\":\"...\",\"confidence\":\"high|medium|low\",\"notes\":\"...\"}",
    "",
    "Исходный заголовок: " + (title || "не указан"),
    "Источник: " + (sourceUrl || "не указан"),
    "",
    "Исходный текст:",
    sourceText
  ].join("\n");

  const candidates = [OPENAI_MODEL, OPENAI_FALLBACK_MODEL].filter(function(v, i, a){ return v && a.indexOf(v) === i; });
  let lastError = "";
  for (const model of candidates) {
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + OPENAI_API_KEY
        },
        body: JSON.stringify({
          model: model,
          input: prompt,
          max_output_tokens: 1500
        }),
        signal: AbortSignal.timeout(45000)
      });
      const data = await response.json().catch(function(){ return {}; });
      if (!response.ok) {
        lastError = (data && data.error && data.error.message) || ("OpenAI HTTP " + response.status);
        continue;
      }
      const output = extractOpenAIText(data);
      if (!output) {
        lastError = "OpenAI вернул пустой ответ";
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(output.replace(/^\s*```json\s*/i, "").replace(/\s*```\s*$/i, ""));
      } catch {
        parsed = { title: title || "AI Pulse", text: output, confidence: "medium", notes: "Ответ модели не был JSON" };
      }
      const result = {
        title: String(parsed.title || title || "AI Pulse").trim(),
        text: String(parsed.text || "").trim(),
        confidence: ["high","medium","low"].includes(String(parsed.confidence)) ? String(parsed.confidence) : "medium",
        notes: String(parsed.notes || "").trim(),
        model: model
      };
      if (!result.text) throw new Error("OpenAI не вернул текст новости");
      return result;
    } catch (error) {
      lastError = String(error && error.message || error);
    }
  }
  throw new Error(lastError || "Не удалось получить ответ OpenAI");
}

function hasEnv() {
  for (const key of arguments) if (!process.env[key]) return false;
  return true;
}

async function buildSystemStatus(force) {
  const now = Date.now();
  if (!force && statusCache.value && now - statusCache.at < 30000) return statusCache.value;

  let storageOk = false;
  let storageDetail = "";
  try {
    ensureDataDir();
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
    storageOk = true;
    storageDetail = "Том /data доступен для записи";
  } catch (error) {
    storageDetail = "Нет записи в " + DATA_DIR;
  }

  const botProbe = BOT_TOKEN ? await telegramProbe("getMe") : { ok: false, error: "TELEGRAM_BOT_TOKEN не задан" };
  const chatProbe = BOT_TOKEN && CHANNEL ? await telegramProbe("getChat", { chat_id: CHANNEL }) : { ok: false, error: "Канал или токен не заданы" };
  const openaiProbe = OPENAI_API_KEY ? await openAIModelProbe() : { ok: false, error: "OPENAI_API_KEY не задан" };

  const railwayConnected = Boolean(
    process.env.RAILWAY_PROJECT_ID ||
    process.env.RAILWAY_SERVICE_ID ||
    process.env.RAILWAY_ENVIRONMENT_ID ||
    process.env.RAILWAY_PUBLIC_DOMAIN
  );
  const gitConnected = Boolean(process.env.RAILWAY_GIT_COMMIT_SHA || process.env.RAILWAY_GIT_REPO_NAME);

  const details = {
    railway: {
      state: railwayConnected ? "connected" : "partial",
      description: railwayConnected ? "Production запущен в Railway" : "Сервис работает, системные переменные Railway не найдены",
      detail: process.env.RAILWAY_ENVIRONMENT_NAME ? "Окружение: " + process.env.RAILWAY_ENVIRONMENT_NAME : "Environment: production",
      next: railwayConnected ? "" : "Проверить Railway runtime variables"
    },
    github: {
      state: gitConnected ? "connected" : "partial",
      description: gitConnected ? "Деплой идёт из GitHub" : "Исходники есть в GitHub, runtime не отдал commit metadata",
      detail: process.env.RAILWAY_GIT_COMMIT_SHA ? "Commit: " + process.env.RAILWAY_GIT_COMMIT_SHA.slice(0, 8) : "Repo: content-factory/news-factory",
      next: gitConnected ? "" : "Проверить source connection в Railway"
    },
    telegramBot: {
      state: botProbe.ok ? "connected" : (BOT_TOKEN ? "partial" : "missing"),
      description: botProbe.ok ? "Бот отвечает через Telegram API" : "Бот не подтверждён API",
      detail: botProbe.ok && botProbe.result ? "@" + (botProbe.result.username || "bot") : String(botProbe.error || ""),
      next: botProbe.ok ? "" : "Проверить TELEGRAM_BOT_TOKEN"
    },
    telegramChannel: {
      state: chatProbe.ok ? "connected" : (CHANNEL ? "partial" : "missing"),
      description: chatProbe.ok ? "Канал доступен боту" : "Доступ к каналу не подтверждён",
      detail: chatProbe.ok && chatProbe.result ? ((chatProbe.result.title || CHANNEL) + " · " + CHANNEL) : String(chatProbe.error || CHANNEL || ""),
      next: chatProbe.ok ? "" : "Проверить права бота и TELEGRAM_CHANNEL"
    },
    storage: {
      state: storageOk ? "connected" : "missing",
      description: storageOk ? "Постоянное хранилище подключено" : "Хранилище недоступно",
      detail: storageDetail,
      next: storageOk ? "" : "Проверить Railway volume /data"
    },
    adminUi: {
      state: ADMIN_UI_PASSWORD ? "connected" : "missing",
      description: ADMIN_UI_PASSWORD ? "Приватная админка защищена входом" : "Пароль админки не задан",
      detail: ADMIN_UI_PASSWORD ? "Сессия HttpOnly + Secure" : "",
      next: ADMIN_UI_PASSWORD ? "" : "Добавить ADMIN_UI_PASSWORD"
    },
    openai: {
      state: openaiProbe.ok ? "connected" : (OPENAI_API_KEY ? "partial" : "missing"),
      description: openaiProbe.ok ? "OpenAI API подключён и модель доступна" : (OPENAI_API_KEY ? "Ключ найден, но API не подтверждён" : "AI rewrite пока не подключён"),
      detail: openaiProbe.ok ? "Модель: " + openaiProbe.model : String(openaiProbe.error || "OPENAI_API_KEY отсутствует"),
      next: openaiProbe.ok ? "" : (OPENAI_API_KEY ? "Проверить ключ, доступ к модели и биллинг OpenAI" : "Подключить OpenAI API для переписывания новостей")
    },
    mediaEngine: {
      state: OPENAI_API_KEY && MEDIA_REQUIRED && GENERATE_COVER_IF_MISSING ? "connected" : (OPENAI_API_KEY ? "partial" : "missing"),
      description: OPENAI_API_KEY && MEDIA_REQUIRED && GENERATE_COVER_IF_MISSING ? "Медиа-движок включён" : "Медиа-движок настроен не полностью",
      detail: "Фото/видео обязательно · если медиа нет, обложка генерируется через " + OPENAI_IMAGE_MODEL,
      next: OPENAI_API_KEY && MEDIA_REQUIRED && GENERATE_COVER_IF_MISSING ? "" : "Проверить MEDIA_REQUIRED и GENERATE_COVER_IF_MISSING"
    },
    supabase: {
      state: dbReady ? "connected" : (DATABASE_URL ? "partial" : "missing"),
      description: dbReady ? "PostgreSQL подключён и доступен" : (DATABASE_URL ? "DATABASE_URL задан, база ещё не подтверждена" : "База данных не подключена"),
      detail: dbReady ? "Долговременное хранение news_items, collector_runs и snapshots" : (DATABASE_URL ? "Ожидание подключения PostgreSQL" : "Используется только /data/state.json"),
      next: dbReady ? "" : "Проверить PostgreSQL в Railway"
    },
    vk: {
      state: hasEnv("VK_ACCESS_TOKEN") && hasEnv("VK_OWNER_ID") ? "connected" : "missing",
      description: hasEnv("VK_ACCESS_TOKEN") ? "VK частично настроен" : "Автопубликация VK ещё не подключена",
      detail: hasEnv("VK_OWNER_ID") ? "Owner ID найден" : "",
      next: hasEnv("VK_ACCESS_TOKEN") && hasEnv("VK_OWNER_ID") ? "" : "Подключить VK API"
    },
    collector: {
      state: COLLECTOR_ENABLED ? "connected" : "missing",
      description: COLLECTOR_ENABLED ? "News Collector включён" : "News Collector выключен",
      detail: String((state.sources || []).filter(function(x){ return x.enabled; }).length) + " активных источников · ротация всех источников · до " + MAX_ITEMS_PER_RUN + " новостей за запуск",
      next: COLLECTOR_ENABLED ? "" : "Включить COLLECTOR_ENABLED"
    },
    scheduler: {
      state: collectorTimer ? "connected" : (COLLECTOR_ENABLED ? "partial" : "missing"),
      description: collectorTimer ? "24/7 scheduler запущен" : "Scheduler ещё не стартовал",
      detail: collectorTimer
        ? ("Проверка каждые " + POLL_INTERVAL_MINUTES + " минут · автопубликация " + (AUTO_PUBLISH_ENABLED ? "включена" : "выключена"))
        : "Режим: " + state.mode,
      next: collectorTimer ? "" : "Перезапустить сервис после включения collector"
    }
  };

  const values = Object.values(details);
  const summary = {
    connected: values.filter(function(x){ return x.state === "connected"; }).length,
    partial: values.filter(function(x){ return x.state === "partial"; }).length,
    missing: values.filter(function(x){ return x.state === "missing"; }).length,
    total: values.length
  };

  const result = {
    ok: true,
    checkedAt: new Date().toISOString(),
    environment: process.env.RAILWAY_ENVIRONMENT_NAME || "production",
    service: "news-factory-api",
    version: APP_VERSION,
    mode: state.mode,
    summary: summary,
    details: details
  };
  statusCache = { at: now, value: result };
  return result;
}

const server = http.createServer(async function(req, res) {
  try {
    const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
    const p = url.pathname;

    if (req.method === "GET" && p === "/health") {
      return sendJson(res, 200, {
        ok: true,
        service: "news-factory",
        telegramConfigured: Boolean(BOT_TOKEN && CHANNEL),
        uiConfigured: Boolean(ADMIN_UI_PASSWORD),
        openaiConfigured: Boolean(OPENAI_API_KEY),
        openaiModel: OPENAI_MODEL,
        mediaRequired: MEDIA_REQUIRED,
        imageModel: OPENAI_IMAGE_MODEL,
        version: APP_VERSION
      });
    }

    if (req.method === "GET" && p.startsWith("/media/")) {
      const fileName = decodeURIComponent(p.slice("/media/".length));
      if (!fileName || fileName !== path.basename(fileName)) return sendJson(res, 400, { ok: false, error: "invalid media path" });
      const filePath = path.join(MEDIA_DIR, fileName);
      try {
        const body = fs.readFileSync(filePath);
        const ext = path.extname(fileName).toLowerCase();
        const type = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "application/octet-stream";
        res.writeHead(200, { "content-type": type, "cache-control": "public, max-age=31536000, immutable" });
        return res.end(body);
      } catch {
        return sendJson(res, 404, { ok: false, error: "media not found" });
      }
    }

    if (req.method === "GET" && p === "/") return redirect(res, "/admin");
    if (req.method === "GET" && p === "/login") {
      if (isAuthed(req)) return redirect(res, "/admin");
      return sendHtmlFile(res, "login.html");
    }
    if (req.method === "GET" && p === "/admin") {
      if (!isAuthed(req)) return redirect(res, "/login");
      return sendHtmlFile(res, "admin.html");
    }

    if (req.method === "POST" && p === "/api/login") {
      const body = await readJson(req);
      const providedPassword = String(body.password || "");
      const providedHash = crypto.createHash("sha256").update(providedPassword).digest("hex");
      const hashConfigured = /^[a-f0-9]{64}$/.test(ADMIN_UI_PASSWORD_SHA256);
      const hashMatches = hashConfigured &&
        crypto.timingSafeEqual(Buffer.from(providedHash, "hex"), Buffer.from(ADMIN_UI_PASSWORD_SHA256, "hex"));
      const plainMatches = !hashConfigured && Boolean(ADMIN_UI_PASSWORD) && providedPassword === ADMIN_UI_PASSWORD;
      if (!hashMatches && !plainMatches) {
        return sendJson(res, 401, { ok: false, error: "invalid password" });
      }
      return sendJson(res, 200, { ok: true }, {
        "set-cookie": "nf_session=" + sessionToken() + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000"
      });
    }

    if (req.method === "POST" && p === "/api/logout") {
      return sendJson(res, 200, { ok: true }, {
        "set-cookie": "nf_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
      });
    }

    if (p.startsWith("/api/") && !requireAuth(req, res)) return;

    if (req.method === "GET" && p === "/api/dashboard") {
      const cleanup = pruneQueueItems(state);
      if (cleanup.removed) saveState();
      return sendJson(res, 200, { ok: true, state: state });
    }

    if (req.method === "POST" && p === "/api/calendar/assign") {
      const body = await readJson(req);
      const day = String(body.date || "");
      const time = String(body.time || "");
      const queueId = String(body.queueId || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return sendJson(res, 400, { ok: false, error: "Некорректная дата" });
      const schedule = ensureScheduleShape(state);
      if (!(schedule.slots || []).some(function(slot){ return slot.time === time; })) {
        return sendJson(res, 400, { ok: false, error: "Некорректное время" });
      }
      const item = (state.queue || []).find(function(x){ return x.id === queueId; });
      if (!item) return sendJson(res, 404, { ok: false, error: "Новость не найдена в очереди" });

      Object.keys(schedule.assignments).forEach(function(d) {
        Object.keys(schedule.assignments[d] || {}).forEach(function(t) {
          if (schedule.assignments[d][t] === queueId) delete schedule.assignments[d][t];
        });
      });

      if (!schedule.assignments[day]) schedule.assignments[day] = {};
      if (!schedule.suppressed[day]) schedule.suppressed[day] = {};
      schedule.assignments[day][time] = queueId;
      delete schedule.suppressed[day][time];
      saveState();
      return sendJson(res, 200, { ok: true, assignment: { date: day, time: time, queueId: queueId } });
    }

    if (req.method === "POST" && p === "/api/calendar/remove") {
      const body = await readJson(req);
      const day = String(body.date || "");
      const time = String(body.time || "");
      const schedule = ensureScheduleShape(state);
      if (schedule.assignments[day]) delete schedule.assignments[day][time];
      if (!schedule.suppressed[day]) schedule.suppressed[day] = {};
      schedule.suppressed[day][time] = true;
      saveState();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && p === "/api/calendar/auto") {
      const body = await readJson(req);
      const day = String(body.date || moscowDateKey(new Date()));
      const time = String(body.time || "");
      const schedule = ensureScheduleShape(state);
      if (!schedule.suppressed[day]) schedule.suppressed[day] = {};
      delete schedule.suppressed[day][time];
      if (schedule.assignments[day]) delete schedule.assignments[day][time];
      ensureScheduleAssignments(state, day);
      saveState();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && p === "/api/analytics") {
      const force = url.searchParams.get("refresh") === "1";
      const analytics = await buildPlatformAnalytics(force);
      return sendJson(res, 200, analytics);
    }

    if (req.method === "GET" && p === "/api/status") {
      const force = url.searchParams.get("refresh") === "1";
      const status = await buildSystemStatus(force);
      return sendJson(res, 200, status);
    }

    if (req.method === "GET" && p === "/api/news") {
      const items = await listNewsItems(url.searchParams.get("limit") || 50);
      return sendJson(res, 200, { ok: true, items: items });
    }

    if (req.method === "GET" && p === "/api/collector/status") {
      const runs = await getCollectorRuns(10);
      return sendJson(res, 200, {
        ok: true,
        enabled: COLLECTOR_ENABLED,
        running: collectorRunning,
        intervalMinutes: POLL_INTERVAL_MINUTES,
        maxItemsPerRun: MAX_ITEMS_PER_RUN,
        queueMaxAgeHours: QUEUE_MAX_AGE_HOURS,
        articleMaxAgeHours: ARTICLE_MAX_AGE_HOURS,
        queueMaxAutoItems: QUEUE_MAX_AUTO_ITEMS,
        autoPublishEnabled: AUTO_PUBLISH_ENABLED,
        autoPublishMinIntervalMinutes: AUTO_PUBLISH_MIN_INTERVAL_MINUTES,
        mediaRequired: MEDIA_REQUIRED,
        generateCoverIfMissing: GENERATE_COVER_IF_MISSING,
        imageModel: OPENAI_IMAGE_MODEL,
        dbReady: dbReady,
        lastRun: lastCollectorRun,
        runs: runs
      });
    }

    if (req.method === "POST" && p === "/api/collector/run") {
      const result = await collectOnce("manual");
      return sendJson(res, result.ok === false ? 409 : 200, result);
    }

    if (req.method === "POST" && p === "/api/ai/test") {
      const probe = await openAIModelProbe();
      if (!probe.ok) return sendJson(res, 502, { ok: false, error: probe.error });
      return sendJson(res, 200, { ok: true, model: probe.model });
    }

    if (req.method === "POST" && p === "/api/ai/rewrite") {
      const body = await readJson(req);
      const result = await callOpenAIRewrite(body);
      state.stats.rewritten += 1;
      saveState();
      return sendJson(res, 200, { ok: true, result: result });
    }

    if (req.method === "POST" && p === "/api/mode") {
      const body = await readJson(req);
      const mode = String(body.mode || "");
      if (!["AUTO", "REVIEW", "PAUSED"].includes(mode)) {
        return sendJson(res, 400, { ok: false, error: "invalid mode" });
      }
      state.mode = mode;
      saveState();
      return sendJson(res, 200, { ok: true, mode: mode });
    }

    if (req.method === "POST" && p === "/api/test") {
      const marker = crypto.randomBytes(3).toString("hex");
      const result = await sendTelegram("✅ News Factory подключён\n\nАвтопубликация в AI Pulse работает.\nТест: " + marker);
      state.history.unshift({ id: newId("hist"), title: "Тест News Factory", messageId: result.message_id, publishedAt: new Date().toISOString() });
      state.history = state.history.slice(0, 100);
      state.stats.published += 1;
      saveState();
      return sendJson(res, 200, { ok: true, messageId: result.message_id });
    }

    if (req.method === "POST" && p === "/api/publish") {
      const body = await readJson(req);
      const text = String(body.text || "").trim();
      if (!text) return sendJson(res, 400, { ok: false, error: "Введите текст" });
      const media = await ensureMediaForNews({
        id: newId("manual"),
        title: String(body.title || "AI Pulse").trim(),
        text: text,
        sourceName: "Ручная публикация",
        imageUrl: String(body.imageUrl || "").trim(),
        videoUrl: String(body.videoUrl || "").trim()
      });
      if (MEDIA_REQUIRED && !(media.imageUrl || media.generatedImageUrl || media.videoUrl)) {
        return sendJson(res, 422, { ok: false, error: "Не удалось подготовить фото или видео для публикации" });
      }
      const result = await sendTelegramPost({
        title: String(body.title || "").trim(),
        text: text,
        sourceUrl: String(body.sourceUrl || "").trim(),
        imageUrl: media.imageUrl,
        generatedImageUrl: media.generatedImageUrl,
        videoUrl: media.videoUrl
      });
      state.history.unshift({
        id: newId("hist"),
        title: String(body.title || "Публикация"),
        text: text,
        messageId: result.message_id,
        publishedAt: new Date().toISOString()
      });
      state.history = state.history.slice(0, 100);
      state.stats.published += 1;
      saveState();
      return sendJson(res, 200, { ok: true, messageId: result.message_id });
    }

    if (req.method === "POST" && p === "/api/sources") {
      const body = await readJson(req);
      const name = String(body.name || "").trim();
      const sourceUrl = String(body.url || "").trim();
      if (!name || !sourceUrl) return sendJson(res, 400, { ok: false, error: "Заполните название и ссылку" });
      state.sources.push({ id: newId("src"), name: name, type: "web", url: sourceUrl, enabled: true });
      saveState();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && p === "/api/sources/toggle") {
      const body = await readJson(req);
      const src = state.sources.find(function(x){ return x.id === body.id; });
      if (!src) return sendJson(res, 404, { ok: false, error: "Источник не найден" });
      src.enabled = !src.enabled;
      saveState();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && p === "/api/sources/remove") {
      const body = await readJson(req);
      state.sources = state.sources.filter(function(x){ return x.id !== body.id; });
      saveState();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && p === "/api/queue") {
      const body = await readJson(req);
      const text = String(body.text || "").trim();
      if (!text) return sendJson(res, 400, { ok: false, error: "Нужен текст" });
      state.queue.unshift({
        id: newId("q"),
        title: String(body.title || "Черновик"),
        text: text,
        createdAt: new Date().toISOString(),
        sourceUrl: String(body.sourceUrl || "").trim(),
        imageUrl: String(body.imageUrl || "").trim(),
        generatedImageUrl: String(body.generatedImageUrl || "").trim(),
        videoUrl: String(body.videoUrl || "").trim(),
        mediaType: String(body.mediaType || ""),
        mediaStatus: String(body.mediaStatus || "")
      });
      saveState();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && p === "/api/queue/remove") {
      const body = await readJson(req);
      state.queue = state.queue.filter(function(x){ return x.id !== body.id; });
      removeQueueIdFromSchedule(state, body.id);
      ensureScheduleAssignments(state);
      saveState();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && p === "/api/queue/publish") {
      const body = await readJson(req);
      const item = state.queue.find(function(x){ return x.id === body.id; });
      if (!item) return sendJson(res, 404, { ok: false, error: "Черновик не найден" });
      let media = {
        imageUrl: item.imageUrl || "",
        generatedImageUrl: item.generatedImageUrl || "",
        videoUrl: item.videoUrl || "",
        mediaType: item.mediaType || "",
        mediaStatus: item.mediaStatus || ""
      };
      if (!(media.imageUrl || media.generatedImageUrl || media.videoUrl)) {
        media = await ensureMediaForNews({
          id: item.newsId || item.id,
          title: item.title,
          text: item.text,
          sourceName: item.sourceName || "Очередь",
          imageUrl: "",
          videoUrl: ""
        });
        item.imageUrl = media.imageUrl || "";
        item.generatedImageUrl = media.generatedImageUrl || "";
        item.videoUrl = media.videoUrl || "";
        item.mediaType = media.mediaType;
        item.mediaStatus = media.mediaStatus;
        saveState();
      }
      if (MEDIA_REQUIRED && !(media.imageUrl || media.generatedImageUrl || media.videoUrl)) {
        return sendJson(res, 422, { ok: false, error: "Не удалось подготовить фото или видео. Публикация заблокирована." });
      }
      const result = await sendTelegramPost({
        title: item.title,
        text: item.text,
        sourceUrl: item.sourceUrl || "",
        imageUrl: media.imageUrl,
        generatedImageUrl: media.generatedImageUrl,
        videoUrl: media.videoUrl
      });
      state.queue = state.queue.filter(function(x){ return x.id !== body.id; });
      removeQueueIdFromSchedule(state, body.id);
      ensureScheduleAssignments(state);
      state.history.unshift({
        id: newId("hist"),
        title: item.title,
        text: item.text,
        messageId: result.message_id,
        publishedAt: new Date().toISOString()
      });
      state.history = state.history.slice(0, 100);
      state.stats.published += 1;
      saveState();
      return sendJson(res, 200, { ok: true, messageId: result.message_id });
    }

    if (req.method === "POST" && p === "/publish") {
      if (req.headers["x-admin-key"] !== ADMIN_KEY) return sendJson(res, 401, { ok: false, error: "unauthorized" });
      const body = await readJson(req);
      const text = String(body.text || "").trim();
      if (!text) return sendJson(res, 400, { ok: false, error: "text is required" });
      const media = await ensureMediaForNews({
        id: newId("legacy"),
        title: String(body.title || "AI Pulse").trim(),
        text: text,
        sourceName: "API публикация",
        imageUrl: String(body.imageUrl || "").trim(),
        videoUrl: String(body.videoUrl || "").trim()
      });
      if (MEDIA_REQUIRED && !(media.imageUrl || media.generatedImageUrl || media.videoUrl)) {
        return sendJson(res, 422, { ok: false, error: "Не удалось подготовить медиа" });
      }
      const result = await sendTelegramPost({
        title: String(body.title || "").trim(),
        text: text,
        sourceUrl: String(body.sourceUrl || "").trim(),
        imageUrl: media.imageUrl,
        generatedImageUrl: media.generatedImageUrl,
        videoUrl: media.videoUrl
      });
      return sendJson(res, 200, { ok: true, messageId: result.message_id });
    }

    return sendJson(res, 404, { ok: false, error: "not found" });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: error.message });
  }
});

await initDb();
const startupCleanup = pruneQueueItems(state);
if (startupCleanup.removed) saveState();
startCollectorScheduler();

server.listen(PORT, "0.0.0.0", function() {
  console.log("News Factory listening on :" + PORT);
});
