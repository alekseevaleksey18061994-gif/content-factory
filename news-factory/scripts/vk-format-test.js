import assert from "node:assert/strict";
import { adaptVkBody, vkTail, sourceDomain, breakWallOfText, handlesToTmeLinks } from "../lib/vk-format.js";

// signature line becomes nothing in the body; tail adds the link
const body = adaptVkBody("Лид.\n\n• а\n• б\n\n#рецепты #еда\n@chtotameda", { handle: "chtotameda" });
assert.ok(!/@/.test(body), "no @ left");
assert.ok(body.endsWith("#рецепты #еда"));
assert.equal(vkTail({ handle: "chtotameda", sources: [{ url: "https://www.bbcgoodfood.com/recipes/x?y=1" }] }),
  "Мы в Telegram: t.me/chtotameda\nИсточник: bbcgoodfood.com");
assert.equal(vkTail({ handle: "", sources: [] }), "");
assert.equal(vkTail({ handle: "a_bcd", sources: [{ url: "https://a.com/1" }, { url: "https://a.com/2" }, { url: "https://b.org/x" }] }),
  "Мы в Telegram: t.me/a_bcd\nИсточники: a.com, b.org");
assert.equal(sourceDomain("not a url"), "");
assert.equal(sourceDomain("https://m.example.com/a"), "example.com");

// cross-promo handle of another channel becomes a link, e-mails and urls untouched
assert.equal(handlesToTmeLinks("👉 Больше про ИИ — в 🤖 Что там у ИИ? @chtotamai"), "👉 Больше про ИИ — в 🤖 Что там у ИИ? t.me/chtotamai");
assert.equal(handlesToTmeLinks("пишите a@b.com и https://t.me/x/@abcd"), "пишите a@b.com и https://t.me/x/@abcd");

// wall of text is split into short paragraphs; lists and short paragraphs are kept
const wall = "Первое предложение довольно длинное и содержит детали. ".repeat(3) + "Второе предложение тоже длинное и подробное. ".repeat(3) + "Третье. Четвёртое.";
const split = breakWallOfText(wall, 200);
assert.ok(split.includes("\n\n"), "split into paragraphs");
for (const p of split.split("\n\n")) assert.ok(p.split(/(?<=[.!?])\s+/).length <= 2, "<=2 sentences: " + p);
const list = "Нужно:\n• а\n• б\n• в, " + "очень длинный пункт ".repeat(20);
assert.equal(breakWallOfText(list, 200), list, "lists untouched");
assert.equal(breakWallOfText("Коротко. Просто.", 200), "Коротко. Просто.");

// signature of another case / without @ is also removed only when it is the last line
assert.equal(adaptVkBody("Текст\n@ChtoTamEda", { handle: "chtotameda" }), "Текст");
assert.equal(adaptVkBody("Про @chtotameda в тексте", { handle: "chtotameda" }), "Про t.me/chtotameda в тексте");
console.log("vk-format tests passed");
