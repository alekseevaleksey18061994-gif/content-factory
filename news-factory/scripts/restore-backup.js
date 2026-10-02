#!/usr/bin/env node
// Opens an off-site backup made by lib/offsite-backup.js and shows or extracts what is inside.
//
//   BACKUP_ENCRYPTION_KEY=... node scripts/restore-backup.js <backup.json.gz.enc> [--workspaces-out workspaces.json] [--json-out backup.json] [--force]
//
// Nothing is written unless an --*-out option is given, and an existing file is never overwritten without --force.
// To restore a production store: copy the extracted workspaces.json to /data/workspaces.json while the app is stopped.
import fs from "node:fs";
import { unpackBackup } from "../lib/offsite-backup.js";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--workspaces-out" && args[args.indexOf(a) - 1] !== "--json-out");
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : ""; };
const force = args.includes("--force");
if (!file) { console.error("usage: node scripts/restore-backup.js <backup file> [--workspaces-out file] [--json-out file] [--force]"); process.exit(2); }

const payload = unpackBackup(fs.readFileSync(file), process.env.BACKUP_ENCRYPTION_KEY || "");
const list = (payload.workspaceStore && payload.workspaceStore.workspaces) || [];
console.log("backup of " + payload.app + " v" + payload.version + " made at " + payload.createdAt);
console.log("workspaces in store: " + list.length + " (default: " + (payload.workspaceStore && payload.workspaceStore.defaultWorkspaceId) + ")");
for (const ws of list) {
  const st = ws.state || {};
  console.log("  " + ws.id + "  " + (ws.telegramChannel || "-") + "  sources=" + (st.sources || []).length + " queue=" + (st.queue || []).length + " history=" + (st.history || []).length);
}
console.log("snapshots included: " + (payload.snapshots || []).length);

function writeOut(target, data) {
  if (fs.existsSync(target) && !force) { console.error("refusing to overwrite " + target + " (use --force)"); process.exit(1); }
  fs.writeFileSync(target, data, { mode: 0o600 });
  console.log("written " + target);
}
if (opt("--workspaces-out")) writeOut(opt("--workspaces-out"), JSON.stringify(payload.workspaceStore, null, 2));
if (opt("--json-out")) writeOut(opt("--json-out"), JSON.stringify(payload, null, 2));
