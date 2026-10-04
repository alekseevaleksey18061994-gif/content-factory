// v0.52.6 «Что там с деньгами?» — personal-finance rubrics, score, freshness and cadence.
process.env.TZ = "UTC";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadServer, inWs, mkQueueItem } from "./dedupe-harness.js";
import { channelStrategy, MONEY_RUBRIC_SOURCES_V0526 } from "../lib/channel-dna.js";
import { postRating } from "../lib/post-rating.js";

const M = "chtotamdengi";
const msk = (hh, mm=0, day="05") => `2026-10-${day}T${String(hh - 3).padStart(2,"0")}:${String(mm).padStart(2,"0")}:00Z`;
const src = (id, url, extra={}) => Object.assign({ id, name:id, url, enabled:true, group:"media", type:"web", priority:2 }, extra);
let passed=0;
async function test(name, fn){ await fn(); passed++; console.log("ok - "+name); }
function strong(over={}) {
  return mkQueueItem(Object.assign({
    title:"Ставка по вкладу изменилась до 18%",
    text:"Условия изменились: ставка 18%. Проверить новые условия можно в банке.",
    articlePublishedAt:msk(12,0),
    contentBucket:"deposits",
    channelSignals:{utility:10,local:10,deal:8,discussion:6,virality:4,wow:4,visual:5},
    sourceRole:"official_primary",
    editorialV2:{channelId:"money",status:"approved",verdict:"pass",importance:9,contentBucket:"deposits",channelSignals:{utility:10,local:10,deal:8,discussion:6,virality:4,wow:4,visual:5}}
  },over));
}

await test("M1 DNA: 8 equal rubrics, five-source floor and approved 8 normal slots", async () => {
  const st=channelStrategy("money");
  assert.equal(st.rubrics.length,8);
  assert.deepEqual(st.rubrics.map(r=>r.id).sort(),Object.keys(st.mix).sort());
  assert.ok(Object.values(st.mix).every(v=>v===0.125));
  assert.equal(st.rubricMinSources,5);
  assert.equal(st.rubricMaxSources,6);
  assert.deepEqual(st.slotHours,[9,11,13,16,18,20]);

  const t=await loadServer({fixedNow:msk(12,0)});
  assert.deepEqual(inWs(t,M,()=>t.channelSlotHours()),[9,11,13,16,18,20]);
  assert.deepEqual(inWs(t,M,()=>t.bloggerSlotsFor()),["14:30","21:30"]);
  assert.equal(inWs(t,M,()=>t.bloggerTargetFor()),2);
  const sch=inWs(t,M,()=>t.ensureScheduleShape(t.ws(M).state));
  const times=(sch.slots||[]).map(x=>x.time);
  for(const time of ["09:00","11:00","13:00","14:30","16:00","18:00","20:00","21:30","22:30"]) assert.ok(times.includes(time),time);
  assert.equal(sch.targetPerDay,8);
  assert.equal(sch.maxPerDay,8);
  t.restoreConsole();
});

await test("M2 exactly one normal post per rubric: repeat is blocked, untouched rubric wins", async () => {
  const t=await loadServer({fixedNow:msk(14,0)});
  const ws=t.ws(M);
  ws.state.history=[{id:"h1",publishedAt:msk(9,2),contentBucket:"cards_banks",publicationOrigin:"schedule",scheduledSlot:"2026-10-05 09:00"}];
  ws.state.queue=[
    strong({id:"repeat",newsId:"nr",contentBucket:"cards_banks",editorialV2:{channelId:"money",status:"approved",verdict:"pass",importance:10,contentBucket:"cards_banks",channelSignals:{utility:10,discussion:10,virality:10,wow:10}},channelSignals:{utility:10,discussion:10,virality:10,wow:10}}),
    strong({id:"fresh",newsId:"nf",contentBucket:"deposits"})
  ];
  assert.equal(inWs(t,M,()=>t.dynamicBestQueueItemRaw("",true)).id,"fresh");
  ws.state.queue=[ws.state.queue[0]];
  assert.equal(inWs(t,M,()=>t.dynamicBestQueueItemRaw("",false)),null);
  t.restoreConsole();
});

await test("M3 custom 100-point money score and 48/72-hour freshness windows", async () => {
  const now=Date.now();
  const base={
    channelId:"money",title:"Пособие увеличили до 25 000 ₽",text:"Размер выплаты — 25 000 ₽.",
    editorialV2:{status:"approved",verdict:"pass",importance:9,contentBucket:"income_benefits",channelSignals:{utility:10,discussion:6,virality:4,wow:3}},
    channelSignals:{utility:10,discussion:6,virality:4,wow:3},sourceRole:"official_primary",sourceCount:1,qcStatus:"pass"
  };
  const recent=postRating(Object.assign({},base,{articlePublishedAt:new Date(now-6*3600000).toISOString()}));
  assert.ok(recent.total>=90,recent.total);
  assert.deepEqual(recent.parts.map(p=>p.max),[30,20,20,15,10,5]);
  const oldDurable=postRating(Object.assign({},base,{articlePublishedAt:new Date(now-60*3600000).toISOString()}));
  assert.equal(oldDurable.parts.find(p=>p.short==="Свежесть").got,4);

  const t=await loadServer({fixedNow:msk(15,0)});
  const regular=strong({contentBucket:"cards_banks",editorialV2:{channelId:"money",status:"approved",verdict:"pass",importance:9,contentBucket:"cards_banks",channelSignals:{utility:10}}});
  const durable=strong({contentBucket:"taxes",editorialV2:{channelId:"money",status:"approved",verdict:"pass",importance:9,contentBucket:"taxes",channelSignals:{utility:10}}});
  assert.equal(inWs(t,M,()=>t.dynamicItemMaxAgeMs(regular)),48*3600000);
  assert.equal(inWs(t,M,()=>t.dynamicItemMaxAgeMs(durable)),72*3600000);
  t.restoreConsole();
});

await test("M4 70–79 is reserve only when genuinely useful; below 70 never publishes", async () => {
  const t=await loadServer({fixedNow:msk(14,0)});
  const ws=t.ws(M);
  const reserve=strong({
    id:"reserve",newsId:"reserve-news",title:"Как вернуть банковскую комиссию 500 ₽",text:"Практическая инструкция: возврат 500 ₽.",
    contentBucket:"money_howto",sourceRole:"media_context",
    channelSignals:{utility:7,discussion:3,virality:2,wow:2},
    editorialV2:{channelId:"money",status:"approved",verdict:"pass",importance:6,contentBucket:"money_howto",channelSignals:{utility:7,discussion:3,virality:2,wow:2}}
  });
  ws.state.queue=[reserve];
  const rating=inWs(t,M,()=>t.queueItemRating(reserve));
  assert.ok(rating>=70&&rating<80,"reserve rating="+rating);
  assert.equal(inWs(t,M,()=>t.ratingBelowAutoThreshold(reserve)),true);
  assert.equal(inWs(t,M,()=>t.dynamicBestQueueItem()).id,"reserve");

  const weak=strong({
    id:"weak",newsId:"weak-news",title:"Общий финансовый совет",text:"Полезный материал без цифр.",
    contentBucket:"money_howto",sourceRole:"media_context",
    channelSignals:{utility:3,discussion:2,virality:2,wow:2},
    editorialV2:{channelId:"money",status:"approved",verdict:"pass",importance:5,contentBucket:"money_howto",channelSignals:{utility:3,discussion:2,virality:2,wow:2}}
  });
  ws.state.queue=[weak];
  assert.ok(inWs(t,M,()=>t.queueItemRating(weak))<70);
  assert.equal(inWs(t,M,()=>t.dynamicBestQueueItem()),null);
  t.restoreConsole();
});

await test("M5 important financial claims require official primary or two independent sources", async () => {
  const t=await loadServer({fixedNow:msk(14,0)});
  const author=strong({contentBucket:"cards_banks",sourceRole:"author_opinion",title:"Банк изменил комиссию на переводы до 2%",text:"Новая комиссия 2% на переводы.",editorialV2:{channelId:"money",status:"approved",verdict:"pass",importance:8,contentBucket:"cards_banks",channelSignals:{utility:9}}});
  assert.equal(inWs(t,M,()=>t.moneyFactConfirmationOk(author)),false);
  const official=Object.assign({},author,{sourceRole:"official_primary"});
  assert.equal(inWs(t,M,()=>t.moneyFactConfirmationOk(official)),true);
  const multi=Object.assign({},author,{storySources:[{name:"A"},{name:"B"}]});
  assert.equal(inWs(t,M,()=>t.moneyFactConfirmationOk(multi)),true);
  t.restoreConsole();
});

await test("M6 planned shared source feeds several rubrics; unknown legacy source is quarantined; floor becomes 5", async () => {
  const central=MONEY_RUBRIC_SOURCES_V0526.add.find(x=>x.url==="https://t.me/s/centralbank_russia");
  assert.ok(central && central.rubrics.length>=4);
  const t=await loadServer({fixedNow:msk(14,0),state:{[M]:{
    sources:[
      src("cb",central.url,{name:"Банк России",group:"official"}),
      src("old","https://generic-economy.example/news",{name:"Старая экономика"})
    ],
    rubricLimits:{cards_banks:{min:2}}
  }}});
  const ws=t.ws(M);
  const result=inWs(t,M,()=>t.normalizeMoneyRubricSourcesV0526(ws));
  const cb=ws.state.sources.find(x=>x.id==="cb");
  assert.deepEqual(cb.rubrics,central.rubrics);
  assert.equal(ws.state.sources.find(x=>x.id==="old").enabled,false);
  assert.ok(result.paused.includes("Старая экономика"));
  const counts=inWs(t,M,()=>t.rubricSourceCounts());
  for(const id of central.rubrics) assert.equal(counts[id],1,id);
  for(const r of channelStrategy("money").rubrics) assert.ok(inWs(t,M,()=>t.rubricMinFor(r.id))>=5,r.id);
  t.restoreConsole();
});

await test("M7 95+ emergency candidate is available only as a ninth post and only once", async () => {
  const t=await loadServer({fixedNow:msk(22,15)});
  const ws=t.ws(M);
  const normalSlots=["09:00","11:00","13:00","16:00","18:00","20:00"];
  ws.state.history=normalSlots.map((time,i)=>({id:"h"+i,publishedAt:msk(Number(time.slice(0,2)),2),contentBucket:channelStrategy("money").rubrics[i].id,publicationOrigin:"schedule",scheduledSlot:"2026-10-05 "+time}));
  ws.state.history.push({id:"h6",publishedAt:msk(14,32),contentBucket:"financial_scams",publicationOrigin:"blogger-schedule",scheduledSlot:"2026-10-05 14:30"});
  ws.state.history.push({id:"h7",publishedAt:msk(21,32),contentBucket:"money_howto",publicationOrigin:"blogger-schedule",scheduledSlot:"2026-10-05 21:30"});
  assert.equal(inWs(t,M,()=>t.moneyNormalPublishedCount("2026-10-05")),8);

  const emergency=strong({
    id:"em",newsId:"em-news",title:"ЦБ экстренно изменил ключевую ставку до 20%",text:"Ключевая ставка — 20%. Решение вступает в силу сегодня.",
    contentBucket:"ruble_inflation_cb",sourceRole:"official_primary",
    channelSignals:{utility:10,discussion:10,virality:10,wow:10},
    editorialV2:{channelId:"money",status:"approved",verdict:"pass",importance:10,contentBucket:"ruble_inflation_cb",channelSignals:{utility:10,discussion:10,virality:10,wow:10}}
  });
  ws.state.queue=[emergency];
  assert.ok(inWs(t,M,()=>t.queueItemRating(emergency))>=95);
  const prepared=await inWs(t,M,()=>t.prepareMoneyEmergencySlot());
  assert.equal(prepared.prepared,"em");

  ws.state.history.unshift({id:"e1",publishedAt:msk(22,31),contentBucket:"ruble_inflation_cb",publicationOrigin:"money-emergency-schedule",scheduledSlot:"2026-10-05 22:30"});
  assert.equal((await inWs(t,M,()=>t.prepareMoneyEmergencySlot())).skipped,"emergency_already_used");
  t.restoreConsole();
});

await test("M8 money cannot bypass rubric scheduler through legacy direct auto-publish", async () => {
  const server=fs.readFileSync(fileURLToPath(new URL("../server.js",import.meta.url)),"utf8");
  assert.match(server,/const canAutoPublish =\s*\/\/[^\n]*\n\s*editorialChannelId\(\) !== "money" &&/);
});

console.log("money-rubrics: "+passed+" passed");
