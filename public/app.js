const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const starterProducts = [
  { id:'washcloth', name:'Корейская мочалка', category:'Красота и уход', icon:'🧽', tag:'Хит' },
  { id:'holder', name:'Держатель полотенец', category:'Дом и кухня', icon:'🧻', tag:'Новинка' },
  { id:'curler', name:'Мини-плойка', category:'Красота и уход', icon:'〰️', tag:'Популярно' },
];
let products = JSON.parse(localStorage.getItem('cf_products') || 'null') || starterProducts;
let runs = JSON.parse(localStorage.getItem('cf_runs') || '[]');
let selectedProductId = products[0]?.id;
let selectedRunId = null;

const save = () => {
  localStorage.setItem('cf_products', JSON.stringify(products));
  localStorage.setItem('cf_runs', JSON.stringify(runs));
  renderAll();
};
const esc = (v='') => String(v).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const product = id => products.find(p => p.id === id);
const runStatusClass = s => s === 'Готово' ? 'done' : s === 'На проверке' ? 'review' : s === 'В работе' ? 'work' : 'wait';

function go(page){
  $$('.page').forEach(x => x.classList.toggle('active', x.id === page));
  $$('.nav').forEach(x => x.classList.toggle('active', x.dataset.go === page || (page==='productDetail'&&x.dataset.go==='products') || (page==='reviewScreen'&&x.dataset.go==='generations')));
  window.scrollTo({top:0,behavior:'smooth'});
}
$$('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));

function openCreate(id, platform){
  selectedProductId = id || selectedProductId || products[0]?.id;
  renderProductSelect();
  if(selectedProductId) $('#productSelect').value = selectedProductId;
  if(platform){
    $$('[data-p]').forEach(x => x.checked = x.dataset.p === platform);
  }
  $('#launchMsg').textContent = '';
  $('#createModal').classList.add('open');
  $('#createModal').setAttribute('aria-hidden','false');
}
$$('[data-create]').forEach(b => b.addEventListener('click', () => openCreate(null,b.dataset.platform)));
$('#closeModal').onclick = () => $('#createModal').classList.remove('open');

function renderProductSelect(){
  $('#productSelect').innerHTML = products.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
}
function productCard(p){
  return `<button class="product-card" onclick="openProduct('${p.id}')"><span class="product-thumb">${p.icon||'◆'}</span><span><b>${esc(p.name)}</b><small>${esc(p.category||'Товар')}</small><span class="pill">${esc(p.tag||'Товар')}</span></span><span class="chev">›</span></button>`;
}
function runRow(r){
  const p = product(r.productId);
  const label = r.stage || 'Видео';
  return `<button class="run-row" onclick="openRun('${r.id}')"><span class="run-thumb">${p?.icon||'◆'}</span><span><b>${esc(label)} · ${esc(p?.name||'Товар')}</b><small>${esc(r.created)} · ${esc(r.style)} · ${esc(r.duration)}</small></span><span class="status ${runStatusClass(r.status)}">${esc(r.status)}</span></button>`;
}
function renderHome(){
  $('#homeProducts').innerHTML = products.slice(0,3).map(productCard).join('') || '<div class="empty">Добавь первый товар</div>';
  const latest = runs.slice().reverse().slice(0,5);
  $('#latestRuns').innerHTML = latest.length ? latest.map(runRow).join('') : '<div class="empty">Пока нет генераций. Запусти первый ролик.</div>';
  $('#working').textContent = runs.filter(r=>r.status==='В работе').length;
  $('#review').textContent = runs.filter(r=>r.status==='На проверке').length;
  $('#done').textContent = runs.filter(r=>r.status==='Готово').length;
  const costs = runs.filter(r=>Number.isFinite(r.cost)).map(r=>r.cost);
  $('#averageCost').textContent = costs.length ? `~ ${Math.round(costs.reduce((a,b)=>a+b,0)/costs.length)} ₽ / ролик` : '—';
}
function renderProducts(){
  $('#productsGrid').innerHTML = products.map(p => `<article class="catalog-card"><div class="product-thumb">${p.icon||'◆'}</div><h3>${esc(p.name)}</h3><p>${esc(p.category||'Товар')}</p><div class="catalog-actions"><button class="btn primary" onclick="openCreate('${p.id}')">Создать ролик</button><button class="secondary" onclick="openProduct('${p.id}')">Открыть</button></div></article>`).join('') || '<div class="empty">Товаров пока нет.</div>';
}
function renderProductDetail(){
  const p = product(selectedProductId) || products[0];
  if(!p){ $('#productDetailBody').innerHTML='<div class="empty">Добавь первый товар.</div>'; return; }
  const pruns = runs.filter(r=>r.productId===p.id).slice().reverse();
  const last = pruns[0];
  const stages = [
    ['Сценарий','Идея, хук и текст ролика'],['Референсы','Подбор ракурсов и визуальной логики'],['Видео','Генерация сцен'],['Озвучка','Голос и звуковая дорожка'],['Монтаж','Финальная сборка ролика']
  ];
  const doneSteps = last?.status==='Готово' ? 5 : last?.status==='На проверке' ? 4 : last ? 2 : 0;
  $('#productDetailBody').innerHTML = `
    <section class="panel detail-hero"><div class="product-thumb">${p.icon||'◆'}</div><div><span class="kicker">КОНТЕНТ ДЛЯ ТОВАРА</span><h1>${esc(p.name)}</h1><p class="muted">${esc(p.category||'Товар')}</p><div class="detail-chips"><span class="chip">TikTok</span><span class="chip">Reels</span><span class="chip">Shorts</span></div></div></section>
    <section class="panel"><div class="section-block-title"><h2>Параметры генерации</h2><button class="text-btn" onclick="openCreate('${p.id}')">Настроить ›</button></div><div class="settings-grid"><div class="setting"><small>Длительность</small><b>${last?.duration||'15 / 30 / 45 сек'}</b></div><div class="setting"><small>Стиль</small><b>${last?.style||'UGC / Вирусный / Премиум'}</b></div><div class="setting"><small>Количество</small><b>${last?.count||'5 вариантов'}</b></div><div class="setting"><small>Формат</small><b>9:16</b></div></div></section>
    <section class="panel"><div class="section-block-title"><h2>Статус производства</h2><span class="status ${last?runStatusClass(last.status):'wait'}">${esc(last?.status||'Не запущено')}</span></div><div class="pipeline">${stages.map((s,i)=>`<div class="stage ${i<doneSteps?'':i===doneSteps&&last?'progress':'pending'}"><span class="stage-num">${i+1}</span><span><b>${s[0]}</b><small>${s[1]}</small></span><span class="status ${i<doneSteps?'done':i===doneSteps&&last?'work':'wait'}">${i<doneSteps?'Готово':i===doneSteps&&last?'В процессе':'Ожидает'}</span></div>`).join('')}</div></section>
    <section class="panel"><div class="section-block-title"><h2>Последние задачи</h2><button class="text-btn" onclick="go('generations')">Все задачи ›</button></div><div class="runs-list">${pruns.length?pruns.slice(0,5).map(runRow).join(''):'<div class="empty">Для этого товара пока нет генераций.</div>'}</div><button class="btn primary full" style="margin-top:14px" onclick="openCreate('${p.id}')">▶ Запустить генерацию</button></section>`;
}
window.openProduct = id => { selectedProductId=id; renderProductDetail(); go('productDetail'); };

function renderRuns(){
  $('#runsTable').innerHTML = runs.length ? runs.slice().reverse().map(runRow).join('') : '<div class="empty"><h3>Пока нет генераций</h3><p>Запусти первый ролик с главной страницы.</p></div>';
}
window.openRun = id => { selectedRunId=id; renderReview(); go('reviewScreen'); };
function renderReview(){
  const r = runs.find(x=>x.id===selectedRunId) || runs[runs.length-1];
  if(!r){ $('#reviewBody').innerHTML='<div class="empty">Нет ролика для просмотра.</div>'; return; }
  const p = product(r.productId);
  $('#reviewBody').innerHTML = `<div class="review-layout"><section class="panel"><div class="video-preview"><div class="video-copy">${esc(p?.name||'Товар')}</div></div><div style="margin-top:13px"><h2 style="margin:0 0 5px">${esc(p?.name||'Товар')}</h2><p class="muted" style="margin:0">TikTok / Reels / Shorts · ${esc(r.style)} · ${esc(r.duration)} · 9:16</p></div></section><div><section class="panel"><span class="kicker">РОЛИК ГОТОВ</span><h1 style="margin:6px 0">Проверка и публикация</h1><p class="muted">Просмотри результат и выбери дальнейшее действие.</p><div class="review-actions"><button class="action-card active" onclick="markReady('${r.id}')"><b>✓ Утвердить</b><small>Ролик готов к публикации</small></button><button class="action-card" onclick="redoRun('${r.id}')"><b>↻ Переделать</b><small>Создать новую версию</small></button><button class="action-card"><b>🎙 Сменить голос</b><small>Выбрать другой голос</small></button><button class="action-card"><b>Т Изменить текст</b><small>Отредактировать сценарий</small></button></div></section><section class="panel"><h2>Публикация</h2><div class="publish-list">${['TikTok','Reels','Shorts'].map(n=>`<div class="publish-row"><span><b>${n}</b><small style="display:block;color:var(--muted);margin-top:3px">Готово к публикации</small></span><span class="toggle"></span></div>`).join('')}</div><button class="btn primary full" style="margin-top:14px" onclick="markReady('${r.id}');go('publish')">➤ Опубликовать</button></section></div></div>`;
}
window.markReady = id => { const r=runs.find(x=>x.id===id); if(r){r.status='Готово';r.stage='Монтаж';r.cost=r.cost||58;save();renderReview();} };
window.redoRun = id => { const r=runs.find(x=>x.id===id); if(r) openCreate(r.productId); };

function renderReady(){
  const ready = runs.filter(r=>r.status==='Готово').slice().reverse();
  $('#readyGrid').innerHTML = ready.length ? ready.map(r=>{const p=product(r.productId);return `<article class="ready-card"><div class="video-preview" onclick="openRun('${r.id}')"><div class="video-copy">${esc(p?.name||'Товар')}</div></div><h3>${esc(p?.name||'Товар')}</h3><p class="muted">${esc(r.style)} · ${esc(r.duration)} · 9:16</p><button class="btn primary full" onclick="openRun('${r.id}')">Открыть публикацию</button></article>`}).join('') : '<div class="panel empty"><h3>Готовых роликов пока нет</h3><p>После утверждения ролики появятся здесь.</p></div>';
}

async function renderConnections(){
  let s={services:{}};
  try{const r=await fetch('/api/status');s=await r.json()}catch{}
  const rows=[
    ['n8n — сервер',s.services?.n8nServer,'Оркестрация автоматизаций'],
    ['n8n — рабочий процесс',s.services?.n8nWorkflow,'Запуск полного конвейера'],
    ['Higgsfield',s.services?.higgsfield,'Генерация товарных сцен и видео'],
    ['Runway',s.services?.runway,'Дополнительная генерация и обработка'],
    ['Descript',s.services?.descript,'Монтаж и финальная сборка'],
    ['Google Drive',s.services?.drive,'Хранение исходников и результатов'],
  ];
  $('#connections').innerHTML=rows.map(([name,on,desc])=>`<div class="conn"><div class="conn-left"><span class="dot ${on?'on':''}"></span><span><b>${name}</b><small>${desc}</small></span></div><span class="status ${on?'done':'wait'}">${on?'Подключено':'Ожидает'}</span></div>`).join('');
}

$('#addProduct').onclick=()=>$('#productModal').classList.add('open');
$$('[data-close-product]').forEach(x=>x.onclick=()=>$('#productModal').classList.remove('open'));
$('#saveProduct').onclick=()=>{
  const name=$('#newProductName').value.trim(); if(!name)return;
  products.push({id:'p'+Date.now(),name,category:$('#newProductCategory').value.trim()||'Товар',icon:'◆',tag:'Новый'});
  $('#newProductName').value='';$('#newProductCategory').value='';$('#productModal').classList.remove('open');save();
};
$('#launch').onclick=async()=>{
  const platforms=$$('[data-p]:checked').map(x=>x.dataset.p);
  const payload={id:'r'+Date.now(),productId:$('#productSelect').value,brief:$('#brief').value.trim(),style:$('#style').value,duration:$('#duration').value,count:$('#count').value,format:$('#format').value,platforms,created:new Date().toLocaleString('ru-RU'),status:'В работе',stage:'Сценарий'};
  $('#launch').disabled=true;$('#launchMsg').textContent='Запускаю производство…';
  try{
    const resp=await fetch('/api/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    const body=await resp.json().catch(()=>({}));
    runs.push(payload);save();
    $('#launchMsg').textContent=resp.ok?'Производство запущено. Статус уже в разделе «Генерации».':(body.error||'Задача сохранена, но рабочий процесс n8n ещё не подключён.');
  }catch{
    runs.push(payload);save();$('#launchMsg').textContent='Задача сохранена. Связь с n8n временно недоступна.';
  }finally{
    $('#launch').disabled=false;setTimeout(()=>{$('#createModal').classList.remove('open');go('generations')},950);
  }
};

function renderAll(){renderProductSelect();renderHome();renderProducts();renderProductDetail();renderRuns();renderReady();renderConnections()}
if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
renderAll();
