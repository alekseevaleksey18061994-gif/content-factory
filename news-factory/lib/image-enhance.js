// Extracted from server.js (v0.62.0 module split). Behaviour is unchanged.
import fs from "node:fs";
import { safeFetch } from "./safe-fetch.js";
import { assertSafeRaster, SAFE_INPUT_PIXELS } from "./image-guard.js";
import sharp from "sharp";
import crypto from "node:crypto";
import path from "node:path";
import { IMAGE_ENHANCEMENT_ENABLED } from "./env-config.js";
import { MEDIA_DIR, ensureDataDir, localMediaPathFromUrl, mediaPublicUrl } from "./article-extract.js";
import { isLocalMediaUrl } from "./telegram-upload.js";

// Quality-only enhancement of a real news photo. Deliberately NOT generative: an image
// model redraws the picture (invented details, changed sky, padded borders from a fixed
// output size). Here the pixels of the scene stay the same — only technical quality:
// EXIF orientation, moderate upscale of small photos, light denoise, gentle sharpening
// and a very mild contrast lift. Same composition and aspect ratio.
export const ENHANCE_TARGET_WIDTH = 1600;

export async function enhanceNewsImage(payload) {
  if (!IMAGE_ENHANCEMENT_ENABLED) throw new Error("Улучшение изображений отключено");

  const imageUrl = String(payload.imageUrl || "").trim();
  let bytes = null;
  const localFile = localMediaPathFromUrl(imageUrl);
  if (localFile && fs.existsSync(localFile)) {
    bytes = fs.readFileSync(localFile);
  } else {
    if (!/^https?:\/\//i.test(imageUrl)) throw new Error("Нет исходного изображения для улучшения");
    const sourceResponse = await safeFetch(imageUrl, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; NewsFactoryMedia/1.0)" },
      timeoutMs: 30000,
      maxBytes: 25 * 1024 * 1024
    });
    if (!sourceResponse.ok) throw new Error("Не удалось скачать исходное фото: HTTP " + sourceResponse.status);
    bytes = sourceResponse.body;
  }
  if (!bytes || !bytes.length) throw new Error("Исходное изображение пустое");
  if (bytes.length > 25 * 1024 * 1024) throw new Error("Исходное изображение слишком большое");

  const meta = await assertSafeRaster(bytes);
  const width = Number(meta.width || 0);
  if (!width) throw new Error("Не удалось определить размер изображения");

  let pipeline = sharp(bytes, { failOn: "none", limitInputPixels: SAFE_INPUT_PIXELS }).rotate();
  if (width < ENHANCE_TARGET_WIDTH) {
    // Upscale at most 2x: beyond that interpolation only adds blur.
    pipeline = pipeline.resize({ width: Math.min(ENHANCE_TARGET_WIDTH, width * 2), kernel: "lanczos3", withoutEnlargement: false });
  }
  // median(3) throws "rank: window too large" on tiny images (a side under the window).
  const height = Number(meta.height || 0);
  if (width < 1000 && width >= 16 && height >= 16) pipeline = pipeline.median(3);
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

export async function cacheSourceImage(imageUrl, id) {
  const sourceUrl = String(imageUrl || "").trim();
  if (!sourceUrl) return "";
  if (isLocalMediaUrl(sourceUrl)) return sourceUrl;

  const response = await safeFetch(sourceUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; NewsFactory/1.0; +https://news-factory-api-production.up.railway.app)",
      "accept": "image/webp,image/jpeg,image/png,image/gif,image/*;q=0.5"
    },
    timeoutMs: 30000,
    maxBytes: 20 * 1024 * 1024
  });
  if (!response.ok) throw new Error("Фото источника HTTP " + response.status);
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("image/")) throw new Error("Источник вернул не изображение");

  const bytes = response.body;
  if (!bytes.length) throw new Error("Фото источника пустое");
  if (bytes.length > 20 * 1024 * 1024) throw new Error("Фото источника больше 20 МБ");
  await assertSafeRaster(bytes); // jpeg/png/webp/gif/avif only: SVG is never rasterised

  ensureDataDir();
  const safeId = String(id || crypto.randomBytes(8).toString("hex")).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 70);
  const fileName = "source_" + safeId + "_" + Date.now() + ".webp";
  const filePath = path.join(MEDIA_DIR, fileName);

  await sharp(bytes, { limitInputPixels: SAFE_INPUT_PIXELS })
    .rotate()
    .resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 90 })
    .toFile(filePath);

  return mediaPublicUrl(fileName);
}

export async function prepareReusableSourceImage(imageUrl, id) {
  const sourceUrl = String(imageUrl || "").trim();
  if (!sourceUrl) return { imageUrl: "", originalImageUrl: "" };
  try {
    const cached = await cacheSourceImage(sourceUrl, id);
    return { imageUrl: cached || "", originalImageUrl: sourceUrl, cached: Boolean(cached) };
  } catch (error) {
    console.warn("Source image cache failed:", sourceUrl, error.message);
    // Not an image / not reachable: never publish or show the raw remote URL.
    return { imageUrl: "", originalImageUrl: sourceUrl, cached: false, cacheError: error.message };
  }
}

