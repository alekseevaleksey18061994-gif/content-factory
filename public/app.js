
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
let products=load(accountLocalKey("cf_products"),[]),runs=load(accountLocalKey("cf_runs"),[]),campaigns=load(accountLocalKey("cf_campaigns"),[]),scripts=load(accountLocalKey("cf_scripts"),[]),characters=load(accountLocalKey("cf_characters"),[]),journal=load(accountLocalKey("cf_journal"),[]),expenses=load(accountLocalKey("cf_expenses"),[]),settings=load(accountLocalKey("cf_settings"),{mode:"auto",budgetCampaign:5000,budgetAttempts:3,budgetApproval:100,costRates:{usdRub:0,higgsfieldRubPerGeneration:0,runwayRubPerSecond:0,descriptRubPerAction:0}});
let selectedProductId=products[0]?.id||null,selectedRunId=runs.at(-1)?.id||null,createMode=settings.mode||"auto";
const ST=["Идея","Сценарий","Storyboard","Референсы","Генерация","Озвучка","Монтаж","AI-проверка","На проверке","Готово","Запланировано","Опубликовано"];
const prod=id=>products.find(x=>x.id===id),camp=id=>campaigns.find(x=>x.id===id);
const pname=r=>prod(r.productId)?.name||r.productName||"Удалённый товар";
const norm=r=>r.status==="Готово"?"Готово":r.status==="На проверке"?"На проверке":r.stage==="Видео"?"Генерация":ST.includes(r.stage)?r.stage:(r.status==="В работе"?"Сценарий":"Идея");
const sidx=r=>Math.max(0,ST.indexOf(norm(r)));
const pct=r=>Number.isFinite(r.progress)?Math.max(0,Math.min(100,r.progress)):Math.round(sidx(r)/(ST.length-1)*100);
const scl=s=>s==="Готово"||s==="Запланировано"||s==="Опубликовано"?"done":s==="На проверке"?"review":s==="Ошибка"?"error":s==="В работе"?"work":"wait";
function saveLocalState(){
  save(accountLocalKey("cf_products"),products);
  save(accountLocalKey("cf_runs"),runs);
  save(accountLocalKey("cf_campaigns"),campaigns);
  save(accountLocalKey("cf_scripts"),scripts);
  save(accountLocalKey("cf_characters"),characters);
  save(accountLocalKey("cf_journal"),journal.slice(-500));
  save(accountLocalKey("cf_expenses"),expenses.slice(-3000));
  save(accountLocalKey("cf_settings"),settings);
}
function stateSnapshot(){
  return {version:1,products,runs,campaigns,scripts,characters,journal:journal.slice(-500),expenses:expenses.slice(-3000),settings};
}
let syncTimer=null;
async function pushState(){
  try{
    await fetch("/api/state?account="+encodeURIComponent(activeAccountId),{method:"PUT",headers:{"content-type":"application/json","x-content-account":activeAccountId},body:JSON.stringify({accountId:activeAccountId,data:stateSnapshot()})});
  }catch{}
}
async function syncFromServer(){
  try{
    const r=await fetch("/api/state?account="+encodeURIComponent(activeAccountId),{cache:"no-store",headers:{"x-content-account":activeAccountId}});
    if(!r.ok)return;
    const payload=await r.json();
    const data=payload?.data;
    if(data&&typeof data==="object"){
      products=Array.isArray(data.products)?data.products:[];
      runs=Array.isArray(data.runs)?data.runs:[];
      campaigns=Array.isArray(data.campaigns)?data.campaigns:[];
      scripts=Array.isArray(data.scripts)?data.scripts:[];
      characters=Array.isArray(data.characters)?data.characters:[];
      journal=Array.isArray(data.journal)?data.journal:[];
      expenses=Array.isArray(data.expenses)?data.expenses:[];
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
function go(id){
  $$(".page").forEach(x=>x.classList.toggle("active",x.id===id));
  $$(".nav").forEach(x=>x.classList.toggle("active",x.dataset.go===id||(id==="productDetail"&&x.dataset.go==="products")||(id==="runDetail"&&x.dataset.go==="generations")));
  setMobileDrawer(false);
  if(id==="profile")renderConnections();
  if(id==="account")renderAccounts();
  if(id==="assistant"){refreshChatStatus();syncChatHistoryFromCloud();}
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
function opts(){const po=products.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join("");["productSelect","campaignProduct"].forEach(id=>{if($("#"+id))$("#"+id).innerHTML=po});if($("#campaignSelect"))$("#campaignSelect").innerHTML='<option value="">Без кампании</option>'+campaigns.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join("");if($("#characterSelect"))$("#characterSelect").innerHTML='<option value="">Без персонажа</option>'+characters.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join("")}
function openCreate(id,platform){selectedProductId=id||selectedProductId||products[0]?.id;opts();if(selectedProductId&&$("#productSelect"))$("#productSelect").value=selectedProductId;if(platform)$$("[data-p]").forEach(x=>x.checked=x.dataset.p===platform);$("#launchMsg").textContent="";openM("createModal")}
window.openCreate=openCreate;$$("[data-create]").forEach(b=>b.onclick=()=>openCreate(null,b.dataset.platform));
function stat(i,l,v,t=""){return '<div class="stat '+t+'"><span>'+i+'</span><div><small>'+l+'</small><b>'+v+'</b></div></div>'}
function primaryMedia(p){const list=Array.isArray(p?.media)?p.media:[];return list.find(m=>m.isPrimary)||list[0]||null}
function productThumb(p,cls="product-thumb"){const m=primaryMedia(p);return '<span class="'+cls+(m?' has-image':'')+'">'+(m?'<img src="'+esc(m.url)+'" alt="'+esc(p.name||"Товар")+'">':(p.icon||"◆"))+'</span>'}
function pcard(p){return '<button class="product-card" onclick="openProduct(\''+p.id+'\')">'+productThumb(p)+'<span><b>'+esc(p.name)+'</b><small>'+esc(p.category||"Товар")+'</small><span class="pill">'+esc(p.tag||"Товар")+'</span></span><span class="chev">›</span></button>'}
function primaryCharacterMedia(c){const list=Array.isArray(c?.media)?c.media:[];return list.find(m=>m.isPrimary)||list[0]||null}
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
      const resp=await fetch("/api/media/upload",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({productId:"avatar-"+character.id,fileName:file.name,mimeType:file.type||"image/jpeg",dataBase64})});
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
      const resp=await fetch("/api/media/upload",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({productId,fileName:file.name,mimeType:file.type||"image/jpeg",dataBase64})});
      const body=await resp.json().catch(()=>({}));
      if(!resp.ok||!body.media)throw new Error(body.detail||body.error||"Ошибка загрузки");
      if(!p.media.length)body.media.isPrimary=true;
      p.media.push(body.media);ok++;saveLocalState();renderAll();
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
window.makePrimaryMedia=(productId,mediaId)=>{const p=prod(productId);if(!p)return;(p.media||[]).forEach(m=>m.isPrimary=m.id===mediaId);log("Изменено главное фото",p.name);persist();renderProductDetail()};
window.deleteProductMedia=async(productId,mediaId)=>{const p=prod(productId);if(!p)return;const m=(p.media||[]).find(x=>x.id===mediaId);if(!m||!confirm("Удалить это фото?"))return;try{await fetch("/api/media/delete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({path:m.path})})}catch{};const wasPrimary=!!m.isPrimary;p.media=(p.media||[]).filter(x=>x.id!==mediaId);if(wasPrimary&&p.media[0])p.media[0].isPrimary=true;log("Удалено фото товара",p.name);persist();renderProductDetail()}
function rrow(r){return '<button class="run-row" onclick="openRun(\''+r.id+'\')"><span class="run-thumb">'+(prod(r.productId)?.icon||"◆")+'</span><span><b>'+esc(pname(r))+(r.variant?" · вариант "+r.variant:"")+'</b><small>'+esc(norm(r))+' · '+esc(r.created||"")+' · '+esc(r.style||"")+'</small><div class="progress"><i style="width:'+pct(r)+'%"></i></div></span><span class="status '+scl(r.status)+'">'+esc(r.status||"В работе")+'</span></button>'}
function task(r){return{id:r.id,title:norm(r)+" · "+pname(r),service:norm(r)==="Генерация"?"Higgsfield / Runway":norm(r)==="Озвучка"?"Озвучка":norm(r)==="Монтаж"?"Descript / монтаж":"Content Factory",progress:r.status==="Ошибка"?0:pct(r),state:r.status==="Ошибка"?"Ошибка":r.status==="Готово"?"Готово":"Выполняется",attempt:r.attempt||1,cost:r.cost||0}}
function taskHtml(t){return '<div class="task-row"><span class="task-icon">'+(t.state==="Ошибка"?"!":"⚙")+'</span><span><b>'+esc(t.title)+'</b><small>'+esc(t.service)+' · попытка '+t.attempt+'/'+(settings.budgetAttempts||3)+(t.cost?" · "+t.cost+" ₽":"")+'</small><div class="progress"><i style="width:'+t.progress+'%"></i></div></span><span class="status '+(t.state==="Ошибка"?"error":t.state==="Готово"?"done":"work")+'">'+t.state+'</span></div>'}
function renderDashboard(){
const active=runs.filter(r=>r.status==="В работе").length,review=runs.filter(r=>r.status==="На проверке").length,ready=runs.filter(r=>r.status==="Готово").length,errors=runs.filter(r=>r.status==="Ошибка").length,pub=runs.filter(r=>norm(r)==="Опубликовано").length,cost=runs.reduce((s,r)=>s+(Number(r.cost)||0),0);
$("#dashboardStats").innerHTML=stat("⚙","В работе",active)+stat("◷","На проверке",review,"blue")+stat("✓","Готово",ready)+stat("!","Ошибки",errors,"warn")+stat("➤","Опубликовано",pub,"purple")+stat("₽","Расходы",cost+" ₽");
const a=runs.filter(r=>r.status==="Ошибка"||r.status==="На проверке").slice(-5).reverse(),ap=$("#attentionPanel");ap.classList.toggle("empty-attention",!a.length);ap.innerHTML='<div class="panel-title"><div><span class="mini-icon">'+(a.length?"!":"✓")+'</span><h2>Требует внимания</h2><p>'+(a.length?"Задачи, которые нельзя пропустить":"Критических задач нет")+'</p></div></div>'+(a.length?a.map(r=>'<div class="attention-row"><span class="attention-icon">!</span><span><b>'+esc(pname(r))+'</b><small>'+(r.status==="Ошибка"?"Процесс остановлен":"Ожидает твоего решения")+'</small></span><button class="secondary" onclick="openRun(\''+r.id+'\')">Открыть</button></div>').join(""):'<div class="muted">Когда ролик зависнет, потребует проверки или превысит лимит — он появится здесь.</div>');
const cnt={};ST.forEach(x=>cnt[x]=0);runs.forEach(r=>cnt[norm(r)]=(cnt[norm(r)]||0)+1);$("#pipelineOverview").innerHTML=ST.slice(0,10).map((x,i)=>'<button class="pipeline-node" onclick="go(\'production\')"><small>'+x+'</small><b>'+(cnt[x]||0)+'</b><em>'+(i<9?"Следующий этап →":"Финиш")+'</em></button>').join("");
const at=runs.filter(r=>!["Готово","Запланировано","Опубликовано"].includes(r.status)).map(task).slice(-4).reverse();$("#backgroundMini").innerHTML=at.length?at.map(taskHtml).join(""):'<div class="empty">Фоновых задач пока нет.</div>';$("#bgBadge").textContent=at.length;
$("#homeProducts").innerHTML=products.slice(0,3).map(pcard).join("")||'<div class="empty">Добавь первый товар</div>';$("#latestRuns").innerHTML=runs.length?runs.slice(-5).reverse().map(rrow).join(""):'<div class="empty">Пока нет роликов.</div>';
const L=[["production","⌁","Производство","Конвейер"],["background","◷","Фоновые задачи","Все процессы"],["campaigns","◫","Кампании","Серии роликов"],["scripts","✎","Сценарии","Хуки и промты"],["scenes","▤","Сцены","Storyboard и версии"],["characters","◉","Персонажи","AI-блогеры"],["calendar","▦","Календарь","План публикаций"],["analytics","↗","Аналитика","Результаты"],["costs","₽","Расходы","Лимиты"],["journal","☷","Журнал","История"]];$("#sectionLinks").innerHTML=L.map(x=>'<button class="section-link" onclick="go(\''+x[0]+'\')"><b>'+x[1]+" "+x[2]+'</b><small>'+x[3]+'</small></button>').join("")
}
function renderProduction(){const K=["Идея","Сценарий","Storyboard","Генерация","Озвучка","Монтаж","AI-проверка","На проверке","Готово","Запланировано","Опубликовано"];$("#kanban").innerHTML=K.map(k=>{const a=runs.filter(r=>norm(r)===k);return '<div class="kanban-col"><div class="kanban-head"><b>'+k+'</b><span class="count-bubble">'+a.length+'</span></div>'+(a.length?a.map(r=>'<div class="kanban-card" onclick="openRun(\''+r.id+'\')"><b>'+esc(pname(r))+'</b><small>'+esc(r.style||"")+' · '+esc(r.duration||"")+'</small><div class="progress mini-progress"><i style="width:'+pct(r)+'%"></i></div></div>').join(""):'<div class="empty" style="padding:28px 5px">0</div>')+'</div>'}).join("")}
function renderBackground(){const a=runs.map(task).reverse();$("#backgroundTasks").innerHTML=a.length?a.map(taskHtml).join(""):'<div class="empty">Задач пока нет.</div>'}
$("#retryFailed").onclick=()=>{let n=0;runs.forEach(r=>{if(r.status==="Ошибка"){r.status="В работе";r.attempt=(r.attempt||1)+1;n++}});if(n)log("Повтор неудачных задач","Перезапущено: "+n);persist()};
function renderProducts(){$("#productsGrid").innerHTML=products.length?products.map(p=>'<article class="catalog-card">'+productThumb(p)+'<h3>'+esc(p.name)+'</h3><p>'+esc(p.category||"Товар")+'</p><div class="catalog-actions"><button class="btn primary" onclick="openCreate(\''+p.id+'\')">Создать ролик</button><button class="secondary" onclick="openProduct(\''+p.id+'\')">Паспорт</button><button class="danger-btn" onclick="deleteProduct(\''+p.id+'\')">Удалить</button></div></article>').join(""):'<div class="empty">Товаров пока нет.</div>'}
window.deleteProduct=async id=>{const p=prod(id);if(!p||!confirm('Удалить товар «'+p.name+'»?'))return;const all=confirm("Удалить также все ролики и историю этого товара?\n\nOK — удалить всё\nОтмена — сохранить историю роликов");for(const m of (p.media||[])){try{await fetch("/api/media/delete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({path:m.path})})}catch{}}if(!all)runs.forEach(r=>{if(r.productId===id)r.productName=p.name});products=products.filter(x=>x.id!==id);if(all)runs=runs.filter(r=>r.productId!==id);campaigns=campaigns.filter(c=>c.productId!==id);selectedProductId=products[0]?.id||null;log("Удалён товар",p.name+(all?" вместе с историей":" — история сохранена"));persist();go("products")};
function mediaGallery(p){const media=Array.isArray(p.media)?p.media:[];return '<div class="media-toolbar"><div><b>Фотографии товара</b><small>Главное фото используется как основной эталон для AI.</small></div><input id="mediaUploadInput" type="file" accept="image/*" multiple hidden onchange="uploadExistingPhotos(event,\''+p.id+'\')"><button class="btn primary" onclick="document.getElementById(\'mediaUploadInput\').click()">＋ Добавить фото</button></div><div id="mediaStatus" class="message"></div>'+(media.length?'<div class="media-grid">'+media.map(m=>'<article class="media-card '+(m.isPrimary?"primary-media":"")+'"><div class="media-image"><img src="'+esc(m.url)+'" alt="'+esc(p.name)+'">'+(m.isPrimary?'<span class="media-primary-badge">Главное</span>':'')+'</div><div class="media-file">'+esc(m.fileName||"Фото")+'</div><div class="media-actions">'+(!m.isPrimary?'<button class="tiny-btn" onclick="makePrimaryMedia(\''+p.id+'\',\''+m.id+'\')">★ Главное</button>':'<span class="tiny-ok">★ Эталон</span>')+'<button class="tiny-btn danger-mini" onclick="deleteProductMedia(\''+p.id+'\',\''+m.id+'\')">Удалить</button></div></article>').join("")+'</div>':'<div class="media-empty"><span>▧</span><b>Фото ещё нет</b><small>Добавь реальные фотографии товара с нескольких ракурсов.</small><button class="secondary" onclick="document.getElementById(\'mediaUploadInput\').click()">Выбрать фото</button></div>')}
function renderProductDetail(){const p=prod(selectedProductId)||products[0];if(!p){$("#productDetailBody").innerHTML='<div class="empty">Добавь первый товар.</div>';return}const rr=runs.filter(r=>r.productId===p.id).reverse();$("#productDetailBody").innerHTML='<section class="panel detail-hero">'+productThumb(p)+'<div><span class="kicker">ПАСПОРТ ТОВАРА</span><h1>'+esc(p.name)+'</h1><p class="muted">'+esc(p.category||"Товар")+'</p><div class="detail-chips"><span class="chip">Фото: '+((p.media||[]).length)+'</span><span class="chip">Роликов: '+rr.length+'</span><span class="chip">Кампаний: '+campaigns.filter(c=>c.productId===p.id).length+'</span></div><div class="catalog-actions"><button class="btn primary" onclick="openCreate(\''+p.id+'\')">＋ Создать ролик</button><button class="danger-btn" onclick="deleteProduct(\''+p.id+'\')">Удалить</button></div></div></section><section class="panel"><div class="panel-title"><div><span class="mini-icon">▧</span><h2>Медиа товара</h2><p>Оригинальные фото становятся эталонами для генерации</p></div></div>'+mediaGallery(p)+'</section><section class="panel"><div class="panel-title"><div><span class="mini-icon">▣</span><h2>Паспорт</h2><p>Что система обязана помнить</p></div></div><div class="passport-grid"><div class="passport-block"><h3>УТП</h3><p>'+esc(p.utp||"Не заполнено")+'</p></div><div class="passport-block"><h3>Мастер-стиль</h3><p>'+esc(p.masterStyle||"Не выбран")+'</p></div><div class="passport-block"><h3>Защита товара</h3><div class="lock-list">'+String(p.rules||"Не менять реальный внешний вид товара.").split(/\n|\./).filter(Boolean).map(x=>'<div class="lock-row"><span>🔒</span><div>'+esc(x.trim())+'</div></div>').join("")+'</div></div><div class="passport-block"><h3>AI-эталон</h3><p>'+(primaryMedia(p)?"Главное фото закреплено. Оно будет передаваться в генерацию как основной референс товара.":"Добавь главное фото, чтобы AI сохранял внешний вид товара.")+'</p></div></div></section><section class="panel"><div class="panel-title"><div><span class="mini-icon">⌁</span><h2>История производства</h2></div></div><div class="runs-list">'+(rr.length?rr.slice(0,8).map(rrow).join(""):'<div class="empty">Роликов ещё нет.</div>')+'</div></section>'}
window.openProduct=id=>{selectedProductId=id;renderProductDetail();go("productDetail")};
$("#addProduct").onclick=()=>{if($("#saveProductMsg"))$("#saveProductMsg").textContent="";openM("productModal")};
$("#saveProduct").onclick=async()=>{const n=$("#newProductName").value.trim();if(!n)return;const btn=$("#saveProduct"),msg=$("#saveProductMsg"),files=[...($("#newProductImages")?.files||[])];btn.disabled=true;msg.textContent="Сохраняю товар…";const p={id:uid("p"),name:n,category:$("#newProductCategory").value.trim()||"Товар",icon:"◆",tag:"Новый",utp:$("#newProductUtp").value.trim(),rules:$("#newProductRules").value.trim(),masterStyle:"Не выбран",media:[]};products.push(p);selectedProductId=p.id;log("Добавлен товар",n);saveLocalState();renderAll();if(files.length)await uploadPhotos(p.id,files,msg);persist();["newProductName","newProductCategory","newProductUtp","newProductRules"].forEach(id=>$("#"+id).value="");if($("#newProductImages"))$("#newProductImages").value="";btn.disabled=false;msg.textContent=files.length?"Товар и фотографии сохранены.":"Товар сохранён.";setTimeout(()=>{closeM("productModal");openProduct(p.id)},500)};
function renderCampaigns(){$("#campaignGrid").innerHTML=campaigns.length?campaigns.map(c=>{const made=runs.filter(r=>r.campaignId===c.id).length,pc=Math.round(made/Math.max(1,c.target)*100),spent=runs.filter(r=>r.campaignId===c.id).reduce((s,r)=>s+(Number(r.cost)||0),0);return '<article class="campaign-card"><span class="kicker">КАМПАНИЯ</span><h3>'+esc(c.name)+'</h3><p>'+esc(prod(c.productId)?.name||"Товар удалён")+'</p><div class="campaign-meta"><span class="chip">'+made+"/"+c.target+' роликов</span><span class="chip">'+c.budget+' ₽</span></div><div class="campaign-progress"><div class="progress"><i style="width:'+Math.min(100,pc)+'%"></i></div><div class="campaign-budget"><span>Прогресс '+pc+'%</span><span>Потрачено '+spent+' ₽</span></div></div><div class="catalog-actions"><button class="btn primary" onclick="openCreate(\''+c.productId+'\')">Добавить ролики</button></div></article>'}).join(""):'<div class="empty">Кампаний пока нет.</div>'}
$("#addCampaign").onclick=()=>{opts();openM("campaignModal")};$("#saveCampaign").onclick=()=>{const n=$("#campaignName").value.trim();if(!n)return;campaigns.push({id:uid("c"),name:n,productId:$("#campaignProduct").value,target:Number($("#campaignTarget").value)||30,budget:Number($("#campaignBudget").value)||5000,mix:$("#campaignMix").value.trim(),created:now()});log("Создана кампания",n);closeM("campaignModal");persist()};
function renderRuns(){$("#runsTable").innerHTML=runs.length?runs.slice().reverse().map(rrow).join(""):'<div class="empty"><h3>Пока нет роликов</h3><p>Запусти первый ролик.</p></div>'}
window.openRun=id=>{selectedRunId=id;renderRunDetail();go("runDetail")};
function readiness(r){const i=sidx(r);return [["Сценарий",i>=1?1:0,1],["Референсы",i>=3?3:0,3],["AI-изображения",i>=4?4:0,4],["AI-видео",i>=5?5:Math.max(0,i-3),5],["Озвучка",i>=6?1:0,1],["Музыка / SFX",i>=6?1:0,1],["Субтитры",i>=7?1:0,1],["Монтаж",i>=7?1:0,1]]}
function scenes(r){const n=r.sceneCount||5;return Array.from({length:n},(_,i)=>{const x=i+1,a=(r.acceptedScenes||[]).includes(x),v=(r.sceneVersions?.[x]||1),title=x===1?"Хук":x===n?"CTA":x===2?"Проблема":x===3?"Демонстрация":"Результат";return '<article class="scene-card"><div class="scene-preview">Сцена '+x+'<br>'+title+'</div><h3>'+x+". "+title+'</h3><small>'+((x-1)*5)+"–"+Math.min(x*5,30)+' сек · '+esc(r.modelMode||"Авто")+'</small><div class="version-row">'+Array.from({length:v},(_,q)=>'<span class="version '+(q===v-1&&a?"ok":"")+'">V'+(q+1)+(q===v-1&&a?" ✓":"")+'</span>').join("")+'</div><div class="scene-actions"><button class="tiny-btn" onclick="acceptScene(\''+r.id+"',"+x+')">✓ Принять</button><button class="tiny-btn" onclick="regenScene(\''+r.id+"',"+x+')">↻ Переделать</button><button class="tiny-btn" onclick="promptScene(\''+r.id+"',"+x+')">✎ Промт</button><button class="tiny-btn" onclick="modelScene(\''+r.id+"',"+x+')">◉ Модель</button></div></article>'}).join("")}
function renderRunDetail(){
  const r=runs.find(x=>x.id===selectedRunId)||runs.at(-1);
  if(!r){$("#runDetailBody").innerHTML='<div class="empty">Нет ролика.</div>';return}
  const idx=sidx(r),rd=readiness(r),rs=rd.reduce((sum,x)=>sum+x[1],0),rt=rd.reduce((sum,x)=>sum+x[2],0);
  const qc=["Товар соответствует эталону","Нет визуальных артефактов","Текст без ошибок","Safe-зоны соблюдены","Звук присутствует","Субтитры синхронны","CTA присутствует"];
  const stageHtml=ST.map((st,i)=>'<div class="stage '+(i<idx?"":i===idx?"progress":"pending")+'"><span class="stage-num">'+(i+1)+'</span><span><b>'+st+'</b><small>'+(i<idx?"Этап завершён":i===idx?"Текущий этап":"Ожидает")+'</small></span><span class="status '+(i<idx?"done":i===idx?"work":"wait")+'">'+(i<idx?"Готово":i===idx?"В процессе":"Ожидает")+'</span></div>').join("");
  const readyHtml=rd.map(x=>'<div class="ready-line"><span><b>'+x[0]+'</b><small>'+(x[1]===x[2]?"Готово":"В процессе")+'</small></span><span class="ready-count">'+x[1]+' из '+x[2]+'</span></div>').join("");
  const qcHtml=qc.map(t=>'<div class="qc-row"><span>'+t+'</span><b class="'+(idx>=7?"qc-ok":"qc-wait")+'">'+(idx>=7?"✓ Пройдено":"Ожидает")+'</b></div>').join("");
  const editParts=["Хук","Сцена 2","Сцена 3","Голос","Музыка","Субтитры","CTA","Цветокоррекция"];
  const edits=editParts.map(x=>'<button class="edit-option" data-edit-part="'+x+'">'+x+'</button>').join("");
  const generatedUrl=r.generationResult?.urls?.[0]||r.generationResult?.jobs?.find?.(j=>j?.results?.raw?.url)?.results?.raw?.url||null;
  const generatedVideo=generatedUrl?'<section class="panel generated-video-panel"><div class="panel-title"><div><span class="mini-icon">▶</span><h2>Видео Higgsfield</h2><p>Результат автоматической генерации</p></div><span class="status done">Готово</span></div><video controls playsinline preload="metadata" style="width:100%;max-height:620px;border-radius:16px;background:#000" src="'+esc(generatedUrl)+'"></video><div class="catalog-actions"><a class="secondary" href="'+esc(generatedUrl)+'" target="_blank" rel="noopener">Открыть оригинал ↗</a></div></section>':'';
  $("#runDetailBody").innerHTML=
    '<section class="panel"><div class="section-head" style="margin:0"><div><span class="kicker">РОЛИК</span><h1>'+esc(pname(r))+(r.variant?' · вариант '+r.variant:'')+'</h1><p>'+esc(r.style||'')+' · '+esc(r.duration||'')+' · 9:16 · '+esc((r.platforms||[]).join(' / '))+'</p></div><span class="status '+scl(r.status)+'">'+esc(r.status||'В работе')+'</span></div><div class="progress" style="height:10px;margin-top:18px"><i style="width:'+pct(r)+'%"></i></div><div class="campaign-budget"><span>Прогресс: '+pct(r)+'%</span><span>Режим: '+(r.mode==="manual"?"Ручной":"Автопилот")+'</span></div></section>'+generatedVideo+
    '<div class="run-layout"><section class="panel"><div class="panel-title"><div><span class="mini-icon">⌁</span><h2>Производственный путь</h2><p>Все этапы отдельно</p></div></div><div class="stage-list">'+stageHtml+'</div></section><aside><section class="panel"><div class="panel-title"><div><span class="mini-icon">✓</span><h2>Контроль готовности</h2><p>'+rs+' из '+rt+'</p></div></div><div class="readiness">'+readyHtml+'</div></section><section class="panel"><div class="panel-title"><div><span class="mini-icon">₽</span><h2>Ограничения</h2></div></div><div class="readiness"><div class="ready-line"><span>Бюджет</span><b>'+(r.budget||500)+' ₽</b></div><div class="ready-line"><span>Попыток на сцену</span><b>'+(r.maxAttempts||3)+'</b></div><div class="ready-line"><span>Модель</span><b>'+esc(r.modelMode||"Авто")+'</b></div></div></section></aside></div>'+
    '<section class="panel"><div class="panel-title"><div><span class="mini-icon">▤</span><h2>Storyboard и сцены</h2><p>Меняется только нужная сцена</p></div></div><div class="storyboard">'+scenes(r)+'</div></section>'+
    '<div class="two-col"><section class="panel"><div class="panel-title"><div><span class="mini-icon">✓</span><h2>AI-проверка</h2></div></div><div class="qc-list">'+qcHtml+'</div></section><section class="panel"><div class="panel-title"><div><span class="mini-icon">✎</span><h2>Точечная доработка</h2><p>Не перезапускаем весь ролик</p></div></div><div class="edit-grid">'+edits+'</div><div class="catalog-actions"><button class="secondary" id="sendRevision">↩ На доработку</button><button class="btn primary" id="approveMontageBtn">✓ Утвердить монтаж</button><button class="btn primary" id="approveRunBtn">✓ Утвердить ролик</button></div></section></div>';
  $$("[data-edit-part]").forEach(btn=>btn.onclick=()=>requestEdit(r.id,btn.dataset.editPart));
  $("#sendRevision").onclick=()=>requestEdit(r.id,"Комментарий");
  $("#approveMontageBtn").onclick=()=>approveMontage(r.id);
  $("#approveRunBtn").onclick=()=>markReady(r.id);
}
window.acceptScene=(id,n)=>{const r=runs.find(x=>x.id===id);if(!r)return;r.acceptedScenes=[...new Set([...(r.acceptedScenes||[]),n])];log("Сцена утверждена",pname(r)+" · сцена "+n);persist();renderRunDetail()};
window.regenScene=(id,n)=>{const r=runs.find(x=>x.id===id);if(!r)return;r.sceneVersions=r.sceneVersions||{};r.sceneVersions[n]=(r.sceneVersions[n]||1)+1;r.acceptedScenes=(r.acceptedScenes||[]).filter(x=>x!==n);r.status="В работе";r.stage="Генерация";r.attempt=(r.attempt||1)+1;log("Перегенерация сцены",pname(r)+" · сцена "+n+" · V"+r.sceneVersions[n]);persist();renderRunDetail();api({action:"regenerate_scene",runId:id,scene:n})};
window.promptScene=(id,n)=>{const t=prompt("Новый промт для сцены "+n+":");if(t){const r=runs.find(x=>x.id===id);r.scenePrompts=r.scenePrompts||{};r.scenePrompts[n]=t;log("Изменён промт сцены",pname(r)+" · сцена "+n);persist();renderRunDetail()}};
window.modelScene=(id,n)=>{const t=prompt("Модель для сцены "+n+":","Авто");if(t){const r=runs.find(x=>x.id===id);r.sceneModels=r.sceneModels||{};r.sceneModels[n]=t;log("Сменена модель сцены",pname(r)+" · сцена "+n+" → "+t);persist();renderRunDetail()}};
window.requestEdit=(id,part)=>{const r=runs.find(x=>x.id===id);if(!r)return;const note=prompt("Что изменить: "+part+"?","");if(note===null)return;r.status="В работе";r.stage=part.startsWith("Сцена")?"Генерация":part==="Голос"?"Озвучка":["Музыка","Субтитры","Цветокоррекция"].includes(part)?"Монтаж":"Сценарий";r.revisions=r.revisions||[];r.revisions.push({part,note,time:now()});log("Ролик отправлен на доработку",pname(r)+" · "+part+": "+(note||"без комментария"));persist();renderRunDetail();api({action:"revise",runId:id,part,note})};
window.approveMontage=id=>{const r=runs.find(x=>x.id===id);if(!r)return;r.status="На проверке";r.stage="На проверке";r.progress=82;log("Монтаж утверждён",pname(r));persist();renderRunDetail()};
window.markReady=id=>{const r=runs.find(x=>x.id===id);if(!r)return;r.status="Готово";r.stage="Готово";r.progress=91;log("Ролик утверждён",pname(r));persist();renderRunDetail()};
function renderScripts(){$("#scriptsList").innerHTML=scripts.length?scripts.slice().reverse().map(s=>'<article class="library-item"><div><h3>'+esc(s.title)+'</h3><p><b>Хук:</b> '+esc(s.hook||"—")+"\n"+esc(s.body||"")+"\n<b>CTA:</b> "+esc(s.cta||"—")+'</p><div class="library-meta"><span class="chip">Использован: '+(s.used||0)+' раз</span></div></div><button class="secondary" onclick="useScript(\''+s.id+'\')">Использовать</button></article>').join(""):'<div class="empty">Сценариев пока нет.</div>';const P=[["UGC-хук","Разговорное начало от лица покупателя"],["Проблема → решение","Боль → демонстрация → результат → CTA"],["Демонстрация","Максимум продукта в кадре"]];$("#promptLibrary").innerHTML=P.map((p,i)=>'<div class="prompt-card"><b>'+p[0]+'</b><small>'+p[1]+'</small><div class="dup-meter"><strong>Защита от повторов: включена</strong><div class="progress"><i style="width:'+(18+i*7)+'%"></i></div></div></div>').join("")}
$("#addScript").onclick=()=>openM("scriptModal");$("#saveScript").onclick=()=>{const n=$("#scriptTitle").value.trim();if(!n)return;scripts.push({id:uid("s"),title:n,hook:$("#scriptHook").value.trim(),body:$("#scriptBody").value.trim(),cta:$("#scriptCta").value.trim(),used:0,created:now()});log("Сохранён сценарий",n);closeM("scriptModal");persist()};
window.useScript=id=>{const s=scripts.find(x=>x.id===id);if(!s)return;s.used=(s.used||0)+1;$("#brief").value=[s.hook,s.body,s.cta].filter(Boolean).join("\n");openCreate();persist()};
function renderScenes(){const r=runs.find(x=>x.id===selectedRunId)||runs.at(-1);$("#scenesWorkspace").innerHTML=r?'<section class="panel"><div class="panel-title"><div><span class="mini-icon">▤</span><h2>'+esc(pname(r))+'</h2><p>'+esc(r.style||"")+' · '+esc(r.duration||"")+'</p></div><button class="text-btn" onclick="openRun(\''+r.id+'\')">Открыть ролик ›</button></div><div class="storyboard">'+scenes(r)+'</div></section>':'<div class="panel empty">Создай ролик — здесь появится storyboard.</div>'}
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
  try{await fetch("/api/media/delete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({path:m.path})})}catch{}
  const wasPrimary=!!m.isPrimary;
  c.media=(c.media||[]).filter(x=>x.id!==mediaId);
  if(wasPrimary&&c.media[0])c.media[0].isPrimary=true;
  log("Удалено фото AI-аватара",c.name);
  persist();renderCharacterExistingMedia();renderCharacters();
};

function renderCharacters(){
  $("#characterGrid").innerHTML=characters.length?characters.map(c=>{
    const m=primaryCharacterMedia(c),count=(c.media||[]).length;
    return '<article class="character-card"><div class="avatar-art '+(m?"has-photo":"")+'">'+(m?'<img src="'+esc(m.url)+'" alt="'+esc(c.name)+'">':'◉')+'</div><h3>'+esc(c.name)+'</h3><p>'+esc((c.age?c.age+" лет · ":"")+(c.look||""))+'</p><div class="character-tags"><span class="chip">Фото: '+count+'</span><span class="chip">'+(count?"Лицо закреплено":"Нужны фото")+'</span><span class="chip">Голос: '+(c.voiceLinked?"подключён":"ожидает")+'</span></div><div id="avatarStatus-'+c.id+'" class="message"></div><input id="avatarUpload-'+c.id+'" type="file" accept="image/*" multiple hidden onchange="uploadExistingCharacterPhotos(event,\''+c.id+'\')"><div class="catalog-actions"><button class="btn primary" onclick="createWithCharacter(\''+c.id+'\')">Создать ролик</button><button class="secondary" onclick="editCharacter(\''+c.id+'\')">Редактировать</button><button class="secondary" onclick="document.getElementById(\'avatarUpload-'+c.id+'\').click()">＋ Фото</button></div></article>'
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
  btn.disabled=true;msg.textContent=existing?"Сохраняю изменения…":"Сохраняю AI-аватара…";
  const c=existing||{id:uid("ch"),voiceLinked:false,media:[],created:now()};
  c.name=n;
  c.age=$("#characterAge").value.trim();
  c.look=$("#characterLook").value.trim();
  c.voice=$("#characterVoice").value.trim();
  c.topics=$("#characterTopics").value.trim();
  c.locks=$("#characterLocks").value.trim();
  c.updatedAt=new Date().toISOString();
  if(!existing){characters.push(c);saveLocalState();renderCharacters()}
  let result={ok:1,failed:0};
  if(files.length)result=await uploadCharacterPhotos(c,files,msg);
  if(!existing&&!result.ok){
    characters=characters.filter(x=>x.id!==c.id);saveLocalState();renderAll();btn.disabled=false;msg.textContent="Аватар не сохранён: не удалось загрузить фото.";return
  }
  log(existing?"Изменён AI-аватар":"Создан AI-аватар",n+" · фото: "+(c.media||[]).length);
  persist();
  if($("#characterImages"))$("#characterImages").value="";
  renderCharacterDraftPreview();renderCharacterExistingMedia();
  btn.disabled=false;msg.textContent=existing?"Изменения сохранены.":"AI-аватар сохранён.";
  setTimeout(()=>closeM("characterModal"),500)
};
window.createWithCharacter=id=>{openCreate();setTimeout(()=>$("#characterSelect").value=id,0)};

function renderPublish(){const a=runs.filter(r=>["Готово","Запланировано","Опубликовано"].includes(r.status)).reverse();$("#readyGrid").innerHTML=a.length?a.map(r=>'<article class="ready-card"><div class="video-preview" onclick="openRun(\''+r.id+'\')"><div class="video-copy">'+esc(pname(r))+'</div></div><h3>'+esc(pname(r))+'</h3><p>'+esc(r.style||"")+" · "+esc(r.duration||"")+' · 9:16</p><div class="publish-list">'+(r.platforms||["TikTok","Reels","Shorts"]).map(n=>'<div class="publish-row"><span><b>'+n+'</b><small style="display:block;color:var(--muted);margin-top:3px">'+(r.status==="Опубликовано"?"Опубликовано":r.status==="Запланировано"?"Запланировано":"Готово к публикации")+'</small></span><span class="toggle"></span></div>').join("")+'</div><div class="catalog-actions"><button class="secondary" onclick="openRun(\''+r.id+'\')">Проверить</button><button class="btn primary" onclick="scheduleRun(\''+r.id+'\')">Запланировать</button></div></article>').join(""):'<div class="panel empty">После утверждения ролики появятся здесь.</div>'}
window.scheduleRun=id=>{const r=runs.find(x=>x.id===id);if(!r)return;const d=prompt("Дата и время публикации:",r.scheduledAt||"");if(!d)return;r.scheduledAt=d;r.status="Запланировано";r.stage="Запланировано";r.progress=96;log("Ролик запланирован",pname(r)+" · "+d);persist()};
function renderCalendar(){const st=new Date();st.setHours(0,0,0,0);const D=Array.from({length:7},(_,i)=>{const d=new Date(st);d.setDate(st.getDate()+i);return d}),E=runs.filter(r=>r.scheduledAt||r.status==="Опубликовано");$("#calendarGrid").innerHTML='<div class="calendar-grid">'+D.map(d=>{const k=d.toLocaleDateString("ru-RU"),e=E.filter(r=>String(r.scheduledAt||"").startsWith(k)||r.publishedDate===k);return '<div class="day"><div class="day-head"><b>'+d.toLocaleDateString("ru-RU",{weekday:"short"})+'</b><small>'+k.slice(0,5)+'</small></div>'+(e.map(r=>'<div class="calendar-event" onclick="openRun(\''+r.id+'\')"><b>'+esc(pname(r))+'</b><small>'+esc(r.scheduledAt||"Опубликовано")+'</small></div>').join("")||'<div class="muted" style="font-size:10px">Нет публикаций</div>')+'</div>'}).join("")+'</div>'}
$("#autoSchedule").onclick=()=>{const a=runs.filter(r=>r.status==="Готово");if(!a.length)return alert("Нет готовых роликов.");const b=new Date();a.forEach((r,i)=>{const d=new Date(b);d.setDate(b.getDate()+Math.floor(i/2)+1);d.setHours(i%2?18:12,0,0,0);r.scheduledAt=d.toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});r.status="Запланировано";r.stage="Запланировано";r.progress=96});log("Автораспределение публикаций","Запланировано: "+a.length);persist()};
function renderAnalytics(){const p=runs.filter(r=>r.status==="Опубликовано"),views=p.reduce((s,r)=>s+(Number(r.metrics?.views)||0),0),clicks=p.reduce((s,r)=>s+(Number(r.metrics?.clicks)||0),0),sales=p.reduce((s,r)=>s+(Number(r.metrics?.sales)||0),0);$("#analyticsStats").innerHTML=stat("▶","Просмотры",views)+stat("◷","Удержание","0%","blue")+stat("↗","Переходы",clicks,"purple")+stat("₽","Продажи",sales);$("#insights").innerHTML='<div class="insight-card"><b>Система копит данные</b><p>После публикаций здесь появятся сравнения по хукам, стилям, персонажам и товарам.</p></div>';$("#trendCards").innerHTML='<div class="trend-card"><b>Тренды</b><p>Темы и форматы для следующих тестов.</p></div><div class="trend-card"><b>Конкуренты</b><p>Структуры роликов, частота публикаций и рекламные гипотезы.</p></div>'}
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
  const totalRub=all.reduce((s,e)=>s+expenseRubValue(e),0);
  const chat=all.filter(e=>e.provider==="OpenAI"&&e.category==="chat");
  const chatRub=chat.reduce((s,e)=>s+expenseRubValue(e),0);
  const monthRub=all.filter(e=>{const d=expenseDate(e);return d&&d.getMonth()===month&&d.getFullYear()===year}).reduce((s,e)=>s+expenseRubValue(e),0);
  const monthlyFixed=all.filter(e=>e.recurring==="monthly").reduce((s,e)=>s+expenseRubValue(e),0);
  $("#costStats").innerHTML=stat("₽","Всего",fmtMoney(totalRub)+" ₽")+stat("✦","ChatGPT",fmtMoney(chatRub)+" ₽","blue")+stat("◷","Этот месяц",fmtMoney(monthRub)+" ₽","purple")+stat("↻","Постоянные / мес.",fmtMoney(monthlyFixed)+" ₽","warn");

  const providers=["OpenAI","Higgsfield","Runway","Descript","Railway","Supabase","n8n","Google Drive","Другое"];
  $("#expenseProviderCards").innerHTML=providers.map(p=>{
    const rows=all.filter(e=>e.provider===p),rub=rows.reduce((s,e)=>s+expenseRubValue(e),0);
    const usd=rows.reduce((s,e)=>s+(Number(e.amountUsd)||0),0);
    const usage=rows.length;
    return '<div class="expense-provider-card"><div><b>'+esc(p)+'</b><small>'+usage+' операций</small></div><strong>'+fmtMoney(rub)+' ₽</strong>'+(usd?'<em>$'+usd.toFixed(4)+'</em>':'')+'</div>'
  }).join("");

  $("#usdRubRate").value=settings.costRates.usdRub||"";
  $("#higgsfieldRate").value=settings.costRates.higgsfieldRubPerGeneration||0;
  $("#runwayRate").value=settings.costRates.runwayRubPerSecond||0;
  $("#descriptRate").value=settings.costRates.descriptRubPerAction||0;
  $("#budgetCampaign").value=settings.budgetCampaign||5000;
  $("#budgetAttempts").value=settings.budgetAttempts||3;
  $("#budgetApproval").value=settings.budgetApproval||100;

  const pf=$("#costProviderFilter");
  if(pf&&pf.options.length<=1)providers.forEach(p=>pf.insertAdjacentHTML("beforeend",'<option value="'+esc(p)+'">'+esc(p)+'</option>'));
  const provider=pf?.value||"",period=$("#costPeriodFilter")?.value||"all";
  let rows=all.slice();
  if(provider)rows=rows.filter(e=>e.provider===provider);
  if(period==="month")rows=rows.filter(e=>{const d=expenseDate(e);return d&&d.getMonth()===month&&d.getFullYear()===year});
  if(period==="today")rows=rows.filter(e=>(e.createdAt||"").slice(0,10)===todayKey);
  $("#costRows").innerHTML=rows.slice().reverse().slice(0,200).map(e=>{
    const d=expenseDate(e),rub=expenseRubValue(e);
    const usage=e.usage?Object.entries(e.usage).filter(([,v])=>typeof v!=="object").map(([k,v])=>k+": "+v).join(" · "):"";
    return '<div class="expense-row"><div class="expense-main"><span class="expense-provider-badge">'+esc(e.provider||"Другое")+'</span><div><h3>'+esc(e.description||"Расход")+'</h3><p>'+esc((d?d.toLocaleString("ru-RU"):"")+(e.model?" · "+e.model:"")+(usage?" · "+usage:""))+'</p></div></div><div class="expense-amount"><b>'+fmtMoney(rub)+' ₽</b>'+(e.amountUsd?'<small>$'+Number(e.amountUsd).toFixed(5)+'</small>':'')+(e.source==="manual"?'<button class="tiny-btn danger-mini" onclick="deleteExpense(\''+e.id+'\')">Удалить</button>':'')+'</div></div>'
  }).join("")||'<div class="empty">Расходов пока нет.</div>';
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
window.deleteExpense=async id=>{
  if(!confirm("Удалить этот расход?"))return;
  await fetch("/api/expenses?account="+encodeURIComponent(activeAccountId)+"&id="+encodeURIComponent(id),{method:"DELETE"});
  await syncFromServer();renderCosts();
};

let chatHistory=load(chatLocalKey(),[]);
let chatDraftAttachments=[];
let chatCloudSyncing=false;

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
  try{
    const r=await fetch("/api/chat/history?account="+encodeURIComponent(activeAccountId),{cache:"no-store",headers:{"x-content-account":activeAccountId}});
    if(!r.ok)return;
    const data=await r.json();
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
    return '<div class="chat-bubble '+(m.role==="user"?"user":"assistant")+'"><b>'+(m.role==="user"?"Ты":"ChatGPT")+'</b>'+
      (m.content?'<p>'+esc(m.content)+'</p>':'')+
      (attachments?'<div class="chat-history-files">'+attachments+'</div>':'')+
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
  save(chatLocalKey(),chatHistory.slice(-200));
  if(input)input.value="";
  go("assistant");
  renderChat();
  const status=$("#chatStatus"); if(status)status.textContent="Думаю…";
  try{
    const r=await fetch("/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      message,history:previous,attachments:sentAttachments,accountId:activeAccountId
    })});
    const data=await r.json().catch(()=>({}));
    chatHistory.push({role:"assistant",content:r.ok?(data.text||"Готово."):(data.detail||data.error||"Ошибка подключения")});
  }catch(err){
    chatHistory.push({role:"assistant",content:"Ошибка связи: "+String(err?.message||err)});
  }
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
if($("#mobileChatDock"))$("#mobileChatDock").onsubmit=e=>{
  e.preventDefault();
  const input=$("#mobileChatInput");
  sendChatMessage(input?.value,input);
};
$("#mobileChatDockOpen")?.addEventListener("click",()=>go("assistant"));
if($("#clearChat"))$("#clearChat").onclick=async()=>{
  chatHistory=[];
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
    productId:"account-"+activeAccountId,fileName:file.name,mimeType:file.type||"image/jpeg",dataBase64
  })});
  const body=await resp.json().catch(()=>({}));
  if(!resp.ok||!body.media)throw new Error(body.detail||body.error||"Ошибка загрузки фото");
  const prev=activeAccount();
  if(prev?.avatarPath&&prev.avatarPath!==body.media.path){
    fetch("/api/media/delete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({path:prev.avatarPath})}).catch(()=>{});
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
  settings=load(accountLocalKey("cf_settings"),{mode:"auto",budgetCampaign:5000,budgetAttempts:3,budgetApproval:100});
  chatHistory=load(chatLocalKey(),[]);
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
    if(a?.avatarPath)await fetch("/api/media/delete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({path:a.avatarPath})}).catch(()=>{});
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

function renderJournal(){$("#journalList").innerHTML=journal.length?journal.slice().reverse().map(j=>'<div class="journal-row '+(j.type==="error"?"error":"")+'"><span class="journal-time">'+esc(j.time)+'</span><span class="journal-dot"></span><span><b>'+esc(j.title)+'</b><small>'+esc(j.detail||"")+'</small></span></div>').join(""):'<div class="empty">Журнал пока пуст.</div>'}
async function renderConnections(){
  let s={services:{},details:{}};
  try{s=await (await fetch("/api/status",{cache:"no-store"})).json()}catch{}
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
  const characterPayload=chosenCharacter?{
    id:chosenCharacter.id,
    name:chosenCharacter.name,
    age:chosenCharacter.age||"",
    look:chosenCharacter.look||"",
    voice:chosenCharacter.voice||"",
    topics:chosenCharacter.topics||"",
    locks:chosenCharacter.locks||"",
    media:(chosenCharacter.media||[]).map(m=>({id:m.id,url:m.url,path:m.path,isPrimary:!!m.isPrimary}))
  }:null;
  const base={accountId:activeAccountId,batchId:uid("batch"),productId:$("#productSelect").value,productName:chosenProduct?.name||"Товар",productUtp:chosenProduct?.utp||"",productRules:chosenProduct?.rules||"",media:productMedia,product:{id:chosenProduct?.id||null,name:chosenProduct?.name||"Товар",utp:chosenProduct?.utp||"",rules:chosenProduct?.rules||"",media:productMedia},campaignId:$("#campaignSelect").value||null,characterId:chosenCharacter?.id||null,character:characterPayload,avatarReferences:characterPayload?.media||[],brief:$("#brief").value.trim(),style:$("#style").value,duration:$("#duration").value,count:$("#count").value,format:$("#format").value,platforms,mode:createMode,modelMode:$("#modelMode").value,budget:Number($("#runBudget").value)||500,maxAttempts:Number($("#runAttempts").value)||3,created:now()};
  $("#launch").disabled=true;$("#launchMsg").textContent="Запускаю производство…";
  const res=await api({action:"create_batch",...base}),arr=[];
  for(let i=1;i<=n;i++)arr.push({id:uid("r"),...base,variant:n>1?i:null,status:"В работе",stage:"Сценарий",progress:8,attempt:1,sceneCount:5,sceneVersions:{1:1,2:1,3:1,4:1,5:1},acceptedScenes:[]});
  runs.push(...arr);selectedRunId=arr[0]?.id;
  log("Запущено производство",base.productName+" · "+n+" роликов · "+(chosenCharacter?"аватар "+chosenCharacter.name+" · ":"")+(base.mode==="manual"?"ручной режим":"автопилот"));persist();
  $("#launchMsg").textContent=res.ok?"Передано в n8n. Фото товара и AI-аватара переданы как референсы.":"Задачи добавлены. Рабочий workflow n8n пока не подключён к кнопке запуска.";
  $("#launch").disabled=false;setTimeout(()=>{closeM("createModal");go("production")},1000)
};
function renderAll(){opts();renderDashboard();renderProduction();renderBackground();renderProducts();renderProductDetail();renderCampaigns();renderRuns();renderRunDetail();renderScripts();renderScenes();renderCharacters();renderPublish();renderCalendar();renderAnalytics();renderCosts();renderJournal();renderChat();renderAccounts();refreshChatStatus();renderConnections()}
if("serviceWorker" in navigator){
  navigator.serviceWorker.getRegistrations().then(rs=>Promise.all(rs.map(r=>r.unregister()))).catch(()=>{});
}
if("caches" in window)caches.keys().then(keys=>Promise.all(keys.map(k=>caches.delete(k)))).catch(()=>{});
window.addEventListener("pageshow",()=>{window.scrollTo({top:0,left:0,behavior:"instant"})},{once:true});

let authMode='login';
let currentAuthUser=null;
function setAuthMode(mode){
  authMode=mode==='register'?'register':'login';
  $("[data-auth-mode]").forEach(b=>b.classList.toggle("active",b.dataset.authMode===authMode));
  if($("#authNameField"))$("#authNameField").hidden=authMode!=="register";
  if($("#authSubmit"))$("#authSubmit").textContent=authMode==="register"?"Создать аккаунт":"Войти";
  if($("#authPassword"))$("#authPassword").autocomplete=authMode==="register"?"new-password":"current-password";
  if($("#authMessage"))$("#authMessage").textContent="";
}
$("[data-auth-mode]").forEach(b=>b.addEventListener("click",()=>setAuthMode(b.dataset.authMode)));
$("#authForm")?.addEventListener("submit",async e=>{
  e.preventDefault();
  const btn=$("#authSubmit"),msg=$("#authMessage");
  btn.disabled=true;msg.textContent=authMode==="register"?"Создаю кабинет…":"Вхожу…";
  try{
    const r=await fetch("/api/auth/"+authMode,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      login:$("#authLogin").value.trim(),
      password:$("#authPassword").value,
      displayName:$("#authDisplayName")?.value.trim()||""
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
async function bootAuthenticatedApp(){
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

