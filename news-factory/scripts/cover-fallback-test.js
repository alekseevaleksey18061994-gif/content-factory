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

has(block, "manual_new_cover_generated", "manual cover mode");
has(block, "forceAi: true", "manual click bypasses economy text-card mode");
has(block, "coverGenerationCount", "each click advances visual variation");
has(block, 'item.imageUrl = ""', "old source image is removed from active media");
has(block, 'item.enhancedImageUrl = ""', "old enhanced image is removed");
has(block, "generatedImageUrl = generated.url", "fresh cover becomes active");
if (block.includes("enhanceNewsImage(")) {
  throw new Error("Manual cover button still performs technical source-image enhancement");
}
has(server, 'Date.now() + "_" + crypto.randomBytes(3).toString("hex") + ".png"', "generated cover URL is unique");
has(server, "if (!preparedImage.imageUrl) {", "collector broken-hotlink fallback");
if (server.includes("const publishImageUrl = preparedImage.imageUrl || imageUrl;")) {
  throw new Error("Raw remote image can still become publishable media");
}
has(admin, "Генерирую новую AI-обложку", "UI says it is generating a new cover");
has(admin, "Новая AI-обложка готова", "UI confirms new cover");
has(admin, "img=item.enhancedImageUrl||item.imageUrl||item.generatedImageUrl||item.originalImageUrl", "preview prefers generated cover");

console.log("cover-fallback regression checks: OK");
