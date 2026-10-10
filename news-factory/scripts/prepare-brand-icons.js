import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Rebuild all installable icons from the approved News Factory NF + AI robot art.
// Keep this prestart step deterministic, and don't touch application data.
const pub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const source = path.join(pub, "nf-brand-source.png");
if (!fs.existsSync(source)) throw new Error("NF brand source image is missing");
const targets = [
  [32, "favicon.png"],
  [180, "apple-touch-icon.png"],
  [192, "icon-192.png"],
  [512, "icon-512.png"]
];
await Promise.all(targets.map(async ([size, filename]) => {
  await sharp(source).resize(size, size, { fit: "cover", kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9 }).toFile(path.join(pub, filename));
}));
console.log("NF brand icons ready: favicon, iOS, PWA 192/512");
