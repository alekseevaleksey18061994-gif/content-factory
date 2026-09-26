
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const load=(k,d)=>{try{const v=JSON.parse(localStorage.getItem(k)||"null");return v??d}catch{return d}};
const save=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
const esc=(v="")=>String(v).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const uid=p=>p+Date.now()+Math.random().toString(36).slice(2,6);
const now=()=>new Date().toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
const starter=[
{id:"washcloth",name:"Корейская мочалка",category:"Красота и уход",icon:"🧽",tag:"Хит",utp:"Выраженная фактура, удобный формат, понятная демонстрация использования.",rules:"Не менять форму, фактуру и цвет товара. Не дорисовывать детали. Показывать корректное использование.",masterStyle:"Тёмный премиум / UGC"},
{id:"holder",name:"Держатель полотенец",category:"Дом и кухня",icon:"🧻",tag:"Новинка",utp:"Аккуратный вид, удобная установка, наглядная демонстрация.",rules:"Сохранять реальную конструкцию, комплект и пропорции.",masterStyle:"Премиальный интерьер"},
{id:"curler",name:"Мини-плойка",category:"Красота и уход",icon:"〰️",tag:"Популярно",utp:"Компактность, быстрый визуальный результат, UGC-подача.",rules:"Не менять форму корпуса и органы управления.",masterStyle:"Beauty UGC"}
];
let activeAccountId=load("cf_active_account","main"),accounts=[];
const accountLocalKey=key=>activeAccountId==="main"?key:key+"__"+activeAccountId;
const chatLocalKey=()=>activeAccountId==="main"?"cf_chat_history":"cf_chat_history__"+activeAccountId;
let products=load(accountLocalKey("cf_products"),[]),runs=load(accountLocalKey("cf_runs"),[]),campaigns=load(accountLocalKey("cf_campaigns"),[]),scripts=load(accountLocalKey("cf_scripts"),[]),savedIdeas=load(accountLocalKey("cf_saved_ideas"),[]),mediaLibrary=load(accountLocalKey("cf_media_library"),[]),characters=load(accountLocalKey("cf_characters"),[]),journal=load(accountLocalKey("cf_journal"),[]),expenses=load(accountLocalKey("cf_expenses"),[]),videoAnalyses=load(accountLocalKey("cf_video_analyses"),[]),settings=load(accountLocalKey("cf_settings"),{mode:"auto",budgetCampaign:5000,budgetAttempts:3,budgetApproval:100,costRates:{usdRub:0,higgsfieldRubPerGeneration:0,runwayRubPerSecond:0,descriptRubPerAction:0}});
let selectedProductId=products[0]?.id||null,selectedRunId=runs.at(-1)?.id||null,createMode=settings.mode||"auto",editingProductId=null;
const ST=["Идея","Сценарий","Storyboard","Превиз-кадры","Генерация","Озвучка","Монтаж","AI-проверка","На проверке","Готово","Запланировано","Опубликовано"];
const prod=id=>products.find(x=>x.id===id),camp=id=>campaigns.find(x=>x.id===id);
const pname=r=>prod(r.productId)?.name||r.productName||"Удалённый товар";
const norm=r=>r.status==="Готово"?"Готово":r.stage==="Референсы"?"Превиз-кадры":r.stage==="Видео"?"Генерация":ST.includes(r.stage)?r.stage:(r.status==="На проверке"?"На проверке":r.status==="В работе"?"Сценарий":"Идея");
const sidx=r=>Math.max(0,ST.indexOf(norm(r)));
const pct=r=>Number.isFinite(r.progress)?Math.max(0,Math.min(100,r.progress)):Math.round(sidx(r)/(ST.length-1)*100);
const scl=s=>s==="Готово"||s==="Запланировано"||s==="Опубликовано"?"done":s==="На проверке"?"review":s==="Ошибка"?"error":s==="Ждёт пополнения"?"blocked":s==="В работе"?"work":"wait";
function saveLocalState(){
  save(accountLocalKey("cf_products"),products);
  save(accountLocalKey("cf_runs"),runs);
  save(accountLocalKey("cf_campaigns"),campaigns);
  save(accountLocalKey("cf_scripts"),scripts);
  save(accountLocalKey("cf_saved_ideas"),savedIdeas);
  save(accountLocalKey("cf_media_library"),mediaLibrary.slice(-10000));
  save(accountLocalKey("cf_characters"),characters);
  save(accountLocalKey("cf_journal"),journal.slice(-500));
  save(accountLocalKey("cf_expenses"),expenses.slice(-3000));
  save(accountLocalKey("cf_video_analyses"),videoAnalyses.slice(-100));
  save(accountLocalKey("cf_settings"),settings);
}
function stateSnapshot(){
  return {version:1,products,runs,campaigns,scripts,savedIdeas,mediaLibrary:mediaLibrary.slice(-10000),characters,journal:journal.slice(-500),expenses:expenses.slice(-3000),videoAnalyses:videoAnalyses.slice(-100),settings};
}
let syncTimer=null;
let localMutationDepth=0;
let deferredServerSync=false;
const beginLocalMutation=()=>{localMutationDepth++};
const finishLocalMutation=()=>{localMutationDepth=Math.max(0,localMutationDepth-1)};
async function pushState(){
  try{
    const r=await fetch("/api/state?account="+encodeURIComponent(activeAccountId),{method:"PUT",headers:{"content-type":"application/json","x-content-account":activeAccountId},body:JSON.stringify({accountId:activeAccountId,data:stateSnapshot()})});
    return r.ok;
  }catch{return false}
}
async function syncFromServer(){
  if(localMutationDepth>0){deferredServerSync=true;return}
  try{
    deferredServerSync=false;
    const r=await fetch("/api/state?account="+encodeURIComponent(activeAccountId),{cache:"no-store",headers:{"x-content-account":activeAccountId}});
    if(!r.ok)return;
    const payload=await r.json();
    const data=payload?.data;
    if(data&&typeof data==="object"){
      products=Array.isArray(data.products)?data.products:[];
      runs=Array.isArray(data.runs)?data.runs:[];
      campaigns=Array.isArray(data.campaigns)?data.campaigns:[];
      scripts=Array.isArray(data.scripts)?data.scripts:[];
      savedIdeas=Array.isArray(data.savedIdeas)?data.savedIdeas:[];
      mediaLibrary=Array.isArray(data.mediaLibrary)?data.mediaLibrary:[];
      characters=Array.isArray(data.characters)?data.characters:[];
      journal=Array.isArray(data.journal)?data.journal:[];
      expenses=Array.isArray(data.expenses)?data.expenses:[];
      videoAnalyses=Array.isArray(data.videoAnalyses)?data.videoAnalyses:[];
      settings=data.settings&&typeof data.settings==="object"?data.settings:settings;
      selectedProductId=products.find(x=>x.id===selectedProductId)?.id||products[0]?.id||null;
      selectedRunId=runs.find(x=>x.id===selectedRunId)?.id||runs.at(-1)?.id||null;
      createMode=settings.mode||"auto";
      saveLocalState();
      renderAll();
    }else{
      await pushState();
    }
  }catch{}
}
function persist(){
  saveLocalState();
  renderAll();
  clearTimeout(syncTimer);
  syncTimer=setTimeout(pushState,180);
}
function log(t,d="",type="ok"){journal.push({id:uid("j"),time:now(),title:t,detail:d,type});save("cf_journal",journal.slice(-500))}
function setMobileDrawer(open){
  const side=$("#appSidebar"),backdrop=$("#mobileDrawerBackdrop"),toggle=$("#mobileMenuToggle");
  if(!side)return;
  side.classList.toggle("mobile-open",!!open);
  backdrop?.classList.toggle("open",!!open);
  document.body.classList.toggle("mobile-drawer-open",!!open);
  toggle?.setAttribute("aria-expanded",open?"true":"false");
}
function go(id,options={}){
  document.querySelectorAll(".page").forEach(x=>x.classList.toggle("active",x.id===id));
  document.querySelectorAll(".nav").forEach(x=>x.classList.toggle("active",x.dataset.go===id||(id==="productDetail"&&x.dataset.go==="products")||(id==="runDetail"&&x.dataset.go==="generations")));
  setMobileDrawer(false);
  if(id==="profile")renderConnections();
  if(id==="account")renderAccounts();
  if(id==="costs"){renderCosts();ensureUsdRubRate();}
  if(id==="assistant"){refreshChatStatus();if(!options.skipChatSync)syncChatHistoryFromCloud();}
  scrollTo({top:0,behavior:"smooth"});
}
window.go=go;
$("#mobileMenuToggle")?.addEventListener("click",()=>setMobileDrawer(true));
$("#mobileDrawerClose")?.addEventListener("click",()=>setMobileDrawer(false));
$("#mobileDrawerBackdrop")?.addEventListener("click",()=>setMobileDrawer(false));
document.addEventListener("keydown",e=>{if(e.key==="Escape")setMobileDrawer(false)});
document.addEventListener("click",e=>{
  const b=e.target.closest?.("[data-go]");
  if(!b||!b.dataset.go)return;
  e.preventDefault();
  go(b.dataset.go);
});
function syncModalUi(){document.body.classList.toggle("modal-open",!!document.querySelector(".modal.open"))}
function openM(id){$("#"+id)?.classList.add("open");syncModalUi()}
function closeM(id){$("#"+id)?.classList.remove("open");syncModalUi()}
window.closeModal=closeM;
$$("[data-close]").forEach(b=>b.onclick=()=>closeM(b.dataset.close));$$(".modal").forEach(m=>m.onclick=e=>{if(e.target===m)closeM(m.id)});
function characterOptions(selected="",emptyLabel="Без персонажа"){
  return '<option value="">'+esc(emptyLabel)+'</option>'+characters.map(c=>'<option value="'+esc(c.id)+'" '+(String(c.id)===String(selected)?'selected':'')+'>'+esc(c.name)+'</option>').join("");
}
function opts(){
  const po=products.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join("");
  ["productSelect","campaignProduct","ideaProduct"].forEach(id=>{
    const el=$("#"+id);if(!el)return;
    const old=el.value;el.innerHTML=po;
    if(products.some(p=>String(p.id)===String(old)))el.value=old;
  });
  if($("#campaignSelect")){
    const old=$("#campaignSelect").value;
    $("#campaignSelect").innerHTML='<option value="">Без кампании</option>'+campaigns.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join("");
    if(campaigns.some(c=>String(c.id)===String(old)))$("#campaignSelect").value=old;
  }
  if($("#characterSelect")){
    const old=$("#characterSelect").value;
    $("#characterSelect").innerHTML=characterOptions(old);
    if(characters.some(c=>String(c.id)===String(old)))$("#characterSelect").value=old;
  }
  if($("#newProductCharacter")){
    const old=$("#newProductCharacter").value;
    $("#newProductCharacter").innerHTML=characterOptions(old,"Без привязки");
    if(characters.some(c=>String(c.id)===String(old)))$("#newProductCharacter").value=old;
  }
}
function applyProductDefaultCharacter(force=true){
  const select=$("#characterSelect"),productSelect=$("#productSelect"),hint=$("#characterSelectHint");
  if(!select||!productSelect)return;
  const p=prod(productSelect.value);
  const linked=characters.find(c=>String(c.id)===String(p?.defaultCharacterId||""));
  if(force)select.value=linked?.id||"";
  if(hint)hint.textContent=linked
    ?'Привязан к товару: '+linked.name+'. Можно переопределить только для этого запуска.'
    :'К товару аватар не привязан. Можно выбрать вручную.';
}
function openCreate(id,platform){
  selectedProductId=id||selectedProductId||products[0]?.id;
  opts();
  if(selectedProductId&&$("#productSelect"))$("#productSelect").value=selectedProductId;
  applyProductDefaultCharacter(true);
  if(platform)$$("[data-p]").forEach(x=>x.checked=x.dataset.p===platform);
  $("#launchMsg").textContent="";
  openM("createModal");
}
window.openCreate=openCreate;
window.openCreate=openCreate;$$("[data-create]").forEach(b=>b.onclick=()=>openCreate(null,b.dataset.platform));
$("#productSelect")?.addEventListener("change",()=>{selectedProductId=$("#productSelect").value;applyProductDefaultCharacter(true)});
function stat(i,l,v,t=""){return '<div class="stat '+t+'"><span>'+i+'</span><div><small>'+l+'</small><b>'+v+'</b></div></div>'}
function primaryMedia(p){const list=Array.isArray(p?.media)?p.media:[];return list.find(m=>m.isPrimary)||list[0]||null}
function productThumb(p,cls="product-thumb"){const m=primaryMedia(p);return '<span class="'+cls+(m?' has-image':'')+'">'+(m?'<img src="'+esc(m.url)+'" alt="'+esc(p.name||"Товар")+'">':(p.icon||"◆"))+'</span>'}
function pcard(p){return '<button class="product-card" onclick="openProduct(\''+p.id+'\')">'+productThumb(p)+'<span><b>'+esc(p.name)+'</b><small>'+esc(p.category||"Товар")+'</small><span class="pill">'+esc(p.tag||"Товар")+'</span></span><span class="chev">›</span></button>'}
function primaryCharacterMedia(c){const list=Array.isArray(c?.media)?c.media:[];return list.find(m=>m.isPrimary)||list[0]||null}
function productCharacter(p){return characters.find(c=>String(c.id)===String(p?.defaultCharacterId||""))||null}
window.setProductDefaultCharacter=(productId,characterId)=>{
  const p=prod(productId);if(!p)return;
  p.defaultCharacterId=characterId||null;
  const c=productCharacter(p);
  log("Изменена привязка аватара",p.name+" → "+(c?.name||"без аватара"));
  persist();
  if(selectedProductId===productId)renderProductDetail();
};
function renderCharacterDraftPreview(){
  const box=$("#characterPhotoPreview"),input=$("#characterImages");if(!box||!input)return;
  const files=[...(input.files||[])].slice(0,10);
  if(!files.length){box.innerHTML='<div class="avatar-preview-empty">Фото пока не выбраны</div>';return}
  box.innerHTML=files.map((file,i)=>'<div class="avatar-preview-item"><img src="'+URL.createObjectURL(file)+'" alt="Фото '+(i+1)+'"><small>'+esc(file.name)+'</small></div>').join("");
}
async function uploadCharacterPhotos(character,fileList,statusEl=null){
  const files=[...fileList].filter(Boolean).slice(0,10);
  character.media=Array.isArray(character.media)?character.media:[];
  let ok=0,failed=0;
  for(let i=0;i<files.length;i++){
    const file=files[i];
    if(!String(file.type||"").startsWith("image/")){failed++;continue}
    if(file.size>10*1024*1024){failed++;if(statusEl)statusEl.textContent='Фото «'+file.name+'» больше 10 МБ — пропущено.';continue}
    try{
      if(statusEl)statusEl.textContent='Загружаю фото аватара '+(i+1)+' из '+files.length+'…';
      const dataBase64=await fileDataUrl(file);
      const resp=await fetch("/api/media/upload",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accountId:activeAccountId,productId:"avatar-"+character.id,fileName:file.name,mimeType:file.type||"image/jpeg",dataBase64})});
      const body=await resp.json().catch(()=>({}));
      if(!resp.ok||!body.media)throw new Error(body.detail||body.error||"Ошибка загрузки");
      if(!character.media.length)body.media.isPrimary=true;
      character.media.push(body.media);ok++;saveLocalState();renderCharacters();opts();
    }catch(e){
      failed++;
      if(statusEl)statusEl.textContent='Не удалось загрузить «'+file.name+'»: '+String(e?.message||e);
    }
  }
  persist();
  if(statusEl)statusEl.textContent=failed?'Загружено: '+ok+'. Не удалось: '+failed+'.':'Готово. Фото аватара: '+character.media.length+'.';
  return {ok,failed};
}
window.uploadExistingCharacterPhotos=async(e,characterId)=>{
  const c=characters.find(x=>x.id===characterId);if(!c)return;
  const files=[...e.target.files];const status=$("#avatarStatus-"+characterId);
  await uploadCharacterPhotos(c,files,status);e.target.value="";renderCharacters();
}
function fileDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||""));r.onerror=()=>reject(r.error||new Error("Не удалось прочитать файл"));r.readAsDataURL(file)})}
window.downloadMedia=(url,name="content-factory-file")=>{
  if(!url)return;
  const a=document.createElement("a");
  a.href="/api/media/download?account="+encodeURIComponent(activeAccountId)+"&url="+encodeURIComponent(url)+"&name="+encodeURIComponent(name);
  a.style.display="none";
  document.body.appendChild(a);a.click();a.remove();
};
window.deletePrevisFrame=async(runId,frameId,scene,frame)=>{
  if(!confirm("Удалить этот превиз-кадр? После изменения старые видео/монтаж этого запуска будут сброшены."))return;
  try{
    await runServerAction({runId,action:"delete_previs_frame",frameId,scene,frame});
    runStageOpen="Превиз-кадры";renderRunDetail();
  }catch(e){alert(String(e?.message||e))}
};
window.replacePrevisFrame=(runId,frameId,scene,frame)=>{
  const input=document.createElement("input");
  input.type="file";input.accept="image/*";
  input.onchange=async()=>{
    const file=input.files?.[0];if(!file)return;
    if(file.size>10*1024*1024){alert("Фото больше 10 МБ.");return}
    try{
      const dataBase64=await fileDataUrl(file);
      const resp=await fetch("/api/media/upload",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
        accountId:activeAccountId,productId:"previs-"+runId,fileName:file.name,mimeType:file.type||"image/jpeg",dataBase64
      })});
      const body=await resp.json().catch(()=>({}));
      if(!resp.ok||!body.media)throw new Error(body.detail||body.error||"Ошибка загрузки");
      await runServerAction({runId,action:"replace_previs_frame",frameId,scene,frame,media:body.media});
      runStageOpen="Превиз-кадры";renderRunDetail();
    }catch(e){alert(String(e?.message||e))}
  };
  input.click();
};
async function uploadPhotos(productId,fileList,statusEl=null){
  const p=prod(productId);if(!p)return {ok:0,failed:0};
  const files=[...fileList].filter(Boolean);
  p.media=Array.isArray(p.media)?p.media:[];
  let ok=0,failed=0;
  for(let i=0;i<files.length;i++){
    const file=files[i];
    if(!String(file.type||"").startsWith("image/")){failed++;continue}
    if(file.size>10*1024*1024){failed++;if(statusEl)statusEl.textContent='Фото «'+file.name+'» больше 10 МБ — пропущено.';continue}
    try{
      if(statusEl)statusEl.textContent='Загружаю фото '+(i+1)+' из '+files.length+'…';
      const dataBase64=await fileDataUrl(file);
      const resp=await fetch("/api/media/upload",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accountId:activeAccountId,productId,fileName:file.name,mimeType:file.type||"image/jpeg",dataBase64})});
      const body=await resp.json().catch(()=>({}));
      if(!resp.ok||!body.media)throw new Error(body.detail||body.error||"Ошибка загрузки");
      if(!p.media.length)body.media.isPrimary=true;
      p.media.push(body.media);p.productDNAFingerprint="";ok++;saveLocalState();renderAll();
    }catch(e){
      failed++;
      if(statusEl)statusEl.textContent='Не удалось загрузить «'+file.name+'»: '+String(e?.message||e);
    }
  }
  persist();
  if(statusEl)statusEl.textContent=failed?'Загружено: '+ok+'. Не удалось: '+failed+'.':'Готово. Загружено фото: '+ok+'.';
  return {ok,failed};
}
window.uploadExistingPhotos=async(e,productId)=>{const files=[...e.target.files];const status=$("#mediaStatus");await uploadPhotos(productId,files,status);e.target.value="";renderProductDetail()};
window.makePrimaryMedia=(productId,mediaId)=>{const p=prod(productId);if(!p)return;(p.media||[]).forEach(m=>m.isPrimary=m.id===mediaId);p.productDNAFingerprint="";log("Изменено главное фото",p.name);persist();renderProductDetail()};
window.deleteProductMedia=async(productId,mediaId)=>{const p=prod(productId);if(!p)return;const m=(p.media||[]).find(x=>x.id===mediaId);if(!m||!confirm("Удалить это фото?"))return;try{await fetch("/api/media/delete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accountId:activeAccountId,path:m.path})})}catch{};const wasPrimary=!!m.isPrimary;p.media=(p.media||[]).filter(x=>x.id!==mediaId);if(wasPrimary&&p.media[0])p.media[0].isPrimary=true;p.productDNAFingerprint="";log("Удалено фото товара",p.name);persist();renderProductDetail()}
async function deleteFactoryEntity(type,id,label="объект"){
  const messages={
    run:"Удалить этот процесс из списка? Если он сейчас выполняется, дальнейшая генерация будет остановлена. Уже созданные фото останутся в разделе «Фото», а видео — в разделе «Видео».",
    script:"Удалить этот сценарий из библиотеки?",
    campaign:"Удалить эту кампанию? Уже созданные ролики сохранятся.",
    character:"Удалить этого AI-аватара и его сохранённые фото?",
    videoAnalysis:"Удалить этот разбор видео?",
    journal:"Удалить эту запись журнала?",
    expense:"Удалить эту запись расхода?"
  };
  if(!confirm((messages[type]||"Удалить "+label+"?")+"\n\nДействие нельзя отменить."))return false;
  try{
    const r=await fetch("/api/entities/delete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accountId:activeAccountId,type,id,confirmed:true})});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data.detail||data.error||"Не удалось удалить");
    if(type==="run"&&selectedRunId===id){
      selectedRunId=runs.filter(x=>x.id!==id).at(-1)?.id||null;
      runStageOpen="";
    }
    if(type==="character"&&editingCharacterId===id){editingCharacterId=null;closeM("characterModal")}
    await syncFromServer();
    return true;
  }catch(e){alert(String(e?.message||e));return false}
}
window.deleteRun=async id=>{const wasCurrent=selectedRunId===id;const ok=await deleteFactoryEntity("run",id,"процесс");if(ok&&wasCurrent)go("generations");return ok};
window.deleteScript=id=>deleteFactoryEntity("script",id,"сценарий");
window.deleteCampaign=id=>deleteFactoryEntity("campaign",id,"кампанию");
window.deleteCharacter=id=>deleteFactoryEntity("character",id,"AI-аватара");
window.deleteVideoAnalysis=id=>deleteFactoryEntity("videoAnalysis",id,"разбор");
window.deleteJournalEntry=id=>deleteFactoryEntity("journal",id,"запись");

function rrow(r){return '<div class="run-row-wrap"><button class="run-row" onclick="openRun(\''+r.id+'\')"><span class="run-thumb">'+(prod(r.productId)?.icon||"◆")+'</span><span><b>'+esc(pname(r))+(r.variant?" · вариант "+r.variant:"")+'</b><small>'+esc(norm(r))+' · '+esc(r.created||"")+' · '+esc(r.style||"")+'</small><div class="progress"><i style="width:'+pct(r)+'%"></i></div></span><span class="status '+scl(r.status)+'">'+esc(r.status||"В работе")+'</span></button><button class="tiny-btn danger-mini run-delete-btn" onclick="deleteRun(\''+r.id+'\')">Удалить</button></div>'}
function task(r){return{id:r.id,title:norm(r)+" · "+pname(r),service:norm(r)==="Генерация"?"Higgsfield / Runway":norm(r)==="Озвучка"?"Озвучка":norm(r)==="Монтаж"?"Descript / монтаж":"Content Factory",progress:r.status==="Ошибка"?0:pct(r),state:r.status==="В работе"?"Выполняется":(r.status||"Черновик"),attempt:r.attempt||1,cost:r.cost||0}}
function taskHtml(t){return '<div class="task-row"><span class="task-icon">'+(t.state==="Ошибка"?"!":"⚙")+'</span><span><b>'+esc(t.title)+'</b><small>'+esc(t.service)+' · попытка '+t.attempt+'/'+(settings.budgetAttempts||3)+(t.cost?" · "+t.cost+" ₽":"")+'</small><div class="progress"><i style="width:'+t.progress+'%"></i></div></span><span class="status '+scl(t.state==="Выполняется"?"В работе":t.state)+'">'+t.state+'</span><button class="tiny-btn danger-mini" onclick="deleteRun(\''+t.id+'\')">Удалить</button></div>'}
function renderDashboard(){
const active=runs.filter(r=>r.status==="В работе").length,review=runs.filter(r=>r.status==="На проверке").length,ready=runs.filter(r=>r.status==="Готово").length,errors=runs.filter(r=>r.status==="Ошибка").length,pub=runs.filter(r=>norm(r)==="Опубликовано").length,cost=runs.reduce((s,r)=>s+(Number(r.cost)||0),0);
$("#dashboardStats").innerHTML=stat("⚙","В работе",active)+stat("◷","На проверке",review,"blue")+stat("✓","Готово",ready)+stat("!","Ошибки",errors,"warn")+stat("➤","Опубликовано",pub,"purple")+stat("₽","Расходы",cost+" ₽");
const a=runs.filter(r=>r.status==="Ошибка"||r.status==="На проверке"||r.status==="Ждёт пополнения").slice(-5).reverse(),ap=$("#attentionPanel");ap.classList.toggle("empty-attention",!a.length);ap.innerHTML='<div class="panel-title"><div><span class="mini-icon">'+(a.length?"!":"✓")+'</span><h2>Требует внимания</h2><p>'+(a.length?"Задачи, которые нельзя пропустить":"Критических задач нет")+'</p></div></div>'+(a.length?a.map(r=>{const total=Number(r.generationResult?.totalScenes||r.sceneCount||0),accepted=(r.acceptedScenes||[]).length,pending=Math.max(0,total-accepted),finalReady=!!r.montageResult?.url;let msg,label,handler;if(r.status==="Ждёт пополнения"){const p=r.providerBlock?.provider||"API";msg="Нужны API-кредиты · "+esc(p)+" · весь прогресс сохранён";label="Разобраться и продолжить";handler="openRun";}else if(r.status==="Ошибка"){const reason=String(r.error||"Ошибка процесса").replace(/^Автопилот:\s*/,"").slice(0,180);msg="Ошибка · "+esc(norm(r))+" · "+reason;label="Открыть";handler="openRun";}else if(finalReady){msg="Финальный ролик готов · AI-проверка: "+(r.qcResult?.passed===false?"есть замечания":"пройдена");label="Проверить финальный ролик";handler="openFinalReview";}else{msg=total?("Готово "+total+" сцен · принято "+accepted+"/"+total+(pending?" · проверить ещё "+pending:"")):"Ожидает твоего решения";label="Проверить сцены";handler="openRunReview";}return '<div class="attention-row"><span class="attention-icon">!</span><span><b>'+esc(pname(r))+'</b><small>'+esc(msg)+'</small></span><div class="attention-actions"><button class="secondary" onclick="'+handler+'(\''+r.id+'\')">'+label+'</button><button class="tiny-btn danger-mini" onclick="deleteRun(\''+r.id+'\')">Удалить</button></div></div>'}).join(""):'<div class="muted">Когда ролик зависнет, потребует проверки или превысит лимит — он появится здесь.</div>');
const cnt={};ST.forEach(x=>cnt[x]=0);runs.forEach(r=>cnt[norm(r)]=(cnt[norm(r)]||0)+1);$("#pipelineOverview").innerHTML=ST.slice(0,10).map((x,i)=>'<button class="pipeline-node '+((cnt[x]||0)?'has-items':'')+'" onclick="openProductionStage(\''+x+'\')"><small>'+x+'</small><b>'+(cnt[x]||0)+'</b><em>'+((cnt[x]||0)?"Открыть →":"Нет роликов")+'</em></button>').join("");
const at=runs.filter(r=>!["Готово","Запланировано","Опубликовано"].includes(r.status)).map(task).slice(-4).reverse();$("#backgroundMini").innerHTML=at.length?at.map(taskHtml).join(""):'<div class="empty">Фоновых задач пока нет.</div>';$("#bgBadge").textContent=runs.filter(r=>r.status==="В работе").length;
$("#homeProducts").innerHTML=products.slice(0,3).map(pcard).join("")||'<div class="empty">Добавь первый товар</div>';$("#latestRuns").innerHTML=runs.length?runs.slice(-5).reverse().map(rrow).join(""):'<div class="empty">Пока нет роликов.</div>';
const L=[["production","⌁","Производство","Конвейер"],["ideas","✦","Идеи","Создать и запустить"],["background","◷","Фоновые задачи","Все процессы"],["campaigns","◫","Кампании","Серии роликов"],["scripts","✎","Сценарии","Хуки и промты"],["photos","▧","Фото","Превизы и изображения"],["videos","▶","Видео","Сцены и готовые ролики"],["characters","◉","Персонажи","AI-блогеры"],["calendar","▦","Календарь","План публикаций"],["analytics","↗","Аналитика","Результаты"],["costs","₽","Расходы","Лимиты"],["journal","☷","Журнал","История"]];$("#sectionLinks").innerHTML=L.map(x=>'<button class="section-link" onclick="go(\''+x[0]+'\')"><b>'+x[1]+" "+x[2]+'</b><small>'+x[3]+'</small></button>').join("")
}
function ideaDetailsHtml(idea={}){
  const fields=[
    ["Аудитория",idea.audience],["Первые 3 секунды",idea.first3Seconds||idea.hook],
    ["Механика",idea.mechanic],["Роль товара",idea.productRole],["Удержание",idea.retention],
    ["Payoff",idea.payoff],["Угол",idea.angle],["CTA",idea.ctaDirection],
    ["Production",idea.production],["Почему работает",idea.why]
  ].filter(x=>String(x[1]||"").trim());
  const q=idea.quality&&typeof idea.quality==="object"?idea.quality:{};
  const qKeys=[["hook","Хук"],["retention","Удержание"],["nativeTikTok","TikTok"],["proofVariety","Proof"],["shareability","Share"],["originality","Оригинальность"],["generatability","AI"],["overall","Итог"]];
  return '<details class="saved-idea-details"><summary>Все детали идеи</summary><div class="saved-idea-detail-grid">'+fields.map(x=>'<div><small>'+esc(x[0])+'</small><p>'+esc(x[1])+'</p></div>').join("")+'</div>'+(Object.keys(q).length?'<div class="saved-idea-scores">'+qKeys.filter(x=>q[x[0]]!=null).map(x=>'<span>'+esc(x[1])+' <b>'+esc(q[x[0]])+'/10</b></span>').join("")+'</div>':'')+'</details>';
}
function renderIdeas(){
  const list=$("#ideaList");if(!list)return;
  const items=savedIdeas.slice().reverse();
  if(!items.length){
    const legacy=runs.filter(r=>r.idea).slice().reverse();
    list.innerHTML=legacy.length?legacy.map(r=>{
      const idea=r.idea||{};
      return '<article class="idea-card"><div><span class="kicker">РОЛИК · ИДЕЯ</span><h3>'+esc(idea.title||pname(r))+'</h3><p>'+esc(idea.concept||"")+'</p><div class="idea-hook"><b>Первые 3 секунды</b><span>'+esc(idea.first3Seconds||idea.hook||"—")+'</span></div>'+ideaDetailsHtml(idea)+'</div><div class="idea-actions"><button class="secondary" onclick="openStageDetail(\''+r.id+'\',\'Идея\')">Открыть</button><button class="btn primary" onclick="runAction(\''+r.id+'\',\'advance_stage\')">▶ В сценарий</button></div></article>';
    }).join(""):'<div class="empty">Идей пока нет. Выбери товар и нажми «Сгенерировать идею».</div>';
    return;
  }
  list.innerHTML='<div class="saved-ideas-head"><div><span class="kicker">БИБЛИОТЕКА</span><h2>Сохранённые идеи</h2><p>Идеи хранятся отдельно от процессов и не удаляются вместе с роликом.</p></div><b>'+items.length+'</b></div>'+
    items.map(x=>{
      const idea=x.idea||{},source=runs.find(r=>r.id===x.sourceRunId);
      return '<article class="idea-card saved-idea-card '+(x.selected?'selected':'')+'"><div><span class="kicker">ВАРИАНТ '+esc(x.index||"")+(x.selected?' · ВЫБРАН':'')+'</span><h3>'+esc(idea.title||x.productName||"Идея")+'</h3><p>'+esc(idea.concept||"")+'</p><div class="idea-hook"><b>Хук</b><span>'+esc(idea.first3Seconds||idea.hook||"—")+'</span></div>'+ideaDetailsHtml(idea)+'<small class="saved-idea-product">'+esc(x.productName||"")+'</small></div><div class="idea-actions">'+(source?'<button class="secondary" onclick="openStageDetail(\''+source.id+'\',\'Идея\')">Открыть исходный процесс</button>':'')+'<button class="btn primary" onclick="launchSavedIdea(\''+esc(x.id)+'\')">▶ Запустить эту идею</button><button class="danger-btn" onclick="deleteSavedIdea(\''+esc(x.id)+'\')">Удалить идею</button></div></article>';
    }).join("");
}

$("#generateIdeaBtn")?.addEventListener("click",async()=>{
  const btn=$("#generateIdeaBtn"),status=$("#ideaStatus");btn.disabled=true;status.textContent="Ищу 10 разных механик, дважды проверяю и докручиваю идею…";
  try{
    const r=await fetch("/api/ideas/generate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      accountId:activeAccountId,productId:$("#ideaProduct")?.value||"",style:$("#ideaStyle")?.value||"UGC",brief:$("#ideaBrief")?.value.trim()||""
    })});
    const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.detail||data.error||"Ошибка");
    await syncFromServer();selectedRunId=data.run?.id||selectedRunId;status.textContent="Идея готова.";
  }catch(e){status.textContent=String(e?.message||e)}finally{btn.disabled=false}
});
function storyboardCompleteUi(r){
  const required=["title","duration","purpose","shot","framing","camera","lens","angle","cameraHeight","focus","depth","motionTiming","environment","setDesign","foreground","midground","background","props","materials","colorPalette","lighting","practicalLights","characters","performance","blocking","product","action","startFrame","endFrame","continuity","retentionMechanic","patternInterrupt","microPayoff","sound","soundDesign","transition","editorNote","negative","promptEn"];
  const board=Array.isArray(r?.storyboard)?r.storyboard:[];
  const expected=Array.isArray(r?.script?.scenes)?r.script.scenes.length:board.length;
  return !!(board.length&&board.length===expected&&board.every(s=>required.every(k=>String(s?.[k]||"").trim())));
}
function previsEndpointFrames(list=[]){
  const arr=Array.isArray(list)?list:[];
  const byScene=new Map();
  arr.forEach(x=>{
    const scene=Number(x?.scene)||0;
    if(!scene)return;
    if(!byScene.has(scene))byScene.set(scene,[]);
    byScene.get(scene).push(x);
  });
  const out=[];
  [...byScene.keys()].sort((a,b)=>a-b).forEach(scene=>{
    const items=byScene.get(scene).slice().sort((a,b)=>Number(a?.frame||0)-Number(b?.frame||0));
    const start=items.find(x=>String(x?.frameType||'').toLowerCase()==='start')||items[0];
    const end=items.find(x=>String(x?.frameType||'').toLowerCase()==='end')||items[items.length-1];
    if(start)out.push(start);
    if(end&&end!==start)out.push(end);
  });
  return out;
}
function previsExpectedTotal(r){
  const board=Array.isArray(r?.storyboard)?r.storyboard:[];
  if(board.length)return board.length*2;
  const plan=previsEndpointFrames(r?.previsPlan?.frames||[]);
  return plan.length||10;
}
function previsReadyCount(r){
  return previsEndpointFrames((Array.isArray(r?.previsFrames)?r.previsFrames:[]).filter(x=>x?.url)).length;
}
function productionStageDone(r,k){
  if(k==="Идея")return !!r.idea;
  if(k==="Сценарий")return !!r.script;
  if(k==="Storyboard")return storyboardCompleteUi(r);
  if(k==="Превиз-кадры"){const total=previsExpectedTotal(r),ready=previsReadyCount(r);return !!(r.previsResult?.completed&&total&&ready>=total)}
  if(k==="Генерация"){const total=Number(r.generationResult?.totalScenes||r.sceneCount||0);const ready=(r.generationResult?.urls||[]).filter(Boolean).length;return !!(r.generationResult?.completed&&total&&ready>=total)}
  if(k==="Озвучка")return !!r.voiceoverResult;
  if(k==="Монтаж")return !!r.montageResult;
  if(k==="AI-проверка")return !!r.qcResult;
  if(k==="Проверка")return r.stage==="На проверке"||["Готово","Запланировано","Опубликовано"].includes(r.status);
  if(k==="Готово")return ["Готово","Запланировано","Опубликовано"].includes(r.status);
  return false;
}
window.openProductionStage=(stage)=>{
  const map={Проверка:"На проверке"};
  const target=map[stage]||stage;
  const candidates=runs.filter(r=>r.status!=="Остановлено"&&(productionStageDone(r,stage)||norm(r)===target)).slice().reverse();
  const r=candidates[0];
  if(!r)return;
  selectedRunId=r.id;
  if(stage==="Проверка"){openRunReview(r.id);return}
  runStageOpen=target;
  renderRunDetail();
  go("runDetail");
  setTimeout(()=>document.getElementById("stageReport")?.scrollIntoView({behavior:"smooth",block:"start"}),80);
};
function renderProduction(){
  const K=["Идея","Сценарий","Storyboard","Превиз-кадры","Генерация","Озвучка","Монтаж","AI-проверка","Проверка","Готово"];
  const liveRuns=runs.filter(r=>r.status!=="Остановлено");
  const steps=K.map((k,i)=>{
    const done=liveRuns.filter(r=>productionStageDone(r,k)).length;
    const current=liveRuns.filter(r=>norm(r)===(k==="Проверка"?"На проверке":k)).length;
    return '<button class="production-step '+(current?'is-current':done?'is-complete':'is-upcoming')+'" onclick="openProductionStage(\''+k+'\')"><span class="production-step-num">'+(done&&!current?'✓':i+1)+'</span><span class="production-step-copy"><b>'+k+'</b><small>'+(i<K.length-1?'Шаг '+(i+1)+' из '+K.length:'Финиш')+'</small></span><span class="production-step-stats"><strong>'+done+'</strong><small>готово'+(current?' · сейчас '+current:'')+'</small></span></button>';
  }).join("");
  const active=liveRuns.slice().reverse().filter(r=>!["Готово","Запланировано","Опубликовано"].includes(r.status));
  const cards=active.length?active.map(r=>{
    const artifactCount=K.filter(k=>productionStageDone(r,k)).length;
    return '<div class="production-run-wrap"><button class="production-run-card" onclick="openRun(\''+r.id+'\')"><span><b>'+esc(pname(r))+'</b><small>Сейчас: '+esc(norm(r))+' · '+artifactCount+'/'+K.length+' этапов с результатом</small></span><span class="status '+scl(r.status)+'">'+esc(r.status||"В работе")+'</span></button><button class="tiny-btn danger-mini" onclick="deleteRun(\''+r.id+'\')">Удалить</button></div>';
  }).join(""):'<div class="empty compact-empty">Активных роликов нет.</div>';
  $("#kanban").innerHTML='<section class="production-flow"><div class="production-flow-head"><div><span class="kicker">ПОРЯДОК</span><h2>Этапы производства</h2><p>Выбери этап, чтобы открыть результат. Бирюзовым отмечены текущие этапы.</p></div></div><div class="production-steps">'+steps+'</div></section><section class="production-active"><div class="production-flow-head"><div><span class="kicker">РОЛИКИ</span><h2>Что сейчас происходит</h2></div></div><div class="production-run-list">'+cards+'</div></section>';
}
function renderBackground(){const a=runs.map(task).reverse();$("#backgroundTasks").innerHTML=a.length?a.map(taskHtml).join(""):'<div class="empty">Задач пока нет.</div>'}
$("#retryFailed").onclick=()=>{let n=0;runs.forEach(r=>{if(r.status==="Ошибка"){r.status="В работе";r.attempt=(r.attempt||1)+1;n++}});if(n)log("Повтор неудачных задач","Перезапущено: "+n);persist()};
function renderProducts(){$("#productsGrid").innerHTML=products.length?products.map(p=>'<article class="catalog-card">'+productThumb(p)+'<h3>'+esc(p.name)+'</h3><p>'+esc(p.category||"Товар")+'</p><div class="catalog-actions"><button class="btn primary" onclick="openCreate(\''+p.id+'\')">Создать ролик</button><button class="secondary" onclick="openProduct(\''+p.id+'\')">Паспорт</button><button class="danger-btn" onclick="deleteProduct(\''+p.id+'\')">Удалить</button></div></article>').join(""):'<div class="empty">Товаров пока нет.</div>'}
window.deleteProduct=async id=>{const p=prod(id);if(!p||!confirm('Удалить товар «'+p.name+'»?'))return;const all=confirm("Удалить также все ролики и историю этого товара?\n\nOK — удалить всё\nОтмена — сохранить историю роликов");for(const m of (p.media||[])){try{await fetch("/api/media/delete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accountId:activeAccountId,path:m.path})})}catch{}}if(!all)runs.forEach(r=>{if(r.productId===id)r.productName=p.name});products=products.filter(x=>x.id!==id);if(all)runs=runs.filter(r=>r.productId!==id);campaigns=campaigns.filter(c=>c.productId!==id);selectedProductId=products[0]?.id||null;log("Удалён товар",p.name+(all?" вместе с историей":" — история сохранена"));persist();go("products")};
function mediaGallery(p){const media=Array.isArray(p.media)?p.media:[];return '<div class="media-toolbar"><div><b>Фотографии товара</b><small>Фото задают identity товара: форму, цвет и детали. После первых превиз-кадров основой становятся уже сгенерированные кадры.</small></div><input id="mediaUploadInput" type="file" accept="image/*" multiple hidden onchange="uploadExistingPhotos(event,\''+p.id+'\')"><button class="btn primary" onclick="document.getElementById(\'mediaUploadInput\').click()">＋ Добавить фото</button></div><div id="mediaStatus" class="message"></div>'+(media.length?'<div class="media-grid">'+media.map(m=>'<article class="media-card '+(m.isPrimary?"primary-media":"")+'"><div class="media-image"><img src="'+esc(m.url)+'" alt="'+esc(p.name)+'">'+(m.isPrimary?'<span class="media-primary-badge">Главное</span>':'')+'</div><div class="media-file">'+esc(m.fileName||"Фото")+'</div><div class="media-actions">'+(!m.isPrimary?'<button class="tiny-btn" onclick="makePrimaryMedia(\''+p.id+'\',\''+m.id+'\')">★ Главное</button>':'<span class="tiny-ok">★ Эталон</span>')+'<button class="tiny-btn" onclick="downloadMedia(\''+esc(m.url)+'\',\''+esc(m.fileName||"product-photo.jpg")+'\')">↓ Скачать</button><button class="tiny-btn danger-mini" onclick="deleteProductMedia(\''+p.id+'\',\''+m.id+'\')">Удалить</button></div></article>').join("")+'</div>':'<div class="media-empty"><span>▧</span><b>Фото ещё нет</b><small>Добавь реальные фотографии товара с нескольких ракурсов.</small><button class="secondary" onclick="document.getElementById(\'mediaUploadInput\').click()">Выбрать фото</button></div>')}
function renderProductDetail(){const p=prod(selectedProductId)||products[0];if(!p){$("#productDetailBody").innerHTML='<div class="empty">Добавь первый товар.</div>';return}const rr=runs.filter(r=>r.productId===p.id).reverse();$("#productDetailBody").innerHTML='<section class="panel detail-hero">'+productThumb(p)+'<div><span class="kicker">ПАСПОРТ ТОВАРА</span><h1>'+esc(p.name)+'</h1><p class="muted">'+esc(p.category||"Товар")+'</p><div class="detail-chips"><span class="chip">Фото: '+((p.media||[]).length)+'</span><span class="chip">Роликов: '+rr.length+'</span><span class="chip">Кампаний: '+campaigns.filter(c=>c.productId===p.id).length+'</span></div><div class="catalog-actions"><button class="btn primary" onclick="openCreate(\''+p.id+'\')">＋ Создать ролик</button><button class="secondary" onclick="openProductEditor(\''+p.id+'\')">✎ Редактировать</button><button class="danger-btn" onclick="deleteProduct(\''+p.id+'\')">Удалить</button></div></div></section><section class="panel"><div class="panel-title"><div><span class="mini-icon">▧</span><h2>Медиа товара</h2><p>Оригинальные фото становятся эталонами для генерации</p></div></div>'+mediaGallery(p)+'</section><section class="panel"><div class="panel-title"><div><span class="mini-icon">▣</span><h2>Паспорт</h2><p>Что система обязана помнить</p></div></div><div class="passport-grid"><div class="passport-block"><h3>УТП</h3><p>'+esc(p.utp||"Не заполнено")+'</p></div><div class="passport-block"><h3>Мастер-стиль</h3><p>'+esc(p.masterStyle||"Не выбран")+'</p></div><div class="passport-block"><h3>Защита товара</h3><div class="lock-list">'+String(p.rules||"Не менять реальный внешний вид товара.").split(/\n|\./).filter(Boolean).map(x=>'<div class="lock-row"><span>🔒</span><div>'+esc(x.trim())+'</div></div>').join("")+'</div></div><div class="passport-block"><h3>Product DNA</h3><p>'+(p.productDNA?esc(p.productDNA.summary||p.productDNA.geometry||"Product DNA создан"):"Будет автоматически создан из исходных фото при следующем запуске.")+'</p>'+(p.productDNA?.prohibitedChanges?.length?'<div class="lock-list">'+p.productDNA.prohibitedChanges.slice(0,8).map(x=>'<div class="lock-row"><span>◆</span><div>'+esc(x)+'</div></div>').join("")+'</div>':'')+'</div><div class="passport-block"><h3>AI-аватар товара</h3><select onchange="setProductDefaultCharacter(\''+p.id+'\',this.value)">'+characterOptions(p.defaultCharacterId||"","Без привязки")+'</select><p>'+(productCharacter(p)?'По умолчанию идеи, сценарии, storyboard, превиз, видео и озвучка создаются под аватара «'+esc(productCharacter(p).name)+'». Старые запуски сохраняют свой снимок аватара.':'Аватар не привязан. При запуске можно выбрать его вручную.')+'</p></div><div class="passport-block"><h3>AI-identity</h3><p>'+(primaryMedia(p)?"Фото товара закреплены как контроль внешности. Они не должны быть главным anchor каждого кадра.":"Добавь фото товара, чтобы AI понимал его реальный внешний вид.")+'</p></div></div></section><section class="panel"><div class="panel-title"><div><span class="mini-icon">⌁</span><h2>История производства</h2></div></div><div class="runs-list">'+(rr.length?rr.slice(0,8).map(rrow).join(""):'<div class="empty">Роликов ещё нет.</div>')+'</div></section>';enhanceProductDetail();polishActionMenus(document.getElementById("productDetailBody"))}
window.openProduct=id=>{selectedProductId=id;renderProductDetail();go("productDetail")};
function resetProductModal(){
  editingProductId=null;
  opts();
  ["newProductName","newProductCategory","newProductUtp","newProductRules"].forEach(id=>{const el=$("#"+id);if(el)el.value=""});
  if($("#newProductCharacter"))$("#newProductCharacter").value="";
  if($("#newProductImages"))$("#newProductImages").value="";
  const modal=$("#productModal");
  if(modal){
    const kicker=modal.querySelector(".kicker"),title=modal.querySelector("h2");
    if(kicker)kicker.textContent="НОВЫЙ ТОВАР";
    if(title)title.textContent="Добавить товар";
  }
  if($("#saveProduct"))$("#saveProduct").textContent="Сохранить товар";
  if($("#newProductImagesHint"))$("#newProductImagesHint").textContent="Можно выбрать сразу несколько фото. Первое станет главным.";
  if($("#saveProductMsg"))$("#saveProductMsg").textContent="";
}
$("#addProduct").onclick=()=>{resetProductModal();openM("productModal")};

window.openProductEditor=id=>{
  const p=prod(id);if(!p)return;
  editingProductId=p.id;
  opts();
  $("#newProductName").value=p.name||"";
  $("#newProductCategory").value=p.category||"";
  $("#newProductUtp").value=p.utp||"";
  $("#newProductRules").value=p.rules||"";
  if($("#newProductCharacter"))$("#newProductCharacter").value=p.defaultCharacterId||"";
  if($("#newProductImages"))$("#newProductImages").value="";
  const modal=$("#productModal");
  if(modal){
    const kicker=modal.querySelector(".kicker"),title=modal.querySelector("h2");
    if(kicker)kicker.textContent="РЕДАКТИРОВАНИЕ ТОВАРА";
    if(title)title.textContent="Редактировать товар";
  }
  if($("#saveProduct"))$("#saveProduct").textContent="Сохранить изменения";
  if($("#newProductImagesHint"))$("#newProductImagesHint").textContent=(p.media||[]).length
    ?'Сейчас сохранено фото: '+(p.media||[]).length+'. Новые фото добавятся к существующим. Удалить или назначить главное фото можно в карточке товара.'
    :'Новые фото добавятся к товару. Первое станет главным.';
  if($("#saveProductMsg"))$("#saveProductMsg").textContent="";
  openM("productModal");
};

$("#saveProduct").onclick=async()=>{
  const n=$("#newProductName").value.trim();
  const msg=$("#saveProductMsg"),btn=$("#saveProduct");
  if(!n){if(msg)msg.textContent="Укажи название товара.";return}
  const files=[...($("#newProductImages")?.files||[])];
  btn.disabled=true;
  beginLocalMutation();
  try{
    const existing=editingProductId?prod(editingProductId):null;
    const p=existing||{
      id:uid("p"),icon:"◆",tag:"Новый",masterStyle:"Не выбран",media:[],created:now()
    };
    const oldName=p.name||n;
    p.name=n;
    p.category=$("#newProductCategory").value.trim()||"Товар";
    p.utp=$("#newProductUtp").value.trim();
    p.rules=$("#newProductRules").value.trim();
    p.productDNAFingerprint="";
    p.defaultCharacterId=$("#newProductCharacter")?.value||null;
    p.media=Array.isArray(p.media)?p.media:[];
    p.updatedAt=new Date().toISOString();

    if(!existing){
      products.push(p);
      log("Добавлен товар",n);
    }else{
      log("Изменён товар",oldName+(oldName!==n?" → "+n:""));
    }
    selectedProductId=p.id;
    saveLocalState();
    renderAll();

    if(files.length){
      msg.textContent=existing?"Сохраняю изменения и загружаю новые фото…":"Сохраняю товар и фотографии…";
      await uploadPhotos(p.id,files,msg);
    }else{
      msg.textContent=existing?"Сохраняю изменения…":"Сохраняю товар…";
    }

    saveLocalState();
    renderAll();
    clearTimeout(syncTimer);
    const saved=await pushState();
    if(!saved)throw new Error("Не удалось сохранить изменения товара на сервере");

    if($("#newProductImages"))$("#newProductImages").value="";
    msg.textContent=existing?"Изменения товара сохранены.":files.length?"Товар и фотографии сохранены.":"Товар сохранён.";
    const productId=p.id;
    editingProductId=null;
    setTimeout(()=>{closeM("productModal");openProduct(productId)},350);
  }catch(e){
    if(msg)msg.textContent="Ошибка сохранения: "+String(e?.message||e);
  }finally{
    finishLocalMutation();
    btn.disabled=false;
    if(localMutationDepth===0&&deferredServerSync)setTimeout(()=>syncFromServer(),0);
  }
};

function renderCampaigns(){$("#campaignGrid").innerHTML=campaigns.length?campaigns.map(c=>{const made=runs.filter(r=>r.campaignId===c.id).length,pc=Math.round(made/Math.max(1,c.target)*100),spent=runs.filter(r=>r.campaignId===c.id).reduce((s,r)=>s+(Number(r.cost)||0),0);return '<article class="campaign-card"><span class="kicker">КАМПАНИЯ</span><h3>'+esc(c.name)+'</h3><p>'+esc(prod(c.productId)?.name||"Товар удалён")+'</p><div class="campaign-meta"><span class="chip">'+made+"/"+c.target+' роликов</span><span class="chip">'+c.budget+' ₽</span></div><div class="campaign-progress"><div class="progress"><i style="width:'+Math.min(100,pc)+'%"></i></div><div class="campaign-budget"><span>Прогресс '+pc+'%</span><span>Потрачено '+spent+' ₽</span></div></div><div class="catalog-actions"><button class="btn primary" onclick="openCreate(\''+c.productId+'\')">Добавить ролики</button><button class="danger-btn" onclick="deleteCampaign(\''+c.id+'\')">Удалить</button></div></article>'}).join(""):'<div class="empty">Кампаний пока нет.</div>'}
$("#addCampaign").onclick=()=>{opts();openM("campaignModal")};$("#saveCampaign").onclick=()=>{const n=$("#campaignName").value.trim();if(!n)return;campaigns.push({id:uid("c"),name:n,productId:$("#campaignProduct").value,target:Number($("#campaignTarget").value)||30,budget:Number($("#campaignBudget").value)||5000,mix:$("#campaignMix").value.trim(),created:now()});log("Создана кампания",n);closeM("campaignModal");persist()};
function renderRuns(){$("#runsTable").innerHTML=runs.length?runs.slice().reverse().map(rrow).join(""):'<div class="empty"><h3>Пока нет роликов</h3><p>Запусти первый ролик.</p></div>'}
window.openRun=id=>{selectedRunId=id;renderRunDetail();go("runDetail")};
window.openRunReview=id=>{selectedRunId=id;runStageOpen="";renderRunDetail();go("runDetail");setTimeout(()=>document.getElementById("sceneReviewPanel")?.scrollIntoView({behavior:"smooth",block:"start"}),80)};
window.openFinalReview=id=>{selectedRunId=id;runStageOpen="";renderRunDetail();go("runDetail");setTimeout(()=>document.getElementById("finalReviewPanel")?.scrollIntoView({behavior:"smooth",block:"start"}),80)};
function stageDone(r,stage){
  if(stage==="Идея")return !!r.idea;
  if(stage==="Сценарий")return !!r.script;
  if(stage==="Storyboard")return storyboardCompleteUi(r);
  if(stage==="Превиз-кадры"){const total=previsExpectedTotal(r),ready=previsReadyCount(r);return !!(r.previsResult?.completed&&total&&ready>=total)}
  if(stage==="Генерация"){const total=Number(r.generationResult?.totalScenes||r.sceneCount||0);const ready=(r.generationResult?.urls||[]).filter(Boolean).length;return !!(r.generationResult?.completed&&total&&ready>=total)}
  if(stage==="Озвучка")return !!r.voiceoverResult;
  if(stage==="Монтаж")return !!r.montageResult;
  if(stage==="AI-проверка")return !!r.qcResult;
  if(stage==="На проверке")return r.stage==="На проверке"||["Готово","Запланировано","Опубликовано"].includes(r.status);
  if(stage==="Готово")return ["Готово","Запланировано","Опубликовано"].includes(r.status);
  if(stage==="Запланировано")return ["Запланировано","Опубликовано"].includes(r.status);
  if(stage==="Опубликовано")return r.status==="Опубликовано";
  return false;
}
function readiness(r){
  const previsTotal=previsExpectedTotal(r);
  return [["Сценарий",r.script?1:0,1],["Storyboard",Array.isArray(r.storyboard)&&r.storyboard.length?1:0,1],["Превиз",previsReadyCount(r),previsTotal],["AI-видео",r.generationResult?1:0,1],["Озвучка",r.voiceoverResult?1:0,1],["Монтаж",r.montageResult?1:0,1]];
}
function sceneResultUrl(r,index){
  const urls=r.generationResult?.urls||[];
  return urls[index]||r.sceneResults?.[index+1]?.url||null;
}
function scenes(r){
  const board=Array.isArray(r.storyboard)&&r.storyboard.length?r.storyboard:Array.from({length:r.sceneCount||5},(_,i)=>({scene:i+1,title:i===0?"Хук":i===1?"Проблема":i===2?"Демонстрация":i===4?"CTA":"Результат",duration:(i*5)+"–"+((i+1)*5)+" сек",shot:"",action:"",voiceover:"",onscreen:"",prompt:""}));
  return board.map((sc,i)=>{
    const n=i+1,a=(r.acceptedScenes||[]).includes(n),v=(r.sceneVersions?.[n]||1),url=sceneResultUrl(r,i);
    const preview=url?'<video controls playsinline preload="metadata" src="'+esc(url)+'"></video>':'<div class="scene-preview-copy"><b>Сцена '+n+'</b><span>'+esc(sc.title||"")+'</span></div>';
    const route=r.sceneRouting?.[n]||null,routeLabel=route?(route.provider==="seedance"?"Seedance 2.5":"Runway"):(r.modelMode||"Авто");
    const routeMeta=route?(" · "+esc(route.complexity||"")+" / "+esc(route.risk||"")):"";
    return '<article class="scene-card"><div class="scene-preview">'+preview+'</div><h3>'+n+'. '+esc(sc.title||"Сцена")+'</h3><small>'+esc(sc.duration||"")+' · '+esc(routeLabel)+routeMeta+'</small><div class="scene-copy">'+(sc.framing||sc.camera?'<p><b>Камера:</b> '+esc([sc.framing,sc.camera].filter(Boolean).join(" · "))+'</p>':'')+(sc.shot?'<p><b>Кадр:</b> '+esc(sc.shot)+'</p>':'')+(sc.action?'<p><b>Действие:</b> '+esc(sc.action)+'</p>':'')+(sc.voiceover?'<p><b>Озвучка:</b> '+esc(sc.voiceover)+'</p>':'')+(sc.onscreen?'<p><b>Текст:</b> '+esc(sc.onscreen)+'</p>':'')+((sc.promptEn||sc.prompt)?'<details><summary>Prompt</summary><p>'+esc(sc.promptEn||sc.prompt)+'</p></details>':'')+'</div><div class="version-row">'+Array.from({length:v},(_,q)=>'<span class="version '+(q===v-1&&a?"ok":"")+'">V'+(q+1)+(q===v-1&&a?" ✓":"")+'</span>').join("")+'</div><div class="scene-actions">'+(a?'<button class="tiny-btn scene-accepted-btn" disabled>✓ Принята</button>':'<button class="tiny-btn" data-accept-scene="'+n+'" onclick="acceptScene(\''+r.id+'\','+n+',this)">✓ Принять</button>')+'<button class="tiny-btn" onclick="regenScene(\''+r.id+'\','+n+')">↻ Переделать</button><button class="tiny-btn" onclick="promptScene(\''+r.id+'\','+n+')">✎ Промт</button><button class="tiny-btn" onclick="modelScene(\''+r.id+'\','+n+')">◉ Модель</button>'+(url?'<button class="tiny-btn danger-mini" onclick="deleteSceneVideo(\''+r.id+'\','+n+')">Удалить видео</button>':'')+'</div></article>';
  }).join("");
}
let runStageOpen="";
function stageReportHtml(r,stage){
  const idea=r.idea||{},script=r.script||{},refs=r.references||{},board=Array.isArray(r.storyboard)?r.storyboard:[];
  let body='';
  if(stage==="Идея"){
    const alternatives=Array.isArray(idea.alternatives)?idea.alternatives:[];
    const hookLab=idea.hookLab&&typeof idea.hookLab==="object"?idea.hookLab:{variants:[]};
    const hookVariants=Array.isArray(hookLab.variants)?hookLab.variants:[];
    body='<div class="idea-master-report">'+
      '<div class="idea-master-hero"><div class="idea-selected-head"><span class="kicker">ВЫБРАННАЯ ИДЕЯ</span><span class="idea-selected-badge">✓ Активна</span></div><h3>'+esc(idea.title||"Идея ещё не создана")+'</h3><p>'+esc(idea.concept||"")+'</p><div class="idea-master-actions"><button class="secondary" onclick="launchIdeaOption(\''+r.id+'\',1)">▶ Запустить копию отдельно</button></div></div>'+
      '<div class="idea-master-grid">'+
        '<div><small>Целевая аудитория</small><p>'+esc(idea.audience||"—")+'</p></div>'+
        '<div><small>Хук</small><p>'+esc(idea.hook||"—")+'</p></div>'+
        '<div><small>Первые 3 секунды</small><p>'+esc(idea.first3Seconds||"—")+'</p></div>'+
        '<div><small>Механика</small><p>'+esc(idea.mechanic||"—")+'</p></div>'+
        '<div><small>Роль товара</small><p>'+esc(idea.productRole||"—")+'</p></div>'+
        '<div><small>Что удерживает</small><p>'+esc(idea.retention||"—")+'</p></div>'+
        '<div><small>Финальный payoff</small><p>'+esc(idea.payoff||"—")+'</p></div>'+
        '<div><small>Угол подачи</small><p>'+esc(idea.angle||"—")+'</p></div>'+
        '<div><small>CTA</small><p>'+esc(idea.ctaDirection||"—")+'</p></div>'+
        '<div><small>Сложность</small><p>'+esc(idea.production||"—")+'</p></div>'+
      '</div>'+
      '<div class="idea-why"><small>Почему эта идея выбрана</small><p>'+esc(idea.why||"—")+'</p></div>'+
      (hookVariants.length?'<div class="idea-alt-wrap"><div class="idea-alt-head"><div><h3>🔥 Hook Lab</h3><p>5 разных первых 3 секунд до дорогой генерации.</p></div><span>выбран №'+esc(String(hookLab.selectedIndex||1))+'</span></div><div class="idea-alt-list">'+hookVariants.map((h,i)=>'<article class="'+((i+1)===Number(hookLab.selectedIndex||1)?"selected":"")+'"><span>'+String(i+1)+'</span><div class="idea-alt-copy">'+(h.previewUrl?'<div class="hook-preview"><img src="'+esc(h.previewUrl)+'" alt="Hook '+String(i+1)+'"><button class="tiny-btn" onclick="downloadMedia(\''+esc(h.previewUrl)+'\',\'hook-'+String(i+1)+'.png\')">↓ Скачать</button></div>':'')+'<b>'+esc(h.type||"Hook")+'</b><small>'+esc(h.firstFrame||"")+'</small><p>'+esc([h.action,h.line,h.audio,h.openLoop].filter(Boolean).join(" · "))+'</p><small>'+esc(h.why||"")+'</small></div></article>').join("")+'</div><div class="idea-why"><small>Почему выбран этот хук</small><p>'+esc(hookLab.selectionReason||"—")+'</p></div></div>':'')+
      (alternatives.length?'<div class="idea-alt-wrap"><div class="idea-alt-head"><div><h3>Другие сохранённые идеи</h3><p>Все варианты полноценные и сохраняются отдельно.</p></div><span>'+alternatives.length+' варианта</span></div><div class="idea-alt-list">'+alternatives.map((x,i)=>'<article><span>'+String(i+1)+'</span><div class="idea-alt-copy"><b>'+esc(x.title||"Вариант")+'</b><small>'+esc(x.hook||"")+'</small><p>'+esc(x.concept||"")+'</p>'+ideaDetailsHtml(x)+'<div class="idea-alt-actions"><button class="btn primary" onclick="selectIdeaOption(\''+r.id+'\','+(i+2)+')">✓ Выбрать эту идею</button><button class="secondary" onclick="launchIdeaOption(\''+r.id+'\','+(i+2)+')">▶ Запустить отдельно</button></div></div></article>').join("")+'</div></div>':'')+
    '</div>';
  }
  else if(stage==="Сценарий"){
    const scriptScenes=Array.isArray(script.scenes)&&script.scenes.length?script.scenes:board.map((x,i)=>({
      scene:i+1,time:x.duration||"",purpose:"",visual:x.shot||"",action:x.action||"",
      dialogue:"",voiceover:x.voiceover||"",onscreen:x.onscreen||"",sound:x.sound||"",
      transition:"",continuity:"",productRole:""
    }));
    const quality=script.quality&&typeof script.quality==="object"?script.quality:{};
    const review=script.reviewProcess&&typeof script.reviewProcess==="object"?script.reviewProcess:null;
    const qualityFields=[
      ["scrollStop","Scroll-stop"],["curiosityGap","Интрига"],["retention","Удержание"],
      ["pacing","Темп"],["nativeTikTok","TikTok-native"],["dialogueNaturalness","Речь"],
      ["hookSpecificity","Хук"],["beatVariety","Разнообразие beats"],["proofVariety","Разные proof"],
      ["speechEconomy","Лаконичность"],["productIntegration","Товар"],["audioPlan","Звук"],
      ["generatability","AI-генерация"],["payoff","Payoff"],["sceneDensity","Плотность"],
      ["patternInterruptQuality","Pattern interrupts"],["environmentSpecificity","Среда"],["visualContrast","Контраст"],["microPayoffCadence","Micro-payoff"],["overall","Итог"]
    ];
    const qualityHtml=Object.keys(quality).length
      ?'<div class="script-quality-panel"><div class="script-quality-head"><div><small>AI SCRIPT DOCTOR</small><b>'+esc(review?.passes||1)+' проверки + автодокрутка</b></div><span class="status '+(review?.passed===false?"work":"done")+'">'+(review?.passed===false?"Есть замечания":"Проверено")+'</span></div><div class="script-quality-grid">'+qualityFields.filter(([k])=>quality[k]!=null).map(([k,label])=>'<div class="'+(Number(quality[k])>=8?"good":"warn")+'"><span>'+esc(label)+'</span><b>'+esc(quality[k])+'/10</b></div>').join("")+'</div>'+(review?.finalChanges?.length?'<details class="script-review-details"><summary>Что AI докрутил</summary><ul>'+review.finalChanges.map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul></details>':'')+'</div>'
      :'';
    const tableHtml=scriptScenes.length?'<div class="script-table-wrap script-desktop-table"><table class="script-table script-table-rich"><thead><tr><th>№</th><th>Время</th><th>Задача сцены</th><th>Что в кадре</th><th>Текст / реплики</th><th>Звук</th></tr></thead><tbody>'+scriptScenes.map((x,i)=>{const speech=[x.dialogue?("Диалог: "+x.dialogue):"",x.voiceover?("Закадрово: "+x.voiceover):"",x.onscreen?("На экране: "+x.onscreen):""].filter(Boolean).join("\n");const visual=[x.visual,x.action].filter(Boolean).join("\n");return '<tr><td>'+(x.scene||i+1)+'</td><td>'+esc(x.time||"—")+'</td><td>'+esc(x.purpose||"—")+'</td><td>'+esc(visual||"—")+'</td><td>'+esc(speech||"—")+'</td><td>'+esc(x.sound||"—")+'</td></tr><tr class="script-detail-row"><td></td><td colspan="5"><div class="script-detail-grid"><span><b>Переход:</b> '+esc(x.transition||"—")+'</span><span><b>Continuity:</b> '+esc(x.continuity||"—")+'</span><span><b>Роль товара:</b> '+esc(x.productRole||"—")+'</span><span><b>Удержание:</b> '+esc(x.retentionMechanic||"—")+'</span><span><b>Open loop:</b> '+esc(x.openLoop||"—")+'</span><span><b>Pattern interrupt:</b> '+esc(x.patternInterrupt||"—")+'</span><span><b>Контраст:</b> '+esc(x.visualContrast||"—")+'</span><span><b>Micro-conflict:</b> '+esc(x.microConflict||"—")+'</span><span><b>Micro-payoff:</b> '+esc(x.microPayoff||"—")+'</span><span><b>Среда:</b> '+esc(x.environmentStory||"—")+'</span><span><b>Игра героя:</b> '+esc(x.performanceBeat||"—")+'</span><span><b>Sound bridge:</b> '+esc(x.soundBridge||"—")+'</span><span><b>Следующий вопрос:</b> '+esc(x.nextQuestion||"—")+'</span></div></td></tr>'}).join("")+'</tbody></table></div>':'';
    const mobileHtml=scriptScenes.length?'<div class="script-mobile-list">'+scriptScenes.map((x,i)=>{
      const speech=[x.dialogue?("Диалог: "+x.dialogue):"",x.voiceover?("Озвучка: "+x.voiceover):"",x.onscreen?("На экране: "+x.onscreen):""].filter(Boolean);
      return '<article class="script-mobile-card">'+
        '<div class="script-mobile-head"><span class="script-scene-number">'+(x.scene||i+1)+'</span><div><small>СЦЕНА '+(x.scene||i+1)+'</small><b>'+esc(x.time||"—")+'</b></div></div>'+
        '<div class="script-mobile-purpose">'+esc(x.purpose||"—")+'</div>'+
        '<div class="script-mobile-section"><small>Что видит зритель</small><p>'+esc(x.visual||"—")+'</p></div>'+
        '<div class="script-mobile-section"><small>Действие</small><p>'+esc(x.action||"—")+'</p></div>'+
        (speech.length?'<div class="script-mobile-section speech"><small>Речь / текст</small>'+speech.map(v=>'<p>'+esc(v)+'</p>').join("")+'</div>':'')+
        '<div class="script-mobile-section"><small>Звук</small><p>'+esc(x.sound||"—")+'</p></div>'+
        '<details class="script-mobile-tech"><summary>Retention · постановка · continuity</summary><div><p><b>Удержание:</b> '+esc(x.retentionMechanic||"—")+'</p><p><b>Open loop:</b> '+esc(x.openLoop||"—")+'</p><p><b>Pattern interrupt:</b> '+esc(x.patternInterrupt||"—")+'</p><p><b>Контраст:</b> '+esc(x.visualContrast||"—")+'</p><p><b>Micro-conflict:</b> '+esc(x.microConflict||"—")+'</p><p><b>Micro-payoff:</b> '+esc(x.microPayoff||"—")+'</p><p><b>Среда:</b> '+esc(x.environmentStory||"—")+'</p><p><b>Игра героя:</b> '+esc(x.performanceBeat||"—")+'</p><p><b>Sound bridge:</b> '+esc(x.soundBridge||"—")+'</p><p><b>Следующий вопрос:</b> '+esc(x.nextQuestion||"—")+'</p><p><b>Переход:</b> '+esc(x.transition||"—")+'</p><p><b>Continuity:</b> '+esc(x.continuity||"—")+'</p><p><b>Роль товара:</b> '+esc(x.productRole||"—")+'</p></div></details>'+
      '</article>';
    }).join("")+'</div>':'';
    body='<div class="artifact-script">'+
      '<div class="script-master-head"><span class="kicker">УТВЕРЖДЁННАЯ ИДЕЯ → СЦЕНАРИЙ</span><h3>'+esc(script.title||idea.title||"Сценарий")+'</h3><p>'+esc(script.logline||script.structure||"")+'</p></div>'+
      qualityHtml+
      '<div class="script-summary">'+
        '<div><small>Хук</small><p>'+esc(script.hook||idea.hook||"—")+'</p></div>'+
        '<div><small>CTA</small><p>'+esc(script.cta||idea.ctaDirection||"—")+'</p></div>'+
        '<div><small>Тон</small><p>'+esc(script.tone||"—")+'</p></div>'+
        '<div><small>Длительность</small><p>'+esc(script.duration||r.duration||"—")+'</p></div>'+
      '</div>'+
      (script.globalContinuity?'<div class="script-rule-box"><small>Continuity всего ролика</small><p>'+esc(script.globalContinuity)+'</p></div>':'')+
      (script.subtitleRules?'<div class="script-rule-box"><small>Субтитры / safe zone</small><p>'+esc(script.subtitleRules)+'</p></div>':'')+
      (scriptScenes.length?(tableHtml+mobileHtml):'<p>'+esc(script.body||script.voiceover||"—")+'</p>')+
    '</div>';
  }
  else if(stage==="Storyboard"){
    body=(board.length?'<div class="stage-inline-note"><b>План раскадровки: 2 кадра на сцену</b><p>START = начало действия, END = заметно продвинутый или завершённый момент. Эти два кадра задаются здесь и затем используются этапом превиза.</p></div>':'')+(board.length?'<div class="storyboard-report">'+board.map((x,i)=>{
      const sceneNo=i+1;
      const required=["title","duration","purpose","shot","framing","camera","lens","angle","cameraHeight","focus","depth","motionTiming","environment","setDesign","foreground","midground","background","props","materials","colorPalette","lighting","practicalLights","characters","performance","blocking","product","action","startFrame","endFrame","continuity","retentionMechanic","patternInterrupt","microPayoff","sound","soundDesign","transition","editorNote","negative","promptEn"];
      const missing=required.filter(k=>!String(x?.[k]||"").trim());
      const job=r.storyboardSceneJobs?.[sceneNo];
      const busy=job?.status==="queued"||job?.status==="processing";
      return '<article class="storyboard-report-card '+(missing.length?"storyboard-incomplete":"storyboard-complete")+'">'+
        '<div class="storyboard-report-head"><span class="storyboard-number">'+sceneNo+'</span><div><h3>'+esc(x.title||"Сцена")+'</h3><small>'+esc(x.duration||"")+'</small></div><div class="storyboard-scene-tools"><span class="status '+(missing.length?"work":"done")+'">'+(missing.length?("Не заполнено: "+missing.length):"Заполнено")+'</span><button class="secondary storyboard-scene-regenerate" '+(busy?"disabled":"")+' onclick="regenerateStoryboardScene(\''+r.id+'\','+sceneNo+')">'+(busy?"⏳ Обновляется":"↻ Переделать сцену")+'</button></div></div>'+
        '<div class="storyboard-meta">'+
          '<div><small>Задача</small><p>'+esc(x.purpose||"—")+'</p></div>'+
          '<div><small>Крупность</small><p>'+esc(x.framing||"—")+'</p></div>'+
          '<div><small>Камера</small><p>'+esc(x.camera||"—")+'</p></div>'+
          '<div><small>Ракурс / объектив</small><p>'+esc([x.angle,x.lens].filter(Boolean).join(" · ")||"—")+'</p></div>'+
          '<div><small>Высота камеры</small><p>'+esc(x.cameraHeight||"—")+'</p></div>'+
          '<div><small>Фокус / глубина</small><p>'+esc([x.focus,x.depth].filter(Boolean).join(" · ")||"—")+'</p></div>'+
          '<div><small>Тайминг движения</small><p>'+esc(x.motionTiming||"—")+'</p></div>'+
        '</div>'+
        '<div class="storyboard-wide"><small>Что в кадре</small><p>'+esc(x.shot||"—")+'</p></div>'+
        '<div class="storyboard-wide"><small>Действие</small><p>'+esc(x.action||"—")+'</p></div>'+
        '<div class="storyboard-meta"><div><small>Высота камеры</small><p>'+esc(x.cameraHeight||"—")+'</p></div><div><small>Фокус</small><p>'+esc(x.focus||"—")+'</p></div><div><small>Глубина</small><p>'+esc(x.depth||"—")+'</p></div><div><small>Motion timing</small><p>'+esc(x.motionTiming||"—")+'</p></div></div>'+
        '<div class="storyboard-wide"><small>Set design</small><p>'+esc(x.setDesign||"—")+'</p></div>'+
        '<div class="storyboard-meta"><div><small>Foreground</small><p>'+esc(x.foreground||"—")+'</p></div><div><small>Midground</small><p>'+esc(x.midground||"—")+'</p></div><div><small>Background</small><p>'+esc(x.background||"—")+'</p></div><div><small>Props</small><p>'+esc(x.props||"—")+'</p></div></div>'+
        '<div class="storyboard-meta"><div><small>Материалы</small><p>'+esc(x.materials||"—")+'</p></div><div><small>Палитра</small><p>'+esc(x.colorPalette||"—")+'</p></div><div><small>Практикал-свет</small><p>'+esc(x.practicalLights||"—")+'</p></div><div><small>Blocking</small><p>'+esc(x.blocking||"—")+'</p></div></div>'+
        '<div class="storyboard-wide"><small>Performance</small><p>'+esc(x.performance||"—")+'</p></div>'+
        '<div class="storyboard-meta"><div><small>Retention</small><p>'+esc(x.retentionMechanic||"—")+'</p></div><div><small>Pattern interrupt</small><p>'+esc(x.patternInterrupt||"—")+'</p></div><div><small>Micro-payoff</small><p>'+esc(x.microPayoff||"—")+'</p></div><div><small>Sound design</small><p>'+esc(x.soundDesign||"—")+'</p></div></div>'+
        '<div class="storyboard-wide"><small>Editor note</small><p>'+esc(x.editorNote||"—")+'</p></div>'+
        '<div class="storyboard-wide"><small>SET DESIGN / интерьер</small><p>'+esc(x.setDesign||"—")+'</p></div>'+
        '<div class="storyboard-meta">'+
          '<div><small>Передний план</small><p>'+esc(x.foreground||"—")+'</p></div>'+
          '<div><small>Средний план</small><p>'+esc(x.midground||"—")+'</p></div>'+
          '<div><small>Фон</small><p>'+esc(x.background||"—")+'</p></div>'+
          '<div><small>Props</small><p>'+esc(x.props||"—")+'</p></div>'+
          '<div><small>Материалы</small><p>'+esc(x.materials||"—")+'</p></div>'+
          '<div><small>Палитра</small><p>'+esc(x.colorPalette||"—")+'</p></div>'+
        '</div>'+
        '<div class="storyboard-meta">'+
          '<div class="'+(!x.environment?"storyboard-field-missing":"")+'"><small>Локация</small><p>'+esc(x.environment||"—")+'</p></div>'+
          '<div class="'+(!x.lighting?"storyboard-field-missing":"")+'"><small>Свет</small><p>'+esc(x.lighting||"—")+'</p></div>'+
          '<div><small>Practical lights</small><p>'+esc(x.practicalLights||"—")+'</p></div>'+
          '<div class="'+(!x.characters?"storyboard-field-missing":"")+'"><small>Персонаж</small><p>'+esc(x.characters||"—")+'</p></div>'+
          '<div><small>Игра героя</small><p>'+esc(x.performance||"—")+'</p></div>'+
          '<div><small>Blocking</small><p>'+esc(x.blocking||"—")+'</p></div>'+
          '<div class="'+(!x.product?"storyboard-field-missing":"")+'"><small>Товар</small><p>'+esc(x.product||"—")+'</p></div>'+
        '</div>'+
        '<div class="storyboard-frame-pair"><div class="'+(!x.startFrame?"storyboard-field-missing":"")+'"><small>START FRAME</small><p>'+esc(x.startFrame||"—")+'</p></div><div class="'+(!x.endFrame?"storyboard-field-missing":"")+'"><small>END FRAME</small><p>'+esc(x.endFrame||"—")+'</p></div></div>'+
        '<div class="storyboard-wide"><small>Continuity</small><p>'+esc(x.continuity||"—")+'</p></div>'+
        '<div class="storyboard-meta"><div><small>Retention mechanic</small><p>'+esc(x.retentionMechanic||"—")+'</p></div><div><small>Pattern interrupt</small><p>'+esc(x.patternInterrupt||"—")+'</p></div><div><small>Micro-payoff</small><p>'+esc(x.microPayoff||"—")+'</p></div><div><small>Sound design</small><p>'+esc(x.soundDesign||"—")+'</p></div><div><small>Editor note</small><p>'+esc(x.editorNote||"—")+'</p></div></div>'+
        '<div class="storyboard-meta">'+
          '<div><small>Диалог</small><p>'+esc(x.dialogue||"Не предусмотрено сценарием")+'</p></div>'+
          '<div><small>Озвучка</small><p>'+esc(x.voiceover||"Не предусмотрено сценарием")+'</p></div>'+
          '<div><small>Текст на экране</small><p>'+esc(x.onscreen||"Не предусмотрено сценарием")+'</p></div>'+
          '<div><small>Звук / переход</small><p>'+esc([x.sound,x.transition].filter(Boolean).join(" · ")||"—")+'</p></div>'+
        '</div>'+
        '<details class="storyboard-prompt"><summary>Prompt для видеомодели</summary><p>'+esc(x.promptEn||x.prompt||"—")+'</p><small>NEGATIVE</small><p>'+esc(x.negative||"—")+'</p></details>'+
        (missing.length?'<div class="storyboard-missing-note">Нужно заполнить: '+missing.map(esc).join(", ")+'</div>':'')+
      '</article>';
    }).join("")+'</div>':'<div class="empty compact-empty">Storyboard ещё не создан.</div>');
  }
  else if(stage==="Превиз-кадры"){
    const frames=Array.isArray(r.previsFrames)?r.previsFrames:[];
    const planFrames=previsEndpointFrames(Array.isArray(r.previsPlan?.frames)?r.previsPlan.frames:[]);
    const displayFrames=previsEndpointFrames(frames);
    const total=previsExpectedTotal(r);
    const ready=displayFrames.filter(x=>x?.url).length;
    const slots=(planFrames.length?planFrames:displayFrames).map(spec=>{
      const current=frames.find(x=>String(x?.id)===String(spec?.id))||frames.find(x=>Number(x?.scene)===Number(spec?.scene)&&String(x?.frameType||"").toLowerCase()===String(spec?.frameType||"").toLowerCase())||frames.find(x=>Number(x?.scene)===Number(spec?.scene)&&Number(x?.frame)===Number(spec?.frame));
      return {...spec,...(current||{})};
    });
    const grouped=[...new Set(slots.map(x=>Number(x.scene)).filter(Boolean))];
    body='<div class="previs-head"><div><b>'+ready+' / '+total+' кадров</b><p>По 2 кадра на сцену: START → END. END должен заметно развивать действие, а не повторять START. Меняем фазу действия, позу/руки, положение товара и при необходимости крупность или угол камеры, сохраняя continuity.</p></div><span class="status '+(r.previsResult?.completed&&ready>=total?'done':'work')+'">'+(r.previsResult?.completed&&ready>=total?'Готово':'Нужно '+Math.max(0,total-ready)+' кадр.')+'</span></div>'+
      (slots.length?'<div class="previs-scenes">'+grouped.map(scene=>'<section class="previs-scene"><div class="previs-scene-title"><b>Сцена '+scene+'</b><small>'+slots.filter(x=>Number(x.scene)===scene&&x.url).length+' / '+slots.filter(x=>Number(x.scene)===scene).length+' кадров</small></div><div class="previs-grid">'+slots.filter(x=>Number(x.scene)===scene).sort((a,b)=>String(a.frameType||"")==="start"?-1:String(b.frameType||"")==="start"?1:0).map(x=>'<article class="previs-card"><div class="previs-image">'+(x.url?'<img src="'+esc(x.url)+'" alt="Превиз сцены '+scene+'">':'<div class="empty compact-empty">Кадр удалён / не создан</div>')+'</div><div class="previs-card-copy"><b>'+esc((x.frameType||"frame").toUpperCase())+' · '+(String(x.frameType||"").toLowerCase()==="start"?'начало сцены':'конец сцены')+'</b><small>'+esc(x.timecode||"")+(x.source==="user-upload"?' · ТВОЙ КАДР':'')+'</small><small>'+(x.source==="user-upload"?'Источник: твой кадр':'Генератор: '+esc(x.provider||x.model||"—")+(x.fallbackFrom?' · fallback из '+esc(x.fallbackFrom):''))+(x.qc?.score?' · QC '+esc(x.qc.score)+'/10':'')+(x.qc?.productIdentityScore!=null?' · Product '+esc(x.qc.productIdentityScore)+'%':'')+(x.qc?.continuityScore!=null?' · Continuity '+esc(x.qc.continuityScore)+'%':'')+'</small><p>'+esc(x.goal||x.action||"")+'</p><div class="previs-ref-mode">'+esc(x.referenceMode||"anchor-led")+'</div><div class="media-actions">'+(x.url?'<button class="tiny-btn" onclick="downloadMedia(\''+esc(x.url)+'\',\'previs-scene-'+scene+'-'+esc(x.frameType||"frame")+'.png\')">↓ Скачать</button><button class="tiny-btn" onclick="replacePrevisFrame(\''+r.id+'\',\''+esc(x.id||"")+'\','+scene+','+Number(x.frame||1)+')">↑ Заменить своим</button><button class="tiny-btn danger-mini" onclick="deletePrevisFrame(\''+r.id+'\',\''+esc(x.id||"")+'\','+scene+','+Number(x.frame||1)+')">Удалить</button>':'<button class="btn primary" onclick="replacePrevisFrame(\''+r.id+'\',\''+esc(x.id||"")+'\','+scene+','+Number(x.frame||1)+')">＋ Загрузить свой кадр</button>')+'</div><details><summary>Cinematic prompt</summary><p>'+esc(x.imagePromptEn||x.imagePromptRu||"—")+'</p><small>Continuity</small><p>'+esc(x.continuityNotes||"—")+'</p></details></div></article>').join("")+'</div></section>').join("")+'</div>':'<div class="empty compact-empty">'+esc(r.previsError||"Кадры ещё не сгенерированы.")+'</div>');
  } else if(stage==="Генерация"){
    const sceneEntries=Object.entries(r.sceneResults||{}).sort((a,b)=>Number(a[0])-Number(b[0])).filter(([,v])=>v?.ok&&v?.urls?.length);
    body=sceneEntries.length?'<div class="generated-grid">'+sceneEntries.map(([sceneNo,v])=>{const u=v.urls[0];return '<div class="generated-video-panel"><video controls playsinline preload="metadata" src="'+esc(u)+'"></video><p class="artifact-note"><b>Сцена '+esc(sceneNo)+'</b>'+(v.routerProvider?' · '+esc(v.routerProvider):'')+(v.qc?.score?' · QC '+esc(v.qc.score)+'/10':'')+(v.qc?.productIdentityScore!=null?' · Product '+esc(v.qc.productIdentityScore)+'%':'')+(v.qc?.continuityScore!=null?' · Continuity '+esc(v.qc.continuityScore)+'%':'')+'</p><div class="media-actions"><button class="tiny-btn" onclick="downloadMedia(\''+esc(u)+'\',\'scene-'+esc(sceneNo)+'.mp4\')">↓ Скачать видео</button><button class="tiny-btn danger-mini" onclick="deleteSceneVideo(\''+r.id+'\','+Number(sceneNo)+')">Удалить только это видео</button></div></div>'}).join("")+'</div>':'<div class="empty compact-empty">'+esc(r.generationError||r.error||"Видео ещё не получено. Можно повторить этап.")+'</div>';
  } else if(stage==="Озвучка"){
    const v=r.voiceoverResult;
    body=v?'<div class="artifact-script"><h3>Озвучка готова</h3><p>Модель: '+esc(v.model||v.provider||"")+'</p><p>Сцен с речью: '+((v.spokenScenes||[]).length)+'</p>'+(r.audioDirector?.analysis?'<p><b>Audio QC:</b> '+esc(r.audioDirector.analysis.score||"—")+'% · '+esc(r.audioDirector.analysis.integratedLufs??"—")+' LUFS · '+esc(r.audioDirector.analysis.truePeakDbtp??"—")+' dBTP</p>':'')+(v.spokenScenes?.length?'<div class="stage-storyboard-list">'+v.spokenScenes.map(x=>'<div><b>Сцена '+x.scene+'</b><span>'+x.duration+' сек</span><p>'+esc(x.text||"")+'</p></div>').join("")+'</div>':'')+'</div>':'<div class="empty compact-empty">Озвучка ещё не готова.</div>';
  } else if(stage==="Монтаж"){
    body=r.montageResult?.url?'<div class="generated-video-panel"><video controls playsinline preload="metadata" src="'+esc(r.montageResult.url)+'"></video><p class="artifact-note">Длительность: '+esc(r.montageResult.durationSeconds||"—")+' сек</p><div class="media-actions"><button class="btn primary" onclick="downloadMedia(\''+esc(r.montageResult.url)+'\',\'final-'+esc(r.id)+'.mp4\')">↓ Скачать готовое видео</button><button class="tiny-btn danger-mini" onclick="deleteFinalVideo(\''+r.id+'\')">Удалить только финальное видео</button></div></div>':'<div class="empty compact-empty">Финальный монтаж ещё не готов.</div>';
  } else if(stage==="AI-проверка"){
    const q=r.qcResult;
    const dc=q?.directorCut||r.directorCut||null;
    body=q?'<div class="artifact-script"><h3>'+(q.passed===false?'Есть замечания':'Проверка завершена')+'</h3><p>'+esc(q.summary||"")+'</p>'+(q.score!=null?'<p><b>QC:</b> '+esc(q.score)+'/10</p>':'')+(q.productIdentityScore!=null?'<p><b>Product Identity:</b> '+esc(q.productIdentityScore)+'%</p>':'')+(q.continuityScore!=null?'<p><b>Continuity:</b> '+esc(q.continuityScore)+'%</p>':'')+(q.issues?.length?'<ul>'+q.issues.map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul>':'')+(dc?'<div class="script-rule-box"><small>DIRECTOR CUT</small><p>'+esc(dc.reason||("Оценка режиссуры: "+(dc.score??"—")))+'</p>'+(dc.reshootScenes?.length?'<p><b>Пересъёмка:</b> сцены '+dc.reshootScenes.map(esc).join(", ")+'</p>':'')+(dc.sceneNotes?.length?'<div class="director-cut-scenes">'+dc.sceneNotes.map(x=>'<div><b>Сцена '+esc(x.scene||"")+'</b><p>'+esc(x.issue||"")+'</p><small>'+esc(x.fix||"")+(x.preferredProvider?' · '+esc(x.preferredProvider):'')+'</small></div>').join("")+'</div>':'')+(dc.montageActions?.length?'<ul>'+dc.montageActions.map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul>':'')+'</div>':'')+'</div>':'<div class="empty compact-empty">AI-проверка ещё не завершена.</div>';
  } else body='<div class="empty compact-empty">Этот этап ещё не выполнен.</div>';
  const canRegen=["Идея","Сценарий","Storyboard","Превиз-кадры","Генерация","Озвучка","Монтаж","AI-проверка"].includes(stage);
  const manual=r.mode==="manual";
  const storyboardBusy=stage==="Storyboard"&&(
    (r.backgroundTask?.type==="storyboard"&&["queued","processing"].includes(String(r.backgroundTask?.status||""))) ||
    Object.values(r.storyboardSceneJobs||{}).some(j=>["queued","processing"].includes(String(j?.status||"")))
  );
  const nextAction=!manual?''
    :stage==="Идея"
      ?'<button class="btn primary" onclick="runAction(\''+r.id+'\',\'advance_stage\')">✓ Утвердить идею → Сценарий</button>'
      :stage==="Сценарий"
        ?'<button class="btn primary" onclick="runAction(\''+r.id+'\',\'advance_stage\')">✓ Утвердить сценарий → Storyboard</button>'
        :stage==="Storyboard"
          ?(r.stage==="Превиз-кадры"||r.previsRunning
            ?'<button class="btn primary" disabled>⏳ Превиз уже запущен</button>'
            :storyboardBusy
              ?'<button class="btn primary" disabled>⏳ Storyboard ещё обновляется</button>'
              :'<button class="btn primary" onclick="runAction(\''+r.id+'\',\'advance_stage\',this)">✓ Утвердить Storyboard → Превиз</button>')
          :stage==="Превиз-кадры"&&r.previsResult?.completed
            ?'<button class="btn primary" onclick="runAction(\''+r.id+'\',\'advance_stage\')">✓ Утвердить превиз → Генерация видео</button>'
            :'';
  return '<section class="panel stage-report" id="stageReport"><div class="panel-title"><div><span class="mini-icon">▤</span><h2>'+esc(stage)+'</h2><p>'+(manual?'Ручной режим · этап ждёт подтверждения после готовности':'Автопилот · этапы проходят автоматически')+'</p></div><span class="status '+(stageDone(r,stage)?"done":"wait")+'">'+(stageDone(r,stage)?"Готово":"Не готово")+'</span></div>'+body+'<div class="stage-report-actions">'+nextAction+(canRegen?'<button class="secondary" onclick="runAction(\''+r.id+'\',\'regenerate\',\''+stage+'\')">↻ Переделать этап</button>':'')+(r.status==="Ждёт пополнения"?'<button class="btn primary" onclick="runAction(\''+r.id+'\',\'resume\')">↻ Проверить оплату и продолжить</button>':r.status==="Ошибка"?'<button class="btn primary" onclick="runAction(\''+r.id+'\',\'resume\')">↻ Повторить этап</button>':r.status==="Остановлено"?'<button class="btn primary" onclick="runAction(\''+r.id+'\',\'resume\')">▶ Продолжить</button>':'<button class="danger-btn" onclick="runAction(\''+r.id+'\',\'stop\')">■ Остановить</button>')+'</div></section>';
}
window.regenerateStoryboardScene=async(runId,scene)=>{
  const note=prompt("Что изменить только в сцене "+scene+"? Можно оставить пустым — AI сам заполнит и улучшит все технические поля.","");
  if(note===null)return;
  const r=await fetch("/api/runs/action",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accountId:activeAccountId,runId,action:"regenerate_storyboard_scene",scene,note})});
  const data=await r.json().catch(()=>({}));
  if(!r.ok){alert(data.detail||data.error||"Не удалось переделать сцену");return}
  await syncFromServer();selectedRunId=runId;runStageOpen="Storyboard";renderRunDetail();
};
window.openStageDetail=(id,stage)=>{selectedRunId=id;runStageOpen=stage;renderRunDetail();setTimeout(()=>document.getElementById("stageReport")?.scrollIntoView({behavior:"smooth",block:"start"}),40)};
window.selectIdeaOption=async(runId,optionIndex)=>{
  const r=await fetch("/api/runs/action",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accountId:activeAccountId,runId,action:"select_idea_option",optionIndex})});
  const data=await r.json().catch(()=>({}));if(!r.ok){alert(data.detail||data.error||"Не удалось выбрать идею");return}
  await syncFromServer();selectedRunId=runId;runStageOpen="Идея";renderRunDetail();
  setTimeout(()=>document.getElementById("stageReport")?.scrollIntoView({behavior:"smooth",block:"start"}),40);
};
window.launchIdeaOption=async(runId,optionIndex)=>{
  const r=await fetch("/api/runs/action",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accountId:activeAccountId,runId,action:"launch_idea_option",optionIndex})});
  const data=await r.json().catch(()=>({}));if(!r.ok){alert(data.detail||data.error||"Не удалось запустить идею");return}
  await syncFromServer();selectedRunId=data.run?.id||selectedRunId;runStageOpen="Идея";renderRunDetail();go("runDetail");
};
window.launchSavedIdea=async(ideaId)=>{
  const r=await fetch("/api/ideas/action",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accountId:activeAccountId,action:"launch_saved",ideaId})});
  const data=await r.json().catch(()=>({}));if(!r.ok){alert(data.detail||data.error||"Не удалось запустить идею");return}
  await syncFromServer();selectedRunId=data.run?.id||selectedRunId;runStageOpen="Идея";renderRunDetail();go("runDetail");
};
window.deleteSavedIdea=async(ideaId)=>{
  if(!confirm("Удалить эту идею из библиотеки? Процессы и ролики не удалятся."))return;
  const r=await fetch("/api/ideas/action",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accountId:activeAccountId,action:"delete_saved",ideaId})});
  const data=await r.json().catch(()=>({}));if(!r.ok){alert(data.detail||data.error||"Не удалось удалить идею");return}
  await syncFromServer();renderIdeas();
};
window.regenerateStoryboardScene=async(runId,scene)=>{
  const note=prompt("Что изменить только в сцене "+scene+"? Оставь пустым, чтобы AI просто докрутил её и заполнил все поля.","");
  if(note===null)return;
  const r=await fetch("/api/runs/action",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
    accountId:activeAccountId,runId,action:"regenerate_storyboard_scene",scene,note
  })});
  const data=await r.json().catch(()=>({}));
  if(!r.ok){alert(data.detail||data.error||"Не удалось переделать сцену");return}
  await syncFromServer();selectedRunId=runId;runStageOpen="Storyboard";renderRunDetail();
  go("runDetail",{skipChatSync:true});
};
window.runAction=async(id,action,stage="",button=null)=>{
  let note="";
  if(action==="regenerate"){const v=prompt("Что изменить в этапе «"+stage+"»?","");if(v===null)return;note=v}
  const btn=button&&button.tagName?button:null;
  const oldText=btn?.textContent||"";
  if(btn){btn.disabled=true;btn.textContent=action==="advance_stage"?"⏳ Запускаю следующий этап…":"⏳ Запускаю…"}
  try{
    const r=await fetch("/api/runs/action",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accountId:activeAccountId,runId:id,action,stage,note})});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data.detail||data.error||"Ошибка");
    if(data.run&&action==="advance_stage"){
      const pos=runs.findIndex(x=>x.id===id);
      if(pos>=0)runs[pos]={...runs[pos],...data.run};
      runStageOpen=data.run.stage||runStageOpen;
    }
    await syncFromServer();
    selectedRunId=id;
    if(action==="advance_stage")runStageOpen=data.run?.stage||runs.find(x=>x.id===id)?.stage||runStageOpen||"";
    renderRunDetail();
    if(action==="start"||action==="resume"||action==="advance_stage")go("runDetail");
  }catch(e){
    alert(String(e?.message||e));
    if(btn){btn.disabled=false;btn.textContent=oldText}
  }
};

function qualitySystemsHtml(r){
  const gate=r?.qualityGate&&typeof r.qualityGate==='object'?r.qualityGate:null;
  const fallback=[
    {key:"productIdentity",label:"Product Identity",score:null,status:"pending"},
    {key:"continuity",label:"Continuity Engine",score:null,status:"pending"},
    {key:"directorPreflight",label:"Director AI",score:null,status:"pending"},
    {key:"audio",label:"Audio Director",score:null,status:"pending"},
    {key:"directorCut",label:"Final Director Cut",score:null,status:"pending"}
  ];
  const systems=Array.isArray(gate?.systems)&&gate.systems.length?gate.systems:fallback;
  const rows=systems.map(x=>{
    const score=Number.isFinite(Number(x.score))?Math.round(Number(x.score)):null;
    const good=x.status==="green";
    return '<div class="ready-line"><span><b>'+esc(x.label||x.key)+'</b><small>'+(good?'Жёсткий QC пройден':score==null?'Ожидает этап':'Нужна автодокрутка')+'</small></span><b class="'+(good?'qc-ok':'qc-wait')+'">'+(score==null?'—':score+'%')+'</b></div>';
  }).join("");
  return '<section class="panel"><div class="panel-title"><div><span class="mini-icon">◆</span><h2>Quality Gate · 5 систем</h2><p>Зелёный только после фактической проверки, без рисования фиктивных 100%</p></div><span class="status '+(gate?.passed?'done':'work')+'">'+(gate?.passed?'Все зелёные':(gate?.overall!=null?'Минимум '+Math.round(gate.overall)+'%':'В процессе'))+'</span></div><div class="readiness">'+rows+'</div></section>';
}

function renderRunDetail(){
  const r=runs.find(x=>x.id===selectedRunId)||runs.at(-1);
  if(!r){$("#runDetailBody").innerHTML='<div class="empty">Нет ролика.</div>';return}
  const rd=readiness(r),rs=rd.reduce((sum,x)=>sum+x[1],0),rt=rd.reduce((sum,x)=>sum+x[2],0);
  const q=r.qcResult||null;
  const qchecks=q?.checks||{};
  const audioOk=Number(r.audioDirector?.analysis?.score)>=90;
  const qc=[
    ["Товар соответствует эталону",q?((Number(q.productIdentityScore)>=95&&String(qchecks.productConsistency||"").toLowerCase()==="ok")?"ok":"fail"):"pending"],
    ["Нет визуальных артефактов",q?(String(qchecks.visualArtifacts||"").toLowerCase()==="ok"?"ok":"fail"):"pending"],
    ["Сценарий / текст соответствует",q?(String(qchecks.scriptCompliance||"").toLowerCase()==="ok"?"ok":"fail"):"pending"],
    ["Формат 9:16 соблюдён",q?(String(qchecks.verticalFormat||"").toLowerCase()==="ok"?"ok":"fail"):"pending"],
    ["Звук нормализован",r.audioDirector?.analysis?(audioOk?"ok":"fail"):"pending"],
    ["Continuity сохранён",q?(Number(q.continuityScore)>=85?"ok":"fail"):"pending"],
    ["Payoff / CTA читается",q?(String(qchecks.payoff||"").toLowerCase()==="ok"?"ok":"fail"):"pending"]
  ];
  const currentIndex=Math.max(0,ST.indexOf(r.stage));
  const stageHtml=ST.map((st,i)=>{
    const done=stageDone(r,st),current=st===r.stage&&!done,status=done?"Готово":current?"В процессе":"Ожидает",cls=done?"done":current?"work":"wait";
    const regen=["Идея","Сценарий","Storyboard","Превиз-кадры","Генерация","Озвучка","Монтаж","AI-проверка"].includes(st)&&(done||current);
    return '<div class="stage-row"><button class="stage stage-click '+(current?"progress":done?"done-stage":"pending")+'" onclick="openStageDetail(\''+r.id+'\',\''+st+'\')"><span class="stage-num">'+(i+1)+'</span><span><b>'+st+'</b><small>'+(done?"Есть результат":current?"Сейчас выполняется":"Ожидает")+'</small></span><span class="status '+cls+'">'+status+'</span></button>'+(regen?'<button class="stage-regen-btn" title="Переделать только этап '+esc(st)+'" onclick="event.stopPropagation();runAction(\''+r.id+'\',\'regenerate\',\''+st+'\')">↻ <span>Переделать</span></button>':'')+'</div>';
  }).join("");
  const readyHtml=rd.map(x=>'<div class="ready-line"><span><b>'+x[0]+'</b><small>'+(x[1]===x[2]?"Готово":"Нет результата")+'</small></span><span class="ready-count">'+x[1]+' из '+x[2]+'</span></div>').join("");
  const qcHtml=qc.map(([label,state])=>'<div class="qc-row"><span>'+esc(label)+'</span><b class="'+(state==="ok"?"qc-ok":"qc-wait")+'">'+(state==="ok"?"✓ Пройдено":state==="fail"?"Нужно исправить":"Ожидает")+'</b></div>').join("");
  const editParts=["Хук","Сцена 2","Сцена 3","Голос","Музыка","Субтитры","CTA","Цветокоррекция"];
  const edits=editParts.map(x=>'<button class="edit-option" data-edit-part="'+x+'">'+x+'</button>').join("");
  const totalScenes=Number(r.generationResult?.totalScenes||r.sceneCount||0);
  const generatedSceneUrls=Array.isArray(r.generationResult?.urls)?r.generationResult.urls.filter(Boolean):[];
  const generatedVideosReady=Boolean(r.generationResult?.completed&&totalScenes>0&&generatedSceneUrls.length>=totalScenes);
  const acceptedScenes=Array.isArray(r.acceptedScenes)?r.acceptedScenes:[];
  const pendingScenes=Array.from({length:totalScenes},(_,i)=>i+1).filter(n=>!acceptedScenes.includes(n));
  const reviewPanel=(r.stage==="На проверке"&&r.status==="На проверке"&&generatedVideosReady&&!r.montageResult?.url)?'<section class="panel stage-report" id="sceneReviewPanel"><div class="panel-title"><div><span class="mini-icon">✓</span><h2>Проверка сцен</h2><p>Просмотри каждую сцену и прими или переделай</p></div><span class="status work">Принято '+acceptedScenes.length+'/'+totalScenes+'</span></div><div class="review-scene-list">'+Array.from({length:totalScenes},(_,i)=>{const n=i+1,url=sceneResultUrl(r,i),ok=acceptedScenes.includes(n);return '<article class="review-scene '+(ok?'accepted':'')+'"><div class="review-scene-head"><b>Сцена '+n+'</b><span class="status '+(ok?'done':'wait')+'">'+(ok?'Принята':'Нужно решение')+'</span></div>'+(url?'<video controls playsinline preload="metadata" src="'+esc(url)+'"></video><div class="media-actions"><button class="tiny-btn" onclick="downloadMedia(\''+esc(url)+'\',\'scene-'+n+'.mp4\')">↓ Скачать</button></div>':'<div class="empty compact-empty">Видео ещё нет</div>')+'<div class="review-scene-actions">'+(ok?'<button class="secondary" onclick="regenScene(\''+r.id+'\','+n+')">↻ Переделать</button>':'<button class="btn primary" onclick="acceptScene(\''+r.id+'\','+n+',this)">✓ Принять сцену</button><button class="secondary" onclick="regenScene(\''+r.id+'\','+n+')">↻ Переделать</button>')+'</div></article>'}).join("")+'</div>'+(pendingScenes.length?'<div class="message">Осталось подтвердить сцены: '+pendingScenes.join(", ")+'</div>':'<div class="message">Все сцены подтверждены.</div>')+'</section>':'';
  const finalReviewPanel=(r.status==="На проверке"&&r.montageResult?.url)?'<section class="panel final-review-panel" id="finalReviewPanel"><div class="panel-title"><div><span class="mini-icon">▶</span><h2>Финальная проверка ролика</h2><p>Сцены уже подтверждены, озвучка и монтаж готовы</p></div><span class="status '+(r.qcResult?.passed===false?'review':'done')+'">'+(r.qcResult?.passed===false?'Есть замечание AI':'AI-проверка пройдена')+'</span></div><video controls playsinline preload="metadata" src="'+esc(r.montageResult.url)+'"></video><div class="final-qc-summary"><b>AI-проверка</b><p>'+esc(r.qcResult?.summary||"Проверка завершена.")+'</p>'+(r.qcResult?.issues?.length?'<ul>'+r.qcResult.issues.map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul>':'')+'</div><div class="final-review-actions"><button class="secondary" onclick="downloadMedia(\''+esc(r.montageResult.url)+'\',\'final-'+esc(r.id)+'.mp4\')">↓ Скачать видео</button><button class="tiny-btn danger-mini" onclick="deleteFinalVideo(\''+r.id+'\')">Удалить финальное видео</button><button class="btn primary" onclick="markReady(\''+r.id+'\')">✓ Утвердить ролик</button><button class="secondary" onclick="document.getElementById(\'storyboardReview\')?.scrollIntoView({behavior:\'smooth\',block:\'start\'})">↻ Перейти к сценам для доработки</button></div></section>':'';
  const generatedUrl=r.montageResult?.url||r.generationResult?.urls?.[0]||null;
  const generatedVideo=generatedUrl?'<section class="panel generated-video-panel"><div class="panel-title"><div><span class="mini-icon">▶</span><h2>'+(r.montageResult?.url?'Финальный ролик':'Полученное видео')+'</h2><p>'+(r.montageResult?.url?'Собранный монтаж с озвучкой':'Результат генерации сцены')+'</p></div><span class="status done">Получено</span></div><video controls playsinline preload="metadata" src="'+esc(generatedUrl)+'"></video><div class="media-actions"><button class="btn primary" onclick="downloadMedia(\''+esc(generatedUrl)+'\',\''+(r.montageResult?.url?'final-'+esc(r.id)+'.mp4':'generated-'+esc(r.id)+'.mp4')+'\')">↓ Скачать</button>'+(r.montageResult?.url?'<button class="tiny-btn danger-mini" onclick="deleteFinalVideo(\''+r.id+'\')">Удалить финальное видео</button>':'')+'</div></section>':'';
  const stageReport=runStageOpen?stageReportHtml(r,runStageOpen):'';
  const runMode=r.mode==="manual"?"manual":"auto";
  const modeSwitch='<div class="run-mode-control"><span><b>Режим процесса</b><small>'+(runMode==="manual"?"Текущий шаг завершится и остановится на подтверждении":"Следующие этапы продолжатся автоматически")+'</small></span><div class="run-mode-buttons"><button class="'+(runMode==="manual"?"btn primary":"secondary")+'" '+(runMode==="manual"?"disabled":"")+' onclick="switchRunMode(\''+r.id+'\',\'manual\',this)">Ручной</button><button class="'+(runMode==="auto"?"btn primary":"secondary")+'" '+(runMode==="auto"?"disabled":"")+' onclick="switchRunMode(\''+r.id+'\',\'auto\',this)">Автопилот</button></div></div>';
  $("#runDetailBody").innerHTML=
    '<section class="panel"><div class="section-head" style="margin:0"><div><span class="kicker">РОЛИК</span><h1>'+esc(pname(r))+(r.variant?' · вариант '+r.variant:'')+'</h1><p>'+esc(r.style||'')+' · '+esc(r.duration||'')+' · 9:16 · '+esc((r.platforms||[]).join(' / '))+'</p></div><span class="status '+scl(r.status)+'">'+esc(r.status==="На проверке"&&r.stage!=="На проверке"?"Ждёт подтверждения: "+r.stage:(r.status||"В работе"))+'</span></div><div class="progress" style="height:10px;margin-top:18px"><i style="width:'+pct(r)+'%"></i></div><div class="campaign-budget"><span>Прогресс: '+pct(r)+'%</span><span>Режим: '+(r.mode==="manual"?"Ручной":"Автопилот")+'</span></div>'+modeSwitch+'<div class="run-top-actions">'+(r.status==="Ждёт пополнения"?'<button class="btn primary" onclick="runAction(\''+r.id+'\',\'resume\')">↻ Проверить оплату и продолжить</button>':r.status==="Ошибка"?'<button class="btn primary" onclick="runAction(\''+r.id+'\',\'resume\')">↻ Повторить этап</button>':r.status==="Остановлено"?'<button class="btn primary" onclick="runAction(\''+r.id+'\',\'resume\')">▶ Продолжить</button>':'<button class="danger-btn" onclick="runAction(\''+r.id+'\',\'stop\')">■ Остановить</button>')+(r.status==="Черновик"?'<button class="btn primary" onclick="runAction(\''+r.id+'\',\'start\')">▶ Запустить производство</button>':'')+'<button class="danger-btn" onclick="deleteRun(\''+r.id+'\')">Удалить процесс</button></div></section>'+reviewPanel+finalReviewPanel+generatedVideo+
    qualitySystemsHtml(r)+'<div class="run-layout"><section class="panel"><div class="panel-title"><div><span class="mini-icon">⌁</span><h2>Производственный путь</h2><p>Нажми на любой этап — увидишь реальный результат</p></div></div><div class="stage-list">'+stageHtml+'</div></section><aside><section class="panel"><div class="panel-title"><div><span class="mini-icon">✓</span><h2>Контроль готовности</h2><p>'+rs+' из '+rt+'</p></div></div><div class="readiness">'+readyHtml+'</div></section><section class="panel"><div class="panel-title"><div><span class="mini-icon">₽</span><h2>Ограничения</h2></div></div><div class="readiness"><div class="ready-line"><span>Бюджет</span><b>'+(r.budget||500)+' ₽</b></div><div class="ready-line"><span>Попыток</span><b>'+(r.maxAttempts||3)+'</b></div><div class="ready-line"><span>Модель</span><b>'+esc(r.modelMode||"Авто")+'</b></div></div></section></aside></div>'+stageReport+
    '<section class="panel" id="storyboardReview"><div class="panel-title"><div><span class="mini-icon">▤</span><h2>Storyboard и сцены</h2><p>Кадр, действие, озвучка, промт и версии</p></div></div><div class="storyboard">'+scenes(r)+'</div></section>'+
    '<div class="two-col"><section class="panel"><div class="panel-title"><div><span class="mini-icon">✓</span><h2>AI-проверка</h2></div></div><div class="qc-list">'+qcHtml+'</div></section><section class="panel"><div class="panel-title"><div><span class="mini-icon">✎</span><h2>Точечная доработка</h2><p>Переделываем только нужную часть</p></div></div><div class="edit-grid">'+edits+'</div><div class="catalog-actions"><button class="secondary" id="sendRevision">↩ На доработку</button><button class="btn primary" id="approveMontageBtn">✓ Утвердить монтаж</button><button class="btn primary" id="approveRunBtn">✓ Утвердить ролик</button></div></section></div>';
  $$("[data-edit-part]").forEach(btn=>btn.onclick=()=>requestEdit(r.id,btn.dataset.editPart));
  $("#sendRevision").onclick=()=>requestEdit(r.id,"Комментарий");
  $("#approveMontageBtn").onclick=()=>approveMontage(r.id);
  $("#approveRunBtn").onclick=()=>markReady(r.id);
}
async function runServerAction(payload){
  const r=await fetch("/api/runs/action",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accountId:activeAccountId,...payload})});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.detail||data.error||"Ошибка");
  await syncFromServer();
  if(payload.runId)selectedRunId=payload.runId;
  renderRunDetail();
  return data.run;
}
window.acceptScene=async(id,n,btn)=>{
  const r=runs.find(x=>x.id===id);
  if((r?.acceptedScenes||[]).includes(n)){
    if(btn){btn.textContent="✓ Принята";btn.disabled=true;btn.classList.add("scene-accepted-btn")}
    return;
  }
  const oldText=btn?.textContent||"";
  if(btn){btn.disabled=true;btn.textContent="Сохраняю…"}
  try{
    await runServerAction({runId:id,action:"accept_scene",scene:n});
    const fresh=runs.find(x=>x.id===id);
    if(!(fresh?.acceptedScenes||[]).includes(n))throw new Error("Сервер не сохранил подтверждение сцены "+n);
    if(btn){btn.textContent="✓ Принята";btn.classList.add("scene-accepted-btn")}
  }catch(e){
    if(btn){btn.disabled=false;btn.textContent=oldText||"✓ Принять"}
    alert(String(e?.message||e));
  }
};
window.switchRunMode=async(id,mode,btn)=>{
  const next=mode==="manual"?"manual":"auto";
  const oldText=btn?.textContent||"";
  if(btn){btn.disabled=true;btn.textContent="Переключаю…"}
  try{
    await runServerAction({runId:id,action:"set_mode",mode:next});
  }catch(e){
    if(btn){btn.disabled=false;btn.textContent=oldText}
    alert(String(e?.message||e));
  }
};
window.regenScene=async(id,n)=>{if(!confirm("Переделать только сцену "+n+"?"))return;try{await runServerAction({runId:id,action:"regenerate_scene",scene:n})}catch(e){alert(String(e?.message||e))}};
window.promptScene=async(id,n)=>{const t=prompt("Новый промт для сцены "+n+":");if(!t)return;try{await runServerAction({runId:id,action:"update_scene_prompt",scene:n,prompt:t})}catch(e){alert(String(e?.message||e))}};
window.modelScene=async(id,n)=>{const r=runs.find(x=>x.id===id),current=r?.sceneModels?.[n]||"Авто";const t=prompt("Модель для сцены "+n+":\nАвто — AI Router\nRunway — простая сцена\nSeedance 2.5 — сложная сцена",current);if(!t)return;try{await runServerAction({runId:id,action:"set_scene_model",scene:n,model:t})}catch(e){alert(String(e?.message||e))}};
window.requestEdit=async(id,part)=>{const note=prompt("Что изменить: "+part+"?","");if(note===null)return;try{await runServerAction({runId:id,action:"regenerate",stage:part.startsWith("Сцена")?"Генерация":part==="Голос"?"Озвучка":["Музыка","Субтитры","Цветокоррекция"].includes(part)?"Монтаж":"Сценарий",note})}catch(e){alert(String(e?.message||e))}};
window.approveMontage=async id=>{try{await runServerAction({runId:id,action:"approve_montage"})}catch(e){alert(String(e?.message||e))}};
window.markReady=async id=>{try{await runServerAction({runId:id,action:"approve_run"})}catch(e){alert(String(e?.message||e))}};
function renderScripts(){$("#scriptsList").innerHTML=scripts.length?scripts.slice().reverse().map(s=>'<article class="library-item"><div><h3>'+esc(s.title)+'</h3><p><b>Хук:</b> '+esc(s.hook||"—")+"\n"+esc(s.body||"")+"\n<b>CTA:</b> "+esc(s.cta||"—")+'</p><div class="library-meta"><span class="chip">Использован: '+(s.used||0)+' раз</span></div></div><div class="library-actions"><button class="secondary" onclick="useScript(\''+s.id+'\')">Использовать</button><button class="danger-btn" onclick="deleteScript(\''+s.id+'\')">Удалить</button></div></article>').join(""):'<div class="empty">Сценариев пока нет.</div>';const P=[["UGC-хук","Разговорное начало от лица покупателя"],["Проблема → решение","Боль → демонстрация → результат → CTA"],["Демонстрация","Максимум продукта в кадре"]];$("#promptLibrary").innerHTML=P.map((p,i)=>'<div class="prompt-card"><b>'+p[0]+'</b><small>'+p[1]+'</small><div class="dup-meter"><strong>Защита от повторов: включена</strong><div class="progress"><i style="width:'+(18+i*7)+'%"></i></div></div></div>').join("")}
$("#addScript").onclick=()=>openM("scriptModal");$("#saveScript").onclick=()=>{const n=$("#scriptTitle").value.trim();if(!n)return;scripts.push({id:uid("s"),title:n,hook:$("#scriptHook").value.trim(),body:$("#scriptBody").value.trim(),cta:$("#scriptCta").value.trim(),used:0,created:now()});log("Сохранён сценарий",n);closeM("scriptModal");persist()};
window.useScript=id=>{const s=scripts.find(x=>x.id===id);if(!s)return;s.used=(s.used||0)+1;$("#brief").value=[s.hook,s.body,s.cta].filter(Boolean).join("\n");openCreate();persist()};
function collectGeneratedMedia(){
  const archived=(Array.isArray(mediaLibrary)?mediaLibrary:[]).slice().reverse();
  const activePhotos=[],activeVideos=[];
  const seenPhoto=new Set(),seenVideo=new Set();

  for(const r of (Array.isArray(runs)?runs:[]).slice().reverse()){
    for(const f of (Array.isArray(r.previsFrames)?r.previsFrames:[])){
      if(!f?.url||seenPhoto.has(String(f.url)))continue;
      seenPhoto.add(String(f.url));
      activePhotos.push({
        id:'active-previs-'+String(r.id)+'-'+String(f.id||f.scene+'-'+f.frame),
        kind:'image',url:f.url,path:f.path||'',productName:pname(r),
        sourceStage:'Превиз',scene:f.scene,frame:f.frame,frameId:f.id||'',
        provider:f.provider||f.model||'',fileName:f.fileName||('previs-scene-'+f.scene+'-'+(f.frameType||f.frame)+'.png'),
        active:true,activeType:'previs',runId:r.id
      });
    }
    for(const [sceneNo,sr] of Object.entries(r.sceneResults||{})){
      for(const [idx,u] of (Array.isArray(sr?.urls)?sr.urls:[]).entries()){
        if(!u||seenVideo.has(String(u)))continue;
        seenVideo.add(String(u));
        activeVideos.push({
          id:'active-scene-'+String(r.id)+'-'+sceneNo+'-'+idx,kind:'video',url:u,productName:pname(r),
          sourceStage:'Видео-сцена',scene:Number(sceneNo),videoIndex:idx,
          provider:sr.routerProvider||sr.provider||sr.model||'',fileName:'scene-'+sceneNo+(idx?'-'+(idx+1):'')+'.mp4',
          active:true,activeType:'scene',runId:r.id
        });
      }
    }
    const finalUrl=r.montageResult?.url||r.finalMedia?.url||'';
    if(finalUrl&&!seenVideo.has(String(finalUrl))){
      seenVideo.add(String(finalUrl));
      activeVideos.unshift({
        id:'active-final-'+r.id,kind:'video',url:finalUrl,
        productName:pname(r),sourceStage:'Финальный ролик',
        provider:'Монтаж',fileName:'final-'+r.id+'.mp4',
        active:true,activeType:'final',runId:r.id
      });
    }
  }

  const archivedPhotos=archived.filter(m=>m.kind!=="video"&&!seenPhoto.has(String(m.url||'')));
  const archivedVideos=archived.filter(m=>m.kind==="video"&&!seenVideo.has(String(m.url||'')));
  return {
    photos:[...activePhotos,...archivedPhotos],
    videos:[...activeVideos,...archivedVideos]
  };
}

function generatedMediaCard(m){
  const title=[m.productName,m.sourceStage,m.scene?("сцена "+m.scene):""].filter(Boolean).join(" · ");
  const preview=m.kind==="video"
    ? '<video controls playsinline preload="metadata" src="'+esc(m.url||"")+'"></video>'
    : '<img loading="lazy" src="'+esc(m.url||"")+'" alt="'+esc(title||"Медиа")+'" onerror="mediaImageError(this)">';
  const ext=m.kind==="video"?".mp4":".png";
  let del='';
  if(m.activeType==="previs") del='<button class="tiny-btn danger-mini" onclick="deletePrevisFrame(\''+esc(m.runId)+'\',\''+esc(m.frameId||"")+'\','+Number(m.scene||1)+','+Number(m.frame||1)+')">Удалить фото</button>';
  else if(m.activeType==="scene") del='<button class="tiny-btn danger-mini" onclick="deleteSceneVideoItem(\''+esc(m.runId)+'\','+Number(m.scene||1)+','+Number(m.videoIndex||0)+')">Удалить видео</button>';
  else if(m.activeType==="final") del='<button class="tiny-btn danger-mini" onclick="deleteFinalVideo(\''+esc(m.runId)+'\')">Удалить видео</button>';
  else del='<button class="tiny-btn danger-mini" onclick="deleteLibraryMedia(\''+esc(m.id||"")+'\')">Удалить</button>';

  return '<article class="archive-media-card '+(m.active?'active-media-card':'')+'">'+
    '<div class="archive-media-preview">'+preview+(m.kind!=="video"?'<button class="media-expand" aria-label="Открыть фото крупно" data-preview-url="'+esc(m.url||'')+'" data-preview-title="'+esc(title)+'" onclick="openMediaPreview(this.dataset.previewUrl,this.dataset.previewTitle)">⤢</button>':'')+'</div>'+
    '<div class="archive-media-copy"><b>'+esc(title||"Сохранённый файл")+'</b>'+
    '<small>'+(m.active?'<span class="chip">Текущий</span> ':'')+esc(m.provider||m.model||"")+(m.archivedAt?' · сохранено '+esc(new Date(m.archivedAt).toLocaleString("ru-RU")):'')+'</small>'+
    '<div class="media-actions"><button class="tiny-btn" onclick="downloadMedia(\''+esc(m.url||"")+'\',\''+esc(m.fileName||("media-"+m.id+ext))+'\')">↓ Скачать</button>'+del+'</div></div></article>';
}

function renderMediaSection(targetId,type){
  const box=$("#"+targetId);if(!box)return;
  const all=collectGeneratedMedia()[type], f=mediaFilters[type];
  const select=(key,label,values)=>'<label>'+label+'<select data-filter="'+key+'" data-library="'+type+'" onchange="changeMediaFilter(this)"><option value="">Все</option>'+values.map(v=>'<option value="'+esc(v)+'" '+(f[key]===String(v)?'selected':'')+'>'+esc(key==='run'?(v==='archive'?'Архив':(()=>{const r=runs.find(r=>r.id===v);return r?pname(r)+' · '+(r.created||r.style||'Ролик'):'Архивный ролик '+String(v).slice(-6)})()):v)+'</option>').join('')+'</select></label>';
  const items=all.filter(m=>(!f.product||m.productName===f.product)&&(!f.run||String(m.runId||'archive')===f.run)&&(!f.scene||String(m.scene||'')===f.scene));
  const options=key=>[...new Set(all.map(m=>m[key]).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'ru',{numeric:true}));
  box.innerHTML='<section class="panel media-library-panel"><div class="media-filters">'+select('product','Товар',options('productName'))+select('run','Ролик',[...new Set(all.map(m=>m.runId||'archive'))])+select('scene','Сцена',options('scene'))+'<label>Порядок<select data-filter="order" data-library="'+type+'" onchange="changeMediaFilter(this)"><option value="recent" '+(f.order==='recent'?'selected':'')+'>Сначала новые</option><option value="scene" '+(f.order==='scene'?'selected':'')+'>По сценам и версиям</option></select></label></div><div class="media-selection-bar"><span>'+items.length+' из '+all.length+' файлов</span><button class="secondary" onclick="selectVisibleMedia(\''+type+'\')">Выбрать все</button><button class="secondary" onclick="clearMediaSelection(\''+type+'\')">Снять выбор</button><button class="btn primary" data-download-selection="'+type+'" onclick="downloadSelectedMedia(\''+type+'\')">Скачать выбранные</button></div><div class="archive-media-grid"></div></section>';
  if(f.order==='scene')items.sort((a,b)=>String(a.productName||'').localeCompare(String(b.productName||''))||String(a.runId||'').localeCompare(String(b.runId||''))||Number(a.scene||0)-Number(b.scene||0));
  const grid=box.querySelector('.archive-media-grid');
  grid.innerHTML=items.length?items.map(generatedMediaCard).join(''):'<div class="empty">По выбранным фильтрам ничего не найдено.</div>';
  [...grid.querySelectorAll('article')].forEach((card,i)=>{
    const m=items[i],key=mediaKey(m);card.dataset.mediaKey=key;
    const versions=all.filter(v=>v.productName===m.productName&&v.runId===m.runId&&v.scene===m.scene);if(m.scene&&versions.length>1){const badge=document.createElement('span');badge.className='media-version';badge.textContent='Сцена '+m.scene+' · версия '+(versions.length-versions.indexOf(m));card.querySelector('.archive-media-preview').append(badge);}
    const label=document.createElement('label');label.className='media-select';
    const input=document.createElement('input');input.type='checkbox';input.checked=mediaSelection[type].has(key);input.setAttribute('aria-label','Выбрать '+(m.productName||'файл')+' · сцена '+(m.scene||'—'));
    input.onchange=()=>{input.checked?mediaSelection[type].add(key):mediaSelection[type].delete(key);updateMediaSelection(type)};
    label.append(input);card.querySelector('.archive-media-preview').append(label);
  });
  updateMediaSelection(type);polishActionMenus(box);
}

function renderPhotos(){renderMediaSection("photosWorkspace","photos")}
function renderVideos(){renderMediaSection("videosWorkspace","videos")}
function renderMediaLibraries(){renderPhotos();renderVideos()}
window.deleteLibraryMedia=async id=>{
  if(!id||!confirm("Удалить только этот файл из медиатеки? Остальные фото и видео останутся."))return;
  const r=await fetch("/api/entities/delete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accountId:activeAccountId,type:"media",id,confirmed:true})});
  const data=await r.json().catch(()=>({}));
  if(!r.ok){alert(data.detail||data.error||"Не удалось удалить файл");return}
  await syncFromServer();renderMediaLibraries();
};
window.deleteSceneVideoItem=async(runId,scene,index=0)=>{
  if(!confirm("Удалить только выбранное видео сцены "+scene+"? Остальные фото и видео останутся."))return;
  const r=await fetch("/api/runs/action",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accountId:activeAccountId,runId,action:"delete_scene_video_item",scene,index})});
  const data=await r.json().catch(()=>({}));
  if(!r.ok){alert(data.detail||data.error||"Не удалось удалить выбранное видео");return}
  await syncFromServer();selectedRunId=runId;runStageOpen="Генерация";renderRunDetail();renderMediaLibraries();
};
window.deleteSceneVideo=(runId,scene)=>window.deleteSceneVideoItem(runId,scene,0);
window.deleteFinalVideo=async runId=>{
  if(!confirm("Удалить только финальное видео? Сцены, превизы, сценарий и процесс останутся."))return;
  const r=await fetch("/api/runs/action",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accountId:activeAccountId,runId,action:"delete_final_video"})});
  const data=await r.json().catch(()=>({}));
  if(!r.ok){alert(data.detail||data.error||"Не удалось удалить финальное видео");return}
  await syncFromServer();selectedRunId=runId;runStageOpen="Монтаж";renderRunDetail();renderMediaLibraries();
};
let editingCharacterId=null;

function renderCharacterExistingMedia(){
  const box=$("#characterExistingMedia");if(!box)return;
  const c=characters.find(x=>x.id===editingCharacterId);
  if(!c){box.innerHTML="";box.classList.remove("has-media");return}
  const media=Array.isArray(c.media)?c.media:[];
  box.classList.toggle("has-media",media.length>0);
  box.innerHTML=media.length?'<div class="avatar-existing-title"><b>Сохранённые фото</b><small>'+media.length+' шт.</small></div><div class="avatar-existing-grid">'+media.map(m=>
    '<div class="avatar-existing-item '+(m.isPrimary?'primary':'')+'"><img src="'+esc(m.url)+'" alt=""><div><button type="button" onclick="setPrimaryCharacterPhoto(\''+c.id+'\',\''+m.id+'\')">'+(m.isPrimary?'Главное':'Сделать главным')+'</button><button class="danger-mini" type="button" onclick="deleteCharacterPhoto(\''+c.id+'\',\''+m.id+'\')">Удалить</button></div></div>'
  ).join("")+'</div>':"";
}
window.setPrimaryCharacterPhoto=(characterId,mediaId)=>{
  const c=characters.find(x=>x.id===characterId);if(!c)return;
  (c.media||[]).forEach(m=>m.isPrimary=m.id===mediaId);
  log("Изменено главное фото AI-аватара",c.name);
  persist();renderCharacterExistingMedia();renderCharacters();
};
window.deleteCharacterPhoto=async(characterId,mediaId)=>{
  const c=characters.find(x=>x.id===characterId);if(!c)return;
  const m=(c.media||[]).find(x=>x.id===mediaId);if(!m||!confirm("Удалить это фото аватара?"))return;
  try{await fetch("/api/media/delete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accountId:activeAccountId,path:m.path})})}catch{}
  const wasPrimary=!!m.isPrimary;
  c.media=(c.media||[]).filter(x=>x.id!==mediaId);
  if(wasPrimary&&c.media[0])c.media[0].isPrimary=true;
  log("Удалено фото AI-аватара",c.name);
  persist();renderCharacterExistingMedia();renderCharacters();
};

function renderCharacters(){
  $("#characterGrid").innerHTML=characters.length?characters.map(c=>{
    const m=primaryCharacterMedia(c),count=(c.media||[]).length;
    return '<article class="character-card"><div class="avatar-art '+(m?"has-photo":"")+'">'+(m?'<img src="'+esc(m.url)+'" alt="'+esc(c.name)+'">':'◉')+'</div><h3>'+esc(c.name)+'</h3><p>'+esc((c.age?c.age+" лет · ":"")+(c.look||""))+'</p><div class="character-tags"><span class="chip">Фото: '+count+'</span><span class="chip">'+(count?"Лицо закреплено":"Нужны фото")+'</span><span class="chip">Голос: '+(c.voiceLinked?"подключён":"ожидает")+'</span></div><div id="avatarStatus-'+c.id+'" class="message"></div><input id="avatarUpload-'+c.id+'" type="file" accept="image/*" multiple hidden onchange="uploadExistingCharacterPhotos(event,\''+c.id+'\')"><div class="catalog-actions"><button class="btn primary" onclick="createWithCharacter(\''+c.id+'\')">Создать ролик</button><button class="secondary" onclick="editCharacter(\''+c.id+'\')">Редактировать</button><button class="secondary" onclick="document.getElementById(\'avatarUpload-'+c.id+'\').click()">＋ Фото</button><button class="danger-btn" onclick="deleteCharacter(\''+c.id+'\')">Удалить</button></div></article>'
  }).join(""):'<div class="empty">AI-аватаров пока нет. Создай первого и загрузи его реальные фото.</div>';
  const S=[["UGC","Живая подача и естественный свет"],["Premium","Контролируемый свет и hero-shot"],["Viral","Быстрый хук и активный монтаж"]];
  $("#styleGrid").innerHTML=S.map(s=>'<article class="style-card"><div class="style-swatch"></div><h3>'+s[0]+'</h3><p>'+s[1]+'</p></article>').join("")
}
function resetCharacterModal(){
  editingCharacterId=null;
  ["characterName","characterAge","characterLook","characterVoice","characterTopics","characterLocks"].forEach(id=>{if($("#"+id))$("#"+id).value=""});
  if($("#characterImages"))$("#characterImages").value="";
  if($("#saveCharacterMsg"))$("#saveCharacterMsg").textContent="";
  if($("#characterModalTitle"))$("#characterModalTitle").textContent="Создать постоянного AI-аватара";
  if($("#characterModalHelp"))$("#characterModalHelp").textContent="Загрузи 1–10 реальных фото лица. Они станут референсами, чтобы сохранять внешность героя между роликами.";
  if($("#characterPhotoLabel"))$("#characterPhotoLabel").textContent="Фото для аватара";
  if($("#saveCharacter"))$("#saveCharacter").textContent="Сохранить AI-аватара";
  renderCharacterExistingMedia();
  renderCharacterDraftPreview();
}
$("#addCharacter").onclick=()=>{resetCharacterModal();openM("characterModal")};
window.editCharacter=id=>{
  const c=characters.find(x=>x.id===id);if(!c)return;
  editingCharacterId=id;
  $("#characterName").value=c.name||"";
  $("#characterAge").value=c.age||"";
  $("#characterLook").value=c.look||"";
  $("#characterVoice").value=c.voice||"";
  $("#characterTopics").value=c.topics||"";
  $("#characterLocks").value=c.locks||"";
  if($("#characterImages"))$("#characterImages").value="";
  if($("#saveCharacterMsg"))$("#saveCharacterMsg").textContent="";
  $("#characterModalTitle").textContent="Редактировать AI-аватара";
  $("#characterModalHelp").textContent="Измени данные, добавь новые фото или выбери главное референсное фото.";
  $("#characterPhotoLabel").textContent="Добавить новые фото";
  $("#saveCharacter").textContent="Сохранить изменения";
  renderCharacterExistingMedia();
  renderCharacterDraftPreview();
  openM("characterModal");
};
if($("#characterImages"))$("#characterImages").onchange=renderCharacterDraftPreview;
$("#saveCharacter").onclick=async()=>{
  const n=$("#characterName").value.trim(),files=[...($("#characterImages")?.files||[])].slice(0,10),msg=$("#saveCharacterMsg"),btn=$("#saveCharacter");
  if(!n){msg.textContent="Укажи имя аватара.";return}
  const existing=editingCharacterId?characters.find(x=>x.id===editingCharacterId):null;
  if(!existing&&!files.length){msg.textContent="Добавь хотя бы одно фото лица.";return}
  btn.disabled=true;
  beginLocalMutation();
  try{
    msg.textContent=existing?"Сохраняю изменения…":"Сохраняю AI-аватара…";
    const c=existing||{id:uid("ch"),voiceLinked:false,media:[],created:now()};
    c.name=n;
    c.age=$("#characterAge").value.trim();
    c.look=$("#characterLook").value.trim();
    c.voice=$("#characterVoice").value.trim();
    c.topics=$("#characterTopics").value.trim();
    c.locks=$("#characterLocks").value.trim();
    c.updatedAt=new Date().toISOString();

    if(!existing){
      characters.push(c);
      saveLocalState();
      renderCharacters();
    }

    let result={ok:1,failed:0};
    if(files.length)result=await uploadCharacterPhotos(c,files,msg);

    if(!existing&&!result.ok){
      characters=characters.filter(x=>x.id!==c.id);
      saveLocalState();
      renderAll();
      clearTimeout(syncTimer);
      await pushState();
      msg.textContent="Аватар не сохранён: не удалось загрузить фото.";
      return;
    }

    log(existing?"Изменён AI-аватар":"Создан AI-аватар",n+" · фото: "+(c.media||[]).length);
    saveLocalState();
    renderAll();
    clearTimeout(syncTimer);
    const saved=await pushState();
    if(!saved)throw new Error("Не удалось сохранить аватара на сервере");

    if($("#characterImages"))$("#characterImages").value="";
    renderCharacterDraftPreview();
    renderCharacterExistingMedia();
    msg.textContent=existing?"Изменения сохранены.":"AI-аватар сохранён.";
    setTimeout(()=>closeM("characterModal"),500);
  }catch(e){
    msg.textContent="Ошибка сохранения: "+String(e?.message||e);
  }finally{
    finishLocalMutation();
    btn.disabled=false;
    if(localMutationDepth===0&&deferredServerSync)setTimeout(()=>syncFromServer(),0);
  }
};
window.createWithCharacter=id=>{openCreate();setTimeout(()=>$("#characterSelect").value=id,0)};


function videoAnalysisText(value,keys=[]){
  if(value==null)return "";
  if(typeof value==="string"||typeof value==="number")return String(value);
  if(Array.isArray(value))return value.map(x=>videoAnalysisText(x,keys)).filter(Boolean).join(" · ");
  if(typeof value==="object"){
    for(const k of keys){if(value[k]!=null&&String(value[k]).trim())return videoAnalysisText(value[k],keys)}
    return Object.entries(value).filter(([,v])=>v!=null&&String(v).trim()).slice(0,8).map(([k,v])=>k+": "+videoAnalysisText(v,keys)).join(" · ");
  }
  return String(value);
}
function renderVideoLab(){
  const psel=$("#analysisProduct"),asel=$("#analysisAvatar");
  if(psel)psel.innerHTML='<option value="">Без товара</option>'+products.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join("");
  if(asel)asel.innerHTML='<option value="">Без аватара</option>'+characters.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join("");
  const list=$("#videoAnalysisList");if(!list)return;
  list.innerHTML=videoAnalyses.length?videoAnalyses.slice().reverse().map(v=>{
    const a=v.analysis||{},src=a.sourceBlueprint||a.sourceReconstruction||{},adapt=a.adaptation||{};
    const adaptScenes=Array.isArray(adapt.scenes)?adapt.scenes:[];
    const sourceShots=Array.isArray(src.shots)?src.shots:(Array.isArray(a.scenes)?a.scenes:[]);
    const summary=videoAnalysisText(a.summary,["description","mechanic"]);
    const hook=videoAnalysisText(a.hook,["observation","mechanism","visual"]);
    const adaptConcept=videoAnalysisText(adapt.concept,["idea","title"]);
    const adaptHook=videoAnalysisText(adapt.hook,["visual","voiceover","onscreen"]);
    const transcript=String(src.exactVoiceover||src.spokenTranscript||src.voiceoverScript||v.timedTranscript||v.transcript||"").trim();
    const frames=(Array.isArray(v.keyframes)&&v.keyframes.length?v.keyframes:(Array.isArray(v.frameSamples)?v.frameSamples:[])).filter(x=>x?.url);
    const audioBadge=v.audioPresent?(transcript?'Озвучка извлечена ✓':('Аудио: '+esc(v.transcriptStatus||"без текста"))):'Без аудио';
    const productWarn=!v.productName?'<div class="analysis-warning"><b>Товар не выбран.</b> Исходник разобран, но улучшенная версия не привязана к Product DNA конкретного товара. Для точной копии механики под наш товар выбери товар и запусти разбор ещё раз.</div>':'';
    const sourceGrammar=[src.cameraGrammar?'<p><b>Камера:</b> '+esc(src.cameraGrammar)+'</p>':'',src.lightingGrammar?'<p><b>Свет:</b> '+esc(src.lightingGrammar)+'</p>':'',src.setGrammar?'<p><b>Интерьер:</b> '+esc(src.setGrammar)+'</p>':'',src.editingGrammar?'<p><b>Монтаж:</b> '+esc(src.editingGrammar)+'</p>':'',src.audioGrammar?'<p><b>Звук:</b> '+esc(src.audioGrammar)+'</p>':''].filter(Boolean).join("");
    return '<article class="video-analysis-card">'+
      '<div class="video-analysis-head"><div><span class="chip">'+esc(v.sourceType==="youtube"?"YouTube":"Загрузка")+'</span>'+(v.provider?'<span class="chip">AI: '+esc(v.provider)+'</span>':'')+'<span class="chip">'+audioBadge+'</span><h3>'+esc(v.sourceName||"Видео")+'</h3><p>'+esc((v.productName?"Товар: "+v.productName:"")+(v.avatarName?" · Аватар: "+v.avatarName:"")+(v.providerNote?" · "+v.providerNote:""))+'</p></div><div class="catalog-actions"><button class="secondary" onclick="saveAnalysisAsScript(\''+v.id+'\')">Создать улучшенный сценарий</button><button class="danger-btn" onclick="deleteVideoAnalysis(\''+v.id+'\')">Удалить</button></div></div>'+
      productWarn+
      '<div class="analysis-columns"><div><small>Что реально в исходнике</small><p>'+esc(summary||src.scriptSummary||"—")+'</p><b>Хук</b><p>'+esc(hook||src.sourceHook||"—")+'</p></div><div><small>Улучшенная версия</small><p>'+esc(adaptConcept||"—")+'</p><b>Новый хук</b><p>'+esc(adaptHook||"—")+'</p></div></div>'+
      (transcript?'<details class="analysis-detail" open><summary>🎙 Точная озвучка / речь</summary><p>'+esc(transcript)+'</p>'+(v.transcription?.model?'<small>Модель: '+esc(v.transcription.model)+' · '+esc(v.transcription.status||"")+'</small>':'')+'</details>':(v.audioPresent?'<div class="analysis-warning">Аудиодорожка есть, но речь не удалось извлечь. Статус: '+esc(v.transcriptStatus||"неизвестно")+(v.transcriptError?' · '+esc(v.transcriptError):'')+'</div>':''))+
      (frames.length?'<details class="analysis-detail" open><summary>🖼 Ключевые кадры исходника · '+frames.length+'</summary><div class="analysis-frame-grid">'+frames.map(x=>'<figure><img src="'+esc(x.url)+'" alt="Кадр"><figcaption>'+((x.shot?('S'+x.shot+' '):''))+Number(x.time||x.timeSec||0).toFixed(2)+'с'+(x.phase?' · '+esc(x.phase):'')+'</figcaption></figure>').join("")+'</div></details>':'')+
      (sourceGrammar?'<details class="analysis-detail" open><summary>🎥 Визуальная грамматика исходника</summary>'+sourceGrammar+'</details>':'')+
      (sourceShots.length?'<details class="analysis-detail" open><summary>🎬 Shot-by-shot · '+sourceShots.length+'</summary><div class="analysis-scenes">'+sourceShots.slice(0,30).map((s,i)=>'<div><span>'+(s.shot||i+1)+'</span><p><b>'+esc(String(s.start??s.timing??""))+(s.end!=null?'–'+esc(String(s.end)):'')+'</b> '+esc([s.framing,s.cameraAngle,s.angle,s.cameraMotion,s.lensEstimate,s.lensFeel].filter(Boolean).join(" · "))+'<br>'+esc([s.frameSummary,s.action,s.handAction,s.productAction,s.spokenLine,s.dialogueOrVoice,s.onscreenText,s.retentionMechanic,s.microPayoff].filter(Boolean).join(" · "))+'</p></div>').join("")+'</div></details>':'')+
      (src.scriptSummary?'<details class="analysis-detail"><summary>📝 Восстановленный сценарий исходника</summary><p>'+esc(src.scriptSummary)+'</p>'+(src.onscreenTextTimeline?.length?'<p><b>Текст на экране:</b> '+esc(src.onscreenTextTimeline.join(" · "))+'</p>':'')+'</details>':'')+
      (adapt.productionBible?'<details class="analysis-detail"><summary>🎞 Production Bible улучшенной версии</summary><p>'+esc(adapt.productionBible)+'</p>'+(adapt.differencesFromSource?.length?'<ul>'+adapt.differencesFromSource.map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul>':'')+'</details>':'')+
      (adaptScenes.length?'<details class="analysis-detail" open><summary>🚀 Улучшенная версия · '+adaptScenes.length+' сцен</summary><div class="analysis-scenes">'+adaptScenes.slice(0,30).map((s,i)=>'<div><span>'+(s.scene||i+1)+'</span><p><b>'+esc(s.time||s.duration||"Сцена")+'</b> '+esc([s.purpose,s.shot,s.camera,s.lens,s.environment,s.setDesign].filter(Boolean).join(" · "))+'<br>'+esc([s.avatarAction,s.productAction,s.voiceover,s.onscreen,s.sound,s.transition,s.retentionMechanic,s.productLock].filter(Boolean).join(" · "))+'</p></div>').join("")+'</div></details>':'')+
    '</article>';
  }).join(""):'<div class="empty">Разборов пока нет.</div>';
}
$("#analyzeVideoFile")?.addEventListener("click",async()=>{
  const file=$("#competitorVideoFile")?.files?.[0],status=$("#videoFileStatus"),btn=$("#analyzeVideoFile");
  if(!file){status.textContent="Выбери видео.";return}
  btn.disabled=true;status.textContent="Извлекаю кадры, аудио и анализирую…";
  try{
    const qs=new URLSearchParams({account:activeAccountId,fileName:file.name,productId:$("#analysisProduct")?.value||"",avatarId:$("#analysisAvatar")?.value||""});
    const r=await fetch("/api/video-analysis/upload?"+qs.toString(),{method:"POST",headers:{"content-type":file.type||"application/octet-stream"},body:file});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data.detail||data.error||"Ошибка анализа");
    await syncFromServer();go("videoLab");status.textContent="Готово.";
  }catch(e){const m=String(e?.message||e);status.textContent=/no credits remaining|insufficient_quota|баланс/i.test(m)?"OpenAI API без баланса, а резервный Descript тоже не смог завершить разбор. Проверь кредиты API.":m}finally{btn.disabled=false}
});
$("#analyzeYoutube")?.addEventListener("click",async()=>{
  const url=$("#youtubeAnalysisUrl")?.value.trim(),status=$("#youtubeStatus"),btn=$("#analyzeYoutube");
  if(!url){status.textContent="Вставь ссылку YouTube.";return}
  btn.disabled=true;status.textContent="Получаю субтитры и разбираю структуру…";
  try{
    const r=await fetch("/api/video-analysis/youtube",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accountId:activeAccountId,url,productId:$("#analysisProduct")?.value||"",avatarId:$("#analysisAvatar")?.value||""})});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data.detail||data.error||"Ошибка анализа");
    await syncFromServer();go("videoLab");status.textContent="Готово.";
  }catch(e){const m=String(e?.message||e);status.textContent=/no credits remaining|insufficient_quota|баланс/i.test(m)?"OpenAI API без баланса, а резервный Descript тоже не смог завершить разбор. Проверь кредиты API.":m}finally{btn.disabled=false}
});
window.saveAnalysisAsScript=id=>{
  const v=videoAnalyses.find(x=>x.id===id);if(!v)return;
  const a=v.analysis?.adaptation||{};
  if(!v.productName){alert("Сначала выбери конкретный товар и повтори разбор. Без Product DNA можно разобрать исходник, но нельзя сохранять точную улучшенную версию под наш товар.");return}
  const sceneText=(a.scenes||[]).map((s,i)=>(i+1)+". "+[s.duration,s.purpose,s.shot,s.camera,s.avatarAction,s.productAction,s.voiceover,s.onscreen,s.sound,s.retentionMechanic,s.patternInterrupt,s.microPayoff].filter(Boolean).join(" · ")).join("\n");
  const hook=videoAnalysisText(a.hook,["voiceover","visual","onscreen"]);
  const concept=videoAnalysisText(a.concept,["idea","title"]);
  const cta=videoAnalysisText(a.cta,["text","productionNotes"]);
  scripts.push({id:uid("s"),title:"Адаптация: "+(v.sourceName||"Видео"),hook,body:[concept,sceneText].filter(Boolean).join("\n\n"),cta,used:0,created:now()});
  log("Сценарий создан из разбора",v.sourceName||"Видео");persist();go("scripts");
};

function renderPublish(){const a=runs.filter(r=>["Готово","Запланировано","Опубликовано"].includes(r.status)).reverse();$("#readyGrid").innerHTML=a.length?a.map(r=>'<article class="ready-card"><div class="video-preview" onclick="openRun(\''+r.id+'\')"><div class="video-copy">'+esc(pname(r))+'</div></div><h3>'+esc(pname(r))+'</h3><p>'+esc(r.style||"")+" · "+esc(r.duration||"")+' · 9:16</p><div class="publish-list">'+(r.platforms||["TikTok","Reels","Shorts"]).map(n=>'<div class="publish-row"><span><b>'+n+'</b><small style="display:block;color:var(--muted);margin-top:3px">'+(r.status==="Опубликовано"?"Опубликовано":r.status==="Запланировано"?"Запланировано":"Готово к публикации")+'</small></span><span class="toggle"></span></div>').join("")+'</div><div class="catalog-actions"><button class="secondary" onclick="openRun(\''+r.id+'\')">Проверить</button><button class="btn primary" onclick="scheduleRun(\''+r.id+'\')">Запланировать</button><button class="danger-btn" onclick="deleteRun(\''+r.id+'\')">Удалить</button></div></article>').join(""):'<div class="panel empty">После утверждения ролики появятся здесь.</div>'}
window.scheduleRun=id=>{const r=runs.find(x=>x.id===id);if(!r)return;const d=prompt("Дата и время публикации:",r.scheduledAt||"");if(!d)return;r.scheduledAt=d;r.status="Запланировано";r.stage="Запланировано";r.progress=96;log("Ролик запланирован",pname(r)+" · "+d);persist()};
function renderCalendar(){const st=new Date();st.setHours(0,0,0,0);const D=Array.from({length:7},(_,i)=>{const d=new Date(st);d.setDate(st.getDate()+i);return d}),E=runs.filter(r=>r.scheduledAt||r.status==="Опубликовано");$("#calendarGrid").innerHTML='<div class="calendar-grid">'+D.map(d=>{const k=d.toLocaleDateString("ru-RU"),e=E.filter(r=>String(r.scheduledAt||"").startsWith(k)||r.publishedDate===k);return '<div class="day"><div class="day-head"><b>'+d.toLocaleDateString("ru-RU",{weekday:"short"})+'</b><small>'+k.slice(0,5)+'</small></div>'+(e.map(r=>'<div class="calendar-event" onclick="openRun(\''+r.id+'\')"><b>'+esc(pname(r))+'</b><small>'+esc(r.scheduledAt||"Опубликовано")+'</small></div>').join("")||'<div class="muted" style="font-size:10px">Нет публикаций</div>')+'</div>'}).join("")+'</div>'}
$("#autoSchedule").onclick=()=>{const a=runs.filter(r=>r.status==="Готово");if(!a.length)return alert("Нет готовых роликов.");const b=new Date();a.forEach((r,i)=>{const d=new Date(b);d.setDate(b.getDate()+Math.floor(i/2)+1);d.setHours(i%2?18:12,0,0,0);r.scheduledAt=d.toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});r.status="Запланировано";r.stage="Запланировано";r.progress=96});log("Автораспределение публикаций","Запланировано: "+a.length);persist()};
function renderAnalytics(){
  const published=runs.filter(r=>r.status==="Опубликовано"||r.metrics);
  const views=published.reduce((s,r)=>s+(Number(r.metrics?.views)||0),0);
  const clicks=published.reduce((s,r)=>s+(Number(r.metrics?.clicks)||0),0);
  const sales=published.reduce((s,r)=>s+(Number(r.metrics?.sales)||0),0);
  const ret=published.map(r=>Number(r.metrics?.retention??r.metrics?.averageRetention??r.metrics?.completionRate)).filter(Number.isFinite);
  const avgRet=ret.length?Math.round(ret.reduce((a,b)=>a+b,0)/ret.length):0;
  $("#analyticsStats").innerHTML=stat("▶","Просмотры",views)+stat("◷","Удержание",avgRet+"%","blue")+stat("↗","Переходы",clicks,"purple")+stat("₽","Продажи",sales);
  const scored=published.filter(r=>r.idea&&r.metrics).map(r=>({r,score:(Number(r.metrics?.retention||0)*4)+(Number(r.metrics?.rewatchRate||0)*2)+(Number(r.metrics?.ctr||0)*3)+Math.log10(Math.max(1,Number(r.metrics?.views)||1))*2})).sort((a,b)=>b.score-a.score);
  $("#insights").innerHTML=scored.length
    ? scored.slice(0,5).map((x,i)=>'<div class="insight-card"><b>'+(i===0?"Лучший паттерн":"Рабочий паттерн")+'</b><p>'+esc(x.r.idea?.mechanic||x.r.idea?.hook||x.r.idea?.title||"Идея")+'</p><small>Просмотры: '+(Number(x.r.metrics?.views)||0)+' · удержание: '+(Number(x.r.metrics?.retention??x.r.metrics?.completionRate)||0)+'% · CTR: '+(Number(x.r.metrics?.ctr)||0)+'%</small></div>').join("")
    : '<div class="insight-card"><b>Learning Loop включён</b><p>Когда у опубликованных роликов появятся метрики, следующие идеи автоматически начнут учитывать сильные и слабые паттерны.</p></div>';
  const recent=videoAnalyses.slice(-4).reverse();
  $("#trendCards").innerHTML='<div class="trend-card"><b>Creative Memory</b><p>Последние идеи не повторяются; рабочие механики возвращаются в генератор как обучающий сигнал.</p></div><div class="trend-card"><b>Competitor Brain · '+videoAnalyses.length+'</b><p>'+(recent.length?esc(recent.map(v=>v.title||v.name||"Разбор").join(" · ")):"Добавь ролики конкурентов — их хуки и структуры попадут в генератор идей.")+'</p></div>';
}
let usdRubAutoLoading=false;
async function ensureUsdRubRate(){
  settings.costRates=settings.costRates||{};
  if(Number(settings.costRates.usdRub)>0||usdRubAutoLoading)return;
  usdRubAutoLoading=true;
  try{
    const r=await fetch("/api/fx/usd-rub",{cache:"no-store"});
    const data=await r.json().catch(()=>({}));
    if(r.ok&&Number(data.rate)>0){
      settings.costRates.usdRub=Number(data.rate);
      settings.costRates.usdRubSource=data.source||"Банк России";
      settings.costRates.usdRubUpdatedAt=data.date||new Date().toISOString();
      saveLocalState();
      renderCosts();
      clearTimeout(syncTimer);
      syncTimer=setTimeout(pushState,100);
    }
  }catch{}finally{usdRubAutoLoading=false}
}
function expenseRubValue(e){
  const rate=Number(settings.costRates?.usdRub)||0;
  return (Number(e.amountRub)||0)+((Number(e.amountUsd)||0)*rate);
}
function fmtMoney(n){return (Math.round((Number(n)||0)*100)/100).toLocaleString("ru-RU",{maximumFractionDigits:2})}
function expenseDate(e){const d=new Date(e.createdAt||0);return Number.isNaN(d.getTime())?null:d}
function renderCosts(){
  settings.costRates=settings.costRates||{usdRub:0,higgsfieldRubPerGeneration:0,runwayRubPerSecond:0,descriptRubPerAction:0};
  const nowD=new Date(),month=nowD.getMonth(),year=nowD.getFullYear(),todayKey=nowD.toISOString().slice(0,10);
  const all=Array.isArray(expenses)?expenses:[];
  const totalRub=all.reduce((sum,e)=>sum+expenseRubValue(e),0);
  const chat=all.filter(e=>e.provider==="OpenAI"&&e.category==="chat");
  const chatRub=chat.reduce((sum,e)=>sum+expenseRubValue(e),0);
  const monthRub=all
    .filter(e=>{const d=expenseDate(e);return d&&d.getMonth()===month&&d.getFullYear()===year})
    .reduce((sum,e)=>sum+expenseRubValue(e),0);
  const monthlyFixed=all
    .filter(e=>e.recurring==="monthly")
    .reduce((sum,e)=>sum+expenseRubValue(e),0);

  const costStats=$("#costStats");
  if(costStats){
    costStats.innerHTML=
      stat("₽","Всего",fmtMoney(totalRub)+" ₽")+
      stat("✦","ChatGPT",fmtMoney(chatRub)+" ₽","blue")+
      stat("◷","Этот месяц",fmtMoney(monthRub)+" ₽","purple")+
      stat("↻","Постоянные / мес.",fmtMoney(monthlyFixed)+" ₽","warn");
  }

  const providers=["OpenAI","Higgsfield","Runway","Descript","Railway","Supabase","n8n","Google Drive","Другое"];
  const providerCards=$("#expenseProviderCards");
  if(providerCards){
    providerCards.innerHTML=providers.map(provider=>{
      const rows=all.filter(e=>e.provider===provider);
      const rub=rows.reduce((sum,e)=>sum+expenseRubValue(e),0);
      const usd=rows.reduce((sum,e)=>sum+(Number(e.amountUsd)||0),0);
      const usage=rows.filter(e=>!["subscription","topup","payment-fee"].includes(String(e.category||""))).length;
      return '<div class="expense-provider-card">'+
        '<div><b>'+esc(provider)+'</b><small>'+usage+' операций</small></div>'+
        '<strong>'+fmtMoney(rub)+' ₽</strong>'+
        (usd?'<em>$'+usd.toFixed(2)+'</em>':'')+
      '</div>';
    }).join("");
  }

  const billing=settings.providerBilling&&typeof settings.providerBilling==="object"?settings.providerBilling:{};
  const funding=all.filter(e=>["subscription","topup","payment-fee"].includes(String(e.category||"")));
  const billingSummary=$("#billingSummary");
  if(billingSummary){
    const fundingHtml=funding.slice().reverse().map(e=>{
      const rub=expenseRubValue(e);
      const recurring=e.recurring==="monthly"?" / мес.":"";
      return '<div class="billing-item">'+
        '<div><b>'+esc(e.provider||"Сервис")+'</b><small>'+esc(e.description||"")+'</small></div>'+
        '<div><strong>'+fmtMoney(rub)+' ₽</strong>'+
          (Number(e.amountUsd)?'<small>$'+Number(e.amountUsd).toFixed(2)+recurring+'</small>':'')+
        '</div>'+
      '</div>';
    }).join("");

    const balanceParts=[];
    const runwayApiCreditError=runs.some(r=>/runway[^\n]*not enough credits|not enough credits[^\n]*runway/i.test(String(r?.error||r?.generationError||"")));
    const higgsfieldApiCreditError=runs.some(r=>/higgsfield[^\n]*(credit balance is too low|not enough credits|insufficient credits)/i.test(String(r?.error||r?.generationError||"")));
    if(billing.higgsfield){
      balanceParts.push(
        '<div class="billing-balance"><b>Higgsfield Web / MCP</b><span>'+
        esc(billing.higgsfield.plan||"")+' · '+esc(billing.higgsfield.credits||0)+' кредитов · не API-баланс'+
        '</span></div>'
      );
    }
    if(billing.runway){
      balanceParts.push(
        '<div class="billing-balance"><b>Runway Web</b><span>'+
        esc(billing.runway.plan||"")+' · '+esc(billing.runway.totalCredits||0)+' кредитов ('+
        esc(billing.runway.planCredits||0)+' тариф + '+esc(billing.runway.purchasedCredits||0)+' куплено) · не API-баланс'+
        '</span></div>'
      );
    }
    balanceParts.push(
      '<div class="billing-balance"><b>Content Factory API</b><span>'+
      'Runway Dev: '+(runwayApiCreditError?'недостаточно кредитов':'отдельный баланс')+
      ' · Higgsfield API: '+(higgsfieldApiCreditError?'недостаточно средств':'отдельный prepaid-баланс')+
      '</span></div>'
    );

    billingSummary.innerHTML=
      (fundingHtml||'<div class="empty compact-empty">Подписок и пополнений пока нет.</div>')+
      (balanceParts.length?'<div class="billing-balances">'+balanceParts.join("")+'</div>':'');
  }

  const usdRate=$("#usdRubRate");
  if(usdRate){
    usdRate.value=settings.costRates.usdRub||"";
    usdRate.title=settings.costRates.usdRubSource
      ?("Авто: "+settings.costRates.usdRubSource+(settings.costRates.usdRubUpdatedAt?" · "+settings.costRates.usdRubUpdatedAt:""))
      :"";
  }
  if($("#higgsfieldRate"))$("#higgsfieldRate").value=settings.costRates.higgsfieldRubPerGeneration||0;
  if($("#runwayRate"))$("#runwayRate").value=settings.costRates.runwayRubPerSecond||0;
  if($("#descriptRate"))$("#descriptRate").value=settings.costRates.descriptRubPerAction||0;
  if($("#budgetCampaign"))$("#budgetCampaign").value=settings.budgetCampaign||5000;
  if($("#budgetAttempts"))$("#budgetAttempts").value=settings.budgetAttempts||3;
  if($("#budgetApproval"))$("#budgetApproval").value=settings.budgetApproval||100;

  const pf=$("#costProviderFilter");
  if(pf&&pf.options.length<=1){
    providers.forEach(provider=>pf.insertAdjacentHTML("beforeend",'<option value="'+esc(provider)+'">'+esc(provider)+'</option>'));
  }
  const provider=pf?.value||"";
  const period=$("#costPeriodFilter")?.value||"all";
  let rows=all.slice();
  if(provider)rows=rows.filter(e=>e.provider===provider);
  if(period==="month")rows=rows.filter(e=>{const d=expenseDate(e);return d&&d.getMonth()===month&&d.getFullYear()===year});
  if(period==="today")rows=rows.filter(e=>(e.createdAt||"").slice(0,10)===todayKey);

  const costRows=$("#costRows");
  if(costRows){
    costRows.innerHTML=rows.slice().reverse().slice(0,200).map(e=>{
      const d=expenseDate(e),rub=expenseRubValue(e);
      const usage=e.usage
        ?Object.entries(e.usage).filter(([,v])=>typeof v!=="object").map(([k,v])=>k+": "+v).join(" · ")
        :"";
      return '<div class="expense-row">'+
        '<div class="expense-main"><span class="expense-provider-badge">'+esc(e.provider||"Другое")+'</span>'+
          '<div><h3>'+esc(e.description||"Расход")+'</h3><p>'+
          esc((d?d.toLocaleString("ru-RU"):"")+(e.model?" · "+e.model:"")+(usage?" · "+usage:""))+
          '</p></div></div>'+
        '<div class="expense-amount"><b>'+fmtMoney(rub)+' ₽</b>'+
          (Number(e.amountUsd)?'<small>$'+Number(e.amountUsd).toFixed(5)+'</small>':'')+
          '<button class="tiny-btn danger-mini" onclick="deleteExpense(\''+e.id+'\')">Удалить</button>'+
        '</div>'+
      '</div>';
    }).join("")||'<div class="empty">Расходов пока нет.</div>';
  }
}

$("#saveBudget").onclick=()=>{
  settings.costRates=settings.costRates||{};
  settings.costRates.usdRub=Number($("#usdRubRate").value)||0;
  settings.costRates.higgsfieldRubPerGeneration=Number($("#higgsfieldRate").value)||0;
  settings.costRates.runwayRubPerSecond=Number($("#runwayRate").value)||0;
  settings.costRates.descriptRubPerAction=Number($("#descriptRate").value)||0;
  settings.budgetCampaign=Number($("#budgetCampaign").value)||5000;
  settings.budgetAttempts=Number($("#budgetAttempts").value)||3;
  settings.budgetApproval=Number($("#budgetApproval").value)||100;
  log("Обновлены тарифы и лимиты","Курс USD/RUB: "+(settings.costRates.usdRub||"не задан"));
  persist();
};
$("#costProviderFilter")?.addEventListener("change",renderCosts);
$("#costPeriodFilter")?.addEventListener("change",renderCosts);
$("#addExpenseBtn")?.addEventListener("click",()=>{if($("#expenseMessage"))$("#expenseMessage").textContent="";openM("expenseModal")});
$("#saveExpenseBtn")?.addEventListener("click",async()=>{
  const msg=$("#expenseMessage"),btn=$("#saveExpenseBtn");btn.disabled=true;if(msg)msg.textContent="Сохраняю…";
  try{
    const r=await fetch("/api/expenses",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      accountId:activeAccountId,provider:$("#expenseProvider").value,description:$("#expenseDescription").value.trim()||"Ручной расход",
      amountRub:Number($("#expenseRub").value)||0,amountUsd:Number($("#expenseUsd").value)||0,recurring:$("#expenseRecurring").value
    })});
    const data=await r.json();if(!r.ok)throw new Error(data.error||data.detail||"Ошибка");
    closeM("expenseModal");await syncFromServer();go("costs");
  }catch(e){if(msg)msg.textContent=String(e?.message||e)}finally{btn.disabled=false}
});
window.deleteExpense=async id=>{if(await deleteFactoryEntity("expense",id,"расход"))renderCosts()};

let chatHistory=load(chatLocalKey(),[]);
let chatDraftAttachments=[];
let chatCloudSyncing=false;
let chatRevision=0;

async function saveCloudChatHistory(){
  try{
    const r=await fetch("/api/chat/history",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({
      accountId:activeAccountId,
      history:chatHistory.slice(-200)
    })});
    return r.ok;
  }catch{return false}
}

async function syncChatHistoryFromCloud(){
  if(chatCloudSyncing)return;
  chatCloudSyncing=true;
  const startedRevision=chatRevision;
  const accountAtStart=activeAccountId;
  try{
    const r=await fetch("/api/chat/history?account="+encodeURIComponent(accountAtStart),{cache:"no-store",headers:{"x-content-account":accountAtStart}});
    if(!r.ok)return;
    const data=await r.json();
    if(accountAtStart!==activeAccountId||startedRevision!==chatRevision)return;
    const local=Array.isArray(chatHistory)?chatHistory:[];
    if(data.hasCloudHistory){
      chatHistory=Array.isArray(data.history)?data.history:[];
      save(chatLocalKey(),chatHistory);
      renderChat();
    }else if(local.length){
      chatHistory=local.slice(-200);
      await saveCloudChatHistory();
      save(chatLocalKey(),chatHistory);
      renderChat();
    }
  }catch{}finally{
    chatCloudSyncing=false;
  }
}
let chatUploadBusy=false;

function attachmentIcon(a){
  if(a?.kind==="image")return "🖼";
  const ext=String(a?.name||"").split(".").pop().toLowerCase();
  if(ext==="pdf")return "📕";
  if(["xls","xlsx","csv"].includes(ext))return "📊";
  if(["doc","docx","txt","md"].includes(ext))return "📄";
  return "📎";
}
function renderChatAttachmentDraft(){
  const html=chatDraftAttachments.map((a,i)=>
    '<div class="chat-attachment-chip">'+
      (a.previewUrl?'<img src="'+a.previewUrl+'" alt="">':'<span>'+attachmentIcon(a)+'</span>')+
      '<b>'+esc(a.name)+'</b>'+
      '<button type="button" onclick="removeChatDraftAttachment('+i+')" aria-label="Убрать вложение">×</button>'+
    '</div>'
  ).join("");
  $$(".chat-attachment-draft").forEach(el=>{
    el.innerHTML=html;
    el.classList.toggle("has-files",!!html);
  });
}
window.removeChatDraftAttachment=i=>{
  const item=chatDraftAttachments[i];
  if(item?.previewUrl)URL.revokeObjectURL(item.previewUrl);
  chatDraftAttachments.splice(i,1);
  renderChatAttachmentDraft();
};

async function uploadChatFile(file){
  if(file.size>15*1024*1024)throw new Error(file.name+": больше 15 МБ");
  const dataBase64=await fileDataUrl(file);
  const r=await fetch("/api/chat/upload",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({fileName:file.name,mimeType:file.type||"application/octet-stream",dataBase64,accountId:activeAccountId})
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok||!data.attachment)throw new Error(data.detail||data.error||"Ошибка загрузки "+file.name);
  return {
    ...data.attachment,
    previewUrl:String(file.type||"").startsWith("image/")?URL.createObjectURL(file):""
  };
}
async function addChatFiles(files){
  const list=[...files].slice(0,Math.max(0,4-chatDraftAttachments.length));
  if(!list.length)return;
  chatUploadBusy=true;
  const status=$("#chatStatus");if(status)status.textContent="Загружаю вложение…";
  try{
    for(const file of list){
      const uploaded=await uploadChatFile(file);
      chatDraftAttachments.push(uploaded);
      renderChatAttachmentDraft();
    }
  }catch(err){
    alert(String(err?.message||err));
  }finally{
    chatUploadBusy=false;
    refreshChatStatus();
  }
}
$$("[data-chat-attach]").forEach(btn=>btn.addEventListener("click",()=>$("#chatFileInput")?.click()));
$("#chatFileInput")?.addEventListener("change",e=>{addChatFiles(e.target.files);e.target.value=""});

function renderChat(){
  const box=$("#chatMessages");
  if(!box)return;
  if(!chatHistory.length){
    box.innerHTML='<div class="chat-bubble assistant"><b>ChatGPT</b><p>Готов управлять Content Factory. Можно писать текст, прикреплять фото, PDF и документы.</p></div>';
    return;
  }
  box.innerHTML=chatHistory.map(m=>{
    const attachments=(m.attachments||[]).map(a=>
      '<span class="chat-history-file">'+attachmentIcon(a)+' '+esc(a.name||"Файл")+'</span>'
    ).join("");
    const images=(m.images||[]).filter(x=>x?.url).map(img=>
      '<a class="chat-generated-image" href="'+esc(img.url)+'" target="_blank" rel="noopener"><img src="'+esc(img.url)+'" alt="'+esc(img.name||"AI image")+'"></a>'
    ).join("");
    return '<div class="chat-bubble '+(m.role==="user"?"user":"assistant")+'"><b>'+(m.role==="user"?"Ты":"ChatGPT")+'</b>'+
      (m.content?'<p>'+esc(m.content)+'</p>':'')+
      (attachments?'<div class="chat-history-files">'+attachments+'</div>':'')+
      (images?'<div class="chat-generated-images">'+images+'</div>':'')+
    '</div>';
  }).join("");
  box.scrollTop=box.scrollHeight;
}
async function refreshChatStatus(){
  const el=$("#chatStatus"); if(!el)return;
  try{
    const s=await (await fetch("/api/status",{cache:"no-store"})).json();
    const ok=s.services?.openai&&s.services?.chatgptControl;
    el.textContent=ok?"Подключён к OpenAI API":"Ожидает OpenAI API";
    el.className=ok?"chat-online":"chat-offline";
  }catch{el.textContent="Статус недоступен"}
}
async function sendChatMessage(raw,input=null){
  const message=String(raw||"").trim();
  if(chatUploadBusy)return;
  if(!message&&!chatDraftAttachments.length)return;
  const previous=chatHistory.slice(-12);
  const sentAttachments=chatDraftAttachments.map(({previewUrl,...a})=>a);
  chatDraftAttachments.forEach(a=>{if(a.previewUrl)URL.revokeObjectURL(a.previewUrl)});
  chatDraftAttachments=[];
  renderChatAttachmentDraft();

  chatHistory.push({role:"user",content:message,attachments:sentAttachments});
  chatRevision++;
  save(chatLocalKey(),chatHistory.slice(-200));
  if(input)input.value="";
  go("assistant",{skipChatSync:true});
  renderChat();
  await saveCloudChatHistory();
  const status=$("#chatStatus"); if(status)status.textContent="Думаю…";
  try{
    const r=await fetch("/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      message,history:previous,attachments:sentAttachments,accountId:activeAccountId
    })});
    const data=await r.json().catch(()=>({}));
    chatHistory.push({
      role:"assistant",
      content:r.ok?(data.text||"Готово."):(data.detail||data.error||"Ошибка подключения"),
      images:r.ok&&Array.isArray(data.images)?data.images:[]
    });
  }catch(err){
    chatHistory.push({role:"assistant",content:"Ошибка связи: "+String(err?.message||err)});
  }
  chatRevision++;
  save(chatLocalKey(),chatHistory.slice(-200));
  await saveCloudChatHistory();
  await syncFromServer();
  renderChat();
  refreshChatStatus();
}
if($("#chatForm"))$("#chatForm").onsubmit=e=>{
  e.preventDefault();
  const input=$("#chatInput");
  sendChatMessage(input?.value,input);
};
$("#mobileChatDockOpen")?.addEventListener("click",()=>go("assistant"));
if($("#clearChat"))$("#clearChat").onclick=async()=>{
  chatHistory=[];
  chatRevision++;
  save(chatLocalKey(),chatHistory);
  renderChat();
  try{await fetch("/api/chat/history?account="+encodeURIComponent(activeAccountId),{method:"DELETE"})}catch{}
};
function activeAccount(){
  return accounts.find(x=>x.id===activeAccountId)||accounts[0]||null;
}
function accountInitial(a){
  return String(a?.name||a?.owner||'A').trim().charAt(0).toUpperCase()||'A';
}
async function loadAccounts(){
  try{
    const r=await fetch("/api/accounts",{cache:"no-store"});
    const data=await r.json();
    if(!r.ok||!Array.isArray(data.accounts))return;
    accounts=data.accounts;
    if(!accounts.some(x=>x.id===activeAccountId)){
      activeAccountId=accounts[0]?.id||"main";
      save("cf_active_account",activeAccountId);
    }
    renderAccounts();
    renderAccountChrome();
  }catch{}
}
function accountAvatarHtml(a){return a?.avatarUrl?'<img src="'+esc(a.avatarUrl)+'" alt="">':esc(accountInitial(a))}
async function saveAccountPatch(patch){
  const r=await fetch("/api/accounts",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({id:activeAccountId,...patch})});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.error||data.detail||"Ошибка сохранения");
  await loadAccounts();
  return data.account;
}
async function uploadAccountPhoto(file){
  if(!file||!String(file.type||"").startsWith("image/"))throw new Error("Выбери изображение.");
  if(file.size>10*1024*1024)throw new Error("Фото больше 10 МБ.");
  const dataBase64=await fileDataUrl(file);
  const resp=await fetch("/api/media/upload",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
    accountId:activeAccountId,productId:"account-"+activeAccountId,fileName:file.name,mimeType:file.type||"image/jpeg",dataBase64
  })});
  const body=await resp.json().catch(()=>({}));
  if(!resp.ok||!body.media)throw new Error(body.detail||body.error||"Ошибка загрузки фото");
  const prev=activeAccount();
  if(prev?.avatarPath&&prev.avatarPath!==body.media.path){
    fetch("/api/media/delete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accountId:activeAccountId,path:prev.avatarPath})}).catch(()=>{});
  }
  await saveAccountPatch({avatarUrl:body.media.url||"",avatarPath:body.media.path||""});
}
function renderAccountChrome(){
  const a=activeAccount();
  document.querySelectorAll(".account-avatar").forEach(el=>{el.innerHTML=accountAvatarHtml(a)});
  const side=$("#accountSideName");if(side)side.textContent=a?.name||"Основной аккаунт";
  const mobileName=$("#mobileAccountName");if(mobileName)mobileName.textContent=a?.name||"Основной";
  const desktopName=$("#desktopAccountName");if(desktopName)desktopName.textContent=a?.name||"Основной аккаунт";
  const photo=$("#accountPhotoImage"),fallback=$("#accountPhotoFallback");
  if(photo&&fallback){
    if(a?.avatarUrl){photo.src=a.avatarUrl;photo.hidden=false;fallback.hidden=true}
    else{photo.removeAttribute("src");photo.hidden=true;fallback.hidden=false;fallback.textContent=accountInitial(a)}
  }
}
function renderAccounts(){
  const list=$("#accountList"); if(!list)return;
  list.innerHTML=accounts.map(a=>'<button class="account-card '+(a.id===activeAccountId?'active':'')+'" onclick="switchAccount(\''+a.id+'\')"><span class="account-card-avatar">'+accountAvatarHtml(a)+'</span><span><b>'+esc(a.name||'Аккаунт')+'</b><small>'+esc(a.company||a.owner||'Отдельное рабочее пространство')+'</small></span><em>'+(a.id===activeAccountId?'Активен':'Переключить')+'</em></button>').join("");
  const a=activeAccount();
  if(!a)return;
  if($("#accountName"))$("#accountName").value=a.name||"";
  if($("#accountOwner"))$("#accountOwner").value=a.owner||"";
  if($("#accountCompany"))$("#accountCompany").value=a.company||"";
  if($("#accountEmail"))$("#accountEmail").value=a.email||"";
  if($("#accountPhone"))$("#accountPhone").value=a.phone||"";
  if($("#accountNotes"))$("#accountNotes").value=a.notes||"";
  if($("#accountMemory"))$("#accountMemory").value=a.memory||"";
  if($("#deleteAccount"))$("#deleteAccount").style.display=a.id==="main"?"none":"inline-flex";
  renderAccountChrome();
}
function loadLocalAccountState(){
  products=load(accountLocalKey("cf_products"),[]);
  runs=load(accountLocalKey("cf_runs"),[]);
  campaigns=load(accountLocalKey("cf_campaigns"),[]);
  scripts=load(accountLocalKey("cf_scripts"),[]);
  characters=load(accountLocalKey("cf_characters"),[]);
  journal=load(accountLocalKey("cf_journal"),[]);
  expenses=load(accountLocalKey("cf_expenses"),[]);
  videoAnalyses=load(accountLocalKey("cf_video_analyses"),[]);
  settings=load(accountLocalKey("cf_settings"),{mode:"auto",budgetCampaign:5000,budgetAttempts:3,budgetApproval:100});
  chatHistory=load(chatLocalKey(),[]);
  chatRevision++;
  chatDraftAttachments.forEach(a=>{if(a.previewUrl)URL.revokeObjectURL(a.previewUrl)});
  chatDraftAttachments=[];
  renderChatAttachmentDraft();
  selectedProductId=products[0]?.id||null;
  selectedRunId=runs.at(-1)?.id||null;
  createMode=settings.mode||"auto";
}
window.switchAccount=async id=>{
  if(id===activeAccountId){go("account");return}
  await pushState();
  activeAccountId=id;
  save("cf_active_account",activeAccountId);
  loadLocalAccountState();
  renderAll();
  await syncFromServer();
  await syncChatHistoryFromCloud();
  renderAccountChrome();
  go("home");
};
$("#addAccount")?.addEventListener("click",()=>{
  if($("#newAccountName"))$("#newAccountName").value="";
  if($("#newAccountOwner"))$("#newAccountOwner").value=activeAccount()?.owner||"Алексей";
  if($("#newAccountCompany"))$("#newAccountCompany").value="";
  if($("#createAccountMessage"))$("#createAccountMessage").textContent="";
  openM("accountModal");
});
$("#createAccountBtn")?.addEventListener("click",async()=>{
  const btn=$("#createAccountBtn"),msg=$("#createAccountMessage");
  const name=$("#newAccountName")?.value.trim();
  if(!name){if(msg)msg.textContent="Укажи название аккаунта.";return}
  btn.disabled=true;if(msg)msg.textContent="Создаю…";
  try{
    const r=await fetch("/api/accounts",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      name,
      owner:$("#newAccountOwner")?.value.trim()||"",
      company:$("#newAccountCompany")?.value.trim()||""
    })});
    const data=await r.json();
    if(!r.ok)throw new Error(data.error||data.detail||"Ошибка создания");
    await loadAccounts();
    closeM("accountModal");
    await switchAccount(data.account.id);
  }catch(e){if(msg)msg.textContent=String(e?.message||e)}
  finally{btn.disabled=false}
});
$("#accountPhotoInput")?.addEventListener("change",async e=>{
  const file=e.target.files?.[0],msg=$("#accountMessage");if(!file)return;
  if(msg)msg.textContent="Загружаю фото…";
  try{await uploadAccountPhoto(file);if(msg)msg.textContent="Фото аккаунта сохранено."}
  catch(err){if(msg)msg.textContent=String(err?.message||err)}
  e.target.value="";
});
$("#removeAccountPhoto")?.addEventListener("click",async()=>{
  const a=activeAccount(),msg=$("#accountMessage");
  try{
    if(a?.avatarPath)await fetch("/api/media/delete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({accountId:activeAccountId,path:a.avatarPath})}).catch(()=>{});
    await saveAccountPatch({avatarUrl:"",avatarPath:""});
    if(msg)msg.textContent="Фото удалено.";
  }catch(err){if(msg)msg.textContent=String(err?.message||err)}
});
$("#accountProfileForm")?.addEventListener("submit",async e=>{
  e.preventDefault();
  const msg=$("#accountMessage");if(msg)msg.textContent="Сохраняю…";
  try{
    const r=await fetch("/api/accounts",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({
      id:activeAccountId,
      name:$("#accountName")?.value.trim()||"",
      owner:$("#accountOwner")?.value.trim()||"",
      company:$("#accountCompany")?.value.trim()||"",
      email:$("#accountEmail")?.value.trim()||"",
      phone:$("#accountPhone")?.value.trim()||"",
      notes:$("#accountNotes")?.value.trim()||"",
      memory:$("#accountMemory")?.value.trim()||""
    })});
    const data=await r.json();
    if(!r.ok)throw new Error(data.error||data.detail||"Ошибка сохранения");
    await loadAccounts();
    if(msg)msg.textContent="Сохранено.";
  }catch(e){if(msg)msg.textContent=String(e?.message||e)}
});
$("#deleteAccount")?.addEventListener("click",async()=>{
  const a=activeAccount();if(!a||a.id==="main")return;
  if(!confirm('Удалить аккаунт «'+a.name+'» и его рабочие данные?'))return;
  const r=await fetch("/api/accounts?id="+encodeURIComponent(a.id),{method:"DELETE"});
  const data=await r.json().catch(()=>({}));
  if(!r.ok){if($("#accountMessage"))$("#accountMessage").textContent=data.error||"Не удалось удалить.";return}
  activeAccountId="main";save("cf_active_account",activeAccountId);
  await loadAccounts();loadLocalAccountState();await syncFromServer();go("account");
});

function renderJournal(){$("#journalList").innerHTML=journal.length?journal.slice().reverse().map(j=>'<div class="journal-row '+(j.type==="error"?"error":"")+'"><span class="journal-time">'+esc(j.time)+'</span><span class="journal-dot"></span><span><b>'+esc(j.title)+'</b><small>'+esc(j.detail||"")+'</small></span><button class="tiny-btn danger-mini journal-delete" onclick="deleteJournalEntry(\''+j.id+'\')">Удалить</button></div>').join(""):'<div class="empty">Журнал пока пуст.</div>'}
async function renderConnections(){
  let s={services:{},details:{}};
  try{s=await (await fetch("/api/status",{cache:"no-store"})).json()}catch{}
  if($("#appVersion")&&s.version)$("#appVersion").textContent="v"+String(s.version)+(s.build&&s.build!=="dev"?" · "+String(s.build):"");
  const D=s.details||{};
  const R=[
    ["Railway","railway"],
    ["GitHub","github"],
    ["Supabase","supabase"],
    ["n8n + PostgreSQL","n8n"],
    ["Google Drive","drive"],
    ["Higgsfield API","higgsfield"],
    ["OpenAI API","openai"],
    ["ChatGPT внутри Content Factory","chatgpt"],
    ["FFmpeg / Remotion","assembly"],
    ["Runway","runway"],
    ["Descript","descript"],
    ["TikTok / Instagram / YouTube","socials"]
  ];
  const fallback={state:"missing",description:"Статус недоступен",detail:"Не удалось получить данные",next:"Проверить backend"};
  const statusMeta=state=>state==="connected"?["done","Подключено","on"]:state==="partial"?["work","Частично","partial"]:["wait","Не подключено",""];
  $("#connections").innerHTML=R.map(([name,key])=>{
    const x=D[key]||fallback;
    const [statusClass,label,dotClass]=statusMeta(x.state);
    return '<div class="conn conn-detailed"><div class="conn-left"><span class="dot '+dotClass+'"></span><span><b>'+esc(name)+'</b><small>'+esc(x.description||"")+'</small>'+(x.detail?'<small class="conn-note">'+esc(x.detail)+'</small>':'')+(x.next?'<small class="conn-next">Следующий шаг: '+esc(x.next)+'</small>':'')+'</span></div><span class="status '+statusClass+'">'+label+'</span></div>'
  }).join("");
  $$(".mode-card[data-mode]").forEach(b=>b.classList.toggle("active",b.dataset.mode===settings.mode))
}
$$(".mode-card[data-mode]").forEach(b=>b.onclick=()=>{settings.mode=b.dataset.mode;createMode=settings.mode;log("Изменён режим производства",settings.mode==="auto"?"Автопилот":"Ручной контроль");persist()});$$(".mode-card[data-create-mode]").forEach(b=>b.onclick=()=>{$$(".mode-card[data-create-mode]").forEach(x=>x.classList.remove("active"));b.classList.add("active");createMode=b.dataset.createMode});
function renderSearch(q=""){const z=q.trim().toLowerCase(),I=[...products.map(x=>({t:"Товар",n:x.name,s:x.category,a:"openProduct('"+x.id+"')"})),...runs.map(x=>({t:"Ролик",n:pname(x),s:norm(x)+" · "+(x.style||""),a:"openRun('"+x.id+"')"})),...campaigns.map(x=>({t:"Кампания",n:x.name,s:prod(x.productId)?.name||"",a:"go('campaigns')"})),...scripts.map(x=>({t:"Сценарий",n:x.title,s:x.hook||"",a:"go('scripts')"})),...characters.map(x=>({t:"Персонаж",n:x.name,s:x.look||"",a:"go('characters')"}))].filter(x=>!z||(x.n+" "+x.s+" "+x.t).toLowerCase().includes(z)).slice(0,30);$("#searchResults").innerHTML=I.length?I.map(x=>'<button class="search-result" onclick="closeModal(\'searchModal\');'+x.a+'"><b>'+esc(x.n)+'</b><small>'+x.t+" · "+esc(x.s)+'</small></button>').join(""):'<div class="empty">Ничего не найдено.</div>'}
$("#openSearch").onclick=()=>{openM("searchModal");setTimeout(()=>$("#searchInput").focus(),50);renderSearch("")};$("#searchInput").oninput=e=>renderSearch(e.target.value);document.addEventListener("keydown",e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openM("searchModal");$("#searchInput").focus()}});
async function api(payload){try{const r=await fetch("/api/start",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});return{ok:r.ok,body:await r.json().catch(()=>({}))}}catch(e){return{ok:false,body:{error:String(e)}}}}
$("#launch").onclick=async()=>{
  if(!products.length)return alert("Сначала добавь товар.");
  const platforms=$$("[data-p]:checked").map(x=>x.dataset.p),n=Math.max(1,parseInt($("#count").value)||1);
  const chosenProduct=prod($("#productSelect").value)||null;
  const productMedia=(chosenProduct?.media||[]).map(m=>({id:m.id,url:m.url,path:m.path,isPrimary:!!m.isPrimary}));
  const chosenCharacter=characters.find(c=>c.id===$("#characterSelect").value)||null;
  const characterPayload=chosenCharacter?{id:chosenCharacter.id,name:chosenCharacter.name,age:chosenCharacter.age||"",look:chosenCharacter.look||"",voice:chosenCharacter.voice||"",topics:chosenCharacter.topics||"",locks:chosenCharacter.locks||"",media:(chosenCharacter.media||[]).map(m=>({id:m.id,url:m.url,path:m.path,isPrimary:!!m.isPrimary}))}:null;
  const base={accountId:activeAccountId,batchId:uid("batch"),productId:$("#productSelect").value,productName:chosenProduct?.name||"Товар",productUtp:chosenProduct?.utp||"",productRules:chosenProduct?.rules||"",media:productMedia,product:{id:chosenProduct?.id||null,name:chosenProduct?.name||"Товар",utp:chosenProduct?.utp||"",rules:chosenProduct?.rules||"",media:productMedia,defaultCharacterId:chosenProduct?.defaultCharacterId||null},campaignId:$("#campaignSelect").value||null,characterId:chosenCharacter?.id||null,characterOverride:true,character:characterPayload,avatarReferences:characterPayload?.media||[],brief:$("#brief").value.trim(),style:$("#style").value,duration:$("#duration").value,count:String(n),format:$("#format").value,platforms,mode:createMode,modelMode:$("#modelMode").value,budget:Number($("#runBudget").value)||500,maxAttempts:Number($("#runAttempts").value)||3,created:now()};
  $("#launch").disabled=true;$("#launchMsg").textContent=createMode==="manual"?"Создаю идею для ручного подтверждения…":"Запускаю автопилот: идея → сценарий → storyboard → по 2 START/END превиз-кадра на сцену → видео…";
  try{
    const r=await fetch("/api/start",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"create_batch",...base})});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data.detail||data.error||"Не удалось запустить");
    await syncFromServer();
    selectedRunId=data.runs?.[0]?.id||runs.at(-1)?.id||null;
    $("#launchMsg").textContent="Запуск создан. Открываю отчёт по этапам…";
    setTimeout(()=>{closeM("createModal");runStageOpen="Идея";if(selectedRunId)openRun(selectedRunId);else go("production")},450);
  }catch(e){
    $("#launchMsg").textContent=String(e?.message||e);
  }finally{$("#launch").disabled=false}
};
function renderAll(){opts();renderDashboard();renderProduction();renderIdeas();renderBackground();renderProducts();renderProductDetail();renderCampaigns();renderRuns();renderRunDetail();renderScripts();renderMediaLibraries();renderCharacters();renderVideoLab();renderPublish();renderCalendar();renderAnalytics();renderCosts();renderJournal();renderChat();renderAccounts();refreshChatStatus();renderConnections();polishRenderedUI()}
if("serviceWorker" in navigator){
  navigator.serviceWorker.getRegistrations().then(rs=>Promise.all(rs.map(r=>r.unregister()))).catch(()=>{});
}
if("caches" in window)caches.keys().then(keys=>Promise.all(keys.map(k=>caches.delete(k)))).catch(()=>{});
window.addEventListener("pageshow",()=>{window.scrollTo({top:0,left:0,behavior:"instant"})},{once:true});

let authMode='login';
let currentAuthUser=null;
function setAuthMode(mode){
  authMode=mode==='register'?'register':mode==='forgot'?'forgot':'login';
  $$("[data-auth-mode]").forEach(b=>b.classList.toggle("active",b.dataset.authMode===authMode));
  if($("#authTabs"))$("#authTabs").hidden=authMode==="forgot";
  if($("#authPasswordField"))$("#authPasswordField").hidden=authMode==="forgot";
  if($("#authForgot"))$("#authForgot").hidden=authMode!=="login";
  if($("#authBack"))$("#authBack").hidden=authMode!=="forgot";
  if($("#authSubmit"))$("#authSubmit").textContent=authMode==="register"?"Создать аккаунт":authMode==="forgot"?"Отправить ссылку":"Войти";
  if($("#authPassword")){
    $("#authPassword").autocomplete=authMode==="register"?"new-password":"current-password";
    $("#authPassword").required=authMode!=="forgot";
  }
  if($("#authLogin")){
    $("#authLogin").placeholder="name@example.com";
    $("#authLogin").autocomplete="email";
  }
  if($("#authNote"))$("#authNote").textContent=authMode==="forgot"
    ?"На почту придёт одноразовая ссылка для создания нового пароля."
    :"Вход и регистрация по почте и паролю. Для каждого пользователя — отдельный личный кабинет.";
  if($("#authMessage"))$("#authMessage").textContent="";
}
$$("[data-auth-mode]").forEach(b=>b.addEventListener("click",()=>setAuthMode(b.dataset.authMode)));
$("#authForgot")?.addEventListener("click",()=>setAuthMode("forgot"));
$("#authBack")?.addEventListener("click",()=>setAuthMode("login"));
$("#authPasswordToggle")?.addEventListener("click",()=>{
  const input=$("#authPassword"),btn=$("#authPasswordToggle");
  if(!input||!btn)return;
  const show=input.type==="password";
  input.type=show?"text":"password";
  btn.textContent=show?"Скрыть":"Показать";
  btn.setAttribute("aria-label",show?"Скрыть пароль":"Показать пароль");
});
$("#authForm")?.addEventListener("submit",async e=>{
  e.preventDefault();
  const btn=$("#authSubmit"),msg=$("#authMessage"),email=$("#authLogin").value.trim();
  btn.disabled=true;
  msg.textContent=authMode==="register"?"Создаю кабинет…":authMode==="forgot"?"Отправляю ссылку…":"Вхожу…";
  try{
    if(authMode==="forgot"){
      const r=await fetch("/api/auth/forgot-password",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email})});
      const data=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(data.error||data.detail||"Ошибка восстановления");
      msg.textContent=data.message||"Если аккаунт существует, ссылка отправлена на почту.";
      return;
    }
    const r=await fetch("/api/auth/"+authMode,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      email,
      password:$("#authPassword").value
    })});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data.error||data.detail||"Ошибка авторизации");
    location.reload();
  }catch(err){msg.textContent=String(err?.message||err)}
  finally{btn.disabled=false}
});
$("#logoutBtn")?.addEventListener("click",async()=>{
  try{await fetch("/api/auth/logout",{method:"POST"})}catch{}
  location.reload();
});
async function refreshAppVersion(){
  try{
    const s=await (await fetch("/api/health?ts="+Date.now(),{cache:"no-store"})).json();
    if($("#appVersion")&&s?.version)$("#appVersion").textContent="v"+String(s.version)+(s.build&&s.build!=="dev"?" · "+String(s.build):"");
  }catch{}
}
async function bootAuthenticatedApp(){
  refreshAppVersion();
  try{
    const r=await fetch("/api/auth/me",{cache:"no-store"});
    if(!r.ok){$("#authGate")?.classList.add("show");return}
    const data=await r.json();
    currentAuthUser=data.user||null;
    $("#authGate")?.classList.remove("show");
    renderAll();
    await loadAccounts();
    await syncFromServer();
    await syncChatHistoryFromCloud();
  }catch{
    $("#authGate")?.classList.add("show");
  }
}
setAuthMode("login");
bootAuthenticatedApp();
setInterval(()=>{if(document.visibilityState==="visible"&&runs.some(r=>r.status==="В работе"))syncFromServer()},4000);

