import assert from "node:assert/strict";
import { CHANNEL_DNA, SOURCE_CLASSES, channelStrategy } from "../lib/channel-dna.js";
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
assert.equal(classifyContentBucket("shopping",{title:"На Wildberries нашли компактный органайзер"}), "wildberries");
assert.equal(classifyContentBucket("shopping",{title:"Новый товар появился на Ozon"}), "ozon");
assert.equal(classifyContentBucket("shopping",{title:"В соцсетях завирусился необычный товар"}), "viral_products");
assert.equal(classifyContentBucket("auto",{title:"В России меняются правила ОСАГО для водителей"}), "driver_important");
assert.equal(classifyContentBucket("auto",{title:"Geely показала новую модель для китайского рынка"}), "china");
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

console.log("Channel DNA v2 smoke: OK");
