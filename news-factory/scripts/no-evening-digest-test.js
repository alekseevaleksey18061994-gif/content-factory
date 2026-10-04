import fs from "node:fs";
const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");

function has(needle, label) {
  if (!server.includes(needle)) throw new Error("Missing: " + label);
}

has('const DIGEST_EVENING_ENABLED = String(process.env.DIGEST_EVENING_ENABLED || "false")', "evening digest disabled by default");
has('if (kind === "evening" && !DIGEST_EVENING_ENABLED) return { ok: true, skipped: "evening_digest_disabled" };', "manual evening digest blocked");
has('if (DIGEST_EVENING_ENABLED) jobs.push({ kind: "evening"', "scheduler does not enqueue evening digest when disabled");
has('if (now.weekday === 0) jobs.push({ kind: "sunday"', "Sunday weekly digest remains independent");
console.log("no-evening-digest checks: OK");
