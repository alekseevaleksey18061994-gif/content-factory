/* Content Factory 2.11 — view-only controls. No generation or account mutations. */
const mediaFilters={photos:{product:'',run:'',scene:'',order:'recent'},videos:{product:'',run:'',scene:'',order:'recent'}};
const mediaSelection={photos:new Set(),videos:new Set()};
const mediaKey=m=>String(m.id||m.url);
function changeMediaFilter(input){mediaFilters[input.dataset.library][input.dataset.filter]=input.value;renderMediaSection(input.dataset.library==='photos'?'photosWorkspace':'videosWorkspace',input.dataset.library)}
function updateMediaSelection(type){
  const box=document.getElementById(type==='photos'?'photosWorkspace':'videosWorkspace');
  const valid=new Set(collectGeneratedMedia()[type].map(mediaKey));
  for(const key of mediaSelection[type])if(!valid.has(key))mediaSelection[type].delete(key);
  const btn=box?.querySelector('[data-download-selection]');if(btn){btn.disabled=!mediaSelection[type].size;btn.textContent='Скачать выбранные'+(mediaSelection[type].size?' ('+mediaSelection[type].size+')':'')}
}
function selectVisibleMedia(type){const box=document.getElementById(type==='photos'?'photosWorkspace':'videosWorkspace');box.querySelectorAll('[data-media-key]').forEach(c=>{mediaSelection[type].add(c.dataset.mediaKey);c.querySelector('input[type=checkbox]').checked=true});updateMediaSelection(type)}
function clearMediaSelection(type){mediaSelection[type].clear();document.getElementById(type==='photos'?'photosWorkspace':'videosWorkspace').querySelectorAll('.media-select input').forEach(i=>i.checked=false);updateMediaSelection(type)}
async function downloadSelectedMedia(type){
  const items=collectGeneratedMedia()[type].filter(m=>mediaSelection[type].has(mediaKey(m)));
  for(const m of items){downloadMedia(m.url,m.fileName||('media-'+m.id+(type==='videos'?'.mp4':'.png')));await new Promise(r=>setTimeout(r,300))}
}
function mediaImageError(img){
  const host=img.parentElement;if(host.querySelector('.media-load-error'))return;
  img.hidden=true;
  const box=document.createElement('div');box.className='media-load-error';
  const title=document.createElement('b');title.textContent='Фото не загрузилось';
  const note=document.createElement('span');note.textContent='Можно повторить загрузку или скачать файл';
  const btn=document.createElement('button');btn.className='secondary';btn.textContent='Повторить загрузку';
  btn.onclick=()=>{box.remove();img.hidden=false;const src=img.getAttribute('src');img.removeAttribute('src');img.setAttribute('src',src)};
  box.append(title,note,btn);host.append(box);
}
function openMediaPreview(url,title){
  let dialog=document.getElementById('mediaLightbox');
  if(!dialog){dialog=document.createElement('dialog');dialog.id='mediaLightbox';dialog.innerHTML='<form method="dialog"><button class="secondary" aria-label="Закрыть просмотр">Закрыть ×</button></form><img><p></p>';document.body.append(dialog);dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()})}
  dialog.querySelector('img').src=url;dialog.querySelector('img').alt=title;dialog.querySelector('p').textContent=title;dialog.showModal();
}
function polishActionMenus(root=document){
  root.querySelectorAll('button.danger-btn,button.danger-mini').forEach(btn=>{
    if(!btn.textContent.trim().startsWith('Удалить')||btn.closest('.action-menu'))return;
    const menu=document.createElement('details');menu.className='action-menu';
    const summary=document.createElement('summary');summary.textContent='⋯';summary.setAttribute('aria-label','Дополнительные действия');summary.title='Дополнительные действия';
    btn.before(menu);menu.append(summary,btn);
    btn.addEventListener('click',()=>menu.open=false);
  });
}
let detailTab='overview',detailProduct='';
function enhanceProductDetail(){
  const body=document.getElementById('productDetailBody');if(!body?.querySelector('.detail-hero'))return;
  if(detailProduct!==selectedProductId){detailProduct=selectedProductId;detailTab='overview'}
  const sections=[...body.children],hero=sections[0],media=sections[1],passport=sections[2],history=sections[3];
  if(!history)return;
  const blocks=[...passport.querySelectorAll('.passport-block')];
  const rules=document.createElement('section'),avatar=document.createElement('section');
  rules.className=avatar.className='panel';
  rules.innerHTML='<h2>Правила генерации</h2><div class="passport-grid"></div>';
  avatar.innerHTML='<h2>Аватар товара</h2><div class="passport-grid"></div>';
  [blocks[2],blocks[3],blocks[5]].filter(Boolean).forEach(b=>rules.lastElementChild.append(b));
  if(blocks[4])avatar.lastElementChild.append(blocks[4]);
  body.append(rules,avatar);
  const views={overview:passport,photos:media,rules,avatar,history};
  const tabs=document.createElement('div');tabs.className='detail-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Разделы товара');
  const entries=[['overview','Обзор'],['photos','Фото'],['rules','Правила генерации'],['avatar','Аватар'],['history','История']];
  const show=key=>{detailTab=key;Object.entries(views).forEach(([k,v])=>v.hidden=k!==key);tabs.querySelectorAll('button').forEach(b=>{b.classList.toggle('active',b.dataset.tab===key);b.setAttribute('aria-selected',String(b.dataset.tab===key));b.tabIndex=b.dataset.tab===key?0:-1})};
  entries.forEach(([key,label],i)=>{const btn=document.createElement('button');btn.type='button';btn.dataset.tab=key;btn.textContent=label;btn.setAttribute('role','tab');btn.id='product-tab-'+key;btn.setAttribute('aria-controls','product-panel-'+key);views[key].id='product-panel-'+key;views[key].setAttribute('role','tabpanel');views[key].setAttribute('aria-labelledby',btn.id);btn.onclick=()=>show(key);btn.onkeydown=e=>{if(['ArrowRight','ArrowLeft','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?entries.length-1:(i+(e.key==='ArrowRight'?1:-1)+entries.length)%entries.length;show(entries[next][0]);tabs.children[next].focus()}};tabs.append(btn)});
  hero.after(tabs);show(detailTab);
  body.querySelectorAll('.media-file').forEach(el=>{el.title=el.textContent;el.textContent='Фото товара'});
}
function polishRenderedUI(){polishActionMenus();document.querySelectorAll('.sidebar-group').forEach(g=>{if(g.querySelector('.nav.active')){g.classList.remove('collapsed');g.querySelector('.sidebar-toggle')?.setAttribute('aria-expanded','true')}})}
function setupSidebar(){
  const side=document.getElementById('appSidebar'), groups=[...side.querySelectorAll('.sidebar-group')];
  const scroll=document.createElement('div');scroll.className='sidebar-scroll';groups[0].before(scroll);groups.forEach(g=>scroll.append(g));
  groups.forEach(g=>{const label=g.querySelector('.sidebar-title'),btn=document.createElement('button');btn.className='sidebar-title sidebar-toggle';btn.type='button';btn.textContent=label.textContent;btn.setAttribute('aria-expanded','true');btn.onclick=()=>{const closed=g.classList.toggle('collapsed');btn.setAttribute('aria-expanded',String(!closed))};label.replaceWith(btn)});
  // Consistent 20px stroke icons, supplied inline so no external asset is required.
  const paths={home:'M3 10 12 3l9 7v10H3Z M9 20v-7h6v7',production:'M4 5h16v4H4Z M4 15h7v4H4Z M16 15h4v4h-4Z M12 9v3H7v3 M12 12h6v3',ideas:'M8 16h8 M9 20h6 M8 13a6 6 0 1 1 8 0v3H8Z',products:'M3 7l9-4 9 4v10l-9 4-9-4Z M3 7l9 4 9-4 M12 11v10',campaigns:'M3 5h7l2 3h9v12H3Z',generations:'M4 4h16v16H4Z M10 8l6 4-6 4Z',scripts:'M5 3h14v18H5Z M8 7h8 M8 11h8 M8 15h5',photos:'M3 4h18v16H3Z M3 16l6-6 5 5 3-3 4 4 M16 8h.01',videos:'M3 5h13v14H3Z M16 10l5-3v10l-5-3',characters:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2',videoLab:'M3 4h13v13H3Z M9 8l4 3-4 3Z M17 17l4 4',publish:'M3 11 21 3l-8 18-3-8Z M10 13 21 3',calendar:'M3 5h18v16H3Z M3 10h18 M7 3v4 M17 3v4',analytics:'M4 20V4 M4 20h17 M8 16v-5 M13 16V7 M18 16v-9',costs:'M7 21V3h7a5 5 0 0 1 0 10H4 M4 17h11',journal:'M5 4h14v17H5Z M8 8h8 M8 12h8 M8 16h6',assistant:'M3 4h18v13H9l-5 4v-4H3Z M7 10h.01 M12 10h.01 M17 10h.01',account:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2',profile:'M4 7h16 M4 17h16 M8 4v6 M16 14v6'};
  side.querySelectorAll('.nav').forEach(b=>{const span=b.querySelector('span');if(paths[b.dataset.go])span.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+paths[b.dataset.go]+'"/></svg>'});
  document.addEventListener('click',e=>{document.querySelectorAll('.action-menu[open]').forEach(m=>{if(!m.contains(e.target))m.open=false})});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.action-menu[open]').forEach(m=>m.open=false)});
}
setupSidebar();
