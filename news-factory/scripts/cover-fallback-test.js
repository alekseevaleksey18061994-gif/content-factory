import fs from "node:fs";

const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const admin = fs.readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");

function has(text, needle, label) {
  if (!text.includes(needle)) throw new Error("Missing: " + label);
}

const start = server.indexOf('if (req.method === "POST" && p === "/api/queue/enhance-media")');
const end = server.indexOf('if (req.method === "POST" && p === "/api/queue/publish")', start);
if (start < 0 || end <= start) throw new Error("cover endpoint missing");
const block = server.slice(start, end);

has(block, "QUEUE_COVER_SOURCE_FALLBACK", "broken-source fallback");
has(block, "generateFreshCover", "fresh cover generation");
has(block, "item.imageUrl = enhanced.url", "enhanced image becomes active");
has(block, 'item.generatedImageUrl = ""', "enhancement is not mislabelled");
has(server, "if (!preparedImage.imageUrl) {", "collector broken-hotlink fallback");
if (server.includes("const publishImageUrl = preparedImage.imageUrl || imageUrl;")) {
  throw new Error("Raw remote image can still become publishable media");
}
has(admin, "img=item.enhancedImageUrl||item.imageUrl||item.generatedImageUrl||item.originalImageUrl", "preview cover priority");
has(admin, "var image=sourceImage||md.generatedImageUrl||md.originalImageUrl||'';", "news list cover priority");
has(admin, "j&&j.mode==='enhanced'?'Фото улучшено':'Новая AI-обложка готова'", "UI mode feedback");

console.log("cover-fallback regression checks: OK");
