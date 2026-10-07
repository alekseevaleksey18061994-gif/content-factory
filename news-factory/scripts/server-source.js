// Static tests grep the application source. Since v0.62.0 parts of server.js live in lib modules marked
// "// Extracted from server.js"; this returns server.js followed by those modules so the checks keep working.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function extractedModules() {
  const dir = path.join(APP_DIR, "lib");
  return fs.readdirSync(dir).filter((f) => f.endsWith(".js")).map((f) => path.join(dir, f))
    .filter((f) => fs.readFileSync(f, "utf8").startsWith("// Extracted from server.js"));
}
export function readServerSource() {
  return [path.join(APP_DIR, "server.js")].concat(extractedModules()).map((f) => fs.readFileSync(f, "utf8")).join("\n");
}
