// VK status / analytics behaviour with a community token (no wall.get), and the "why not selected" log.
//   npm run test:vk-diagnostics
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadServer, inWs } from "./dedupe-harness.js";

const cases = {};
function test(name, fn) { cases[name] = fn; }
const VKENV = { VK_ACCESS_TOKEN: "community-secret-token", VK_GROUP_ID: "241910449", VK_OWNER_ID: "-241910449", VK_PUBLISH_ENABLED: "true", VK_USER_TOKEN: "", VK_USER_ACCESS_TOKEN: "" };
const two = [["ai-main", "ai", "Что там у ИИ?"], ["chtotamtachki", "auto", "Что там у тачек?"]];

function fakeVk(calls) {
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith("https://api.vk.com/method/")) {
      const method = u.split("/method/")[1];
      const body = new URLSearchParams(String(init.body || ""));
      calls.push({ method, token: body.get("access_token") });
      if (method === "groups.getById") return new Response(JSON.stringify({ response: { groups: [{ id: 241910449, name: "Что там у ИИ?", members_count: 321 }] } }), { status: 200 });
      if (method === "wall.get") {
        if (body.get("access_token") === "community-secret-token") return new Response(JSON.stringify({ error: { error_code: 27, error_msg: "Group authorization failed: method is unavailable with group auth." } }), { status: 200 });
        return new Response(JSON.stringify({ response: { items: [{ id: 7, text: "Заголовок\nтекст", date: 1790880000, views: { count: 100 }, likes: { count: 5 }, comments: { count: 1 }, reposts: { count: 2 } }] } }), { status: 200 });
      }
    }
    return new Response("{}", { status: 200 });
  };
}

test("V1 community token: no wall.get call, audience size still reported", async () => {
  const t = await loadServer({ channels: two, env: Object.assign({}, VKENV, { WORKSPACE_RECOVERY_ENABLED: "false" }) });
  const calls = []; fakeVk(calls);
  const r = await t.fetchVkAnalytics();
  assert.equal(calls.some((c) => c.method === "wall.get"), false, "wall.get must not be called with a community token");
  assert.equal(r.connected, true); assert.equal(r.available, false);
  assert.equal(r.totals.subscribers, 321);
  assert.match(r.note, /VK_USER_TOKEN/);
});

test("V2 user token: wall.get is called with the user token and parsed", async () => {
  const t = await loadServer({ channels: two, env: Object.assign({}, VKENV, { VK_USER_TOKEN: "user-secret-token", WORKSPACE_RECOVERY_ENABLED: "false" }) });
  const calls = []; fakeVk(calls);
  const r = await t.fetchVkAnalytics();
  const wall = calls.find((c) => c.method === "wall.get");
  assert.ok(wall); assert.equal(wall.token, "user-secret-token");
  assert.equal(r.available, true); assert.equal(r.totals.posts, 1); assert.equal(r.totals.views, 100); assert.equal(r.totals.subscribers, 321);
});

test("V3 vkAutoStatus: only the default cabinet is allowed, flags reflect topic settings, no secrets", async () => {
  const t = await loadServer({ channels: two, env: Object.assign({}, VKENV, { WORKSPACE_RECOVERY_ENABLED: "false" }) });
  t.ws("ai-main").state.topicSettings.default.auto_publish_vk = true; // the harness fixture has VK off
  const a = inWs(t, "ai-main", () => t.vkAutoStatus());
  assert.equal(a.workspace, "ai-main"); assert.equal(a.workspaceAllowed, true); assert.equal(a.autoPublishVk, true);
  assert.equal(a.publishEnabled, true); assert.equal(a.communityTokenSet, true); assert.equal(a.userTokenSet, false); assert.equal(a.groupConfigured, true);
  const car = inWs(t, "chtotamtachki", () => t.vkAutoStatus());
  assert.equal(car.workspaceAllowed, false);
  t.ws("ai-main").state.topicSettings.default.auto_publish_vk = false;
  assert.equal(inWs(t, "ai-main", () => t.vkAutoStatus()).autoPublishVk, false);
  assert.equal(JSON.stringify(a).includes("secret"), false);
});

test("V4 a post that does not go to VK although VK is configured logs why", async () => {
  const t = await loadServer({ channels: two, env: Object.assign({}, VKENV, { TELEGRAM_BOT_TOKEN: "tg-token", TELEGRAM_CHANNEL: "@chtotamai", WORKSPACE_RECOVERY_ENABLED: "false" }) });
  const lines = []; const w = console.warn; console.warn = (...a) => { lines.push(a.join(" ")); };
  globalThis.fetch = async (url) => new Response(JSON.stringify({ ok: true, result: { message_id: 5, chat: { id: -1, type: "channel" } } }), { status: 200 });
  t.ws("ai-main").state.topicSettings.default.auto_publish_vk = false;
  try { await inWs(t, "ai-main", () => t.sendMultiPlatformPost({ id: "q1", title: "T", text: "Текст поста", topicId: "default" }, { telegram: true, vk: false })).catch(() => {}); } finally { console.warn = w; }
  const line = lines.find((l) => l.startsWith("VK_NOT_SELECTED"));
  assert.ok(line, "expected VK_NOT_SELECTED, got: " + lines.slice(0, 3).join(" | "));
  const info = JSON.parse(line.slice("VK_NOT_SELECTED ".length));
  assert.equal(info.autoPublishVk, false); assert.equal(info.workspaceAllowed, true); assert.equal(info.requested.vk, false);
  assert.equal(line.includes("secret"), false);
});

async function main() {
  const only1 = process.argv[2];
  if (only1) {
    const name = Object.keys(cases).find((n) => n === only1 || n.startsWith(only1 + " "));
    if (!name) throw new Error("unknown case " + only1);
    await cases[name]();
    process.exit(0);
  }
  let failed = 0;
  for (const name of Object.keys(cases)) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name.split(" ")[0]], { env: Object.assign({}, process.env, { TZ: "UTC" }), encoding: "utf8", timeout: 120000 });
    if (r.status === 0) console.log("ok - " + name);
    else { failed += 1; console.log("FAIL - " + name + "\n" + String(r.stderr || r.stdout).split("\n").slice(0, 16).join("\n")); }
  }
  console.log(failed ? failed + " failed" : "vk-diagnostics tests passed");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
