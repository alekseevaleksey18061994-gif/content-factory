import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "news-factory-accounts-"));
const port = 39322;
const password = "local-smoke-password";
const appDir = fileURLToPath(new URL("..", import.meta.url));
const child = spawn(process.execPath, ["server.js"], {
  cwd: appDir,
  env: Object.assign({}, process.env, {
    PORT: String(port), DATA_DIR: dataDir, STATE_SAVE_DEBOUNCE_MS: "0", DATABASE_URL: "", ADMIN_UI_PASSWORD: password, ADMIN_UI_PASSWORD_SHA256: "",
    COLLECTOR_ENABLED: "false", AUTO_PUBLISH_ENABLED: "false", TELEGRAM_BOT_TOKEN: "", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: ""
  }),
  stdio: ["ignore", "pipe", "pipe"]
});
let stderr = "";
child.stderr.on("data", function (x) { stderr += String(x); });
const base = "http://127.0.0.1:" + port;

try {
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(base + "/health")).ok) break; } catch {}
    await new Promise(function (r) { setTimeout(r, 100); });
    if (i === 59) throw new Error("server did not start: " + stderr.slice(-400));
  }
  const login = await fetch(base + "/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
  const cookie = String(login.headers.get("set-cookie") || "").split(";")[0];
  const call = async function (method, url, body) {
    const r = await fetch(base + url, { method, headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(function () { return {}; }) };
  };

  const list = await call("GET", "/api/workspaces");
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.json.profiles) && list.json.profiles.includes("crypto"), "profiles list exposed");
  // v0.65.0: unified read-only channel config + its status card
  const cc = await call("GET", "/api/channels/config");
  assert.equal(cc.status, 200);
  assert.equal(cc.json.ok, true);
  assert.equal(cc.json.channels.length, list.json.workspaces.length, "channel config covers every workspace");
  for (const k of ["id", "name", "telegram", "profile", "sources", "issues"]) assert.ok(k in cc.json.channels[0], "channel config." + k);
  const stat = await call("GET", "/api/status");
  assert.equal(stat.status, 200);
  const card = JSON.stringify(stat.json).includes('"channelConfig"');
  assert.ok(card, "status exposes channelConfig card");
  const first = list.json.workspaces[0];
  for (const k of ["mode", "autoPublish", "queue", "sources", "published", "missing"]) assert.ok(k in first.summary, "summary." + k);
  assert.ok(Array.isArray(first.summary.missing));

  const created = await call("POST", "/api/workspaces", { name: "Тестовый канал", telegramChannel: "https://t.me/s/test_channel_x" });
  assert.equal(created.status, 201);
  assert.equal(created.json.workspace.telegramChannel, "@test_channel_x", "t.me link normalised");
  assert.equal(created.json.workspace.telegramPublicUsername, "test_channel_x", "username derived from t.me link, not stored raw");
  assert.equal(created.json.workspace.slug, "test_channel_x", "slug derived from t.me link");
  // regression: Cyrillic-only name used to produce a duplicate id of an existing workspace
  const cyr1 = await call("POST", "/api/workspaces", { name: "Что там у кино?" });
  const cyr2 = await call("POST", "/api/workspaces", { name: "Что там у еды?" });
  const ids = (await call("GET", "/api/workspaces")).json.workspaces.map(function (w) { return w.id; });
  assert.equal(new Set(ids).size, ids.length, "workspace ids stay unique: " + ids.join(","));
  assert.notEqual(cyr1.json.workspace.id, cyr2.json.workspace.id);
  // the global AUTO_PUBLISH_ENABLED=false switch must be reflected in the status
  assert.ok((await call("GET", "/api/workspaces")).json.workspaces.every(function (w) { return w.summary.autoPublish === false; }), "autoPublish respects AUTO_PUBLISH_ENABLED");
  const id = created.json.workspace.id;

  const cases = [
    ["abcde_chan", "@abcde_chan"],
    ["@already", "@already"],
    ["-1001234567890", "-1001234567890"],
    ["ab", "ab"],
    ["t.me/another_one/", "@another_one"],
    ["https://evil.example/t.me/xxxxxx", "https://evil.example/t.me/xxxxxx"]
  ];
  for (const [input, expected] of cases) {
    const r = await call("POST", "/api/workspaces/update", { id, telegramChannel: input, telegramPublicUsername: "keep" });
    assert.equal(r.status, 200);
    assert.equal(r.json.workspace.telegramChannel, expected, "channel " + input);
    assert.equal(r.json.workspace.telegramPublicUsername, "keep", "explicit username is not overwritten");
  }
  const blank = await call("POST", "/api/workspaces/update", { id, telegramChannel: "@derive_me", telegramPublicUsername: "" });
  assert.equal(blank.json.workspace.telegramPublicUsername, "derive_me", "username derived from channel when empty");

  const bad = await call("POST", "/api/workspaces/update", { id, channelId: "nope" });
  assert.equal(bad.status, 400);
  const pin = await call("POST", "/api/workspaces/update", { id, channelId: "crypto" });
  assert.equal(pin.json.workspace.channelId, "crypto");

  const after = (await call("GET", "/api/workspaces")).json.workspaces.find(function (w) { return w.id === id; });
  assert.ok(!after.summary.missing.includes("profile"), "profile no longer missing after pinning");
  assert.ok(after.summary.missing.includes("avatar"), "avatar missing: " + JSON.stringify(after.summary));
  assert.equal(typeof after.summary.sources, "number");
  assert.equal(after.summary.missing.includes("sources"), after.summary.sources < 15, "sources flag matches threshold");;

  const unauth = await fetch(base + "/api/workspaces");
  assert.equal(unauth.status, 401);
  console.log("ok - accounts smoke");
} finally {
  child.kill("SIGTERM");
  fs.rmSync(dataDir, { recursive: true, force: true });
}
