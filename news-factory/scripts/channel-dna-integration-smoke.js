import fs from "node:fs";

const fail = (message) => { console.error(message); process.exit(1); };
const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const prompt = fs.readFileSync(new URL("../prompts/chto-tam.md", import.meta.url), "utf8");
const editorial = fs.readFileSync(new URL("../lib/editorial-v2.js", import.meta.url), "utf8");
const sourceQuality = fs.readFileSync(new URL("../lib/source-quality.js", import.meta.url), "utf8");

[
  'import { channelStrategyScore, sourceClassFor } from "./lib/channel-strategy.js";',
  "channel_strategy: channelStrategy(channelId)",
  "strategy.totalBonus",
  'contentBucket: post.contentBucket || ""',
  "sourceClass: sourceClassFor(source)",
  "v0.44.0-channel-dna-v2"
].forEach((marker) => {
  if (!server.includes(marker)) fail("Missing server integration marker: " + marker);
});

[
  "### 2аа. Channel DNA: тип контента и сигналы",
  '"content_bucket": "news"',
  '"channel_signals": {',
  "channel_strategy.mix"
].forEach((marker) => {
  if (!prompt.includes(marker)) fail("Missing prompt marker: " + marker);
});

[
  "contentBucket: str(r.content_bucket, 40)",
  '["virality","utility","discussion","visual","wow","local","deal"]'
].forEach((marker) => {
  if (!editorial.includes(marker)) fail("Missing writer-normalization marker: " + marker);
});

if (!sourceQuality.includes('COMMUNITY:"сообщество"') || !sourceQuality.includes('SOCIAL:"соцсеть"')) {
  fail("Source prefilter does not distinguish COMMUNITY/SOCIAL");
}

console.log("Channel DNA v2 integration smoke: OK");
