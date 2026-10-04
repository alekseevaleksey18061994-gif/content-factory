// v0.52.9 — approved «Что там у тачек?» + «Что там с покупками?» configuration.
process.env.TZ = "UTC";
import assert from "node:assert/strict";
import { loadServer, inWs, mkQueueItem } from "./dedupe-harness.js";
import { channelStrategy, AUTO_RUBRIC_SOURCES_V0529, SHOPPING_RUBRIC_SOURCES_V0529 } from "../lib/channel-dna.js";

const A="chtotamtachki";
const S="chtotampokupki";
const msk=(hh,mm=0)=>`2026-10-05T${String(hh-3).padStart(2,"0")}:${String(mm).padStart(2,"0")}:00Z`;
let passed=0;
async function test(name,fn){ await fn(); passed++; console.log("ok - "+name); }

await test("AS1 cars: 8 approved rubrics and exact 15-slot rubric map", async()=>{
  const st=channelStrategy("auto");
  assert.deepEqual(st.rubrics.map(r=>r.id),[
    "premieres","russia_market","china","ev_hybrid","auto_tech","bloggers_owners","viral_unusual","driver_important"
  ]);
  assert.deepEqual(st.slotHours,[8,9,10,11,12,13,14,15,16,17,18,19,20,21,22]);
  assert.equal(Object.keys(st.slotRubrics).length,15);
  assert.equal(st.slotRubrics["08:00"],"driver_important");
  assert.equal(st.slotRubrics["12:00"],"bloggers_owners");
  assert.equal(st.slotRubrics["21:00"],"auto_tech");
  assert.equal(st.slotRubrics["22:00"],"viral_unusual");
});

await test("AS2 cars: approved blogger set is present and old extra :30 lane is disabled", async()=>{
  const approved=["Ильдар Авто-подбор","Александр Булкин","Михеев и Павлов","Туман","AcademeG","Клубный Сервис","Гараж 54","Жекич Дубровский","Иван Зенкевич PRO автомобили","Денис Механик"];
  const names=new Set(AUTO_RUBRIC_SOURCES_V0529.add.map(x=>x.name));
  for(const name of approved) assert.ok(names.has(name),name);
  assert.ok(!Array.from(names).some(x=>/давыд/i.test(x)));
  const t=await loadServer({fixedNow:msk(10)});
  assert.deepEqual(inWs(t,A,()=>t.bloggerSlotsFor()),[]);
  const sch=inWs(t,A,()=>t.ensureScheduleShape(t.ws(A).state));
  assert.ok(!(sch.slots||[]).some(x=>x.kind==="blogger"));
  t.restoreConsole();
});

await test("AS3 cars: a slot only selects its assigned rubric", async()=>{
  const t=await loadServer({fixedNow:msk(10)});
  const ws=t.ws(A);
  ws.state.queue=[
    mkQueueItem({id:"china",newsId:"nchina",contentBucket:"china",editorialV2:{channelId:"auto",status:"approved",verdict:"pass",importance:10,contentBucket:"china"},aiScore:98}),
    mkQueueItem({id:"prem",newsId:"nprem",contentBucket:"premieres",editorialV2:{channelId:"auto",status:"approved",verdict:"pass",importance:8,contentBucket:"premieres"},aiScore:80})
  ];
  const best=inWs(t,A,()=>t.dynamicBestQueueItemRaw("",true,"premieres"));
  assert.equal(best && best.id,"prem");
  assert.equal(inWs(t,A,()=>t.channelSlotRubric("10:00")),"premieres");
  ws.state.sources=[{id:"blog",name:"Ильдар Авто-подбор",url:"https://t.me/s/ildar_auto_podbor",enabled:true,group:"blogger",rubric:"bloggers_owners",rubrics:["bloggers_owners"]}];
  ws.state.queue=[
    mkQueueItem({id:"blogq",newsId:"nblog",sourceId:"blog",sourceName:"Ильдар Авто-подбор",contentBucket:"bloggers_owners",editorialV2:{channelId:"auto",status:"approved",verdict:"pass",importance:9,contentBucket:"bloggers_owners"},aiScore:90})
  ];
  assert.equal(inWs(t,A,()=>t.dynamicBestQueueItemRaw("",true,"bloggers_owners")).id,"blogq");
  t.restoreConsole();
});

await test("AS4 shopping: five rubrics, 20 exact slots and approved 5/5/5/5/7 source floors", async()=>{
  const st=channelStrategy("shopping");
  assert.deepEqual(st.rubrics.map(r=>r.id),["wildberries","ozon","yandex_market","aliexpress","viral_products"]);
  assert.equal(st.slotSchedule.length,20);
  assert.deepEqual(st.rubricDefaultMins,{wildberries:5,ozon:5,yandex_market:5,aliexpress:5,viral_products:7});
  const counts={};
  for(const x of st.slotSchedule) counts[x.rubric]=(counts[x.rubric]||0)+1;
  assert.deepEqual(counts,{viral_products:4,wildberries:5,ozon:5,yandex_market:3,aliexpress:3});
  assert.deepEqual(st.slotSchedule.map(x=>x.time),[
    "08:00","08:45","09:30","10:15","11:00","11:45","12:30","13:15","14:00","14:45",
    "15:30","16:15","17:00","17:45","18:30","19:15","20:00","20:45","21:30","22:15"
  ]);
  assert.equal(SHOPPING_RUBRIC_SOURCES_V0529.add.length,27);
});

await test("AS5 shopping: runtime schedule is exactly 20 custom slots and no source links are public", async()=>{
  const t=await loadServer({fixedNow:msk(12)});
  const sch=inWs(t,S,()=>t.ensureScheduleShape(t.ws(S).state));
  assert.equal(sch.targetPerDay,20);
  assert.equal(sch.maxPerDay,20);
  assert.equal(sch.slots.length,20);
  assert.ok(sch.slots.every(x=>x.kind==="channel-custom"));
  assert.equal(inWs(t,S,()=>t.rubricMinFor("wildberries")),5);
  assert.equal(inWs(t,S,()=>t.rubricMinFor("viral_products")),7);
  const post={title:"Находка",text:"Полезная вещь для дома. https://example.com/product",sourceName:"Test Store",sourceUrl:"https://example.com/product",originalUrl:"https://example.com/product"};
  const tg=inWs(t,S,()=>t.formatTelegramPost(post));
  const vk=inWs(t,S,()=>t.formatVkPost(post,{includeSource:true}));
  assert.ok(!/Источник|Источники|example\.com/.test(tg),tg);
  assert.ok(!/Источник|Источники|example\.com/.test(vk),vk);
  t.restoreConsole();
});

await test("AS6 shopping: old broad-channel buckets cannot leak into a product slot", async()=>{
  const t=await loadServer({fixedNow:msk(12)});
  const ws=t.ws(S);
  ws.state.sources=[{id:"ozsrc",name:"Ozon source",url:"https://x/oz",enabled:true,rubric:"ozon",rubrics:["ozon"],group:"creator"}];
  ws.state.queue=[
    mkQueueItem({id:"old",newsId:"nold",sourceId:"ozsrc",sourceName:"Ozon source",contentBucket:"deal",editorialV2:{channelId:"shopping",status:"approved",verdict:"pass",importance:10,contentBucket:"deal"},aiScore:99}),
    mkQueueItem({id:"new",newsId:"nnew",sourceId:"ozsrc",sourceName:"Ozon source",contentBucket:"ozon",editorialV2:{channelId:"shopping",status:"approved",verdict:"pass",importance:8,contentBucket:"ozon"},aiScore:82})
  ];
  const best=inWs(t,S,()=>t.dynamicBestQueueItemRaw("",true,"ozon"));
  assert.equal(best && best.id,"new");
  assert.equal(inWs(t,S,()=>t.channelRatingMinAuto()),75);
  assert.equal(inWs(t,S,()=>t.channelRatingDropBelow()),65);
  t.restoreConsole();
});

console.log("auto-shopping-rubrics-test: "+passed+" passed");
