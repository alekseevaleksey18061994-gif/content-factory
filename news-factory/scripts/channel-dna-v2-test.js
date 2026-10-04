import assert from "node:assert/strict";
import { CHANNEL_DNA, SOURCE_CLASSES, channelStrategy } from "../lib/channel-dna.js";
import { APPROVED_AUTO_BLOGGER_SOURCES, SHOPPING_FIND_SOURCES } from "../lib/channel-curated-sources.js";
import { normalizeShoppingFindSources, normalizeAutoRubricSources } from "../lib/channel-rubric-migrations.js";
import {
  sourceClassFor,
  classifyContentBucket,
  contentMixBalance,
  channelStrategyScore,
  normalizeChannelSignals
} from "../lib/channel-strategy.js";

for (const [id, dna] of Object.entries(CHANNEL_DNA)) {
  const values = Object.values(dna.mix || {});
  assert.ok(values.length >= 3, id + ": mix missing");
  const sum = values.reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(sum - 1) < 0.001, id + ": mix must sum to 1, got " + sum);
  assert.ok(Object.keys(dna.scoreWeights || {}).length >= 4, id + ": score weights missing");
  assert.ok(Array.isArray(dna.preferredSources) && dna.preferredSources.length === 5, id + ": source preference missing");
  dna.preferredSources.forEach((x)=>assert.ok(SOURCE_CLASSES.includes(x), id + ": bad source class " + x));
  assert.deepEqual(Object.keys(channelStrategy(id).mix), Object.keys(dna.mix));
}

assert.equal(sourceClassFor({group:"official",url:"https://example.com"}), "OFFICIAL");
assert.equal(sourceClassFor({group:"creator",url:"https://t.me/s/foo"}), "CREATOR");
assert.equal(sourceClassFor({group:"media",url:"https://www.reddit.com/r/aivideo/top/"}), "COMMUNITY");
assert.equal(sourceClassFor({group:"media",url:"https://www.tiktok.com/@foo"}), "SOCIAL");
assert.equal(sourceClassFor({sourceClass:"COMMUNITY",group:"media"}), "COMMUNITY");

assert.equal(classifyContentBucket("ai",{title:"В сети завирусилось AI-видео, которое сделал пользователь"}), "viral_find");
assert.equal(classifyContentBucket("games",{title:"Игроки нашли баг и превратили его в мем"}), "community");
assert.equal(classifyContentBucket("science",{title:"Учёные обнаружили новый вид динозавра"}), "animals");
assert.equal(classifyContentBucket("sport",{title:"Hardcore: бой блогеров закончился конфликтом"}), "media_sport");
assert.equal(classifyContentBucket("shopping",{title:"На маркетплейсе началась скидка 40%"}), "deal");
assert.equal(classifyContentBucket("shopping",{title:"Новый товар без скидки появился на Ozon"}), "viral_product");
assert.equal(classifyContentBucket("home",{title:"Как организовать хранение в маленькой квартире"}), "organization");

const aiHistory = Array.from({length:12},(_,i)=>({contentBucket:"important_news",title:"Релиз модели "+i,publishedAt:new Date(Date.now()-i*3600000).toISOString()}));
const viralMix = contentMixBalance("ai",{contentBucket:"viral_find",title:"AI ролик"},aiHistory,24);
const newsMix = contentMixBalance("ai",{contentBucket:"important_news",title:"Новая модель"},aiHistory,24);
assert.ok(viralMix.bonus > 0, "underrepresented AI viral content must get a positive mix bonus");
assert.ok(newsMix.bonus < 0, "overrepresented AI news must get a penalty");

// v0.51.3: home is 10 equal themes (real estate is excluded outright, see home-rubrics-test): an overrepresented theme is penalised
const homeHistory = Array.from({length:10},(_,i)=>({contentBucket:"marketplace_finds",title:"Находка "+i}));
assert.ok(contentMixBalance("home",{contentBucket:"marketplace_finds"},homeHistory,24).bonus < 0, "an overrepresented home theme must be capped by mix");

const digestHeavy = [
  ...Array.from({length:4},()=>({contentBucket:"important_news"})),
  ...Array.from({length:20},()=>({isDigest:true,contentBucket:"viral_find"}))
];
assert.equal(contentMixBalance("ai",{contentBucket:"important_news"},digestHeavy,24).sampleSize,4);

const explicit = normalizeChannelSignals({virality:15,utility:-3,discussion:7}, {});
assert.equal(explicit.virality,10);
assert.equal(explicit.utility,0);
assert.equal(explicit.discussion,7);

const gameCommunity = channelStrategyScore("games",
  {contentBucket:"community",title:"Игроки нашли баг и сделали мем",videoUrl:"https://cdn/video.mp4",sourceGroup:"creator"},
  Array.from({length:8},(_,i)=>({contentBucket:i%2?"release":"drama",title:"post "+i})),
  {group:"creator",url:"https://t.me/s/games"}
);
assert.ok(gameCommunity.totalBonus > 0, "games community/video story should get channel bonus");
assert.equal(gameCommunity.sourceClass,"CREATOR");
assert.equal(sourceClassFor({group:"creator",name:"МЕМАЧ (Telegram)",url:"https://t.me/s/memachh"}),"COMMUNITY");


// v0.53.0: approved car and shopping channel structures.
const autoStrategy = channelStrategy("auto");
assert.equal(autoStrategy.rubrics.length, 8);
assert.deepEqual(autoStrategy.slotHours, [8,9,10,11,12,13,14,15,16,17,18,19,20,21,22]);
assert.equal(Object.keys(autoStrategy.slotRubrics).length, 15);
assert.equal(autoStrategy.slotRubrics["08:00"], "driver_important");
assert.equal(autoStrategy.slotRubrics["12:00"], "bloggers_tests");
assert.equal(autoStrategy.slotRubrics["22:00"], "viral_unusual");
assert.equal(APPROVED_AUTO_BLOGGER_SOURCES.length, 10);
assert.equal(APPROVED_AUTO_BLOGGER_SOURCES.some((x)=>/davyd|давыд/i.test(x.name+" "+x.url)), false);

const shoppingStrategy = channelStrategy("shopping");
assert.equal(shoppingStrategy.rubrics.length, 5);
assert.deepEqual(shoppingStrategy.slotHours, [8,11,14,17,20]);
assert.equal(Object.keys(shoppingStrategy.slotRubrics).length, 20);
const shoppingSlotCounts = {};
Object.values(shoppingStrategy.slotRubrics).forEach((id)=>{ shoppingSlotCounts[id]=(shoppingSlotCounts[id]||0)+1; });
assert.deepEqual(shoppingSlotCounts, {viral_products:4,wildberries:5,ozon:5,yandex_market:3,aliexpress:3});
assert.deepEqual(shoppingStrategy.rubrics.map((r)=>r.minSources), [5,5,5,5,7]);

const shoppingSourceCounts = {};
SHOPPING_FIND_SOURCES.forEach((s)=>{ shoppingSourceCounts[s.rubric]=(shoppingSourceCounts[s.rubric]||0)+1; });
assert.equal(SHOPPING_FIND_SOURCES.length, 27);
assert.deepEqual(shoppingSourceCounts, {wildberries:5,ozon:5,yandex_market:5,aliexpress:5,viral_products:7});

const shoppingState = {sources:[{id:"old",name:"Retail news",url:"https://example.com/retail",group:"media",enabled:true}],sourceReplenish:{}};
const shoppingMigration = normalizeShoppingFindSources(shoppingState, SHOPPING_FIND_SOURCES, new Set(shoppingStrategy.rubrics.map((r)=>r.id)), "2026-10-05T00:00:00.000Z");
assert.equal(shoppingMigration.added.length, 27);
assert.equal(shoppingState.sources.find((s)=>s.id==="old").enabled, false);
assert.equal(shoppingState.sources.filter((s)=>s.enabled).length, 27);

const autoState = {sources:[{id:"blogger-lisa-rulit",name:"Лиса Рулит",url:"https://t.me/s/lisacars",group:"blogger",enabled:true},{id:"cars-zr",name:"За рулём",url:"https://www.zr.ru/",group:"media",enabled:true}],publicationSchedule:{slots:[{time:"10:30",kind:"blogger"}]},sourceReplenish:{}};
normalizeAutoRubricSources(autoState, APPROVED_AUTO_BLOGGER_SOURCES, ["10:30","12:30","15:30","18:30","21:30"], "2026-10-05T00:00:00.000Z");
assert.equal(autoState.sources.find((s)=>s.id==="blogger-lisa-rulit").enabled, false);
assert.equal(autoState.sources.find((s)=>s.id==="cars-zr").rubric, "russia_market");
assert.equal(autoState.sources.filter((s)=>s.group==="blogger"&&s.enabled).length, 10);
assert.equal(autoState.publicationSchedule.slots.length, 0);

console.log("Channel DNA v2 smoke: OK");
