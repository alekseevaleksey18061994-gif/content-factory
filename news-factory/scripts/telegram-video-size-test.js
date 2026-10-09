import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
process.env.PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "https://example.test";
const { telegramVideoTooLarge, telegramVideoSizeBytes, TELEGRAM_VIDEO_MAX_BYTES } = await import("../lib/telegram-upload.js");
assert.equal(TELEGRAM_VIDEO_MAX_BYTES, 49 * 1024 * 1024);
assert.equal(await telegramVideoTooLarge(""), false);
assert.equal(await telegramVideoSizeBytes("http://127.0.0.1:1/x.mp4"), null); // unreachable → unknown, never throws
assert.equal(await telegramVideoTooLarge("http://127.0.0.1:1/x.mp4"), false);
console.log("telegram-video-size-test: OK");
