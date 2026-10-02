import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../server.js", import.meta.url));
const src = fs.readFileSync(serverPath, "utf8");

function has(re, message) { assert.match(src, re, message); }

has(/MEDIA_DEFER_EXPENSIVE[\s\S]{0,160}"true"/, "deferred media must default on");
has(/MEDIA_QUALITY_MIN_SCORE[\s\S]{0,120}62/, "media quality threshold must have a sane default");
has(/EDITORIAL_QUEUE_TARGET[\s\S]{0,120}4/, "capacity gate target must default to four");
has(/function capacityGateDecision\(/, "capacity gate helper missing");
has(/EDITORIAL_CAPACITY_DEFERRED/, "capacity gate must be observable");
has(/prefilterScore\s*=\s*Math\.max/, "prefilter score must reach the capacity gate");

has(/function looksLikeScreenshot\(/, "screenshot detector missing");
has(/function assessMediaQuality\(/, "media quality scorer missing");
has(/MEDIA_QUALITY_REJECTED/, "bad media rejection must be logged");
has(/async function sanitizeMediaPack[\s\S]{0,1800}assessMediaQuality/, "final sanitizer must reject a bad singleton too");
has(/social_screenshot/, "social screenshots must be penalized");
has(/logo_or_flag/, "logos and flags must be penalized");
has(/mediaGoodRate/, "source media-quality feedback missing");

has(/function editorialCostTier\(/, "cost tier helper missing");
has(/async function finalizeApprovedMedia\(/, "final media step missing");
has(/image_generation_final/, "paid image generation must be tagged as final-stage cost");
has(/local-branded-card-v2/, "zero-cost branded fallback missing");

const qc = src.indexOf('baseItem.metadata.qcModel = qc.model || "";');
const finalMedia = src.indexOf("const finalMedia = await finalizeApprovedMedia", qc);
assert.ok(qc >= 0 && finalMedia > qc, "expensive/final media work must happen only after QC");

has(/Promise\.allSettled\(\[tgJob, vkJob\]\)/, "Telegram and VK must be attempted independently");
has(/ANTHROPIC_HEALTH_CACHE_MIN[\s\S]{0,120}120/, "Claude health probe should default to a two-hour cache");
has(/cooldownByKind[\s\S]{0,220}billing[\s\S]{0,220}auth[\s\S]{0,220}outage/, "provider breaker needs failure-specific cooldowns");
has(/if \(\(selected\.telegram \|\| selected\.vk\) && !result\.telegramPublished && !result\.vkPublished\)/,
  "retry error should happen only when neither network published");

console.log("cost-media-balance tests passed");
