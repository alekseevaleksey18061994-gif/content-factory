// Extracted from server.js (v0.62.0 module split). Behaviour is unchanged.
import { TEXT_CARD_POSTS_ALLOWED } from "./env-config.js";
import { canonicalizeUrl, normalizeDate, stripHtml } from "./article-extract.js";

// True when the post has no photo/video of its own and would go out with the locally drawn text card only.
export function isTextCardOnly(item) {
  if (!item) return false;
  const meta = item.metadata || {};
  if (item.videoUrl || item.imageUrl || meta.videoUrl || meta.imageUrl) return false;
  const generated = String(item.generatedImageUrl || meta.generatedImageUrl || "");
  if (!generated) return false;
  return item.mediaOrigin === "local_branded_card" || item.mediaStatus === "local_card" ||
    /^local-branded-card/.test(String(item.generatedBy || "")) || /(?:^|\/)budget_card_[^/]*\.webp(?:\?|$)/.test(generated);
}

export function textCardBlocked(item) { return !TEXT_CARD_POSTS_ALLOWED && isTextCardOnly(item); }

export function hasPublishableMedia(item) {
  return Boolean(item && (item.videoUrl || item.imageUrl || item.generatedImageUrl || (item.metadata && (item.metadata.videoUrl || item.metadata.imageUrl || item.metadata.generatedImageUrl))));
}

export function extractTelegramSourcePosts(html, sourceUrl) {
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

export function extractArticleLinks(html, sourceUrl) {
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

export const statusCache = new Map();

export const analyticsCache = new Map();

export function parseCompactNumber(value) {
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

export function metricFromChunk(chunk, classPattern) {
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

export function parseTelegramPreview(html) {
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

