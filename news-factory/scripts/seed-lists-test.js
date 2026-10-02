import assert from "node:assert/strict";
import { SEED_SOURCES } from "../lib/source-quality.js";
import { CHANNEL_IDS } from "../lib/editorial-v2.js";

const GROUPS = new Set(["media", "official", "creator", "company", "expert"]);
for (const [channel, list] of Object.entries(SEED_SOURCES)) {
  assert.ok(CHANNEL_IDS.includes(channel), "unknown channel profile in SEED_SOURCES: " + channel);
  const urls = new Set();
  for (const item of list) {
    assert.ok(item.name && /^https?:\/\/[^\s]+$/.test(item.url), channel + ": bad entry " + JSON.stringify(item));
    assert.ok(GROUPS.has(item.group), channel + ": unexpected group " + item.group);
    assert.ok(!urls.has(item.url), channel + ": duplicate url " + item.url);
    urls.add(item.url);
    if (/^https:\/\/t\.me\//.test(item.url)) assert.ok(/^https:\/\/t\.me\/s\/[A-Za-z0-9_]{5,}$/.test(item.url), channel + ": telegram source must use t.me/s/<name>: " + item.url);
  }
}
// Lists of 25+ entries skip AI discovery (it hit the OpenAI rate limit), and need >=15 working sources to enable auto-publishing.
for (const channel of ["travel", "shopping", "home"]) {
  assert.ok((SEED_SOURCES[channel] || []).length >= 25, channel + " needs a hand-made list of 25+ candidates");
}
console.log("ok - seed lists");
