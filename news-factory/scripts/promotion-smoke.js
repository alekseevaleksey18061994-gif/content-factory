import fs from "node:fs";
import { spawnSync } from "node:child_process";

const fail = (msg) => { console.error(msg); process.exit(1); };

const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const admin = fs.readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");

[
  "/api/promotion",
  "buildPromotionReport",
  "startPromotionSnapshotMonitor",
  "promotion_campaigns",
  "promotion_creative"
].forEach((marker) => {
  if (!server.includes(marker)) fail("Missing server promotion marker: " + marker);
});

[
  'id="promotionPage"',
  "promotionPage:'promotion'",
  "function renderPromotion(data)",
  "function addPromotionCampaign()",
  "function generatePromotionCreative()"
].forEach((marker) => {
  if (!admin.includes(marker)) fail("Missing admin promotion marker: " + marker);
});

const scripts = Array.from(admin.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)).map((m) => m[1]).filter(Boolean);
for (const source of scripts) new Function(source);

const syntax = spawnSync(process.execPath, ["--check", new URL("../server.js", import.meta.url).pathname], { encoding: "utf8" });
if (syntax.status !== 0) fail(syntax.stderr || syntax.stdout || "server.js syntax check failed");

console.log("Promotion smoke: OK");
