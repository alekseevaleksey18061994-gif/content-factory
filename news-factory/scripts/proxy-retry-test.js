import assert from "node:assert/strict";
import { proxyRetryLists, SOURCES_V055, SOURCES_TOPUP_V058 } from "../lib/channel-sources-v055.js";

const lists = proxyRetryLists();
const key = function(u) { return String(u).toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, ""); };
for (const channelId of Object.keys(SOURCES_V055)) {
  const list = lists[channelId];
  assert.ok(Array.isArray(list) && list.length >= 1, channelId + " keeps the starting candidates");
  const keys = list.map(function(x) { return key(x.url); });
  assert.equal(new Set(keys).size, keys.length, channelId + " has no duplicate URLs");
}
// reserve candidates of "home" are included
const homeKeys = new Set(lists.home.map(function(x) { return key(x.url); }));
for (const x of SOURCES_TOPUP_V058.home) assert.ok(homeKeys.has(key(x.url)), "home reserve " + x.name);
// the previously blocked Russian sources of "money" are retried
for (const host of ["banki.ru", "cbr.ru", "rbc.ru"]) assert.ok(lists.money.some(function(x) { return key(x.url).includes(host); }), "money retries " + host);
console.log("proxy-retry tests passed");
