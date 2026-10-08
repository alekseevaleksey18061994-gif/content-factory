// Regression: median(3) threw "rank: window too large" on very thin images.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "enh-"));
process.env.IMAGE_ENHANCEMENT_ENABLED = "1";
const sharp = (await import("sharp")).default;
const { MEDIA_DIR, ensureDataDir, mediaPublicUrl } = await import("../lib/article-extract.js");
const { enhanceNewsImage } = await import("../lib/image-enhance.js");
ensureDataDir();
let failed = 0;
async function run(name, w, h) {
  const file = "tiny_" + w + "x" + h + ".png";
  const buf = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 120, g: 80, b: 40 } } }).png().toBuffer();
  fs.writeFileSync(path.join(MEDIA_DIR, file), buf);
  try {
    const r = await enhanceNewsImage({ id: name, imageUrl: mediaPublicUrl(file) });
    console.log("ok - " + name + " -> " + r.fileName);
  } catch (e) { failed += 1; console.log("FAIL - " + name + ": " + e.message); }
}
await run("E0 thin 600x1", 600, 1);
await run("E0b thin 1x600", 1, 600);
await run("E1 tiny 4x4", 4, 4);
await run("E2 normal 800x500", 800, 500);
process.exit(failed ? 1 : 0);
