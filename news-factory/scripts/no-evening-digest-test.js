import fs from "node:fs";
import { readServerSource } from "./server-source.js";
const server = readServerSource();

function has(needle, label) {
  if (!server.includes(needle)) throw new Error("Missing: " + label);
}

has('const DIGEST_EVENING_ENABLED = String(process.env.DIGEST_EVENING_ENABLED || "false")', "evening digest disabled by default");
has('if (kind === "evening" && !DIGEST_EVENING_ENABLED) return { ok: true, skipped: "evening_digest_disabled" };', "manual evening digest blocked");
has('if (DIGEST_EVENING_ENABLED) jobs.push({ kind: "evening"', "scheduler does not enqueue evening digest when disabled");
has('const DIGEST_SUNDAY_ENABLED = String(process.env.DIGEST_SUNDAY_ENABLED || "false")', "weekly digest disabled by default");
has('if (kind === "sunday" && !DIGEST_SUNDAY_ENABLED) return { ok: true, skipped: "sunday_digest_disabled" };', "manual weekly digest blocked");
has('if (DIGEST_SUNDAY_ENABLED && now.weekday === 0) jobs.push({ kind: "sunday"', "scheduler does not enqueue weekly digest when disabled");
console.log("no-public-digests checks: OK");
