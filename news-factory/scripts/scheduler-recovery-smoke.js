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
  "return catchUpCurrentRegularSlotAllWorkspaces()"
].forEach((marker) => {
  if (!source.includes(marker)) fail("Missing scheduler recovery marker: " + marker);
});

const completedPos = source.indexOf("state.dynamicScheduler.lastTickKey = key;");
const actionPos = source.indexOf("const result = action === \"prepare\"");
if (completedPos < actionPos) fail("Scheduler marks tick complete before action finishes");

const syntax = spawnSync(process.execPath, ["--check", serverUrl.pathname], { encoding: "utf8" });
if (syntax.status !== 0) fail(syntax.stderr || syntax.stdout || "server.js syntax check failed");

console.log("Scheduler recovery smoke: OK");
