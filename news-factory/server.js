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
const IMAGE_ENHANCEMENT_ENABLED = String(process.env.IMAGE_ENHANCEMENT_ENABLED || "true").toLowerCase() !== "false";
const AUTO_ENHANCE_SOURCE_IMAGES = String(process.env.AUTO_ENHANCE_SOURCE_IMAGES || "true").toLowerCase() !== "false";
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-sunburst";
const OPENAI_IMAGE_QUALITY = process.env.OPENAI_IMAGE_QUALITY || "low";
const PUBLIC_BASE_URL = (process.env.NEWS_FACTORY_PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN : "https://news-factory-api-production.up.railway.app")).replace(/\/$/, "");
const VK_ACCESS_TOKEN = String(process.env.VK_ACCESS_TOKEN || process.env.VK_TOKEN || "").trim();
const VK_GROUP_ID = Math.abs(Number(process.env.VK_GROUP_ID || 0)) || 0;
const VK_OWNER_ID = Number(process.env.VK_OWNER_ID || (VK_GROUP_ID ? -VK_GROUP_ID : 0)) || 0;
const VK_SCREEN_NAME = String(process.env.VK_SCREEN_NAME || "chtotamai").trim();
const VK_PUBLIC_URL = String(process.env.VK_PUBLIC_URL || (VK_SCREEN_NAME ? "https://vk.ru/" + VK_SCREEN_NAME : "")).trim();
const VK_API_VERSION = String(process.env.VK_API_VERSION || "5.199").trim();
const VK_PUBLISH_ENABLED = String(process.env.VK_PUBLISH_ENABLED || "false").toLowerCase() === "true";
const COLLECTOR_ENABLED = String(process.env.COLLECTOR_ENABLED || "true").toLowerCase() !== "false";
const AUTO_PUBLISH_ENABLED = String(process.env.AUTO_PUBLISH_ENABLED || "false").toLowerCase() === "true";
const AUTO_PUBLISH_MIN_INTERVAL_MINUTES = Math.max(10, Number(process.env.AUTO_PUBLISH_MIN_INTERVAL_MINUTES || 30));
const POLL_INTERVAL_MINUTES = Math.max(5, Number(process.env.POLL_INTERVAL_MINUTES || 15));
const DYNAMIC_SLOT_START_HOUR = 8;
const DYNAMIC_SLOT_END_HOUR = 23;
const DYNAMIC_SLOT_PREP_MINUTE = 45;
const DYNAMIC_SLOT_MAX_AGE_HOURS = 4;
const DYNAMIC_DAILY_TARGET = 10;
const DYNAMIC_DAILY_MAX = 12;
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
    targetPerDay: DYNAMIC_DAILY_TARGET,
    maxPerDay: DYNAMIC_DAILY_MAX,
    minIntervalMinutes: 60,
    strategy: "dynamic-hourly",
    prepareMinutesBefore: 15,
    assignments: {},
    suppressed: {},
    slots: Array.from({ length: DYNAMIC_SLOT_END_HOUR - DYNAMIC_SLOT_START_HOUR + 1 }, function(_, i) {
      const hour = DYNAMIC_SLOT_START_HOUR + i;
      return { time: String(hour).padStart(2, "0") + ":00", kind: "dynamic", label: "Динамическое окно" };
    })
  },
  dynamicScheduler: {
    strategy: "dynamic-hourly",
    prepareMinutesBefore: 15,
    lastPreparedAt: "",
    lastPublishedAt: "",
    lastPublishedSlot: "",
    lastTickKey: ""
  },
  queue: [],
  newsVisibleAfter: "",
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
  // Dynamic scheduler never fills the whole day in advance.
  // A slot is assigned only shortly before publication.
  ensureScheduleShape(targetState);
  cleanupScheduleAssignments(targetState);
  return 0;
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

    const clearOldNewsMigrationId = "v0.14.1-clear-old-news";
    if (!loaded.migrations.includes(clearOldNewsMigrationId)) {
      loaded.newsVisibleAfter = new Date().toISOString();
      loaded.queue = [];
      ensureScheduleShape(loaded);
      loaded.publicationSchedule.assignments = {};
      loaded.publicationSchedule.suppressed = {};
      loaded.migrations.push(clearOldNewsMigrationId);
    }

    const scheduleMigrationId = "v0.9.0-publication-calendar";
    if (!loaded.migrations.includes(scheduleMigrationId)) {
      loaded.publicationSchedule = structuredClone(defaultState.publicationSchedule);
      loaded.migrations.push(scheduleMigrationId);
    } else if (!loaded.publicationSchedule) {
      loaded.publicationSchedule = structuredClone(defaultState.publicationSchedule);
    }

    const dynamicMigrationId = "v0.19.0-dynamic-hourly-source";
    if (!loaded.migrations.includes(dynamicMigrationId)) {
      // Remove only automatic items prepared by the old all-day calendar.
      // Manual drafts are preserved.
      loaded.queue = (loaded.queue || []).filter(function(item){ return item && !item.newsId; });
      loaded.publicationSchedule = structuredClone(defaultState.publicationSchedule);
      loaded.dynamicScheduler = structuredClone(defaultState.dynamicScheduler);
      loaded.migrations.push(dynamicMigrationId);
    } else {
      loaded.publicationSchedule = Object.assign(
        structuredClone(defaultState.publicationSchedule),
        loaded.publicationSchedule || {}
      );
      loaded.publicationSchedule.strategy = "dynamic-hourly";
      loaded.publicationSchedule.prepareMinutesBefore = 15;
      loaded.publicationSchedule.targetPerDay = DYNAMIC_DAILY_TARGET;
      loaded.publicationSchedule.maxPerDay = DYNAMIC_DAILY_MAX;
      loaded.publicationSchedule.slots = structuredClone(defaultState.publicationSchedule.slots);
      loaded.dynamicScheduler = Object.assign(
        structuredClone(defaultState.dynamicScheduler),
        loaded.dynamicScheduler || {}
      );
    }

    pruneQueueItems(loaded);

    fs.writeFileSync(STATE_FILE, JSON.stringify(loaded, null, 2), "utf8");
    return loaded;
  } catch {
    const fresh = structuredClone(defaultState);
    fresh.migrations.push("v0.3.2-restore-openai-source");
    fresh.migrations.push("v0.8.0-curated-sources-20");
    fresh.migrations.push("v0.9.0-publication-calendar");
    fresh.migrations.push("v0.10.0-freshness-engine");
    fresh.migrations.push("v0.11.0-dashboard-calendar-actions");
    fresh.migrations.push("v0.14.1-clear-old-news");
    fresh.migrations.push("v0.19.0-dynamic-hourly-source");
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
    "Create a premium editorial technology news image for the Telegram channel «Что там у ИИ?».",
    "Topic: " + String(payload.title || "AI technology news"),
    "Context: " + String(payload.text || "").slice(0, 1800),
    "Visual direction: premium modern AI-news editorial, cinematic but realistic, strong central subject, clean composition, deep contrast, sophisticated electric-blue/cyan accents, subtle depth and atmosphere, visually striking enough to stop a scroll without looking like cheap sci-fi.",
    "No text, no captions, no watermarks, no fake UI, no invented logos, no random letters.",
    "If a real company/product is mentioned, do not invent a different product design or fabricated branding.",
    "Landscape 3:2 composition suitable for Telegram and VK. Keep important faces/products inside a safe central area for mobile crops."
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

async function enhanceNewsImage(payload) {
  if (!OPENAI_API_KEY || !IMAGE_ENHANCEMENT_ENABLED) {
    throw new Error("AI-улучшение изображений отключено");
  }

  const imageUrl = String(payload.imageUrl || "").trim();
  if (!/^https?:\/\//i.test(imageUrl)) throw new Error("Нет исходного изображения для улучшения");

  const sourceResponse = await fetch(imageUrl, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; NewsFactoryMedia/1.0)" },
    redirect: "follow",
    signal: AbortSignal.timeout(30000)
  });
  if (!sourceResponse.ok) throw new Error("Не удалось скачать исходное фото: HTTP " + sourceResponse.status);

  const contentType = String(sourceResponse.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!contentType.startsWith("image/")) throw new Error("Исходный файл не является изображением");

  const bytes = Buffer.from(await sourceResponse.arrayBuffer());
  if (!bytes.length) throw new Error("Исходное изображение пустое");
  if (bytes.length > 12 * 1024 * 1024) throw new Error("Исходное изображение слишком большое для AI-улучшения");

  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : contentType.includes("gif") ? "gif" : "jpg";
  const prompt = [
    "Transform this source photo into a premium, scroll-stopping editorial image for the AI-news brand «Что там у ИИ?».",
    "ABSOLUTE FACT LOCK: preserve every real person, face, body, product, logo, screen, document, object and factual scene identity. No substitutions and no invented details.",
    "Do not add text, captions, numbers, fake UI, logos, watermarks, people or products that were not in the source.",
    "Make the presentation noticeably stronger: professional editorial crop, cleaner composition, better sharpness, natural skin tones, controlled highlights, deeper contrast, richer but realistic color, subtle cinematic depth.",
    "Add only restrained non-factual visual treatment such as soft electric-blue/cyan light shaping, gentle background separation, vignette or atmospheric glow where it does not change the factual scene.",
    "The result should feel like a high-end technology magazine cover image, not a filter and not fantasy sci-fi.",
    "Keep it realistic, credible and mobile-readable. Landscape 3:2.",
    "Topic context: " + String(payload.title || "").slice(0, 500)
  ].join("\n");

  const models = [OPENAI_IMAGE_MODEL, "gpt-image-2"].filter(function(v, i, a){ return v && a.indexOf(v) === i; });
  let lastError = "";

  for (const model of models) {
    try {
      const form = new FormData();
      form.append("model", model);
      form.append("image[]", new Blob([bytes], { type: contentType }), "source." + ext);
      form.append("prompt", prompt);
      form.append("size", "1536x1024");
      form.append("quality", OPENAI_IMAGE_QUALITY);

      const response = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { authorization: "Bearer " + OPENAI_API_KEY },
        body: form,
        signal: AbortSignal.timeout(120000)
      });
      const data = await response.json().catch(function(){ return {}; });
      if (!response.ok) {
        lastError = (data && data.error && data.error.message) || ("OpenAI image edit HTTP " + response.status);
        continue;
      }
      const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
      if (!b64) {
        lastError = "OpenAI image edit не вернул изображение";
        continue;
      }

      ensureDataDir();
      const safeId = String(payload.id || crypto.randomBytes(8).toString("hex")).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
      const fileName = "enhanced_" + safeId + "_" + Date.now() + ".png";
      fs.writeFileSync(path.join(MEDIA_DIR, fileName), Buffer.from(b64, "base64"));
      return { url: mediaPublicUrl(fileName), model: model, fileName: fileName };
    } catch (error) {
      lastError = String(error && error.message || error);
    }
  }

  throw new Error(lastError || "Не удалось улучшить изображение");
}

async function ensureMediaForNews(payload) {
  const imageUrl = String(payload.imageUrl || "").trim();
  const videoUrl = String(payload.videoUrl || "").trim();

  // Priority #1: video. Keep a found photo as fallback in case Telegram cannot fetch/send the video.
  if (videoUrl) {
    return {
      videoUrl: videoUrl,
      imageUrl: imageUrl,
      originalImageUrl: imageUrl,
      generatedImageUrl: "",
      mediaType: "video",
      mediaStatus: "video_found",
      mediaPriority: 1
    };
  }

  // Priority #2: source photo. By default we automatically create a stronger editorial version.
  if (imageUrl) {
    if (IMAGE_ENHANCEMENT_ENABLED && AUTO_ENHANCE_SOURCE_IMAGES) {
      try {
        const enhanced = await enhanceNewsImage({
          id: payload.id || newId("enhance"),
          title: payload.title || "",
          imageUrl: imageUrl
        });
        return {
          videoUrl: "",
          imageUrl: imageUrl,
          originalImageUrl: imageUrl,
          generatedImageUrl: enhanced.url,
          mediaType: "photo",
          mediaStatus: "enhanced",
          mediaPriority: 2,
          canEnhance: true,
          enhancedBy: enhanced.model,
          enhancedAt: new Date().toISOString()
        };
      } catch (error) {
        console.warn("Auto image enhancement failed, using source photo:", error.message);
      }
    }
    return {
      videoUrl: "",
      imageUrl: imageUrl,
      originalImageUrl: imageUrl,
      generatedImageUrl: "",
      mediaType: "photo",
      mediaStatus: "photo_found",
      mediaPriority: 2,
      canEnhance: IMAGE_ENHANCEMENT_ENABLED
    };
  }

  // Priority #3: generate a photo only when neither video nor photo was found.
  if (GENERATE_COVER_IF_MISSING) {
    try {
      const generated = await generateNewsCover(payload);
      return {
        videoUrl: "",
        imageUrl: "",
        originalImageUrl: "",
        generatedImageUrl: generated.url,
        mediaType: "generated",
        mediaStatus: "generated",
        mediaPriority: 3,
        generatedBy: generated.model
      };
    } catch (error) {
      return {
        videoUrl: "",
        imageUrl: "",
        originalImageUrl: "",
        generatedImageUrl: "",
        mediaType: "none",
        mediaStatus: "generation_error",
        mediaPriority: 99,
        mediaError: error.message
      };
    }
  }

  return { videoUrl: "", imageUrl: "", originalImageUrl: "", generatedImageUrl: "", mediaType: "none", mediaStatus: "missing", mediaPriority: 99 };
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
    const cutoff = normalizeDate(state.newsVisibleAfter || "");
    const r = cutoff
      ? await db.query(
          `SELECT id, source_id AS "sourceId", source_name AS "sourceName", source_url AS "sourceUrl",
          original_url AS "originalUrl", original_title AS "originalTitle", detected_at AS "detectedAt",
          rewritten_title AS "rewrittenTitle", rewritten_text AS "rewrittenText", confidence, status,
          telegram_message_id AS "telegramMessageId", published_at AS "publishedAt", metadata
          FROM news_items WHERE detected_at >= $1 ORDER BY detected_at DESC LIMIT $2`,
          [cutoff, safeLimit]
        )
      : await db.query(
          `SELECT id, source_id AS "sourceId", source_name AS "sourceName", source_url AS "sourceUrl",
          original_url AS "originalUrl", original_title AS "originalTitle", detected_at AS "detectedAt",
          rewritten_title AS "rewrittenTitle", rewritten_text AS "rewrittenText", confidence, status,
          telegram_message_id AS "telegramMessageId", published_at AS "publishedAt", metadata
          FROM news_items ORDER BY detected_at DESC LIMIT $1`,
          [safeLimit]
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
            originalImageUrl: media.originalImageUrl || media.imageUrl || "",
            videoUrl: media.videoUrl || "",
            generatedImageUrl: media.generatedImageUrl || "",
            mediaType: media.mediaType,
            mediaStatus: media.mediaStatus,
            mediaPriority: media.mediaPriority || 99,
            canEnhance: Boolean(media.canEnhance),
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
          trigger === "legacy-auto" &&
          state.mode === "AUTO" &&
          AUTO_PUBLISH_ENABLED &&
          enoughTimePassed &&
          summary.published < 1;

        if (canAutoPublish) {
          const tg = await sendMultiPlatformPost({
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
            vkPostId: tg.vkPostId || null,
            publishedAt: baseItem.publishedAt,
            sourceUrl: url,
            imageUrl: media.imageUrl || "",
            originalImageUrl: media.originalImageUrl || media.imageUrl || "",
            generatedImageUrl: media.generatedImageUrl || "",
            videoUrl: media.videoUrl || "",
            mediaType: media.mediaType,
            mediaStatus: media.mediaStatus,
            mediaPriority: media.mediaPriority || 99
          });
          state.history = state.history.slice(0, 300);
          state.stats.published += 1;
          summary.published += 1;
        } else {
          baseItem.status = "queued";
          baseItem.metadata.autoPublishBlocked = state.mode === "AUTO" ? (
            !AUTO_PUBLISH_ENABLED ? "disabled" :
            trigger !== "legacy-auto" ? "slot_scheduler" :
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
            originalImageUrl: media.originalImageUrl || media.imageUrl || "",
            generatedImageUrl: media.generatedImageUrl || "",
            videoUrl: media.videoUrl || "",
            mediaType: media.mediaType,
            mediaStatus: media.mediaStatus,
            mediaPriority: media.mediaPriority || 99,
            canEnhance: Boolean(media.canEnhance),
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

function dynamicDailyPublishedCount(dayKey) {
  return (state.history || []).filter(function(item) {
    return item && item.publishedAt && moscowDateKey(new Date(item.publishedAt)) === dayKey;
  }).length;
}

function dynamicItemAgeMs(item) {
  const stamp = item && item.articlePublishedAt;
  if (!stamp) return Number.MAX_SAFE_INTEGER;
  const ms = new Date(stamp).getTime();
  if (!Number.isFinite(ms)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Date.now() - ms);
}

function dynamicItemScore(item) {
  const ageMinutes = dynamicItemAgeMs(item) / 60000;
  let score = Math.max(0, 100 - ageMinutes * 0.45);
  const source = (state.sources || []).find(function(src){ return src && src.name === item.sourceName; });
  if (source && Number(source.priority) === 1) score += 18;
  if (item.videoUrl) score += 8;
  else if (item.generatedImageUrl || item.imageUrl) score += 4;
  return score;
}

function dynamicUsedQueueIds() {
  const used = new Set();
  const schedule = ensureScheduleShape(state);
  Object.keys(schedule.assignments || {}).forEach(function(day) {
    Object.values(schedule.assignments[day] || {}).forEach(function(id) {
      if (id) used.add(id);
    });
  });
  return used;
}

function dynamicBestQueueItem() {
  const used = dynamicUsedQueueIds();
  const maxAge = DYNAMIC_SLOT_MAX_AGE_HOURS * 60 * 60 * 1000;
  return (state.queue || [])
    .filter(function(item) {
      return item && item.id && item.newsId && item.articlePublishedAt &&
        !used.has(item.id) && dynamicItemAgeMs(item) <= maxAge;
    })
    .sort(function(a, b) {
      const scoreDiff = dynamicItemScore(b) - dynamicItemScore(a);
      if (scoreDiff) return scoreDiff;
      return new Date(b.articlePublishedAt || 0).getTime() - new Date(a.articlePublishedAt || 0).getTime();
    })[0] || null;
}

function dynamicAssignBest(day, time) {
  const item = dynamicBestQueueItem();
  const schedule = ensureScheduleShape(state);
  if (!schedule.assignments[day]) schedule.assignments[day] = {};
  if (!schedule.suppressed[day]) schedule.suppressed[day] = {};
  if (!item) {
    delete schedule.assignments[day][time];
    saveState();
    return null;
  }
  schedule.assignments[day][time] = item.id;
  delete schedule.suppressed[day][time];
  item.preparedFor = day + " " + time;
  item.preparedAt = new Date().toISOString();
  state.dynamicScheduler = state.dynamicScheduler || {};
  state.dynamicScheduler.lastPreparedAt = item.preparedAt;
  saveState();
  return item;
}

async function prepareDynamicSlot() {
  const now = new Date();
  const nowMinutes = moscowMinutes(now);
  const hour = Math.floor(nowMinutes / 60);
  const nextHour = hour + 1;
  if (nextHour < DYNAMIC_SLOT_START_HOUR || nextHour > DYNAMIC_SLOT_END_HOUR) {
    return { ok: true, skipped: "outside_hours" };
  }

  const day = moscowDateKey(now);
  if (dynamicDailyPublishedCount(day) >= DYNAMIC_DAILY_MAX) {
    return { ok: true, skipped: "daily_max" };
  }

  const schedule = ensureScheduleShape(state);
  const time = String(nextHour).padStart(2, "0") + ":00";
  if (schedule.suppressed[day] && schedule.suppressed[day][time]) {
    return { ok: true, skipped: "suppressed" };
  }

  const collector = await collectOnce("slot-prep");
  const item = dynamicAssignBest(day, time);
  return {
    ok: true,
    slot: time,
    collector: collector,
    prepared: item ? item.id : null,
    title: item ? item.title : ""
  };
}

async function publishDynamicSlot() {
  const now = new Date();
  const nowMinutes = moscowMinutes(now);
  const hour = Math.floor(nowMinutes / 60);
  if (hour < DYNAMIC_SLOT_START_HOUR || hour > DYNAMIC_SLOT_END_HOUR) {
    return { ok: true, skipped: "outside_hours" };
  }

  const day = moscowDateKey(now);
  const time = String(hour).padStart(2, "0") + ":00";
  const slotKey = day + " " + time;
  state.dynamicScheduler = state.dynamicScheduler || {};

  if (state.dynamicScheduler.lastPublishedSlot === slotKey) {
    return { ok: true, skipped: "already_done" };
  }
  if (dynamicDailyPublishedCount(day) >= DYNAMIC_DAILY_MAX) {
    return { ok: true, skipped: "daily_max" };
  }

  const schedule = ensureScheduleShape(state);
  const queueId = schedule.assignments[day] && schedule.assignments[day][time];
  if (!queueId) {
    state.dynamicScheduler.lastPublishedSlot = slotKey;
    saveState();
    return { ok: true, skipped: "empty_slot" };
  }

  const item = (state.queue || []).find(function(q){ return q && q.id === queueId; });
  if (!item) {
    delete schedule.assignments[day][time];
    state.dynamicScheduler.lastPublishedSlot = slotKey;
    saveState();
    return { ok: true, skipped: "missing_item" };
  }

  if (dynamicItemAgeMs(item) > DYNAMIC_SLOT_MAX_AGE_HOURS * 60 * 60 * 1000) {
    delete schedule.assignments[day][time];
    state.queue = (state.queue || []).filter(function(q){ return q.id !== queueId; });
    state.dynamicScheduler.lastPublishedSlot = slotKey;
    saveState();
    return { ok: true, skipped: "stale" };
  }

  if (state.mode !== "AUTO" || !AUTO_PUBLISH_ENABLED) {
    return { ok: true, skipped: "auto_disabled", prepared: queueId };
  }

  const result = await sendMultiPlatformPost(item);
  const publishedAt = new Date().toISOString();

  state.history.unshift({
    id: newId("hist"),
    title: item.title || "Публикация",
    text: item.text || "",
    messageId: result.message_id,
    vkPostId: result.vkPostId || null,
    vkError: result.vkError || "",
    publishedAt: publishedAt,
    sourceUrl: item.sourceUrl || "",
    imageUrl: item.imageUrl || "",
    originalImageUrl: item.originalImageUrl || item.imageUrl || "",
    generatedImageUrl: item.generatedImageUrl || "",
    videoUrl: item.videoUrl || "",
    mediaType: item.mediaType || "",
    mediaStatus: item.mediaStatus || ""
  });
  state.history = state.history.slice(0, 300);
  state.stats.published = Number(state.stats.published || 0) + 1;
  state.queue = (state.queue || []).filter(function(q){ return q.id !== queueId; });
  delete schedule.assignments[day][time];

  state.dynamicScheduler.lastPublishedSlot = slotKey;
  state.dynamicScheduler.lastPublishedAt = publishedAt;

  if (db && dbReady && item.newsId) {
    try {
      await db.query(
        "UPDATE news_items SET status='published', telegram_message_id=$2, published_at=$3, metadata=COALESCE(metadata,'{}'::jsonb) || $4::jsonb WHERE id=$1",
        [item.newsId, result.message_id, publishedAt, JSON.stringify({ vkPostId: result.vkPostId || null, vkError: result.vkError || "" })]
      );
    } catch (error) {
      console.warn("Dynamic publish DB update failed:", error.message);
    }
  }

  saveState();
  return {
    ok: true,
    published: true,
    messageId: result.message_id,
    vkPostId: result.vkPostId || null,
    vkError: result.vkError || "",
    slot: time
  };
}

async function dynamicSchedulerTick() {
  if (collectorRunning) return;
  const now = new Date();
  const nowMinutes = moscowMinutes(now);
  const hour = Math.floor(nowMinutes / 60);
  const minute = nowMinutes % 60;
  const day = moscowDateKey(now);

  let action = "";
  if (minute === DYNAMIC_SLOT_PREP_MINUTE && hour >= DYNAMIC_SLOT_START_HOUR - 1 && hour < DYNAMIC_SLOT_END_HOUR) {
    action = "prepare";
  } else if (minute === 0 && hour >= DYNAMIC_SLOT_START_HOUR && hour <= DYNAMIC_SLOT_END_HOUR) {
    action = "publish";
  }
  if (!action) return;

  state.dynamicScheduler = state.dynamicScheduler || {};
  const key = day + "-" + String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0") + "-" + action;
  if (state.dynamicScheduler.lastTickKey === key) return;
  state.dynamicScheduler.lastTickKey = key;
  saveState();

  try {
    const result = action === "prepare" ? await prepareDynamicSlot() : await publishDynamicSlot();
    console.log("Dynamic scheduler " + action + ":", JSON.stringify(result));
  } catch (error) {
    console.error("Dynamic scheduler " + action + " failed:", error.message);
  }
}

function startCollectorScheduler() {
  if (!COLLECTOR_ENABLED || collectorTimer) return;
  collectorTimer = setInterval(function() {
    dynamicSchedulerTick().catch(function(error){ console.error("Dynamic scheduler tick failed:", error.message); });
  }, 30000);
  dynamicSchedulerTick().catch(function(error){ console.error("Dynamic scheduler startup failed:", error.message); });
  console.log("Dynamic scheduler: search at :45, publish on the hour, 08:00-23:00 Moscow");
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

function trimPostToCaptionLimit(post, limit) {
  const max = Number(limit || 900);
  const out = Object.assign({}, post);
  let text = String(out.text || "").trim();
  let html = formatTelegramPost(out);
  while (html.length > max && text.length > 140) {
    const over = html.length - max;
    let target = Math.max(140, text.length - over - 40);
    let cut = text.slice(0, target).trim();
    const punct = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "), cut.lastIndexOf("\n"));
    if (punct > Math.floor(target * 0.55)) cut = cut.slice(0, punct + 1).trim();
    text = cut.replace(/[\s,;:–—-]+$/g, "") + "…";
    out.text = text;
    html = formatTelegramPost(out);
  }
  return out;
}

async function preparePostForSingleTelegramCaption(post) {
  const original = Object.assign({}, post);
  if (formatTelegramPost(original).length <= 900) return original;

  if (OPENAI_API_KEY) {
    const prompt = [
      "Сожми готовый новостной пост канала «Что там у ИИ?» так, чтобы он целиком поместился в подпись к одному фото/видео Telegram.",
      "Сохрани только факты из исходного готового поста. Ничего не добавляй и не меняй цифры, имена, компании, даты и смысл.",
      "Заголовок до 90 знаков. Текст 430–620 знаков. 3–5 коротких абзацев.",
      "Можно сохранить 1–2 выделения **жирным** и максимум одну строку > для важного факта.",
      "Не добавляй слово «Источник» — ссылку добавит система.",
      "Верни строго JSON: {\"title\":\"...\",\"text\":\"...\"}.",
      "",
      "Заголовок:",
      String(original.title || ""),
      "",
      "Текст:",
      String(original.text || "")
    ].join("\n");

    const candidates = [OPENAI_MODEL, OPENAI_FALLBACK_MODEL].filter(function(v, i, a){ return v && a.indexOf(v) === i; });
    for (const model of candidates) {
      try {
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer " + OPENAI_API_KEY },
          body: JSON.stringify({ model: model, input: prompt, max_output_tokens: 900 }),
          signal: AbortSignal.timeout(45000)
        });
        const data = await response.json().catch(function(){ return {}; });
        if (!response.ok) continue;
        const output = extractOpenAIText(data);
        if (!output) continue;
        const parsed = JSON.parse(output.replace(/^\s*```json\s*/i, "").replace(/\s*```\s*$/i, ""));
        const compact = Object.assign({}, original, {
          title: String(parsed.title || original.title || "").trim(),
          text: String(parsed.text || "").trim()
        });
        if (compact.text && formatTelegramPost(compact).length <= 900) return compact;
        return trimPostToCaptionLimit(compact, 900);
      } catch (error) {
        console.warn("Telegram caption compact failed:", error.message);
      }
    }
  }

  return trimPostToCaptionLimit(original, 900);
}

function normalizePublishTargets(value) {
  const requested = value && typeof value === "object" ? value : {};
  const hasExplicit = Object.prototype.hasOwnProperty.call(requested, "telegram") || Object.prototype.hasOwnProperty.call(requested, "vk");
  return {
    telegram: hasExplicit ? requested.telegram !== false : true,
    vk: hasExplicit ? requested.vk === true : true
  };
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
  let imageUrl = String(post.generatedImageUrl || post.imageUrl || "").trim();
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
      if (!imageUrl && GENERATE_COVER_IF_MISSING) {
        try {
          const generatedFallback = await generateNewsCover({
            id: post.id || newId("video_fallback"),
            title: post.title || "Что там у ИИ?",
            text: post.text || "",
            sourceName: post.sourceName || "Telegram fallback"
          });
          post.generatedImageUrl = generatedFallback.url;
        } catch (fallbackError) {
          throw new Error("Видео недоступно, а резервное фото не удалось подготовить: " + fallbackError.message);
        }
      } else if (!imageUrl) {
        throw error;
      }
    }
  }

  imageUrl = String(post.generatedImageUrl || post.imageUrl || "").trim();

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

async function vkApi(method, params) {
  if (!VK_ACCESS_TOKEN || !VK_GROUP_ID) throw new Error("VK configuration is incomplete");
  const body = new URLSearchParams();
  Object.entries(params || {}).forEach(function(entry) {
    const key = entry[0], value = entry[1];
    if (value !== undefined && value !== null && value !== "") body.set(key, String(value));
  });
  body.set("access_token", VK_ACCESS_TOKEN);
  body.set("v", VK_API_VERSION);
  const response = await fetch("https://api.vk.com/method/" + method, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json().catch(function(){ return {}; });
  if (!response.ok || data.error) {
    const err = data && data.error;
    throw new Error(err ? ("VK " + err.error_code + ": " + err.error_msg) : ("VK HTTP " + response.status));
  }
  return data.response;
}

function formatVkPost(post) {
  const title = String(post.title || "").trim();
  let text = String(post.text || "").trim();
  text = text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/^>\s?/gm, "▌ ")
    .replace(/\n{3,}/g, "\n\n");
  let out = "";
  if (title) out += title;
  if (text) out += (out ? "\n\n" : "") + text;
  const sourceUrl = String(post.sourceUrl || "").trim();
  if (sourceUrl) out += (out ? "\n\n" : "") + "Источник: " + sourceUrl;
  return out.trim();
}

async function uploadVkWallPhoto(imageUrl) {
  if (!imageUrl) throw new Error("VK: нет фото для публикации");
  const uploadServer = await vkApi("photos.getWallUploadServer", { group_id: VK_GROUP_ID });
  if (!uploadServer || !uploadServer.upload_url) throw new Error("VK: не получен сервер загрузки фото");

  let sourceUrl = String(imageUrl || "").trim();
  if (sourceUrl.startsWith("/")) sourceUrl = PUBLIC_BASE_URL + sourceUrl;
  const imageResponse = await fetch(sourceUrl, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; NewsFactoryVK/1.0)" },
    signal: AbortSignal.timeout(20000)
  });
  if (!imageResponse.ok) throw new Error("VK: фото недоступно, HTTP " + imageResponse.status);
  const bytes = await imageResponse.arrayBuffer();
  const mime = String(imageResponse.headers.get("content-type") || "image/jpeg").split(";")[0];
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const form = new FormData();
  form.append("photo", new Blob([bytes], { type: mime }), "news." + ext);

  const uploadResponse = await fetch(uploadServer.upload_url, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30000)
  });
  const uploaded = await uploadResponse.json().catch(function(){ return {}; });
  if (!uploadResponse.ok || !uploaded.server || !uploaded.photo || !uploaded.hash) {
    throw new Error("VK: загрузка фото не завершена");
  }

  const saved = await vkApi("photos.saveWallPhoto", {
    group_id: VK_GROUP_ID,
    server: uploaded.server,
    photo: uploaded.photo,
    hash: uploaded.hash
  });
  const photo = Array.isArray(saved) ? saved[0] : (saved && saved.items ? saved.items[0] : null);
  if (!photo || !photo.id) throw new Error("VK: фото не сохранено");
  return "photo" + photo.owner_id + "_" + photo.id;
}

async function publishVkPost(post) {
  if (!VK_PUBLISH_ENABLED) return null;
  if (!VK_ACCESS_TOKEN || !VK_GROUP_ID || !VK_OWNER_ID) throw new Error("VK: подключение настроено не полностью");

  let imageUrl = String(post.generatedImageUrl || post.imageUrl || "").trim();
  if (!imageUrl && GENERATE_COVER_IF_MISSING) {
    const generated = await generateNewsCover({
      id: post.id || newId("vk_cover"),
      title: post.title || "Что там у ИИ?",
      text: post.text || "",
      sourceName: post.sourceName || "VK"
    });
    imageUrl = String(generated.url || "").trim();
  }
  if (!imageUrl) throw new Error("VK: публикация без изображения запрещена");

  const attachment = await uploadVkWallPhoto(imageUrl);
  const result = await vkApi("wall.post", {
    owner_id: VK_OWNER_ID,
    from_group: 1,
    message: formatVkPost(post),
    attachments: attachment
  });
  return result || null;
}

async function sendMultiPlatformPost(post, targets) {
  const selected = normalizePublishTargets(targets);
  if (!selected.telegram && !selected.vk) throw new Error("Выберите хотя бы одну соцсеть");

  const prepared = selected.telegram ? await preparePostForSingleTelegramCaption(post) : Object.assign({}, post);
  const result = {
    message_id: null,
    vkPostId: null,
    telegramPublished: false,
    vkPublished: false,
    publishedText: prepared.text || "",
    publishedTitle: prepared.title || ""
  };

  if (selected.telegram) {
    const tg = await sendTelegramPost(prepared);
    result.message_id = tg.message_id;
    result.telegramPublished = true;
  }

  if (selected.vk) {
    if (!VK_PUBLISH_ENABLED || !VK_ACCESS_TOKEN || !VK_GROUP_ID || !VK_OWNER_ID) {
      result.vkError = "VK не настроен для публикации";
    } else {
      try {
        const vk = await publishVkPost(prepared);
        if (vk && vk.post_id) {
          result.vkPostId = vk.post_id;
          result.vkPublished = true;
        }
      } catch (error) {
        console.warn("VK publish failed:", error.message);
        result.vkError = String(error.message || error);
      }
    }
  }

  return result;
}

async function vkProbe() {
  if (!VK_ACCESS_TOKEN || !VK_GROUP_ID) return { ok: false, error: "VK_ACCESS_TOKEN или VK_GROUP_ID не задан" };
  try {
    const response = await vkApi("groups.getById", {
      group_id: VK_GROUP_ID,
      fields: "members_count"
    });
    const group = Array.isArray(response) ? response[0] : (response && Array.isArray(response.groups) ? response.groups[0] : null);
    if (!group) return { ok: false, error: "VK не вернул данные сообщества" };
    return { ok: true, group: group };
  } catch (error) {
    return { ok: false, error: String(error && error.message || error) };
  }
}

async function fetchVkAnalytics() {
  if (!VK_ACCESS_TOKEN || !VK_GROUP_ID || !VK_OWNER_ID) {
    return {
      connected: false,
      available: false,
      platform: "vk",
      totals: { posts: 0, views: 0, likes: 0, comments: 0, reposts: 0, subscribers: null, avgViews: 0, engagementRate: 0 },
      posts: [],
      note: "VK пока не подключён полностью."
    };
  }

  try {
    const groupResponse = await vkApi("groups.getById", {
      group_id: VK_GROUP_ID,
      fields: "members_count"
    });
    const group = Array.isArray(groupResponse) ? groupResponse[0] : (groupResponse && Array.isArray(groupResponse.groups) ? groupResponse.groups[0] : null);
    const wall = await vkApi("wall.get", {
      owner_id: VK_OWNER_ID,
      count: 100,
      filter: "owner"
    });
    const items = wall && Array.isArray(wall.items) ? wall.items : [];
    const posts = items.map(function(item) {
      const views = Number(item && item.views && item.views.count || 0);
      const likes = Number(item && item.likes && item.likes.count || 0);
      const comments = Number(item && item.comments && item.comments.count || 0);
      const reposts = Number(item && item.reposts && item.reposts.count || 0);
      const rawText = String(item && item.text || "").trim();
      const title = rawText.split(/\n+/)[0].slice(0, 140) || ("Публикация #" + item.id);
      return {
        postId: item.id,
        title: title,
        publishedAt: item.date ? new Date(Number(item.date) * 1000).toISOString() : "",
        views: views,
        likes: likes,
        comments: comments,
        reposts: reposts,
        url: "https://vk.ru/wall" + VK_OWNER_ID + "_" + item.id
      };
    });

    const totals = posts.reduce(function(acc, post) {
      acc.views += post.views;
      acc.likes += post.likes;
      acc.comments += post.comments;
      acc.reposts += post.reposts;
      return acc;
    }, { views: 0, likes: 0, comments: 0, reposts: 0 });
    const avgViews = posts.length ? Math.round(totals.views / posts.length) : 0;
    const engagementRate = totals.views > 0
      ? Number((((totals.likes + totals.comments + totals.reposts) / totals.views) * 100).toFixed(2))
      : 0;

    return {
      connected: true,
      available: true,
      platform: "vk",
      groupId: VK_GROUP_ID,
      groupName: group && group.name ? group.name : "Что там у ИИ?",
      groupUrl: VK_PUBLIC_URL,
      checkedAt: new Date().toISOString(),
      totals: {
        posts: posts.length,
        views: totals.views,
        likes: totals.likes,
        comments: totals.comments,
        reposts: totals.reposts,
        subscribers: group && Number.isFinite(Number(group.members_count)) ? Number(group.members_count) : null,
        avgViews: avgViews,
        engagementRate: engagementRate
      },
      posts: posts,
      note: "Статистика получена напрямую через VK API."
    };
  } catch (error) {
    return {
      connected: true,
      available: false,
      platform: "vk",
      error: String(error && error.message || error),
      totals: { posts: 0, views: 0, likes: 0, comments: 0, reposts: 0, subscribers: null, avgViews: 0, engagementRate: 0 },
      posts: [],
      note: "VK подключён, но статистика пока недоступна через выданные права."
    };
  }
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
  const vk = await fetchVkAnalytics();
  const value = {
    ok: true,
    generatedAt: new Date().toISOString(),
    telegram: telegram,
    vk: vk
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
    "Ты редактор Telegram-канала «Что там у ИИ? | Новости нейросетей».",
    "Твоя задача — не просто пересказать новость, а сделать живой фирменный Telegram-пост: человечный, быстрый, умный и узнаваемый.",
    "",
    "ГЛАВНОЕ:",
    "- используй только факты из исходного текста;",
    "- ничего не придумывай: даты, цены, характеристики, цитаты, сравнения и цифры нельзя добавлять от себя;",
    "- если факт не подтверждён исходником — не используй его;",
    "- не копируй формулировки источника дословно длинными кусками;",
    "- не копируй стиль конкурентов один в один: у «Что там у ИИ?» должен быть собственный голос;",
    "- для политических, трагических, медицинских и других чувствительных тем — нейтрально, без шуток и оценочных призывов;",
    "",
    "ГОЛОС «ЧТО ТАМ У ИИ?»:",
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
        parsed = { title: title || "Что там у ИИ?", text: output, confidence: "medium", notes: "Ответ модели не был JSON" };
      }
      const result = {
        title: String(parsed.title || title || "Что там у ИИ?").trim(),
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
  const vkStatusProbe = VK_ACCESS_TOKEN && VK_GROUP_ID ? await vkProbe() : { ok: false, error: "VK не настроен" };

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
      detail: botProbe.ok && botProbe.result
        ? ((botProbe.result.first_name || "Telegram-бот") + (botProbe.result.username ? " · @" + botProbe.result.username : ""))
        : String(botProbe.error || ""),
      username: botProbe.ok && botProbe.result ? String(botProbe.result.username || "") : "",
      displayName: botProbe.ok && botProbe.result ? String(botProbe.result.first_name || "") : "",
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
      detail: "Приоритет: видео → фото → генерация фото · найденные фото можно улучшать через " + OPENAI_IMAGE_MODEL,
      next: OPENAI_API_KEY && MEDIA_REQUIRED && GENERATE_COVER_IF_MISSING ? "" : "Проверить MEDIA_REQUIRED и GENERATE_COVER_IF_MISSING"
    },
    supabase: {
      state: dbReady ? "connected" : (DATABASE_URL ? "partial" : "missing"),
      description: dbReady ? "PostgreSQL подключён и доступен" : (DATABASE_URL ? "DATABASE_URL задан, база ещё не подтверждена" : "База данных не подключена"),
      detail: dbReady ? "Долговременное хранение news_items, collector_runs и snapshots" : (DATABASE_URL ? "Ожидание подключения PostgreSQL" : "Используется только /data/state.json"),
      next: dbReady ? "" : "Проверить PostgreSQL в Railway"
    },
    vk: {
      state: vkStatusProbe.ok ? "connected" : (VK_ACCESS_TOKEN ? "partial" : "missing"),
      description: vkStatusProbe.ok ? "VK подключён через API" : (VK_ACCESS_TOKEN ? "VK-токен найден, но API не подтверждён" : "VK ещё не подключён"),
      detail: vkStatusProbe.ok && vkStatusProbe.group
        ? ((vkStatusProbe.group.name || "Что там у ИИ?") + " · " + (VK_PUBLIC_URL || ("ID " + VK_GROUP_ID)))
        : String(vkStatusProbe.error || ""),
      next: vkStatusProbe.ok ? "" : "Проверить права ключа сообщества VK"
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
        ? ("Окна 08:00–23:00 · поиск за 15 минут · Telegram + VK · автопубликация " + (AUTO_PUBLISH_ENABLED ? "включена" : "выключена"))
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
        imageEnhancementEnabled: IMAGE_ENHANCEMENT_ENABLED,
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
      const item = dynamicAssignBest(day, time);
      return sendJson(res, 200, { ok: true, assignment: item ? { date: day, time: time, queueId: item.id } : null });
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
        intervalMinutes: 60,
        strategy: "dynamic-hourly",
        prepareMinutesBefore: 15,
        activeHours: "08:00–23:00",
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
      const result = await sendTelegram("✅ News Factory подключён\n\nАвтопубликация в «Что там у ИИ?» работает.\nТест: " + marker);
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
        title: String(body.title || "Что там у ИИ?").trim(),
        text: text,
        sourceName: "Ручная публикация",
        imageUrl: String(body.imageUrl || "").trim(),
        videoUrl: String(body.videoUrl || "").trim()
      });
      if (MEDIA_REQUIRED && !(media.imageUrl || media.generatedImageUrl || media.videoUrl)) {
        return sendJson(res, 422, { ok: false, error: "Не удалось подготовить фото или видео для публикации" });
      }
      const result = await sendMultiPlatformPost({
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
        vkPostId: result.vkPostId || null,
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

    if (req.method === "POST" && p === "/api/queue/enhance-media") {
      const body = await readJson(req);
      const item = (state.queue || []).find(function(x){ return x.id === body.id; });
      if (!item) return sendJson(res, 404, { ok: false, error: "Новость не найдена в очереди" });
      if (item.videoUrl) return sendJson(res, 409, { ok: false, error: "Для этой новости приоритет уже у видео — улучшать фото не требуется" });

      const sourceImage = String(item.originalImageUrl || item.imageUrl || "").trim();
      if (!sourceImage) return sendJson(res, 400, { ok: false, error: "У новости нет найденного фото для улучшения" });

      try {
        const enhanced = await enhanceNewsImage({
          id: item.newsId || item.id,
          title: item.title,
          text: item.text,
          imageUrl: sourceImage
        });
        item.originalImageUrl = sourceImage;
        item.imageUrl = sourceImage;
        item.generatedImageUrl = enhanced.url;
        item.mediaType = "enhanced";
        item.mediaStatus = "enhanced";
        item.mediaPriority = 2;
        item.enhancedBy = enhanced.model;
        item.enhancedAt = new Date().toISOString();
        item.canEnhance = true;

        if (db && dbReady && item.newsId) {
          const row = await db.query("SELECT metadata FROM news_items WHERE id=$1 LIMIT 1", [item.newsId]);
          if (row.rowCount) {
            const metadata = Object.assign({}, row.rows[0].metadata || {}, {
              originalImageUrl: sourceImage,
              imageUrl: sourceImage,
              generatedImageUrl: enhanced.url,
              mediaType: "enhanced",
              mediaStatus: "enhanced",
              mediaPriority: 2,
              enhancedBy: enhanced.model,
              enhancedAt: item.enhancedAt
            });
            await db.query("UPDATE news_items SET metadata=$2::jsonb WHERE id=$1", [item.newsId, JSON.stringify(metadata)]);
          }
        }

        saveState();
        return sendJson(res, 200, { ok: true, imageUrl: enhanced.url, model: enhanced.model });
      } catch (error) {
        return sendJson(res, 502, { ok: false, error: error.message || "Не удалось улучшить фото" });
      }
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
      const result = await sendMultiPlatformPost({
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
        vkPostId: result.vkPostId || null,
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
        title: String(body.title || "Что там у ИИ?").trim(),
        text: text,
        sourceName: "API публикация",
        imageUrl: String(body.imageUrl || "").trim(),
        videoUrl: String(body.videoUrl || "").trim()
      });
      if (MEDIA_REQUIRED && !(media.imageUrl || media.generatedImageUrl || media.videoUrl)) {
        return sendJson(res, 422, { ok: false, error: "Не удалось подготовить медиа" });
      }
      const result = await sendMultiPlatformPost({
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
