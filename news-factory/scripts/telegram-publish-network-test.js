import assert from "node:assert/strict";
import fs from "node:fs";
import { telegramTransportRetrySafe, telegramRequest } from "../lib/telegram-errors.js";

const originalFetch = globalThis.fetch;
const success = (result = { chat: { id: -100123 } }) => ({
  ok: true, status: 200, json: async () => ({ ok: true, result })
});
const networkError = (code = "") => {
  const cause = code ? Object.assign(new Error("connect failure"), { code }) : undefined;
  return new TypeError("fetch failed", cause ? { cause } : undefined);
};

async function mockCalls(method, failures) {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls <= failures.length) throw failures[calls - 1];
    return success();
  };
  try {
    const result = await telegramRequest(method, () => ({ method: "POST", body: "{}" }), 1000);
    assert.ok(result);
    return calls;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

try {
  // getChat is read-only: a generic undici "fetch failed" can safely be retried.
  assert.equal(await mockCalls("getChat", [networkError()]), 2);
  // Known connection-refused errors happened before a send; the retry cannot duplicate it.
  assert.equal(await mockCalls("sendPhoto", [networkError("ECONNREFUSED")]), 2);

  // An unknown send failure may have reached Telegram. Do not retry or upload a second copy.
  let ambiguousCalls = 0;
  globalThis.fetch = async () => { ambiguousCalls += 1; throw networkError(); };
  await assert.rejects(
    () => telegramRequest("sendPhoto", () => ({ method: "POST" }), 1000),
    error => Boolean(error.telegramAmbiguous && error.telegramMethod === "sendPhoto")
  );
  assert.equal(ambiguousCalls, 1);
  globalThis.fetch = originalFetch;

  // A mutating method that is not a send is not eligible for blind retry.
  assert.equal(telegramTransportRetrySafe("deleteMessage", networkError()), false);
  assert.equal(telegramTransportRetrySafe("setChatTitle", networkError()), false);
  assert.equal(telegramTransportRetrySafe("getChatMember", networkError()), true);

  // Both auto-scheduler and manual endpoint must expose partial publication.
  const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(server, /targets\.telegram && !result\.telegramPublished \? "partial"/);
  assert.match(server, /doneTelegram && doneVk \? "published" : "partial"/);
  assert.match(server, /telegramStatus: item\.telegramStatus/);
  assert.match(server, /error\.telegramAmbiguous \|\| isTelegramFatalError\(error\)/);

  console.log("telegram-publish-network-test: PASS");
} finally {
  globalThis.fetch = originalFetch;
}
