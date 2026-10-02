// Guard for raster images that come from third-party URLs before they reach sharp/librsvg.
// SVG (and anything else that is not a plain raster format) is refused: rasterising an
// attacker-controlled SVG can burn CPU for tens of seconds in the libuv thread pool and
// can reference external resources.
import sharp from "sharp";

export const SAFE_RASTER_FORMATS = ["jpeg", "png", "webp", "gif", "avif"];
export const SAFE_INPUT_PIXELS = 80 * 1000 * 1000;

// Cheap magic-byte sniff that never invokes a decoder. Returns a format name or "".
export function sniffRasterFormat(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (b.length < 12) return "";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b[0] === 0x89 && b.toString("latin1", 1, 4) === "PNG") return "png";
  if (b.toString("latin1", 0, 4) === "GIF8") return "gif";
  if (b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "webp";
  if (b.toString("latin1", 4, 8) === "ftyp") {
    const brand = b.toString("latin1", 8, 12);
    if (brand === "avif" || brand === "avis") return "avif";
  }
  return "";
}

// Throws unless `bytes` is a jpeg/png/webp/gif/avif within the pixel limit. Returns sharp metadata.
export async function assertSafeRaster(bytes, options) {
  const maxPixels = Number(options && options.maxPixels || SAFE_INPUT_PIXELS);
  const sniffed = sniffRasterFormat(bytes);
  if (!sniffed) throw new Error("Источник вернул не растровое изображение (допустимы JPEG, PNG, WEBP, GIF, AVIF)");
  let meta;
  try { meta = await sharp(bytes, { limitInputPixels: maxPixels }).metadata(); }
  catch { throw new Error("Исходный файл не является изображением"); }
  const format = meta.format === "heif" ? "avif" : meta.format;
  if (!SAFE_RASTER_FORMATS.includes(format)) throw new Error("Формат изображения не поддерживается: " + meta.format);
  const pixels = Number(meta.width || 0) * Number(meta.height || 0);
  if (!pixels) throw new Error("Не удалось определить размер изображения");
  if (pixels > maxPixels) throw new Error("Изображение слишком большое по разрешению");
  return meta;
}
