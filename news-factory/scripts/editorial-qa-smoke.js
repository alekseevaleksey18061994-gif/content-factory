import fs from "node:fs";
import { spawnSync } from "node:child_process";

const fail = (m) => { console.error(m); process.exit(1); };
const serverUrl = new URL("../server.js", import.meta.url);
const adminUrl = new URL("../public/admin.html", import.meta.url);
const server = fs.readFileSync(serverUrl, "utf8");
const admin = fs.readFileSync(adminUrl, "utf8");

[
  "runEditorialQaNetwork",
  "/api/editorial/qa/run",
  "/api/editorial/repair-current-slot",
  "publicationCoverageSnapshot",
  "degradedQc"
].forEach((x)=>{ if(!server.includes(x)) fail("Missing QA backend marker: "+x); });

[
  'id="qaPage"',
  "Редакционный QA",
  "Проверить всю редакцию",
  "Догнать текущий слот",
  "loadEditorialQa"
].forEach((x)=>{ if(!admin.includes(x)) fail("Missing QA UI marker: "+x); });

const scripts = Array.from(admin.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)).map((m)=>m[1]);
for (const code of scripts) new Function(code);

const syntax = spawnSync(process.execPath, ["--check", serverUrl.pathname], { encoding:"utf8" });
if (syntax.status !== 0) fail(syntax.stderr || syntax.stdout || "server.js syntax failed");

console.log("Editorial QA smoke: OK");
