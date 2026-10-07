// Tests for lib/channel-config.js (read-only unified channel view + consistency check).
//   npm run test:channel-config
import assert from "node:assert/strict";
import { buildChannelConfig } from "../lib/channel-config.js";
import { RECOVERY_CHANNELS } from "../lib/workspace-recovery.js";
import { REMOVED_CHANNELS_V055, REMOVED_CHANNELS_V060 } from "../lib/channel-rubrics-v055.js";

const src = (n) => Array.from({ length: n }, (_, i) => ({ id: "s" + i, enabled: true }));
const ws = (id, over) => Object.assign({ id, name: "Канал " + id, telegramChannel: "@" + id, telegramPublicUsername: id, avatarUrl: "x", channelId: id, state: { mode: "AUTO", sources: src(20), topicSettings: { default: {} } } }, over || {});
const ctx = (over) => Object.assign({ profiles: ["tech", "games", "kino"], resolveChannelId: (w) => w.channelId || "", recovery: [], removed: [], vkMap: null, defaultWorkspaceId: "tech" }, over || {});
const codes = (r, id) => r.channels.find((c) => c.id === id).issues.map((i) => i.code);

const cases = {
  "C1 a consistent channel has no errors or warnings"() {
    const r = buildChannelConfig([ws("tech")], ctx({ recovery: [{ id: "tech", handle: "@tech", channelId: "tech" }], vkMap: { tech: { accountName: "x" } } }));
    assert.equal(r.errors, 0); assert.equal(r.warnings, 0);
    assert.equal(r.channels[0].vk, true); assert.equal(r.channels[0].inRecovery, true);
  },
  "C2 duplicate handle and duplicate profile are errors on both channels"() {
    const r = buildChannelConfig([ws("tech"), ws("games", { telegramChannel: "@TECH", channelId: "tech" })], ctx());
    assert.ok(codes(r, "tech").includes("duplicate_handle")); assert.ok(codes(r, "games").includes("duplicate_handle"));
    assert.ok(codes(r, "tech").includes("duplicate_profile")); assert.ok(r.errors >= 4);
  },
  "C3 missing telegram / unknown or missing profile are errors"() {
    const r = buildChannelConfig([ws("tech", { telegramChannel: "" }), ws("games", { channelId: "nope" }), ws("kino", { channelId: "" })], ctx());
    assert.ok(codes(r, "tech").includes("no_telegram"));
    assert.ok(codes(r, "games").includes("unknown_profile"));
    assert.ok(codes(r, "kino").includes("no_profile"));
  },
  "C4 handle vs username mismatch, few sources, no avatar, no VK are reported with the right level"() {
    const r = buildChannelConfig([ws("tech", { telegramPublicUsername: "other", avatarUrl: "", state: { sources: src(3) } })], ctx({ vkMap: {} }));
    const c = r.channels[0].issues;
    assert.equal(c.find((i) => i.code === "handle_mismatch").level, "warn");
    assert.equal(c.find((i) => i.code === "few_sources").level, "warn");
    assert.equal(c.find((i) => i.code === "no_vk").level, "warn");
    assert.equal(c.find((i) => i.code === "no_avatar").level, "info");
  },
  "C5 VK check is skipped entirely when VK via Postmypost is off"() {
    const r = buildChannelConfig([ws("tech")], ctx({ vkMap: null }));
    assert.equal(r.channels[0].vk, null); assert.ok(!codes(r, "tech").includes("no_vk"));
  },
  "C6 recovery manifest drift and orphan manifest entries"() {
    const r = buildChannelConfig([ws("tech"), ws("games")], ctx({ recovery: [{ id: "tech", handle: "@old", channelId: "kino" }, { id: "gone", handle: "@gone", channelId: "x" }, { id: "dead", handle: "@d", channelId: "y" }], removed: ["dead"] }));
    assert.ok(codes(r, "tech").includes("recovery_drift")); assert.ok(codes(r, "tech").includes("recovery_profile_drift"));
    assert.ok(codes(r, "games").includes("not_restorable"));
    assert.deepEqual(r.orphanRecovery, ["gone"]);
  },
  "C7 default channel is not flagged as non-restorable; removed channel present is a warning"() {
    const r = buildChannelConfig([ws("tech"), ws("kino")], ctx({ removed: ["kino"] }));
    assert.ok(!codes(r, "tech").includes("not_restorable"));
    assert.ok(codes(r, "kino").includes("removed_channel_present"));
  },
  "C8 robust to empty / malformed input"() {
    assert.deepEqual(buildChannelConfig(null, null).channels, []);
    const r = buildChannelConfig([{ id: "x" }], {});
    assert.ok(r.errors >= 2);
  },
  "C9 the real recovery manifest has no internal duplicates and matches removed lists"() {
    const r = buildChannelConfig(RECOVERY_CHANNELS.map((e) => ({ id: e.id, name: e.name, telegramChannel: e.handle, telegramPublicUsername: e.handle.slice(1), avatarUrl: "x", channelId: e.channelId, state: { sources: src(20) } })),
      ctx({ profiles: RECOVERY_CHANNELS.map((e) => e.channelId), recovery: RECOVERY_CHANNELS, removed: [], defaultWorkspaceId: "" }));
    assert.equal(r.errors, 0, JSON.stringify(r.channels.flatMap((c) => c.issues.filter((i) => i.level === "error"))));
    assert.ok(REMOVED_CHANNELS_V055.concat(REMOVED_CHANNELS_V060).every((id) => RECOVERY_CHANNELS.some((e) => e.id === id)), "removed ids exist in manifest");
  }
};
let failed = 0;
for (const [name, fn] of Object.entries(cases)) {
  try { await fn(); console.log("ok - " + name); } catch (e) { failed++; console.log("FAIL - " + name + "\n" + (e && e.stack || e)); }
}
console.log(failed ? failed + " failed" : "channel-config tests passed");
process.exit(failed ? 1 : 0);
