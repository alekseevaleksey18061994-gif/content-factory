// Extracted from server.js (v0.62.0 module split). Behaviour is unchanged.
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { safeFetch } from "./safe-fetch.js";
import { assertSafeRaster } from "./image-guard.js";
import sharp from "sharp";
import { PUBLIC_BASE_URL } from "./env-config.js";

export const DATA_DIR = process.env.DATA_DIR || "/data";

export const MEDIA_DIR = path.join(DATA_DIR, "media");

export const VK_PREVIEW_WIDTH = 1200;

export const VK_PREVIEW_HEIGHT = 630;

export const VK_PREVIEW_MAX_BYTES = Math.max(200000, Math.min(1048576, Number(process.env.VK_PREVIEW_MAX_BYTES || 950000)));

export const VK_PREVIEW_JPEG_QUALITY = Math.max(45, Math.min(90, Number(process.env.VK_PREVIEW_JPEG_QUALITY || 82)));

export function ensureDataDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
  try { fs.mkdirSync(MEDIA_DIR, { recursive: true }); } catch {}
}

// options.assumeMoscow: a timestamp without a zone ("2026-10-01T11:30:00") comes from a Russian site and means
// Moscow time (+03:00); read as UTC it would look 3 hours newer than it is.
export function normalizeDate(value, options) {
  if (!value) return "";
  const raw = String(value).trim();
  let d;
  const naive = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/.exec(raw);
  if (naive && options && options.assumeMoscow) d = new Date(naive[1] + "T" + naive[2] + "+03:00");
  else d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return "";
  if (d.getTime() > Date.now() + 24 * 60 * 60 * 1000) return "";
  return d.toISOString();
}

export function canonicalizeUrl(raw, base) {
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

export function htmlDecode(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, function(_, n){ return String.fromCharCode(Number(n)); });
}

export function stripHtml(html) {
  return htmlDecode(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
  ).trim();
}

export function extractTitle(html) {
  const og = String(html || "").match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
             String(html || "").match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["'][^>]*>/i);
  if (og && og[1]) return stripHtml(og[1]).slice(0, 300);
  const m = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripHtml(m[1]).slice(0, 300) : "";
}

export function extractPublishedAt(html, hint) {
  const source = String(html || "");
  let assumeMoscow = false;
  try { assumeMoscow = /(\.ru|\.su|\.рф|\.xn--p1ai)$/i.test(new URL(String(hint && hint.url || "")).hostname); } catch {}
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
    const normalized = normalizeDate(htmlDecode(m[1]), { assumeMoscow: assumeMoscow });
    if (normalized) return normalized;
  }
  return "";
}

// Site preview for the Sources page: share image, favicon and page title.
export function extractSitePreview(html, pageUrl) {
  const src = String(html || "");
  let icon = "";
  const links = src.match(/<link[^>]+>/gi) || [];
  const ranked = [];
  for (const tag of links) {
    const rel = (tag.match(/rel=["']([^"']+)["']/i) || [])[1] || "";
    const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1] || "";
    if (!href || !/icon/i.test(rel)) continue;
    const size = Number(((tag.match(/sizes=["'](\d+)x\d+["']/i) || [])[1]) || (/apple-touch/i.test(rel) ? 180 : 32));
    ranked.push({ href: href, size: size });
  }
  ranked.sort(function(a, b){ return Math.abs(a.size - 96) - Math.abs(b.size - 96); });
  if (ranked[0]) icon = canonicalizeUrl(htmlDecode(ranked[0].href), pageUrl) || "";
  if (!icon) { try { icon = new URL("/favicon.ico", pageUrl).toString(); } catch {} }
  const title = htmlDecode(((src.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i) || [])[1]) ||
    ((src.match(/<title[^>]*>([^<]{1,160})<\/title>/i) || [])[1]) || "").trim().slice(0, 120);
  return { image: extractMetaImage(src, pageUrl) || "", icon: /^https?:\/\//i.test(icon) ? icon : "", title: title, at: new Date().toISOString() };
}

export function extractMetaImage(html, pageUrl) {
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

// Telegram sendVideo only plays MPEG-4 (.mp4 / .m4v): a .webm is delivered as a plain "logo.webm" file
// attachment, and a QuickTime .mov is not reliably accepted, so only MPEG-4 containers pass. Short decorative clips (animated logos, backgrounds, hero loops) found on
// article pages are not news video either, so neither is accepted as a post video.
export function isUsableNewsVideoUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) return false;
  let pathname = value;
  try { pathname = new URL(value, PUBLIC_BASE_URL).pathname; } catch {}
  if (!/\.(mp4|m4v)$/i.test(pathname)) return false;
  let base = pathname.split("/").pop() || "";
  try { base = decodeURIComponent(base); } catch { return false; }
  if (/(^|[-_.\s])(logo|logotype|loop|intro|outro|bg|background|header|hero|banner|favicon|icon|sprite|placeholder|ambient|teaser-loop)([-_.\s\d]|$)/i.test(base)) return false;
  return true;
}

export function extractMetaVideo(html, pageUrl) {
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
    if (url && /^https?:\/\//i.test(url) && /\.(mp4|mov|m4v|webm)(\?|$)/i.test(url) && isUsableNewsVideoUrl(url)) return url;
  }
  return "";
}

export function extractArticleMediaCandidates(html, pageUrl) {
  const source = String(html || "");
  const images = [];
  const videos = [];
  const imageSeen = new Set();
  const videoSeen = new Set();

  function addImage(raw, score, reason, meta) {
    const url = canonicalizeUrl(htmlDecode(raw || ""), pageUrl);
    if (!url || !/^https?:\/\//i.test(url) || imageSeen.has(url)) return;
    if (/\.(svg|ico)(\?|$)/i.test(url)) return;
    let nextScore = Number(score || 0);
    if (/(?:logo|avatar|icon|sprite|emoji|badge|pixel|tracker|placeholder|favicon)/i.test(url)) nextScore -= 80;
    if (/(?:article|news|upload|media|image|photo|press|cdn|content)/i.test(url)) nextScore += 8;
    if (nextScore < 15) return;
    imageSeen.add(url);
    images.push(Object.assign({ url: url, score: nextScore, reason: reason || "page_image" }, meta || {}));
  }

  function addVideo(raw, score, reason) {
    const url = canonicalizeUrl(htmlDecode(raw || ""), pageUrl);
    if (!url || !/^https?:\/\//i.test(url) || videoSeen.has(url)) return;
    if (!/\.(mp4|mov|m4v|webm)(\?|$)/i.test(url)) return;
    if (!isUsableNewsVideoUrl(url)) return;
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
    if (width >= 1200 || height >= 800) score += 40;
    else if (width >= 900 || height >= 600) score += 30;
    else if (width >= 500 || height >= 350) score += 15;
    else if (width && height && (width < 320 || height < 200)) score -= 35;
    const alt = String(altMatch && altMatch[1] || "");
    if (alt.length >= 20) score += 10;
    if (/(?:logo|avatar|icon|banner|advert|реклам|логотип|флаг|герб|скриншот|screenshot)/i.test(alt)) score -= 50;
    addImage(raw, score, "article_img", { alt: alt.slice(0, 300), width: width, height: height });
  }

  const posterRe = /<video\b[^>]*poster=["']([^"']+)["'][^>]*>/gi;
  while ((m = posterRe.exec(source))) addImage(m[1], 85, "video_poster");

  const videoRe = /<(?:video|source)\b[^>]*src=["']([^"']+)["'][^>]*>/gi;
  while ((m = videoRe.exec(source))) addVideo(m[1], 90, "video_tag");

  images.sort(function(a,b){ return b.score - a.score; });
  videos.sort(function(a,b){ return b.score - a.score; });
  return { images: images.slice(0, 12), videos: videos.slice(0, 4) };
}

export function mediaPublicUrl(fileName) {
  return PUBLIC_BASE_URL + "/media/" + encodeURIComponent(fileName);
}

export function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function previewDescription(post) {
  const title = String(post && post.title || "").replace(/[*_>#`]/g, " ").replace(/\s+/g, " ").trim();
  const body = String(post && post.text || "").replace(/[*_>#`]/g, " ").replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim();
  return (title + (body ? " — " + body : "")).slice(0, 280);
}

export function previewSlug(post) {
  const base = String(post && (post.postId || post.id || post.newsId) || "post")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "post";
  return base + "-" + Date.now().toString(36) + "-" + crypto.randomBytes(5).toString("hex");
}

export function previewPageUrl(slug) {
  return PUBLIC_BASE_URL + "/p/" + encodeURIComponent(slug);
}

export function localMediaPathFromUrl(rawUrl) {
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

export async function loadPreviewSourceBytes(rawUrl) {
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
  // Third-party URL: SSRF-safe download with a hard size cap, raster formats only (no SVG).
  const response = await safeFetch(absolute, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; NewsFactoryPreview/1.0)" },
    timeoutMs: 30000,
    maxBytes: 20 * 1024 * 1024
  });
  if (!response.ok) throw new Error("Не удалось скачать preview-изображение: HTTP " + response.status);
  const type = String(response.headers.get("content-type") || "").toLowerCase();
  if (!type.startsWith("image/")) throw new Error("Preview-источник не является изображением");
  const bytes = response.body;
  if (!bytes.length) throw new Error("Preview-изображение пустое");
  await assertSafeRaster(bytes);
  return bytes;
}

export function wrapPreviewTitle(value, maxChars, maxLines) {
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

export function buildTemplatePreviewSvg(post) {
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

export async function encodePreviewJpeg(inputBytes) {
  const qualities = Array.from(new Set([
    VK_PREVIEW_JPEG_QUALITY,
    Math.max(45, VK_PREVIEW_JPEG_QUALITY - 8),
    Math.max(45, VK_PREVIEW_JPEG_QUALITY - 16),
    58,
    50,
    45
  ]));
  let last = null;
  // v0.60.4: a photo whose shape differs from 1200x630 is shown WHOLE on a blurred copy of itself (no cropped edges/text);
  // near-matching shapes still fill the frame.
  let base = null;
  try {
    const rotated = await sharp(inputBytes, { limitInputPixels: 80 * 1000 * 1000 }).rotate().toBuffer({ resolveWithObject: true });
    const ratio = rotated.info.width / Math.max(1, rotated.info.height);
    if (Math.abs(ratio / (VK_PREVIEW_WIDTH / VK_PREVIEW_HEIGHT) - 1) > 0.08) {
      const bg = await sharp(rotated.data).resize(VK_PREVIEW_WIDTH, VK_PREVIEW_HEIGHT, { fit: "cover", position: "centre" }).blur(28).modulate({ brightness: 0.75 }).toBuffer();
      const fg = await sharp(rotated.data).resize(VK_PREVIEW_WIDTH, VK_PREVIEW_HEIGHT, { fit: "inside", withoutEnlargement: false }).toBuffer();
      base = await sharp(bg).composite([{ input: fg, gravity: "centre" }]).png().toBuffer();
    }
  } catch (error) { base = null; }
  for (const quality of qualities) {
    const out = await sharp(base || inputBytes, { limitInputPixels: 80 * 1000 * 1000 })
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

export async function buildMediaPackCollage(urls) {
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

export async function prepareVkPreviewImage(post, slug) {
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

export function normalizePublicPostSources(post) {
  const p = post || {};
  if (p.hidePublicSources === true) return [];
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

