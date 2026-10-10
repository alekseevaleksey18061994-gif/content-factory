// Render native Apple/PWA icons from the approved 128px NF robot artwork.
import sharp from "sharp";
const icon = "public/nf-icon-128.png";
for (const [dest,size] of [
  ["public/icon-192.png",192],
  ["public/icon-512.png",512],
  ["public/apple-touch-icon.png",180]
]) {
  await sharp(icon).resize(size,size,{kernel:"lanczos3"}).png({compressionLevel:9}).toFile(dest);
}
console.log("NF robot icons ready: Apple / PWA / favicon");
