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

has(block, 'requestedMode = String(body.mode || "fresh")', "manual cover mode selector");
has(block, 'requestedMode === "reference"', "reference mode branch");
has(block, "generateNewsCoverFromReference", "reference generator");
has(block, "manual_reference_cover_generated", "reference mode metadata");
has(block, "manual_new_cover_generated", "fresh mode metadata");
has(block, "coverReferenceUsed", "reference usage metadata");
has(block, "fallbackReason", "reference fallback to fresh generation");
if (block.includes("enhanceNewsImage(")) {
  throw new Error("Manual cover action must not technically upscale the source photo");
}

has(server, 'https://api.openai.com/v1/images/edits', "OpenAI image edits endpoint");
has(server, 'form.append("image[]",', "reference image upload");
has(server, 'form.append("input_fidelity", "high")', "high reference fidelity");
has(server, "QUEUE_REFERENCE_COVER_FALLBACK", "reference fallback logging");
has(server, "if (!preparedImage.imageUrl) {", "collector broken-hotlink fallback");
if (server.includes("const publishImageUrl = preparedImage.imageUrl || imageUrl;")) {
  throw new Error("Raw remote image can still become publishable media");
}

has(admin, "AI с нуля", "fresh cover button");
has(admin, "По фото", "reference cover button");
has(admin, "Генерирую новую обложку по исходному фото", "reference UI feedback");
has(admin, "Референс недоступен — сделана AI-обложка с нуля", "reference fallback UI feedback");
has(admin, "img=item.enhancedImageUrl||item.imageUrl||item.generatedImageUrl||item.originalImageUrl", "preview prefers generated cover");

console.log("cover-fallback regression checks: OK");
