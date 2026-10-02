import fs from "node:fs";

const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const admin = fs.readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");

function expectContains(haystack, needle, label) {
  if (!haystack.includes(needle)) throw new Error("Missing regression guard: " + label);
}

expectContains(server, 'const applyGeneratedCover = async function(reason)', "manual cover generation fallback");
expectContains(server, 'if (!sourceImage) {', "missing source image generates a cover");
expectContains(server, 'QUEUE_COVER_SOURCE_FALLBACK', "enhancement failure fallback");
expectContains(server, 'item.imageUrl = enhanced.url;', "enhanced photo becomes the active image");
expectContains(server, 'item.enhancedImageUrl = enhanced.url;', "enhanced photo is exposed to admin preview");
expectContains(server, 'if (!preparedImage.imageUrl) {', "collector handles dead source image");
if (server.includes('const publishImageUrl = preparedImage.imageUrl || imageUrl;')) {
  throw new Error("Dead remote image fallback regressed: raw source URL can become publishable media");
}
expectContains(admin, "result&&result.mode==='enhanced'?'Фото улучшено':'Новая AI-обложка готова'", "admin reports generated vs enhanced result");
expectContains(admin, "'<button class=\"qa-tool\" onclick=\"enhanceQueuePhoto('+ja(q.id)+')\">Обложка</button>'", "cover button available for non-video posts");

console.log("cover-fallback regression checks: OK");
