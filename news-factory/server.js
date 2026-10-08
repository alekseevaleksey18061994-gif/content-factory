import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import sharp from "sharp";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { AsyncLocalStorage } from "node:async_hooks";
import { safeFetch, validateUrl as validateFetchUrl, parseProxyUrl } from "./lib/safe-fetch.js";
import { createSourceFetcher, parseFeed, looksLikeFeed, discoverFeedUrl, guessFeedUrls } from "./lib/source-fetch.js";
import { assertSafeRaster, SAFE_INPUT_PIXELS } from "./lib/image-guard.js";
import { adaptVkBody, vkTail } from "./lib/vk-format.js";
import { ADMIN_CSP, baseSecurityHeaders, originAllowed } from "./lib/http-security.js";
import { safeEqual, clientIp as proxyClientIp, createFailureLimiter, verifyPasswordScrypt, createSessionEpochStore, sessionTokenFor } from "./lib/auth-guard.js";
import { fileURLToPath } from "node:url";
import { postRating, queueItemRatingInput } from "./lib/post-rating.js";
import { channelTopic, channelFocus, channelStrategy, SOURCE_REWORK_V0430, INTERNET_SOURCE_FIX_V0451, HOME_RUBRIC_SOURCES_V0513, MONEY_RUBRIC_SOURCES_V0526 } from "./lib/channel-dna.js";
import { SOURCES_V055, SOURCES_TOPUP_V058, proxyRetryLists } from "./lib/channel-sources-v055.js";
import { RUBRICS_V055_MIGRATION, REMOVED_CHANNELS_V055, REMOVED_CHANNELS_V060, CHANNEL_NAME_TAILS_V055, RUBRIC_PLAN_V055, isRubricsV055Channel, isLegacyThemeChannelV055, classifySourceV055, classifyTextV055, shouldRestoreAutoPausedV055 } from "./lib/channel-rubrics-v055.js";
import { WORKSPACE_RECOVERY_MIGRATION, RECOVERY_CHANNELS, isUsableSnapshotState, recoveredWorkspaceRecord } from "./lib/workspace-recovery.js";
import { channelStrategyScore, sourceClassFor } from "./lib/channel-strategy.js";
import { APPROVED_AUTO_BLOGGER_SOURCES, SHOPPING_FIND_SOURCES } from "./lib/channel-curated-sources.js";
import { normalizeShoppingFindSources, normalizeAutoRubricSources, resetApprovedAutoBloggers, reassignCarRubricGroups } from "./lib/channel-rubric-migrations.js";
import { evaluateHealth } from "./lib/health-alerts.js";
import { runMigrations, migrationStatus } from "./lib/db-migrations.js";
import { buildChannelConfig } from "./lib/channel-config.js";
import { buildAssignPrompt, parseAssignResult, tagSource, ASSIGN_BATCH, ASSIGN_MARKER, ASSIGN_MIN_ANSWERED } from "./lib/source-rubric-assign.js";
import { planSourceCleanup, sweepCandidates, applySourceRemoval, inAnyGroup, DEAD_GRACE_MS } from "./lib/source-cleanup.js";
import { networkDay, isDateKey } from "./lib/network-day.js";
import { backupConfig, backupConfigProblem, packBackup, backupObjectKey, uploadBackup, backupDue } from "./lib/offsite-backup.js";
import { missingWorkspaces, missingAlertText, createAlertThrottle } from "./lib/workspace-watchdog.js";
import { createProviderBreaker, createResponsesFailover, classifyProviderFailure, tripsBreaker } from "./lib/llm-failover.js";
import { recordPending as pmpRecordPending, applyStatuses as pmpApplyStatuses, summarize as pmpSummarize } from "./lib/pmp-reconcile.js";
import { createPostmypostClient, resolvePostmypostTarget, listPostmypostAccounts, matchWorkspacesToAccounts, PUBLICATION_STATUS as PMP_STATUS } from "./lib/postmypost.js";
import { moscowParts, historyFormat, historyHook, bucketWeights, bestHours, isDigestHistory, pickDigestPosts, buildDailyReportText, topReasons } from "./lib/insights.js";
import { isPolicySkipReason, staleYearInTitle, buildPrefilterPrompt, parsePrefilterResult, recordOutcome, autoPauseReason, outcomeForStatus, sourcesNeeded, freshCandidates, sourceHost, sourceKey, RESERVE_SOURCES, SEED_SOURCES, retiredSeedSources, MAX_SOURCES_ADDED_PER_RUN, buildDiscoveryPrompt, parseDiscoveryResult } from "./lib/source-quality.js";
import {
  createEditorialPipeline,
  createModelClients,
  resolveChannelId,
  channelFreshnessHours,
  timeSlotFor,
  moscowIso,
  legacyScores,
  loadPrompt as loadEditorialPrompt,
  CHANNEL_IDS as EDITORIAL_CHANNEL_IDS
} from "./lib/editorial-v2.js";
import { matchRegistry as matchEditorialRegistry } from "./lib/editorial-registry.js";
import { CAPTION_VISIBLE_LIMIT, TELEGRAM_CAPTION_HARD_LIMIT, visibleLength, trimPostPreservingTail, missingProtected } from "./lib/telegram-caption.js";
import { cardSafeText, wrapCardLines } from "./lib/card-text.js";
import { readJsonBody } from "./lib/http-body.js";
import {
  COST_STATE_MIGRATION_ID,
  collectLegacyCostRows,
  stripLegacyCostEvents,
  resolveCostPricing,
  calculateUsageCost as calculateApiUsageCost,
  moscowPeriodBounds,
  monthForecastCost,
  percentChange,
  BALANCE_PROVIDERS,
  normalizeBalanceInput,
  computeApiBalance
} from "./lib/costs.js";
import {
  atomicWriteFileSync,
  loadJsonStoreWithRecovery,
  createAtomicStoreWriter,
  createKeyedDebouncer,
  retryWithBackoff,
  withAdvisoryLock,
  parseCbrUsdRate,
  resolveUsdRubFallback,
  dispatchBudgetAlerts,
  DEFAULT_USD_RUB_RATE
} from "./lib/data-safety.js";
import { ADMIN_KEY, ADMIN_UI_PASSWORD, ADMIN_UI_PASSWORD_SCRYPT, ADMIN_UI_PASSWORD_SHA256, ANTHROPIC_API_KEY, ANTHROPIC_ASSIST_MODEL, ANTHROPIC_CHECKER_MODEL, ANTHROPIC_CHECK_MIN_IMPORTANCE, ANTHROPIC_FALLBACK_WRITER_MODEL, ANTHROPIC_HEALTH_CACHE_MIN, ANTHROPIC_MODEL, ANTHROPIC_STRONG_CHECKER_MODEL, ANTHROPIC_STRONG_IMPORTANCE, AUTO_ENHANCE_SOURCE_IMAGES, AUTO_PUBLISH_ENABLED, AUTO_PUBLISH_MIN_INTERVAL_MINUTES, AUTO_QUALITY_MIN, BOT_TOKEN, CHANNEL, COLLECTOR_ENABLED, COPYRIGHT_MAX_VERBATIM_WORDS, COPYRIGHT_MEDIA_MODE, COPYRIGHT_SAFE_MODE, DAILY_REPORT_ENABLED, DAILY_REPORT_TIME, DATABASE_URL, DIGEST_ENABLED, DIGEST_EVENING_ENABLED, DIGEST_EVENING_TIME, DIGEST_SUNDAY_ENABLED, DIGEST_SUNDAY_TIME, DYNAMIC_ASSIGNMENT_GRACE_MIN, DYNAMIC_SLOT_END_HOUR, DYNAMIC_SLOT_PREP_MINUTE, DYNAMIC_SLOT_START_HOUR, EDITORIAL_CAPACITY_BYPASS_SCORE, EDITORIAL_LEARNING_ENABLED, EDITORIAL_LEARNING_REFRESH_MINUTES, EDITORIAL_QC_ENABLED, EDITORIAL_QUEUE_TARGET, EDITORIAL_V2_ENABLED, EDITORIAL_V2_MAX_FIX_ROUNDS, EDITORIAL_V2_REQUIRE_ALL_CHECKERS, EDITORIAL_VARIETY_ENABLED, GENERATE_COVER_IF_MISSING, HEADLINE_PREFILTER_ENABLED, IMAGE_ENHANCEMENT_ENABLED, IMAGE_ENHANCE_MIN_GAP_MS, MEDIA_AI_COVER_MIN_IMPORTANCE, MEDIA_DEFER_EXPENSIVE, MEDIA_DIRECTOR_MAX_IMAGES, MEDIA_EXTRA_MIN_HEIGHT, MEDIA_EXTRA_MIN_WIDTH, MEDIA_QUALITY_MIN_SCORE, MEDIA_REQUIRED, OPENAI_API_KEY, OPENAI_FALLBACK_MODEL, OPENAI_IMAGE_MODEL, OPENAI_IMAGE_QUALITY, OPENAI_MODEL, POSTMYPOST_TOKEN, POST_RATING_DROP_BELOW, POST_RATING_MIN_AUTO, PROVIDER_BREAKER_COOLDOWN_MIN, PROVIDER_FAILOVER_COVER_CARD, PROVIDER_FAILOVER_ENABLED, PUBLIC_BASE_URL, PUBLISH_REPAIR_MAX_ATTEMPTS, SOURCES_ADDED_PER_RUN, SOURCES_MAX_ACTIVE, SOURCES_MIN_ACTIVE, SOURCE_AUTO_PAUSE_ENABLED, SOURCE_IMAGE_ENHANCE_CONCURRENCY, SOURCE_PROBATION_HOURS, SOURCE_REPLENISH_INTERVAL_MINUTES, SOURCE_STARVING_RUNS, STORY_CLUSTER_ENABLED, STORY_CLUSTER_MAX_SOURCES, STORY_CLUSTER_MIN_SIMILARITY, STORY_CLUSTER_WINDOW_HOURS, STORY_MEDIA_PACK_COUNT, STORY_PRECHECK_ENABLED, STORY_UPDATE_WINDOW_HOURS, TELEGRAM_ALERT_CHAT_ID, TELEGRAM_API_TIMEOUT_MS, TELEGRAM_PUBLIC_USERNAME, TELEGRAM_RETRY_AFTER_MAX_SECONDS, TEXT_CARD_POSTS_ALLOWED, TRUSTED_PROXY_HOPS, VK_ACCESS_TOKEN, VK_API_VERSION, VK_APP_ID, VK_GROUP_ID, VK_OAUTH_HANDOFF_SECRET, VK_OAUTH_MODE, VK_OAUTH_REDIRECT_URI, VK_OAUTH_SCOPE, VK_OAUTH_TTL_MS, VK_OWNER_ID, VK_PUBLIC_URL, VK_PUBLISH_ENABLED, VK_VIA_POSTMYPOST, authFailureLimiter, envNumber } from "./lib/env-config.js";
import { DATA_DIR, MEDIA_DIR, VK_PREVIEW_HEIGHT, VK_PREVIEW_WIDTH, canonicalizeUrl, ensureDataDir, escapeHtml, extractArticleMediaCandidates, extractMetaImage, extractMetaVideo, extractPublishedAt, extractSitePreview, extractTitle, isUsableNewsVideoUrl, localMediaPathFromUrl, mediaPublicUrl, normalizeDate, normalizePublicPostSources, prepareVkPreviewImage, previewDescription, previewPageUrl, previewSlug, stripHtml } from "./lib/article-extract.js";
import { isTelegramFatalError, telegramApi, telegramPlainPayload, telegramRequest } from "./lib/telegram-errors.js";
import { assertTelegramPublishResult, isLocalMediaUrl, telegramMediaApi } from "./lib/telegram-upload.js";
import { escapeTelegramHtml, formatTelegramPost, newId } from "./lib/telegram-format.js";
import { createVkError, logVkError, vkApi, vkOAuthCallbackHtml, vkPostContext } from "./lib/vk-errors.js";
import { enhanceNewsImage, prepareReusableSourceImage } from "./lib/image-enhance.js";
import { BLOGGER_DAILY_TARGET, BLOGGER_SLOTS, BLOGGER_SOURCES, CAR_SOURCES, CHANNEL_EXTRA_LANES, CURATED_SOURCES, RUSSIAN_AI_SOURCES } from "./lib/source-lists.js";
import { analyticsCache, extractArticleLinks, extractTelegramSourcePosts, hasPublishableMedia, isTextCardOnly, parseTelegramPreview, statusCache, textCardBlocked } from "./lib/source-parse.js";


const EDITORIAL_V2_PROMPT_FILE = fileURLToPath(new URL("./prompts/chto-tam.md", import.meta.url));


let vkOAuthSession = null;
let vkOAuthHandoff = null;


 // default only; each channel picks at prepMinuteFor()
// Staggered collection (2026-10-04): every channel used to collect at :45 at once (~1500 page requests in a few
// minutes queued behind the global fetch limit, slowed each other down and once hung the whole morning). Each channel
// now collects at its own minute between :10 and :40; :45 only picks the post from the queue it filled.
const COLLECTION_STAGGER_ENABLED = String(process.env.COLLECTION_STAGGER_ENABLED || "true").toLowerCase() !== "false";
function staggerEnvMinute(name, fallback, min, max) {
  const raw = process.env[name];
  const n = raw == null || String(raw).trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) ? Math.round(Math.max(min, Math.min(max, n))) : fallback;
}
const COLLECTION_STAGGER_FROM = staggerEnvMinute("COLLECTION_STAGGER_FROM", 10, 10, 40);
const COLLECTION_STAGGER_TO = Math.max(COLLECTION_STAGGER_FROM, staggerEnvMinute("COLLECTION_STAGGER_TO", 40, 10, 40));
const COLLECTION_STAGGER_WINDOW_MINUTES = 8;
// The rest of the hour is spread the same way, in the same channel order: picking the post :41–:57 (was :45 for
// everyone) and the post itself :00–:10 (was :00 for everyone).
const SLOT_PREP_FROM = staggerEnvMinute("SLOT_PREP_FROM", 41, 41, 57);
const SLOT_PREP_TO = Math.max(SLOT_PREP_FROM, staggerEnvMinute("SLOT_PREP_TO", 57, 41, 57));
const SLOT_PUBLISH_SPREAD_MINUTES = staggerEnvMinute("SLOT_PUBLISH_SPREAD_MINUTES", 10, 0, 10);
// An empty slot re-collects at most this often (was every 2 minutes for 44 minutes: ~20 full runs an hour per channel).
const EMPTY_SLOT_RESCUE_MINUTES = staggerEnvMinute("EMPTY_SLOT_RESCUE_MINUTES", 8, 2, 30);
const SCHEDULER_SLOT_WINDOW_MINUTES = Math.max(1, Math.min(14, Number(process.env.SCHEDULER_SLOT_WINDOW_MINUTES || 10)));
const DYNAMIC_SLOT_MAX_AGE_HOURS = Math.max(4, Math.min(48, Number(process.env.DYNAMIC_SLOT_MAX_AGE_HOURS || 24)));
// Regular channel promise: one regular publication slot every hour from 08:00
// through 23:00 Moscow. The old 12-post cap silently skipped evening slots.
const DYNAMIC_DAILY_TARGET = DYNAMIC_SLOT_END_HOUR - DYNAMIC_SLOT_START_HOUR + 1;
const DYNAMIC_DAILY_MAX = Math.max(DYNAMIC_DAILY_TARGET, Math.min(24, Number(process.env.DYNAMIC_DAILY_MAX || DYNAMIC_DAILY_TARGET)));
const MAX_ITEMS_PER_RUN = Math.max(1, Math.min(10, Number(process.env.MAX_ITEMS_PER_RUN || 5)));
const ARTICLE_MAX_AGE_HOURS = Math.max(6, Math.min(168, Number(process.env.ARTICLE_MAX_AGE_HOURS || 24)));
const QUEUE_MAX_AGE_HOURS = Math.max(2, Math.min(72, Number(process.env.QUEUE_MAX_AGE_HOURS || 12)));
const QUEUE_MAX_AUTO_ITEMS = Math.max(5, Math.min(50, Number(process.env.QUEUE_MAX_AUTO_ITEMS || 20)));
// Articles whose page carries no publication date are judged by fetch time, but only for this long.
const UNDATED_ARTICLE_MAX_AGE_HOURS = Math.max(2, Math.min(48, Number(process.env.UNDATED_ARTICLE_MAX_AGE_HOURS || 12)));
// A link that fails transiently (download, writer outage, DB write) is retried this many times in total, then recorded as seen.
const SKIP_RETRY_MAX = Math.max(1, Math.min(6, Number(process.env.SKIP_RETRY_MAX || 3)));
// After a skipped link (stale, too short, unreachable) the collector opens up to this many further unseen links of the same source in the same run.
const EXTRA_LINKS_PER_SOURCE = Math.max(0, Math.min(8, Number(process.env.EXTRA_LINKS_PER_SOURCE || 3)));
// The same article (normalized URL or content hash) queued/published by another channel is skipped for this long.
const CROSS_CHANNEL_DEDUPE_ENABLED = String(process.env.CROSS_CHANNEL_DEDUPE_ENABLED || "true").toLowerCase() !== "false";
const CROSS_CHANNEL_DEDUPE_HOURS = Math.max(1, Math.min(168, Number(process.env.CROSS_CHANNEL_DEDUPE_HOURS || 48)));
const AI_STRONG_NEWS_SCORE_RAW = Number(process.env.AI_STRONG_NEWS_SCORE || 75);
const AI_STRONG_NEWS_SCORE = Math.max(60, Math.min(95, Number.isFinite(AI_STRONG_NEWS_SCORE_RAW) ? AI_STRONG_NEWS_SCORE_RAW : 75));
const AI_TOP_NEWS_SCORE_RAW = Number(process.env.AI_TOP_NEWS_SCORE || 88);
const AI_TOP_NEWS_SCORE = Math.max(AI_STRONG_NEWS_SCORE, Math.min(100, Number.isFinite(AI_TOP_NEWS_SCORE_RAW) ? AI_TOP_NEWS_SCORE_RAW : 88));
const PORT = Number(process.env.PORT || 3000);

const STATE_FILE = path.join(DATA_DIR, "state.json");
const WORKSPACES_FILE = path.join(DATA_DIR, "workspaces.json");
const DEFAULT_WORKSPACE_ID = "ai-main";

const PUBLIC_DIR = path.join(process.cwd(), "public");
// Text in generated images (cover cards, VK previews) needs fonts; the server image has none, so every letter was
// drawn as an empty box. Point fontconfig (used by sharp/librsvg) at the bundled DejaVu fonts.
(function configureFonts() {
  try {
    const dir = fileURLToPathSafe(new URL("./fonts/", import.meta.url));
    const conf = dir && path.join(dir, "fonts.conf");
    if (conf && fs.existsSync(conf) && !process.env.FONTCONFIG_FILE) {
      process.env.FONTCONFIG_FILE = conf;
      process.env.FONTCONFIG_PATH = dir;
    }
  } catch {}
})();
function fileURLToPathSafe(u) { try { return decodeURIComponent(u.pathname); } catch { return ""; } }


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
for (const warning of (COST_PRICING_CONFIG.warnings || [])) console.warn("COST_PRICING_JSON:", warning);


// Editor's notes per channel (2026-10-03): what discovery should look for, which channels get their sources
// refreshed (24 h trial for every automatically added source; the ones that never brought a news item are
// replaced), extra Telegram channels, and the source set for the kino meme lane.
const CHANNEL_SOURCE_PLANS = {
  home: { refresh: true, boost: 0, hint: "находки и подборки товаров для дома, до/после обычных квартир, хранение, уборка, ремонт своими руками, тренды интерьера, кухня; НЕ рынок недвижимости, НЕ ЖКХ, НЕ IT-новости, НЕ городские новости" },
  auto: { refresh: false, boost: 0, hint: "автоисточники по 8 рубрикам: премьеры, авторынок России, китайские авто, электро и гибриды, автотехнологии, сильные блогерские тесты, вирусное и важное водителю; без мелких ДТП, дилерской рекламы и слухов без надёжного источника" },
  shopping: { refresh: true, boost: 15, hint: "товарные находки Wildberries, Ozon, Яндекс Маркета, AliExpress и вирусные товары; рекламные посты допустимы как источник товара; не нужны новости для селлеров, права потребителей и корпоративные новости ритейла" },
  money: { refresh: true, hint: "сильнее личные финансы обычных людей: вклады, кредиты, ипотека, налоги и вычеты, цены, зарплаты, пенсии, мошенники и банки; меньше биржи и макроэкономики" },
  tech: { refresh: true, hint: "гаджеты и сервисы, которые обычный человек купит или поставит завтра: смартфоны, ноутбуки, наушники, приложения, обновления, утечки; меньше корпоративных новостей" },
  games: { hint: "игровые новостные Telegram-каналы: релизы, скидки и раздачи, утечки, трейлеры, игровое сообщество", telegramMin: 12 },
  science: { refresh: true, hint: "вау-наука для широкой публики: космос с красивыми снимками, животные, тело человека и здоровье, археология, необычные открытия; без грантов, конференций и рейтингов вузов" },
  sport: { hint: "разные виды спорта и события России и мира: футбол (РПЛ, еврокубки, сборная), хоккей (КХЛ, НХЛ), баскетбол, теннис, Формула-1, бокс и ММА, биатлон, лыжи, фигурное катание, киберспорт", boost: 15 },
  world: { refresh: true, hint: "вирусное в интернете: мемы, тренды TikTok, Reels и YouTube, челленджи, интернет-истории; лучше Telegram-каналы и сайты про тренды, а не обычные новостные" },
  kino: { laneHint: "Telegram-каналы с мемами и юмором про кино и сериалы (подписанные кадры, шутки про премьеры и актёров)", laneMin: 6 }
};
function channelSourcePlan() { return CHANNEL_SOURCE_PLANS[resolveChannelId(currentWorkspace())] || null; }
// ---- themes (rubrics) and own hours per channel (v0.51.3, «Что там для дома?»: 10 themes, one post a day each)
function channelRubrics(ws) { return channelStrategy(resolveChannelId(ws || currentWorkspace())).rubrics || []; }
function rubricIds(ws) { return new Set(channelRubrics(ws).map(function(r){ return r.id; })); }
// Theme of a queue/history item: the writer's content_bucket when it is a theme, else the theme of its source.
function itemRubric(item, ids) {
  const set = ids || rubricIds();
  if (!item || !set.size) return "";
  const bucket = String(item.contentBucket || (item.editorialV2 && item.editorialV2.contentBucket) || "");
  if (set.has(bucket)) return bucket;
  const source = findSourceForItem(item);
  if (!source) return "";
  const primary = String(source.rubric || "");
  if (set.has(primary)) return primary;
  const many = Array.isArray(source.rubrics) ? source.rubrics.map(String) : [];
  return many.find(function(id){ return set.has(id); }) || "";
}
// Sub-topic of every queued/published post for the calendar tag: bucket → source rubric → keywords of the text.
function itemRubricsMap() {
  const out = {};
  const ids = rubricIds();
  if (!ids.size) return out;
  const channelId = resolveChannelId(currentWorkspace());
  const list = [].concat(Array.isArray(state.queue) ? state.queue : [], Array.isArray(state.history) ? state.history.slice(-400) : []);
  for (const item of list) {
    if (!item || !item.id) continue;
    let r = itemRubric(item, ids);
    if (!r) { const c = classifyTextV055(channelId, String(item.title || "") + " " + String(item.text || "").slice(0, 1500)); if (c && ids.has(c)) r = c; }
    if (r) out[item.id] = r;
  }
  return out;
}
// Rub cost of every queued/published post (sum of its API calls by news_id), for the queue and history lists.
async function postCostsMap() {
  const out = {};
  if (!db || !dbReady) return out;
  const ids = [];
  for (const item of [].concat(Array.isArray(state.queue) ? state.queue : [], Array.isArray(state.history) ? state.history.slice(0, 60) : [])) {
    const id = item && String(item.newsId || item.id || "");
    if (id) ids.push(id);
  }
  if (!ids.length) return out;
  try {
    const rate = await getUsdRubRate();
    const r = await db.query("SELECT news_id, COALESCE(SUM(cost_usd),0)::float8 AS usd FROM cost_events WHERE workspace_id=$1 AND news_id = ANY($2::text[]) GROUP BY news_id", [currentWorkspaceId(), ids]);
    for (const row of r.rows) out[row.news_id] = Math.round(Number(row.usd || 0) * rate * 100) / 100;
  } catch (e) { console.warn("POST_COSTS_FAILED " + String(e && e.message || e).slice(0, 160)); }
  return out;
}
function rubricSourceCounts(ws) {
  const counts = {};
  for (const r of channelRubrics(ws)) counts[r.id] = 0;
  const st = ws && ws.state ? ws.state : state;
  for (const src of (st.sources || [])) {
    if (!src || !src.enabled) continue;
    const ids = new Set([String(src.rubric || "")].concat(Array.isArray(src.rubrics) ? src.rubrics.map(String) : []));
    for (const id of ids) if (Object.prototype.hasOwnProperty.call(counts, id)) counts[id] += 1;
  }
  return counts;
}
// Per-theme source limits: the editor can raise or lower the minimum of each theme group (state.rubricLimits[id].min).
// Editor-defined rubric minimum has no upper cap. Automatic replenishment is still rate-limited per run/cooldown.
const RUBRIC_MIN_LIMIT = 1;
function rubricMinFor(rubricId, ws) {
  const st = ws && ws.state ? ws.state : state;
  const strat = channelStrategy(resolveChannelId(ws || currentWorkspace()));
  const rubric = (strat.rubrics || []).find(function(r){ return r && String(r.id) === String(rubricId); });
  const base = Math.max(1, Number(rubric && rubric.minSources || strat.rubricMinSources || 1));
  const own = st.rubricLimits && st.rubricLimits[rubricId] && Number(st.rubricLimits[rubricId].min);
  return Number.isFinite(own) && own >= RUBRIC_MIN_LIMIT ? Math.round(own) : base;
}
// the ceiling never sits below the editor's minimum
function rubricMaxFor(rubricId, ws) {
  const strat = channelStrategy(resolveChannelId(ws || currentWorkspace()));
  return Math.max(strat.rubricMaxSources || strat.rubricMinSources || 1, rubricMinFor(rubricId, ws));
}
function rubricGroupsInfo(ws) {
  const counts = rubricSourceCounts(ws);
  const st = ws && ws.state ? ws.state : state;
  const strat = channelStrategy(resolveChannelId(ws || currentWorkspace()));
  return channelRubrics(ws).map(function(r){
    const base = Math.max(1, Number(r && r.minSources || strat.rubricMinSources || 1));
    return { id: r.id, label: r.label, hint: r.hint || "", active: counts[r.id] || 0, min: rubricMinFor(r.id, ws), defaultMin: base, max: rubricMaxFor(r.id, ws),
      custom: !!(st.rubricLimits && st.rubricLimits[r.id]) };
  });
}
const RUBRIC_LIMIT_SEARCH_COOLDOWN_MS = 10 * 60000;
function setRubricLimit(rubricId, min) {
  if (!rubricIds().has(String(rubricId))) return { ok: false, error: "Такой группы нет" };
  const n = Math.round(Number(min));
  if (!Number.isFinite(n) || n < RUBRIC_MIN_LIMIT) return { ok: false, error: "Минимум — от " + RUBRIC_MIN_LIMIT };
  if (!state.rubricLimits || typeof state.rubricLimits !== "object" || Array.isArray(state.rubricLimits)) state.rubricLimits = {};
  const before = rubricMinFor(rubricId);
  if (before === n && state.rubricLimits[rubricId]) return { ok: true, rubric: rubricId, min: n, changed: false, search: false };
  state.rubricLimits[rubricId] = { min: n, at: new Date().toISOString() };
  // A changed limit is a fresh request: the hourly throttle and the "3 empty searches" rest are lifted — but at most
  // once per 10 minutes, so repeated clicks cannot turn into unlimited paid searches.
  state.sourceReplenish = state.sourceReplenish && typeof state.sourceReplenish === "object" ? state.sourceReplenish : {};
  const lastEditor = Date.parse(state.sourceReplenish.editorSearchAt || "") || 0;
  const search = Date.now() - lastEditor >= RUBRIC_LIMIT_SEARCH_COOLDOWN_MS;
  if (search) {
    state.sourceReplenish.editorSearchAt = new Date().toISOString();
    state.sourceReplenish.lastAt = "";
    if (state.sourceReplenish.misses) delete state.sourceReplenish.misses.rubric;
  }
  return { ok: true, rubric: rubricId, min: n, changed: before !== n, search: search };
}
function channelRubricConfigReady(ws) {
  const target = ws || currentWorkspace();
  const id = resolveChannelId(target);
  const st = target && target.state ? target.state : state;
  const migrations = Array.isArray(st && st.migrations) ? st.migrations : [];
  if (id === "shopping" && !migrations.includes("v0.53.0-shopping-finds")) return false;
  if (id === "auto" && !migrations.includes("v0.53.0-car-rubrics")) return false;
  // money/home already had their own rubric config before v0.55: no gate for them (no fallback window at startup)
  if (isRubricsV055Channel(id) && id !== "money" && id !== "home" && !migrations.includes(RUBRICS_V055_MIGRATION)) return false;
  return true;
}
// v0.55.0 channels run as one hourly stream: bloggers and Russian-AI sources compete in the regular slots
// (no separate :30 lanes) and rubrics are soft daily quotas.
function channelUnifiedSlots(ws) {
  const target = ws || currentWorkspace();
  if (!channelRubricConfigReady(target)) return false;
  return Boolean(channelStrategy(resolveChannelId(target)).unifiedSlots);
}
function channelSlotHours(ws) {
  if (!channelRubricConfigReady(ws)) return null;
  const hours = channelStrategy(resolveChannelId(ws || currentWorkspace())).slotHours;
  return Array.isArray(hours) && hours.length ? hours : null;
}
function channelSlotRubric(time, ws) {
  if (!channelRubricConfigReady(ws)) return "";
  const strat = channelStrategy(resolveChannelId(ws || currentWorkspace()));
  return String(strat && strat.slotRubrics && strat.slotRubrics[String(time || "")] || "");
}
function isChannelSlotHour(hour, ws) {
  const hours = channelSlotHours(ws);
  return hours ? hours.includes(Number(hour)) : (hour >= DYNAMIC_SLOT_START_HOUR && hour <= DYNAMIC_SLOT_END_HOUR);
}
function channelDailyMax(ws) {
  const hours = channelSlotHours(ws);
  return hours ? Math.min(DYNAMIC_DAILY_MAX, hours.length) : DYNAMIC_DAILY_MAX;
}
function channelExtraLane() {
  const ws = currentWorkspace();
  if (!channelRubricConfigReady(ws) && resolveChannelId(ws) === "shopping") return null;
  if (channelUnifiedSlots(ws)) return null;
  return CHANNEL_EXTRA_LANES[resolveChannelId(ws)] || null;
}
function bloggerSlotsFor() { const lane = channelExtraLane(); return lane ? lane.slots : []; }
function bloggerTargetFor() { const lane = channelExtraLane(); return lane ? Math.max(0, Number(lane.targetPerDay == null ? lane.slots.length : lane.targetPerDay)) : 0; }
// The extra lane runs when the channel has blogger sources (or, for an anySource lane, any enabled source).
function bloggerLaneActive() {
  const lane = channelExtraLane();
  return (state.sources || []).some(function(source){ return source && source.enabled && (source.group === "blogger" || Boolean(lane && lane.anySource && !isRussianAISource(source))); });
}
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


// Per-channel freshness (prompts/chto-tam.md section 2): the base limits (ARTICLE_MAX_AGE_HOURS, DYNAMIC_SLOT_MAX_AGE_HOURS,
// QUEUE_MAX_AGE_HOURS) are for 24-hour channels and are scaled up for the 72-hour ones (science, world, home, food).
function channelFreshnessFactor(ws) {
  try {
    const target = ws || currentWorkspace();
    return channelFreshnessHours(resolveChannelId(target), 24) / 24;
  } catch { return 1; }
}
function articleMaxAgeMs(ws) { return ARTICLE_MAX_AGE_HOURS * 3600000 * channelFreshnessFactor(ws); }
function dynamicSlotMaxAgeMs(ws) { return DYNAMIC_SLOT_MAX_AGE_HOURS * 3600000 * channelFreshnessFactor(ws); }
function queueMaxAgeHoursFor(ws) { return Math.min(96, QUEUE_MAX_AGE_HOURS * channelFreshnessFactor(ws)); }
// A queue item whose article carried no date lives shorter: its age is only known from the fetch time.
function dynamicItemMaxAgeMs(item) {
  let base = dynamicSlotMaxAgeMs();
  // This helper also runs while persisted workspaces are being normalized, before workspaceStore
  // itself has finished initialization. Prefer the item's channel hint and only consult runtime
  // workspace context once it is safe; startup must never dereference workspaceStore here.
  let channelId = String(item && (item.channelId || (item.editorialV2 && item.editorialV2.channelId)) || "");
  if (!channelId) {
    try { channelId = editorialChannelId(); } catch { channelId = ""; }
  }
  if (channelId === "money") {
    const bucket = String(item && (item.contentBucket || (item.editorialV2 && item.editorialV2.contentBucket)) || "");
    const durable = bucket === "taxes" || bucket === "income_benefits" || bucket === "money_howto";
    base = (durable ? 72 : 48) * 3600000;
  }
  const undated = item && item.newsId && !item.articlePublishedAt;
  return undated ? Math.min(base, UNDATED_ARTICLE_MAX_AGE_HOURS * 3600000) : base;
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
  // a channel with its own hours (home: 10 a day) offers only those hourly slots in the calendar
  let wsList = [];
  try { wsList = workspaceStore.workspaces || []; } catch { wsList = []; } // called while the store is still loading
  // `state` is the per-request proxy of the current workspace; other callers pass a workspace's own state object
  let ownerWs = null;
  try { ownerWs = targetState === state ? currentWorkspace() : null; } catch { ownerWs = null; }
  if (!ownerWs) ownerWs = wsList.find(function(w){ return w && w.state === targetState; }) || null;
  const ownHours = ownerWs ? channelSlotHours(ownerWs) : null;
  const unified = ownerWs ? channelUnifiedSlots(ownerWs) : false;
  if (unified && Array.isArray(schedule.slots)) {
    const laneTimes = new Set(schedule.slots.filter(function(slot){ return slot && (slot.kind === "blogger" || slot.kind === "russian-ai"); }).map(function(slot){ return String(slot.time || ""); }));
    schedule.slots = schedule.slots.filter(function(slot){ return slot && slot.kind !== "blogger" && slot.kind !== "russian-ai"; });
    // reservations of the removed :30 lane slots would keep their posts "used" with no slot left to publish them
    if (laneTimes.size) {
      for (const day of Object.keys(schedule.assignments)) {
        const dayMap = schedule.assignments[day];
        if (!dayMap || typeof dayMap !== "object") continue;
        for (const time of Object.keys(dayMap)) {
          if (!laneTimes.has(time)) continue;
          const lost = (targetState.queue || []).find(function(q){ return q && q.id === dayMap[time]; });
          clearDynamicAssignmentMarkers(lost, day + " " + time);
          delete dayMap[time];
        }
      }
    }
  }
  if (ownHours && Array.isArray(schedule.slots)) {
    schedule.slots = schedule.slots.filter(function(slot){
      if (!slot || slot.kind === "blogger" || slot.kind === "russian-ai" || slot.kind === "money-emergency" || !/^\d{2}:00$/.test(String(slot.time || ""))) return true;
      return ownHours.includes(Number(String(slot.time).slice(0, 2)));
    });
    schedule.maxPerDay = Math.min(Number(schedule.maxPerDay || ownHours.length), ownHours.length);
    schedule.targetPerDay = Math.min(Number(schedule.targetPerDay || ownHours.length), ownHours.length);
  }
  if (unified && ownHours && Array.isArray(schedule.slots)) {
    // a persisted calendar from before the channel went unified gets the new hourly slots too (money: 10:00 and 22:00)
    const have = new Set(schedule.slots.map(function(slot){ return String(slot && slot.time || ""); }));
    for (const h of ownHours) {
      const time = String(h).padStart(2, "0") + ":00";
      if (!have.has(time)) schedule.slots.push({ time: time, kind: "dynamic", label: "Динамическое окно" });
    }
    if (ownerWs && resolveChannelId(ownerWs) === "money" && !have.has("22:30")) schedule.slots.push({ time: "22:30", kind: "money-emergency", label: "Экстренно 95+" });
    schedule.slots.sort(function(a,b){ return String(a.time || "").localeCompare(String(b.time || "")); });
    schedule.maxPerDay = ownHours.length;
    schedule.targetPerDay = ownHours.length;
  }
  const ownerLane = ownerWs && !unified ? CHANNEL_EXTRA_LANES[resolveChannelId(ownerWs)] : null;
  if (ownerLane && Array.isArray(schedule.slots)) {
    const existing = new Set(schedule.slots.map(function(slot){ return String(slot && slot.time || ""); }));
    for (const time of ownerLane.slots || []) {
      if (!existing.has(time)) schedule.slots.push({ time: time, kind: "blogger", label: ownerLane.label || "Доп. пост" });
    }
    if (ownerWs && resolveChannelId(ownerWs) === "money" && !existing.has("22:30")) {
      schedule.slots.push({ time: "22:30", kind: "money-emergency", label: "Экстренно 95+" });
    }
    schedule.slots.sort(function(a,b){ return String(a.time || "").localeCompare(String(b.time || "")); });
    if (ownHours) {
      const total = ownHours.length + Math.max(0, Number(ownerLane.targetPerDay == null ? ownerLane.slots.length : ownerLane.targetPerDay));
      schedule.maxPerDay = total;
      schedule.targetPerDay = total;
    }
  }
  // Expose the approved rubric attached to every themed slot. The scheduler already enforces this
  // through channelSlotRubric(); keeping it on the slot lets the admin calendar show the real plan.
  if (ownerWs && Array.isArray(schedule.slots)) {
    const strategy = channelStrategy(resolveChannelId(ownerWs));
    const rubricById = new Map((strategy.rubrics || []).map(function(r){ return [String(r.id || ""), r]; }));
    for (const slot of schedule.slots) {
      if (!slot) continue;
      const rubricId = channelSlotRubric(String(slot.time || ""), ownerWs);
      const rubricMeta = rubricById.get(rubricId);
      if (rubricId && rubricMeta) {
        slot.rubric = rubricId;
        slot.rubricLabel = String(rubricMeta.label || rubricId);
      } else {
        delete slot.rubric;
        delete slot.rubricLabel;
      }
    }
  }
  return schedule;
}

function cleanupScheduleAssignments(targetState) {
  const schedule = ensureScheduleShape(targetState);
  const validIds = new Set((targetState.queue || []).map(function(item){ return item && item.id; }).filter(Boolean));
  const now = new Date();
  const today = moscowDateKey(now);
  const nowMinutes = moscowMinutes(now);
  const slotMeta = new Map((schedule.slots || []).map(function(slot){ return [String(slot && slot.time || ""), slot || {}]; }));
  Object.keys(schedule.assignments).forEach(function(day) {
    const byTime = schedule.assignments[day];
    if (!byTime || typeof byTime !== "object") {
      delete schedule.assignments[day];
      return;
    }
    Object.keys(byTime).forEach(function(time) {
      const id = byTime[time];
      const item = (targetState.queue || []).find(function(q){ return q && q.id === id; });
      let expired = day < today;
      if (!expired && day === today) {
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || ""));
        if (m) {
          const minutes = Number(m[1]) * 60 + Number(m[2]);
          const meta = slotMeta.get(String(time)) || {};
          const shortGrace = String(time).slice(-3) !== ":00" || (meta.kind && meta.kind !== "dynamic");
          const grace = shortGrace ? SCHEDULER_SLOT_WINDOW_MINUTES : DYNAMIC_ASSIGNMENT_GRACE_MIN;
          expired = minutes + grace < nowMinutes;
        }
      }
      if (!validIds.has(id) || expired) {
        delete byTime[time];
        clearDynamicAssignmentMarkers(item, day + " " + time);
      }
    });
    if (!Object.keys(byTime).length) delete schedule.assignments[day];
  });

  Object.keys(schedule.suppressed).forEach(function(day) {
    if (day < today) delete schedule.suppressed[day];
  });
}

function dynamicSlotKind(slot) {
  if (!slot) return undefined;
  if (slot.kind === "blogger") return "blogger";
  if (slot.kind === "russian-ai") return "russian-ai";
  if (slot.kind === "money-emergency") return "money-emergency";
  return undefined;
}

function clearDynamicAssignmentMarkers(item, slotKey) {
  if (!item) return;
  if (String(item.reservedFor || "") === slotKey) {
    delete item.reservedFor;
    delete item.reservedAt;
  }
  if (String(item.preparedFor || "") === slotKey) {
    delete item.preparedFor;
    delete item.preparedAt;
    delete item.preparedKind;
  }
  if (String(item.manualFor || "") === slotKey) {
    delete item.manualFor;
    delete item.manualAt;
  }
}

function setDynamicAssignment(day, time, item, kind, stage) {
  if (!item || !item.id) return null;
  const schedule = ensureScheduleShape(state);
  if (!schedule.assignments[day]) schedule.assignments[day] = {};
  if (!schedule.suppressed[day]) schedule.suppressed[day] = {};
  const slotKey = day + " " + time;
  const previousId = schedule.assignments[day][time];
  if (previousId && previousId !== item.id) {
    const previous = (state.queue || []).find(function(q){ return q && q.id === previousId; });
    clearDynamicAssignmentMarkers(previous, slotKey);
  }
  schedule.assignments[day][time] = item.id;
  delete schedule.suppressed[day][time];

  const nowIso = new Date().toISOString();
  if (stage === "manual") {
    clearDynamicAssignmentMarkers(item, slotKey);
    item.manualFor = slotKey;
    item.manualAt = nowIso;
  } else if (stage === "reserved") {
    if (String(item.manualFor || "") === slotKey) delete item.manualFor;
    item.reservedFor = slotKey;
    item.reservedAt = nowIso;
  } else {
    item.reservedFor = slotKey;
    item.reservedAt = item.reservedAt || nowIso;
    item.preparedFor = slotKey;
    item.preparedKind = kind === "blogger" ? "blogger" : (kind === "russian-ai" ? "russian-ai" : (kind === "money-emergency" ? "money-emergency" : "regular"));
    item.preparedAt = nowIso;
  }

  if (stage !== "reserved" && !item.sourceSelectedAt) {
    noteSourceEvent(item, "selected");
    item.sourceSelectedAt = nowIso;
  }
  if (stage === "prepared") {
    state.dynamicScheduler = state.dynamicScheduler || {};
    state.dynamicScheduler.lastPreparedAt = nowIso;
  }
  return item;
}

function ensureScheduleAssignments(targetState, dayKey) {
  const schedule = ensureScheduleShape(targetState);
  cleanupScheduleAssignments(targetState);
  // Selection helpers below are workspace-context aware and operate through the state proxy.
  // During startup normalization we only clean persisted assignments; live prefill runs for the active workspace.
  if (targetState !== state) return 0;

  const now = new Date();
  const today = moscowDateKey(now);
  const day = String(dayKey || today);
  if (day !== today) return 0;
  const nowMinutes = moscowMinutes(now);
  let added = 0;

  const slots = (schedule.slots || []).slice().sort(function(a, b){ return String(a && a.time || "").localeCompare(String(b && b.time || "")); });
  for (const slot of slots) {
    if (!slot || !/^\d{2}:\d{2}$/.test(String(slot.time || ""))) continue;
    const time = String(slot.time);
    if (slotMinutes(time) < nowMinutes) continue;
    if (schedule.suppressed[day] && schedule.suppressed[day][time]) continue;
    if (slotHasSuccessfulPublication(day + " " + time)) continue;

    const existingId = schedule.assignments[day] && schedule.assignments[day][time];
    const existing = existingId && (state.queue || []).find(function(q){ return q && q.id === existingId; });
    if (existing) continue;

    const item = dynamicBestQueueItem(dynamicSlotKind(slot), time);
    if (!item) continue;
    setDynamicAssignment(day, time, item, dynamicSlotKind(slot), "reserved");
    added += 1;
  }
  return added;
}

function rebalanceScheduleAssignments(targetState, dayKey) {
  const schedule = ensureScheduleShape(targetState);
  cleanupScheduleAssignments(targetState);
  if (targetState !== state) return 0;

  const now = new Date();
  const today = moscowDateKey(now);
  const day = String(dayKey || today);
  if (day !== today) return 0;
  const nowMinutes = moscowMinutes(now);
  const before = Object.assign({}, schedule.assignments[day] || {});

  for (const [time, id] of Object.entries(schedule.assignments[day] || {})) {
    if (slotMinutes(time) < nowMinutes) continue;
    const slotKey = day + " " + time;
    if (slotHasSuccessfulPublication(slotKey)) continue;
    const item = (state.queue || []).find(function(q){ return q && q.id === id; });
    if (!item) {
      delete schedule.assignments[day][time];
      continue;
    }
    // Manual choices are hard locks. Assignments from an older build without our reservation markers are
    // also preserved because they may have been selected manually before v0.54.4.
    const manual = String(item.manualFor || "") === slotKey;
    const knownAuto = String(item.reservedFor || "") === slotKey || String(item.preparedFor || "") === slotKey;
    if (manual || !knownAuto) continue;
    delete schedule.assignments[day][time];
    clearDynamicAssignmentMarkers(item, slotKey);
  }

  ensureScheduleAssignments(state, day);
  const after = schedule.assignments[day] || {};
  const times = new Set(Object.keys(before).concat(Object.keys(after)));
  let changed = 0;
  for (const time of times) if (String(before[time] || "") !== String(after[time] || "")) changed += 1;
  if (changed) saveState();
  return changed;
}

function removeQueueIdFromSchedule(targetState, queueId) {
  const schedule = ensureScheduleShape(targetState);
  const item = (targetState.queue || []).find(function(q){ return q && q.id === queueId; });
  Object.keys(schedule.assignments).forEach(function(day) {
    Object.keys(schedule.assignments[day] || {}).forEach(function(time) {
      if (schedule.assignments[day][time] === queueId) {
        delete schedule.assignments[day][time];
        clearDynamicAssignmentMarkers(item, day + " " + time);
      }
    });
    if (!Object.keys(schedule.assignments[day] || {}).length) delete schedule.assignments[day];
  });
}


function pruneQueueItems(targetState, options) {
  if (!targetState || !Array.isArray(targetState.queue)) return { removed: 0, expired: 0, overflow: 0 };
  let factor = options && Number(options.factor) > 0 ? Number(options.factor) : 1;
  if (!(options && options.factor)) {
    try {
      const owner = targetState === state ? currentWorkspace() : workspaceStore.workspaces.find(function(w){ return w && w.state === targetState; });
      if (owner) factor = channelFreshnessFactor(owner);
    } catch {}
  }
  const cutoff = Date.now() - QUEUE_MAX_AGE_HOURS * factor * 60 * 60 * 1000;
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

  // Overflow drops the tail of this order, so it has to put the posts that can actually go out first:
  // 0 = already assigned to a slot, 1 = approved and inside its publish window, 2 = approved but past it,
  // 3 = on hold / rejected. Inside a tier the AI score decides (it used to decide alone, so a held post
  // with a high score could push an approved, ready one out of the queue).
  const assignedIds = new Set();
  try {
    const schedule = ensureScheduleShape(targetState);
    Object.keys(schedule.assignments || {}).forEach(function(day){ Object.values(schedule.assignments[day] || {}).forEach(function(id){ if (id) assignedIds.add(id); }); });
  } catch {}
  const pruneTier = function(item) {
    if (assignedIds.has(item.id)) return 0;
    if (!isApprovedQueueItem(item)) return 3;
    return dynamicItemAgeMs(item) <= dynamicItemMaxAgeMs(item) ? 1 : 2;
  };
  automatic.sort(function(a, b) {
    const aTier = pruneTier(a), bTier = pruneTier(b);
    if (aTier !== bTier) return aTier - bTier;
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
    articleMaxAgeHours: ARTICLE_MAX_AGE_HOURS * factor,
    queueMaxAgeHours: QUEUE_MAX_AGE_HOURS * factor,
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

function normalizeWorkspaceState(saved, freshnessFactor) {
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
  pruneQueueItems(loaded, { factor: freshnessFactor });
  return loaded;
}
function freshWorkspaceState() {
  const fresh = structuredClone(defaultState);
  // Safe start: nothing is published automatically until enableAutoPublishingAfterChecks
  // (Telegram reachable + bot can post + enough sources + profile) has passed and switched it to AUTO.
  // A manual mode / auto-publish choice made in the admin before that clears the pending flag, so the gate never overrides it.
  fresh.mode = "REVIEW";
  fresh.autoGate = { pending: true, since: new Date().toISOString() };
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

// A public @username (not a numeric chat id like -1001234567890, which must never be shown as "@-100…").
function telegramUsernameOrEmpty(value) {
  const v = String(value || "").trim().replace(/^@/, "");
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(v) ? v : "";
}
function normalizeWorkspaceMeta(raw, fallbackId) {
  const id = String(raw && raw.id || fallbackId || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || DEFAULT_WORKSPACE_ID;
  const name = String(raw && raw.name || "Новый канал").trim().slice(0, 80) || "Новый канал";
  const slug = String(raw && raw.slug || "").trim().replace(/^@/, "").slice(0, 80);
  const initialsRaw = String(raw && raw.initials || "").trim().toUpperCase().replace(/[^A-ZА-Я0-9]/gi, "").slice(0, 3);
  const initials = initialsRaw || name.split(/\s+/).filter(Boolean).slice(0, 2).map(function(x){ return x[0] || ""; }).join("").toUpperCase().slice(0, 3) || "NF";
  const telegramChannel = String(raw && raw.telegramChannel || "").trim();
  const telegramPublicUsername = telegramUsernameOrEmpty(raw && raw.telegramPublicUsername) || telegramUsernameOrEmpty(telegramChannel) || telegramUsernameOrEmpty(slug);
  const avatarUrl = String(raw && raw.avatarUrl || "").trim();
  const avatarFile = String(raw && raw.avatarFile || "").trim();
  const channelIdRaw = String(raw && raw.channelId || "").trim().toLowerCase();
  const channelId = EDITORIAL_CHANNEL_IDS.includes(channelIdRaw) ? channelIdRaw : "";
  return { id, name, slug, initials, telegramChannel, telegramPublicUsername, avatarUrl, avatarFile, channelId, createdAt: String(raw && raw.createdAt || new Date().toISOString()), updatedAt: String(raw && raw.updatedAt || new Date().toISOString()), state: normalizeWorkspaceState(raw && raw.state, channelFreshnessFactor({ id, name, slug, telegramPublicUsername, channelId })) };
}
function isUsableWorkspaceStoreFile(parsed) {
  return Boolean(parsed && typeof parsed === "object" && Array.isArray(parsed.workspaces) && parsed.workspaces.length > 0);
}
const WORKSPACES_BAK_FILE = WORKSPACES_FILE + ".bak";
const workspaceStoreWriter = createAtomicStoreWriter({
  file: WORKSPACES_FILE,
  bakFile: WORKSPACES_BAK_FILE,
  validate: isUsableWorkspaceStoreFile,
  backupIntervalMs: Math.max(0, Number(process.env.WORKSPACES_BACKUP_INTERVAL_MS || 60000))
});
function loadWorkspaceStore() {
  ensureDataDir();
  // A damaged workspaces.json is NEVER replaced by a fresh one-channel store: it is moved
  // to workspaces.json.corrupt-<ts>, the last good .bak is used, and if that is unusable too
  // loadJsonStoreWithRecovery throws so the process refuses to start (and overwrite data).
  const loaded = loadJsonStoreWithRecovery({ file: WORKSPACES_FILE, bakFile: WORKSPACES_BAK_FILE, validate: isUsableWorkspaceStoreFile });
  if (loaded.status !== "missing") {
    if (loaded.status === "ok") workspaceStoreWriter.backupNow(); // a known-good copy exists from the very first boot after this change
    const parsed = loaded.data;
    const workspaces = parsed.workspaces.map(function(ws, index){ return normalizeWorkspaceMeta(ws, index === 0 ? DEFAULT_WORKSPACE_ID : "workspace-" + (index + 1)); });
    const requestedDefault = String(parsed.defaultWorkspaceId || "");
    const defaultWorkspaceId = workspaces.some(function(ws){ return ws.id === requestedDefault; }) ? requestedDefault : workspaces[0].id;
    return { version: 1, defaultWorkspaceId, workspaces };
  }
  // First start only: neither workspaces.json nor its backup exists.
  const legacyState = loadLegacyState();
  const first = normalizeWorkspaceMeta({ id: DEFAULT_WORKSPACE_ID, name: "Что там у ИИ?", slug: TELEGRAM_PUBLIC_USERNAME || "chtotamai", initials: "AI", telegramChannel: CHANNEL, telegramPublicUsername: TELEGRAM_PUBLIC_USERNAME, state: legacyState }, DEFAULT_WORKSPACE_ID);
  const created = { version: 1, defaultWorkspaceId: first.id, workspaces: [first] };
  if (fs.existsSync(WORKSPACES_FILE)) throw new Error("workspaces.json appeared during startup; refusing to overwrite it");
  try { workspaceStoreWriter.write(JSON.stringify(created, null, 2)); } catch (error) { console.error("Cannot write initial workspaces.json:", error.message); }
  return created;
}
const workspaceContext = new AsyncLocalStorage();
let workspaceStore = loadWorkspaceStore();
function getWorkspaceById(id) { const normalized = String(id || "").trim(); return workspaceStore.workspaces.find(function(ws){ return ws.id === normalized; }) || null; }
// A background task of a channel that was deleted meanwhile keeps running inside its old context. It must NOT
// fall back to the default (AI) channel: its writes would land there and its publishes would go to the wrong
// Telegram channel. It gets a detached, never persisted, channel-less workspace instead.
const orphanWorkspaces = new Map();
function orphanWorkspace(id) {
  let ws = orphanWorkspaces.get(id);
  if (!ws) {
    ws = { id: id, name: "(удалён)", slug: "", initials: "NF", telegramChannel: "", telegramPublicUsername: "", orphan: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), state: freshWorkspaceState() };
    ws.state.mode = "PAUSED";
    orphanWorkspaces.set(id, ws);
    if (orphanWorkspaces.size > 50) orphanWorkspaces.delete(orphanWorkspaces.keys().next().value);
    console.warn("WORKSPACE_GONE " + JSON.stringify({ workspace: String(id).slice(0, 64), note: "background task of a removed channel is isolated from the default channel" }));
  }
  return ws;
}
function requestedWorkspaceIdFromContext() { const context = workspaceContext.getStore(); return String(context && context.workspaceId || "").trim(); }
function currentWorkspaceId() { const requested = requestedWorkspaceIdFromContext(); if (requested) return requested; return workspaceStore.defaultWorkspaceId; }
function currentWorkspace() { const requested = requestedWorkspaceIdFromContext(); if (requested) { return getWorkspaceById(requested) || orphanWorkspace(requested); } return getWorkspaceById(workspaceStore.defaultWorkspaceId) || workspaceStore.workspaces[0]; }
function currentTelegramChannel() {
  const ws = currentWorkspace();
  return ws ? String(ws.telegramChannel || "").trim() : String(CHANNEL || "").trim();
}
function currentTelegramPublicUsername() {
  const ws = currentWorkspace();
  return ws
    ? (telegramUsernameOrEmpty(ws.telegramPublicUsername) || telegramUsernameOrEmpty(ws.slug) || telegramUsernameOrEmpty(ws.telegramChannel))
    : (telegramUsernameOrEmpty(TELEGRAM_PUBLIC_USERNAME) || telegramUsernameOrEmpty(CHANNEL));
}
// VK publishing per channel: the main cabinet has its own community token (direct VK + Postmypost); every other channel
// may publish to VK only through its own community connected in Postmypost (see refreshPostmypostMap).
function workspaceVkPublishingAllowed(ws) {
  const target = ws || currentWorkspace();
  if (!target || !VK_VIA_POSTMYPOST) return false;
  // VK posts go only through Postmypost (with the picture). The main cabinet is allowed before the first map refresh;
  // the publish itself refreshes the map and needs the pairing.
  if (target.id === workspaceStore.defaultWorkspaceId) return true;
  return Boolean(postmypostMap.byWorkspace[target.id]);
}
// Direct VK API calls (analytics, wall.get, community token) exist only for the main cabinet's community.
function workspaceVkDirectAllowed(ws) {
  const target = ws || currentWorkspace();
  return Boolean(target && target.id === workspaceStore.defaultWorkspaceId);
}
function publicWorkspaceMeta(ws) { return { id: ws.id, name: ws.name, slug: ws.slug || "", initials: ws.initials || "NF", telegramChannel: ws.telegramChannel || "", telegramPublicUsername: ws.telegramPublicUsername || "", avatarUrl: ws.avatarUrl || "", vkPublishingAllowed: workspaceVkPublishingAllowed(ws), channelId: ws.channelId || "", editorialChannelId: resolveChannelId(ws), createdAt: ws.createdAt, updatedAt: ws.updatedAt }; }
// Two cabinets posting into one Telegram chat would publish every post twice into it.
function telegramChatKey(raw) {
  const v = String(raw || "").trim();
  if (!v) return "";
  return /^-?\d+$/.test(v) ? v : v.replace(/^@/, "").toLowerCase();
}
function findWorkspaceByTelegramChat(raw, exceptId) {
  const key = telegramChatKey(raw);
  if (!key) return null;
  return workspaceStore.workspaces.find(function(ws){ return ws && ws.id !== exceptId && telegramChatKey(ws.telegramChannel) === key; }) || null;
}
function normalizeTelegramChannelInput(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const link = text.match(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z][A-Za-z0-9_]{4,31})\/?(?:\?.*)?$/i);
  if (link) return "@" + link[1];
  if (/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(text)) return "@" + text;
  return text; // @username и числовые chat_id (-100…) не трогаем
}
function channelConfigReport() {
  return buildChannelConfig(workspaceStore.workspaces, {
    profiles: EDITORIAL_CHANNEL_IDS,
    resolveChannelId: resolveChannelId,
    recovery: RECOVERY_CHANNELS,
    removed: REMOVED_CHANNELS_V055.concat(REMOVED_CHANNELS_V060),
    vkMap: VK_VIA_POSTMYPOST ? postmypostMap.byWorkspace : null,
    defaultWorkspaceId: workspaceStore.defaultWorkspaceId
  });
}
function workspaceSummary(ws) {
  const st = ws && ws.state && typeof ws.state === "object" ? ws.state : {};
  const sources = Array.isArray(st.sources) ? st.sources.filter(function(x){ return x && x.enabled; }).length : 0;
  const topic = st.topicSettings && st.topicSettings.default || {};
  const autoPublish = AUTO_PUBLISH_ENABLED && String(st.mode || "") === "AUTO" && topic.auto_publish_telegram !== false;
  const missing = [];
  if (!String(ws.telegramChannel || "").trim()) missing.push("telegramChannel");
  if (!String(ws.telegramPublicUsername || ws.slug || "").trim()) missing.push("username");
  if (!resolveChannelId(ws)) missing.push("profile");
  if (!String(ws.avatarUrl || "").trim()) missing.push("avatar");
  if (sources < 15) missing.push("sources");
  const history = Array.isArray(st.history) ? st.history : [];
  // Moscow day window computed once (no per-entry date formatting); invalid
  // dates and test publications are ignored.
  const now = new Date();
  const nowMinutes = moscowMinutes(now);
  const dayStartMs = now.getTime() - nowMinutes * 60000 - (now.getUTCSeconds() * 1000 + now.getUTCMilliseconds());
  let publishedToday = 0, lastMs = 0;
  for (const h of history) {
    if (!h || !h.publishedAt || h.publicationOrigin === "test") continue;
    const t = Date.parse(h.publishedAt);
    if (!Number.isFinite(t)) continue;
    if (t > lastMs) lastMs = t;
    if (t >= dayStartMs) publishedToday += 1;
  }
  const lastPublishedAt = lastMs ? new Date(lastMs).toISOString() : "";
  // planned posts per day: hourly slots of the channel plus its extra (:30) lane when it has one
  let plannedPerDay = 0;
  try {
    const ownHours = channelSlotHours(ws);
    const lane = channelUnifiedSlots(ws) ? null : (CHANNEL_EXTRA_LANES[resolveChannelId(ws)] || null);
    plannedPerDay = (ownHours ? ownHours.length : DYNAMIC_DAILY_TARGET) + (lane ? Math.max(0, Number(lane.targetPerDay == null ? (lane.slots || []).length : lane.targetPerDay)) : 0);
  } catch { plannedPerDay = 0; }
  const queue = Array.isArray(st.queue) ? st.queue.length : 0;
  // Operational problems (what stops posts from coming out), separate from
  // cosmetic settings like the avatar.
  const problems = [];
  const hoursSincePost = lastMs ? (Date.now() - lastMs) / 3600000 : null;
  if (autoPublish && nowMinutes >= 10 * 60 && (hoursSincePost == null || hoursSincePost > 3)) problems.push("stale");
  if (autoPublish && queue === 0) problems.push("emptyQueue");
  if (!autoPublish && String(st.mode || "") !== "PAUSED") problems.push("notAuto");
  return {
    mode: String(st.mode || ""),
    autoPublish: autoPublish,
    queue: queue,
    sources: sources,
    published: Number(st.stats && st.stats.published || 0),
    publishedToday: publishedToday,
    plannedPerDay: plannedPerDay,
    lastPublishedAt: lastPublishedAt,
    missing: missing,
    problems: problems
  };
}
// Every saveState() used to serialise and fsync the WHOLE 16-channel store (tens of MB, pretty-printed, plus a
// second copy in state.json) synchronously: 0.2-1 s per call, dozens of calls at the top of the hour, and the
// stalled event loop turned fast answers into DB / Telegram / Postmypost timeouts. Now saves are coalesced: the
// store is written at most once per STATE_SAVE_DEBOUNCE_MS (forced after STATE_SAVE_MAX_WAIT_MS), compact,
// and flushed synchronously on shutdown signals. STATE_SAVE_DEBOUNCE_MS=0 restores immediate writes.
const STATE_SAVE_DEBOUNCE_MS = Math.max(0, Number(process.env.STATE_SAVE_DEBOUNCE_MS == null || process.env.STATE_SAVE_DEBOUNCE_MS === "" ? 1500 : process.env.STATE_SAVE_DEBOUNCE_MS) || 0);
const STATE_SAVE_MAX_WAIT_MS = Math.max(STATE_SAVE_DEBOUNCE_MS, Number(process.env.STATE_SAVE_MAX_WAIT_MS || 5000) || 5000);
let storeFlushTimer = null;
let storeDirtySince = 0;
let storeFlushStats = { writes: 0, requests: 0, lastMs: 0, maxMs: 0, lastError: "" };
function assertStorePersistable() {
  if (!workspaceStore || !Array.isArray(workspaceStore.workspaces) || !workspaceStore.workspaces.length) {
    throw new Error("refusing to persist an empty workspace store");
  }
}
function flushWorkspaceStoreNow() {
  if (storeFlushTimer) { clearTimeout(storeFlushTimer); storeFlushTimer = null; }
  storeDirtySince = 0;
  ensureDataDir();
  assertStorePersistable();
  const started = Date.now();
  // temp file + fsync + rename; the previous good copy is rotated to workspaces.json.bak
  workspaceStoreWriter.write(JSON.stringify(workspaceStore));
  const defaultWorkspace = getWorkspaceById(workspaceStore.defaultWorkspaceId);
  if (defaultWorkspace && defaultWorkspace.state) atomicWriteFileSync(STATE_FILE, JSON.stringify(defaultWorkspace.state));
  storeFlushStats.writes += 1;
  storeFlushStats.lastMs = Date.now() - started;
  storeFlushStats.maxMs = Math.max(storeFlushStats.maxMs, storeFlushStats.lastMs);
  storeFlushStats.lastError = "";
}
function persistWorkspaceStore() {
  assertStorePersistable();
  storeFlushStats.requests += 1;
  if (!STATE_SAVE_DEBOUNCE_MS) return flushWorkspaceStoreNow();
  const now = Date.now();
  if (!storeDirtySince) storeDirtySince = now;
  if (storeFlushTimer) clearTimeout(storeFlushTimer);
  const wait = Math.max(0, Math.min(STATE_SAVE_DEBOUNCE_MS, storeDirtySince + STATE_SAVE_MAX_WAIT_MS - now));
  storeFlushTimer = setTimeout(function() {
    storeFlushTimer = null;
    try { flushWorkspaceStoreNow(); }
    catch (error) {
      storeFlushStats.lastError = String(error && error.message || error);
      console.error("STATE_SAVE_FAILED " + JSON.stringify({ error: storeFlushStats.lastError }));
      // keep the data dirty: the next save (or the shutdown flush) tries again
      storeDirtySince = storeDirtySince || Date.now();
    }
  }, wait);
  if (storeFlushTimer.unref) storeFlushTimer.unref();
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

    // Russian AI sources that do not open from the server (fetch failed / captcha)
    // are replaced by working pages: Habr company blogs, Habr AI hub, vc.ru, Telegram.
    const ruFixMigration = "v0.39.3-ru-ai-sources-fix";
    if (!aiWorkspace.state.migrations.includes(ruFixMigration)) {
      const list = aiWorkspace.state.sources = Array.isArray(aiWorkspace.state.sources) ? aiWorkspace.state.sources : [];
      const byId = function(id){ return list.find(function(x){ return x && x.id === id; }); };
      const now = new Date().toISOString();
      const yandex = byId("ru-yandex-ai");
      if (yandex) { yandex.url = "https://habr.com/ru/companies/yandex/news/"; yandex.name = "Яндекс на Хабре"; yandex.enabled = true; delete yandex.autoPaused; delete yandex.preview; }
      const airi = byId("ru-airi");
      if (airi) { airi.url = "https://t.me/s/airi_research_institute"; airi.group = "creator"; airi.enabled = true; delete airi.autoPaused; delete airi.preview; }
      for (const id of ["ru-ntechlab", "ru-tbank-ai"]) {
        const src = byId(id);
        if (src && src.enabled) { src.enabled = false; src.autoPaused = { reason: "сайт не открывается с сервера, заменён рабочим источником", at: now }; }
      }
      for (const add of [
        { id: "ru-habr-ai", name: "Хабр: ИИ (новости)", type: "web", group: "media", priority: 2, url: "https://habr.com/ru/hubs/artificial_intelligence/news/", enabled: true },
        { id: "ru-vc-ai", name: "vc.ru: ИИ", type: "web", group: "media", priority: 2, url: "https://vc.ru/ai", enabled: true }
      ]) {
        if (byId(add.id)) continue;
        const sameUrl = list.find(function(x){ return x && String(x.url || "").replace(/\/+$/, "") === add.url.replace(/\/+$/, ""); });
        if (sameUrl && String(sameUrl.id || "").startsWith("auto-")) {
          // An auto-added copy becomes the Russian AI source (keeps its stats and on/off state).
          const stats = aiWorkspace.state.sourceStats || {};
          if (stats[sameUrl.id] && !stats[add.id]) { stats[add.id] = stats[sameUrl.id]; delete stats[sameUrl.id]; }
          sameUrl.id = add.id; sameUrl.name = add.name; sameUrl.type = add.type; sameUrl.group = add.group; sameUrl.priority = add.priority;
        } else if (!sameUrl) {
          list.push(Object.assign({ mediaLicense: "unknown", copyrightMode: "facts_only" }, add));
        }
      }
      aiWorkspace.state.migrations.push(ruFixMigration);
      aiWorkspace.updatedAt = now;
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

  // NOTE (audit): this block recreates the "chtotamtachki" workspace on every start, so an
  // intentionally deleted channel comes back. Everything below dereferences `cars.state`, and
  // a tombstone list would have to be persisted in workspaces.json and honoured by the delete
  // endpoint, so this is deliberately left unchanged (risky for existing deployments).
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
  const carRubricMigration = "v0.53.0-car-rubrics";
  if (!cars.state.migrations.includes(carRubricMigration)) {
    normalizeAutoRubricSources(cars.state, APPROVED_AUTO_BLOGGER_SOURCES, BLOGGER_SLOTS, new Date().toISOString());
    cars.state.migrations.push(carRubricMigration);
    cars.updatedAt = new Date().toISOString();
    changed = true;
  }

  // v0.53.1: v0.53.0 changed the approved blogger list, but old source-quality streaks survived.
  // Give the newly approved pack a clean 14-day evaluation window instead of immediately pausing it for old rejects.
  const carBloggerResetMigration = "v0.53.1-car-approved-blogger-reset";
  if (!cars.state.migrations.includes(carBloggerResetMigration)) {
    const now = new Date().toISOString();
    normalizeAutoRubricSources(cars.state, APPROVED_AUTO_BLOGGER_SOURCES, BLOGGER_SLOTS, now);
    const reset = resetApprovedAutoBloggers(cars.state, APPROVED_AUTO_BLOGGER_SOURCES, now);
    cars.state.migrations.push(carBloggerResetMigration);
    cars.updatedAt = now;
    console.log("CAR_BLOGGER_RESET_V0531 " + JSON.stringify({ workspace: cars.id, reset: reset.reset.length }));
    changed = true;
  }

  // v0.54.0: split the seeded car sources into separate theme groups (previously almost all sat in "premieres").
  const carGroupsMigration = "v0.54.0-car-rubric-groups";
  if (!cars.state.migrations.includes(carGroupsMigration)) {
    const reassigned = reassignCarRubricGroups(cars.state, new Date().toISOString());
    cars.state.migrations.push(carGroupsMigration);
    cars.updatedAt = new Date().toISOString();
    console.log("CAR_RUBRIC_GROUPS_V0540 " + JSON.stringify({ workspace: cars.id, reassigned: reassigned.length }));
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

(function backfillChannelDnaV2SourceClasses(){
  let changed = false;
  const migration = "v0.44.0-channel-dna-v2";
  for (const ws of workspaceStore.workspaces) {
    if (!ws || !ws.state) continue;
    ws.state.migrations = Array.isArray(ws.state.migrations) ? ws.state.migrations : [];
    if (ws.state.migrations.includes(migration)) continue;
    for (const source of (ws.state.sources || [])) {
      if (!source) continue;
      const next = sourceClassFor(source);
      if (source.sourceClass !== next) {
        source.sourceClass = next;
        changed = true;
      }
    }
    for (const item of (ws.state.queue || [])) {
      if (!item) continue;
      if (!item.sourceClass) item.sourceClass = sourceClassFor(item);
    }
    for (const item of (ws.state.history || [])) {
      if (!item) continue;
      if (!item.sourceClass) item.sourceClass = sourceClassFor(item);
    }
    ws.state.migrations.push(migration);
    ws.updatedAt = new Date().toISOString();
    changed = true;
  }
  if (changed) persistWorkspaceStore();
})();

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
      row.newsId || null, pgJsonString(row.extra || {})
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
  // Answered by Claude through the failover: that call has its own Anthropic cost row, no phantom OpenAI one.
  if (data && data.failover && data.failover.provider === "anthropic") return null;
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
    image_generation: "AI-обложка / fallback",
    promotion_creative: "Продвижение · рекламный креатив"
  };
  return labels[String(value || "")] || String(value || "Другое");
}

function providerLabel(value) {
  const map = { openai: "OpenAI", anthropic: "Anthropic Claude" };
  return map[String(value || "")] || String(value || "Другое");
}

// USD/RUB: CBR (cached 6 h) -> last known good CBR value (persisted in the network cost-budget
// state, survives restarts) -> COST_USD_RUB_RATE -> built-in constant. It never returns 0/null:
// a missing rate used to make budgets compute as 0 RUB and silently switch economy mode off.
let usdRubFailedAt = 0;
let usdRubFallbackLogged = "";
let lastUsdRubInfo = { source: "none", at: 0 };
async function getUsdRubRate() {
  const now = Date.now();
  if (cbrUsdRubCache.value && now - cbrUsdRubCache.at < 6 * 60 * 60 * 1000) return cbrUsdRubCache.value;
  const retryAfterFailureMs = 5 * 60 * 1000;
  if (!(usdRubFailedAt && now - usdRubFailedAt < retryAfterFailureMs)) {
    try {
      const response = await fetch("https://www.cbr.ru/scripts/XML_daily.asp", {
        headers: { "user-agent": "NewsFactory/1.0" },
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) throw new Error("CBR HTTP " + response.status);
      const rate = parseCbrUsdRate(await response.text());
      cbrUsdRubCache = { at: now, value: rate };
      usdRubFailedAt = 0;
      usdRubFallbackLogged = "";
      lastUsdRubInfo = { source: "cbr", at: now };
      try {
        const budget = networkCostBudgetState();
        const stored = Number(budget.lastUsdRub && budget.lastUsdRub.value);
        if (!(Math.abs(stored - rate) < 0.00001)) {
          budget.lastUsdRub = { value: rate, at: new Date(now).toISOString() };
          persistWorkspaceStore();
        }
      } catch (error) { console.warn("Cannot persist last known USD/RUB rate:", error.message); }
      return rate;
    } catch (error) {
      usdRubFailedAt = now;
      console.warn("CBR USD/RUB rate unavailable:", error && error.message || error);
    }
  }
  let stored = null;
  try {
    const saved = networkCostBudgetState().lastUsdRub;
    if (saved && Number(saved.value) > 0) stored = { value: Number(saved.value), at: Date.parse(saved.at) || 0 };
  } catch {}
  const lastGood = cbrUsdRubCache.value ? { value: cbrUsdRubCache.value, at: cbrUsdRubCache.at } : stored;
  const fb = resolveUsdRubFallback({ lastGood: lastGood, configured: process.env.COST_USD_RUB_RATE, defaultRate: DEFAULT_USD_RUB_RATE });
  lastUsdRubInfo = { source: fb.source, at: fb.at };
  if (usdRubFallbackLogged !== fb.source) {
    usdRubFallbackLogged = fb.source; // log once per outage / source change
    console.warn("USD/RUB: CBR unavailable, using " + fb.source + " rate " + fb.rate + " for cost budgets and economy mode");
  }
  return fb.rate;
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
    fxAvailable: Boolean(rate),
    fxSource: lastUsdRubInfo.source
  };
}

function networkApiBalances() {
  const ws = getWorkspaceById(workspaceStore.defaultWorkspaceId) || workspaceStore.workspaces[0];
  if (!ws.state.apiBalances || typeof ws.state.apiBalances !== "object") ws.state.apiBalances = {};
  return ws.state.apiBalances;
}

async function apiBalanceSnapshot(knownRate) {
  const stored = networkApiBalances();
  const rate = Number(knownRate || 0) || await getUsdRubRate();
  const now = new Date();
  const out = [];
  for (const provider of BALANCE_PROVIDERS) {
    const cfg = stored[provider];
    const base = { provider: provider, name: providerLabel(provider), configured: false };
    if (!cfg || !Number.isFinite(Number(cfg.amountUsd)) || !cfg.asOf || !Number.isFinite(new Date(cfg.asOf).getTime())) {
      out.push(base);
      continue;
    }
    if (!db || !dbReady) {
      out.push(Object.assign(base, { configured: true, available: false, amountUsd: Number(cfg.amountUsd), asOf: cfg.asOf, lowUsd: Number(cfg.lowUsd || 0) }));
      continue;
    }
    const asOf = new Date(cfg.asOf);
    const recentFrom = new Date(Math.max(asOf.getTime(), now.getTime() - 7 * 24 * 60 * 60 * 1000));
    let spentQ, recentQ;
    try {
      spentQ = await db.query(
        "SELECT COALESCE(SUM(cost_usd),0)::float8 AS usd, COUNT(*) FILTER (WHERE NOT pricing_known)::int AS unpriced FROM cost_events WHERE provider=$1 AND at >= $2",
        [provider, asOf.toISOString()]
      );
      recentQ = await db.query(
        "SELECT COALESCE(SUM(cost_usd),0)::float8 AS usd FROM cost_events WHERE provider=$1 AND at >= $2",
        [provider, recentFrom.toISOString()]
      );
    } catch (error) {
      // Повреждённое сохранённое значение не должно ломать весь отчёт «Расходы».
      console.warn("API balance calculation failed for " + provider + ":", error.message);
      out.push(Object.assign(base, { configured: true, available: false, amountUsd: Number(cfg.amountUsd), asOf: cfg.asOf, lowUsd: Number(cfg.lowUsd || 0) }));
      continue;
    }
    const calc = computeApiBalance(cfg, spentQ.rows[0] && spentQ.rows[0].usd, recentQ.rows[0] && recentQ.rows[0].usd, now, COST_TRACKING_RETENTION_DAYS);
    out.push(Object.assign(base, calc, {
      configured: true,
      available: true,
      unpricedCalls: Number(spentQ.rows[0] && spentQ.rows[0].unpriced || 0),
      remainingRub: rate ? calc.remainingUsd * rate : null,
      spentRub: rate ? calc.spentUsd * rate : null
    }));
  }
  return out;
}

// Provider out of money: tell the owner in Telegram (once per 3 hours per provider)
// instead of silently failing every call.
const billingAlertSentAt = {};
function alertProviderLabel(key) { return key === "openai" ? "OpenAI" : "Anthropic (Claude)"; }
function maybeBillingAlert(text, forcedProvider) {
  const msg = String(text || "");
  let provider = forcedProvider === "openai" || forcedProvider === "anthropic" ? alertProviderLabel(forcedProvider) : "";
  if (!provider) {
    if (/no credits remaining|insufficient_quota|exceeded your current quota/i.test(msg)) provider = "OpenAI";
    else if (/credit balance is too low/i.test(msg)) provider = "Anthropic (Claude)";
  }
  if (!provider || !BOT_TOKEN) return;
  const last = billingAlertSentAt[provider] || 0;
  if (Date.now() - last < 3 * 3600000) return;
  const ws = getWorkspaceById(workspaceStore.defaultWorkspaceId) || workspaceStore.workspaces[0];
  const chatId = TELEGRAM_ALERT_CHAT_ID || String(ws && ws.state && ws.state.telegramAlertChatId || "").trim();
  // Throttle the log line too, but retry the message soon if no chat is known yet.
  billingAlertSentAt[provider] = chatId ? Date.now() : Date.now() - 3 * 3600000 + 10 * 60000;
  console.warn("BILLING_EXHAUSTED " + JSON.stringify({ provider: provider, alerted: Boolean(chatId) }));
  if (!chatId) return;
  const key = provider === "OpenAI" ? "openai" : "anthropic";
  const other = key === "openai" ? "anthropic" : "openai";
  const otherConfigured = other === "openai" ? Boolean(OPENAI_API_KEY) : Boolean(ANTHROPIC_API_KEY);
  const otherUp = otherConfigured && !providerBreaker.isOpen(other);
  const link = key === "openai" ? "https://platform.openai.com/settings/organization/billing/" : "https://console.anthropic.com/settings/billing";
  let effect;
  if (PROVIDER_FAILOVER_ENABLED && otherUp) effect = "Публикация не остановилась: " + alertProviderLabel(other) + " сам взял на себя написание и проверку постов. Как только баланс будет пополнен, всё вернётся на обычную схему автоматически.";
  else if (PROVIDER_FAILOVER_ENABLED && otherConfigured) effect = "Второй сервис тоже недоступен — новые посты не пишутся, пока не пополнится хотя бы один баланс. Каналы выпустят то, что уже в очереди.";
  else effect = key === "openai" ? "Новые посты не пишутся — каналы выпустят то, что уже в очереди, и остановятся." : "Вторая проверка фактов не работает — посты проверяет только одна нейросеть.";
  telegramApi("sendMessage", {
    chat_id: chatId,
    text: "🚨 News Factory: у " + provider + " закончились деньги (или ключ не принят).\n" + effect + "\nПополните баланс: " + link,
    disable_web_page_preview: true
  }).catch(function(error){
    // Failed send: allow another try in 10 minutes instead of 3 hours.
    billingAlertSentAt[provider] = Date.now() - 3 * 3600000 + 10 * 60000;
    console.warn("Billing alert failed:", error.message);
  });
}

// One switch for the whole app: after "no money / bad key" a provider is skipped for PROVIDER_BREAKER_COOLDOWN_MIN
// minutes (then retried once), so every post does not pay for a request that is certain to fail.
const providerBreaker = createProviderBreaker({
  cooldownMs: PROVIDER_BREAKER_COOLDOWN_MIN * 60000,
  cooldownByKind: {
    billing: Math.max(PROVIDER_BREAKER_COOLDOWN_MIN, 60) * 60000,
    auth: Math.max(PROVIDER_BREAKER_COOLDOWN_MIN, 240) * 60000,
    outage: Math.min(PROVIDER_BREAKER_COOLDOWN_MIN, 5) * 60000
  },
  onTrip: function(provider, reason, kind) {
    console.warn("PROVIDER_SWITCHED_OFF " + JSON.stringify({ provider: provider, kind: kind, failover: PROVIDER_FAILOVER_ENABLED, reason: String(reason || "").slice(0, 200) }));
    maybeBillingAlert(reason, provider);
  },
  onRecover: function(provider) {
    console.log("PROVIDER_RECOVERED " + JSON.stringify({ provider: provider }));
    delete billingAlertSentAt[alertProviderLabel(provider)];
    sendOwnerAlert("✅ News Factory: " + alertProviderLabel(provider) + " снова отвечает — работа вернулась на обычную схему.").catch(function(){});
  }
});

// Drop-in for the OpenAI Responses endpoint fetch used by the helper models (headline filter, scoring,
// translation, story composer ...): OpenAI first, Claude when OpenAI has no money / is down.
const llmResponsesFetch = createResponsesFailover({
  breaker: providerBreaker,
  get anthropicApiKey() { return PROVIDER_FAILOVER_ENABLED ? ANTHROPIC_API_KEY : ""; },
  get anthropicModel() { return ANTHROPIC_ASSIST_MODEL; },
  onUsage: function(event) { return recordCostUsage(event); },
  onFailover: function(info) {
    const now = Date.now();
    if (now - (llmResponsesFetch.lastLogAt || 0) < 60000) return;
    llmResponsesFetch.lastLogAt = now;
    console.warn("LLM_FAILOVER " + JSON.stringify({ from: info.from, to: info.to, why: info.why }));
  }
});

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
  if (!snap.fxAvailable) {
    // Defensive: with no rate every RUB figure is 0 and the ratios would switch economy mode off.
    // Keep the previous decision instead.
    return Object.assign({}, snap, { economyMode: Boolean(b.economyMode), economyReason: String(b.economyReason || "") });
  }
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
    // The dedupe key is claimed BEFORE the Telegram await (concurrent evaluations and a failing
    // 403/slow Telegram used to produce 6-8 identical sends); failures back off for 30 minutes.
    const alertsDirty = await dispatchBudgetAlerts({
      alerts: b.alerts,
      day: mskDay,
      thresholds: [80, 100],
      reached: function(threshold) { return Boolean((snap.dailyBudgetRub && snap.dailyRatio >= threshold/100) || (snap.monthlyBudgetRub && snap.monthlyRatio >= threshold/100)); },
      send: function(threshold) { return sendCostBudgetAlert(snap, threshold); },
      onError: function(error) { console.warn("Cost budget Telegram alert failed:", error.message); }
    });
    if (alertsDirty) dirty = true;
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
  // emoji have no glyph in the card font (they were drawn as boxes): keep letters, digits and punctuation only
  // emoji, CJK and other scripts missing from DejaVu are dropped (they rendered as boxes)
  const noEmoji = cardSafeText;
  const raw = noEmoji(String(payload && payload.title || "Новость").slice(0, 400)) || "Новость";
  const esc = function(v){ return String(v||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); };
  const channel = noEmoji(currentWorkspace().name || "News Factory") || "News Factory";
  const topic = String(payload && payload.topicId || currentWorkspace().channelId || "NEWS").toUpperCase();
  const seed = crypto.createHash("sha256").update(channel + "|" + raw).digest()[0];
  const variants = [
    { a:"#0b1630", b:"#2849a8", accent:"#58d6ff" },
    { a:"#10231f", b:"#176b5c", accent:"#54e3b2" },
    { a:"#22142f", b:"#71356f", accent:"#f58bd8" },
    { a:"#251b0d", b:"#8a5a16", accent:"#ffd36b" },
    { a:"#1f1414", b:"#7b3030", accent:"#ff8b8b" },
    { a:"#101a28", b:"#225c7a", accent:"#7dd7ff" }
  ];
  const v = variants[seed % variants.length];
  // DejaVu Bold is wider than Arial: 26 chars per line, 4 lines, long words split, overflow ends with "…"
  const lines = wrapCardLines(raw, 26, 4);
  const text = lines.map(function(x,i){
    return '<text x="92" y="'+(355+i*98)+'" font-family="Arial,sans-serif" font-size="64" font-weight="800" fill="#fff">'+esc(x)+'</text>';
  }).join("");
  const note = esc(wrapCardLines(cardSafeText(payload && payload.cardNote != null ? payload.cardNote : ""), 80, 1)[0] || "");
  const variant = seed % 3;
  const decor = variant === 0
    ? '<circle cx="1320" cy="170" r="240" fill="'+v.accent+'" opacity=".18"/><circle cx="1400" cy="860" r="330" fill="'+v.accent+'" opacity=".08"/>'
    : variant === 1
      ? '<path d="M1040 0 L1536 0 L1536 1024 L1280 1024 Z" fill="'+v.accent+'" opacity=".10"/><circle cx="1280" cy="260" r="170" fill="'+v.accent+'" opacity=".12"/>'
      : '<rect x="1120" y="-80" width="520" height="1180" rx="220" transform="rotate(18 1120 -80)" fill="'+v.accent+'" opacity=".10"/>';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024">'+
    '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="'+v.a+'"/><stop offset="1" stop-color="'+v.b+'"/></linearGradient></defs>'+
    '<rect width="1536" height="1024" fill="url(#bg)"/>'+decor+
    '<rect x="92" y="92" width="14" height="110" rx="7" fill="'+v.accent+'"/>'+
    '<text x="138" y="138" font-family="Arial,sans-serif" font-size="38" font-weight="800" fill="#fff">'+esc(wrapCardLines(channel, 48, 1)[0] || "News Factory")+'</text>'+
    '<text x="138" y="188" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="'+v.accent+'">'+esc(topic)+'</text>'+
    text+
    '<text x="92" y="925" font-family="Arial,sans-serif" font-size="28" fill="#dbe7ff">'+note+'</text>'+
    '<text x="1440" y="925" text-anchor="end" font-family="Arial,sans-serif" font-size="25" font-weight="700" fill="'+v.accent+'">NEWS FACTORY</text>'+
    '</svg>';
  const fileName = "budget_card_" + String(payload && payload.id || crypto.randomBytes(5).toString("hex")).replace(/[^a-zA-Z0-9_-]/g,"_").slice(0,70) + "_" + Date.now() + ".webp";
  await sharp(Buffer.from(svg)).webp({quality:88}).toFile(path.join(MEDIA_DIR,fileName));
  return { url: mediaPublicUrl(fileName), model: "local-branded-card-v2", economy: true, variant: variant };
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
      balances: await apiBalanceSnapshot(rate),
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
    balances: await apiBalanceSnapshot(rate),
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
  return /(?:^|\/)(?:cover_[a-zA-Z0-9_-]+\.png|budget_card_[a-zA-Z0-9_-]+\.webp)(?:\?|$)/.test(v);
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
  // Slot-preparation dry run (v0.58.0): same decisions, but no card file is rendered for a copy that is thrown away.
  const dryRun = out.__photoPrecheck === true;
  delete out.__photoPrecheck;
  const renderCard = function(args) { return dryRun ? Promise.resolve({ url: "precheck://card", model: "precheck" }) : renderEconomyTextCard(args); };
  const license = sourceMediaLicense(out);
  out.mediaLicense = license;
  out.copyrightSafe = COPYRIGHT_SAFE_MODE;
  out.copyrightMediaMode = COPYRIGHT_MEDIA_MODE;
  out.copyrightPolicyVersion = "v2";
  if (mediaLicenseAllowsReuse(license)) {
    const candidatePack = Array.from(new Set(
      [out.imageUrl].concat(Array.isArray(out.mediaPackUrls) ? out.mediaPackUrls : []).filter(Boolean)
    ));
    if (candidatePack.length) {
      const clean = await sanitizeMediaPack(candidatePack, out.editorialV2 && out.editorialV2.album === true ? MEDIA_DIRECTOR_MAX_IMAGES : 1);
      if (clean.length) {
        out.imageUrl = clean[0];
        out.mediaPackUrls = clean;
      } else {
        out.originalImageUrl = out.originalImageUrl || out.imageUrl || "";
        out.imageUrl = "";
        out.mediaPackUrls = [];
        out.mediaQualityRejectedAtPublish = true;
      }
    }
    if (!out.imageUrl && !out.videoUrl && !out.generatedImageUrl && GENERATE_COVER_IF_MISSING && !TEXT_CARD_POSTS_ALLOWED) {
      const error = new Error("Нет подходящего фото: пост с текстовой карточкой не публикуется");
      error.code = "NO_PHOTO"; error.permanent = true; // this post never gets a photo: free the slot for the next one
      throw error;
    }
    if (textCardBlocked(out)) {
      const error = new Error("Нет фото: пост с текстовой карточкой не публикуется");
      error.code = "NO_PHOTO"; error.permanent = true; // this post never gets a photo: free the slot for the next one
      throw error;
    }
    if (!out.imageUrl && !out.videoUrl && !out.generatedImageUrl && GENERATE_COVER_IF_MISSING) {
      const local = await renderCard({
        id: out.newsId || out.postId || out.id || newId("media_gate"),
        title: out.title || currentWorkspace().name || "News Factory",
        text: out.text || "",
        topicId: out.topicId || currentWorkspace().channelId || "",
        cardNote: "Редакционная карточка"
      });
      out.generatedImageUrl = local.url;
      out.generatedBy = local.model;
      out.mediaType = "generated";
      out.mediaStatus = "local_card";
      out.mediaOrigin = "local_branded_card";
      out.copyrightMediaDecision = "bad_source_media_replaced";
    }
    if (!out.mediaOrigin && (out.videoUrl || out.imageUrl)) out.mediaOrigin = "source_media";
    if (MEDIA_REQUIRED && !out.imageUrl && !out.videoUrl && !out.generatedImageUrl) {
      throw new Error("Публикация запрещена: качественное медиа не подготовлено");
    }
    return out;
  }

  const generatedIndependent =
    out.mediaStatus === "generated" ||
    out.mediaStatus === "local_card" ||
    out.mediaOrigin === "ai_generated" ||
    out.mediaOrigin === "local_branded_card" ||
    isIndependentGeneratedUrl(out.generatedImageUrl);

  out.originalImageUrl = out.originalImageUrl || out.imageUrl || "";
  out.originalVideoUrl = out.originalVideoUrl || out.videoUrl || "";
  out.imageUrl = "";
  out.videoUrl = "";
  // The album pack holds third-party photos too: when the source media is not reusable it must not bypass the filter.
  out.mediaPackUrls = [];

  if (!generatedIndependent) out.generatedImageUrl = "";
  if (!TEXT_CARD_POSTS_ALLOWED && GENERATE_COVER_IF_MISSING && (!out.generatedImageUrl || /(?:^|\/)budget_card_/.test(out.generatedImageUrl))) {
    const error = new Error("Фото источника запрещено, а пост с текстовой карточкой не публикуется");
    error.code = "NO_PHOTO"; error.permanent = true; // this post never gets a photo: free the slot for the next one
    throw error;
  }
  if (!out.generatedImageUrl) {
    if (!GENERATE_COVER_IF_MISSING) {
      if (MEDIA_REQUIRED) throw new Error("Медиа этого источника запрещено настройками, а генерация резервной обложки отключена");
      return out;
    }
    const generated = await renderCard({
      id: out.newsId || out.postId || out.id || newId("copyright"),
      title: out.title || currentWorkspace().name || "News Factory",
      text: out.text || "",
      topicId: out.topicId || currentWorkspace().channelId || "",
      cardNote: "Редакционная карточка"
    });
    out.generatedImageUrl = generated.url;
    out.generatedBy = generated.model;
  }
  out.mediaType = "generated";
  out.mediaStatus = out.mediaOrigin === "ai_generated" ? "generated" : "local_card";
  out.mediaOrigin = generatedIndependent && out.mediaOrigin === "ai_generated" ? "ai_generated" : "local_branded_card";
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
    // Only an approved post may absorb another source; a held / rejected one is about to be removed.
    if (!isApprovedQueueItem(item)) continue;
    if (storySourceSnapshot(item).length >= STORY_CLUSTER_MAX_SOURCES) continue;
    const age = Math.abs(now - (queueItemTimeMs(item) || now));
    if (age > STORY_CLUSTER_WINDOW_HOURS * 60 * 60 * 1000) continue;
    const score = storySimilarity(item, newItem);
    if (score > bestScore) { bestScore = score; best = item; }
  }
  return best && bestScore >= STORY_CLUSTER_MIN_SIMILARITY ? { item: best, similarity: bestScore } : null;
}


function sourceEditorialRole(sourceOrItem) {
  const item = sourceOrItem || {};
  const group = String(item.group || item.sourceGroup || "").toLowerCase();
  if (group === "story") return "multi_source";

  let resolved = item;
  if (!item.group && !item.sourceGroup && !item.sourceClass && !item.source_class) {
    const sourceId = String(item.sourceId || item.id || "");
    const sourceName = String(item.sourceName || item.name || "");
    const ws = currentWorkspace();
    const source = ws && ws.state && Array.isArray(ws.state.sources)
      ? ws.state.sources.find(function(x){
          return x && ((sourceId && String(x.id || "") === sourceId) || (sourceName && String(x.name || "") === sourceName));
        })
      : null;
    if (source) resolved = source;
  }

  const sourceClass = sourceClassFor(resolved);
  if (sourceClass === "OFFICIAL") return "official_primary";
  if (sourceClass === "CREATOR") return "author_opinion";
  if (sourceClass === "COMMUNITY") return "community_signal";
  if (sourceClass === "SOCIAL") return "social_signal";
  if (sourceClass === "MEDIA") return "media_context";
  return "context_source";
}

function sourceRoleLabel(role) {
  const map = {
    official_primary: "Официальный первичный источник",
    author_opinion: "Автор/создатель контента",
    community_signal: "Сообщество / пользовательская находка",
    social_signal: "Соцсеть / вирусный первичный сигнал",
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
  const formatKey = String((item.editorialV2 && item.editorialV2.format) || item.contentFormatLabel || item.contentFormat || "").trim().toLowerCase();
  const format = learning.byFormat && learning.byFormat[formatKey];
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
  return postRating(queueItemRatingInput(item, editorialChannelId())).total;
}
function channelRatingMinAuto() {
  const id = editorialChannelId();
  return id === "money" ? 70 : (id === "shopping" ? 55 : POST_RATING_MIN_AUTO);
}
function channelRatingDropBelow() {
  const id = editorialChannelId();
  return id === "money" ? 60 : (id === "shopping" ? 45 : POST_RATING_DROP_BELOW);
}

function moneyFactConfirmationOk(item) {
  if (editorialChannelId() !== "money") return true;
  const rubric = itemRubric(item);
  if (!["cards_banks","deposits","credits_mortgage","taxes","ruble_inflation_cb","income_benefits"].includes(rubric)) return true;
  const text = [item && item.title, item && item.text, item && item.sourceOriginalTitle, item && item.sourceOriginalText].filter(Boolean).join(" ");
  const critical = /ставк|курс|инфляц|налог|ндфл|вычет|пособ|пенси|выплат|мрот|ипотек|кредит|вклад|комисси|лимит|блокиров|нов.*правил|измен.*услов/iu.test(text);
  if (!critical) return true;
  const role = String(item && item.sourceRole || "");
  const count = Number((item && item.storySources && item.storySources.length) || (item && item.storyCluster && item.storyCluster.sourceCount) || 0);
  return role === "official_primary" || count > 1;
}

// Posts below the channel threshold are reserve candidates; money uses 70 normal / 60 reserve, shopping 55 / 45 (v0.53.4).
function ratingBelowAutoThreshold(item) {
  const min = channelRatingMinAuto();
  return min > 0 && queueItemRating(item) < min;
}

function autoQualityEligible(item) {
  const score = Number(item && item.qualityScore);
  return Number.isFinite(score) && score >= AUTO_QUALITY_MIN && item.qcStatus !== "hold" &&
    queueItemRating(item) >= channelRatingDropBelow() && moneyFactConfirmationOk(item);
}

// Why a queue item can never be published automatically (removed by autoResolveQueue).
function autoRejectReason(item) {
  if (!item || !item.newsId) return "";
  const rating = queueItemRating(item);
  const dropBelow = channelRatingDropBelow();
  if (dropBelow > 0 && rating < dropBelow) return "рейтинг " + rating + " из 100 ниже " + dropBelow;
  const verdict = item.editorialV2 && item.editorialV2.verdict;
  if (item.qcStatus === "hold" && verdict === "reject") return "проверка GPT/Claude нашла ошибки и отклонила пост";
  if (item.qcStatus === "hold" && verdict === "fix_exhausted") return "ошибки не исправлены за отведённые раунды";
  if (item.qcStatus === "hold" && verdict === "copyright_overlap") return "текст слишком близок к источнику";
  if (item.qcStatus === "hold" && item.editorialV2 && (item.editorialV2.status === "skip" || verdict === "skip")) return "редакция при повторной проверке решила пропустить новость";
  if (item.qcStatus === "hold" && verdict === "unavailable" && Number(item.editorialV2RetryCount || 0) >= 6) return "проверка нейросетью недоступна после 6 попыток";
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
  for (const r of removed) removeQueueIdFromSchedule(state, r.item.id);
  saveState();
  for (const r of removed) {
    console.log("QUEUE_AUTO_REJECTED " + JSON.stringify({ workspace: currentWorkspaceId(), newsId: r.item.newsId, title: String(r.item.title || "").slice(0, 80), reason: r.reason }));
    if (db && dbReady) {
      try {
        await db.query("UPDATE news_items SET status='auto_rejected', metadata=COALESCE(metadata,'{}'::jsonb) || $2::jsonb, updated_at=NOW() WHERE id=$1 AND workspace_id=$3",
          [r.item.newsId, pgJsonString({ autoRejectReason: r.reason, autoRejectedAt: new Date().toISOString() }), currentWorkspaceId()]);
      } catch (error) { console.warn("Auto reject status update failed:", error.message); }
    }
  }
  return { removed: removed.length };
}

function buildDecisionExplanation(item) {
  if (!item) return { summary: "Нет данных", factors: [] };
  const diversity = editorialDiversityPenalty(item);
  const learning = editorialLearningBonus(item);
  const strategy = channelStrategyScore(editorialChannelId(), item, recentHistoryItems(24), item);
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
  factors.push("Тип контента: " + strategy.bucket);
  factors.push("Источник: " + strategy.sourceClass);
  if (strategy.fit && strategy.fit.score != null) factors.push("Channel Score: " + strategy.fit.score + "/10");
  if (strategy.mix && strategy.mix.bonus) factors.push("Баланс контента: " + (strategy.mix.bonus > 0 ? "+" : "") + strategy.mix.bonus);
  if (strategy.sourceBonus) factors.push("Бонус класса источника: +" + strategy.sourceBonus);
  if (diversity.penalty) factors.push("Штраф за повторяемость: -" + diversity.penalty);
  if (item.qcIssues && item.qcIssues.length) factors.push("QC: " + item.qcIssues.slice(0, 2).join("; "));
  return {
    summary: item.decisionSummary || "Система учитывает силу новости, качество поста, разнообразие ленты, медиа и статистику аудитории.",
    factors: factors.slice(0, 10),
    diversityPenalty: diversity.penalty,
    learningBonus: learning.bonus,
    channelStrategy: strategy,
    autoQualityMin: AUTO_QUALITY_MIN,
    autoEligible: autoQualityEligible(item)
  };
}

function sourceStatKey(sourceOrItem) {
  if (!sourceOrItem) return "";
  if (sourceOrItem.sourceId) return String(sourceOrItem.sourceId);
  if (sourceOrItem.id && String(sourceOrItem.id).startsWith("cars-")) return String(sourceOrItem.id);
  // A source object keeps its own stats even when another source has the same name.
  if (sourceOrItem.id && sourceOrItem.url && (state.sources || []).some(function(src){ return src && src.id === sourceOrItem.id; })) return String(sourceOrItem.id);
  const name = String(sourceOrItem.sourceName || sourceOrItem.name || "").trim();
  const found = (state.sources || []).find(function(src){ return src && src.name === name; });
  return found ? String(found.id) : "";
}

// Keys that would reach Object.prototype when used as an object property name.
function isReservedKey(key) {
  const k = String(key);
  return k === "__proto__" || k === "constructor" || k === "prototype";
}

function ensureSourceStat(sourceOrItem) {
  state.sourceStats = state.sourceStats && typeof state.sourceStats === "object" ? state.sourceStats : {};
  const key = sourceStatKey(sourceOrItem);
  if (!key || isReservedKey(key)) return null;
  if (!Object.prototype.hasOwnProperty.call(state.sourceStats, key)) {
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
  else if (event === "junk") {
    // "needs a confirmation" is the editors' rule, not the source's fault: it does not count toward the junk streak
    if (isPolicySkipReason(extra && extra.reason)) { stat.policySkips = Number(stat.policySkips || 0) + 1; stat.policyStreak = Number(stat.policyStreak || 0) + 1; stat.lastPolicySkipAt = now; }
    else { recordOutcome(stat, "junk"); stat.lastJunkReason = String(extra && extra.reason || "").slice(0, 160); }
  }
  else if (event === "useful") { recordOutcome(stat, "ok"); }
  else if (event === "media_good") { stat.mediaGood = Number(stat.mediaGood || 0) + 1; stat.lastMediaScore = Number(extra && extra.score || 0); }
  else if (event === "media_bad") { stat.mediaBad = Number(stat.mediaBad || 0) + 1; stat.lastMediaScore = Number(extra && extra.score || 0); }
}

// v0.66.0: dead sources are removed (not just paused) and never come back: their keys go to state.sourceBlockedHosts.
const SOURCE_DEAD_SWEEP_ENABLED = process.env.SOURCE_DEAD_SWEEP !== "0";
// the start-up restore migrations (they re-enable sources paused by mistake) run in the first minutes: nothing is swept before they are done
const SOURCE_DEAD_SWEEP_WARMUP_S = Number.isFinite(Number(process.env.SOURCE_DEAD_SWEEP_WARMUP_S)) && process.env.SOURCE_DEAD_SWEEP_WARMUP_S !== "" ? Number(process.env.SOURCE_DEAD_SWEEP_WARMUP_S) : 900;
function removeSourcesFromState(removals, why) {
  if (!removals.length) return 0;
  const n = applySourceRemoval(state, removals, [sourceKey], new Date().toISOString(), why);
  for (const r of removals) if (state.sourceStats && r.id && !isReservedKey(r.id)) delete state.sourceStats[String(r.id)];
  return n;
}
// Pause sources that only bring junk or keep failing. Keeps at least a few
// sources enabled per group and never touches sources the editor turned on
// after an automatic pause (they are reset on toggle).
function autoPauseWeakSources() {
  if (!SOURCE_AUTO_PAUSE_ENABLED) return [];
  const paused = [];
  for (const source of (state.sources || [])) {
    if (!source || !source.enabled) continue;
    // A source explicitly re-enabled by the editor gets a 14-day clean evaluation window.
    // This guard must run before the generic junk/error auto-pause, not only in the themed-source pass below.
    if (source.editorEnabledAt && Date.now() - Date.parse(source.editorEnabledAt) < 14 * 86400000) continue;
    const group = source.group || "media";
    const enabledInGroup = (state.sources || []).filter(function(x){ return x && x.enabled && (x.group || "media") === group; }).length;
    const reason = autoPauseReason(source, ensureSourceStat(source), enabledInGroup);
    if (!reason) continue;
    // No quality rule (junk streak, junk share, trial, unconfirmable news) takes a rubric below its minimum number of
    // sources (v0.59.0). Only a source whose site does not open at all is paused regardless: it gives nothing anyway.
    if (!/^сайт не открывается/.test(reason)) {
      const minIds = rubricIds();
      if (minIds.size) {
        const own = (Array.isArray(source.rubrics) && source.rubrics.length ? source.rubrics : [source.rubric]).map(String).filter(function(id){ return minIds.has(id); });
        const have = rubricSourceCounts();
        if (own.some(function(id){ return Number(have[id] || 0) <= rubricMinFor(id); })) continue;
      }
    }
    // at most 3 trial pauses per run: replacements arrive gradually, the channel never loses half its sources at once
    if (/пробный срок/.test(reason) && paused.filter(function(x){ return /пробный срок/.test(x.reason); }).length >= 3) continue;
    source.enabled = false;
    source.autoPaused = { reason: reason, at: new Date().toISOString() };
    paused.push({ id: source.id, name: source.name, reason: reason });
    console.log("SOURCE_AUTO_PAUSED " + JSON.stringify({ workspace: currentWorkspaceId(), id: source.id, name: source.name, reason: reason }));
  }
  // Theme channels: a source that gives its theme less than one post a week after 7 days (or whose news are almost
  // all rejected) is replaced by the theme search — at most 2 per run.
  const ids = rubricIds();
  if (ids.size) {
    const labels = {};
    for (const r of channelRubrics()) labels[r.id] = r.label;
    let themePaused = 0;
    const counts = rubricSourceCounts();
    for (const source of (state.sources || [])) {
      if (themePaused >= 1) break; // one per run: the theme search replaces it before the next one goes
      if (!source || !source.enabled || source.autoPauseExempt || !ids.has(String(source.rubric || ""))) continue;
      // the editor switched it on by hand: never paused by this rule for 14 days
      if (source.editorEnabledAt && Date.now() - Date.parse(source.editorEnabledAt) < 14 * 86400000) continue;
      if (source.recoveredAt && Date.now() - Date.parse(source.recoveredAt) < 14 * 86400000) continue; // put back by a recovery migration
      if (source.probationUntil && Date.parse(source.probationUntil) > Date.now()) continue; // still on trial
      if (counts[source.rubric] <= rubricMinFor(source.rubric)) continue; // never below the theme's minimum (the editor's own limit counts)
      const card = sourceScorecard(source, ensureSourceStat(source) || {}, ids, labels);
      // weak = nothing published for two weeks in its theme, or almost everything rejected
      if (card.verdict !== "Слабый" || card.ageDays < 2 * SCORECARD_DAYS) continue;
      const reason = "слабый источник темы «" + (labels[source.rubric] || source.rubric) + "»: " + card.publishedWeek + " публикаций в неделю" + (card.passRate != null ? ", проходимость " + Math.round(card.passRate * 100) + "%" : "");
      source.enabled = false;
      source.autoPaused = { reason: reason, at: new Date().toISOString() };
      paused.push({ id: source.id, name: source.name, reason: reason });
      themePaused += 1;
      counts[source.rubric] -= 1;
      console.log("SOURCE_AUTO_PAUSED " + JSON.stringify({ workspace: currentWorkspaceId(), id: source.id, name: source.name, reason: reason, rubric: source.rubric }));
    }
  }
  // v0.66.0: a source the system paused and nobody switched back on within a day is dead: remove it and block its return
  if (SOURCE_DEAD_SWEEP_ENABLED && process.uptime() >= SOURCE_DEAD_SWEEP_WARMUP_S) {
    const dead = sweepCandidates(state.sources, Date.now(), DEAD_GRACE_MS);
    if (dead.length) {
      const n = removeSourcesFromState(dead, "авто-удаление мёртвого источника");
      console.log("SOURCE_DEAD_REMOVED " + JSON.stringify({ workspace: currentWorkspaceId(), removed: n, names: dead.slice(0, 10).map(function(x){ return x.name; }) }));
    }
  }
  return paused;
}

// Keep at least SOURCES_MIN_ACTIVE enabled sources per channel: replacements
// come from the reserve list, then from AI discovery (web search). Every
// candidate must open and show a list of article links before it is enabled.
async function validateSourceCandidate(url) {
  try {
    const html = await fetchText(url, 15000);
    if (/^https?:\/\/t\.me\/s\//i.test(url)) {
      // Telegram public preview: needs recent posts.
      const posts = extractTelegramSourcePosts(html, url);
      const fresh = posts.filter(function(x){ return !x.publishedAt || Date.now() - new Date(x.publishedAt).getTime() < 14 * 24 * 3600000; });
      if (posts.length < 3 || fresh.length < 1) return { ok: false, reason: "в канале нет свежих постов (" + posts.length + ")" };
      return { ok: true, links: posts.length };
    }
    const links = extractArticleLinks(html, url).filter(function(l){ return String(l.title || "").trim().length >= 25; });
    if (links.length < 6) return { ok: false, reason: "на странице мало новостей (" + links.length + ")" };
    return { ok: true, links: links.length, feedUrl: discoverFeedUrl(html, url) || "" };
  } catch (error) {
    // The page is blocked from our server, but its RSS feed may open: then the source is usable through the feed.
    if (!/^https?:\/\/t\.me\//i.test(url)) {
      const probe = { url: url };
      const feed = await sourceLinksFromFeed(probe).catch(function(){ return null; });
      const fresh = feed ? feed.links.filter(function(x){ return x.publishedAt && Date.now() - new Date(x.publishedAt).getTime() < 7 * 24 * 3600000; }) : [];
      if (feed && feed.links.length >= 6 && fresh.length >= 1) return { ok: true, links: feed.links.length, feedUrl: feed.feedUrl, viaFeed: true };
    }
    return { ok: false, reason: "не открывается: " + String(error.message || error).slice(0, 80) };
  }
}

async function discoverSourcesWithAI(count, discoverOpts) {
  if (!OPENAI_API_KEY) return [];
  const ws = currentWorkspace();
  const channelId = resolveChannelId(ws);
  const dopt = discoverOpts || {};
  const plan = channelSourcePlan();
  const prompt = buildDiscoveryPrompt({
    channelName: ws && ws.name || "",
    topic: channelTopic(channelId) || CHANNEL_TOPICS_RU[channelId] || "",
    hint: dopt.hint != null ? dopt.hint : (plan && plan.hint || ""),
    telegramOnly: Boolean(dopt.telegramOnly),
    count: count,
    // Telegram channels are named one by one (t.me/s/name), the bare host "t.me" would forbid all of them
    existingHosts: Array.from(new Set((state.sources || []).map(function(x){
      const url = String(x && x.url || "");
      return /^https?:\/\/t\.me\//i.test(url) ? sourceKey(url) : sourceHost(url);
    }).filter(function(h){ return h && h !== "t.me"; })))
  });
  const triedModes = [true, false];
  let retriedAfterLimit = false;
  while (triedModes.length) {
    const withSearch = triedModes.shift();
    try {
      const body = { model: OPENAI_MODEL, input: prompt, max_output_tokens: 8000 };
      if (withSearch) body.tools = [{ type: "web_search" }];
      const response = await llmResponsesFetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + OPENAI_API_KEY },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180000)
      });
      const data = await response.json().catch(function(){ return {}; });
      if (!response.ok) throw new Error(data && data.error && data.error.message || ("HTTP " + response.status));
      recordOpenAIResponseUsage(OPENAI_MODEL, "source_discovery", data, "responses", { web_search: withSearch });
      return parseDiscoveryResult(extractOpenAIText(data));
    } catch (error) {
      console.warn("SOURCE_DISCOVERY_ERROR " + JSON.stringify({ workspace: currentWorkspaceId(), webSearch: withSearch, error: error.message }));
      // TPM limit: 16 channels discover at the same moment. Wait what OpenAI asks (capped) and try this mode once more.
      const wait = rateLimitWaitMs(error.message);
      if (wait && !retriedAfterLimit) {
        retriedAfterLimit = true;
        await new Promise(function(resolve){ setTimeout(resolve, wait); });
        if (withSearch) { triedModes.unshift(true); }
      }
    }
  }
  return [];
}

// "Please try again in 1.372s" / "in 862ms" -> ms to wait (+jitter, 2..30 s), or 0 when not a rate limit.
function rateLimitWaitMs(message) {
  const text = String(message || "");
  if (!/rate limit/i.test(text)) return 0;
  const m = text.match(/try again in ([\d.]+)\s*(ms|s)\b/i);
  const base = m ? Number(m[1]) * (m[2].toLowerCase() === "ms" ? 1 : 1000) : 5000;
  return Math.min(30000, Math.max(2000, Math.round(base + 1000 + Math.random() * 4000)));
}

const replenishRunning = new Set(); // workspace ids with a top-up in flight (two at once added the same sources twice)
async function replenishSources(reason) {
  const wsKey = currentWorkspaceId();
  if (replenishRunning.has(wsKey)) return { added: [], need: 0, busy: true };
  replenishRunning.add(wsKey);
  try { return await replenishSourcesInner(reason); } finally { replenishRunning.delete(wsKey); }
}
// A discovery kind that found nothing usable 3 times in a row rests 24 h (each call is a paid web search).
function discoveryAllowed(kind) {
  const misses = state.sourceReplenish && state.sourceReplenish.misses && state.sourceReplenish.misses[kind];
  return !misses || !misses.until || Date.parse(misses.until) <= Date.now();
}
function noteDiscoveryResult(kind, addedCount) {
  state.sourceReplenish.misses = state.sourceReplenish.misses && typeof state.sourceReplenish.misses === "object" ? state.sourceReplenish.misses : {};
  const m = state.sourceReplenish.misses[kind] || { count: 0 };
  if (addedCount > 0) { delete state.sourceReplenish.misses[kind]; return; }
  m.count = Number(m.count || 0) + 1;
  if (m.count >= 3) { m.until = new Date(Date.now() + 24 * 3600000).toISOString(); m.count = 0; }
  state.sourceReplenish.misses[kind] = m;
}
async function replenishSourcesInner(reason) {
  const target = Number.isFinite(Number(state.sourceTarget)) && state.sourceTarget !== "" && state.sourceTarget != null ? Number(state.sourceTarget) : SOURCES_MIN_ACTIVE;
  let need = Math.min(SOURCES_ADDED_PER_RUN, sourcesNeeded(state.sources, target));
  // Editor asked for new sources for this channel (one-time boost, see applyChannelNotes).
  // the boost lives 72 h at most: candidates that never validate must not keep paid discovery running forever
  if (Number(state.sourceBoostRemaining || 0) > 0 && state.sourceBoostUntil && Date.parse(state.sourceBoostUntil) <= Date.now()) state.sourceBoostRemaining = 0;
  const boostLeft = Number(state.sourceBoostRemaining || 0);
  if (boostLeft > 0) {
    const activeNow = (state.sources || []).filter(function(x){ return x && x.enabled; }).length;
    need = Math.max(need, Math.min(SOURCES_ADDED_PER_RUN, boostLeft, Math.max(0, SOURCES_MAX_ACTIVE - activeNow)));
    if (need) reason = "editor_boost";
  }
  // Starving channel (no new news in recent preparations): add sources beyond the target, up to the ceiling.
  const starving = Number(state.sourceStarvingRuns || 0) >= SOURCE_STARVING_RUNS;
  if (starving) {
    const active = (state.sources || []).filter(function(x){ return x && x.enabled; }).length;
    need = Math.max(need, Math.min(SOURCES_ADDED_PER_RUN, Math.max(0, SOURCES_MAX_ACTIVE - active)));
    if (need) reason = "starving";
  }
  const plan = channelSourcePlan();
  const enabledTelegram = (state.sources || []).filter(function(x){ return x && x.enabled && /^https?:\/\/t\.me\/s\//i.test(String(x.url || "")); });
  const laneSources = (state.sources || []).filter(function(x){ return x && x.enabled && x.group === "blogger"; });
  const roomLeft = Math.max(0, SOURCES_MAX_ACTIVE - (state.sources || []).filter(function(x){ return x && x.enabled; }).length);
  const needTelegram = plan && plan.telegramMin && discoveryAllowed("telegram") ? Math.max(0, Math.min(SOURCES_ADDED_PER_RUN, roomLeft, plan.telegramMin - enabledTelegram.length)) : 0;
  const needLane = plan && plan.laneMin && discoveryAllowed("lane") ? Math.max(0, Math.min(SOURCES_ADDED_PER_RUN, roomLeft, plan.laneMin - laneSources.length)) : 0;
  // Theme channels: the theme with the fewest sources below its minimum gets its own search (one theme per run).
  const strategyNow = channelStrategy(resolveChannelId(currentWorkspace()));
  let rubricTarget = null;
  const themedChannelId = resolveChannelId(currentWorkspace());
  const themedMigrations = state.migrations || [];
  const themedReady =
    !(themedChannelId === "home" && !themedMigrations.includes("v0.51.3-home-rubrics")) &&
    !(themedChannelId === "shopping" && !themedMigrations.includes("v0.53.0-shopping-finds")) &&
    !(themedChannelId === "auto" && !themedMigrations.includes("v0.53.0-car-rubrics")) &&
    !(isRubricsV055Channel(themedChannelId) && themedChannelId !== "money" && themedChannelId !== "home" && !themedMigrations.includes(RUBRICS_V055_MIGRATION)); // sources must be tagged before themed discovery
  // one miss counter for all themes: 3 empty searches in a row -> the whole theme search rests 24 h (paid web search)
  if (themedReady && Array.isArray(strategyNow.rubrics) && strategyNow.rubrics.length && strategyNow.rubricMinSources > 0 && discoveryAllowed("rubric")) {
    const counts = rubricSourceCounts();
    // below the minimum first; a starving channel or a raised target grows its thinnest theme up to the maximum
    const wantsMore = need > 0 || starving;
    // the group furthest below its own minimum goes first; then the thinnest one growing toward its ceiling
    // groups take turns: the one searched longest ago goes first, so a group whose minimum cannot be filled
    // (candidates ran out) never starves the others; the deficit decides between equals
    const lastTried = (state.sourceReplenish && state.sourceReplenish.rubricLast) || {};
    const triedAt = function(id){ return Date.parse(lastTried[id] || "") || 0; };
    const short = strategyNow.rubrics
      .filter(function(r){ return counts[r.id] < rubricMinFor(r.id) || (wantsMore && counts[r.id] < rubricMaxFor(r.id)); })
      .sort(function(a, b){
        const belowA = counts[a.id] < rubricMinFor(a.id) ? 0 : 1, belowB = counts[b.id] < rubricMinFor(b.id) ? 0 : 1;
        return belowA - belowB || triedAt(a.id) - triedAt(b.id) || (counts[a.id] - rubricMinFor(a.id)) - (counts[b.id] - rubricMinFor(b.id)) || counts[a.id] - counts[b.id];
      })[0];
    if (short) {
      const ceiling = rubricMaxFor(short.id);
      rubricTarget = { rubric: short, need: Math.max(0, Math.min(SOURCES_ADDED_PER_RUN, roomLeft, ceiling - counts[short.id])) };
      if (!rubricTarget.need) rubricTarget = null;
    }
  }
  // Once a theme migration tagged the sources, grow theme by theme only. Before that, preserve
  // the legacy generic replenisher so startup/tests cannot strand an untagged workspace.
  if (themedReady && Array.isArray(strategyNow.rubrics) && strategyNow.rubrics.length) need = 0;
  if (!need && !needTelegram && !needLane && !rubricTarget) {
    // v0.65.1: say WHY nothing is searched (at most once per 6 h per channel), so a stalled theme can be diagnosed from the log
    try {
      const diag = state.sourceReplenish && typeof state.sourceReplenish === "object" ? state.sourceReplenish : (state.sourceReplenish = {});
      if (Date.now() - Date.parse(diag.idleLoggedAt || "") > 6 * 3600000 || !diag.idleLoggedAt) {
        diag.idleLoggedAt = new Date().toISOString();
        const countsNow = themedReady ? rubricSourceCounts() : {};
        const below = Object.keys(countsNow).filter(function(id){ return countsNow[id] < rubricMinFor(id); });
        const misses = diag.misses && diag.misses.rubric || null;
        console.log("SOURCE_REPLENISH_IDLE " + JSON.stringify({
          workspace: currentWorkspaceId(), themedReady: Boolean(themedReady), rubricSearchAllowed: discoveryAllowed("rubric"),
          restUntil: misses && misses.until || "", missCount: misses ? Number(misses.count || 0) : 0,
          roomLeft: roomLeft, belowMin: below, counts: countsNow, sourcesNeededLegacy: need
        }));
      }
    } catch (error) { /* diagnostics must never break replenish */ }
    return { added: [], need: 0 };
  }
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

  async function tryList(list, from, forceGroup) {
    for (const c of freshCandidates(list, state.sources, blocked)) {
      if (need <= 0) return;
      if (forceGroup && !/^https?:\/\/t\.me\/s\//i.test(c.url)) continue; // lane / Telegram lists take Telegram channels only
      const candKey = sourceKey(c.url);
      if ((state.sources || []).some(function(x){ return x && sourceKey(x.url) === candKey; })) continue; // added meanwhile
      const key = sourceKey(c.url);
      if (rejected[key]) continue;
      const check = await validateSourceCandidate(c.url);
      if (!check.ok) { rejected[key] = { at: new Date().toISOString(), reason: check.reason }; continue; }
      const source = {
        id: "auto-" + crypto.createHash("sha256").update(c.url).digest("hex").slice(0, 10),
        name: c.name, type: "web", group: forceGroup || (/^https?:\/\/t\.me\/s\//i.test(c.url) ? "creator" : (c.group === "official" ? "official" : "media")), sourceClass: sourceClassFor(c), priority: 2,
        url: c.url, enabled: true, mediaLicense: "unknown", copyrightMode: "facts_only",
        autoAdded: { at: new Date().toISOString(), from: from, why: c.why || "", reason: reason || "" },
        // On trial: kept only if its news pass the editors within SOURCE_PROBATION_HOURS (see autoPauseReason).
        probationUntil: new Date(Date.now() + SOURCE_PROBATION_HOURS * 3600000).toISOString()
      };
      if (check.feedUrl) source.feedUrl = check.feedUrl;
      state.sources.push(source);
      added.push({ name: source.name, url: source.url, from: from });
      need -= 1;
      console.log("SOURCE_AUTO_ADDED " + JSON.stringify({ workspace: currentWorkspaceId(), name: source.name, url: source.url, from: from, links: check.links }));
    }
  }

  const mainNeed = need;
  if (mainNeed > 0) {
    await tryList(RESERVE_SOURCES[channelId] || [], "reserve");
    // candidates are often rejected by validation (do not open, few news): ask for more than needed
    if (need > 0 && discoveryAllowed("main")) {
      const before = added.length;
      await tryList(await discoverSourcesWithAI(Math.min(30, need * 2 + 4)), "ai");
      noteDiscoveryResult("main", added.length - before);
    }
  }
  const addedMain = added.length;
  // Telegram channels the editor asked for (games) and the meme lane (kino).
  if (needTelegram > 0) {
    need = needTelegram;
    const before = added.length;
    await tryList(await discoverSourcesWithAI(Math.min(30, needTelegram * 2 + 4), { telegramOnly: true, hint: plan.hint }), "ai-telegram", "creator");
    noteDiscoveryResult("telegram", added.length - before);
  }
  if (needLane > 0) {
    need = needLane;
    const before = added.length;
    await tryList(await discoverSourcesWithAI(Math.min(30, needLane * 2 + 4), { telegramOnly: true, hint: plan.laneHint }), "ai-lane", "blogger");
    noteDiscoveryResult("lane", added.length - before);
  }
  if (rubricTarget) {
    state.sourceReplenish.rubricLast = state.sourceReplenish.rubricLast && typeof state.sourceReplenish.rubricLast === "object" ? state.sourceReplenish.rubricLast : {};
    state.sourceReplenish.rubricLast[rubricTarget.rubric.id] = new Date().toISOString();
    need = rubricTarget.need;
    const before = added.length;
    const theme = rubricTarget.rubric;
    await tryList(await discoverSourcesWithAI(Math.min(30, need * 2 + 4), { hint: "тема «" + theme.label + "»: " + theme.hint + ". Только про эту тему." }), "ai-rubric");
    // the new sources belong to the theme they were found for
    for (const a of added.slice(before)) {
      const src = (state.sources || []).find(function(x){ return x && x.url === a.url; });
      if (src) { src.rubric = theme.id; src.rubricAssignedAt = new Date().toISOString(); }
      a.rubric = theme.id;
    }
    noteDiscoveryResult("rubric", added.length - before);
    console.log("SOURCE_RUBRIC_REPLENISH " + JSON.stringify({ workspace: currentWorkspaceId(), rubric: theme.id, added: added.length - before, sources: rubricSourceCounts()[theme.id] }));
  }
  if (Number(state.sourceBoostRemaining || 0) > 0) state.sourceBoostRemaining = Math.max(0, Number(state.sourceBoostRemaining) - addedMain);
  if (added.length) console.log("SOURCE_REPLENISH " + JSON.stringify({ workspace: currentWorkspaceId(), reason: reason || "", added: added.length, stillNeeded: need }));
  saveState();
  return { added: added, need: need };
}

// One cheap call over all fresh headlines before media and editorial work:
// drops ads, listings, old press releases and off-topic links.
const CHANNEL_TOPICS_RU = { ai: "искусственный интеллект", auto: "автомобили, авторынок России и мира", money: "личные финансы в России: курс рубля, ставка ЦБ, вклады, кредиты и ипотека, налоги, цены и инфляция, пенсии", tech: "технологии и гаджеты", games: "игры", kino: "кино и сериалы", science: "наука", sport: "спорт", world: "необычные и удивительные мировые новости: рекорды, культура, курьёзы без жертв и политики", stars: "знаменитости", travel: "путешествия", shopping: "товарные находки Wildberries, Ozon, Яндекс Маркета, AliExpress и вирусные товары; рекламный исходный пост допустим как сырьё, если из него можно сделать самостоятельный пост о товаре", home: "дом и быт", food: "еда", business: "бизнес", crypto: "криптовалюты" };
async function prefilterCandidates(candidates, summary) {
  if (!candidates.length) return candidates;
  const now = new Date();
  const kept = [];
  const rejected = [];
  for (const candidate of candidates) {
    const title = candidate.link.title || "";
    // No hard drop by year in the title: web links carry no date here, and
    // "к 2025 году" / model years are normal in fresh news. Freshness is judged
    // by the pre-filter model and by the article date after the page is opened.
    void title;
    kept.push(candidate);
  }
  // Verdicts are cached per URL for a day: a kept link that waits for its turn
  // is not paid for again, and every run it waits raises its priority so no
  // source starves behind higher-scored links of other sources.
  state.prefilterCache = state.prefilterCache && typeof state.prefilterCache === "object" ? state.prefilterCache : {};
  const cache = state.prefilterCache;
  const dayAgo = Date.now() - 24 * 3600000;
  for (const key of Object.keys(cache)) if (new Date(cache[key].at || 0).getTime() < dayAgo) delete cache[key];
  const cachedRanked = [];
  const toJudge = [];
  for (const candidate of kept) {
    const hit = cache[candidate.link.url];
    if (hit) { hit.waited = Number(hit.waited || 0) + 1; cachedRanked.push({ candidate: candidate, score: Number(hit.score || 5) + hit.waited * 1.5 }); }
    else toJudge.push(candidate);
  }
  let ranked = toJudge.map(function(candidate){ return { candidate: candidate, score: 5 }; });
  const judged = toJudge;
  if (HEADLINE_PREFILTER_ENABLED && OPENAI_API_KEY && judged.length) {
    const ws = currentWorkspace();
    const channelId = resolveChannelId(ws);
    const prompt = buildPrefilterPrompt({
      channelName: ws && ws.name || "",
      topic: channelTopic(channelId) || CHANNEL_TOPICS_RU[channelId] || "",
      focus: channelFocus(channelId),
      today: new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" }).format(now),
      items: judged.map(function(candidate){ return { source: candidate.source.name, group: candidate.source.group, sourceClass: sourceClassFor(candidate.source), date: candidate.link.publishedAt || "", title: candidate.link.title || "", text: candidate.link.text || "" }; })
    });
    try {
      const response = await llmResponsesFetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + OPENAI_API_KEY },
        // 20-40 headlines with reasons need room; a cut answer made the pre-filter fail open.
        body: JSON.stringify({ model: OPENAI_MODEL, input: prompt, max_output_tokens: 8000, text: { format: { type: "json_object" } } }),
        signal: AbortSignal.timeout(60000)
      });
      const data = await response.json().catch(function(){ return {}; });
      if (!response.ok) throw new Error(data && data.error && data.error.message || ("HTTP " + response.status));
      recordOpenAIResponseUsage(OPENAI_MODEL, "headline_prefilter", data, "responses", { items: judged.length });
      const verdicts = parsePrefilterResult(extractOpenAIText(data), judged.length);
      if (!verdicts) throw new Error("не удалось разобрать ответ");
      ranked = [];
      judged.forEach(function(candidate, index) {
        const v = verdicts.get(index + 1);
        if (v.keep) { ranked.push({ candidate: candidate, score: v.score }); cache[candidate.link.url] = { score: v.score, waited: 0, at: new Date().toISOString() }; }
        else rejected.push({ candidate: candidate, reason: v.reason || "отсеяно по заголовку", score: v.score });
      });
    } catch (error) {
      // Fail open: without the pre-filter the old order is used, nothing is lost.
      console.warn("HEADLINE_PREFILTER_ERROR " + JSON.stringify({ workspace: currentWorkspaceId(), error: error.message }));
      maybeBillingAlert(error.message);
    }
  }
  for (const r of rejected) {
    const source = r.candidate.source;
    const link = r.candidate.link;
    noteSourceEvent(source, "junk", { reason: r.reason });
    try {
      await saveNewsItem({
        id: "news_" + crypto.createHash("sha256").update("prefilter\n" + currentWorkspaceId() + "\n" + link.url).digest("hex").slice(0, 20),
        sourceId: source.id, sourceName: source.name, sourceUrl: source.url,
        originalUrl: link.url, originalTitle: link.title || "", originalText: String(link.text || "").slice(0, 2000),
        contentHash: "", status: "prefilter_skip",
        metadata: { prefilterReason: r.reason, prefilterScore: r.score, articlePublishedAt: link.publishedAt || "" }
      });
    } catch (error) { console.warn("Prefilter save failed:", error.message); }
  }
  ranked = ranked.concat(cachedRanked);
  ranked.sort(function(a, b){ return b.score - a.score; });
  summary.prefilterRejected = rejected.length;
  if (rejected.length || ranked.length) {
    console.log("HEADLINE_PREFILTER " + JSON.stringify({ workspace: currentWorkspaceId(), total: candidates.length, kept: ranked.length, rejected: rejected.length, examples: rejected.slice(0, 5).map(function(r){ return (r.candidate.link.title || "").slice(0, 70) + " — " + r.reason; }) }));
  }
  return ranked.map(function(r){
    r.candidate.prefilterScore = Math.max(0, Math.min(10, Number(r.score || 0)));
    return r.candidate;
  });
}

// Source scorecard (v0.51.3): what the source really gives the channel over the last 7 days.
//   published/week, pass rate (useful vs junk), on-theme share, photo share, AI interest, real Telegram views.
const SCORECARD_DAYS = 7;
function sourceScorecard(source, stat, ids, rubricLabels) {
  const now = Date.now();
  const since = now - SCORECARD_DAYS * 86400000;
  // age in its theme: a source given a theme today starts from zero; unknown age = no verdict yet
  const since0 = Date.parse(source && source.rubricAssignedAt || "") || Date.parse(source && source.autoAdded && source.autoAdded.at || "") || NaN;
  const ageDays = Number.isFinite(since0) ? Math.max(0, (now - since0) / 86400000) : 0;
  const mine = (state.history || []).filter(function(h){
    if (!h || !h.publishedAt || Date.parse(h.publishedAt) < since) return false;
    return (h.sourceId && String(h.sourceId) === String(source.id)) || (!h.sourceId && h.sourceName && h.sourceName === source.name);
  });
  const useful = Number(stat.useful || 0), junk = Number(stat.junk || 0);
  const passRate = useful + junk ? useful / (useful + junk) : null;
  const rubric = ids.has(String(source.rubric || "")) ? String(source.rubric) : "";
  const themed = rubric ? mine.filter(function(h){ const t = String(h.contentBucket || ""); return ids.has(t); }) : [];
  const topicHit = themed.length ? themed.filter(function(h){ return String(h.contentBucket) === rubric; }).length / themed.length : null;
  const mediaGood = Number(stat.mediaGood || 0), mediaBad = Number(stat.mediaBad || 0);
  const photoRate = mediaGood + mediaBad ? mediaGood / (mediaGood + mediaBad) : null;
  const viewed = mine.filter(function(h){ return Number(h.views || 0) > 0; });
  const avgViews = viewed.length ? Math.round(viewed.reduce(function(a, h){ return a + Number(h.views || 0); }, 0) / viewed.length) : null;
  const weekFactor = SCORECARD_DAYS / Math.max(1, Math.min(SCORECARD_DAYS, ageDays));
  const publishedWeek = Math.round(mine.length * weekFactor * 10) / 10;
  let verdict = "Собираем данные";
  if (ageDays >= 2 || useful + junk >= 10) {
    // one post per theme a day shared by 4–6 sources: ~1–2 posts a week each is normal
    if (publishedWeek >= 1.5 && (passRate == null || passRate >= 0.3)) verdict = "Хороший";
    else if ((ageDays >= SCORECARD_DAYS && mine.length === 0) || (useful + junk >= 10 && passRate != null && passRate < 0.15)) verdict = "Слабый";
    else verdict = "Средний";
  }
  return { rubric: rubric, rubricLabel: rubric ? (rubricLabels[rubric] || rubric) : "", ageDays: Math.round(ageDays * 10) / 10,
    publishedWeek: publishedWeek, passRate: passRate, topicHit: topicHit, photoRate: photoRate, avgViews: avgViews, verdict: verdict };
}

function buildSourceRankings() {
  const ids = rubricIds();
  const rubricLabels = {};
  for (const r of channelRubrics()) rubricLabels[r.id] = r.label;
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
      const mediaGood = Number(stat.mediaGood || 0);
      const mediaBad = Number(stat.mediaBad || 0);
      const mediaSamples = mediaGood + mediaBad;
      if (mediaSamples >= 5) rating -= Math.min(10, Math.round((mediaBad / mediaSamples) * 12));
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
      sourceClass: source.sourceClass || sourceClassFor(source),
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
      mediaGood: Number(stat.mediaGood || 0),
      mediaBad: Number(stat.mediaBad || 0),
      mediaGoodRate: (Number(stat.mediaGood || 0) + Number(stat.mediaBad || 0)) ? Number(stat.mediaGood || 0) / (Number(stat.mediaGood || 0) + Number(stat.mediaBad || 0)) : null,
      lastJunkReason: stat.lastJunkReason || "",
      autoPaused: source.autoPaused || null,
      scorecard: sourceScorecard(source, stat, ids, rubricLabels)
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

const db = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL, max: Math.max(2, Math.min(30, Number(process.env.DB_POOL_MAX || 12) || 12)), idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000 }) : null;
if (db) {
  // Without an 'error' listener a dropped idle connection (DB restart, network blip) is an
  // unhandled 'error' event and kills the process. Only the message is logged (never the URL).
  db.on("error", function(error) {
    console.error("PostgreSQL pool error (idle client):", error && error.message || error);
  });
}
let dbReady = false;
// Collector lock is per workspace: one channel's slow collection must not block
// slot preparation of the other channels in the network.
const collectorRunningWorkspaces = new Set();
function isCollectorRunning(workspaceId) { return collectorRunningWorkspaces.has(workspaceId || currentWorkspaceId()); }
// Where each running collector is right now. A step that never settles (seen 2026-10-04: every channel's 07:45
// preparation hung and blocked all morning slots) is then visible in the log and released by the watchdog.
const collectorRuns = new Map(); // workspaceId -> { token, trigger, startedAt, step, stepAt }
const COLLECTOR_MAX_RUN_MS = envNumberEarly("COLLECTOR_MAX_RUN_MINUTES", 25, 1, 180) * 60000;
const COLLECTOR_STUCK_MS = envNumberEarly("COLLECTOR_STUCK_MINUTES", 40, 1, 360) * 60000;
const SCHEDULER_PREPARE_TIMEOUT_MS = envNumberEarly("SCHEDULER_PREPARE_TIMEOUT_MINUTES", 20, 0.02, 120) * 60000;
function envNumberEarly(name, fallback, min, max) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.max(min, Math.min(max, n)) : fallback;
}
function collectorRunInfo(workspaceId) {
  const run = collectorRuns.get(workspaceId);
  if (!run) return null;
  const now = Date.now();
  return { trigger: run.trigger, step: run.step, stepSec: Math.round((now - run.stepAt) / 1000), runMin: Math.round((now - run.startedAt) / 6000) / 10 };
}
// Rejects after ms; the original promise keeps running, but the caller (and its locks) are freed.
function withDeadline(promise, ms, label) {
  let timer;
  const deadline = new Promise(function(_, reject) {
    timer = setTimeout(function() {
      const error = new Error((label || "operation") + " exceeded " + Math.round(ms / 60000) + " min");
      error.code = "DEADLINE";
      reject(error);
    }, ms);
    if (timer && typeof timer.unref === "function") timer.unref();
  });
  return Promise.race([promise, deadline]).finally(function() { clearTimeout(timer); });
}
function releaseStuckCollectors(nowMs) {
  const now = Number(nowMs || Date.now());
  const released = [];
  // A run that still moves from step to step is slow, not stuck: it stops by itself at COLLECTOR_MAX_RUN_MS.
  const stuckMs = Math.max(COLLECTOR_STUCK_MS, COLLECTOR_MAX_RUN_MS + 10 * 60000);
  for (const [wsId, run] of collectorRuns) {
    if (now - run.startedAt < stuckMs) continue;
    if (now - Number(run.stepAt || run.startedAt) < stuckMs / 2) continue;
    // Never release a run that is sending a post right now: if it resumed later it could publish twice.
    if (/^publish/.test(String(run.step || ""))) {
      if (!run.stuckLogged) { run.stuckLogged = true; console.error("COLLECTOR_STUCK " + JSON.stringify(Object.assign({ workspace: wsId, released: false }, collectorRunInfo(wsId)))); }
      continue;
    }
    console.error("COLLECTOR_STUCK " + JSON.stringify(Object.assign({ workspace: wsId, released: true }, collectorRunInfo(wsId))));
    collectorRuns.delete(wsId);
    collectorRunningWorkspaces.delete(wsId);
    released.push(wsId);
  }
  return released;
}
const schedulerTickRunning = new Set();
let collectorTimer = null;
const lastCollectorRuns = new Map();
function saveState() {
  pruneQueueItems(state);
  state.updatedAt = new Date().toISOString();
  currentWorkspace().updatedAt = state.updatedAt;
  // The PostgreSQL snapshot is the independent copy: schedule it even when the disk write fails.
  try { persistWorkspaceStore(); } finally { scheduleStateSnapshot(); }
}

// news_items.vk_post_id / public_post_pages.vk_post_id are BIGINT. Postmypost posts carry ids like
// "pmp-32539480" (kept in metadata/state); only a plain numeric VK post id goes into the column.
function vkPostIdForDb(value) {
  const text = String(value == null ? "" : value).trim();
  return /^\d{1,18}$/.test(text) ? text : null;
}
// PostgreSQL json/jsonb rejects lone UTF-16 surrogates (a title or a key cut in the middle of an emoji) and \u0000,
// text columns reject \u0000. JSON.stringify keeps both, so every snapshot of such a workspace failed with
// "invalid input syntax for type json".
function pgSafeString(text) {
  let out = typeof text.toWellFormed === "function" ? text.toWellFormed() : text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
  if (out.indexOf("\u0000") !== -1) out = out.split("\u0000").join("");
  return out;
}
function pgText(value) { return typeof value === "string" ? pgSafeString(value) : value; }
// Well-formed JSON.stringify writes a LONE surrogate (in values AND keys) as an escape \udXXX and NUL as \u0000;
// paired surrogates stay raw characters. A genuine escape has an odd number of backslashes in front of "u".
function pgJsonString(value) {
  const json = JSON.stringify(value);
  if (json === undefined || json.indexOf("\\u") === -1) return json;
  return json.replace(/(?<!\\)((?:\\\\)*)\\u(d[89a-f][0-9a-f]{2}|0000)/gi, function(m, slashes, code) {
    return slashes + (code === "0000" ? "" : "\\ufffd");
  });
}

// Serialises schema bootstrap + migrations between concurrently starting instances
// (rolling deploys): the session-level advisory lock is held on a dedicated connection.
const DB_INIT_ADVISORY_LOCK_KEY = 7242001;
async function initDbAttempt() {
  await withAdvisoryLock(db, DB_INIT_ADVISORY_LOCK_KEY, async function() {
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
    await runMigrations(db);
  });
  {
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
  }
}

// Bounded retry with exponential backoff (DB_INIT_MAX_ATTEMPTS, DB_INIT_RETRY_BASE_MS). If every
// attempt fails the app keeps running without the DB, but a background retry round is scheduled
// every DB_INIT_RECOVERY_MS so dbReady does not stay false forever after one outage.
let dbInitRunning = false;
let dbInitRecoveryTimer = null;
async function initDb() {
  if (!db) return false;
  if (dbInitRunning) return dbReady;
  dbInitRunning = true;
  try {
    await retryWithBackoff(initDbAttempt, {
      attempts: Math.max(1, Math.min(10, Number(process.env.DB_INIT_MAX_ATTEMPTS || 5))),
      baseMs: Math.max(0, Number(process.env.DB_INIT_RETRY_BASE_MS || 1000)),
      maxMs: 15000,
      onRetry: function(error, attempt, delay) {
        dbReady = false;
        console.warn("PostgreSQL init attempt " + attempt + " failed: " + (error && error.message || error) + "; retrying in " + delay + " ms");
      }
    });
    return true;
  } catch (error) {
    dbReady = false;
    console.error("PostgreSQL init failed:", error && error.message || error);
    const recoveryMs = Math.max(1000, Number(process.env.DB_INIT_RECOVERY_MS || 30000));
    if (dbInitRecoveryTimer) clearTimeout(dbInitRecoveryTimer);
    dbInitRecoveryTimer = setTimeout(function() { dbInitRecoveryTimer = null; initDb().catch(function(){}); }, recoveryMs);
    if (dbInitRecoveryTimer.unref) dbInitRecoveryTimer.unref();
    return false;
  } finally {
    dbInitRunning = false;
  }
}

async function saveStateSnapshot() {
  if (!db || !dbReady) return;
  try {
    const workspaceId = currentWorkspaceId();
    await db.query("INSERT INTO app_snapshots(workspace_id,state) VALUES($1,$2::jsonb)", [workspaceId, pgJsonString(state)]);
    await db.query("DELETE FROM app_snapshots WHERE workspace_id=$1 AND id NOT IN (SELECT id FROM app_snapshots WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 200)", [workspaceId]);
  } catch (error) {
    console.error("State snapshot failed:", error.message);
  }
}

// One debounce timer per workspace: a single global timer made a save in workspace B
// cancel the pending snapshot of workspace A. The callback re-enters the workspace context.
const snapshotDebouncer = createKeyedDebouncer(1500, function(workspaceId) {
  if (!getWorkspaceById(workspaceId)) return;
  return workspaceContext.run({ workspaceId: workspaceId }, function(){ return saveStateSnapshot(); });
});
function scheduleStateSnapshot() {
  if (!db || !dbReady) return;
  snapshotDebouncer.schedule(currentWorkspaceId());
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
  const hidePublicSources = Boolean(post && post.hidePublicSources === true);
  const sourceName = hidePublicSources ? "" : String(primarySource.name || post && post.sourceName || "").trim();
  const sourceUrl = hidePublicSources ? "" : String(primarySource.url || post && post.sourceUrl || "").trim();
  const postId = String(post && (post.postId || post.id || post.newsId) || slug);
  const topicId = String(post && (post.topicId || post.topic_id) || "default");

  await db.query(
    `INSERT INTO public_post_pages
      (slug, workspace_id, post_id, topic_id, title, body_text, description, source_name, source_url, sources, image_filename, image_url, image_width, image_height, image_bytes)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15)`,
    [slug, currentWorkspaceId(), postId, topicId, title, bodyText, description, sourceName || null, sourceUrl || null, pgJsonString(sources), image.fileName, image.url, image.width, image.height, image.bytes]
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
  if (costEconomyMode() && !(payload && payload.forceAi)) return renderEconomyTextCard(payload);
  if (!OPENAI_API_KEY || !GENERATE_COVER_IF_MISSING) {
    throw new Error("Генерация обложек отключена");
  }

  const workspace = currentWorkspace();
  const channelName = String(workspace.name || "News Factory");
  const channelId = resolveChannelId(workspace);
  const channelEditorialFocus = channelFocus(channelId);
  const channelContentType = channelStrategy(channelId).type;
  const prompt = [
    "Create a premium editorial news image for the Telegram channel «" + channelName + "».",
    "Channel content type: " + String(channelContentType || "news") + ".",
    channelEditorialFocus ? ("Channel editorial focus: " + channelEditorialFocus) : "",
    "Topic: " + String(payload.title || "AI technology news"),
    "Context: " + String(payload.text || "").slice(0, 1800),
    payload.sourceName ? ("Source context label: " + String(payload.sourceName).slice(0, 180)) : "",
    "Visual recipe: " + visualRecipeFor(payload, payload.visualIndex || 0),
    "Make it look like a real photograph someone could plausibly capture, not a movie poster and not generic AI art.",
    "Use natural or practical lighting, realistic color balance, imperfect real-world textures, believable materials, subtle sensor/film texture where appropriate, and slightly imperfect asymmetry.",
    "Avoid plastic skin, over-smoothed surfaces, excessive teal-orange grading, neon glows, holograms, floating interface elements, dramatic lens flares, perfect symmetry, fake bokeh, glossy 3D-render aesthetics and impossible reflections.",
    "Create an independent original visual from the factual description only. Do not reproduce, trace, closely imitate, or restage any source photograph, video frame, artwork, poster, thumbnail, or distinctive composition.",
    "Do not imitate a living artist or a recognizable copyrighted visual style. Use generic documentary/editorial photography language.",
    "No text, no captions, no watermarks, no fake UI, no invented logos, no random letters.",
    "If a real company/product is mentioned, do not invent a different product design or fabricated branding.",
    "Landscape 3:2 composition suitable for Telegram and VK. Keep important faces/products inside a safe central area for mobile crops."
  ].filter(Boolean).join("\n");

  const candidates = [OPENAI_IMAGE_MODEL, "gpt-image-2"].filter(function(v, i, a){ return v && a.indexOf(v) === i; });
  let lastError = "";
  // OpenAI is out of money: a missing cover must not stop the post (MEDIA_REQUIRED), draw the local text card.
  const coverCardFallback = async function(reason) {
    if (!PROVIDER_FAILOVER_ENABLED || !PROVIDER_FAILOVER_COVER_CARD) return null;
    console.warn("COVER_FALLBACK_TEXT_CARD " + JSON.stringify({ workspace: currentWorkspaceId(), reason: String(reason || "").slice(0, 160) }));
    return renderEconomyTextCard(Object.assign({}, payload, { cardNote: "" })); // readers see the card: no internal notes
  };
  if (providerBreaker.isOpen("openai")) {
    const card = await coverCardFallback(providerBreaker.reason("openai"));
    if (card) return card;
  }

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
        const failureKind = classifyProviderFailure({ status: response.status, message: lastError });
        if (tripsBreaker(failureKind)) {
          providerBreaker.trip("openai", lastError, failureKind);
          const card = await coverCardFallback(lastError);
          if (card) return card;
          break;
        }
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
      const fileName = "cover_" + safeId + "_" + Date.now() + "_" + crypto.randomBytes(3).toString("hex") + ".png";
      const filePath = path.join(MEDIA_DIR, fileName);
      fs.writeFileSync(filePath, Buffer.from(b64, "base64"));
      return { url: mediaPublicUrl(fileName), model: model, fileName: fileName };
    } catch (error) {
      lastError = String(error && error.message || error);
    }
  }
  throw new Error(lastError || "Не удалось сгенерировать обложку");
}


async function loadReferenceImageForGeneration(imageUrl, id) {
  const sourceUrl = String(imageUrl || "").trim();
  if (!sourceUrl) throw new Error("У новости нет исходного фото для референса");

  const prepared = await prepareReusableSourceImage(sourceUrl, String(id || "reference") + "_ref");
  const usableUrl = String(prepared.imageUrl || "").trim();
  if (!usableUrl) throw new Error(prepared.cacheError || "Исходное фото для референса недоступно");

  let bytes = null;
  const localFile = localMediaPathFromUrl(usableUrl);
  if (localFile && fs.existsSync(localFile)) {
    bytes = fs.readFileSync(localFile);
  } else {
    const response = await safeFetch(usableUrl, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; NewsFactoryReference/1.0)" },
      timeoutMs: 30000,
      maxBytes: 20 * 1024 * 1024
    });
    if (!response.ok) throw new Error("Не удалось скачать фото-референс: HTTP " + response.status);
    bytes = response.body;
  }

  if (!bytes || !bytes.length) throw new Error("Фото-референс пустое");
  await assertSafeRaster(bytes);

  const normalized = await sharp(bytes, { failOn: "none", limitInputPixels: SAFE_INPUT_PIXELS })
    .rotate()
    .resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();

  return {
    bytes: normalized,
    originalImageUrl: prepared.originalImageUrl || sourceUrl,
    cachedImageUrl: usableUrl
  };
}

async function generateNewsCoverFromReference(payload, referenceUrl) {
  if (!OPENAI_API_KEY || !GENERATE_COVER_IF_MISSING) throw new Error("Генерация обложек отключена");
  if (providerBreaker.isOpen("openai")) throw new Error(providerBreaker.reason("openai") || "OpenAI временно недоступен");

  const reference = await loadReferenceImageForGeneration(referenceUrl, payload && (payload.newsId || payload.id));
  const workspace = currentWorkspace();
  const channelName = String(workspace.name || "News Factory");
  const channelId = resolveChannelId(workspace);
  const editorialFocus = channelFocus(channelId);
  const contentType = channelStrategy(channelId).type;

  const prompt = [
    "Create a NEW premium editorial news image for the Telegram channel «" + channelName + "» using the supplied image only as a visual reference.",
    "Channel content type: " + String(contentType || "news") + ".",
    editorialFocus ? ("Channel editorial focus: " + editorialFocus) : "",
    "Topic: " + String(payload.title || "News"),
    "Context: " + String(payload.text || "").slice(0, 1800),
    "Reference rule: preserve the main subject identity, important real objects, scene context and useful visual cues when relevant, but create a noticeably new composition rather than copying the source frame.",
    "Remove all source text, ratings, captions, watermarks, logos, UI, borders and thumbnail graphics unless a real-world product logo is factually necessary.",
    "Improve framing, lighting, detail and realism. Make it look like a clean high-end editorial photograph, not a screenshot, poster, thumbnail or AI collage.",
    "Do not invent events, people, products or factual details that are not supported by the news text or reference image.",
    "Do not imitate a living artist or a recognizable copyrighted visual style.",
    "No added text, captions, watermarks, fake UI or random letters.",
    "Landscape 3:2 composition suitable for Telegram and VK. Keep the main subject inside a safe central area for mobile crops."
  ].filter(Boolean).join("\n");

  const candidates = [OPENAI_IMAGE_MODEL, "gpt-image-2"].filter(function(v, i, a){ return v && a.indexOf(v) === i; });
  let lastError = "";

  for (const model of candidates) {
    try {
      const form = new FormData();
      form.append("model", model);
      form.append("image[]", new Blob([reference.bytes], { type: "image/png" }), "reference.png");
      form.append("prompt", prompt);
      form.append("size", "1536x1024");
      form.append("quality", OPENAI_IMAGE_QUALITY);
      form.append("input_fidelity", "high");
      form.append("output_format", "png");

      const response = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { authorization: "Bearer " + OPENAI_API_KEY },
        body: form,
        signal: AbortSignal.timeout(120000)
      });
      const data = await response.json().catch(function(){ return {}; });
      if (!response.ok) {
        lastError = (data && data.error && data.error.message) || ("OpenAI Image Edit HTTP " + response.status);
        const failureKind = classifyProviderFailure({ status: response.status, message: lastError });
        if (tripsBreaker(failureKind)) providerBreaker.trip("openai", lastError, failureKind);
        continue;
      }

      recordOpenAIResponseUsage(model, String(payload && payload.costPurpose || "image_generation"), data, "images.edits", {
        quality: OPENAI_IMAGE_QUALITY,
        size: "1536x1024",
        input_fidelity: "high",
        reference: true,
        news_id: payload && (payload.newsId || payload.id) || ""
      });

      const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
      if (!b64) {
        lastError = "OpenAI Image Edit не вернул изображение";
        continue;
      }

      ensureDataDir();
      const safeId = String(payload.id || crypto.randomBytes(8).toString("hex")).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 70);
      const fileName = "cover_ref_" + safeId + "_" + Date.now() + "_" + crypto.randomBytes(3).toString("hex") + ".png";
      fs.writeFileSync(path.join(MEDIA_DIR, fileName), Buffer.from(b64, "base64"));
      return {
        url: mediaPublicUrl(fileName),
        model: model,
        fileName: fileName,
        referenceOriginalUrl: reference.originalImageUrl,
        referenceCachedUrl: reference.cachedImageUrl
      };
    } catch (error) {
      lastError = String(error && error.message || error);
    }
  }

  throw new Error(lastError || "Не удалось создать обложку по фото");
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
        if (!prepared.imageUrl) throw new Error(prepared.cacheError || "фото источника недоступно");
        item.imageUrl = prepared.imageUrl;
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
                pgJsonString({
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

    // Never keep an expired/broken remote hotlink as publishable media.
    // If the source photo cannot be cached, switch to a fresh AI cover.
    if (!preparedImage.imageUrl) {
      if (GENERATE_COVER_IF_MISSING) {
        try {
          const generated = await generateNewsCover(payload);
          return {
            videoUrl: "",
            imageUrl: "",
            originalImageUrl: preparedImage.originalImageUrl || imageUrl,
            originalVideoUrl: "",
            generatedImageUrl: generated.url,
            mediaType: "generated",
            mediaStatus: "generated",
            mediaPriority: 3,
            canEnhance: false,
            mediaLicense: mediaLicense,
            mediaOrigin: "ai_generated",
            copyrightSafe: COPYRIGHT_SAFE_MODE,
            copyrightMediaMode: COPYRIGHT_MEDIA_MODE,
            copyrightMediaDecision: "source_image_unavailable_generated_cover",
            generatedBy: generated.model,
            mediaError: preparedImage.cacheError || ""
          };
        } catch (error) {
          console.warn("Source image unavailable and cover generation failed:", error.message);
          return {
            videoUrl: "",
            imageUrl: "",
            originalImageUrl: preparedImage.originalImageUrl || imageUrl,
            originalVideoUrl: "",
            generatedImageUrl: "",
            mediaType: "none",
            mediaStatus: "generation_error",
            mediaPriority: 99,
            canEnhance: false,
            mediaLicense: mediaLicense,
            mediaOrigin: "source_image_unavailable",
            copyrightSafe: COPYRIGHT_SAFE_MODE,
            copyrightMediaMode: COPYRIGHT_MEDIA_MODE,
            mediaError: String((preparedImage.cacheError || "") + "; " + error.message).slice(0, 600)
          };
        }
      }
      return {
        videoUrl: "",
        imageUrl: "",
        originalImageUrl: preparedImage.originalImageUrl || imageUrl,
        originalVideoUrl: "",
        generatedImageUrl: "",
        mediaType: "none",
        mediaStatus: "missing",
        mediaPriority: 99,
        canEnhance: false,
        mediaLicense: mediaLicense,
        mediaOrigin: "source_image_unavailable",
        copyrightSafe: COPYRIGHT_SAFE_MODE,
        copyrightMediaMode: COPYRIGHT_MEDIA_MODE,
        mediaError: preparedImage.cacheError || "Фото источника недоступно"
      };
    }

    const publishImageUrl = preparedImage.imageUrl;
    if (IMAGE_ENHANCEMENT_ENABLED && AUTO_ENHANCE_SOURCE_IMAGES && sourceReuseAllowed) {
      try {
        const enhanced = await enhanceNewsImage({
          id: payload.id || newId("enhance"),
          title: payload.title || "",
          text: payload.text || "",
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
          mediaOrigin: "quality_enhanced_source",
          copyrightSafe: COPYRIGHT_SAFE_MODE,
          copyrightMediaMode: COPYRIGHT_MEDIA_MODE,
          enhancedBy: enhanced.model,
          enhancedAt: new Date().toISOString()
        };
      } catch (error) {
        console.warn("Auto image enhancement failed, using cached source photo:", error.message);
      }
    }
    return {
      videoUrl: "",
      imageUrl: publishImageUrl,
      cachedSourceImageUrl: publishImageUrl,
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
    const hashRaw = await sharp(file).resize(16, 16, { fit: "fill" }).grayscale().raw().toBuffer();
    const probe = await sharp(file).resize(48, 48, { fit: "fill" }).grayscale().raw().toBuffer();
    const stats = await sharp(file).stats();
    let sum = 0;
    for (const val of hashRaw) sum += val;
    const avg = sum / hashRaw.length;
    const bits = Array.from(hashRaw, function(val){ return val >= avg ? 1 : 0; });
    let white = 0, dark = 0, edges = 0, edgeTotal = 0;
    const w = 48;
    for (let y = 0; y < 48; y += 1) {
      for (let x = 0; x < 48; x += 1) {
        const idx = y * w + x;
        const val = probe[idx];
        if (val >= 242) white += 1;
        if (val <= 22) dark += 1;
        if (x > 0) { edgeTotal += 1; if (Math.abs(val - probe[idx - 1]) >= 42) edges += 1; }
        if (y > 0) { edgeTotal += 1; if (Math.abs(val - probe[idx - w]) >= 42) edges += 1; }
      }
    }
    const pixels = probe.length || 1;
    return {
      width: Number(meta.width || 0), height: Number(meta.height || 0), bits: bits,
      entropy: Number(stats.entropy || 0), whiteRatio: white / pixels, darkRatio: dark / pixels,
      edgeDensity: edgeTotal ? edges / edgeTotal : 0
    };
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
  if (isReservedKey(key)) return false;
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
function looksLikeScreenshot(fp) {
  if (!fp) return false;
  return (fp.whiteRatio >= 0.42 && fp.edgeDensity >= 0.075) ||
    (fp.whiteRatio >= 0.56 && fp.entropy > 0 && fp.entropy < 6.4);
}
function assessMediaQuality(fp, candidate) {
  const c = candidate || {};
  const url = String(c.url || "").toLowerCase();
  const alt = String(c.alt || "").toLowerCase();
  let score = Math.max(0, Math.min(100, Number(c.score || 55)));
  const reasons = [];
  if (!fp) return { score: 0, pass: false, reasons: ["unreadable"] };
  if (fp.width >= 1400 && fp.height >= 800) score += 14;
  else if (fp.width >= 1000 && fp.height >= 600) score += 8;
  else if (fp.width < 700 || fp.height < 400) { score -= 28; reasons.push("small"); }
  if (looksLikeGraphic(fp)) { score -= 60; reasons.push("flat_graphic"); }
  if (looksLikeScreenshot(fp)) { score -= 60; reasons.push("screenshot_like"); }
  if (isLikelyThumbnailUrl(url)) { score -= 28; reasons.push("thumbnail"); }
  if (/(?:screenshot|screen-shot|screencap|twitter|x\.com|tweet|tgme|telegram|status\/|post\/)/i.test(url + " " + alt)) {
    score -= 22; reasons.push("social_screenshot");
  }
  const explicitLogoOrFlag = /(?:logo|emblem|coat.?of.?arms|flag|герб|флаг|логотип|icon|avatar)/i.test(url + " " + alt);
  if (explicitLogoOrFlag) {
    score -= 55; reasons.push("logo_or_flag");
  }
  const ratio = fp.height ? fp.width / fp.height : 0;
  if (ratio && (ratio < 0.58 || ratio > 2.25)) { score -= 12; reasons.push("awkward_ratio"); }
  if (fp.entropy >= 6.2 && fp.whiteRatio < 0.35) score += 6;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const hardReject = explicitLogoOrFlag || looksLikeScreenshot(fp);
  return { score: score, pass: !hardReject && score >= MEDIA_QUALITY_MIN_SCORE, reasons: reasons, hardReject: hardReject };
}

// Final clean-up of a post's photo set, used everywhere a pack is (re)built:
// keeps order, puts a real photo first if the main one is a logo/graphic, and keeps
// extras only if they are local, large, photo-like, not thumbnails and not a near
// duplicate of a photo already kept.
async function sanitizeMediaPack(urls, maxCount) {
  const limit = Math.max(1, Number(maxCount || MEDIA_DIRECTOR_MAX_IMAGES));
  const list = Array.from(new Set((Array.isArray(urls) ? urls : []).map(function(u){ return String(u || "").trim(); }).filter(Boolean)));
  if (!list.length) return [];
  const entries = [];
  for (const url of list) entries.push({ url: url, fp: await localImageFingerprint(url) });
  const kept = [];
  for (const e of entries) {
    if (kept.length >= limit) break;
    if (!e.fp || isLikelyThumbnailUrl(e.url)) continue;
    const quality = assessMediaQuality(e.fp, { url: e.url, score: kept.length ? 55 : 80, reason: "sanitizer" });
    if (!quality.pass) continue;
    if (kept.length > 0 && (e.fp.width < MEDIA_EXTRA_MIN_WIDTH || e.fp.height < MEDIA_EXTRA_MIN_HEIGHT)) continue;
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
  const deferExpensive = p.deferExpensive === true;
  const license = normalizeMediaLicense(p.mediaLicense || "unknown");
  const sourceAllowed = mediaLicenseAllowsReuse(license);
  const candidates = p.mediaCandidates && typeof p.mediaCandidates === "object" ? p.mediaCandidates : { images: [], videos: [] };
  const images = Array.isArray(candidates.images) ? candidates.images : [];
  const videos = Array.isArray(candidates.videos) ? candidates.videos : [];
  const fallbackImage = String(p.imageUrl || "").trim();
  const fallbackVideo = String(p.videoUrl || "").trim();
  const selectedVideo = String((videos[0] && videos[0].url) || fallbackVideo || "").trim();

  if (!sourceAllowed) {
    if (deferExpensive) {
      return {
        videoUrl: "", imageUrl: "", originalImageUrl: fallbackImage || (images[0] && images[0].url) || "",
        originalVideoUrl: selectedVideo, generatedImageUrl: "", mediaPackUrls: [], originalMediaUrls: [],
        mediaType: "pending", mediaStatus: "deferred_generation", mediaPriority: 90, mediaLicense: license,
        mediaOrigin: "deferred", copyrightSafe: COPYRIGHT_SAFE_MODE, copyrightMediaMode: COPYRIGHT_MEDIA_MODE,
        mediaDirector: { strategy: "blocked_source_deferred", sourceCandidateCount: images.length + videos.length, selectedCount: 0 }
      };
    }
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
  const qualityLog = [];
  const seen = new Set();
  const pool = images.map(function(x){ return x && typeof x === "object" ? x : { url: String(x || ""), score: 55, reason: "candidate" }; }).filter(function(x){ return x && x.url; });
  if (fallbackImage && !pool.some(function(x){ return x.url === fallbackImage; })) pool.unshift({ url: fallbackImage, score: 90, reason: "fallback_meta" });

  const fingerprints = [];
  let bestRejectedScore = 0;
  for (const sourceCandidate of pool) {
    if (imageUrls.length >= MEDIA_DIRECTOR_MAX_IMAGES) break;
    const key = String(sourceCandidate.url || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const isExtra = imageUrls.length > 0;
    if (isExtra && isLikelyThumbnailUrl(key)) continue;
    try {
      const prepared = await prepareReusableSourceImage(key, String(p.id || "media") + "_md" + imageUrls.length);
      const cached = String(prepared.imageUrl || "").trim();
      if (!cached) continue;
      const fp = await localImageFingerprint(cached);
      const placeholder = isSourcePlaceholderImage(p.sourceName, p.articleUrl || p.id, fp);
      const quality = assessMediaQuality(fp, sourceCandidate);
      if (placeholder) {
        quality.pass = false;
        quality.score = Math.max(0, quality.score - 50);
        quality.reasons = quality.reasons.concat(["source_placeholder"]);
      }
      bestRejectedScore = Math.max(bestRejectedScore, quality.score);
      qualityLog.push({ url: key.slice(0, 220), score: quality.score, pass: quality.pass, reasons: quality.reasons });
      if (!quality.pass) {
        console.log("MEDIA_QUALITY_REJECTED " + JSON.stringify({
          source: p.sourceName || "", news: p.id || "", score: quality.score,
          reasons: quality.reasons, width: fp && fp.width || 0, height: fp && fp.height || 0
        }));
        continue;
      }
      if (isExtra) {
        if (!fp || fp.width < MEDIA_EXTRA_MIN_WIDTH || fp.height < MEDIA_EXTRA_MIN_HEIGHT) continue;
        if (fingerprints.some(function(prev){ return imageFingerprintsSimilar(prev, fp); })) continue;
      }
      if (fp) fingerprints.push(fp);
      const enhanced = (isExtra || deferExpensive)
        ? { url: cached, enhanced: false, error: "" }
        : await enhanceSourceCandidate(cached, p, "md" + imageUrls.length);
      const chosen = String(enhanced.url || cached).trim();
      if (!chosen) continue;
      imageUrls.push(chosen);
      enhancedImageUrls.push(enhanced.enhanced ? chosen : "");
      originalImageUrls.push(String(prepared.originalImageUrl || key));
      enhancementLog.push({
        originalUrl: String(prepared.originalImageUrl || key), cachedUrl: cached,
        enhancedUrl: enhanced.enhanced ? chosen : "", enhanced: Boolean(enhanced.enhanced),
        model: enhanced.model || "", error: enhanced.error || ""
      });
    } catch (error) {
      console.warn("Media Director image skipped:", error.message);
    }
  }

  const mainQuality = qualityLog.find(function(x){ return x.pass; });
  if (selectedVideo) {
    const poster = imageUrls[0] || "";
    return {
      videoUrl: selectedVideo, imageUrl: poster, originalImageUrl: originalImageUrls[0] || fallbackImage || "",
      originalVideoUrl: selectedVideo, generatedImageUrl: "", enhancedImageUrl: enhancedImageUrls.find(Boolean) || "",
      mediaPackUrls: imageUrls.slice(0, MEDIA_DIRECTOR_MAX_IMAGES), originalMediaUrls: originalImageUrls.slice(0, MEDIA_DIRECTOR_MAX_IMAGES),
      mediaEnhancementLog: enhancementLog, mediaQualityLog: qualityLog, mediaQualityScore: mainQuality ? mainQuality.score : bestRejectedScore,
      mediaType: "video", mediaStatus: deferExpensive ? "video_approved_pending_enhancement" : (enhancedImageUrls.some(Boolean) ? "video_poster_enhanced" : "video_found"),
      mediaPriority: 1, mediaLicense: license, mediaOrigin: "source_media", copyrightSafe: COPYRIGHT_SAFE_MODE, copyrightMediaMode: COPYRIGHT_MEDIA_MODE,
      mediaDirector: { strategy: "video_first", sourceCandidateCount: images.length + videos.length, selectedCount: 1 + imageUrls.length, enhancedCount: enhancedImageUrls.filter(Boolean).length }
    };
  }

  if (imageUrls.length) {
    return {
      videoUrl: "", imageUrl: imageUrls[0], originalImageUrl: originalImageUrls[0] || fallbackImage || "",
      originalVideoUrl: "", generatedImageUrl: "", enhancedImageUrl: enhancedImageUrls.find(Boolean) || "",
      mediaPackUrls: imageUrls.slice(0, MEDIA_DIRECTOR_MAX_IMAGES), originalMediaUrls: originalImageUrls.slice(0, MEDIA_DIRECTOR_MAX_IMAGES),
      mediaEnhancementLog: enhancementLog, mediaQualityLog: qualityLog, mediaQualityScore: mainQuality ? mainQuality.score : bestRejectedScore,
      mediaType: imageUrls.length > 1 ? "album" : "photo",
      mediaStatus: deferExpensive ? "photo_approved_pending_enhancement" : (enhancedImageUrls.some(Boolean) ? "enhanced" : "photo_found"),
      mediaPriority: 2, mediaLicense: license, mediaOrigin: "source_media", copyrightSafe: COPYRIGHT_SAFE_MODE, copyrightMediaMode: COPYRIGHT_MEDIA_MODE,
      mediaDirector: { strategy: deferExpensive ? "quality_source_deferred" : (imageUrls.length > 1 ? "enhanced_source_album" : "enhanced_source_photo"), sourceCandidateCount: images.length + videos.length, selectedCount: imageUrls.length, enhancedCount: enhancedImageUrls.filter(Boolean).length }
    };
  }

  if (deferExpensive) {
    return {
      videoUrl: "", imageUrl: "", originalImageUrl: fallbackImage || "", originalVideoUrl: fallbackVideo || "",
      generatedImageUrl: "", enhancedImageUrl: "", mediaPackUrls: [], originalMediaUrls: [],
      mediaEnhancementLog: [], mediaQualityLog: qualityLog, mediaQualityScore: bestRejectedScore,
      mediaType: "pending", mediaStatus: "deferred_missing", mediaPriority: 90, mediaLicense: license,
      mediaOrigin: "deferred", copyrightSafe: COPYRIGHT_SAFE_MODE, copyrightMediaMode: COPYRIGHT_MEDIA_MODE,
      mediaDirector: { strategy: "bad_or_missing_media_deferred", sourceCandidateCount: images.length + videos.length, selectedCount: 0, rejectedBestScore: bestRejectedScore }
    };
  }

  const fallback = await ensureMediaForNews(Object.assign({}, p, { imageUrl: "", videoUrl: "" }));
  fallback.mediaDirector = {
    strategy: "ai_fallback", sourceCandidateCount: images.length + videos.length,
    selectedCount: fallback.generatedImageUrl ? 1 : 0, rejectedBestScore: bestRejectedScore
  };
  return fallback;
}

function editorialCostTier(rewrite, editorialMeta, media) {
  const importance = Number(editorialMeta && editorialMeta.importance || 0);
  const score = Number(rewrite && rewrite.editorialScore || 0);
  if ((media && media.videoUrl) || importance >= MEDIA_AI_COVER_MIN_IMPORTANCE || score >= 85) return 1;
  if (importance >= 6 || score >= 65) return 2;
  return 3;
}

async function finalizeApprovedMedia(media, payload, tier) {
  const current = Object.assign({}, media || {});
  const p = payload || {};
  current.costTier = tier;

  if (current.videoUrl) {
    if (current.imageUrl && IMAGE_ENHANCEMENT_ENABLED && AUTO_ENHANCE_SOURCE_IMAGES) {
      const enhanced = await enhanceSourceCandidate(current.imageUrl, p, "final_video_poster");
      if (enhanced.url) {
        current.imageUrl = enhanced.url;
        current.enhancedImageUrl = enhanced.enhanced ? enhanced.url : current.enhancedImageUrl || "";
        current.mediaStatus = enhanced.enhanced ? "video_poster_enhanced" : "video_found";
      }
    }
    return current;
  }

  if (current.imageUrl) {
    if (IMAGE_ENHANCEMENT_ENABLED && AUTO_ENHANCE_SOURCE_IMAGES) {
      const enhanced = await enhanceSourceCandidate(current.imageUrl, p, "final_main");
      if (enhanced.url) {
        current.imageUrl = enhanced.url;
        current.enhancedImageUrl = enhanced.enhanced ? enhanced.url : current.enhancedImageUrl || "";
        current.mediaPackUrls = [current.imageUrl].concat((current.mediaPackUrls || []).slice(1)).slice(0, MEDIA_DIRECTOR_MAX_IMAGES);
        current.mediaStatus = enhanced.enhanced ? "enhanced" : "photo_found";
      }
    }
    return current;
  }

  if (tier === 1 && GENERATE_COVER_IF_MISSING) {
    try {
      const generated = await generateNewsCover(Object.assign({}, p, { costPurpose: "image_generation_final" }));
      current.generatedImageUrl = generated.url;
      current.mediaType = "generated";
      current.mediaStatus = generated.economy ? "local_card" : "generated";
      current.mediaOrigin = generated.economy ? "local_branded_card" : "ai_generated";
      current.generatedBy = generated.model;
      return current;
    } catch (error) {
      console.warn("Final AI cover failed, using local branded card:", error.message);
    }
  }

  const local = await renderEconomyTextCard(Object.assign({}, p, { cardNote: tier === 1 ? "Резервная редакционная карточка" : "Редакционная карточка" }));
  current.generatedImageUrl = local.url;
  current.mediaType = "generated";
  current.mediaStatus = "local_card";
  current.mediaOrigin = "local_branded_card";
  current.generatedBy = local.model;
  return current;
}


// Source pages: browser-like headers, IPv4 retry after a dropped connection, and the Russian proxy
// (SOURCE_PROXY_URL) for sites that block or time out from abroad. See lib/source-fetch.js.
let sourceProxy = null;
try { sourceProxy = parseProxyUrl(process.env.SOURCE_PROXY_URL || ""); }
catch (error) { console.error("SOURCE_PROXY_INVALID " + JSON.stringify({ error: error.message })); }
const SOURCE_PROXY_DOMAINS = String(process.env.SOURCE_PROXY_DOMAINS || ".ru,.su,.xn--p1ai,vk.com,t.me");
const sourceFetcher = createSourceFetcher({
  fetch: function(url, init) { return safeFetch(url, init); },
  proxy: sourceProxy,
  proxyFirstDomains: SOURCE_PROXY_DOMAINS,
  maxConcurrent: envNumber("SOURCE_FETCH_CONCURRENCY", 48, 1, 200)
});
if (sourceProxy) console.log("SOURCE_PROXY_ENABLED " + JSON.stringify({ proxy: sourceProxy.label, proxyFirstDomains: SOURCE_PROXY_DOMAINS.split(",").map(function(x){ return x.trim(); }).filter(Boolean).length }));

async function fetchText(url, timeoutMs) {
  // Source pages are third-party: SSRF-safe client (public IPs only, re-validated redirects, size cap).
  const response = await sourceFetcher.fetch(url, {
    timeoutMs: timeoutMs || 15000,
    maxBytes: 5 * 1024 * 1024
  });
  if (!response.ok) throw new Error("HTTP " + response.status + " " + url);
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html") && !type.includes("application/xhtml")) throw new Error("Unsupported content type: " + type);
  return decodeHtmlBody(await response.arrayBuffer(), type);
}

// RSS/Atom items of a feed -> [{url,title,text,publishedAt,imageUrl}]. Throws when the URL is not a feed.
async function fetchFeedItems(url, timeoutMs) {
  const response = await sourceFetcher.fetch(url, {
    headers: { accept: "application/rss+xml,application/atom+xml,application/xml;q=0.9,text/xml;q=0.8,*/*;q=0.5" },
    timeoutMs: timeoutMs || 15000,
    maxBytes: 5 * 1024 * 1024
  });
  if (!response.ok) throw new Error("HTTP " + response.status + " " + url);
  const type = response.headers.get("content-type") || "";
  const text = decodeHtmlBody(await response.arrayBuffer(), type);
  if (!looksLikeFeed(text)) throw new Error("not a feed: " + url);
  return parseFeed(text, url);
}

// A blocked source page is read from its RSS feed instead: the known feed first, then (once a day) the usual
// feed locations. Returns {links, feedUrl} or null.
async function sourceLinksFromFeed(source) {
  const known = String(source.feedUrl || "");
  const probeAllowed = !source.feedProbeAt || Date.now() - new Date(source.feedProbeAt).getTime() > 24 * 3600000;
  const candidates = known ? [known] : (probeAllowed ? guessFeedUrls(source.url) : []);
  if (!known && probeAllowed) source.feedProbeAt = new Date().toISOString();
  for (const feedUrl of candidates) {
    try {
      const items = await fetchFeedItems(feedUrl, 12000);
      if (!items.length) continue;
      return { feedUrl: feedUrl, links: items.slice(0, 12).map(function(x) {
        return { url: canonicalizeUrl(x.url, feedUrl) || x.url, title: x.title, text: x.text, publishedAt: x.publishedAt, imageUrl: x.imageUrl, fromFeed: true, score: 10 };
      }) };
    } catch {}
  }
  return null;
}

// Article page that could not be opened, rebuilt from what the Telegram post / RSS item already carries.
function articleHtmlFromLink(link) {
  const text = String(link && link.text || "").trim();
  if (!text) return "";
  const image = link.imageUrl ? '<meta property="og:image" content="' + escapeHtml(link.imageUrl) + '">' : "";
  const date = link.publishedAt ? '<meta property="article:published_time" content="' + escapeHtml(link.publishedAt) + '">' : "";
  return "<html><head><title>" + escapeHtml(link.title || "") + "</title>" + image + date + "</head><body><article>" +
    text.split(/\n+/).map(function(p) { return "<p>" + escapeHtml(p) + "</p>"; }).join("") + "</article></body></html>";
}

// Pages in windows-1251 / koi8-r (Пикабу, some Russian media) came out as
// «����» because response.text() always decodes UTF-8. Charset is taken from
// the Content-Type header, then from <meta charset> in the first bytes.
function decodeHtmlBody(buffer, contentType) {
  const bytes = new Uint8Array(buffer);
  let charset = (String(contentType || "").match(/charset=["']?([\w-]+)/i) || [])[1] || "";
  if (!charset) {
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
    charset = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1] || "";
  }
  charset = charset.toLowerCase();
  if (!charset || charset === "utf-8" || charset === "utf8") return new TextDecoder("utf-8").decode(bytes);
  try { return new TextDecoder(charset).decode(bytes); }
  catch { return new TextDecoder("utf-8").decode(bytes); }
}

// Per-URL counter of transient failures (download, writer outage, DB write). Kept in the workspace
// state so it survives restarts; after SKIP_RETRY_MAX attempts the link counts as seen.
function bumpSkipAttempt(url, kind) {
  state.skipAttempts = state.skipAttempts && typeof state.skipAttempts === "object" ? state.skipAttempts : {};
  const entry = state.skipAttempts[url] || { n: 0 };
  entry.n = Number(entry.n || 0) + 1;
  entry.kind = String(kind || "");
  entry.at = new Date().toISOString();
  state.skipAttempts[url] = entry;
  const keys = Object.keys(state.skipAttempts);
  if (keys.length > 300) {
    keys.sort(function(a, b){ return String(state.skipAttempts[a].at || "").localeCompare(String(state.skipAttempts[b].at || "")); })
      .slice(0, keys.length - 300).forEach(function(k){ delete state.skipAttempts[k]; });
  }
  return entry.n;
}

// Records a link that will never be worth opening again (stale, too short, unreachable, published by another
// channel) so it stops being "the first unseen link" of its source. Shown nowhere in the feed (prefilter_skip) unless a status is given.
async function recordSeenSkip(source, link, reason, text, extra) {
  const url = String(link && link.url || "");
  try {
    await saveNewsItem({
      id: "news_" + crypto.createHash("sha256").update("prefilter\n" + currentWorkspaceId() + "\n" + url).digest("hex").slice(0, 20),
      sourceId: source && source.id, sourceName: source && source.name, sourceUrl: source && source.url,
      originalUrl: url, originalTitle: String(link && link.title || ""), originalText: "",
      contentHash: "", status: extra && extra.status || "prefilter_skip",
      metadata: Object.assign({ skipReason: reason, prefilterReason: text || reason, articlePublishedAt: link && link.publishedAt || "" }, extra && extra.metadata || {})
    });
  } catch (error) {
    console.warn("SEEN_SKIP_SAVE_FAILED " + JSON.stringify({ workspace: currentWorkspaceId(), url: url, error: error.message }));
    // Keep the in-memory guard so a failing DB cannot make the same link loop.
    state.skipAttempts = state.skipAttempts && typeof state.skipAttempts === "object" ? state.skipAttempts : {};
    state.skipAttempts[url] = { n: SKIP_RETRY_MAX, kind: reason, at: new Date().toISOString() };
  }
}

async function seenOriginalUrl(url) {
  if (state.skipAttempts && state.skipAttempts[url] && Number(state.skipAttempts[url].n) >= SKIP_RETRY_MAX) return true;
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
        item.id, currentWorkspaceId(), item.sourceId, pgText(item.sourceName), item.sourceUrl, item.originalUrl, pgText(item.originalTitle),
        pgText(item.originalText), item.contentHash, pgText(item.rewrittenTitle) || null, pgText(item.rewrittenText) || null,
        item.confidence || null, item.status, item.telegramMessageId || null, item.publishedAt || null,
        pgJsonString(item.metadata || {}),
        item.topicId || "default",
        vkPostIdForDb(item.vkPostId),
        item.vkStatus || null,
        item.vkErrorCode == null ? null : String(item.vkErrorCode),
        pgText(item.vkError || item.vkErrorMsg) || null,
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

function editorialQueueReadyDepth() {
  const now = Date.now();
  return (state.queue || []).filter(function(item) {
    if (!item || item.telegramPublished || item.status === "publish_failed" || item.status === "media_failed") return false;
    if (item.qcStatus === "hold") return false;
    if (item.editorialV2 && !["approved","pass"].includes(String(item.editorialV2.status || item.editorialV2.verdict || "").toLowerCase())) return false;
    const stamp = new Date(item.articlePublishedAt || item.createdAt || item.queuedAt || 0).getTime();
    if (Number.isFinite(stamp) && stamp > 0 && now - stamp > queueMaxAgeHoursFor(currentWorkspace()) * 3600000) return false;
    return true;
  }).length;
}

function capacityGateDecision(candidate, trigger) {
  const triggerName = String(trigger || "");
  if (triggerName === "manual" || triggerName.includes("last-chance")) return { allow: true, reason: "urgent_trigger", depth: editorialQueueReadyDepth() };
  const depth = editorialQueueReadyDepth();
  const score = Number(candidate && candidate.prefilterScore || 0);
  const hasVideo = Boolean(candidate && candidate.link && candidate.link.hasVideo);
  if (depth < EDITORIAL_QUEUE_TARGET) return { allow: true, reason: "queue_needs_posts", depth: depth, score: score };
  if (score >= EDITORIAL_CAPACITY_BYPASS_SCORE || hasVideo) return { allow: true, reason: hasVideo ? "video_bypass" : "top_story_bypass", depth: depth, score: score };
  return { allow: false, reason: "queue_full", depth: depth, score: score };
}

async function collectOnce(trigger) {
  if (!COLLECTOR_ENABLED) return { ok: false, error: "Collector disabled" };
  const collectorWorkspaceId = currentWorkspaceId();
  if (collectorRunningWorkspaces.has(collectorWorkspaceId)) return { ok: false, error: "Collector already running" };
  collectorRunningWorkspaces.add(collectorWorkspaceId);
  const collectorToken = Symbol("collector");
  const collectorStartedMs = Date.now();
  collectorRuns.set(collectorWorkspaceId, { token: collectorToken, trigger: String(trigger || "scheduler"), startedAt: collectorStartedMs, step: "start", stepAt: collectorStartedMs });
  // Released by the watchdog -> this run is a zombie: it must stop at its next step instead of running next to the
  // new run (two runs in one workspace queued the same article twice).
  const ownsRun = function() { const run = collectorRuns.get(collectorWorkspaceId); return Boolean(run && run.token === collectorToken); };
  const releasedError = function() { const e = new Error("collector run released by the watchdog"); e.code = "COLLECTOR_RELEASED"; return e; };
  const markStep = function(step) {
    if (!ownsRun()) throw releasedError();
    const run = collectorRuns.get(collectorWorkspaceId);
    run.step = String(step || ""); run.stepAt = Date.now();
  };
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
      if (bloggerRun) {
        const lane = channelExtraLane();
        return src.group === "blogger" || Boolean(lane && lane.anySource && !isRussianAISource(src));
      }
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

    markStep("sources:" + rotatedSources.length);
    const sourceResults = await Promise.all(rotatedSources.map(async function(source) {
      noteSourceEvent(source, "check");
      try {
        const isTelegramCreator = source.group === "blogger" || source.group === "creator" || /^https?:\/\/t\.me\/s\//i.test(String(source.url || ""));
        let html = "";
        let links;
        try {
          html = await fetchText(source.url, 15000);
        } catch (pageError) {
          // Page blocked / timed out: its RSS feed often still opens (and carries dates).
          const feed = isTelegramCreator || /^https?:\/\/t\.me\//i.test(String(source.url || "")) ? null : await sourceLinksFromFeed(source);
          if (!feed) throw pageError;
          if (source.feedUrl !== feed.feedUrl) {
            source.feedUrl = feed.feedUrl;
            console.log("SOURCE_FEED_FALLBACK " + JSON.stringify({ workspace: currentWorkspaceId(), source: source.name, feed: feed.feedUrl, pageError: String(pageError.message || pageError).slice(0, 120) }));
          }
          summary.viaFeed = Number(summary.viaFeed || 0) + 1;
          links = feed.links;
        }
        noteSourceEvent(source, "fetch_ok");
        if (!links) {
          // Refresh the site preview once a week (cheap: the page is already loaded).
          if (!source.preview || Date.now() - new Date(source.preview.at || 0).getTime() > 7 * 24 * 3600000) {
            try { source.preview = extractSitePreview(html, source.url); } catch {}
          }
          // Remember the page's own feed for the day the page gets blocked.
          if (!source.feedUrl && !isTelegramCreator) {
            const feedUrl = discoverFeedUrl(html, source.url);
            if (feedUrl) source.feedUrl = feedUrl;
          }
          links = (isTelegramCreator
            ? extractTelegramSourcePosts(html, source.url)
            : extractArticleLinks(html, source.url)
          ).slice(0, isTelegramCreator ? 18 : 12);
        }
        const crossIndex = CROSS_CHANNEL_DEDUPE_ENABLED ? crossChannelIndex() : null;
        for (const link of links) {
          // Claimed synchronously (before any await) and by the normalised URL: all sources run in parallel, and two
          // feeds carrying the same article (or the same link with ?utm) used to both pass the check -> queued twice.
          const linkKey = normalizeArticleUrl(link.url) || link.url;
          if (selectedUrls.has(linkKey)) continue;
          selectedUrls.add(linkKey);
          // Same article already queued / published by another channel: leave it, look at the next link.
          // Not recorded as seen, so the link is free again when the other channel's post is dropped.
          const linkConflict = crossIndex && crossChannelConflict({ urls: new Set([normalizeArticleUrl(link.url)].filter(Boolean)), hashes: new Set() }, { index: crossIndex });
          if (linkConflict) {
            summary.skipped += 1;
            if (linkConflict.where === "published" && !(await seenOriginalUrl(link.url))) {
              await recordSeenSkip(source, link, "cross_channel_duplicate", "Уже опубликовано в канале " + linkConflict.channel, { status: "duplicate_story", metadata: { autoPublishBlocked: "cross_channel_duplicate", crossChannel: { workspace: linkConflict.workspace, channel: linkConflict.channel, by: linkConflict.by, where: linkConflict.where } } });
            }
            continue;
          }
          if (await seenOriginalUrl(link.url)) {
            summary.skipped += 1;
            continue;
          }
          noteSourceEvent(source, "candidate");
          return { source: source, link: link, rest: links.slice(links.indexOf(link) + 1), extra: 0 };
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
    markStep("prefilter:" + ordered.length);
    const prefiltered = await prefilterCandidates(ordered, summary);
    ordered.length = 0;
    prefiltered.forEach(function(candidate){ ordered.push(candidate); });

    if (enabledSources.length) {
      state.sourceCursor = (cursor + Math.max(1, MAX_ITEMS_PER_RUN)) % enabledSources.length;
      saveState();
    }

    // When a link turns out to be unusable (stale, too short, unreachable, taken by another channel) the next
    // unseen link of the same source is opened in the same run, so one bad link cannot shadow the fresh ones
    // behind it. Bounded by EXTRA_LINKS_PER_SOURCE.
    const advanceSource = async function(from) {
      let current = from;
      while (current && Array.isArray(current.rest) && current.rest.length && Number(current.extra || 0) < EXTRA_LINKS_PER_SOURCE) {
        const link = current.rest.shift();
        const linkKey = normalizeArticleUrl(link.url) || link.url;
        if (selectedUrls.has(linkKey)) continue;
        selectedUrls.add(linkKey);
        if (CROSS_CHANNEL_DEDUPE_ENABLED && crossChannelConflict({ urls: new Set([normalizeArticleUrl(link.url)].filter(Boolean)), hashes: new Set() })) continue;
        if (await seenOriginalUrl(link.url)) continue;
        noteSourceEvent(current.source, "candidate");
        const next = { source: current.source, link: link, rest: current.rest, extra: Number(current.extra || 0) + 1 };
        const kept = await prefilterCandidates([next], summary);
        if (kept.length) { ordered.push(next); return; }
        current = next;
      }
    };

    for (const candidate of ordered) {
      if (summary.found >= MAX_ITEMS_PER_RUN) break;
      if (!ownsRun()) throw releasedError();
      // A huge morning backlog must not hold the channel past its slot: stop cleanly, the rest waits for the next run.
      if (Date.now() - collectorStartedMs > COLLECTOR_MAX_RUN_MS) {
        summary.timedOut = true;
        console.warn("COLLECTOR_RUN_LIMIT " + JSON.stringify({ workspace: collectorWorkspaceId, trigger: String(trigger || ""), minutes: Math.round((Date.now() - collectorStartedMs) / 60000), found: summary.found }));
        break;
      }
      const source = candidate.source;
      const url = candidate.link.url;
      markStep("article:" + String(url || "").slice(0, 120));

      let baseSaved = false;
      let claimed = [];
      try {
        // v0.58.0: the queue is full and this link is not a top story: do not even open the page. Before, a deferred link
        // was downloaded again on every run only to be turned away at the gate below.
        const earlyCapacity = capacityGateDecision(candidate, trigger);
        if (!earlyCapacity.allow) {
          summary.capacityDeferred = Number(summary.capacityDeferred || 0) + 1;
          console.log("EDITORIAL_CAPACITY_DEFERRED " + JSON.stringify({
            workspace: currentWorkspaceId(), url: url, depth: earlyCapacity.depth, score: earlyCapacity.score, target: EDITORIAL_QUEUE_TARGET, early: true
          }));
          continue;
        }
        let articleHtml;
        try {
          articleHtml = await fetchText(url, 15000);
        } catch (fetchErrorRaw) {
          // The Telegram post / RSS item already carries the text: use it instead of losing the news.
          // ...but not when the page is gone (404/410: removed or retracted) — only when it is blocked or slow.
          const removed = /HTTP (404|410)\b/.test(String(fetchErrorRaw && fetchErrorRaw.message || ""));
          const rebuilt = removed ? "" : articleHtmlFromLink(candidate.link);
          const minText = (source.group === "blogger" || source.group === "creator") ? 40 : 250;
          if (rebuilt && String(candidate.link.text || "").length >= minText) {
            articleHtml = rebuilt;
            summary.fromLinkText = Number(summary.fromLinkText || 0) + 1;
          }
          if (!articleHtml) {
          const fetchError = fetchErrorRaw;
          // A removed / forbidden page is final; a timeout or 5xx is retried a few times and then recorded as
          // seen. Before this the same dead link stayed the first unseen link of its source forever.
          noteSourceEvent(source, "error");
          summary.errors.push(url + ": " + fetchError.message);
          const permanent = /HTTP (401|403|404|410|451)\b|Unsupported content type/.test(String(fetchError.message || ""));
          if (permanent || bumpSkipAttempt(url, "fetch_failed") >= SKIP_RETRY_MAX) {
            await recordSeenSkip(source, candidate.link, "fetch_failed", "Страница недоступна: " + String(fetchError.message || "").slice(0, 120));
          }
          await advanceSource(candidate);
          continue;
          }
        }
        const isBlogger = source.group === "blogger" || source.group === "creator";
        const originalTitle = isBlogger
          ? (candidate.link.title || extractTitle(articleHtml) || source.name)
          : (extractTitle(articleHtml) || candidate.link.title);
        const articlePublishedAt = candidate.link.publishedAt || extractPublishedAt(articleHtml, { url: url });
        const windowMs = articleMaxAgeMs();
        if (articlePublishedAt && (Date.now() - new Date(articlePublishedAt).getTime()) > windowMs) {
          summary.skipped += 1;
          await recordSeenSkip(source, Object.assign({}, candidate.link, { title: originalTitle, publishedAt: articlePublishedAt }), "stale_article", "Старше " + Math.round(windowMs / 3600000) + " ч: " + articlePublishedAt);
          await advanceSource(candidate);
          continue;
        }
        // No date on the page: freshness is unknown. A past year in the title (an old press release) is dropped;
        // anything else goes on with extra care (the writer is told the date is unknown, and the queue item gets a
        // shorter life, see dynamicItemMaxAgeMs).
        const dateUnknown = !articlePublishedAt;
        if (dateUnknown && !isBlogger && staleYearInTitle(originalTitle, false, new Date())) {
          summary.skipped += 1;
          await recordSeenSkip(source, Object.assign({}, candidate.link, { title: originalTitle }), "stale_year_in_title", "Без даты, в заголовке прошлый год");
          await advanceSource(candidate);
          continue;
        }
        const mediaCandidates = extractArticleMediaCandidates(articleHtml, url);
        const imageUrl = (mediaCandidates.images[0] && mediaCandidates.images[0].url) || extractMetaImage(articleHtml, url);
        const videoUrl = (mediaCandidates.videos[0] && mediaCandidates.videos[0].url) || extractMetaVideo(articleHtml, url);
        const raw = stripHtml(articleHtml);
        const originalText = (isBlogger && candidate.link.text ? String(candidate.link.text) : raw).slice(0, 14000);
        if (originalText.length < (isBlogger ? 40 : 250)) {
          summary.skipped += 1;
          await recordSeenSkip(source, Object.assign({}, candidate.link, { title: originalTitle, publishedAt: articlePublishedAt || "" }), "too_short", "Слишком короткая страница (" + originalText.length + " зн.)");
          await advanceSource(candidate);
          continue;
        }
        const contentHash = crypto.createHash("sha256").update(originalTitle + "\n" + originalText.slice(0, 6000)).digest("hex");
        // The id is scoped to the workspace and the URL: the same article collected by two channels (or the
        // same text under two URLs) used to collide on news_items_pkey, and the loser's post stayed queued
        // without a DB row, so it was re-collected every tick. Rows written before this change keep their ids;
        // all lookups go by (workspace_id, original_url).
        // Exact cross-channel check (URL or content hash) and an in-flight claim: all workspaces tick in
        // parallel, so two channels can be writing the same article at the same moment.
        if (CROSS_CHANNEL_DEDUPE_ENABLED) {
          const articleKeys = itemArticleKeys({ originalUrl: url, contentHash: contentHash });
          const conflict = crossChannelConflict(articleKeys);
          if (conflict) {
            console.log("CROSS_CHANNEL_DUPLICATE " + JSON.stringify({ workspace: currentWorkspaceId(), url: url, by: conflict.by, otherWorkspace: conflict.workspace, otherChannel: conflict.channel, where: conflict.where, windowHours: CROSS_CHANNEL_DEDUPE_HOURS }));
            summary.skipped += 1;
            if (conflict.where === "published") {
              // Published elsewhere: final. Queued / in flight elsewhere: not recorded, retried while the other post is still undecided.
              await saveNewsItem({
                id: "news_" + crypto.createHash("sha256").update("crosschannel\n" + currentWorkspaceId() + "\n" + url).digest("hex").slice(0, 20),
                sourceId: source.id, sourceName: source.name, sourceUrl: source.url, originalUrl: url, originalTitle: originalTitle,
                originalText: originalText.slice(0, 2000), contentHash: contentHash, status: "duplicate_story",
                metadata: { trigger: trigger || "scheduler", articlePublishedAt: articlePublishedAt || "", autoPublishBlocked: "cross_channel_duplicate", crossChannel: { workspace: conflict.workspace, channel: conflict.channel, by: conflict.by, where: conflict.where } }
              });
            }
            await advanceSource(candidate);
            continue;
          }
          claimed = crossChannelClaim(articleKeys);
        }

        const capacity = capacityGateDecision(candidate, trigger);
        if (!capacity.allow) {
          summary.capacityDeferred = Number(summary.capacityDeferred || 0) + 1;
          console.log("EDITORIAL_CAPACITY_DEFERRED " + JSON.stringify({
            workspace: currentWorkspaceId(), url: url, depth: capacity.depth, score: capacity.score, target: EDITORIAL_QUEUE_TARGET
          }));
          continue;
        }

        // Scoped by workspace: the same article in two channels (e.g. Афиша Daily in
        // food and internet) collided on news_items_pkey and failed every collection.
        // The default workspace keeps the old ids.
        const wsIdForHash = currentWorkspaceId();
        const id = "news_" + (wsIdForHash && wsIdForHash !== workspaceStore.defaultWorkspaceId
          ? crypto.createHash("sha256").update(wsIdForHash + "\n" + url + "\n" + contentHash).digest("hex").slice(0, 20)
          : contentHash.slice(0, 20));
        // Cheap duplicate check on the source text BEFORE media preparation and the
        // writer/checker calls: an obvious repeat of a recently published post costs
        // one short classifier call instead of media + 3-6 LLM calls.
        let storyPrecheck = null;
        if (STORY_PRECHECK_ENABLED) {
          try {
            markStep("story_precheck");
            storyPrecheck = await classifyPublishedStoryRelationship({ id: id, newsId: id, title: originalTitle, text: originalText, sourceId: source.id, sourceName: source.name });
          } catch (error) {
            console.warn("STORY_PRECHECK_ERROR " + JSON.stringify({ workspace: currentWorkspaceId(), url: url, error: error.message }));
            storyPrecheck = null;
          }
          // A queued post's "update" is reported as "duplicate" (queued: true) so that it is merged into the queued
          // post instead of published twice; that merge needs the full pipeline, so only a genuine duplicate
          // (the model said "duplicate", not "update") is dropped here.
          if (storyPrecheck && storyPrecheck.relation === "duplicate" && !(storyPrecheck.queued && storyPrecheck.judgedRelation === "update")) {
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
        markStep("media");
        const media = await prepareMediaDirector({
          id: id,
          deferExpensive: MEDIA_DEFER_EXPENSIVE,
          articleUrl: url,
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
            articleDateUnknown: dateUnknown || undefined,
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
        if (Number.isFinite(Number(media.mediaQualityScore))) {
          noteSourceEvent(source, Number(media.mediaQualityScore) >= MEDIA_QUALITY_MIN_SCORE ? "media_good" : "media_bad", { score: Number(media.mediaQualityScore) });
        }

        if (MEDIA_REQUIRED && !hasPublishableMedia(baseItem) && !["deferred_missing","deferred_generation"].includes(String(baseItem.metadata.mediaStatus || ""))) {
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
            markStep("editorial");
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
            summary.errors.push(originalTitle + ": " + error.message);
            maybeBillingAlert(error.message);
            // A transient model error (429, timeout) must not lose the article: retried on the next ticks,
            // recorded as rewrite_error (and so seen) only after SKIP_RETRY_MAX attempts.
            if (bumpSkipAttempt(url, "rewrite_error") < SKIP_RETRY_MAX) { saveState(); continue; }
            baseItem.status = "rewrite_error";
            baseItem.metadata.rewriteError = error.message;
            await saveNewsItem(baseItem);
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
            markStep("rewrite");
            rewrite = await callOpenAIRewrite({ title: originalTitle, sourceUrl: url, text: originalText, sourceName: source.name, sourceGroup: source.group || "", newsId: id });
            state.stats.rewritten += 1;
          } catch (error) {
            summary.errors.push(originalTitle + ": " + error.message);
            maybeBillingAlert(error.message);
            if (bumpSkipAttempt(url, "rewrite_error") < SKIP_RETRY_MAX) { saveState(); continue; }
            baseItem.status = "rewrite_error";
            baseItem.metadata.rewriteError = error.message;
            await saveNewsItem(baseItem);
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

        markStep("qc");
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

        // A held draft must never trigger paid image generation. It can keep a free
        // local fallback until a later retry actually approves the post.
        const costTier = qc.qcStatus === "hold" ? 3 : editorialCostTier(rewrite, editorialV2Meta, media);
        markStep("final_media");
        const finalMedia = await finalizeApprovedMedia(media, {
          id: id,
          newsId: id,
          title: rewrite.title || originalTitle,
          text: rewrite.text,
          topicId: editorialChannelId(),
          sourceName: source.name,
          sourceUrl: url,
          mediaLicense: media.mediaLicense || sourceMediaLicense(source)
        }, costTier);
        Object.assign(media, finalMedia);
        Object.assign(baseItem.metadata, {
          imageUrl: media.imageUrl || "",
          originalImageUrl: media.originalImageUrl || "",
          originalVideoUrl: media.originalVideoUrl || "",
          videoUrl: media.videoUrl || "",
          generatedImageUrl: media.generatedImageUrl || "",
          enhancedImageUrl: media.enhancedImageUrl || "",
          mediaPackUrls: Array.isArray(media.mediaPackUrls) ? media.mediaPackUrls : [],
          mediaType: media.mediaType || "",
          mediaStatus: media.mediaStatus || "",
          mediaOrigin: media.mediaOrigin || "",
          mediaQualityScore: media.mediaQualityScore == null ? null : Number(media.mediaQualityScore),
          mediaCostTier: costTier,
          generatedBy: media.generatedBy || ""
        });
        if (MEDIA_REQUIRED && !(media.imageUrl || media.generatedImageUrl || media.videoUrl)) {
          baseItem.status = "missing_media_final";
          baseItem.metadata.autoPublishBlocked = "missing_media_final";
          await saveNewsItem(baseItem);
          summary.skipped += 1;
          continue;
        }

        const postText = rewrite.text;

        const lastPublished = (state.history || []).find(function(x){ return x && x.publishedAt; });
        const lastPublishedAt = lastPublished ? new Date(lastPublished.publishedAt).getTime() : 0;
        const enoughTimePassed = !lastPublishedAt || (Date.now() - lastPublishedAt) >= AUTO_PUBLISH_MIN_INTERVAL_MINUTES * 60 * 1000;
        const canAutoPublish =
          // Money is slot-only: direct legacy auto-publish would bypass one-post-per-rubric and the approved cadence.
          editorialChannelId() !== "money" &&
          trigger === "legacy-auto" &&
          state.mode === "AUTO" &&
          AUTO_PUBLISH_ENABLED &&
          enoughTimePassed &&
          qc.qualityScore >= AUTO_QUALITY_MIN &&
          qc.qcStatus !== "hold" &&
          !ratingBelowAutoThreshold({ editorialV2: editorialV2Meta, aiScore: rewrite.editorialScore, qcStatus: qc.qcStatus, articlePublishedAt: articlePublishedAt || "", createdAt: new Date().toISOString(), videoUrl: media.videoUrl, imageUrl: media.imageUrl, generatedImageUrl: media.generatedImageUrl, sourceRole: sourceRole }) &&
          summary.published < 1;

        if (canAutoPublish) {
          markStep("publish");
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
            contentHash: contentHash,
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
            sourceClass: sourceClassFor(source),
            contentBucket: editorialV2Meta && editorialV2Meta.contentBucket || "",
            channelSignals: editorialV2Meta && editorialV2Meta.channelSignals || {},
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
            articleDateUnknown: dateUnknown || undefined,
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
            contentHash: contentHash,
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
            sourceClass: sourceClassFor(source),
            contentBucket: editorialV2Meta && editorialV2Meta.contentBucket || "",
            channelSignals: editorialV2Meta && editorialV2Meta.channelSignals || {},
            decisionSummary: qc.decisionSummary,
            editorialV2: editorialV2Meta
          };

          // Reuse the precheck verdict when the classifier already judged this story;
          // otherwise (e.g. a foreign-language source) compare the rewritten post.
          const storyRelation = (storyPrecheck && storyPrecheck.judged)
            ? storyPrecheck
            : await classifyPublishedStoryRelationship(queueItem);
          // A duplicate of a post still in the queue first tries the multi-source
          // story merge (second source enriches the queued post); only if no merge
          // happens is it dropped as a duplicate.
          const queuedDuplicate = storyRelation.relation === "duplicate" && storyRelation.queued;
          if (storyRelation.relation === "duplicate" && !queuedDuplicate) {
            baseItem.status = "duplicate_story";
            baseItem.metadata.storyRelation = compactStoryRelation(storyRelation);
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

          markStep("story_merge");
          const mergedStory = await tryMergeStoryQueueItem(queueItem);
          if (!mergedStory && queuedDuplicate) {
            baseItem.status = "duplicate_story";
            baseItem.metadata.storyRelation = compactStoryRelation(storyRelation);
            baseItem.metadata.autoPublishBlocked = "duplicate_story";
            summary.skipped += 1;
            await saveNewsItem(baseItem);
            saveState();
            continue;
          }
          baseItem.metadata.storyRelation = {
            relation: storyRelation.relation,
            updateOf: queueItem.storyUpdateOf || "",
            updateTitle: queueItem.storyUpdateTitle || "",
            reason: storyRelation.reason || ""
          };
          if (mergedStory) {
            baseItem.metadata.storyClusterId = mergedStory.storyCluster && mergedStory.storyCluster.id || "";
            baseItem.metadata.storyMergedIntoQueueId = mergedStory.id;
            baseItem.metadata.storySourceCount = mergedStory.storySources && mergedStory.storySources.length || 0;
          } else {
            // DB row first: when the write fails (throws into the catch below) nothing is queued, so a post
            // can never sit in the queue without a news_items row and be re-collected on every tick.
            markStep("queue");
            await saveNewsItem(baseItem);
            baseSaved = true;
            if (!ownsRun()) throw releasedError();
            state.queue.unshift(queueItem);
          }
          pruneQueueItems(state);
          summary.queued += 1;
          noteSourceEvent(source, "useful");
        }

        if (!baseSaved) await saveNewsItem(baseItem);
        saveState();
      } catch (error) {
        if (error && error.code === "COLLECTOR_RELEASED") throw error;
        noteSourceEvent(source, "error");
        summary.errors.push(url + ": " + error.message);
        // Bounded retry: after SKIP_RETRY_MAX failures the link counts as seen (see seenOriginalUrl).
        bumpSkipAttempt(url, "error");
      } finally {
        crossChannelRelease(claimed);
      }
    }

    // Starvation: slot preparations that found nothing new in a row (see replenishSources).
    if (String(trigger || "").startsWith("slot-")) {
      // capacityDeferred: there were good candidates, the queue was just full — not starving
      state.sourceStarvingRuns = summary.found > 0 || summary.queued > 0 || Number(summary.capacityDeferred || 0) > 0 ? 0 : Number(state.sourceStarvingRuns || 0) + 1;
      if (state.sourceStarvingRuns >= SOURCE_STARVING_RUNS) summary.starving = state.sourceStarvingRuns;
    }
    const pausedSources = autoPauseWeakSources();
    if (pausedSources.length) summary.pausedSources = pausedSources;
    // Top up sources in the background so the collector run is not delayed.
    replenishSources(pausedSources.length ? "replace_paused" : "below_target").catch(function(error){
      console.warn("SOURCE_REPLENISH_ERROR " + JSON.stringify({ workspace: currentWorkspaceId(), error: error.message }));
    });
    const calendarRebalanced = rebalanceScheduleAssignments(state, moscowDateKey(new Date()));
    if (calendarRebalanced) summary.calendarRebalanced = calendarRebalanced;
    summary.finishedAt = new Date().toISOString();
    if (summary.errors.length || summary.viaFeed || summary.fromLinkText) summary.sourceFetch = sourceFetcher.stats();
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
    if (error && error.code === "COLLECTOR_RELEASED") {
      summary.released = true;
      console.warn("COLLECTOR_ZOMBIE_STOPPED " + JSON.stringify({ workspace: collectorWorkspaceId, trigger: String(trigger || ""), minutes: Math.round((Date.now() - collectorStartedMs) / 60000) }));
    } else {
      lastCollectorRuns.set(currentWorkspaceId(), summary); // a released run must not overwrite the newer run's summary
    }
    if (db && dbReady && runId) {
      try {
        await db.query("UPDATE collector_runs SET finished_at=NOW(), status='failed', error_text=$2 WHERE id=$1", [runId, error.message]);
      } catch {}
    }
    return summary;
  } finally {
    // The watchdog may have released this run and a newer one may own the flag now: only clear our own.
    const run = collectorRuns.get(collectorWorkspaceId);
    if (run && run.token === collectorToken) {
      collectorRuns.delete(collectorWorkspaceId);
      collectorRunningWorkspaces.delete(collectorWorkspaceId);
    }
  }
}

function dynamicScheduledHistorySlot(item) {
  if (!item || !item.publishedAt) return "";

  const explicitOrigin = String(item.publicationOrigin || "").trim();
  const explicitSlot = String(item.scheduledSlot || "").trim();
  if ((explicitOrigin === "schedule" || explicitOrigin === "blogger-schedule" || explicitOrigin === "russian-ai-schedule" || explicitOrigin === "money-emergency-schedule") && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(explicitSlot)) {
    return explicitSlot; // the lane counters filter by origin themselves
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
      item.publicationOrigin !== "russian-ai-schedule" &&
      item.publicationOrigin !== "money-emergency-schedule";
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
function moneyEmergencyDailyPublishedCount(dayKey) {
  return (state.history || []).filter(function(item) {
    const slot = dynamicScheduledHistorySlot(item);
    return slot && slot.startsWith(dayKey + " ") && item.publicationOrigin === "money-emergency-schedule";
  }).length;
}
function moneyNormalPublishedCount(dayKey) {
  return dynamicDailyPublishedCount(dayKey) + bloggerDailyPublishedCount(dayKey);
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
  const channelId = editorialChannelId();
  const strategy = channelStrategyScore(channelId, item, recentHistoryItems(24), item);

  if (Number.isFinite(aiScore)) {
    // The visible post rating stays 0–100. Selection gets an additional Channel DNA
    // layer so a story that fits this specific channel can outrank generic "important" news.
    const base = Math.max(0, Math.min(100, queueItemRating(item)));
    const quality = Number(item && item.qualityScore);
    const qualityBonus = Number.isFinite(quality) ? Math.max(-8, Math.min(8, (quality - AUTO_QUALITY_MIN) * 0.35)) : -4;
    const diversity = editorialDiversityPenalty(item);
    const learning = editorialLearningBonus(item);
    const storyBonus = item && item.storyCluster && Number(item.storyCluster.sourceCount) > 1 ? 4 : 0;
    const updateBonus = item && item.storyUpdateOf ? 2 : 0;
    return Math.max(0, Math.min(124,
      base +
      videoPriorityBonus(item, base) +
      qualityBonus +
      learning.bonus +
      storyBonus +
      updateBonus +
      strategy.totalBonus -
      diversity.penalty
    ));
  }

  const ageMinutes = dynamicItemAgeMs(item) / 60000;
  const fallback = Math.min(74, Math.max(0, 68 - ageMinutes * 0.2));
  const diversity = editorialDiversityPenalty(item);
  const learning = editorialLearningBonus(item);
  return Math.max(0, Math.min(103, fallback + videoPriorityBonus(item, fallback) + learning.bonus + strategy.totalBonus - diversity.penalty));
}

function dynamicUsedQueueIds() {
  const used = new Set();
  const schedule = ensureScheduleShape(state);
  // An assignment whose slot has long passed (missed window, REVIEW mode, downtime) must not keep reserving the
  // best post forever. A grace period keeps a late retry of the current slot working.
  const now = new Date();
  const today = moscowDateKey(now);
  const nowMinutes = moscowMinutes(now);
  Object.keys(schedule.assignments || {}).forEach(function(day) {
    Object.entries(schedule.assignments[day] || {}).forEach(function(entry) {
      const id = entry[1];
      if (!id) return;
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(entry[0] || ""));
      const slotMinutes = m ? Number(m[1]) * 60 + Number(m[2]) : null;
      // :30 lanes have no catch-up: their reservation ends with the publish window, so a missed extra slot does
      // not keep an ordinary post away from the hourly lane for 90 minutes.
      const extraTimes = new Set((channelExtraLane() && channelExtraLane().slots || []).map(String));
      const grace = (extraTimes.has(String(entry[0] || "")) || (m && m[2] === "30"))
        ? SCHEDULER_SLOT_WINDOW_MINUTES : DYNAMIC_ASSIGNMENT_GRACE_MIN;
      const expired = day < today || (day === today && slotMinutes != null && slotMinutes + grace < nowMinutes);
      if (!expired) used.add(id);
    });
  });
  return used;
}

function dynamicBestQueueItem(kind, time) {
  // Posts at or above the rating threshold first; reserve posts only when none is available.
  // A thematic slot is never backfilled by another rubric: if its own queue is weak/empty, the slot is skipped.
  return dynamicBestQueueItemRaw(kind, true, time) || dynamicBestQueueItemRaw(kind, false, time);
}

function dynamicBestQueueItemRaw(kind, onlyAboveThreshold, time) {
  const used = dynamicUsedQueueIds();
  const wantsBlogger = kind === "blogger";
  const wantsRussianAi = kind === "russian-ai";
  const wantsMoneyEmergency = kind === "money-emergency";
  const channelId = editorialChannelId();
  const anySourceLane = wantsBlogger && Boolean(channelExtraLane() && channelExtraLane().anySource);
  // The same article already published by another channel (e.g. a copy queued before the cross-channel check existed).
  const foreignPublished = CROSS_CHANNEL_DEDUPE_ENABLED ? crossChannelIndex({ publishedOnly: true }) : null;
  const excludedBuckets = new Set(channelStrategy(editorialChannelId()).excludeBuckets || []);
  // one post per theme a day: a theme already posted today waits while another theme has a candidate
  const themes = rubricIds();
  const today = moscowDateKey(new Date());
  const themesToday = new Set();
  const themeCountToday = {};
  const strategyNow = channelStrategy(channelId);
  const rubricQuota = {};
  for (const rb of (strategyNow.rubrics || [])) rubricQuota[rb.id] = Math.max(1, Number(rb.perDay || 1));
  const unifiedFlow = channelUnifiedSlots();
  if (themes.size) {
    for (const h of (state.history || [])) {
      if (h && h.publishedAt && moscowDateKey(new Date(h.publishedAt)) === today) { const t = itemRubric(h, themes); if (t) { themesToday.add(t); themeCountToday[t] = (themeCountToday[t] || 0) + 1; } }
    }
  }
  // v0.55.0: a rubric with a daily quota (perDay) stays "open" until the quota is filled; the rule is soft (ranking only).
  const themeOpen = function(t) { return unifiedFlow ? (themeCountToday[t] || 0) < (rubricQuota[t] || 1) : !themesToday.has(t); };
  const themeRank = function(item) { if (!themes.size) return 0; const t = itemRubric(item, themes); return !t ? 1 : (themeOpen(t) ? 2 : 0); };
  return (state.queue || [])
    .filter(function(item) {
      if (!(item && item.id && item.newsId && item.status !== "media_failed" && item.status !== "publish_failed" && !used.has(item.id) && dynamicItemAgeMs(item) <= dynamicItemMaxAgeMs(item))) return false;
      if (item.publishRetryAfter && Date.parse(item.publishRetryAfter) > Date.now()) return false;
      { const pending = pendingAutoTargets(item); if (!pending.telegram && !pending.vk) return false; }
      if (foreignPublished && crossChannelConflict(item, { index: foreignPublished })) return false;
      if (!autoQualityEligible(item)) return false;
      if (textCardBlocked(item)) return false;
      if (excludedBuckets.size && excludedBuckets.has(String(item.contentBucket || (item.editorialV2 && item.editorialV2.contentBucket) || ""))) return false;
      const itemTheme = itemRubric(item, themes);
      const desiredRubric = channelSlotRubric(time);
      if (desiredRubric && itemTheme !== desiredRubric) return false;
      if (channelId === "money") {
        if (!itemTheme) return false; // old/unclassified queue cannot leak into the rebuilt channel
        if (!wantsMoneyEmergency && !unifiedFlow && themesToday.has(itemTheme)) return false; // unified flow: a filled rubric only ranks lower (a slot never stays empty)
        if (!onlyAboveThreshold) {
          const utility = Number(item.channelSignals && item.channelSignals.utility != null ? item.channelSignals.utility : item.editorialV2 && item.editorialV2.channelSignals && item.editorialV2.channelSignals.utility);
          if (!Number.isFinite(utility) || utility < 7) return false; // 70–79 only when genuinely useful
        }
      }
      if (wantsMoneyEmergency) {
        const importance = Number(item.editorialV2 && item.editorialV2.importance);
        return channelId === "money" && queueItemRating(item) >= 95 && Number.isFinite(importance) && importance >= 9 && !isRussianAISource(item);
      }
      if (onlyAboveThreshold && ratingBelowAutoThreshold(item)) return false;
      if (wantsBlogger) return isBloggerSource(item) || Boolean(anySourceLane && !isRussianAISource(item));
      if (wantsRussianAi) return isRussianAISource(item);
      if (channelId === "auto") return !isRussianAISource(item);
      if (unifiedFlow) return true;
      return !isBloggerSource(item) && !isRussianAISource(item);
    })
    .sort(function(a, b) {
      const themeDiff = themeRank(b) - themeRank(a);
      if (themeDiff) return themeDiff;
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
  const item = dynamicBestQueueItem(kind, time);
  const schedule = ensureScheduleShape(state);
  if (!schedule.assignments[day]) schedule.assignments[day] = {};
  if (!schedule.suppressed[day]) schedule.suppressed[day] = {};
  if (!item) {
    const oldId = schedule.assignments[day][time];
    const oldItem = oldId && (state.queue || []).find(function(q){ return q && q.id === oldId; });
    clearDynamicAssignmentMarkers(oldItem, day + " " + time);
    delete schedule.assignments[day][time];
    saveState();
    return null;
  }
  setDynamicAssignment(day, time, item, kind, "prepared");
  saveState();
  return item;
}

function dynamicReserveBest(day, time, kind) {
  const item = dynamicBestQueueItem(kind, time);
  if (!item) return null;
  setDynamicAssignment(day, time, item, kind, "reserved");
  saveState();
  return item;
}

// Final pre-publication check. Auto-reserved future posts are temporarily released so a newly found
// stronger story can move into the imminent slot. Manual choices and already-finalized later slots stay locked.
function dynamicRefreshBest(day, time, kind) {
  const schedule = ensureScheduleShape(state);
  if (!schedule.assignments[day]) schedule.assignments[day] = {};
  if (!schedule.suppressed[day]) schedule.suppressed[day] = {};
  const slotKey = day + " " + time;
  const currentId = schedule.assignments[day][time] || "";
  const current = currentId && (state.queue || []).find(function(q){ return q && q.id === currentId; });

  const currentManual = current && String(current.manualFor || "") === slotKey;
  const currentKnownAuto = current && (String(current.reservedFor || "") === slotKey || String(current.preparedFor || "") === slotKey);
  // Before v0.54.4 manual calendar choices had no marker at all. Treat an existing unmarked assignment as manual
  // so a deploy cannot silently overwrite a user's choice.
  if (current && (currentManual || !currentKnownAuto)) {
    if (!currentManual) {
      current.manualFor = slotKey;
      current.manualAt = new Date().toISOString();
    }
    setDynamicAssignment(day, time, current, kind, "prepared");
    saveState();
    return { item: current, replaced: false, previousId: currentId, manual: true };
  }

  const targetMinute = slotMinutes(time);
  const released = [];
  Object.keys(schedule.assignments[day] || {}).forEach(function(t) {
    if (slotMinutes(t) < targetMinute) return;
    const id = schedule.assignments[day][t];
    const item = id && (state.queue || []).find(function(q){ return q && q.id === id; });
    const key = day + " " + t;
    const isTarget = t === time;
    const autoReservedLater = !isTarget && item && String(item.reservedFor || "") === key &&
      String(item.preparedFor || "") !== key && String(item.manualFor || "") !== key;
    if (!isTarget && !autoReservedLater) return;
    released.push({ time: t, id: id, item: item });
    delete schedule.assignments[day][t];
    clearDynamicAssignmentMarkers(item, key);
  });

  const best = dynamicBestQueueItem(kind, time);
  if (best) setDynamicAssignment(day, time, best, kind, "prepared");

  // Refill every now-empty future slot from the remaining queue. This also puts the displaced old post
  // into the next suitable slot instead of dropping it from the calendar.
  ensureScheduleAssignments(state, day);
  saveState();
  return { item: best, replaced: Boolean(currentId && best && currentId !== best.id), previousId: currentId, released: released.length };
}

// v0.58.0: the photo is judged when the slot is prepared, not at the publish minute. A post whose only photo fails the
// quality check ("Нет подходящего фото") used to take the slot's first attempt and was swapped for the next one only at
// publish time (up to 4 attempts per slot). Now such a post is set aside here and the next best one is chosen.
// A hand-picked post is never touched; any other error is left for the publisher.
const SLOT_PHOTO_PRECHECK_ENABLED = String(process.env.SLOT_PHOTO_PRECHECK_ENABLED || "true").toLowerCase() !== "false";
const SLOT_PHOTO_PRECHECK_MAX = 3;
async function refreshBestWithPhotoCheck(day, time, kind) {
  let refreshed = dynamicRefreshBest(day, time, kind);
  if (!SLOT_PHOTO_PRECHECK_ENABLED) return refreshed;
  const rejected = [];
  for (let i = 0; i < SLOT_PHOTO_PRECHECK_MAX && refreshed.item && !refreshed.manual; i += 1) {
    const item = refreshed.item;
    try {
      await enforceCopyrightSafeMedia(Object.assign({}, item, { postId: item.id, topicId: item.topicId || "default", __photoPrecheck: true }));
      break;
    } catch (error) {
      if (!(error && error.code === "NO_PHOTO")) break;
      item.publishFailures = Number(item.publishFailures || 0) + 1;
      item.lastPublishError = String(error.message || error).slice(0, 300);
      item.status = "publish_failed";
      item.preparedFor = "";
      rejected.push(String(item.id));
      console.log("SLOT_PHOTO_PRECHECK_REJECTED " + JSON.stringify({ workspace: currentWorkspaceId(), slot: day + " " + time, queueId: item.id, error: item.lastPublishError }));
      saveState();
      refreshed = dynamicRefreshBest(day, time, kind);
    }
  }
  if (rejected.length) refreshed.photoRejected = rejected;
  return refreshed;
}

async function prepareDynamicSlot() {
  const now = new Date();
  const nowMinutes = moscowMinutes(now);
  const hour = Math.floor(nowMinutes / 60);
  const nextHour = hour + 1;
  if (nextHour < DYNAMIC_SLOT_START_HOUR || nextHour > DYNAMIC_SLOT_END_HOUR) {
    return { ok: true, skipped: "outside_hours" };
  }
  if (!isChannelSlotHour(nextHour)) return { ok: true, skipped: "not_channel_slot" };

  const day = moscowDateKey(now);
  if (dynamicDailyPublishedCount(day) >= channelDailyMax()) {
    return { ok: true, skipped: "daily_max" };
  }

  const schedule = ensureScheduleShape(state);
  const time = String(nextHour).padStart(2, "0") + ":00";
  if (schedule.suppressed[day] && schedule.suppressed[day][time]) {
    return { ok: true, skipped: "suppressed" };
  }

  // This hour's staggered collection already ran: pick from the queue it filled, collect again only when nothing fits.
  state.dynamicScheduler = state.dynamicScheduler || {};
  if (COLLECTION_STAGGER_ENABLED && state.dynamicScheduler.lastCollectKey === staggeredCollectKey(day, hour)) {
    await refreshEditorialLearning(false).catch(function(error){ console.warn("Editorial learning refresh failed:", error.message); });
    const refreshed = await refreshBestWithPhotoCheck(day, time);
    const ready = refreshed.item;
    if (ready) return { ok: true, slot: time, collector: { ok: true, skipped: "staggered_collect_done" }, prepared: ready.id, title: ready.title, replaced: refreshed.replaced, photoRejected: refreshed.photoRejected };
  }
  const collector = await collectOnce("slot-prep");
  await refreshEditorialLearning(false).catch(function(error){ console.warn("Editorial learning refresh failed:", error.message); });
  const refreshed = await refreshBestWithPhotoCheck(day, time);
  const item = refreshed.item;
  return {
    ok: true,
    slot: time,
    collector: collector,
    prepared: item ? item.id : null,
    title: item ? item.title : "",
    replaced: refreshed.replaced
  };
}

async function prepareBloggerSlot(time) {
  const now = new Date();
  const day = moscowDateKey(now);
  const slotTime = String(time || "");
  if (!bloggerSlotsFor().includes(slotTime)) return { ok: true, skipped: "invalid_blogger_slot" };
  if (bloggerDailyPublishedCount(day) >= bloggerTargetFor()) return { ok: true, skipped: "blogger_daily_target" };

  const schedule = ensureScheduleShape(state);
  if (schedule.suppressed[day] && schedule.suppressed[day][slotTime]) return { ok: true, skipped: "suppressed" };

  const lane = channelExtraLane();
  let collector = { ok: true, skipped: "queue_ready" };
  let refreshed = dynamicRefreshBest(day, slotTime, "blogger");
  let item = refreshed.item;
  if (!item) {
    collector = lane && lane.anySource && editorialChannelId() !== "shopping"
      ? { ok: true, skipped: "any_source_lane_uses_queue" }
      : await collectOnce("blogger-slot-prep");
    await refreshEditorialLearning(false).catch(function(error){ console.warn("Editorial learning refresh failed:", error.message); });
    refreshed = dynamicRefreshBest(day, slotTime, "blogger");
    item = refreshed.item;
  }
  state.bloggerScheduler = state.bloggerScheduler || {};
  state.bloggerScheduler.lastPreparedAt = new Date().toISOString();
  saveState();
  return { ok: true, slot: slotTime, collector: collector, prepared: item ? item.id : null, title: item ? item.title : "" };
}

async function prepareMoneyEmergencySlot() {
  const now = new Date();
  const day = moscowDateKey(now);
  if (editorialChannelId() !== "money") return { ok: true, skipped: "not_money" };
  if (moneyNormalPublishedCount(day) < 8) return { ok: true, skipped: "normal_day_not_full" };
  if (moneyEmergencyDailyPublishedCount(day) >= 1) return { ok: true, skipped: "emergency_already_used" };
  const time = "22:30";
  const schedule = ensureScheduleShape(state);
  if (schedule.suppressed[day] && schedule.suppressed[day][time]) return { ok: true, skipped: "suppressed" };
  const item = dynamicRefreshBest(day, time, "money-emergency").item;
  state.moneyEmergencyScheduler = state.moneyEmergencyScheduler || {};
  state.moneyEmergencyScheduler.lastPreparedAt = new Date().toISOString();
  saveState();
  return { ok: true, slot: time, prepared: item ? item.id : null, title: item ? item.title : "" };
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
  const item = dynamicRefreshBest(day, slotTime, "russian-ai").item;
  state.russianAiScheduler = state.russianAiScheduler || {};
  state.russianAiScheduler.lastPreparedAt = new Date().toISOString();
  saveState();
  return { ok: true, slot: slotTime, collector: collector, prepared: item ? item.id : null, title: item ? item.title : "" };
}

function slotHasSuccessfulPublication(slotKey) {
  return (state.history || []).some(function(item){
    if (!item || String(item.scheduledSlot || "") !== String(slotKey || "")) return false;
    return Boolean(item.messageId || item.telegramMessageId || item.vkPostId || item.publishedAt);
  });
}

function emptySlotCollectorAllowed(schedulerState, slotKey) {
  const same = String(schedulerState.lastEmptySlotKey || "") === String(slotKey || "");
  const at = new Date(schedulerState.lastEmptySlotAttemptAt || 0).getTime();
  return !same || !Number.isFinite(at) || Date.now() - at >= EMPTY_SLOT_RESCUE_MINUTES * 60 * 1000;
}

// A channel's own minute in [from, to]: channels spread evenly in a stable (id-sorted) order, the same order for
// collecting, picking and publishing, so a channel always collects before it picks and picks before it posts.
function staggerMinuteFor(workspaceId, from, to) {
  const ids = (workspaceStore.workspaces || []).filter(Boolean).map(function(ws){ return String(ws.id); }).sort();
  const idx = Math.max(0, ids.indexOf(String(workspaceId || "")));
  const span = to - from;
  if (ids.length <= 1 || span <= 0) return from;
  return from + Math.round(idx * span / (ids.length - 1));
}
function collectionMinuteFor(workspaceId) { return staggerMinuteFor(workspaceId, COLLECTION_STAGGER_FROM, COLLECTION_STAGGER_TO); }
function prepMinuteFor(workspaceId) { return staggerMinuteFor(workspaceId, SLOT_PREP_FROM, SLOT_PREP_TO); }
function publishMinuteFor(workspaceId) { return staggerMinuteFor(workspaceId, 0, SLOT_PUBLISH_SPREAD_MINUTES); }

function staggeredCollectKey(day, hour) {
  return day + "-" + String(hour).padStart(2, "0") + "-collect";
}

// Runs this channel's collection for the next hourly slot at its own minute. Its completion is kept apart from
// lastTickKey, so it can never make a slot's publish/prepare action look undone (or done).
async function staggeredCollectTick(day, hour, minute) {
  if (!COLLECTION_STAGGER_ENABLED || !COLLECTOR_ENABLED) return null;
  if (hour < DYNAMIC_SLOT_START_HOUR - 1 || hour >= DYNAMIC_SLOT_END_HOUR) return null;
  if (!isChannelSlotHour(hour + 1)) return null; // no post next hour in this channel: nothing to collect for
  const at = collectionMinuteFor(currentWorkspaceId());
  if (minute < at || minute >= Math.min(at + COLLECTION_STAGGER_WINDOW_MINUTES, prepMinuteFor(currentWorkspaceId()))) return null;
  state.dynamicScheduler = state.dynamicScheduler || {};
  const key = staggeredCollectKey(day, hour);
  if (state.dynamicScheduler.lastCollectKey === key) return null;
  if (state.mode !== "AUTO") return null;
  if (dynamicDailyPublishedCount(day) >= channelDailyMax()) return null;
  const started = Date.now();
  try {
    const result = await withDeadline(collectOnce("slot-collect"), SCHEDULER_PREPARE_TIMEOUT_MS, "staggered collect");
    if (result && result.error === "Collector already running") return result; // retried on the next tick
    state.dynamicScheduler.lastCollectKey = key;
    state.dynamicScheduler.lastCollectAt = new Date().toISOString();
    saveState();
    console.log("STAGGERED_COLLECT " + JSON.stringify({ workspace: currentWorkspaceId(), minute: at, found: result && result.found || 0, queued: result && result.queued || 0, timedOut: Boolean(result && result.timedOut), sec: Math.round((Date.now() - started) / 1000) }));
    return result;
  } catch (error) {
    if (error && error.code === "DEADLINE") {
      console.error("SCHEDULER_TICK_TIMEOUT " + JSON.stringify({ workspace: currentWorkspaceId(), action: "collect", slot: key, collector: collectorRunInfo(currentWorkspaceId()) }));
    } else {
      console.error("STAGGERED_COLLECT_FAILED " + JSON.stringify({ workspace: currentWorkspaceId(), error: String(error && error.message || error).slice(0, 200) }));
    }
    return null;
  }
}

// One slot = one published post. If the chosen post fails, the next best post from the queue is tried right away,
// up to SLOT_PUBLISH_TRIES posts, until one goes out. The failed post rests PUBLISH_RETRY_COOLDOWN_MIN minutes
// (PUBLISH_FAILURE_MAX failures in total -> publish_failed for good).
async function publishDynamicSlot(kind, explicitTime) {
  let lastError = null;
  const failedIds = [];
  for (let attempt = 1; attempt <= SLOT_PUBLISH_TRIES; attempt++) {
    try {
      // Later attempts use only posts already in the queue: no costly last-chance collector run per failed post.
      const result = await publishDynamicSlotOnce(kind, { noRescue: attempt > 1 }, explicitTime);
      if (failedIds.length) {
        console.log("SLOT_NEXT_ITEM_RESULT " + JSON.stringify({ workspace: currentWorkspaceId(), attempts: attempt, failed: failedIds, result: { published: Boolean(result && result.published), skipped: result && result.skipped || "" } }));
        return Object.assign({}, result, { slotAttempts: attempt, failedBefore: failedIds });
      }
      return result;
    } catch (error) {
      // Only a failed PUBLICATION moves on to the next post; any other error (collector, database) is not retried here.
      if (!(error && error.queueId)) throw error;
      if (error.slotStop) {
        console.warn("SLOT_NEXT_ITEM_STOP " + JSON.stringify({ workspace: currentWorkspaceId(), attempt: attempt, queueId: error.queueId, reason: error.slotStop, error: String(error.message || error).slice(0, 200) }));
        throw error;
      }
      lastError = error;
      failedIds.push(String(error.queueId));
      console.warn("SLOT_NEXT_ITEM " + JSON.stringify({ workspace: currentWorkspaceId(), attempt: attempt, queueId: error && error.queueId || "", error: String(error && error.message || error).slice(0, 200) }));
    }
  }
  throw lastError || new Error("slot publish failed");
}

async function publishDynamicSlotOnce(kind, opts, explicitTime) {
  const publishKind = kind === "blogger" ? "blogger" : (kind === "russian-ai" ? "russian-ai" : (kind === "money-emergency" ? "money-emergency" : "regular"));
  const now = new Date();
  const nowMinutes = moscowMinutes(now);
  const hour = Math.floor(nowMinutes / 60);
  if (hour < DYNAMIC_SLOT_START_HOUR || hour > DYNAMIC_SLOT_END_HOUR) {
    return { ok: true, skipped: "outside_hours" };
  }

  const day = moscowDateKey(now);
  const time = explicitTime
    ? String(explicitTime)
    : String(hour).padStart(2, "0") + ((publishKind === "blogger" || publishKind === "russian-ai" || publishKind === "money-emergency") ? ":30" : ":00");
  if (publishKind === "blogger" && !bloggerSlotsFor().includes(time)) return { ok: true, skipped: "not_blogger_slot" };
  if (publishKind === "russian-ai" && !RUSSIAN_AI_SLOTS.includes(time)) return { ok: true, skipped: "not_russian_ai_slot" };
  if (publishKind === "money-emergency" && (editorialChannelId() !== "money" || time !== "22:30")) return { ok: true, skipped: "not_money_emergency_slot" };
  if (publishKind === "regular" && !isChannelSlotHour(hour)) return { ok: true, skipped: "not_channel_slot" };
  const slotKey = day + " " + time;
  state.dynamicScheduler = state.dynamicScheduler || {};
  state.bloggerScheduler = state.bloggerScheduler || {};
  state.russianAiScheduler = state.russianAiScheduler || {};
  state.moneyEmergencyScheduler = state.moneyEmergencyScheduler || {};
  const schedulerState = publishKind === "blogger"
    ? state.bloggerScheduler
    : (publishKind === "russian-ai" ? state.russianAiScheduler : (publishKind === "money-emergency" ? state.moneyEmergencyScheduler : state.dynamicScheduler));

  if (schedulerState.lastPublishedSlot === slotKey) {
    if (slotHasSuccessfulPublication(slotKey)) return { ok: true, skipped: "already_done" };
    // Older builds marked an empty slot as completed. Clear that stale marker so
    // catch-up can recover the missing publication.
    schedulerState.lastPublishedSlot = "";
    saveState();
  }
  if (publishKind === "blogger") {
    if (bloggerDailyPublishedCount(day) >= bloggerTargetFor()) return { ok: true, skipped: "blogger_daily_target" };
  } else if (publishKind === "russian-ai") {
    if (russianAiDailyPublishedCount(day) >= RUSSIAN_AI_DAILY_TARGET) return { ok: true, skipped: "russian_ai_daily_target" };
  } else if (publishKind === "money-emergency") {
    if (moneyNormalPublishedCount(day) < 8) return { ok: true, skipped: "normal_day_not_full" };
    if (moneyEmergencyDailyPublishedCount(day) >= 1) return { ok: true, skipped: "emergency_already_used" };
  } else if (dynamicDailyPublishedCount(day) >= channelDailyMax()) {
    return { ok: true, skipped: "daily_max" };
  }

  const schedule = ensureScheduleShape(state);
  const laneKind = publishKind === "blogger" ? "blogger" : (publishKind === "russian-ai" ? "russian-ai" : (publishKind === "money-emergency" ? "money-emergency" : undefined));
  // Re-rank once more at the actual publication moment. If a stronger story entered the queue after
  // the 15-minute preparation, it replaces the automatic reservation now; manual choices stay locked.
  const publishRefresh = dynamicRefreshBest(day, time, laneKind);
  let queueId = publishRefresh.item && publishRefresh.item.id || "";

  if (!queueId) {
    let lastChanceItem = dynamicRefreshBest(day, time, laneKind).item;

    if (!lastChanceItem && !(opts && opts.noRescue) && emptySlotCollectorAllowed(schedulerState, slotKey)) {
      schedulerState.lastEmptySlotKey = slotKey;
      schedulerState.lastEmptySlotAttemptAt = new Date().toISOString();
      saveState();

      // Fast path first: an Anthropic outage may already have left a strong,
      // fully sourced story in the queue with qcStatus=hold. Repair at most two
      // such items with primary OpenAI QC before doing a costly full source scan.
      const rescue = await retryUnavailableEditorialQueueItems(2).catch(function(error){
        return { checked: 0, repaired: 0, held: 0, skipped: 0, error: String(error && error.message || error) };
      });
      lastChanceItem = dynamicRefreshBest(day, time, laneKind).item;
      if (lastChanceItem) {
        console.log("SLOT_FAST_RESCUE " + JSON.stringify({
          workspace: currentWorkspaceId(),
          slot: slotKey,
          queueId: lastChanceItem.id,
          rescue: rescue
        }));
      }

      if (!lastChanceItem && !isCollectorRunning()) {
        const lastChanceTrigger = publishKind === "blogger"
          ? "blogger-slot-last-chance"
          : (publishKind === "russian-ai" ? "russian-ai-slot-last-chance" : (publishKind === "money-emergency" ? "money-emergency-last-chance" : "slot-last-chance"));
        const collectorResult = await collectOnce(lastChanceTrigger);
        lastChanceItem = dynamicRefreshBest(day, time, laneKind).item;
        console.log("SLOT_FULL_RESCUE " + JSON.stringify({
          workspace: currentWorkspaceId(),
          slot: slotKey,
          queueId: lastChanceItem && lastChanceItem.id || "",
          collector: collectorResult
        }));
      }
    }
    queueId = lastChanceItem && lastChanceItem.id || "";
  }

  if (!queueId) {
    schedulerState.lastEmptySlotKey = slotKey;
    schedulerState.lastEmptySlotAttemptAt = schedulerState.lastEmptySlotAttemptAt || new Date().toISOString();
    saveState();
    return { ok: true, skipped: "empty_slot_retry_pending", slot: time };
  }

  const item = (state.queue || []).find(function(q){ return q && q.id === queueId; });
  if (!item) {
    delete schedule.assignments[day][time];
    schedulerState.lastEmptySlotKey = slotKey;
    schedulerState.lastEmptySlotAttemptAt = new Date().toISOString();
    saveState();
    return { ok: true, skipped: "missing_item_retry_pending" };
  }

  const releasePublishLock = acquirePublishLock(item.id);
  if (!releasePublishLock) return { ok: true, skipped: "publish_in_progress", prepared: queueId };
  try {
  if (dynamicItemAgeMs(item) > dynamicItemMaxAgeMs(item)) {
    delete schedule.assignments[day][time];
    state.queue = (state.queue || []).filter(function(q){ return q.id !== queueId; });
    schedulerState.lastEmptySlotKey = slotKey;
    schedulerState.lastEmptySlotAttemptAt = new Date().toISOString();
    saveState();
    return { ok: true, skipped: "stale_retry_pending" };
  }

  if (state.mode !== "AUTO" || !AUTO_PUBLISH_ENABLED) {
    // Nothing is published in this slot, so it must not keep reserving the best post.
    delete schedule.assignments[day][time];
    item.preparedFor = "";
    schedulerState.lastPublishedSlot = slotKey;
    saveState();
    return { ok: true, skipped: "auto_disabled", prepared: queueId };
  }

  // Last look before publishing: another channel may have published this article since it was queued.
  const publishConflict = CROSS_CHANNEL_DEDUPE_ENABLED ? crossChannelConflict(item, { publishedOnly: true }) : null;
  if (publishConflict) {
    console.log("CROSS_CHANNEL_DUPLICATE " + JSON.stringify({ workspace: currentWorkspaceId(), stage: "publish", queueId: queueId, by: publishConflict.by, otherWorkspace: publishConflict.workspace, otherChannel: publishConflict.channel, windowHours: CROSS_CHANNEL_DEDUPE_HOURS }));
    delete schedule.assignments[day][time];
    state.queue = (state.queue || []).filter(function(q){ return q.id !== queueId; });
    saveState();
    if (db && dbReady && item.newsId) {
      try {
        await db.query("UPDATE news_items SET status='duplicate_story', metadata=COALESCE(metadata,'{}'::jsonb) || $2::jsonb, updated_at=NOW() WHERE id=$1 AND workspace_id=$3 AND status NOT IN ('published','media_failed')",
          [item.newsId, pgJsonString({ autoPublishBlocked: "cross_channel_duplicate", crossChannel: { workspace: publishConflict.workspace, channel: publishConflict.channel, by: publishConflict.by } }), currentWorkspaceId()]);
      } catch (error) { console.warn("Cross-channel duplicate status update failed:", error.message); }
    }
    // The slot stays open: the next scheduler tick picks the next best post.
    return { ok: true, skipped: "cross_channel_duplicate", prepared: queueId };
  }

  const targets = pendingAutoTargets(item);

  if (!targets.telegram && !targets.vk) {
    delete schedule.assignments[day][time];
    // Everything this channel publishes to is already done (or VK retries are used up): the post is finished.
    if (item.telegramPublished || item.vkPublished) state.queue = (state.queue || []).filter(function(q){ return q.id !== queueId; });
    schedulerState.lastPublishedSlot = slotKey;
    saveState();
    return { ok: true, skipped: "auto_targets_disabled", slot: time };
  }

  let result;
  try {
    result = await sendMultiPlatformPost(Object.assign({}, item, {
      postId: item.id,
      topicId: item.topicId || "default",
      allow_text_fallback: allowTextFallbackForPost(item)
    }), targets);
  } catch (error) {
    // A post that keeps failing must not hold the slot (and every following slot) hostage.
    const partial = error && error.partialResult || {};
    // Channel-level trouble (bot kicked, chat gone, flood limit): the post is not to blame and the next post would fail
    // the same way -> stop this slot, keep the post. No answer from Telegram: the post may already be out -> stop too,
    // a different post in the same slot could make two posts.
    const channelLevel = Boolean(partial.telegramPermanent || partial.telegramRateLimited || (error && (error.telegramPermanent || error.telegramRateLimited)));
    const unclear = Boolean(partial.telegramNetwork);
    if (channelLevel || unclear) {
      item.lastPublishError = String(error && error.message || error).slice(0, 300);
      if (unclear) {
        item.publishFailures = Number(item.publishFailures || 0) + 1;
        if (item.publishFailures >= PUBLISH_FAILURE_MAX) {
          item.status = "publish_failed";
          delete schedule.assignments[day][time];
          console.warn("PUBLISH_FAILED " + JSON.stringify({ workspace: currentWorkspaceId(), queueId: queueId, failures: item.publishFailures, unclear: true, error: item.lastPublishError }));
        }
      }
      saveState();
      if (error && typeof error === "object") { error.queueId = queueId; error.slotStop = channelLevel ? "channel" : "unclear"; }
      throw error;
    }
    item.publishFailures = Number(item.publishFailures || 0) + 1;
    item.lastPublishError = String(error && error.message || error).slice(0, 300);
    const permanent = Boolean(error && (error.permanent || error.telegramPermanent));
    // The slot is freed for the next post right away; this post rests before it may be tried again.
    delete schedule.assignments[day][time];
    item.preparedFor = "";
    if (permanent || item.publishFailures >= PUBLISH_FAILURE_MAX) {
      item.status = "publish_failed";
      console.warn("PUBLISH_FAILED " + JSON.stringify({ workspace: currentWorkspaceId(), queueId: queueId, failures: item.publishFailures, permanent: permanent, error: item.lastPublishError }));
    } else {
      item.publishRetryAfter = new Date(Date.now() + PUBLISH_RETRY_COOLDOWN_MIN * 60000).toISOString();
    }
    saveState();
    if (error && typeof error === "object") error.queueId = queueId;
    throw error;
  }
  if (result.safeMedia) Object.assign(item, result.safeMedia);
  const publishedAt = new Date().toISOString();
  if (targets.vk && !result.vkPublished) item.vkAttempts = Number(item.vkAttempts || 0) + 1;

  if (result.telegramPublished) {
    item.telegramPublished = true;
    item.telegramMessageId = result.message_id;
    item.telegramPublishedAt = publishedAt;
    if (result.telegramUncertain) item.telegramUncertain = true; // sent, no answer: check the channel by hand
  }
  if (result.vkPublished) {
    item.vkPublished = true;
    item.vkPostId = result.vkPostId || null;
    item.vkStatus = "published";
    item.vkPublishedAt = publishedAt;
    if (result.vkUncertain) { item.vkUncertain = true; item.vkStatus = "uncertain"; }
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
      telegramUncertain: Boolean(result.telegramUncertain || item.telegramUncertain),
      vkPostId: result.vkPostId || item.vkPostId || null,
      vkStatus: result.vkStatus || item.vkStatus || "",
      vkError: result.vkError || item.vkError || "",
      vkPreviewSlug: result.vkPreviewSlug || item.vkPreviewSlug || "",
      vkPreviewUrl: result.vkPreviewUrl || item.vkPreviewUrl || "",
      publishedAt: publishedAt,
      sourceId: item.sourceId || "",
      sourceName: item.sourceName || "",
      sourceUrl: item.sourceUrl || "",
      contentHash: item.contentHash || "",
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
      sourceClass: item.sourceClass || sourceClassFor(item),
      contentBucket: item.contentBucket || (item.editorialV2 && item.editorialV2.contentBucket) || "",
      channelSignals: item.channelSignals || (item.editorialV2 && item.editorialV2.channelSignals) || {},
      decisionSummary: item.decisionSummary || "",
      decisionExplanation: buildDecisionExplanation(item),
      repairLog: Array.isArray(result.repairLog) ? result.repairLog : [],
      mediaDirector: item.mediaDirector || null,
      storyUpdateOf: item.storyUpdateOf || "",
      storyUpdateTitle: item.storyUpdateTitle || "",
      editorialV2: item.editorialV2 || null,
      publicationOrigin: publishKind === "blogger"
        ? "blogger-schedule"
        : (publishKind === "russian-ai" ? "russian-ai-schedule" : (publishKind === "money-emergency" ? "money-emergency-schedule" : "schedule")),
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
    historyItem.sourceClass = item.sourceClass || sourceClassFor(item);
    historyItem.contentBucket = item.contentBucket || (item.editorialV2 && item.editorialV2.contentBucket) || historyItem.contentBucket || "";
    historyItem.channelSignals = item.channelSignals || (item.editorialV2 && item.editorialV2.channelSignals) || historyItem.channelSignals || {};
    historyItem.decisionExplanation = buildDecisionExplanation(item);
    historyItem.publicationOrigin = publishKind === "blogger"
      ? "blogger-schedule"
      : (publishKind === "russian-ai" ? "russian-ai-schedule" : (publishKind === "money-emergency" ? "money-emergency-schedule" : "schedule"));
    historyItem.scheduledSlot = slotKey;
  }

  delete schedule.assignments[day][time];
  if (result.telegramPublished || result.vkPublished) {
    schedulerState.lastPublishedSlot = slotKey;
    schedulerState.lastPublishedAt = publishedAt;
    schedulerState.lastEmptySlotKey = "";
    schedulerState.lastEmptySlotAttemptAt = "";
  }

  const mediaFailed = result.vkStatus === "media_failed";
  const stillPending = pendingAutoTargets(item);
  if (!mediaFailed && !stillPending.telegram && !stillPending.vk) {
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
          pgJsonString({
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
          vkPostIdForDb(result.vkPostId || item.vkPostId),
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
  } finally {
    releasePublishLock();
  }
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
  // Each action has a window of SCHEDULER_SLOT_WINDOW_MINUTES instead of one exact minute.
  const inWindow = function(start) { return minute >= start && minute < start + SCHEDULER_SLOT_WINDOW_MINUTES; };
  let windowStart = minute;

  // Extra lanes may use :15/:30/:45 as well as the legacy :30 slots.
  const ownerLane = channelExtraLane();
  if (editorialChannelId() === "shopping" && ownerLane && Array.isArray(ownerLane.slots)) {
    for (const candidateTime of ownerLane.slots) {
      const sm = slotMinutes(candidateTime);
      const prep = sm - 15;
      if (prep >= 0 && nowMinutes >= prep && nowMinutes < prep + SCHEDULER_SLOT_WINDOW_MINUTES) {
        bloggerTime = candidateTime;
        action = "blogger_prepare";
        windowStart = prep % 60;
        break;
      }
    }
    if (!action) {
      for (const candidateTime of ownerLane.slots) {
        const sm = slotMinutes(candidateTime);
        if (nowMinutes >= sm && nowMinutes < sm + SCHEDULER_SLOT_WINDOW_MINUTES) {
          bloggerTime = candidateTime;
          action = "blogger_publish";
          windowStart = sm % 60;
          break;
        }
      }
    }
  }

  if (!action && inWindow(15)) {
    windowStart = 15;
    bloggerTime = String(hour).padStart(2, "0") + ":30";
    russianAiTime = bloggerTime;
    if (editorialChannelId() === "money" && bloggerTime === "22:30") {
      action = "money_emergency_prepare";
    } else if (bloggerSlotsFor().includes(bloggerTime) && bloggerLaneActive()) {
      action = "blogger_prepare";
    } else if (!channelUnifiedSlots() && RUSSIAN_AI_SLOTS.includes(russianAiTime) && (state.sources || []).some(function(source){ return source && source.enabled && isRussianAISource(source); })) {
      action = "russian_ai_prepare";
    }
  }
  if (!action && inWindow(30)) {
    windowStart = 30;
    bloggerTime = String(hour).padStart(2, "0") + ":30";
    russianAiTime = bloggerTime;
    if (editorialChannelId() === "money" && bloggerTime === "22:30") {
      action = "money_emergency_publish";
    } else if (bloggerSlotsFor().includes(bloggerTime) && bloggerLaneActive()) {
      action = "blogger_publish";
    } else if (!channelUnifiedSlots() && RUSSIAN_AI_SLOTS.includes(russianAiTime) && (state.sources || []).some(function(source){ return source && source.enabled && isRussianAISource(source); })) {
      action = "russian_ai_publish";
    }
  }
  const prepAt = prepMinuteFor(currentWorkspaceId());
  const publishAt = publishMinuteFor(currentWorkspaceId());
  if (!action && inWindow(prepAt) && hour >= DYNAMIC_SLOT_START_HOUR - 1 && hour < DYNAMIC_SLOT_END_HOUR && isChannelSlotHour(hour + 1)) {
    action = "prepare";
    windowStart = DYNAMIC_SLOT_PREP_MINUTE; // key only: stable even if the channel's minute shifts mid-hour
  } else if (!action && inWindow(publishAt) && hour >= DYNAMIC_SLOT_START_HOUR && hour <= DYNAMIC_SLOT_END_HOUR && isChannelSlotHour(hour)) {
    action = "publish";
    windowStart = 0;
  }
  // No slot action due (or it already completed in this window): use the free tick for this channel's own collection.
  if (!action || (state.dynamicScheduler && state.dynamicScheduler.lastTickKey === day + "-" + String(hour).padStart(2, "0") + ":" + String(windowStart).padStart(2, "0") + "-" + action)) {
    await staggeredCollectTick(day, hour, minute);
    return;
  }
  if (action.startsWith("blogger_") && !bloggerLaneActive()) return;
  if (action.startsWith("russian_ai_") && channelUnifiedSlots()) return;
  if (action.startsWith("russian_ai_") && !(state.sources || []).some(function(source){ return source && source.enabled && isRussianAISource(source); })) return;
  if (action.startsWith("money_emergency_") && editorialChannelId() !== "money") return;

  state.dynamicScheduler = state.dynamicScheduler || {};
  const key = day + "-" + String(hour).padStart(2, "0") + ":" + String(windowStart).padStart(2, "0") + "-" + action;
  if (state.dynamicScheduler.lastTickKey === key) return;

  // Do not persist the tick as completed before the work succeeds.
  // A deploy/restart in the middle of the slot must be able to retry it.
  state.dynamicScheduler.lastAttemptedTickKey = key;
  state.dynamicScheduler.lastAttemptedTickAt = new Date().toISOString();

  try {
    const work = action === "prepare"
      ? prepareDynamicSlot()
      : action === "publish"
        ? publishDynamicSlot()
        : action === "blogger_prepare"
          ? prepareBloggerSlot(bloggerTime)
          : action === "blogger_publish"
            ? publishDynamicSlot("blogger", bloggerTime)
            : action === "russian_ai_prepare"
              ? prepareRussianAiSlot(russianAiTime)
              : action === "russian_ai_publish"
                ? publishDynamicSlot("russian-ai")
                : action === "money_emergency_prepare"
                  ? prepareMoneyEmergencySlot()
                  : publishDynamicSlot("money-emergency");
    // A preparation step that never settles must not hold this channel's scheduler lock forever (and with it every
    // later slot). Publishing is not cut off: a cut-off publish could still go out later and double the post.
    const result = !/prepare$/.test(action) ? await work : await withDeadline(work, SCHEDULER_PREPARE_TIMEOUT_MS, "scheduler " + action).catch(function(error) {
      if (error && error.code === "DEADLINE") {
        console.error("SCHEDULER_TICK_TIMEOUT " + JSON.stringify({ workspace: currentWorkspaceId(), action: action, slot: key, collector: collectorRunInfo(currentWorkspaceId()) }));
      }
      throw error;
    });
    state.dynamicScheduler.lastTickKey = key;
    state.dynamicScheduler.lastTickCompletedAt = new Date().toISOString();
    saveState();
    console.log("Dynamic scheduler " + action + " " + currentWorkspaceId() + ":", JSON.stringify(result));
  } catch (error) {
    // Leave lastTickKey untouched: the next 30-second tick can retry inside the window.
    console.error("Dynamic scheduler " + action + " " + currentWorkspaceId() + " failed:", error.message);
  }
}

const catchupLogState = new Map();
async function catchUpCurrentRegularSlotAllWorkspaces() {
  const now = new Date();
  const nowMinutes = moscowMinutes(now);
  const hour = Math.floor(nowMinutes / 60);
  const minute = nowMinutes % 60;
  // Give a slow collector/checker up to 44 minutes to recover the hourly post.
  // 20:45 is already the preparation window for 21:00, so stop before it.
  if (hour < DYNAMIC_SLOT_START_HOUR || hour > DYNAMIC_SLOT_END_HOUR || minute > 44) return;
  // (per channel below: not before its own publish minute)

  const day = moscowDateKey(now);
  const time = String(hour).padStart(2, "0") + ":00";
  const slotKey = day + " " + time;

  await Promise.all(workspaceStore.workspaces.map(async function(ws) {
    if (!ws || schedulerTickRunning.has(ws.id)) return;
    // the catch-up must not post a channel before its own spread-out minute (it still recovers up to :44 as before)
    if (minute < publishMinuteFor(ws.id)) return;
    if (!isChannelSlotHour(hour, ws)) return; // this channel has no post this hour
    schedulerTickRunning.add(ws.id);
    try {
      await workspaceContext.run({ workspaceId: ws.id }, async function() {
        state.dynamicScheduler = state.dynamicScheduler || {};
        if (slotHasSuccessfulPublication(slotKey)) {
          state.dynamicScheduler.lastPublishedSlot = slotKey;
          return;
        }
        if (state.mode !== "AUTO" || !AUTO_PUBLISH_ENABLED) return;

        const schedule = ensureScheduleShape(state);
        if (schedule.suppressed[day] && schedule.suppressed[day][time]) return;
        const assignment = schedule.assignments[day] && schedule.assignments[day][time] || "";

        // An empty channel retries every 30 s for up to 44 minutes; log the start once and a result only when it
        // changes, otherwise ~170 identical lines per hour crowd out real events (Railway drops log bursts).
        const logKey = ws.id + "|" + slotKey;
        const firstTry = !catchupLogState.has(logKey);
        if (firstTry) console.warn("SCHEDULER_CATCHUP_START " + JSON.stringify({ workspace: ws.id, slot: time, queueId: assignment, minute: minute }));
        const result = await publishDynamicSlot();
        const summary = JSON.stringify(result || null);
        if (firstTry || catchupLogState.get(logKey) !== summary) console.log("SCHEDULER_CATCHUP_RESULT " + JSON.stringify({ workspace: ws.id, slot: time, result: result }));
        catchupLogState.set(logKey, summary);
        if (catchupLogState.size > 500) catchupLogState.delete(catchupLogState.keys().next().value);
      });
    } catch (error) {
      console.error("SCHEDULER_CATCHUP_FAILED " + JSON.stringify({ workspace: ws.id, slot: time, error: error.message }));
    } finally {
      schedulerTickRunning.delete(ws.id);
    }
  }));
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
    releaseStuckCollectors();
    dynamicSchedulerTickAllWorkspaces()
      .then(function(){ return catchUpCurrentRegularSlotAllWorkspaces(); })
      .catch(function(error){ console.error("Dynamic scheduler tick failed:", error.message); });
  }, 30000);
  dynamicSchedulerTickAllWorkspaces()
    .then(function(){ return catchUpCurrentRegularSlotAllWorkspaces(); })
    .catch(function(error){ console.error("Dynamic scheduler startup failed:", error.message); });
  console.log("Dynamic scheduler: regular hourly + restart catch-up + autoblogger slots + Russian AI slots 09:30/11:30/13:30/16:30/19:30/22:30 Moscow");
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
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": ADMIN_CSP });
    res.end(body);
  } catch {
    sendJson(res, 500, { ok: false, error: "UI file missing" });
  }
}

function redirect(res, location) {
  res.writeHead(302, { location: location });
  res.end();
}

const readJson = readJsonBody;

class BadRequestError extends Error {
  constructor(message) { super(message); this.name = "BadRequestError"; this.statusCode = 400; }
}

// JSON body that must be an object: null / arrays / scalars / malformed JSON answer 400 instead of crashing into a 500.
async function readJsonObject(req, maxBytes) {
  let body;
  try { body = await readJson(req, maxBytes); }
  catch (error) {
    if (error instanceof SyntaxError) throw new BadRequestError("invalid JSON");
    if (/request too large/.test(String(error && error.message))) { const e = new BadRequestError("request too large"); e.statusCode = 413; throw e; }
    throw error;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequestError("JSON object expected");
  return body;
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
    const rawValue = trimmed.slice(i + 1);
    try { out[trimmed.slice(0, i)] = decodeURIComponent(rawValue); } catch { out[trimmed.slice(0, i)] = rawValue; }
  });
  return out;
}

// Session epoch lives next to the other state on the persistent volume. Epoch 0 (nothing stored) keeps the
// legacy token so cookies issued before this feature stay valid; "logout everywhere" bumps it.
let sessionEpochStore = null;
function getSessionEpochStore() {
  if (!sessionEpochStore) sessionEpochStore = createSessionEpochStore(path.join(DATA_DIR, "session-epoch.json"));
  return sessionEpochStore;
}

function sessionToken() {
  return sessionTokenFor(ADMIN_KEY, getSessionEpochStore().get());
}

function isAuthed(req) {
  const provided = parseCookies(req).nf_session;
  return typeof provided === "string" && provided.length > 0 && safeEqual(provided, sessionToken());
}

function requestClientIp(req) {
  return proxyClientIp(req, TRUSTED_PROXY_HOPS);
}

// x-admin-key check for the machine endpoints: constant-time, and failures count towards the per-IP lockout.
// Returns true when authorised; otherwise has already answered 401/429 and returns false.
function requireAdminKey(req, res) {
  const ip = requestClientIp(req);
  const gate = authFailureLimiter.check(ip);
  if (!gate.allowed) {
    sendJson(res, 429, { ok: false, error: "too many attempts" }, { "retry-after": String(gate.retryAfterSec), "cache-control": "no-store" });
    return false;
  }
  if (!safeEqual(req.headers["x-admin-key"], ADMIN_KEY)) {
    authFailureLimiter.fail(ip);
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return false;
  }
  authFailureLimiter.success(ip);
  return true;
}

function requireAuth(req, res) {
  if (!isAuthed(req)) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return false;
  }
  return true;
}


// Telegram counts VISIBLE characters (tags and link URLs are free); see lib/telegram-caption.js.
// The body is shortened, legal marks / hashtags / signature are always kept.
function telegramCaptionFits(html) { return visibleLength(html) <= TELEGRAM_CAPTION_HARD_LIMIT; }

function trimPostToCaptionLimit(post, limit) {
  return trimPostPreservingTail(post, limit || CAPTION_VISIBLE_LIMIT, formatTelegramPost);
}

async function preparePostForSingleTelegramCaption(post) {
  const original = Object.assign({}, post);
  const channelName = String(currentWorkspace().name || "News Factory");
  if (visibleLength(formatTelegramPost(original)) <= CAPTION_VISIBLE_LIMIT) return original;

  if (OPENAI_API_KEY) {
    const prompt = [
      "Сожми готовый новостной пост канала «" + channelName + "» так, чтобы он целиком поместился в подпись к одному фото/видео Telegram.",
      "Сохрани только факты из исходного готового поста. Ничего не добавляй и не меняй цифры, имена, компании, даты и смысл.",
      "Заголовок до 90 знаков. Текст 430–620 знаков. 3–5 коротких абзацев.",
      "Обязательно сохрани дословно: юридические пометки в скобках (иноагент, запрещённая организация), строку с хэштегами и подпись канала (@имя) в самом конце, строку «👉 Больше про…», если она есть.",
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
        const response = await llmResponsesFetch("https://api.openai.com/v1/responses", {
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
        // The rewrite runs after the fact-check: never accept one that lost legal marks,
        // hashtags or the signature; fall back to the deterministic trim of the checked text.
        const lost = missingProtected(original.text, compact.text);
        if (lost.length) {
          console.warn("TELEGRAM_CAPTION_COMPACT_REJECTED " + JSON.stringify({ lost: lost.slice(0, 5) }));
          break;
        }
        if (compact.text && visibleLength(formatTelegramPost(compact)) <= CAPTION_VISIBLE_LIMIT) return compact;
        return trimPostToCaptionLimit(compact, CAPTION_VISIBLE_LIMIT);
      } catch (error) {
        console.warn("Telegram caption compact failed:", error.message);
      }
    }
  }

  return trimPostToCaptionLimit(original, CAPTION_VISIBLE_LIMIT);
}

function normalizePublishTargets(value) {
  const requested = value && typeof value === "object" ? value : {};
  const hasExplicit = Object.prototype.hasOwnProperty.call(requested, "telegram") || Object.prototype.hasOwnProperty.call(requested, "vk");
  return {
    telegram: hasExplicit ? requested.telegram !== false : true,
    vk: (hasExplicit ? requested.vk === true : true) && workspaceVkPublishingAllowed(currentWorkspace())
  };
}


async function ensureTelegramPublishTarget(workspace, repair) {
  const ws = workspace || currentWorkspace();
  if (!ws) throw new Error("Telegram workspace is missing");
  const configured = String(ws.telegramChannel || "").trim();
  if (!configured) throw new Error("Telegram channel is not configured for this account");

  let chat = await telegramApi("getChat", { chat_id: configured });
  let repaired = false;

  // If the configured username points to a discussion group, follow its linked
  // broadcast channel instead of silently publishing into the wrong chat.
  if (chat && chat.type !== "channel" && chat.linked_chat_id != null) {
    try {
      const linked = await telegramApi("getChat", { chat_id: chat.linked_chat_id });
      if (linked && linked.type === "channel") {
        chat = linked;
        if (repair) {
          ws.telegramChannel = linked.username ? ("@" + linked.username) : String(linked.id);
          if (linked.username) {
            ws.telegramPublicUsername = String(linked.username).replace(/^@/, "");
            ws.slug = ws.telegramPublicUsername;
          }
          ws.updatedAt = new Date().toISOString();
          persistWorkspaceStore();
          repaired = true;
        }
      }
    } catch {}
  }

  if (!chat || chat.type !== "channel") {
    throw new Error("Telegram цель не является каналом: " + String(chat && chat.type || "unknown"));
  }

  const actualUsername = String(chat.username || "").replace(/^@/, "").toLowerCase();
  const expectedUsername = String(ws.telegramPublicUsername || ws.slug || "").replace(/^@/, "").toLowerCase();

  if (repair && actualUsername && expectedUsername !== actualUsername) {
    ws.telegramPublicUsername = actualUsername;
    ws.slug = actualUsername;
    ws.telegramChannel = "@" + actualUsername;
    ws.updatedAt = new Date().toISOString();
    persistWorkspaceStore();
    repaired = true;
  }

  return {
    chat: chat,
    chatId: chat.id,
    username: actualUsername,
    title: String(chat.title || ""),
    repaired: repaired
  };
}


// A cover for a post whose media Telegram refused. At most one paid generation per post:
// a cover created by an earlier attempt (or by the media director) is reused.
async function telegramCoverFallback(post, failingUrl, idPrefix) {
  const existing = String(post.generatedImageUrl || "").trim();
  if (existing && existing !== String(failingUrl || "").trim() && isLocalMediaUrl(existing)) return { url: existing, reused: true };
  const cover = await generateNewsCover({
    id: post.id || newId(idPrefix),
    title: post.title || currentWorkspace().name || "News Factory",
    text: post.text || "",
    sourceName: post.sourceName || "Telegram fallback"
  });
  post.generatedImageUrl = cover.url;
  return cover;
}

async function sendTelegramPost(post) {
  const target = await ensureTelegramPublishTarget(currentWorkspace(), true);
  const telegramChannel = target.chatId;
  const html = formatTelegramPost(post);
  const mediaPackUrls = Array.from(new Set((Array.isArray(post.mediaPackUrls) ? post.mediaPackUrls : [])
    .map(function(url){ return String(url || "").trim(); })
    .filter(function(url){ return /^https?:\/\//i.test(url); }))).slice(0, 10);
  let imageUrl = String(post.imageUrl || post.generatedImageUrl || mediaPackUrls[0] || "").trim();
  const rawVideoUrl = String(post.videoUrl || "").trim();
  const videoUrl = isUsableNewsVideoUrl(rawVideoUrl) ? rawVideoUrl : "";
  if (rawVideoUrl && !videoUrl) {
    console.warn("TELEGRAM_VIDEO_SKIPPED " + JSON.stringify({ post_id: String(post.id || post.postId || "unknown"), url: rawVideoUrl.slice(0, 200), reason: "not a playable news video (webm / logo / decorative loop)" }));
    if (!String(post.imageUrl || post.generatedImageUrl || "").trim() && !mediaPackUrls.length && GENERATE_COVER_IF_MISSING) {
      const cover = await generateNewsCover({
        id: post.id || newId("video_skipped"),
        title: post.title || currentWorkspace().name || "News Factory",
        text: post.text || "",
        sourceName: post.sourceName || "Telegram"
      });
      post.generatedImageUrl = cover.url;
    }
  }

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
        return assertTelegramPublishResult(first, target);
      }
    } catch (error) {
      console.warn("sendMediaGroup failed, falling back to one image:", error.message);
      if (isTelegramFatalError(error)) throw error;
      imageUrl = mediaPackUrls[0] || imageUrl;
    }
  }

  if (MEDIA_REQUIRED && !imageUrl && !videoUrl) {
    throw new Error("Публикация запрещена: у новости нет фото или видео");
  }

  if (videoUrl) {
    try {
      return assertTelegramPublishResult(await telegramMediaApi("sendVideo", {
        chat_id: telegramChannel,
        caption: telegramCaptionFits(html) ? html : (post.title ? "<b>" + escapeTelegramHtml(post.title) + "</b>" : undefined),
        parse_mode: "HTML",
        supports_streaming: true
      }, "video", videoUrl, "video"), target);
    } catch (error) {
      console.warn("sendVideo failed:", error.message);
      if (isTelegramFatalError(error)) throw error;
      if (!imageUrl && GENERATE_COVER_IF_MISSING) {
        try {
          await telegramCoverFallback(post, "", "video_fallback");
        } catch (fallbackError) {
          throw new Error("Видео недоступно, а резервное фото не удалось подготовить: " + fallbackError.message);
        }
      } else if (!imageUrl) {
        throw error;
      }
    }
  }

  imageUrl = String(post.imageUrl || post.generatedImageUrl || imageUrl || "").trim();

  if (imageUrl && telegramCaptionFits(html)) {
    try {
      return assertTelegramPublishResult(await telegramMediaApi("sendPhoto", {
        chat_id: telegramChannel,
        caption: html,
        parse_mode: "HTML"
      }, "photo", imageUrl, "image"), target);
    } catch (error) {
      console.warn("sendPhoto failed:", error.message);
      // Chat rejected us / rate limit / bad markup: a new cover cannot fix it, do not pay for one.
      if (isTelegramFatalError(error) || error.telegramParseError) throw error;
      if (GENERATE_COVER_IF_MISSING) {
        try {
          const generatedFallback = await telegramCoverFallback(post, imageUrl, "telegram_photo_fallback");
          imageUrl = generatedFallback.url;
          return assertTelegramPublishResult(await telegramMediaApi("sendPhoto", {
            chat_id: telegramChannel,
            caption: html,
            parse_mode: "HTML"
          }, "photo", imageUrl, "image"), target);
        } catch (fallbackError) {
          console.warn("Telegram generated photo fallback failed:", fallbackError.message);
          // "maybe sent" / chat-level errors end here: the code below would send the same cover again
          if (MEDIA_REQUIRED || isTelegramFatalError(fallbackError)) throw fallbackError;
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
      if (!GENERATE_COVER_IF_MISSING || isTelegramFatalError(error) || error.telegramParseError) throw error;
      const generatedFallback = await telegramCoverFallback(post, imageUrl, "telegram_photo_fallback");
      imageUrl = generatedFallback.url;
      photo = await telegramMediaApi("sendPhoto", {
        chat_id: telegramChannel,
        caption: post.title ? "<b>" + escapeTelegramHtml(post.title) + "</b>" : undefined,
        parse_mode: "HTML"
      }, "photo", imageUrl, "image");
    }
    if (html && !telegramCaptionFits(html)) {
      try {
        await telegramApi("sendMessage", {
          chat_id: telegramChannel,
          text: html,
          parse_mode: "HTML",
          disable_web_page_preview: true
        });
      } catch (textError) {
        // The photo is already in the channel: failing the whole post here made the slot / repair loop send the
        // photo again (up to 4 photos for one post). Keep it as published, report the missing text.
        console.warn("TELEGRAM_TEXT_AFTER_PHOTO_FAILED " + JSON.stringify({ post_id: String(post.id || post.postId || ""), message_id: photo && photo.message_id, error: String(textError && textError.message || textError).slice(0, 200) }));
        if (photo && typeof photo === "object") photo.textAfterPhotoFailed = true;
      }
    }
    return assertTelegramPublishResult(photo, target);
  }

  throw new Error("Публикация запрещена: медиа не подготовлено");
}

async function sendTelegram(text) {
  const target = await ensureTelegramPublishTarget(currentWorkspace(), true);
  const result = await telegramApi("sendMessage", {
    chat_id: target.chatId,
    text: String(text || ""),
    disable_web_page_preview: true
  });
  return assertTelegramPublishResult(result, target);
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
  return String(provided || "").length > 0 && String(expected || "").length > 0 && safeEqual(provided, expected);
}

// Who may start / capture a VK OAuth session: a logged-in admin cookie, the handoff secret, or the admin key.
// The VK callback itself cannot carry our SameSite=Strict cookie (cross-site redirect), so it is protected by
// the one-time random state that only an authorised start call ever hands out.
function vkOAuthCallerAuthorized(req) {
  if (isAuthed(req)) return true;
  if (VK_OAUTH_HANDOFF_SECRET && secretMatches(req.headers["x-oauth-handoff-secret"], VK_OAUTH_HANDOFF_SECRET)) return true;
  return safeEqual(req.headers["x-admin-key"], ADMIN_KEY);
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


function formatVkPost(post, options) {
  const opts = options || {};
  const title = String(post.title || "").trim();
  let text = String(post.text || "").trim();
  text = text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/^>\s?/gm, "▌ ")
    .replace(/\n{3,}/g, "\n\n");
  const ws = currentWorkspace();
  const handle = ws ? (telegramUsernameOrEmpty(ws.telegramPublicUsername) || telegramUsernameOrEmpty(ws.slug)) : "";
  text = adaptVkBody(text, { handle: handle });
  let out = "";
  if (title) out += title;
  if (text) out += (out ? "\n\n" : "") + text;
  const sources = opts.includeSource !== false ? normalizePublicPostSources(post).slice(0, 5) : [];
  const tail = vkTail({ handle: handle, sources: sources });
  if (tail) out += (out ? "\n\n" : "") + tail;
  return out.trim();
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

// VK is optional and often off. A post that already went to Telegram must never occupy a slot again just
// because VK failed: VK gets a bounded number of automatic retries, then the post leaves the queue.
// One VK attempt per post by default: when VK fails, the NEXT post goes to VK in the next slot instead of a slot spent
// re-sending the old one to VK only.
const VK_AUTO_RETRY_MAX = Math.max(1, Number(process.env.VK_AUTO_RETRY_MAX || 1));
// A post that failed to publish waits this long before it may be tried again (the slot moves on to the next post).
const PUBLISH_RETRY_COOLDOWN_MIN = Math.max(1, Math.min(24 * 60, Number(process.env.PUBLISH_RETRY_COOLDOWN_MIN || 30) || 30));
// How many queue posts one slot tries, one after another, until one is published.
const SLOT_PUBLISH_TRIES = Math.max(1, Math.min(10, Number(process.env.SLOT_PUBLISH_TRIES || 5) || 5));
const PUBLISH_FAILURE_MAX = Math.max(1, Number(process.env.PUBLISH_FAILURE_MAX || 3));
function pendingAutoTargets(item) {
  const t = autoPublishTargetsForPost(item);
  return {
    telegram: t.telegram && item.telegramPublished !== true,
    vk: t.vk && item.vkPublished !== true && Number(item.vkAttempts || 0) < VK_AUTO_RETRY_MAX
  };
}

// In-memory guard against publishing the same post twice at once (double click, retry, scheduler + manual).
// It is taken BEFORE the first await and released in finally.
const publishLocks = new Set();
function acquirePublishLock(postId) {
  const key = currentWorkspaceId() + ":" + String(postId || "");
  if (publishLocks.has(key)) return null;
  publishLocks.add(key);
  return function release() { publishLocks.delete(key); };
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

  // Our own cached media is read from disk (no self-HTTP round trip, no SSRF surface).
  const localVkPath = localMediaPathFromUrl(sourceUrl);
  if (localVkPath) {
    let localBytes = null;
    try { localBytes = fs.readFileSync(localVkPath); } catch {}
    if (localBytes && localBytes.length) {
      const localExt = path.extname(localVkPath).replace(/^\./, "").toLowerCase();
      const localMime = localExt === "png" ? "image/png" : localExt === "webp" ? "image/webp" : "image/jpeg";
      return { bytes: localBytes, mime: localMime, ext: localExt === "png" ? "png" : localExt === "webp" ? "webp" : "jpg" };
    }
  }

  let response;
  try {
    response = await safeFetch(sourceUrl, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; NewsFactoryVK/1.0)" },
      timeoutMs: 30000,
      maxBytes: 20 * 1024 * 1024
    });
  } catch (error) {
    logVkError("image.download", "network", error && error.message || error, context);
    throw createVkError("image.download", "network", error && error.message || error, context);
  }

  if (!response.ok) {
    logVkError("image.download", response.status, "Image HTTP " + response.status, context);
    throw createVkError("image.download", response.status, "Image HTTP " + response.status, context);
  }

  const bytes = response.body;
  if (!bytes.length) {
    logVkError("image.download", "empty", "Downloaded image is empty", context);
    throw createVkError("image.download", "empty", "Downloaded image is empty", context);
  }
  try {
    await assertSafeRaster(bytes);
  } catch (error) {
    logVkError("image.download", "not_raster", error && error.message || error, context);
    throw createVkError("image.download", "not_raster", error && error.message || error, context);
  }

  const mime = String(response.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  return { bytes: bytes, mime: mime, ext: ext };
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

let postmypostClientInstance = null;
let postmypostTargetCache = null;
function postmypostClient() {
  if (!postmypostClientInstance) postmypostClientInstance = createPostmypostClient({ token: POSTMYPOST_TOKEN, pollMs: Math.max(10, Number(process.env.POSTMYPOST_POLL_MS || 2000) || 2000) });
  return postmypostClientInstance;
}
async function postmypostTarget() {
  if (postmypostTargetCache && Date.now() - postmypostTargetCache.at < 6 * 3600000) return postmypostTargetCache.target;
  const target = await resolvePostmypostTarget(postmypostClient(), {
    projectId: process.env.POSTMYPOST_PROJECT_ID || "", accountId: process.env.POSTMYPOST_ACCOUNT_ID || ""
  }, VK_GROUP_ID);
  postmypostTargetCache = { at: Date.now(), target: target };
  return target;
}
// Which Postmypost VK community belongs to which channel. Refreshed at boot and every 30 minutes; kept on errors.
let postmypostMap = { at: 0, byWorkspace: {}, unmatchedAccounts: [], problems: [], error: "" };
function postmypostExplicitMap() {
  let map = {};
  try {
    const parsed = JSON.parse(process.env.POSTMYPOST_ACCOUNT_MAP || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) map = parsed;
    else throw new Error("not an object");
  } catch (error) {
    if (!postmypostExplicitMap.warned) { postmypostExplicitMap.warned = true; console.warn("POSTMYPOST_ACCOUNT_MAP_INVALID " + JSON.stringify({ error: String(error && error.message || error).slice(0, 120), hint: '{"workspace_id": account_id}' })); }
  }
  if (process.env.POSTMYPOST_ACCOUNT_ID && !map[workspaceStore.defaultWorkspaceId]) map[workspaceStore.defaultWorkspaceId] = process.env.POSTMYPOST_ACCOUNT_ID;
  return map;
}
// A channel whose VK community has just been found gets VK auto-publishing switched on ONCE (remembered by account id),
// so turning VK off in the admin later is respected.
function enableVkForMappedChannels() {
  const enabled = [];
  for (const ws of workspaceStore.workspaces) {
    const entry = postmypostMap.byWorkspace[ws.id];
    if (!entry || ws.id === workspaceStore.defaultWorkspaceId) continue;
    workspaceContext.run({ workspaceId: ws.id }, function() {
      // Once per channel, ever: a re-connected community (new account id) or a map change never re-enables VK
      // that the owner turned off. Only the account id is kept up to date.
      if (state.vkPostmypostEnabledAt) {
        if (Number(state.vkPostmypostAccountId || 0) !== Number(entry.accountId)) { state.vkPostmypostAccountId = Number(entry.accountId); saveState(); }
        return;
      }
      state.topicSettings = state.topicSettings || {};
      state.topicSettings.default = Object.assign({}, state.topicSettings.default || {}, { auto_publish_vk: true });
      state.vkPostmypostAccountId = Number(entry.accountId);
      state.vkPostmypostEnabledAt = new Date().toISOString();
      saveState();
      enabled.push(ws.id);
      console.log("VK_POSTMYPOST_CHANNEL_ENABLED " + JSON.stringify({ workspace: ws.id, channel: ws.name, account: entry.accountId, account_name: entry.accountName, how: entry.how }));
    });
  }
  return enabled;
}
async function refreshPostmypostMap(reason) {
  if (!VK_VIA_POSTMYPOST) return null;
  try {
    const accounts = await listPostmypostAccounts(postmypostClient(), process.env.POSTMYPOST_PROJECT_ID || "");
    const matched = matchWorkspacesToAccounts(
      workspaceStore.workspaces.map(function(ws){ return { id: ws.id, name: ws.name }; }),
      accounts,
      { defaultWorkspaceId: workspaceStore.defaultWorkspaceId, vkGroupId: VK_GROUP_ID, explicit: postmypostExplicitMap() }
    );
    postmypostMap = Object.assign({ at: Date.now(), error: "" }, matched);
    const enabled = enableVkForMappedChannels();
    const info = {
      ok: true, reason: reason || "", enabled: VK_VIA_POSTMYPOST,
      channels: workspaceStore.workspaces.map(function(ws){ const e = matched.byWorkspace[ws.id]; return e ? { workspace: ws.id, account: e.accountId, name: e.accountName, how: e.how } : null; }).filter(Boolean),
      withoutVk: workspaceStore.workspaces.filter(function(ws){ return !matched.byWorkspace[ws.id]; }).map(function(ws){ return ws.name; }),
      unmatchedAccounts: matched.unmatchedAccounts.slice(0, 20),
      problems: matched.problems.slice(0, 20),
      newlyEnabled: enabled
    };
    const def = matched.byWorkspace[workspaceStore.defaultWorkspaceId];
    if (def) { info.projectId = def.projectId; info.accountId = def.accountId; info.account = def.accountName; }
    console.log("POSTMYPOST_STATUS " + JSON.stringify(info));
    return info;
  } catch (error) {
    postmypostMap = Object.assign({}, postmypostMap, { at: Date.now(), error: String(error && error.message || error).slice(0, 300) });
    const info = { ok: false, reason: reason || "", enabled: VK_VIA_POSTMYPOST, error: postmypostMap.error, keptChannels: Object.keys(postmypostMap.byWorkspace).length };
    console.warn("POSTMYPOST_STATUS " + JSON.stringify(info));
    return info;
  }
}
function logPostmypostStatus() { return refreshPostmypostMap("boot"); }
// The Postmypost target of the current channel: from the channel map; the main cabinet also falls back to VK_GROUP_ID.
async function postmypostTargetForCurrent() {
  const wsId = currentWorkspaceId();
  if (!postmypostMap.byWorkspace[wsId] && Date.now() - Number(postmypostMap.at || 0) > 5 * 60000) await refreshPostmypostMap("publish");
  const entry = postmypostMap.byWorkspace[wsId];
  if (entry) return { projectId: entry.projectId, accountId: entry.accountId, accountName: entry.accountName };
  // No guessing (not even "the only connected community"): without its own pairing a channel does not use Postmypost.
  throw Object.assign(new Error("Для этого канала не найдена VK-группа в Postmypost"), { pmpCode: "target_not_found" });
}

async function publishVkPost(post) {
  if (!VK_PUBLISH_ENABLED) return null;
  const baseContext = vkPostContext(post);
  // VK posts go ONLY through Postmypost (photo included). The old direct community-token route, which could only post
  // text with an invisible photo, is gone.
  const isMain = currentWorkspaceId() === workspaceStore.defaultWorkspaceId;
  if (!VK_VIA_POSTMYPOST || (!isMain && !postmypostMap.byWorkspace[currentWorkspaceId()])) {
    const error = createVkError("wall.post", "config_missing", VK_VIA_POSTMYPOST ? "VK для этого канала не подключён (нет VK-группы в Postmypost)" : "VK публикуется только через Postmypost: POSTMYPOST_TOKEN не задан", baseContext);
    logVkError("wall.post", error.vkErrorCode, error.vkErrorMsg, Object.assign({}, baseContext, { tokenKind: "postmypost" }));
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
  let attempts = 0;

  // A network error on wall.post itself is ambiguous (the post may already exist): never fall through to another
  // mode and risk a duplicate.
  const ambiguous = async function(error) {
    const code = error && error.vkErrorCode;
    // network / VK "internal server error" (10) / HTTP 5xx: VK may have created the post anyway.
    const unclear = code === "network" || Number(code) === 10 || (Number(code) >= 500 && Number(code) < 600);
    if (!(error && error.vkMethod === "wall.post" && unclear)) return false;
    error.mediaFailed = true;
    error.vkAmbiguous = true;
    error.mediaAttempts = attempts || 1;
    error.previewSlug = preview.slug;
    await markPublicPostVkFailed(preview.slug, error);
    await notifyVkMediaFailure(post, error, error.mediaAttempts);
    throw error;
  };
  // Runs AFTER VK created the post: nothing here may throw, or the caller would try another mode = a second post.
  const published = async function(result, mode, extraLog) {
    const numericVkId = result && /^\d+$/.test(String(result.post_id)) ? result.post_id : null;
    try { await markPublicPostPublished(preview.slug, numericVkId); }
    catch (error) { console.warn("VK_PREVIEW_MARK_FAILED " + JSON.stringify({ slug: preview.slug, post_id: result && result.post_id || null, error: String(error && error.message || error).slice(0, 200) })); }
    if (result && typeof result === "object") {
      result.mediaMode = mode;
      result.mediaAttempts = attempts;
      result.previewSlug = preview.slug;
      result.previewUrl = preview.url;
      result.previewImageUrl = preview.imageUrl;
      console.log("VK_POST_PUBLISHED " + JSON.stringify(Object.assign({ post_id: result.post_id || null, slug: preview.slug, media_mode: mode }, extraLog || {})));
    }
    return result || null;
  };

  // Postmypost: the only route where readers SEE the photo. Its failure before the post exists falls back to direct VK.
  async function tryPostmypost() {
    const pmp = postmypostClient();
    const target = await postmypostTargetForCurrent();
    const pmpContext = { post_id: context.postId, slug: preview.slug, project: target.projectId, account: target.accountId };
    attempts += 1;
    // Push the picture as a file (Postmypost cannot download from our Railway domain); by URL only as a last resort.
    let fileId;
    const localPath = localMediaPathFromUrl(preview.imageUrl);
    if (localPath && fs.existsSync(localPath)) {
      fileId = await pmp.uploadFile(target.projectId, fs.readFileSync(localPath), path.basename(localPath), "image/jpeg", 90000);
    } else {
      fileId = await pmp.uploadByUrl(target.projectId, preview.imageUrl, 90000);
    }
    let created;
    try {
      created = await pmp.createPublication({
        projectId: target.projectId, accountId: target.accountId, content: baseMessage, fileIds: [fileId],
        postAt: new Date(Date.now() + 15000).toISOString()
      });
    } catch (error) {
      // Network / 5xx: Postmypost may have created the publication anyway -> stop, never post a second copy.
      if (error && (error.pmpCode === "network" || Number(error.pmpStatus) >= 500)) {
        const err = createVkError("postmypost.publication", "network", String(error.message || error), context);
        err.vkMethod = "wall.post"; err.vkErrorCode = "network";
        await ambiguous(err);
      }
      throw error;
    }
    const pubId = created && created.id;
    if (!pubId) {
      // 2xx without an id: the publication may exist -> stop, never post a second copy.
      const err = createVkError("postmypost.publication", "network", "Postmypost не вернул id публикации", context);
      err.vkMethod = "wall.post"; err.vkErrorCode = "network";
      await ambiguous(err);
    }
    let waited;
    try {
      waited = await pmp.waitPublished(pubId, Math.max(100, Number(process.env.POSTMYPOST_WAIT_MS || 120000) || 120000));
    } catch (error) {
      // The publication exists; only the status check failed. Treat it as sent: a retry would post a duplicate.
      console.warn("VK_POSTMYPOST_STATUS_UNKNOWN " + JSON.stringify(Object.assign({}, pmpContext, { publication_id: pubId, error: String(error && error.message || error).slice(0, 200) })));
      waited = { status: PMP_STATUS.PENDING, timedOut: true };
    }
    if (waited.status === PMP_STATUS.ERROR || waited.status === PMP_STATUS.DELETED) {
      // The publication exists in Postmypost but VK refused it: the post is not on the wall, direct VK may try.
      throw Object.assign(new Error("Postmypost: публикация " + pubId + " завершилась ошибкой (статус " + waited.status + ")"), { pmpCode: "publication_error", pmpPublicationId: pubId });
    }
    const mode = waited.status === PMP_STATUS.PUBLISHED ? "postmypost" : "postmypost_pending";
    if (mode === "postmypost_pending") {
      // Not confirmed yet: remember it, the reconcile timer re-checks it and alerts if it never goes out.
      try { pmpRecordPending(state, { id: pubId, slug: preview.slug, postId: context.postId, status: waited.status }, Date.now()); saveState(); } catch {}
    }
    console.log("VK_POSTMYPOST_RESULT " + JSON.stringify(Object.assign({}, pmpContext, { publication_id: pubId, file_id: fileId, status: waited.status, timed_out: Boolean(waited.timedOut) })));
    return published({ post_id: "pmp-" + pubId }, mode, { pmp_publication_id: pubId });
  }

  try {
    return await tryPostmypost();
  } catch (error) {
    if (error && error.vkAmbiguous) throw error;
    postmypostTargetCache = null;
    console.warn("VK_POSTMYPOST_FAILED " + JSON.stringify({ post_id: context.postId, slug: preview.slug, code: error && (error.pmpCode != null ? error.pmpCode : error.vkErrorCode) || null, error: String(error && error.message || error).slice(0, 400) }));
    // No other VK route: the VK side of this post fails, Telegram is not affected.
    const failed = createVkError("postmypost", error && error.pmpCode != null ? error.pmpCode : "failed", String(error && error.message || error).slice(0, 400), context);
    failed.mediaFailed = true;
    failed.mediaAttempts = attempts || 1;
    failed.previewSlug = preview.slug;
    await markPublicPostVkFailed(preview.slug, failed);
    throw failed;
  }
}

function postForPlatform(post, platform) {
  const out = Object.assign({}, post || {});
  if (editorialChannelId() === "shopping") out.hidePublicSources = true;
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
  // Permanent chat errors and rate limits are not media problems: repairing and re-sending only repeats them.
  if (isTelegramFatalError(error)) return false;
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
    telegramStatus: selected.telegram ? "pending" : "not_selected",
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

  const tgJob = selected.telegram
    ? sendTelegramPostWithRepair(telegramPrepared)
    : Promise.resolve(null);
  const vkJob = selected.vk
    ? ((!VK_PUBLISH_ENABLED || !workspaceVkPublishingAllowed(currentWorkspace()))
        ? Promise.reject(Object.assign(new Error("VK не настроен для публикации"), { vkErrorCode: "config_missing" }))
        : publishVkPostWithRepair(vkPrepared))
    : Promise.resolve(null);

  // Important: both networks get their own attempt. A Telegram failure cannot prevent
  // VK from posting, and a VK failure cannot roll back Telegram.
  const settled = await Promise.allSettled([tgJob, vkJob]);
  const tgSettled = settled[0];
  const vkSettled = settled[1];

  if (selected.telegram) {
    if (tgSettled.status === "fulfilled" && tgSettled.value) {
      const tgAttempt = tgSettled.value;
      const tg = tgAttempt.result;
      telegramPrepared = tgAttempt.post;
      result.message_id = tg.message_id;
      result.telegramPublished = true;
      result.telegramStatus = "published";
      result.repairLog.push.apply(result.repairLog, tgAttempt.repairLog || []);
      result.publishedText = telegramPrepared.text || result.publishedText;
      result.publishedTitle = telegramPrepared.title || result.publishedTitle;
      result.publishedTelegramText = telegramPrepared.text || "";
      result.publishedTelegramTitle = telegramPrepared.title || "";
    } else {
      const error = tgSettled.reason || new Error("Telegram publish failed");
      if (error && error.telegramAmbiguous) {
        // The request went out and no answer came back: Telegram usually publishes such a post. Counting it as
        // published (without a message id) keeps the slot from sending the same post — or another one — again.
        console.warn("TELEGRAM_UNCERTAIN " + JSON.stringify({ workspace: currentWorkspaceId(), post_id: String(post.postId || post.id || ""), error: String(error.message || error).slice(0, 200) }));
        result.telegramPublished = true;
        result.telegramStatus = "uncertain";
        result.telegramUncertain = true;
        result.telegramError = String(error.message || error);
      }
    }
    if (!result.telegramPublished && !(tgSettled.status === "fulfilled" && tgSettled.value)) {
      const error = tgSettled.reason || new Error("Telegram publish failed");
      result.telegramStatus = "failed";
      result.telegramError = String(error && error.message || error);
      result.telegramPermanent = Boolean(error && (error.permanent || error.telegramPermanent));
      result.telegramRateLimited = Boolean(error && error.telegramRateLimited);
      // No answer from Telegram at all (network/timeout): the message may have been delivered.
      result.telegramNetwork = Boolean(error && !error.telegram);
    }
  }

  if (selected.vk) {
    if (vkSettled.status === "fulfilled" && vkSettled.value) {
      const vkAttempt = vkSettled.value;
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
    } else {
      const error = vkSettled.reason || new Error("VK publish failed");
      if (error && error.vkAmbiguous) {
        // The publication may exist (Postmypost/VK did not answer after the create call): a retry would make a
        // second VK post. Counted as published without an id, flagged for a manual check.
        console.warn("VK_UNCERTAIN " + JSON.stringify({ workspace: currentWorkspaceId(), post_id: String(post.postId || post.id || ""), error: String(error.message || error).slice(0, 200) }));
        result.vkPublished = true;
        result.vkStatus = "uncertain";
        result.vkUncertain = true;
        result.vkError = String(error.vkErrorMsg || error.message || error);
      }
    }
    if (selected.vk && !result.vkPublished && !(vkSettled.status === "fulfilled" && vkSettled.value)) {
      const error = vkSettled.reason || new Error("VK publish failed");
      result.vkStatus = error && error.mediaFailed ? "media_failed" : "failed";
      result.vkMediaAttempts = Number(error && error.mediaAttempts || 0);
      result.vkErrorCode = error && error.vkErrorCode != null ? error.vkErrorCode : null;
      result.vkError = String(error && (error.vkErrorMsg || error.message) || error);
      result.vkPreviewSlug = String(error && error.previewSlug || "");
      result.vkPreviewUrl = result.vkPreviewSlug ? previewPageUrl(result.vkPreviewSlug) : "";
    }
  }

  // Preserve retry semantics only when neither network succeeded, but do it after
  // both autonomous jobs had their chance.
  if ((selected.telegram || selected.vk) && !result.telegramPublished && !result.vkPublished) {
    const error = new Error([
      result.telegramError ? "Telegram: " + result.telegramError : "",
      result.vkError ? "VK: " + result.vkError : ""
    ].filter(Boolean).join(" | ") || "Публикация не удалась ни в одной сети");
    error.permanent = Boolean(result.telegramPermanent && (!selected.vk || result.vkErrorCode === "config_missing"));
    error.partialResult = result;
    throw error;
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

let vkWallGetBlockedUntil = 0;
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
    // wall.get is closed to community tokens (error 27). Asked once a day instead of every hour; the subscriber
    // count above does not need it and keeps working.
    let wall = null;
    if (Date.now() >= vkWallGetBlockedUntil) {
      try {
        wall = await vkApi("wall.get", { owner_id: VK_OWNER_ID, count: 100, filter: "owner" }, { quietCodes: [27] });
      } catch (wallError) {
        if (String(wallError && wallError.vkErrorCode) !== "27") throw wallError;
        vkWallGetBlockedUntil = Date.now() + 24 * 3600 * 1000;
        console.log("VK_WALL_GET_UNAVAILABLE " + JSON.stringify({ error_code: 27, note: "community token cannot read the wall; post statistics skipped, retry in 24h" }));
      }
    }
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


let anthropicProbeCache = { at: 0, value: null };


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
  // The community token belongs to the main cabinet: other channels must not show its VK numbers as their own.
  const vk = workspaceVkDirectAllowed(currentWorkspace()) ? await fetchVkAnalytics() : {
    connected: false, available: false, platform: "vk",
    totals: { posts: 0, views: 0, likes: 0, comments: 0, reposts: 0, subscribers: null, avgViews: 0, engagementRate: 0 },
    posts: [], note: workspaceVkPublishingAllowed(currentWorkspace()) ? "Посты в VK идут через Postmypost; статистика VK для этого канала пока не собирается." : "VK для этого канала не подключён."
  };
  const value = {
    ok: true,
    generatedAt: new Date().toISOString(),
    telegram: telegram,
    vk: vk
  };
  analyticsCache.set(cacheKey, { at: now, value: value });
  return value;
}


async function fetchTelegramSubscriberCountLight(workspace) {
  const ws = workspace || currentWorkspace();
  const chatId = String(ws && ws.telegramChannel || "").trim();
  if (!chatId) return { available: false, subscribers: null, error: "Telegram-канал не настроен" };

  const probe = await telegramProbe("getChatMemberCount", { chat_id: chatId });
  if (probe.ok && Number.isFinite(Number(probe.result))) {
    return { available: true, subscribers: Number(probe.result), source: "bot_api", error: "" };
  }

  const username = String(ws && (ws.telegramPublicUsername || ws.slug) || "").replace(/^@/, "").trim();
  if (!username) return { available: false, subscribers: null, error: probe.error || "Публичный username не настроен" };
  try {
    const response = await fetch("https://t.me/s/" + encodeURIComponent(username), {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; NewsFactoryGrowth/1.0; +https://t.me/" + username + ")",
        "accept-language": "ru,en;q=0.8"
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error("Telegram HTTP " + response.status);
    const parsed = parseTelegramPreview(await response.text());
    if (parsed.subscribers != null && Number.isFinite(Number(parsed.subscribers))) {
      return { available: true, subscribers: Number(parsed.subscribers), source: "public_web_preview", error: "" };
    }
    return { available: false, subscribers: null, error: probe.error || "Telegram не вернул число подписчиков" };
  } catch (error) {
    return { available: false, subscribers: null, error: probe.error || String(error && error.message || error) };
  }
}

async function recordPromotionSnapshot(workspaceId, platform, totals) {
  if (!db || !dbReady || !workspaceId || !platform) return false;
  const t = totals || {};
  const subscribers = Number(t.subscribers);
  if (!Number.isFinite(subscribers) || subscribers < 0) return false;
  try {
    const recent = await db.query(
      "SELECT subscribers, recorded_at FROM promotion_snapshots WHERE workspace_id=$1 AND platform=$2 ORDER BY recorded_at DESC LIMIT 1",
      [workspaceId, platform]
    );
    const last = recent.rows[0];
    if (last) {
      const age = Date.now() - new Date(last.recorded_at).getTime();
      if (age < 45 * 60 * 1000 && Number(last.subscribers) === subscribers) return false;
    }
    await db.query(
      "INSERT INTO promotion_snapshots(workspace_id,platform,subscribers,views,engagement_rate) VALUES($1,$2,$3,$4,$5)",
      [
        workspaceId,
        platform,
        subscribers,
        Math.max(0, Number(t.views || 0) || 0),
        Number.isFinite(Number(t.engagementRate)) ? Number(t.engagementRate) : null
      ]
    );
    return true;
  } catch (error) {
    console.warn("Promotion snapshot failed " + workspaceId + "/" + platform + ":", error.message);
    return false;
  }
}

async function promotionBaselineMaps(workspaceIds) {
  const ids = (workspaceIds || []).filter(Boolean);
  const out = { day: new Map(), week: new Map(), month: new Map(), first: new Map() };
  if (!db || !dbReady || !ids.length) return out;
  try {
    const r = await db.query(
      "SELECT DISTINCT ON (workspace_id, platform) workspace_id, platform, subscribers, recorded_at " +
      "FROM promotion_snapshots WHERE workspace_id = ANY($1::text[]) ORDER BY workspace_id, platform, recorded_at ASC",
      [ids]
    );
    for (const row of r.rows) out.first.set(row.workspace_id + ":" + row.platform, { subscribers: Number(row.subscribers), recordedAt: row.recorded_at });
  } catch (error) {
    console.warn("Promotion first snapshot failed:", error.message);
  }

  for (const entry of [["day",1],["week",7],["month",30]]) {
    const key = entry[0], days = entry[1];
    try {
      const r = await db.query(
        "SELECT DISTINCT ON (workspace_id, platform) workspace_id, platform, subscribers, recorded_at " +
        "FROM promotion_snapshots WHERE workspace_id = ANY($1::text[]) " +
        "AND recorded_at <= NOW() - ($2::int * INTERVAL '1 day') " +
        "ORDER BY workspace_id, platform, recorded_at DESC",
        [ids, days]
      );
      for (const row of r.rows) out[key].set(row.workspace_id + ":" + row.platform, { subscribers: Number(row.subscribers), recordedAt: row.recorded_at });
    } catch (error) {
      console.warn("Promotion baseline " + key + " failed:", error.message);
    }
  }
  return out;
}

function promotionDelta(current, baseline) {
  const now = Number(current);
  if (!Number.isFinite(now) || !baseline || !Number.isFinite(Number(baseline.subscribers))) return null;
  return now - Number(baseline.subscribers);
}

async function promotionCampaignReport(workspaceId) {
  const empty = { spendRub: 0, attributedSubscribers: 0, clicks: 0, costPerSubscriber: null, active: 0, campaigns: [] };
  if (!db || !dbReady) return empty;
  try {
    const [summary, list] = await Promise.all([
      db.query(
        "SELECT COALESCE(SUM(spend_rub),0)::float8 AS spend_rub, COALESCE(SUM(attributed_subscribers),0)::int AS subscribers, " +
        "COALESCE(SUM(clicks),0)::int AS clicks, COUNT(*) FILTER (WHERE status='active')::int AS active " +
        "FROM promotion_campaigns WHERE workspace_id=$1",
        [workspaceId]
      ),
      db.query(
        "SELECT id,name,platform,source_type,source_name,spend_rub::float8 AS spend_rub,clicks,attributed_subscribers,status,started_at,ended_at " +
        "FROM promotion_campaigns WHERE workspace_id=$1 ORDER BY started_at DESC LIMIT 30",
        [workspaceId]
      )
    ]);
    const s = summary.rows[0] || {};
    const spendRub = Number(s.spend_rub || 0);
    const subscribers = Number(s.subscribers || 0);
    return {
      spendRub: spendRub,
      attributedSubscribers: subscribers,
      clicks: Number(s.clicks || 0),
      costPerSubscriber: subscribers > 0 ? Number((spendRub / subscribers).toFixed(2)) : null,
      active: Number(s.active || 0),
      campaigns: list.rows.map(function(row){
        return {
          id: row.id,
          name: row.name,
          platform: row.platform,
          sourceType: row.source_type,
          sourceName: row.source_name,
          spendRub: Number(row.spend_rub || 0),
          clicks: Number(row.clicks || 0),
          attributedSubscribers: Number(row.attributed_subscribers || 0),
          status: row.status,
          startedAt: row.started_at,
          endedAt: row.ended_at
        };
      })
    };
  } catch (error) {
    console.warn("Promotion campaigns report failed:", error.message);
    return empty;
  }
}

function promotionTopPosts(analytics) {
  const rows = [];
  const tg = analytics && analytics.telegram || {};
  for (const p of (tg.posts || [])) {
    const views = Number(p.views || 0);
    const interactions = Number(p.reactions || 0) + Number(p.comments || 0);
    rows.push({
      platform: "telegram",
      title: p.title || ("Telegram #" + (p.messageId || "")),
      url: p.url || "",
      views: views,
      interactions: interactions,
      engagementRate: views > 0 ? Number(((interactions / views) * 100).toFixed(2)) : 0,
      publishedAt: p.publishedAt || ""
    });
  }
  const vk = analytics && analytics.vk || {};
  for (const p of (vk.posts || [])) {
    const views = Number(p.views || 0);
    const interactions = Number(p.likes || 0) + Number(p.comments || 0) + Number(p.reposts || 0);
    rows.push({
      platform: "vk",
      title: p.title || ("VK #" + (p.postId || "")),
      url: p.url || "",
      views: views,
      interactions: interactions,
      engagementRate: views > 0 ? Number(((interactions / views) * 100).toFixed(2)) : 0,
      publishedAt: p.publishedAt || ""
    });
  }
  rows.sort(function(a,b){
    if (b.views !== a.views) return b.views - a.views;
    return b.engagementRate - a.engagementRate;
  });
  return rows.slice(0, 8);
}

async function buildPromotionReport(force) {
  const selectedWorkspaceId = currentWorkspaceId();
  const allWorkspaces = workspaceStore.workspaces.slice();
  const rows = await Promise.all(allWorkspaces.map(function(ws){
    return workspaceContext.run({ workspaceId: ws.id }, async function(){
      const tg = await fetchTelegramSubscriberCountLight(ws);
      let vkSubscribers = null;
      let vkAvailable = false;
      if (workspaceVkDirectAllowed(ws)) {
        try {
          const vk = await fetchVkAnalytics();
          if (vk && vk.totals && Number.isFinite(Number(vk.totals.subscribers))) {
            vkSubscribers = Number(vk.totals.subscribers);
            vkAvailable = true;
            await recordPromotionSnapshot(ws.id, "vk", vk.totals);
          }
        } catch {}
      }
      if (tg.available) await recordPromotionSnapshot(ws.id, "telegram", { subscribers: tg.subscribers });
      return {
        id: ws.id,
        name: ws.name,
        handle: ws.telegramPublicUsername ? ("@" + String(ws.telegramPublicUsername).replace(/^@/,"")) : String(ws.telegramChannel || ""),
        avatarUrl: ws.avatarUrl || "",
        telegramSubscribers: tg.available ? tg.subscribers : null,
        telegramAvailable: Boolean(tg.available),
        telegramError: tg.error || "",
        vkSubscribers: vkSubscribers,
        vkAvailable: vkAvailable,
        published: Number(ws.state && ws.state.stats && ws.state.stats.published || 0)
      };
    });
  }));

  const baselines = await promotionBaselineMaps(allWorkspaces.map(function(ws){ return ws.id; }));
  rows.forEach(function(row){
    const key = row.id + ":telegram";
    row.growth = {
      day: promotionDelta(row.telegramSubscribers, baselines.day.get(key)),
      week: promotionDelta(row.telegramSubscribers, baselines.week.get(key)),
      month: promotionDelta(row.telegramSubscribers, baselines.month.get(key))
    };
    const first = baselines.first.get(key);
    row.sinceStart = first ? { delta: promotionDelta(row.telegramSubscribers, first), since: first.recordedAt } : null;
    row.totalSubscribers = (Number.isFinite(Number(row.telegramSubscribers)) ? Number(row.telegramSubscribers) : 0) +
      (Number.isFinite(Number(row.vkSubscribers)) ? Number(row.vkSubscribers) : 0);
  });

  let details = { analytics: { telegram: {}, vk: {} }, topPosts: [] };
  await workspaceContext.run({ workspaceId: selectedWorkspaceId }, async function(){
    const analytics = await buildPlatformAnalytics(Boolean(force));
    details.analytics = analytics;
    details.topPosts = promotionTopPosts(analytics);
    if (analytics.telegram && analytics.telegram.totals) await recordPromotionSnapshot(selectedWorkspaceId, "telegram", analytics.telegram.totals);
    if (analytics.vk && analytics.vk.totals && Number.isFinite(Number(analytics.vk.totals.subscribers))) {
      await recordPromotionSnapshot(selectedWorkspaceId, "vk", analytics.vk.totals);
    }
  });

  const refreshedBaselines = await promotionBaselineMaps([selectedWorkspaceId]);
  const currentRow = rows.find(function(row){ return row.id === selectedWorkspaceId; }) || rows[0] || {};
  const currentTg = Number.isFinite(Number(currentRow.telegramSubscribers)) ? Number(currentRow.telegramSubscribers) : null;
  const currentVk = Number.isFinite(Number(currentRow.vkSubscribers)) ? Number(currentRow.vkSubscribers) : null;
  const sumGrowth = function(period) {
    let found = false, total = 0;
    const tgBase = refreshedBaselines[period].get(selectedWorkspaceId + ":telegram");
    const vkBase = refreshedBaselines[period].get(selectedWorkspaceId + ":vk");
    if (currentTg != null && tgBase) { total += currentTg - Number(tgBase.subscribers); found = true; }
    if (currentVk != null && vkBase) { total += currentVk - Number(vkBase.subscribers); found = true; }
    return found ? total : null;
  };

  const vkGrowth = {
    day: promotionDelta(currentVk, refreshedBaselines.day.get(selectedWorkspaceId + ":vk")),
    week: promotionDelta(currentVk, refreshedBaselines.week.get(selectedWorkspaceId + ":vk")),
    month: promotionDelta(currentVk, refreshedBaselines.month.get(selectedWorkspaceId + ":vk"))
  };

  const campaigns = await promotionCampaignReport(selectedWorkspaceId);
  const networkTotalSubscribers = rows.reduce(function(sum,row){ return sum + Number(row.totalSubscribers || 0); }, 0);
  const networkWeekGrowthValues = rows.map(function(row){ return row.growth && row.growth.week; }).filter(function(v){ return v != null; });
  const networkGrowth = function(period) {
    const values = rows.map(function(row){ return row.growth && row.growth[period]; }).filter(function(v){ return v != null; });
    return values.length ? values.reduce(function(a,b){ return a + b; }, 0) : null;
  };
  const sinceRows = rows.filter(function(row){ return row.sinceStart && row.sinceStart.delta != null; });
  const networkSince = sinceRows.length ? {
    delta: sinceRows.reduce(function(sum,row){ return sum + row.sinceStart.delta; }, 0),
    since: sinceRows.map(function(row){ return row.sinceStart.since; }).sort()[0]
  } : null;

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    tracking: {
      dbReady: dbReady,
      note: "Рост считается по автоматическим снимкам аудитории. Первые дельты появятся после накопления истории."
    },
    current: {
      id: currentRow.id || selectedWorkspaceId,
      name: currentRow.name || (currentWorkspace() && currentWorkspace().name) || "Канал",
      handle: currentRow.handle || "",
      telegramSubscribers: currentTg,
      vkSubscribers: currentVk,
      totalSubscribers: Number(currentRow.totalSubscribers || 0),
      growth: { day: sumGrowth("day"), week: sumGrowth("week"), month: sumGrowth("month") },
      telegramGrowth: currentRow.growth || { day: null, week: null, month: null },
      sinceStart: currentRow.sinceStart || null,
      vkAvailable: Boolean(currentRow.vkAvailable),
      vkGrowth: vkGrowth,
      campaignSummary: campaigns,
      topPosts: details.topPosts,
      analytics: details.analytics
    },
    network: {
      channels: rows,
      totalSubscribers: networkTotalSubscribers,
      weekGrowth: networkWeekGrowthValues.length ? networkWeekGrowthValues.reduce(function(a,b){ return a + b; }, 0) : null,
      growth: { day: networkGrowth("day"), week: networkGrowth("week"), month: networkGrowth("month") },
      sinceStart: networkSince,
      vkConnected: rows.some(function(row){ return row.vkAvailable; }),
      trackedChannels: rows.filter(function(row){ return row.telegramAvailable || row.vkAvailable; }).length
    }
  };
}

async function generatePromotionCreative() {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY не настроен");
  const ws = currentWorkspace();
  const recent = (state.history || []).slice(0, 12).map(function(h){
    return {
      title: String(h && h.title || "").slice(0, 180),
      text: String(h && h.text || "").replace(/\s+/g," ").slice(0, 450),
      views: Number(h && h.views || 0)
    };
  }).filter(function(x){ return x.title || x.text; });
  const prompt = [
    "Ты growth-редактор News Factory.",
    "Нужно подготовить рекламный креатив для привлечения живых подписчиков в Telegram-канал «" + String(ws.name || "News Factory") + "».",
    "Не выдумывай цифры, достижения, эксклюзивность или факты, которых нет во входных данных.",
    "Пиши по-русски, живо и коротко, без канцелярита.",
    "Нужны четыре поля:",
    "headline — короткий рекламный заголовок;",
    "telegram_ad — рекламный пост на 350–550 знаков;",
    "short_video_hook — хук для Reels/Shorts на 1–2 предложения;",
    "cta — короткий призыв подписаться.",
    'Верни строго JSON без markdown: {"headline":"...","telegram_ad":"...","short_video_hook":"...","cta":"..."}. ',
    "",
    "Недавние темы канала:",
    JSON.stringify(recent.slice(0, 6))
  ].join("\n");

  const candidates = [OPENAI_MODEL, OPENAI_FALLBACK_MODEL].filter(function(v,i,a){ return v && a.indexOf(v) === i; });
  let lastError = "";
  for (const model of candidates) {
    try {
      const response = await llmResponsesFetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + OPENAI_API_KEY },
        body: JSON.stringify({ model: model, input: prompt, max_output_tokens: 900, text: { format: { type: "json_object" } } }),
        signal: AbortSignal.timeout(45000)
      });
      const data = await response.json().catch(function(){ return {}; });
      if (!response.ok) { lastError = data && data.error && data.error.message || ("HTTP " + response.status); continue; }
      recordOpenAIResponseUsage(model, "promotion_creative", data, "responses", {});
      const raw = extractOpenAIText(data).replace(/^\s*```json\s*/i,"").replace(/\s*```\s*$/,"").trim();
      const parsed = JSON.parse(raw);
      return {
        model: model,
        headline: String(parsed.headline || "").trim(),
        telegramAd: String(parsed.telegram_ad || "").trim(),
        shortVideoHook: String(parsed.short_video_hook || "").trim(),
        cta: String(parsed.cta || "").trim()
      };
    } catch (error) {
      lastError = String(error && error.message || error);
    }
  }
  throw new Error(lastError || "Не удалось создать рекламный креатив");
}

let promotionSnapshotTimer = null;
async function refreshPromotionSnapshotsAllWorkspaces() {
  if (!db || !dbReady) return { ok: false, skipped: "db_unavailable" };
  let recorded = 0;
  for (const ws of workspaceStore.workspaces) {
    await workspaceContext.run({ workspaceId: ws.id }, async function(){
      const tg = await fetchTelegramSubscriberCountLight(ws);
      if (tg.available && await recordPromotionSnapshot(ws.id, "telegram", { subscribers: tg.subscribers })) recorded += 1;
      if (workspaceVkDirectAllowed(ws)) {
        try {
          const vk = await fetchVkAnalytics();
          if (vk && vk.totals && Number.isFinite(Number(vk.totals.subscribers))) {
            if (await recordPromotionSnapshot(ws.id, "vk", vk.totals)) recorded += 1;
          }
        } catch {}
      }
    });
  }
  return { ok: true, recorded: recorded };
}

function startPromotionSnapshotMonitor() {
  if (promotionSnapshotTimer) return;
  setTimeout(function(){
    refreshPromotionSnapshotsAllWorkspaces().catch(function(error){ console.warn("Promotion snapshot startup failed:", error.message); });
  }, 12000);
  promotionSnapshotTimer = setInterval(function(){
    refreshPromotionSnapshotsAllWorkspaces().catch(function(error){ console.warn("Promotion snapshot refresh failed:", error.message); });
  }, 60 * 60 * 1000);
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
  if (!force && providerBreaker.isOpen("anthropic")) {
    return { ok: false, error: providerBreaker.reason("anthropic") || "Anthropic временно отключён circuit breaker", breaker: true };
  }
  const now = Date.now();
  if (!force && anthropicProbeCache.value && now - anthropicProbeCache.at < ANTHROPIC_HEALTH_CACHE_MIN * 60 * 1000) {
    return anthropicProbeCache.value;
  }
  try {
    const clients = createModelClients({
      anthropicApiKey: ANTHROPIC_API_KEY,
      anthropicModel: ANTHROPIC_CHECKER_MODEL,
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
      ? { ok: true, model: result.model || ANTHROPIC_CHECKER_MODEL, structured: result.structured !== false }
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
      const response = await llmResponsesFetch("https://api.openai.com/v1/responses", {
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
  // Not filled automatically: load from the official Ministry of Justice register via the admin API (POST /api/editorial/registry).
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
// Matching is word-based with Russian stems and aliases (lib/editorial-registry.js);
// a built-in list of banned organisations (Meta/Facebook/Instagram, ...) is always checked
// in addition to the administrator's lists.
function editorialRegistryForSources(sourceText) {
  return matchEditorialRegistry(loadEditorialRegistry(), sourceText);
}

let editorialPipelineInstance = null;
function editorialPipeline() {
  if (!editorialPipelineInstance) {
    editorialPipelineInstance = createEditorialPipeline({
      promptFile: EDITORIAL_V2_PROMPT_FILE,
      maxFixRounds: EDITORIAL_V2_MAX_FIX_ROUNDS,
      requireAllCheckers: EDITORIAL_V2_REQUIRE_ALL_CHECKERS,
      claudeCheck: process.env.EDITORIAL_V2_CLAUDE_CHECK,
      providerFailover: PROVIDER_FAILOVER_ENABLED,
      config: {
        openaiApiKey: OPENAI_API_KEY,
        openaiModel: OPENAI_MODEL,
        openaiFallbackModel: OPENAI_FALLBACK_MODEL,
        anthropicApiKey: ANTHROPIC_API_KEY,
        anthropicModel: ANTHROPIC_CHECKER_MODEL,
        anthropicStrongModel: ANTHROPIC_STRONG_CHECKER_MODEL,
        anthropicStrongImportance: ANTHROPIC_STRONG_IMPORTANCE,
        anthropicCheckMinImportance: ANTHROPIC_CHECK_MIN_IMPORTANCE,
        anthropicWriterModel: ANTHROPIC_FALLBACK_WRITER_MODEL,
        providerFailover: PROVIDER_FAILOVER_ENABLED,
        breaker: providerBreaker,
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
  const username = target ? (telegramUsernameOrEmpty(target.telegramPublicUsername) || telegramUsernameOrEmpty(target.slug)) : "";
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
        text: stripHtml(String(item.text || "")).replace(/\s+/g, " ").trim().slice(0, 300),
        format: v2.format || item.contentFormatLabel || item.contentFormat || "",
        hook_type: v2.hookType || "",
        ending_type: v2.endingType || "",
        title_emoji: v2.titleEmoji || "",
        crosspromo_target: v2.crosspromoTarget || null,
        content_bucket: v2.contentBucket || item.contentBucket || "",
        entities: normalizeTopicEntities(item.topicEntities).slice(0, 4),
        audience: item.performanceScore == null ? undefined : (item.performanceScore >= 2 ? "выше среднего" : (item.performanceScore <= -2 ? "ниже среднего" : "средне"))
      };
    });
}

// A queue item that the editorial pipeline approved (not on hold / rejected / skipped on re-check).
// Only such items count as "the same story is already covered" and may be merged into.
function isApprovedQueueItem(item) {
  if (!item || !item.newsId) return false;
  if (item.qcStatus === "hold") return false;
  const v2 = item.editorialV2;
  if (v2 && v2.status && v2.status !== "approved") return false;
  return true;
}

const NETWORK_RECENT_PUBLISHED_PER_CHANNEL = 4;
const NETWORK_RECENT_QUEUED_PER_CHANNEL = 3;
const NETWORK_RECENT_MAX = 120;

// Titles the writer sees to avoid duplicates across the network: for every OTHER channel its latest published
// posts of the last 24 hours plus its approved queue (about to go out). The cap is per channel, so channels late in
// the workspace list are as visible as early ones (a single global cap of 60 hid most of the network).
function editorialNetworkRecent() {
  const me = currentWorkspaceId();
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const out = [];
  for (const ws of workspaceStore.workspaces) {
    if (!ws || ws.id === me || !ws.state) continue;
    const channelId = resolveChannelId(ws);
    const mine = [];
    for (const item of (ws.state.queue || [])) {
      if (!isApprovedQueueItem(item)) continue;
      if (item.telegramPublished || item.vkPublished) continue;
      mine.push({ channel_id: channelId || ws.id, title: String(item.title || "").slice(0, 160), date: item.createdAt || "", status: "queued", t: new Date(item.createdAt || 0).getTime() || 0 });
    }
    mine.sort(function(a, b){ return b.t - a.t; });
    mine.length = Math.min(mine.length, NETWORK_RECENT_QUEUED_PER_CHANNEL);
    let published = 0;
    for (const item of (ws.state.history || [])) {
      if (!item || !item.publishedAt) continue;
      const t = new Date(item.publishedAt).getTime();
      if (!Number.isFinite(t) || t < since) break;
      mine.push({ channel_id: channelId || ws.id, title: String(item.title || "").slice(0, 160), date: item.publishedAt, status: "published" });
      published += 1;
      if (published >= NETWORK_RECENT_PUBLISHED_PER_CHANNEL) break;
    }
    for (const x of mine) { delete x.t; out.push(x); }
    if (out.length >= NETWORK_RECENT_MAX) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Deterministic cross-channel dedupe: the same article (normalized URL or content hash) that another channel
// has queued, is processing, or published within CROSS_CHANNEL_DEDUPE_HOURS is not used a second time.
// The model-based network_recent check above is only a hint; this one is exact.
const crossChannelClaims = new Map();

function normalizeArticleUrl(raw) {
  try {
    const u = new URL(String(raw || "").trim());
    if (!/^https?:$/.test(u.protocol)) return "";
    const drop = /^(utm_|fbclid$|gclid$|yclid$|ysclid$|_openstat$|mc_cid$|mc_eid$|cmpid$|from$|ref$|ref_src$|source$)/i;
    const params = Array.from(u.searchParams.entries()).filter(function(kv){ return !drop.test(kv[0]); }).sort(function(a, b){ return a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0); });
    const search = params.length ? "?" + params.map(function(kv){ return kv[0] + "=" + kv[1]; }).join("&") : "";
    const path = u.pathname.replace(/\/index\.(html?|php)$/i, "/").replace(/\/+$/, "");
    return (u.hostname.toLowerCase().replace(/^www\./, "") + path + search).toLowerCase();
  } catch { return ""; }
}

// URLs and content hashes that identify the article(s) behind a queue / history item.
function itemArticleKeys(item) {
  const urls = new Set();
  const hashes = new Set();
  if (!item) return { urls: urls, hashes: hashes };
  const addUrl = function(value){ const n = normalizeArticleUrl(value); if (n) urls.add(n); };
  const addHash = function(value){ const h = String(value || "").trim(); if (h.length >= 16) hashes.add(h); };
  addUrl(item.originalUrl); addUrl(item.sourceUrl);
  (Array.isArray(item.sourceUrls) ? item.sourceUrls : []).forEach(addUrl);
  (Array.isArray(item.sources) ? item.sources : []).forEach(function(x){ addUrl(x && x.url); });
  (Array.isArray(item.storySources) ? item.storySources : []).forEach(function(x){ addUrl(x && x.url); addHash(x && x.contentHash); });
  addHash(item.contentHash);
  if (item.sourceOriginalTitle && item.sourceOriginalText) {
    addHash(crypto.createHash("sha256").update(String(item.sourceOriginalTitle) + "\n" + String(item.sourceOriginalText).slice(0, 6000)).digest("hex"));
  }
  return { urls: urls, hashes: hashes };
}

// Index of everything other channels hold: key -> { workspace, channel, where }. publishedOnly skips queues and in-flight claims.
function crossChannelIndex(options) {
  const me = currentWorkspaceId();
  const publishedOnly = Boolean(options && options.publishedOnly);
  const cutoff = Date.now() - CROSS_CHANNEL_DEDUPE_HOURS * 60 * 60 * 1000;
  const index = new Map();
  const put = function(keys, ws, where) {
    const info = { workspace: ws.id, channel: resolveChannelId(ws) || ws.id, where: where };
    keys.urls.forEach(function(k){ if (!index.has("u:" + k) || where === "published") index.set("u:" + k, info); });
    keys.hashes.forEach(function(k){ if (!index.has("h:" + k) || where === "published") index.set("h:" + k, info); });
  };
  for (const ws of workspaceStore.workspaces) {
    if (!ws || ws.id === me || !ws.state) continue;
    for (const item of (ws.state.history || [])) {
      if (!item || !item.publishedAt) continue;
      const t = new Date(item.publishedAt).getTime();
      if (!Number.isFinite(t)) continue;
      if (t < cutoff) break;
      put(itemArticleKeys(item), ws, "published");
    }
    if (publishedOnly) continue;
    for (const item of (ws.state.queue || [])) {
      if (!item || !item.newsId) continue;
      const t = new Date(item.createdAt || 0).getTime();
      if (Number.isFinite(t) && t && t < cutoff) continue;
      put(itemArticleKeys(item), ws, item.telegramPublished || item.vkPublished ? "published" : "queued");
    }
  }
  if (!publishedOnly) {
    crossChannelClaims.forEach(function(wsId, key) {
      if (wsId === me) return;
      const ws = getWorkspaceById(wsId);
      if (ws && !index.has(key)) index.set(key, { workspace: wsId, channel: ws && resolveChannelId(ws) || wsId, where: "inflight" });
    });
  }
  return index;
}

// keys: { urls:Set, hashes:Set } (or an item). Returns null or { workspace, channel, where, by }.
function crossChannelConflict(keysOrItem, options) {
  if (!CROSS_CHANNEL_DEDUPE_ENABLED) return null;
  const keys = keysOrItem && keysOrItem.urls instanceof Set ? keysOrItem : itemArticleKeys(keysOrItem);
  const index = options && options.index || crossChannelIndex(options);
  for (const u of keys.urls) { const hit = index.get("u:" + u); if (hit) return Object.assign({ by: "url" }, hit); }
  for (const h of keys.hashes) { const hit = index.get("h:" + h); if (hit) return Object.assign({ by: "content_hash" }, hit); }
  return null;
}

function crossChannelClaim(keys) {
  const me = currentWorkspaceId();
  const claimed = [];
  keys.urls.forEach(function(k){ claimed.push("u:" + k); });
  keys.hashes.forEach(function(k){ claimed.push("h:" + k); });
  claimed.forEach(function(k){ crossChannelClaims.set(k, me); });
  return claimed;
}
function crossChannelRelease(claimed) {
  const me = currentWorkspaceId();
  (claimed || []).forEach(function(k){ if (crossChannelClaims.get(k) === me) crossChannelClaims.delete(k); });
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
  let limit = channelDailyMax();
  if (bloggerLaneActive()) limit += bloggerTargetFor();
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
    now: moscowIso(new Date()),
    news_id: String(opts.newsId || opts.news_id || ""),
    mode: opts.mode === "digest" ? "digest" : "post",
    time_slot: opts.timeSlot || timeSlotFor(publishAt),
    vk_enabled: VK_PUBLISH_ENABLED && workspaceVkPublishingAllowed(currentWorkspace()),
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
    has_photo: Boolean(opts.hasPhoto),
    channel_strategy: channelStrategy(channelId)
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
    contentBucket: post.contentBucket || "",
    channelSignals: post.channelSignals || {},
    album: Boolean(post.album),
    legalFlags: post.legalFlags || [],
    conflicts: post.conflicts || null,
    cover: post.cover || null,
    rounds: outcome.rounds || 0,
    writerModel: outcome.writerModel || "",
    writerProvider: outcome.writerProvider || "openai",
    failoverChecker: outcome.failoverChecker || "",
    checkers: checkerModels,
    degradedQc: Boolean(outcome.degraded),
    failedProviders: outcome.failedProviders || [],
    errors: (outcome.errors || []).slice(0, 12),
    log: outcome.log || [],
    checkedAt: new Date().toISOString()
  };

  (outcome.checkers || []).forEach(function(c){ if (c && c.failed) maybeBillingAlert(c.error); });
  // One structured line per editorial decision so the pipeline can be monitored from
  // Railway logs. No secrets, no post bodies.
  console.log("EDITORIAL_V2 " + JSON.stringify({
    workspace: currentWorkspaceId(),
    channel: channelId,
    status: outcome.status,
    verdict: outcome.verdict,
    importance: meta.importance,
    contentBucket: meta.contentBucket || undefined,
    rounds: meta.rounds,
    checkers: checkerModels,
    degradedQc: Boolean(outcome.degraded),
    failedProviders: outcome.failedProviders || [],
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
  const degradedNote = outcome.degraded ? " · резервный режим: недоступен " + (outcome.failedProviders || []).join(", ") : "";
  const decision = approved
    ? "Пост прошёл проверку: " + checkerModels.join(", ") + degradedNote + (outcome.rounds ? " (исправлений: " + outcome.rounds + ")" : "")
    : "Пост не прошёл проверку: " + ({ reject: "проверка отклонила", fix_exhausted: "ошибки остались после исправлений", unavailable: "основной проверщик недоступен", copyright_overlap: "дословное совпадение с источником" }[outcome.verdict] || outcome.verdict);

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
// Editorial QA: production dry-run for all channel profiles. It never publishes.
// The run is asynchronous because a full network audit can take several minutes.
// ---------------------------------------------------------------------------

let editorialQaState = {
  status: "idle",
  startedAt: "",
  finishedAt: "",
  progress: { done: 0, total: 0 },
  summary: null,
  channels: [],
  error: ""
};
// The last QA result survives restarts (deploys happen several times a day).
const EDITORIAL_QA_FILE = path.join(DATA_DIR, "editorial-qa.json");
try {
  if (fs.existsSync(EDITORIAL_QA_FILE)) {
    const saved = JSON.parse(fs.readFileSync(EDITORIAL_QA_FILE, "utf8"));
    if (saved && typeof saved === "object" && Array.isArray(saved.channels)) {
      editorialQaState = Object.assign({}, editorialQaState, saved);
      if (editorialQaState.status === "running") {
        editorialQaState.status = "error";
        editorialQaState.error = "проверка прервалась из-за перезапуска сервера";
      }
    }
  }
} catch (error) { console.warn("Editorial QA state load failed:", error.message); }
function saveEditorialQaState() {
  try { ensureDataDir(); fs.writeFileSync(EDITORIAL_QA_FILE, JSON.stringify(editorialQaState), "utf8"); }
  catch (error) { console.warn("Editorial QA state save failed:", error.message); }
}

function qaStyleCheck(channelId, title, body) {
  const strategy = channelStrategy(channelId);
  const text = (String(title || "") + " " + String(body || "")).toLowerCase();
  const formal = [
    /согласно пресс-релизу/g,
    /в пресс-службе (?:сообщили|заявили)/g,
    /компания сообщила о том, что/g,
    /как отмечается в сообщении/g,
    /по данным пресс-службы/g
  ];
  let formalHits = 0;
  formal.forEach(function(re){ formalHits += (text.match(re) || []).length; });

  if (strategy.type === "blogger") {
    return {
      pass: formalHits === 0,
      note: formalHits ? "Есть канцелярская/пресс-релизная подача" : "Блогерский профиль без пресс-релизных маркеров",
      formalHits
    };
  }
  if (strategy.type === "trends") {
    return {
      pass: formalHits <= 1,
      note: formalHits > 1 ? "Слишком официальная подача для трендового канала" : "Трендовый профиль без перегруза канцеляритом",
      formalHits
    };
  }
  return {
    pass: formalHits <= 2,
    note: formalHits > 2 ? "Слишком много пресс-релизных формулировок" : "Стиль соответствует новостному профилю",
    formalHits
  };
}

function publicationCoverageSnapshot() {
  const now = new Date();
  const nowMinutes = moscowMinutes(now);
  const hour = Math.floor(nowMinutes / 60);
  const day = moscowDateKey(now);
  const time = String(hour).padStart(2, "0") + ":00";
  const slotKey = day + " " + time;
  const channels = workspaceStore.workspaces.map(function(ws){
    const history = ws && ws.state && Array.isArray(ws.state.history) ? ws.state.history : [];
    const hit = history.find(function(item){
      return item && String(item.scheduledSlot || "") === slotKey && Boolean(item.messageId || item.telegramMessageId || item.vkPostId || item.publishedAt);
    });
    const assignment = ws && ws.state && ws.state.schedule && ws.state.schedule.assignments &&
      ws.state.schedule.assignments[day] && ws.state.schedule.assignments[day][time] || "";
    return {
      workspaceId: ws.id,
      name: ws.name,
      channelId: resolveChannelId(ws),
      telegram: ws.telegramPublicUsername || String(ws.telegramChannel || "").replace(/^@/, ""),
      published: Boolean(hit),
      // Channels in manual or paused mode are not expected to post in the slot.
      expected: Boolean(workspaceSummary(ws).autoPublish),
      title: hit && hit.title || "",
      publishedAt: hit && hit.publishedAt || "",
      queueId: assignment || ""
    };
  });
  return {
    slot: slotKey,
    time: time,
    minute: nowMinutes % 60,
    published: channels.filter(function(x){ return x.published; }).length,
    publishedExpected: channels.filter(function(x){ return x.published && x.expected; }).length,
    total: channels.length,
    expected: channels.filter(function(x){ return x.expected; }).length,
    missing: channels.filter(function(x){ return !x.published; }).map(function(x){ return x.workspaceId; }),
    channels
  };
}

function qaSourceClassCounts() {
  const counts = { OFFICIAL:0, MEDIA:0, CREATOR:0, COMMUNITY:0, SOCIAL:0 };
  (state.sources || []).forEach(function(source){
    if (!source || !source.enabled) return;
    const cls = source.sourceClass || sourceClassFor(source);
    if (Object.prototype.hasOwnProperty.call(counts, cls)) counts[cls] += 1;
  });
  return counts;
}

function qaRecentMix(channelId) {
  const strategy = channelStrategy(channelId);
  const mix = strategy.mix || {};
  const recent = (state.history || []).filter(function(item){
    return item && !item.isDigest && item.publicationOrigin !== "digest";
  }).slice(0, 24);
  const counts = {};
  Object.keys(mix).forEach(function(k){ counts[k] = 0; });
  recent.forEach(function(item){
    const bucket = item.contentBucket || item.editorialV2 && item.editorialV2.contentBucket || "";
    if (Object.prototype.hasOwnProperty.call(counts, bucket)) counts[bucket] += 1;
  });
  return { sampleSize: recent.length, counts, target: mix };
}

function qaScoreChecks(checks) {
  const required = checks.filter(function(x){ return x.required !== false; });
  const passed = required.filter(function(x){ return x.pass === true; }).length;
  const percent = required.length ? Math.round(passed / required.length * 100) : 0;
  return { passed, total: required.length, percent };
}

async function runEditorialQaForWorkspace(ws) {
  return workspaceContext.run({ workspaceId: ws.id }, async function(){
    const channelId = resolveChannelId(ws);
    const strategy = channelStrategy(channelId);
    const sourceClasses = qaSourceClassCounts();
    const recentMix = qaRecentMix(channelId);
    const sourceClassVariety = Object.values(sourceClasses).filter(function(n){ return n > 0; }).length;

    const candidates = (state.queue || []).filter(function(item){
      return item && String(item.sourceOriginalText || "").trim() && !item.telegramPublished && item.status !== "media_failed";
    }).sort(function(a,b){ return dynamicItemScore(b) - dynamicItemScore(a); });
    const candidate = candidates[0] || null;

    const checks = [
      { key:"profile", label:"Channel DNA", pass:Boolean(channelId && Object.keys(strategy.mix || {}).length), note:channelId + " · " + strategy.type },
      { key:"sources", label:"Классы источников", pass:sourceClassVariety >= 2, note:sourceClassVariety + " активных классов" },
      { key:"candidate", label:"Контрольный материал", pass:Boolean(candidate), note:candidate ? String(candidate.sourceOriginalTitle || candidate.title || "").slice(0,120) : "Нет подходящего материала в очереди" }
    ];

    let sample = null;
    let degraded = false;
    let checkerError = "";
    if (candidate) {
      try {
        const result = await runEditorialV2([{
          name: String(candidate.sourceName || "Источник"),
          url: String(candidate.sourceUrl || ""),
          date: String(candidate.articlePublishedAt || candidate.createdAt || ""),
          role: sourceRoleLabel(candidate.sourceRole || sourceEditorialRole(candidate)),
          title: String(candidate.sourceOriginalTitle || candidate.title || ""),
          text: String(candidate.sourceOriginalText || candidate.text || "").slice(0,7000),
          photos: [candidate.originalImageUrl, candidate.imageUrl, candidate.generatedImageUrl].filter(Boolean).slice(0,3)
        }], {
          hasPhoto: Boolean(candidate.videoUrl || candidate.imageUrl || candidate.generatedImageUrl),
          newsId: "qa_" + ws.id + "_" + Date.now()
        });

        const meta = result.meta || {};
        const bucketKeys = Object.keys(strategy.mix || {});
        const signals = meta.channelSignals || {};
        const allSignals = ["virality","utility","discussion","visual","wow","local","deal"].every(function(k){ return Number.isFinite(Number(signals[k])); });
        const style = qaStyleCheck(channelId, result.rewrite && result.rewrite.title, result.rewrite && result.rewrite.text);
        degraded = Boolean(meta.degradedQc);
        checkerError = degraded ? String((meta.failedProviders || []).join(", ")) : "";

        checks.push(
          { key:"bucket", label:"Тип контента", pass:bucketKeys.includes(String(meta.contentBucket || "")), note:String(meta.contentBucket || "не определён") },
          { key:"signals", label:"Channel Score", pass:allSignals, note:allSignals ? "7/7 сигналов" : "Не все сигналы заполнены" },
          { key:"style", label:"Стиль канала", pass:style.pass, note:style.note },
          { key:"qc", label:"Фактчек", pass:meta.verdict === "pass", note:meta.verdict === "pass" ? (degraded ? "PASS · резервный режим" : "PASS") : String(meta.verdict || "нет результата") }
        );

        sample = {
          sourceTitle: String(candidate.sourceOriginalTitle || candidate.title || "").slice(0,180),
          title: String(result.rewrite && result.rewrite.title || "").slice(0,180),
          text: String(result.rewrite && result.rewrite.text || "").slice(0,700),
          contentBucket: meta.contentBucket || "",
          channelSignals: signals,
          verdict: meta.verdict || "",
          degradedQc: degraded,
          failedProviders: meta.failedProviders || [],
          checkerModels: meta.checkers || []
        };
      } catch (error) {
        checks.push({ key:"generation", label:"Контрольная генерация", pass:false, note:String(error && error.message || error).slice(0,220) });
      }
    }

    const scored = qaScoreChecks(checks);
    let status = scored.percent >= 85 ? "pass" : (scored.percent >= 60 ? "warn" : "fail");
    if (degraded && status === "pass") status = "warn";

    return {
      workspaceId: ws.id,
      name: ws.name,
      channelId,
      type: strategy.type,
      status,
      percent: scored.percent,
      checks,
      sourceClasses,
      recentMix,
      sample,
      degradedQc: degraded,
      checkerError
    };
  });
}

async function runEditorialQaNetwork() {
  if (editorialQaState.status === "running") return editorialQaState;
  editorialQaState = {
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: "",
    progress: { done: 0, total: workspaceStore.workspaces.length },
    summary: null,
    channels: [],
    error: ""
  };
  // Saved at start too: a restart mid-run is then reported, not shown as the old result.
  saveEditorialQaState();

  try {
    for (const ws of workspaceStore.workspaces) {
      let result;
      try {
        result = await runEditorialQaForWorkspace(ws);
      } catch (error) {
        result = {
          workspaceId: ws.id,
          name: ws.name,
          channelId: resolveChannelId(ws),
          status: "fail",
          percent: 0,
          checks: [{ key:"runtime", label:"Запуск QA", pass:false, note:String(error && error.message || error).slice(0,220) }],
          sourceClasses: {},
          recentMix: {},
          sample: null
        };
      }
      editorialQaState.channels.push(result);
      editorialQaState.progress.done += 1;
    }

    const channels = editorialQaState.channels;
    editorialQaState.summary = {
      pass: channels.filter(function(x){ return x.status === "pass"; }).length,
      warn: channels.filter(function(x){ return x.status === "warn"; }).length,
      fail: channels.filter(function(x){ return x.status === "fail"; }).length,
      averagePercent: channels.length ? Math.round(channels.reduce(function(sum,x){ return sum + Number(x.percent || 0); },0) / channels.length) : 0,
      degraded: channels.filter(function(x){ return x.degradedQc; }).length
    };
    editorialQaState.status = "done";
    editorialQaState.finishedAt = new Date().toISOString();
  } catch (error) {
    editorialQaState.status = "error";
    editorialQaState.error = String(error && error.message || error);
    editorialQaState.finishedAt = new Date().toISOString();
  }
  saveEditorialQaState();
  return editorialQaState;
}

// ---------------------------------------------------------------------------
// Legacy digests (disabled by default): evening «Главное за день» and Sunday «Топ недели».
const digestRunning = new Set();
async function publishDigest(kind, force) {
  const lockKey = currentWorkspaceId() + ":" + kind;
  if (digestRunning.has(lockKey)) return { ok: true, skipped: "already_running" };
  digestRunning.add(lockKey);
  try { return await publishDigestUnlocked(kind, force); }
  finally { digestRunning.delete(lockKey); }
}

async function publishDigestUnlocked(kind, force) {
  if (kind === "evening" && !DIGEST_EVENING_ENABLED) return { ok: true, skipped: "evening_digest_disabled" };
  if (kind === "sunday" && !DIGEST_SUNDAY_ENABLED) return { ok: true, skipped: "sunday_digest_disabled" };
  if (!editorialV2Active()) return { ok: false, skipped: "editorial_v2_off" };
  state.digests = state.digests && typeof state.digests === "object" ? state.digests : {};
  const today = moscowParts(new Date()).day;
  const publishedKey = kind === "sunday" ? "publishedSunday" : "publishedEvening";
  if (!force && state.digests[publishedKey] === today) return { ok: true, skipped: "already_published_today" };
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
  state.digests[publishedKey] = today;
  saveState();
  return { ok: true, published: true, kind: kind, posts: posts.length, messageId: result.message_id || null };
}

async function maybePublishDigest() {
  if (!DIGEST_ENABLED) return;
  const now = moscowParts(new Date());
  state.digests = state.digests && typeof state.digests === "object" ? state.digests : {};
  state.digests.attempts = state.digests.attempts && typeof state.digests.attempts === "object" ? state.digests.attempts : {};
  const jobs = [];
  if (DIGEST_SUNDAY_ENABLED && now.weekday === 0) jobs.push({ kind: "sunday", time: DIGEST_SUNDAY_TIME, doneKey: "lastSunday", publishedKey: "publishedSunday" });
  if (DIGEST_EVENING_ENABLED) jobs.push({ kind: "evening", time: DIGEST_EVENING_TIME, doneKey: "lastEvening", publishedKey: "publishedEvening" });
  for (const job of jobs) {
    if (state.digests[job.doneKey] === now.day || state.digests[job.publishedKey] === now.day) continue;
    if (now.hhmm < job.time || now.hhmm > addMinutesHHMM(job.time, 40)) continue;
    // On Sundays the weekly top replaces the evening digest — only if it was actually published.
    if (job.kind === "evening" && now.weekday === 0 && state.digests.publishedSunday === now.day) { state.digests.lastEvening = now.day; saveState(); continue; }
    const attemptKey = job.kind + ":" + now.day;
    const attempts = Number(state.digests.attempts[attemptKey] || 0);
    if (attempts >= 3) continue;
    state.digests.attempts[attemptKey] = attempts + 1;
    for (const key of Object.keys(state.digests.attempts)) if (!key.endsWith(now.day)) delete state.digests.attempts[key];
    saveState();
    let result;
    try {
      result = await publishDigest(job.kind, false);
    } catch (error) {
      result = { ok: false, error: error.message };
    }
    console.log("DIGEST " + JSON.stringify(Object.assign({ workspace: currentWorkspaceId(), kind: job.kind, attempt: attempts + 1 }, result)));
    // Definitive outcomes close the day; temporary failures are retried (up to 3 times in the window).
    if (result && (result.published || result.skipped === "already_published_today")) state.digests[job.doneKey] = now.day;
    saveState();
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
  const best = regular.filter(function(h){ return Number(h.views || 0) > 0; }).sort(function(a, b){ return Number(b.views || 0) - Number(a.views || 0); })[0] || null;
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
  const attempts = ws.state.dailyReport.attemptsDay === now.day ? Number(ws.state.dailyReport.attempts || 0) : 0;
  if (attempts >= 3) return;
  ws.state.dailyReport.attemptsDay = now.day;
  ws.state.dailyReport.attempts = attempts + 1;
  let result;
  try { result = await sendDailyReport(false); }
  catch (error) { result = { ok: false, error: error.message }; }
  // no_chat is not retried today (the owner has to /start the bot first).
  if (result.ok || result.error === "no_chat") ws.state.dailyReport.lastDay = now.day;
  await workspaceContext.run({ workspaceId: ws.id }, async function(){ saveState(); });
  if (!result.ok) console.warn("DAILY_REPORT_FAILED " + JSON.stringify({ error: result.error, attempt: attempts + 1 }));
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

async function retryUnavailableEditorialQueueItems(limit) {
  if (costEconomyMode()) return { checked: 0, repaired: 0, held: 0, skipped: 0, economyMode: true };
  if (!editorialV2Active()) return { checked: 0, repaired: 0, held: 0, skipped: 0 };

  // Retry even when Anthropic is temporarily unavailable. Editorial v2 now
  // operates in explicit degraded mode with OpenAI as the primary checker,
  // instead of leaving the whole queue on hold and causing empty slots.
  let secondaryChecker = { ok: false, error: "ANTHROPIC_API_KEY не задан" };
  if (ANTHROPIC_API_KEY) {
    secondaryChecker = await anthropicEditorialProbe(false).catch(function(error){
      return { ok: false, error: String(error && error.message || error) };
    });
  }

  const marker = "structured-json-v2-degraded-safe";
  const maxItems = Math.max(1, Math.min(6, Number(limit || 6)));
  const candidates = (state.queue || []).filter(function(item) {
    if (!item || !item.editorialV2) return false;
    if (item.editorialV2RetryVersion === marker) return false;
    const verdict = String(item.editorialV2.verdict || "").toLowerCase();
    const checkerList = Array.isArray(item.editorialV2.checkers) ? item.editorialV2.checkers : [];
    const hadAnthropicFailure = checkerList.some(function(x){ return /^anthropic:error$/i.test(String(x || "")); });
    return verdict === "unavailable" || hadAnthropicFailure;
  }).slice(0, maxItems);

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
      item.editorialV2RetryCount = Number(item.editorialV2RetryCount || 0) + 1;
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
      item.contentBucket = result.meta && result.meta.contentBucket || item.contentBucket || "";
      item.channelSignals = result.meta && result.meta.channelSignals || item.channelSignals || {};
      item.sourceClass = item.sourceClass || sourceClassFor(item);
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

  return {
    checked: candidates.length,
    repaired,
    held,
    skipped,
    degradedSecondaryChecker: !secondaryChecker.ok,
    secondaryCheckerError: secondaryChecker.ok ? "" : String(secondaryChecker.error || "").slice(0, 240)
  };
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
        contentBucket: v2.meta && v2.meta.contentBucket || item.contentBucket || "",
        channelSignals: v2.meta && v2.meta.channelSignals || item.channelSignals || {},
        sourceClass: item.sourceClass || sourceClassFor(item),
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
      const response = await llmResponsesFetch("https://api.openai.com/v1/responses", {
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

function compactStoryRelation(rel) {
  const r = rel || {};
  const c = r.candidate || {};
  return { relation: r.relation || "", reason: r.reason || "", queued: Boolean(r.queued), similarity: Number(r.similarity || 0), publishedTitle: c.title || "", candidateId: c.id || c.queueId || "" };
}

// One pass over the queue: a post that repeats an older queued or published
// story is removed (same check new posts get at collection time).
async function dedupeQueueOnce() {
  const items = (state.queue || []).filter(function(q){ return q && q.newsId && !q.telegramPublished && !q.vkPublished && q.status !== "media_failed"; })
    .sort(function(a, b){ return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(); });
  const removed = [];
  let incomplete = false;
  for (const item of items) {
    if (!(state.queue || []).includes(item)) continue;
    const olderQueue = (state.queue || []).filter(function(q){ return q !== item && new Date(q.createdAt || 0).getTime() <= new Date(item.createdAt || 0).getTime(); });
    const rel = await classifyPublishedStoryRelationship(item, { queueItems: olderQueue });
    if (rel && rel.similarity >= 0.16 && !rel.judged) incomplete = true;
    // The scheduler may have published the post while the model was thinking.
    if (!(state.queue || []).includes(item) || item.telegramPublished || item.vkPublished || item.status === "media_failed") continue;
    if (rel && rel.relation === "duplicate") {
      state.queue = (state.queue || []).filter(function(q){ return q !== item; });
      removeQueueIdFromSchedule(state, item.id);
      removed.push({ title: item.title, of: rel.candidate && rel.candidate.title || "" });
      if (db && dbReady) {
        try {
          await db.query("UPDATE news_items SET status='duplicate_story', metadata=COALESCE(metadata,'{}'::jsonb) || $2::jsonb, updated_at=NOW() WHERE id=$1 AND workspace_id=$3 AND status NOT IN ('published','media_failed')",
            [item.newsId, pgJsonString({ storyRelation: compactStoryRelation(rel), autoPublishBlocked: "duplicate_story" }), currentWorkspaceId()]);
        } catch (error) { console.warn("Queue dedupe status update failed:", error.message); }
      }
    }
  }
  if (removed.length) saveState();
  removed.incomplete = incomplete;
  return removed;
}

const STORY_CLASSIFIER_CANDIDATES = 3;

async function classifyPublishedStoryRelationship(item, options) {
  const queueItems = options && Array.isArray(options.queueItems) ? options.queueItems : (state.queue || []);
  if (!item) return { relation: "new_story", candidate: null, reason: "" };
  const cutoff = Date.now() - STORY_UPDATE_WINDOW_HOURS * 60 * 60 * 1000;

  const ownIds = new Set([item && item.id, item && item.queueId, item && item.newsId].filter(Boolean).map(String));
  // The new item may carry its own source text (original language); candidates are compared both ways, so a foreign
  // source is no longer measured only against the Russian text of a published post.
  const newAsText = Object.assign({}, item, { sourceId: "new:" + String(item.sourceId || item.sourceName || "") });
  const newAsSource = item.sourceOriginalText || item.sourceOriginalTitle
    ? Object.assign({}, item, { title: item.sourceOriginalTitle || item.title, text: item.sourceOriginalText || item.text, sourceId: "new:" + String(item.sourceId || item.sourceName || "") })
    : null;
  const scoreAgainst = function(candidate, prefix) {
    const cand = Object.assign({}, candidate, { sourceId: prefix + String(candidate.sourceId || candidate.sourceName || "") });
    let score = storySimilarity(newAsText, cand);
    const candSource = candidate.sourceOriginalText || candidate.sourceOriginalTitle
      ? Object.assign({}, cand, { title: candidate.sourceOriginalTitle || candidate.title, text: candidate.sourceOriginalText || candidate.text })
      : null;
    if (newAsSource) score = Math.max(score, storySimilarity(newAsSource, cand));
    if (candSource) {
      score = Math.max(score, storySimilarity(newAsText, candSource));
      if (newAsSource) score = Math.max(score, storySimilarity(newAsSource, candSource));
    }
    return score;
  };

  const ranked = [];
  for (const h of (state.history || [])) {
    if (!h || !h.publishedAt || new Date(h.publishedAt).getTime() < cutoff) continue;
    // A queued post that is already partly published (Telegram yes, VK pending)
    // must not be compared with its own history entry.
    if (ownIds.has(String(h.queueId || "")) || ownIds.has(String(h.newsId || "")) || ownIds.has(String(h.id || ""))) continue;
    ranked.push({ score: scoreAgainst(h, "published:"), candidate: h });
  }
  // Posts already waiting in the queue count too: the same story from two sources must not be published twice.
  // Only approved posts: a held / rejected twin is removed by the auto-resolver and must not swallow a good article.
  const selfIds = new Set([item.id, item.queueId, item.newsId].filter(Boolean).map(String));
  for (const q of queueItems) {
    if (!q || !q.newsId || selfIds.has(String(q.id)) || selfIds.has(String(q.newsId))) continue;
    if (!isApprovedQueueItem(q)) continue;
    ranked.push({ score: scoreAgainst(q, "queued:"), candidate: Object.assign({}, q, { __queued: true }) });
  }
  ranked.sort(function(a, b){ return b.score - a.score; });
  const candidates = ranked.filter(function(r){ return r.score >= 0.16; }).slice(0, STORY_CLASSIFIER_CANDIDATES);
  const bestScore = candidates.length ? candidates[0].score : 0;
  if (!candidates.length) return { relation: "new_story", candidate: null, reason: "" };

  if (!OPENAI_API_KEY) {
    const top = candidates[0];
    return top.score >= 0.55
      ? { relation: "possible_update", candidate: top.candidate, similarity: top.score, reason: "Похож на недавно опубликованный сюжет" }
      : { relation: "new_story", candidate: null, similarity: top.score, reason: "" };
  }

  let answered = 0;
  for (const entry of candidates) {
    const best = entry.candidate;
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
      const response = await llmResponsesFetch("https://api.openai.com/v1/responses", {
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
      answered += 1;
      const judgedRelation = ["duplicate","update","new_story"].includes(String(parsed.relation)) ? String(parsed.relation) : "new_story";
      let relation = judgedRelation;
      // An "update" of a post that has not been published yet is the same story:
      // the queued post goes out, the new one is dropped (or merged into it).
      if (best.__queued && relation === "update") relation = "duplicate";
      if (relation === "new_story") continue;
      return {
        relation: relation,
        judgedRelation: judgedRelation,
        candidate: best,
        queued: Boolean(best.__queued),
        similarity: entry.score,
        judged: true,
        newFact: String(parsed.new_fact || "").trim(),
        reason: String(parsed.reason || "").trim()
      };
    } catch (error) {
      console.warn("Story update classifier fallback:", error.message);
    }
  }
  if (answered === candidates.length) return { relation: "new_story", candidate: null, similarity: bestScore, judged: true, reason: "" };
  // Fail open (the post is treated as new) but leave a trace: some comparisons never got an answer.
  console.warn("STORY_CLASSIFIER_FAIL_OPEN " + JSON.stringify({ workspace: currentWorkspaceId(), candidates: candidates.length, answered: answered, similarity: Number(bestScore.toFixed(2)), title: String(item.title || "").slice(0, 80) }));
  return { relation: "new_story", candidate: null, similarity: bestScore, reason: "" };
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
      const response = await llmResponsesFetch("https://api.openai.com/v1/responses", {
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
      // The merge contract: only a post the writer actually produced (status ok) merges sources. Any skip is
      // "keep these as separate items": "different_story" is the documented reason, but the skip reason is free
      // Russian text (low importance, advertising, network duplicate...), so it cannot be matched by equality, and
      // absorbing the new source into the approved post on any other skip attached ad sources to it.
      console.log("STORY_MERGE_SKIPPED " + JSON.stringify({ workspace: currentWorkspaceId(), target: target.id, reason: String(storyV2.reason || "").slice(0, 120) }));
      return null;
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

  // Everything below mutates the queued post. If the merged text then fails the checkers, the post must come
  // back exactly as it was: overwriting an approved post with a hold/reject version got it auto-removed together
  // with the incoming article, and the story was lost.
  const targetBefore = Object.assign({}, target);

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

  const mergedApproved = storyV2
    ? (storyV2.meta && storyV2.meta.status === "approved")
    : (qc.qcStatus !== "hold");
  if (!mergedApproved) {
    Object.keys(target).forEach(function(key){ if (!(key in targetBefore)) delete target[key]; });
    Object.assign(target, targetBefore);
    console.warn("STORY_MERGE_REJECTED " + JSON.stringify({ workspace: currentWorkspaceId(), target: target.id, verdict: storyV2 && storyV2.meta && storyV2.meta.verdict || qc.qcStatus }));
    return null;
  }

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
      const response = await llmResponsesFetch("https://api.openai.com/v1/responses", {
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
      [t.id, pgJsonString({ titleRu: t.titleRu }), currentWorkspaceId()]
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
      const response = await llmResponsesFetch("https://api.openai.com/v1/responses", {
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
        [score.id, pgJsonString({
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

// Russian proxy health for the "Подключения" page: one live request through the proxy to a Russian site (cached 5 min),
// plus the routing counters of the source fetcher. Never exposes credentials: only host:port is shown.
let sourceProxyProbeCache = { at: 0, value: null };
const SOURCE_PROXY_PROBE_URL = process.env.SOURCE_PROXY_PROBE_URL || "https://www.cbr.ru/";
async function sourceProxyProbe(force) {
  if (!sourceProxy) return { enabled: false };
  const now = Date.now();
  if (!force && sourceProxyProbeCache.value && now - sourceProxyProbeCache.at < 5 * 60 * 1000) return sourceProxyProbeCache.value;
  const started = Date.now();
  let value;
  try {
    const response = await safeFetch(SOURCE_PROXY_PROBE_URL, { proxy: sourceProxy, timeoutMs: 8000, maxBytes: 300 * 1024 });
    value = { enabled: true, ok: response.status >= 200 && response.status < 400, status: response.status, ms: Date.now() - started };
    if (!value.ok) value.error = "HTTP " + response.status;
  } catch (error) {
    value = { enabled: true, ok: false, ms: Date.now() - started, error: String(error && error.message || error).slice(0, 160) };
  }
  sourceProxyProbeCache = { at: now, value: value };
  return value;
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

  const proxyProbe = await sourceProxyProbe(force);
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
        (editorialPromptError ? " · ошибка промпта: " + editorialPromptError : "") +
        (Object.keys(providerBreaker.snapshot()).length ? " · временно отключено (переключение на второго): " + Object.entries(providerBreaker.snapshot()).filter(function(e){ return e[1].open; }).map(function(e){ return alertProviderLabel(e[0]) + " — " + e[1].reason.slice(0, 80); }).join("; ") : ""),
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
    sourceProxy: (function(){
      const fs2 = sourceFetcher.stats();
      const counters = fs2.proxy_enabled ? ("через прокси: " + Number(fs2.proxy || 0) + " · сначала прокси: " + Number(fs2.proxyFirst || 0) + " · ошибок: " + Number(fs2.failed || 0)) : "";
      if (!sourceProxy) return { state: "missing", description: "Российский прокси не подключён", detail: "Сайты с блокировкой по зарубежным IP (Банки.ру, ЦБ, РБК и др.) не открываются", next: "Задать SOURCE_PROXY_URL в Railway" };
      if (!proxyProbe || !proxyProbe.ok) return { state: "partial", description: "Прокси задан, но проверочный запрос не прошёл", detail: String(sourceProxy.label || "") + " · " + String(proxyProbe && proxyProbe.error || "нет ответа") + (counters ? " · " + counters : ""), next: "Проверить доступность и оплату прокси" };
      return { state: "connected", description: "Российский прокси работает", detail: String(sourceProxy.label || "") + " · проверка " + new URL(SOURCE_PROXY_PROBE_URL).hostname + ": " + proxyProbe.status + " за " + proxyProbe.ms + " мс · " + counters, next: "" };
    })(),
    alerts: (function(){
      const chatId = TELEGRAM_ALERT_CHAT_ID || String(workspaceStore.workspaces.length && (getWorkspaceById(workspaceStore.defaultWorkspaceId) || workspaceStore.workspaces[0]).state.telegramAlertChatId || "").trim();
      const bot = botProbe && botProbe.ok && botProbe.result && botProbe.result.username ? "@" + botProbe.result.username : "бота News Factory";
      if (!BOT_TOKEN) return { state: "missing", description: "Оповещения невозможны: нет токена бота", detail: "", next: "Задать TELEGRAM_BOT_TOKEN" };
      if (!chatId) return { state: "missing", description: "Оповещения не доходят: бот не знает ваш личный чат", detail: "Сбой, кончившиеся кредиты ИИ, молчащие каналы и проблемы бэкапа сейчас никуда не отправляются", next: "Откройте " + bot + " в Telegram и нажмите «Старт» — привязка произойдёт автоматически за ~10 минут" };
      return { state: "connected", description: "Оповещения подключены (личный чат с ботом)", detail: "Приходят: кончились кредиты ИИ, канал молчит " + HEALTH_SILENCE_HOURS + "+ ч, сбой Postmypost / бота / прокси / базы, не удался бэкап" + (healthAlertsLast ? " · проверка " + Math.round((Date.now() - healthAlertsLast.at) / 60000) + " мин назад" : ""), next: "" };
    })(),
    postmypost: (function(){
      if (!POSTMYPOST_TOKEN) return { state: "missing", description: "Postmypost не подключён", detail: "VK-посты с фото публикуются только через Postmypost", next: "Задать POSTMYPOST_TOKEN в Railway" };
      if (!VK_VIA_POSTMYPOST) return { state: "partial", description: "Postmypost отключён переменной VK_VIA_POSTMYPOST=false", detail: "", next: "Убрать VK_VIA_POSTMYPOST=false" };
      const total = workspaceStore.workspaces.length;
      const mapped = workspaceStore.workspaces.filter(function(ws){ return postmypostMap.byWorkspace[ws.id]; });
      const without = workspaceStore.workspaces.filter(function(ws){ return !postmypostMap.byWorkspace[ws.id]; }).map(function(ws){ return ws.name; });
      const ageMin = postmypostMap.at ? Math.round((Date.now() - postmypostMap.at) / 60000) : null;
      const head = "VK-групп в Postmypost: " + mapped.length + " из " + total + (ageMin !== null ? " · проверено " + ageMin + " мин назад" : "");
      if (postmypostMap.error) return { state: "partial", description: "Postmypost не отвечает, используется последняя карта групп", detail: head + " · ошибка: " + postmypostMap.error.slice(0, 120), next: "Проверить POSTMYPOST_TOKEN и доступность postmypost.io" };
      if (!postmypostMap.at) return { state: "partial", description: "Postmypost ещё не проверен после запуска", detail: head, next: "" };
      if (without.length) return { state: "partial", description: "Postmypost работает, но не у всех каналов есть VK-группа", detail: head + " · без VK: " + without.slice(0, 6).join(", "), next: "Подключить эти группы в кабинете Postmypost" };
      const pend = pmpPendingSummary();
      if (pend.failed || pend.stuck) return { state: "partial", description: "Postmypost принял посты, но в VK они не вышли: зависло " + pend.stuck + ", с ошибкой " + pend.failed, detail: head + " · ждут: " + pend.waiting + " · самый старый " + pend.oldestMin + " мин", next: "Открыть кабинет Postmypost: проверить подключение VK-групп и очередь публикаций" };
      return { state: "connected", description: "Postmypost: публикация в VK работает", detail: head + (pend.waiting ? " · в очереди Postmypost: " + pend.waiting : ""), next: "" };
    })(),
    processHealth: (function(){
      const lag = loopLagHistogram ? Math.round(loopLagHistogram.percentile(99) / 1e6) : 0;
      const rss = Math.round(process.memoryUsage().rss / 1048576);
      const up = Math.round(process.uptime() / 60);
      const detail = "аптайм " + (up >= 120 ? Math.round(up / 60) + " ч" : up + " мин") + " · память " + rss + " МБ · задержка цикла p99 " + lag + " мс · необработанных ошибок: " + processFaults.rejections + " · критических: " + processFaults.exceptions;
      if (processFaults.exceptions > 0 || lag > 2000 || rss > 1800) return { state: "partial", description: "Процесс работает, но есть признаки перегрузки или ошибок", detail: detail, next: "Посмотреть логи PROCESS_UNHANDLED_*" };
      return { state: "connected", description: "Процесс стабилен", detail: detail, next: "" };
    })(),
    backup: (function(){
      const cfg = backupConfig();
      if (!cfg) return { state: "missing", description: "Внешние резервные копии не настроены", detail: "Данные хранятся только на томе Railway", next: "Задать BACKUP_S3_* и BACKUP_ENCRYPTION_KEY в Railway" };
      const problem = backupConfigProblem(cfg);
      if (problem) return { state: "partial", description: "Резервные копии настроены неверно", detail: String(problem), next: "Проверить BACKUP_ENCRYPTION_KEY (не короче 16 символов)" };
      const st = readBackupStatus();
      const last = st.lastSuccessAt ? Date.parse(st.lastSuccessAt) : 0;
      const ageH = last ? Math.round((Date.now() - last) / 3600000) : null;
      const base = (last ? "последняя успешная: " + new Date(last).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) + " МСК (" + ageH + " ч назад) · " + Math.round(Number(st.lastBytes || 0) / 1024) + " КБ · каналов: " + Number(st.workspaces || 0) : "ещё не было успешной копии") + " · раз в " + cfg.intervalHours + " ч · " + (cfg.passphrase ? "зашифровано" : "без шифрования");
      if (Number(st.consecutiveFailures || 0) > 0 || !last || ageH > cfg.intervalHours * 1.5 + 2) return { state: "partial", description: "Резервная копия давно не обновлялась или была ошибка", detail: base + (st.lastError ? " · ошибка: " + String(st.lastError).slice(0, 120) : ""), next: "Проверить доступ к хранилищу копий" };
      return { state: "connected", description: "Резервные копии делаются по расписанию", detail: base, next: "" };
    })(),
    migrations: (function(){
      if (!db) return { state: "missing", description: "База данных не подключена, миграции не применялись", detail: "", next: "" };
      const m = migrationStatus();
      if (!m.ranAt) return { state: "partial", description: "Миграции ещё не запускались", detail: "", next: "Дождаться старта сервиса" };
      const detail = "применено файлов: " + m.total + (m.newlyApplied && m.newlyApplied.length ? " · при этом старте новых: " + m.newlyApplied.length : "");
      if (m.error || (m.drift && m.drift.length) || (m.missingFiles && m.missingFiles.length)) return { state: "partial", description: m.error || "Применённая миграция изменена или её файл пропал", detail: detail + (m.drift && m.drift.length ? " · изменены: " + m.drift.join(", ") : "") + (m.missingFiles && m.missingFiles.length ? " · нет файла: " + m.missingFiles.join(", ") : ""), next: "Не править применённые миграции, добавлять новую" };
      return { state: "connected", description: "Миграции БД применены, файлы не менялись", detail: detail, next: "" };
    })(),
    channelConfig: (function(){
      const r = channelConfigReport();
      const worst = r.channels.filter(function(c){ return c.issues.some(function(i){ return i.level !== "info"; }); });
      const detail = "каналов: " + r.channels.length + " · ошибок: " + r.errors + " · предупреждений: " + r.warnings + (worst.length ? " · " + worst.slice(0, 4).map(function(c){ const i = c.issues.find(function(x){ return x.level !== "info"; }); return c.name + ": " + i.text; }).join("; ") : "");
      if (r.errors) return { state: "failed", description: "В конфигурации каналов есть ошибки", detail: detail, next: "Открыть /api/channels/config и исправить расхождения" };
      if (r.warnings || r.orphanRecovery.length) return { state: "partial", description: "Конфигурация каналов с предупреждениями", detail: detail + (r.orphanRecovery.length ? " · нет в хранилище: " + r.orphanRecovery.join(", ") : ""), next: "Проверить предупреждения" };
      return { state: "connected", description: "Конфигурация каналов согласована", detail: detail, next: "" };
    })(),
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

    const secHeaders = baseSecurityHeaders(p);
    for (const name of Object.keys(secHeaders)) res.setHeader(name, secHeaders[name]);
    // CSRF defence in depth on top of SameSite=Strict: a state-changing request from a browser must come from this site.
    if (!originAllowed(req, [new URL(PUBLIC_BASE_URL).host])) {
      return sendJson(res, 403, { ok: false, error: "cross-origin request refused" });
    }

    if (req.method === "GET" && p === "/health") {
      // Public: liveness + version only (no model names, counts or configuration flags). Details live behind /api/status.
      return sendJson(res, 200, { ok: true, service: "news-factory", version: APP_VERSION });
    }

    if ((req.method === "GET" || req.method === "HEAD") && p.startsWith("/p/")) {
      let slug = "";
      try { slug = decodeURIComponent(p.slice("/p/".length)); } catch { return sendJson(res, 400, { ok: false, error: "invalid page path" }); }
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
      let fileName = "";
      try { fileName = decodeURIComponent(p.slice("/media/".length)); } catch { return sendJson(res, 400, { ok: false, error: "invalid media path" }); }
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
      const loginIp = requestClientIp(req);
      const loginGate = authFailureLimiter.check(loginIp);
      if (!loginGate.allowed) {
        return sendJson(res, 429, { ok: false, error: "too many attempts" }, { "retry-after": String(loginGate.retryAfterSec), "cache-control": "no-store" });
      }
      const body = await readJsonObject(req);
      // Check again after the body arrived: hundreds of parallel requests all passed the first check before any
      // failure was booked, so the lockout never engaged. From here to the verdict everything is synchronous.
      const loginGateAfterBody = authFailureLimiter.check(loginIp);
      if (!loginGateAfterBody.allowed) {
        return sendJson(res, 429, { ok: false, error: "too many attempts" }, { "retry-after": String(loginGateAfterBody.retryAfterSec), "cache-control": "no-store" });
      }
      const providedPassword = String(body.password == null ? "" : body.password).slice(0, 1024);
      let passwordOk = false;
      if (ADMIN_UI_PASSWORD_SCRYPT) {
        passwordOk = verifyPasswordScrypt(providedPassword, ADMIN_UI_PASSWORD_SCRYPT);
      } else if (/^[a-f0-9]{64}$/.test(ADMIN_UI_PASSWORD_SHA256)) {
        // legacy unsalted SHA-256 stays supported; prefer ADMIN_UI_PASSWORD_SCRYPT
        const providedHash = crypto.createHash("sha256").update(providedPassword).digest("hex");
        passwordOk = crypto.timingSafeEqual(Buffer.from(providedHash, "hex"), Buffer.from(ADMIN_UI_PASSWORD_SHA256, "hex"));
      } else if (ADMIN_UI_PASSWORD) {
        passwordOk = safeEqual(providedPassword, ADMIN_UI_PASSWORD);
      }
      if (!passwordOk) {
        authFailureLimiter.fail(loginIp);
        return sendJson(res, 401, { ok: false, error: "invalid password" });
      }
      authFailureLimiter.success(loginIp);
      return sendJson(res, 200, { ok: true }, {
        "set-cookie": "nf_session=" + sessionToken() + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000"
      });
    }

    if (req.method === "POST" && p === "/api/logout") {
      // {"everywhere": true} (authenticated) rotates the session epoch: every issued cookie stops working.
      let everywhere = false;
      if (isAuthed(req)) {
        try { const b = await readJsonObject(req); everywhere = b.everywhere === true; } catch {}
      }
      if (everywhere) getSessionEpochStore().bump();
      return sendJson(res, 200, { ok: true, everywhere: everywhere }, {
        "set-cookie": "nf_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
      });
    }

    if (req.method === "POST" && p === "/internal/vk-preview-test-page") {
      const internalGate = authFailureLimiter.check(requestClientIp(req));
      if (!internalGate.allowed) return sendJson(res, 429, { ok: false, error: "too many attempts" }, { "retry-after": String(internalGate.retryAfterSec) });
      const smokeAuthorized = safeEqual(req.headers["x-admin-key"], ADMIN_KEY) ||
        (VK_OAUTH_HANDOFF_SECRET && secretMatches(req.headers["x-oauth-handoff-secret"], VK_OAUTH_HANDOFF_SECRET));
      if (!smokeAuthorized) {
        authFailureLimiter.fail(requestClientIp(req));
        return sendJson(res, 401, { ok: false, error: "unauthorized" });
      }
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
        console.error("vk-preview-test-page failed:", error);
        return sendJson(res, 500, { ok: false, error: "internal error" }, { "cache-control": "no-store" });
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
      const captureIp = requestClientIp(req);
      const captureGate = authFailureLimiter.check(captureIp);
      if (!captureGate.allowed) return sendJson(res, 429, { ok: false, error: "too many attempts" }, { "retry-after": String(captureGate.retryAfterSec) });
      if (!vkOAuthCallerAuthorized(req)) {
        if (req.headers["x-admin-key"] || req.headers["x-oauth-handoff-secret"]) authFailureLimiter.fail(captureIp);
        return sendJson(res, 401, { ok: false, error: "unauthorized" });
      }
      try {
        const body = await readJsonObject(req);
        await captureVkOAuthToken(body.accessToken, body.state, body.userId);
        return sendJson(res, 200, { ok: true, verified: true });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: String(error && error.message || error) });
      }
    }

    if (req.method === "GET" && p === "/api/vk/oauth/handoff") {
      if (!VK_OAUTH_HANDOFF_SECRET) return sendJson(res, 503, { ok: false, error: "handoff is not configured" });
      const provided = String(req.headers["x-oauth-handoff-secret"] || "");
      const handoffIp = requestClientIp(req);
      const handoffGate = authFailureLimiter.check(handoffIp);
      if (!handoffGate.allowed) return sendJson(res, 429, { ok: false, error: "too many attempts" }, { "retry-after": String(handoffGate.retryAfterSec) });
      if (!secretMatches(provided, VK_OAUTH_HANDOFF_SECRET)) {
        authFailureLimiter.fail(handoffIp);
        return sendJson(res, 401, { ok: false, error: "unauthorized" });
      }
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
      // Starting a session overwrites the global OAuth state and reveals the state value: authorised callers only.
      if (!vkOAuthCallerAuthorized(req)) {
        if (req.headers["x-admin-key"] || req.headers["x-oauth-handoff-secret"]) authFailureLimiter.fail(requestClientIp(req));
        return sendJson(res, 401, { ok: false, error: "unauthorized" });
      }
      try {
        return redirect(res, buildVkOAuthUrl());
      } catch (error) {
        console.error("vk oauth start failed:", error);
        return sendJson(res, 500, { ok: false, error: "VK OAuth is not configured" });
      }
    }

    if (p.startsWith("/api/") && !requireAuth(req, res)) return;

    const requestedWorkspaceId = String(req.headers["x-workspace-id"] || url.searchParams.get("workspace") || "").trim();
    // A named but unknown workspace (deleted channel, stale tab, typo) must not silently act on the default
    // channel: a publish or a write would land in the wrong Telegram channel. Only the cabinet list itself
    // tolerates it, because the admin UI uses that call to repair a stale selection.
    if (requestedWorkspaceId && !getWorkspaceById(requestedWorkspaceId) && !(req.method === "GET" && p === "/api/workspaces")) {
      return sendJson(res, 404, { ok: false, code: "unknown_workspace", error: "Неизвестный канал: " + requestedWorkspaceId.slice(0, 64) });
    }
    const selectedWorkspace = getWorkspaceById(requestedWorkspaceId) || getWorkspaceById(workspaceStore.defaultWorkspaceId) || workspaceStore.workspaces[0];
    workspaceContext.enterWith({ workspaceId: selectedWorkspace.id });

    if (req.method === "GET" && p === "/api/costs") {
      const days = Number(url.searchParams.get("days") || 30);
      const scope = String(url.searchParams.get("scope") || "network").toLowerCase() === "workspace" ? "workspace" : "network";
      const period = String(url.searchParams.get("period") || "").toLowerCase();
      return sendJson(res, 200, await buildCostsReport(days, scope, currentWorkspaceId(), period), { "cache-control": "no-store" });
    }
    if (req.method === "POST" && p === "/api/costs/budget") {
      const body = await readJsonObject(req);
      const b = networkCostBudgetState();
      if (Object.prototype.hasOwnProperty.call(body,"monthlyRub")) b.monthlyRub = Math.max(0, Number(body.monthlyRub || 0) || 0);
      if (Object.prototype.hasOwnProperty.call(body,"dailyRub")) b.dailyRub = Math.max(0, Number(body.dailyRub || 0) || 0);
      b.updatedAt = new Date().toISOString();
      persistWorkspaceStore();
      return sendJson(res,200,{ok:true,budget:await evaluateCostBudget(true)});
    }
    if (req.method === "POST" && p === "/api/costs/balance") {
      const body = await readJsonObject(req);
      const provider = String(body && body.provider || "").toLowerCase();
      const stored = networkApiBalances();
      const parsed = normalizeBalanceInput(provider, body, stored[provider], new Date());
      if (!parsed.ok) return sendJson(res, 400, { ok: false, error: parsed.error });
      if (parsed.clear) delete stored[provider];
      else stored[provider] = parsed.value;
      persistWorkspaceStore();
      return sendJson(res, 200, { ok: true, balances: await apiBalanceSnapshot() }, { "cache-control": "no-store" });
    }

    if (req.method === "GET" && p === "/api/editorial/registry") {
      return sendJson(res, 200, { ok: true, registry: loadEditorialRegistry() });
    }
    if ((req.method === "POST" || req.method === "PUT") && p === "/api/editorial/registry") {
      const body = await readJsonObject(req, 4 * 1024 * 1024);
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
    if (req.method === "GET" && p === "/api/editorial/qa") {
      return sendJson(res, 200, {
        ok: true,
        qa: editorialQaState,
        publicationCoverage: publicationCoverageSnapshot()
      });
    }
    if (req.method === "POST" && p === "/api/editorial/qa/run") {
      if (editorialQaState.status === "running") {
        return sendJson(res, 202, { ok: true, started: false, qa: editorialQaState });
      }
      runEditorialQaNetwork().catch(function(error){
        editorialQaState.status = "error";
        editorialQaState.error = String(error && error.message || error);
        editorialQaState.finishedAt = new Date().toISOString();
      });
      return sendJson(res, 202, { ok: true, started: true });
    }
    if (req.method === "POST" && p === "/api/editorial/repair-current-slot") {
      await catchUpCurrentRegularSlotAllWorkspaces();
      return sendJson(res, 200, { ok: true, publicationCoverage: publicationCoverageSnapshot() });
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
      return sendJson(res, 200, { ok: true, activeWorkspaceId: currentWorkspaceId(), defaultWorkspaceId: workspaceStore.defaultWorkspaceId, profiles: EDITORIAL_CHANNEL_IDS, workspaces: workspaceStore.workspaces.map(function(ws){ return Object.assign(publicWorkspaceMeta(ws), { summary: workspaceSummary(ws) }); }) });
    }
    if (req.method === "GET" && p === "/api/channels/config") {
      return sendJson(res, 200, Object.assign({ ok: true }, channelConfigReport()));
    }
    if (req.method === "GET" && p === "/api/network/day") {
      const rawDate = String(url.searchParams.get("date") || "").trim();
      const dateKey = rawDate || moscowDateKey(new Date());
      if (!isDateKey(dateKey)) return sendJson(res, 400, { ok: false, error: "date must be YYYY-MM-DD" });
      const rows = workspaceStore.workspaces.map(function(ws){
        const summary = workspaceSummary(ws);
        return { id: ws.id, name: ws.name, handle: telegramUsernameOrEmpty(ws.telegramPublicUsername) || telegramUsernameOrEmpty(ws.slug) || "", autoPublish: summary.autoPublish, mode: summary.mode, plannedPerDay: summary.plannedPerDay, queue: summary.queue, history: ws.state && ws.state.history };
      });
      return sendJson(res, 200, Object.assign({ ok: true, historyLimitNote: "В истории каждого канала хранятся последние 300 постов; более старые дни могут быть неполными." }, networkDay(rows, dateKey, Date.now())));
    }
    if (req.method === "POST" && p === "/api/workspaces") {
      const body = await readJsonObject(req);
      const name = String(body.name || "").trim().slice(0, 80);
      if (!name) return sendJson(res, 400, { ok: false, error: "Укажите название канала" });
      const requestedProfile = String(body.channelId || "").trim().toLowerCase();
      if (requestedProfile && !EDITORIAL_CHANNEL_IDS.includes(requestedProfile)) return sendJson(res, 400, { ok: false, error: "Неизвестный профиль канала: " + requestedProfile.slice(0, 40) });
      const tgChannel = normalizeTelegramChannelInput(body.telegramChannel || body.telegramPublicUsername || "");
      const handle = /^@[A-Za-z0-9_]+$/.test(tgChannel) ? tgChannel.slice(1) : "";
      let username = String(normalizeTelegramChannelInput(body.telegramPublicUsername || "")).replace(/^@/, "").trim();
      if (!/^[A-Za-z0-9_]+$/.test(username)) username = handle;
      let slug = String(body.slug || "").replace(/^@/, "").trim();
      if (!/^[A-Za-z0-9_-]+$/.test(slug)) slug = username;
      // id только из латиницы/цифр: normalizeWorkspaceMeta всё остальное вырезает, и id мог совпасть с существующим.
      const base = String(slug || username || name).toLowerCase().replace(/^@/, "").replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "channel";
      const sharedChat = findWorkspaceByTelegramChat(tgChannel, "");
      if (sharedChat) return sendJson(res, 409, { ok: false, error: "Этот Telegram-канал уже подключён к кабинету «" + sharedChat.name + "»", conflictWorkspaceId: sharedChat.id });
      let id = base, suffix = 2;
      while (getWorkspaceById(id)) id = base + "-" + suffix++;
      const workspace = normalizeWorkspaceMeta({
        id: id, name: name,
        slug: slug,
        initials: String(body.initials || "").trim(),
        telegramChannel: tgChannel,
        telegramPublicUsername: username,
        channelId: String(body.channelId || "").trim().toLowerCase(),
        state: freshWorkspaceState()
      }, id);
      workspaceStore.workspaces.push(workspace);
      persistWorkspaceStore();
      return sendJson(res, 201, { ok: true, workspace: publicWorkspaceMeta(workspace) });
    }
    if (req.method === "POST" && p === "/api/workspaces/update") {
      const body = await readJsonObject(req);
      const workspace = getWorkspaceById(String(body.id || currentWorkspaceId()));
      if (!workspace) return sendJson(res, 404, { ok: false, error: "Кабинет не найден" });
      if (body.telegramChannel != null) {
        const nextChannel = normalizeTelegramChannelInput(body.telegramChannel);
        const sharedChat = telegramChatKey(nextChannel) !== telegramChatKey(workspace.telegramChannel) ? findWorkspaceByTelegramChat(nextChannel, workspace.id) : null;
        if (sharedChat) return sendJson(res, 409, { ok: false, error: "Этот Telegram-канал уже подключён к кабинету «" + sharedChat.name + "»", conflictWorkspaceId: sharedChat.id });
      }
      if (body.name != null) workspace.name = String(body.name || "").trim().slice(0, 80) || workspace.name;
      if (body.initials != null) workspace.initials = String(body.initials || "").trim().toUpperCase().replace(/[^A-ZА-Я0-9]/gi, "").slice(0, 3) || workspace.initials;
      if (body.slug != null) workspace.slug = String(body.slug || "").replace(/^@/, "").trim().slice(0, 80);
      if (body.telegramChannel != null) workspace.telegramChannel = normalizeTelegramChannelInput(body.telegramChannel);
      if (body.telegramPublicUsername != null) workspace.telegramPublicUsername = String(body.telegramPublicUsername || "").replace(/^@/, "").trim();
      if (!workspace.telegramPublicUsername && /^@[A-Za-z0-9_]+$/.test(workspace.telegramChannel || "")) workspace.telegramPublicUsername = workspace.telegramChannel.slice(1);
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
      const body = await readJsonObject(req, 10 * 1024 * 1024);
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
      const body = await readJsonObject(req);
      const workspace = getWorkspaceById(String(body.id || currentWorkspaceId()));
      if (!workspace) return sendJson(res, 404, { ok: false, error: "Кабинет не найден" });
      removeWorkspaceAvatar(workspace);
      return sendJson(res, 200, { ok: true, workspace: publicWorkspaceMeta(workspace) });
    }

    if (req.method === "GET" && p === "/api/backup/status") {
      const cfg = backupConfig();
      return sendJson(res, 200, { ok: true, configured: Boolean(cfg), problem: backupConfigProblem(cfg), intervalHours: cfg ? cfg.intervalHours : null, encrypted: Boolean(cfg && cfg.passphrase), status: readBackupStatus(), watchdog: workspaceWatchdogLast });
    }

    if (req.method === "POST" && p === "/api/backup/run") {
      const result = await runOffsiteBackup("manual");
      return sendJson(res, result.ok ? 200 : 502, Object.assign({ ok: false }, result));
    }

    if (req.method === "POST" && p === "/api/workspaces/remove") {
      const body = await readJsonObject(req), id = String(body.id || "");
      if (!id || id === workspaceStore.defaultWorkspaceId) return sendJson(res, 400, { ok: false, error: "Основной кабинет удалить нельзя" });
      const deletingWorkspace = getWorkspaceById(id);
      if (!deletingWorkspace) return sendJson(res, 404, { ok: false, error: "Кабинет не найден" });
      removeWorkspaceAvatar(deletingWorkspace);
      workspaceStore.workspaces = workspaceStore.workspaces.filter(function(ws){ return ws.id !== id; });
      persistWorkspaceStore();
      // A deliberate removal must not trigger the "workspace vanished" alert.
      if (db && dbReady) db.query("UPDATE workspace_registry SET removed_at=NOW() WHERE id=$1", [id]).catch(function(error){ console.warn("workspace_registry update failed:", error.message); });
      statusCache.delete(id); analyticsCache.delete(id);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && p === "/api/media/enhance-queue") {
      const body = await readJsonObject(req);
      const result = await backfillQueueImageEnhancements({ force: Boolean(body && body.force) });
      return sendJson(res, 200, { ok: true, result: result });
    }

    if (req.method === "GET" && p === "/api/dashboard") {
      const cleanup = pruneQueueItems(state);
      const calendarReserved = ensureScheduleAssignments(state, moscowDateKey(new Date()));
      if (cleanup.removed || calendarReserved) saveState();
      for (const item of (state.queue || [])) {
        if (!item) continue;
        item.priorityScore = Math.round(dynamicItemScore(item));
        item.decisionExplanation = buildDecisionExplanation(item);
        item.decisionExplanation.priorityScore = item.priorityScore;
      }
      return sendJson(res, 200, { ok: true, state: state, workspace: publicWorkspaceMeta(currentWorkspace()), sourceRankings: buildSourceRankings(), rubricGroups: rubricGroupsInfo(), itemRubrics: itemRubricsMap(), postCosts: await postCostsMap(), ratingMinAuto: POST_RATING_MIN_AUTO, ratingDropBelow: POST_RATING_DROP_BELOW });
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
      const body = await readJsonObject(req);
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

      removeQueueIdFromSchedule(state, queueId);
      const slot = (schedule.slots || []).find(function(entry){ return entry && entry.time === time; });
      setDynamicAssignment(day, time, item, dynamicSlotKind(slot), "manual");
      saveState();
      return sendJson(res, 200, { ok: true, assignment: { date: day, time: time, queueId: queueId } });
    }

    if (req.method === "POST" && p === "/api/calendar/remove") {
      const body = await readJsonObject(req);
      const day = String(body.date || "");
      const time = String(body.time || "");
      // date/time become object keys below: only YYYY-MM-DD / HH:MM (blocks "__proto__", "constructor", ...)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return sendJson(res, 400, { ok: false, error: "Некорректная дата" });
      if (!/^\d{2}:\d{2}$/.test(time)) return sendJson(res, 400, { ok: false, error: "Некорректное время" });
      const schedule = ensureScheduleShape(state);
      const oldId = schedule.assignments[day] && schedule.assignments[day][time];
      const oldItem = oldId && (state.queue || []).find(function(q){ return q && q.id === oldId; });
      if (schedule.assignments[day]) delete schedule.assignments[day][time];
      clearDynamicAssignmentMarkers(oldItem, day + " " + time);
      if (!schedule.suppressed[day]) schedule.suppressed[day] = {};
      schedule.suppressed[day][time] = true;
      saveState();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && p === "/api/calendar/auto") {
      const body = await readJsonObject(req);
      const day = String(body.date || moscowDateKey(new Date()));
      const time = String(body.time || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return sendJson(res, 400, { ok: false, error: "Некорректная дата" });
      if (!/^\d{2}:\d{2}$/.test(time)) return sendJson(res, 400, { ok: false, error: "Некорректное время" });
      const schedule = ensureScheduleShape(state);
      if (!schedule.suppressed[day]) schedule.suppressed[day] = {};
      delete schedule.suppressed[day][time];
      const oldId = schedule.assignments[day] && schedule.assignments[day][time];
      const oldItem = oldId && (state.queue || []).find(function(q){ return q && q.id === oldId; });
      if (schedule.assignments[day]) delete schedule.assignments[day][time];
      clearDynamicAssignmentMarkers(oldItem, day + " " + time);
      const slot = (schedule.slots || []).find(function(entry){ return entry && entry.time === time; });
      const pickKind = dynamicSlotKind(slot);
      const item = dynamicReserveBest(day, time, pickKind);
      return sendJson(res, 200, { ok: true, assignment: item ? { date: day, time: time, queueId: item.id } : null });
    }

    if (req.method === "GET" && p === "/api/analytics") {
      const force = url.searchParams.get("refresh") === "1";
      const analytics = await buildPlatformAnalytics(force);
      return sendJson(res, 200, analytics);
    }

    if (req.method === "GET" && p === "/api/promotion") {
      const force = url.searchParams.get("refresh") === "1";
      const report = await buildPromotionReport(force);
      return sendJson(res, 200, report, { "cache-control": "no-store" });
    }

    if (req.method === "POST" && p === "/api/promotion/campaigns") {
      if (!db || !dbReady) return sendJson(res, 503, { ok: false, error: "PostgreSQL временно недоступен" });
      const body = await readJson(req);
      const name = String(body.name || "").trim().slice(0, 120);
      if (!name) return sendJson(res, 400, { ok: false, error: "Укажите название кампании" });
      const platform = ["telegram","vk","cross"].includes(String(body.platform || "").toLowerCase()) ? String(body.platform).toLowerCase() : "telegram";
      const sourceType = ["seeding","reels","shorts","vk","crosspromo","blogger","other"].includes(String(body.sourceType || "").toLowerCase()) ? String(body.sourceType).toLowerCase() : "other";
      const sourceName = String(body.sourceName || "").trim().slice(0, 160);
      const spendRub = Math.max(0, Math.min(100000000, Number(body.spendRub || 0) || 0));
      const clicks = Math.max(0, Math.min(100000000, Math.round(Number(body.clicks || 0) || 0)));
      const attributedSubscribers = Math.max(0, Math.min(100000000, Math.round(Number(body.attributedSubscribers || 0) || 0)));
      const id = newId("promo");
      await db.query(
        "INSERT INTO promotion_campaigns(id,workspace_id,name,platform,source_type,source_name,spend_rub,clicks,attributed_subscribers,status) " +
        "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'active')",
        [id,currentWorkspaceId(),name,platform,sourceType,sourceName,spendRub,clicks,attributedSubscribers]
      );
      return sendJson(res, 201, { ok: true, id: id });
    }

    if (req.method === "POST" && p === "/api/promotion/creative") {
      const creative = await generatePromotionCreative();
      return sendJson(res, 200, { ok: true, creative: creative });
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
      const body = await readJsonObject(req);
      const result = await callOpenAIRewrite(body);
      state.stats.rewritten += 1;
      saveState();
      return sendJson(res, 200, { ok: true, result: result });
    }

    if (req.method === "POST" && p === "/api/mode") {
      const body = await readJsonObject(req);
      const mode = String(body.mode || "");
      if (!["AUTO", "REVIEW", "PAUSED"].includes(mode)) {
        return sendJson(res, 400, { ok: false, error: "invalid mode" });
      }
      state.mode = mode;
      if (state.autoGate && state.autoGate.pending) state.autoGate = Object.assign({}, state.autoGate, { pending: false, manualAt: new Date().toISOString() });
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
      const body = await readJsonObject(req);
      const topicId = String(body.topicId || body.topic_id || "default").trim() || "default";
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(topicId) || isReservedKey(topicId)) return sendJson(res, 400, { ok: false, error: "Некорректный topicId" });
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
        if (state.autoGate && state.autoGate.pending) state.autoGate = Object.assign({}, state.autoGate, { pending: false, manualAt: new Date().toISOString() });
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
      state.history = state.history.slice(0, 300);
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
      const body = await readJsonObject(req);
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
      state.history = state.history.slice(0, 300);
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
      const body = await readJsonObject(req);
      const name = String(body.name || "").trim();
      const sourceUrl = String(body.url || "").trim();
      if (!name || !sourceUrl) return sendJson(res, 400, { ok: false, error: "Заполните название и ссылку" });
      if (name.length > 200) return sendJson(res, 400, { ok: false, error: "Название не длиннее 200 символов" });
      if (sourceUrl.length > 2000) return sendJson(res, 400, { ok: false, error: "Ссылка не длиннее 2000 символов" });
      try { validateFetchUrl(sourceUrl); } // http(s) only, no credentials, allowed ports, no internal addresses
      catch (error) { return sendJson(res, 400, { ok: false, error: "Некорректная ссылка: " + (error && error.message || "разрешены только http/https") }); }
      state.sources.push({ id: newId("src"), name: name, type: "web", group: "custom", priority: 3, url: sourceUrl, enabled: true, mediaLicense: "unknown", copyrightMode: "facts_only" });
      saveState();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && p === "/api/report/daily") {
      let result;
      try { result = await sendDailyReport(true); } catch (error) { result = { ok: false, error: error.message }; }
      return sendJson(res, result.ok ? 200 : 409, result);
    }
    if (req.method === "POST" && p === "/api/digest/publish") {
      const body = await readJsonObject(req);
      const result = await publishDigest(body.kind === "sunday" ? "sunday" : "evening", body.force === true);
      return sendJson(res, result.ok ? 200 : 409, result);
    }

    if (req.method === "POST" && p === "/api/sources/target") {
      const body = await readJsonObject(req);
      const target = Math.max(0, Math.min(200, Math.round(Number(body.target))));
      if (!Number.isFinite(target)) return sendJson(res, 400, { ok: false, error: "Укажите число" });
      state.sourceTarget = target;
      if (state.sourceReplenish) state.sourceReplenish.lastAt = "";
      saveState();
      const result = await replenishSources("target_changed");
      return sendJson(res, 200, { ok: true, target: target, result: result });
    }

    if (req.method === "POST" && p === "/api/sources/rubric-limit") {
      const body = await readJsonObject(req);
      const set = setRubricLimit(String(body.rubric || ""), body.min);
      if (!set.ok) return sendJson(res, 400, set);
      saveState();
      let result = null;
      if (set.search) { try { result = await replenishSources("rubric_limit_changed"); } catch (error) { result = { error: error.message }; } }
      return sendJson(res, 200, { ok: true, rubric: set.rubric, min: set.min, changed: set.changed, searched: !!set.search, result: result });
    }

    if (req.method === "POST" && p === "/api/sources/media-license") {
      const body = await readJsonObject(req);
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
      const body = await readJsonObject(req);
      const src = state.sources.find(function(x){ return x.id === body.id; });
      if (!src) return sendJson(res, 404, { ok: false, error: "Источник не найден" });
      src.enabled = !src.enabled;
      if (src.enabled) {
        // Turned on by the editor: forget the automatic pause and its history.
        delete src.autoPaused;
        src.editorEnabledAt = new Date().toISOString();
        delete src.probationUntil; // the editor vouched for it: no trial
        const stat = ensureSourceStat(src);
        if (stat) { stat.recent = []; stat.errorStreak = 0; }
      }
      saveState();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && p === "/api/sources/remove") {
      const body = await readJsonObject(req);
      const removed = state.sources.find(function(x){ return x.id === body.id; });
      // A source the editor removed is never re-added automatically.
      const removedHost = removed && sourceKey(removed.url);
      if (removedHost) {
        state.sourceBlockedHosts = Array.isArray(state.sourceBlockedHosts) ? state.sourceBlockedHosts : [];
        if (!state.sourceBlockedHosts.includes(removedHost)) state.sourceBlockedHosts.push(removedHost);
      }
      state.sources = state.sources.filter(function(x){ return x.id !== body.id; });
      if (state.sourceStats && body.id && !isReservedKey(body.id)) delete state.sourceStats[String(body.id)];
      saveState();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && p === "/api/queue") {
      const body = await readJsonObject(req);
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
      const body = await readJsonObject(req);
      state.queue = state.queue.filter(function(x){ return x.id !== body.id; });
      removeQueueIdFromSchedule(state, body.id);
      ensureScheduleAssignments(state);
      saveState();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && p === "/api/queue/enhance-media") {
      const body = await readJsonObject(req);
      const item = (state.queue || []).find(function(x){ return x.id === body.id; });
      if (!item) return sendJson(res, 404, { ok: false, error: "Новость не найдена в очереди" });
      if (item.videoUrl) return sendJson(res, 409, { ok: false, error: "Для этой новости приоритет уже у видео — отдельная обложка не требуется" });

      const requestedMode = String(body.mode || "fresh").toLowerCase() === "reference" ? "reference" : "fresh";
      const sourceImage = String(item.originalImageUrl || item.cachedSourceImageUrl || item.enhancedImageUrl || item.imageUrl || "").trim();
      const license = sourceMediaLicense(item);

      const persistMediaMetadata = async function(patch) {
        if (!(db && dbReady && item.newsId)) return;
        try {
          const row = await db.query("SELECT metadata FROM news_items WHERE id=$1 AND workspace_id=$2 LIMIT 1", [item.newsId, currentWorkspaceId()]);
          if (!row.rowCount) return;
          const metadata = Object.assign({}, row.rows[0].metadata || {}, patch || {});
          await db.query("UPDATE news_items SET metadata=$2::jsonb WHERE id=$1 AND workspace_id=$3", [item.newsId, pgJsonString(metadata), currentWorkspaceId()]);
        } catch (error) {
          console.warn("QUEUE_COVER_METADATA_SYNC_FAILED " + JSON.stringify({
            workspace: currentWorkspaceId(),
            id: item.newsId || item.id,
            error: String(error && error.message || error).slice(0, 220)
          }));
        }
      };

      try {
        const generation = Number(item.coverGenerationCount || 0) + 1;
        const payload = {
          id: item.newsId || item.id,
          newsId: item.newsId || item.id,
          title: item.title,
          text: item.text,
          sourceName: item.sourceName || "",
          topicId: item.topicId || currentWorkspace().channelId || "",
          visualIndex: generation,
          forceAi: true,
          costPurpose: "image_generation"
        };

        let generated = null;
        let modeUsed = "generated";
        let fallbackReason = "";

        if (requestedMode === "reference") {
          if (!sourceImage) {
            fallbackReason = "У новости нет доступного исходного фото";
          } else if (!mediaLicenseAllowsReuse(license)) {
            fallbackReason = "Исходное фото нельзя использовать как референс по политике медиа";
          } else {
            try {
              generated = await generateNewsCoverFromReference(payload, sourceImage);
              modeUsed = "reference";
            } catch (referenceError) {
              fallbackReason = String(referenceError && referenceError.message || referenceError).slice(0, 500);
              console.warn("QUEUE_REFERENCE_COVER_FALLBACK " + JSON.stringify({
                workspace: currentWorkspaceId(),
                id: item.newsId || item.id,
                error: fallbackReason
              }));
            }
          }
        }

        if (!generated) generated = await generateNewsCover(payload);

        const generatedAt = new Date().toISOString();
        item.originalImageUrl = item.originalImageUrl || sourceImage || "";
        item.imageUrl = "";
        item.enhancedImageUrl = "";
        item.generatedImageUrl = generated.url;
        item.mediaPackUrls = [];
        item.mediaType = "generated";
        item.mediaStatus = "generated";
        item.mediaPriority = 2;
        item.mediaLicense = license;
        item.mediaOrigin = modeUsed === "reference" ? "ai_generated_reference" : "ai_generated";
        item.copyrightSafe = true;
        item.copyrightMediaDecision = modeUsed === "reference" ? "manual_reference_cover_generated" : "manual_new_cover_generated";
        item.generatedBy = generated.model;
        item.generatedAt = generatedAt;
        item.coverGenerationCount = generation;
        item.coverMode = modeUsed;
        item.coverReferenceUsed = modeUsed === "reference";
        item.coverReferenceSource = modeUsed === "reference" ? (generated.referenceOriginalUrl || sourceImage) : "";
        item.coverFallbackReason = fallbackReason;
        item.canEnhance = false;

        await persistMediaMetadata({
          originalImageUrl: item.originalImageUrl || "",
          imageUrl: "",
          enhancedImageUrl: "",
          generatedImageUrl: generated.url,
          mediaPackUrls: [],
          mediaType: "generated",
          mediaStatus: "generated",
          mediaPriority: 2,
          mediaLicense: license,
          mediaOrigin: item.mediaOrigin,
          copyrightSafe: true,
          copyrightPolicyVersion: "v2",
          copyrightMediaDecision: item.copyrightMediaDecision,
          generatedBy: generated.model,
          generatedAt: generatedAt,
          coverGenerationCount: generation,
          coverMode: modeUsed,
          coverReferenceUsed: item.coverReferenceUsed,
          coverReferenceSource: item.coverReferenceSource,
          coverFallbackReason: fallbackReason
        });

        saveState();
        return sendJson(res, 200, {
          ok: true,
          mode: modeUsed,
          requestedMode: requestedMode,
          imageUrl: generated.url,
          model: generated.model,
          generation: generation,
          fallback: Boolean(fallbackReason),
          fallbackReason: fallbackReason,
          copyrightSafe: true
        });
      } catch (error) {
        return sendJson(res, 502, { ok: false, error: error.message || "Не удалось сгенерировать обложку" });
      }
    }

    if (req.method === "POST" && p === "/api/queue/publish") {
      const body = await readJsonObject(req);
      const item = state.queue.find(function(x){ return x.id === body.id; });
      if (!item) {
        const published = (state.history || []).find(function(h){ return h && h.queueId === body.id; });
        if (published) {
          return sendJson(res, 200, {
            ok: true,
            alreadyPublished: true,
            status: "published",
            telegramPublished: Boolean(published.messageId || published.telegramMessageId || published.telegramUncertain),
            telegramUncertain: Boolean(published.telegramUncertain),
            vkPublished: Boolean(published.vkPostId),
            messageId: published.messageId || published.telegramMessageId || null,
            vkPostId: published.vkPostId || null,
            publishedAt: published.publishedAt || "",
            publicationOrigin: published.publicationOrigin || ""
          });
        }
        return sendJson(res, 404, { ok: false, error: "Черновик не найден" });
      }

      // Double click / retry / scheduler at the same time: only one publish of a post may be in flight.
      const releaseManualPublishLock = acquirePublishLock(item.id);
      if (!releaseManualPublishLock) {
        return sendJson(res, 409, { ok: false, error: "Этот пост уже публикуется. Подождите завершения." });
      }
      let manualLockReleased = false;
      const releaseManualOnce = function() { if (!manualLockReleased) { manualLockReleased = true; releaseManualPublishLock(); } };
      res.on("finish", releaseManualOnce);
      // The browser may give up (tab closed, proxy timeout) while Telegram/VK sending is still running: releasing
      // the lock then let the next click publish the same post again. Without a finished response the lock is
      // kept until the send is certainly over (it marks the post as published first).
      res.on("close", function() {
        if (manualLockReleased) return;
        const t = setTimeout(releaseManualOnce, 10 * 60 * 1000);
        if (t.unref) t.unref();
      });

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
        if (result.telegramUncertain) item.telegramUncertain = true;
      }
      if (result.vkPublished) {
        item.vkPublished = true;
        item.vkPostId = result.vkPostId || null;
        if (result.vkUncertain) item.vkUncertain = true;
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
          telegramUncertain: Boolean(result.telegramUncertain || item.telegramUncertain),
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
        state.history = state.history.slice(0, 300);
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
              pgJsonString({
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
              vkPostIdForDb(result.vkPostId || item.vkPostId),
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
      if (!requireAdminKey(req, res)) return;
      const body = await readJsonObject(req);
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
    if (error instanceof BadRequestError) {
      if (!res.headersSent) sendJson(res, error.statusCode || 400, { ok: false, error: error.message });
      return;
    }
    // Full detail stays in the server log; the client only gets a generic message (no paths, SQL, upstream bodies).
    const errorId = crypto.randomBytes(4).toString("hex");
    console.error("REQUEST_FAILED id=" + errorId + " " + req.method + " " + String(req.url || "").split("?")[0] + ":", error);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: "Внутренняя ошибка сервера (код " + errorId + "), подробности в логах", errorId: errorId });
  }
});

await initDb();
startPromotionSnapshotMonitor();

async function repairBalancedQueueMediaAllWorkspaces() {
  for (const ws of workspaceStore.workspaces) {
    if (!ws || !ws.state) continue;
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
}

// v0.54.3: posts that got only the local text card while OpenAI had no credits are blocked from auto-publishing
// (textCardBlocked), so after OpenAI recovers they would sit in the queue forever. Re-draw their cover with AI.
const TEXT_CARD_UPGRADE_MAX_PER_RUN = Math.max(0, Math.min(20, Number(process.env.TEXT_CARD_UPGRADE_MAX_PER_RUN == null || process.env.TEXT_CARD_UPGRADE_MAX_PER_RUN === "" ? 4 : process.env.TEXT_CARD_UPGRADE_MAX_PER_RUN) || 0));
const TEXT_CARD_UPGRADE_MAX_ATTEMPTS = 3;
let textCardUpgradeRunning = false;
async function upgradeTextCardCoversAllWorkspaces() {
  const result = { upgraded: 0, failed: 0, skipped: 0 };
  if (textCardUpgradeRunning || !TEXT_CARD_UPGRADE_MAX_PER_RUN || TEXT_CARD_POSTS_ALLOWED) return result;
  if (!OPENAI_API_KEY || !GENERATE_COVER_IF_MISSING || providerBreaker.isOpen("openai")) return result;
  textCardUpgradeRunning = true;
  try {
    let budget = TEXT_CARD_UPGRADE_MAX_PER_RUN;
    for (const ws of workspaceStore.workspaces) {
      if (!ws || !ws.state || budget <= 0) continue;
      await workspaceContext.run({ workspaceId: ws.id }, async function() {
        const candidates = (state.queue || []).filter(function(item) {
          if (!item || !item.id || !item.newsId || item.status === "media_failed" || item.status === "publish_failed") return false;
          if (!isTextCardOnly(item)) return false;
          if (Number(item.textCardUpgradeAttempts || 0) >= TEXT_CARD_UPGRADE_MAX_ATTEMPTS) return false;
          try { if (dynamicItemAgeMs(item) > dynamicItemMaxAgeMs(item)) return false; } catch {}
          try { return autoQualityEligible(item); } catch { return false; }
        }).sort(function(a, b) { return Number(b.rating || b.editorialScore || 0) - Number(a.rating || a.editorialScore || 0); });
        for (const item of candidates) {
          if (budget <= 0 || providerBreaker.isOpen("openai")) break;
          budget -= 1;
          item.textCardUpgradeAttempts = Number(item.textCardUpgradeAttempts || 0) + 1;
          try {
            const generation = Number(item.coverGenerationCount || 0) + 1;
            const generated = await generateNewsCover({
              id: item.newsId || item.id, newsId: item.newsId || item.id, title: item.title, text: item.text,
              sourceName: item.sourceName || "", topicId: item.topicId || currentWorkspace().channelId || "",
              visualIndex: generation, forceAi: true, costPurpose: "image_generation"
            });
            if (!generated || !generated.url || generated.economy) { result.skipped += 1; continue; } // breaker opened mid-run: still a text card
            const generatedAt = new Date().toISOString();
            Object.assign(item, {
              imageUrl: "", enhancedImageUrl: "", mediaPackUrls: [], generatedImageUrl: generated.url,
              mediaType: "generated", mediaStatus: "generated", mediaOrigin: "ai_generated", copyrightSafe: true,
              copyrightMediaDecision: "text_card_upgraded_to_ai_cover", generatedBy: generated.model, generatedAt: generatedAt,
              coverGenerationCount: generation, coverMode: "generated"
            });
            if (db && dbReady && item.newsId) {
              try {
                const row = await db.query("SELECT metadata FROM news_items WHERE id=$1 AND workspace_id=$2 LIMIT 1", [item.newsId, currentWorkspaceId()]);
                if (row.rowCount) {
                  const metadata = Object.assign({}, row.rows[0].metadata || {}, {
                    imageUrl: "", enhancedImageUrl: "", mediaPackUrls: [], generatedImageUrl: generated.url, mediaType: "generated",
                    mediaStatus: "generated", mediaOrigin: "ai_generated", copyrightSafe: true, generatedBy: generated.model,
                    generatedAt: generatedAt, coverGenerationCount: generation, coverMode: "generated"
                  });
                  await db.query("UPDATE news_items SET metadata=$2::jsonb WHERE id=$1 AND workspace_id=$3", [item.newsId, pgJsonString(metadata), currentWorkspaceId()]);
                }
              } catch (error) {
                console.warn("TEXT_CARD_UPGRADE_METADATA_FAILED " + JSON.stringify({ workspace: ws.id, id: item.newsId, error: String(error && error.message || error).slice(0, 200) }));
              }
            }
            result.upgraded += 1;
            console.log("TEXT_CARD_UPGRADED " + JSON.stringify({ workspace: ws.id, id: item.newsId || item.id, model: generated.model }));
          } catch (error) {
            result.failed += 1;
            console.warn("TEXT_CARD_UPGRADE_FAILED " + JSON.stringify({ workspace: ws.id, id: item.newsId || item.id, error: String(error && error.message || error).slice(0, 200) }));
          }
          saveState();
        }
      });
    }
  } finally { textCardUpgradeRunning = false; }
  return result;
}
setTimeout(function() { upgradeTextCardCoversAllWorkspaces().catch(function(e) { console.warn("TEXT_CARD_UPGRADE_RUN_FAILED", e.message); }); }, 120000);
setInterval(function() { upgradeTextCardCoversAllWorkspaces().catch(function(e) { console.warn("TEXT_CARD_UPGRADE_RUN_FAILED", e.message); }); }, 10 * 60 * 1000);

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

// Starter set for a new channel of the network: removes the AI sources a new
// workspace inherits by default, validates the channel's seed list on the
// server and adds what opens. Runs once per workspace and channel profile.
async function seedChannelSources(ws) {
  const channelId = resolveChannelId(ws);
  if (!channelId || channelId === "ai" || ws.id === "ai-main" || ws.id === "chtotamtachki") return null;
  // Channels without a hand-made list get a starter set from AI discovery.
  let seeds = SEED_SOURCES[channelId] || [];
  if (seeds.length < 25) {
    const found = await discoverSourcesWithAI(30).catch(function(){ return []; });
    seeds = seeds.concat(found);
  }
  if (!ws.channelId) ws.channelId = channelId;
  const aiDefaultIds = new Set(CURATED_SOURCES.map(function(x){ return x.id; }));
  const before = (state.sources || []).length;
  state.sources = (state.sources || []).filter(function(x){ return x && !aiDefaultIds.has(x.id); });
  const removedDefaults = before - state.sources.length;
  // Trader-oriented feeds do not fit a personal-finance channel.
  const removed = [];
  if (channelId === "money") {
    state.sources = state.sources.filter(function(x){
      if (x && /cnbc\.com/i.test(String(x.url || ""))) { removed.push(x.name); return false; }
      return true;
    });
    state.sourceBlockedHosts = Array.isArray(state.sourceBlockedHosts) ? state.sourceBlockedHosts : [];
    if (removed.length && !state.sourceBlockedHosts.includes("cnbc.com")) state.sourceBlockedHosts.push("cnbc.com");
  }
  // Sources that an earlier seed list added and a newer list retired (trader feeds, promo channels,
  // tabloids...). Only seeder-added sources are removed, never the editor's own.
  const retired = retiredSeedSources(state.sources, channelId);
  if (retired.length) {
    const retiredIds = new Set(retired.map(function(x){ return x.id; }));
    state.sourceBlockedHosts = Array.isArray(state.sourceBlockedHosts) ? state.sourceBlockedHosts : [];
    for (const x of retired) {
      const key = sourceKey(x.url);
      if (key && !state.sourceBlockedHosts.includes(key)) state.sourceBlockedHosts.push(key);
      if (state.sourceStats) delete state.sourceStats[x.id];
      removed.push(x.name);
    }
    state.sources = state.sources.filter(function(x){ return !retiredIds.has(x.id); });
  }
  const added = [];
  const failed = [];
  for (const c of freshCandidates(seeds, state.sources, state.sourceBlockedHosts || [])) {
    const check = await validateSourceCandidate(c.url);
    if (!check.ok) { failed.push(c.name + " — " + check.reason); continue; }
    state.sources.push({
      id: "seed-" + crypto.createHash("sha256").update(c.url).digest("hex").slice(0, 10),
      name: c.name, type: "web", group: c.group || "media", sourceClass: sourceClassFor(c), priority: c.group === "official" ? 1 : 2,
      url: c.url, enabled: true, mediaLicense: "unknown", copyrightMode: "facts_only",
      autoAdded: { at: new Date().toISOString(), from: "seed", why: "стартовый набор канала", reason: "seed" },
      feedUrl: check.feedUrl || undefined
    });
    added.push(c.name);
  }
  saveState();
  return { channel: channelId, removedDefaults: removedDefaults, removed: removed, added: added, failed: failed, active: (state.sources || []).filter(function(x){ return x && x.enabled; }).length };
}
// New network channels: seed sources and switch on auto-publishing. Runs at
// start and every 15 minutes, so a channel created in the admin is picked up
// without a restart.
const SEED_LISTS_V0413 = new Set(["kino", "science", "sport"]);
// «Что там в мире?» got a hand-made list of offbeat/culture sources in v0.41.5: AI discovery
// found only 5 sources (general world news is out of its profile), below the 15 needed.
// «Что там у звёзд?» got one too: its discovery hit the OpenAI rate limit and found none.
const SEED_LISTS_V0415 = new Set(["world", "stars"]);
// travel/shopping/home: AI discovery hit the OpenAI rate limit (TPM) and found 0-5 sources each,
// below the 15 needed, so they get hand-made lists in v0.42.2 (validated on the server at seed time).
const SEED_LISTS_V0422 = new Set(["travel", "shopping", "home"]);
// food/business/crypto: same problem (OpenAI rate limit), hand-made lists since v0.42.3.
const SEED_LISTS_V0423 = new Set(["food", "business", "crypto"]);
// v0.42.4: lists cleaned against the channel profiles (trader/promo/tabloid sources retired, replacements added,
// sourceKey no longer collapses sibling rubrics). Re-seeded once under a new prefix: it adds the new entries and
// drops only the retired seed sources (see retiredSeedSources); business only regains the sections the old key dropped.
const SEED_LISTS_V0424 = new Set(["money", "kino", "stars", "travel", "shopping", "home", "food", "business", "crypto"]);
// v0.51.2: money and shopping kept leaving slots empty (sources wrote for traders/sellers): consumer desks added.
const SEED_LISTS_V0512 = new Set(["money", "shopping"]);
let channelSetupRunning = false;
function setupNewChannels() {
  if (channelSetupRunning) return;
  channelSetupRunning = true;
  (async function(){
    for (const ws of workspaceStore.workspaces) {
      if (!ws || !ws.state) continue;
      const channelId = resolveChannelId(ws);
      if (!channelId || channelId === "ai" || ws.id === "ai-main" || ws.id === "chtotamtachki") continue;
      // kino/science/sport got hand-made lists in v0.41.3 (their first run relied
      // on AI discovery, which hit the OpenAI rate limit) — seed them again.
      const migration = (SEED_LISTS_V0512.has(channelId) ? "v0.51.2-seed-" : SEED_LISTS_V0424.has(channelId) ? "v0.42.4-seed-" : SEED_LISTS_V0423.has(channelId) ? "v0.42.3-seed-" : SEED_LISTS_V0422.has(channelId) ? "v0.42.2-seed-" : SEED_LISTS_V0415.has(channelId) ? "v0.41.5-seed-" : SEED_LISTS_V0413.has(channelId) ? "v0.41.3-seed-" : "v0.40.1-seed-") + channelId;
      ws.state.migrations = Array.isArray(ws.state.migrations) ? ws.state.migrations : [];
      await workspaceContext.run({ workspaceId: ws.id }, async function(){
        if (!state.migrations.includes(migration)) {
          const result = await seedChannelSources(ws);
          // Too few working sources (discovery failed, sites down): retry on the
          // next run, up to 4 attempts, instead of marking the seed as done.
          state.seedAttempts = state.seedAttempts && typeof state.seedAttempts === "object" ? state.seedAttempts : {};
          state.seedAttempts[migration] = Number(state.seedAttempts[migration] || 0) + 1;
          const done = !result || result.active >= 15 || state.seedAttempts[migration] >= 4;
          if (done) state.migrations.push(migration);
          saveState();
          persistWorkspaceStore();
          console.log("SOURCE_SEED " + JSON.stringify(Object.assign({ workspace: ws.id, attempt: state.seedAttempts[migration], done: done }, result)));
        }
        // New network channel: switch on automatic publishing once all checks pass.
        const autoMigration = "v0.40.3-auto-publish";
        if (!state.migrations.includes(autoMigration) && !state.migrations.includes("v0.40.2-money-auto-publish")) {
          const auto = await enableAutoPublishingAfterChecks(ws);
          if (auto.skippedManual) {
            state.migrations.push(autoMigration);
            saveState();
          }
          if (auto.enabled) {
            state.migrations.push(autoMigration);
            saveState();
            // Fill the empty queue right away so the first post is ready for the next slot.
            if (!isCollectorRunning(ws.id)) {
              collectOnce("channel-start").then(function(r){
                console.log("CHANNEL_START_COLLECT " + JSON.stringify({ workspace: ws.id, found: r && r.found, queued: r && r.queued, skipped: r && r.skipped }));
              }).catch(function(error){ console.warn("Channel start collect failed:", error.message); });
            }
          }
          console.log("AUTO_PUBLISH_SETUP " + JSON.stringify(Object.assign({ workspace: ws.id }, auto)));
        }
      });
    }
  })().catch(function(error){ console.warn("Source seed failed:", error.message); }).finally(function(){ channelSetupRunning = false; });
}
// v0.43.0: source rework after the owner's review — off-topic sources are paused
// (kept, not deleted) and new ones added after server validation. «Что там в
// мире?» becomes «Что там в сети?» (viral and internet trends).
async function reworkChannelSources(ws, customPlan, tag) {
  const channelId = resolveChannelId(ws);
  const plan = customPlan || SOURCE_REWORK_V0430[channelId];
  const reworkTag = tag || "v0.43.0";
  if (!plan) return null;
  // Exact URL match (not sourceKey): a key covers the whole section, and pausing
  // iz.ru/rubric/obshchestvo must not pause iz.ru/rubric/zhizn.
  const normUrl = function(u) { try { const x = new URL(String(u || "")); return (x.hostname.replace(/^www\./i, "") + x.pathname.replace(/\/+$/, "") + x.search).toLowerCase(); } catch { return ""; } };
  const disableUrls = new Set((plan.disable || []).map(normUrl).filter(Boolean));
  const paused = [];
  const now = new Date().toISOString();
  for (const src of (state.sources || [])) {
    if (!src || !src.enabled || !disableUrls.has(normUrl(src.url))) continue;
    src.enabled = false;
    src.autoPaused = { reason: "не по теме канала (пересборка источников " + reworkTag + ")", at: now };
    paused.push(src.name);
  }
  const added = [];
  const failed = [];
  // Themes for sources the channel already has. v0.52.6 allows one physical source to feed several rubrics.
  const assigned = [];
  const themesByUrl = new Map();
  for (const url of Object.keys(plan.assign || {})) {
    const raw = plan.assign[url];
    themesByUrl.set(normUrl(url), Array.isArray(raw) ? raw.map(String) : [String(raw)]);
  }
  for (const cand of (plan.add || [])) {
    const many = Array.isArray(cand.rubrics) ? cand.rubrics.map(String) : (cand.rubric ? [String(cand.rubric)] : []);
    if (many.length) themesByUrl.set(normUrl(cand.url), many);
  }
  for (const src of (state.sources || [])) {
    const themes = src && themesByUrl.get(normUrl(src.url));
    if (!themes || !themes.length) continue;
    const before = JSON.stringify([String(src.rubric || ""), Array.isArray(src.rubrics) ? src.rubrics : []]);
    src.rubric = themes[0];
    src.rubrics = themes.slice();
    src.rubricAssignedAt = now;
    const after = JSON.stringify([src.rubric, src.rubrics]);
    if (before !== after) assigned.push(src.name);
  }
  for (const c of freshCandidates(plan.add || [], state.sources, state.sourceBlockedHosts || [])) {
    const check = await validateSourceCandidate(c.url);
    if (!check.ok) { failed.push(c.name + " — " + check.reason); continue; }
    // added meanwhile (discovery runs while this validates)
    if ((state.sources || []).some(function(x){ return x && sourceKey(x.url) === sourceKey(c.url); })) continue;
    state.sources.push({
      id: "dna-" + crypto.createHash("sha256").update(c.url).digest("hex").slice(0, 10),
      name: c.name, type: "web", group: c.group || "media", priority: c.group === "official" ? 1 : 2,
      url: c.url, enabled: true, mediaLicense: "unknown", copyrightMode: "facts_only",
      autoAdded: { at: now, from: "dna", why: "пересборка источников канала", reason: reworkTag },
      rubric: c.rubric || (Array.isArray(c.rubrics) && c.rubrics[0]) || undefined,
      rubrics: Array.isArray(c.rubrics) ? c.rubrics.map(String) : (c.rubric ? [String(c.rubric)] : undefined),
      rubricAssignedAt: (c.rubric || (Array.isArray(c.rubrics) && c.rubrics.length)) ? now : undefined
    });
    added.push(c.name);
  }
  let renamed = false;
  if (channelId === "world" && /в мире/i.test(String(ws.name || ""))) {
    ws.name = "Что там в сети?";
    // The channel profile was resolved from the old name; keep it explicit.
    if (!ws.channelId) ws.channelId = "world";
    ws.updatedAt = now;
    renamed = true;
  }
  saveState();
  if (renamed) persistWorkspaceStore();
  return { channel: channelId, paused: paused, added: added, failed: failed, assigned: assigned.length ? assigned : undefined, renamed: renamed, active: (state.sources || []).filter(function(x){ return x && x.enabled; }).length };
}
let sourceReworkRetryTimer = null;
function scheduleSourceReworkRetry() {
  if (sourceReworkRetryTimer) return;
  sourceReworkRetryTimer = setTimeout(function(){ sourceReworkRetryTimer = null; runSourceRework(); }, 30 * 60 * 1000);
}
let sourceReworkRunning = false;
function runSourceRework() {
  if (sourceReworkRunning) return;
  sourceReworkRunning = true;
  (async function(){
    for (const ws of workspaceStore.workspaces) {
      if (!ws || !ws.state) continue;
      const migration = "v0.43.0-source-rework";
      ws.state.migrations = Array.isArray(ws.state.migrations) ? ws.state.migrations : [];
      if (ws.state.migrations.includes(migration)) continue;
      await workspaceContext.run({ workspaceId: ws.id }, async function(){
        const result = await reworkChannelSources(ws);
        // Sites unreachable at start: retry on the next starts (up to 3) instead
        // of leaving the channel with old sources paused and no new ones.
        state.seedAttempts = state.seedAttempts && typeof state.seedAttempts === "object" ? state.seedAttempts : {};
        state.seedAttempts[migration] = Number(state.seedAttempts[migration] || 0) + 1;
        const planned = result && SOURCE_REWORK_V0430[result.channel] ? SOURCE_REWORK_V0430[result.channel].add.length : 0;
        const done = !result || !planned || result.added.length > 0 || state.seedAttempts[migration] >= 3;
        if (done) state.migrations.push(migration);
        else scheduleSourceReworkRetry();
        saveState();
        if (result) console.log("SOURCE_REWORK " + JSON.stringify(Object.assign({ workspace: ws.id }, result)));
      });
    }
  })().catch(function(error){ console.warn("Source rework failed:", error.message); }).finally(function(){ sourceReworkRunning = false; });
}
setTimeout(runSourceRework, 90000);

// v0.44.1: the recreated «Что там в интернете?» channel keeps the same world
// editorial profile but gets an expanded viral/social source pack. This migration
// reruns only that workspace; freshCandidates prevents duplicate sources.
setTimeout(function runInternetSourcePackV0441() {
  (async function(){
    for (const ws of workspaceStore.workspaces) {
      if (!ws || !ws.state || resolveChannelId(ws) !== "world") continue;
      const migration = "v0.44.1-internet-source-pack";
      ws.state.migrations = Array.isArray(ws.state.migrations) ? ws.state.migrations : [];
      if (ws.state.migrations.includes(migration)) continue;
      await workspaceContext.run({ workspaceId: ws.id }, async function(){
        const result = await reworkChannelSources(ws);
        state.migrations.push(migration);
        saveState();
        console.log("INTERNET_SOURCE_PACK " + JSON.stringify(Object.assign({ workspace: ws.id }, result || {})));
      });
    }
  })().catch(function(error){ console.warn("Internet source pack failed:", error.message); });
}, 95000);

// v0.45.1: «Что там в интернете?» got almost nothing from meme-only channels
// (pictures without a story are skipped as «нет контекста»), Reddit is not
// reachable from the server and social-media industry sites are off-topic.
// Pause those, add sources that publish viral stories with context.
setTimeout(function runInternetSourceFixV0451() {
  (async function(){
    for (const ws of workspaceStore.workspaces) {
      if (!ws || !ws.state || resolveChannelId(ws) !== "world") continue;
      const migration = "v0.45.1-internet-sources";
      ws.state.migrations = Array.isArray(ws.state.migrations) ? ws.state.migrations : [];
      if (ws.state.migrations.includes(migration)) continue;
      await workspaceContext.run({ workspaceId: ws.id }, async function(){
        const result = await reworkChannelSources(ws, INTERNET_SOURCE_FIX_V0451, "v0.45.1");
        state.seedAttempts = state.seedAttempts && typeof state.seedAttempts === "object" ? state.seedAttempts : {};
        state.seedAttempts[migration] = Number(state.seedAttempts[migration] || 0) + 1;
        if ((result && result.added.length > 0) || state.seedAttempts[migration] >= 3) state.migrations.push(migration);
        saveState();
        console.log("INTERNET_SOURCE_FIX " + JSON.stringify(Object.assign({ workspace: ws.id }, result || {})));
      });
    }
  })().catch(function(error){ console.warn("Internet source fix failed:", error.message); });
}, 100000);

// v0.53.0: «Что там с покупками?» — five product-find rubrics and the approved source set.
setTimeout(function runShoppingFindsV0530() {
  (async function(){
    for (const ws of workspaceStore.workspaces) {
      if (!ws || !ws.state || resolveChannelId(ws) !== "shopping") continue;
      const migration = "v0.53.0-shopping-finds";
      ws.state.migrations = Array.isArray(ws.state.migrations) ? ws.state.migrations : [];
      if (ws.state.migrations.includes(migration)) continue;
      await workspaceContext.run({ workspaceId: ws.id }, async function(){
        const result = normalizeShoppingFindSources(state, SHOPPING_FIND_SOURCES, rubricIds(ws), new Date().toISOString());
        if (!ws.channelId) ws.channelId = "shopping";
        ws.updatedAt = new Date().toISOString();
        persistWorkspaceStore();
        state.migrations.push(migration);
        if (!state.migrations.includes("v0.51.2-seed-shopping")) state.migrations.push("v0.51.2-seed-shopping");
        saveState();
        console.log("SHOPPING_FINDS_V0530 " + JSON.stringify({
          workspace: ws.id,
          added: result.added.length,
          paused: result.paused.length,
          rubrics: rubricSourceCounts(ws)
        }));
      });
    }
  })().catch(function(error){ console.warn("Shopping finds migration failed:", error.message); });
}, 108000);

// v0.51.3: «Что там для дома?» — 10 themes, one post a day each. Off-topic sources are paused (kept) and their
// sections blocked for discovery; the niche's biggest Telegram channels are added and every source gets its theme.
setTimeout(function runHomeRubricSourcesV0513() {
  (async function(){
    for (const ws of workspaceStore.workspaces) {
      if (!ws || !ws.state || resolveChannelId(ws) !== "home") continue;
      const migration = "v0.51.3-home-rubrics";
      ws.state.migrations = Array.isArray(ws.state.migrations) ? ws.state.migrations : [];
      if (ws.state.migrations.includes(migration)) continue;
      await workspaceContext.run({ workspaceId: ws.id }, async function(){
        const result = await reworkChannelSources(ws, HOME_RUBRIC_SOURCES_V0513, "v0.51.3");
        state.sourceBlockedHosts = Array.isArray(state.sourceBlockedHosts) ? state.sourceBlockedHosts : [];
        for (const url of HOME_RUBRIC_SOURCES_V0513.disable) {
          const key = sourceKey(url);
          if (key && !state.sourceBlockedHosts.includes(key)) state.sourceBlockedHosts.push(key);
        }
        state.seedAttempts = state.seedAttempts && typeof state.seedAttempts === "object" ? state.seedAttempts : {};
        state.seedAttempts[migration] = Number(state.seedAttempts[migration] || 0) + 1;
        if ((result && result.added.length > 0) || state.seedAttempts[migration] >= 3) state.migrations.push(migration);
        saveState();
        console.log("HOME_RUBRIC_SOURCES " + JSON.stringify(Object.assign({ workspace: ws.id, rubrics: rubricSourceCounts() }, result || {})));
      });
    }
  })().catch(function(error){ console.warn("Home rubric sources failed:", error.message); });
}, 105000);

// v0.52.4: finish the «Что там для дома?» source structure.
// Every active source must belong to one of the 10 rubrics; unknown leftovers are paused.
// Weak groups now have a floor of 5 sources (ceiling 6).
function normalizeHomeRubricSourcesV0524(ws) {
  const valid = rubricIds(ws);
  const now = new Date().toISOString();
  const themeByUrl = new Map();
  const normUrl = function(u) {
    try {
      const x = new URL(String(u || ""));
      return (x.hostname.replace(/^www\./i, "") + x.pathname.replace(/\/+$/, "") + x.search).toLowerCase();
    } catch { return ""; }
  };

  for (const url of Object.keys(HOME_RUBRIC_SOURCES_V0513.assign || {})) {
    themeByUrl.set(normUrl(url), HOME_RUBRIC_SOURCES_V0513.assign[url]);
  }
  for (const cand of (HOME_RUBRIC_SOURCES_V0513.add || [])) {
    if (cand && cand.rubric) themeByUrl.set(normUrl(cand.url), cand.rubric);
  }

  const assigned = [];
  const paused = [];
  for (const src of (state.sources || [])) {
    if (!src || !src.enabled) continue;
    const current = String(src.rubric || "");
    if (valid.has(current)) continue;

    const inferred = themeByUrl.get(normUrl(src.url)) || "";
    if (inferred && valid.has(inferred)) {
      src.rubric = inferred;
      src.rubricAssignedAt = now;
      assigned.push(src.name || src.url || src.id);
      continue;
    }

    // An enabled source with no known theme bypasses theme balancing and can leak
    // generic real-estate/IT/city content into the home feed, so quarantine it.
    src.enabled = false;
    src.autoPaused = {
      reason: "нет тематической рубрики «Что там для дома?» (v0.52.4)",
      at: now
    };
    paused.push(src.name || src.url || src.id);
  }

  state.rubricLimits = state.rubricLimits && typeof state.rubricLimits === "object" && !Array.isArray(state.rubricLimits)
    ? state.rubricLimits
    : {};
  for (const r of channelRubrics(ws)) {
    const current = state.rubricLimits[r.id] && Number(state.rubricLimits[r.id].min);
    if (!Number.isFinite(current) || current < 5) {
      state.rubricLimits[r.id] = { min: 5, at: now, migration: "v0.52.4-home-rubric-balance" };
    }
  }

  state.sourceReplenish = state.sourceReplenish && typeof state.sourceReplenish === "object" ? state.sourceReplenish : {};
  state.sourceReplenish.lastAt = "";
  if (state.sourceReplenish.misses) delete state.sourceReplenish.misses.rubric;

  return { assigned: assigned, paused: paused, rubrics: rubricSourceCounts(ws) };
}

setTimeout(function runHomeRubricBalanceV0524() {
  (async function(){
    for (const ws of workspaceStore.workspaces) {
      if (!ws || !ws.state || resolveChannelId(ws) !== "home") continue;
      const migration = "v0.52.4-home-rubric-balance";
      ws.state.migrations = Array.isArray(ws.state.migrations) ? ws.state.migrations : [];
      if (ws.state.migrations.includes(migration)) continue;

      await workspaceContext.run({ workspaceId: ws.id }, async function(){
        const normalized = normalizeHomeRubricSourcesV0524(ws);
        const topups = [];

        // Use the existing OpenAI source discovery, one weak rubric per pass.
        // No Claude/Anthropic calls are used here.
        for (let i = 0; i < 6; i++) {
          const counts = rubricSourceCounts(ws);
          const short = channelRubrics(ws).filter(function(r){ return (counts[r.id] || 0) < rubricMinFor(r.id, ws); });
          if (!short.length) break;

          state.sourceReplenish.lastAt = "";
          if (state.sourceReplenish.misses) delete state.sourceReplenish.misses.rubric;
          const result = await replenishSources("home_rubric_balance");
          topups.push({
            attempt: i + 1,
            added: result && Array.isArray(result.added) ? result.added.length : 0,
            before: counts,
            after: rubricSourceCounts(ws)
          });
        }

        state.migrations.push(migration);
        saveState();
        console.log("HOME_RUBRIC_BALANCE " + JSON.stringify({
          workspace: ws.id,
          assigned: normalized.assigned,
          paused: normalized.paused,
          rubrics: rubricSourceCounts(ws),
          topups: topups
        }));
      });
    }
  })().catch(function(error){ console.warn("Home rubric balance failed:", error.message); });
}, 110000);

// v0.52.6: rebuild «Что там с деньгами?» as personal finance: 8 rubrics, 5+ sources each,
// one normal post per rubric/day. Unknown legacy feeds are quarantined, not deleted.
function normalizeMoneyRubricSourcesV0526(ws) {
  const valid = rubricIds(ws);
  const now = new Date().toISOString();
  const normUrl = function(u) {
    try {
      const x = new URL(String(u || ""));
      return (x.hostname.replace(/^www\./i, "") + x.pathname.replace(/\/+$/, "") + x.search).toLowerCase();
    } catch { return ""; }
  };
  const planned = new Map();
  for (const cand of (MONEY_RUBRIC_SOURCES_V0526.add || [])) {
    const many = (Array.isArray(cand.rubrics) ? cand.rubrics : (cand.rubric ? [cand.rubric] : []))
      .map(String).filter(function(id){ return valid.has(id); });
    if (many.length) planned.set(normUrl(cand.url), many);
  }

  const assigned = [];
  const paused = [];
  for (const src of (state.sources || [])) {
    if (!src || !src.enabled) continue;
    const exact = planned.get(normUrl(src.url));
    if (exact && exact.length) {
      const before = JSON.stringify([src.rubric || "", src.rubrics || []]);
      src.rubric = exact[0];
      src.rubrics = exact.slice();
      src.rubricAssignedAt = now;
      if (before !== JSON.stringify([src.rubric, src.rubrics])) assigned.push(src.name || src.url || src.id);
      continue;
    }

    const known = new Set([String(src.rubric || "")].concat(Array.isArray(src.rubrics) ? src.rubrics.map(String) : []));
    const keep = Array.from(known).filter(function(id){ return valid.has(id); });
    if (keep.length) {
      src.rubric = keep[0];
      src.rubrics = keep;
      continue;
    }

    src.enabled = false;
    src.autoPaused = { reason: "нет рубрики личных финансов «Что там с деньгами?» (v0.52.6)", at: now };
    paused.push(src.name || src.url || src.id);
  }

  state.rubricLimits = state.rubricLimits && typeof state.rubricLimits === "object" && !Array.isArray(state.rubricLimits)
    ? state.rubricLimits : {};
  for (const r of channelRubrics(ws)) {
    const current = state.rubricLimits[r.id] && Number(state.rubricLimits[r.id].min);
    if (!Number.isFinite(current) || current < 5) {
      state.rubricLimits[r.id] = { min: 5, at: now, migration: "v0.52.6-money-personal-finance" };
    }
  }

  state.sourceReplenish = state.sourceReplenish && typeof state.sourceReplenish === "object" ? state.sourceReplenish : {};
  state.sourceReplenish.lastAt = "";
  if (state.sourceReplenish.misses) delete state.sourceReplenish.misses.rubric;
  return { assigned: assigned, paused: paused, rubrics: rubricSourceCounts(ws) };
}

setTimeout(function runMoneyPersonalFinanceV0526() {
  (async function(){
    for (const ws of workspaceStore.workspaces) {
      if (!ws || !ws.state || resolveChannelId(ws) !== "money") continue;
      const migration = "v0.52.6-money-personal-finance";
      ws.state.migrations = Array.isArray(ws.state.migrations) ? ws.state.migrations : [];
      if (ws.state.migrations.includes(migration)) continue;

      await workspaceContext.run({ workspaceId: ws.id }, async function(){
        const sourceResult = await reworkChannelSources(ws, MONEY_RUBRIC_SOURCES_V0526, "v0.52.6");
        const normalized = normalizeMoneyRubricSourcesV0526(ws);
        const topups = [];

        // One weak rubric per pass, OpenAI discovery only. No Claude/Anthropic calls.
        for (let i = 0; i < 8; i++) {
          const counts = rubricSourceCounts(ws);
          const short = channelRubrics(ws).filter(function(r){ return (counts[r.id] || 0) < rubricMinFor(r.id, ws); });
          if (!short.length) break;
          state.sourceReplenish.lastAt = "";
          if (state.sourceReplenish.misses) delete state.sourceReplenish.misses.rubric;
          const result = await replenishSources("money_rubric_balance");
          topups.push({ attempt: i + 1, added: result && Array.isArray(result.added) ? result.added.length : 0, before: counts, after: rubricSourceCounts(ws) });
        }

        ws.name = "Что там с деньгами? | Личные финансы";
        if (!ws.channelId) ws.channelId = "money";
        ws.updatedAt = new Date().toISOString();
        persistWorkspaceStore();

        let telegramTitle = "skipped";
        try {
          const target = await ensureTelegramPublishTarget(ws, true);
          await telegramApi("setChatTitle", { chat_id: target.chatId, title: "Что там с деньгами? | Личные финансы" });
          await telegramApi("setChatDescription", {
            chat_id: target.chatId,
            description: "Личные финансы без шума: карты и банки, вклады, кредиты и ипотека, налоги, рубль и ставка ЦБ, зарплаты и выплаты, мошенники и полезные финансовые правила."
          });
          telegramTitle = "updated";
        } catch (error) {
          telegramTitle = "error: " + String(error && error.message || error).slice(0, 140);
        }

        state.migrations.push(migration);
        saveState();
        console.log("MONEY_RUBRIC_BALANCE " + JSON.stringify({
          workspace: ws.id,
          assigned: normalized.assigned,
          paused: normalized.paused,
          rubrics: rubricSourceCounts(ws),
          sourceAdded: sourceResult && sourceResult.added || [],
          sourceFailed: sourceResult && sourceResult.failed || [],
          topups: topups,
          telegramTitle: telegramTitle
        }));
      });
    }
  })().catch(function(error){ console.warn("Money personal-finance migration failed:", error.message); });
}, 115000);

// v0.52.8: the first production pass showed two money rubrics below the five-source floor because
// otherwise-good Telegram candidates were stale/unavailable. Reuse already validated shared personal-finance
// feeds for those rubrics, then let the normal replenisher replace them later if their quality drops.
setTimeout(function repairMoneyRubricFloorV0528() {
  (async function(){
    for (const ws of workspaceStore.workspaces) {
      if (!ws || !ws.state || resolveChannelId(ws) !== "money") continue;
      const migration = "v0.52.8-money-rubric-floor";
      ws.state.migrations = Array.isArray(ws.state.migrations) ? ws.state.migrations : [];
      if (ws.state.migrations.includes(migration)) continue;
      await workspaceContext.run({ workspaceId: ws.id }, async function(){
        const result = normalizeMoneyRubricSourcesV0526(ws);
        state.migrations.push(migration);
        saveState();
        console.log("MONEY_RUBRIC_FLOOR_REPAIR " + JSON.stringify({
          workspace: ws.id,
          assigned: result.assigned,
          paused: result.paused,
          rubrics: rubricSourceCounts(ws)
        }));
      });
    }
  })().catch(function(error){ console.warn("Money rubric floor repair failed:", error.message); });
}, 45000);

// v0.53.3: (1) money: core finance sources were auto-paused by "10 junk in a row" although most of those skips were
// "needs an official source / two sources" (now not counted against the source) — put the curated ones back;
// (2) shopping: sources that cannot work are switched off so the theme search replaces them: dateless catalogs
// (every card fails the freshness rule) and sites that answer with redirect loops / 403 / 406.
const POLICY_RECOVERY_MIGRATION = "v0.53.3-source-policy-recovery";
const SHOPPING_BROKEN_URLS = ["https://kladskidok.ru/"];
const SHOPPING_FAILING_HOSTS = ["pepper.ru", "buzzfeed.com", "trendhunter.com"];
function recoverPolicyPausedSourcesV0533(ws) {
  const channel = resolveChannelId(ws);
  const out = { restored: [], paused: [] };
  const now = new Date().toISOString();
  if (channel === "money") {
    for (const src of (ws.state.sources || [])) {
      if (!src || src.enabled || !src.autoPaused || !/10 новостей подряд/.test(String(src.autoPaused.reason || ""))) continue;
      const age = Date.now() - Date.parse(src.autoPaused.at || "");
      if (!Number.isFinite(age) || age > 48 * 3600000) continue;
      const from = src.autoAdded && src.autoAdded.from;
      if (src.autoAdded && from !== "seed" && from !== "dna") continue; // only the curated list
      src.enabled = true;
      delete src.autoPaused;
      const stat = ensureSourceStat(src);
      if (stat) { stat.recent = []; stat.policyStreak = 0; }
      src.recoveredAt = now; // grace: the theme scorecard rule does not re-pause it for 14 days
      out.restored.push(src.name);
    }
  }
  if (channel === "shopping") {
    const hostOf = function(u){ try { return new URL(String(u || "")).hostname.replace(/^www\./i, "").toLowerCase(); } catch { return ""; } };
    const pausedHosts = new Set(["kladskidok.ru"]);
    for (const src of (ws.state.sources || [])) {
      if (!src || !src.enabled) continue;
      const stat = ensureSourceStat(src) || {};
      const dateless = SHOPPING_BROKEN_URLS.includes(String(src.url || ""));
      const failing = SHOPPING_FAILING_HOSTS.includes(hostOf(src.url)) && Number(stat.errorStreak || 0) >= 5;
      if (!dateless && !failing) continue;
      src.enabled = false;
      src.autoPaused = { reason: dateless ? "каталог без дат публикации: редактор пропускает каждую карточку" : "сайт не открывается из нашей сети (" + stat.errorStreak + " проверок подряд)", at: now };
      out.paused.push(src.name);
      pausedHosts.add(dateless ? "kladskidok.ru" : hostOf(src.url));
    }
    ws.state.sourceBlockedHosts = Array.isArray(ws.state.sourceBlockedHosts) ? ws.state.sourceBlockedHosts : [];
    // discovery must not bring the same sites back
    for (const host of pausedHosts) if (host && !ws.state.sourceBlockedHosts.includes(host)) ws.state.sourceBlockedHosts.push(host);
  }
  return out;
}
setTimeout(function runPolicyRecoveryV0533() {
  (async function(){
    for (const ws of workspaceStore.workspaces) {
      const channel = ws && ws.state ? resolveChannelId(ws) : "";
      if (channel !== "money" && channel !== "shopping") continue;
      ws.state.migrations = Array.isArray(ws.state.migrations) ? ws.state.migrations : [];
      if (ws.state.migrations.includes(POLICY_RECOVERY_MIGRATION)) continue;
      await workspaceContext.run({ workspaceId: ws.id }, async function(){
        const result = recoverPolicyPausedSourcesV0533(ws);
        state.migrations.push(POLICY_RECOVERY_MIGRATION);
        saveState();
        console.log("SOURCE_POLICY_RECOVERY " + JSON.stringify({ workspace: ws.id, channel: channel, restored: result.restored, paused: result.paused }));
      });
    }
  })().catch(function(error){ console.warn("Source policy recovery failed:", error.message); });
}, 130000);

// v0.54.2: safeFetch now returns cookies handed out by redirects, so the Pepper pages open again. Re-enable the three
// Pepper sources v0.53.3 paused (and unblock the host) for «Что там с покупками?». One-time; "Клад скидок" stays off.
const PEPPER_RESTORE_MIGRATION = "v0.54.2-pepper-restore";
function restorePepperSourcesV0542() {
  const now = new Date().toISOString();
  const restored = [];
  for (const src of (state.sources || [])) {
    if (!src || src.enabled || !/(^|\.)pepper\.ru$/i.test(String(src.url || "").replace(/^https?:\/\//i, "").split("/")[0])) continue;
    src.enabled = true;
    delete src.autoPaused;
    const stat = ensureSourceStat(src);
    if (stat) { stat.errorStreak = 0; stat.recent = []; stat.policyStreak = 0; }
    src.recoveredAt = now;
    restored.push(src.name);
  }
  state.sourceBlockedHosts = (Array.isArray(state.sourceBlockedHosts) ? state.sourceBlockedHosts : []).filter(function(h){ return h !== "pepper.ru"; });
  return restored;
}
setTimeout(function runPepperRestoreV0542() {
  (async function(){
    for (const ws of workspaceStore.workspaces) {
      if (!ws || !ws.state || resolveChannelId(ws) !== "shopping") continue;
      ws.state.migrations = Array.isArray(ws.state.migrations) ? ws.state.migrations : [];
      if (ws.state.migrations.includes(PEPPER_RESTORE_MIGRATION)) continue;
      await workspaceContext.run({ workspaceId: ws.id }, async function(){
        const restored = restorePepperSourcesV0542();
        state.migrations.push(PEPPER_RESTORE_MIGRATION);
        saveState();
        console.log("PEPPER_RESTORE_V0542 " + JSON.stringify({ workspace: ws.id, restored: restored }));
      });
    }
  })().catch(function(error){ console.warn("Pepper restore failed:", error.message); });
}, 140000);

// One-time, additive recovery of channels lost from workspaces.json (see lib/workspace-recovery.js).
let workspaceRecoveryRunning = false;
async function recoverMissingWorkspaces() {
  if (workspaceRecoveryRunning) return { skipped: "running" };
  workspaceRecoveryRunning = true;
  try {
    const defaultWorkspace = getWorkspaceById(workspaceStore.defaultWorkspaceId);
    if (!defaultWorkspace || !defaultWorkspace.state) return { skipped: "no_default_workspace" };
    defaultWorkspace.state.migrations = Array.isArray(defaultWorkspace.state.migrations) ? defaultWorkspace.state.migrations : [];
    if (defaultWorkspace.state.migrations.includes(WORKSPACE_RECOVERY_MIGRATION)) return { skipped: "done" };
    if (!db || !dbReady) return { skipped: "db_not_ready" };
    const missing = RECOVERY_CHANNELS.filter(function(entry){ return !getWorkspaceById(entry.id) && !REMOVED_CHANNELS_V055.includes(entry.id) && !REMOVED_CHANNELS_V060.includes(entry.id); });
    const restored = [];
    const fresh = [];
    for (const entry of missing) {
      let snapshot = null;
      try {
        const result = await db.query("SELECT state, created_at FROM app_snapshots WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 1", [entry.id]);
        if (result.rows[0] && isUsableSnapshotState(result.rows[0].state)) snapshot = result.rows[0];
      } catch (error) {
        // A DB error is not "no snapshot": stop and retry later instead of creating empty channels.
        return { skipped: "db_error", error: String(error && error.message || error).slice(0, 160), restored: restored.length };
      }
      if (getWorkspaceById(entry.id)) continue;
      const nowIso = new Date().toISOString();
      const record = recoveredWorkspaceRecord(entry, snapshot ? snapshot.state : freshWorkspaceState(), nowIso);
      workspaceStore.workspaces.push(normalizeWorkspaceMeta(record, entry.id));
      (snapshot ? restored : fresh).push(entry.id);
      console.warn("WORKSPACE_RECOVERED " + JSON.stringify({ workspace: entry.id, from: snapshot ? "app_snapshots" : "fresh", snapshotAt: snapshot ? new Date(snapshot.created_at).toISOString() : "", sources: snapshot ? snapshot.state.sources.length : 0, queue: snapshot && Array.isArray(snapshot.state.queue) ? snapshot.state.queue.length : 0 }));
    }
    if (restored.length || fresh.length) persistWorkspaceStore();
    await workspaceContext.run({ workspaceId: defaultWorkspace.id }, async function(){
      state.migrations = Array.isArray(state.migrations) ? state.migrations : [];
      if (!state.migrations.includes(WORKSPACE_RECOVERY_MIGRATION)) state.migrations.push(WORKSPACE_RECOVERY_MIGRATION);
      saveState();
    });
    return { restored: restored, fresh: fresh, total: workspaceStore.workspaces.length };
  } finally {
    workspaceRecoveryRunning = false;
  }
}
(function scheduleWorkspaceRecovery() {
  if (String(process.env.WORKSPACE_RECOVERY_ENABLED || "true").toLowerCase() === "false") return;
  let tries = 0;
  (function tick() {
    tries += 1;
    recoverMissingWorkspaces().then(function(result){
      if (result && (result.skipped === "db_not_ready" || result.skipped === "db_error") && tries < 30) return void setTimeout(tick, 10000);
      console.log("WORKSPACE_RECOVERY " + JSON.stringify(result));
    }).catch(function(error){
      console.error("WORKSPACE_RECOVERY failed:", error && error.message || error);
      if (tries < 30) setTimeout(tick, 15000);
    });
  })();
})();

// v0.55.0: owner-approved cleanup and «по группам» rollout.
//  1) «Покупки», «Наука», «Мир» are removed from the cabinet (state archived to DATA_DIR first; the Telegram channels
//     themselves are untouched; workspace_registry.removed_at keeps the watchdog quiet).
//  2) The ten kept channels get the full name «<head> | <тема>» (head unchanged: VK matching uses it), their existing
//     sources are sorted into the new rubrics by keywords, sources paused by mistake in the no-credit hours are
//     restored, and the rubrics/hours/soft quotas are switched on by the migration marker.
const RUBRICS_V055_REMOVAL_MARKER = "v0.55.0-removed-channels";
const REMOVAL_MARKER_V060 = "v0.60.3-removed-dengi";
async function removeChannelsV055() {
  const defaultWorkspace = getWorkspaceById(workspaceStore.defaultWorkspaceId);
  if (!defaultWorkspace || !defaultWorkspace.state) return { skipped: "no_default_workspace" };
  defaultWorkspace.state.migrations = Array.isArray(defaultWorkspace.state.migrations) ? defaultWorkspace.state.migrations : [];
  const groups = [
    { marker: RUBRICS_V055_REMOVAL_MARKER, ids: REMOVED_CHANNELS_V055 },
    { marker: REMOVAL_MARKER_V060, ids: REMOVED_CHANNELS_V060 }
  ].filter(function(g){ return !defaultWorkspace.state.migrations.includes(g.marker); });
  if (!groups.length) return { skipped: "done" };
  const removed = [];
  for (const group of groups) {
    for (const id of group.ids) {
      const ws = getWorkspaceById(id);
      if (!ws || id === workspaceStore.defaultWorkspaceId) continue;
      try {
        const dir = path.join(DATA_DIR, "archive");
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, "removed-" + id + "-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json");
        fs.writeFileSync(file, JSON.stringify({ id: ws.id, name: ws.name, channelId: ws.channelId || "", telegramChannel: ws.telegramChannel || "", state: ws.state }));
      } catch (error) {
        // no archive = no deletion: retry on the next start
        console.warn("CHANNEL_REMOVE_V055 archive failed " + JSON.stringify({ workspace: id, error: String(error && error.message || error).slice(0, 160) }));
        return { skipped: "archive_failed", removed: removed };
      }
      try { removeWorkspaceAvatar(ws); } catch {}
      workspaceStore.workspaces = workspaceStore.workspaces.filter(function(x){ return x.id !== id; });
      if (db && dbReady) await db.query("UPDATE workspace_registry SET removed_at=NOW() WHERE id=$1", [id]).catch(function(error){ console.warn("workspace_registry update failed:", error.message); });
      statusCache.delete(id); analyticsCache.delete(id);
      removed.push(id);
      console.warn("CHANNEL_REMOVED_V055 " + JSON.stringify({ workspace: id, name: ws.name }));
    }
  }
  persistWorkspaceStore();
  await workspaceContext.run({ workspaceId: defaultWorkspace.id }, async function(){
    state.migrations = Array.isArray(state.migrations) ? state.migrations : [];
    for (const group of groups) if (!state.migrations.includes(group.marker)) state.migrations.push(group.marker);
    saveState();
  });
  return { removed: removed };
}
function applyRubricsV055ToWorkspace(ws, nowMs) {
  const channelId = resolveChannelId(ws);
  const plan = RUBRIC_PLAN_V055[channelId];
  if (!plan) return null;
  const ids = new Set(plan.rubrics.map(function(item){ return item.rubric.id; }));
  const legacyThemes = isLegacyThemeChannelV055(channelId);
  let renamed = false;
  if (ws.name && !String(ws.name).includes(" | ") && CHANNEL_NAME_TAILS_V055[channelId]) {
    ws.name = String(ws.name).trim() + " | " + CHANNEL_NAME_TAILS_V055[channelId];
    ws.updatedAt = new Date(nowMs).toISOString();
    renamed = true;
  }
  if (!ws.channelId) ws.channelId = channelId; // keep the profile explicit: the name no longer decides it
  const nowIso = new Date(nowMs).toISOString();
  let tagged = 0, restored = 0;
  for (const src of (state.sources || [])) {
    if (!src) continue;
    if (legacyThemes) continue; // money/home already had curated rubric tags and their own pause history: nothing to re-tag or restore
    if (shouldRestoreAutoPausedV055(src, nowMs, 4 * 86400000)) {
      src.enabled = true;
      delete src.autoPaused;
      src.recoveredAt = nowIso; // 14-day shield against the generic auto-pause rules
      restored += 1;
    }
    const has = ids.has(String(src.rubric || "")) || (Array.isArray(src.rubrics) && src.rubrics.some(function(id){ return ids.has(String(id)); }));
    if (has || !src.enabled) continue;
    const themes = classifySourceV055(channelId, src);
    if (!themes.length) continue;
    src.rubric = themes[0];
    src.rubrics = themes.slice();
    src.rubricAssignedAt = nowIso;
    tagged += 1;
  }
  // a fresh theme search right away (the hourly throttle and the 24 h rest are lifted once)
  state.sourceReplenish = state.sourceReplenish && typeof state.sourceReplenish === "object" ? state.sourceReplenish : {};
  state.sourceReplenish.lastAt = "";
  if (state.sourceReplenish.misses) delete state.sourceReplenish.misses.rubric;
  state.migrations = Array.isArray(state.migrations) ? state.migrations : [];
  if (!state.migrations.includes(RUBRICS_V055_MIGRATION)) state.migrations.push(RUBRICS_V055_MIGRATION);
  return { channel: channelId, renamed: renamed, tagged: tagged, restored: restored };
}
async function runRubricsV055() {
  const removal = await removeChannelsV055();
  console.log("CHANNELS_REMOVAL_V055 " + JSON.stringify(removal));
  const nowMs = Date.now();
  let renamedAny = false;
  for (const ws of workspaceStore.workspaces.slice()) {
    if (!ws || !ws.state || !isRubricsV055Channel(resolveChannelId(ws))) continue;
    ws.state.migrations = Array.isArray(ws.state.migrations) ? ws.state.migrations : [];
    if (ws.state.migrations.includes(RUBRICS_V055_MIGRATION)) continue;
    await workspaceContext.run({ workspaceId: ws.id }, async function(){
      const result = applyRubricsV055ToWorkspace(ws, nowMs);
      saveState();
      if (result && result.renamed) renamedAny = true;
      console.log("RUBRICS_V055 " + JSON.stringify(Object.assign({ workspace: ws.id }, result || {}, { rubrics: rubricSourceCounts(ws) })));
    });
  }
  if (renamedAny) persistWorkspaceStore();
}
setTimeout(function(){
  runRubricsV055().catch(function(error){ console.warn("Rubrics v0.55.0 migration failed:", error && error.message || error); });
}, 112000);

// v0.55.3: starting source set per rubric (hand-picked, lib/channel-sources-v055.js). Every candidate is validated by
// reworkChannelSources before it is added; the automatic pause/replenish logic takes over from there.
const SOURCES_LOAD_V055 = "v0.55.3-rubric-sources";
const SOURCES_TOPUP_MARKER_V058 = "v0.58.0-rubric-topup";
const SOURCES_PROXY_RETRY_MARKER = "v0.60.3-proxy-retry";
let sourcesLoadV055Running = false;
async function loadRubricSourcesV055() {
  if (sourcesLoadV055Running) return;
  sourcesLoadV055Running = true;
  try {
    let retry = false;
    // The v0.58.0 top-up (reserve candidates for weak rubrics) goes through the same validated path, once per channel.
    const loads = [
      { marker: SOURCES_LOAD_V055, lists: SOURCES_V055, tag: "v0.55.3" },
      { marker: SOURCES_TOPUP_MARKER_V058, lists: SOURCES_TOPUP_V058, tag: "v0.58.0" }
    ];
    // v0.60.3: with the Russian proxy connected, candidates that failed validation from abroad are checked again (add-only).
    if (sourceProxy) loads.push({ marker: SOURCES_PROXY_RETRY_MARKER, lists: proxyRetryLists(), tag: "v0.60.3", maxAttempts: 2 });
    for (const load of loads) {
      for (const ws of workspaceStore.workspaces.slice()) {
        if (!ws || !ws.state) continue;
        const channelId = resolveChannelId(ws);
        let list = load.lists[channelId];
        if (!list || !list.length) continue;
        ws.state.migrations = Array.isArray(ws.state.migrations) ? ws.state.migrations : [];
        if (ws.state.migrations.includes(load.marker)) continue;
        if (!ws.state.migrations.includes(RUBRICS_V055_MIGRATION)) { retry = true; continue; }
        await workspaceContext.run({ workspaceId: ws.id }, async function(){
          // The top-up only ADDS: a source the channel already has (even paused, even with several rubrics) is left as it is,
          // because reworkChannelSources would otherwise overwrite its rubrics with the single one listed here.
          if (load.marker === SOURCES_TOPUP_MARKER_V058 || load.marker === SOURCES_PROXY_RETRY_MARKER) {
            const have = new Set((state.sources || []).map(function(x){ return x && sourceKey(x.url); }).filter(Boolean));
            list = list.filter(function(x){ return !have.has(sourceKey(x.url)); });
            if (!list.length) { state.migrations.push(load.marker); saveState(); return; }
          }
          const result = await reworkChannelSources(ws, { add: list.map(function(x){ return { name: x.name, url: x.url, group: x.group, rubrics: x.rubrics }; }), disable: [] }, load.tag);
          state.seedAttempts = state.seedAttempts && typeof state.seedAttempts === "object" ? state.seedAttempts : {};
          state.seedAttempts[load.marker] = Number(state.seedAttempts[load.marker] || 0) + 1;
          const done = (result && result.added.length > 0) || state.seedAttempts[load.marker] >= (load.maxAttempts || 3);
          if (done) state.migrations.push(load.marker); else retry = true;
          saveState();
          console.log("RUBRIC_SOURCES_V055 " + JSON.stringify({ workspace: ws.id, marker: load.marker, planned: list.length, added: result ? result.added.length : 0, failed: result ? result.failed.length : 0, assigned: result && result.assigned ? result.assigned.length : 0, rubrics: rubricSourceCounts(ws) }));
        });
      }
    }
    if (retry) setTimeout(function(){ loadRubricSourcesV055().catch(function(){}); }, 20 * 60 * 1000);
  } finally {
    sourcesLoadV055Running = false;
  }
}
setTimeout(function(){ loadRubricSourcesV055().catch(function(error){ console.warn("Rubric sources load failed:", error && error.message || error); }); }, 150000);

// ---------------------------------------------------------------------------
// Data protection: channel-list watchdog + off-site backup (see lib/workspace-watchdog.js, lib/offsite-backup.js)
// ---------------------------------------------------------------------------
function sendOwnerAlert(text) {
  if (!BOT_TOKEN) return Promise.resolve(false);
  const ws = getWorkspaceById(workspaceStore.defaultWorkspaceId) || workspaceStore.workspaces[0];
  const chatId = TELEGRAM_ALERT_CHAT_ID || String(ws && ws.state && ws.state.telegramAlertChatId || "").trim();
  if (!chatId) return Promise.resolve(false);
  return telegramApi("sendMessage", { chat_id: chatId, text: text, disable_web_page_preview: true }).then(function(){ return true; }).catch(function(error){
    console.warn("Owner alert failed:", error && error.message || error);
    return false;
  });
}

const workspaceAlertThrottle = createAlertThrottle(3 * 3600000);
let workspaceWatchdogLast = null;
async function workspaceWatchdogTick() {
  if (!db || !dbReady) return { skipped: "db_not_ready" };
  const live = workspaceStore.workspaces.map(function(ws){ return ws.id; });
  for (const ws of workspaceStore.workspaces) {
    await db.query(
      "INSERT INTO workspace_registry(id, name) VALUES($1,$2) ON CONFLICT (id) DO UPDATE SET last_seen=NOW(), name=EXCLUDED.name, removed_at=NULL",
      [ws.id, String(ws.name || "")]
    );
  }
  const known = (await db.query("SELECT id, name FROM workspace_registry WHERE removed_at IS NULL")).rows;
  const missing = missingWorkspaces(known, live);
  workspaceWatchdogLast = { at: new Date().toISOString(), live: live.length, missing: missing.map(function(row){ return row.id; }) };
  if (missing.length) {
    console.error("WORKSPACE_MISSING " + JSON.stringify(workspaceWatchdogLast));
    const key = missing.map(function(row){ return row.id; }).sort().join(",");
    if (workspaceAlertThrottle(key)) await sendOwnerAlert(missingAlertText(missing, live.length));
  }
  return workspaceWatchdogLast;
}
(function scheduleWorkspaceWatchdog() {
  if (/^(0|false|no|off)$/i.test(String(process.env.WORKSPACE_WATCHDOG_ENABLED || ""))) return;
  // The first tick waits for the boot-time recovery, so the registry only learns the post-recovery set of channels.
  setTimeout(function tick() {
    workspaceWatchdogTick().catch(function(error){ console.warn("Workspace watchdog failed:", error && error.message || error); });
    setTimeout(tick, 5 * 60 * 1000).unref();
  }, 120000).unref();
})();

const BACKUP_STATUS_FILE = path.join(DATA_DIR, "offsite-backup-status.json");
const BACKUP_ADVISORY_LOCK_KEY = 7242002;
let offsiteBackupRunning = false;
function readBackupStatus() {
  try { return JSON.parse(fs.readFileSync(BACKUP_STATUS_FILE, "utf8")) || {}; } catch { return {}; }
}
function writeBackupStatus(patch) {
  const next = Object.assign({}, readBackupStatus(), patch);
  try { ensureDataDir(); atomicWriteFileSync(BACKUP_STATUS_FILE, JSON.stringify(next, null, 2)); } catch (error) { console.warn("Backup status write failed:", error.message); }
  return next;
}
async function buildBackupPayload() {
  let snapshots = [];
  if (db && dbReady) {
    const rows = (await db.query("SELECT DISTINCT ON (workspace_id) workspace_id, created_at, state FROM app_snapshots ORDER BY workspace_id, created_at DESC")).rows;
    snapshots = rows.map(function(row){ return { workspaceId: row.workspace_id, createdAt: new Date(row.created_at).toISOString(), state: row.state }; });
  }
  return { format: 1, app: "news-factory", version: APP_VERSION, createdAt: new Date().toISOString(), workspaceStore: workspaceStore, snapshots: snapshots };
}
async function runOffsiteBackup(reason) {
  const cfg = backupConfig();
  const problem = backupConfigProblem(cfg);
  if (problem) return { skipped: problem };
  if (offsiteBackupRunning) return { skipped: "running" };
  offsiteBackupRunning = true;
  let lockClient = null;
  try {
    // Only one instance at a time (rolling deploys): non-blocking advisory lock.
    if (db && dbReady) {
      lockClient = await db.connect();
      const got = (await lockClient.query("SELECT pg_try_advisory_lock($1) AS ok", [BACKUP_ADVISORY_LOCK_KEY])).rows[0];
      if (!got || !got.ok) return { skipped: "locked_by_other_instance" };
    }
    const payload = await buildBackupPayload();
    const packed = packBackup(payload, cfg.passphrase);
    const key = backupObjectKey(cfg.prefix, new Date(), packed.ext);
    const uploaded = await uploadBackup(cfg, key, packed.buffer);
    const status = writeBackupStatus({ lastSuccessAt: new Date().toISOString(), lastAttemptAt: new Date().toISOString(), lastKey: key, lastBytes: uploaded.bytes, encrypted: packed.encrypted, workspaces: payload.workspaceStore.workspaces.length, consecutiveFailures: 0, lastError: "" });
    console.log("OFFSITE_BACKUP_OK " + JSON.stringify({ reason: reason, key: key, bytes: uploaded.bytes, workspaces: status.workspaces, encrypted: packed.encrypted }));
    return { ok: true, key: key, bytes: uploaded.bytes, workspaces: status.workspaces, encrypted: packed.encrypted };
  } catch (error) {
    const prev = readBackupStatus();
    const failures = Number(prev.consecutiveFailures || 0) + 1;
    writeBackupStatus({ lastAttemptAt: new Date().toISOString(), consecutiveFailures: failures, lastError: String(error && error.message || error).slice(0, 300) });
    console.error("OFFSITE_BACKUP_FAILED " + JSON.stringify({ reason: reason, failures: failures, error: String(error && error.message || error).slice(0, 300) }));
    if (failures === 2 || failures % 12 === 0) await sendOwnerAlert("⚠️ News Factory: внешний бэкап не удался " + failures + " раз(а) подряд.\n" + String(error && error.message || error).slice(0, 200));
    return { error: String(error && error.message || error).slice(0, 300) };
  } finally {
    offsiteBackupRunning = false;
    if (lockClient) {
      try { await lockClient.query("SELECT pg_advisory_unlock($1)", [BACKUP_ADVISORY_LOCK_KEY]); lockClient.release(); } catch { try { lockClient.release(true); } catch {} }
    }
  }
}
(function scheduleOffsiteBackup() {
  const cfg = backupConfig();
  if (!cfg) return;
  const problem = backupConfigProblem(cfg);
  if (problem) { console.error("OFFSITE_BACKUP_DISABLED " + JSON.stringify({ problem: problem })); return; }
  console.log("OFFSITE_BACKUP_ENABLED " + JSON.stringify({ bucket: cfg.bucket, prefix: cfg.prefix, intervalHours: cfg.intervalHours, encrypted: Boolean(cfg.passphrase) }));
  setTimeout(function tick() {
    const status = readBackupStatus();
    const recentFailure = status.consecutiveFailures > 0 && Date.now() - Date.parse(status.lastAttemptAt || "") < 30 * 60000;
    if (backupDue(status.lastSuccessAt, cfg.intervalHours) && !recentFailure) {
      runOffsiteBackup("scheduled").catch(function(error){ console.error("OFFSITE_BACKUP_FAILED " + (error && error.message || error)); });
    }
    setTimeout(tick, 10 * 60 * 1000).unref();
  }, 180000).unref();
})();

// v0.61.2: owner health alerts (silent channels, Postmypost, bot, proxy, database). See lib/health-alerts.js.
const HEALTH_SILENCE_HOURS = Math.max(2, Math.min(24, Number(process.env.HEALTH_SILENCE_HOURS || 5) || 5));
const HEALTH_ALERTS_ENABLED = !/^(0|false|no|off)$/i.test(String(process.env.HEALTH_ALERTS_ENABLED || ""));
let healthAlertsPrev = {};
let healthAlertsLast = null;
async function healthAlertsTick() {
  if (!HEALTH_ALERTS_ENABLED || !BOT_TOKEN) return;
  // Link the owner's private chat as soon as they press Start; tell them it works.
  const defaultId = workspaceStore.defaultWorkspaceId;
  const hadChat = Boolean(TELEGRAM_ALERT_CHAT_ID || String((getWorkspaceById(defaultId) || {}).state && getWorkspaceById(defaultId).state.telegramAlertChatId || "").trim());
  if (!hadChat) {
    await workspaceContext.run({ workspaceId: defaultId }, async function(){ await discoverTelegramAlertChat(); });
    const nowHas = Boolean(String((getWorkspaceById(defaultId) || {}).state && getWorkspaceById(defaultId).state.telegramAlertChatId || "").trim());
    if (nowHas) await sendOwnerAlert("✅ News Factory: оповещения подключены. Сюда будут приходить: кончились кредиты ИИ, канал молчит " + HEALTH_SILENCE_HOURS + "+ часов, сбой Postmypost, бота, прокси или базы, неудавшийся бэкап.");
    else return;
  }
  let botOk = true;
  try { await telegramApi("getMe", {}); } catch (error) { botOk = !/401|unauthorized|not found/i.test(String(error && error.message || error)); }
  let proxyOk = null;
  if (sourceProxy) { try { const probe = await sourceProxyProbe(false); proxyOk = Boolean(probe && probe.ok); } catch { proxyOk = false; } }
  const channels = workspaceStore.workspaces.map(function(ws){
    let summary = null;
    try { summary = workspaceContext.run({ workspaceId: ws.id }, function(){ return workspaceSummary(ws); }); } catch {}
    return { id: ws.id, name: ws.name, autoPublish: Boolean(summary && summary.autoPublish), paused: Boolean(summary && summary.mode === "PAUSED"), lastPublishedMs: summary && summary.lastPublishedAt ? Date.parse(summary.lastPublishedAt) : 0 };
  });
  const result = evaluateHealth({
    nowMs: Date.now(), channels: channels, silenceHours: HEALTH_SILENCE_HOURS,
    postmypostError: VK_VIA_POSTMYPOST ? postmypostMap.error : "",
    pmpPending: VK_VIA_POSTMYPOST ? pmpPendingSummary() : null,
    botConfigured: true, botOk: botOk, proxyConfigured: Boolean(sourceProxy), proxyOk: proxyOk,
    dbConfigured: Boolean(db), dbReady: Boolean(db) ? dbReady : true
  }, healthAlertsPrev);
  healthAlertsPrev = result.next;
  healthAlertsLast = { at: Date.now(), silent: result.silent.length };
  for (const item of result.send.concat(result.recovered)) {
    console.warn("HEALTH_ALERT " + JSON.stringify({ key: item.key }));
    await sendOwnerAlert(item.text);
  }
}
setTimeout(function healthTick() {
  healthAlertsTick().catch(function(error){ console.warn("HEALTH_ALERTS_FAILED " + String(error && error.message || error).slice(0, 200)); });
  setTimeout(healthTick, 10 * 60 * 1000).unref();
}, 6 * 60 * 1000).unref();

// Re-checks Postmypost publications that were still queued when we stopped waiting (see lib/pmp-reconcile.js).
async function reconcilePostmypostPending() {
  if (!POSTMYPOST_TOKEN || !VK_VIA_POSTMYPOST) return;
  const pmp = postmypostClient();
  for (const ws of workspaceStore.workspaces) {
    if (!ws || !ws.state) continue;
    await workspaceContext.run({ workspaceId: ws.id }, async function(){
      const list = Array.isArray(state.pmpPending) ? state.pmpPending : [];
      if (!list.length) return;
      const statuses = new Map();
      for (const e of list.filter(function(x){ return x && !x.failedAt; }).slice(0, 40)) {
        try { const pub = await pmp.getPublication(e.id); statuses.set(e.id, Number(pub && pub.publication_status)); } catch (error) { console.warn("VK_PMP_RECONCILE_CHECK_FAILED " + JSON.stringify({ workspace: ws.id, publication_id: e.id, error: String(error && error.message || error).slice(0, 160) })); }
      }
      const res = pmpApplyStatuses(list, statuses, Date.now());
      state.pmpPending = res.keep;
      for (const e of res.published) console.log("VK_PMP_PUBLISHED_LATE " + JSON.stringify({ workspace: ws.id, publication_id: e.id, slug: e.slug, minutes: Math.round((Date.now() - Date.parse(e.at)) / 60000) }));
      for (const e of res.failed) console.error("VK_PMP_FAILED_LATE " + JSON.stringify({ workspace: ws.id, publication_id: e.id, slug: e.slug, pmp_status: e.status }));
      for (const e of res.expired) console.error("VK_PMP_EXPIRED " + JSON.stringify({ workspace: ws.id, publication_id: e.id, slug: e.slug }));
      if (res.published.length || res.failed.length || res.expired.length) saveState();
    });
  }
}
function pmpPendingSummary() {
  const all = [];
  for (const ws of workspaceStore.workspaces) { const l = ws && ws.state && ws.state.pmpPending; if (Array.isArray(l)) for (const e of l) all.push(Object.assign({ ws: ws.name }, e)); }
  return pmpSummarize(all, Date.now());
}
setTimeout(function pmpTick() {
  reconcilePostmypostPending().catch(function(error){ console.warn("VK_PMP_RECONCILE_FAILED " + String(error && error.message || error).slice(0, 200)); });
  setTimeout(pmpTick, 5 * 60 * 1000).unref();
}, 4 * 60 * 1000).unref();

setTimeout(setupNewChannels, 30000);
setTimeout(function(){ logPostmypostStatus().catch(function(){}); }, 20000);
setInterval(function(){ refreshPostmypostMap("timer").catch(function(){}); }, 30 * 60000);
setInterval(setupNewChannels, 15 * 60 * 1000);

// Turn on automatic publishing for a new network channel only after checks:
// Telegram channel set and reachable by the bot (can post), enough working
// sources, editorial profile resolved. VK stays off (not connected).
async function enableAutoPublishingAfterChecks(ws) {
  const checks = {};
  // Never override an explicit manual choice: a REVIEW / PAUSED mode or auto_publish_telegram:false that is not the
  // fresh-workspace default (autoGate.pending) was set by a person, so the gate leaves it alone.
  const gatePending = Boolean(state.autoGate && state.autoGate.pending);
  const currentTopic = state.topicSettings && state.topicSettings.default || {};
  if (!gatePending && (state.mode !== "AUTO" || currentTopic.auto_publish_telegram === false)) {
    return { enabled: false, skippedManual: true, mode: state.mode };
  }
  checks.channelId = resolveChannelId(ws);
  checks.profile = Boolean(checks.channelId);
  checks.telegramChannel = String(ws.telegramChannel || "").trim();
  checks.sources = (state.sources || []).filter(function(x){ return x && x.enabled; }).length;
  checks.enoughSources = checks.sources >= 15;
  let botCanPost = false;
  try {
    const target = await ensureTelegramPublishTarget(ws, true);
    const chat = target.chat;
    const me = await telegramApi("getMe", {});
    const member = await telegramApi("getChatMember", { chat_id: chat.id, user_id: me.id });
    // Telegram omits can_post_messages for the creator only; an administrator must have it explicitly true.
    // The news channels are broadcast channels, so any other chat type is rejected.
    checks.chatType = String(chat.type || "");
    botCanPost = Boolean(member) && checks.chatType === "channel" &&
      (member.status === "creator" || (member.status === "administrator" && member.can_post_messages === true));
    if (checks.chatType && checks.chatType !== "channel") checks.telegramError = "chat type is " + checks.chatType + ", expected channel";
    checks.chatTitle = chat.title || "";
    checks.chatType = chat.type || "";
    checks.chatUsername = chat.username || "";
    checks.targetRepaired = Boolean(target.repaired);
  } catch (error) { checks.telegramError = String(error.message || error).slice(0, 160); }
  checks.botCanPost = Boolean(botCanPost);
  const ok = checks.profile && checks.telegramChannel && checks.enoughSources && checks.botCanPost;
  if (ok) {
    state.mode = "AUTO";
    state.topicSettings = state.topicSettings || {};
    const vkKeep = Boolean(state.vkPostmypostEnabledAt) && state.topicSettings.default && state.topicSettings.default.auto_publish_vk === true;
    state.topicSettings.default = Object.assign({}, state.topicSettings.default || {}, { auto_publish_telegram: true, auto_publish_vk: vkKeep });
    if (state.autoGate) state.autoGate = Object.assign({}, state.autoGate, { pending: false, enabledAt: new Date().toISOString() });
    saveState();
  }
  return Object.assign({ enabled: Boolean(ok), mode: state.mode }, checks);
}
setTimeout(function() {
  (async function(){
    for (const ws of workspaceStore.workspaces) {
      if (!ws || !ws.state || ws.id !== "chtotamdengi") continue;
      const migration = "v0.40.2-money-auto-publish";
      ws.state.migrations = Array.isArray(ws.state.migrations) ? ws.state.migrations : [];
      if (ws.state.migrations.includes(migration)) continue;
      await workspaceContext.run({ workspaceId: ws.id }, async function(){
        const result = await enableAutoPublishingAfterChecks(ws);
        // Retried on the next start until all checks pass.
        if (result.enabled || result.skippedManual) { state.migrations.push(migration); saveState(); }
        console.log("AUTO_PUBLISH_SETUP " + JSON.stringify(Object.assign({ workspace: ws.id }, result)));
      });
    }
  })().catch(function(error){ console.warn("Auto publish setup failed:", error.message); });
}, 70000);

// Editor's notes of 2026-10-03, once per channel: refresh the sources of weak channels (every automatically
// added source gets a 24 h trial; ones that never brought a news item that passed are replaced) and a boost of
// new sources found with the channel's hint.
const CHANNEL_NOTES_MIGRATION = "v0.50.0-channel-notes";
const CHANNEL_NOTES_MIGRATION_V0512 = "v0.51.2-channel-notes";
const CHANNEL_NOTES_V0512 = new Set(["money", "shopping"]);
// later one-off refreshes: [migration key, channels]
const CHANNEL_NOTES_STEPS = [
  [CHANNEL_NOTES_MIGRATION_V0512, CHANNEL_NOTES_V0512],
  ["v0.51.3-channel-notes", new Set(["home"])]
];
function applyChannelNotes(ws) {
  const st = ws.state;
  st.migrations = Array.isArray(st.migrations) ? st.migrations : [];
  const channelId = resolveChannelId(ws);
  // v0.51.2: money and shopping get their source refresh again (shopping had no plan in v0.50.0)
  const pendingStep = CHANNEL_NOTES_STEPS.find(function(step){ return step[1].has(channelId) && !st.migrations.includes(step[0]); });
  const migration = !st.migrations.includes(CHANNEL_NOTES_MIGRATION) ? CHANNEL_NOTES_MIGRATION : (pendingStep ? pendingStep[0] : "");
  if (!migration) return null;
  const plan = CHANNEL_SOURCE_PLANS[channelId] || null;
  const result = { workspace: ws.id, trial: 0, boost: 0 };
  if (plan && plan.refresh) {
    // seed (starter) sources stay; the rest get a trial ending between 24 and 48 h from now, so they are not
    // judged — and paused — all in the same collector run
    let i = 0;
    for (const src of st.sources || []) {
      if (src && src.enabled && src.autoAdded && src.autoAdded.from !== "seed" && src.autoAdded.from !== "dna" && !src.probationUntil && !src.autoPauseExempt) { // seed / curated (dna) lists stay
        src.probationUntil = new Date(Date.now() + (24 + (i++ % 24)) * 3600000).toISOString();
        result.trial += 1;
      }
    }
  }
  if (plan && (plan.refresh || plan.boost)) {
    st.sourceBoostRemaining = plan.boost != null ? Math.max(0, Number(plan.boost) || 0) : 15;
    st.sourceBoostUntil = new Date(Date.now() + 72 * 3600000).toISOString();
    st.sourceReplenish = Object.assign({}, st.sourceReplenish || {}, { lastAt: "" });
    result.boost = st.sourceBoostRemaining;
  }
  st.migrations.push(migration);
  // a fresh workspace takes both steps at once
  // a fresh workspace takes all steps at once
  if (migration === CHANNEL_NOTES_MIGRATION) {
    for (const step of CHANNEL_NOTES_STEPS) if (step[1].has(channelId) && !st.migrations.includes(step[0])) st.migrations.push(step[0]);
  }
  result.migration = migration;
  return result;
}

// v0.66.0 one-time clean-up (the editor asked for it): every switched-off source and every source outside the theme groups
// is removed and blocked. Without SOURCE_CLEANUP_EXECUTE=1 it only reports what it would remove (SOURCE_CLEANUP_PLAN).
const SOURCE_CLEANUP_MIGRATION = "v0.66.0-source-cleanup";
function sourceCleanupForCurrentWorkspace(execute) {
  state.migrations = Array.isArray(state.migrations) ? state.migrations : [];
  if (state.migrations.includes(SOURCE_CLEANUP_MIGRATION)) return { skipped: "done" };
  const plan = planSourceCleanup(state.sources, { groupIds: rubricIds(), includeEnabledLoose: false });
  const report = { workspace: currentWorkspaceId(), execute: Boolean(execute), total: (state.sources || []).length, dead: plan.dead.length, looseEnabledKept: plan.looseKept.length, keep: plan.keepCount, looseEnabledKeptNames: plan.looseKept.slice(0, 12).map(function(x){ return x.name; }) };
  console.log("SOURCE_CLEANUP_PLAN " + JSON.stringify(report));
  if (!execute) return Object.assign({ removed: 0 }, report);
  const n = removeSourcesFromState(plan.remove, "разовая очистка v0.66.0");
  state.migrations.push(SOURCE_CLEANUP_MIGRATION);
  saveState();
  console.log("SOURCE_CLEANUP_DONE " + JSON.stringify({ workspace: currentWorkspaceId(), removed: n, left: (state.sources || []).length }));
  return Object.assign({ removed: n, left: (state.sources || []).length }, report);
}
setTimeout(function() {
  (async function(){
    const execute = process.env.SOURCE_CLEANUP_EXECUTE === "1";
    for (const ws of workspaceStore.workspaces) {
      if (!ws || !ws.state) continue;
      await workspaceContext.run({ workspaceId: ws.id }, async function(){ try { sourceCleanupForCurrentWorkspace(execute); } catch (error) { console.warn("Source cleanup failed for " + ws.id + ": " + error.message); } });
    }
  })().catch(function(error){ console.warn("Source cleanup failed:", error.message); });
}, 300000);

// v0.67.1 one-time (the editor asked for it): enabled sources that stayed outside every theme group after the v0.67.0 assignment are removed and blocked.
const LOOSE_REMOVE_MARKER = "v0.67.1-loose-remove";
function removeUnfitLooseForCurrentWorkspace() {
  state.migrations = Array.isArray(state.migrations) ? state.migrations : [];
  if (state.migrations.includes(LOOSE_REMOVE_MARKER)) return { skipped: "done" };
  if (!state.migrations.includes(ASSIGN_MARKER)) return { skipped: "assign_not_done" };
  const plan = planSourceCleanup(state.sources, { groupIds: rubricIds(), includeEnabledLoose: true });
  const judged = new Set((state.sources || []).filter(function(x){ return x && x.rubricAssignJudgedAt; }).map(function(x){ return x.id; }));
  const targets = plan.remove.filter(function(x){ return judged.has(x && x.id !== undefined ? x.id : x); });
  const n = removeSourcesFromState(targets, "удаление не подошедших v0.67.1");
  state.migrations.push(LOOSE_REMOVE_MARKER);
  saveState();
  console.log("SOURCE_LOOSE_REMOVED " + JSON.stringify({ workspace: currentWorkspaceId(), removed: n }));
  return { removed: n };
}
setTimeout(function() {
  (async function(){
    for (const ws of workspaceStore.workspaces) {
      if (!ws || !ws.state) continue;
      await workspaceContext.run({ workspaceId: ws.id }, async function(){ try { removeUnfitLooseForCurrentWorkspace(); } catch (error) { console.warn("Loose remove failed for " + ws.id + ": " + error.message); } });
    }
  })().catch(function(error){ console.warn("Loose remove failed:", error.message); });
}, 600000);

// v0.67.0: enabled sources outside every theme group get attached to the theme(s) they fit (keywords first, then one AI call per batch).
// A source nothing fits stays as it is. Never run twice; if the AI is unavailable nothing is marked and the next start retries.
async function assignLooseSourcesForCurrentWorkspace() {
  state.migrations = Array.isArray(state.migrations) ? state.migrations : [];
  if (state.migrations.includes(ASSIGN_MARKER)) return { skipped: "done" };
  const ws = currentWorkspace();
  const channelId = resolveChannelId(ws);
  const rubrics = channelRubrics(ws);
  const ids = new Set(rubrics.map(function(r){ return r.id; }));
  if (!ids.size) { state.migrations.push(ASSIGN_MARKER); return { skipped: "no_rubrics" }; }
  const nowIso = new Date().toISOString();
  const loose = (state.sources || []).filter(function(x){ return x && x.enabled && !inAnyGroup(x, ids) && !x.rubricAssignJudgedAt; });
  let byKeywords = 0, byAi = 0, unfit = 0;
  const rest = [];
  for (const src of loose) {
    const themes = RUBRIC_PLAN_V055[channelId] ? classifySourceV055(channelId, src).filter(function(id){ return ids.has(id); }) : [];
    if (themes.length) { tagSource(src, themes, nowIso); byKeywords += 1; } else rest.push(src);
  }
  if (rest.length && !OPENAI_API_KEY) return { skipped: "no_ai", loose: loose.length };
  for (let i = 0; i < rest.length; i += ASSIGN_BATCH) {
    const batch = rest.slice(i, i + ASSIGN_BATCH);
    const prompt = buildAssignPrompt({ channelName: ws && ws.name || "", topic: channelTopic(channelId) || CHANNEL_TOPICS_RU[channelId] || "", rubrics: rubrics, sources: batch });
    let verdicts = null;
    try {
      const response = await llmResponsesFetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + OPENAI_API_KEY },
        body: JSON.stringify({ model: OPENAI_MODEL, input: prompt, max_output_tokens: 4000, text: { format: { type: "json_object" } } }),
        signal: AbortSignal.timeout(60000)
      });
      const data = await response.json().catch(function(){ return {}; });
      if (!response.ok) throw new Error(data && data.error && data.error.message || ("HTTP " + response.status));
      recordOpenAIResponseUsage(OPENAI_MODEL, "source_rubric_assign", data, "responses", { items: batch.length });
      verdicts = parseAssignResult(extractOpenAIText(data), batch.length, ids);
      if (!verdicts) throw new Error("не удалось разобрать ответ");
      if (verdicts.size < Math.ceil(batch.length * ASSIGN_MIN_ANSWERED)) throw new Error("ответ неполный: " + verdicts.size + " из " + batch.length);
    } catch (error) {
      console.warn("SOURCE_RUBRIC_ASSIGN_ERROR " + JSON.stringify({ workspace: currentWorkspaceId(), error: String(error && error.message || error).slice(0, 160) }));
      maybeBillingAlert(error && error.message);
      saveState();
      return { skipped: "ai_error", byKeywords: byKeywords, byAi: byAi };
    }
    batch.forEach(function(src, index) {
      const got = verdicts.get(index + 1) || [];
      if (got.length) { tagSource(src, got, nowIso); byAi += 1; } else { src.rubricAssignJudgedAt = nowIso; unfit += 1; } // judged once: never paid for twice
    });
  }
  state.migrations.push(ASSIGN_MARKER);
  saveState();
  const report = { workspace: currentWorkspaceId(), loose: loose.length, byKeywords: byKeywords, byAi: byAi, unfit: unfit };
  console.log("SOURCE_RUBRIC_ASSIGN_DONE " + JSON.stringify(report));
  return report;
}
setTimeout(function() {
  (async function(){
    for (const ws of workspaceStore.workspaces) {
      if (!ws || !ws.state) continue;
      await workspaceContext.run({ workspaceId: ws.id }, async function(){
        try { await assignLooseSourcesForCurrentWorkspace(); } catch (error) { console.warn("Source rubric assign failed for " + ws.id + ": " + error.message); }
      });
    }
  })().catch(function(error){ console.warn("Source rubric assign failed:", error.message); });
}, 420000);

// Top up sources to the target shortly after start (respects the throttle).
setTimeout(function() {
  (async function(){
    for (const ws of workspaceStore.workspaces) {
      if (!ws || !ws.state) continue;
      await workspaceContext.run({ workspaceId: ws.id }, async function(){
        const notes = applyChannelNotes(ws);
        if (notes) { saveState(); console.log("CHANNEL_NOTES_APPLIED " + JSON.stringify(notes)); }
        const result = await replenishSources("startup");
        console.log("Source replenish " + ws.id + ": " + JSON.stringify(result));
      });
    }
  })().catch(function(error){ console.warn("Source replenish failed:", error.message); });
}, 120000);

// Queue posts whose picture is a remote URL, a missing/tiny file or not an
// image get a generated cover instead (video posts keep the video).
async function repairBrokenQueueImages() {
  let fixed = 0, failed = 0;
  if (!PUBLIC_BASE_URL) return { fixed: 0, failed: 0, skipped: "no_public_base_url" };
  // Safety: if most of the queue looks broken, something else is wrong (paths,
  // volume) — do not replace everything with generated covers.
  const withImages = (state.queue || []).filter(function(q){ return q && q.newsId && !q.telegramPublished && (q.enhancedImageUrl || q.imageUrl); });
  let broken = 0;
  for (const q of withImages) {
    const image = q.enhancedImageUrl || q.imageUrl;
    const fp = await localImageFingerprint(image);
    const quality = assessMediaQuality(fp, { url: image, score: 80, reason: "queue_repair" });
    if (!quality.pass) broken += 1;
  }
  if (withImages.length >= 6 && broken > withImages.length / 2) return { fixed: 0, failed: 0, skipped: "too_many_broken", broken: broken, total: withImages.length };
  for (const item of (state.queue || [])) {
    if (!item || !item.newsId || item.telegramPublished) continue;
    const img = String(item.enhancedImageUrl || item.imageUrl || "").trim();
    let ok = false;
    if (img) {
      // Only files in our /media folder count; remote URLs give no fingerprint.
      const fp = await localImageFingerprint(img);
      ok = assessMediaQuality(fp, { url: img, score: 80, reason: "queue_repair" }).pass;
    }
    if (ok) continue;
    if (!img && item.generatedImageUrl) continue;
    if (!img && item.videoUrl) continue;
    try {
      if (item.videoUrl) { item.imageUrl = ""; item.enhancedImageUrl = ""; fixed += 1; continue; }
      const generated = await renderEconomyTextCard({
        id: item.newsId || item.id,
        title: item.title,
        text: item.text,
        topicId: item.topicId || currentWorkspace().channelId || "",
        cardNote: "Редакционная карточка"
      });
      if (img && !item.originalImageUrl) item.originalImageUrl = img;
      item.imageUrl = "";
      item.enhancedImageUrl = "";
      item.mediaPackUrls = [];
      item.generatedImageUrl = generated.url;
      item.mediaType = "generated";
      item.mediaStatus = "local_card";
      item.mediaOrigin = "local_branded_card";
      item.generatedBy = generated.model;
      item.generatedAt = new Date().toISOString();
      fixed += 1;
    } catch (error) { failed += 1; console.warn("Broken queue image repair failed:", item.id, error.message); }
  }
  if (fixed) saveState();
  return { fixed: fixed, failed: failed };
}
setTimeout(function() {
  (async function(){
    for (const ws of workspaceStore.workspaces) {
      if (!ws || !ws.state) continue;
      await workspaceContext.run({ workspaceId: ws.id }, async function(){
        const result = await repairBrokenQueueImages();
        console.log("QUEUE_IMAGE_REPAIR " + JSON.stringify(Object.assign({ workspace: ws.id }, result)));
      });
    }
  })().catch(function(error){ console.warn("Queue image repair failed:", error.message); });
}, 50000);

// One-time removal of duplicate stories already waiting in the queue.
setTimeout(function() {
  (async function(){
    const migration = "v0.39.3-queue-dedupe";
    for (const ws of workspaceStore.workspaces) {
      if (!ws || !ws.state) continue;
      ws.state.migrations = Array.isArray(ws.state.migrations) ? ws.state.migrations : [];
      if (ws.state.migrations.includes(migration)) continue;
      await workspaceContext.run({ workspaceId: ws.id }, async function(){
        const removed = await dedupeQueueOnce();
        // If the model was unavailable for some comparison, try again on the next start.
        if (!removed.incomplete && OPENAI_API_KEY) state.migrations.push(migration);
        saveState();
        console.log("QUEUE_DEDUPE " + JSON.stringify({ workspace: ws.id, removed: removed, incomplete: Boolean(removed.incomplete) }));
      });
    }
  })().catch(function(error){ console.warn("Queue dedupe failed:", error.message); });
}, 100000);

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

setTimeout(function(){
  (async function(){
    for (const ws of workspaceStore.workspaces) {
      if (!ws || !ws.telegramChannel) continue;
      await workspaceContext.run({ workspaceId: ws.id }, async function(){
        try {
          const target = await ensureTelegramPublishTarget(ws, true);
          // v0.55.1: the cabinet shows the channel's real Telegram title when it carries the «<название> | <тема>» form
          const tgTitle = String(target && target.chat && target.chat.title || "").trim();
          if (tgTitle && tgTitle.includes(" | ") && tgTitle.length <= 120 && tgTitle !== ws.name) {
            console.log("CHANNEL_NAME_SYNC " + JSON.stringify({ workspace: ws.id, from: ws.name, to: tgTitle }));
            if (!ws.channelId) ws.channelId = resolveChannelId(ws);
            ws.name = tgTitle;
            ws.updatedAt = new Date().toISOString();
            persistWorkspaceStore();
          }
          let previewPosts = null;
          if (target.username) {
            try {
              const response = await fetch("https://t.me/s/" + encodeURIComponent(target.username), {
                headers: { "user-agent": "Mozilla/5.0 (compatible; NewsFactoryTelegramHealth/1.0)" },
                signal: AbortSignal.timeout(10000)
              });
              if (response.ok) previewPosts = parseTelegramPreview(await response.text()).posts.length;
            } catch {}
          }
          console.log("TELEGRAM_TARGET_HEALTH " + JSON.stringify({
            workspace: ws.id,
            configured: ws.telegramChannel,
            type: target.chat && target.chat.type || "",
            chatId: target.chatId,
            username: target.username,
            title: target.title,
            repaired: target.repaired,
            previewPosts: previewPosts
          }));
        } catch (error) {
          console.error("TELEGRAM_TARGET_HEALTH " + JSON.stringify({
            workspace: ws.id,
            configured: ws.telegramChannel,
            error: String(error && error.message || error)
          }));
        }
      });
    }
  })().catch(function(error){ console.warn("Telegram target health scan failed:", error.message); });
}, 7000);

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

let shutdownStarted = false;

function criticalWorkInFlight() {
  return collectorRunningWorkspaces.size + schedulerTickRunning.size + replenishRunning.size + digestRunning.size + publishLocks.size;
}

// v0.61.1: one stray rejection must not take the whole network down. Rejections are logged and counted; a truly
// uncaught exception flushes state through the graceful path and exits so Railway restarts a clean process.
const processFaults = { rejections: 0, exceptions: 0, last: "" };
const loopLagHistogram = (function(){ try { const h = monitorEventLoopDelay({ resolution: 20 }); h.enable(); return h; } catch { return null; } })();
process.on("unhandledRejection", function(reason) {
  processFaults.rejections += 1;
  processFaults.last = String(reason && reason.message || reason).slice(0, 200);
  console.error("PROCESS_UNHANDLED_REJECTION " + JSON.stringify({ count: processFaults.rejections, error: processFaults.last, stack: String(reason && reason.stack || "").split("\n").slice(0, 4).join(" | ").slice(0, 400) }));
});
process.on("uncaughtException", function(error) {
  processFaults.exceptions += 1;
  console.error("PROCESS_UNCAUGHT_EXCEPTION " + JSON.stringify({ error: String(error && error.message || error).slice(0, 200), stack: String(error && error.stack || "").split("\n").slice(0, 4).join(" | ").slice(0, 400) }));
  gracefulShutdown("uncaughtException").catch(function(){ process.exit(1); });
  setTimeout(function(){ process.exit(1); }, 15000).unref();
});
async function gracefulShutdown(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  console.log("GRACEFUL_SHUTDOWN_START " + signal);

  if (collectorTimer) { clearInterval(collectorTimer); collectorTimer = null; }

  await new Promise(function(resolve) {
    let settled = false;
    const done = function() { if (!settled) { settled = true; resolve(); } };
    try { server.close(done); }
    catch { done(); }
    setTimeout(done, 15000);
  });

  const waitUntil = Date.now() + 15000;
  while (criticalWorkInFlight() > 0 && Date.now() < waitUntil) {
    await new Promise(function(resolve){ setTimeout(resolve, 100); });
  }

  try {
    if (storeFlushTimer || storeDirtySince) flushWorkspaceStoreNow();
    console.log("STATE_FLUSHED_ON_" + signal);
  } catch (error) {
    console.error("STATE_FLUSH_ON_EXIT_FAILED " + JSON.stringify({ error: String(error && error.message || error) }));
  }

  try { if (db) await db.end(); } catch (error) { console.warn("DB_CLOSE_FAILED:", error && error.message || error); }
  console.log("GRACEFUL_SHUTDOWN_DONE " + signal + " active=" + criticalWorkInFlight());
  process.exit(0);
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, function(){ gracefulShutdown(signal).catch(function(error){
    console.error("GRACEFUL_SHUTDOWN_FAILED " + signal + ":", error && error.message || error);
    process.exit(1);
  }); });
}

server.listen(PORT, "0.0.0.0", function() {
  console.log("News Factory listening on :" + PORT);
  // Broken/expired source images must never delay Railway health readiness.
  setTimeout(function() {
    repairBalancedQueueMediaAllWorkspaces().catch(function(error){
      console.warn("Balanced media repair background failed:", error.message);
    });
  }, 1000);

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
