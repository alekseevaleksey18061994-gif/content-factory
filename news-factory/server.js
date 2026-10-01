import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import sharp from "sharp";

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
const VK_USER_TOKEN = String(process.env.VK_USER_TOKEN || process.env.VK_USER_ACCESS_TOKEN || "").trim();
const TELEGRAM_ALERT_CHAT_ID = String(process.env.TELEGRAM_ALERT_CHAT_ID || "").trim();
const VK_GROUP_ID = Math.abs(Number(process.env.VK_GROUP_ID || 0)) || 0;
const VK_OWNER_ID = Number(process.env.VK_OWNER_ID || (VK_GROUP_ID ? -VK_GROUP_ID : 0)) || 0;
const VK_SCREEN_NAME = String(process.env.VK_SCREEN_NAME || "chtotamai").trim();
const VK_PUBLIC_URL = String(process.env.VK_PUBLIC_URL || (VK_SCREEN_NAME ? "https://vk.ru/" + VK_SCREEN_NAME : "")).trim();
const VK_API_VERSION = String(process.env.VK_API_VERSION || "5.199").trim();
const VK_PUBLISH_ENABLED = String(process.env.VK_PUBLISH_ENABLED || "false").toLowerCase() === "true";
const VK_APP_ID = String(process.env.VK_APP_ID || "").trim();
const VK_OAUTH_REDIRECT_URI = String(process.env.VK_OAUTH_REDIRECT_URI || (PUBLIC_BASE_URL + "/api/vk/oauth/callback")).trim();
const VK_OAUTH_SCOPE = String(process.env.VK_OAUTH_SCOPE || "photos wall groups offline").trim();
const VK_OAUTH_MODE = String(process.env.VK_OAUTH_MODE || "legacy").trim().toLowerCase();
const VK_OAUTH_HANDOFF_SECRET = String(process.env.VK_OAUTH_HANDOFF_SECRET || "").trim();
const VK_OAUTH_TTL_MS = 10 * 60 * 1000;
let vkOAuthSession = null;
let vkOAuthHandoff = null;
const COLLECTOR_ENABLED = String(process.env.COLLECTOR_ENABLED || "true").toLowerCase() !== "false";
const AUTO_PUBLISH_ENABLED = String(process.env.AUTO_PUBLISH_ENABLED || "false").toLowerCase() === "true";
const AUTO_PUBLISH_MIN_INTERVAL_MINUTES = Math.max(10, Number(process.env.AUTO_PUBLISH_MIN_INTERVAL_MINUTES || 30));
const POLL_INTERVAL_MINUTES = Math.max(5, Number(process.env.POLL_INTERVAL_MINUTES || 15));
const DYNAMIC_SLOT_START_HOUR = 8;
const DYNAMIC_SLOT_END_HOUR = 23;
const DYNAMIC_SLOT_PREP_MINUTE = 45;
const DYNAMIC_SLOT_MAX_AGE_HOURS = Math.max(4, Math.min(48, Number(process.env.DYNAMIC_SLOT_MAX_AGE_HOURS || 24)));
const DYNAMIC_DAILY_TARGET = 10;
const DYNAMIC_DAILY_MAX = 12;
const MAX_ITEMS_PER_RUN = Math.max(1, Math.min(10, Number(process.env.MAX_ITEMS_PER_RUN || 5)));
const ARTICLE_MAX_AGE_HOURS = Math.max(6, Math.min(168, Number(process.env.ARTICLE_MAX_AGE_HOURS || 24)));
const QUEUE_MAX_AGE_HOURS = Math.max(2, Math.min(72, Number(process.env.QUEUE_MAX_AGE_HOURS || 12)));
const QUEUE_MAX_AUTO_ITEMS = Math.max(5, Math.min(50, Number(process.env.QUEUE_MAX_AUTO_ITEMS || 20)));
const AI_STRONG_NEWS_SCORE_RAW = Number(process.env.AI_STRONG_NEWS_SCORE || 75);
const AI_STRONG_NEWS_SCORE = Math.max(60, Math.min(95, Number.isFinite(AI_STRONG_NEWS_SCORE_RAW) ? AI_STRONG_NEWS_SCORE_RAW : 75));
const AI_TOP_NEWS_SCORE_RAW = Number(process.env.AI_TOP_NEWS_SCORE || 88);
const AI_TOP_NEWS_SCORE = Math.max(AI_STRONG_NEWS_SCORE, Math.min(100, Number.isFinite(AI_TOP_NEWS_SCORE_RAW) ? AI_TOP_NEWS_SCORE_RAW : 88));
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || "/data";
const STATE_FILE = path.join(DATA_DIR, "state.json");
const MEDIA_DIR = path.join(DATA_DIR, "media");
const PUBLIC_DIR = path.join(process.cwd(), "public");
const VK_PREVIEW_WIDTH = 1200;
const VK_PREVIEW_HEIGHT = 630;
const VK_PREVIEW_MAX_BYTES = Math.max(200000, Math.min(1048576, Number(process.env.VK_PREVIEW_MAX_BYTES || 950000)));
const VK_PREVIEW_JPEG_QUALITY = Math.max(45, Math.min(90, Number(process.env.VK_PREVIEW_JPEG_QUALITY || 82)));
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
  topicSettings: {
    default: {
      allow_text_fallback: false,
      auto_publish_telegram: true,
      auto_publish_vk: true
    }
  },
  telegramAlertChatId: "",
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
    const aAi = Number(a && a.aiScore);
    const bAi = Number(b && b.aiScore);
    const aScore = Number.isFinite(aAi) ? aAi : 0;
    const bScore = Number.isFinite(bAi) ? bAi : 0;
    if (bScore !== aScore) return bScore - aScore;
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
    loaded.topicSettings = Object.assign(
      structuredClone(defaultState.topicSettings),
      saved.topicSettings && typeof saved.topicSettings === "object" ? saved.topicSettings : {}
    );
    loaded.topicSettings.default = Object.assign(
      {
        allow_text_fallback: false,
        auto_publish_telegram: true,
        auto_publish_vk: true
      },
      loaded.topicSettings.default || {}
    );

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

async function runMigrations() {
  if (!db) return;
  const migrationsDir = path.join(process.cwd(), "migrations");
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  let files = [];
  try {
    files = fs.readdirSync(migrationsDir)
      .filter(function(name){ return /\.sql$/i.test(name); })
      .sort();
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw error;
  }

  for (const fileName of files) {
    const version = fileName.replace(/\.sql$/i, "");
    const exists = await db.query("SELECT 1 FROM schema_migrations WHERE version=$1 LIMIT 1", [version]);
    if (exists.rowCount) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, fileName), "utf8");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(version) VALUES($1)", [version]);
      await client.query("COMMIT");
      console.log("DB migration applied:", version);
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }
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
    await runMigrations();
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

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function previewDescription(post) {
  const title = String(post && post.title || "").replace(/[*_>#`]/g, " ").replace(/\s+/g, " ").trim();
  const body = String(post && post.text || "").replace(/[*_>#`]/g, " ").replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim();
  return (title + (body ? " — " + body : "")).slice(0, 280);
}

function previewSlug(post) {
  const base = String(post && (post.postId || post.id || post.newsId) || "post")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "post";
  return base + "-" + Date.now().toString(36) + "-" + crypto.randomBytes(5).toString("hex");
}

function previewPageUrl(slug) {
  return PUBLIC_BASE_URL + "/p/" + encodeURIComponent(slug);
}

function localMediaPathFromUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ""), PUBLIC_BASE_URL);
    const base = new URL(PUBLIC_BASE_URL);
    if (u.origin !== base.origin || !u.pathname.startsWith("/media/")) return "";
    const fileName = decodeURIComponent(u.pathname.slice("/media/".length));
    if (!fileName || fileName !== path.basename(fileName)) return "";
    return path.join(MEDIA_DIR, fileName);
  } catch {
    return "";
  }
}

async function loadPreviewSourceBytes(rawUrl) {
  const sourceUrl = String(rawUrl || "").trim();
  if (!sourceUrl) return null;
  const localPath = localMediaPathFromUrl(sourceUrl);
  if (localPath) {
    const bytes = fs.readFileSync(localPath);
    if (!bytes.length) throw new Error("Локальное изображение пустое");
    return bytes;
  }

  const absolute = sourceUrl.startsWith("/") ? PUBLIC_BASE_URL + sourceUrl : sourceUrl;
  if (!/^https:\/\//i.test(absolute)) throw new Error("Для preview требуется HTTPS-изображение");
  const response = await fetch(absolute, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; NewsFactoryPreview/1.0)" },
    redirect: "follow",
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error("Не удалось скачать preview-изображение: HTTP " + response.status);
  const type = String(response.headers.get("content-type") || "").toLowerCase();
  if (!type.startsWith("image/")) throw new Error("Preview-источник не является изображением");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error("Preview-изображение пустое");
  if (bytes.length > 20 * 1024 * 1024) throw new Error("Preview-изображение слишком большое");
  return bytes;
}

function wrapPreviewTitle(value, maxChars, maxLines) {
  const words = String(value || "Что там у ИИ?").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? line + " " + word : word;
    if (next.length <= maxChars || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (words.join(" ").length > lines.join(" ").length && lines.length) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/[.…]*$/, "") + "…";
  }
  return lines.slice(0, maxLines);
}

function buildTemplatePreviewSvg(post) {
  const lines = wrapPreviewTitle(post && post.title, 34, 3);
  const tspans = lines.map(function(line, index) {
    return '<tspan x="82" dy="' + (index === 0 ? "0" : "72") + '">' + escapeHtml(line) + "</tspan>";
  }).join("");
  const topic = escapeHtml(String(post && post.topicId || "default").toUpperCase());
  return Buffer.from(
    '<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#07111f"/><stop offset=".55" stop-color="#10265f"/><stop offset="1" stop-color="#31156e"/></linearGradient>' +
    '<radialGradient id="r" cx=".78" cy=".18" r=".7"><stop stop-color="#42d5ff" stop-opacity=".34"/><stop offset="1" stop-color="#42d5ff" stop-opacity="0"/></radialGradient></defs>' +
    '<rect width="1200" height="630" fill="url(#g)"/><rect width="1200" height="630" fill="url(#r)"/>' +
    '<circle cx="1010" cy="115" r="150" fill="#7b4dff" opacity=".18"/><circle cx="1080" cy="505" r="210" fill="#20c9ff" opacity=".10"/>' +
    '<rect x="82" y="70" width="96" height="96" rx="28" fill="#5166ff"/><text x="130" y="135" text-anchor="middle" font-family="Arial,sans-serif" font-size="42" font-weight="800" fill="#fff">AI</text>' +
    '<text x="204" y="112" font-family="Arial,sans-serif" font-size="28" font-weight="700" fill="#d9e5ff">NEWS FACTORY</text>' +
    '<text x="204" y="148" font-family="Arial,sans-serif" font-size="20" fill="#8ea7d7">Что там у ИИ? · ' + topic + '</text>' +
    '<text x="82" y="285" font-family="Arial,sans-serif" font-size="58" font-weight="800" fill="#fff">' + tspans + '</text>' +
    '<text x="82" y="565" font-family="Arial,sans-serif" font-size="20" fill="#91a8d2">Новости нейросетей и технологий</text>' +
    '</svg>'
  );
}

async function encodePreviewJpeg(inputBytes) {
  const qualities = Array.from(new Set([
    VK_PREVIEW_JPEG_QUALITY,
    Math.max(45, VK_PREVIEW_JPEG_QUALITY - 8),
    Math.max(45, VK_PREVIEW_JPEG_QUALITY - 16),
    58,
    50,
    45
  ]));
  let last = null;
  for (const quality of qualities) {
    const out = await sharp(inputBytes, { limitInputPixels: 80 * 1000 * 1000 })
      .rotate()
      .resize(VK_PREVIEW_WIDTH, VK_PREVIEW_HEIGHT, { fit: "cover", position: "centre" })
      .jpeg({ quality: quality, mozjpeg: true, chromaSubsampling: "4:2:0" })
      .toBuffer({ resolveWithObject: true });
    last = out;
    if (out.data.length <= VK_PREVIEW_MAX_BYTES) return out;
  }
  if (!last || last.data.length > 1048576) throw new Error("Не удалось уложить preview JPEG в 1 МБ");
  return last;
}

async function prepareVkPreviewImage(post, slug) {
  ensureDataDir();
  const sourceUrl = String(post && (post.generatedImageUrl || post.imageUrl) || "").trim();
  let input = null;
  if (sourceUrl) {
    try {
      input = await loadPreviewSourceBytes(sourceUrl);
    } catch (error) {
      console.warn("VK_PREVIEW_SOURCE_FAILED " + JSON.stringify({
        post_id: String(post && (post.postId || post.id) || "unknown"),
        slug: slug,
        error: String(error && error.message || error)
      }));
    }
  }
  if (!input) input = buildTemplatePreviewSvg(post);

  let encoded;
  try {
    encoded = await encodePreviewJpeg(input);
  } catch (error) {
    if (sourceUrl) encoded = await encodePreviewJpeg(buildTemplatePreviewSvg(post));
    else throw error;
  }

  const fileName = "vk_preview_" + slug + ".jpg";
  fs.writeFileSync(path.join(MEDIA_DIR, fileName), encoded.data);
  return {
    fileName: fileName,
    url: mediaPublicUrl(fileName),
    width: encoded.info.width || VK_PREVIEW_WIDTH,
    height: encoded.info.height || VK_PREVIEW_HEIGHT,
    bytes: encoded.data.length
  };
}

function normalizePublicPostSources(post) {
  const p = post || {};
  const out = [];
  const seen = new Set();

  function add(name, url) {
    const sourceUrl = String(url || "").trim();
    if (!sourceUrl || !/^https:\/\//i.test(sourceUrl) || seen.has(sourceUrl)) return;
    seen.add(sourceUrl);
    out.push({
      name: String(name || sourceUrl).trim().slice(0, 200) || sourceUrl,
      url: sourceUrl
    });
  }

  if (Array.isArray(p.sources)) {
    p.sources.forEach(function(source) {
      if (typeof source === "string") add("", source);
      else if (source && typeof source === "object") add(source.name || source.title || "", source.url || source.href || "");
    });
  }
  if (Array.isArray(p.sourceUrls)) {
    p.sourceUrls.forEach(function(url){ add("", url); });
  }
  add(p.sourceName || "", p.sourceUrl || "");
  return out.slice(0, 20);
}

async function createPublicPostPage(post) {
  if (!db || !dbReady) throw new Error("PostgreSQL недоступен — public preview нельзя создать");
  const slug = previewSlug(post);
  const image = await prepareVkPreviewImage(post, slug);
  const title = String(post && post.title || "Что там у ИИ?").trim() || "Что там у ИИ?";
  const bodyText = String(post && post.text || "").trim();
  const description = previewDescription(post);
  const sources = normalizePublicPostSources(post);
  const primarySource = sources[0] || {};
  const sourceName = String(primarySource.name || post && post.sourceName || "").trim();
  const sourceUrl = String(primarySource.url || post && post.sourceUrl || "").trim();
  const postId = String(post && (post.postId || post.id || post.newsId) || slug);
  const topicId = String(post && (post.topicId || post.topic_id) || "default");

  await db.query(
    `INSERT INTO public_post_pages
      (slug, post_id, topic_id, title, body_text, description, source_name, source_url, sources, image_filename, image_url, image_width, image_height, image_bytes)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14)`,
    [slug, postId, topicId, title, bodyText, description, sourceName || null, sourceUrl || null, JSON.stringify(sources), image.fileName, image.url, image.width, image.height, image.bytes]
  );

  return {
    slug: slug,
    url: previewPageUrl(slug),
    title: title,
    description: description,
    sources: sources,
    imageUrl: image.url,
    imageWidth: image.width,
    imageHeight: image.height,
    imageBytes: image.bytes
  };
}

async function getPublicPostPage(slug) {
  if (!db || !dbReady) return null;
  const result = await db.query(
    `SELECT slug, post_id AS "postId", topic_id AS "topicId", title, body_text AS "bodyText",
            description, source_name AS "sourceName", source_url AS "sourceUrl", sources,
            image_filename AS "imageFilename", image_url AS "imageUrl",
            image_width AS "imageWidth", image_height AS "imageHeight", image_bytes AS "imageBytes",
            preflight_status AS "preflightStatus", preflight_checked_at AS "preflightCheckedAt",
            vk_post_id AS "vkPostId", vk_error_code AS "vkErrorCode", vk_error_msg AS "vkErrorMsg",
            created_at AS "createdAt", published_at AS "publishedAt"
       FROM public_post_pages WHERE slug=$1 LIMIT 1`,
    [slug]
  );
  return result.rowCount ? result.rows[0] : null;
}

function renderPublicPostPage(page) {
  const canonical = previewPageUrl(page.slug);
  const title = escapeHtml(page.title);
  const description = escapeHtml(page.description || "");
  const imageUrl = escapeHtml(page.imageUrl);
  const sources = Array.isArray(page.sources) && page.sources.length
    ? page.sources
    : (page.sourceUrl ? [{ name: page.sourceName || page.sourceUrl, url: page.sourceUrl }] : []);
  const sourceLinks = sources.length
    ? '<section class="sources"><h2>Источники</h2><ul>' + sources.map(function(source) {
        return '<li><a href="' + escapeHtml(source.url) + '" rel="nofollow noopener">' + escapeHtml(source.name || source.url) + '</a></li>';
      }).join("") + '</ul></section>'
    : "";
  return '<!doctype html><html lang="ru"><head>' +
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + '</title>' +
    '<meta name="description" content="' + description + '">' +
    '<link rel="canonical" href="' + escapeHtml(canonical) + '">' +
    '<meta property="og:title" content="' + title + '">' +
    '<meta property="og:description" content="' + description + '">' +
    '<meta property="og:type" content="article">' +
    '<meta property="og:url" content="' + escapeHtml(canonical) + '">' +
    '<meta property="og:image" content="' + imageUrl + '">' +
    '<meta property="og:image:width" content="' + Number(page.imageWidth || VK_PREVIEW_WIDTH) + '">' +
    '<meta property="og:image:height" content="' + Number(page.imageHeight || VK_PREVIEW_HEIGHT) + '">' +
    '<meta name="twitter:card" content="summary_large_image">' +
    '<meta name="twitter:title" content="' + title + '">' +
    '<meta name="twitter:description" content="' + description + '">' +
    '<meta name="twitter:image" content="' + imageUrl + '">' +
    '<style>body{margin:0;background:#080b12;color:#f6f8fc;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:860px;margin:0 auto;padding:24px}.card{background:#111722;border:1px solid #273246;border-radius:24px;overflow:hidden}.hero{display:block;width:100%;height:auto;aspect-ratio:1200/630;object-fit:cover}.content{padding:24px 26px 30px}h1{font-size:34px;line-height:1.12;margin:0 0 18px}.body{font-size:18px;line-height:1.55;white-space:pre-wrap;color:#dbe3ef}.sources{margin-top:26px;border-top:1px solid #273246;padding-top:18px}.sources h2{font-size:18px;margin:0 0 10px}.sources ul{margin:0;padding-left:20px}.sources li{margin:7px 0}.sources a{color:#8eb0ff}@media(max-width:640px){.wrap{padding:0}.card{border-radius:0;border-left:0;border-right:0}.content{padding:20px}h1{font-size:28px}.body{font-size:17px}}</style>' +
    '</head><body><main class="wrap"><article class="card"><img class="hero" src="' + imageUrl + '" width="' + Number(page.imageWidth || VK_PREVIEW_WIDTH) + '" height="' + Number(page.imageHeight || VK_PREVIEW_HEIGHT) + '" alt=""><div class="content"><h1>' + title + '</h1><div class="body">' + escapeHtml(page.bodyText) + '</div>' + sourceLinks + '</div></article></main></body></html>';
}

async function preflightPublicPostPage(page) {
  if (!/^https:\/\//i.test(page.url) || !/^https:\/\//i.test(page.imageUrl)) {
    throw new Error("Preview URL должен быть абсолютным HTTPS");
  }

  const requestHeaders = { "user-agent": "Mozilla/5.0 (compatible; NewsFactoryPreflight/1.0)" };

  const pageHead = await fetch(page.url, {
    method: "HEAD",
    redirect: "manual",
    headers: requestHeaders,
    signal: AbortSignal.timeout(15000)
  });
  if (pageHead.status !== 200) throw new Error("Public preview HEAD HTTP " + pageHead.status);
  const pageHeadType = String(pageHead.headers.get("content-type") || "").toLowerCase();
  if (!pageHeadType.includes("text/html")) throw new Error("Public preview HEAD имеет неверный Content-Type");

  const pageResponse = await fetch(page.url, {
    redirect: "manual",
    headers: requestHeaders,
    signal: AbortSignal.timeout(15000)
  });
  if (pageResponse.status !== 200) throw new Error("Public preview HTTP " + pageResponse.status);
  const pageType = String(pageResponse.headers.get("content-type") || "").toLowerCase();
  if (!pageType.includes("text/html")) throw new Error("Public preview имеет неверный Content-Type");
  const html = await pageResponse.text();
  if (!html.includes('property="og:image"') || !html.includes(page.imageUrl)) {
    throw new Error("Public preview не содержит ожидаемый og:image");
  }

  const imageHead = await fetch(page.imageUrl, {
    method: "HEAD",
    redirect: "manual",
    headers: requestHeaders,
    signal: AbortSignal.timeout(15000)
  });
  if (imageHead.status !== 200) throw new Error("og:image HEAD HTTP " + imageHead.status);
  const imageHeadType = String(imageHead.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (imageHeadType !== "image/jpeg") throw new Error("og:image HEAD должен быть image/jpeg");
  const imageHeadLength = Number(imageHead.headers.get("content-length") || 0);
  if (!imageHeadLength || imageHeadLength > 1048576) {
    throw new Error("og:image HEAD должен сообщать размер от 1 байта до 1 МБ");
  }

  const imageResponse = await fetch(page.imageUrl, {
    redirect: "manual",
    headers: requestHeaders,
    signal: AbortSignal.timeout(15000)
  });
  if (imageResponse.status !== 200) throw new Error("og:image HTTP " + imageResponse.status);
  const imageType = String(imageResponse.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (imageType !== "image/jpeg") throw new Error("og:image должен быть image/jpeg");
  const bytes = Buffer.from(await imageResponse.arrayBuffer());
  if (!bytes.length || bytes.length > 1048576) throw new Error("og:image должен быть непустым и не больше 1 МБ");
  const meta = await sharp(bytes).metadata();
  if (Number(meta.width) !== VK_PREVIEW_WIDTH || Number(meta.height) !== VK_PREVIEW_HEIGHT) {
    throw new Error("og:image должен быть " + VK_PREVIEW_WIDTH + "x" + VK_PREVIEW_HEIGHT);
  }

  if (db && dbReady && page.slug) {
    await db.query(
      "UPDATE public_post_pages SET preflight_status='ok', preflight_checked_at=NOW(), vk_error_code=NULL, vk_error_msg=NULL WHERE slug=$1",
      [page.slug]
    );
  }
  return {
    ok: true,
    pageHeadStatus: pageHead.status,
    pageStatus: pageResponse.status,
    imageHeadStatus: imageHead.status,
    imageStatus: imageResponse.status,
    imageBytes: bytes.length,
    imageHeadBytes: imageHeadLength,
    width: meta.width,
    height: meta.height
  };
}

async function markPublicPostPreflightFailed(slug, error) {
  if (!db || !dbReady || !slug) return;
  await db.query(
    "UPDATE public_post_pages SET preflight_status='failed', preflight_checked_at=NOW(), vk_error_code=$2, vk_error_msg=$3 WHERE slug=$1",
    [slug, "preview_failed", String(error && error.message || error).slice(0, 1000)]
  );
}

async function markPublicPostPublished(slug, vkPostId) {
  if (!db || !dbReady || !slug) return;
  await db.query(
    "UPDATE public_post_pages SET published_at=NOW(), vk_post_id=$2, vk_error_code=NULL, vk_error_msg=NULL WHERE slug=$1",
    [slug, vkPostId == null ? null : Number(vkPostId)]
  );
}

async function markPublicPostVkFailed(slug, error) {
  if (!db || !dbReady || !slug) return;
  await db.query(
    "UPDATE public_post_pages SET vk_error_code=$2, vk_error_msg=$3 WHERE slug=$1",
    [slug, error && error.vkErrorCode != null ? String(error.vkErrorCode) : "vk_error", String(error && (error.vkErrorMsg || error.message) || error).slice(0, 1000)]
  );
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
      (id, source_id, source_name, source_url, original_url, original_title, original_text, content_hash, rewritten_title, rewritten_text, confidence, status, telegram_message_id, published_at, metadata, topic_id, vk_post_id, vk_status, vk_error_code, vk_error_msg, vk_media_attempts, updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19,$20,$21,NOW())
      ON CONFLICT (original_url) DO UPDATE SET
        rewritten_title=COALESCE(EXCLUDED.rewritten_title, news_items.rewritten_title),
        rewritten_text=COALESCE(EXCLUDED.rewritten_text, news_items.rewritten_text),
        confidence=COALESCE(EXCLUDED.confidence, news_items.confidence),
        status=EXCLUDED.status,
        telegram_message_id=COALESCE(EXCLUDED.telegram_message_id, news_items.telegram_message_id),
        published_at=COALESCE(EXCLUDED.published_at, news_items.published_at),
        metadata=EXCLUDED.metadata,
        topic_id=COALESCE(EXCLUDED.topic_id, news_items.topic_id),
        vk_post_id=COALESCE(EXCLUDED.vk_post_id, news_items.vk_post_id),
        vk_status=COALESCE(EXCLUDED.vk_status, news_items.vk_status),
        vk_error_code=COALESCE(EXCLUDED.vk_error_code, news_items.vk_error_code),
        vk_error_msg=COALESCE(EXCLUDED.vk_error_msg, news_items.vk_error_msg),
        vk_media_attempts=GREATEST(COALESCE(EXCLUDED.vk_media_attempts,0),COALESCE(news_items.vk_media_attempts,0)),
        updated_at=NOW()`,
      [
        item.id, item.sourceId, item.sourceName, item.sourceUrl, item.originalUrl, item.originalTitle,
        item.originalText, item.contentHash, item.rewrittenTitle || null, item.rewrittenText || null,
        item.confidence || null, item.status, item.telegramMessageId || null, item.publishedAt || null,
        JSON.stringify(item.metadata || {}),
        item.topicId || "default",
        item.vkPostId || null,
        item.vkStatus || null,
        item.vkErrorCode == null ? null : String(item.vkErrorCode),
        item.vkError || item.vkErrorMsg || null,
        Number(item.vkMediaAttempts || 0)
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

function scheduledSlotForQueueId(queueId) {
  if (!queueId) return "";
  const schedule = ensureScheduleShape(state);
  for (const day of Object.keys(schedule.assignments || {})) {
    for (const time of Object.keys(schedule.assignments[day] || {})) {
      if (schedule.assignments[day][time] === queueId) return day + " " + time;
    }
  }
  return "";
}

function enrichNewsFeedItem(row) {
  const item = Object.assign({}, row);
  const metadata = item.metadata && typeof item.metadata === "object" ? Object.assign({}, item.metadata) : {};
  const queueItem = (state.queue || []).find(function(q){ return q && q.newsId === item.id; }) || null;
  const historyItem = (state.history || []).find(function(h){ return h && h.newsId === item.id; }) || null;
  const scheduledSlot = queueItem ? scheduledSlotForQueueId(queueItem.id) : "";

  let runtimeStatus = String(item.status || "discovered");
  if (historyItem) {
    runtimeStatus = historyItem.status === "media_failed" || historyItem.vkStatus === "media_failed"
      ? "media_failed"
      : "published";
  } else if (queueItem) {
    runtimeStatus = queueItem.status === "media_failed"
      ? "media_failed"
      : (scheduledSlot ? "scheduled" : "queued");
  }

  const scoreCandidates = [
    queueItem && queueItem.aiScore,
    metadata.editorialScore
  ];
  let aiScore = null;
  for (const value of scoreCandidates) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) {
      aiScore = Math.max(0, Math.min(100, Math.round(n)));
      break;
    }
  }

  const aiTier = queueItem && queueItem.aiTier
    ? String(queueItem.aiTier)
    : (aiScore == null ? "" : (aiScore >= AI_TOP_NEWS_SCORE ? "top" : (aiScore >= AI_STRONG_NEWS_SCORE ? "strong" : "normal")));
  const aiScoreReason = String((queueItem && queueItem.aiScoreReason) || metadata.scoreReason || "");

  item.status = runtimeStatus;
  item.runtimeStatus = runtimeStatus;
  item.scheduledSlot = scheduledSlot || "";
  item.aiScore = aiScore;
  item.aiTier = aiTier;
  item.aiScoreReason = aiScoreReason;
  item.metadata = metadata;
  return item;
}

async function listNewsItems(limit) {
  const safeLimit = Math.max(1, Math.min(300, Number(limit || 100)));
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
    return r.rows.map(enrichNewsFeedItem);
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
        baseItem.metadata.editorialScore = rewrite.editorialScore;
        baseItem.metadata.scoreBreakdown = rewrite.scoreBreakdown;
        baseItem.metadata.scoreReason = rewrite.scoreReason;

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
            id: id,
            postId: id,
            newsId: id,
            topicId: "default",
            allow_text_fallback: allowTextFallbackForPost({ topicId: "default" }),
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
            text: tg.publishedText || postText,
            messageId: tg.message_id,
            vkPostId: tg.vkPostId || null,
            vkStatus: tg.vkStatus || "",
            vkError: tg.vkError || "",
            vkMediaAttempts: tg.vkMediaAttempts || 0,
            publishedAt: baseItem.publishedAt,
            sourceUrl: url,
            imageUrl: media.imageUrl || "",
            originalImageUrl: media.originalImageUrl || media.imageUrl || "",
            generatedImageUrl: media.generatedImageUrl || "",
            videoUrl: media.videoUrl || "",
            mediaType: media.mediaType,
            mediaStatus: media.mediaStatus,
            mediaPriority: media.mediaPriority || 99,
            publicationOrigin: "legacy-auto"
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
            newsId: id,
            aiScore: rewrite.editorialScore,
            aiScoreBreakdown: rewrite.scoreBreakdown,
            aiScoreReason: rewrite.scoreReason,
            aiTier: rewrite.editorialScore >= AI_TOP_NEWS_SCORE ? "top" : (rewrite.editorialScore >= AI_STRONG_NEWS_SCORE ? "strong" : "normal")
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

function dynamicScheduledHistorySlot(item) {
  if (!item || !item.publishedAt) return "";

  const explicitOrigin = String(item.publicationOrigin || "").trim();
  const explicitSlot = String(item.scheduledSlot || "").trim();
  if (explicitOrigin === "schedule" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(explicitSlot)) {
    return explicitSlot;
  }

  // New manual/test history is explicitly excluded from schedule accounting.
  if (explicitOrigin) return "";

  // Backward compatibility for history created before scheduledSlot existed:
  // genuine dynamic publications happen just after the hour and have queueId+newsId.
  if (!item.queueId || !item.newsId) return "";
  const published = new Date(item.publishedAt);
  if (!Number.isFinite(published.getTime())) return "";
  const minutes = moscowMinutes(published);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  if (hour < DYNAMIC_SLOT_START_HOUR || hour > DYNAMIC_SLOT_END_HOUR || minute > 10) return "";
  return moscowDateKey(published) + " " + String(hour).padStart(2, "0") + ":00";
}

function dynamicDailyPublishedCount(dayKey) {
  return (state.history || []).filter(function(item) {
    const slot = dynamicScheduledHistorySlot(item);
    return slot && slot.startsWith(dayKey + " ");
  }).length;
}

function dynamicItemTimestamp(item) {
  const candidates = [
    item && item.articlePublishedAt,
    item && item.detectedAt,
    item && item.createdAt,
    item && item.queuedAt
  ].filter(Boolean);
  for (const stamp of candidates) {
    const ms = new Date(stamp).getTime();
    if (Number.isFinite(ms)) return ms;
  }
  return 0;
}

function dynamicItemAgeMs(item) {
  const ms = dynamicItemTimestamp(item);
  if (!ms) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Date.now() - ms);
}

function dynamicItemScore(item) {
  const aiScore = Number(item && item.aiScore);

  if (Number.isFinite(aiScore)) {
    // AI editorial score is the primary ranking signal.
    // Freshness/source/media must never lower a 77-point story below a 75-point story.
    return Math.max(0, Math.min(100, aiScore));
  }

  // Backward compatibility for old queue items created before AI editorial scoring.
  // Keep them eligible, but cap them below newly scored strong news.
  const ageMinutes = dynamicItemAgeMs(item) / 60000;
  return Math.min(74, Math.max(0, 68 - ageMinutes * 0.2));
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
      return item && item.id && item.newsId &&
        item.status !== "media_failed" &&
        !used.has(item.id) && dynamicItemAgeMs(item) <= maxAge;
    })
    .sort(function(a, b) {
      const scoreDiff = dynamicItemScore(b) - dynamicItemScore(a);
      if (scoreDiff) return scoreDiff;

      // Only when AI scores are equal do we use source, media and freshness as tie-breakers.
      const aSource = (state.sources || []).find(function(src){ return src && src.name === a.sourceName; });
      const bSource = (state.sources || []).find(function(src){ return src && src.name === b.sourceName; });
      const aPriority = aSource && Number(aSource.priority) === 1 ? 1 : 0;
      const bPriority = bSource && Number(bSource.priority) === 1 ? 1 : 0;
      if (bPriority !== aPriority) return bPriority - aPriority;

      const aMedia = a.videoUrl ? 2 : ((a.generatedImageUrl || a.imageUrl) ? 1 : 0);
      const bMedia = b.videoUrl ? 2 : ((b.generatedImageUrl || b.imageUrl) ? 1 : 0);
      if (bMedia !== aMedia) return bMedia - aMedia;

      return new Date(b.articlePublishedAt || b.createdAt || 0).getTime() -
        new Date(a.articlePublishedAt || a.createdAt || 0).getTime();
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
  let queueId = schedule.assignments[day] && schedule.assignments[day][time];

  if (!queueId) {
    let lastChanceItem = dynamicAssignBest(day, time);
    if (!lastChanceItem && !collectorRunning) {
      await collectOnce("slot-last-chance");
      lastChanceItem = dynamicAssignBest(day, time);
    }
    queueId = lastChanceItem && lastChanceItem.id || "";
  }

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

  const autoTargets = autoPublishTargetsForPost(item);
  const targets = {
    telegram: autoTargets.telegram && item.telegramPublished !== true,
    vk: autoTargets.vk && item.vkPublished !== true
  };

  if (!targets.telegram && !targets.vk) {
    delete schedule.assignments[day][time];
    state.dynamicScheduler.lastPublishedSlot = slotKey;
    saveState();
    return { ok: true, skipped: "auto_targets_disabled", slot: time };
  }

  const result = await sendMultiPlatformPost(Object.assign({}, item, {
    postId: item.id,
    topicId: item.topicId || "default",
    allow_text_fallback: allowTextFallbackForPost(item)
  }), targets);
  const publishedAt = new Date().toISOString();

  if (result.telegramPublished) {
    item.telegramPublished = true;
    item.telegramMessageId = result.message_id;
    item.telegramPublishedAt = publishedAt;
  }
  if (result.vkPublished) {
    item.vkPublished = true;
    item.vkPostId = result.vkPostId || null;
    item.vkStatus = "published";
    item.vkPublishedAt = publishedAt;
  } else if (result.vkStatus === "media_failed") {
    item.status = "media_failed";
    item.vkStatus = "media_failed";
    item.vkError = result.vkError || "";
    item.vkErrorCode = result.vkErrorCode;
    item.vkMediaAttempts = result.vkMediaAttempts || 3;
    item.vkFailedAt = publishedAt;
  }

  let historyItem = item.historyId
    ? (state.history || []).find(function(h){ return h && h.id === item.historyId; })
    : null;

  if (!historyItem && (result.telegramPublished || result.vkPublished)) {
    historyItem = {
      id: newId("hist"),
      queueId: item.id,
      newsId: item.newsId || "",
      title: item.title || "Публикация",
      text: result.publishedText || item.text || "",
      messageId: result.message_id || item.telegramMessageId || null,
      vkPostId: result.vkPostId || item.vkPostId || null,
      vkStatus: result.vkStatus || item.vkStatus || "",
      vkError: result.vkError || item.vkError || "",
      vkPreviewSlug: result.vkPreviewSlug || item.vkPreviewSlug || "",
      vkPreviewUrl: result.vkPreviewUrl || item.vkPreviewUrl || "",
      publishedAt: publishedAt,
      sourceUrl: item.sourceUrl || "",
      imageUrl: item.imageUrl || "",
      originalImageUrl: item.originalImageUrl || item.imageUrl || "",
      generatedImageUrl: item.generatedImageUrl || "",
      videoUrl: item.videoUrl || "",
      mediaType: item.mediaType || "",
      mediaStatus: item.mediaStatus || "",
      publicationOrigin: "schedule",
      scheduledSlot: slotKey
    };
    state.history.unshift(historyItem);
    state.history = state.history.slice(0, 300);
    item.historyId = historyItem.id;
    state.stats.published = Number(state.stats.published || 0) + 1;
  } else if (historyItem) {
    historyItem.messageId = historyItem.messageId || result.message_id || item.telegramMessageId || null;
    historyItem.vkPostId = result.vkPostId || historyItem.vkPostId || null;
    historyItem.vkStatus = result.vkStatus || item.vkStatus || historyItem.vkStatus || "";
    historyItem.vkError = result.vkError || item.vkError || "";
    historyItem.vkPreviewSlug = result.vkPreviewSlug || historyItem.vkPreviewSlug || "";
    historyItem.vkPreviewUrl = result.vkPreviewUrl || historyItem.vkPreviewUrl || "";
    historyItem.publicationOrigin = "schedule";
    historyItem.scheduledSlot = slotKey;
  }

  delete schedule.assignments[day][time];
  state.dynamicScheduler.lastPublishedSlot = slotKey;
  state.dynamicScheduler.lastPublishedAt = publishedAt;

  const mediaFailed = result.vkStatus === "media_failed";
  if (!mediaFailed && (!targets.telegram || item.telegramPublished) && (!targets.vk || item.vkPublished)) {
    state.queue = (state.queue || []).filter(function(q){ return q.id !== queueId; });
  }

  if (db && dbReady && item.newsId) {
    try {
      const dbStatus = mediaFailed ? "media_failed" : "published";
      await db.query(
        "UPDATE news_items SET status=$2, telegram_message_id=COALESCE($3,telegram_message_id), published_at=COALESCE($4,published_at), metadata=COALESCE(metadata,'{}'::jsonb) || $5::jsonb, vk_post_id=COALESCE($6,vk_post_id), vk_status=$7, vk_error_code=$8, vk_error_msg=$9, vk_media_attempts=$10, updated_at=NOW() WHERE id=$1",
        [
          item.newsId,
          dbStatus,
          result.message_id || item.telegramMessageId || null,
          (result.telegramPublished || result.vkPublished) ? publishedAt : null,
          JSON.stringify({
            vkPostId: result.vkPostId || item.vkPostId || null,
            vkStatus: result.vkStatus || item.vkStatus || "",
            vkError: result.vkError || item.vkError || "",
            vkErrorCode: result.vkErrorCode == null ? null : result.vkErrorCode,
            vkMediaAttempts: result.vkMediaAttempts || item.vkMediaAttempts || 0
          }),
          result.vkPostId || item.vkPostId || null,
          result.vkStatus || item.vkStatus || "",
          result.vkErrorCode == null ? (item.vkErrorCode == null ? null : String(item.vkErrorCode)) : String(result.vkErrorCode),
          result.vkError || item.vkError || "",
          Number(result.vkMediaAttempts || item.vkMediaAttempts || 0)
        ]
      );
    } catch (error) {
      console.warn("Dynamic publish DB update failed:", error.message);
    }
  }

  saveState();
  return {
    ok: !mediaFailed,
    published: Boolean(result.telegramPublished || result.vkPublished),
    status: mediaFailed ? "media_failed" : "published",
    messageId: result.message_id || item.telegramMessageId || null,
    vkPostId: result.vkPostId || item.vkPostId || null,
    vkStatus: result.vkStatus || item.vkStatus || "",
    vkError: result.vkError || item.vkError || "",
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

async function discoverTelegramAlertChat() {
  if (TELEGRAM_ALERT_CHAT_ID || String(state.telegramAlertChatId || "").trim() || !BOT_TOKEN) return false;
  try {
    const updates = await telegramApi("getUpdates", {
      limit: 100,
      allowed_updates: ["message"]
    });
    const ids = new Set();
    (Array.isArray(updates) ? updates : []).forEach(function(update) {
      const chat = update && update.message && update.message.chat;
      if (chat && chat.type === "private" && chat.id != null) ids.add(String(chat.id));
    });
    if (ids.size === 1) {
      state.telegramAlertChatId = Array.from(ids)[0];
      saveState();
      console.log("Telegram private alert chat discovered");
      return true;
    }
    console.log("Telegram alert chat discovery skipped: private chat count=" + ids.size);
  } catch (error) {
    console.warn("Telegram alert chat discovery failed:", error.message);
  }
  return false;
}

function getVkUserToken() {
  return String(process.env.VK_USER_TOKEN || "").trim();
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function secretMatches(provided, expected) {
  const a = Buffer.from(String(provided || ""));
  const b = Buffer.from(String(expected || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createVkPkcePair() {
  const verifier = base64Url(crypto.randomBytes(64));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier: verifier, challenge: challenge };
}

function buildVkOAuthUrl() {
  if (!VK_APP_ID) throw new Error("VK_APP_ID не задан");
  const oauthState = base64Url(crypto.randomBytes(24));
  const pkce = createVkPkcePair();
  vkOAuthSession = {
    mode: "vkid",
    state: oauthState,
    codeVerifier: pkce.verifier,
    createdAt: Date.now()
  };

  const params = new URLSearchParams({
    client_id: VK_APP_ID,
    app_id: VK_APP_ID,
    redirect_uri: VK_OAUTH_REDIRECT_URI,
    response_type: "code",
    code_challenge: pkce.challenge,
    code_challenge_method: "s256",
    scope: VK_OAUTH_SCOPE,
    state: oauthState,
    prompt: "consent",
    v: "2.6.1",
    sdk_type: "vkid"
  });
  return "https://id.vk.ru/authorize?" + params.toString();
}

function assertVkOAuthSession(returnedState) {
  const session = vkOAuthSession;
  if (!session || !session.state) throw new Error("Сессия VK OAuth не найдена. Запустите авторизацию заново.");
  if (Date.now() - Number(session.createdAt || 0) > VK_OAUTH_TTL_MS) {
    vkOAuthSession = null;
    throw new Error("Сессия VK OAuth истекла. Запустите авторизацию заново.");
  }
  if (!returnedState || returnedState !== session.state) throw new Error("VK OAuth state не совпал.");
  return session;
}

async function captureVkOAuthToken(accessToken, returnedState, userId, extra) {
  const token = String(accessToken || "").trim();
  if (!token) throw new Error("VK не вернул access_token.");
  assertVkOAuthSession(String(returnedState || ""));

  await vkApi(
    "photos.getWallUploadServer",
    { group_id: VK_GROUP_ID },
    {
      token: token,
      tokenKind: "oauth-user",
      context: { topicId: "system", postId: "oauth-verify", attempt: 1 }
    }
  );

  const details = extra || {};
  vkOAuthHandoff = {
    accessToken: token,
    refreshToken: String(details.refreshToken || ""),
    deviceId: String(details.deviceId || ""),
    expiresIn: Number(details.expiresIn || 0) || 0,
    scope: String(details.scope || ""),
    userId: String(userId || ""),
    createdAt: Date.now()
  };
  vkOAuthSession = null;
  return { ok: true };
}

async function exchangeVkIdAuthorizationCode(code, deviceId, returnedState) {
  const session = assertVkOAuthSession(String(returnedState || ""));
  if (!session.codeVerifier) throw new Error("VK OAuth PKCE verifier не найден.");
  if (!code) throw new Error("VK не вернул authorization code.");
  if (!deviceId) throw new Error("VK не вернул device_id.");

  const query = new URLSearchParams({
    grant_type: "authorization_code",
    redirect_uri: VK_OAUTH_REDIRECT_URI,
    client_id: VK_APP_ID,
    code_verifier: session.codeVerifier,
    state: String(returnedState || ""),
    device_id: String(deviceId || "")
  });

  const response = await fetch("https://id.vk.ru/oauth2/auth?" + query.toString(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: String(code) }).toString(),
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json().catch(function(){ return {}; });
  if (!response.ok || data.error) {
    const message = String(data.error_description || data.error || ("HTTP " + response.status));
    throw new Error("VK ID token exchange: " + message);
  }
  if (String(data.state || "") !== String(returnedState || "")) {
    throw new Error("VK ID state не совпал после обмена кода.");
  }

  await captureVkOAuthToken(data.access_token, returnedState, data.user_id, {
    refreshToken: data.refresh_token,
    deviceId: deviceId,
    expiresIn: data.expires_in,
    scope: data.scope
  });
  return data;
}

function vkOAuthCallbackHtml(ok, message) {
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


function vkPostContext(post, extra) {
  const p = post || {};
  return Object.assign({
    topicId: String(p.topicId || p.topic_id || "default"),
    postId: String(p.postId || p.id || p.newsId || "unknown"),
    slug: String(p.slug || p.previewSlug || p.vkPreviewSlug || "")
  }, extra || {});
}

function vkErrorPayload(method, errorCode, errorMsg, context) {
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

function logVkError(method, errorCode, errorMsg, context) {
  const payload = vkErrorPayload(method, errorCode, errorMsg, context);
  console.error("VK_API_ERROR " + JSON.stringify(payload));
}

function createVkError(method, errorCode, errorMsg, context) {
  const error = new Error("VK " + method + " " + (errorCode == null ? "error" : errorCode) + ": " + String(errorMsg || "unknown error"));
  error.vkMethod = method;
  error.vkErrorCode = errorCode;
  error.vkErrorMsg = String(errorMsg || "");
  error.vkContext = context || {};
  return error;
}

async function vkApi(method, params, options) {
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
    logVkError(method, code, msg, context);
    throw createVkError(method, code, msg, context);
  }

  console.log("VK_API_RESULT " + JSON.stringify(vkErrorPayload(method, null, "", context)));
  return data.response;
}

function formatVkPost(post, options) {
  const opts = options || {};
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
  if (opts.includeSource !== false && sourceUrl) out += (out ? "\n\n" : "") + "Источник: " + sourceUrl;
  return out.trim();
}

function sleepMs(ms) {
  return new Promise(function(resolve){ setTimeout(resolve, ms); });
}

function topicSettingsForPost(post) {
  const p = post || {};
  const topicId = String(p.topicId || p.topic_id || "default");
  const topics = state && state.topicSettings && typeof state.topicSettings === "object" ? state.topicSettings : {};
  return topics[topicId] || topics.default || {};
}

function allowTextFallbackForPost(post) {
  const topic = topicSettingsForPost(post);
  return topic.allow_text_fallback === true || topic.allowTextFallback === true;
}

function autoPublishTargetsForPost(post) {
  const topic = topicSettingsForPost(post);
  return {
    telegram: topic.auto_publish_telegram !== false,
    vk: topic.auto_publish_vk !== false
  };
}

async function notifyVkMediaFailure(post, error, attempts) {
  const errorContext = error && error.vkContext || {};
  const context = vkPostContext(post, errorContext);
  const text = [
    "⚠️ News Factory: VK media_failed",
    "Тема: " + context.topicId,
    "Пост: " + context.postId,
    context.slug ? ("Slug: " + context.slug) : "",
    "Попыток: " + String(attempts == null ? 1 : attempts),
    "Ошибка: " + String(error && (error.vkErrorMsg || error.message) || "неизвестная ошибка")
  ].filter(Boolean).join("\n");

  const alertChatId = TELEGRAM_ALERT_CHAT_ID || String(state.telegramAlertChatId || "").trim();
  if (!alertChatId) {
    console.warn("VK_MEDIA_ALERT_SKIPPED " + JSON.stringify({
      topic_id: context.topicId,
      post_id: context.postId,
      slug: context.slug || "",
      reason: "No private Telegram alert chat discovered/configured"
    }));
    return false;
  }

  try {
    await telegramApi("sendMessage", {
      chat_id: alertChatId,
      text: text,
      disable_web_page_preview: true
    });
    return true;
  } catch (alertError) {
    console.error("VK_MEDIA_ALERT_FAILED " + JSON.stringify({
      topic_id: context.topicId,
      post_id: context.postId,
      error: String(alertError && alertError.message || alertError)
    }));
    return false;
  }
}

async function downloadVkImage(imageUrl, context) {
  let sourceUrl = String(imageUrl || "").trim();
  if (!sourceUrl) throw createVkError("image.download", "no_image", "No image URL for VK publication", context);
  if (sourceUrl.startsWith("/")) sourceUrl = PUBLIC_BASE_URL + sourceUrl;

  let response;
  try {
    response = await fetch(sourceUrl, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; NewsFactoryVK/1.0)" },
      signal: AbortSignal.timeout(30000)
    });
  } catch (error) {
    logVkError("image.download", "network", error && error.message || error, context);
    throw createVkError("image.download", "network", error && error.message || error, context);
  }

  if (!response.ok) {
    logVkError("image.download", response.status, "Image HTTP " + response.status, context);
    throw createVkError("image.download", response.status, "Image HTTP " + response.status, context);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) {
    logVkError("image.download", "empty", "Downloaded image is empty", context);
    throw createVkError("image.download", "empty", "Downloaded image is empty", context);
  }

  const mime = String(response.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  return { bytes: bytes, mime: mime, ext: ext };
}

async function uploadVkWallPhoto(imageUrl, post) {
  const baseContext = vkPostContext(post);
  if (!getVkUserToken()) {
    const error = createVkError("photos.getWallUploadServer", "user_token_missing", "VK_USER_TOKEN is not configured", baseContext);
    logVkError("photos.getWallUploadServer", error.vkErrorCode, error.vkErrorMsg, Object.assign({}, baseContext, { attempt: 1, tokenKind: "user" }));
    error.mediaFailed = true;
    error.mediaAttempts = 0;
    throw error;
  }

  const image = await downloadVkImage(imageUrl, baseContext);
  let lastError = null;
  const delays = [1000, 2500];

  for (let attempt = 1; attempt <= 3; attempt++) {
    const context = Object.assign({}, baseContext, { attempt: attempt, tokenKind: "user" });
    try {
      const uploadServer = await vkApi(
        "photos.getWallUploadServer",
        { group_id: VK_GROUP_ID },
        { token: getVkUserToken(), tokenKind: "user", context: context }
      );
      if (!uploadServer || !uploadServer.upload_url) {
        logVkError("photos.getWallUploadServer", "no_upload_url", "VK did not return upload_url", context);
        throw createVkError("photos.getWallUploadServer", "no_upload_url", "VK did not return upload_url", context);
      }

      const form = new FormData();
      form.append("photo", new Blob([image.bytes], { type: image.mime }), "news." + image.ext);

      let uploadResponse;
      let uploaded = {};
      try {
        uploadResponse = await fetch(uploadServer.upload_url, {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(45000)
        });
        uploaded = await uploadResponse.json().catch(function(){ return {}; });
      } catch (error) {
        logVkError("photo.upload", "network", error && error.message || error, context);
        throw createVkError("photo.upload", "network", error && error.message || error, context);
      }

      if (!uploadResponse.ok || !uploaded.server || !uploaded.photo || !uploaded.hash) {
        const msg = uploaded && uploaded.error ? JSON.stringify(uploaded.error) : ("Invalid upload response HTTP " + uploadResponse.status);
        logVkError("photo.upload", uploadResponse.status || "upload_invalid", msg, context);
        throw createVkError("photo.upload", uploadResponse.status || "upload_invalid", msg, context);
      }

      const saved = await vkApi(
        "photos.saveWallPhoto",
        {
          group_id: VK_GROUP_ID,
          server: uploaded.server,
          photo: uploaded.photo,
          hash: uploaded.hash
        },
        { token: getVkUserToken(), tokenKind: "user", context: context }
      );

      const photo = Array.isArray(saved) ? saved[0] : (saved && saved.items ? saved.items[0] : null);
      if (!photo || !photo.id || !photo.owner_id) {
        logVkError("photos.saveWallPhoto", "invalid_photo", "VK did not return saved photo owner_id/id", context);
        throw createVkError("photos.saveWallPhoto", "invalid_photo", "VK did not return saved photo owner_id/id", context);
      }

      return {
        attachment: "photo" + photo.owner_id + "_" + photo.id,
        attempts: attempt,
        ownerId: photo.owner_id,
        photoId: photo.id
      };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleepMs(delays[attempt - 1]);
    }
  }

  const failed = lastError || createVkError("photo.upload", "unknown", "VK photo upload failed", baseContext);
  failed.mediaFailed = true;
  failed.mediaAttempts = 3;
  throw failed;
}


function vkPostGuid(post, mode) {
  const p = post || {};
  const identity = String(p.postId || p.id || p.newsId || "unknown") + ":" + String(mode || "default");
  return "nf_" + crypto.createHash("sha256").update(identity).digest("hex").slice(0, 28);
}

function isVkLinkPreviewError(error) {
  const code = String(error && error.vkErrorCode == null ? "" : error.vkErrorCode);
  const msg = String(error && (error.vkErrorMsg || error.message) || "").toLowerCase();
  return code === "100" && (msg.includes("link_photo_sizing_rule") || msg.includes("no photo given"));
}

async function loadVkImageBytes(imageUrl, context) {
  // Prepared preview images live on our own volume: read the file directly instead of
  // making an HTTP round trip to our own public URL.
  const localPath = localMediaPathFromUrl(imageUrl);
  if (localPath) {
    try {
      const bytes = fs.readFileSync(localPath);
      if (bytes.length) {
        const lower = localPath.toLowerCase();
        const ext = lower.endsWith(".png") ? "png" : lower.endsWith(".webp") ? "webp" : "jpg";
        const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
        return { bytes: bytes, mime: mime, ext: ext };
      }
    } catch (error) {
      console.warn("VK_LOCAL_IMAGE_READ_FAILED " + JSON.stringify({
        post_id: String(context && context.postId || "unknown"),
        error: String(error && error.message || error)
      }));
    }
  }
  return downloadVkImage(imageUrl, context);
}

async function uploadVkMessagesPhotoWithRetry(imageUrl, post, previewSlug) {
  // VK sometimes answers with an empty "photo" field or a transient 901/network error,
  // so retry a few times with backoff before giving up on this media mode.
  const delays = [1500, 4000];
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const photo = await uploadVkMessagesPhoto(imageUrl, post, previewSlug);
      photo.attempts = attempt;
      return photo;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleepMs(delays[attempt - 1]);
    }
  }
  lastError.mediaAttempts = 3;
  throw lastError;
}

async function uploadVkMessagesPhoto(imageUrl, post, previewSlug) {
  const context = vkPostContext(post, { slug: previewSlug || "", tokenKind: "community" });
  const image = await loadVkImageBytes(imageUrl, context);

  const uploadServer = await vkApi(
    "photos.getMessagesUploadServer",
    {},
    { token: VK_ACCESS_TOKEN, tokenKind: "community", context: context }
  );
  if (!uploadServer || !uploadServer.upload_url) {
    throw createVkError("photos.getMessagesUploadServer", "no_upload_url", "VK did not return messages upload_url", context);
  }

  const form = new FormData();
  form.append("photo", new Blob([image.bytes], { type: image.mime || "image/jpeg" }), "preview." + (image.ext || "jpg"));

  let uploadResponse;
  let uploaded = {};
  try {
    uploadResponse = await fetch(uploadServer.upload_url, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(45000)
    });
    uploaded = await uploadResponse.json().catch(function(){ return {}; });
  } catch (error) {
    logVkError("messages-photo.upload", "network", error && error.message || error, context);
    throw createVkError("messages-photo.upload", "network", error && error.message || error, context);
  }

  if (!uploadResponse.ok || !uploaded.server || !uploaded.photo || !uploaded.hash) {
    const safeShape = {
      http: uploadResponse.status,
      keys: uploaded && typeof uploaded === "object" ? Object.keys(uploaded).sort() : [],
      has_server: Boolean(uploaded && uploaded.server),
      photo_length: uploaded && uploaded.photo != null ? String(uploaded.photo).length : 0,
      hash_length: uploaded && uploaded.hash != null ? String(uploaded.hash).length : 0
    };
    const msg = uploaded && uploaded.error ? "VK upload returned error" : ("Invalid messages photo upload response " + JSON.stringify(safeShape));
    logVkError("messages-photo.upload", uploadResponse.status || "upload_invalid", msg, context);
    throw createVkError("messages-photo.upload", uploadResponse.status || "upload_invalid", msg, context);
  }

  const saved = await vkApi(
    "photos.saveMessagesPhoto",
    {
      server: uploaded.server,
      photo: uploaded.photo,
      hash: uploaded.hash
    },
    { token: VK_ACCESS_TOKEN, tokenKind: "community", context: context }
  );

  const photo = Array.isArray(saved) ? saved[0] : (saved && saved.items ? saved.items[0] : null);
  if (!photo || !photo.id || !photo.owner_id) {
    logVkError("photos.saveMessagesPhoto", "invalid_photo", "VK did not return saved messages photo owner_id/id", context);
    throw createVkError("photos.saveMessagesPhoto", "invalid_photo", "VK did not return saved messages photo owner_id/id", context);
  }

  let attachment = "photo" + photo.owner_id + "_" + photo.id;
  if (photo.access_key) attachment += "_" + photo.access_key;
  return {
    attachment: attachment,
    ownerId: photo.owner_id,
    photoId: photo.id
  };
}

async function uploadVkWallImageDocument(imageUrl, post, previewSlug) {
  const context = vkPostContext(post, { slug: previewSlug || "", tokenKind: "community" });
  const image = await downloadVkImage(imageUrl, context);
  const uploadServer = await vkApi(
    "docs.getWallUploadServer",
    { group_id: VK_GROUP_ID },
    { token: VK_ACCESS_TOKEN, tokenKind: "community", context: context }
  );
  if (!uploadServer || !uploadServer.upload_url) {
    throw createVkError("docs.getWallUploadServer", "no_upload_url", "VK did not return document upload_url", context);
  }

  const form = new FormData();
  form.append("file", new Blob([image.bytes], { type: image.mime || "image/jpeg" }), "preview." + (image.ext || "jpg"));

  let uploadedResponse;
  let uploaded = {};
  try {
    uploadedResponse = await fetch(uploadServer.upload_url, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(45000)
    });
    uploaded = await uploadedResponse.json().catch(function(){ return {}; });
  } catch (error) {
    logVkError("doc.upload", "network", error && error.message || error, context);
    throw createVkError("doc.upload", "network", error && error.message || error, context);
  }

  if (!uploadedResponse.ok || !uploaded.file) {
    const msg = uploaded && uploaded.error ? JSON.stringify(uploaded.error) : ("Invalid doc upload response HTTP " + uploadedResponse.status);
    logVkError("doc.upload", uploadedResponse.status || "upload_invalid", msg, context);
    throw createVkError("doc.upload", uploadedResponse.status || "upload_invalid", msg, context);
  }

  const saved = await vkApi(
    "docs.save",
    {
      file: uploaded.file,
      title: String(post && post.title || "News Factory").slice(0, 120)
    },
    { token: VK_ACCESS_TOKEN, tokenKind: "community", context: context }
  );

  const doc = saved && saved.doc ? saved.doc : (Array.isArray(saved) ? saved[0] : null);
  if (!doc || !doc.id || !doc.owner_id) {
    logVkError("docs.save", "invalid_doc", "VK did not return saved document owner_id/id", context);
    throw createVkError("docs.save", "invalid_doc", "VK did not return saved document owner_id/id", context);
  }

  return {
    attachment: "doc" + doc.owner_id + "_" + doc.id,
    ownerId: doc.owner_id,
    docId: doc.id
  };
}

async function publishVkPost(post) {
  if (!VK_PUBLISH_ENABLED) return null;
  const baseContext = vkPostContext(post);
  if (!VK_ACCESS_TOKEN || !VK_GROUP_ID || !VK_OWNER_ID) {
    const error = createVkError("wall.post", "config_missing", "VK community publishing configuration is incomplete", baseContext);
    logVkError("wall.post", error.vkErrorCode, error.vkErrorMsg, Object.assign({}, baseContext, { tokenKind: "community" }));
    throw error;
  }

  let preview = null;
  try {
    preview = await createPublicPostPage(post);
    await preflightPublicPostPage(preview);
  } catch (cause) {
    const context = Object.assign({}, baseContext, { slug: preview && preview.slug || "" });
    const error = createVkError("preview.preflight", "preview_failed", String(cause && cause.message || cause), context);
    error.mediaFailed = true;
    error.mediaAttempts = 1;
    error.previewSlug = context.slug;
    error.vkContext = context;
    if (preview && preview.slug) await markPublicPostPreflightFailed(preview.slug, error);
    logVkError("preview.preflight", error.vkErrorCode, error.vkErrorMsg, context);
    await notifyVkMediaFailure(post, error, 1);
    throw error;
  }

  const context = Object.assign({}, baseContext, { slug: preview.slug });
  const baseMessage = formatVkPost(post, { includeSource: false });

  // Primary mode: upload the prepared 1200x630 JPEG through the community-token messages
  // upload server and attach it to the wall post as a real photo. VK's link snippet
  // (link_preview below) is unreliable for community tokens ("link_photo_sizing_rule").
  let photoAttempts = 0;
  try {
    const photo = await uploadVkMessagesPhotoWithRetry(preview.imageUrl, post, preview.slug);
    photoAttempts = Number(photo.attempts || 1);
    const photoResult = await vkApi(
      "wall.post",
      {
        owner_id: VK_OWNER_ID,
        from_group: 1,
        message: baseMessage,
        attachments: photo.attachment,
        guid: vkPostGuid(post, "photo")
      },
      { token: VK_ACCESS_TOKEN, tokenKind: "community", context: context }
    );

    await markPublicPostPublished(preview.slug, photoResult && photoResult.post_id);
    if (photoResult && typeof photoResult === "object") {
      photoResult.mediaMode = "photo_upload";
      photoResult.mediaAttempts = photoAttempts;
      photoResult.previewSlug = preview.slug;
      photoResult.previewUrl = preview.url;
      photoResult.previewImageUrl = preview.imageUrl;
      console.log("VK_POST_PUBLISHED " + JSON.stringify({
        post_id: photoResult.post_id || null,
        slug: preview.slug,
        media_mode: photoResult.mediaMode,
        attachment: photo.attachment
      }));
    }
    return photoResult || null;
  } catch (photoError) {
    if (!photoAttempts) photoAttempts = Number(photoError && photoError.mediaAttempts || 1);
    // A network error on wall.post itself is ambiguous (the post may already exist),
    // so do not fall through to another mode and risk a duplicate.
    if (photoError && photoError.vkMethod === "wall.post" && photoError.vkErrorCode === "network") {
      photoError.mediaFailed = true;
      photoError.mediaAttempts = photoAttempts || 1;
      photoError.previewSlug = preview.slug;
      await markPublicPostVkFailed(preview.slug, photoError);
      await notifyVkMediaFailure(post, photoError, photoError.mediaAttempts);
      throw photoError;
    }
    console.warn("VK_PHOTO_UPLOAD_MODE_FAILED " + JSON.stringify({
      post_id: context.postId,
      slug: preview.slug,
      error_code: photoError && photoError.vkErrorCode != null ? photoError.vkErrorCode : null,
      error_msg: String(photoError && (photoError.vkErrorMsg || photoError.message) || photoError)
    }));
  }

  try {
    const result = await vkApi(
      "wall.post",
      {
        owner_id: VK_OWNER_ID,
        from_group: 1,
        message: baseMessage,
        attachments: preview.url,
        guid: vkPostGuid(post, "link")
      },
      { token: VK_ACCESS_TOKEN, tokenKind: "community", context: context }
    );

    await markPublicPostPublished(preview.slug, result && result.post_id);
    if (result && typeof result === "object") {
      result.mediaMode = "link_preview";
      result.mediaAttempts = photoAttempts + 1;
      result.previewSlug = preview.slug;
      result.previewUrl = preview.url;
      result.previewImageUrl = preview.imageUrl;
      console.log("VK_POST_PUBLISHED " + JSON.stringify({
        post_id: result.post_id || null,
        slug: preview.slug,
        media_mode: result.mediaMode
      }));
    }
    return result || null;
  } catch (error) {
    error.mediaAttempts = photoAttempts + 1;
    error.previewSlug = preview.slug;
    error.vkContext = Object.assign({}, error.vkContext || context, { slug: preview.slug });
    await markPublicPostVkFailed(preview.slug, error);

    if (!allowTextFallbackForPost(post)) {
      error.mediaFailed = true;
      await notifyVkMediaFailure(post, error, error.mediaAttempts);
      throw error;
    }

    await notifyVkMediaFailure(post, error, error.mediaAttempts);
    const fallback = await vkApi(
      "wall.post",
      {
        owner_id: VK_OWNER_ID,
        from_group: 1,
        message: baseMessage,
        guid: vkPostGuid(post, "text")
      },
      { token: VK_ACCESS_TOKEN, tokenKind: "community", context: context }
    );

    if (fallback && typeof fallback === "object") {
      fallback.mediaMode = "text_fallback";
      fallback.mediaAttempts = photoAttempts + 2;
      fallback.previewSlug = preview.slug;
      fallback.previewUrl = preview.url;
      fallback.previewImageUrl = preview.imageUrl;
      console.log("VK_POST_PUBLISHED " + JSON.stringify({
        post_id: fallback.post_id || null,
        slug: preview.slug,
        media_mode: fallback.mediaMode
      }));
    }
    return fallback || null;
  }
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
    vkStatus: selected.vk ? "pending" : "not_selected",
    vkMediaAttempts: 0,
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
      result.vkStatus = "failed";
      result.vkError = "VK не настроен для публикации";
    } else {
      try {
        const vk = await publishVkPost(prepared);
        if (vk && vk.post_id) {
          result.vkPostId = vk.post_id;
          result.vkPublished = true;
          result.vkStatus = "published";
          result.vkMediaMode = vk.mediaMode || "";
          result.vkMediaAttempts = Number(vk.mediaAttempts || 0);
          result.vkPreviewSlug = vk.previewSlug || "";
          result.vkPreviewUrl = vk.previewUrl || "";
          result.vkPreviewImageUrl = vk.previewImageUrl || "";
        }
      } catch (error) {
        result.vkStatus = error && error.mediaFailed ? "media_failed" : "failed";
        result.vkMediaAttempts = Number(error && error.mediaAttempts || 0);
        result.vkErrorCode = error && error.vkErrorCode != null ? error.vkErrorCode : null;
        result.vkError = String(error && (error.vkErrorMsg || error.message) || error);
        result.vkPreviewSlug = String(error && error.previewSlug || "");
        result.vkPreviewUrl = result.vkPreviewSlug ? previewPageUrl(result.vkPreviewSlug) : "";
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
    "ОЦЕНКА РЕДАКЦИОННОЙ СИЛЫ НОВОСТИ:",
    "- оцени саму новость, а не качество своего текста;",
    "- importance 0–25: масштаб события и влияние;",
    "- audience_interest 0–20: насколько это интересно широкой аудитории канала про ИИ;",
    "- novelty 0–20: новизна и необычность;",
    "- virality 0–15: вероятность обсуждений, пересылок и реакций;",
    "- usefulness 0–10: практическая ценность для читателя;",
    "- credibility 0–10: надёжность и прямота источника;",
    "- editorial_score — сумма этих шести оценок, строго 0–100;",
    "- score_reason — одна короткая причина оценки без выдумывания фактов.",
    "",
    "Верни СТРОГО JSON без кодового блока:",
    "{\"title\":\"...\",\"text\":\"...\",\"confidence\":\"high|medium|low\",\"notes\":\"...\",\"editorial_score\":0,\"score_breakdown\":{\"importance\":0,\"audience_interest\":0,\"novelty\":0,\"virality\":0,\"usefulness\":0,\"credibility\":0},\"score_reason\":\"...\"}",
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
      const rawBreakdown = parsed.score_breakdown && typeof parsed.score_breakdown === "object" ? parsed.score_breakdown : {};
      const clampScore = function(value, max) {
        const n = Number(value);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.min(max, Math.round(n)));
      };
      const breakdown = {
        importance: clampScore(rawBreakdown.importance, 25),
        audience_interest: clampScore(rawBreakdown.audience_interest, 20),
        novelty: clampScore(rawBreakdown.novelty, 20),
        virality: clampScore(rawBreakdown.virality, 15),
        usefulness: clampScore(rawBreakdown.usefulness, 10),
        credibility: clampScore(rawBreakdown.credibility, 10)
      };
      const breakdownTotal = Object.values(breakdown).reduce(function(sum, value){ return sum + value; }, 0);
      const parsedScore = Number(parsed.editorial_score);
      const editorialScore = breakdownTotal > 0
        ? Math.max(0, Math.min(100, breakdownTotal))
        : (Number.isFinite(parsedScore) ? Math.max(0, Math.min(100, Math.round(parsedScore))) : 50);
      const result = {
        title: String(parsed.title || title || "Что там у ИИ?").trim(),
        text: String(parsed.text || "").trim(),
        confidence: ["high","medium","low"].includes(String(parsed.confidence)) ? String(parsed.confidence) : "medium",
        notes: String(parsed.notes || "").trim(),
        editorialScore: editorialScore,
        scoreBreakdown: breakdown,
        scoreReason: String(parsed.score_reason || "").trim(),
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

async function callOpenAIEditorialScoreBatch(items) {
  if (!OPENAI_API_KEY || !Array.isArray(items) || !items.length) return [];
  const compact = items.slice(0, 10).map(function(item) {
    return {
      id: String(item.id || ""),
      title: String(item.title || "").slice(0, 240),
      source: String(item.sourceName || "").slice(0, 120),
      text: String(item.text || "").slice(0, 1800)
    };
  });
  const prompt = [
    "Ты выпускающий редактор новостного канала «Что там у ИИ?».",
    "Оцени каждую новость отдельно. Не переписывай текст и не добавляй факты.",
    "Шкала строго 0–100 как сумма:",
    "importance 0–25, audience_interest 0–20, novelty 0–20, virality 0–15, usefulness 0–10, credibility 0–10.",
    "Верни строго JSON без markdown:",
    "{\"scores\":[{\"id\":\"...\",\"editorial_score\":0,\"score_breakdown\":{\"importance\":0,\"audience_interest\":0,\"novelty\":0,\"virality\":0,\"usefulness\":0,\"credibility\":0},\"score_reason\":\"короткая причина\"}]}",
    "",
    JSON.stringify(compact)
  ].join("\n");

  const candidates = [OPENAI_MODEL, OPENAI_FALLBACK_MODEL].filter(function(v, i, a){ return v && a.indexOf(v) === i; });
  for (const model of candidates) {
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + OPENAI_API_KEY },
        body: JSON.stringify({ model: model, input: prompt, max_output_tokens: 2200 }),
        signal: AbortSignal.timeout(45000)
      });
      const data = await response.json().catch(function(){ return {}; });
      if (!response.ok) continue;
      const output = extractOpenAIText(data);
      if (!output) continue;
      const parsed = JSON.parse(output.replace(/^\s*```json\s*/i, "").replace(/\s*```\s*$/i, ""));
      const scores = Array.isArray(parsed && parsed.scores) ? parsed.scores : [];
      return scores.map(function(entry) {
        const breakdownRaw = entry && entry.score_breakdown && typeof entry.score_breakdown === "object" ? entry.score_breakdown : {};
        const clamp = function(value, max) {
          const n = Number(value);
          return Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n))) : 0;
        };
        const breakdown = {
          importance: clamp(breakdownRaw.importance, 25),
          audience_interest: clamp(breakdownRaw.audience_interest, 20),
          novelty: clamp(breakdownRaw.novelty, 20),
          virality: clamp(breakdownRaw.virality, 15),
          usefulness: clamp(breakdownRaw.usefulness, 10),
          credibility: clamp(breakdownRaw.credibility, 10)
        };
        const total = Object.values(breakdown).reduce(function(sum, value){ return sum + value; }, 0);
        const explicit = Number(entry && entry.editorial_score);
        const editorialScore = total > 0
          ? Math.min(100, total)
          : (Number.isFinite(explicit) ? Math.max(0, Math.min(100, Math.round(explicit))) : null);
        return {
          id: String(entry && entry.id || ""),
          editorialScore: editorialScore,
          scoreBreakdown: breakdown,
          scoreReason: String(entry && entry.score_reason || "").trim()
        };
      }).filter(function(entry){ return entry.id && Number.isFinite(entry.editorialScore); });
    } catch (error) {
      console.warn("AI editorial score batch failed:", error.message);
    }
  }
  return [];
}

async function backfillRecentNewsEditorialScores(limit) {
  if (!db || !dbReady || !OPENAI_API_KEY) return { ok: false, scored: 0, skipped: "unavailable" };
  const safeLimit = Math.max(1, Math.min(40, Number(limit || 30)));
  const cutoff = normalizeDate(state.newsVisibleAfter || "");
  const params = [];
  let where = "(metadata->>'editorialScore' IS NULL OR metadata->>'editorialScore'='') AND COALESCE(rewritten_text, original_text, '') <> ''";
  if (cutoff) {
    params.push(cutoff);
    where += " AND detected_at >= $" + params.length;
  }
  params.push(safeLimit);
  const rows = await db.query(
    `SELECT id, source_name AS "sourceName", COALESCE(rewritten_title, original_title) AS title,
      COALESCE(rewritten_text, original_text) AS text
      FROM news_items
      WHERE ${where}
      ORDER BY detected_at DESC
      LIMIT $${params.length}`,
    params
  );
  if (!rows.rows.length) return { ok: true, scored: 0 };

  let scored = 0;
  for (let offset = 0; offset < rows.rows.length; offset += 10) {
    const batch = rows.rows.slice(offset, offset + 10);
    const scores = await callOpenAIEditorialScoreBatch(batch);
    const allowedIds = new Set(batch.map(function(item){ return String(item.id || ""); }));
    for (const score of scores) {
      if (!allowedIds.has(score.id)) continue;
      const updated = await db.query(
        "UPDATE news_items SET metadata=COALESCE(metadata,'{}'::jsonb) || $2::jsonb, updated_at=NOW() WHERE id=$1",
        [score.id, JSON.stringify({
          editorialScore: score.editorialScore,
          scoreBreakdown: score.scoreBreakdown,
          scoreReason: score.scoreReason,
          scoreBackfilledAt: new Date().toISOString()
        })]
      );
      if (!updated.rowCount) continue;
      const queueItem = (state.queue || []).find(function(q){ return q && q.newsId === score.id; });
      if (queueItem) {
        queueItem.aiScore = score.editorialScore;
        queueItem.aiScoreBreakdown = score.scoreBreakdown;
        queueItem.aiScoreReason = score.scoreReason;
        queueItem.aiTier = score.editorialScore >= AI_TOP_NEWS_SCORE ? "top" : (score.editorialScore >= AI_STRONG_NEWS_SCORE ? "strong" : "normal");
      }
      scored += 1;
    }
  }
  if (scored) saveState();
  return { ok: true, scored: scored };
}

function hasEnv() {
  for (const key of arguments) if (!process.env[key]) return false;
  return true;
}

async function githubAutomationProbe() {
  const repoName = String(process.env.GITHUB_REPOSITORY || "alekseevaleksey18061994-gif/content-factory").trim();
  const headers = {
    "user-agent": "NewsFactoryStatus/1.0",
    "accept": "application/vnd.github+json"
  };
  const result = {
    repo: repoName,
    repoOk: false,
    workflowOk: false,
    latestStatus: "",
    latestConclusion: "",
    latestRunNumber: null,
    error: ""
  };

  try {
    const repoResponse = await fetch("https://api.github.com/repos/" + repoName, {
      headers: headers,
      signal: AbortSignal.timeout(7000)
    });
    result.repoOk = repoResponse.ok;

    const workflowResponse = await fetch("https://api.github.com/repos/" + repoName + "/actions/workflows/claude.yml/runs?per_page=5", {
      headers: headers,
      signal: AbortSignal.timeout(7000)
    });
    const workflowData = await workflowResponse.json().catch(function(){ return {}; });
    if (workflowResponse.ok) {
      result.workflowOk = true;
      const runs = Array.isArray(workflowData.workflow_runs) ? workflowData.workflow_runs : [];
      const run = runs.find(function(item){
        const conclusion = String(item && item.conclusion || "");
        const status = String(item && item.status || "");
        return status === "in_progress" || status === "queued" || (conclusion && conclusion !== "skipped" && conclusion !== "cancelled");
      }) || runs[0] || null;
      if (run) {
        result.latestStatus = String(run.status || "");
        result.latestConclusion = String(run.conclusion || "");
        result.latestRunNumber = run.run_number == null ? null : Number(run.run_number);
      }
    } else {
      result.error = "GitHub Actions HTTP " + workflowResponse.status;
    }
  } catch (error) {
    result.error = String(error && error.message || error);
  }

  return result;
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

  const probes = await Promise.all([
    BOT_TOKEN ? telegramProbe("getMe") : Promise.resolve({ ok: false, error: "TELEGRAM_BOT_TOKEN не задан" }),
    BOT_TOKEN && CHANNEL ? telegramProbe("getChat", { chat_id: CHANNEL }) : Promise.resolve({ ok: false, error: "Канал или токен не заданы" }),
    OPENAI_API_KEY ? openAIModelProbe() : Promise.resolve({ ok: false, error: "OPENAI_API_KEY не задан" }),
    VK_ACCESS_TOKEN && VK_GROUP_ID ? vkProbe() : Promise.resolve({ ok: false, error: "VK не настроен" }),
    githubAutomationProbe()
  ]);
  const botProbe = probes[0];
  const chatProbe = probes[1];
  const openaiProbe = probes[2];
  const vkStatusProbe = probes[3];
  const githubAutomation = probes[4];

  const railwayConnected = Boolean(
    process.env.RAILWAY_PROJECT_ID ||
    process.env.RAILWAY_SERVICE_ID ||
    process.env.RAILWAY_ENVIRONMENT_ID ||
    process.env.RAILWAY_PUBLIC_DOMAIN
  );
  const gitConnected = Boolean(process.env.RAILWAY_GIT_COMMIT_SHA || process.env.RAILWAY_GIT_REPO_NAME || githubAutomation.repoOk);
  const claudeLatestOk = githubAutomation.workflowOk && (
    githubAutomation.latestStatus === "in_progress" ||
    githubAutomation.latestStatus === "queued" ||
    githubAutomation.latestConclusion === "success"
  );
  const publicEndpointOk = /^https:\/\//i.test(String(PUBLIC_BASE_URL || ""));

  const details = {
    railway: {
      state: railwayConnected ? "connected" : "partial",
      description: railwayConnected ? "Production запущен в Railway" : "Сервис работает, системные переменные Railway не найдены",
      detail: process.env.RAILWAY_ENVIRONMENT_NAME ? "Окружение: " + process.env.RAILWAY_ENVIRONMENT_NAME : "Environment: production",
      next: railwayConnected ? "" : "Проверить Railway runtime variables"
    },
    github: {
      state: gitConnected ? "connected" : "partial",
      description: gitConnected ? "GitHub-репозиторий доступен, код используется для деплоя" : "Связь с GitHub подтверждена не полностью",
      detail: process.env.RAILWAY_GIT_COMMIT_SHA
        ? "Commit: " + process.env.RAILWAY_GIT_COMMIT_SHA.slice(0, 8)
        : ("Repo: " + (githubAutomation.repo || "content-factory")),
      next: gitConnected ? "" : "Проверить source connection в Railway"
    },
    claudeCode: {
      state: claudeLatestOk ? "connected" : (githubAutomation.workflowOk ? "partial" : "missing"),
      description: claudeLatestOk ? "Claude Code подключён через GitHub Actions" : (githubAutomation.workflowOk ? "Workflow Claude Code найден, последний запуск требует внимания" : "Workflow Claude Code не подтверждён"),
      detail: githubAutomation.workflowOk
        ? ("Последний run #" + (githubAutomation.latestRunNumber || "—") + " · " + (githubAutomation.latestStatus || "unknown") + (githubAutomation.latestConclusion ? " · " + githubAutomation.latestConclusion : ""))
        : String(githubAutomation.error || "GitHub Actions workflow недоступен"),
      next: claudeLatestOk ? "" : "Проверить Claude Code workflow и ANTHROPIC_API_KEY в GitHub Actions"
    },
    anthropic: {
      state: claudeLatestOk ? "connected" : (githubAutomation.workflowOk ? "partial" : "missing"),
      description: claudeLatestOk ? "Anthropic API подтверждён успешным Claude Code workflow" : "Anthropic API не подтверждён последним workflow",
      detail: claudeLatestOk
        ? "Anthropic подтверждён успешным Claude Code run · значение ANTHROPIC_API_KEY скрыто"
        : (githubAutomation.workflowOk ? "Workflow найден; наличие ANTHROPIC_API_KEY подтвердит следующий успешный run" : "Claude Code workflow недоступен"),
      next: claudeLatestOk ? "" : "Проверить ANTHROPIC_API_KEY и биллинг Anthropic"
    },
    publicEndpoint: {
      state: publicEndpointOk ? "connected" : "missing",
      description: publicEndpointOk ? "Публичный HTTPS endpoint News Factory настроен" : "Публичный HTTPS endpoint не настроен",
      detail: publicEndpointOk ? String(PUBLIC_BASE_URL) + " · /p/ + /media/" : "",
      next: publicEndpointOk ? "" : "Проверить NEWS_FACTORY_PUBLIC_URL и Railway domain"
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
      description: openaiProbe.ok ? "OpenAI API подключён и текстовая модель доступна" : (OPENAI_API_KEY ? "Ключ найден, но API не подтверждён" : "OpenAI API не подключён"),
      detail: openaiProbe.ok ? "Текстовая модель: " + openaiProbe.model : String(openaiProbe.error || "OPENAI_API_KEY отсутствует"),
      next: openaiProbe.ok ? "" : (OPENAI_API_KEY ? "Проверить ключ, доступ к модели и биллинг OpenAI" : "Подключить OpenAI API")
    },
    openaiImage: {
      state: openaiProbe.ok && IMAGE_ENHANCEMENT_ENABLED && OPENAI_IMAGE_MODEL ? "connected" : (OPENAI_API_KEY ? "partial" : "missing"),
      description: openaiProbe.ok && IMAGE_ENHANCEMENT_ENABLED ? "AI-обработка изображений включена" : "AI-обработка изображений настроена не полностью",
      detail: "Модель: " + String(OPENAI_IMAGE_MODEL || "не задана") + " · улучшение фото " + (IMAGE_ENHANCEMENT_ENABLED ? "включено" : "выключено"),
      next: openaiProbe.ok && IMAGE_ENHANCEMENT_ENABLED ? "" : "Проверить IMAGE_ENHANCEMENT_ENABLED и OPENAI_IMAGE_MODEL"
    },
    mediaEngine: {
      state: OPENAI_API_KEY && MEDIA_REQUIRED && GENERATE_COVER_IF_MISSING ? "connected" : (OPENAI_API_KEY ? "partial" : "missing"),
      description: OPENAI_API_KEY && MEDIA_REQUIRED && GENERATE_COVER_IF_MISSING ? "Медиа-движок включён" : "Медиа-движок настроен не полностью",
      detail: "Приоритет: видео → фото → генерация фото · найденные фото можно улучшать через " + OPENAI_IMAGE_MODEL,
      next: OPENAI_API_KEY && MEDIA_REQUIRED && GENERATE_COVER_IF_MISSING ? "" : "Проверить MEDIA_REQUIRED и GENERATE_COVER_IF_MISSING"
    },
    postgresql: {
      state: dbReady ? "connected" : (DATABASE_URL ? "partial" : "missing"),
      description: dbReady ? "PostgreSQL подключён и доступен" : (DATABASE_URL ? "DATABASE_URL задан, база ещё не подтверждена" : "База данных не подключена"),
      detail: dbReady ? "Долговременное хранение news_items, collector_runs и snapshots" : (DATABASE_URL ? "Ожидание подключения PostgreSQL" : "Используется только /data/state.json"),
      next: dbReady ? "" : "Проверить PostgreSQL в Railway"
    },
    vk: {
      state: vkStatusProbe.ok ? "connected" : (VK_ACCESS_TOKEN ? "partial" : "missing"),
      description: vkStatusProbe.ok ? "VK API и сообщество подключены" : (VK_ACCESS_TOKEN ? "VK-токен найден, но API не подтверждён" : "VK ещё не подключён"),
      detail: vkStatusProbe.ok && vkStatusProbe.group
        ? ((vkStatusProbe.group.name || "Что там у ИИ?") + " · " + (VK_PUBLIC_URL || ("ID " + VK_GROUP_ID)) + " · community token")
        : String(vkStatusProbe.error || ""),
      next: vkStatusProbe.ok ? "Довести подтверждённый способ публикации изображения в VK" : "Проверить права ключа сообщества VK"
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
        ? (function(){
            const autoTargets = autoPublishTargetsForPost({ topicId: "default" });
            const platforms = [autoTargets.telegram ? "Telegram" : "", autoTargets.vk ? "VK" : ""].filter(Boolean).join(" + ") || "нет активных площадок";
            return "Окна 08:00–23:00 · поиск за 15 минут · автопубликация " + (AUTO_PUBLISH_ENABLED ? "включена" : "выключена") + " · " + platforms;
          })()
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

    if ((req.method === "GET" || req.method === "HEAD") && p.startsWith("/p/")) {
      const slug = decodeURIComponent(p.slice("/p/".length));
      if (!slug || !/^[a-z0-9_-]{8,120}$/i.test(slug)) return sendJson(res, 404, { ok: false, error: "page not found" });
      const page = await getPublicPostPage(slug);
      if (!page) return sendJson(res, 404, { ok: false, error: "page not found" });
      const body = renderPublicPostPage(page);
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": Buffer.byteLength(body),
        "cache-control": "public, max-age=300, s-maxage=300",
        "x-robots-tag": "index, follow"
      });
      return req.method === "HEAD" ? res.end() : res.end(body);
    }

    if ((req.method === "GET" || req.method === "HEAD") && p.startsWith("/media/")) {
      const fileName = decodeURIComponent(p.slice("/media/".length));
      if (!fileName || fileName !== path.basename(fileName)) return sendJson(res, 400, { ok: false, error: "invalid media path" });
      const filePath = path.join(MEDIA_DIR, fileName);
      try {
        const ext = path.extname(fileName).toLowerCase();
        const type = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "application/octet-stream";
        if (req.method === "HEAD") {
          const stat = fs.statSync(filePath);
          res.writeHead(200, { "content-type": type, "content-length": stat.size, "cache-control": "public, max-age=31536000, immutable" });
          return res.end();
        }
        const body = fs.readFileSync(filePath);
        res.writeHead(200, { "content-type": type, "content-length": body.length, "cache-control": "public, max-age=31536000, immutable" });
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

    if (req.method === "POST" && p === "/internal/vk-preview-test-page") {
      const smokeAuthorized = req.headers["x-admin-key"] === ADMIN_KEY ||
        (VK_OAUTH_HANDOFF_SECRET && secretMatches(req.headers["x-oauth-handoff-secret"], VK_OAUTH_HANDOFF_SECRET));
      if (!smokeAuthorized) return sendJson(res, 401, { ok: false, error: "unauthorized" });
      try {
        const marker = crypto.randomBytes(4).toString("hex");
        const preview = await createPublicPostPage({
          id: "vk_preview_smoke_" + marker,
          postId: "vk_preview_smoke_" + marker,
          topicId: "smoke",
          title: "News Factory VK preview smoke test",
          text: "Тест публичной страницы, Open Graph изображения и VK link preview. Маркер: " + marker,
          sourceName: "News Factory",
          sourceUrl: PUBLIC_BASE_URL + "/health"
        });
        const preflight = await preflightPublicPostPage(preview);
        return sendJson(res, 200, { ok: true, preview: preview, preflight: preflight }, { "cache-control": "no-store" });
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: String(error && error.message || error) }, { "cache-control": "no-store" });
      }
    }

    if (req.method === "GET" && p === "/api/vk/oauth/callback") {
      try {
        let payload = {};
        const rawPayload = url.searchParams.get("payload");
        if (rawPayload) {
          try { payload = JSON.parse(rawPayload); } catch {}
        }
        const code = url.searchParams.get("code") || payload.code || "";
        const deviceId = url.searchParams.get("device_id") || payload.device_id || "";
        const returnedState = url.searchParams.get("state") || payload.state || "";
        const oauthError = url.searchParams.get("error") || payload.error || "";
        if (oauthError) {
          throw new Error(String(url.searchParams.get("error_description") || payload.error_description || oauthError));
        }

        await exchangeVkIdAuthorizationCode(code, deviceId, returnedState);
        const body = vkOAuthCallbackHtml(true, "Авторизация VK завершена. Пользовательский токен проверен для загрузки фото на стену.");
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-length": Buffer.byteLength(body),
          "cache-control": "no-store",
          "referrer-policy": "no-referrer"
        });
        return res.end(body);
      } catch (error) {
        const body = vkOAuthCallbackHtml(false, String(error && error.message || error));
        res.writeHead(400, {
          "content-type": "text/html; charset=utf-8",
          "content-length": Buffer.byteLength(body),
          "cache-control": "no-store",
          "referrer-policy": "no-referrer"
        });
        return res.end(body);
      }
    }

    if (req.method === "POST" && p === "/api/vk/oauth/capture") {
      try {
        const body = await readJson(req);
        await captureVkOAuthToken(body.accessToken, body.state, body.userId);
        return sendJson(res, 200, { ok: true, verified: true });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: String(error && error.message || error) });
      }
    }

    if (req.method === "GET" && p === "/api/vk/oauth/handoff") {
      if (!VK_OAUTH_HANDOFF_SECRET) return sendJson(res, 503, { ok: false, error: "handoff is not configured" });
      const provided = String(req.headers["x-oauth-handoff-secret"] || "");
      if (!secretMatches(provided, VK_OAUTH_HANDOFF_SECRET)) return sendJson(res, 401, { ok: false, error: "unauthorized" });
      if (!vkOAuthHandoff || !vkOAuthHandoff.accessToken || Date.now() - Number(vkOAuthHandoff.createdAt || 0) > VK_OAUTH_TTL_MS) {
        vkOAuthHandoff = null;
        return sendJson(res, 404, { ok: false, ready: false });
      }
      const handoff = vkOAuthHandoff;
      vkOAuthHandoff = null;
      return sendJson(res, 200, {
        ok: true,
        ready: true,
        accessToken: handoff.accessToken,
        refreshToken: handoff.refreshToken || "",
        deviceId: handoff.deviceId || "",
        expiresIn: Number(handoff.expiresIn || 0),
        scope: handoff.scope || "",
        userId: handoff.userId || ""
      }, { "cache-control": "no-store" });
    }

    if (req.method === "GET" && p === "/api/vk/oauth/start") {
      try {
        return redirect(res, buildVkOAuthUrl());
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: String(error && error.message || error) });
      }
    }

    if (p.startsWith("/api/") && !requireAuth(req, res)) return;

    if (req.method === "GET" && p === "/api/dashboard") {
      const cleanup = pruneQueueItems(state);
      if (cleanup.removed) saveState();
      return sendJson(res, 200, { ok: true, state: state });
    }

    if (req.method === "GET" && p === "/api/vk/oauth/status") {
      return sendJson(res, 200, {
        ok: true,
        appId: VK_APP_ID,
        redirectUri: VK_OAUTH_REDIRECT_URI,
        scope: VK_OAUTH_SCOPE,
        mode: VK_OAUTH_MODE,
        userTokenConfigured: Boolean(getVkUserToken()),
        envTokenConfigured: Boolean(process.env.VK_USER_TOKEN),
        handoffReady: Boolean(vkOAuthHandoff && vkOAuthHandoff.accessToken && Date.now() - Number(vkOAuthHandoff.createdAt || 0) <= VK_OAUTH_TTL_MS),
        storage: "environment_only"
      });
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

    if (req.method === "POST" && p === "/api/news/backfill-scores") {
      const result = await backfillRecentNewsEditorialScores(30);
      return sendJson(res, 200, result);
    }

    if (req.method === "GET" && p === "/api/news") {
      const items = await listNewsItems(url.searchParams.get("limit") || 100);
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
        dynamicSlotMaxAgeHours: DYNAMIC_SLOT_MAX_AGE_HOURS,
        queueMaxAgeHours: QUEUE_MAX_AGE_HOURS,
        articleMaxAgeHours: ARTICLE_MAX_AGE_HOURS,
        queueMaxAutoItems: QUEUE_MAX_AUTO_ITEMS,
        autoPublishEnabled: AUTO_PUBLISH_ENABLED,
        autoPublishTargets: autoPublishTargetsForPost({ topicId: "default" }),
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

    if (req.method === "GET" && p === "/api/topic-settings") {
      return sendJson(res, 200, {
        ok: true,
        topics: state.topicSettings || structuredClone(defaultState.topicSettings)
      });
    }

    if (req.method === "POST" && p === "/api/topic-settings") {
      const body = await readJson(req);
      const topicId = String(body.topicId || body.topic_id || "default").trim() || "default";
      if (!state.topicSettings || typeof state.topicSettings !== "object") {
        state.topicSettings = structuredClone(defaultState.topicSettings);
      }
      const current = Object.assign({
        allow_text_fallback: false,
        auto_publish_telegram: true,
        auto_publish_vk: true
      }, state.topicSettings[topicId] || {});
      if (Object.prototype.hasOwnProperty.call(body, "allow_text_fallback")) {
        current.allow_text_fallback = body.allow_text_fallback === true;
      }
      if (Object.prototype.hasOwnProperty.call(body, "auto_publish_telegram")) {
        current.auto_publish_telegram = body.auto_publish_telegram !== false;
      }
      if (Object.prototype.hasOwnProperty.call(body, "auto_publish_vk")) {
        current.auto_publish_vk = body.auto_publish_vk !== false;
      }
      state.topicSettings[topicId] = current;
      saveState();
      return sendJson(res, 200, {
        ok: true,
        topicId: topicId,
        settings: current
      });
    }

    if (req.method === "POST" && p === "/api/test") {
      const marker = crypto.randomBytes(3).toString("hex");
      const result = await sendTelegram("✅ News Factory подключён\n\nАвтопубликация в «Что там у ИИ?» работает.\nТест: " + marker);
      state.history.unshift({ id: newId("hist"), title: "Тест News Factory", messageId: result.message_id, publishedAt: new Date().toISOString(), publicationOrigin: "test" });
      state.history = state.history.slice(0, 100);
      state.stats.published += 1;
      saveState();
      return sendJson(res, 200, {
        ok: true,
        messageId: result.message_id,
        vkPostId: result.vkPostId || null,
        telegramPublished: result.telegramPublished,
        vkPublished: result.vkPublished,
        vkError: result.vkError || ""
      });
    }

    if (req.method === "POST" && p === "/api/publish") {
      const body = await readJson(req);
      const text = String(body.text || "").trim();
      if (!text) return sendJson(res, 400, { ok: false, error: "Введите текст" });

      const manualId = newId("manual");
      const topicId = String(body.topicId || body.topic_id || "default");
      const media = await ensureMediaForNews({
        id: manualId,
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
        id: manualId,
        postId: manualId,
        topicId: topicId,
        allow_text_fallback: allowTextFallbackForPost({
          topicId: topicId,
          allow_text_fallback: body.allow_text_fallback === true
        }),
        title: String(body.title || "").trim(),
        text: text,
        sourceUrl: String(body.sourceUrl || "").trim(),
        imageUrl: media.imageUrl,
        generatedImageUrl: media.generatedImageUrl,
        videoUrl: media.videoUrl
      }, body.targets || body.platforms);

      const historyItem = {
        id: newId("hist"),
        sourceTaskId: manualId,
        topicId: topicId,
        title: String(body.title || "Публикация"),
        text: result.publishedText || text,
        messageId: result.message_id,
        vkPostId: result.vkPostId || null,
        vkStatus: result.vkStatus || "",
        vkError: result.vkError || "",
        vkMediaAttempts: result.vkMediaAttempts || 0,
        status: result.vkStatus === "media_failed" ? "media_failed" : "published",
        publishedAt: new Date().toISOString(),
        publicationOrigin: "manual"
      };
      state.history.unshift(historyItem);
      state.history = state.history.slice(0, 100);
      if (result.telegramPublished || result.vkPublished) state.stats.published += 1;
      saveState();

      const mediaFailed = result.vkStatus === "media_failed";
      return sendJson(res, mediaFailed ? 207 : 200, {
        ok: !mediaFailed,
        status: mediaFailed ? "media_failed" : "published",
        messageId: result.message_id,
        vkPostId: result.vkPostId || null,
        telegramPublished: result.telegramPublished,
        vkPublished: result.vkPublished,
        vkStatus: result.vkStatus || "",
        vkMediaAttempts: result.vkMediaAttempts || 0,
        vkError: result.vkError || ""
      });
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

      const requestedTargets = normalizePublishTargets(body.targets || body.platforms);
      const effectiveTargets = {
        telegram: requestedTargets.telegram && item.telegramPublished !== true,
        vk: requestedTargets.vk && item.vkPublished !== true
      };
      if (!effectiveTargets.telegram && !effectiveTargets.vk) {
        return sendJson(res, 200, {
          ok: true,
          alreadyPublished: true,
          telegramPublished: item.telegramPublished === true,
          vkPublished: item.vkPublished === true,
          messageId: item.telegramMessageId || null,
          vkPostId: item.vkPostId || null
        });
      }

      const result = await sendMultiPlatformPost({
        id: item.id,
        postId: item.id,
        newsId: item.newsId || "",
        topicId: item.topicId || "default",
        allow_text_fallback: allowTextFallbackForPost(item),
        title: item.title,
        text: item.text,
        sourceUrl: item.sourceUrl || "",
        imageUrl: media.imageUrl,
        generatedImageUrl: media.generatedImageUrl,
        videoUrl: media.videoUrl
      }, effectiveTargets);

      const publishedAt = new Date().toISOString();
      if (result.telegramPublished) {
        item.telegramPublished = true;
        item.telegramMessageId = result.message_id;
        item.telegramPublishedAt = publishedAt;
      }
      if (result.vkPublished) {
        item.vkPublished = true;
        item.vkPostId = result.vkPostId || null;
        item.vkStatus = "published";
        item.vkPublishedAt = publishedAt;
        item.status = "queued";
      } else if (result.vkStatus === "media_failed") {
        item.status = "media_failed";
        item.vkStatus = "media_failed";
        item.vkError = result.vkError || "";
        item.vkErrorCode = result.vkErrorCode;
        item.vkMediaAttempts = result.vkMediaAttempts || 3;
        item.vkFailedAt = publishedAt;
      } else if (requestedTargets.vk && result.vkStatus === "failed") {
        item.vkStatus = "failed";
        item.vkError = result.vkError || "";
      }

      let historyItem = item.historyId
        ? (state.history || []).find(function(h){ return h && h.id === item.historyId; })
        : null;
      if (!historyItem && (result.telegramPublished || result.vkPublished)) {
        historyItem = {
          id: newId("hist"),
          queueId: item.id,
          newsId: item.newsId || "",
          title: item.title,
          text: result.publishedText || item.text,
          messageId: result.message_id || item.telegramMessageId || null,
          vkPostId: result.vkPostId || item.vkPostId || null,
          vkStatus: result.vkStatus || item.vkStatus || "",
          vkError: result.vkError || item.vkError || "",
          publishedAt: publishedAt,
          sourceUrl: item.sourceUrl || "",
          imageUrl: item.imageUrl || "",
          generatedImageUrl: item.generatedImageUrl || "",
          videoUrl: item.videoUrl || "",
          publicationOrigin: "manual",
          manualPublishedFromSchedule: item.preparedFor || ""
        };
        state.history.unshift(historyItem);
        state.history = state.history.slice(0, 100);
        item.historyId = historyItem.id;
        state.stats.published += 1;
      } else if (historyItem) {
        historyItem.messageId = historyItem.messageId || result.message_id || item.telegramMessageId || null;
        historyItem.vkPostId = result.vkPostId || historyItem.vkPostId || null;
        historyItem.vkStatus = result.vkStatus || item.vkStatus || historyItem.vkStatus || "";
        historyItem.vkError = result.vkError || item.vkError || "";
      }

      removeQueueIdFromSchedule(state, body.id);
      const mediaFailed = result.vkStatus === "media_failed";
      const doneTelegram = !requestedTargets.telegram || item.telegramPublished === true;
      const doneVk = !requestedTargets.vk || item.vkPublished === true;
      if (!mediaFailed && doneTelegram && doneVk) {
        state.queue = state.queue.filter(function(x){ return x.id !== body.id; });
      }

      if (db && dbReady && item.newsId) {
        try {
          const status = mediaFailed ? "media_failed" : (doneTelegram && doneVk ? "published" : "queued");
          await db.query(
            "UPDATE news_items SET status=$2, telegram_message_id=COALESCE($3,telegram_message_id), published_at=COALESCE($4,published_at), metadata=COALESCE(metadata,'{}'::jsonb) || $5::jsonb, vk_post_id=COALESCE($6,vk_post_id), vk_status=$7, vk_error_code=$8, vk_error_msg=$9, vk_media_attempts=$10, updated_at=NOW() WHERE id=$1",
            [
              item.newsId,
              status,
              result.message_id || item.telegramMessageId || null,
              (result.telegramPublished || result.vkPublished) ? publishedAt : null,
              JSON.stringify({
                vkPostId: result.vkPostId || item.vkPostId || null,
                vkStatus: result.vkStatus || item.vkStatus || "",
                vkError: result.vkError || item.vkError || "",
                vkErrorCode: result.vkErrorCode == null ? null : result.vkErrorCode,
                vkMediaAttempts: result.vkMediaAttempts || item.vkMediaAttempts || 0
              }),
              result.vkPostId || item.vkPostId || null,
              result.vkStatus || item.vkStatus || "",
              result.vkErrorCode == null ? (item.vkErrorCode == null ? null : String(item.vkErrorCode)) : String(result.vkErrorCode),
              result.vkError || item.vkError || "",
              Number(result.vkMediaAttempts || item.vkMediaAttempts || 0)
            ]
          );
        } catch (error) {
          console.warn("Queue publish DB update failed:", error.message);
        }
      }

      saveState();
      return sendJson(res, mediaFailed ? 207 : 200, {
        ok: !mediaFailed,
        status: mediaFailed ? "media_failed" : "published",
        messageId: result.message_id || item.telegramMessageId || null,
        vkPostId: result.vkPostId || item.vkPostId || null,
        telegramPublished: result.telegramPublished || item.telegramPublished === true,
        vkPublished: result.vkPublished || item.vkPublished === true,
        vkStatus: result.vkStatus || item.vkStatus || "",
        vkMediaAttempts: result.vkMediaAttempts || item.vkMediaAttempts || 0,
        vkError: result.vkError || item.vkError || ""
      });
    }

    if (req.method === "POST" && p === "/publish") {
      if (req.headers["x-admin-key"] !== ADMIN_KEY) return sendJson(res, 401, { ok: false, error: "unauthorized" });
      const body = await readJson(req);
      const text = String(body.text || "").trim();
      if (!text) return sendJson(res, 400, { ok: false, error: "text is required" });

      const legacyId = newId("legacy");
      const topicId = String(body.topicId || body.topic_id || "default");
      const media = await ensureMediaForNews({
        id: legacyId,
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
        id: legacyId,
        postId: legacyId,
        topicId: topicId,
        allow_text_fallback: allowTextFallbackForPost({
          topicId: topicId,
          allow_text_fallback: body.allow_text_fallback === true
        }),
        title: String(body.title || "").trim(),
        text: text,
        sourceUrl: String(body.sourceUrl || "").trim(),
        imageUrl: media.imageUrl,
        generatedImageUrl: media.generatedImageUrl,
        videoUrl: media.videoUrl
      }, body.targets || body.platforms);

      const mediaFailed = result.vkStatus === "media_failed";
      return sendJson(res, mediaFailed ? 207 : 200, {
        ok: !mediaFailed,
        status: mediaFailed ? "media_failed" : "published",
        messageId: result.message_id,
        vkPostId: result.vkPostId || null,
        telegramPublished: result.telegramPublished,
        vkPublished: result.vkPublished,
        vkStatus: result.vkStatus || "",
        vkMediaAttempts: result.vkMediaAttempts || 0,
        vkError: result.vkError || ""
      });
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
setTimeout(function() {
  backfillRecentNewsEditorialScores(30)
    .then(function(result){ if (result && result.scored) console.log("News score backfill:", JSON.stringify(result)); })
    .catch(function(error){ console.warn("News score backfill failed:", error.message); });
}, 1500);
await discoverTelegramAlertChat();
startCollectorScheduler();

server.listen(PORT, "0.0.0.0", function() {
  console.log("News Factory listening on :" + PORT);
});
