// Decides whether a post whose VK part failed on the media stage may be re-sent to VK only.
// Telegram is never touched. Only failures that look like a temporary Postmypost/network problem are retried,
// a limited number of times, with a pause between attempts, and never "uncertain" posts (those may already exist in VK).
export const VK_MEDIA_RETRY_MAX_DEFAULT = 3;
export const VK_MEDIA_RETRY_GAP_MIN_DEFAULT = 10;
export const VK_MEDIA_RETRY_WINDOW_MIN_DEFAULT = 180;

const TRANSIENT = /→ 50[0-4]\b|HTTP 50[0-4]\b|internal server error|bad gateway|service unavailable|gateway time-?out|не завершилась вовремя|timed? ?out|timeout|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up/i;
const PERMANENT = /ENOSPC|no space left|access denied|invalid token|error_code\W*(5|15|27|214)\b|завершилась ошибкой|авторизац|не найден|\b(401|403|404|422)\b/i;

export function vkMediaRetryDecision(item, nowMs, opts) {
  const o = opts || {};
  const max = Number.isFinite(o.max) && o.max >= 0 ? o.max : VK_MEDIA_RETRY_MAX_DEFAULT;
  const gapMs = (Number.isFinite(o.gapMin) && o.gapMin >= 1 ? o.gapMin : VK_MEDIA_RETRY_GAP_MIN_DEFAULT) * 60000;
  const windowMs = (Number.isFinite(o.windowMin) && o.windowMin >= 1 ? o.windowMin : VK_MEDIA_RETRY_WINDOW_MIN_DEFAULT) * 60000;
  if (!item || typeof item !== "object") return { retry: false, reason: "no_item" };
  if (!max) return { retry: false, reason: "disabled" };
  if (!item.telegramPublished) return { retry: false, reason: "telegram_not_published" };
  if (item.vkPublished || item.vkPostId) return { retry: false, reason: "already_in_vk" };
  // A send that started but never reported back (crash): the post may already be in VK - never re-send automatically.
  if (item.vkMediaRetryInFlight) return { retry: false, reason: "in_flight_unknown" };
  if (item.vkUncertain || item.vkStatus === "uncertain") return { retry: false, reason: "uncertain" };
  if (item.vkStatus !== "media_failed") return { retry: false, reason: "not_media_failed" };
  const err = String(item.vkError || "");
  if (PERMANENT.test(err)) return { retry: false, reason: "permanent_error" };
  if (!TRANSIENT.test(err)) return { retry: false, reason: "unknown_error" };
  const failedAt = Date.parse(item.vkFailedAt || "");
  if (!Number.isFinite(failedAt)) return { retry: false, reason: "no_failed_at" };
  if (nowMs - failedAt > windowMs) return { retry: false, reason: "too_old" };
  if (nowMs - failedAt < gapMs) return { retry: false, reason: "too_soon" };
  const tries = Math.max(0, Number(item.vkMediaRetryCount || 0));
  if (tries >= max) return { retry: false, reason: "max_tries" };
  const lastTry = Date.parse(item.vkMediaRetryAt || "");
  if (Number.isFinite(lastTry) && nowMs - lastTry < gapMs) return { retry: false, reason: "too_soon" };
  return { retry: true, reason: "transient" };
}
