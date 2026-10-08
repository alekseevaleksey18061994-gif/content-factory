// Disk guard for the persistent /data volume (v0.69.0).
// Pure helpers + thin fs wrappers: free-space check, which media files nothing refers to any more, and a pruner.
// Incident 2026-10-08: the 5 GB volume filled up, the state could not be saved, so after each restart the scheduler
// believed a slot was still empty and published it again (3 identical posts), and images could not be written.
import fs from "node:fs";
import path from "node:path";

export const DISK_ALERT_PCT = 85;       // alert the owner at this fill level
export const DISK_STOP_FREE_MB = 100;   // below this the scheduler does not publish (the state could not be saved)
export const MEDIA_PRUNE_DEFAULT_DAYS = 14;

// { totalMB, freeMB, usedPct } or null when the file system cannot be asked.
export function diskUsage(dir) {
  try {
    const s = fs.statfsSync(dir);
    const total = Number(s.blocks) * Number(s.bsize);
    const free = Number(s.bavail) * Number(s.bsize);
    if (!(total > 0)) return null;
    return { totalMB: Math.round(total / 1048576), freeMB: Math.round(free / 1048576), usedPct: Math.round((1 - free / total) * 100) };
  } catch { return null; }
}

export function diskIsLow(usage) {
  return Boolean(usage && usage.freeMB < DISK_STOP_FREE_MB);
}

const MEDIA_NAME_RE = /[A-Za-z0-9_.\-]{3,200}\.(?:webp|png|jpe?g|gif|mp4|mov|webm)/gi;

// Every media file name that appears in any of the given strings (state JSON of all channels).
export function referencedMediaNames(texts) {
  const set = new Set();
  for (const text of texts || []) {
    const s = String(text || "");
    let m;
    MEDIA_NAME_RE.lastIndex = 0;
    while ((m = MEDIA_NAME_RE.exec(s))) set.add(m[0].toLowerCase());
  }
  return set;
}

// files: [{ name, size, mtimeMs }]. A file may go only when nothing refers to it, it is old enough and it is not an avatar.
export function planMediaPrune(files, referenced, nowMs, minAgeMs) {
  const del = [];
  let keepReferenced = 0, keepYoung = 0, keepProtected = 0;
  for (const f of files || []) {
    if (!f || !f.name) continue;
    // avatars and VK link-page images (vk_preview_<slug>.jpg is referenced only from Postgres public_post_pages) are never touched,
    // and neither is anything that is not a picture this app writes.
    if (/^(avatar_|vk_preview_)/i.test(f.name) || !/\.(webp|png|jpe?g)$/i.test(f.name)) { keepProtected += 1; continue; }
    if (referenced && referenced.has(String(f.name).toLowerCase())) { keepReferenced += 1; continue; }
    if (nowMs - Number(f.mtimeMs || 0) < minAgeMs) { keepYoung += 1; continue; }
    del.push({ name: f.name, size: Number(f.size || 0) });
  }
  return { delete: del, bytes: del.reduce(function(a, f){ return a + f.size; }, 0), keepReferenced, keepYoung, keepProtected };
}

export function listMediaFiles(dir) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const name of names) {
    try {
      const st = fs.statSync(path.join(dir, name));
      if (st.isFile()) out.push({ name: name, size: st.size, mtimeMs: st.mtimeMs });
    } catch {}
  }
  return out;
}

// Deletes the planned files (only plain names inside dir). Returns what was really removed.
export function pruneMedia(dir, plan) {
  let deleted = 0, bytes = 0;
  for (const f of plan.delete) {
    if (!f.name || f.name.includes("/") || f.name.includes("\\") || f.name.includes("..")) continue;
    try { fs.unlinkSync(path.join(dir, f.name)); deleted += 1; bytes += f.size; } catch {}
  }
  return { deleted, bytes };
}
