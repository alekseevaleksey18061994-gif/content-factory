import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import sharp from "sharp";
import { AsyncLocalStorage } from "node:async_hooks";
import { fileURLToPath } from "node:url";
import { postRating, queueItemRatingInput } from "./lib/post-rating.js";
import { moscowParts, historyFormat, historyHook, bucketWeights, bestHours, isDigestHistory, pickDigestPosts, buildDailyReportText, topReasons } from "./lib/insights.js";
import { staleYearInTitle, buildPrefilterPrompt, parsePrefilterResult, recordOutcome, autoPauseReason, outcomeForStatus, sourcesNeeded, freshCandidates, sourceHost, sourceKey, RESERVE_SOURCES, MAX_SOURCES_ADDED_PER_RUN, buildDiscoveryPrompt, parseDiscoveryResult } from "./lib/source-quality.js";
import {
  createEditorialPipeline,
  createModelClients,
  resolveChannelId,
  timeSlotFor,
  legacyScores,
  loadPrompt as loadEditorialPrompt,
  CHANNEL_IDS as EDITORIAL_CHANNEL_IDS
} from "./lib/editorial-v2.js";
import {
  COST_STATE_MIGRATION_ID,
  collectLegacyCostRows,
  stripLegacyCostEvents,
  resolveCostPricing,
  calculateUsageCost as calculateApiUsageCost,
  moscowPeriodBounds,
  monthForecastCost,
  percentChange
} from "./lib/costs.js";

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
const COPYRIGHT_MEDIA_MODE = String(process.env.COPYRIGHT_MEDIA_MODE || "balanced").trim().toLowerCase();
const COPYRIGHT_SAFE_MODE = COPYRIGHT_MEDIA_MODE === "strict";
const COPYRIGHT_MAX_VERBATIM_WORDS = Math.max(8, Number(process.env.COPYRIGHT_MAX_VERBATIM_WORDS || 12));
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-sunburst";
const OPENAI_IMAGE_QUALITY = process.env.OPENAI_IMAGE_QUALITY || "medium";
const STORY_CLUSTER_ENABLED = String(process.env.STORY_CLUSTER_ENABLED || "true").toLowerCase() !== "false";
const STORY_CLUSTER_WINDOW_HOURS = Math.max(2, Number(process.env.STORY_CLUSTER_WINDOW_HOURS || 8));
const STORY_CLUSTER_MIN_SIMILARITY = Math.max(0.18, Math.min(0.8, Number(process.env.STORY_CLUSTER_MIN_SIMILARITY || 0.20)));
const STORY_CLUSTER_MAX_SOURCES = Math.max(2, Math.min(6, Number(process.env.STORY_CLUSTER_MAX_SOURCES || 5)));
const STORY_MEDIA_PACK_COUNT = Math.max(2, Math.min(4, Number(process.env.STORY_MEDIA_PACK_COUNT || 3)));
const EDITORIAL_VARIETY_ENABLED = String(process.env.EDITORIAL_VARIETY_ENABLED || "true").toLowerCase() !== "false";
const EDITORIAL_QC_ENABLED = String(process.env.EDITORIAL_QC_ENABLED || "true").toLowerCase() !== "false";
// Editorial pipeline v2: one prompt for the whole channel network + double fact-check (GPT + Claude).
// Rollback switch: EDITORIAL_V2_ENABLED=false returns to the previous rewrite + QC flow.
const EDITORIAL_V2_ENABLED = String(process.env.EDITORIAL_V2_ENABLED || "true").toLowerCase() !== "false";
const EDITORIAL_V2_PROMPT_FILE = fileURLToPath(new URL("./prompts/chto-tam.md", import.meta.url));
const EDITORIAL_V2_MAX_FIX_ROUNDS = Math.max(0, Math.min(3, Number(process.env.EDITORIAL_V2_MAX_FIX_ROUNDS || 2)));
const EDITORIAL_V2_REQUIRE_ALL_CHECKERS = String(process.env.EDITORIAL_V2_REQUIRE_ALL_CHECKERS || "true").toLowerCase() !== "false";
const ANTHROPIC_API_KEY = String(process.env.ANTHROPIC_API_KEY || "").trim();
const ANTHROPIC_MODEL = String(process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5").trim();
const HEADLINE_PREFILTER_ENABLED = String(process.env.HEADLINE_PREFILTER_ENABLED || "true").toLowerCase() !== "false";
const SOURCE_AUTO_PAUSE_ENABLED = String(process.env.SOURCE_AUTO_PAUSE_ENABLED || "true").toLowerCase() !== "false";
const POST_RATING_MIN_AUTO = Math.max(0, Math.min(100, Number(process.env.POST_RATING_MIN_AUTO || 50)));
// Nothing waits for a human: below POST_RATING_MIN_AUTO a post is a reserve
// (published only when no better post is available), below
// POST_RATING_DROP_BELOW it is removed from the queue automatically.
const POST_RATING_DROP_BELOW = Math.max(0, Math.min(100, Number(process.env.POST_RATING_DROP_BELOW || 35)));
const DIGEST_ENABLED = String(process.env.DIGEST_ENABLED || "true").toLowerCase() !== "false";
const DIGEST_EVENING_TIME = String(process.env.DIGEST_EVENING_TIME || "21:15");
const DIGEST_SUNDAY_TIME = String(process.env.DIGEST_SUNDAY_TIME || "20:15");
const DAILY_REPORT_ENABLED = String(process.env.DAILY_REPORT_ENABLED || "true").toLowerCase() !== "false";
const DAILY_REPORT_TIME = String(process.env.DAILY_REPORT_TIME || "22:50");
const SOURCES_MIN_ACTIVE = Math.max(0, Math.min(200, Number(process.env.SOURCES_MIN_ACTIVE || 40)));
const SOURCE_REPLENISH_INTERVAL_MINUTES = Math.max(15, Number(process.env.SOURCE_REPLENISH_INTERVAL_MINUTES || 120));
const STORY_PRECHECK_ENABLED = String(process.env.STORY_PRECHECK_ENABLED || "true").toLowerCase() !== "false";
const AUTO_QUALITY_MIN = Math.max(50, Math.min(95, Number(process.env.AUTO_QUALITY_MIN || 72)));
const STORY_UPDATE_WINDOW_HOURS = Math.max(6, Math.min(72, Number(process.env.STORY_UPDATE_WINDOW_HOURS || 36)));
// Default 2: one main photo plus at most one genuinely different large photo.
// One media per post: video → photo → generated cover. Albums are off by default.
const MEDIA_DIRECTOR_MAX_IMAGES = Math.max(1, Math.min(6, Number(process.env.MEDIA_DIRECTOR_MAX_IMAGES || 1)));
// Extra (non-main) album photos must be at least this large: filters "read also" thumbnails.
const MEDIA_EXTRA_MIN_WIDTH = 700;
const MEDIA_EXTRA_MIN_HEIGHT = 400;
const EDITORIAL_LEARNING_ENABLED = String(process.env.EDITORIAL_LEARNING_ENABLED || "true").toLowerCase() !== "false";
const EDITORIAL_LEARNING_REFRESH_MINUTES = Math.max(15, Number(process.env.EDITORIAL_LEARNING_REFRESH_MINUTES || 60));
const PUBLISH_REPAIR_MAX_ATTEMPTS = Math.max(1, Math.min(3, Number(process.env.PUBLISH_REPAIR_MAX_ATTEMPTS || 2)));
const SOURCE_IMAGE_ENHANCE_CONCURRENCY = Math.max(1, Math.min(2, Number(process.env.SOURCE_IMAGE_ENHANCE_CONCURRENCY || 1)));
const IMAGE_ENHANCE_MIN_GAP_MS = Math.max(8000, Number(process.env.IMAGE_ENHANCE_MIN_GAP_MS || 13000));
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
const SCHEDULER_SLOT_WINDOW_MINUTES = Math.max(1, Math.min(14, Number(process.env.SCHEDULER_SLOT_WINDOW_MINUTES || 10)));
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
const WORKSPACES_FILE = path.join(DATA_DIR, "workspaces.json");
const DEFAULT_WORKSPACE_ID = "ai-main";
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

const COST_TRACKING_VERSION = 2;
const COST_TRACKING_RETENTION_DAYS = Math.max(30, Math.min(2000, Number(process.env.COST_TRACKING_RETENTION_DAYS || 400)));
const COST_EVENT_BUFFER_MAX = 2000;
const COST_MONTHLY_BUDGET_RUB = Math.max(0, Number(process.env.COST_MONTHLY_BUDGET_RUB || 0) || 0);
const COST_DAILY_BUDGET_RUB = Math.max(0, Number(process.env.COST_DAILY_BUDGET_RUB || 0) || 0);
const COST_PRICING_CONFIG = resolveCostPricing(process.env.COST_PRICING_JSON || "");
const COST_PRICING_UPDATED_AT = COST_PRICING_CONFIG.updatedAt;
const COST_PRICING = COST_PRICING_CONFIG.pricing;
if (COST_PRICING_CONFIG.error) console.warn("COST_PRICING_JSON ignored:", COST_PRICING_CONFIG.error);

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

const RUSSIAN_AI_SOURCES = [
  { id: "ru-yandex-ai", name: "Yandex AI / Алиса AI", type: "web", group: "official", priority: 1, url: "https://www.yandex.ru/company/news?tag=yandex+ai+studio", enabled: true },
  { id: "ru-sber-ai", name: "Sber AI / GigaChat", type: "web", group: "official", priority: 1, url: "https://habr.com/ru/companies/sberbank/news/page1/", enabled: true },
  { id: "ru-mws-ai", name: "MWS AI", type: "web", group: "official", priority: 1, url: "https://mts.ai/news/", enabled: true },
  { id: "ru-vk-ai", name: "VK AI", type: "web", group: "official", priority: 1, url: "https://vk.company.ru/ru/press/releases/", enabled: true },
  { id: "ru-tbank-ai", name: "T-Bank AI", type: "web", group: "official", priority: 1, url: "https://ai.tbank.ru/", enabled: true },
  { id: "ru-just-ai", name: "Just AI", type: "web", group: "official", priority: 1, url: "https://just-ai.com/blog/news", enabled: true },
  { id: "ru-ntechlab", name: "NtechLab", type: "web", group: "official", priority: 1, url: "https://ntechlab.ru/news", enabled: true },
  { id: "ru-airi", name: "Институт AIRI", type: "web", group: "official", priority: 1, url: "https://airi.net/ru/events/", enabled: true },
  { id: "ru-zheltyi-ai", name: "Жёлтый AI", type: "web", group: "creator", priority: 2, url: "https://t.me/s/zheltyi_ai", enabled: true },
  { id: "ru-ai-happens", name: "AI Happens", type: "web", group: "creator", priority: 2, url: "https://t.me/s/AIhappens", enabled: true }
];

const CAR_SOURCES = [
  { id: "cars-tesla", name: "Tesla Blog", type: "web", group: "official", priority: 1, url: "https://www.tesla.com/blog", enabled: true },
  { id: "cars-byd", name: "BYD Global", type: "web", group: "official", priority: 1, url: "https://www.bydglobal.com/en/news", enabled: true },
  { id: "cars-geely", name: "Geely Newsroom", type: "web", group: "official", priority: 1, url: "https://newsroom.geely.com/", enabled: true },
  { id: "cars-chery", name: "Chery International", type: "web", group: "official", priority: 1, url: "https://www.cheryinternational.com/", enabled: true },
  { id: "cars-nio", name: "NIO Newsroom", type: "web", group: "official", priority: 1, url: "https://www.nio.com/news", enabled: true },
  { id: "cars-xpeng", name: "XPENG Pressroom", type: "web", group: "official", priority: 1, url: "https://www.xpeng.com/nl/pressroom", enabled: true },
  { id: "cars-zeekr", name: "ZEEKR Global", type: "web", group: "official", priority: 1, url: "https://www.zeekrglobal.com/", enabled: true },
  { id: "cars-gwm", name: "GWM Global", type: "web", group: "official", priority: 1, url: "https://www.gwm-global.com/news/", enabled: true },
  { id: "cars-toyota", name: "Toyota Global Newsroom", type: "web", group: "official", priority: 1, url: "https://global.toyota/en/newsroom/", enabled: true },
  { id: "cars-vw", name: "Volkswagen Newsroom", type: "web", group: "official", priority: 1, url: "https://www.volkswagen-newsroom.com/en/press-releases", enabled: true },
  { id: "cars-bmw", name: "BMW Group PressClub", type: "web", group: "official", priority: 1, url: "https://www.press.bmwgroup.com/global/", enabled: true },
  { id: "cars-mercedes", name: "Mercedes-Benz Media", type: "web", group: "official", priority: 1, url: "https://media.mercedes-benz.com/", enabled: true },

  { id: "cars-reuters", name: "Reuters Autos & Transportation", type: "web", group: "media", priority: 2, url: "https://www.reuters.com/business/autos-transportation/", enabled: true },
  { id: "cars-carnewschina", name: "CarNewsChina", type: "web", group: "media", priority: 2, url: "https://carnewschina.com/", enabled: true },
  { id: "cars-cnevpost", name: "CnEVPost", type: "web", group: "media", priority: 2, url: "https://cnevpost.com/", enabled: true },
  { id: "cars-gasgoo", name: "Gasgoo Auto News", type: "web", group: "media", priority: 2, url: "https://autonews.gasgoo.com/", enabled: true },
  { id: "cars-electrek", name: "Electrek", type: "web", group: "media", priority: 2, url: "https://electrek.co/", enabled: true },
  { id: "cars-insideevs", name: "InsideEVs", type: "web", group: "media", priority: 2, url: "https://insideevs.com/news/", enabled: true },
  { id: "cars-motor1", name: "Motor1", type: "web", group: "media", priority: 2, url: "https://www.motor1.com/news/", enabled: true },
  { id: "cars-carscoops", name: "Carscoops", type: "web", group: "media", priority: 2, url: "https://www.carscoops.com/category/news/", enabled: true },
  { id: "cars-autocar", name: "Autocar", type: "web", group: "media", priority: 2, url: "https://www.autocar.co.uk/car-news", enabled: true },
  { id: "cars-topgear", name: "Top Gear", type: "web", group: "media", priority: 2, url: "https://www.topgear.com/car-news", enabled: true },
  { id: "cars-caranddriver", name: "Car and Driver", type: "web", group: "media", priority: 2, url: "https://www.caranddriver.com/news/", enabled: true },
  { id: "cars-thedrive", name: "The Drive", type: "web", group: "media", priority: 2, url: "https://www.thedrive.com/news", enabled: true },
  { id: "cars-jalopnik", name: "Jalopnik", type: "web", group: "media", priority: 2, url: "https://www.jalopnik.com/", enabled: true },
  { id: "cars-autonews-ru", name: "Autonews.ru", type: "web", group: "media", priority: 2, url: "https://www.autonews.ru/", enabled: true },
  { id: "cars-motor-ru", name: "Motor.ru", type: "web", group: "media", priority: 2, url: "https://motor.ru/", enabled: true },
  { id: "cars-drom", name: "Drom Новости", type: "web", group: "media", priority: 2, url: "https://news.drom.ru/", enabled: true },
  { id: "cars-quto", name: "Quto", type: "web", group: "media", priority: 2, url: "https://quto.ru/news/", enabled: true },
  { id: "cars-autoevolution", name: "Autoevolution", type: "web", group: "media", priority: 2, url: "https://www.autoevolution.com/news/", enabled: true },
  { id: "cars-zr", name: "За рулём", type: "web", group: "media", priority: 2, url: "https://www.zr.ru/", enabled: true },
  { id: "cars-autostat", name: "Автостат", type: "web", group: "media", priority: 1, url: "https://www.autostat.ru/news/", enabled: true },
  { id: "cars-kolesa", name: "Колёса.ру", type: "web", group: "media", priority: 2, url: "https://www.kolesa.ru/news", enabled: true },
  { id: "cars-autoreview", name: "Авторевю", type: "web", group: "media", priority: 2, url: "https://autoreview.ru/news", enabled: true }
];

const BLOGGER_SOURCES = [
  { id: "blogger-ildar", name: "Ильдар Авто-подбор", type: "web", group: "blogger", priority: 2, url: "https://t.me/s/ildar_auto_podbor", enabled: true },
  { id: "blogger-dubrovskiy", name: "Жекич Дубровский", type: "web", group: "blogger", priority: 2, url: "https://t.me/s/dubrovskiy_444", enabled: true },
  { id: "blogger-academeg", name: "AcademeG", type: "web", group: "blogger", priority: 2, url: "https://t.me/s/academeg_true_original", enabled: true },
  { id: "blogger-strekal", name: "Илья Стрекаловский", type: "web", group: "blogger", priority: 2, url: "https://t.me/s/Strekalovsky", enabled: true },
  { id: "blogger-miheev-pavlov", name: "Михеев и Павлов", type: "web", group: "blogger", priority: 2, url: "https://t.me/s/miheevpavlov_pro", enabled: true },
  { id: "blogger-pasha-pel", name: "Паша ПЭЛ", type: "web", group: "blogger", priority: 2, url: "https://t.me/s/pel_video", enabled: true },
  { id: "blogger-klubniy-servis", name: "Клубный Сервис", type: "web", group: "blogger", priority: 2, url: "https://t.me/s/klubniy_servis", enabled: true },
  { id: "blogger-lisa-rulit", name: "Лиса Рулит", type: "web", group: "blogger", priority: 2, url: "https://t.me/s/lisacars", enabled: true },
  { id: "blogger-anton-avtoman", name: "Anton Avtoman", type: "web", group: "blogger", priority: 2, url: "https://t.me/s/anton_avtoman", enabled: true },
  { id: "blogger-bulkin", name: "Bulkin Drive", type: "web", group: "blogger", priority: 2, url: "https://t.me/s/bulkin_live", enabled: true }
];
const BLOGGER_SLOTS = ["10:30", "12:30", "15:30", "18:30", "21:30"];
const BLOGGER_DAILY_TARGET = 5;
const RUSSIAN_AI_SLOTS = ["09:30", "11:30", "13:30", "16:30", "19:30", "22:30"];
const RUSSIAN_AI_DAILY_TARGET = 6;

const defaultState = {
  mode: "REVIEW",
  sources: structuredClone(CURATED_SOURCES),
  sourceStats: {},
  sourceCursor: 0,
  queuePolicy: {
    articleMaxAgeHours: ARTICLE_MAX_AGE_HOURS,
    queueMaxAgeHours: QUEUE_MAX_AGE_HOURS,
    queueMaxAutoItems: QUEUE_MAX_AUTO_ITEMS
  },
  copyrightPolicy: {
    safeMode: COPYRIGHT_SAFE_MODE,
    factsOnly: true,
    requireSourceLink: true,
    autoUseThirdPartyMedia: COPYRIGHT_MEDIA_MODE === "balanced",
    maxVerbatimWords: COPYRIGHT_MAX_VERBATIM_WORDS,
    version: "v2"
  },
  editorialPolicy: {
    qcEnabled: EDITORIAL_QC_ENABLED,
    autoQualityMin: AUTO_QUALITY_MIN,
    diversityEnabled: true,
    platformVariants: true,
    storyUpdates: true,
    mediaDirector: true,
    repairLoop: true
  },
  editorialLearning: {
    updatedAt: "",
    sampleSize: 0,
    byFormat: {},
    bySource: {},
    byTopic: {}
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
  costTracking: {
    version: COST_TRACKING_VERSION,
    startedAt: new Date().toISOString()
  },
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


function loadLegacyState() {
  ensureDataDir();
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const saved = JSON.parse(raw);
    const loaded = Object.assign({}, structuredClone(defaultState), saved);
    loaded.sources = Array.isArray(saved.sources) ? saved.sources : structuredClone(defaultState.sources);
    loaded.migrations = Array.isArray(saved.migrations) ? saved.migrations : [];
    loaded.stats = Object.assign({ discovered: 0, rewritten: 0, published: 0, skipped: 0, expired: 0 }, saved.stats || {});
    loaded.queue = Array.isArray(saved.queue) ? saved.queue : [];
    loaded.costTracking = saved.costTracking && typeof saved.costTracking === "object"
      ? Object.assign(structuredClone(defaultState.costTracking), saved.costTracking)
      : structuredClone(defaultState.costTracking);
    if (saved.costTracking && Array.isArray(saved.costTracking.events)) loaded.costTracking.events = saved.costTracking.events;
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

function normalizeWorkspaceState(saved) {
  const source = saved && typeof saved === "object" ? saved : {};
  const loaded = Object.assign({}, structuredClone(defaultState), source);
  loaded.sources = Array.isArray(source.sources) ? source.sources : structuredClone(defaultState.sources);
  loaded.sourceStats = source.sourceStats && typeof source.sourceStats === "object" ? source.sourceStats : {};
  loaded.migrations = Array.isArray(source.migrations) ? source.migrations : [];
  loaded.stats = Object.assign({ discovered: 0, rewritten: 0, published: 0, skipped: 0, expired: 0 }, source.stats || {});
  loaded.queue = Array.isArray(source.queue) ? source.queue : [];
  loaded.history = Array.isArray(source.history) ? source.history : [];
  loaded.costTracking = source.costTracking && typeof source.costTracking === "object"
    ? Object.assign(structuredClone(defaultState.costTracking), source.costTracking)
    : structuredClone(defaultState.costTracking);
  if (source.costTracking && Array.isArray(source.costTracking.events)) loaded.costTracking.events = source.costTracking.events;
  loaded.costTracking.startedAt = String(loaded.costTracking.startedAt || new Date().toISOString());
  loaded.topicSettings = Object.assign(structuredClone(defaultState.topicSettings), source.topicSettings && typeof source.topicSettings === "object" ? source.topicSettings : {});
  loaded.topicSettings.default = Object.assign({ allow_text_fallback: false, auto_publish_telegram: true, auto_publish_vk: true }, loaded.topicSettings.default || {});
  loaded.publicationSchedule = Object.assign(structuredClone(defaultState.publicationSchedule), loaded.publicationSchedule || {});
  loaded.dynamicScheduler = Object.assign(structuredClone(defaultState.dynamicScheduler), loaded.dynamicScheduler || {});
  ensureScheduleShape(loaded);
  pruneQueueItems(loaded);
  return loaded;
}
function freshWorkspaceState() {
  const fresh = structuredClone(defaultState);
  fresh.mode = "AUTO";
  fresh.sources = [];
  fresh.sourceStats = {};
  fresh.queue = [];
  fresh.history = [];
  fresh.stats = { discovered: 0, rewritten: 0, published: 0, skipped: 0, expired: 0 };
  fresh.sourceCursor = 0;
  fresh.newsVisibleAfter = new Date().toISOString();
  fresh.topicSettings = structuredClone(defaultState.topicSettings);
  fresh.topicSettings.default = Object.assign({}, fresh.topicSettings.default || {}, {
    allow_text_fallback: false,
    auto_publish_telegram: true,
    auto_publish_vk: false
  });
  fresh.publicationSchedule = structuredClone(defaultState.publicationSchedule);
  fresh.dynamicScheduler = structuredClone(defaultState.dynamicScheduler);
  fresh.migrations = Array.isArray(fresh.migrations) ? fresh.migrations : [];
  ensureScheduleShape(fresh);
  return fresh;
}

function normalizeWorkspaceMeta(raw, fallbackId) {
  const id = String(raw && raw.id || fallbackId || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || DEFAULT_WORKSPACE_ID;
  const name = String(raw && raw.name || "Новый канал").trim().slice(0, 80) || "Новый канал";
  const slug = String(raw && raw.slug || "").trim().replace(/^@/, "").slice(0, 80);
  const initialsRaw = String(raw && raw.initials || "").trim().toUpperCase().replace(/[^A-ZА-Я0-9]/gi, "").slice(0, 3);
  const initials = initialsRaw || name.split(/\s+/).filter(Boolean).slice(0, 2).map(function(x){ return x[0] || ""; }).join("").toUpperCase().slice(0, 3) || "NF";
  const telegramChannel = String(raw && raw.telegramChannel || "").trim();
  const telegramPublicUsername = String(raw && raw.telegramPublicUsername || telegramChannel || slug || "").replace(/^@/, "").trim();
  const avatarUrl = String(raw && raw.avatarUrl || "").trim();
  const avatarFile = String(raw && raw.avatarFile || "").trim();
  const channelIdRaw = String(raw && raw.channelId || "").trim().toLowerCase();
  const channelId = EDITORIAL_CHANNEL_IDS.includes(channelIdRaw) ? channelIdRaw : "";
  return { id, name, slug, initials, telegramChannel, telegramPublicUsername, avatarUrl, avatarFile, channelId, createdAt: String(raw && raw.createdAt || new Date().toISOString()), updatedAt: String(raw && raw.updatedAt || new Date().toISOString()), state: normalizeWorkspaceState(raw && raw.state) };
}
function loadWorkspaceStore() {
  ensureDataDir();
  try {
    const parsed = JSON.parse(fs.readFileSync(WORKSPACES_FILE, "utf8"));
    const rawWorkspaces = Array.isArray(parsed && parsed.workspaces) ? parsed.workspaces : [];
    if (rawWorkspaces.length) {
      const workspaces = rawWorkspaces.map(function(ws, index){ return normalizeWorkspaceMeta(ws, index === 0 ? DEFAULT_WORKSPACE_ID : "workspace-" + (index + 1)); });
      const requestedDefault = String(parsed.defaultWorkspaceId || "");
      const defaultWorkspaceId = workspaces.some(function(ws){ return ws.id === requestedDefault; }) ? requestedDefault : workspaces[0].id;
      return { version: 1, defaultWorkspaceId, workspaces };
    }
  } catch {}
  const legacyState = loadLegacyState();
  const first = normalizeWorkspaceMeta({ id: DEFAULT_WORKSPACE_ID, name: "Что там у ИИ?", slug: TELEGRAM_PUBLIC_USERNAME || "chtotamai", initials: "AI", telegramChannel: CHANNEL, telegramPublicUsername: TELEGRAM_PUBLIC_USERNAME, state: legacyState }, DEFAULT_WORKSPACE_ID);
  const created = { version: 1, defaultWorkspaceId: first.id, workspaces: [first] };
  try { fs.writeFileSync(WORKSPACES_FILE, JSON.stringify(created, null, 2), "utf8"); } catch {}
  return created;
}
const workspaceContext = new AsyncLocalStorage();
let workspaceStore = loadWorkspaceStore();
function getWorkspaceById(id) { const normalized = String(id || "").trim(); return workspaceStore.workspaces.find(function(ws){ return ws.id === normalized; }) || null; }
function currentWorkspaceId() { const context = workspaceContext.getStore(); const requested = context && context.workspaceId; if (requested && getWorkspaceById(requested)) return requested; return workspaceStore.defaultWorkspaceId; }
function currentWorkspace() { return getWorkspaceById(currentWorkspaceId()) || workspaceStore.workspaces[0]; }
function currentTelegramChannel() {
  const ws = currentWorkspace();
  return ws ? String(ws.telegramChannel || "").trim() : String(CHANNEL || "").trim();
}
function currentTelegramPublicUsername() {
  const ws = currentWorkspace();
  return ws
    ? String(ws.telegramPublicUsername || ws.slug || ws.telegramChannel || "").replace(/^@/, "").trim()
    : String(TELEGRAM_PUBLIC_USERNAME || CHANNEL || "").replace(/^@/, "").trim();
}
function workspaceVkPublishingAllowed(ws) {
  const target = ws || currentWorkspace();
  return Boolean(target && target.id === workspaceStore.defaultWorkspaceId);
}
function publicWorkspaceMeta(ws) { return { id: ws.id, name: ws.name, slug: ws.slug || "", initials: ws.initials || "NF", telegramChannel: ws.telegramChannel || "", telegramPublicUsername: ws.telegramPublicUsername || "", avatarUrl: ws.avatarUrl || "", vkPublishingAllowed: workspaceVkPublishingAllowed(ws), channelId: ws.channelId || "", editorialChannelId: resolveChannelId(ws), createdAt: ws.createdAt, updatedAt: ws.updatedAt }; }
function persistWorkspaceStore() {
  ensureDataDir();
  fs.writeFileSync(WORKSPACES_FILE, JSON.stringify(workspaceStore, null, 2), "utf8");
  const defaultWorkspace = getWorkspaceById(workspaceStore.defaultWorkspaceId);
  if (defaultWorkspace && defaultWorkspace.state) fs.writeFileSync(STATE_FILE, JSON.stringify(defaultWorkspace.state, null, 2), "utf8");
}

function ensureConfiguredWorkspaces() {
  let changed = false;

  const aiWorkspace = getWorkspaceById(DEFAULT_WORKSPACE_ID) || workspaceStore.workspaces[0];
  if (aiWorkspace && aiWorkspace.state) {
    aiWorkspace.state.migrations = Array.isArray(aiWorkspace.state.migrations) ? aiWorkspace.state.migrations : [];
    const russianAiMigration = "v0.29.3-ai-russian-sources-10";
    if (!aiWorkspace.state.migrations.includes(russianAiMigration)) {
      const existingIds = new Set((aiWorkspace.state.sources || []).map(function(source){ return source && source.id; }));
      for (const source of RUSSIAN_AI_SOURCES) {
        if (!existingIds.has(source.id)) aiWorkspace.state.sources.push(structuredClone(source));
      }
      aiWorkspace.state.russianSourcesBootstrapPending = true;
      aiWorkspace.state.migrations.push(russianAiMigration);
      aiWorkspace.updatedAt = new Date().toISOString();
      changed = true;
    }

    const russianSlotMigration = "v0.29.3-ai-russian-slots-6";
    if (!aiWorkspace.state.migrations.includes(russianSlotMigration)) {
      const schedule = ensureScheduleShape(aiWorkspace.state);
      const slotMap = new Map((schedule.slots || []).map(function(slot){ return [slot.time, slot]; }));
      for (const time of RUSSIAN_AI_SLOTS) {
        if (!slotMap.has(time)) schedule.slots.push({ time: time, kind: "russian-ai", label: "Российский ИИ" });
      }
      schedule.slots.sort(function(a,b){ return String(a.time).localeCompare(String(b.time)); });
      aiWorkspace.state.russianAiScheduler = Object.assign({
        targetPerDay: RUSSIAN_AI_DAILY_TARGET,
        lastPreparedAt: "",
        lastPublishedAt: "",
        lastPublishedSlot: ""
      }, aiWorkspace.state.russianAiScheduler || {});
      aiWorkspace.state.migrations.push(russianSlotMigration);
      aiWorkspace.updatedAt = new Date().toISOString();
      changed = true;
    }
  }

  let cars = workspaceStore.workspaces.find(function(ws){
    const slug = String(ws.slug || ws.telegramPublicUsername || ws.telegramChannel || "").replace(/^@/, "").toLowerCase();
    return slug === "chtotamtachki" || String(ws.name || "").trim().toLowerCase() === "что там у тачек?";
  });
  if (!cars) {
    cars = normalizeWorkspaceMeta({
      id: "chtotamtachki",
      name: "Что там у тачек?",
      slug: "chtotamtachki",
      initials: "АВТ",
      telegramChannel: "@chtotamtachki",
      telegramPublicUsername: "chtotamtachki",
      state: freshWorkspaceState()
    }, "chtotamtachki");
    workspaceStore.workspaces.push(cars);
    changed = true;
  } else {
    if (!cars.telegramChannel) { cars.telegramChannel = "@chtotamtachki"; changed = true; }
    if (!cars.telegramPublicUsername) { cars.telegramPublicUsername = "chtotamtachki"; changed = true; }
    if (!cars.slug) { cars.slug = "chtotamtachki"; changed = true; }
    if (!cars.name) { cars.name = "Что там у тачек?"; changed = true; }
  }
  const autoModeMigration = "v0.28.9-car-auto-mode";
  if (!cars.state.migrations.includes(autoModeMigration)) {
    cars.state.mode = "AUTO";
    cars.state.topicSettings = cars.state.topicSettings || {};
    cars.state.topicSettings.default = Object.assign({}, cars.state.topicSettings.default || {}, {
      allow_text_fallback: false,
      auto_publish_telegram: true,
      auto_publish_vk: false
    });
    cars.state.migrations.push(autoModeMigration);
    changed = true;
  }

  const carSourcesMigration = "v0.28.5-car-sources-30";
  cars.state.migrations = Array.isArray(cars.state.migrations) ? cars.state.migrations : [];
  if (!cars.state.migrations.includes(carSourcesMigration)) {
    cars.state.sources = structuredClone(CAR_SOURCES);
    cars.state.sourceStats = {};
    cars.state.sourceCursor = 0;
    cars.state.migrations.push(carSourcesMigration);
    changed = true;
  }

  const bloggerMigration = "v0.28.6-car-bloggers-10";
  if (!cars.state.migrations.includes(bloggerMigration)) {
    const existingIds = new Set((cars.state.sources || []).map(function(source){ return source && source.id; }));
    for (const source of BLOGGER_SOURCES) {
      if (!existingIds.has(source.id)) cars.state.sources.push(structuredClone(source));
    }
    const schedule = ensureScheduleShape(cars.state);
    const slotMap = new Map((schedule.slots || []).map(function(slot){ return [slot.time, slot]; }));
    for (const time of BLOGGER_SLOTS) {
      if (!slotMap.has(time)) schedule.slots.push({ time: time, kind: "blogger", label: "Автоблогеры" });
    }
    schedule.slots.sort(function(a,b){ return String(a.time).localeCompare(String(b.time)); });
    cars.state.bloggerScheduler = Object.assign({
      targetPerDay: BLOGGER_DAILY_TARGET,
      lastPreparedAt: "",
      lastPublishedAt: "",
      lastPublishedSlot: ""
    }, cars.state.bloggerScheduler || {});
    cars.state.migrations.push(bloggerMigration);
    changed = true;
  }
  // Russian-market sources: prices, sales starts and statistics in Russia.
  const ruCarSourcesMigration = "v0.35.0-car-sources-ru";
  if (!cars.state.migrations.includes(ruCarSourcesMigration)) {
    const existingIds = new Set((cars.state.sources || []).map(function(source){ return source && source.id; }));
    for (const id of ["cars-zr", "cars-autostat", "cars-kolesa", "cars-autoreview"]) {
      const source = CAR_SOURCES.find(function(x){ return x.id === id; });
      if (source && !existingIds.has(id)) cars.state.sources.push(structuredClone(source));
    }
    cars.state.migrations.push(ruCarSourcesMigration);
    changed = true;
  }
  const copyrightMigration = "v0.30.0-copyright-safe-v1";
  for (const ws of workspaceStore.workspaces) {
    if (!ws || !ws.state) continue;
    ws.state.migrations = Array.isArray(ws.state.migrations) ? ws.state.migrations : [];
    if (ws.state.migrations.includes(copyrightMigration)) continue;

    ws.state.copyrightPolicy = Object.assign({
      safeMode: COPYRIGHT_SAFE_MODE,
      factsOnly: true,
      requireSourceLink: true,
      autoUseThirdPartyMedia: false,
      maxVerbatimWords: COPYRIGHT_MAX_VERBATIM_WORDS,
      version: "v1"
    }, ws.state.copyrightPolicy || {});

    const sourceMap = new Map();
    for (const source of (ws.state.sources || [])) {
      if (!source) continue;
      source.mediaLicense = normalizeMediaLicense(source.mediaLicense || "unknown");
      source.copyrightMode = source.copyrightMode || ((source.group === "blogger" || source.group === "creator") ? "facts_only_attributed" : "facts_only");
      sourceMap.set(String(source.id || ""), source);
    }

    for (const item of (ws.state.queue || [])) {
      if (!item) continue;
      const source = sourceMap.get(String(item.sourceId || "")) || null;
      const license = normalizeMediaLicense(item.mediaLicense || (source && source.mediaLicense) || "unknown");
      item.mediaLicense = license;
      item.copyrightMode = item.copyrightMode || ((source && (source.group === "blogger" || source.group === "creator")) ? "facts_only_attributed" : "facts_only");
      const sourceReuseAllowed = mediaLicenseAllowsReuse(license);
      const generatedIsIndependent = item.mediaStatus === "generated" || item.mediaOrigin === "ai_generated" || isIndependentGeneratedUrl(item.generatedImageUrl);
      if (COPYRIGHT_SAFE_MODE && !sourceReuseAllowed && !generatedIsIndependent) {
        item.originalImageUrl = item.originalImageUrl || item.imageUrl || "";
        item.originalVideoUrl = item.originalVideoUrl || item.videoUrl || "";
        item.imageUrl = "";
        item.videoUrl = "";
        item.generatedImageUrl = "";
        item.mediaType = "none";
        item.mediaStatus = "copyright_pending";
        item.mediaOrigin = "source_media_blocked";
        item.copyrightSafe = true;
      }
    }

    ws.state.migrations.push(copyrightMigration);
    ws.updatedAt = new Date().toISOString();
    changed = true;
  }

  const balancedMediaMigration = "v0.31.2-balanced-source-media";
  for (const ws of workspaceStore.workspaces) {
    if (!ws || !ws.state) continue;
    ws.state.migrations = Array.isArray(ws.state.migrations) ? ws.state.migrations : [];
    if (ws.state.migrations.includes(balancedMediaMigration)) continue;

    ws.state.copyrightPolicy = Object.assign({}, ws.state.copyrightPolicy || {}, {
      safeMode: COPYRIGHT_SAFE_MODE,
      mediaMode: COPYRIGHT_MEDIA_MODE,
      factsOnly: true,
      requireSourceLink: true,
      autoUseThirdPartyMedia: COPYRIGHT_MEDIA_MODE === "balanced",
      maxVerbatimWords: COPYRIGHT_MAX_VERBATIM_WORDS,
      version: "v2"
    });

    const sourceMap = new Map((ws.state.sources || []).map(function(source){ return [String(source && source.id || ""), source]; }));
    for (const item of (ws.state.queue || [])) {
      if (!item) continue;
      const source = sourceMap.get(String(item.sourceId || "")) || null;
      const license = normalizeMediaLicense(item.mediaLicense || (source && source.mediaLicense) || "unknown");
      item.mediaLicense = license;
      item.copyrightSafe = COPYRIGHT_SAFE_MODE;
      item.copyrightMediaMode = COPYRIGHT_MEDIA_MODE;
      item.copyrightPolicyVersion = "v2";

      if (mediaLicenseAllowsReuse(license)) {
        const sourceVideo = String(item.originalVideoUrl || item.videoUrl || "").trim();
        const sourceImage = String(item.originalImageUrl || item.imageUrl || "").trim();

        if (sourceVideo) {
          item.videoUrl = sourceVideo;
          if (sourceImage) item.imageUrl = sourceImage;
          item.mediaType = "video";
          item.mediaStatus = "video_found";
          item.mediaPriority = 1;
          item.mediaOrigin = "source_media";
          item.copyrightMediaDecision = "balanced_source_reuse";
        } else if (sourceImage) {
          item.imageUrl = sourceImage;
          item.videoUrl = "";
          item.mediaType = "photo";
          item.mediaStatus = "photo_found";
          item.mediaPriority = 2;
          item.mediaOrigin = "source_media";
          item.copyrightMediaDecision = "balanced_source_reuse";
        }
      }
    }

    ws.state.migrations.push(balancedMediaMigration);
    ws.updatedAt = new Date().toISOString();
    changed = true;
  }

  const editorialIntelligenceMigration = "v0.32.0-editorial-intelligence";
  for (const ws of workspaceStore.workspaces) {
    if (!ws || !ws.state) continue;
    ws.state.migrations = Array.isArray(ws.state.migrations) ? ws.state.migrations : [];
    if (ws.state.migrations.includes(editorialIntelligenceMigration)) continue;

    ws.state.editorialPolicy = Object.assign({
      qcEnabled: EDITORIAL_QC_ENABLED,
      autoQualityMin: AUTO_QUALITY_MIN,
      diversityEnabled: true,
      platformVariants: true,
      storyUpdates: true,
      mediaDirector: true,
      repairLoop: true
    }, ws.state.editorialPolicy || {});
    ws.state.editorialLearning = Object.assign({
      updatedAt: "",
      sampleSize: 0,
      byFormat: {},
      bySource: {},
      byTopic: {}
    }, ws.state.editorialLearning || {});

    for (const source of (ws.state.sources || [])) {
      if (!source) continue;
      source.editorialRole = source.editorialRole || sourceEditorialRole(source);
    }

    for (const item of (ws.state.queue || [])) {
      if (!item) continue;
      item.sourceRole = item.sourceRole || sourceEditorialRole(item);
      if (!Number.isFinite(Number(item.qualityScore))) {
        item.qualityScore = 72;
        item.qualityBreakdown = item.qualityBreakdown || { hook: 14, clarity: 11, factuality: 20, originality: 10, structure: 7, mediaFit: 10 };
        item.qcStatus = item.qcStatus || "legacy_pass";
        item.qcIssues = Array.isArray(item.qcIssues) ? item.qcIssues : [];
      }
      item.topicEntities = normalizeTopicEntities(item.topicEntities);
      item.platformVariants = item.platformVariants && typeof item.platformVariants === "object" ? item.platformVariants : {
        telegram: { title: item.title || "", text: item.text || "" },
        vk: { title: item.title || "", text: item.text || "" }
      };
      item.decisionSummary = item.decisionSummary || "Старая карточка адаптирована к новому редакционному контуру.";
    }

    for (const h of (ws.state.history || [])) {
      if (!h) continue;
      h.sourceRole = h.sourceRole || sourceEditorialRole(h);
      h.topicEntities = normalizeTopicEntities(h.topicEntities);
    }

    ws.state.migrations.push(editorialIntelligenceMigration);
    ws.updatedAt = new Date().toISOString();
    changed = true;
  }

  if (changed) {
    cars.updatedAt = new Date().toISOString();
    persistWorkspaceStore();
  }
}
ensureConfiguredWorkspaces();

const state = new Proxy({}, {
  get: function(_target, prop){ return currentWorkspace().state[prop]; },
  set: function(_target, prop, value){ currentWorkspace().state[prop] = value; return true; },
  deleteProperty: function(_target, prop){ return delete currentWorkspace().state[prop]; },
  ownKeys: function(){ return Reflect.ownKeys(currentWorkspace().state); },
  has: function(_target, prop){ return prop in currentWorkspace().state; },
  getOwnPropertyDescriptor: function(_target, prop){ const d = Object.getOwnPropertyDescriptor(currentWorkspace().state, prop); return d || { configurable: true, enumerable: true, writable: true, value: currentWorkspace().state[prop] }; }
});

let cbrUsdRubCache = { at: 0, value: null };
let infraSizeCache = { at: 0, mediaBytes: 0, dbBytes: 0 };
const costEventBuffer = [];
let costBufferFlushRunning = false;
let costRetentionTimer = null;

function ensureCostTracking(targetState) {
  if (!targetState.costTracking || typeof targetState.costTracking !== "object") {
    targetState.costTracking = { version: COST_TRACKING_VERSION, startedAt: new Date().toISOString() };
  }
  targetState.costTracking.version = COST_TRACKING_VERSION;
  if (!targetState.costTracking.startedAt) targetState.costTracking.startedAt = new Date().toISOString();
  return targetState.costTracking;
}

function bufferCostEvent(row) {
  if (!row) return;
  costEventBuffer.push(row);
  if (costEventBuffer.length > COST_EVENT_BUFFER_MAX) {
    costEventBuffer.splice(0, costEventBuffer.length - COST_EVENT_BUFFER_MAX);
    console.warn("Cost event buffer reached limit; oldest events were dropped");
  }
}

async function insertCostEventRow(row) {
  if (!db || !dbReady) throw new Error("PostgreSQL unavailable");
  await db.query(
    `INSERT INTO cost_events(
      id, at, workspace_id, provider, model, operation, endpoint, kind,
      input_tokens, output_tokens, cached_input_tokens, cache_read_tokens, cache_write_tokens,
      image_input_tokens, image_output_tokens, cost_usd, pricing_known, estimated, news_id, extra
    ) VALUES(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb
    ) ON CONFLICT (id) DO NOTHING`,
    [
      row.id, row.at, row.workspaceId, row.provider, row.model, row.operation, row.endpoint, row.kind,
      row.inputTokens, row.outputTokens, row.cachedInputTokens, row.cacheReadTokens, row.cacheWriteTokens,
      row.imageInputTokens, row.imageOutputTokens, row.costUsd, row.pricingKnown, row.estimated,
      row.newsId || null, JSON.stringify(row.extra || {})
    ]
  );
  scheduleCostBudgetCheck();
}

function persistCostEvent(row) {
  if (!db || !dbReady) {
    bufferCostEvent(row);
    return;
  }
  insertCostEventRow(row).catch(function(error) {
    bufferCostEvent(row);
    console.warn("Cost event insert failed:", error.message);
  });
}

async function flushCostEventBuffer() {
  if (costBufferFlushRunning || !db || !dbReady || !costEventBuffer.length) return { flushed: 0, remaining: costEventBuffer.length };
  costBufferFlushRunning = true;
  let flushed = 0;
  try {
    while (costEventBuffer.length && dbReady) {
      const row = costEventBuffer[0];
      try {
        await insertCostEventRow(row);
        costEventBuffer.shift();
        flushed += 1;
      } catch (error) {
        console.warn("Cost buffer flush failed:", error.message);
        break;
      }
    }
  } finally {
    costBufferFlushRunning = false;
  }
  return { flushed: flushed, remaining: costEventBuffer.length };
}

async function migrateLegacyCostEventsToPostgres() {
  if (!db || !dbReady) return { workspaces: 0, events: 0, skipped: true };
  const rows = collectLegacyCostRows(workspaceStore.workspaces, COST_STATE_MIGRATION_ID);
  let inserted = 0;
  for (const row of rows) {
    await insertCostEventRow(row);
    inserted += 1;
  }
  const changed = stripLegacyCostEvents(workspaceStore.workspaces, COST_STATE_MIGRATION_ID);
  if (changed.workspaces) persistWorkspaceStore();
  console.log("Cost events legacy migration:", JSON.stringify({ workspaces: changed.workspaces, events: inserted }));
  return { workspaces: changed.workspaces, events: inserted };
}

async function refreshStoredCostPricing() {
  if (!db || !dbReady) return { updated: 0 };
  let updated = 0;
  for (const [model, rate] of Object.entries(COST_PRICING.anthropic || {})) {
    const result = await db.query(
      `UPDATE cost_events SET
        cost_usd=((input_tokens::numeric*$2::numeric)+(cache_read_tokens::numeric*$3::numeric)+(cache_write_tokens::numeric*$4::numeric)+(output_tokens::numeric*$5::numeric))/1000000.0,
        pricing_known=TRUE, estimated=FALSE
       WHERE provider='anthropic' AND model=$1`,
      [model, Number(rate.input || 0), Number(rate.cacheRead || 0), Number(rate.cacheWrite || 0), Number(rate.output || 0)]
    );
    updated += Number(result.rowCount || 0);
  }
  const knownOpenAI = Object.keys(COST_PRICING.openaiText || {});
  if (knownOpenAI.length) {
    const unknown = await db.query(
      "UPDATE cost_events SET pricing_known=FALSE, estimated=TRUE WHERE provider='openai' AND kind='text' AND NOT (model = ANY($1::text[]))",
      [knownOpenAI]
    );
    updated += Number(unknown.rowCount || 0);
  }
  return { updated: updated };
}

async function cleanupCostEvents() {
  if (!db || !dbReady) return { deleted: 0 };
  const result = await db.query(
    "DELETE FROM cost_events WHERE at < NOW() - ($1::text || ' days')::interval",
    [String(COST_TRACKING_RETENTION_DAYS)]
  );
  return { deleted: Number(result.rowCount || 0) };
}

function scheduleCostRetentionCleanup() {
  if (costRetentionTimer) clearInterval(costRetentionTimer);
  costRetentionTimer = setInterval(function() {
    cleanupCostEvents().catch(function(error){ console.warn("Cost retention cleanup failed:", error.message); });
    flushCostEventBuffer().catch(function(error){ console.warn("Cost buffer flush failed:", error.message); });
  }, 24 * 60 * 60 * 1000);
  if (costRetentionTimer && typeof costRetentionTimer.unref === "function") costRetentionTimer.unref();
}

function recordCostUsage(event) {
  const e = event && typeof event === "object" ? event : {};
  const provider = String(e.provider || "").toLowerCase();
  if (!provider) return null;
  const model = String(e.model || "unknown");
  const endpoint = String(e.endpoint || (provider === "anthropic" ? "messages" : "responses"));
  const priced = calculateApiUsageCost(provider, model, e.usage || {}, endpoint, COST_PRICING);
  const extra = e.extra && typeof e.extra === "object" ? e.extra : {};
  const row = {
    id: "cost_" + crypto.randomBytes(10).toString("hex"),
    at: new Date().toISOString(),
    workspaceId: currentWorkspaceId(),
    provider: provider,
    model: model,
    operation: String(e.purpose || e.operation || "api_call").slice(0, 80),
    endpoint: endpoint,
    kind: priced.kind,
    inputTokens: priced.inputTokens,
    outputTokens: priced.outputTokens,
    cachedInputTokens: priced.cachedInputTokens,
    cacheReadTokens: priced.cacheReadTokens,
    cacheWriteTokens: priced.cacheWriteTokens,
    imageInputTokens: priced.imageInputTokens,
    imageOutputTokens: priced.imageOutputTokens,
    textInputTokens: priced.textInputTokens,
    costUsd: Number(priced.costUsd || 0),
    pricingKnown: Boolean(priced.pricingKnown),
    estimated: Boolean(priced.estimated),
    newsId: String(e.newsId || extra.news_id || extra.newsId || "").trim() || null,
    extra: extra
  };
  persistCostEvent(row);
  return row;
}

function recordOpenAIResponseUsage(model, operation, data, endpoint, extra) {
  const details = extra && typeof extra === "object" ? extra : {};
  return recordCostUsage({
    provider: "openai",
    model: model,
    purpose: operation,
    endpoint: endpoint || "responses",
    usage: data && data.usage || {},
    newsId: details.news_id || details.newsId || "",
    extra: details
  });
}

function operationLabel(value) {
  const labels = {
    editorial_writer: "Редакция v2 · написание поста",
    editorial_checker_openai: "Редакция v2 · проверка GPT",
    editorial_checker_anthropic: "Редакция v2 · проверка Claude",
    editorial_checker_anthropic_repair: "Claude · повтор JSON-проверки",
    editorial_health: "Claude · проверка подключения",
    telegram_caption_compact: "Telegram · сокращение подписи",
    legacy_rewrite: "Старая редакция · рерайт",
    editorial_qc: "Финальный QC",
    story_relation: "Проверка дубля/обновления",
    story_composer: "Объединение нескольких источников",
    title_translation: "Перевод заголовков",
    editorial_score_batch: "Пакетный рейтинг новостей",
    image_generation: "AI-обложка / fallback"
  };
  return labels[String(value || "")] || String(value || "Другое");
}

function providerLabel(value) {
  const map = { openai: "OpenAI", anthropic: "Anthropic Claude" };
  return map[String(value || "")] || String(value || "Другое");
}

async function getUsdRubRate() {
  const now = Date.now();
  if (cbrUsdRubCache.value && now - cbrUsdRubCache.at < 6 * 60 * 60 * 1000) return cbrUsdRubCache.value;
  try {
    const response = await fetch("https://www.cbr.ru/scripts/XML_daily.asp", {
      headers: { "user-agent": "NewsFactory/1.0" },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error("CBR HTTP " + response.status);
    const xml = await response.text();
    const block = xml.match(/<Valute[^>]*>[\s\S]*?<CharCode>USD<\/CharCode>[\s\S]*?<\/Valute>/i);
    if (!block) throw new Error("USD not found");
    const nominalMatch = block[0].match(/<Nominal>([^<]+)<\/Nominal>/i);
    const valueMatch = block[0].match(/<Value>([^<]+)<\/Value>/i);
    const nominal = Number(String(nominalMatch && nominalMatch[1] || "1").replace(",", "."));
    const value = Number(String(valueMatch && valueMatch[1] || "").replace(",", "."));
    if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(nominal) || nominal <= 0) throw new Error("bad CBR rate");
    const rate = value / nominal;
    cbrUsdRubCache = { at: now, value: rate };
    return rate;
  } catch {
    const fallback = Number(process.env.COST_USD_RUB_RATE || 0);
    return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
  }
}

function directoryBytes(dir) {
  let total = 0;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) total += directoryBytes(full);
      else if (entry.isFile()) total += fs.statSync(full).size;
    } catch {}
  }
  return total;
}

async function getInfrastructureEstimate() {
  const now = Date.now();
  if (now - infraSizeCache.at > 5 * 60 * 1000) {
    let dbBytes = infraSizeCache.dbBytes || 0;
    if (db && dbReady) {
      try {
        const r = await db.query("SELECT pg_database_size(current_database())::bigint AS bytes");
        dbBytes = Number(r.rows && r.rows[0] && r.rows[0].bytes || 0);
      } catch {}
    }
    infraSizeCache = { at: now, mediaBytes: directoryBytes(MEDIA_DIR), dbBytes };
  }
  const uptimeSec = Math.max(1, process.uptime());
  const cpu = process.cpuUsage();
  const avgVcpu = Math.max(0, (Number(cpu.user || 0) + Number(cpu.system || 0)) / 1000000 / uptimeSec);
  const rssGb = process.memoryUsage().rss / 1000000000;
  const mediaGb = infraSizeCache.mediaBytes / 1000000000;
  const dbGb = infraSizeCache.dbBytes / 1000000000;
  const appCpuMonthly = avgVcpu * COST_PRICING.railway.cpuVcpuMonth;
  const appMemoryMonthly = rssGb * COST_PRICING.railway.memoryGbMonth;
  const mediaStorageMonthly = mediaGb * COST_PRICING.railway.volumeGbMonth;
  const dbStorageMonthly = dbGb * COST_PRICING.railway.volumeGbMonth;
  return {
    estimatedMonthlyUsd: appCpuMonthly + appMemoryMonthly + mediaStorageMonthly + dbStorageMonthly,
    partial: true,
    note: "Оценка run-rate: CPU/RAM news-factory-api + объём media и БД. Compute Postgres, egress и тариф Railway в эту оценку не входят.",
    services: [
      { id: "news-factory-api", name: "Railway · news-factory-api", monthlyUsd: appCpuMonthly + appMemoryMonthly, detail: "CPU ≈ " + avgVcpu.toFixed(4) + " vCPU · RAM ≈ " + rssGb.toFixed(3) + " GB" },
      { id: "media-volume", name: "Railway · media volume", monthlyUsd: mediaStorageMonthly, detail: "Хранилище ≈ " + mediaGb.toFixed(3) + " GB" },
      { id: "postgres-storage", name: "Railway · Postgres storage", monthlyUsd: dbStorageMonthly, detail: "База ≈ " + dbGb.toFixed(3) + " GB · compute не включён" }
    ]
  };
}



let costBudgetCheckTimer = null;
let costBudgetInterval = null;

function networkCostBudgetState() {
  const ws = getWorkspaceById(workspaceStore.defaultWorkspaceId) || workspaceStore.workspaces[0];
  if (!ws.state.costBudget || typeof ws.state.costBudget !== "object") {
    ws.state.costBudget = {
      monthlyRub: COST_MONTHLY_BUDGET_RUB,
      dailyRub: COST_DAILY_BUDGET_RUB,
      economyMode: false,
      economyReason: "",
      alerts: {},
      updatedAt: ""
    };
  }
  const b = ws.state.costBudget;
  b.monthlyRub = Math.max(0, Number(b.monthlyRub || 0) || 0);
  b.dailyRub = Math.max(0, Number(b.dailyRub || 0) || 0);
  if (!b.alerts || typeof b.alerts !== "object") b.alerts = {};
  return b;
}

function costEconomyMode() {
  return Boolean(networkCostBudgetState().economyMode);
}

async function costBudgetSnapshot(knownRate) {
  const b = networkCostBudgetState();
  const now = new Date();
  const rate = Number(knownRate || 0) || await getUsdRubRate();
  const todayBounds = moscowPeriodBounds("today", now, 1);
  const monthStart = new Date(Date.UTC(todayBounds.moscowYear, todayBounds.moscowMonth - 1, 1, -3, 0, 0, 0));
  let todayUsd = 0, monthUsd = 0;
  if (db && dbReady) {
    todayUsd = (await costSummaryBetween(todayBounds.start, now, false, "")).costUsd;
    monthUsd = (await costSummaryBetween(monthStart, now, false, "")).costUsd;
  }
  const todayRub = rate ? todayUsd * rate : 0;
  const monthToDateRub = rate ? monthUsd * rate : 0;
  return {
    configured: Boolean(b.monthlyRub || b.dailyRub),
    monthlyBudgetRub: b.monthlyRub,
    dailyBudgetRub: b.dailyRub,
    todayRub: todayRub,
    monthToDateRub: monthToDateRub,
    monthlyRatio: b.monthlyRub ? monthToDateRub / b.monthlyRub : 0,
    dailyRatio: b.dailyRub ? todayRub / b.dailyRub : 0,
    economyMode: Boolean(b.economyMode),
    economyReason: String(b.economyReason || ""),
    fxAvailable: Boolean(rate)
  };
}

async function sendCostBudgetAlert(snapshot, threshold) {
  if (!BOT_TOKEN) return false;
  const ws = getWorkspaceById(workspaceStore.defaultWorkspaceId) || workspaceStore.workspaces[0];
  const alertChatId = TELEGRAM_ALERT_CHAT_ID || String(ws.state.telegramAlertChatId || "").trim();
  if (!alertChatId) return false;
  const parts = [];
  if (snapshot.dailyBudgetRub && snapshot.dailyRatio >= threshold / 100) {
    parts.push("День: " + Math.round(snapshot.todayRub).toLocaleString("ru-RU") + " ₽ из " + Math.round(snapshot.dailyBudgetRub).toLocaleString("ru-RU") + " ₽");
  }
  if (snapshot.monthlyBudgetRub && snapshot.monthlyRatio >= threshold / 100) {
    parts.push("Месяц: " + Math.round(snapshot.monthToDateRub).toLocaleString("ru-RU") + " ₽ из " + Math.round(snapshot.monthlyBudgetRub).toLocaleString("ru-RU") + " ₽");
  }
  if (!parts.length) return false;
  await telegramApi("sendMessage", {
    chat_id: alertChatId,
    text: (threshold >= 100 ? "🚨 News Factory: бюджет исчерпан" : "⚠️ News Factory: 80% бюджета") + "\n" + parts.join("\n") +
      (threshold >= 100 ? "\nВключён режим экономии." : ""),
    disable_web_page_preview: true
  });
  return true;
}

async function evaluateCostBudget(notify) {
  const b = networkCostBudgetState();
  const snap = await costBudgetSnapshot();
  const dailyOver = snap.dailyBudgetRub > 0 && snap.dailyRatio >= 1;
  const monthlyOver = snap.monthlyBudgetRub > 0 && snap.monthlyRatio >= 1;
  const economy = Boolean(dailyOver || monthlyOver);
  const reason = dailyOver && monthlyOver ? "daily_and_monthly" : (dailyOver ? "daily" : (monthlyOver ? "monthly" : ""));
  let dirty = b.economyMode !== economy || b.economyReason !== reason;
  b.economyMode = economy;
  b.economyReason = reason;
  if (dirty) b.updatedAt = new Date().toISOString();

  if (notify && snap.configured && snap.fxAvailable) {
    const mskDay = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0,10);
    for (const threshold of [80,100]) {
      const reached = (snap.dailyBudgetRub && snap.dailyRatio >= threshold/100) || (snap.monthlyBudgetRub && snap.monthlyRatio >= threshold/100);
      const key = "last" + threshold + "Day";
      if (reached && b.alerts[key] !== mskDay) {
        try {
          if (await sendCostBudgetAlert(snap, threshold)) {
            b.alerts[key] = mskDay;
            dirty = true;
          }
        } catch (error) {
          console.warn("Cost budget Telegram alert failed:", error.message);
        }
      }
    }
  }
  if (dirty) persistWorkspaceStore();
  return Object.assign({}, snap, { economyMode: economy, economyReason: reason });
}

function scheduleCostBudgetCheck() {
  if (costBudgetCheckTimer) return;
  costBudgetCheckTimer = setTimeout(function() {
    costBudgetCheckTimer = null;
    evaluateCostBudget(true).catch(function(error){ console.warn("Cost budget check failed:", error.message); });
  }, 3500);
  if (costBudgetCheckTimer.unref) costBudgetCheckTimer.unref();
}

function startCostBudgetMonitor() {
  if (costBudgetInterval) clearInterval(costBudgetInterval);
  costBudgetInterval = setInterval(function() {
    evaluateCostBudget(true).catch(function(error){ console.warn("Cost budget monitor failed:", error.message); });
  }, 10 * 60 * 1000);
  if (costBudgetInterval.unref) costBudgetInterval.unref();
}

async function renderEconomyTextCard(payload) {
  ensureDataDir();
  const raw = String(payload && payload.title || "Новость").trim().slice(0,160);
  const esc = function(v){ return String(v||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); };
  const words = raw.split(/\s+/), lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? line + " " + word : word;
    if (next.length > 34 && line) { lines.push(line); line = word; } else line = next;
    if (lines.length >= 3) break;
  }
  if (line && lines.length < 4) lines.push(line);
  const text = lines.slice(0,4).map(function(v,i){
    return '<text x="90" y="'+(360+i*100)+'" font-family="Arial,sans-serif" font-size="70" font-weight="700" fill="#15232d">'+esc(v)+'</text>';
  }).join("");
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024"><rect width="1536" height="1024" fill="#eef8f8"/><rect width="20" height="1024" fill="#1fc8c5"/><text x="90" y="170" font-family="Arial,sans-serif" font-size="40" font-weight="700" fill="#159d9b">'+esc(currentWorkspace().name||"News Factory")+'</text>'+text+'<text x="90" y="915" font-family="Arial,sans-serif" font-size="30" fill="#61727c">Режим экономии · без AI-обложки</text></svg>';
  const fileName = "budget_card_" + String(payload && payload.id || crypto.randomBytes(5).toString("hex")).replace(/[^a-zA-Z0-9_-]/g,"_").slice(0,70) + "_" + Date.now() + ".webp";
  await sharp(Buffer.from(svg)).webp({quality:86}).toFile(path.join(MEDIA_DIR,fileName));
  return { url: mediaPublicUrl(fileName), model: "local-budget-card", economy: true };
}

async function costSummaryBetween(startAt, endAt, workspaceOnly, workspaceId) {
  const params = [startAt.toISOString(), endAt.toISOString()];
  let where = "WHERE at >= $1 AND at < $2";
  if (workspaceOnly) {
    params.push(workspaceId);
    where += " AND workspace_id=$3";
  }
  const result = await db.query(
    "SELECT COUNT(*)::int AS calls, " +
    "COALESCE(SUM(cost_usd),0)::float8 AS cost_usd, " +
    "COALESCE(SUM(input_tokens + CASE WHEN provider='anthropic' THEN cache_read_tokens + cache_write_tokens ELSE 0 END),0)::float8 AS input_tokens, " +
    "COALESCE(SUM(output_tokens),0)::float8 AS output_tokens, " +
    "COUNT(*) FILTER (WHERE NOT pricing_known)::int AS unpriced_calls, " +
    "COUNT(*) FILTER (WHERE estimated)::int AS estimated_calls " +
    "FROM cost_events " + where,
    params
  );
  const row = result.rows[0] || {};
  return {
    calls: Number(row.calls || 0),
    costUsd: Number(row.cost_usd || 0),
    inputTokens: Number(row.input_tokens || 0),
    outputTokens: Number(row.output_tokens || 0),
    unpricedCalls: Number(row.unpriced_calls || 0),
    estimatedCalls: Number(row.estimated_calls || 0)
  };
}

async function wastedCostBetween(startAt, endAt, workspaceOnly, workspaceId) {
  const params = [startAt.toISOString(), endAt.toISOString(), ["editorial_skip","duplicate_story","rewrite_error"]];
  let workspaceClause = "";
  if (workspaceOnly) {
    params.push(workspaceId);
    workspaceClause = " AND c.workspace_id=$4";
  }
  const result = await db.query(
    "SELECT COALESCE(SUM(c.cost_usd),0)::float8 AS cost_usd " +
    "FROM cost_events c JOIN news_items n ON n.id=c.news_id AND n.workspace_id=c.workspace_id " +
    "WHERE c.at >= $1 AND c.at < $2 AND n.status = ANY($3::text[])" + workspaceClause,
    params
  );
  return Number(result.rows[0] && result.rows[0].cost_usd || 0);
}

function publishedCountsBetween(startAt, endAt, workspaceOnly, workspaceId) {
  const out = new Map();
  for (const ws of workspaceStore.workspaces) {
    if (!ws || !ws.state || (workspaceOnly && ws.id !== workspaceId)) continue;
    let count = 0;
    for (const item of (ws.state.history || [])) {
      if (!item || !item.publishedAt) continue;
      const ts = new Date(item.publishedAt).getTime();
      if (Number.isFinite(ts) && ts >= startAt.getTime() && ts < endAt.getTime()) count += 1;
    }
    out.set(ws.id, count);
  }
  return out;
}

async function buildCostsReport(days, scope, workspaceId, requestedPeriod) {
  const now = new Date();
  const safeDays = Math.max(1, Math.min(COST_TRACKING_RETENTION_DAYS, Number(days || 30)));
  const workspaceOnly = scope === "workspace";
  const requested = String(requestedPeriod || "").toLowerCase();
  const period = ["today","7","30","month","year"].includes(requested) ? requested : "";
  const bounds = moscowPeriodBounds(period, now, safeDays);
  const rate = await getUsdRubRate();
  const infrastructure = await getInfrastructureEstimate();
  const convertRub = function(usd){ return rate ? Number(usd || 0) * rate : null; };
  const emptyMetric = function(){ return { costUsd: 0, costRub: rate ? 0 : null, calls: 0, changePct: 0 }; };

  if (!db || !dbReady) {
    return {
      ok: false,
      scope: workspaceOnly ? "workspace" : "network",
      days: safeDays,
      selectedPeriod: { period: period || "custom", label: bounds.label, start: bounds.start.toISOString(), end: bounds.end.toISOString() },
      dbReady: false,
      bufferedEvents: costEventBuffer.length,
      trackingStartedAt: new Date().toISOString(),
      pricingUpdatedAt: COST_PRICING_UPDATED_AT,
      pricingOverridden: Boolean(COST_PRICING_CONFIG.overridden),
      currency: { usdRub: rate, source: rate ? "CBR" : "USD only" },
      totals: { costUsd: 0, costRub: rate ? 0 : null, calls: 0, inputTokens: 0, outputTokens: 0, unpricedCalls: 0, estimatedCalls: 0 },
      today: emptyMetric(),
      monthToDate: emptyMetric(),
      forecastMonth: emptyMetric(),
      costPerPublishedPost: Object.assign(emptyMetric(), { publishedPosts: 0 }),
      wastedOnSkipped: Object.assign(emptyMetric(), { sharePct: 0 }),
      providers: [], operations: [], workspaces: [], daily: [],
      infrastructure: Object.assign({}, infrastructure, {
        estimatedMonthlyRub: convertRub(infrastructure.estimatedMonthlyUsd),
        services: infrastructure.services.map(function(s){ return Object.assign({}, s, { monthlyRub: convertRub(s.monthlyUsd) }); })
      }),
      budget: await costBudgetSnapshot(rate),
      freeServices: [],
      note: "PostgreSQL временно недоступен; новые события находятся в памяти и будут дозаписаны автоматически."
    };
  }

  const selectedParams = [bounds.start.toISOString(), bounds.end.toISOString()];
  let selectedWhere = "WHERE at >= $1 AND at < $2";
  if (workspaceOnly) {
    selectedParams.push(workspaceId);
    selectedWhere += " AND workspace_id=$3";
  }

  const selected = await costSummaryBetween(bounds.start, bounds.end, workspaceOnly, workspaceId);
  const previous = await costSummaryBetween(bounds.previousStart, bounds.previousEnd, workspaceOnly, workspaceId);
  const wastedUsd = await wastedCostBetween(bounds.start, bounds.end, workspaceOnly, workspaceId);

  const todayBounds = moscowPeriodBounds("today", now, 1);
  const monthStart = new Date(Date.UTC(todayBounds.moscowYear, todayBounds.moscowMonth - 1, 1, -3, 0, 0, 0));
  const previousMonthStart = new Date(Date.UTC(todayBounds.moscowYear, todayBounds.moscowMonth - 2, 1, -3, 0, 0, 0));
  const previousMonthNominalEnd = new Date(previousMonthStart.getTime() + (now.getTime() - monthStart.getTime()));
  const previousMonthEnd = previousMonthNominalEnd.getTime() > monthStart.getTime() ? monthStart : previousMonthNominalEnd;

  const todaySummary = await costSummaryBetween(todayBounds.start, now, workspaceOnly, workspaceId);
  const previousToday = await costSummaryBetween(
    new Date(todayBounds.start.getTime() - 24*60*60*1000),
    new Date(now.getTime() - 24*60*60*1000),
    workspaceOnly, workspaceId
  );
  const monthSummary = await costSummaryBetween(monthStart, now, workspaceOnly, workspaceId);
  const previousMonthComparable = await costSummaryBetween(previousMonthStart, previousMonthEnd, workspaceOnly, workspaceId);

  const providerQ = await db.query(
    "SELECT provider AS id, COUNT(*)::int AS calls, COALESCE(SUM(cost_usd),0)::float8 AS cost_usd, " +
    "COALESCE(SUM(input_tokens + CASE WHEN provider='anthropic' THEN cache_read_tokens + cache_write_tokens ELSE 0 END),0)::float8 AS input_tokens, " +
    "COALESCE(SUM(output_tokens),0)::float8 AS output_tokens, COUNT(*) FILTER (WHERE NOT pricing_known)::int AS unpriced_calls, " +
    "COUNT(*) FILTER (WHERE estimated)::int AS estimated_calls FROM cost_events " + selectedWhere +
    " GROUP BY provider ORDER BY cost_usd DESC, calls DESC",
    selectedParams
  );
  const operationQ = await db.query(
    "SELECT provider, operation, model, COUNT(*)::int AS calls, COALESCE(SUM(cost_usd),0)::float8 AS cost_usd, " +
    "COALESCE(SUM(input_tokens + CASE WHEN provider='anthropic' THEN cache_read_tokens + cache_write_tokens ELSE 0 END),0)::float8 AS input_tokens, " +
    "COALESCE(SUM(output_tokens),0)::float8 AS output_tokens, COUNT(*) FILTER (WHERE NOT pricing_known)::int AS unpriced_calls, " +
    "COUNT(*) FILTER (WHERE estimated)::int AS estimated_calls FROM cost_events " + selectedWhere +
    " GROUP BY provider, operation, model ORDER BY cost_usd DESC, calls DESC",
    selectedParams
  );

  const workspaceStatuses = ["editorial_skip","duplicate_story","rewrite_error"];
  const workspaceParams = selectedParams.slice();
  workspaceParams.push(workspaceStatuses);
  const statusParam = "$" + workspaceParams.length;
  const workspaceWhere = "WHERE c.at >= $1 AND c.at < $2" + (workspaceOnly ? " AND c.workspace_id=$3" : "");
  const workspaceQ = await db.query(
    "SELECT c.workspace_id AS id, COUNT(*)::int AS calls, COALESCE(SUM(c.cost_usd),0)::float8 AS cost_usd, " +
    "COALESCE(SUM(c.input_tokens + CASE WHEN c.provider='anthropic' THEN c.cache_read_tokens + c.cache_write_tokens ELSE 0 END),0)::float8 AS input_tokens, " +
    "COALESCE(SUM(c.output_tokens),0)::float8 AS output_tokens, COUNT(*) FILTER (WHERE NOT c.pricing_known)::int AS unpriced_calls, " +
    "COUNT(*) FILTER (WHERE c.estimated)::int AS estimated_calls, " +
    "COALESCE(SUM(c.cost_usd) FILTER (WHERE n.status = ANY(" + statusParam + "::text[])),0)::float8 AS wasted_usd " +
    "FROM cost_events c LEFT JOIN news_items n ON n.id=c.news_id AND n.workspace_id=c.workspace_id " + workspaceWhere +
    " GROUP BY c.workspace_id ORDER BY cost_usd DESC, calls DESC",
    workspaceParams
  );

  const dailyBounds = moscowPeriodBounds("30", now, 30);
  const dailyParams = [dailyBounds.start.toISOString(), now.toISOString()];
  let dailyWorkspace = "";
  if (workspaceOnly) {
    dailyParams.push(workspaceId);
    dailyWorkspace = " AND workspace_id=$3";
  }
  const dailyQ = await db.query(
    "SELECT to_char(at AT TIME ZONE 'Europe/Moscow','YYYY-MM-DD') AS day, COUNT(*)::int AS calls, " +
    "COALESCE(SUM(cost_usd),0)::float8 AS cost_usd, " +
    "COALESCE(SUM(cost_usd) FILTER (WHERE provider='openai'),0)::float8 AS openai_usd, " +
    "COALESCE(SUM(cost_usd) FILTER (WHERE provider='anthropic'),0)::float8 AS anthropic_usd, " +
    "COALESCE(SUM(cost_usd) FILTER (WHERE kind='image'),0)::float8 AS image_usd " +
    "FROM cost_events WHERE at >= $1 AND at < $2" + dailyWorkspace + " GROUP BY 1 ORDER BY 1",
    dailyParams
  );

  const workspaceNames = new Map(workspaceStore.workspaces.map(function(ws){ return [ws.id, ws.name || ws.id]; }));
  const published = publishedCountsBetween(bounds.start, bounds.end, workspaceOnly, workspaceId);
  const previousPublished = publishedCountsBetween(bounds.previousStart, bounds.previousEnd, workspaceOnly, workspaceId);
  const publishedTotal = Array.from(published.values()).reduce(function(a,b){ return a+b; },0);
  const previousPublishedTotal = Array.from(previousPublished.values()).reduce(function(a,b){ return a+b; },0);
  const currentCostPerPost = publishedTotal ? selected.costUsd / publishedTotal : 0;
  const previousCostPerPost = previousPublishedTotal ? previous.costUsd / previousPublishedTotal : 0;

  const byWorkspaceRow = new Map(workspaceQ.rows.map(function(row){ return [row.id, row]; }));
  const workspaces = workspaceStore.workspaces
    .filter(function(ws){ return ws && (!workspaceOnly || ws.id === workspaceId); })
    .map(function(ws) {
      const x = byWorkspaceRow.get(ws.id) || {};
      const costUsd = Number(x.cost_usd || 0);
      const wasted = Number(x.wasted_usd || 0);
      const posts = Number(published.get(ws.id) || 0);
      return {
        id: ws.id, name: workspaceNames.get(ws.id) || ws.id, calls: Number(x.calls || 0),
        costUsd: costUsd, costRub: convertRub(costUsd),
        inputTokens: Number(x.input_tokens || 0), outputTokens: Number(x.output_tokens || 0),
        unpricedCalls: Number(x.unpriced_calls || 0), estimatedCalls: Number(x.estimated_calls || 0),
        publishedPosts: posts,
        costPerPublishedPostUsd: posts ? costUsd / posts : 0,
        costPerPublishedPostRub: posts ? convertRub(costUsd / posts) : (rate ? 0 : null),
        wastedUsd: wasted, wastedRub: convertRub(wasted), wastedSharePct: costUsd ? wasted / costUsd * 100 : 0
      };
    })
    .sort(function(a,b){ return b.costUsd-a.costUsd; });

  const providers = providerQ.rows.map(function(x) {
    const costUsd = Number(x.cost_usd || 0);
    return {
      id:x.id, name:providerLabel(x.id), calls:Number(x.calls||0), costUsd:costUsd, costRub:convertRub(costUsd),
      inputTokens:Number(x.input_tokens||0), outputTokens:Number(x.output_tokens||0),
      unpricedCalls:Number(x.unpriced_calls||0), estimatedCalls:Number(x.estimated_calls||0)
    };
  });
  const operations = operationQ.rows.map(function(x) {
    const costUsd = Number(x.cost_usd || 0);
    return {
      provider:x.provider, providerName:providerLabel(x.provider), operation:x.operation,
      operationLabel:operationLabel(x.operation), model:x.model, calls:Number(x.calls||0),
      costUsd:costUsd, costRub:convertRub(costUsd), inputTokens:Number(x.input_tokens||0),
      outputTokens:Number(x.output_tokens||0), unpricedCalls:Number(x.unpriced_calls||0),
      estimatedCalls:Number(x.estimated_calls||0), sharePct:selected.costUsd ? costUsd/selected.costUsd*100 : 0
    };
  });

  const dailyMap = new Map(dailyQ.rows.map(function(x){ return [x.day,x]; }));
  const daily = [];
  const currentMoscowMidnight = new Date(Date.UTC(todayBounds.moscowYear,todayBounds.moscowMonth-1,todayBounds.moscowDay,-3));
  for (let i=29;i>=0;i-=1) {
    const date = new Date(currentMoscowMidnight.getTime() - i*24*60*60*1000);
    const shifted = new Date(date.getTime() + 3*60*60*1000);
    const day = shifted.getUTCFullYear() + "-" + String(shifted.getUTCMonth()+1).padStart(2,"0") + "-" + String(shifted.getUTCDate()).padStart(2,"0");
    const x = dailyMap.get(day) || {};
    const costUsd=Number(x.cost_usd||0), openaiUsd=Number(x.openai_usd||0), anthropicUsd=Number(x.anthropic_usd||0), imageUsd=Number(x.image_usd||0);
    daily.push({
      day:day, calls:Number(x.calls||0), costUsd:costUsd, costRub:convertRub(costUsd),
      openaiUsd:openaiUsd, openaiRub:convertRub(openaiUsd),
      anthropicUsd:anthropicUsd, anthropicRub:convertRub(anthropicUsd),
      imageUsd:imageUsd, imageRub:convertRub(imageUsd)
    });
  }

  const trackingStarts = workspaceStore.workspaces
    .filter(function(ws){ return !workspaceOnly || ws.id===workspaceId; })
    .map(function(ws){ return ensureCostTracking(ws.state).startedAt; }).filter(Boolean).sort();
  const forecastUsd = monthForecastCost(monthSummary.costUsd,now);
  const forecastPreviousUsd = previousMonthComparable.costUsd;
  return {
    ok:true,
    scope:workspaceOnly?"workspace":"network",
    days:safeDays,
    selectedPeriod:{period:period||"custom",label:bounds.label,start:bounds.start.toISOString(),end:bounds.end.toISOString()},
    trackingStartedAt:trackingStarts[0]||bounds.start.toISOString(),
    pricingUpdatedAt:COST_PRICING_UPDATED_AT,
    pricingOverridden:Boolean(COST_PRICING_CONFIG.overridden),
    currency:{usdRub:rate,source:rate?"CBR":"USD only"},
    totals:{
      costUsd:selected.costUsd,costRub:convertRub(selected.costUsd),calls:selected.calls,inputTokens:selected.inputTokens,outputTokens:selected.outputTokens,
      unpricedCalls:selected.unpricedCalls,estimatedCalls:selected.estimatedCalls,changePct:percentChange(selected.costUsd,previous.costUsd)
    },
    today:{costUsd:todaySummary.costUsd,costRub:convertRub(todaySummary.costUsd),calls:todaySummary.calls,changePct:percentChange(todaySummary.costUsd,previousToday.costUsd)},
    monthToDate:{costUsd:monthSummary.costUsd,costRub:convertRub(monthSummary.costUsd),calls:monthSummary.calls,changePct:percentChange(monthSummary.costUsd,previousMonthComparable.costUsd)},
    forecastMonth:{costUsd:forecastUsd,costRub:convertRub(forecastUsd),changePct:percentChange(forecastUsd,forecastPreviousUsd)},
    costPerPublishedPost:{costUsd:currentCostPerPost,costRub:convertRub(currentCostPerPost),publishedPosts:publishedTotal,changePct:percentChange(currentCostPerPost,previousCostPerPost)},
    wastedOnSkipped:{costUsd:wastedUsd,costRub:convertRub(wastedUsd),sharePct:selected.costUsd?wastedUsd/selected.costUsd*100:0},
    providers:providers, operations:operations, workspaces:workspaces, daily:daily,
    budget: await costBudgetSnapshot(rate),
    infrastructure:Object.assign({},infrastructure,{
      estimatedMonthlyRub:convertRub(infrastructure.estimatedMonthlyUsd),
      services:infrastructure.services.map(function(s){return Object.assign({},s,{monthlyRub:convertRub(s.monthlyUsd)});})
    }),
    freeServices:[
      {name:"Telegram Bot API",costUsd:0,note:"Отдельной платы за API-публикации нет"},
      {name:"VK API",costUsd:0,note:"Отдельной платы за API-публикации нет"},
      {name:"Sharp",costUsd:0,note:"Локальная обработка изображений; расход только в Railway CPU/RAM"}
    ],
    note:"API-расходы хранятся в PostgreSQL; события старше "+COST_TRACKING_RETENTION_DAYS+" дней удаляются автоматически."
  };
}

function findSourceForItem(item) {
  if (!item) return null;
  const sourceId = String(item.sourceId || "").trim();
  if (sourceId) {
    const byId = (state.sources || []).find(function(source){ return source && String(source.id) === sourceId; });
    if (byId) return byId;
  }
  const sourceName = String(item.sourceName || item.name || "").trim();
  return (state.sources || []).find(function(source){ return source && String(source.name || "") === sourceName; }) || null;
}
function normalizeMediaLicense(value) {
  const v = String(value || "unknown").trim().toLowerCase();
  return ["allowed", "user_provided", "forbidden", "unknown"].includes(v) ? v : "unknown";
}
function mediaLicenseAllowsReuse(value) {
  const v = normalizeMediaLicense(value);
  if (v === "forbidden") return false;
  if (!COPYRIGHT_SAFE_MODE) return true;
  return v === "allowed" || v === "user_provided";
}
function sourceMediaLicense(sourceOrItem) {
  if (sourceOrItem && sourceOrItem.mediaLicense) return normalizeMediaLicense(sourceOrItem.mediaLicense);
  const source = sourceOrItem && sourceOrItem.group ? sourceOrItem : findSourceForItem(sourceOrItem);
  return normalizeMediaLicense(source && source.mediaLicense || "unknown");
}
function isIndependentGeneratedUrl(value) {
  const v = String(value || "");
  return /(?:^|\/)cover_[a-zA-Z0-9_-]+\.png(?:\?|$)/.test(v);
}
function findVerbatimOverlap(sourceText, outputText, minWords) {
  const normalize = function(value) {
    return String(value || "").toLowerCase()
      .replace(/[^0-9a-zа-яё]+/gi, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  };
  const sourceWords = normalize(sourceText);
  const outputWords = normalize(outputText);
  const width = Math.max(8, Number(minWords || COPYRIGHT_MAX_VERBATIM_WORDS));
  if (sourceWords.length < width || outputWords.length < width) return "";
  const sourcePhrases = new Set();
  for (let i = 0; i <= sourceWords.length - width; i += 1) sourcePhrases.add(sourceWords.slice(i, i + width).join(" "));
  for (let i = 0; i <= outputWords.length - width; i += 1) {
    const phrase = outputWords.slice(i, i + width).join(" ");
    if (sourcePhrases.has(phrase)) return phrase;
  }
  return "";
}
async function enforceCopyrightSafeMedia(post) {
  const out = Object.assign({}, post || {});
  const license = sourceMediaLicense(out);
  out.mediaLicense = license;
  out.copyrightSafe = COPYRIGHT_SAFE_MODE;
  out.copyrightMediaMode = COPYRIGHT_MEDIA_MODE;
  out.copyrightPolicyVersion = "v2";
  if (mediaLicenseAllowsReuse(license)) {
    if (!out.mediaOrigin && (out.videoUrl || out.imageUrl)) out.mediaOrigin = "source_media";
    return out;
  }

  const generatedIndependent =
    out.mediaStatus === "generated" ||
    out.mediaOrigin === "ai_generated" ||
    isIndependentGeneratedUrl(out.generatedImageUrl);

  out.originalImageUrl = out.originalImageUrl || out.imageUrl || "";
  out.originalVideoUrl = out.originalVideoUrl || out.videoUrl || "";
  out.imageUrl = "";
  out.videoUrl = "";

  if (!generatedIndependent) out.generatedImageUrl = "";
  if (!out.generatedImageUrl) {
    if (!GENERATE_COVER_IF_MISSING) {
      if (MEDIA_REQUIRED) throw new Error("Медиа этого источника запрещено настройками, а генерация резервной обложки отключена");
      return out;
    }
    const generated = await generateNewsCover({
      id: out.newsId || out.postId || out.id || newId("copyright"),
      title: out.title || currentWorkspace().name || "News Factory",
      text: out.text || "",
      sourceName: out.sourceName || ""
    });
    out.generatedImageUrl = generated.url;
    out.generatedBy = generated.model;
  }
  out.mediaType = "generated";
  out.mediaStatus = "generated";
  out.mediaOrigin = "ai_generated";
  out.copyrightMediaDecision = "source_media_blocked";
  return out;
}

function isBloggerSource(sourceOrItem) {
  const source = sourceOrItem && sourceOrItem.group ? sourceOrItem : findSourceForItem(sourceOrItem);
  return Boolean(source && source.group === "blogger");
}
function isRussianAISource(sourceOrItem) {
  const directId = String(sourceOrItem && (sourceOrItem.sourceId || sourceOrItem.id) || "");
  if (directId.startsWith("ru-")) return true;
  const source = sourceOrItem && sourceOrItem.group ? sourceOrItem : findSourceForItem(sourceOrItem);
  return Boolean(source && String(source.id || "").startsWith("ru-"));
}


const EDITORIAL_FORMATS = [
  {
    id: "news-flash",
    label: "короткий новостной удар",
    instruction: "Сразу дай самый сильный подтверждённый факт в первой строке. Затем 2–3 коротких абзаца: что произошло → важная деталь → что это меняет. Без рубрик и канцелярита."
  },
  {
    id: "why-it-matters",
    label: "почему это важно",
    instruction: "Начни с неожиданного, но точного следствия новости. Затем объясни событие простыми словами и отдельным коротким абзацем покажи, почему оно важно читателю."
  },
  {
    id: "three-facts",
    label: "три факта",
    instruction: "После короткого хука дай 3 содержательных пункта через •. Каждый пункт должен добавлять новый факт, а не повторять предыдущий. Заверши одной короткой мыслью."
  },
  {
    id: "question-answer",
    label: "вопрос → ответ",
    instruction: "Открой пост коротким естественным вопросом, который прямо следует из новости, и сразу дай ответ. Затем раскрой 2–3 ключевые детали. Не превращай вопрос в кликбейт."
  },
  {
    id: "explainer",
    label: "мини-разбор",
    instruction: "Построй текст как понятный мини-разбор: сильный хук → что именно изменилось → как это работает/что означает → что стоит отслеживать дальше. Не используй одинаковые служебные подзаголовки."
  },
  {
    id: "number-led",
    label: "цифра в центре",
    instruction: "Если в исходнике есть действительно важная цифра, начни с неё и объясни её смысл. Если значимой цифры нет — используй обычный сильный факт. Не выдумывай числа."
  },
  {
    id: "human-angle",
    label: "человеческий ракурс",
    instruction: "Начни с конкретного фактического момента, действия или наблюдения из исходника. Затем быстро расширь контекст. Текст должен ощущаться как рассказ человека, а не пресс-релиз, но без выдуманных сцен."
  }
];

const STORY_STOP_WORDS = new Set([
  "который","которая","которые","этого","этой","этот","это","также","будет","стала","стало","стали",
  "новый","новая","новые","нового","сейчас","сегодня","после","перед","через","своей","своих","свой",
  "компания","компании","сообщил","сообщила","рассказал","рассказала","показал","показала","представил","представила",
  "россии","россия","может","могут","теперь","первый","первая","вышел","вышла","запустил","запустила",
  "with","from","that","this","will","have","has","new","the","and","for"
]);

function stableHashNumber(value) {
  const s = String(value || "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function recentEditorialFormats(limit) {
  const seen = [];
  const items = [].concat(state.queue || [], state.history || []);
  for (const item of items) {
    const id = String(item && (item.contentFormat || item.editorialFormat) || "");
    if (id && !seen.includes(id)) seen.push(id);
    if (seen.length >= Number(limit || 3)) break;
  }
  return seen;
}

function selectEditorialFormat(payload) {
  if (!EDITORIAL_VARIETY_ENABLED) return EDITORIAL_FORMATS[0];
  const p = payload || {};
  const hay = (String(p.title || "") + " " + String(p.text || "")).toLowerCase();
  const recent = new Set(recentEditorialFormats(3));
  let candidates = EDITORIAL_FORMATS.filter(function(format){ return !recent.has(format.id); });
  if (!candidates.length) candidates = EDITORIAL_FORMATS.slice();

  if (/\b\d+[\s.,%₽$€]/u.test(hay)) {
    const numberLed = candidates.find(function(x){ return x.id === "number-led"; });
    if (numberLed && stableHashNumber(hay) % 3 === 0) return numberLed;
  }
  if (p.sourceGroup === "blogger" || p.sourceGroup === "creator") {
    const human = candidates.find(function(x){ return x.id === "human-angle"; });
    if (human) return human;
  }
  return candidates[stableHashNumber(String(p.title || "") + "|" + String(p.sourceName || "")) % candidates.length];
}

function storyTokens(value) {
  return String(value || "").toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^0-9a-zа-я_-]+/gi, " ")
    .split(/\s+/)
    .map(function(word){ return word.replace(/^[-_]+|[-_]+$/g, ""); })
    .filter(function(word){ return word.length >= 4 && !STORY_STOP_WORDS.has(word); });
}

function tokenJaccard(a, b) {
  const aa = new Set(storyTokens(a));
  const bb = new Set(storyTokens(b));
  if (!aa.size || !bb.size) return 0;
  let inter = 0;
  aa.forEach(function(word){ if (bb.has(word)) inter += 1; });
  return inter / (aa.size + bb.size - inter);
}

function storySimilarity(a, b) {
  if (!a || !b) return 0;
  const aSource = String(a.sourceId || a.sourceName || "");
  const bSource = String(b.sourceId || b.sourceName || "");
  if (aSource && bSource && aSource === bSource && !(a.storySources && a.storySources.length > 1)) return 0;

  const titleScore = tokenJaccard(a.title || "", b.title || "");
  const bodyScore = tokenJaccard(
    String(a.title || "") + " " + String(a.text || "").slice(0, 900),
    String(b.title || "") + " " + String(b.text || "").slice(0, 900)
  );
  const aTitleTokens = new Set(storyTokens(a.title || ""));
  const bTitleTokens = new Set(storyTokens(b.title || ""));
  let sharedTitle = 0;
  aTitleTokens.forEach(function(word){ if (bTitleTokens.has(word)) sharedTitle += 1; });
  const anchorBonus = sharedTitle >= 2 ? 0.08 : 0;
  return Math.min(1, titleScore * 0.68 + bodyScore * 0.32 + anchorBonus);
}

function queueItemTimeMs(item) {
  const ts = new Date(item && (item.articlePublishedAt || item.createdAt || item.updatedAt) || 0).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function storySourceSnapshot(item) {
  const sources = Array.isArray(item && item.storySources) && item.storySources.length
    ? item.storySources
    : [{
        sourceId: item && item.sourceId || "",
        sourceName: item && item.sourceName || "Источник",
        sourceGroup: item && item.sourceGroup || "",
        sourceRole: item && item.sourceRole || sourceEditorialRole(item),
        url: item && item.sourceUrl || "",
        newsId: item && item.newsId || "",
        title: item && (item.sourceOriginalTitle || item.title) || "",
        text: item && (item.sourceOriginalText || item.text) || "",
        publishedAt: item && (item.articlePublishedAt || item.createdAt) || "",
        originalImageUrl: item && item.originalImageUrl || "",
        originalVideoUrl: item && item.originalVideoUrl || ""
      }];
  return sources;
}

function mergeStorySources(a, b) {
  const out = [];
  const seen = new Set();
  [].concat(storySourceSnapshot(a), storySourceSnapshot(b)).forEach(function(source){
    if (!source) return;
    const key = String(source.url || source.newsId || source.sourceId || source.sourceName || "").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({
      sourceId: String(source.sourceId || ""),
      sourceName: String(source.sourceName || source.name || "Источник"),
      sourceGroup: String(source.sourceGroup || source.group || ""),
      sourceRole: String(source.sourceRole || sourceEditorialRole(source)),
      url: String(source.url || source.sourceUrl || ""),
      newsId: String(source.newsId || ""),
      title: String(source.title || "").slice(0, 300),
      text: String(source.text || "").slice(0, 4500),
      publishedAt: String(source.publishedAt || ""),
      originalImageUrl: String(source.originalImageUrl || ""),
      originalVideoUrl: String(source.originalVideoUrl || "")
    });
  });
  return out.slice(0, STORY_CLUSTER_MAX_SOURCES);
}

function findStoryClusterCandidate(newItem) {
  if (!STORY_CLUSTER_ENABLED || !newItem) return null;
  const now = queueItemTimeMs(newItem) || Date.now();
  let best = null;
  let bestScore = 0;
  for (const item of (state.queue || [])) {
    if (!item || item.telegramPublished || item.vkPublished) continue;
    if (storySourceSnapshot(item).length >= STORY_CLUSTER_MAX_SOURCES) continue;
    const age = Math.abs(now - (queueItemTimeMs(item) || now));
    if (age > STORY_CLUSTER_WINDOW_HOURS * 60 * 60 * 1000) continue;
    const score = storySimilarity(item, newItem);
    if (score > bestScore) { bestScore = score; best = item; }
  }
  return best && bestScore >= STORY_CLUSTER_MIN_SIMILARITY ? { item: best, similarity: bestScore } : null;
}


function sourceEditorialRole(sourceOrItem) {
  let group = String(sourceOrItem && (sourceOrItem.group || sourceOrItem.sourceGroup) || "").toLowerCase();
  if (!group && sourceOrItem) {
    const sourceId = String(sourceOrItem.sourceId || sourceOrItem.id || "");
    const sourceName = String(sourceOrItem.sourceName || sourceOrItem.name || "");
    const ws = currentWorkspace();
    const source = ws && ws.state && Array.isArray(ws.state.sources)
      ? ws.state.sources.find(function(item){
          return item && ((sourceId && String(item.id || "") === sourceId) || (sourceName && String(item.name || "") === sourceName));
        })
      : null;
    group = String(source && source.group || "").toLowerCase();
  }
  if (group === "official") return "official_primary";
  if (group === "blogger" || group === "creator") return "author_opinion";
  if (group === "media") return "media_context";
  if (group === "story") return "multi_source";
  return "context_source";
}

function sourceRoleLabel(role) {
  const map = {
    official_primary: "Официальный первичный источник",
    author_opinion: "Авторское мнение/демонстрация",
    media_context: "СМИ и дополнительный контекст",
    multi_source: "Несколько независимых источников",
    context_source: "Контекстный источник"
  };
  return map[String(role || "")] || "Контекстный источник";
}

function normalizeTopicEntities(values) {
  const out = [];
  const seen = new Set();
  for (const value of (Array.isArray(values) ? values : [])) {
    const text = String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
    const key = text.toLowerCase();
    if (!text || text.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out.slice(0, 5);
}

function recentHistoryItems(limit) {
  return (state.history || []).filter(function(item){ return item && item.publishedAt; }).slice(0, Math.max(1, Number(limit || 8)));
}

function editorialDiversityPenalty(item) {
  const recent = recentHistoryItems(8);
  if (!recent.length || !item) return { penalty: 0, reasons: [] };
  const reasons = [];
  let penalty = 0;
  const itemEntities = new Set(normalizeTopicEntities(item.topicEntities).map(function(x){ return x.toLowerCase(); }));
  const itemFormat = String(item.contentFormat || "");
  const itemSource = String(item.sourceName || "").toLowerCase();
  const itemMedia = item.videoUrl ? "video" : ((Array.isArray(item.mediaPackUrls) && item.mediaPackUrls.length > 1) ? "album" : (item.imageUrl || item.generatedImageUrl ? "photo" : "none"));

  recent.forEach(function(h, index) {
    const weight = index < 2 ? 1 : (index < 5 ? 0.55 : 0.3);
    const hEntities = normalizeTopicEntities(h.topicEntities).map(function(x){ return x.toLowerCase(); });
    const shared = hEntities.filter(function(x){ return itemEntities.has(x); }).length;
    if (shared) {
      const add = Math.round((index < 2 ? 9 : 5) * weight);
      penalty += add;
      reasons.push("повтор темы/компании +" + add);
    }
    if (itemFormat && itemFormat === String(h.contentFormat || "")) {
      const add = Math.round((index < 2 ? 5 : 2) * weight);
      penalty += add;
      reasons.push("повтор формата +" + add);
    }
    if (itemSource && itemSource === String(h.sourceName || "").toLowerCase()) {
      const add = Math.round((index < 2 ? 4 : 2) * weight);
      penalty += add;
      reasons.push("тот же источник +" + add);
    }
    const hMedia = h.videoUrl ? "video" : ((Array.isArray(h.mediaPackUrls) && h.mediaPackUrls.length > 1) ? "album" : (h.imageUrl || h.generatedImageUrl ? "photo" : "none"));
    if (index < 2 && itemMedia !== "none" && itemMedia === hMedia) {
      penalty += 1;
      reasons.push("одинаковый тип медиа +1");
    }
  });
  return { penalty: Math.min(28, penalty), reasons: Array.from(new Set(reasons)).slice(0, 5) };
}

function learningBucketScore(bucket) {
  if (!bucket || !Number(bucket.samples || 0)) return 0;
  const perf = Number(bucket.performance || 0);
  return Math.max(-8, Math.min(8, Number.isFinite(perf) ? perf : 0));
}

function editorialLearningBonus(item) {
  if (!EDITORIAL_LEARNING_ENABLED || !state.editorialLearning || !item) return { bonus: 0, reasons: [] };
  const learning = state.editorialLearning;
  let bonus = 0;
  const reasons = [];
  const format = learning.byFormat && learning.byFormat[item.contentFormat];
  const source = learning.bySource && learning.bySource[String(item.sourceName || "").toLowerCase()];
  const entities = normalizeTopicEntities(item.topicEntities);
  if (format) {
    const v = learningBucketScore(format);
    bonus += v;
    if (Math.abs(v) >= 2) reasons.push("формат по статистике " + (v > 0 ? "+" : "") + v);
  }
  if (source) {
    const v = learningBucketScore(source) * 0.6;
    bonus += v;
    if (Math.abs(v) >= 2) reasons.push("источник по статистике " + (v > 0 ? "+" : "") + Math.round(v));
  }
  for (const entity of entities.slice(0, 2)) {
    const bucket = learning.byTopic && learning.byTopic[entity.toLowerCase()];
    if (!bucket) continue;
    const v = learningBucketScore(bucket) * 0.45;
    bonus += v;
    if (Math.abs(v) >= 2) reasons.push("тема по статистике " + (v > 0 ? "+" : "") + Math.round(v));
  }
  return { bonus: Math.max(-10, Math.min(10, Math.round(bonus))), reasons: reasons.slice(0, 4) };
}

function queueItemRating(item) {
  return postRating(queueItemRatingInput(item)).total;
}

// Posts below the rating threshold are not published automatically: they wait
// for the editor (the queue card says why).
function ratingBelowAutoThreshold(item) {
  return POST_RATING_MIN_AUTO > 0 && queueItemRating(item) < POST_RATING_MIN_AUTO;
}

function autoQualityEligible(item) {
  const score = Number(item && item.qualityScore);
  return Number.isFinite(score) && score >= AUTO_QUALITY_MIN && item.qcStatus !== "hold" && queueItemRating(item) >= POST_RATING_DROP_BELOW;
}

// Why a queue item can never be published automatically (removed by autoResolveQueue).
function autoRejectReason(item) {
  if (!item || !item.newsId) return "";
  const rating = queueItemRating(item);
  if (POST_RATING_DROP_BELOW > 0 && rating < POST_RATING_DROP_BELOW) return "рейтинг " + rating + " из 100 ниже " + POST_RATING_DROP_BELOW;
  const verdict = item.editorialV2 && item.editorialV2.verdict;
  if (item.qcStatus === "hold" && verdict === "reject") return "проверка GPT/Claude нашла ошибки и отклонила пост";
  if (item.qcStatus === "hold" && verdict === "fix_exhausted") return "ошибки не исправлены за отведённые раунды";
  if (item.qcStatus === "hold" && verdict === "copyright_overlap") return "текст слишком близок к источнику";
  return "";
}

async function autoResolveQueue() {
  const removed = [];
  const keep = [];
  for (const item of (state.queue || [])) {
    const reason = autoRejectReason(item);
    if (!reason) { keep.push(item); continue; }
    removed.push({ item: item, reason: reason });
  }
  if (!removed.length) return { removed: 0 };
  state.queue = keep;
  saveState();
  for (const r of removed) {
    console.log("QUEUE_AUTO_REJECTED " + JSON.stringify({ workspace: currentWorkspaceId(), newsId: r.item.newsId, title: String(r.item.title || "").slice(0, 80), reason: r.reason }));
    if (db && dbReady) {
      try {
        await db.query("UPDATE news_items SET status='auto_rejected', metadata=COALESCE(metadata,'{}'::jsonb) || $2::jsonb, updated_at=NOW() WHERE id=$1 AND workspace_id=$3",
          [r.item.newsId, JSON.stringify({ autoRejectReason: r.reason, autoRejectedAt: new Date().toISOString() }), currentWorkspaceId()]);
      } catch (error) { console.warn("Auto reject status update failed:", error.message); }
    }
  }
  return { removed: removed.length };
}

function buildDecisionExplanation(item) {
  if (!item) return { summary: "Нет данных", factors: [] };
  const diversity = editorialDiversityPenalty(item);
  const learning = editorialLearningBonus(item);
  const base = Number(item.aiScore);
  const quality = Number(item.qualityScore);
  const factors = [];
  if (Number.isFinite(base)) factors.push("Сила новости: " + Math.round(base) + "/100");
  if (Number.isFinite(quality)) factors.push("Качество готового поста: " + Math.round(quality) + "/100");
  if (item.contentFormatLabel) factors.push("Формат: " + item.contentFormatLabel);
  if (item.sourceRole) factors.push("Роль источника: " + sourceRoleLabel(item.sourceRole));
  if (item.storyCluster && Number(item.storyCluster.sourceCount) > 1) factors.push("Сюжет: " + item.storyCluster.sourceCount + " источника");
  if (item.storyUpdateOf) factors.push("Обновление ранее опубликованного сюжета");
  if (item.videoUrl) factors.push("Видео: приоритет +" + videoPriorityBonus(item, Number.isFinite(base) ? base : 60));
  if (Array.isArray(item.mediaPackUrls) && item.mediaPackUrls.length > 1) factors.push("Media Pack: " + item.mediaPackUrls.length + " изображения");
  if (learning.bonus) factors.push("Обучение на статистике: " + (learning.bonus > 0 ? "+" : "") + learning.bonus);
  if (diversity.penalty) factors.push("Штраф за повторяемость: -" + diversity.penalty);
  if (item.qcIssues && item.qcIssues.length) factors.push("QC: " + item.qcIssues.slice(0, 2).join("; "));
  return {
    summary: item.decisionSummary || "Система учитывает силу новости, качество поста, разнообразие ленты, медиа и статистику аудитории.",
    factors: factors.slice(0, 10),
    diversityPenalty: diversity.penalty,
    learningBonus: learning.bonus,
    autoQualityMin: AUTO_QUALITY_MIN,
    autoEligible: autoQualityEligible(item)
  };
}

function sourceStatKey(sourceOrItem) {
  if (!sourceOrItem) return "";
  if (sourceOrItem.sourceId) return String(sourceOrItem.sourceId);
  if (sourceOrItem.id && String(sourceOrItem.id).startsWith("cars-")) return String(sourceOrItem.id);
  const name = String(sourceOrItem.sourceName || sourceOrItem.name || "").trim();
  const found = (state.sources || []).find(function(src){ return src && src.name === name; });
  return found ? String(found.id) : "";
}

function ensureSourceStat(sourceOrItem) {
  state.sourceStats = state.sourceStats && typeof state.sourceStats === "object" ? state.sourceStats : {};
  const key = sourceStatKey(sourceOrItem);
  if (!key) return null;
  if (!state.sourceStats[key]) {
    state.sourceStats[key] = {
      checks: 0, candidates: 0, discovered: 0, scored: 0, strong: 0, top: 0,
      selected: 0, published: 0, errors: 0, scoreSum: 0,
      lastCheckAt: "", lastCandidateAt: "", lastDiscoveredAt: "", lastStrongAt: "",
      lastSelectedAt: "", lastPublishedAt: "", lastErrorAt: ""
    };
  }
  return state.sourceStats[key];
}

function noteSourceEvent(sourceOrItem, event, extra) {
  const stat = ensureSourceStat(sourceOrItem);
  if (!stat) return;
  const now = new Date().toISOString();
  if (event === "check") { stat.checks = Number(stat.checks || 0) + 1; stat.lastCheckAt = now; }
  else if (event === "candidate") { stat.candidates = Number(stat.candidates || 0) + 1; stat.lastCandidateAt = now; }
  else if (event === "discovered") { stat.discovered = Number(stat.discovered || 0) + 1; stat.lastDiscoveredAt = now; }
  else if (event === "score") {
    const score = Math.max(0, Math.min(100, Number(extra && extra.score || 0)));
    stat.scored = Number(stat.scored || 0) + 1;
    stat.scoreSum = Number(stat.scoreSum || 0) + score;
    if (score >= AI_STRONG_NEWS_SCORE) { stat.strong = Number(stat.strong || 0) + 1; stat.lastStrongAt = now; }
    if (score >= AI_TOP_NEWS_SCORE) stat.top = Number(stat.top || 0) + 1;
  } else if (event === "selected") { stat.selected = Number(stat.selected || 0) + 1; stat.lastSelectedAt = now; }
  else if (event === "published") { stat.published = Number(stat.published || 0) + 1; stat.lastPublishedAt = now; }
  else if (event === "error") { stat.errors = Number(stat.errors || 0) + 1; stat.lastErrorAt = now; }
  else if (event === "fetch_error") { stat.errorStreak = Number(stat.errorStreak || 0) + 1; }
  else if (event === "fetch_ok") { stat.errorStreak = 0; }
  else if (event === "junk") { recordOutcome(stat, "junk"); stat.lastJunkReason = String(extra && extra.reason || "").slice(0, 160); }
  else if (event === "useful") { recordOutcome(stat, "ok"); }
}

// Pause sources that only bring junk or keep failing. Keeps at least a few
// sources enabled per group and never touches sources the editor turned on
// after an automatic pause (they are reset on toggle).
function autoPauseWeakSources() {
  if (!SOURCE_AUTO_PAUSE_ENABLED) return [];
  const paused = [];
  for (const source of (state.sources || [])) {
    if (!source || !source.enabled) continue;
    const group = source.group || "media";
    const enabledInGroup = (state.sources || []).filter(function(x){ return x && x.enabled && (x.group || "media") === group; }).length;
    const reason = autoPauseReason(source, ensureSourceStat(source), enabledInGroup);
    if (!reason) continue;
    source.enabled = false;
    source.autoPaused = { reason: reason, at: new Date().toISOString() };
    paused.push({ id: source.id, name: source.name, reason: reason });
    console.log("SOURCE_AUTO_PAUSED " + JSON.stringify({ workspace: currentWorkspaceId(), id: source.id, name: source.name, reason: reason }));
  }
  return paused;
}

// Keep at least SOURCES_MIN_ACTIVE enabled sources per channel: replacements
// come from the reserve list, then from AI discovery (web search). Every
// candidate must open and show a list of article links before it is enabled.
async function validateSourceCandidate(url) {
  try {
    const html = await fetchText(url, 15000);
    const links = extractArticleLinks(html, url).filter(function(l){ return String(l.title || "").trim().length >= 25; });
    if (links.length < 6) return { ok: false, reason: "на странице мало новостей (" + links.length + ")" };
    return { ok: true, links: links.length };
  } catch (error) {
    return { ok: false, reason: "не открывается: " + String(error.message || error).slice(0, 80) };
  }
}

async function discoverSourcesWithAI(count) {
  if (!OPENAI_API_KEY) return [];
  const ws = currentWorkspace();
  const channelId = resolveChannelId(ws);
  const prompt = buildDiscoveryPrompt({
    channelName: ws && ws.name || "",
    topic: CHANNEL_TOPICS_RU[channelId] || "",
    count: count,
    existingHosts: Array.from(new Set((state.sources || []).map(function(x){ return sourceHost(x && x.url); }).filter(Boolean)))
  });
  for (const withSearch of [true, false]) {
    try {
      const body = { model: OPENAI_MODEL, input: prompt, max_output_tokens: 2500 };
      if (withSearch) body.tools = [{ type: "web_search" }];
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + OPENAI_API_KEY },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90000)
      });
      const data = await response.json().catch(function(){ return {}; });
      if (!response.ok) throw new Error(data && data.error && data.error.message || ("HTTP " + response.status));
      recordOpenAIResponseUsage(OPENAI_MODEL, "source_discovery", data, "responses", { web_search: withSearch });
      return parseDiscoveryResult(extractOpenAIText(data));
    } catch (error) {
      console.warn("SOURCE_DISCOVERY_ERROR " + JSON.stringify({ workspace: currentWorkspaceId(), webSearch: withSearch, error: error.message }));
    }
  }
  return [];
}

async function replenishSources(reason) {
  const target = Number.isFinite(Number(state.sourceTarget)) && state.sourceTarget !== "" && state.sourceTarget != null ? Number(state.sourceTarget) : SOURCES_MIN_ACTIVE;
  let need = Math.min(MAX_SOURCES_ADDED_PER_RUN, sourcesNeeded(state.sources, target));
  if (!need) return { added: [], need: 0 };
  state.sourceReplenish = state.sourceReplenish && typeof state.sourceReplenish === "object" ? state.sourceReplenish : {};
  const last = new Date(state.sourceReplenish.lastAt || 0).getTime();
  if (Date.now() - last < SOURCE_REPLENISH_INTERVAL_MINUTES * 60000) return { added: [], need: need, throttled: true };
  state.sourceReplenish.lastAt = new Date().toISOString();

  const rejected = state.sourceReplenish.rejected && typeof state.sourceReplenish.rejected === "object" ? state.sourceReplenish.rejected : {};
  const weekAgo = Date.now() - 7 * 24 * 3600000;
  for (const key of Object.keys(rejected)) if (new Date(rejected[key].at || 0).getTime() < weekAgo) delete rejected[key];
  state.sourceReplenish.rejected = rejected;
  const blocked = Array.isArray(state.sourceBlockedHosts) ? state.sourceBlockedHosts : [];
  const channelId = resolveChannelId(currentWorkspace());
  const added = [];

  async function tryList(list, from) {
    for (const c of freshCandidates(list, state.sources, blocked)) {
      if (need <= 0) return;
      const key = sourceKey(c.url);
      if (rejected[key]) continue;
      const check = await validateSourceCandidate(c.url);
      if (!check.ok) { rejected[key] = { at: new Date().toISOString(), reason: check.reason }; continue; }
      const source = {
        id: "auto-" + crypto.createHash("sha256").update(c.url).digest("hex").slice(0, 10),
        name: c.name, type: "web", group: c.group === "official" ? "official" : "media", priority: 2,
        url: c.url, enabled: true, mediaLicense: "unknown", copyrightMode: "facts_only",
        autoAdded: { at: new Date().toISOString(), from: from, why: c.why || "", reason: reason || "" }
      };
      state.sources.push(source);
      added.push({ name: source.name, url: source.url, from: from });
      need -= 1;
      console.log("SOURCE_AUTO_ADDED " + JSON.stringify({ workspace: currentWorkspaceId(), name: source.name, url: source.url, from: from, links: check.links }));
    }
  }

  await tryList(RESERVE_SOURCES[channelId] || [], "reserve");
  if (need > 0) await tryList(await discoverSourcesWithAI(need + 4), "ai");
  saveState();
  return { added: added, need: need };
}

// One cheap call over all fresh headlines before media and editorial work:
// drops ads, listings, old press releases and off-topic links.
const CHANNEL_TOPICS_RU = { ai: "искусственный интеллект", auto: "автомобили, авторынок России и мира", money: "деньги и финансы", tech: "технологии и гаджеты", games: "игры", kino: "кино и сериалы", science: "наука", sport: "спорт", world: "мировые новости", stars: "знаменитости", travel: "путешествия", shopping: "покупки и скидки", home: "дом и быт", food: "еда", business: "бизнес", crypto: "криптовалюты" };
async function prefilterCandidates(candidates, summary) {
  if (!candidates.length) return candidates;
  const now = new Date();
  const kept = [];
  const rejected = [];
  for (const candidate of candidates) {
    const title = candidate.link.title || "";
    if (staleYearInTitle(title, Boolean(candidate.link.publishedAt), now)) rejected.push({ candidate: candidate, reason: "старая новость: в заголовке прошлый год, даты нет", score: 1 });
    else kept.push(candidate);
  }
  let ranked = kept.map(function(candidate){ return { candidate: candidate, score: 5 }; });
  if (HEADLINE_PREFILTER_ENABLED && OPENAI_API_KEY && kept.length) {
    const ws = currentWorkspace();
    const channelId = resolveChannelId(ws);
    const prompt = buildPrefilterPrompt({
      channelName: ws && ws.name || "",
      topic: CHANNEL_TOPICS_RU[channelId] || "",
      today: new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" }).format(now),
      items: kept.map(function(candidate){ return { source: candidate.source.name, group: candidate.source.group, date: candidate.link.publishedAt || "", title: candidate.link.title || "", text: candidate.link.text || "" }; })
    });
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + OPENAI_API_KEY },
        body: JSON.stringify({ model: OPENAI_MODEL, input: prompt, max_output_tokens: 2500 }),
        signal: AbortSignal.timeout(45000)
      });
      const data = await response.json().catch(function(){ return {}; });
      if (!response.ok) throw new Error(data && data.error && data.error.message || ("HTTP " + response.status));
      recordOpenAIResponseUsage(OPENAI_MODEL, "headline_prefilter", data, "responses", { items: kept.length });
      const verdicts = parsePrefilterResult(extractOpenAIText(data), kept.length);
      if (!verdicts) throw new Error("не удалось разобрать ответ");
      ranked = [];
      kept.forEach(function(candidate, index) {
        const v = verdicts.get(index + 1);
        if (v.keep) ranked.push({ candidate: candidate, score: v.score });
        else rejected.push({ candidate: candidate, reason: v.reason || "отсеяно по заголовку", score: v.score });
      });
    } catch (error) {
      // Fail open: without the pre-filter the old order is used, nothing is lost.
      console.warn("HEADLINE_PREFILTER_ERROR " + JSON.stringify({ workspace: currentWorkspaceId(), error: error.message }));
    }
  }
  for (const r of rejected) {
    const source = r.candidate.source;
    const link = r.candidate.link;
    noteSourceEvent(source, "junk", { reason: r.reason });
    try {
      await saveNewsItem({
        id: "news_" + crypto.createHash("sha256").update("prefilter\n" + link.url).digest("hex").slice(0, 20),
        sourceId: source.id, sourceName: source.name, sourceUrl: source.url,
        originalUrl: link.url, originalTitle: link.title || "", originalText: String(link.text || "").slice(0, 2000),
        contentHash: "", status: "prefilter_skip",
        metadata: { prefilterReason: r.reason, prefilterScore: r.score, articlePublishedAt: link.publishedAt || "" }
      });
    } catch (error) { console.warn("Prefilter save failed:", error.message); }
  }
  ranked.sort(function(a, b){ return b.score - a.score; });
  summary.prefilterRejected = rejected.length;
  if (rejected.length || ranked.length) {
    console.log("HEADLINE_PREFILTER " + JSON.stringify({ workspace: currentWorkspaceId(), total: candidates.length, kept: ranked.length, rejected: rejected.length, examples: rejected.slice(0, 5).map(function(r){ return (r.candidate.link.title || "").slice(0, 70) + " — " + r.reason; }) }));
  }
  return ranked.map(function(r){ return r.candidate; });
}

function buildSourceRankings() {
  const rows = (state.sources || []).map(function(source) {
    const stat = ensureSourceStat(source) || {};
    const checks = Number(stat.checks || 0);
    const scored = Number(stat.scored || 0);
    const selected = Number(stat.selected || 0);
    const errors = Number(stat.errors || 0);
    const avgScore = scored ? Number(stat.scoreSum || 0) / scored : 0;
    const strongPerCheck = checks ? Number(stat.strong || 0) / checks : 0;
    const selectedPerCheck = checks ? selected / checks : 0;
    const reliability = checks ? Math.max(0, 1 - Math.min(1, errors / checks)) : 1;
    let rating = null;
    if (checks >= 10 || scored >= 3) {
      rating = Math.round(
        avgScore * 0.40 +
        Math.min(100, strongPerCheck * 300) * 0.20 +
        Math.min(100, selectedPerCheck * 500) * 0.30 +
        reliability * 100 * 0.10
      );
      rating = Math.max(0, Math.min(100, rating));
    }
    let status = "Собираем данные";
    if (checks >= 15 && selected === 0) status = "Не используется";
    else if (rating != null && rating < 45) status = "На замену";
    else if (rating != null && rating < 60) status = "Слабый";
    else if (rating != null && rating < 75) status = "Рабочий";
    else if (rating != null) status = "Сильный";
    return {
      id: source.id,
      rating: rating,
      status: status,
      checks: checks,
      candidates: Number(stat.candidates || 0),
      discovered: Number(stat.discovered || 0),
      scored: scored,
      strong: Number(stat.strong || 0),
      top: Number(stat.top || 0),
      selected: selected,
      published: Number(stat.published || 0),
      errors: errors,
      avgScore: scored ? Math.round(avgScore) : null,
      lastSelectedAt: stat.lastSelectedAt || "",
      lastPublishedAt: stat.lastPublishedAt || "",
      useful: Number(stat.useful || 0),
      junk: Number(stat.junk || 0),
      lastJunkReason: stat.lastJunkReason || "",
      autoPaused: source.autoPaused || null
    };
  });
  rows.sort(function(a,b){
    if (a.rating == null && b.rating == null) return b.selected - a.selected || b.scored - a.scored;
    if (a.rating == null) return 1;
    if (b.rating == null) return -1;
    return b.rating - a.rating || b.selected - a.selected || b.scored - a.scored;
  });
  rows.forEach(function(row,index){ row.rank = index + 1; });
  return rows;
}

const db = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL, max: 4, idleTimeoutMillis: 30000 }) : null;
let dbReady = false;
// Collector lock is per workspace: one channel's slow collection must not block
// slot preparation of the other channels in the network.
const collectorRunningWorkspaces = new Set();
function isCollectorRunning(workspaceId) { return collectorRunningWorkspaces.has(workspaceId || currentWorkspaceId()); }
const schedulerTickRunning = new Set();
let collectorTimer = null;
const lastCollectorRuns = new Map();
let snapshotTimer = null;
function saveState() {
  pruneQueueItems(state);
  state.updatedAt = new Date().toISOString();
  currentWorkspace().updatedAt = state.updatedAt;
  persistWorkspaceStore();
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
        workspace_id TEXT NOT NULL DEFAULT 'ai-main',
        source_id TEXT,
        source_name TEXT,
        source_url TEXT,
        original_url TEXT,
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
        workspace_id TEXT NOT NULL DEFAULT 'ai-main',
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
        workspace_id TEXT NOT NULL DEFAULT 'ai-main',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        state JSONB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS app_snapshots_created_idx ON app_snapshots(created_at DESC);
    `);
    await runMigrations();
    dbReady = true;
    await migrateLegacyCostEventsToPostgres();
    await refreshStoredCostPricing();
    await flushCostEventBuffer();
    await cleanupCostEvents();
    scheduleCostRetentionCleanup();
    startCostBudgetMonitor();
    await evaluateCostBudget(false);
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
    const workspaceId = currentWorkspaceId();
    await db.query("INSERT INTO app_snapshots(workspace_id,state) VALUES($1,$2::jsonb)", [workspaceId, JSON.stringify(state)]);
    await db.query("DELETE FROM app_snapshots WHERE workspace_id=$1 AND id NOT IN (SELECT id FROM app_snapshots WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 200)", [workspaceId]);
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


function extractArticleMediaCandidates(html, pageUrl) {
  const source = String(html || "");
  const images = [];
  const videos = [];
  const imageSeen = new Set();
  const videoSeen = new Set();

  function addImage(raw, score, reason) {
    const url = canonicalizeUrl(htmlDecode(raw || ""), pageUrl);
    if (!url || !/^https?:\/\//i.test(url) || imageSeen.has(url)) return;
    if (/\.(svg|ico)(\?|$)/i.test(url)) return;
    if (/(?:logo|avatar|icon|sprite|emoji|badge|pixel|tracker|placeholder|favicon)/i.test(url)) score -= 80;
    if (/(?:article|news|upload|media|image|photo|press|cdn|content)/i.test(url)) score += 8;
    if (score < 15) return;
    imageSeen.add(url);
    images.push({ url: url, score: score, reason: reason || "page_image" });
  }

  function addVideo(raw, score, reason) {
    const url = canonicalizeUrl(htmlDecode(raw || ""), pageUrl);
    if (!url || !/^https?:\/\//i.test(url) || videoSeen.has(url)) return;
    if (!/\.(mp4|mov|m4v|webm)(\?|$)/i.test(url)) return;
    videoSeen.add(url);
    videos.push({ url: url, score: score, reason: reason || "page_video" });
  }

  const og = extractMetaImage(source, pageUrl);
  if (og) addImage(og, 120, "og:image");
  const video = extractMetaVideo(source, pageUrl);
  if (video) addVideo(video, 140, "og/video");

  const imgRe = /<img\b([^>]+)>/gi;
  let m;
  while ((m = imgRe.exec(source))) {
    const attrs = m[1] || "";
    const srcMatch = attrs.match(/(?:src|data-src|data-original|data-lazy-src)=["']([^"']+)["']/i);
    const srcsetMatch = attrs.match(/(?:srcset|data-srcset)=["']([^"']+)["']/i);
    const altMatch = attrs.match(/(?:alt|title)=["']([^"']+)["']/i);
    const widthMatch = attrs.match(/\bwidth=["']?(\d{2,5})/i);
    const heightMatch = attrs.match(/\bheight=["']?(\d{2,5})/i);
    let raw = srcMatch && srcMatch[1] || "";
    if (!raw && srcsetMatch && srcsetMatch[1]) {
      const parts = srcsetMatch[1].split(",").map(function(x){ return x.trim().split(/\s+/)[0]; }).filter(Boolean);
      raw = parts[parts.length - 1] || "";
    }
    if (!raw) continue;
    let score = 30;
    const width = Number(widthMatch && widthMatch[1] || 0);
    const height = Number(heightMatch && heightMatch[1] || 0);
    if (width >= 900 || height >= 600) score += 30;
    else if (width >= 500 || height >= 350) score += 15;
    else if (width && height && (width < 220 || height < 160)) score -= 30;
    const alt = String(altMatch && altMatch[1] || "");
    if (alt.length >= 20) score += 10;
    if (/(?:logo|avatar|icon|banner|advert|реклам|логотип)/i.test(alt)) score -= 50;
    addImage(raw, score, "article_img");
  }

  const posterRe = /<video\b[^>]*poster=["']([^"']+)["'][^>]*>/gi;
  while ((m = posterRe.exec(source))) addImage(m[1], 85, "video_poster");

  const videoRe = /<(?:video|source)\b[^>]*src=["']([^"']+)["'][^>]*>/gi;
  while ((m = videoRe.exec(source))) addVideo(m[1], 90, "video_tag");

  images.sort(function(a,b){ return b.score - a.score; });
  videos.sort(function(a,b){ return b.score - a.score; });
  return {
    images: images.slice(0, 10),
    videos: videos.slice(0, 4)
  };
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


async function buildMediaPackCollage(urls) {
  const list = (Array.isArray(urls) ? urls : []).map(function(url){ return String(url || "").trim(); }).filter(Boolean).slice(0, 4);
  if (list.length < 2) return null;

  const loaded = [];
  for (const url of list) {
    try {
      const bytes = await loadPreviewSourceBytes(url);
      if (bytes) loaded.push(bytes);
    } catch (error) {
      console.warn("VK collage image skipped:", error.message);
    }
  }
  if (loaded.length < 2) return null;

  const gap = 8;
  const cells = [];
  if (loaded.length === 2) {
    cells.push({ left: 0, top: 0, width: 596, height: 630 });
    cells.push({ left: 604, top: 0, width: 596, height: 630 });
  } else if (loaded.length === 3) {
    cells.push({ left: 0, top: 0, width: 596, height: 630 });
    cells.push({ left: 604, top: 0, width: 596, height: 311 });
    cells.push({ left: 604, top: 319, width: 596, height: 311 });
  } else {
    cells.push({ left: 0, top: 0, width: 596, height: 311 });
    cells.push({ left: 604, top: 0, width: 596, height: 311 });
    cells.push({ left: 0, top: 319, width: 596, height: 311 });
    cells.push({ left: 604, top: 319, width: 596, height: 311 });
  }

  const composites = [];
  for (let i = 0; i < Math.min(loaded.length, cells.length); i += 1) {
    const cell = cells[i];
    const img = await sharp(loaded[i], { limitInputPixels: 80 * 1000 * 1000 })
      .rotate()
      .resize(cell.width, cell.height, { fit: "cover", position: "centre" })
      .jpeg({ quality: 88 })
      .toBuffer();
    composites.push({ input: img, left: cell.left, top: cell.top });
  }

  return sharp({
    create: { width: VK_PREVIEW_WIDTH, height: VK_PREVIEW_HEIGHT, channels: 3, background: { r: 245, g: 248, b: 252 } }
  }).composite(composites).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}

async function prepareVkPreviewImage(post, slug) {
  ensureDataDir();
  const sourceUrl = String(post && (post.imageUrl || post.generatedImageUrl) || "").trim();
  const mediaPackUrls = Array.isArray(post && post.mediaPackUrls) ? post.mediaPackUrls.filter(Boolean).slice(0, 4) : [];
  let input = null;

  if (mediaPackUrls.length > 1) {
    try {
      input = await buildMediaPackCollage(mediaPackUrls);
    } catch (error) {
      console.warn("VK_PREVIEW_COLLAGE_FAILED " + JSON.stringify({
        post_id: String(post && (post.postId || post.id) || "unknown"),
        slug: slug,
        error: String(error && error.message || error)
      }));
    }
  }

  if (!input && sourceUrl) {
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

  if (Array.isArray(p.storySources)) {
    p.storySources.forEach(function(source) {
      if (source && typeof source === "object") add(source.sourceName || source.name || source.title || "", source.url || source.sourceUrl || source.href || "");
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
      (slug, workspace_id, post_id, topic_id, title, body_text, description, source_name, source_url, sources, image_filename, image_url, image_width, image_height, image_bytes)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15)`,
    [slug, currentWorkspaceId(), postId, topicId, title, bodyText, description, sourceName || null, sourceUrl || null, JSON.stringify(sources), image.fileName, image.url, image.width, image.height, image.bytes]
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


const NEWS_VISUAL_RECIPES = [
  "DOCUMENTARY PHOTO: candid real-world moment, eye-level or slightly off-axis framing, natural available light, believable background clutter, subtle imperfections, restrained color, no posing.",
  "DETAIL PHOTO: close editorial detail of the most important real object or technology, tactile materials, realistic reflections and wear, shallow but believable depth of field, no floating UI.",
  "CONTEXT PHOTO: wider environmental view that explains where or how the event happens, ordinary real-world scale, natural daylight or practical interior lighting, no theatrical staging.",
  "EDITORIAL STILL LIFE: grounded arrangement of relevant real objects on a believable desk/workbench/environment, asymmetrical composition, practical light, real textures, no glossy 3D-render look.",
  "HUMAN-SCALE TECH PHOTO: technology shown in believable everyday use without fake interfaces, natural hands/body posture where appropriate, documentary framing, no advertising pose."
];

function visualRecipeFor(payload, index) {
  if (payload && payload.visualRecipe) return String(payload.visualRecipe);
  const offset = Number(index || 0);
  return NEWS_VISUAL_RECIPES[(stableHashNumber(String(payload && payload.title || "") + "|" + offset) + offset) % NEWS_VISUAL_RECIPES.length];
}

async function generateNewsCover(payload) {
  if (costEconomyMode()) return renderEconomyTextCard(payload);
  if (!OPENAI_API_KEY || !GENERATE_COVER_IF_MISSING) {
    throw new Error("Генерация обложек отключена");
  }

  const channelName = String(currentWorkspace().name || "News Factory");
  const prompt = [
    "Create a premium editorial news image for the Telegram channel «" + channelName + "».",
    "Topic: " + String(payload.title || "AI technology news"),
    "Context: " + String(payload.text || "").slice(0, 1800),
    "Visual recipe: " + visualRecipeFor(payload, payload.visualIndex || 0),
    "Make it look like a real photograph someone could plausibly capture, not a movie poster and not generic AI art.",
    "Use natural or practical lighting, realistic color balance, imperfect real-world textures, believable materials, subtle sensor/film texture where appropriate, and slightly imperfect asymmetry.",
    "Avoid plastic skin, over-smoothed surfaces, excessive teal-orange grading, neon glows, holograms, floating interface elements, dramatic lens flares, perfect symmetry, fake bokeh, glossy 3D-render aesthetics and impossible reflections.",
    "Create an independent original visual from the factual description only. Do not reproduce, trace, closely imitate, or restage any source photograph, video frame, artwork, poster, thumbnail, or distinctive composition.",
    "Do not imitate a living artist or a recognizable copyrighted visual style. Use generic documentary/editorial photography language.",
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
      recordOpenAIResponseUsage(model, String(payload && payload.costPurpose || "image_generation"), data, "images", {
        quality: OPENAI_IMAGE_QUALITY, size: "1536x1024", news_id: payload && (payload.newsId || payload.id) || ""
      });
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


async function generateStoryMediaPack(payload, count) {
  const desired = Math.max(2, Math.min(4, Number(count || STORY_MEDIA_PACK_COUNT)));
  const baseId = String(payload && payload.id || newId("story")).replace(/[^a-zA-Z0-9_-]/g, "_");
  const tasks = Array.from({ length: desired }, function(_, index) {
    return generateNewsCover(Object.assign({}, payload, {
      id: baseId + "_m" + (index + 1) + "_" + Date.now(),
      visualIndex: index,
      visualRecipe: NEWS_VISUAL_RECIPES[index % NEWS_VISUAL_RECIPES.length]
    }));
  });
  const settled = await Promise.allSettled(tasks);
  const items = settled
    .filter(function(x){ return x.status === "fulfilled" && x.value && x.value.url; })
    .map(function(x){ return x.value; });
  if (!items.length) throw new Error("Не удалось создать изображения для сюжета");
  return items;
}


let imageEnhanceSlotTail = Promise.resolve();
let imageEnhanceLastStartedAt = 0;

function sleepImageMs(ms) {
  return new Promise(function(resolve){ setTimeout(resolve, Math.max(0, Number(ms || 0))); });
}

async function reserveImageEnhanceSlot() {
  let release;
  const previous = imageEnhanceSlotTail;
  imageEnhanceSlotTail = new Promise(function(resolve){ release = resolve; });
  await previous;
  try {
    const wait = Math.max(0, IMAGE_ENHANCE_MIN_GAP_MS - (Date.now() - imageEnhanceLastStartedAt));
    if (wait) await sleepImageMs(wait);
    imageEnhanceLastStartedAt = Date.now();
  } finally {
    release();
  }
}

function imageRetryDelayMs(response, data) {
  const retryHeader = response && response.headers && response.headers.get("retry-after");
  const retrySeconds = Number(retryHeader);
  if (Number.isFinite(retrySeconds) && retrySeconds > 0) return Math.ceil(retrySeconds * 1000) + 1200;
  const message = String(data && data.error && data.error.message || "");
  const match = message.match(/try again in\s+([0-9.]+)s/i);
  if (match) return Math.ceil(Number(match[1]) * 1000) + 1200;
  return 15000;
}

// Quality-only enhancement of a real news photo. Deliberately NOT generative: an image
// model redraws the picture (invented details, changed sky, padded borders from a fixed
// output size). Here the pixels of the scene stay the same — only technical quality:
// EXIF orientation, moderate upscale of small photos, light denoise, gentle sharpening
// and a very mild contrast lift. Same composition and aspect ratio.
const ENHANCE_TARGET_WIDTH = 1600;
async function enhanceNewsImage(payload) {
  if (!IMAGE_ENHANCEMENT_ENABLED) throw new Error("Улучшение изображений отключено");

  const imageUrl = String(payload.imageUrl || "").trim();
  let bytes = null;
  const localFile = localMediaPathFromUrl(imageUrl);
  if (localFile && fs.existsSync(localFile)) {
    bytes = fs.readFileSync(localFile);
  } else {
    if (!/^https?:\/\//i.test(imageUrl)) throw new Error("Нет исходного изображения для улучшения");
    const sourceResponse = await fetch(imageUrl, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; NewsFactoryMedia/1.0)" },
      redirect: "follow",
      signal: AbortSignal.timeout(30000)
    });
    if (!sourceResponse.ok) throw new Error("Не удалось скачать исходное фото: HTTP " + sourceResponse.status);
    bytes = Buffer.from(await sourceResponse.arrayBuffer());
  }
  if (!bytes || !bytes.length) throw new Error("Исходное изображение пустое");
  if (bytes.length > 25 * 1024 * 1024) throw new Error("Исходное изображение слишком большое");

  let meta;
  try { meta = await sharp(bytes).metadata(); } catch { throw new Error("Исходный файл не является изображением"); }
  const width = Number(meta.width || 0);
  if (!width) throw new Error("Не удалось определить размер изображения");

  let pipeline = sharp(bytes, { failOn: "none" }).rotate();
  if (width < ENHANCE_TARGET_WIDTH) {
    // Upscale at most 2x: beyond that interpolation only adds blur.
    pipeline = pipeline.resize({ width: Math.min(ENHANCE_TARGET_WIDTH, width * 2), kernel: "lanczos3", withoutEnlargement: false });
  }
  if (width < 1000) pipeline = pipeline.median(3);
  pipeline = pipeline
    .sharpen({ sigma: 0.8, m1: 0.6, m2: 1.6 })
    .linear(1.04, -5)
    .jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: "4:4:4" });

  const out = await pipeline.toBuffer();
  ensureDataDir();
  const safeId = String(payload.id || crypto.randomBytes(8).toString("hex")).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  const fileName = "enhanced_" + safeId + "_" + Date.now() + ".jpg";
  fs.writeFileSync(path.join(MEDIA_DIR, fileName), out);
  return { url: mediaPublicUrl(fileName), model: "quality-only-v1", fileName: fileName };
}


function isLocalMediaUrl(value) {
  const url = String(value || "").trim();
  return Boolean(url && PUBLIC_BASE_URL && url.startsWith(PUBLIC_BASE_URL + "/media/"));
}

async function cacheSourceImage(imageUrl, id) {
  const sourceUrl = String(imageUrl || "").trim();
  if (!sourceUrl) return "";
  if (isLocalMediaUrl(sourceUrl)) return sourceUrl;

  const response = await fetch(sourceUrl, {
    redirect: "follow",
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; NewsFactory/1.0; +https://news-factory-api-production.up.railway.app)",
      "accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
    },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error("Фото источника HTTP " + response.status);
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("image/")) throw new Error("Источник вернул не изображение");

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error("Фото источника пустое");
  if (bytes.length > 20 * 1024 * 1024) throw new Error("Фото источника больше 20 МБ");

  ensureDataDir();
  const safeId = String(id || crypto.randomBytes(8).toString("hex")).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 70);
  const fileName = "source_" + safeId + "_" + Date.now() + ".webp";
  const filePath = path.join(MEDIA_DIR, fileName);

  await sharp(bytes, { limitInputPixels: 80 * 1000 * 1000 })
    .rotate()
    .resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 90 })
    .toFile(filePath);

  return mediaPublicUrl(fileName);
}

async function prepareReusableSourceImage(imageUrl, id) {
  const sourceUrl = String(imageUrl || "").trim();
  if (!sourceUrl) return { imageUrl: "", originalImageUrl: "" };
  try {
    const cached = await cacheSourceImage(sourceUrl, id);
    return { imageUrl: cached || sourceUrl, originalImageUrl: sourceUrl, cached: Boolean(cached) };
  } catch (error) {
    console.warn("Source image cache failed:", sourceUrl, error.message);
    return { imageUrl: sourceUrl, originalImageUrl: sourceUrl, cached: false, cacheError: error.message };
  }
}

async function repairBalancedQueueMedia() {
  if (COPYRIGHT_MEDIA_MODE !== "balanced") return { repaired: 0, failed: 0 };
  let repaired = 0;
  let failed = 0;

  for (const item of (state.queue || [])) {
    if (!item) continue;
    const license = sourceMediaLicense(item);
    if (!mediaLicenseAllowsReuse(license)) continue;

    const sourceVideo = String(item.originalVideoUrl || item.videoUrl || "").trim();
    const sourceImage = String(item.originalImageUrl || item.imageUrl || "").trim();

    if (sourceVideo && !item.videoUrl) {
      item.videoUrl = sourceVideo;
      item.mediaType = "video";
      item.mediaStatus = "video_found";
      item.mediaPriority = 1;
      item.mediaOrigin = "source_media";
      item.copyrightMediaDecision = "balanced_source_reuse";
      repaired += 1;
    }

    if (sourceImage && (!item.imageUrl || !isLocalMediaUrl(item.imageUrl))) {
      try {
        const prepared = await prepareReusableSourceImage(sourceImage, item.newsId || item.id);
        item.originalImageUrl = prepared.originalImageUrl || sourceImage;
        item.imageUrl = prepared.imageUrl || sourceImage;
        if (!item.videoUrl) {
          item.mediaType = "photo";
          item.mediaStatus = "photo_found";
          item.mediaPriority = 2;
        }
        item.mediaOrigin = "source_media";
        item.copyrightMediaDecision = "balanced_source_reuse";
        repaired += 1;
      } catch (error) {
        failed += 1;
        console.warn("Queue media repair failed:", item.id, error.message);
      }
    }
  }

  if (repaired) saveState();
  return { repaired: repaired, failed: failed };
}


async function backfillQueueImageEnhancements(options) {
  if (!IMAGE_ENHANCEMENT_ENABLED || !AUTO_ENHANCE_SOURCE_IMAGES) {
    return { enhanced: 0, failed: 0, skipped: 0, total: 0 };
  }

  const opts = options || {};
  const force = Boolean(opts.force);
  const candidates = (state.queue || []).filter(function(item) {
    if (!item) return false;
    if (!mediaLicenseAllowsReuse(sourceMediaLicense(item))) return false;
    const originals = (Array.isArray(item.originalMediaUrls) ? item.originalMediaUrls : [])
      .concat([item.originalImageUrl || ""])
      .filter(Boolean);
    if (!originals.length) return false;
    if (!force && item.mediaEnhancementBackfillVersion === "v3") return false;
    return true;
  });

  let cursor = 0;
  let enhanced = 0;
  let failed = 0;
  let skipped = 0;

  async function worker() {
    while (cursor < candidates.length) {
      const item = candidates[cursor++];
      try {
        const originals = Array.from(new Set(
          (Array.isArray(item.originalMediaUrls) ? item.originalMediaUrls : [])
            .concat([item.originalImageUrl || ""])
            .filter(Boolean)
        )).slice(0, MEDIA_DIRECTOR_MAX_IMAGES);

        if (!originals.length) {
          item.mediaEnhancementBackfillVersion = "v3";
          skipped += 1;
          continue;
        }

        const enhancedUrls = [];
        const logs = [];

        for (let i = 0; i < originals.length; i += 1) {
          const original = originals[i];
          const prepared = await prepareReusableSourceImage(original, String(item.newsId || item.id) + "_bf" + i);
          // Only the main photo is AI-enhanced (OpenAI image rate limit, fewer altered photos).
          const result = i === 0
            ? await enhanceSourceCandidate(
                prepared.imageUrl || original,
                { id: item.newsId || item.id, title: item.title || item.sourceOriginalTitle || "" },
                "bf" + i
              )
            : { url: prepared.imageUrl || original, enhanced: false, error: "" };
          if (result.url) enhancedUrls.push(result.url);
          logs.push({
            originalUrl: original,
            cachedUrl: prepared.imageUrl || "",
            enhancedUrl: result.enhanced ? result.url : "",
            enhanced: Boolean(result.enhanced),
            model: result.model || "",
            error: result.error || ""
          });
        }

        const genuinelyEnhanced = logs.some(function(entry){ return entry.enhanced; });
        if (!enhancedUrls.length || !genuinelyEnhanced) {
          item.mediaEnhancementError = logs.map(function(x){ return x.error; }).filter(Boolean).join("; ").slice(0, 600) || "AI-улучшение не выполнено";
          item.mediaEnhancementRetryAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
          failed += 1;
          saveState();
          continue;
        }

        const cleanPack = await sanitizeMediaPack(enhancedUrls, item.editorialV2 && item.editorialV2.album === false ? 1 : MEDIA_DIRECTOR_MAX_IMAGES);
        item.imageUrl = cleanPack[0] || enhancedUrls[0];
        item.enhancedImageUrl = item.imageUrl;
        item.mediaPackUrls = cleanPack.length ? cleanPack : enhancedUrls.slice(0, 1);
        if (!item.videoUrl) item.mediaType = item.mediaPackUrls.length > 1 ? "album" : "photo";
        item.mediaEnhancementLog = logs;
        item.mediaEnhancementBackfillVersion = "v3";
        item.mediaEnhancementError = logs.some(function(x){ return x.error; }) ? "Часть фотографий оставлена в исходном качестве" : "";
        item.mediaOrigin = "ai_enhanced_source";
        item.enhancedAt = new Date().toISOString();
        item.canEnhance = false;

        if (item.videoUrl) {
          item.mediaStatus = "video_poster_enhanced";
          item.mediaType = "video";
          item.mediaPriority = 1;
        } else {
          item.mediaStatus = "enhanced";
          item.mediaType = enhancedUrls.length > 1 ? "album" : "photo";
          item.mediaPriority = 2;
        }

        if (item.generatedImageUrl && item.originalImageUrl) item.generatedImageUrl = "";

        if (db && dbReady && item.newsId) {
          try {
            await db.query(
              "UPDATE news_items SET metadata=COALESCE(metadata,'{}'::jsonb) || $2::jsonb, updated_at=NOW() WHERE id=$1 AND workspace_id=$3",
              [
                item.newsId,
                JSON.stringify({
                  imageUrl: item.imageUrl || "",
                  enhancedImageUrl: item.enhancedImageUrl || "",
                  generatedImageUrl: item.generatedImageUrl || "",
                  mediaPackUrls: item.mediaPackUrls || [],
                  mediaEnhancementLog: item.mediaEnhancementLog || [],
                  mediaStatus: item.mediaStatus || "",
                  mediaType: item.mediaType || "",
                  mediaOrigin: item.mediaOrigin || "",
                  enhancedAt: item.enhancedAt || ""
                }),
                currentWorkspaceId()
              ]
            );
          } catch (dbError) {
            console.warn("Enhancement backfill DB update failed:", dbError.message);
          }
        }

        enhanced += 1;
        saveState();
      } catch (error) {
        failed += 1;
        item.mediaEnhancementError = String(error && error.message || error).slice(0, 600);
        item.mediaEnhancementRetryAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
        console.warn("Queue image enhancement backfill failed:", item.id, error.message);
        saveState();
      }
    }
  }

  const workers = Math.min(SOURCE_IMAGE_ENHANCE_CONCURRENCY, Math.max(1, candidates.length));
  await Promise.all(Array.from({ length: workers }, function(){ return worker(); }));
  return { enhanced: enhanced, failed: failed, skipped: skipped, total: candidates.length };
}

async function ensureMediaForNews(payload) {
  const imageUrl = String(payload.imageUrl || "").trim();
  const videoUrl = String(payload.videoUrl || "").trim();
  const mediaLicense = normalizeMediaLicense(payload.mediaLicense || "unknown");
  const sourceReuseAllowed = mediaLicenseAllowsReuse(mediaLicense);

  // Balanced mode: source media is used by default with attribution. Only forbidden media is blocked.
  if (!sourceReuseAllowed && (imageUrl || videoUrl)) {
    if (GENERATE_COVER_IF_MISSING) {
      try {
        const generated = await generateNewsCover(payload);
        return {
          videoUrl: "",
          imageUrl: "",
          originalImageUrl: imageUrl,
          originalVideoUrl: videoUrl,
          generatedImageUrl: generated.url,
          mediaType: "generated",
          mediaStatus: "generated",
          mediaPriority: 2,
          mediaLicense: mediaLicense,
          mediaOrigin: "ai_generated",
          copyrightSafe: COPYRIGHT_SAFE_MODE,
          copyrightMediaMode: COPYRIGHT_MEDIA_MODE,
          copyrightMediaDecision: "source_media_blocked",
          generatedBy: generated.model
        };
      } catch (error) {
        return {
          videoUrl: "",
          imageUrl: "",
          originalImageUrl: imageUrl,
          originalVideoUrl: videoUrl,
          generatedImageUrl: "",
          mediaType: "none",
          mediaStatus: "generation_error",
          mediaPriority: 99,
          mediaLicense: mediaLicense,
          mediaOrigin: "source_media_blocked",
          copyrightSafe: COPYRIGHT_SAFE_MODE,
          copyrightMediaMode: COPYRIGHT_MEDIA_MODE,
          copyrightMediaDecision: "source_media_blocked",
          mediaError: error.message
        };
      }
    }
    return {
      videoUrl: "",
      imageUrl: "",
      originalImageUrl: imageUrl,
      originalVideoUrl: videoUrl,
      generatedImageUrl: "",
      mediaType: "none",
      mediaStatus: "copyright_pending",
      mediaPriority: 99,
      mediaLicense: mediaLicense,
      mediaOrigin: "source_media_blocked",
      copyrightSafe: COPYRIGHT_SAFE_MODE,
          copyrightMediaMode: COPYRIGHT_MEDIA_MODE,
      copyrightMediaDecision: "source_media_blocked"
    };
  }

  // Reuse source video in balanced mode; cache its poster image locally when present.
  if (videoUrl) {
    const preparedImage = imageUrl ? await prepareReusableSourceImage(imageUrl, payload.id || "video") : { imageUrl: "", originalImageUrl: "" };
    return {
      videoUrl: videoUrl,
      imageUrl: preparedImage.imageUrl || "",
      originalImageUrl: preparedImage.originalImageUrl || imageUrl,
      originalVideoUrl: videoUrl,
      generatedImageUrl: "",
      mediaType: "video",
      mediaStatus: "video_found",
      mediaPriority: 1,
      mediaLicense: mediaLicense,
      mediaOrigin: "source_media",
      copyrightSafe: COPYRIGHT_SAFE_MODE,
      copyrightMediaMode: COPYRIGHT_MEDIA_MODE
    };
  }

  // Source photo: cache it on our media domain so the admin, Telegram and VK do not depend on hotlinking.
  if (imageUrl) {
    const preparedImage = await prepareReusableSourceImage(imageUrl, payload.id || "photo");
    const publishImageUrl = preparedImage.imageUrl || imageUrl;
    if (IMAGE_ENHANCEMENT_ENABLED && AUTO_ENHANCE_SOURCE_IMAGES && sourceReuseAllowed) {
      try {
        const enhanced = await enhanceNewsImage({
          id: payload.id || newId("enhance"),
          title: payload.title || "",
          imageUrl: publishImageUrl
        });
        return {
          videoUrl: "",
          imageUrl: enhanced.url,
          enhancedImageUrl: enhanced.url,
          originalImageUrl: preparedImage.originalImageUrl || imageUrl,
          cachedSourceImageUrl: publishImageUrl,
          originalVideoUrl: "",
          generatedImageUrl: "",
          mediaType: "photo",
          mediaStatus: "enhanced",
          mediaPriority: 2,
          canEnhance: true,
          mediaLicense: mediaLicense,
          mediaOrigin: "ai_enhanced_source",
          copyrightSafe: COPYRIGHT_SAFE_MODE,
          copyrightMediaMode: COPYRIGHT_MEDIA_MODE,
          enhancedBy: enhanced.model,
          enhancedAt: new Date().toISOString()
        };
      } catch (error) {
        console.warn("Auto image enhancement failed, using licensed source photo:", error.message);
      }
    }
    return {
      videoUrl: "",
      imageUrl: publishImageUrl,
      originalImageUrl: preparedImage.originalImageUrl || imageUrl,
      originalVideoUrl: "",
      generatedImageUrl: "",
      mediaType: "photo",
      mediaStatus: "photo_found",
      mediaPriority: 2,
      canEnhance: IMAGE_ENHANCEMENT_ENABLED,
      mediaLicense: mediaLicense,
      mediaOrigin: "source_media",
      copyrightSafe: COPYRIGHT_SAFE_MODE,
      copyrightMediaMode: COPYRIGHT_MEDIA_MODE
    };
  }

  // No source media: generate an independent editorial visual.
  if (GENERATE_COVER_IF_MISSING) {
    try {
      const generated = await generateNewsCover(payload);
      return {
        videoUrl: "",
        imageUrl: "",
        originalImageUrl: "",
        originalVideoUrl: "",
        generatedImageUrl: generated.url,
        mediaType: "generated",
        mediaStatus: "generated",
        mediaPriority: 3,
        mediaLicense: mediaLicense,
        mediaOrigin: "ai_generated",
        copyrightSafe: COPYRIGHT_SAFE_MODE,
        copyrightMediaMode: COPYRIGHT_MEDIA_MODE,
        generatedBy: generated.model
      };
    } catch (error) {
      return {
        videoUrl: "",
        imageUrl: "",
        originalImageUrl: "",
        originalVideoUrl: "",
        generatedImageUrl: "",
        mediaType: "none",
        mediaStatus: "generation_error",
        mediaPriority: 99,
        mediaLicense: mediaLicense,
        mediaOrigin: "none",
        copyrightSafe: COPYRIGHT_SAFE_MODE,
        copyrightMediaMode: COPYRIGHT_MEDIA_MODE,
        mediaError: error.message
      };
    }
  }

  return {
    videoUrl: "",
    imageUrl: "",
    originalImageUrl: "",
    originalVideoUrl: "",
    generatedImageUrl: "",
    mediaType: "none",
    mediaStatus: "missing",
    mediaPriority: 99,
    mediaLicense: mediaLicense,
    mediaOrigin: "none",
    copyrightSafe: COPYRIGHT_SAFE_MODE,
    copyrightMediaMode: COPYRIGHT_MEDIA_MODE
  };
}



// URL patterns of thumbnails, avatars and logos that should never become extra album photos.
function isLikelyThumbnailUrl(url) {
  const u = String(url || "").toLowerCase();
  return /(fill|resize|crop|thumb|thumbnail)[-_=]?\d{2,3}x\d{2,3}|[-_]\d{2,3}x\d{2,3}\.(jpe?g|png|webp|gif)|\/(thumbs?|thumbnails?|avatars?|logos?|icons?|authors?)\/|[?&](w|width)=\d{2,3}(&|$)/.test(u);
}

// Size + 16x16 average hash of a cached local image; used to drop tiny images and
// the same photo saved in another crop/resolution.
async function localImageFingerprint(mediaUrl) {
  const file = localMediaPathFromUrl(mediaUrl);
  if (!file || !fs.existsSync(file)) return null;
  try {
    const meta = await sharp(file).metadata();
    const raw = await sharp(file).resize(16, 16, { fit: "fill" }).grayscale().raw().toBuffer();
    const stats = await sharp(file).stats();
    let sum = 0;
    for (const v of raw) sum += v;
    const avg = sum / raw.length;
    const bits = Array.from(raw, function(v){ return v >= avg ? 1 : 0; });
    return { width: Number(meta.width || 0), height: Number(meta.height || 0), bits: bits, entropy: Number(stats.entropy || 0) };
  } catch {
    return null;
  }
}

// A source that puts the same picture on every article (its logo / default
// share image) is detected by remembering recent main-photo fingerprints per source.
function isSourcePlaceholderImage(sourceName, newsId, fp) {
  if (!fp || !Array.isArray(fp.bits) || !sourceName) return false;
  state.sourceImagePrints = state.sourceImagePrints && typeof state.sourceImagePrints === "object" ? state.sourceImagePrints : {};
  const key = String(sourceName);
  const list = Array.isArray(state.sourceImagePrints[key]) ? state.sourceImagePrints[key] : [];
  const id = String(newsId || "");
  const bits = fp.bits.join("");
  // Near-identical picture (≤ 8% of hash bits differ) on another article of the same source.
  const repeat = list.some(function(prev){
    if (!prev || prev.id === id || typeof prev.bits !== "string" || prev.bits.length !== bits.length) return false;
    let diff = 0;
    for (let i = 0; i < bits.length; i += 1) if (prev.bits[i] !== bits[i]) diff += 1;
    return diff <= Math.round(bits.length * 0.08);
  });
  if (!list.some(function(prev){ return prev && prev.id === id; })) {
    list.push({ id: id, bits: bits, at: new Date().toISOString() });
    state.sourceImagePrints[key] = list.slice(-15);
  }
  return repeat;
}

// Logos, brand cards and flat graphics have very low entropy (~0.5–4); real photos ~6.5–7.8.
const MEDIA_MIN_PHOTO_ENTROPY = 5;
function looksLikeGraphic(fp) { return Boolean(fp) && fp.entropy > 0 && fp.entropy < MEDIA_MIN_PHOTO_ENTROPY; }

// Final clean-up of a post's photo set, used everywhere a pack is (re)built:
// keeps order, puts a real photo first if the main one is a logo/graphic, and keeps
// extras only if they are local, large, photo-like, not thumbnails and not a near
// duplicate of a photo already kept.
async function sanitizeMediaPack(urls, maxCount) {
  const limit = Math.max(1, Number(maxCount || MEDIA_DIRECTOR_MAX_IMAGES));
  const list = Array.from(new Set((Array.isArray(urls) ? urls : []).map(function(u){ return String(u || "").trim(); }).filter(Boolean)));
  if (list.length <= 1) return list;
  const entries = [];
  for (const url of list) entries.push({ url: url, fp: await localImageFingerprint(url) });
  if (looksLikeGraphic(entries[0].fp)) {
    const photoIndex = entries.findIndex(function(e, i){ return i > 0 && e.fp && !looksLikeGraphic(e.fp) && e.fp.width >= MEDIA_EXTRA_MIN_WIDTH && !isLikelyThumbnailUrl(e.url); });
    if (photoIndex > 0) entries.unshift(entries.splice(photoIndex, 1)[0]);
  }
  const kept = [entries[0]];
  for (const e of entries.slice(1)) {
    if (kept.length >= limit) break;
    if (!e.fp || isLikelyThumbnailUrl(e.url)) continue;
    if (e.fp.width < MEDIA_EXTRA_MIN_WIDTH || e.fp.height < MEDIA_EXTRA_MIN_HEIGHT) continue;
    if (looksLikeGraphic(e.fp)) continue;
    if (kept.some(function(k){ return imageFingerprintsSimilar(k.fp, e.fp); })) continue;
    kept.push(e);
  }
  return kept.map(function(e){ return e.url; });
}

function imageFingerprintsSimilar(a, b) {
  if (!a || !b || a.bits.length !== b.bits.length) return false;
  let diff = 0;
  for (let i = 0; i < a.bits.length; i += 1) if (a.bits[i] !== b.bits[i]) diff += 1;
  return diff <= Math.round(a.bits.length * 0.25);
}

async function enhanceSourceCandidate(preparedUrl, payload, suffix) {
  const sourceUrl = String(preparedUrl || "").trim();
  if (!sourceUrl) return { url: "", enhanced: false, error: "" };
  if (!IMAGE_ENHANCEMENT_ENABLED || !AUTO_ENHANCE_SOURCE_IMAGES) {
    return { url: sourceUrl, enhanced: false, error: "" };
  }
  try {
    const enhanced = await enhanceNewsImage({
      id: String(payload && payload.id || newId("enhance")) + "_" + String(suffix || "source"),
      title: String(payload && payload.title || ""),
      imageUrl: sourceUrl
    });
    return {
      url: enhanced.url,
      enhanced: true,
      model: enhanced.model,
      sourceUrl: sourceUrl,
      enhancedAt: new Date().toISOString()
    };
  } catch (error) {
    console.warn("Source image enhancement failed, using cached original:", error.message);
    return { url: sourceUrl, enhanced: false, error: String(error && error.message || error), sourceUrl: sourceUrl };
  }
}

async function prepareMediaDirector(payload) {
  const p = payload || {};
  const license = normalizeMediaLicense(p.mediaLicense || "unknown");
  const sourceAllowed = mediaLicenseAllowsReuse(license);
  const candidates = p.mediaCandidates && typeof p.mediaCandidates === "object" ? p.mediaCandidates : { images: [], videos: [] };
  const images = Array.isArray(candidates.images) ? candidates.images : [];
  const videos = Array.isArray(candidates.videos) ? candidates.videos : [];
  const fallbackImage = String(p.imageUrl || "").trim();
  const fallbackVideo = String(p.videoUrl || "").trim();
  const selectedVideo = String((videos[0] && videos[0].url) || fallbackVideo || "").trim();

  if (!sourceAllowed) {
    const safe = await ensureMediaForNews(Object.assign({}, p, {
      imageUrl: fallbackImage || (images[0] && images[0].url) || "",
      videoUrl: selectedVideo
    }));
    safe.mediaDirector = {
      strategy: "blocked_source_fallback",
      sourceCandidateCount: images.length + videos.length,
      selectedCount: safe.generatedImageUrl || safe.imageUrl || safe.videoUrl ? 1 : 0
    };
    return safe;
  }

  const imageUrls = [];
  const originalImageUrls = [];
  const enhancedImageUrls = [];
  const enhancementLog = [];
  const seen = new Set();
  const pool = images.map(function(x){ return x && x.url; }).filter(Boolean);
  if (fallbackImage) pool.unshift(fallbackImage);

  const fingerprints = [];
  for (const sourceImage of pool) {
    if (imageUrls.length >= MEDIA_DIRECTOR_MAX_IMAGES) break;
    const key = String(sourceImage || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const isExtra = imageUrls.length > 0;
    if (isExtra && isLikelyThumbnailUrl(key)) continue;
    try {
      const prepared = await prepareReusableSourceImage(key, String(p.id || "media") + "_md" + imageUrls.length);
      const cached = String(prepared.imageUrl || "").trim();
      if (!cached) continue;
      const fp = await localImageFingerprint(cached);
      if (!isExtra && fp && (looksLikeGraphic(fp) || isSourcePlaceholderImage(p.sourceName, p.id, fp))) {
        // Main photo is a logo / brand card / the source's default share image
        // (e.g. the VK logo on every VK press release): not a news photo.
        console.log("MEDIA_PLACEHOLDER_SKIPPED " + JSON.stringify({ source: p.sourceName || "", news: p.id || "", entropy: Number(fp.entropy || 0).toFixed(2), url: key.slice(0, 160) }));
        continue;
      }
      if (isExtra) {
        // Extra photos must be large and genuinely different from the ones already chosen.
        if (!fp || fp.width < MEDIA_EXTRA_MIN_WIDTH || fp.height < MEDIA_EXTRA_MIN_HEIGHT || looksLikeGraphic(fp)) continue;
        if (fingerprints.some(function(prev){ return imageFingerprintsSimilar(prev, fp); })) continue;
      }
      if (fp) fingerprints.push(fp);
      // Generative enhancement only for the main photo: it is rate-limited by OpenAI
      // (5 input images/min) and must not rewrite every news photo in an album.
      const enhanced = isExtra
        ? { url: cached, enhanced: false, error: "" }
        : await enhanceSourceCandidate(cached, p, "md" + imageUrls.length);
      const chosen = String(enhanced.url || cached).trim();
      if (!chosen) continue;
      imageUrls.push(chosen);
      enhancedImageUrls.push(enhanced.enhanced ? chosen : "");
      originalImageUrls.push(String(prepared.originalImageUrl || key));
      enhancementLog.push({
        originalUrl: String(prepared.originalImageUrl || key),
        cachedUrl: cached,
        enhancedUrl: enhanced.enhanced ? chosen : "",
        enhanced: Boolean(enhanced.enhanced),
        model: enhanced.model || "",
        error: enhanced.error || ""
      });
    } catch (error) {
      console.warn("Media Director image skipped:", error.message);
    }
  }

  if (selectedVideo) {
    const poster = imageUrls[0] || "";
    return {
      videoUrl: selectedVideo,
      imageUrl: poster,
      originalImageUrl: originalImageUrls[0] || fallbackImage || "",
      originalVideoUrl: selectedVideo,
      generatedImageUrl: "",
      enhancedImageUrl: enhancedImageUrls.find(Boolean) || "",
      mediaPackUrls: imageUrls.slice(0, MEDIA_DIRECTOR_MAX_IMAGES),
      originalMediaUrls: originalImageUrls.slice(0, MEDIA_DIRECTOR_MAX_IMAGES),
      mediaEnhancementLog: enhancementLog,
      mediaType: "video",
      mediaStatus: enhancedImageUrls.some(Boolean) ? "video_poster_enhanced" : "video_found",
      mediaPriority: 1,
      mediaLicense: license,
      mediaOrigin: "source_media",
      copyrightSafe: COPYRIGHT_SAFE_MODE,
      copyrightMediaMode: COPYRIGHT_MEDIA_MODE,
      mediaDirector: {
        strategy: "video_first",
        sourceCandidateCount: images.length + videos.length,
        selectedCount: 1 + imageUrls.length,
        enhancedCount: enhancedImageUrls.filter(Boolean).length,
        videoReason: videos[0] && videos[0].reason || (fallbackVideo ? "meta_video" : "")
      }
    };
  }

  if (imageUrls.length) {
    return {
      videoUrl: "",
      imageUrl: imageUrls[0],
      originalImageUrl: originalImageUrls[0] || fallbackImage || "",
      originalVideoUrl: "",
      generatedImageUrl: "",
      enhancedImageUrl: enhancedImageUrls.find(Boolean) || "",
      mediaPackUrls: imageUrls.slice(0, MEDIA_DIRECTOR_MAX_IMAGES),
      originalMediaUrls: originalImageUrls.slice(0, MEDIA_DIRECTOR_MAX_IMAGES),
      mediaEnhancementLog: enhancementLog,
      mediaType: imageUrls.length > 1 ? "album" : "photo",
      mediaStatus: enhancedImageUrls.some(Boolean) ? "enhanced" : "photo_found",
      mediaPriority: 2,
      mediaLicense: license,
      mediaOrigin: "source_media",
      copyrightSafe: COPYRIGHT_SAFE_MODE,
      copyrightMediaMode: COPYRIGHT_MEDIA_MODE,
      mediaDirector: {
        strategy: imageUrls.length > 1 ? "enhanced_source_album" : "enhanced_source_photo",
        sourceCandidateCount: images.length + videos.length,
        selectedCount: imageUrls.length,
        enhancedCount: enhancedImageUrls.filter(Boolean).length
      }
    };
  }

  const fallback = await ensureMediaForNews(Object.assign({}, p, { imageUrl: "", videoUrl: "" }));
  fallback.mediaDirector = {
    strategy: "ai_fallback",
    sourceCandidateCount: images.length + videos.length,
    selectedCount: fallback.generatedImageUrl ? 1 : 0
  };
  return fallback;
}

function hasPublishableMedia(item) {
  return Boolean(item && (item.videoUrl || item.imageUrl || item.generatedImageUrl || (item.metadata && (item.metadata.videoUrl || item.metadata.imageUrl || item.metadata.generatedImageUrl))));
}


function extractTelegramSourcePosts(html, sourceUrl) {
  const source = String(html || "");
  let channel = "";
  try {
    const u = new URL(sourceUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    channel = parts[0] === "s" ? String(parts[1] || "") : String(parts[0] || "");
  } catch {}
  if (!channel) return [];

  const posts = [];
  const chunks = source.split(/<div[^>]+class=["'][^"']*tgme_widget_message_wrap[^"']*["'][^>]*>/i).slice(1);
  for (const chunk of chunks) {
    const dataPost = chunk.match(/data-post=["']([^"']+)\/([0-9]+)["']/i);
    const messageId = dataPost ? Number(dataPost[2]) : 0;
    if (!messageId) continue;

    const textMatch = chunk.match(/<div[^>]+class=["'][^"']*tgme_widget_message_text[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    let text = textMatch ? stripHtml(textMatch[1]).replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() : "";
    if (!text || text.length < 20) continue;

    const dateMatch = chunk.match(/<time[^>]+datetime=["']([^"']+)["']/i);
    const hasVideo = /tgme_widget_message_video|tgme_widget_message_video_player|video_player|media is not supported|media is too big/i.test(chunk);
    const hasPhoto = /tgme_widget_message_photo_wrap|background-image\s*:\s*url/i.test(chunk);
    const firstLine = text.split("\n").map(function(x){ return x.trim(); }).find(Boolean) || text;
    const title = firstLine.length > 150 ? firstLine.slice(0, 147) + "…" : firstLine;

    posts.push({
      url: "https://t.me/" + channel + "/" + messageId,
      title: title,
      text: text,
      publishedAt: dateMatch ? normalizeDate(dateMatch[1]) : "",
      hasVideo: hasVideo,
      hasPhoto: hasPhoto,
      score: 20 + (hasVideo ? 8 : 0) + (hasPhoto ? 3 : 0) + Math.min(5, Math.floor(text.length / 180))
    });
  }
  return posts.sort(function(a,b){
    const ta = new Date(a.publishedAt || 0).getTime();
    const tb = new Date(b.publishedAt || 0).getTime();
    if (tb !== ta) return tb - ta;
    return b.score - a.score;
  }).slice(0, 18);
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
    const r = await db.query("SELECT 1 FROM news_items WHERE workspace_id=$1 AND original_url=$2 LIMIT 1", [currentWorkspaceId(), url]);
    return r.rowCount > 0;
  }
  state.seenUrls = Array.isArray(state.seenUrls) ? state.seenUrls : [];
  return state.seenUrls.includes(url);
}

async function saveNewsItem(item) {
  if (db && dbReady) {
    await db.query(
      `INSERT INTO news_items
      (id, workspace_id, source_id, source_name, source_url, original_url, original_title, original_text, content_hash, rewritten_title, rewritten_text, confidence, status, telegram_message_id, published_at, metadata, topic_id, vk_post_id, vk_status, vk_error_code, vk_error_msg, vk_media_attempts, updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19,$20,$21,$22,NOW())
      ON CONFLICT (workspace_id, original_url) DO UPDATE SET
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
        item.id, currentWorkspaceId(), item.sourceId, item.sourceName, item.sourceUrl, item.originalUrl, item.originalTitle,
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
  const v2Meta = metadata.editorialV2 && typeof metadata.editorialV2 === "object" ? metadata.editorialV2 : null;
  if (aiScore == null && v2Meta && Number.isFinite(Number(v2Meta.importance))) aiScore = Math.max(0, Math.min(100, Number(v2Meta.importance) * 10));
  let aiScoreReason = String((queueItem && queueItem.aiScoreReason) || metadata.scoreReason || "");
  if (item.status === "editorial_skip" && !queueItem && !historyItem) {
    const reason = String(metadata.editorialSkipReason || (v2Meta && v2Meta.skipReason) || "не прошла отбор");
    if (!/^Пропущено редакцией/.test(aiScoreReason)) aiScoreReason = "Пропущено редакцией: " + reason;
    item.editorialSkipReason = reason;
  }

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
          FROM news_items WHERE workspace_id=$1 AND detected_at >= $2 AND status <> 'prefilter_skip' ORDER BY detected_at DESC LIMIT $3`,
          [currentWorkspaceId(), cutoff, safeLimit]
        )
      : await db.query(
          `SELECT id, source_id AS "sourceId", source_name AS "sourceName", source_url AS "sourceUrl",
          original_url AS "originalUrl", original_title AS "originalTitle", detected_at AS "detectedAt",
          rewritten_title AS "rewrittenTitle", rewritten_text AS "rewrittenText", confidence, status,
          telegram_message_id AS "telegramMessageId", published_at AS "publishedAt", metadata
          FROM news_items WHERE workspace_id=$1 AND status <> 'prefilter_skip' ORDER BY detected_at DESC LIMIT $2`,
          [currentWorkspaceId(), safeLimit]
        );
    return r.rows.map(enrichNewsFeedItem);
  }
  return [];
}

async function getCollectorRuns(limit) {
  if (!db || !dbReady) return [];
  const r = await db.query(
    'SELECT id, started_at AS "startedAt", finished_at AS "finishedAt", status, found_count AS "foundCount", queued_count AS "queuedCount", published_count AS "publishedCount", skipped_count AS "skippedCount", error_text AS "errorText" FROM collector_runs WHERE workspace_id=$1 ORDER BY id DESC LIMIT $2',
    [currentWorkspaceId(), Math.max(1, Math.min(50, Number(limit || 10)))]
  );
  return r.rows;
}

async function collectOnce(trigger) {
  if (!COLLECTOR_ENABLED) return { ok: false, error: "Collector disabled" };
  const collectorWorkspaceId = currentWorkspaceId();
  if (collectorRunningWorkspaces.has(collectorWorkspaceId)) return { ok: false, error: "Collector already running" };
  collectorRunningWorkspaces.add(collectorWorkspaceId);
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
      const r = await db.query("INSERT INTO collector_runs(workspace_id,status) VALUES($1,'running') RETURNING id", [currentWorkspaceId()]);
      runId = r.rows[0].id;
    }

    if (state.mode === "PAUSED" && trigger !== "manual") {
      summary.skipped += 1;
      return summary;
    }

    const triggerName = String(trigger || "");
    const bloggerRun = triggerName.startsWith("blogger-");
    const russianAiRun = triggerName.startsWith("russian-ai-");
    const enabledSources = (state.sources || []).filter(function(src){
      if (!src || !src.enabled || !/^https?:\/\//i.test(src.url || "")) return false;
      if (bloggerRun) return src.group === "blogger";
      if (russianAiRun) return isRussianAISource(src);
      if (triggerName.startsWith("slot-")) return src.group !== "blogger" && !isRussianAISource(src);
      return true;
    });
    const ordered = [];
    const selectedUrls = new Set();

    const cursor = enabledSources.length ? Math.abs(Number(state.sourceCursor || 0)) % enabledSources.length : 0;
    const rotatedSources = enabledSources.length
      ? enabledSources.slice(cursor).concat(enabledSources.slice(0, cursor))
      : [];

    const sourceResults = await Promise.all(rotatedSources.map(async function(source) {
      noteSourceEvent(source, "check");
      try {
        const html = await fetchText(source.url, 15000);
        noteSourceEvent(source, "fetch_ok");
        const isTelegramCreator = source.group === "blogger" || source.group === "creator";
        const links = (isTelegramCreator
          ? extractTelegramSourcePosts(html, source.url)
          : extractArticleLinks(html, source.url)
        ).slice(0, isTelegramCreator ? 18 : 12);
        for (const link of links) {
          if (selectedUrls.has(link.url)) continue;
          if (await seenOriginalUrl(link.url)) {
            summary.skipped += 1;
            continue;
          }
          selectedUrls.add(link.url);
          noteSourceEvent(source, "candidate");
          return { source: source, link: link };
        }
        return null;
      } catch (error) {
        noteSourceEvent(source, "error");
        noteSourceEvent(source, "fetch_error");
        summary.errors.push(source.name + ": " + error.message);
        return null;
      }
    }));

    for (const candidate of sourceResults) {
      if (candidate) ordered.push(candidate);
    }
    const prefiltered = await prefilterCandidates(ordered, summary);
    ordered.length = 0;
    prefiltered.forEach(function(candidate){ ordered.push(candidate); });

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
        const isBlogger = source.group === "blogger" || source.group === "creator";
        const originalTitle = isBlogger
          ? (candidate.link.title || extractTitle(articleHtml) || source.name)
          : (extractTitle(articleHtml) || candidate.link.title);
        const articlePublishedAt = candidate.link.publishedAt || extractPublishedAt(articleHtml);
        if (articlePublishedAt && (Date.now() - new Date(articlePublishedAt).getTime()) > ARTICLE_MAX_AGE_HOURS * 60 * 60 * 1000) {
          summary.skipped += 1;
          continue;
        }
        const mediaCandidates = extractArticleMediaCandidates(articleHtml, url);
        const imageUrl = (mediaCandidates.images[0] && mediaCandidates.images[0].url) || extractMetaImage(articleHtml, url);
        const videoUrl = (mediaCandidates.videos[0] && mediaCandidates.videos[0].url) || extractMetaVideo(articleHtml, url);
        const raw = stripHtml(articleHtml);
        const originalText = (isBlogger && candidate.link.text ? String(candidate.link.text) : raw).slice(0, 14000);
        if (originalText.length < (isBlogger ? 40 : 250)) {
          summary.skipped += 1;
          continue;
        }
        const contentHash = crypto.createHash("sha256").update(originalTitle + "\n" + originalText.slice(0, 6000)).digest("hex");
        const id = "news_" + contentHash.slice(0, 20);
        // Cheap duplicate check on the source text BEFORE media preparation and the
        // writer/checker calls: an obvious repeat of a recently published post costs
        // one short classifier call instead of media + 3-6 LLM calls.
        let storyPrecheck = null;
        if (STORY_PRECHECK_ENABLED) {
          try {
            storyPrecheck = await classifyPublishedStoryRelationship({ id: id, newsId: id, title: originalTitle, text: originalText, sourceId: source.id, sourceName: source.name });
          } catch (error) {
            console.warn("STORY_PRECHECK_ERROR " + JSON.stringify({ workspace: currentWorkspaceId(), url: url, error: error.message }));
            storyPrecheck = null;
          }
          if (storyPrecheck && storyPrecheck.relation === "duplicate") {
            console.log("STORY_PRECHECK_DUPLICATE " + JSON.stringify({ workspace: currentWorkspaceId(), url: url, similarity: Number(storyPrecheck.similarity || 0).toFixed(2), publishedId: storyPrecheck.candidate && (storyPrecheck.candidate.id || storyPrecheck.candidate.queueId) || "" }));
            await saveNewsItem({
              id: id,
              sourceId: source.id,
              sourceName: source.name,
              sourceUrl: source.url,
              originalUrl: url,
              originalTitle: originalTitle,
              originalText: originalText,
              contentHash: contentHash,
              status: "duplicate_story",
              metadata: {
                trigger: trigger || "scheduler",
                articlePublishedAt: articlePublishedAt || "",
                storyRelation: { relation: "duplicate", reason: storyPrecheck.reason || "", similarity: storyPrecheck.similarity || 0, publishedTitle: storyPrecheck.candidate && storyPrecheck.candidate.title || "", stage: "precheck" },
                autoPublishBlocked: "duplicate_story"
              }
            });
            summary.skipped += 1;
            saveState();
            continue;
          }
        }
        const media = await prepareMediaDirector({
          id: id,
          title: originalTitle,
          text: originalText,
          sourceName: source.name,
          imageUrl: imageUrl,
          videoUrl: videoUrl,
          mediaCandidates: mediaCandidates,
          mediaLicense: sourceMediaLicense(source)
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
            originalImageUrl: media.originalImageUrl || media.imageUrl || imageUrl || "",
            originalVideoUrl: media.originalVideoUrl || videoUrl || "",
            videoUrl: media.videoUrl || "",
            hasEmbeddedVideo: Boolean(candidate.link && candidate.link.hasVideo),
            generatedImageUrl: media.generatedImageUrl || "",
            enhancedImageUrl: media.enhancedImageUrl || "",
            mediaPackUrls: Array.isArray(media.mediaPackUrls) ? media.mediaPackUrls : [],
            originalMediaUrls: Array.isArray(media.originalMediaUrls) ? media.originalMediaUrls : [],
            mediaEnhancementLog: Array.isArray(media.mediaEnhancementLog) ? media.mediaEnhancementLog : [],
            // Main photo already enhanced at collection time: the queue backfill must not redo it.
            mediaEnhancementBackfillVersion: (Array.isArray(media.mediaEnhancementLog) && media.mediaEnhancementLog.some(function(x){ return x && x.enhanced; })) ? "v3" : undefined,
            mediaDirector: media.mediaDirector || null,
            mediaType: media.mediaType,
            mediaStatus: media.mediaStatus,
            mediaPriority: media.mediaPriority || 99,
            mediaLicense: media.mediaLicense || sourceMediaLicense(source),
            mediaOrigin: media.mediaOrigin || "",
            copyrightSafe: COPYRIGHT_SAFE_MODE,
            copyrightPolicyVersion: "v1",
            copyrightMediaDecision: media.copyrightMediaDecision || "",
            sourceAttributionRequired: true,
            sourceRole: sourceEditorialRole(source),
            factsOnly: true,
            canEnhance: Boolean(media.canEnhance),
            mediaError: media.mediaError || "",
            generatedBy: media.generatedBy || ""
          }
        };
        summary.found += 1;
        state.stats.discovered += 1;
        noteSourceEvent(source, "discovered");

        if (MEDIA_REQUIRED && !hasPublishableMedia(baseItem)) {
          baseItem.status = "missing_media";
          await saveNewsItem(baseItem);
          summary.skipped += 1;
          summary.errors.push(originalTitle + ": не удалось подготовить фото или видео");
          continue;
        }

        let rewrite;
        let qc;
        let editorialV2Meta = null;
        const sourceRole = sourceEditorialRole(source);
        if (editorialV2Active()) {
          let v2;
          try {
            v2 = await runEditorialV2([{
              name: source.name,
              url: url,
              date: articlePublishedAt || "",
              role: sourceRoleLabel(sourceRole),
              title: originalTitle,
              text: originalText,
              photos: [media.imageUrl, media.originalImageUrl].concat(Array.isArray(media.mediaPackUrls) ? media.mediaPackUrls : []).filter(Boolean)
            }], {
              hasPhoto: Boolean(media.imageUrl || media.generatedImageUrl || media.videoUrl || (Array.isArray(media.mediaPackUrls) && media.mediaPackUrls.length)),
              newsId: id
            });
            state.stats.rewritten += 1;
          } catch (error) {
            baseItem.status = "rewrite_error";
            baseItem.metadata.rewriteError = error.message;
            await saveNewsItem(baseItem);
            summary.errors.push(originalTitle + ": " + error.message);
            continue;
          }
          baseItem.metadata.editorialV2 = v2.meta;
          if (v2.skip) {
            baseItem.status = "editorial_skip";
            baseItem.metadata.editorialSkipReason = v2.reason;
            if (v2.meta.titleRu) baseItem.metadata.titleRu = v2.meta.titleRu;
            baseItem.metadata.editorialScore = v2.meta.importance == null ? 0 : v2.meta.importance * 10;
            baseItem.metadata.scoreReason = "Пропущено редакцией: " + v2.reason;
            noteSourceEvent(source, "score", { score: v2.meta.importance == null ? 0 : v2.meta.importance * 10 });
            await saveNewsItem(baseItem);
            summary.skipped += 1;
            summary.editorialSkipped = (summary.editorialSkipped || 0) + 1;
            noteSourceEvent(source, "junk", { reason: v2.reason });
            continue;
          }
          rewrite = v2.rewrite;
          qc = v2.qc;
          editorialV2Meta = v2.meta;
          // Several photos only where the writer says they show different, relevant things.
          if (!v2.meta.album && Array.isArray(media.mediaPackUrls) && media.mediaPackUrls.length > 1) {
            media.mediaPackUrls = media.mediaPackUrls.slice(0, 1);
            if (Array.isArray(media.originalMediaUrls)) media.originalMediaUrls = media.originalMediaUrls.slice(0, 1);
            if (!media.videoUrl) media.mediaType = "photo";
            baseItem.metadata.mediaPackUrls = media.mediaPackUrls;
            baseItem.metadata.originalMediaUrls = media.originalMediaUrls || [];
            baseItem.metadata.mediaType = media.mediaType;
          }
        } else {
          try {
            rewrite = await callOpenAIRewrite({ title: originalTitle, sourceUrl: url, text: originalText, sourceName: source.name, sourceGroup: source.group || "", newsId: id });
            state.stats.rewritten += 1;
          } catch (error) {
            baseItem.status = "rewrite_error";
            baseItem.metadata.rewriteError = error.message;
            await saveNewsItem(baseItem);
            summary.errors.push(originalTitle + ": " + error.message);
            continue;
          }
        }

        baseItem.rewrittenTitle = rewrite.title;
        baseItem.rewrittenText = rewrite.text;
        baseItem.confidence = rewrite.confidence;
        baseItem.metadata.model = rewrite.model;
        baseItem.metadata.notes = rewrite.notes;
        baseItem.metadata.editorialScore = rewrite.editorialScore;
        baseItem.metadata.scoreBreakdown = rewrite.scoreBreakdown;
        baseItem.metadata.scoreReason = rewrite.scoreReason;
        baseItem.metadata.contentFormat = rewrite.contentFormat || "";
        baseItem.metadata.contentFormatLabel = rewrite.contentFormatLabel || "";
        noteSourceEvent(source, "score", { score: rewrite.editorialScore });

        if (!qc) qc = await callOpenAIEditorialQC({
          title: rewrite.title,
          text: rewrite.text,
          sourceTitle: originalTitle,
          sourceText: originalText,
          sourceName: source.name,
          sourceGroup: source.group || "",
          sourceRole: sourceRole,
          contentFormat: rewrite.contentFormat || "",
          contentFormatLabel: rewrite.contentFormatLabel || "",
          imageUrl: media.imageUrl || "",
          generatedImageUrl: media.generatedImageUrl || "",
          videoUrl: media.videoUrl || "",
          mediaPackUrls: Array.isArray(media.mediaPackUrls) ? media.mediaPackUrls : [],
          mediaOrigin: media.mediaOrigin || "",
          mediaDirector: media.mediaDirector || null,
          newsId: id
        });
        rewrite.title = qc.title || rewrite.title;
        rewrite.text = qc.text || rewrite.text;
        baseItem.rewrittenTitle = rewrite.title;
        baseItem.rewrittenText = rewrite.text;
        baseItem.metadata.qualityScore = qc.qualityScore;
        baseItem.metadata.qualityBreakdown = qc.qualityBreakdown;
        baseItem.metadata.qcStatus = qc.qcStatus;
        baseItem.metadata.qcIssues = qc.qcIssues;
        baseItem.metadata.qcRepaired = qc.qcRepaired;
        baseItem.metadata.topicEntities = qc.topicEntities;
        baseItem.metadata.platformVariants = qc.platformVariants;
        baseItem.metadata.decisionSummary = qc.decisionSummary;
        baseItem.metadata.qcModel = qc.model || "";
        baseItem.metadata.sourceRole = sourceRole;

        const postText = rewrite.text;

        const lastPublished = (state.history || []).find(function(x){ return x && x.publishedAt; });
        const lastPublishedAt = lastPublished ? new Date(lastPublished.publishedAt).getTime() : 0;
        const enoughTimePassed = !lastPublishedAt || (Date.now() - lastPublishedAt) >= AUTO_PUBLISH_MIN_INTERVAL_MINUTES * 60 * 1000;
        const canAutoPublish =
          trigger === "legacy-auto" &&
          state.mode === "AUTO" &&
          AUTO_PUBLISH_ENABLED &&
          enoughTimePassed &&
          qc.qualityScore >= AUTO_QUALITY_MIN &&
          qc.qcStatus !== "hold" &&
          !ratingBelowAutoThreshold({ editorialV2: editorialV2Meta, aiScore: rewrite.editorialScore, qcStatus: qc.qcStatus, articlePublishedAt: articlePublishedAt || "", createdAt: new Date().toISOString(), videoUrl: media.videoUrl, imageUrl: media.imageUrl, generatedImageUrl: media.generatedImageUrl, sourceRole: sourceRole }) &&
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
            sourceId: source.id,
            sourceName: source.name,
            sourceUrl: url,
            imageUrl: media.imageUrl,
            originalImageUrl: media.originalImageUrl || imageUrl || "",
            originalVideoUrl: media.originalVideoUrl || videoUrl || "",
            generatedImageUrl: media.generatedImageUrl,
            videoUrl: media.videoUrl,
            mediaStatus: media.mediaStatus || "",
            mediaOrigin: media.mediaOrigin || "",
            mediaLicense: media.mediaLicense || sourceMediaLicense(source),
            mediaPackUrls: Array.isArray(media.mediaPackUrls) ? media.mediaPackUrls : [],
            platformVariants: qc.platformVariants,
            qualityScore: qc.qualityScore,
            qualityBreakdown: qc.qualityBreakdown,
            qcStatus: qc.qcStatus,
            topicEntities: qc.topicEntities,
            sourceRole: sourceRole,
            decisionSummary: qc.decisionSummary
          });
          baseItem.status = "published";
          noteSourceEvent(source, "useful");
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
            sourceId: source.id,
            sourceName: source.name,
            sourceUrl: url,
            imageUrl: media.imageUrl || "",
            originalImageUrl: media.originalImageUrl || media.imageUrl || "",
            generatedImageUrl: media.generatedImageUrl || "",
            videoUrl: media.videoUrl || "",
            hasEmbeddedVideo: Boolean(candidate.link && candidate.link.hasVideo),
            mediaType: media.mediaType,
            mediaStatus: media.mediaStatus,
            mediaPriority: media.mediaPriority || 99,
            contentFormat: rewrite.contentFormat || "",
            contentFormatLabel: rewrite.contentFormatLabel || "",
            qualityScore: qc.qualityScore,
            qualityBreakdown: qc.qualityBreakdown,
            qcStatus: qc.qcStatus,
            qcIssues: qc.qcIssues,
            topicEntities: qc.topicEntities,
            platformVariants: qc.platformVariants,
            sourceRole: sourceRole,
            decisionSummary: qc.decisionSummary,
            mediaPackUrls: Array.isArray(media.mediaPackUrls) ? media.mediaPackUrls : [],
            editorialV2: editorialV2Meta,
            publicationOrigin: "legacy-auto"
          });
          state.history = state.history.slice(0, 300);
          state.stats.published += 1;
          noteSourceEvent(source, "published");
          summary.published += 1;
        } else {
          baseItem.status = "queued";
          baseItem.metadata.autoPublishBlocked = state.mode === "AUTO" ? (
            !AUTO_PUBLISH_ENABLED ? "disabled" :
            trigger !== "legacy-auto" ? "slot_scheduler" :
            !enoughTimePassed ? "rate_limited" :
            qc.qualityScore < AUTO_QUALITY_MIN || qc.qcStatus === "hold" ? "quality_hold" :
            "run_limit"
          ) : "review_mode";
          const queueItem = {
            id: newId("q"),
            title: rewrite.title || originalTitle,
            text: postText,
            sourceOriginalTitle: originalTitle,
            sourceOriginalText: originalText.slice(0, 7000),
            createdAt: new Date().toISOString(),
            articlePublishedAt: articlePublishedAt || "",
            sourceId: source.id,
            sourceGroup: source.group || "",
            sourceUrl: url,
            imageUrl: media.imageUrl || "",
            originalImageUrl: media.originalImageUrl || media.imageUrl || imageUrl || "",
            originalVideoUrl: media.originalVideoUrl || videoUrl || "",
            generatedImageUrl: media.generatedImageUrl || "",
            enhancedImageUrl: media.enhancedImageUrl || "",
            videoUrl: media.videoUrl || "",
            mediaPackUrls: Array.isArray(media.mediaPackUrls) ? media.mediaPackUrls : [],
            originalMediaUrls: Array.isArray(media.originalMediaUrls) ? media.originalMediaUrls : [],
            mediaEnhancementLog: Array.isArray(media.mediaEnhancementLog) ? media.mediaEnhancementLog : [],
            // Main photo already enhanced at collection time: the queue backfill must not redo it.
            mediaEnhancementBackfillVersion: (Array.isArray(media.mediaEnhancementLog) && media.mediaEnhancementLog.some(function(x){ return x && x.enhanced; })) ? "v3" : undefined,
            mediaDirector: media.mediaDirector || null,
            mediaType: media.mediaType,
            mediaStatus: media.mediaStatus,
            mediaPriority: media.mediaPriority || 99,
            mediaLicense: media.mediaLicense || sourceMediaLicense(source),
            mediaOrigin: media.mediaOrigin || "",
            copyrightSafe: COPYRIGHT_SAFE_MODE,
            copyrightPolicyVersion: "v1",
            copyrightMediaDecision: media.copyrightMediaDecision || "",
            canEnhance: Boolean(media.canEnhance),
            sourceName: source.name,
            newsId: id,
            aiScore: rewrite.editorialScore,
            aiScoreBreakdown: rewrite.scoreBreakdown,
            aiScoreReason: rewrite.scoreReason,
            aiTier: rewrite.editorialScore >= AI_TOP_NEWS_SCORE ? "top" : (rewrite.editorialScore >= AI_STRONG_NEWS_SCORE ? "strong" : "normal"),
            contentFormat: rewrite.contentFormat || "",
            contentFormatLabel: rewrite.contentFormatLabel || "",
            qualityScore: qc.qualityScore,
            qualityBreakdown: qc.qualityBreakdown,
            qcStatus: qc.qcStatus,
            qcIssues: qc.qcIssues,
            qcRepaired: qc.qcRepaired,
            topicEntities: qc.topicEntities,
            platformVariants: qc.platformVariants,
            sourceRole: sourceRole,
            decisionSummary: qc.decisionSummary,
            editorialV2: editorialV2Meta
          };

          // Reuse the precheck verdict when the classifier already judged this story;
          // otherwise (e.g. a foreign-language source) compare the rewritten post.
          const storyRelation = (storyPrecheck && storyPrecheck.judged)
            ? storyPrecheck
            : await classifyPublishedStoryRelationship(queueItem);
          if (storyRelation.relation === "duplicate") {
            baseItem.status = "duplicate_story";
            baseItem.metadata.storyRelation = storyRelation;
            baseItem.metadata.autoPublishBlocked = "duplicate_story";
            summary.skipped += 1;
            await saveNewsItem(baseItem);
            saveState();
            continue;
          }
          if (storyRelation.relation === "update" && storyRelation.candidate) {
            queueItem.storyUpdateOf = storyRelation.candidate.id || storyRelation.candidate.queueId || "";
            queueItem.storyUpdateTitle = storyRelation.candidate.title || "";
            queueItem.storyUpdateNewFact = storyRelation.newFact || "";
            queueItem.storyUpdateReason = storyRelation.reason || "";
            queueItem.storyUpdateSimilarity = storyRelation.similarity || 0;
            if (!/^обновление\s*:/i.test(queueItem.title)) queueItem.title = "Обновление: " + queueItem.title.replace(/^[^\p{L}\p{N}]+/u, "");
            if (queueItem.platformVariants && queueItem.platformVariants.telegram && !/^обновление\s*:/i.test(queueItem.platformVariants.telegram.title || "")) {
              queueItem.platformVariants.telegram.title = "Обновление: " + String(queueItem.platformVariants.telegram.title || queueItem.title).replace(/^[^\p{L}\p{N}]+/u, "");
            }
            if (queueItem.platformVariants && queueItem.platformVariants.vk && !/^обновление\s*:/i.test(queueItem.platformVariants.vk.title || "")) {
              queueItem.platformVariants.vk.title = "Обновление: " + String(queueItem.platformVariants.vk.title || queueItem.title).replace(/^[^\p{L}\p{N}]+/u, "");
            }
          }

          const mergedStory = await tryMergeStoryQueueItem(queueItem);
          if (mergedStory) {
            baseItem.metadata.storyClusterId = mergedStory.storyCluster && mergedStory.storyCluster.id || "";
            baseItem.metadata.storyMergedIntoQueueId = mergedStory.id;
            baseItem.metadata.storySourceCount = mergedStory.storySources && mergedStory.storySources.length || 0;
          } else {
            state.queue.unshift(queueItem);
          }
          baseItem.metadata.storyRelation = {
            relation: storyRelation.relation,
            updateOf: queueItem.storyUpdateOf || "",
            updateTitle: queueItem.storyUpdateTitle || "",
            reason: storyRelation.reason || ""
          };
          pruneQueueItems(state);
          summary.queued += 1;
          noteSourceEvent(source, "useful");
        }

        await saveNewsItem(baseItem);
        saveState();
      } catch (error) {
        noteSourceEvent(source, "error");
        summary.errors.push(url + ": " + error.message);
      }
    }

    const pausedSources = autoPauseWeakSources();
    if (pausedSources.length) summary.pausedSources = pausedSources;
    // Top up sources in the background so the collector run is not delayed.
    replenishSources(pausedSources.length ? "replace_paused" : "below_target").catch(function(error){
      console.warn("SOURCE_REPLENISH_ERROR " + JSON.stringify({ workspace: currentWorkspaceId(), error: error.message }));
    });
    summary.finishedAt = new Date().toISOString();
    lastCollectorRuns.set(currentWorkspaceId(), summary);
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
    lastCollectorRuns.set(currentWorkspaceId(), summary);
    if (db && dbReady && runId) {
      try {
        await db.query("UPDATE collector_runs SET finished_at=NOW(), status='failed', error_text=$2 WHERE id=$1", [runId, error.message]);
      } catch {}
    }
    return summary;
  } finally {
    collectorRunningWorkspaces.delete(collectorWorkspaceId);
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
    return slot && slot.startsWith(dayKey + " ") &&
      item.publicationOrigin !== "blogger-schedule" &&
      item.publicationOrigin !== "russian-ai-schedule";
  }).length;
}
function bloggerDailyPublishedCount(dayKey) {
  return (state.history || []).filter(function(item) {
    const slot = dynamicScheduledHistorySlot(item);
    return slot && slot.startsWith(dayKey + " ") && item.publicationOrigin === "blogger-schedule";
  }).length;
}
function russianAiDailyPublishedCount(dayKey) {
  return (state.history || []).filter(function(item) {
    const slot = dynamicScheduledHistorySlot(item);
    return slot && slot.startsWith(dayKey + " ") && item.publicationOrigin === "russian-ai-schedule";
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

function videoPriorityBonus(item, baseScore) {
  const hasRealVideo = Boolean(item && item.videoUrl);
  const hasEmbeddedVideo = Boolean(item && (item.hasEmbeddedVideo || (item.metadata && item.metadata.hasEmbeddedVideo)));
  if (!hasRealVideo && !hasEmbeddedVideo) return 0;
  const strongEnough = Number(baseScore || 0) >= 55;
  if (hasRealVideo) return strongEnough ? 10 : 4;
  return strongEnough ? 5 : 2;
}

function dynamicItemScore(item) {
  const aiScore = Number(item && item.aiScore);

  if (Number.isFinite(aiScore)) {
    // Order of publication follows the 100-point post rating shown in the admin.
    const base = Math.max(0, Math.min(100, queueItemRating(item)));
    const quality = Number(item && item.qualityScore);
    const qualityBonus = Number.isFinite(quality) ? Math.max(-8, Math.min(8, (quality - AUTO_QUALITY_MIN) * 0.35)) : -4;
    const diversity = editorialDiversityPenalty(item);
    const learning = editorialLearningBonus(item);
    const storyBonus = item && item.storyCluster && Number(item.storyCluster.sourceCount) > 1 ? 4 : 0;
    const updateBonus = item && item.storyUpdateOf ? 2 : 0;
    return Math.max(0, Math.min(100,
      base +
      videoPriorityBonus(item, base) +
      qualityBonus +
      learning.bonus +
      storyBonus +
      updateBonus -
      diversity.penalty
    ));
  }

  const ageMinutes = dynamicItemAgeMs(item) / 60000;
  const fallback = Math.min(74, Math.max(0, 68 - ageMinutes * 0.2));
  const diversity = editorialDiversityPenalty(item);
  const learning = editorialLearningBonus(item);
  return Math.max(0, Math.min(79, fallback + videoPriorityBonus(item, fallback) + learning.bonus - diversity.penalty));
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

function dynamicBestQueueItem(kind) {
  // Posts at or above the rating threshold first; reserve posts only when none is available.
  const best = dynamicBestQueueItemRaw(kind, true);
  return best || dynamicBestQueueItemRaw(kind, false);
}

function dynamicBestQueueItemRaw(kind, onlyAboveThreshold) {
  const used = dynamicUsedQueueIds();
  const maxAge = DYNAMIC_SLOT_MAX_AGE_HOURS * 60 * 60 * 1000;
  const wantsBlogger = kind === "blogger";
  const wantsRussianAi = kind === "russian-ai";
  return (state.queue || [])
    .filter(function(item) {
      if (!(item && item.id && item.newsId && item.status !== "media_failed" && !used.has(item.id) && dynamicItemAgeMs(item) <= maxAge)) return false;
      if (!autoQualityEligible(item)) return false;
      if (onlyAboveThreshold && ratingBelowAutoThreshold(item)) return false;
      if (wantsBlogger) return isBloggerSource(item);
      if (wantsRussianAi) return isRussianAISource(item);
      return !isBloggerSource(item) && !isRussianAISource(item);
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

function dynamicAssignBest(day, time, kind) {
  const item = dynamicBestQueueItem(kind);
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
  item.preparedKind = kind === "blogger" ? "blogger" : (kind === "russian-ai" ? "russian-ai" : "regular");
  item.preparedAt = new Date().toISOString();
  if (!item.sourceSelectedAt) {
    noteSourceEvent(item, "selected");
    item.sourceSelectedAt = item.preparedAt;
  }
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
  await refreshEditorialLearning(false).catch(function(error){ console.warn("Editorial learning refresh failed:", error.message); });
  const item = dynamicAssignBest(day, time);
  return {
    ok: true,
    slot: time,
    collector: collector,
    prepared: item ? item.id : null,
    title: item ? item.title : ""
  };
}

async function prepareBloggerSlot(time) {
  const now = new Date();
  const day = moscowDateKey(now);
  const slotTime = String(time || "");
  if (!BLOGGER_SLOTS.includes(slotTime)) return { ok: true, skipped: "invalid_blogger_slot" };
  if (bloggerDailyPublishedCount(day) >= BLOGGER_DAILY_TARGET) return { ok: true, skipped: "blogger_daily_target" };

  const schedule = ensureScheduleShape(state);
  if (schedule.suppressed[day] && schedule.suppressed[day][slotTime]) return { ok: true, skipped: "suppressed" };

  const collector = await collectOnce("blogger-slot-prep");
  await refreshEditorialLearning(false).catch(function(error){ console.warn("Editorial learning refresh failed:", error.message); });
  const item = dynamicAssignBest(day, slotTime, "blogger");
  state.bloggerScheduler = state.bloggerScheduler || {};
  state.bloggerScheduler.lastPreparedAt = new Date().toISOString();
  saveState();
  return { ok: true, slot: slotTime, collector: collector, prepared: item ? item.id : null, title: item ? item.title : "" };
}

async function prepareRussianAiSlot(time) {
  const now = new Date();
  const day = moscowDateKey(now);
  const slotTime = String(time || "");
  if (!RUSSIAN_AI_SLOTS.includes(slotTime)) return { ok: true, skipped: "invalid_russian_ai_slot" };
  if (russianAiDailyPublishedCount(day) >= RUSSIAN_AI_DAILY_TARGET) return { ok: true, skipped: "russian_ai_daily_target" };

  const schedule = ensureScheduleShape(state);
  if (schedule.suppressed[day] && schedule.suppressed[day][slotTime]) return { ok: true, skipped: "suppressed" };

  const collector = await collectOnce("russian-ai-slot-prep");
  await refreshEditorialLearning(false).catch(function(error){ console.warn("Editorial learning refresh failed:", error.message); });
  const item = dynamicAssignBest(day, slotTime, "russian-ai");
  state.russianAiScheduler = state.russianAiScheduler || {};
  state.russianAiScheduler.lastPreparedAt = new Date().toISOString();
  saveState();
  return { ok: true, slot: slotTime, collector: collector, prepared: item ? item.id : null, title: item ? item.title : "" };
}

async function publishDynamicSlot(kind) {
  const publishKind = kind === "blogger" ? "blogger" : (kind === "russian-ai" ? "russian-ai" : "regular");
  const now = new Date();
  const nowMinutes = moscowMinutes(now);
  const hour = Math.floor(nowMinutes / 60);
  if (hour < DYNAMIC_SLOT_START_HOUR || hour > DYNAMIC_SLOT_END_HOUR) {
    return { ok: true, skipped: "outside_hours" };
  }

  const day = moscowDateKey(now);
  const time = String(hour).padStart(2, "0") + ((publishKind === "blogger" || publishKind === "russian-ai") ? ":30" : ":00");
  if (publishKind === "blogger" && !BLOGGER_SLOTS.includes(time)) return { ok: true, skipped: "not_blogger_slot" };
  if (publishKind === "russian-ai" && !RUSSIAN_AI_SLOTS.includes(time)) return { ok: true, skipped: "not_russian_ai_slot" };
  const slotKey = day + " " + time;
  state.dynamicScheduler = state.dynamicScheduler || {};
  state.bloggerScheduler = state.bloggerScheduler || {};
  state.russianAiScheduler = state.russianAiScheduler || {};
  const schedulerState = publishKind === "blogger"
    ? state.bloggerScheduler
    : (publishKind === "russian-ai" ? state.russianAiScheduler : state.dynamicScheduler);

  if (schedulerState.lastPublishedSlot === slotKey) {
    return { ok: true, skipped: "already_done" };
  }
  if (publishKind === "blogger") {
    if (bloggerDailyPublishedCount(day) >= BLOGGER_DAILY_TARGET) return { ok: true, skipped: "blogger_daily_target" };
  } else if (publishKind === "russian-ai") {
    if (russianAiDailyPublishedCount(day) >= RUSSIAN_AI_DAILY_TARGET) return { ok: true, skipped: "russian_ai_daily_target" };
  } else if (dynamicDailyPublishedCount(day) >= DYNAMIC_DAILY_MAX) {
    return { ok: true, skipped: "daily_max" };
  }

  const schedule = ensureScheduleShape(state);
  let queueId = schedule.assignments[day] && schedule.assignments[day][time];

  if (!queueId) {
    const laneKind = publishKind === "blogger" ? "blogger" : (publishKind === "russian-ai" ? "russian-ai" : undefined);
    let lastChanceItem = dynamicAssignBest(day, time, laneKind);
    if (!lastChanceItem && !isCollectorRunning()) {
      const lastChanceTrigger = publishKind === "blogger"
        ? "blogger-slot-last-chance"
        : (publishKind === "russian-ai" ? "russian-ai-slot-last-chance" : "slot-last-chance");
      await collectOnce(lastChanceTrigger);
      lastChanceItem = dynamicAssignBest(day, time, laneKind);
    }
    queueId = lastChanceItem && lastChanceItem.id || "";
  }

  if (!queueId) {
    schedulerState.lastPublishedSlot = slotKey;
    saveState();
    return { ok: true, skipped: "empty_slot" };
  }

  const item = (state.queue || []).find(function(q){ return q && q.id === queueId; });
  if (!item) {
    delete schedule.assignments[day][time];
    schedulerState.lastPublishedSlot = slotKey;
    saveState();
    return { ok: true, skipped: "missing_item" };
  }

  if (dynamicItemAgeMs(item) > DYNAMIC_SLOT_MAX_AGE_HOURS * 60 * 60 * 1000) {
    delete schedule.assignments[day][time];
    state.queue = (state.queue || []).filter(function(q){ return q.id !== queueId; });
    schedulerState.lastPublishedSlot = slotKey;
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
    schedulerState.lastPublishedSlot = slotKey;
    saveState();
    return { ok: true, skipped: "auto_targets_disabled", slot: time };
  }

  const result = await sendMultiPlatformPost(Object.assign({}, item, {
    postId: item.id,
    topicId: item.topicId || "default",
    allow_text_fallback: allowTextFallbackForPost(item)
  }), targets);
  if (result.safeMedia) Object.assign(item, result.safeMedia);
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
      sourceId: item.sourceId || "",
      sourceName: item.sourceName || "",
      sourceUrl: item.sourceUrl || "",
      sourceUrls: Array.isArray(item.sourceUrls) ? item.sourceUrls : [],
      sources: Array.isArray(item.sources) ? item.sources : [],
      storySources: Array.isArray(item.storySources) ? item.storySources : [],
      storyCluster: item.storyCluster || null,
      imageUrl: item.imageUrl || "",
      originalImageUrl: item.originalImageUrl || item.imageUrl || "",
      generatedImageUrl: item.generatedImageUrl || "",
      videoUrl: item.videoUrl || "",
      mediaPackUrls: Array.isArray(item.mediaPackUrls) ? item.mediaPackUrls : [],
      mediaType: item.mediaType || "",
      mediaStatus: item.mediaStatus || "",
      contentFormat: item.contentFormat || "",
      contentFormatLabel: item.contentFormatLabel || "",
      qualityScore: item.qualityScore == null ? null : Number(item.qualityScore),
      qualityBreakdown: item.qualityBreakdown || null,
      qcStatus: item.qcStatus || "",
      qcIssues: Array.isArray(item.qcIssues) ? item.qcIssues : [],
      topicEntities: normalizeTopicEntities(item.topicEntities),
      platformVariants: item.platformVariants || null,
      sourceRole: item.sourceRole || sourceEditorialRole(item),
      decisionSummary: item.decisionSummary || "",
      decisionExplanation: buildDecisionExplanation(item),
      repairLog: Array.isArray(result.repairLog) ? result.repairLog : [],
      mediaDirector: item.mediaDirector || null,
      storyUpdateOf: item.storyUpdateOf || "",
      storyUpdateTitle: item.storyUpdateTitle || "",
      editorialV2: item.editorialV2 || null,
      publicationOrigin: publishKind === "blogger"
        ? "blogger-schedule"
        : (publishKind === "russian-ai" ? "russian-ai-schedule" : "schedule"),
      scheduledSlot: slotKey
    };
    state.history.unshift(historyItem);
    state.history = state.history.slice(0, 300);
    item.historyId = historyItem.id;
    state.stats.published = Number(state.stats.published || 0) + 1;
    noteSourceEvent(item, "published");
  } else if (historyItem) {
    historyItem.messageId = historyItem.messageId || result.message_id || item.telegramMessageId || null;
    historyItem.vkPostId = result.vkPostId || historyItem.vkPostId || null;
    historyItem.vkStatus = result.vkStatus || item.vkStatus || historyItem.vkStatus || "";
    historyItem.vkError = result.vkError || item.vkError || "";
    historyItem.vkPreviewSlug = result.vkPreviewSlug || historyItem.vkPreviewSlug || "";
    historyItem.vkPreviewUrl = result.vkPreviewUrl || historyItem.vkPreviewUrl || "";
    historyItem.repairLog = (historyItem.repairLog || []).concat(Array.isArray(result.repairLog) ? result.repairLog : []);
    historyItem.qualityScore = item.qualityScore == null ? historyItem.qualityScore : Number(item.qualityScore);
    historyItem.qcStatus = item.qcStatus || historyItem.qcStatus || "";
    historyItem.topicEntities = normalizeTopicEntities(item.topicEntities || historyItem.topicEntities);
    historyItem.platformVariants = item.platformVariants || historyItem.platformVariants || null;
    historyItem.decisionExplanation = buildDecisionExplanation(item);
    historyItem.publicationOrigin = publishKind === "blogger"
      ? "blogger-schedule"
      : (publishKind === "russian-ai" ? "russian-ai-schedule" : "schedule");
    historyItem.scheduledSlot = slotKey;
  }

  delete schedule.assignments[day][time];
  schedulerState.lastPublishedSlot = slotKey;
  schedulerState.lastPublishedAt = publishedAt;

  const mediaFailed = result.vkStatus === "media_failed";
  if (!mediaFailed && (!targets.telegram || item.telegramPublished) && (!targets.vk || item.vkPublished)) {
    state.queue = (state.queue || []).filter(function(q){ return q.id !== queueId; });
  }

  if (db && dbReady && item.newsId) {
    try {
      const dbStatus = mediaFailed ? "media_failed" : "published";
      await db.query(
        "UPDATE news_items SET status=$2, telegram_message_id=COALESCE($3,telegram_message_id), published_at=COALESCE($4,published_at), metadata=COALESCE(metadata,'{}'::jsonb) || $5::jsonb, vk_post_id=COALESCE($6,vk_post_id), vk_status=$7, vk_error_code=$8, vk_error_msg=$9, vk_media_attempts=$10, updated_at=NOW() WHERE id=$1 AND workspace_id=$11",
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
            vkMediaAttempts: result.vkMediaAttempts || item.vkMediaAttempts || 0,
            repairLog: Array.isArray(result.repairLog) ? result.repairLog : [],
            qualityScore: item.qualityScore == null ? null : Number(item.qualityScore),
            qcStatus: item.qcStatus || "",
            topicEntities: normalizeTopicEntities(item.topicEntities),
            sourceRole: item.sourceRole || sourceEditorialRole(item)
          }),
          result.vkPostId || item.vkPostId || null,
          result.vkStatus || item.vkStatus || "",
          result.vkErrorCode == null ? (item.vkErrorCode == null ? null : String(item.vkErrorCode)) : String(result.vkErrorCode),
          result.vkError || item.vkError || "",
          Number(result.vkMediaAttempts || item.vkMediaAttempts || 0),
          currentWorkspaceId()
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
  if (isCollectorRunning()) return;
  const now = new Date();
  const nowMinutes = moscowMinutes(now);
  const hour = Math.floor(nowMinutes / 60);
  const minute = nowMinutes % 60;
  const day = moscowDateKey(now);

  let action = "";
  let bloggerTime = "";
  let russianAiTime = "";
  // Each action has a window of SCHEDULER_SLOT_WINDOW_MINUTES instead of one exact minute:
  // a tick delayed by another channel's work no longer silently loses the slot.
  // lastTickKey (built from the window start, not the actual minute) keeps it idempotent.
  const inWindow = function(start) { return minute >= start && minute < start + SCHEDULER_SLOT_WINDOW_MINUTES; };
  let windowStart = minute;
  if (inWindow(15)) {
    windowStart = 15;
    bloggerTime = String(hour).padStart(2, "0") + ":30";
    russianAiTime = bloggerTime;
    if (BLOGGER_SLOTS.includes(bloggerTime) && (state.sources || []).some(function(source){ return source && source.enabled && source.group === "blogger"; })) {
      action = "blogger_prepare";
    } else if (RUSSIAN_AI_SLOTS.includes(russianAiTime) && (state.sources || []).some(function(source){ return source && source.enabled && isRussianAISource(source); })) {
      action = "russian_ai_prepare";
    }
  }
  if (!action && inWindow(30)) {
    windowStart = 30;
    bloggerTime = String(hour).padStart(2, "0") + ":30";
    russianAiTime = bloggerTime;
    if (BLOGGER_SLOTS.includes(bloggerTime) && (state.sources || []).some(function(source){ return source && source.enabled && source.group === "blogger"; })) {
      action = "blogger_publish";
    } else if (RUSSIAN_AI_SLOTS.includes(russianAiTime) && (state.sources || []).some(function(source){ return source && source.enabled && isRussianAISource(source); })) {
      action = "russian_ai_publish";
    }
  }
  if (!action && inWindow(DYNAMIC_SLOT_PREP_MINUTE) && hour >= DYNAMIC_SLOT_START_HOUR - 1 && hour < DYNAMIC_SLOT_END_HOUR) {
    action = "prepare";
    windowStart = DYNAMIC_SLOT_PREP_MINUTE;
  } else if (!action && inWindow(0) && hour >= DYNAMIC_SLOT_START_HOUR && hour <= DYNAMIC_SLOT_END_HOUR) {
    action = "publish";
    windowStart = 0;
  }
  if (!action) return;
  if (action.startsWith("blogger_") && !(state.sources || []).some(function(source){ return source && source.enabled && source.group === "blogger"; })) return;
  if (action.startsWith("russian_ai_") && !(state.sources || []).some(function(source){ return source && source.enabled && isRussianAISource(source); })) return;

  state.dynamicScheduler = state.dynamicScheduler || {};
  const key = day + "-" + String(hour).padStart(2, "0") + ":" + String(windowStart).padStart(2, "0") + "-" + action;
  if (state.dynamicScheduler.lastTickKey === key) return;
  state.dynamicScheduler.lastTickKey = key;
  saveState();

  try {
    const result = action === "prepare"
      ? await prepareDynamicSlot()
      : action === "publish"
        ? await publishDynamicSlot()
        : action === "blogger_prepare"
          ? await prepareBloggerSlot(bloggerTime)
          : action === "blogger_publish"
            ? await publishDynamicSlot("blogger")
            : action === "russian_ai_prepare"
              ? await prepareRussianAiSlot(russianAiTime)
              : await publishDynamicSlot("russian-ai");
    console.log("Dynamic scheduler " + action + ":", JSON.stringify(result));
  } catch (error) {
    console.error("Dynamic scheduler " + action + " failed:", error.message);
  }
}

async function dynamicSchedulerTickAllWorkspaces() {
  // Channels tick in parallel, each in its own workspace context; a channel whose
  // previous tick is still running (long collection) is skipped until it finishes.
  await Promise.all(workspaceStore.workspaces.map(async function(ws) {
    if (!ws || schedulerTickRunning.has(ws.id)) return;
    schedulerTickRunning.add(ws.id);
    try {
      await workspaceContext.run({ workspaceId: ws.id }, async function(){ await dynamicSchedulerTick(); });
    } catch (error) {
      console.error("Dynamic scheduler workspace " + ws.id + " failed:", error.message);
    } finally {
      schedulerTickRunning.delete(ws.id);
    }
  }));
}
function startCollectorScheduler() {
  if (!COLLECTOR_ENABLED || collectorTimer) return;
  collectorTimer = setInterval(function() {
    dynamicSchedulerTickAllWorkspaces().catch(function(error){ console.error("Dynamic scheduler tick failed:", error.message); });
  }, 30000);
  dynamicSchedulerTickAllWorkspaces().catch(function(error){ console.error("Dynamic scheduler startup failed:", error.message); });
  console.log("Dynamic scheduler: regular hourly + autoblogger slots + Russian AI slots 09:30/11:30/13:30/16:30/19:30/22:30 Moscow");
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

async function readJson(req, maxBytes) {
  let body = "";
  const limit = Math.max(1024, Number(maxBytes || 1024 * 1024));
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body, "utf8") > limit) throw new Error("request too large");
  }
  if (!body) return {};
  return JSON.parse(body);
}

async function saveWorkspaceAvatar(workspace, dataUrl) {
  if (!workspace) throw new Error("Кабинет не найден");
  const raw = String(dataUrl || "").trim();
  const match = raw.match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error("Поддерживаются JPG, PNG и WEBP");
  const input = Buffer.from(match[2], "base64");
  if (!input.length) throw new Error("Файл изображения пустой");
  if (input.length > 8 * 1024 * 1024) throw new Error("Фото должно быть не больше 8 МБ");

  const output = await sharp(input, { limitInputPixels: 50 * 1000 * 1000 })
    .rotate()
    .resize(512, 512, { fit: "cover", position: "centre" })
    .webp({ quality: 90 })
    .toBuffer();

  ensureDataDir();
  const safeId = String(workspace.id || "account").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  const fileName = "avatar_" + safeId + "_" + Date.now() + ".webp";
  fs.writeFileSync(path.join(MEDIA_DIR, fileName), output);

  if (workspace.avatarFile && workspace.avatarFile !== fileName) {
    try {
      const oldFile = path.basename(String(workspace.avatarFile));
      if (oldFile.startsWith("avatar_")) fs.unlinkSync(path.join(MEDIA_DIR, oldFile));
    } catch {}
  }

  workspace.avatarFile = fileName;
  workspace.avatarUrl = mediaPublicUrl(fileName);
  workspace.updatedAt = new Date().toISOString();
  persistWorkspaceStore();
  return workspace.avatarUrl;
}

function removeWorkspaceAvatar(workspace) {
  if (!workspace) throw new Error("Кабинет не найден");
  if (workspace.avatarFile) {
    try {
      const fileName = path.basename(String(workspace.avatarFile));
      if (fileName.startsWith("avatar_")) fs.unlinkSync(path.join(MEDIA_DIR, fileName));
    } catch {}
  }
  workspace.avatarFile = "";
  workspace.avatarUrl = "";
  workspace.updatedAt = new Date().toISOString();
  persistWorkspaceStore();
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
  const sources = normalizePublicPostSources(post).slice(0, 5);
  let html = "";
  if (title) html += "<b>" + escapeTelegramHtml(title) + "</b>";
  if (text) html += (html ? "\n\n" : "") + formatTelegramBody(text);
  if (sources.length === 1) {
    html += (html ? "\n\n" : "") + '🔗 <a href="' + escapeTelegramAttr(sources[0].url) + '">Источник</a>';
  } else if (sources.length > 1) {
    const links = sources.map(function(source, index) {
      const label = String(source.name || "").trim() && !/^https?:/i.test(String(source.name || ""))
        ? String(source.name).trim()
        : ("Источник " + (index + 1));
      return '<a href="' + escapeTelegramAttr(source.url) + '">' + escapeTelegramHtml(label) + '</a>';
    });
    html += (html ? "\n\n" : "") + "🔗 Источники: " + links.join(" · ");
  }
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
  const channelName = String(currentWorkspace().name || "News Factory");
  if (formatTelegramPost(original).length <= 900) return original;

  if (OPENAI_API_KEY) {
    const prompt = [
      "Сожми готовый новостной пост канала «" + channelName + "» так, чтобы он целиком поместился в подпись к одному фото/видео Telegram.",
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
        recordOpenAIResponseUsage(model, "telegram_caption_compact", data, "responses");
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
    vk: (hasExplicit ? requested.vk === true : true) && workspaceVkPublishingAllowed(currentWorkspace())
  };
}

async function telegramApi(method, payload) {
  if (!BOT_TOKEN) throw new Error("Telegram bot token is not configured");
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

function telegramUploadMeta(rawUrl, fallbackKind) {
  const value = String(rawUrl || "").trim();
  let ext = fallbackKind === "video" ? "mp4" : "jpg";
  try {
    const u = new URL(value, PUBLIC_BASE_URL);
    const guessed = path.extname(u.pathname).replace(/^\./, "").toLowerCase();
    if (guessed) ext = guessed;
  } catch {}
  let mime = fallbackKind === "video" ? "video/mp4" : "image/jpeg";
  if (ext === "png") mime = "image/png";
  else if (ext === "webp") mime = "image/webp";
  else if (ext === "gif") mime = "image/gif";
  else if (ext === "webm") mime = "video/webm";
  else if (ext === "mov") mime = "video/quicktime";
  else if (ext === "m4v") mime = "video/x-m4v";
  return { ext: ext || (fallbackKind === "video" ? "mp4" : "jpg"), mime: mime };
}

async function loadTelegramUpload(rawUrl, kind) {
  const sourceUrl = String(rawUrl || "").trim();
  if (!sourceUrl) throw new Error("Telegram media URL is empty");
  const meta = telegramUploadMeta(sourceUrl, kind);
  const localPath = localMediaPathFromUrl(sourceUrl);
  let bytes;
  let mime = meta.mime;
  let ext = meta.ext;

  if (localPath) {
    bytes = fs.readFileSync(localPath);
  } else {
    const absolute = sourceUrl.startsWith("/") ? PUBLIC_BASE_URL + sourceUrl : sourceUrl;
    const response = await fetch(absolute, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; NewsFactoryTelegram/1.0)",
        "accept": kind === "video" ? "video/*,*/*;q=0.8" : "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error("Telegram media download HTTP " + response.status);
    mime = String(response.headers.get("content-type") || mime).split(";")[0].trim() || mime;
    bytes = Buffer.from(await response.arrayBuffer());
  }

  if (!bytes || !bytes.length) throw new Error("Telegram media is empty");
  if (kind === "video") {
    if (bytes.length > 49 * 1024 * 1024) throw new Error("Видео больше лимита Telegram Bot API");
  } else {
    if (bytes.length > 9 * 1024 * 1024 || !/^image\/(jpeg|png|webp|gif)$/i.test(mime)) {
      bytes = await sharp(bytes, { limitInputPixels: 80 * 1000 * 1000 })
        .rotate()
        .resize(1800, 1800, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer();
      mime = "image/jpeg";
      ext = "jpg";
    }
  }
  return { bytes: bytes, mime: mime, ext: ext };
}

async function telegramMultipartApi(method, payload, fieldName, mediaUrl, kind) {
  if (!BOT_TOKEN) throw new Error("Telegram bot token is not configured");
  const media = await loadTelegramUpload(mediaUrl, kind);
  const endpoint = "https://api.telegram.org/bot" + BOT_TOKEN + "/" + method;
  const form = new FormData();
  Object.entries(payload || {}).forEach(function(entry) {
    const key = entry[0], value = entry[1];
    if (value === undefined || value === null || value === "") return;
    form.append(key, typeof value === "boolean" ? (value ? "true" : "false") : String(value));
  });
  form.append(fieldName, new Blob([media.bytes], { type: media.mime }), "news." + media.ext);
  const response = await fetch(endpoint, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(kind === "video" ? 60000 : 45000)
  });
  const data = await response.json().catch(function(){ return {}; });
  if (!response.ok || !data.ok) throw new Error((data && data.description) || ("Telegram multipart HTTP " + response.status));
  return data.result;
}

async function telegramMediaApi(method, payload, fieldName, mediaUrl, kind) {
  try {
    return await telegramApi(method, Object.assign({}, payload, { [fieldName]: mediaUrl }));
  } catch (urlError) {
    console.warn(method + " URL mode failed, retrying upload:", urlError.message);
    return telegramMultipartApi(method, payload, fieldName, mediaUrl, kind);
  }
}

async function sendTelegramPost(post) {
  const telegramChannel = currentTelegramChannel();
  if (!telegramChannel) throw new Error("Telegram channel is not configured for this account");
  const html = formatTelegramPost(post);
  const mediaPackUrls = Array.from(new Set((Array.isArray(post.mediaPackUrls) ? post.mediaPackUrls : [])
    .map(function(url){ return String(url || "").trim(); })
    .filter(function(url){ return /^https?:\/\//i.test(url); }))).slice(0, 10);
  let imageUrl = String(post.imageUrl || post.generatedImageUrl || mediaPackUrls[0] || "").trim();
  const videoUrl = String(post.videoUrl || "").trim();

  if (mediaPackUrls.length > 1 && !videoUrl) {
    try {
      const album = mediaPackUrls.map(function(url, index) {
        const item = { type: "photo", media: url };
        if (index === 0) {
          item.caption = html;
          item.parse_mode = "HTML";
        }
        return item;
      });
      const messages = await telegramApi("sendMediaGroup", {
        chat_id: telegramChannel,
        media: album
      });
      if (Array.isArray(messages) && messages.length) {
        const first = messages[0];
        first.media_group_message_ids = messages.map(function(message){ return message.message_id; });
        return first;
      }
    } catch (error) {
      console.warn("sendMediaGroup failed, falling back to one image:", error.message);
      imageUrl = mediaPackUrls[0] || imageUrl;
    }
  }

  if (MEDIA_REQUIRED && !imageUrl && !videoUrl) {
    throw new Error("Публикация запрещена: у новости нет фото или видео");
  }

  if (videoUrl) {
    try {
      return await telegramMediaApi("sendVideo", {
        chat_id: telegramChannel,
        caption: html.length <= 1000 ? html : (post.title ? "<b>" + escapeTelegramHtml(post.title) + "</b>" : undefined),
        parse_mode: "HTML",
        supports_streaming: true
      }, "video", videoUrl, "video");
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

  imageUrl = String(post.imageUrl || post.generatedImageUrl || "").trim();

  if (imageUrl && html.length <= 950) {
    try {
      return await telegramMediaApi("sendPhoto", {
        chat_id: telegramChannel,
        caption: html,
        parse_mode: "HTML"
      }, "photo", imageUrl, "image");
    } catch (error) {
      console.warn("sendPhoto failed:", error.message);
      if (GENERATE_COVER_IF_MISSING) {
        try {
          const generatedFallback = await generateNewsCover({
            id: post.id || newId("telegram_photo_fallback"),
            title: post.title || currentWorkspace().name || "News Factory",
            text: post.text || "",
            sourceName: post.sourceName || "Telegram fallback"
          });
          post.generatedImageUrl = generatedFallback.url;
          imageUrl = generatedFallback.url;
          return await telegramMediaApi("sendPhoto", {
            chat_id: telegramChannel,
            caption: html,
            parse_mode: "HTML"
          }, "photo", imageUrl, "image");
        } catch (fallbackError) {
          console.warn("Telegram generated photo fallback failed:", fallbackError.message);
          if (MEDIA_REQUIRED) throw fallbackError;
        }
      } else if (MEDIA_REQUIRED) {
        throw error;
      }
    }
  }

  if (imageUrl) {
    let photo;
    try {
      photo = await telegramMediaApi("sendPhoto", {
        chat_id: telegramChannel,
        caption: post.title ? "<b>" + escapeTelegramHtml(post.title) + "</b>" : undefined,
        parse_mode: "HTML"
      }, "photo", imageUrl, "image");
    } catch (error) {
      console.warn("sendPhoto long-caption media failed:", error.message);
      if (!GENERATE_COVER_IF_MISSING) throw error;
      const generatedFallback = await generateNewsCover({
        id: post.id || newId("telegram_photo_fallback"),
        title: post.title || currentWorkspace().name || "News Factory",
        text: post.text || "",
        sourceName: post.sourceName || "Telegram fallback"
      });
      post.generatedImageUrl = generatedFallback.url;
      imageUrl = generatedFallback.url;
      photo = await telegramMediaApi("sendPhoto", {
        chat_id: telegramChannel,
        caption: post.title ? "<b>" + escapeTelegramHtml(post.title) + "</b>" : undefined,
        parse_mode: "HTML"
      }, "photo", imageUrl, "image");
    }
    if (html && html.length > 950) {
      await telegramApi("sendMessage", {
        chat_id: telegramChannel,
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
  const telegramChannel = currentTelegramChannel();
  if (!telegramChannel) throw new Error("Telegram channel is not configured for this account");
  return telegramApi("sendMessage", {
    chat_id: telegramChannel,
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
  const sources = normalizePublicPostSources(post).slice(0, 5);
  if (opts.includeSource !== false && sources.length === 1) {
    out += (out ? "\n\n" : "") + "Источник: " + sources[0].url;
  } else if (opts.includeSource !== false && sources.length > 1) {
    out += (out ? "\n\n" : "") + "Источники:\n" + sources.map(function(source) {
      const name = String(source.name || "Источник").replace(/https?:\/\/\S+/g, "").trim() || "Источник";
      return "• " + name + " — " + source.url;
    }).join("\n");
  }
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
    vk: topic.auto_publish_vk !== false && workspaceVkPublishingAllowed(currentWorkspace())
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
  const baseMessage = formatVkPost(post, { includeSource: true });

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


function postForPlatform(post, platform) {
  const out = Object.assign({}, post || {});
  const variants = out.platformVariants && typeof out.platformVariants === "object" ? out.platformVariants : {};
  const variant = variants[platform] && typeof variants[platform] === "object" ? variants[platform] : null;
  if (variant) {
    if (String(variant.title || "").trim()) out.title = String(variant.title).trim();
    if (String(variant.text || "").trim()) out.text = String(variant.text).trim();
  }
  out.platformVariant = platform;
  return out;
}

function publishErrorLooksRepairable(error) {
  const text = String(error && (error.vkErrorMsg || error.message) || error || "").toLowerCase();
  return /media|photo|video|image|file|upload|caption|too long|400|413|preview|размер|фото|видео|медиа/.test(text);
}

async function repairPostForPublishing(post, platform, error, attempt) {
  const out = Object.assign({}, post || {});
  out.repairLog = Array.isArray(out.repairLog) ? out.repairLog.slice() : [];
  const reason = String(error && (error.vkErrorMsg || error.message) || error || "").slice(0, 280);
  const action = [];

  if (Array.isArray(out.mediaPackUrls) && out.mediaPackUrls.length > 1) {
    out.mediaPackUrls = out.mediaPackUrls.slice(0, 1);
    action.push("album→single");
  }

  if (out.videoUrl && publishErrorLooksRepairable(error)) {
    out.originalVideoUrl = out.originalVideoUrl || out.videoUrl;
    out.videoUrl = "";
    action.push("video→image");
  }

  if (out.originalImageUrl && (!out.imageUrl || !isLocalMediaUrl(out.imageUrl))) {
    try {
      const prepared = await prepareReusableSourceImage(out.originalImageUrl, String(out.newsId || out.postId || out.id || "repair") + "_" + platform);
      if (prepared.imageUrl) {
        out.imageUrl = prepared.imageUrl;
        action.push("cache-source-photo");
      }
    } catch {}
  }

  if (!out.imageUrl && out.generatedImageUrl) {
    out.imageUrl = out.generatedImageUrl;
    action.push("generated→primary");
  }

  if (!out.imageUrl && !out.videoUrl && GENERATE_COVER_IF_MISSING) {
    try {
      const generated = await generateNewsCover({
        id: String(out.newsId || out.postId || out.id || newId("repair")) + "_" + platform + "_" + attempt,
        title: out.title || currentWorkspace().name,
        text: out.text || "",
        sourceName: out.sourceName || ""
      });
      out.generatedImageUrl = generated.url;
      out.imageUrl = generated.url;
      out.mediaType = "generated";
      out.mediaStatus = "generated";
      out.mediaOrigin = "ai_generated";
      action.push("generate-fallback");
    } catch (generateError) {
      action.push("fallback-failed");
    }
  }

  out.repairLog.push({
    platform: platform,
    attempt: attempt,
    reason: reason,
    action: action.join(", ") || "retry"
  });
  return out;
}

async function sendTelegramPostWithRepair(post) {
  let candidate = Object.assign({}, post);
  const repairLog = [];
  for (let attempt = 1; attempt <= PUBLISH_REPAIR_MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await sendTelegramPost(candidate);
      return { result: result, post: candidate, repairLog: repairLog.concat(candidate.repairLog || []) };
    } catch (error) {
      if (attempt >= PUBLISH_REPAIR_MAX_ATTEMPTS || !publishErrorLooksRepairable(error)) throw error;
      candidate = await repairPostForPublishing(candidate, "telegram", error, attempt + 1);
      repairLog.push.apply(repairLog, candidate.repairLog || []);
      candidate.repairLog = [];
    }
  }
  throw new Error("Telegram repair loop exhausted");
}

async function publishVkPostWithRepair(post) {
  let candidate = Object.assign({}, post);
  const repairLog = [];
  let lastError = null;
  for (let attempt = 1; attempt <= PUBLISH_REPAIR_MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await publishVkPost(candidate);
      return { result: result, post: candidate, repairLog: repairLog.concat(candidate.repairLog || []) };
    } catch (error) {
      lastError = error;
      if (attempt >= PUBLISH_REPAIR_MAX_ATTEMPTS || !publishErrorLooksRepairable(error)) throw error;
      candidate = await repairPostForPublishing(candidate, "vk", error, attempt + 1);
      repairLog.push.apply(repairLog, candidate.repairLog || []);
      candidate.repairLog = [];
    }
  }
  throw lastError || new Error("VK repair loop exhausted");
}

async function sendMultiPlatformPost(post, targets) {
  const selected = normalizePublishTargets(targets);
  if (!selected.telegram && !selected.vk) throw new Error("Выберите хотя бы одну соцсеть");

  const safeBase = await enforceCopyrightSafeMedia(post);
  let telegramPrepared = postForPlatform(safeBase, "telegram");
  let vkPrepared = postForPlatform(safeBase, "vk");
  if (selected.telegram) telegramPrepared = await preparePostForSingleTelegramCaption(telegramPrepared);

  const result = {
    message_id: null,
    vkPostId: null,
    telegramPublished: false,
    vkPublished: false,
    vkStatus: selected.vk ? "pending" : "not_selected",
    vkMediaAttempts: 0,
    publishedText: selected.telegram ? (telegramPrepared.text || "") : (vkPrepared.text || ""),
    publishedTitle: selected.telegram ? (telegramPrepared.title || "") : (vkPrepared.title || ""),
    publishedTelegramText: telegramPrepared.text || "",
    publishedTelegramTitle: telegramPrepared.title || "",
    publishedVkText: vkPrepared.text || "",
    publishedVkTitle: vkPrepared.title || "",
    repairLog: [],
    safeMedia: {
      imageUrl: safeBase.imageUrl || "",
      originalImageUrl: safeBase.originalImageUrl || "",
      originalVideoUrl: safeBase.originalVideoUrl || "",
      generatedImageUrl: safeBase.generatedImageUrl || "",
      videoUrl: safeBase.videoUrl || "",
      mediaPackUrls: Array.isArray(safeBase.mediaPackUrls) ? safeBase.mediaPackUrls.slice(0, 10) : [],
      mediaType: safeBase.mediaType || "",
      mediaStatus: safeBase.mediaStatus || "",
      mediaLicense: safeBase.mediaLicense || "unknown",
      mediaOrigin: safeBase.mediaOrigin || "",
      copyrightSafe: COPYRIGHT_SAFE_MODE,
      copyrightMediaMode: COPYRIGHT_MEDIA_MODE,
      copyrightPolicyVersion: "v2",
      copyrightMediaDecision: safeBase.copyrightMediaDecision || ""
    }
  };

  if (selected.telegram) {
    const tgAttempt = await sendTelegramPostWithRepair(telegramPrepared);
    const tg = tgAttempt.result;
    telegramPrepared = tgAttempt.post;
    result.message_id = tg.message_id;
    result.telegramPublished = true;
    result.repairLog.push.apply(result.repairLog, tgAttempt.repairLog || []);
    result.publishedText = telegramPrepared.text || result.publishedText;
    result.publishedTitle = telegramPrepared.title || result.publishedTitle;
    result.publishedTelegramText = telegramPrepared.text || "";
    result.publishedTelegramTitle = telegramPrepared.title || "";
  }

  if (selected.vk) {
    if (!VK_PUBLISH_ENABLED || !VK_ACCESS_TOKEN || !VK_GROUP_ID || !VK_OWNER_ID) {
      result.vkStatus = "failed";
      result.vkError = "VK не настроен для публикации";
    } else {
      try {
        const vkAttempt = await publishVkPostWithRepair(vkPrepared);
        const vk = vkAttempt.result;
        vkPrepared = vkAttempt.post;
        result.repairLog.push.apply(result.repairLog, vkAttempt.repairLog || []);
        result.publishedVkText = vkPrepared.text || "";
        result.publishedVkTitle = vkPrepared.title || "";
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


const statusCache = new Map();
const analyticsCache = new Map();
let anthropicProbeCache = { at: 0, value: null };

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
  const telegramPublicUsername = currentTelegramPublicUsername();
  if (!telegramPublicUsername) {
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
    let url = "https://t.me/s/" + encodeURIComponent(telegramPublicUsername);
    if (before) url += "?before=" + encodeURIComponent(before);
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; NewsFactoryAnalytics/1.0; +https://t.me/" + telegramPublicUsername + ")",
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
        url: "https://t.me/" + telegramPublicUsername + "/" + p.messageId
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
    channel: "@" + telegramPublicUsername,
    channelUrl: "https://t.me/" + telegramPublicUsername,
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
  const cacheKey = currentWorkspaceId();
  const cached = analyticsCache.get(cacheKey);
  if (!force && cached && cached.value && now - cached.at < 5 * 60 * 1000) return cached.value;
  const telegram = await fetchTelegramAnalytics(force);
  const vk = await fetchVkAnalytics();
  const value = {
    ok: true,
    generatedAt: new Date().toISOString(),
    telegram: telegram,
    vk: vk
  };
  analyticsCache.set(cacheKey, { at: now, value: value });
  return value;
}



function addLearningSample(map, key, value) {
  const k = String(key || "").trim().toLowerCase();
  if (!k || !Number.isFinite(Number(value))) return;
  if (!map[k]) map[k] = { samples: 0, performance: 0 };
  const bucket = map[k];
  const samples = Number(bucket.samples || 0);
  const next = Math.max(-10, Math.min(10, Number(value)));
  bucket.performance = Number(((Number(bucket.performance || 0) * samples + next) / (samples + 1)).toFixed(2));
  bucket.samples = samples + 1;
}

async function refreshEditorialLearning(force) {
  if (!EDITORIAL_LEARNING_ENABLED) return { ok: false, skipped: "disabled" };
  state.editorialLearning = state.editorialLearning && typeof state.editorialLearning === "object"
    ? state.editorialLearning
    : { updatedAt: "", sampleSize: 0, byFormat: {}, bySource: {}, byTopic: {} };

  const previous = new Date(state.editorialLearning.updatedAt || 0).getTime();
  if (!force && previous && Date.now() - previous < EDITORIAL_LEARNING_REFRESH_MINUTES * 60 * 1000) {
    return { ok: true, skipped: "fresh", sampleSize: state.editorialLearning.sampleSize || 0 };
  }

  let analytics;
  try {
    analytics = await buildPlatformAnalytics(Boolean(force));
  } catch (error) {
    return { ok: false, error: error.message };
  }

  const tgPosts = new Map(((analytics.telegram && analytics.telegram.posts) || []).map(function(post){ return [Number(post.messageId), post]; }));
  const vkPosts = new Map(((analytics.vk && analytics.vk.posts) || []).map(function(post){ return [Number(post.postId), post]; }));
  const tgAvgViews = Math.max(1, Number(analytics.telegram && analytics.telegram.totals && analytics.telegram.totals.avgViews || 0));
  const vkAvgViews = Math.max(1, Number(analytics.vk && analytics.vk.totals && analytics.vk.totals.avgViews || 0));
  const byFormat = {};
  const bySource = {};
  const byTopic = {};
  const byHook = {};
  const byHour = {};
  let samples = 0;

  for (const h of (state.history || []).slice(0, 120)) {
    if (!h) continue;
    const values = [];
    const tg = tgPosts.get(Number(h.messageId));
    if (tg && Number(tg.views || 0) > 0) {
      h.views = Number(tg.views || 0);
      h.reactions = Number(tg.reactions || 0);
      const viewRatio = Number(tg.views || 0) / tgAvgViews;
      const interactionRate = Number(tg.views || 0) > 0 ? (Number(tg.reactions || 0) + Number(tg.comments || 0)) / Number(tg.views || 1) : 0;
      values.push(Math.max(-10, Math.min(10, (viewRatio - 1) * 5 + interactionRate * 120)));
    }
    const vk = vkPosts.get(Number(h.vkPostId));
    if (vk && Number(vk.views || 0) > 0) {
      const viewRatio = Number(vk.views || 0) / vkAvgViews;
      const interactionRate = (Number(vk.likes || 0) + Number(vk.comments || 0) + Number(vk.reposts || 0)) / Number(vk.views || 1);
      values.push(Math.max(-10, Math.min(10, (viewRatio - 1) * 5 + interactionRate * 100)));
    }
    if (!values.length) continue;
    const performance = values.reduce(function(sum,v){ return sum + v; }, 0) / values.length;
    h.performanceScore = Number(performance.toFixed(2));
    addLearningSample(byFormat, historyFormat(h), performance);
    if (historyHook(h)) addLearningSample(byHook, historyHook(h), performance);
    if (h.publishedAt && !isDigestHistory(h)) addLearningSample(byHour, String(moscowParts(h.publishedAt).hour), performance);
    addLearningSample(bySource, h.sourceName, performance);
    normalizeTopicEntities(h.topicEntities).forEach(function(entity){ addLearningSample(byTopic, entity, performance); });
    samples += 1;
  }

  state.editorialLearning = {
    updatedAt: new Date().toISOString(),
    sampleSize: samples,
    byFormat: byFormat,
    bySource: bySource,
    byTopic: byTopic,
    byHook: byHook,
    byHour: byHour,
    avgViews: tgAvgViews > 1 ? tgAvgViews : 0
  };
  saveState();
  console.log("EDITORIAL_LEARNING " + JSON.stringify({ workspace: currentWorkspaceId(), samples: samples, avgViews: Math.round(tgAvgViews), formats: bucketWeights(byFormat, 3), hooks: bucketWeights(byHook, 3), bestHours: bestHours(byHour, 3).slice(0, 3).map(function(x){ return x.hour; }) }));
  return { ok: true, sampleSize: samples };
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


async function anthropicEditorialProbe(force) {
  if (!ANTHROPIC_API_KEY) return { ok: false, error: "ANTHROPIC_API_KEY не задан" };
  const now = Date.now();
  if (!force && anthropicProbeCache.value && now - anthropicProbeCache.at < 10 * 60 * 1000) {
    return anthropicProbeCache.value;
  }
  try {
    const clients = createModelClients({
      anthropicApiKey: ANTHROPIC_API_KEY,
      anthropicModel: ANTHROPIC_MODEL,
      timeoutMs: 30000,
      onUsage: recordCostUsage
    });
    const result = await clients.callAnthropic(
      [
        "Ты технический health-check редакционного корректора.",
        "Верни verdict=pass, пустой errors, checked_claims=1 и короткий summary.",
        "Не добавляй никаких других данных."
      ].join("\n"),
      JSON.stringify({
        role: "checker",
        channel_id: "health",
        post: { title: "Проверка подключения", tg_text: "Служебная проверка.", vk_text: "Служебная проверка.", cover: null, format: "health", legal_flags: [], has_photo: false },
        sources: [{ name: "health", url: "https://example.com", date: new Date().toISOString(), role: "technical", title: "Проверка", text: "Служебная проверка API." }],
        registry: { banned_orgs: [], foreign_agents: [] }
      }),
      { maxTokens: 250, purpose: "editorial_health" }
    );
    const parsed = result && result.parsed || {};
    const ok = ["pass", "fix", "reject"].includes(String(parsed.verdict || "").toLowerCase()) && Array.isArray(parsed.errors);
    const value = ok
      ? { ok: true, model: result.model || ANTHROPIC_MODEL, structured: result.structured !== false }
      : { ok: false, error: "Claude вернул ответ вне схемы" };
    anthropicProbeCache = { at: now, value };
    return value;
  } catch (error) {
    const value = { ok: false, error: String(error && error.message || error) };
    anthropicProbeCache = { at: now, value };
    return value;
  }
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

function parseLooseRewriteOutput(output) {
  const cleaned = String(output || "")
    .replace(/^\s*```json\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  if (!cleaned) return null;
  try { return JSON.parse(cleaned); } catch {}

  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch {}
  }

  const extractJsonString = function(key) {
    const re = new RegExp('"' + key + '"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"', "i");
    const m = cleaned.match(re);
    if (!m) return "";
    try { return JSON.parse('"' + m[1] + '"'); } catch { return m[1].replace(/\\n/g, "\n").replace(/\\\"/g, '"'); }
  };
  const text = extractJsonString("text");
  if (!text) return null;
  return {
    title: extractJsonString("title"),
    text: text,
    confidence: extractJsonString("confidence") || "medium",
    notes: extractJsonString("notes"),
    score_reason: extractJsonString("score_reason")
  };
}

async function callOpenAIRewrite(payload) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY не настроен");
  const sourceText = String(payload.text || "").trim();
  if (!sourceText) throw new Error("Нужен исходный текст новости");
  const title = String(payload.title || "").trim();
  const sourceUrl = String(payload.sourceUrl || "").trim();
  const sourceName = String(payload.sourceName || "").trim();
  const sourceGroup = String(payload.sourceGroup || "").trim();
  const channelName = String(currentWorkspace().name || "News Factory");
  const editorialFormat = selectEditorialFormat({ title: title, text: sourceText, sourceName: sourceName, sourceGroup: sourceGroup });
  const prompt = [
    "Ты редактор Telegram-канала «" + channelName + "».",
    "Твоя задача — не просто пересказать новость, а сделать живой фирменный Telegram-пост: человечный, быстрый, умный и узнаваемый.",
    "",
    "ГЛАВНОЕ:",
    "- используй только факты из исходного текста;",
    "- ничего не придумывай: даты, цены, характеристики, цитаты, сравнения и цифры нельзя добавлять от себя;",
    "- если факт не подтверждён исходником — не используй его;",
    sourceGroup === "blogger"
      ? "- это материал автоблогера «" + sourceName + "»: его личные оценки, предположения и впечатления обязательно атрибутируй автору и не выдавай за установленный факт;"
      : sourceGroup === "creator"
        ? "- это авторский источник «" + sourceName + "»: личные оценки и предположения обязательно атрибутируй автору и не выдавай за установленный факт;"
        : "- отделяй факты от оценок и предположений источника;",
    sourceGroup === "blogger"
      ? "- если блогер показывает собственный автомобиль, эксперимент, покупку или тест — прямо укажи, что это произошло у автора/в его проекте;"
      : sourceGroup === "creator"
        ? "- если автор делится собственным опытом, мнением или экспериментом — прямо укажи, что это позиция автора;"
        : "- сохраняй нейтральную атрибуцию источника там, где это важно;",
    "- COPYRIGHT SAFE: извлекай факты, но пиши текст заново с собственной структурой, порядком предложений и формулировками;",
    "- не делай близкий рерайт абзац-в-абзац и не сохраняй синтаксис исходника;",
    "- не копируй формулировки источника дословно; прямые цитаты используй только когда без них теряется смысл, максимум 8 слов подряд, с явной атрибуцией автору;",
    "- заголовок тоже формулируй самостоятельно, если это не официальное название продукта/события;",
    "- не копируй стиль конкурентов один в один: у канала «" + channelName + "» должен быть собственный голос;",
    "- для политических, трагических, медицинских и других чувствительных тем — нейтрально, без шуток и оценочных призывов;",
    "",
    "ГОЛОС КАНАЛА «" + channelName + "»:",
    "- живой русский язык, как будто умный человек рассказал важную новость другу;",
    "- меньше канцелярита и фраз вроде «компания сообщила», если можно сказать проще;",
    "- допускается лёгкая ирония или короткая шутка по теме канала, но только если тема реально подходит;",
    "- юмор не должен искажать факт и не должен быть в каждом посте;",
    "- можно использовать 2–4 уместных emoji на весь пост, а не украшать каждую строку;",
    "- иногда можно закончить коротким вопросом аудитории или реакцией в духе «Как вам такой расклад?»;",
    "",
    "ФОРМАТ ЭТОГО КОНКРЕТНОГО ПОСТА: " + editorialFormat.label + ".",
    editorialFormat.instruction,
    "- Не повторяй привычный шаблон соседних постов. Варьируй длину абзацев, тип хука, расположение акцента и наличие вопроса в финале.",
    "- Хук должен обещать ровно ту ценность, которую даёт пост: никаких ложных интриг, сенсационности и кликбейта.",
    "- Перед финальным ответом мысленно придумай минимум 3 разных хука (факт, вопрос, следствие/контраст) и выбери самый точный для этой новости; варианты в ответ не выводи.",
    "- Если финальный вопрос не добавляет смысла, закончи сильным фактом или коротким выводом — вопрос не обязателен.",
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
    "- audience_interest 0–20: насколько это интересно широкой аудитории текущего канала;",
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
      recordOpenAIResponseUsage(model, "legacy_rewrite", data, "responses", { news_id: payload && payload.newsId || "" });
      const output = extractOpenAIText(data);
      if (!output) {
        lastError = "OpenAI вернул пустой ответ";
        continue;
      }
      let parsed = parseLooseRewriteOutput(output);
      if (!parsed) {
        parsed = { title: title || channelName, text: output, confidence: "medium", notes: "Ответ модели не был JSON" };
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
        contentFormat: editorialFormat.id,
        contentFormatLabel: editorialFormat.label,
        model: model
      };
      if (!result.text) throw new Error("OpenAI не вернул текст новости");
      if (COPYRIGHT_SAFE_MODE) {
        const overlap = findVerbatimOverlap(sourceText, result.title + " " + result.text, COPYRIGHT_MAX_VERBATIM_WORDS);
        if (overlap) {
          lastError = "Copyright Safe Mode: найден слишком длинный дословный фрагмент";
          continue;
        }
      }
      result.copyrightSafe = COPYRIGHT_SAFE_MODE;
      result.copyrightPolicyVersion = "v1";
      return result;
    } catch (error) {
      lastError = String(error && error.message || error);
    }
  }
  throw new Error(lastError || "Не удалось получить ответ OpenAI");
}



// ---------------------------------------------------------------------------
// Editorial pipeline v2 glue (prompts/chto-tam.md + GPT/Claude double check).
// ---------------------------------------------------------------------------
const EDITORIAL_REGISTRY_FILE = path.join(DATA_DIR, "editorial-registry.json");
const DEFAULT_EDITORIAL_REGISTRY = {
  // Organisations designated as extremist and banned in RF; journalists must mark them.
  banned_orgs: ["Meta Platforms", "Instagram", "Facebook"],
  // Fill from the official Ministry of Justice register via the admin API.
  foreign_agents: [],
  updatedAt: ""
};

function normalizeEditorialRegistry(raw) {
  const list = function(value) {
    return Array.from(new Set((Array.isArray(value) ? value : String(value || "").split(/\n|;/))
      .map(function(x){ return String(x || "").trim(); })
      .filter(Boolean)
      .map(function(x){ return x.slice(0, 160); }))).slice(0, 5000);
  };
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    banned_orgs: list(r.banned_orgs != null ? r.banned_orgs : DEFAULT_EDITORIAL_REGISTRY.banned_orgs),
    foreign_agents: list(r.foreign_agents),
    updatedAt: String(r.updatedAt || "")
  };
}

function loadEditorialRegistry() {
  try {
    return normalizeEditorialRegistry(JSON.parse(fs.readFileSync(EDITORIAL_REGISTRY_FILE, "utf8")));
  } catch {
    return normalizeEditorialRegistry(DEFAULT_EDITORIAL_REGISTRY);
  }
}

function saveEditorialRegistry(raw) {
  ensureDataDir();
  const registry = normalizeEditorialRegistry(raw);
  registry.updatedAt = new Date().toISOString();
  fs.writeFileSync(EDITORIAL_REGISTRY_FILE, JSON.stringify(registry, null, 2), "utf8");
  return registry;
}

// Only names that actually occur in the sources are sent to the model: the full
// register can be thousands of lines and must not bloat every request.
function editorialRegistryForSources(sourceText) {
  const registry = loadEditorialRegistry();
  const hay = String(sourceText || "").toLowerCase();
  const hit = function(name) {
    const n = String(name || "").toLowerCase();
    return n.length >= 3 && hay.includes(n);
  };
  return {
    banned_orgs: registry.banned_orgs.filter(hit),
    foreign_agents: registry.foreign_agents.filter(hit)
  };
}

let editorialPipelineInstance = null;
function editorialPipeline() {
  if (!editorialPipelineInstance) {
    editorialPipelineInstance = createEditorialPipeline({
      promptFile: EDITORIAL_V2_PROMPT_FILE,
      maxFixRounds: EDITORIAL_V2_MAX_FIX_ROUNDS,
      requireAllCheckers: EDITORIAL_V2_REQUIRE_ALL_CHECKERS,
      config: {
        openaiApiKey: OPENAI_API_KEY,
        openaiModel: OPENAI_MODEL,
        openaiFallbackModel: OPENAI_FALLBACK_MODEL,
        anthropicApiKey: ANTHROPIC_API_KEY,
        anthropicModel: ANTHROPIC_MODEL,
        onUsage: recordCostUsage
      }
    });
  }
  return editorialPipelineInstance;
}

let editorialPromptError = "";
function editorialV2Active() {
  if (!EDITORIAL_V2_ENABLED || !OPENAI_API_KEY) return false;
  try {
    loadEditorialPrompt(EDITORIAL_V2_PROMPT_FILE);
    editorialPromptError = "";
    return true;
  } catch (error) {
    editorialPromptError = String(error && error.message || error);
    console.error("Editorial v2 prompt unavailable, using legacy flow:", editorialPromptError);
    return false;
  }
}

function editorialChannelId() {
  return resolveChannelId(currentWorkspace());
}

function editorialSignature(ws) {
  const target = ws || currentWorkspace();
  const username = String(target && (target.telegramPublicUsername || target.slug) || "").replace(/^@/, "").trim();
  return username ? "@" + username : "";
}

function editorialRecentPosts(limit) {
  return (state.history || [])
    .filter(function(item){ return item && item.publishedAt; })
    .slice(0, Math.max(1, Number(limit || 12)))
    .map(function(item) {
      const v2 = item.editorialV2 || {};
      return {
        date: item.publishedAt,
        title: String(item.title || "").slice(0, 160),
        format: v2.format || item.contentFormatLabel || item.contentFormat || "",
        hook_type: v2.hookType || "",
        ending_type: v2.endingType || "",
        title_emoji: v2.titleEmoji || "",
        crosspromo_target: v2.crosspromoTarget || null,
        entities: normalizeTopicEntities(item.topicEntities).slice(0, 4),
        audience: item.performanceScore == null ? undefined : (item.performanceScore >= 2 ? "выше среднего" : (item.performanceScore <= -2 ? "ниже среднего" : "средне"))
      };
    });
}

function editorialNetworkRecent() {
  const me = currentWorkspaceId();
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const out = [];
  for (const ws of workspaceStore.workspaces) {
    if (!ws || ws.id === me || !ws.state) continue;
    const channelId = resolveChannelId(ws);
    for (const item of (ws.state.history || [])) {
      if (!item || !item.publishedAt) continue;
      const t = new Date(item.publishedAt).getTime();
      if (!Number.isFinite(t) || t < since) break;
      out.push({ channel_id: channelId || ws.id, title: String(item.title || "").slice(0, 160), date: item.publishedAt });
      if (out.length >= 60) return out;
    }
  }
  return out;
}

function editorialNetworkChannels() {
  const me = currentWorkspaceId();
  return workspaceStore.workspaces
    .filter(function(ws){ return ws && ws.id !== me && resolveChannelId(ws) && editorialSignature(ws); })
    .map(function(ws){ return { channel_id: resolveChannelId(ws), name: ws.name, signature: editorialSignature(ws) }; });
}

function editorialFormatStats() {
  const byFormat = state.editorialLearning && state.editorialLearning.byFormat;
  if (!byFormat || typeof byFormat !== "object") return null;
  const out = {};
  for (const [format, bucket] of Object.entries(byFormat)) {
    if (!bucket || Number(bucket.samples || 0) < 3) continue;
    const perf = Number(bucket.performance || 0);
    if (!Number.isFinite(perf)) continue;
    out[format] = Math.round(Math.max(0.5, Math.min(1.5, 1 + perf / 16)) * 100) / 100;
  }
  return Object.keys(out).length ? out : null;
}

function editorialPostsToday() {
  const day = moscowDateKey(new Date());
  return (state.history || []).filter(function(item){
    return item && item.publishedAt && moscowDateKey(new Date(item.publishedAt)) === day;
  }).length;
}

function editorialDailyLimit() {
  const sources = state.sources || [];
  let limit = DYNAMIC_DAILY_MAX;
  if (sources.some(function(s){ return s && s.enabled && s.group === "blogger"; })) limit += BLOGGER_DAILY_TARGET;
  if (sources.some(function(s){ return s && s.enabled && isRussianAISource(s); })) limit += RUSSIAN_AI_DAILY_TARGET;
  return limit;
}

// sources: [{ name, url, date, text, photos }]
async function runEditorialV2(sources, options) {
  const opts = options || {};
  const channelId = editorialChannelId();
  const publishAt = new Date(Date.now() + 60 * 60 * 1000);
  const sourceText = sources.map(function(s){ return String(s.title || "") + "\n" + String(s.text || ""); }).join("\n\n");
  const request = {
    now: new Date().toISOString(),
    news_id: String(opts.newsId || opts.news_id || ""),
    mode: opts.mode === "digest" ? "digest" : "post",
    time_slot: opts.timeSlot || timeSlotFor(publishAt),
    signature: editorialSignature(),
    posts_today: editorialPostsToday(),
    daily_limit: editorialDailyLimit(),
    sources: sources.map(function(s) {
      return {
        name: String(s.name || ""),
        url: String(s.url || ""),
        date: String(s.date || ""),
        role: String(s.role || ""),
        title: String(s.title || "").slice(0, 400),
        text: String(s.text || "").slice(0, Math.max(2500, Math.floor(12000 / Math.max(1, sources.length)))),
        photos: (Array.isArray(s.photos) ? s.photos : []).filter(Boolean).slice(0, 5)
      };
    }),
    recent_posts: editorialRecentPosts(12),
    network_recent: editorialNetworkRecent(),
    network_channels: editorialNetworkChannels(),
    registry: editorialRegistryForSources(sourceText),
    has_photo: Boolean(opts.hasPhoto)
  };
  const formatStats = editorialFormatStats();
  if (formatStats) request.format_stats = formatStats;
  const learning = state.editorialLearning || {};
  const hookStats = bucketWeights(learning.byHook, 3);
  if (hookStats) request.hook_stats = hookStats;
  const best = (state.history || [])
    .filter(function(h){ return h && h.publishedAt && !isDigestHistory(h) && Number(h.performanceScore || 0) >= 2 && Date.now() - new Date(h.publishedAt).getTime() < 14 * 24 * 3600000; })
    .sort(function(a, b){ return Number(b.performanceScore || 0) - Number(a.performanceScore || 0); })
    .slice(0, 3)
    .map(function(h){ return { title: String(h.title || "").slice(0, 120), format: historyFormat(h), hook_type: historyHook(h), views: h.views || undefined }; });
  if (best.length) request.best_posts = best;
  if (opts.mergeCheck) request.merge_check = true;

  const outcome = await editorialPipeline().run(channelId, request);
  const post = outcome.post || {};

  if (outcome.status !== "skip" && COPYRIGHT_SAFE_MODE) {
    const overlap = findVerbatimOverlap(sourceText, [post.title, post.tgText, post.vkText].join(" "), COPYRIGHT_MAX_VERBATIM_WORDS);
    if (overlap) {
      outcome.status = "hold";
      outcome.verdict = "copyright_overlap";
      outcome.errors = (outcome.errors || []).concat([{ severity: "critical", type: "tech", field: "tg_text", quote: overlap.slice(0, 160), problem: "дословный фрагмент источника", fix: "переписать своими словами", checker: "copyright" }]);
    }
  }

  const scores = legacyScores(outcome, AUTO_QUALITY_MIN);
  const checkerModels = (outcome.checkers || []).map(function(c){ return c.failed ? c.provider + ":error" : c.provider + ":" + c.model + ":" + c.verdict; });
  const meta = {
    version: 2,
    channelId: channelId,
    status: outcome.status,
    verdict: outcome.verdict,
    importance: post.importance == null ? null : post.importance,
    skipReason: post.skipReason || "",
    titleRu: post.titleRu || "",
    angle: post.angle || null,
    format: post.format || "",
    hookType: post.hookType || "",
    endingType: post.endingType || "",
    titleEmoji: post.titleEmoji || "",
    crosspromoTarget: post.crosspromoTarget || null,
    album: Boolean(post.album),
    legalFlags: post.legalFlags || [],
    conflicts: post.conflicts || null,
    cover: post.cover || null,
    rounds: outcome.rounds || 0,
    writerModel: outcome.writerModel || "",
    checkers: checkerModels,
    errors: (outcome.errors || []).slice(0, 12),
    log: outcome.log || [],
    checkedAt: new Date().toISOString()
  };

  // One structured line per editorial decision so the pipeline can be monitored from
  // Railway logs. No secrets, no post bodies.
  console.log("EDITORIAL_V2 " + JSON.stringify({
    workspace: currentWorkspaceId(),
    channel: channelId,
    status: outcome.status,
    verdict: outcome.verdict,
    importance: meta.importance,
    rounds: meta.rounds,
    checkers: checkerModels,
    errors: (outcome.errors || []).length,
    skipReason: meta.skipReason ? String(meta.skipReason).slice(0, 120) : undefined,
    checkerErrors: (outcome.checkers || []).filter(function(c){ return c.failed; }).map(function(c){ return c.provider + ": " + String(c.error || "").slice(0, 160); }),
    title: String(post.title || post.titleRu || "").slice(0, 90)
  }));

  if (outcome.status === "skip") return { skip: true, reason: post.skipReason || "skip", meta: meta };

  const issues = (outcome.errors || []).map(function(e){
    return "[" + (e.checker || "check") + "] " + (e.problem || e.quote) + (e.fix ? " → " + e.fix : "");
  }).slice(0, 10);
  if (outcome.verdict === "unavailable") {
    issues.unshift("Проверка недоступна: " + (outcome.checkers || []).filter(function(c){ return c.failed; }).map(function(c){ return c.provider + " — " + String(c.error || "").slice(0, 120); }).join("; "));
  }
  const approved = outcome.status === "approved";
  const decision = approved
    ? "Пост прошёл проверку: " + checkerModels.join(", ") + (outcome.rounds ? " (исправлений: " + outcome.rounds + ")" : "")
    : "Пост не прошёл проверку: " + ({ reject: "проверка отклонила", fix_exhausted: "ошибки остались после исправлений", unavailable: "одна из нейросетей-проверщиков недоступна", copyright_overlap: "дословное совпадение с источником" }[outcome.verdict] || outcome.verdict);

  return {
    skip: false,
    meta: meta,
    rewrite: {
      title: post.title,
      text: post.tgText,
      confidence: approved ? "high" : "low",
      notes: post.conflicts ? "Расхождения в источниках: " + post.conflicts : "",
      editorialScore: scores.editorialScore,
      scoreBreakdown: { importance: post.importance || 0 },
      scoreReason: post.angle || ("Важность " + (post.importance || "?") + "/10"),
      contentFormat: post.format || "",
      contentFormatLabel: post.format || "",
      model: outcome.writerModel || ""
    },
    qc: {
      title: post.title,
      text: post.tgText,
      qualityScore: scores.qualityScore,
      qualityBreakdown: { factuality: approved ? 25 : 0 },
      qcStatus: scores.qcStatus,
      qcIssues: issues,
      qcRepaired: (outcome.rounds || 0) > 0,
      topicEntities: normalizeTopicEntities(post.entities || []),
      platformVariants: {
        telegram: { title: post.title, text: post.tgText },
        vk: { title: post.title, text: post.vkText || post.tgText }
      },
      decisionSummary: decision,
      model: checkerModels.join(", ")
    }
  };
}

// ---------------------------------------------------------------------------
// Digests: evening «Главное за день» and Sunday «Топ недели» from published posts.
async function publishDigest(kind) {
  if (!editorialV2Active()) return { ok: false, skipped: "editorial_v2_off" };
  if (state.mode !== "AUTO" || !AUTO_PUBLISH_ENABLED) return { ok: true, skipped: "auto_disabled" };
  const now = new Date();
  const posts = pickDigestPosts(state.history, kind, now);
  const min = kind === "sunday" ? 5 : 4;
  if (posts.length < min) return { ok: true, skipped: "few_posts", count: posts.length };
  const ws = currentWorkspace();
  const username = currentTelegramPublicUsername();
  const sources = posts.map(function(h) {
    return {
      name: ws && ws.name || "Канал",
      url: username && h.messageId ? "https://t.me/" + username + "/" + h.messageId : "",
      date: h.publishedAt,
      role: "опубликованный пост канала" + (h.views ? ", просмотров: " + h.views : ""),
      title: String(h.title || ""),
      text: stripHtml(String(h.text || "")).slice(0, 1500)
    };
  });
  const day = moscowParts(now).day;
  const v2 = await runEditorialV2(sources, { mode: "digest", timeSlot: kind === "sunday" ? "sunday_digest" : "evening", newsId: "digest_" + kind + "_" + day, hasPhoto: true });
  if (v2.skip) return { ok: true, skipped: "writer_skip", reason: v2.reason };
  if (!v2.qc || v2.qc.qcStatus !== "pass") return { ok: true, skipped: "not_approved", verdict: v2.meta && v2.meta.verdict };
  const cover = posts.find(function(h){ return h && (h.imageUrl || h.generatedImageUrl); }) || {};
  const id = "digest_" + kind + "_" + day + "_" + crypto.randomBytes(3).toString("hex");
  const result = await sendMultiPlatformPost({
    id: id, postId: id, newsId: "", topicId: "default", allow_text_fallback: true,
    title: v2.rewrite.title, text: v2.rewrite.text,
    sourceName: ws && ws.name || "", sourceUrl: "",
    imageUrl: cover.imageUrl || "", generatedImageUrl: cover.imageUrl ? "" : (cover.generatedImageUrl || ""),
    mediaOrigin: cover.imageUrl ? "source_media" : (cover.generatedImageUrl ? "ai_generated" : ""),
    platformVariants: v2.qc.platformVariants, qcStatus: "pass", qualityScore: v2.qc.qualityScore,
    topicEntities: [], decisionSummary: v2.qc.decisionSummary
  }, { telegram: true, vk: false });
  if (!result.telegramPublished) return { ok: false, error: result.error || result.telegramError || "Telegram не принял дайджест" };
  state.history = Array.isArray(state.history) ? state.history : [];
  state.history.unshift({
    id: newId("hist"), isDigest: true, digestKind: kind,
    title: v2.rewrite.title, text: result.publishedText || v2.rewrite.text,
    messageId: result.message_id || null, publishedAt: new Date().toISOString(),
    sourceName: ws && ws.name || "", imageUrl: cover.imageUrl || "", generatedImageUrl: cover.imageUrl ? "" : (cover.generatedImageUrl || ""),
    contentFormat: "Дайджест", contentFormatLabel: "Дайджест", editorialV2: v2.meta, publicationOrigin: "digest"
  });
  state.history = state.history.slice(0, 300);
  saveState();
  return { ok: true, published: true, kind: kind, posts: posts.length, messageId: result.message_id || null };
}

async function maybePublishDigest() {
  if (!DIGEST_ENABLED) return;
  const now = moscowParts(new Date());
  state.digests = state.digests && typeof state.digests === "object" ? state.digests : {};
  const jobs = [];
  if (now.weekday === 0) jobs.push({ kind: "sunday", time: DIGEST_SUNDAY_TIME, key: "lastSunday" });
  jobs.push({ kind: "evening", time: DIGEST_EVENING_TIME, key: "lastEvening" });
  for (const job of jobs) {
    if (state.digests[job.key] === now.day) continue;
    if (now.hhmm < job.time || now.hhmm > addMinutesHHMM(job.time, 40)) continue;
    // Sunday top replaces the evening digest on Sundays.
    if (job.kind === "evening" && now.weekday === 0 && state.digests.lastSunday === now.day) { state.digests.lastEvening = now.day; continue; }
    state.digests[job.key] = now.day;
    saveState();
    try {
      const result = await publishDigest(job.kind);
      console.log("DIGEST " + JSON.stringify(Object.assign({ workspace: currentWorkspaceId() }, result)));
    } catch (error) {
      console.warn("DIGEST_FAILED " + JSON.stringify({ workspace: currentWorkspaceId(), kind: job.kind, error: error.message }));
    }
    return;
  }
}

function addMinutesHHMM(hhmm, minutes) {
  const parts = String(hhmm || "00:00").split(":");
  const total = Math.min(23 * 60 + 59, Number(parts[0] || 0) * 60 + Number(parts[1] || 0) + Number(minutes || 0));
  return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
}

// ---------------------------------------------------------------------------
// Daily report to the owner in Telegram (private chat with the bot).
async function collectDailyReportForWorkspace() {
  const ws = currentWorkspace();
  const since = Date.now() - 24 * 3600000;
  const recent = (state.history || []).filter(function(h){ return h && h.publishedAt && new Date(h.publishedAt).getTime() >= since; });
  const regular = recent.filter(function(h){ return !isDigestHistory(h); });
  const username = currentTelegramPublicUsername();
  const best = regular.slice().sort(function(a, b){ return Number(b.views || 0) - Number(a.views || 0); })[0] || null;
  const filtered = { prefilter: 0, editorial: 0, duplicate: 0, autoRejected: 0 };
  const reasons = [];
  if (db && dbReady) {
    try {
      const r = await db.query("SELECT status, metadata->>'prefilterReason' AS pr, metadata->>'editorialSkipReason' AS er, metadata->>'autoRejectReason' AS ar FROM news_items WHERE workspace_id=$1 AND detected_at > NOW() - INTERVAL '24 hours' AND status IN ('prefilter_skip','editorial_skip','duplicate_story','auto_rejected')", [currentWorkspaceId()]);
      for (const row of r.rows) {
        if (row.status === "prefilter_skip") { filtered.prefilter += 1; if (row.pr) reasons.push(row.pr); }
        else if (row.status === "editorial_skip") { filtered.editorial += 1; if (row.er) reasons.push(row.er); }
        else if (row.status === "duplicate_story") filtered.duplicate += 1;
        else if (row.status === "auto_rejected") { filtered.autoRejected += 1; if (row.ar) reasons.push(row.ar); }
      }
    } catch (error) { console.warn("Daily report query failed:", error.message); }
  }
  const queue = (state.queue || []).filter(function(q){ return q && q.newsId; });
  const ready = queue.filter(function(q){ return autoQualityEligible(q) && !ratingBelowAutoThreshold(q); }).length;
  const reserve = queue.filter(function(q){ return autoQualityEligible(q) && ratingBelowAutoThreshold(q); }).length;
  const waiting = queue.filter(function(q){ return q.editorialV2 && q.editorialV2.verdict === "unavailable"; }).length;
  const problems = [];
  if (waiting) problems.push("ждут повторной проверки нейросетью: " + waiting);
  if (!regular.length) problems.push("за сутки не вышло ни одного поста");
  const last = lastCollectorRuns.get(currentWorkspaceId());
  if (last && last.ok === false) problems.push("сбор новостей завершился ошибкой: " + String(last.error || "").slice(0, 120));
  return {
    name: ws && ws.name || currentWorkspaceId(),
    published: regular.length,
    digest: recent.some(isDigestHistory),
    queueReady: ready,
    queueReserve: reserve,
    filtered: filtered,
    topReasons: topReasons(reasons, 3),
    best: best ? { title: best.title, views: best.views || 0, url: username && best.messageId ? "https://t.me/" + username + "/" + best.messageId : "" } : null,
    sourcesPaused: (state.sources || []).filter(function(x){ return x && x.autoPaused && new Date(x.autoPaused.at || 0).getTime() >= since; }).map(function(x){ return x.name; }),
    sourcesAdded: (state.sources || []).filter(function(x){ return x && x.autoAdded && new Date(x.autoAdded.at || 0).getTime() >= since; }).map(function(x){ return x.name; }),
    problems: problems
  };
}

async function sendDailyReport(force) {
  const defaultId = workspaceStore.defaultWorkspaceId || (workspaceStore.workspaces[0] && workspaceStore.workspaces[0].id);
  const channels = [];
  for (const ws of workspaceStore.workspaces) {
    if (!ws || !ws.state) continue;
    await workspaceContext.run({ workspaceId: ws.id }, async function(){ channels.push(await collectDailyReportForWorkspace()); });
  }
  let spend = null;
  try { spend = await costBudgetSnapshot(); } catch {}
  const text = buildDailyReportText({
    date: moscowParts(new Date()).day.split("-").reverse().join("."),
    channels: channels,
    spendRub: spend && Number.isFinite(Number(spend.todayRub)) ? spend.todayRub : null,
    budgetRub: spend && spend.dailyBudgetRub || 0
  });
  return await workspaceContext.run({ workspaceId: defaultId }, async function() {
    if (!BOT_TOKEN) return { ok: false, error: "нет токена бота" };
    await discoverTelegramAlertChat();
    const chatId = TELEGRAM_ALERT_CHAT_ID || String(state.telegramAlertChatId || "").trim();
    if (!chatId) {
      console.warn("DAILY_REPORT_NO_CHAT напишите боту /start в личные сообщения, чтобы получать отчёты");
      return { ok: false, error: "no_chat", text: text };
    }
    await telegramApi("sendMessage", { chat_id: chatId, text: text, disable_web_page_preview: true });
    console.log("DAILY_REPORT_SENT " + JSON.stringify({ channels: channels.length, force: Boolean(force) }));
    return { ok: true, text: text };
  });
}

async function maybeSendDailyReport() {
  if (!DAILY_REPORT_ENABLED) return;
  const now = moscowParts(new Date());
  const ws = getWorkspaceById(workspaceStore.defaultWorkspaceId) || workspaceStore.workspaces[0];
  if (!ws || !ws.state) return;
  ws.state.dailyReport = ws.state.dailyReport && typeof ws.state.dailyReport === "object" ? ws.state.dailyReport : {};
  if (ws.state.dailyReport.lastDay === now.day) return;
  if (now.hhmm < DAILY_REPORT_TIME || now.hhmm > addMinutesHHMM(DAILY_REPORT_TIME, 60)) return;
  ws.state.dailyReport.lastDay = now.day;
  await workspaceContext.run({ workspaceId: ws.id }, async function(){ saveState(); });
  const result = await sendDailyReport(false);
  if (!result.ok) console.warn("DAILY_REPORT_FAILED " + JSON.stringify({ error: result.error }));
}

let extrasTickRunning = false;
setInterval(function() {
  if (extrasTickRunning || !COLLECTOR_ENABLED) return;
  extrasTickRunning = true;
  (async function(){
    for (const ws of workspaceStore.workspaces) {
      if (!ws || !ws.state) continue;
      await workspaceContext.run({ workspaceId: ws.id }, async function(){ await maybePublishDigest(); });
    }
    await maybeSendDailyReport();
  })().catch(function(error){ console.warn("Extras tick failed:", error.message); }).finally(function(){ extrasTickRunning = false; });
}, 60000);

async function retryUnavailableEditorialQueueItems() {
  if (costEconomyMode()) return { checked: 0, repaired: 0, held: 0, skipped: 0, economyMode: true };
  if (!editorialV2Active() || !ANTHROPIC_API_KEY) return { checked: 0, repaired: 0, held: 0, skipped: 0 };
  const probe = await anthropicEditorialProbe(false);
  if (!probe.ok) return { checked: 0, repaired: 0, held: 0, skipped: 0, error: probe.error || "Anthropic checker unavailable" };

  const marker = "structured-json-v1";
  const candidates = (state.queue || []).filter(function(item) {
    if (!item || !item.editorialV2) return false;
    if (item.editorialV2RetryVersion === marker) return false;
    const verdict = String(item.editorialV2.verdict || "").toLowerCase();
    const checkerList = Array.isArray(item.editorialV2.checkers) ? item.editorialV2.checkers : [];
    const hadAnthropicFailure = checkerList.some(function(x){ return /^anthropic:error$/i.test(String(x || "")); });
    return verdict === "unavailable" || hadAnthropicFailure;
  }).slice(0, 6);

  let repaired = 0;
  let held = 0;
  let skipped = 0;

  for (const item of candidates) {
    try {
      const sourceText = String(item.sourceOriginalText || item.text || "").trim();
      if (!sourceText) {
        item.editorialV2RetryVersion = marker;
        item.editorialV2RetryError = "Нет исходного текста";
        skipped += 1;
        continue;
      }

      const result = await runEditorialV2([{
        name: String(item.sourceName || "Источник"),
        url: String(item.sourceUrl || ""),
        date: String(item.articlePublishedAt || item.createdAt || ""),
        role: sourceRoleLabel(item.sourceRole || sourceEditorialRole(item)),
        title: String(item.sourceOriginalTitle || item.title || ""),
        text: sourceText,
        photos: [item.enhancedImageUrl, item.imageUrl, item.originalImageUrl]
          .concat(Array.isArray(item.mediaPackUrls) ? item.mediaPackUrls : [])
          .filter(Boolean)
          .slice(0, 5)
      }], {
        hasPhoto: Boolean(item.videoUrl || item.enhancedImageUrl || item.imageUrl || item.generatedImageUrl || (Array.isArray(item.mediaPackUrls) && item.mediaPackUrls.length)),
        newsId: item.newsId || item.id
      });

      item.editorialV2RetryVersion = marker;
      item.editorialV2RetryAt = new Date().toISOString();
      item.editorialV2RetryError = "";
      item.editorialV2 = result.meta;

      if (result.skip) {
        item.qcStatus = "hold";
        item.qcIssues = ["Редакция v2 после повторной проверки решила пропустить новость: " + String(result.reason || "skip")];
        item.decisionSummary = item.qcIssues[0];
        skipped += 1;
        continue;
      }

      const rewrite = result.rewrite || {};
      const qc = result.qc || {};
      item.title = rewrite.title || item.title;
      item.text = rewrite.text || item.text;
      item.aiScore = Number(rewrite.editorialScore || item.aiScore || 0);
      item.aiScoreBreakdown = rewrite.scoreBreakdown || item.aiScoreBreakdown || {};
      item.aiScoreReason = rewrite.scoreReason || item.aiScoreReason || "";
      item.contentFormat = rewrite.contentFormat || item.contentFormat || "";
      item.contentFormatLabel = rewrite.contentFormatLabel || item.contentFormatLabel || "";
      item.qualityScore = Number(qc.qualityScore || item.qualityScore || 0);
      item.qualityBreakdown = qc.qualityBreakdown || item.qualityBreakdown || {};
      item.qcStatus = qc.qcStatus || "hold";
      item.qcIssues = Array.isArray(qc.qcIssues) ? qc.qcIssues : [];
      item.qcRepaired = Boolean(qc.qcRepaired);
      item.topicEntities = Array.isArray(qc.topicEntities) ? qc.topicEntities : item.topicEntities || [];
      item.platformVariants = qc.platformVariants || item.platformVariants || {};
      item.decisionSummary = qc.decisionSummary || item.decisionSummary || "";
      item.priorityScore = Math.round(dynamicItemScore(item));
      item.decisionExplanation = buildDecisionExplanation(item);

      if (item.qcStatus === "pass" && result.meta && result.meta.verdict === "pass") repaired += 1;
      else held += 1;
    } catch (error) {
      item.editorialV2RetryError = String(error && error.message || error).slice(0, 500);
      console.warn("EDITORIAL_V2_RETRY_FAILED " + JSON.stringify({
        workspace: currentWorkspaceId(),
        queueId: item.id,
        error: item.editorialV2RetryError
      }));
      held += 1;
    } finally {
      saveState();
    }
  }

  return { checked: candidates.length, repaired, held, skipped };
}

// Re-runs every not-yet-published queue item through the current editorial v2 rules
// (writer + GPT/Claude check). Non-destructive: items the writer now skips are put on
// hold with a reason instead of being deleted.
async function rebuildQueueWithEditorialV2() {
  if (costEconomyMode()) return { ok: false, economyMode: true, error: "Режим экономии: пересборка очереди приостановлена" };
  if (!editorialV2Active()) return { ok: false, error: "Редакция v2 выключена" };
  const wsId = currentWorkspaceId();
  if (collectorRunningWorkspaces.has(wsId)) return { ok: false, error: "Идёт сбор новостей, попробуйте позже" };
  collectorRunningWorkspaces.add(wsId);
  const summary = { ok: true, workspace: wsId, total: 0, approved: 0, hold: 0, skipped: 0, failed: 0 };
  try {
    const items = (state.queue || []).filter(function(q) {
      return q && !q.publishedAt && (String(q.sourceOriginalText || "").trim() || (Array.isArray(q.storySources) && q.storySources.length));
    });
    for (const item of items) {
      summary.total += 1;
      const rawSources = Array.isArray(item.storySources) && item.storySources.length
        ? item.storySources
        : [{
            sourceName: item.sourceName, url: item.sourceUrl, publishedAt: item.articlePublishedAt || item.createdAt,
            sourceRole: item.sourceRole, title: item.sourceOriginalTitle || item.title, text: item.sourceOriginalText || "",
            originalImageUrl: item.originalImageUrl
          }];
      const sources = rawSources.map(function(source) {
        return {
          name: source.sourceName || "Источник",
          url: source.url || "",
          date: source.publishedAt || "",
          role: sourceRoleLabel(source.sourceRole || sourceEditorialRole(source)),
          title: source.title || "",
          text: source.text || "",
          photos: [source.originalImageUrl].filter(Boolean)
        };
      });
      let v2;
      try {
        v2 = await runEditorialV2(sources, {
          hasPhoto: Boolean(item.imageUrl || item.generatedImageUrl || item.videoUrl || (Array.isArray(item.mediaPackUrls) && item.mediaPackUrls.length)),
          newsId: item.newsId || item.id
        });
      } catch (error) {
        summary.failed += 1;
        item.editorialRebuildError = String(error && error.message || error).slice(0, 300);
        saveState();
        continue;
      }
      item.editorialRebuiltAt = new Date().toISOString();
      item.editorialRebuildError = "";
      // Freshly re-checked: the separate "checker unavailable" retry must not redo it —
      // unless this check itself could not reach a checker.
      if (!(v2.meta && v2.meta.verdict === "unavailable")) item.editorialV2RetryVersion = "structured-json-v1";
      else delete item.editorialV2RetryVersion;
      if (v2.skip) {
        summary.skipped += 1;
        Object.assign(item, {
          qcStatus: "hold",
          qualityScore: Math.min(Number(item.qualityScore) || 0, 40),
          decisionSummary: "Пропущено при пересборке: " + v2.reason,
          editorialV2: v2.meta
        });
        saveState();
        continue;
      }
      Object.assign(item, {
        title: v2.rewrite.title,
        text: v2.rewrite.text,
        aiScore: v2.rewrite.editorialScore,
        aiScoreBreakdown: v2.rewrite.scoreBreakdown,
        aiScoreReason: v2.rewrite.scoreReason,
        aiTier: v2.rewrite.editorialScore >= AI_TOP_NEWS_SCORE ? "top" : (v2.rewrite.editorialScore >= AI_STRONG_NEWS_SCORE ? "strong" : "normal"),
        contentFormat: v2.rewrite.contentFormat,
        contentFormatLabel: v2.rewrite.contentFormatLabel,
        qualityScore: v2.qc.qualityScore,
        qualityBreakdown: v2.qc.qualityBreakdown,
        qcStatus: v2.qc.qcStatus,
        qcIssues: v2.qc.qcIssues,
        qcRepaired: v2.qc.qcRepaired,
        topicEntities: v2.qc.topicEntities,
        platformVariants: v2.qc.platformVariants,
        decisionSummary: v2.qc.decisionSummary,
        editorialV2: v2.meta
      });
      if (!v2.meta.album && Array.isArray(item.mediaPackUrls) && item.mediaPackUrls.length > 1) {
        item.mediaPackUrls = item.mediaPackUrls.slice(0, 1);
        if (!item.videoUrl) item.mediaType = "photo";
      }
      if (v2.qc.qcStatus === "pass") summary.approved += 1; else summary.hold += 1;
      saveState();
    }
  } finally {
    collectorRunningWorkspaces.delete(wsId);
  }
  console.log("EDITORIAL_V2_REBUILD " + JSON.stringify(summary));
  return summary;
}

function fallbackEditorialQC(payload) {
  const p = payload || {};
  const hasMedia = Boolean(p.videoUrl || p.imageUrl || p.generatedImageUrl || (Array.isArray(p.mediaPackUrls) && p.mediaPackUrls.length));
  const text = String(p.text || "").trim();
  const title = String(p.title || "").trim();
  let score = 72;
  if (title.length >= 18 && title.length <= 100) score += 3;
  if (text.length >= 350 && text.length <= 1100) score += 3;
  if (hasMedia) score += 4;
  if (!text) score = 35;
  return {
    title: title,
    text: text,
    qualityScore: Math.max(0, Math.min(100, score)),
    qualityBreakdown: {
      hook: title ? 14 : 4,
      clarity: text ? 12 : 4,
      factuality: 20,
      originality: 11,
      structure: text ? 8 : 3,
      mediaFit: hasMedia ? 12 : 4
    },
    qcStatus: score >= AUTO_QUALITY_MIN ? "pass" : "hold",
    qcIssues: [],
    qcRepaired: false,
    topicEntities: [],
    platformVariants: {
      telegram: { title: title, text: text },
      vk: { title: title, text: text }
    },
    decisionSummary: "Базовая автоматическая проверка пройдена без отдельного AI-QC.",
    model: ""
  };
}

async function callOpenAIEditorialQC(payload) {
  const p = payload || {};
  if (!EDITORIAL_QC_ENABLED || !OPENAI_API_KEY) return fallbackEditorialQC(p);

  const sourceRole = String(p.sourceRole || sourceEditorialRole(p));
  const recent = recentHistoryItems(6).map(function(item) {
    return {
      title: String(item.title || "").slice(0, 160),
      format: String(item.contentFormatLabel || item.contentFormat || ""),
      entities: normalizeTopicEntities(item.topicEntities)
    };
  });
  const mediaInfo = {
    video: Boolean(p.videoUrl),
    image: Boolean(p.imageUrl || p.generatedImageUrl),
    albumCount: Array.isArray(p.mediaPackUrls) ? p.mediaPackUrls.length : 0,
    mediaOrigin: String(p.mediaOrigin || ""),
    mediaDirector: p.mediaDirector || null
  };

  const prompt = [
    "Ты финальный выпускающий редактор канала «" + String(currentWorkspace().name || "News Factory") + "».",
    "Проведи последний QC готового новостного поста и при необходимости сразу исправь его.",
    "",
    "НЕЛЬЗЯ добавлять факты, которых нет в исходном материале. Все числа, даты, характеристики, причины и цитаты сверяй только с SOURCE.",
    "Роль источника: " + sourceRoleLabel(sourceRole) + ".",
    sourceRole === "official_primary"
      ? "Официальный источник — опора для дат, характеристик и заявлений компании."
      : sourceRole === "author_opinion"
        ? "Мнения, впечатления и выводы автора обязательно оставляй атрибутированными как мнение/опыт автора."
        : "СМИ/контекстный источник — факты и оценки не смешивай.",
    "",
    "ПРОВЕРЬ:",
    "- фактологию относительно SOURCE;",
    "- сильный, но честный хук без кликбейта;",
    "- естественный русский язык без канцелярита и типичных AI-фраз;",
    "- отсутствие повторов, шаблонных финалов и лишнего вопроса ради вопроса;",
    "- мобильную читаемость и короткие абзацы;",
    "- соответствие медиа теме;",
    "- отличие структуры от последних публикаций.",
    "",
    "Сделай ДВЕ адаптации одного и того же набора фактов:",
    "Telegram: компактнее, живее, 450–850 знаков, 3–6 коротких блоков.",
    "VK: чуть больше контекста, 600–1200 знаков, естественный первый абзац; не копируй Telegram дословно.",
    "Ссылки на источник не вставляй — система добавит их сама.",
    "",
    "QUALITY SCORE 0–100 как сумма: hook 0–20, clarity 0–15, factuality 0–25, originality 0–15, structure 0–10, media_fit 0–15.",
    "Если исходный черновик слабый — исправь его и оцени уже ИСПРАВЛЕННЫЙ вариант.",
    "",
    "Верни строго JSON:",
    "{\"final_title\":\"...\",\"final_text\":\"...\",\"telegram\":{\"title\":\"...\",\"text\":\"...\"},\"vk\":{\"title\":\"...\",\"text\":\"...\"},\"quality_score\":0,\"quality_breakdown\":{\"hook\":0,\"clarity\":0,\"factuality\":0,\"originality\":0,\"structure\":0,\"media_fit\":0},\"issues\":[\"...\"],\"repaired\":true,\"entities\":[\"бренд/продукт/главная тема\"],\"decision_summary\":\"почему пост готов/не готов\"}",
    "",
    "SOURCE TITLE: " + String(p.sourceTitle || ""),
    "SOURCE TEXT: " + String(p.sourceText || "").slice(0, 9000),
    "",
    "DRAFT TITLE: " + String(p.title || ""),
    "DRAFT TEXT: " + String(p.text || ""),
    "",
    "MEDIA: " + JSON.stringify(mediaInfo),
    "RECENT FEED: " + JSON.stringify(recent)
  ].join("\n");

  const candidates = [OPENAI_MODEL, OPENAI_FALLBACK_MODEL].filter(function(v, i, a){ return v && a.indexOf(v) === i; });
  let lastError = "";
  for (const model of candidates) {
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + OPENAI_API_KEY },
        body: JSON.stringify({ model: model, input: prompt, max_output_tokens: 2600 }),
        signal: AbortSignal.timeout(55000)
      });
      const data = await response.json().catch(function(){ return {}; });
      if (!response.ok) {
        lastError = data && data.error && data.error.message || ("OpenAI HTTP " + response.status);
        continue;
      }
      recordOpenAIResponseUsage(model, "editorial_qc", data, "responses", { news_id: p.newsId || p.news_id || "" });
      const output = extractOpenAIText(data);
      if (!output) { lastError = "QC вернул пустой ответ"; continue; }
      let parsed;
      try {
        parsed = JSON.parse(output.replace(/^\s*```json\s*/i, "").replace(/\s*```\s*$/i, ""));
      } catch {
        const first = output.indexOf("{"), last = output.lastIndexOf("}");
        if (first >= 0 && last > first) {
          try { parsed = JSON.parse(output.slice(first, last + 1)); } catch {}
        }
      }
      if (!parsed) { lastError = "QC JSON не разобран"; continue; }

      const clamp = function(value, max) {
        const n = Number(value);
        return Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n))) : 0;
      };
      const raw = parsed.quality_breakdown && typeof parsed.quality_breakdown === "object" ? parsed.quality_breakdown : {};
      const breakdown = {
        hook: clamp(raw.hook, 20),
        clarity: clamp(raw.clarity, 15),
        factuality: clamp(raw.factuality, 25),
        originality: clamp(raw.originality, 15),
        structure: clamp(raw.structure, 10),
        mediaFit: clamp(raw.media_fit, 15)
      };
      const sum = Object.values(breakdown).reduce(function(total, value){ return total + value; }, 0);
      const explicit = Number(parsed.quality_score);
      const score = sum > 0 ? sum : (Number.isFinite(explicit) ? Math.max(0, Math.min(100, Math.round(explicit))) : 70);
      const finalTitle = String(parsed.final_title || p.title || "").trim();
      const finalText = String(parsed.final_text || p.text || "").trim();
      if (!finalText) { lastError = "QC не вернул текст"; continue; }

      if (COPYRIGHT_SAFE_MODE && p.sourceText) {
        const overlap = findVerbatimOverlap(p.sourceText, finalTitle + " " + finalText, COPYRIGHT_MAX_VERBATIM_WORDS);
        if (overlap) { lastError = "QC оставил длинный дословный фрагмент"; continue; }
      }

      const tg = parsed.telegram && typeof parsed.telegram === "object" ? parsed.telegram : {};
      const vk = parsed.vk && typeof parsed.vk === "object" ? parsed.vk : {};
      return {
        title: finalTitle,
        text: finalText,
        qualityScore: Math.max(0, Math.min(100, Math.round(score))),
        qualityBreakdown: breakdown,
        qcStatus: score >= AUTO_QUALITY_MIN ? "pass" : "hold",
        qcIssues: Array.isArray(parsed.issues) ? parsed.issues.map(function(x){ return String(x || "").trim(); }).filter(Boolean).slice(0, 6) : [],
        qcRepaired: Boolean(parsed.repaired),
        topicEntities: normalizeTopicEntities(parsed.entities),
        platformVariants: {
          telegram: {
            title: String(tg.title || finalTitle).trim(),
            text: String(tg.text || finalText).trim()
          },
          vk: {
            title: String(vk.title || finalTitle).trim(),
            text: String(vk.text || finalText).trim()
          }
        },
        decisionSummary: String(parsed.decision_summary || "").trim(),
        model: model
      };
    } catch (error) {
      lastError = String(error && error.message || error);
    }
  }

  console.warn("Editorial QC fallback:", lastError);
  const fallback = fallbackEditorialQC(p);
  fallback.qcIssues = lastError ? ["AI-QC fallback: " + lastError.slice(0, 180)] : [];
  return fallback;
}

async function classifyPublishedStoryRelationship(item) {
  if (!item) return { relation: "new_story", candidate: null, reason: "" };
  const cutoff = Date.now() - STORY_UPDATE_WINDOW_HOURS * 60 * 60 * 1000;
  let best = null;
  let bestScore = 0;

  for (const h of (state.history || [])) {
    if (!h || !h.publishedAt || new Date(h.publishedAt).getTime() < cutoff) continue;
    const score = storySimilarity(
      Object.assign({}, item, { sourceId: "new:" + String(item.sourceId || item.sourceName || "") }),
      Object.assign({}, h, { sourceId: "published:" + String(h.sourceId || h.sourceName || "") })
    );
    if (score > bestScore) { bestScore = score; best = h; }
  }
  if (!best || bestScore < 0.16) return { relation: "new_story", candidate: null, reason: "" };

  if (!OPENAI_API_KEY) {
    return bestScore >= 0.55
      ? { relation: "possible_update", candidate: best, similarity: bestScore, reason: "Похож на недавно опубликованный сюжет" }
      : { relation: "new_story", candidate: null, similarity: bestScore, reason: "" };
  }

  const prompt = [
    "Сравни новую новость с уже опубликованным постом.",
    "Определи одно из трёх:",
    "duplicate — по сути те же факты, существенного нового нет;",
    "update — это развитие того же сюжета и есть новый важный факт/цифра/решение/дата;",
    "new_story — отдельное событие, даже если компания/тема та же.",
    "Не путай новости одной компании с одним событием.",
    "Верни строго JSON: {\"relation\":\"duplicate|update|new_story\",\"new_fact\":\"что именно новое\",\"reason\":\"коротко\"}.",
    "NEW: " + JSON.stringify({ title: item.title, text: String(item.text || "").slice(0, 2600), entities: item.topicEntities || [] }),
    "PUBLISHED: " + JSON.stringify({ title: best.title, text: String(best.text || "").slice(0, 2600), entities: best.topicEntities || [] })
  ].join("\n");

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + OPENAI_API_KEY },
      body: JSON.stringify({ model: OPENAI_MODEL, input: prompt, max_output_tokens: 600 }),
      signal: AbortSignal.timeout(30000)
    });
    const data = await response.json().catch(function(){ return {}; });
    if (!response.ok) throw new Error(data && data.error && data.error.message || ("HTTP " + response.status));
    recordOpenAIResponseUsage(OPENAI_MODEL, "story_relation", data, "responses", { news_id: item.newsId || item.id || "" });
    const output = extractOpenAIText(data);
    const parsed = JSON.parse(String(output || "").replace(/^\s*```json\s*/i, "").replace(/\s*```\s*$/i, ""));
    const relation = ["duplicate","update","new_story"].includes(String(parsed.relation)) ? String(parsed.relation) : "new_story";
    return {
      relation: relation,
      candidate: relation === "new_story" ? null : best,
      similarity: bestScore,
      judged: true,
      newFact: String(parsed.new_fact || "").trim(),
      reason: String(parsed.reason || "").trim()
    };
  } catch (error) {
    console.warn("Story update classifier fallback:", error.message);
    return { relation: "new_story", candidate: null, similarity: bestScore, reason: "" };
  }
}

async function callOpenAIStoryComposer(storySources, existingItem, incomingItem) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY не настроен");
  const sources = (storySources || []).slice(0, STORY_CLUSTER_MAX_SOURCES).map(function(source, index) {
    return {
      n: index + 1,
      source: String(source.sourceName || "Источник"),
      role: sourceRoleLabel(source.sourceRole || sourceEditorialRole(source)),
      url: String(source.url || ""),
      title: String(source.title || "").slice(0, 300),
      text: String(source.text || "").slice(0, 4200)
    };
  });
  if (sources.length < 2) throw new Error("Для сюжета нужно минимум два источника");

  const channelName = String(currentWorkspace().name || "News Factory");
  const combinedTitle = [existingItem && existingItem.title, incomingItem && incomingItem.title].filter(Boolean).join(" | ");
  const combinedText = sources.map(function(x){ return x.title + " " + x.text.slice(0, 700); }).join(" ");
  const editorialFormat = selectEditorialFormat({
    title: combinedTitle,
    text: combinedText,
    sourceName: sources.map(function(x){ return x.source; }).join(", "),
    sourceGroup: "story"
  });

  const prompt = [
    "Ты выпускающий редактор Telegram-канала «" + channelName + "». Перед тобой несколько материалов, которые алгоритм считает похожими.",
    "Сначала проверь: это действительно одно и то же конкретное событие/релиз/заявление, а не просто новости об одной компании или теме.",
    "Если события разные — верни same_story=false и не объединяй их. Если это один сюжет — same_story=true и собери один сильный самостоятельный пост.",
    "",
    "ПРАВИЛА СИНТЕЗА:",
    "- используй только факты из переданных материалов; ничего не додумывай;",
    "- убирай повторы и объединяй совпадающие факты;",
    "- если важная деталь есть только у одного источника, при необходимости атрибутируй её этому источнику;",
    "- если источники расходятся в цифрах, датах или трактовках — не выбирай молча одну версию, а кратко обозначь расхождение;",
    "- учитывай поле role каждого материала: официальный первичный источник — опора для характеристик/дат; СМИ — контекст; автор/блогер — мнение, опыт и демонстрация с атрибуцией;",
    "- COPYRIGHT SAFE: полностью новая структура и формулировки; никаких длинных дословных фрагментов;",
    "- прямую цитату используй только если она действительно важна, максимум 8 слов подряд и с атрибуцией;",
    "- ссылки на источники в текст не вставляй — система добавит их сама.",
    "",
    "ФОРМАТ ЭТОГО ПОСТА: " + editorialFormat.label + ".",
    editorialFormat.instruction,
    "- Первый экран должен цеплять реальной ценностью: сильный факт, понятное следствие, контраст или короткий вопрос — без кликбейта.",
    "- Не используй одинаковый шаблон «что произошло / почему важно / что дальше» буквально в каждом посте.",
    "- Допускаются 1–3 уместных emoji, максимум одно выделение строкой через > и 1–3 фразы **жирным**.",
    "- Финальный вопрос — только если он естественный. Иначе закончи сильным фактом.",
    "",
    "ДЛИНА: примерно 700–1050 знаков, 4–7 коротких визуальных блоков.",
    "",
    "ОЦЕНКА:",
    "importance 0–25, audience_interest 0–20, novelty 0–20, virality 0–15, usefulness 0–10, credibility 0–10.",
    "editorial_score — сумма, строго 0–100. Несколько независимых источников могут повышать credibility, но не должны искусственно завышать importance.",
    "",
    "Верни строго JSON:",
    "{\"same_story\":true,\"story_key\":\"короткий ключ события\",\"title\":\"...\",\"text\":\"...\",\"confidence\":\"high|medium|low\",\"editorial_score\":0,\"score_breakdown\":{\"importance\":0,\"audience_interest\":0,\"novelty\":0,\"virality\":0,\"usefulness\":0,\"credibility\":0},\"score_reason\":\"...\"}",
    "Если same_story=false: title и text оставь пустыми.",
    "",
    "МАТЕРИАЛЫ:",
    JSON.stringify(sources)
  ].join("\n");

  const models = [OPENAI_MODEL, OPENAI_FALLBACK_MODEL].filter(function(v, i, a){ return v && a.indexOf(v) === i; });
  let lastError = "";
  for (const model of models) {
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + OPENAI_API_KEY },
        body: JSON.stringify({ model: model, input: prompt, max_output_tokens: 1800 }),
        signal: AbortSignal.timeout(50000)
      });
      const data = await response.json().catch(function(){ return {}; });
      if (!response.ok) {
        lastError = data && data.error && data.error.message || ("OpenAI HTTP " + response.status);
        continue;
      }
      recordOpenAIResponseUsage(model, "story_composer", data, "responses", { news_id: incomingItem && (incomingItem.newsId || incomingItem.id) || "" });
      const output = extractOpenAIText(data);
      if (!output) { lastError = "OpenAI вернул пустой сюжет"; continue; }
      let parsed;
      try {
        parsed = JSON.parse(output.replace(/^\s*```json\s*/i, "").replace(/\s*```\s*$/i, ""));
      } catch {
        parsed = parseLooseRewriteOutput(output);
      }
      if (!parsed) { lastError = "Не удалось разобрать сюжет"; continue; }
      if (parsed.same_story === false || String(parsed.same_story).toLowerCase() === "false") {
        return { sameStory: false, model: model };
      }
      if (!String(parsed.text || "").trim()) { lastError = "Не удалось разобрать сюжет"; continue; }

      const raw = parsed.score_breakdown && typeof parsed.score_breakdown === "object" ? parsed.score_breakdown : {};
      const clamp = function(value, max) {
        const n = Number(value);
        return Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n))) : 0;
      };
      const breakdown = {
        importance: clamp(raw.importance, 25),
        audience_interest: clamp(raw.audience_interest, 20),
        novelty: clamp(raw.novelty, 20),
        virality: clamp(raw.virality, 15),
        usefulness: clamp(raw.usefulness, 10),
        credibility: clamp(raw.credibility, 10)
      };
      const sum = Object.values(breakdown).reduce(function(total, value){ return total + value; }, 0);
      const parsedScore = Number(parsed.editorial_score);
      const editorialScore = sum > 0 ? sum : (Number.isFinite(parsedScore) ? Math.max(0, Math.min(100, Math.round(parsedScore))) : 60);
      const result = {
        sameStory: true,
        storyKey: String(parsed.story_key || "").trim(),
        title: String(parsed.title || combinedTitle || channelName).trim(),
        text: String(parsed.text || "").trim(),
        confidence: ["high","medium","low"].includes(String(parsed.confidence)) ? String(parsed.confidence) : "medium",
        editorialScore: editorialScore,
        scoreBreakdown: breakdown,
        scoreReason: String(parsed.score_reason || "").trim(),
        contentFormat: editorialFormat.id,
        contentFormatLabel: editorialFormat.label,
        model: model
      };

      if (COPYRIGHT_SAFE_MODE) {
        const combinedOutput = result.title + " " + result.text;
        const overlap = sources.find(function(source){
          return findVerbatimOverlap(source.title + " " + source.text, combinedOutput, COPYRIGHT_MAX_VERBATIM_WORDS);
        });
        if (overlap) { lastError = "Copyright Safe Mode: сюжет слишком близок к одному из источников"; continue; }
      }
      return result;
    } catch (error) {
      lastError = String(error && error.message || error);
    }
  }
  throw new Error(lastError || "Не удалось собрать сюжет");
}

async function tryMergeStoryQueueItem(newItem) {
  const match = findStoryClusterCandidate(newItem);
  if (!match) return null;

  const target = match.item;
  const sources = mergeStorySources(target, newItem);
  const distinctNames = new Set(sources.map(function(source){ return String(source.sourceName || "").toLowerCase(); }).filter(Boolean));
  if (sources.length < 2 || distinctNames.size < 2) return null;

  let composed;
  let storyV2 = null;
  if (editorialV2Active()) {
    try {
      storyV2 = await runEditorialV2(sources.map(function(source) {
        return {
          name: source.sourceName || "Источник",
          url: source.url || "",
          date: source.publishedAt || "",
          role: sourceRoleLabel(source.sourceRole || sourceEditorialRole(source)),
          title: source.title || "",
          text: source.text || "",
          photos: [source.originalImageUrl].filter(Boolean)
        };
      }), { mergeCheck: true, hasPhoto: true, newsId: newItem.newsId || newItem.id });
    } catch (error) {
      console.warn("Story editorial v2 skipped:", error.message);
      return null;
    }
    if (storyV2.skip) {
      if (storyV2.reason === "different_story") return null;
      // Same event, but the writer saw nothing worth rewriting: absorb the new source
      // into the existing story (no duplicate post), keep the already checked text.
      const refs = sources.map(function(source){ return { name: source.sourceName || "Источник", url: source.url || "" }; }).filter(function(x){ return x.url; });
      Object.assign(target, {
        sources: refs,
        sourceUrls: refs.map(function(x){ return x.url; }),
        storySources: sources,
        storyNewsIds: Array.from(new Set(sources.map(function(source){ return source.newsId; }).filter(Boolean))),
        updatedAt: new Date().toISOString()
      });
      return target;
    }
    composed = {
      sameStory: true,
      title: storyV2.rewrite.title,
      text: storyV2.rewrite.text,
      storyKey: "",
      editorialScore: storyV2.rewrite.editorialScore,
      scoreBreakdown: storyV2.rewrite.scoreBreakdown,
      scoreReason: storyV2.rewrite.scoreReason,
      contentFormat: storyV2.rewrite.contentFormat,
      contentFormatLabel: storyV2.rewrite.contentFormatLabel,
      model: storyV2.rewrite.model
    };
  } else {
    try {
      composed = await callOpenAIStoryComposer(sources, target, newItem);
    } catch (error) {
      console.warn("Story composer skipped:", error.message);
      return null;
    }
  }

  if (!composed || composed.sameStory === false) return null;

  // One media for the merged story with the usual priority: video → real photo → one
  // generated cover (no generated multi-image packs).
  const storyVideo = String(target.videoUrl || newItem.videoUrl || "").trim();
  const storyPhoto = String(target.imageUrl || newItem.imageUrl || "").trim();
  let storyGenerated = String(target.generatedImageUrl || newItem.generatedImageUrl || "").trim();
  if (!storyVideo && !storyPhoto && !storyGenerated && GENERATE_COVER_IF_MISSING) {
    try {
      const cover = await generateNewsCover({
        id: "story_" + stableHashNumber(sources.map(function(x){ return x.url || x.newsId; }).join("|")),
        title: composed.title,
        text: composed.text,
        sourceName: sources.map(function(x){ return x.sourceName; }).join(", ")
      });
      storyGenerated = cover && cover.url || "";
    } catch (error) {
      console.warn("Story cover failed:", error.message);
    }
  }
  const mediaPack = [];
  const existingPack = [storyPhoto].filter(Boolean);
  const mediaPackUrls = [storyPhoto || storyGenerated].filter(Boolean);
  const storyFromTarget = Boolean(target.videoUrl || target.imageUrl);
  const storyMediaSource = storyFromTarget ? target : newItem;

  const storyId = String(target.storyCluster && target.storyCluster.id || ("story_" + crypto.randomBytes(6).toString("hex")));
  const sourceRefs = sources.map(function(source){ return { name: source.sourceName || "Источник", url: source.url || "" }; }).filter(function(x){ return x.url; });
  const newsIds = Array.from(new Set(sources.map(function(source){ return source.newsId; }).filter(Boolean)));

  Object.assign(target, {
    title: composed.title,
    text: composed.text,
    updatedAt: new Date().toISOString(),
    sourceGroup: "story",
    sourceName: sources.length + " источника",
    sourceUrl: sourceRefs[0] && sourceRefs[0].url || target.sourceUrl || "",
    sourceUrls: sourceRefs.map(function(x){ return x.url; }),
    sources: sourceRefs,
    storySources: sources,
    storyNewsIds: newsIds,
    storyCluster: {
      id: storyId,
      key: composed.storyKey || "",
      sourceCount: sources.length,
      similarity: Math.round(match.similarity * 100) / 100,
      updatedAt: new Date().toISOString()
    },
    imageUrl: storyPhoto || (storyVideo ? String(storyMediaSource.imageUrl || "") : ""),
    videoUrl: storyVideo,
    originalImageUrl: String(storyMediaSource.originalImageUrl || ""),
    originalVideoUrl: String(storyMediaSource.originalVideoUrl || storyVideo || ""),
    generatedImageUrl: storyPhoto || storyVideo ? String(target.generatedImageUrl || "") : storyGenerated,
    mediaPackUrls: mediaPackUrls,
    mediaPack: mediaPack,
    mediaType: storyVideo ? "video" : (storyPhoto ? "photo" : "generated"),
    mediaStatus: storyVideo ? "video_found" : (storyPhoto ? (storyMediaSource.mediaStatus || "photo_found") : "generated"),
    mediaOrigin: storyVideo || storyPhoto ? "source_media" : "ai_generated",
    mediaLicense: String(storyMediaSource.mediaLicense || "unknown"),
    copyrightSafe: true,
    copyrightPolicyVersion: "v1",
    copyrightMediaDecision: "multi_source_original_pack",
    canEnhance: false,
    aiScore: composed.editorialScore,
    aiScoreBreakdown: composed.scoreBreakdown,
    aiScoreReason: composed.scoreReason,
    aiTier: composed.editorialScore >= AI_TOP_NEWS_SCORE ? "top" : (composed.editorialScore >= AI_STRONG_NEWS_SCORE ? "strong" : "normal"),
    contentFormat: composed.contentFormat,
    contentFormatLabel: composed.contentFormatLabel,
    storyComposerModel: composed.model
  });

  const sourceTextForQc = sources.map(function(source){
    return String(source.title || "") + "\n" + String(source.text || "");
  }).join("\n\n---\n\n").slice(0, 12000);
  if (storyV2) target.editorialV2 = storyV2.meta;
  const qc = storyV2 ? storyV2.qc : await callOpenAIEditorialQC({
    title: target.title,
    text: target.text,
    sourceTitle: sources.map(function(source){ return source.title; }).filter(Boolean).join(" | ").slice(0, 1000),
    sourceText: sourceTextForQc,
    sourceName: target.sourceName,
    sourceGroup: "story",
    sourceRole: "multi_source",
    contentFormat: target.contentFormat,
    contentFormatLabel: target.contentFormatLabel,
    imageUrl: target.imageUrl || "",
    generatedImageUrl: target.generatedImageUrl || "",
    videoUrl: target.videoUrl || "",
    mediaPackUrls: target.mediaPackUrls || [],
    mediaOrigin: target.mediaOrigin || "",
    mediaDirector: { strategy: existingPack.length >= 2 ? "multi_source_real_media" : "multi_source_mixed_media", selectedCount: target.mediaPackUrls.length }
  });
  target.title = qc.title || target.title;
  target.text = qc.text || target.text;
  target.qualityScore = qc.qualityScore;
  target.qualityBreakdown = qc.qualityBreakdown;
  target.qcStatus = qc.qcStatus;
  target.qcIssues = qc.qcIssues;
  target.qcRepaired = qc.qcRepaired;
  target.topicEntities = qc.topicEntities;
  target.platformVariants = qc.platformVariants;
  target.sourceRole = "multi_source";
  target.decisionSummary = qc.decisionSummary;
  target.mediaOrigin = existingPack.length ? "source_media" : target.mediaOrigin;
  target.mediaStatus = target.mediaPackUrls.length > 1 ? "photo_found" : target.mediaStatus;
  target.copyrightSafe = COPYRIGHT_SAFE_MODE;
  target.copyrightPolicyVersion = "v2";

  return target;
}

// News that never became a post (skipped, failed, no media, duplicate) keep their
// original — often English — headline. The admin feed shows a Russian translation
// stored in metadata.titleRu; this fills it for older rows in small batches.
async function translateTitlesToRussian(items) {
  if (!OPENAI_API_KEY || !Array.isArray(items) || !items.length) return [];
  const compact = items.slice(0, 40).map(function(item){ return { id: String(item.id || ""), title: String(item.title || "").slice(0, 300) }; });
  const prompt = [
    "Переведи заголовки новостей на русский язык.",
    "Перевод нейтральный и точный, до 120 символов, без эмодзи, без оценок, ничего не добавляй.",
    "Названия компаний, моделей и продуктов оставляй как в оригинале (NIO, Tesla, GPT-6).",
    "Служебные хвосты сайтов вроде « - News | NIO» или « | Reuters» отбрасывай.",
    "Верни строго JSON без markdown: {\"items\":[{\"id\":\"...\",\"title_ru\":\"...\"}]}",
    "",
    JSON.stringify(compact)
  ].join("\n");
  const candidates = [OPENAI_MODEL, OPENAI_FALLBACK_MODEL].filter(function(v, i, a){ return v && a.indexOf(v) === i; });
  for (const model of candidates) {
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + OPENAI_API_KEY },
        body: JSON.stringify({ model: model, input: prompt, max_output_tokens: 3000 }),
        signal: AbortSignal.timeout(45000)
      });
      const data = await response.json().catch(function(){ return {}; });
      if (!response.ok) continue;
      recordOpenAIResponseUsage(model, "title_translation", data, "responses");
      const output = extractOpenAIText(data);
      if (!output) continue;
      const parsed = JSON.parse(output.replace(/^\s*```json\s*/i, "").replace(/\s*```\s*$/i, ""));
      const allowed = new Set(compact.map(function(x){ return x.id; }));
      return (Array.isArray(parsed && parsed.items) ? parsed.items : [])
        .map(function(x){ return { id: String(x && x.id || ""), titleRu: String(x && x.title_ru || "").replace(/<[^>]+>/g, "").trim().slice(0, 160) }; })
        .filter(function(x){ return allowed.has(x.id) && /[А-Яа-яЁё]/.test(x.titleRu); });
    } catch (error) {
      console.warn("Title translation batch failed:", error.message);
    }
  }
  return [];
}

async function backfillRussianNewsTitles(limit) {
  if (!db || !dbReady || !OPENAI_API_KEY) return { ok: false, translated: 0, skipped: "unavailable" };
  const safeLimit = Math.max(1, Math.min(40, Number(limit || 40)));
  const rows = await db.query(
    `SELECT id, original_title AS title FROM news_items
      WHERE workspace_id=$1
        AND COALESCE(rewritten_title, '') = ''
        AND COALESCE(original_title, '') <> ''
        AND original_title !~ '[А-Яа-яЁё]'
        AND (metadata->>'titleRu' IS NULL OR metadata->>'titleRu' = '')
      ORDER BY detected_at DESC
      LIMIT $2`,
    [currentWorkspaceId(), safeLimit]
  );
  if (!rows.rows.length) return { ok: true, translated: 0 };
  const translated = await translateTitlesToRussian(rows.rows);
  let count = 0;
  for (const t of translated) {
    const updated = await db.query(
      "UPDATE news_items SET metadata=COALESCE(metadata,'{}'::jsonb) || $2::jsonb, updated_at=NOW() WHERE id=$1 AND workspace_id=$3",
      [t.id, JSON.stringify({ titleRu: t.titleRu }), currentWorkspaceId()]
    );
    count += updated.rowCount || 0;
  }
  return { ok: true, translated: count };
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
  const channelName = String(currentWorkspace().name || "News Factory");
  const prompt = [
    "Ты выпускающий редактор новостного канала «" + channelName + "».",
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
      recordOpenAIResponseUsage(model, "editorial_score_batch", data, "responses");
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
  const params = [currentWorkspaceId()];
  let where = "workspace_id=$1 AND status <> 'editorial_skip' AND (metadata->>'editorialScore' IS NULL OR metadata->>'editorialScore'='') AND COALESCE(rewritten_text, original_text, '') <> ''";
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
        "UPDATE news_items SET metadata=COALESCE(metadata,'{}'::jsonb) || $2::jsonb, updated_at=NOW() WHERE id=$1 AND workspace_id=$3",
        [score.id, JSON.stringify({
          editorialScore: score.editorialScore,
          scoreBreakdown: score.scoreBreakdown,
          scoreReason: score.scoreReason,
          scoreBackfilledAt: new Date().toISOString()
        }), currentWorkspaceId()]
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
  const cacheKey = currentWorkspaceId();
  const cached = statusCache.get(cacheKey);
  if (!force && cached && cached.value && now - cached.at < 30000) return cached.value;
  const telegramChannel = currentTelegramChannel();

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
    BOT_TOKEN && telegramChannel ? telegramProbe("getChat", { chat_id: telegramChannel }) : Promise.resolve({ ok: false, error: "Канал или токен не заданы" }),
    OPENAI_API_KEY ? openAIModelProbe() : Promise.resolve({ ok: false, error: "OPENAI_API_KEY не задан" }),
    ANTHROPIC_API_KEY ? anthropicEditorialProbe(Boolean(force)) : Promise.resolve({ ok: false, error: "ANTHROPIC_API_KEY не задан" }),
    VK_ACCESS_TOKEN && VK_GROUP_ID ? vkProbe() : Promise.resolve({ ok: false, error: "VK не настроен" }),
    githubAutomationProbe()
  ]);
  const botProbe = probes[0];
  const chatProbe = probes[1];
  const openaiProbe = probes[2];
  const anthropicProbe = probes[3];
  const vkStatusProbe = probes[4];
  const githubAutomation = probes[5];

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
      state: chatProbe.ok ? "connected" : (telegramChannel ? "partial" : "missing"),
      description: chatProbe.ok ? "Канал доступен боту" : "Доступ к каналу не подтверждён",
      detail: chatProbe.ok && chatProbe.result ? ((chatProbe.result.title || telegramChannel) + " · " + telegramChannel) : String(chatProbe.error || telegramChannel || ""),
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
    editorialV2: {
      state: !editorialV2Active()
        ? (EDITORIAL_V2_ENABLED ? "missing" : "partial")
        : (!ANTHROPIC_API_KEY ? "partial" : (openaiProbe.ok && anthropicProbe.ok ? "connected" : "partial")),
      description: !editorialV2Active()
        ? (EDITORIAL_V2_ENABLED ? "Редакция v2 не запустилась — работает старая схема" : "Редакция v2 выключена (EDITORIAL_V2_ENABLED=false)")
        : (!ANTHROPIC_API_KEY
          ? "Редакция v2 работает, но проверка только GPT"
          : (openaiProbe.ok && anthropicProbe.ok
            ? "Редакция v2: автор GPT + двойная проверка GPT и Claude"
            : "Редакция v2 настроена, но один из проверщиков не прошёл живую проверку")),
      detail: "Канал: " + (resolveChannelId(currentWorkspace()) || "профиль не определён") +
        " · GPT: " + (openaiProbe.ok ? openaiProbe.model : "ошибка") +
        " · Claude: " + (anthropicProbe.ok ? (anthropicProbe.model + (anthropicProbe.structured ? " · JSON schema OK" : " · JSON fallback")) : String(anthropicProbe.error || (ANTHROPIC_API_KEY ? "ошибка" : "нет ключа"))) +
        " · исправлений до " + EDITORIAL_V2_MAX_FIX_ROUNDS +
        (editorialPromptError ? " · ошибка промпта: " + editorialPromptError : ""),
      next: !EDITORIAL_V2_ENABLED ? "" :
        (!editorialV2Active() ? "Проверить OPENAI_API_KEY и файл prompts/chto-tam.md" :
          (!ANTHROPIC_API_KEY ? "Добавить ANTHROPIC_API_KEY для второй проверки" :
            (!openaiProbe.ok ? "Проверить OpenAI API и биллинг" :
              (!anthropicProbe.ok ? "Проверить Anthropic API, модель и формат ответа" : ""))))
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
  statusCache.set(cacheKey, { at: now, value: result });
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
        telegramConfigured: Boolean(BOT_TOKEN && workspaceStore.workspaces.some(function(ws){ return Boolean(ws.telegramChannel); })),
        workspaceCount: workspaceStore.workspaces.length,
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

    const requestedWorkspaceId = String(req.headers["x-workspace-id"] || url.searchParams.get("workspace") || "").trim();
    const selectedWorkspace = getWorkspaceById(requestedWorkspaceId) || getWorkspaceById(workspaceStore.defaultWorkspaceId) || workspaceStore.workspaces[0];
    workspaceContext.enterWith({ workspaceId: selectedWorkspace.id });

    if (req.method === "GET" && p === "/api/costs") {
      const days = Number(url.searchParams.get("days") || 30);
      const scope = String(url.searchParams.get("scope") || "network").toLowerCase() === "workspace" ? "workspace" : "network";
      const period = String(url.searchParams.get("period") || "").toLowerCase();
      return sendJson(res, 200, await buildCostsReport(days, scope, currentWorkspaceId(), period), { "cache-control": "no-store" });
    }
    if (req.method === "POST" && p === "/api/costs/budget") {
      const body = await readJson(req);
      const b = networkCostBudgetState();
      if (Object.prototype.hasOwnProperty.call(body,"monthlyRub")) b.monthlyRub = Math.max(0, Number(body.monthlyRub || 0) || 0);
      if (Object.prototype.hasOwnProperty.call(body,"dailyRub")) b.dailyRub = Math.max(0, Number(body.dailyRub || 0) || 0);
      b.updatedAt = new Date().toISOString();
      persistWorkspaceStore();
      return sendJson(res,200,{ok:true,budget:await evaluateCostBudget(true)});
    }

    if (req.method === "GET" && p === "/api/editorial/registry") {
      return sendJson(res, 200, { ok: true, registry: loadEditorialRegistry() });
    }
    if ((req.method === "POST" || req.method === "PUT") && p === "/api/editorial/registry") {
      const body = await readJson(req, 4 * 1024 * 1024);
      const current = loadEditorialRegistry();
      const registry = saveEditorialRegistry({
        banned_orgs: body.banned_orgs != null ? body.banned_orgs : current.banned_orgs,
        foreign_agents: body.foreign_agents != null ? body.foreign_agents : current.foreign_agents
      });
      return sendJson(res, 200, { ok: true, registry: registry });
    }
    if (req.method === "POST" && p === "/api/editorial/rebuild-queue") {
      const result = await rebuildQueueWithEditorialV2();
      return sendJson(res, result.ok ? 200 : 409, result);
    }
    if (req.method === "GET" && p === "/api/editorial/status") {
      const recent = (state.queue || []).concat(state.history || []).filter(function(item){ return item && item.editorialV2; }).slice(0, 20);
      const anthropicHealth = ANTHROPIC_API_KEY ? await anthropicEditorialProbe(false) : { ok: false, error: "ANTHROPIC_API_KEY не задан" };
      return sendJson(res, 200, {
        ok: true,
        enabled: EDITORIAL_V2_ENABLED,
        active: editorialV2Active(),
        operational: editorialV2Active() && Boolean(OPENAI_API_KEY) && (!EDITORIAL_V2_REQUIRE_ALL_CHECKERS || (Boolean(ANTHROPIC_API_KEY) && anthropicHealth.ok)),
        promptError: editorialPromptError || null,
        channelId: resolveChannelId(currentWorkspace()),
        checkers: ["openai:" + OPENAI_MODEL].concat(ANTHROPIC_API_KEY ? ["anthropic:" + ANTHROPIC_MODEL] : []),
        checkerHealth: {
          openai: { configured: Boolean(OPENAI_API_KEY) },
          anthropic: { configured: Boolean(ANTHROPIC_API_KEY), ok: Boolean(anthropicHealth.ok), model: anthropicHealth.ok ? anthropicHealth.model : "", structured: Boolean(anthropicHealth.structured), error: anthropicHealth.ok ? "" : String(anthropicHealth.error || "") }
        },
        requireAllCheckers: EDITORIAL_V2_REQUIRE_ALL_CHECKERS,
        maxFixRounds: EDITORIAL_V2_MAX_FIX_ROUNDS,
        recent: recent.map(function(item){ return { title: item.title, verdict: item.editorialV2.verdict, importance: item.editorialV2.importance, checkers: item.editorialV2.checkers, rounds: item.editorialV2.rounds, errors: item.editorialV2.errors }; })
      });
    }
    if (req.method === "GET" && p === "/api/workspaces") {
      return sendJson(res, 200, { ok: true, activeWorkspaceId: currentWorkspaceId(), defaultWorkspaceId: workspaceStore.defaultWorkspaceId, workspaces: workspaceStore.workspaces.map(publicWorkspaceMeta) });
    }
    if (req.method === "POST" && p === "/api/workspaces") {
      const body = await readJson(req);
      const name = String(body.name || "").trim().slice(0, 80);
      if (!name) return sendJson(res, 400, { ok: false, error: "Укажите название канала" });
      const base = String(body.slug || body.telegramPublicUsername || name).toLowerCase().replace(/^@/, "").replace(/[^a-z0-9а-яё_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "channel";
      let id = base, suffix = 2;
      while (getWorkspaceById(id)) id = base + "-" + suffix++;
      const workspace = normalizeWorkspaceMeta({
        id: id, name: name,
        slug: String(body.slug || body.telegramPublicUsername || "").replace(/^@/, "").trim(),
        initials: String(body.initials || "").trim(),
        telegramChannel: String(body.telegramChannel || body.telegramPublicUsername || "").trim(),
        telegramPublicUsername: String(body.telegramPublicUsername || body.telegramChannel || "").replace(/^@/, "").trim(),
        channelId: String(body.channelId || "").trim().toLowerCase(),
        state: freshWorkspaceState()
      }, id);
      workspaceStore.workspaces.push(workspace);
      persistWorkspaceStore();
      return sendJson(res, 201, { ok: true, workspace: publicWorkspaceMeta(workspace) });
    }
    if (req.method === "POST" && p === "/api/workspaces/update") {
      const body = await readJson(req);
      const workspace = getWorkspaceById(String(body.id || currentWorkspaceId()));
      if (!workspace) return sendJson(res, 404, { ok: false, error: "Кабинет не найден" });
      if (body.name != null) workspace.name = String(body.name || "").trim().slice(0, 80) || workspace.name;
      if (body.initials != null) workspace.initials = String(body.initials || "").trim().toUpperCase().replace(/[^A-ZА-Я0-9]/gi, "").slice(0, 3) || workspace.initials;
      if (body.slug != null) workspace.slug = String(body.slug || "").replace(/^@/, "").trim().slice(0, 80);
      if (body.telegramChannel != null) workspace.telegramChannel = String(body.telegramChannel || "").trim();
      if (body.telegramPublicUsername != null) workspace.telegramPublicUsername = String(body.telegramPublicUsername || "").replace(/^@/, "").trim();
      if (body.channelId != null) {
        const requestedChannelId = String(body.channelId || "").trim().toLowerCase();
        if (requestedChannelId && !EDITORIAL_CHANNEL_IDS.includes(requestedChannelId)) return sendJson(res, 400, { ok: false, error: "Неизвестный профиль канала: " + requestedChannelId + ". Допустимо: " + EDITORIAL_CHANNEL_IDS.join(", ") });
        workspace.channelId = requestedChannelId;
      }
      workspace.updatedAt = new Date().toISOString();
      persistWorkspaceStore();
      statusCache.delete(workspace.id);
      analyticsCache.delete(workspace.id);
      return sendJson(res, 200, { ok: true, workspace: publicWorkspaceMeta(workspace) });
    }
    if (req.method === "POST" && p === "/api/workspaces/avatar") {
      const body = await readJson(req, 10 * 1024 * 1024);
      const workspace = getWorkspaceById(String(body.id || currentWorkspaceId()));
      if (!workspace) return sendJson(res, 404, { ok: false, error: "Кабинет не найден" });
      try {
        await saveWorkspaceAvatar(workspace, body.image);
        return sendJson(res, 200, { ok: true, workspace: publicWorkspaceMeta(workspace) });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error.message || "Не удалось сохранить фото" });
      }
    }

    if (req.method === "POST" && p === "/api/workspaces/avatar/remove") {
      const body = await readJson(req);
      const workspace = getWorkspaceById(String(body.id || currentWorkspaceId()));
      if (!workspace) return sendJson(res, 404, { ok: false, error: "Кабинет не найден" });
      removeWorkspaceAvatar(workspace);
      return sendJson(res, 200, { ok: true, workspace: publicWorkspaceMeta(workspace) });
    }

    if (req.method === "POST" && p === "/api/workspaces/remove") {
      const body = await readJson(req), id = String(body.id || "");
      if (!id || id === workspaceStore.defaultWorkspaceId) return sendJson(res, 400, { ok: false, error: "Основной кабинет удалить нельзя" });
      const deletingWorkspace = getWorkspaceById(id);
      if (!deletingWorkspace) return sendJson(res, 404, { ok: false, error: "Кабинет не найден" });
      removeWorkspaceAvatar(deletingWorkspace);
      workspaceStore.workspaces = workspaceStore.workspaces.filter(function(ws){ return ws.id !== id; });
      persistWorkspaceStore();
      statusCache.delete(id); analyticsCache.delete(id);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && p === "/api/media/enhance-queue") {
      const body = await readJson(req);
      const result = await backfillQueueImageEnhancements({ force: Boolean(body && body.force) });
      return sendJson(res, 200, { ok: true, result: result });
    }

    if (req.method === "GET" && p === "/api/dashboard") {
      const cleanup = pruneQueueItems(state);
      if (cleanup.removed) saveState();
      for (const item of (state.queue || [])) {
        if (!item) continue;
        item.priorityScore = Math.round(dynamicItemScore(item));
        item.decisionExplanation = buildDecisionExplanation(item);
        item.decisionExplanation.priorityScore = item.priorityScore;
      }
      return sendJson(res, 200, { ok: true, state: state, workspace: publicWorkspaceMeta(currentWorkspace()), sourceRankings: buildSourceRankings(), ratingMinAuto: POST_RATING_MIN_AUTO, ratingDropBelow: POST_RATING_DROP_BELOW });
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
      if (!item.sourceSelectedAt) {
        noteSourceEvent(item, "selected");
        item.sourceSelectedAt = new Date().toISOString();
      }
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
      const slot = (schedule.slots || []).find(function(entry){ return entry && entry.time === time; });
      const pickKind = slot && slot.kind === "blogger" ? "blogger" : (slot && slot.kind === "russian-ai" ? "russian-ai" : undefined);
      const item = dynamicAssignBest(day, time, pickKind);
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
      status.costBudget = await costBudgetSnapshot();
      return sendJson(res, 200, status);
    }

    if (req.method === "POST" && p === "/api/news/backfill-scores") {
      const result = await backfillRecentNewsEditorialScores(30);
      const titles = await backfillRussianNewsTitles(40).catch(function(error){ return { ok: false, translated: 0, error: error.message }; });
      result.titlesTranslated = titles.translated || 0;
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
        running: isCollectorRunning(),
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
        lastRun: lastCollectorRuns.get(currentWorkspaceId()) || null,
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
      const result = await sendTelegram("✅ News Factory подключён\n\nАвтопубликация в «" + String(currentWorkspace().name || "текущий канал") + "» работает.\nТест: " + marker);
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
        videoUrl: String(body.videoUrl || "").trim(),
        mediaLicense: "user_provided"
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
        originalImageUrl: media.originalImageUrl || "",
        originalVideoUrl: media.originalVideoUrl || "",
        generatedImageUrl: media.generatedImageUrl,
        videoUrl: media.videoUrl,
        mediaStatus: media.mediaStatus || "",
        mediaOrigin: media.mediaOrigin || "",
        mediaLicense: media.mediaLicense || "user_provided"
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
      state.sources.push({ id: newId("src"), name: name, type: "web", group: "custom", priority: 3, url: sourceUrl, enabled: true, mediaLicense: "unknown", copyrightMode: "facts_only" });
      saveState();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && p === "/api/report/daily") {
      const result = await sendDailyReport(true);
      return sendJson(res, result.ok ? 200 : 409, result);
    }
    if (req.method === "POST" && p === "/api/digest/publish") {
      const body = await readJson(req);
      const result = await publishDigest(body.kind === "sunday" ? "sunday" : "evening");
      return sendJson(res, result.ok ? 200 : 409, result);
    }

    if (req.method === "POST" && p === "/api/sources/target") {
      const body = await readJson(req);
      const target = Math.max(0, Math.min(200, Math.round(Number(body.target))));
      if (!Number.isFinite(target)) return sendJson(res, 400, { ok: false, error: "Укажите число" });
      state.sourceTarget = target;
      if (state.sourceReplenish) state.sourceReplenish.lastAt = "";
      saveState();
      const result = await replenishSources("target_changed");
      return sendJson(res, 200, { ok: true, target: target, result: result });
    }

    if (req.method === "POST" && p === "/api/sources/media-license") {
      const body = await readJson(req);
      const src = state.sources.find(function(x){ return x.id === body.id; });
      if (!src) return sendJson(res, 404, { ok: false, error: "Источник не найден" });
      const license = normalizeMediaLicense(body.mediaLicense);
      if (!["unknown", "allowed", "forbidden"].includes(license)) {
        return sendJson(res, 400, { ok: false, error: "Недопустимый режим медиа" });
      }
      src.mediaLicense = license;
      src.mediaLicenseUpdatedAt = new Date().toISOString();
      saveState();
      return sendJson(res, 200, { ok: true, mediaLicense: license });
    }

    if (req.method === "POST" && p === "/api/sources/toggle") {
      const body = await readJson(req);
      const src = state.sources.find(function(x){ return x.id === body.id; });
      if (!src) return sendJson(res, 404, { ok: false, error: "Источник не найден" });
      src.enabled = !src.enabled;
      if (src.enabled) {
        // Turned on by the editor: forget the automatic pause and its history.
        delete src.autoPaused;
        const stat = ensureSourceStat(src);
        if (stat) { stat.recent = []; stat.errorStreak = 0; }
      }
      saveState();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && p === "/api/sources/remove") {
      const body = await readJson(req);
      const removed = state.sources.find(function(x){ return x.id === body.id; });
      // A source the editor removed is never re-added automatically.
      const removedHost = removed && sourceHost(removed.url);
      if (removedHost) {
        state.sourceBlockedHosts = Array.isArray(state.sourceBlockedHosts) ? state.sourceBlockedHosts : [];
        if (!state.sourceBlockedHosts.includes(removedHost)) state.sourceBlockedHosts.push(removedHost);
      }
      state.sources = state.sources.filter(function(x){ return x.id !== body.id; });
      if (state.sourceStats && body.id) delete state.sourceStats[body.id];
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
        mediaStatus: String(body.mediaStatus || ""),
        mediaLicense: (String(body.imageUrl || "").trim() || String(body.videoUrl || "").trim()) ? "user_provided" : "unknown",
        mediaOrigin: (String(body.imageUrl || "").trim() || String(body.videoUrl || "").trim()) ? "user_provided" : "",
        copyrightSafe: COPYRIGHT_SAFE_MODE,
        copyrightPolicyVersion: "v1"
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

      try {
        const license = sourceMediaLicense(item);
        if (COPYRIGHT_SAFE_MODE && !mediaLicenseAllowsReuse(license)) {
          const generated = await generateNewsCover({
            id: item.newsId || item.id,
            title: item.title,
            text: item.text,
            sourceName: item.sourceName || ""
          });
          item.originalImageUrl = item.originalImageUrl || sourceImage || "";
          item.imageUrl = "";
          item.videoUrl = "";
          item.generatedImageUrl = generated.url;
          item.mediaType = "generated";
          item.mediaStatus = "generated";
          item.mediaPriority = 2;
          item.mediaLicense = license;
          item.mediaOrigin = "ai_generated";
          item.copyrightSafe = true;
          item.copyrightMediaDecision = "third_party_media_blocked";
          item.generatedBy = generated.model;
          item.generatedAt = new Date().toISOString();
          item.canEnhance = false;
          saveState();
          return sendJson(res, 200, { ok: true, imageUrl: generated.url, model: generated.model, copyrightSafe: true });
        }

        if (!sourceImage) return sendJson(res, 400, { ok: false, error: "У новости нет найденного фото для улучшения" });
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
        item.mediaLicense = license;
        item.mediaOrigin = "licensed_derivative";
        item.copyrightSafe = COPYRIGHT_SAFE_MODE;
        item.enhancedBy = enhanced.model;
        item.enhancedAt = new Date().toISOString();
        item.canEnhance = true;

        if (db && dbReady && item.newsId) {
          const row = await db.query("SELECT metadata FROM news_items WHERE id=$1 AND workspace_id=$2 LIMIT 1", [item.newsId, currentWorkspaceId()]);
          if (row.rowCount) {
            const metadata = Object.assign({}, row.rows[0].metadata || {}, {
              originalImageUrl: sourceImage,
              imageUrl: sourceImage,
              generatedImageUrl: enhanced.url,
              mediaType: "enhanced",
              mediaStatus: "enhanced",
              mediaPriority: 2,
              mediaLicense: license,
              mediaOrigin: "licensed_derivative",
              copyrightSafe: COPYRIGHT_SAFE_MODE,
              copyrightPolicyVersion: "v1",
              enhancedBy: enhanced.model,
              enhancedAt: item.enhancedAt
            });
            await db.query("UPDATE news_items SET metadata=$2::jsonb WHERE id=$1 AND workspace_id=$3", [item.newsId, JSON.stringify(metadata), currentWorkspaceId()]);
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
        mediaPackUrls: Array.isArray(item.mediaPackUrls) ? item.mediaPackUrls : [],
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
          videoUrl: "",
          mediaLicense: sourceMediaLicense(item)
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
        sourceId: item.sourceId || "",
        sourceName: item.sourceName || "",
        sourceUrl: item.sourceUrl || "",
        imageUrl: media.imageUrl,
        originalImageUrl: item.originalImageUrl || media.originalImageUrl || "",
        originalVideoUrl: item.originalVideoUrl || media.originalVideoUrl || "",
        generatedImageUrl: media.generatedImageUrl,
        videoUrl: media.videoUrl,
        mediaStatus: media.mediaStatus || item.mediaStatus || "",
        mediaOrigin: item.mediaOrigin || media.mediaOrigin || "",
        mediaLicense: item.mediaLicense || media.mediaLicense || sourceMediaLicense(item),
        mediaPackUrls: Array.isArray(item.mediaPackUrls) ? item.mediaPackUrls : (Array.isArray(media.mediaPackUrls) ? media.mediaPackUrls : []),
        platformVariants: item.platformVariants || null,
        qualityScore: item.qualityScore,
        qualityBreakdown: item.qualityBreakdown,
        qcStatus: item.qcStatus,
        qcIssues: item.qcIssues,
        topicEntities: item.topicEntities,
        sourceRole: item.sourceRole,
        decisionSummary: item.decisionSummary,
        storyUpdateOf: item.storyUpdateOf || "",
        storyUpdateTitle: item.storyUpdateTitle || ""
      }, effectiveTargets);

      if (result.safeMedia) Object.assign(item, result.safeMedia);
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
          sourceId: item.sourceId || "",
          sourceName: item.sourceName || "",
          sourceUrl: item.sourceUrl || "",
          sourceUrls: Array.isArray(item.sourceUrls) ? item.sourceUrls : [],
          sources: Array.isArray(item.sources) ? item.sources : [],
          storySources: Array.isArray(item.storySources) ? item.storySources : [],
          storyCluster: item.storyCluster || null,
          imageUrl: item.imageUrl || "",
          generatedImageUrl: item.generatedImageUrl || "",
          videoUrl: item.videoUrl || "",
          mediaPackUrls: Array.isArray(item.mediaPackUrls) ? item.mediaPackUrls : [],
          contentFormat: item.contentFormat || "",
          contentFormatLabel: item.contentFormatLabel || "",
          qualityScore: item.qualityScore == null ? null : Number(item.qualityScore),
          qualityBreakdown: item.qualityBreakdown || null,
          qcStatus: item.qcStatus || "",
          qcIssues: Array.isArray(item.qcIssues) ? item.qcIssues : [],
          topicEntities: normalizeTopicEntities(item.topicEntities),
          platformVariants: item.platformVariants || null,
          sourceRole: item.sourceRole || sourceEditorialRole(item),
          decisionSummary: item.decisionSummary || "",
          decisionExplanation: buildDecisionExplanation(item),
          repairLog: Array.isArray(result.repairLog) ? result.repairLog : [],
          mediaDirector: item.mediaDirector || null,
          storyUpdateOf: item.storyUpdateOf || "",
          storyUpdateTitle: item.storyUpdateTitle || "",
          editorialV2: item.editorialV2 || null,
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
        historyItem.repairLog = (historyItem.repairLog || []).concat(Array.isArray(result.repairLog) ? result.repairLog : []);
        historyItem.qualityScore = item.qualityScore == null ? historyItem.qualityScore : Number(item.qualityScore);
        historyItem.qcStatus = item.qcStatus || historyItem.qcStatus || "";
        historyItem.topicEntities = normalizeTopicEntities(item.topicEntities || historyItem.topicEntities);
        historyItem.platformVariants = item.platformVariants || historyItem.platformVariants || null;
        historyItem.decisionExplanation = buildDecisionExplanation(item);
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
            "UPDATE news_items SET status=$2, telegram_message_id=COALESCE($3,telegram_message_id), published_at=COALESCE($4,published_at), metadata=COALESCE(metadata,'{}'::jsonb) || $5::jsonb, vk_post_id=COALESCE($6,vk_post_id), vk_status=$7, vk_error_code=$8, vk_error_msg=$9, vk_media_attempts=$10, updated_at=NOW() WHERE id=$1 AND workspace_id=$11",
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
                vkMediaAttempts: result.vkMediaAttempts || item.vkMediaAttempts || 0,
                mediaLicense: item.mediaLicense || "unknown",
                mediaOrigin: item.mediaOrigin || "",
                copyrightSafe: COPYRIGHT_SAFE_MODE,
                copyrightMediaMode: COPYRIGHT_MEDIA_MODE,
                copyrightPolicyVersion: "v2",
                copyrightMediaDecision: item.copyrightMediaDecision || "",
                repairLog: Array.isArray(result.repairLog) ? result.repairLog : [],
                qualityScore: item.qualityScore == null ? null : Number(item.qualityScore),
                qualityBreakdown: item.qualityBreakdown || null,
                qcStatus: item.qcStatus || "",
                qcIssues: Array.isArray(item.qcIssues) ? item.qcIssues : [],
                topicEntities: normalizeTopicEntities(item.topicEntities),
                sourceRole: item.sourceRole || sourceEditorialRole(item),
                platformVariants: item.platformVariants || null,
                decisionSummary: item.decisionSummary || "",
                storyUpdateOf: item.storyUpdateOf || ""
              }),
              result.vkPostId || item.vkPostId || null,
              result.vkStatus || item.vkStatus || "",
              result.vkErrorCode == null ? (item.vkErrorCode == null ? null : String(item.vkErrorCode)) : String(result.vkErrorCode),
              result.vkError || item.vkError || "",
              Number(result.vkMediaAttempts || item.vkMediaAttempts || 0),
              currentWorkspaceId()
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
        videoUrl: String(body.videoUrl || "").trim(),
        mediaLicense: "user_provided"
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
        originalImageUrl: media.originalImageUrl || "",
        originalVideoUrl: media.originalVideoUrl || "",
        generatedImageUrl: media.generatedImageUrl,
        videoUrl: media.videoUrl,
        mediaStatus: media.mediaStatus || "",
        mediaOrigin: media.mediaOrigin || "",
        mediaLicense: media.mediaLicense || "user_provided"
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
for (const ws of workspaceStore.workspaces) {
  await workspaceContext.run({ workspaceId: ws.id }, async function(){
    const startupCleanup = pruneQueueItems(state);
    if (startupCleanup.removed) saveState();
    try {
      const repaired = await repairBalancedQueueMedia();
      if (repaired.repaired || repaired.failed) console.log("Balanced media repair " + ws.id + ":", JSON.stringify(repaired));
    } catch (error) {
      console.warn("Balanced media repair " + ws.id + " failed:", error.message);
    }
  });
}
setTimeout(function() {
  (async function(){
    for (const ws of workspaceStore.workspaces) {
      await workspaceContext.run({ workspaceId: ws.id }, async function(){
        try {
          const result = await backfillRecentNewsEditorialScores(30);
          if (result && result.scored) console.log("News score backfill " + ws.id + ":", JSON.stringify(result));
        } catch (error) { console.warn("News score backfill " + ws.id + " failed:", error.message); }
      });
    }
  })();
}, 1500);

// One-time bootstrap of per-source outcomes from the last week of news, so
// automatic pausing works on existing history instead of starting from zero.
setTimeout(function() {
  (async function(){
    const migration = "v0.35.0-source-outcomes-bootstrap";
    if (!db || !dbReady) return;
    for (const ws of workspaceStore.workspaces) {
      if (!ws || !ws.state) continue;
      ws.state.migrations = Array.isArray(ws.state.migrations) ? ws.state.migrations : [];
      if (ws.state.migrations.includes(migration)) continue;
      await workspaceContext.run({ workspaceId: ws.id }, async function(){
        const r = await db.query("SELECT source_id, status FROM news_items WHERE workspace_id=$1 AND detected_at > NOW() - INTERVAL '7 days' ORDER BY detected_at ASC", [ws.id]);
        const bySource = new Map();
        for (const row of r.rows) {
          const outcome = outcomeForStatus(row.status);
          if (!outcome || !row.source_id) continue;
          if (!bySource.has(row.source_id)) bySource.set(row.source_id, []);
          bySource.get(row.source_id).push(outcome);
        }
        let touched = 0;
        for (const source of (state.sources || [])) {
          const outcomes = bySource.get(source.id);
          if (!outcomes) continue;
          const stat = ensureSourceStat(source);
          if (!stat) continue;
          stat.recent = [];
          outcomes.forEach(function(o){ recordOutcome(stat, o); });
          touched += 1;
        }
        const paused = autoPauseWeakSources();
        state.migrations.push(migration);
        saveState();
        console.log("Source outcomes bootstrap " + ws.id + ": " + JSON.stringify({ sources: touched, paused: paused }));
      });
    }
  })().catch(function(error){ console.warn("Source outcomes bootstrap failed:", error.message); });
}, 45000);

// One-time replacement of logo / brand-card main photos in the queue with a
// generated cover (e.g. the VK logo taken from VK press releases).
setTimeout(function() {
  (async function(){
    const migration = "v0.35.1-queue-logo-photos";
    for (const ws of workspaceStore.workspaces) {
      if (!ws || !ws.state) continue;
      ws.state.migrations = Array.isArray(ws.state.migrations) ? ws.state.migrations : [];
      if (ws.state.migrations.includes(migration)) continue;
      await workspaceContext.run({ workspaceId: ws.id }, async function(){
        let replaced = 0, failed = 0;
        for (const item of (state.queue || [])) {
          if (!item || item.videoUrl || !item.imageUrl) continue;
          const fp = await localImageFingerprint(item.imageUrl);
          if (!fp || !looksLikeGraphic(fp)) continue;
          try {
            const generated = await generateNewsCover({ id: item.newsId || item.id, title: item.title, text: item.text, sourceName: item.sourceName || "" });
            item.originalImageUrl = item.originalImageUrl || item.imageUrl;
            item.imageUrl = "";
            item.mediaPackUrls = [];
            item.generatedImageUrl = generated.url;
            item.mediaType = "generated";
            item.mediaStatus = "generated";
            item.mediaOrigin = "ai_generated";
            item.generatedBy = generated.model;
            item.generatedAt = new Date().toISOString();
            replaced += 1;
          } catch (error) { failed += 1; console.warn("Queue logo photo replace failed:", error.message); }
        }
        state.migrations.push(migration);
        saveState();
        console.log("Queue logo photos " + ws.id + ": " + JSON.stringify({ replaced: replaced, failed: failed }));
      });
    }
  })().catch(function(error){ console.warn("Queue logo photos clean-up failed:", error.message); });
}, 75000);

// Top up sources to the target shortly after start (respects the throttle).
setTimeout(function() {
  (async function(){
    for (const ws of workspaceStore.workspaces) {
      if (!ws || !ws.state) continue;
      await workspaceContext.run({ workspaceId: ws.id }, async function(){
        const result = await replenishSources("startup");
        console.log("Source replenish " + ws.id + ": " + JSON.stringify(result));
      });
    }
  })().catch(function(error){ console.warn("Source replenish failed:", error.message); });
}, 120000);

// One-time clean-up of photo sets already in the queue (duplicates, logos, thumbnails).
setTimeout(function() {
  (async function(){
    const migration = "v0.34.0-single-media-cleanup";
    for (const ws of workspaceStore.workspaces) {
      if (!ws || !ws.state) continue;
      ws.state.migrations = Array.isArray(ws.state.migrations) ? ws.state.migrations : [];
      if (ws.state.migrations.includes(migration)) continue;
      await workspaceContext.run({ workspaceId: ws.id }, async function(){
        let changed = 0;
        for (const item of (state.queue || [])) {
          if (!item) continue;
          if (item.videoUrl) {
            // Video has priority: no extra photos next to it.
            if (Array.isArray(item.mediaPackUrls) && item.mediaPackUrls.length > 1) { item.mediaPackUrls = item.mediaPackUrls.slice(0, 1); changed += 1; }
            continue;
          }
          const pack = Array.isArray(item.mediaPackUrls) && item.mediaPackUrls.length ? item.mediaPackUrls : [item.imageUrl].filter(Boolean);
          if (pack.length < 2 && !(pack.length === 1 && item.imageUrl && item.imageUrl !== pack[0])) continue;
          const max = 1;
          const clean = await sanitizeMediaPack(pack, max);
          if (clean.join("|") !== pack.join("|") || item.imageUrl !== clean[0]) {
            item.mediaPackUrls = clean;
            item.imageUrl = clean[0] || item.imageUrl;
            item.mediaType = clean.length > 1 ? "album" : "photo";
            changed += 1;
          }
        }
        state.migrations.push(migration);
        saveState();
        console.log("Queue media clean-up " + ws.id + ": " + JSON.stringify({ changed: changed }));
      });
    }
  })().catch(function(error){ console.warn("Queue media clean-up failed:", error.message); });
}, 60000);

// One-time rebuild of the existing queue with the current editorial rules (v0.33.7).
setTimeout(function() {
  (async function(){
    const migration = "v0.33.7-editorial-v2-rebuild-queue";
    for (const ws of workspaceStore.workspaces) {
      if (!ws || !ws.state) continue;
      ws.state.migrations = Array.isArray(ws.state.migrations) ? ws.state.migrations : [];
      if (ws.state.migrations.includes(migration)) continue;
      await workspaceContext.run({ workspaceId: ws.id }, async function(){
        try {
          // First re-process queue photos from the originals with the quality-only
          // enhancer (replaces earlier generative redraws), then rebuild the texts.
          const photos = await backfillQueueImageEnhancements({ force: true }).catch(function(error){ return { error: error.message }; });
          console.log("Queue photo re-enhancement " + ws.id + ":", JSON.stringify(photos));
          const result = await rebuildQueueWithEditorialV2();
          if (result.ok) {
            state.migrations.push(migration);
            saveState();
          } else {
            console.warn("Editorial v2 queue rebuild " + ws.id + " postponed:", result.error);
          }
        } catch (error) {
          console.warn("Editorial v2 queue rebuild " + ws.id + " failed:", error.message);
        }
      });
    }
  })();
}, 20000);

setTimeout(function() {
  (async function(){
    for (const ws of workspaceStore.workspaces) {
      await workspaceContext.run({ workspaceId: ws.id }, async function(){
        try {
          const result = await backfillQueueImageEnhancements();
          console.log("Queue image enhancement backfill " + ws.id + ":", JSON.stringify(result));
        } catch (error) {
          console.warn("Queue image enhancement backfill " + ws.id + " failed:", error.message);
        }
      });
    }
  })();
}, 4000);

setTimeout(function() {
  (async function(){
    for (const ws of workspaceStore.workspaces) {
      await workspaceContext.run({ workspaceId: ws.id }, async function(){
        try {
          const result = await backfillQueueImageEnhancements();
          if (result.total) console.log("Queue image enhancement retry " + ws.id + ":", JSON.stringify(result));
        } catch (error) {
          console.warn("Queue image enhancement retry " + ws.id + " failed:", error.message);
        }
      });
    }
  })();
}, 3 * 60 * 1000);
await workspaceContext.run({ workspaceId: workspaceStore.defaultWorkspaceId }, async function(){ await discoverTelegramAlertChat(); });
startCollectorScheduler();

setTimeout(function() {
  (async function(){
    for (const ws of workspaceStore.workspaces) {
      const hasBloggers = Array.isArray(ws.state && ws.state.sources) && ws.state.sources.some(function(source){ return source && source.enabled && source.group === "blogger"; });
      if (!hasBloggers) continue;
      const hasBloggerQueue = Array.isArray(ws.state.queue) && ws.state.queue.some(function(item){ return item && (item.sourceGroup === "blogger" || String(item.sourceId || "").startsWith("blogger-")); });
      if (!hasBloggerQueue) {
        await workspaceContext.run({ workspaceId: ws.id }, async function(){
          try {
            const result = await collectOnce("blogger-bootstrap");
            console.log("Blogger bootstrap " + ws.id + ":", JSON.stringify(result));
          } catch (error) {
            console.warn("Blogger bootstrap " + ws.id + " failed:", error.message);
          }
        });
      }
    }

    const ai = getWorkspaceById(DEFAULT_WORKSPACE_ID);
    if (ai && ai.state && ai.state.russianSourcesBootstrapPending) {
      await workspaceContext.run({ workspaceId: ai.id }, async function(){
        try {
          const result = await collectOnce("ai-russian-bootstrap");
          state.russianSourcesBootstrapPending = false;
          state.russianSourcesBootstrappedAt = new Date().toISOString();
          saveState();
          console.log("AI Russian sources bootstrap:", JSON.stringify(result));
        } catch (error) {
          console.warn("AI Russian sources bootstrap failed:", error.message);
        }
      });
    }

    const cars = workspaceStore.workspaces.find(function(ws){ return ws && ws.id === "chtotamtachki"; });
    if (cars) {
      await workspaceContext.run({ workspaceId: cars.id }, async function(){
        try {
          const now = new Date();
          const day = moscowDateKey(now);
          const hour = Math.floor(moscowMinutes(now) / 60);
          const time = String(hour).padStart(2, "0") + ":00";
          const schedule = ensureScheduleShape(state);
          const hasPreparedCurrentSlot = Boolean(schedule.assignments[day] && schedule.assignments[day][time]);
          if (state.mode === "AUTO" && AUTO_PUBLISH_ENABLED && hasPreparedCurrentSlot) {
            const result = await publishDynamicSlot();
            console.log("Car startup catch-up publish:", JSON.stringify(result));
          }
        } catch (error) {
          console.warn("Car startup catch-up publish failed:", error.message);
        }

        const repairMarker = "v0.29.1-car-telegram-media-repair-test";
        state.migrations = Array.isArray(state.migrations) ? state.migrations : [];
        if (!state.migrations.includes(repairMarker)) {
          try {
            let item = (state.queue || [])
              .filter(function(q){ return q && q.id && q.telegramPublished !== true && !isBloggerSource(q); })
              .sort(function(a,b){ return dynamicItemScore(b) - dynamicItemScore(a); })[0] || null;
            if (!item) {
              await collectOnce("car-repair-test");
              item = (state.queue || [])
                .filter(function(q){ return q && q.id && q.telegramPublished !== true && !isBloggerSource(q); })
                .sort(function(a,b){ return dynamicItemScore(b) - dynamicItemScore(a); })[0] || null;
            }
            if (!item) throw new Error("Нет подходящей новости для контрольной публикации");

            let media = {
              imageUrl: item.imageUrl || "",
              generatedImageUrl: item.generatedImageUrl || "",
              videoUrl: item.videoUrl || ""
            };
            if (!(media.imageUrl || media.generatedImageUrl || media.videoUrl)) {
              media = await ensureMediaForNews({
                id: item.newsId || item.id,
                title: item.title,
                text: item.text,
                sourceName: item.sourceName || "Контрольная публикация",
                imageUrl: "",
                videoUrl: "",
                mediaLicense: sourceMediaLicense(item)
              });
              item.imageUrl = media.imageUrl || "";
              item.generatedImageUrl = media.generatedImageUrl || "";
              item.videoUrl = media.videoUrl || "";
            }

            const result = await sendMultiPlatformPost({
              id: item.id,
              postId: item.id,
              newsId: item.newsId || "",
              topicId: item.topicId || "default",
              allow_text_fallback: false,
              title: item.title,
              text: item.text,
              sourceName: item.sourceName || "",
              sourceId: item.sourceId || "",
              sourceUrl: item.sourceUrl || "",
              imageUrl: item.imageUrl || media.imageUrl || "",
              originalImageUrl: item.originalImageUrl || media.originalImageUrl || "",
              originalVideoUrl: item.originalVideoUrl || media.originalVideoUrl || "",
              generatedImageUrl: item.generatedImageUrl || media.generatedImageUrl || "",
              videoUrl: item.videoUrl || media.videoUrl || "",
              mediaStatus: item.mediaStatus || media.mediaStatus || "",
              mediaOrigin: item.mediaOrigin || media.mediaOrigin || "",
              mediaLicense: item.mediaLicense || media.mediaLicense || sourceMediaLicense(item)
            }, { telegram: true, vk: false });

            if (!result.telegramPublished) throw new Error("Telegram не подтвердил публикацию");
            const publishedAt = new Date().toISOString();
            item.telegramPublished = true;
            item.telegramMessageId = result.message_id;
            item.telegramPublishedAt = publishedAt;
            item.published = item.vkPublished === true;
            item.publishedAt = publishedAt;
            state.history.unshift({
              id: newId("hist"),
              queueId: item.id,
              newsId: item.newsId || "",
              title: result.publishedTitle || item.title || "",
              text: result.publishedText || item.text || "",
              telegramPublished: true,
              telegramMessageId: result.message_id,
              telegramPublishedAt: publishedAt,
              vkPublished: false,
              sourceId: item.sourceId || "",
              sourceName: item.sourceName || "",
              sourceUrl: item.sourceUrl || "",
              imageUrl: item.imageUrl || "",
              generatedImageUrl: item.generatedImageUrl || "",
              videoUrl: item.videoUrl || "",
              publishedAt: publishedAt,
              publicationOrigin: "repair-test"
            });
            state.stats.published = Number(state.stats.published || 0) + 1;
            noteSourceEvent(item, "published");
            state.migrations.push(repairMarker);
            saveState();
            console.log("CAR_TELEGRAM_REPAIR_TEST_SUCCESS " + JSON.stringify({
              queue_id: item.id,
              message_id: result.message_id,
              title: item.title || ""
            }));
          } catch (error) {
            console.error("CAR_TELEGRAM_REPAIR_TEST_FAILED " + String(error && error.message || error));
          }
        }
      });
    }
  })();
}, 5000);

// Items held because a checker was unreachable are re-checked every 15 minutes
// (previously only once at startup). Cheap when there is nothing to retry.
async function retryUnavailableEditorialAllWorkspaces() {
  if (!EDITORIAL_V2_ENABLED || !ANTHROPIC_API_KEY) return;
  for (const ws of workspaceStore.workspaces) {
    if (!ws || !ws.state) continue;
    const pending = (ws.state.queue || []).some(function(item) {
      if (!item || !item.editorialV2) return false;
      const checkers = Array.isArray(item.editorialV2.checkers) ? item.editorialV2.checkers : [];
      return item.editorialV2.verdict === "unavailable" || checkers.some(function(x){ return /^anthropic:error$/i.test(String(x || "")); });
    });
    if (!pending) continue;
    await workspaceContext.run({ workspaceId: ws.id }, async function() {
      // Items held as "unavailable" must stay eligible for this retry.
      for (const item of (state.queue || [])) {
        if (item && item.editorialV2 && item.editorialV2.verdict === "unavailable") delete item.editorialV2RetryVersion;
      }
      const result = await retryUnavailableEditorialQueueItems();
      if (result.checked || result.error) console.log("EDITORIAL_V2_RETRY " + JSON.stringify(Object.assign({ workspace: ws.id }, result)));
    });
  }
}
setInterval(function() {
  retryUnavailableEditorialAllWorkspaces().catch(function(error){ console.warn("EDITORIAL_V2_RETRY failed:", error.message); });
}, 15 * 60 * 1000);

// Queue clean-up without a human: posts that can never go out automatically are removed.
async function autoResolveAllWorkspaces() {
  for (const ws of workspaceStore.workspaces) {
    if (!ws || !ws.state) continue;
    await workspaceContext.run({ workspaceId: ws.id }, async function() {
      const result = await autoResolveQueue();
      if (result.removed) console.log("QUEUE_AUTO_RESOLVE " + JSON.stringify({ workspace: ws.id, removed: result.removed }));
    });
  }
}
setTimeout(function(){ autoResolveAllWorkspaces().catch(function(error){ console.warn("Queue auto resolve failed:", error.message); }); }, 90000);
setInterval(function() {
  autoResolveAllWorkspaces().catch(function(error){ console.warn("Queue auto resolve failed:", error.message); });
}, 15 * 60 * 1000);

server.listen(PORT, "0.0.0.0", function() {
  console.log("News Factory listening on :" + PORT);

  if (EDITORIAL_V2_ENABLED && ANTHROPIC_API_KEY) {
    setTimeout(async function() {
      try {
        const probe = await anthropicEditorialProbe(true);
        console.log("EDITORIAL_V2_CHECKER_HEALTH " + JSON.stringify({
          provider: "anthropic",
          ok: Boolean(probe.ok),
          model: probe.ok ? probe.model : ANTHROPIC_MODEL,
          structured: Boolean(probe.structured),
          error: probe.ok ? "" : String(probe.error || "").slice(0, 180)
        }));

        if (probe.ok) {
          for (const ws of workspaceStore.workspaces) {
            await workspaceContext.run({ workspaceId: ws.id }, async function() {
              const result = await retryUnavailableEditorialQueueItems();
              if (result.checked) {
                console.log("EDITORIAL_V2_RETRY " + JSON.stringify({
                  workspace: ws.id,
                  checked: result.checked,
                  repaired: result.repaired,
                  held: result.held,
                  skipped: result.skipped
                }));
              }
            });
          }
        }
      } catch (error) {
        console.warn("EDITORIAL_V2_CHECKER_HEALTH " + JSON.stringify({
          provider: "anthropic",
          ok: false,
          model: ANTHROPIC_MODEL,
          error: String(error && error.message || error).slice(0, 180)
        }));
      }
    }, 2500);
  }
});
