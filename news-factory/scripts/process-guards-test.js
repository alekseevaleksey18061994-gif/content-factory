// v0.61.1: process guards and the new Connections cards (static + behavioural, no network).
// Run: npm run test:process-guards
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = fs.readFileSync(path.join(APP, "server.js"), "utf8");
const admin = fs.readFileSync(path.join(APP, "public/admin.html"), "utf8");
let n = 0; const ok = (m) => { n++; console.log("ok - " + m); };

assert.match(server, /process\.on\("unhandledRejection"/); ok("server registers an unhandledRejection guard");
assert.match(server, /process\.on\("uncaughtException"[\s\S]{0,400}gracefulShutdown\("uncaughtException"\)/); ok("uncaughtException goes through the graceful shutdown");
for (const key of ["postmypost", "processHealth", "backup"]) {
  assert.ok(new RegExp("\\n    " + key + ": \\(function\\(\\)\\{").test(server), key + " card exists in status details");
  assert.ok(admin.includes(key + ":'"), key + " has a name in admin.html");
}
assert.match(admin, /keys:\['vk','postmypost'\]/); ok("Postmypost sits in the VK group of the Connections page");

// Behaviour: a stray rejection must not kill a node process that installs the same guard.
const guard = server.slice(server.indexOf('process.on("unhandledRejection"'), server.indexOf('process.on("uncaughtException"'));
const child = spawnSync(process.execPath, ["--input-type=module", "-e", "const processFaults={rejections:0,last:''};" + guard + "Promise.reject(new Error('boom'));setTimeout(()=>{console.log('alive '+processFaults.rejections)},50)"], { encoding: "utf8" });
assert.equal(child.status, 0, child.stderr);
assert.match(child.stdout, /alive 1/); ok("an unhandled rejection is counted and the process stays alive");
console.log(n + " passed");
