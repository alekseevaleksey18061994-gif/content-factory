// Extracted from server.js (v0.62.0 module split). Behaviour is unchanged.
import crypto from "node:crypto";
import { createFailureLimiter } from "./auth-guard.js";

export const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

export const CHANNEL = process.env.TELEGRAM_CHANNEL || "";

export const TELEGRAM_PUBLIC_USERNAME = String(process.env.TELEGRAM_PUBLIC_USERNAME || CHANNEL || "").replace(/^@/, "").trim();

export const ADMIN_KEY = process.env.ADMIN_KEY || crypto.randomBytes(32).toString("hex");

export const ADMIN_UI_PASSWORD = process.env.ADMIN_UI_PASSWORD || "";

export const ADMIN_UI_PASSWORD_SHA256 = String(process.env.ADMIN_UI_PASSWORD_SHA256 || "").trim().toLowerCase();

// Optional salted hash ("scrypt$<salt hex>$<hash hex>", see lib/auth-guard.js hashPasswordScrypt). Preferred over SHA-256 / plain when set.
export const ADMIN_UI_PASSWORD_SCRYPT = String(process.env.ADMIN_UI_PASSWORD_SCRYPT || "").trim();

// Railway puts exactly one proxy in front of the app; XFF entries to the left of it are client-controlled.
export const TRUSTED_PROXY_HOPS = Math.max(0, Math.min(5, Number(process.env.TRUSTED_PROXY_HOPS == null || process.env.TRUSTED_PROXY_HOPS === "" ? 1 : process.env.TRUSTED_PROXY_HOPS) || 0));

export const authFailureLimiter = createFailureLimiter({
  maxFailures: Math.max(1, Number(process.env.AUTH_MAX_FAILURES || 8) || 8),
  windowMs: 15 * 60 * 1000,
  baseLockMs: 30 * 1000,
  maxLockMs: 15 * 60 * 1000
});

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

export const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-6-luna";

export const OPENAI_FALLBACK_MODEL = "gpt-5.6-luna";

export const DATABASE_URL = process.env.DATABASE_URL || "";

export const MEDIA_REQUIRED = String(process.env.MEDIA_REQUIRED || "true").toLowerCase() !== "false";

export const GENERATE_COVER_IF_MISSING = String(process.env.GENERATE_COVER_IF_MISSING || "true").toLowerCase() !== "false";

// Editor's rule (2026-10-04): a post whose only picture is our text card (title on a coloured background) is not
// published automatically — readers want a real photo. TEXT_CARD_POSTS_ALLOWED=true restores the old behaviour.
export const TEXT_CARD_POSTS_ALLOWED = String(process.env.TEXT_CARD_POSTS_ALLOWED || "false").toLowerCase() === "true";

export const IMAGE_ENHANCEMENT_ENABLED = String(process.env.IMAGE_ENHANCEMENT_ENABLED || "true").toLowerCase() !== "false";

export const AUTO_ENHANCE_SOURCE_IMAGES = String(process.env.AUTO_ENHANCE_SOURCE_IMAGES || "true").toLowerCase() !== "false";

// Golden-mean pipeline: cheap validation first; expensive/generated media only after editorial approval.
export const MEDIA_DEFER_EXPENSIVE = String(process.env.MEDIA_DEFER_EXPENSIVE || "true").toLowerCase() !== "false";

export const MEDIA_QUALITY_MIN_SCORE = Math.max(35, Math.min(90, Number(process.env.MEDIA_QUALITY_MIN_SCORE || 62) || 62));

export const EDITORIAL_QUEUE_TARGET = Math.max(1, Math.min(12, Number(process.env.EDITORIAL_QUEUE_TARGET || 4) || 4));

export const EDITORIAL_CAPACITY_BYPASS_SCORE = Math.max(7, Math.min(10, Number(process.env.EDITORIAL_CAPACITY_BYPASS_SCORE || 9) || 9));

export const MEDIA_AI_COVER_MIN_IMPORTANCE = Math.max(6, Math.min(10, Number(process.env.MEDIA_AI_COVER_MIN_IMPORTANCE || 8) || 8));

export const COPYRIGHT_MEDIA_MODE = String(process.env.COPYRIGHT_MEDIA_MODE || "balanced").trim().toLowerCase();

export const COPYRIGHT_SAFE_MODE = COPYRIGHT_MEDIA_MODE === "strict";

export const COPYRIGHT_MAX_VERBATIM_WORDS = Math.max(8, Number(process.env.COPYRIGHT_MAX_VERBATIM_WORDS || 12));

export const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-sunburst";

export const OPENAI_IMAGE_QUALITY = process.env.OPENAI_IMAGE_QUALITY || "medium";

export const STORY_CLUSTER_ENABLED = String(process.env.STORY_CLUSTER_ENABLED || "true").toLowerCase() !== "false";

export const STORY_CLUSTER_WINDOW_HOURS = Math.max(2, Number(process.env.STORY_CLUSTER_WINDOW_HOURS || 8));

export const STORY_CLUSTER_MIN_SIMILARITY = Math.max(0.18, Math.min(0.8, Number(process.env.STORY_CLUSTER_MIN_SIMILARITY || 0.20)));

export const STORY_CLUSTER_MAX_SOURCES = Math.max(2, Math.min(6, Number(process.env.STORY_CLUSTER_MAX_SOURCES || 5)));

export const STORY_MEDIA_PACK_COUNT = Math.max(2, Math.min(4, Number(process.env.STORY_MEDIA_PACK_COUNT || 3)));

export const EDITORIAL_VARIETY_ENABLED = String(process.env.EDITORIAL_VARIETY_ENABLED || "true").toLowerCase() !== "false";

export const EDITORIAL_QC_ENABLED = String(process.env.EDITORIAL_QC_ENABLED || "true").toLowerCase() !== "false";

// Editorial pipeline v2: one prompt for the whole channel network + double fact-check (GPT + Claude).
// Rollback switch: EDITORIAL_V2_ENABLED=false returns to the previous rewrite + QC flow.
export const EDITORIAL_V2_ENABLED = String(process.env.EDITORIAL_V2_ENABLED || "true").toLowerCase() !== "false";

export const EDITORIAL_V2_MAX_FIX_ROUNDS = Math.max(0, Math.min(3, Number(process.env.EDITORIAL_V2_MAX_FIX_ROUNDS || 2)));

export const EDITORIAL_V2_REQUIRE_ALL_CHECKERS = String(process.env.EDITORIAL_V2_REQUIRE_ALL_CHECKERS || "true").toLowerCase() !== "false";

export const ANTHROPIC_API_KEY = String(process.env.ANTHROPIC_API_KEY || "").trim();

// Cost control: routine second-pass fact checking and helper failover use Haiku.
// Sonnet is reserved for high-risk/high-importance checks and writer failover.
export const ANTHROPIC_MODEL = String(process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5").trim();

export const ANTHROPIC_CHECKER_MODEL = String(process.env.ANTHROPIC_CHECKER_MODEL || "claude-haiku-4-5").trim();

// v0.53.5: the strong checker inherits ANTHROPIC_MODEL only when it is not an Opus/Fable/Mythos-class model; those are capped to Sonnet unless ANTHROPIC_STRONG_CHECKER_MODEL is set.
export const ANTHROPIC_STRONG_CHECKER_MODEL = String(process.env.ANTHROPIC_STRONG_CHECKER_MODEL || (/opus|fable|mythos/i.test(ANTHROPIC_MODEL) ? "claude-sonnet-5-5" : ANTHROPIC_MODEL) || "claude-sonnet-5-5").trim();

export const ANTHROPIC_CHECK_MIN_IMPORTANCE = Math.max(0, Math.min(10, Number(process.env.ANTHROPIC_CHECK_MIN_IMPORTANCE == null || process.env.ANTHROPIC_CHECK_MIN_IMPORTANCE === "" ? 7 : process.env.ANTHROPIC_CHECK_MIN_IMPORTANCE) || 0));

export const ANTHROPIC_ASSIST_MODEL = String(process.env.ANTHROPIC_ASSIST_MODEL || ANTHROPIC_CHECKER_MODEL).trim();

export const ANTHROPIC_STRONG_IMPORTANCE = Math.max(7, Math.min(10, Number(process.env.ANTHROPIC_STRONG_IMPORTANCE || 10) || 10));

export const ANTHROPIC_HEALTH_CACHE_MIN = Math.max(10, Math.min(360, Number(process.env.ANTHROPIC_HEALTH_CACHE_MIN || 120) || 120));

// Provider failover: OpenAI or Claude out of money (or down) -> the other one writes and checks, publishing goes on.
export const PROVIDER_FAILOVER_ENABLED = String(process.env.EDITORIAL_V2_PROVIDER_FAILOVER || "true").toLowerCase() !== "false";

export const ANTHROPIC_FALLBACK_WRITER_MODEL = String(process.env.ANTHROPIC_FALLBACK_WRITER_MODEL || "claude-sonnet-5-5").trim();

export const PROVIDER_BREAKER_COOLDOWN_MIN = Math.max(1, Math.min(240, Number(process.env.PROVIDER_BREAKER_COOLDOWN_MIN || 10) || 10));

// When OpenAI cannot draw covers (no money) a local text card is used instead of blocking the post on MEDIA_REQUIRED.
export const PROVIDER_FAILOVER_COVER_CARD = String(process.env.PROVIDER_FAILOVER_COVER_CARD || "true").toLowerCase() !== "false";

export const HEADLINE_PREFILTER_ENABLED = String(process.env.HEADLINE_PREFILTER_ENABLED || "true").toLowerCase() !== "false";

export const SOURCE_AUTO_PAUSE_ENABLED = String(process.env.SOURCE_AUTO_PAUSE_ENABLED || "true").toLowerCase() !== "false";

export function envNumber(name, def, min, max) { const v = Number(String(process.env[name] == null ? "" : process.env[name]).replace(",", ".").replace(/[^0-9.\-]/g, "")); const n = process.env[name] == null || process.env[name] === "" || !Number.isFinite(v) ? def : v; return Math.max(min, Math.min(max, n)); }

export const POST_RATING_MIN_AUTO = envNumber("POST_RATING_MIN_AUTO", 50, 0, 100);

// Nothing waits for a human: below POST_RATING_MIN_AUTO a post is a reserve
// (published only when no better post is available), below
// POST_RATING_DROP_BELOW it is removed from the queue automatically.
export const POST_RATING_DROP_BELOW = envNumber("POST_RATING_DROP_BELOW", 35, 0, 100);

export function normHHMM(v, def) { const m = String(v || "").trim().match(/^(\d{1,2}):(\d{2})$/); if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return def; return m[1].padStart(2, "0") + ":" + m[2]; }

export const DIGEST_ENABLED = String(process.env.DIGEST_ENABLED || "true").toLowerCase() !== "false";

// Product rule: public digests are removed: both «Главное за день» and Sunday «Топ недели».
// Each can only return if the editor explicitly enables its dedicated flag.
export const DIGEST_EVENING_ENABLED = String(process.env.DIGEST_EVENING_ENABLED || "false").toLowerCase() === "true";

export const DIGEST_SUNDAY_ENABLED = String(process.env.DIGEST_SUNDAY_ENABLED || "false").toLowerCase() === "true";

export const DIGEST_EVENING_TIME = normHHMM(process.env.DIGEST_EVENING_TIME, "21:15");

export const DIGEST_SUNDAY_TIME = normHHMM(process.env.DIGEST_SUNDAY_TIME, "20:15");

export const DAILY_REPORT_ENABLED = String(process.env.DAILY_REPORT_ENABLED || "true").toLowerCase() !== "false";

export const DAILY_REPORT_TIME = normHHMM(process.env.DAILY_REPORT_TIME, "22:50");

export const SOURCES_MIN_ACTIVE = envNumber("SOURCES_MIN_ACTIVE", 40, 0, 200);

export const SOURCE_REPLENISH_INTERVAL_MINUTES = Math.max(15, Number(process.env.SOURCE_REPLENISH_INTERVAL_MINUTES || 60));

// How many new sources one top-up may add (was a fixed 5) and the ceiling a starving channel may grow to.
export const SOURCES_ADDED_PER_RUN = envNumber("SOURCES_ADDED_PER_RUN", 15, 1, 50);

export const SOURCES_MAX_ACTIVE = envNumber("SOURCES_MAX_ACTIVE", 150, 10, 400);

// A channel whose slot preparations found nothing new this many times in a row gets new sources even when it
// already has the target number: the count is fine, but they bring nothing.
export const SOURCE_STARVING_RUNS = envNumber("SOURCE_STARVING_RUNS", 2, 1, 24);

export const SOURCE_PROBATION_HOURS = envNumber("SOURCE_PROBATION_HOURS", 48, 6, 24 * 14);

export const STORY_PRECHECK_ENABLED = String(process.env.STORY_PRECHECK_ENABLED || "true").toLowerCase() !== "false";

export const AUTO_QUALITY_MIN = Math.max(50, Math.min(95, Number(process.env.AUTO_QUALITY_MIN || 72)));

export const STORY_UPDATE_WINDOW_HOURS = Math.max(6, Math.min(72, Number(process.env.STORY_UPDATE_WINDOW_HOURS || 36)));

// Default 2: one main photo plus at most one genuinely different large photo.
// One media per post: video → photo → generated cover. Albums are off by default.
export const MEDIA_DIRECTOR_MAX_IMAGES = Math.max(1, Math.min(6, Number(process.env.MEDIA_DIRECTOR_MAX_IMAGES || 1)));

// Extra (non-main) album photos must be at least this large: filters "read also" thumbnails.
export const MEDIA_EXTRA_MIN_WIDTH = 700;

export const MEDIA_EXTRA_MIN_HEIGHT = 400;

export const EDITORIAL_LEARNING_ENABLED = String(process.env.EDITORIAL_LEARNING_ENABLED || "true").toLowerCase() !== "false";

export const EDITORIAL_LEARNING_REFRESH_MINUTES = Math.max(15, Number(process.env.EDITORIAL_LEARNING_REFRESH_MINUTES || 60));

export const PUBLISH_REPAIR_MAX_ATTEMPTS = Math.max(1, Math.min(3, Number(process.env.PUBLISH_REPAIR_MAX_ATTEMPTS || 2)));

// Telegram Bot API: timeout of one JSON call, and the longest "retry_after" (429) we are willing to sit out once.
export const TELEGRAM_API_TIMEOUT_MS = Math.max(5000, Math.min(120000, Number(process.env.TELEGRAM_API_TIMEOUT_MS || 30000)));

export const TELEGRAM_RETRY_AFTER_MAX_SECONDS = Math.max(1, Math.min(120, Number(process.env.TELEGRAM_RETRY_AFTER_MAX_SECONDS || 30)));

export const SOURCE_IMAGE_ENHANCE_CONCURRENCY = Math.max(1, Math.min(2, Number(process.env.SOURCE_IMAGE_ENHANCE_CONCURRENCY || 1)));

export const IMAGE_ENHANCE_MIN_GAP_MS = Math.max(8000, Number(process.env.IMAGE_ENHANCE_MIN_GAP_MS || 13000));

export const PUBLIC_BASE_URL = (process.env.NEWS_FACTORY_PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN : "https://news-factory-api-production.up.railway.app")).replace(/\/$/, "");

export const VK_ACCESS_TOKEN = String(process.env.VK_ACCESS_TOKEN || process.env.VK_TOKEN || "").trim();

export const VK_USER_TOKEN = String(process.env.VK_USER_TOKEN || process.env.VK_USER_ACCESS_TOKEN || "").trim();

export const TELEGRAM_ALERT_CHAT_ID = String(process.env.TELEGRAM_ALERT_CHAT_ID || "").trim();

export const VK_GROUP_ID = Math.abs(Number(process.env.VK_GROUP_ID || 0)) || 0;

export const VK_OWNER_ID = Number(process.env.VK_OWNER_ID || (VK_GROUP_ID ? -VK_GROUP_ID : 0)) || 0;

export const VK_SCREEN_NAME = String(process.env.VK_SCREEN_NAME || "chtotamai").trim();

export const VK_PUBLIC_URL = String(process.env.VK_PUBLIC_URL || (VK_SCREEN_NAME ? "https://vk.ru/" + VK_SCREEN_NAME : "")).trim();

export const VK_API_VERSION = String(process.env.VK_API_VERSION || "5.199").trim();

export const VK_PUBLISH_ENABLED = String(process.env.VK_PUBLISH_ENABLED || "false").toLowerCase() === "true";

// VK posts WITH a visible photo go through Postmypost (an app VK approved for photos). Set POSTMYPOST_TOKEN to enable;
// VK_VIA_POSTMYPOST=false switches back to direct VK API without removing the token.
export const POSTMYPOST_TOKEN = String(process.env.POSTMYPOST_TOKEN || "").trim();

export const VK_VIA_POSTMYPOST = Boolean(POSTMYPOST_TOKEN) && String(process.env.VK_VIA_POSTMYPOST || "true").toLowerCase() !== "false";

export const VK_APP_ID = String(process.env.VK_APP_ID || "").trim();

export const VK_OAUTH_REDIRECT_URI = String(process.env.VK_OAUTH_REDIRECT_URI || (PUBLIC_BASE_URL + "/api/vk/oauth/callback")).trim();

export const VK_OAUTH_SCOPE = String(process.env.VK_OAUTH_SCOPE || "photos wall groups offline").trim();

export const VK_OAUTH_MODE = String(process.env.VK_OAUTH_MODE || "legacy").trim().toLowerCase();

export const VK_OAUTH_HANDOFF_SECRET = String(process.env.VK_OAUTH_HANDOFF_SECRET || "").trim();

export const VK_OAUTH_TTL_MS = 10 * 60 * 1000;

export const COLLECTOR_ENABLED = String(process.env.COLLECTOR_ENABLED || "true").toLowerCase() !== "false";

export const AUTO_PUBLISH_ENABLED = String(process.env.AUTO_PUBLISH_ENABLED || "false").toLowerCase() === "true";

export const AUTO_PUBLISH_MIN_INTERVAL_MINUTES = Math.max(10, Number(process.env.AUTO_PUBLISH_MIN_INTERVAL_MINUTES || 30));

export const POLL_INTERVAL_MINUTES = Math.max(5, Number(process.env.POLL_INTERVAL_MINUTES || 15));

// declared early: cleanupScheduleAssignments() runs while workspaces load at startup
export const DYNAMIC_ASSIGNMENT_GRACE_MIN = Math.max(0, Number(process.env.DYNAMIC_ASSIGNMENT_GRACE_MIN || 90));

export const DYNAMIC_SLOT_START_HOUR = 8;

export const DYNAMIC_SLOT_END_HOUR = 23;

export const DYNAMIC_SLOT_PREP_MINUTE = 45;

