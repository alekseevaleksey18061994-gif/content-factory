// Editor's rule 2026-10-04: no post goes out with only our text card (title on a coloured background) as its picture.
//   npm run test:no-text-card
process.env.TZ = "UTC";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadServer, inWs, mkQueueItem } from "./dedupe-harness.js";

const cases = {};
function test(name, fn) { cases[name] = fn; }
const card = (over) => mkQueueItem(Object.assign({ imageUrl: "", generatedImageUrl: "/media/budget_card_n1_1.webp", mediaOrigin: "local_branded_card", mediaStatus: "local_card", generatedBy: "local-branded-card-v2" }, over));

test("T1 text-card-only posts are recognised and never picked for a slot; a post with a photo is", async () => {
  const t = await loadServer({ fixedNow: "2026-10-04T08:00:00Z" });
  assert.equal(t.isTextCardOnly(card()), true);
  assert.equal(t.isTextCardOnly(card({ mediaOrigin: "", mediaStatus: "", generatedBy: "" })), true, "by file name");
  assert.equal(t.isTextCardOnly(mkQueueItem({ imageUrl: "https://x/p.jpg" })), false);
  assert.equal(t.isTextCardOnly(card({ imageUrl: "https://x/p.jpg" })), false, "has its own photo");
  assert.equal(t.isTextCardOnly(mkQueueItem({ imageUrl: "", generatedImageUrl: "/media/cover_abc.png", mediaOrigin: "ai_generated" })), false, "AI illustration is a picture");
  const ws = "chtotamcrypto";
  t.ws(ws).state.queue = [card({ id: "qc", newsId: "nc", aiScore: 99 })];
  assert.equal(await inWs(t, ws, async () => t.dynamicBestQueueItemRaw("", false)), null, "only a card -> nothing to post");
  t.ws(ws).state.queue.push(mkQueueItem({ id: "qp", newsId: "np", aiScore: 50, imageUrl: "https://x/p.jpg" }));
  const best = await inWs(t, ws, async () => t.dynamicBestQueueItemRaw("", false));
  assert.equal(best && best.id, "qp", "the lower-rated post with a photo wins over the card");
});

const PROD = { GENERATE_COVER_IF_MISSING: "true", MEDIA_REQUIRED: "true" }; // production defaults (the harness turns them off)
test("T2 at publish time a post that lost its photo is refused (permanent) instead of getting a text card", async () => {
  const t = await loadServer({ fixedNow: "2026-10-04T08:00:00Z", env: PROD });
  await assert.rejects(inWs(t, "chtotamcrypto", () => t.enforceCopyrightSafeMedia({ id: "p", title: "Заголовок", text: "x", imageUrl: "", sourceName: "S" })),
    (e) => e.code === "NO_PHOTO" && e.permanent === true);
  await assert.rejects(inWs(t, "chtotamcrypto", () => t.enforceCopyrightSafeMedia({ id: "p", title: "t", text: "x", imageUrl: "", generatedImageUrl: "/media/budget_card_x_1.webp", mediaOrigin: "local_branded_card", sourceName: "S" })),
    (e) => e.code === "NO_PHOTO");
  await assert.rejects(inWs(t, "chtotamcrypto", () => t.enforceCopyrightSafeMedia({ id: "p", title: "t", text: "x", imageUrl: "https://third.example/a.jpg", mediaLicense: "forbidden", sourceName: "S" })),
    (e) => e.code === "NO_PHOTO", "forbidden source photo + no other picture");
});

test("T3 TEXT_CARD_POSTS_ALLOWED=true restores the old fallback card", async () => {
  const t = await loadServer({ fixedNow: "2026-10-04T08:00:00Z", env: Object.assign({ TEXT_CARD_POSTS_ALLOWED: "true" }, PROD) });
  const out = await inWs(t, "chtotamcrypto", () => t.enforceCopyrightSafeMedia({ id: "p", title: "Заголовок", text: "x", imageUrl: "", sourceName: "S" }));
  assert.match(out.generatedImageUrl, /budget_card_/);
  t.ws("chtotamcrypto").state.queue = [card({ id: "qc", newsId: "nc" })];
  assert.equal((await inWs(t, "chtotamcrypto", async () => t.dynamicBestQueueItemRaw("", false))).id, "qc");
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
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name.split(" ")[0]], { env: Object.assign({}, process.env, { TZ: "UTC" }), encoding: "utf8", timeout: 180000 });
    if (r.status === 0) console.log("ok - " + name);
    else { failed += 1; console.log("FAIL - " + name + "\n" + String(r.stderr || r.stdout).split("\n").filter((l) => !/^    at/.test(l)).slice(0, 20).join("\n")); }
  }
  console.log(failed ? failed + " failed" : "no-text-card tests passed");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
