import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { diskUsage, diskIsLow, referencedMediaNames, planMediaPrune, listMediaFiles, pruneMedia, DISK_STOP_FREE_MB } from "../lib/disk-guard.js";
import { evaluateHealth } from "../lib/health-alerts.js";
import { channelDay } from "../lib/network-day.js";
const now = Date.parse("2026-10-08T12:00:00Z");
const DAY = 86400000;
try {
  const protectedPlan = planMediaPrune([
    { name: "vk_preview_q1-abc.jpg", size: 1, mtimeMs: now - 90 * DAY },
    { name: "notes.txt", size: 1, mtimeMs: now - 90 * DAY },
    { name: "x.avif", size: 1, mtimeMs: now - 90 * DAY },
    { name: "old.JPG", size: 1, mtimeMs: now - 90 * DAY }
  ], new Set(), now, 14 * DAY);
  assert.deepEqual(protectedPlan.delete.map(function(f){ return f.name; }), ["old.JPG"], "VK preview images and non-pictures are never pruned");
  console.log("ok - D0 vk_preview_ and non-picture files are protected");
  const refs = referencedMediaNames([JSON.stringify({ queue: [{ imageUrl: "/media/cover_a_1.png" }], history: [{ mediaPackUrls: ["https://x.up.railway.app/media/Budget_B.WEBP?x=1"] }] }), "no media here"]);
  assert.ok(refs.has("cover_a_1.png")); assert.ok(refs.has("budget_b.webp"));
  console.log("ok - D1 referenced names (case-insensitive, with host and query)");
  const files = [
    { name: "cover_a_1.png", size: 100, mtimeMs: now - 30 * DAY },   // referenced -> keep
    { name: "budget_b.webp", size: 200, mtimeMs: now - 30 * DAY },   // referenced -> keep
    { name: "old_unused.webp", size: 300, mtimeMs: now - 30 * DAY }, // goes
    { name: "young_unused.webp", size: 400, mtimeMs: now - 1 * DAY },// too young -> keep
    { name: "avatar_x.png", size: 500, mtimeMs: now - 90 * DAY }     // avatar -> keep
  ];
  const plan = planMediaPrune(files, refs, now, 14 * DAY);
  assert.deepEqual(plan.delete.map(function(f){ return f.name; }), ["old_unused.webp"]);
  assert.equal(plan.bytes, 300); assert.equal(plan.keepReferenced, 2); assert.equal(plan.keepYoung, 1); assert.equal(plan.keepProtected, 1);
  console.log("ok - D2 plan keeps referenced, young and avatar files");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mediaprune-"));
  for (const f of files) { fs.writeFileSync(path.join(dir, f.name), Buffer.alloc(f.size)); fs.utimesSync(path.join(dir, f.name), new Date(f.mtimeMs), new Date(f.mtimeMs)); }
  const real = planMediaPrune(listMediaFiles(dir), refs, now, 14 * DAY);
  assert.deepEqual(real.delete.map(function(f){ return f.name; }), ["old_unused.webp"]);
  const done = pruneMedia(dir, { delete: real.delete.concat([{ name: "../evil", size: 1 }, { name: "a/b", size: 1 }]) });
  assert.equal(done.deleted, 1); assert.equal(done.bytes, 300);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["avatar_x.png", "budget_b.webp", "cover_a_1.png", "young_unused.webp"]);
  console.log("ok - D3 real prune deletes only planned plain names");
  const du = diskUsage(dir);
  assert.ok(du && du.totalMB > 0 && du.usedPct >= 0 && du.usedPct <= 100);
  assert.equal(diskUsage("/definitely/not/here"), null);
  assert.equal(diskIsLow({ freeMB: DISK_STOP_FREE_MB - 1 }), true);
  assert.equal(diskIsLow({ freeMB: DISK_STOP_FREE_MB }), false);
  assert.equal(diskIsLow(null), false, "unknown usage never blocks publishing");
  console.log("ok - D4 disk usage and low-space rule");
  const full = { nowMs: now, channels: [], disk: { usedPct: 97, freeMB: 120, totalMB: 5000 } };
  let h = evaluateHealth(full, {});
  assert.equal(h.send.length, 0, "needs 2 ticks");
  h = evaluateHealth(full, h.next);
  assert.equal(h.send.length, 1); assert.match(h.send[0].text, /Диск \/data заполнен на 97%/);
  const ok = evaluateHealth({ nowMs: now, channels: [], disk: { usedPct: 40, freeMB: 3000, totalMB: 5000 } }, h.next);
  assert.equal(ok.recovered.length, 1); assert.match(ok.recovered[0].text, /достаточно места/);
  const none = evaluateHealth({ nowMs: now, channels: [], disk: { usedPct: 84, freeMB: 800, totalMB: 5000 } }, {});
  assert.equal(Object.keys(none.next).length, 0, "below the threshold nothing is tracked");
  console.log("ok - D5 disk alert + recovery");
  const dd = channelDay({ id: "z", name: "Z", slots: ["13:00"], history: [
    { publishedAt: "2026-10-08T10:12:00Z", messageId: 95, vkPostId: "pmp-1", title: "A" },
    { publishedAt: "2026-10-08T10:15:00Z", messageId: 96, title: "A", publicationOrigin: "duplicate-removed" }
  ] }, "2026-10-08", Date.parse("2026-10-08T12:00:00Z"));
  assert.equal(dd.published, 1, "a removed duplicate does not count as a published post");
  assert.equal(dd.tgFailed, 0);
  console.log("ok - D6 removed duplicates are ignored by the day view");
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("disk-guard tests passed");
} catch (e) { console.error(e); process.exit(1); }
