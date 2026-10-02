import fs from "node:fs";
import { spawnSync } from "node:child_process";

const serverUrl = new URL("../server.js", import.meta.url);
const source = fs.readFileSync(serverUrl, "utf8");
const fail = (msg) => { console.error(msg); process.exit(1); };

[
  "async function catchUpCurrentRegularSlotAllWorkspaces()",
  "SCHEDULER_CATCHUP_START",
  "SCHEDULER_CATCHUP_RESULT",
  "lastAttemptedTickKey",
  "lastTickCompletedAt",
  "return catchUpCurrentRegularSlotAllWorkspaces()",
  "empty_slot_retry_pending",
  "slotHasSuccessfulPublication(slotKey)",
  "DYNAMIC_SLOT_END_HOUR - DYNAMIC_SLOT_START_HOUR + 1"
].forEach((marker) => {
  if (!source.includes(marker)) fail("Missing scheduler recovery marker: " + marker);
});

const completedPos = source.indexOf("state.dynamicScheduler.lastTickKey = key;");
const actionPos = source.indexOf("const result = action === \"prepare\"");
if (completedPos < actionPos) fail("Scheduler marks tick complete before action finishes");


if (source.includes('schedulerState.lastPublishedSlot = slotKey;\n    saveState();\n    return { ok: true, skipped: "empty_slot"')) {
  fail("Empty slot is still marked as successfully published");
}

const syntax = spawnSync(process.execPath, ["--check", serverUrl.pathname], { encoding: "utf8" });
if (syntax.status !== 0) fail(syntax.stderr || syntax.stdout || "server.js syntax check failed");

console.log("Scheduler recovery smoke: OK");
