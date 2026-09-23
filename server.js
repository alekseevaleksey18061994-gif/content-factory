import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHiggsfieldClient } from '@higgsfield/client/v2';
import RunwayML, { TaskFailedError as RunwayTaskFailedError } from '@runwayml/sdk';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile=promisify(execFileCb);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const port = Number(process.env.PORT || 3000);

const mime = {
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.svg':'image/svg+xml',
  '.png':'image/png',
  '.webmanifest':'application/manifest+json',
};

const json = (res,status,data) => {
  res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(JSON.stringify(data));
};

const readBody = async req => {
  const chunks=[];
  for await (const c of req) chunks.push(c);
  if(!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

async function n8nAlive(){
  const u=process.env.N8N_BASE_URL;
  if(!u) return false;
  try {
    const r=await fetch(u.replace(/\/$/,'')+'/');
    return r.status<500;
  } catch {
    return false;
  }
}

const supabaseConfigured = () =>
  Boolean(
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_PUBLISHABLE_KEY &&
    process.env.CONTENT_FACTORY_DB_SECRET
  );

function supabaseHeaders(extra={}){
  const key=process.env.SUPABASE_PUBLISHABLE_KEY;
  return {
    apikey:key,
    authorization:`Bearer ${key}`,
    'x-app-api-key':process.env.CONTENT_FACTORY_DB_SECRET,
    'content-type':'application/json',
    ...extra
  };
}

const DEFAULT_ACCOUNT_ID='main';
const ACCOUNTS_REGISTRY_ID='accounts_registry';

function sanitizeAccountId(value){
  const raw=String(value||DEFAULT_ACCOUNT_ID).trim();
  if(raw===DEFAULT_ACCOUNT_ID) return DEFAULT_ACCOUNT_ID;
  const safe=raw.replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);
  return safe||DEFAULT_ACCOUNT_ID;
}

function accountStateRowId(accountId=DEFAULT_ACCOUNT_ID){
  const id=sanitizeAccountId(accountId);
  return id===DEFAULT_ACCOUNT_ID ? 'main' : 'account_'+id;
}

async function readStateRow(rowId){
  if(!supabaseConfigured()) return {configured:false,data:null};
  const base=process.env.SUPABASE_URL.replace(/\/$/,'');
  const r=await fetch(base+'/rest/v1/app_state?id=eq.'+encodeURIComponent(rowId)+'&select=data,updated_at&limit=1',{
    headers:supabaseHeaders()
  });
  if(!r.ok){
    const detail=await r.text();
    throw new Error('Supabase read failed: '+r.status+' '+detail);
  }
  const rows=await r.json();
  return {configured:true,data:rows?.[0]?.data??null,updatedAt:rows?.[0]?.updated_at??null};
}

async function writeStateRow(rowId,data){
  if(!supabaseConfigured()) return {configured:false};
  const base=process.env.SUPABASE_URL.replace(/\/$/,'');
  const r=await fetch(base+'/rest/v1/app_state?on_conflict=id',{
    method:'POST',
    headers:supabaseHeaders({'prefer':'resolution=merge-duplicates,return=minimal'}),
    body:JSON.stringify([{id:rowId,data,updated_at:new Date().toISOString()}])
  });
  if(!r.ok){
    const detail=await r.text();
    throw new Error('Supabase write failed: '+r.status+' '+detail);
  }
  return {configured:true};
}

async function deleteStateRow(rowId){
  if(!supabaseConfigured()) return {configured:false};
  const base=process.env.SUPABASE_URL.replace(/\/$/,'');
  const r=await fetch(base+'/rest/v1/app_state?id=eq.'+encodeURIComponent(rowId),{
    method:'DELETE',
    headers:supabaseHeaders({'prefer':'return=minimal'})
  });
  if(!r.ok){
    const detail=await r.text();
    throw new Error('Supabase delete failed: '+r.status+' '+detail);
  }
  return {configured:true};
}

async function readAppState(accountId=DEFAULT_ACCOUNT_ID){
  return readStateRow(accountStateRowId(accountId));
}

async function writeAppState(data,accountId=DEFAULT_ACCOUNT_ID){
  return writeStateRow(accountStateRowId(accountId),data);
}

function blankFactoryState(){
  return {
    version:1,
    products:[],
    runs:[],
    campaigns:[],
    scripts:[],
    characters:[],
    journal:[],
    expenses:[],
    settings:{mode:'auto',budgetCampaign:5000,budgetAttempts:3,budgetApproval:100,costRates:{usdRub:0,higgsfieldRubPerGeneration:0,runwayRubPerSecond:0,descriptRubPerAction:0}}
  };
}

async function ensureAccountsRegistry(){
  const row=await readStateRow(ACCOUNTS_REGISTRY_ID);
  if(row.data?.accounts?.length) return row.data;
  const registry={
    version:1,
    accounts:[{
      id:DEFAULT_ACCOUNT_ID,
      name:'Основной аккаунт',
      owner:'Алексей',
      company:'',
      email:'',
      phone:'',
      notes:'',
      memory:'',
      avatarUrl:'',
      avatarPath:'',
      createdAt:new Date().toISOString()
    }]
  };
  await writeStateRow(ACCOUNTS_REGISTRY_ID,registry);
  return registry;
}

async function writeAccountsRegistry(registry){
  registry.version=1;
  registry.accounts=Array.isArray(registry.accounts)?registry.accounts:[];
  await writeStateRow(ACCOUNTS_REGISTRY_ID,registry);
  return registry;
}

async function callProductMedia(payload){
  if(!process.env.SUPABASE_URL || !process.env.CONTENT_FACTORY_DB_SECRET){
    throw new Error('Media storage is not configured');
  }
  const base=process.env.SUPABASE_URL.replace(/\/$/,'');
  const r=await fetch(`${base}/functions/v1/product-media`,{
    method:'POST',
    headers:{
      'content-type':'application/json',
      'x-app-api-key':process.env.CONTENT_FACTORY_DB_SECRET
    },
    body:JSON.stringify(payload)
  });
  const text=await r.text();
  let data;
  try{ data=text?JSON.parse(text):{}; }catch{ data={detail:text}; }
  if(!r.ok || data?.ok===false){
    throw new Error(data?.detail || data?.error || `Media request failed: ${r.status}`);
  }
  return data;
}


const higgsfieldConfigured = () =>
  Boolean(process.env.HIGGSFIELD_API_KEY_ID && process.env.HIGGSFIELD_API_KEY_SECRET);

const openaiConfigured = () => Boolean(process.env.OPENAI_API_KEY);

async function moduleAvailable(name){
  try{
    await import(name);
    return true;
  }catch{
    return false;
  }
}

async function commandAvailable(command,args=['-version']){
  try{
    await execFile(command,args,{timeout:5000});
    return true;
  }catch{
    return false;
  }
}

function openAIText(response){
  if(typeof response?.output_text==='string' && response.output_text.trim()) return response.output_text.trim();
  const out=Array.isArray(response?.output)?response.output:[];
  const parts=[];
  for(const item of out){
    if(item?.type==='message' && Array.isArray(item.content)){
      for(const c of item.content){
        if(c?.type==='output_text' && c.text) parts.push(c.text);
      }
    }
  }
  return parts.join('\n').trim();
}


function factoryId(prefix='id'){
  return prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
}

function compactName(value){
  return String(value||'').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/gi,' ').trim();
}

function findProductInState(data,query){
  const items=Array.isArray(data?.products)?data.products:[];
  const q=compactName(query);
  if(!q) return null;
  return items.find(x=>String(x?.id||'')===String(query))
    || items.find(x=>compactName(x?.name)===q)
    || items.find(x=>compactName(x?.name).includes(q)||q.includes(compactName(x?.name)))
    || null;
}

function findRunInState(data,query){
  const items=Array.isArray(data?.runs)?data.runs:[];
  const q=compactName(query);
  if(!q) return null;
  return items.find(x=>String(x?.id||'')===String(query))
    || items.find(x=>String(x?.batchId||'')===String(query))
    || [...items].reverse().find(x=>compactName(x?.productName).includes(q)||q.includes(compactName(x?.productName)))
    || null;
}

function appendFactoryJournal(data,title,detail='',type='ok'){
  data.journal=Array.isArray(data.journal)?data.journal:[];
  data.journal.push({
    id:factoryId('j'),
    time:new Date().toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}),
    title,
    detail,
    type
  });
  data.journal=data.journal.slice(-500);
}

async function recordExpense(accountId,entry={}){
  accountId=sanitizeAccountId(accountId||DEFAULT_ACCOUNT_ID);
  const state=await readAppState(accountId);
  const data=state?.data&&typeof state.data==='object'?state.data:blankFactoryState();
  data.expenses=Array.isArray(data.expenses)?data.expenses:[];
  const expense={
    id:factoryId('exp'),
    provider:String(entry.provider||'Другое').slice(0,80),
    category:String(entry.category||'other').slice(0,80),
    description:String(entry.description||'Расход').slice(0,500),
    amountRub:Number(entry.amountRub)||0,
    amountUsd:Number(entry.amountUsd)||0,
    usage:entry.usage&&typeof entry.usage==='object'?entry.usage:null,
    model:String(entry.model||'').slice(0,160),
    source:String(entry.source||'auto').slice(0,40),
    recurring:String(entry.recurring||'').slice(0,40),
    createdAt:entry.createdAt||new Date().toISOString()
  };
  data.expenses.push(expense);
  data.expenses=data.expenses.slice(-3000);
  await writeAppState(data,accountId);
  return expense;
}

async function costRates(accountId){
  const state=await readAppState(sanitizeAccountId(accountId||DEFAULT_ACCOUNT_ID));
  return state?.data?.settings?.costRates||{};
}

function openAIUsageCost(model,usage={}){
  const name=String(model||'gpt-5.6-luna').toLowerCase();
  let inputRate=0.20,cachedRate=0.02,outputRate=1.20;
  if(name.includes('gpt-5.6-terra')){inputRate=2;cachedRate=.2;outputRate=12}
  else if(name.includes('gpt-5.6-sol')){inputRate=4;cachedRate=.4;outputRate=20}
  const input=Number(usage.input_tokens)||0;
  const output=Number(usage.output_tokens)||0;
  const cached=Number(usage.input_tokens_details?.cached_tokens)||0;
  const uncached=Math.max(0,input-cached);
  return {
    amountUsd:(uncached*inputRate+cached*cachedRate+output*outputRate)/1e6,
    details:{inputTokens:input,cachedTokens:cached,outputTokens:output,inputRate,cachedRate,outputRate}
  };
}

async function dispatchFactoryStart(payload){
  const direct=process.env.N8N_CONTENT_WEBHOOK;
  const base=process.env.N8N_WEBHOOK_BASE;
  const webhook=direct || (base ? base.replace(/\/$/,'')+'/content-factory-run' : '');
  const generationWebhook=process.env.N8N_GENERATION_WEBHOOK || '';
  if(!webhook && !generationWebhook){
    return {ok:false,code:'workflow_not_connected',error:'n8n workflow не подключён'};
  }
  const results={archive:null,generation:null};
  if(webhook){
    try{
      const r=await fetch(webhook,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
      const text=await r.text();
      let data; try{data=JSON.parse(text)}catch{data={message:text}}
      results.archive={ok:r.ok,status:r.status,data};
    }catch(e){
      results.archive={ok:false,status:0,error:String(e?.message||e)};
    }
  }
  if(generationWebhook){
    try{
      const r=await fetch(generationWebhook,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
      const text=await r.text();
      let data; try{data=JSON.parse(text)}catch{data={message:text}}
      results.generation={ok:r.ok,status:r.status,data};
    }catch(e){
      results.generation={ok:false,status:0,error:String(e?.message||e)};
    }
  }
  const primaryOk=results.archive ? results.archive.ok : Boolean(results.generation?.ok);
  return {ok:primaryOk,data:results};
}

const factoryTools=[
  {
    type:'function',
    name:'get_factory_state',
    description:'Получить актуальное состояние Content Factory: товары, кампании, последние запуски и настройки.',
    parameters:{type:'object',properties:{},additionalProperties:false}
  },
  {
    type:'function',
    name:'update_settings',
    description:'Изменить режим и бюджетные настройки Content Factory.',
    parameters:{
      type:'object',
      properties:{
        mode:{type:'string',enum:['auto','manual']},
        budgetCampaign:{type:'number'},
        budgetAttempts:{type:'integer'},
        budgetApproval:{type:'number'}
      },
      additionalProperties:false
    }
  },
  {
    type:'function',
    name:'create_campaign',
    description:'Создать кампанию для существующего товара.',
    parameters:{
      type:'object',
      properties:{
        product:{type:'string',description:'Название или id товара'},
        name:{type:'string'},
        target:{type:'integer'},
        budget:{type:'number'},
        mix:{type:'string'}
      },
      required:['product','name'],
      additionalProperties:false
    }
  },
  {
    type:'function',
    name:'create_script',
    description:'Добавить сценарий в библиотеку Content Factory.',
    parameters:{
      type:'object',
      properties:{
        title:{type:'string'},
        hook:{type:'string'},
        body:{type:'string'},
        cta:{type:'string'}
      },
      required:['title'],
      additionalProperties:false
    }
  },
  {
    type:'function',
    name:'update_product',
    description:'Изменить паспорт существующего товара: название, категорию, УТП, ограничения или мастер-стиль.',
    parameters:{
      type:'object',
      properties:{
        product:{type:'string'},
        name:{type:'string'},
        category:{type:'string'},
        utp:{type:'string'},
        rules:{type:'string'},
        masterStyle:{type:'string'}
      },
      required:['product'],
      additionalProperties:false
    }
  },
  {
    type:'function',
    name:'set_account_memory',
    description:'Сохранить долговременную память активного аккаунта. Использовать только когда пользователь явно просит запомнить, сохранить на будущее, изменить или забыть информацию. Передавай полный новый текст памяти.',
    parameters:{type:'object',properties:{memory:{type:'string',description:'Полный текст долговременной памяти аккаунта после изменения'}},required:['memory'],additionalProperties:false}
  },
  {
    type:'function',
    name:'create_video_batch',
    description:'Запустить производство роликов для существующего товара через n8n. Это может расходовать платные AI-кредиты. Если count больше 3, confirmed должен быть true только после отдельного подтверждения пользователя.',
    parameters:{
      type:'object',
      properties:{
        product:{type:'string'},
        count:{type:'integer',minimum:1,maximum:20},
        brief:{type:'string'},
        style:{type:'string'},
        duration:{type:'string'},
        modelMode:{type:'string'},
        budget:{type:'number'},
        maxAttempts:{type:'integer'},
        confirmed:{type:'boolean'}
      },
      required:['product','count'],
      additionalProperties:false
    }
  },
  {
    type:'function',
    name:'retry_failed_runs',
    description:'Перезапустить ошибочные запуски. Можно ограничить конкретным товаром.',
    parameters:{
      type:'object',
      properties:{product:{type:'string'}},
      additionalProperties:false
    }
  },
  {
    type:'function',
    name:'approve_run',
    description:'Утвердить конкретный ролик и отметить его готовым.',
    parameters:{
      type:'object',
      properties:{run:{type:'string'}},
      required:['run'],
      additionalProperties:false
    }
  },
  {
    type:'function',
    name:'delete_run',
    description:'Удалить один запуск/ролик из состояния. Разрушительное действие: confirmed=true допустим только после явного отдельного подтверждения пользователя.',
    parameters:{
      type:'object',
      properties:{run:{type:'string'},confirmed:{type:'boolean'}},
      required:['run'],
      additionalProperties:false
    }
  },
  {
    type:'function',
    name:'publish_run',
    description:'Опубликовать готовый ролик. Сейчас действие возможно только если подключены нужные соцсети.',
    parameters:{
      type:'object',
      properties:{run:{type:'string'},platforms:{type:'array',items:{type:'string'}},confirmed:{type:'boolean'}},
      required:['run'],
      additionalProperties:false
    }
  }
];

async function executeFactoryTool(name,args={},accountId=DEFAULT_ACCOUNT_ID){
  accountId=sanitizeAccountId(accountId);
  const state=await readAppState(accountId);
  const data=state?.data && typeof state.data==='object' ? state.data : {
    version:1,products:[],runs:[],campaigns:[],scripts:[],characters:[],journal:[],expenses:[],settings:{}
  };
  data.products=Array.isArray(data.products)?data.products:[];
  data.runs=Array.isArray(data.runs)?data.runs:[];
  data.campaigns=Array.isArray(data.campaigns)?data.campaigns:[];
  data.scripts=Array.isArray(data.scripts)?data.scripts:[];
  data.settings=data.settings&&typeof data.settings==='object'?data.settings:{};

  if(name==='get_factory_state'){
    return {
      ok:true,
      products:data.products.map(p=>({id:p.id,name:p.name,category:p.category,mediaCount:(p.media||[]).length})),
      campaigns:data.campaigns.slice(-20),
      runs:data.runs.slice(-30).map(r=>({id:r.id,batchId:r.batchId,productName:r.productName,status:r.status,stage:r.stage,progress:r.progress,style:r.style,duration:r.duration})),
      settings:data.settings
    };
  }

  if(name==='set_account_memory'){
    const registry=await ensureAccountsRegistry();
    const account=registry.accounts.find(x=>x.id===accountId);
    if(!account) return {ok:false,error:'Аккаунт не найден'};
    account.memory=String(args.memory||'').trim().slice(0,12000);
    account.updatedAt=new Date().toISOString();
    await writeAccountsRegistry(registry);
    return {ok:true,memory:account.memory};
  }

  if(name==='update_settings'){
    if(args.mode) data.settings.mode=args.mode==='manual'?'manual':'auto';
    if(args.budgetCampaign!==undefined) data.settings.budgetCampaign=clampNumber(args.budgetCampaign,0,10000000,data.settings.budgetCampaign||5000);
    if(args.budgetAttempts!==undefined) data.settings.budgetAttempts=Math.round(clampNumber(args.budgetAttempts,1,10,data.settings.budgetAttempts||3));
    if(args.budgetApproval!==undefined) data.settings.budgetApproval=clampNumber(args.budgetApproval,0,1000000,data.settings.budgetApproval||100);
    appendFactoryJournal(data,'ChatGPT изменил настройки','Режим: '+(data.settings.mode||'auto')+' · бюджет кампании: '+(data.settings.budgetCampaign||0)+' ₽');
    await writeAppState(data,accountId);
    return {ok:true,settings:data.settings};
  }

  if(name==='create_campaign'){
    const product=findProductInState(data,args.product);
    if(!product) return {ok:false,error:'Товар не найден',availableProducts:data.products.map(p=>p.name)};
    const campaign={
      id:factoryId('c'),
      name:String(args.name||'Новая кампания').slice(0,160),
      productId:product.id,
      target:Math.round(clampNumber(args.target,1,500,30)),
      budget:clampNumber(args.budget,0,10000000,data.settings.budgetCampaign||5000),
      mix:String(args.mix||'').slice(0,5000),
      created:new Date().toISOString()
    };
    data.campaigns.push(campaign);
    appendFactoryJournal(data,'ChatGPT создал кампанию',campaign.name+' · '+product.name);
    await writeAppState(data,accountId);
    return {ok:true,campaign,product:{id:product.id,name:product.name}};
  }

  if(name==='create_script'){
    const script={
      id:factoryId('s'),
      title:String(args.title||'Новый сценарий').slice(0,200),
      hook:String(args.hook||'').slice(0,5000),
      body:String(args.body||'').slice(0,16000),
      cta:String(args.cta||'').slice(0,3000),
      created:new Date().toISOString()
    };
    data.scripts.push(script);
    appendFactoryJournal(data,'ChatGPT добавил сценарий',script.title);
    await writeAppState(data,accountId);
    return {ok:true,script};
  }

  if(name==='update_product'){
    const product=findProductInState(data,args.product);
    if(!product) return {ok:false,error:'Товар не найден',availableProducts:data.products.map(p=>p.name)};
    const allowed=['name','category','utp','rules','masterStyle'];
    for(const k of allowed){
      if(args[k]!==undefined && String(args[k]).trim()) product[k]=String(args[k]).trim().slice(0,k==='rules'||k==='utp'?12000:1000);
    }
    appendFactoryJournal(data,'ChatGPT изменил товар',product.name);
    await writeAppState(data,accountId);
    return {ok:true,product:{id:product.id,name:product.name,category:product.category,utp:product.utp,rules:product.rules,masterStyle:product.masterStyle}};
  }

  if(name==='create_video_batch'){
    const product=findProductInState(data,args.product);
    if(!product) return {ok:false,error:'Товар не найден',availableProducts:data.products.map(p=>p.name)};
    const count=Math.round(clampNumber(args.count,1,20,1));
    if(count>3 && args.confirmed!==true){
      return {ok:false,requires_confirmation:true,message:'Запуск '+count+' роликов может потратить заметный бюджет. Нужно отдельное подтверждение пользователя.'};
    }
    const batchId=factoryId('batch');
    const style=String(args.style||'UGC').slice(0,120);
    const duration=String(args.duration||'30 сек').slice(0,80);
    const budget=clampNumber(args.budget,0,1000000,500);
    const maxAttempts=Math.round(clampNumber(args.maxAttempts,1,10,data.settings.budgetAttempts||3));
    const media=(product.media||[]).map(m=>({id:m.id,url:m.url,path:m.path,isPrimary:!!m.isPrimary}));
    const payload={
      action:'create_batch',
      accountId,
      batchId,
      productId:product.id,
      productName:product.name,
      productUtp:product.utp||'',
      productRules:product.rules||'',
      media,
      product:{id:product.id,name:product.name,utp:product.utp||'',rules:product.rules||'',media},
      brief:String(args.brief||'').slice(0,12000),
      style,
      duration,
      count:count+' вариантов',
      variantCount:count,
      format:'9:16',
      platforms:[],
      mode:data.settings.mode||'auto',
      modelMode:String(args.modelMode||'Авто — умный выбор').slice(0,120),
      budget,
      maxAttempts,
      created:new Date().toISOString()
    };
    const dispatched=await dispatchFactoryStart(payload);
    if(!dispatched.ok) return {ok:false,error:'Не удалось передать запуск в n8n',detail:dispatched};
    for(let i=1;i<=count;i++){
      data.runs.push({
        id:factoryId('r'),
        ...payload,
        variant:count>1?i:null,
        status:'В работе',
        stage:'Сценарий',
        progress:8,
        attempt:1,
        sceneCount:5,
        sceneVersions:{1:1,2:1,3:1,4:1,5:1},
        acceptedScenes:[]
      });
    }
    appendFactoryJournal(data,'ChatGPT запустил производство',product.name+' · '+count+' ролик(а/ов) · '+style);
    await writeAppState(data,accountId);
    return {ok:true,batchId,count,product:product.name,style,duration,budget,dispatch:dispatched.data};
  }

  if(name==='retry_failed_runs'){
    const product=args.product?findProductInState(data,args.product):null;
    let changed=0;
    for(const run of data.runs){
      if(run.status!=='Ошибка') continue;
      if(product && run.productId!==product.id) continue;
      run.status='В работе';
      run.stage='Сценарий';
      run.progress=Math.min(Number(run.progress)||0,12);
      run.attempt=(Number(run.attempt)||1)+1;
      run.updatedAt=new Date().toISOString();
      changed++;
    }
    if(changed){
      appendFactoryJournal(data,'ChatGPT перезапустил ошибки','Запусков: '+changed);
      await writeAppState(data,accountId);
    }
    return {ok:true,retried:changed};
  }

  if(name==='approve_run'){
    const run=findRunInState(data,args.run);
    if(!run) return {ok:false,error:'Запуск не найден'};
    run.status='Готово';
    run.stage='Готово';
    run.progress=100;
    run.updatedAt=new Date().toISOString();
    appendFactoryJournal(data,'ChatGPT утвердил ролик',run.productName||run.id);
    await writeAppState(data,accountId);
    return {ok:true,run:{id:run.id,productName:run.productName,status:run.status}};
  }

  if(name==='delete_run'){
    const run=findRunInState(data,args.run);
    if(!run) return {ok:false,error:'Запуск не найден'};
    if(args.confirmed!==true){
      return {ok:false,requires_confirmation:true,message:'Нужно отдельное подтверждение удаления запуска '+run.id+'.'};
    }
    data.runs=data.runs.filter(x=>x.id!==run.id);
    appendFactoryJournal(data,'ChatGPT удалил запуск',(run.productName||'Ролик')+' · '+run.id);
    await writeAppState(data,accountId);
    return {ok:true,deleted:{id:run.id,productName:run.productName}};
  }

  if(name==='publish_run'){
    const run=findRunInState(data,args.run);
    if(!run) return {ok:false,error:'Запуск не найден'};
    const connected={
      TikTok:Boolean(process.env.TIKTOK_ACCESS_TOKEN),
      Instagram:Boolean(process.env.INSTAGRAM_ACCESS_TOKEN),
      YouTube:Boolean(process.env.YOUTUBE_ACCESS_TOKEN || process.env.YOUTUBE_REFRESH_TOKEN)
    };
    const requested=Array.isArray(args.platforms)&&args.platforms.length?args.platforms:['TikTok','Instagram','YouTube'];
    const missing=requested.filter(p=>!connected[p]);
    if(missing.length) return {ok:false,blocked:true,error:'Соцсети ещё не подключены',missing};
    if(args.confirmed!==true) return {ok:false,requires_confirmation:true,message:'Нужно отдельное подтверждение публикации.'};
    return {ok:false,blocked:true,error:'Публикационный executor ещё не реализован. Подключены токены, но backend публикации нужно добавить.'};
  }

  return {ok:false,error:'Неизвестный инструмент: '+name};
}

async function callOpenAIChat(message,history=[],accountId=DEFAULT_ACCOUNT_ID){
  if(!openaiConfigured()) throw new Error('OpenAI API is not configured');
  const safeHistory=(Array.isArray(history)?history:[]).slice(-12).map(x=>({
    role:x?.role==='assistant'?'assistant':'user',
    content:String(x?.content||'').slice(0,8000)
  }));
  accountId=sanitizeAccountId(accountId);
  const state=await readAppState(accountId).catch(()=>({data:null}));
  const snapshot=state?.data||{};
  const registry=await ensureAccountsRegistry().catch(()=>({accounts:[]}));
  const profile=(registry.accounts||[]).find(x=>x.id===accountId)||null;
  const context={
    account:profile?{id:profile.id,name:profile.name,owner:profile.owner,company:profile.company,email:profile.email,phone:profile.phone,notes:profile.notes,memory:profile.memory||''}:null,
    products:(snapshot.products||[]).map(p=>({id:p.id,name:p.name,category:p.category,utp:p.utp,rules:p.rules,mediaCount:(p.media||[]).length})),
    campaigns:(snapshot.campaigns||[]).slice(-20),
    runs:(snapshot.runs||[]).slice(-25).map(r=>({id:r.id,batchId:r.batchId,productName:r.productName,status:r.status,stage:r.stage,progress:r.progress,style:r.style,duration:r.duration})),
    settings:snapshot.settings||{}
  };
  const input=[
    {role:'system',content:[{type:'input_text',text:
      'Ты — оператор Content Factory. Отвечай по-русски, коротко и конкретно. '+
      'Ты не только советник: когда пользователь просит выполнить доступное действие, используй backend-инструмент и реально выполни его. '+
      'Никогда не заявляй об успехе до получения успешного результата инструмента. '+
      'Для запуска более 3 роликов, удаления и публикации требуется отдельное подтверждение: сначала вызови инструмент без confirmed=true, получи requires_confirmation и попроси пользователя подтвердить. '+
      'Ставь confirmed=true только если пользователь после такого запроса явно ответил, что подтверждает/да/запускай/удаляй. '+
      'Если соцсети не подключены, честно сообщи, что публикация заблокирована. '+
      'У активного аккаунта есть долговременная память отдельно от видимой истории чата. Если пользователь явно говорит «запомни», «сохрани на будущее», «забудь» или просит изменить память — используй set_account_memory. Не сохраняй чувствительные данные без явной просьбы. '+
      'Если можно выполнить задачу инструментом, предпочитай выполнить её, а не объяснять пользователю ручные шаги. Контекст: '+JSON.stringify(context)
    }]} ,
    ...safeHistory.map(x=>({
      role:x.role,
      content:[{
        type:x.role==='assistant'?'output_text':'input_text',
        text:x.content
      }]
    })),
    {role:'user',content:[{type:'input_text',text:String(message||'').slice(0,12000)}]}
  ];

  let r=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'content-type':'application/json'},
    body:JSON.stringify({
      model:process.env.OPENAI_MODEL||'gpt-5.6-luna',
      input,
      tools:factoryTools,
      tool_choice:'auto',
      reasoning:{effort:'low'},
      max_output_tokens:2200
    })
  });
  let text=await r.text();
  let data; try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
  if(!r.ok) throw new Error(data?.error?.message||data?.message||('OpenAI error '+r.status));

  const usageTotal={input_tokens:0,output_tokens:0,input_tokens_details:{cached_tokens:0}};
  const addUsage=u=>{
    if(!u)return;
    usageTotal.input_tokens+=Number(u.input_tokens)||0;
    usageTotal.output_tokens+=Number(u.output_tokens)||0;
    usageTotal.input_tokens_details.cached_tokens+=Number(u.input_tokens_details?.cached_tokens)||0;
  };
  addUsage(data.usage);

  const actions=[];
  for(let round=0;round<4;round++){
    const calls=(Array.isArray(data?.output)?data.output:[]).filter(x=>x?.type==='function_call');
    if(!calls.length) break;
    const outputs=[];
    for(const call of calls){
      let args={};
      try{args=call.arguments?JSON.parse(call.arguments):{}}catch{}
      let result;
      try{result=await executeFactoryTool(call.name,args,accountId)}
      catch(e){result={ok:false,error:String(e?.message||e)}}
      actions.push({name:call.name,args,result});
      outputs.push({type:'function_call_output',call_id:call.call_id,output:JSON.stringify(result)});
    }
    r=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',
      headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'content-type':'application/json'},
      body:JSON.stringify({
        model:process.env.OPENAI_MODEL||'gpt-5.6-luna',
        previous_response_id:data.id,
        input:outputs,
        tools:factoryTools,
        tool_choice:'auto',
        reasoning:{effort:'low'},
        max_output_tokens:2200
      })
    });
    text=await r.text();
    try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
    if(!r.ok) throw new Error(data?.error?.message||data?.message||('OpenAI error '+r.status));
    addUsage(data.usage);
  }

  const usedModel=data?.model||process.env.OPENAI_MODEL||'gpt-5.6-luna';
  const priced=openAIUsageCost(usedModel,usageTotal);
  if(priced.amountUsd>0){
    await recordExpense(accountId,{
      provider:'OpenAI',
      category:'chat',
      description:'ChatGPT-пульт',
      amountUsd:priced.amountUsd,
      model:usedModel,
      usage:priced.details,
      source:'auto'
    }).catch(()=>{});
  }

  return {
    text:openAIText(data)|| (actions.length?'Готово.':''),
    actions,
    responseId:data?.id||null,
    model:data?.model||process.env.OPENAI_MODEL||'gpt-5.6-luna'
  };
}

function internalRequestAllowed(req){
  const expected=process.env.CONTENT_FACTORY_DB_SECRET;
  const supplied=req.headers['x-content-factory-key'];
  return Boolean(expected && supplied && supplied===expected);
}

function clampNumber(value,min,max,fallback){
  const n=Number(value);
  return Number.isFinite(n) ? Math.max(min,Math.min(max,n)) : fallback;
}

function normalizeReferenceUrls(items=[]){
  const flat=Array.isArray(items)?items:[items];
  const seen=new Set();
  const out=[];
  for(const item of flat){
    const raw=typeof item==='string' ? item : (item?.url || item?.publicUrl || item?.src || '');
    if(typeof raw!=='string' || !/^https:\/\//i.test(raw)) continue;
    if(seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
    if(out.length>=9) break;
  }
  return out;
}

async function generateHiggsfieldScene(body){
  if(!higgsfieldConfigured()) throw new Error('Higgsfield API is not configured');

  const prompt=String(body?.prompt || '').trim();
  if(!prompt) throw new Error('Scene prompt is required');

  const refs=normalizeReferenceUrls(body?.referenceMedia || body?.references || body?.imageUrls || []);
  const duration=clampNumber(body?.duration,4,15,5);
  const aspectRatio=String(body?.aspectRatio || '9:16');
  const generateAudio=body?.generateAudio !== false;

  const credentials=`${process.env.HIGGSFIELD_API_KEY_ID}:${process.env.HIGGSFIELD_API_KEY_SECRET}`;
  const client=createHiggsfieldClient({
    credentials,
    timeout:120000,
    maxRetries:3,
    pollInterval:2500,
    maxPollTime:360000
  });

  const model=String(
    body?.model ||
    (refs.length ? 'bytedance/seedance-2.0/reference-to-video' : 'bytedance/seedance-2.0/text-to-video')
  );

  const input={
    prompt,
    duration,
    resolution:String(body?.resolution || '720p'),
    aspect_ratio:aspectRatio,
    generate_audio:generateAudio
  };
  if(refs.length) input.image_urls=refs;

  const result=await client.subscribe(model,{input,withPolling:true});
  const jobs=Array.isArray(result?.jobs)?result.jobs:[];
  const urls=jobs
    .map(job=>job?.results?.raw?.url || job?.results?.url || job?.result?.url)
    .filter(Boolean);

  const hfAccount=sanitizeAccountId(body?.accountId||DEFAULT_ACCOUNT_ID);
  const hfRates=await costRates(hfAccount).catch(()=>({}));
  const hfRub=(Number(hfRates.higgsfieldRubPerGeneration)||0)*Math.max(1,jobs.length||1);
  await recordExpense(hfAccount,{
    provider:'Higgsfield',category:'generation',description:'Генерация видео',amountRub:hfRub,
    usage:{jobs:Math.max(1,jobs.length||1),duration},model,source:'auto'
  }).catch(()=>{});

  return {
    ok:Boolean(result?.isCompleted ?? urls.length),
    provider:'higgsfield',
    model,
    input:{...input,image_urls:refs.length?refs:undefined},
    requestId:result?.requestId || result?.request_id || null,
    isCompleted:Boolean(result?.isCompleted ?? urls.length),
    isNsfw:Boolean(result?.isNsfw),
    urls,
    jobs
  };
}


async function generateRunwayScene(body){
  if(!process.env.RUNWAYML_API_SECRET) throw new Error('Runway API is not configured');
  const prompt=String(body?.prompt||'').trim();
  if(!prompt) throw new Error('Scene prompt is required');

  const refs=normalizeReferenceUrls(body?.referenceMedia || body?.references || body?.imageUrls || []);
  const requested=Number(body?.duration)||5;
  const duration=requested>=8?10:5;
  const ratio=String(body?.ratio||'720:1280');
  const client=new RunwayML({apiKey:process.env.RUNWAYML_API_SECRET});

  try{
    const pending=client.imageToVideo.create({
      model:String(body?.model||process.env.RUNWAY_MODEL||'gen4.5'),
      ...(refs[0]?{promptImage:refs[0]}:{}),
      promptText:prompt,
      ratio,
      duration
    });
    const created=await pending;
    const completed=await pending.waitForTaskOutput();
    const output=Array.isArray(completed?.output)?completed.output:[];
    const rwAccount=sanitizeAccountId(body?.accountId||DEFAULT_ACCOUNT_ID);
    const rwRates=await costRates(rwAccount).catch(()=>({}));
    const rwRub=(Number(rwRates.runwayRubPerSecond)||0)*duration;
    await recordExpense(rwAccount,{
      provider:'Runway',category:'generation',description:'Генерация видео',amountRub:rwRub,
      usage:{seconds:duration},model:String(body?.model||process.env.RUNWAY_MODEL||'gen4.5'),source:'auto'
    }).catch(()=>{});
    return {
      ok:true,
      provider:'runway',
      taskId:created?.id||completed?.id||null,
      model:String(body?.model||process.env.RUNWAY_MODEL||'gen4.5'),
      duration,
      ratio,
      urls:output.filter(x=>typeof x==='string'),
      raw:completed
    };
  }catch(e){
    if(e instanceof RunwayTaskFailedError){
      throw new Error('Runway task failed: '+JSON.stringify(e.taskDetails||{}));
    }
    throw e;
  }
}

async function descriptRequest(pathname,{method='GET',body}={}){
  if(!process.env.DESCRIPT_API_TOKEN) throw new Error('Descript API is not configured');
  const r=await fetch('https://descriptapi.com/v1'+pathname,{
    method,
    headers:{
      authorization:`Bearer ${process.env.DESCRIPT_API_TOKEN}`,
      ...(body?{'content-type':'application/json'}:{})
    },
    ...(body?{body:JSON.stringify(body)}:{})
  });
  const text=await r.text();
  let data;
  try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
  if(!r.ok) throw new Error(data?.message||data?.error||`Descript error ${r.status}`);
  return data;
}

async function descriptImport(body){
  const result=await descriptRequest('/jobs/import/project_media',{
    method:'POST',
    body:{
      project_name:String(body?.projectName||'Content Factory project'),
      add_media:body?.addMedia||{},
      ...(Array.isArray(body?.compositions)?{add_compositions:body.compositions}:{}),
      ...(body?.callbackUrl?{callback_url:String(body.callbackUrl)}:{})
    }
  });
  const accountId=sanitizeAccountId(body?.accountId||DEFAULT_ACCOUNT_ID);
  const rates=await costRates(accountId).catch(()=>({}));
  await recordExpense(accountId,{provider:'Descript',category:'editing',description:'Импорт проекта',amountRub:Number(rates.descriptRubPerAction)||0,usage:{actions:1},source:'auto'}).catch(()=>{});
  return result;
}

async function descriptAgent(body){
  const projectId=String(body?.projectId||'').trim();
  const prompt=String(body?.prompt||'').trim();
  if(!projectId||!prompt) throw new Error('projectId and prompt are required');
  const result=await descriptRequest('/jobs/agent',{
    method:'POST',
    body:{
      project_id:projectId,
      prompt,
      ...(body?.callbackUrl?{callback_url:String(body.callbackUrl)}:{})
    }
  });
  const accountId=sanitizeAccountId(body?.accountId||DEFAULT_ACCOUNT_ID);
  const rates=await costRates(accountId).catch(()=>({}));
  await recordExpense(accountId,{provider:'Descript',category:'editing',description:'AI-монтаж / agent',amountRub:Number(rates.descriptRubPerAction)||0,usage:{actions:1},source:'auto'}).catch(()=>{});
  return result;
}

async function applyGenerationCallback(body){
  if(!supabaseConfigured()) throw new Error('Server database is not configured');
  const accountId=sanitizeAccountId(body?.accountId||DEFAULT_ACCOUNT_ID);
  const state=await readAppState(accountId);
  const data=state.data || {};
  const runs=Array.isArray(data.runs)?data.runs:[];
  const batchId=body?.batchId || body?.jobId || null;
  if(!batchId) throw new Error('batchId or jobId is required');

  let matched=0;
  for(const run of runs){
    if(run?.batchId===batchId || run?.jobId===batchId || run?.id===batchId){
      matched++;
      run.stage=body?.ok===false ? 'Ошибка генерации' : 'Генерация';
      run.status=body?.ok===false ? 'Ошибка' : 'В работе';
      run.progress=body?.ok===false ? (run.progress || 0) : Math.max(Number(run.progress)||0,65);
      run.generationResult=body?.result || null;
      run.generationError=body?.error || null;
      run.updatedAt=new Date().toISOString();
    }
  }
  data.runs=runs;
  await writeAppState(data,accountId);
  return {matched,accountId};
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');

  if((url.pathname==='/health'||url.pathname==='/api/health') && req.method==='GET'){
    let database=false;
    let databaseError=null;
    if(supabaseConfigured()){
      try{
        await readAppState();
        database=true;
      }catch(e){
        databaseError=String(e?.message||e);
      }
    }
    return json(res,200,{ok:true,service:'Content Factory',version:'1.4.3',database,databaseError,time:new Date().toISOString()});
  }

  if(url.pathname==='/api/status' && req.method==='GET'){
    const railway=Boolean(process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_ENVIRONMENT_ID);
    const github=process.env.GITHUB_CONNECTED === 'true' || Boolean(process.env.RAILWAY_GIT_COMMIT_SHA || process.env.RAILWAY_GIT_REPO_NAME);
    const database=supabaseConfigured();
    const n8nServer=await n8nAlive();
    const n8nWorkflow=process.env.N8N_CONTENT_WEBHOOK_ACTIVE === 'true';
    const n8nGeneration=Boolean(process.env.N8N_GENERATION_WEBHOOK);
    const n8nPostgres=process.env.N8N_POSTGRES_CONNECTED === 'true';
    const drive=process.env.GOOGLE_DRIVE_CONNECTED === 'true';
    const driveMigrated=process.env.GOOGLE_DRIVE_PERSISTENT_MIGRATED === 'true';
    const higgsfield=higgsfieldConfigured();
    const higgsfieldCallbackVerified=process.env.HIGGSFIELD_FINAL_CALLBACK_VERIFIED === 'true';
    const openai=openaiConfigured();
    const chatgptControl=openai && process.env.CHATGPT_CONTROL_ENABLED === 'true';
    const ffmpeg=await commandAvailable('ffmpeg',['-version']);
    const remotion=await moduleAvailable('@remotion/renderer');
    const runway=Boolean(process.env.RUNWAYML_API_SECRET);
    const descript=Boolean(process.env.DESCRIPT_API_TOKEN);
    const tiktok=Boolean(process.env.TIKTOK_ACCESS_TOKEN);
    const instagram=Boolean(process.env.INSTAGRAM_ACCESS_TOKEN);
    const youtube=Boolean(process.env.YOUTUBE_ACCESS_TOKEN || process.env.YOUTUBE_REFRESH_TOKEN);

    const details={
      railway:{
        state:railway?'connected':'missing',
        description:'Хостинг сайта, backend, n8n и PostgreSQL',
        detail:railway?'Production-среда Railway активна':'Railway environment не определён',
        next:railway?'':'Подключить production hosting'
      },
      github:{
        state:github?'connected':'missing',
        description:'Исходный код Content Factory и автодеплой',
        detail:github?'Репозиторий и main используются для production':'Связь с GitHub не подтверждена',
        next:github?'':'Подключить репозиторий к Railway'
      },
      supabase:{
        state:database?'connected':'missing',
        description:'Товары, настройки, статусы и медиа',
        detail:database?'Серверная база и storage подключены':'Supabase backend не настроен',
        next:database?'':'Добавить Supabase URL, key и server secret'
      },
      n8n:{
        state:(n8nServer&&n8nWorkflow&&n8nGeneration&&n8nPostgres)?'connected':(n8nServer&&(n8nWorkflow||n8nGeneration))?'partial':'missing',
        description:'Оркестрация автоматизаций + постоянная PostgreSQL',
        detail:'Сервер: '+(n8nServer?'онлайн':'нет')+' · архив: '+(n8nWorkflow?'подключён':'нет')+' · генерация: '+(n8nGeneration?'подключена':'нет')+' · PostgreSQL: '+(n8nPostgres?'подключён':'не подтверждён'),
        next:(n8nServer&&n8nWorkflow&&n8nGeneration&&n8nPostgres)?'':'Довести все workflow до постоянного n8n'
      },
      drive:{
        state:drive?(driveMigrated?'connected':'partial'):'missing',
        description:'Исходники, генерации, готовые ролики и архив',
        detail:drive?(driveMigrated?'OAuth работает в постоянном n8n':'Архив работает, но Google Drive credential ещё остаётся в старом n8n'):'Google Drive не подключён',
        next:drive&&!driveMigrated?'Перенести OAuth credential в n8n-v2-persistent':drive?'':'Подключить Google Drive'
      },
      higgsfield:{
        state:higgsfield?(higgsfieldCallbackVerified?'connected':'partial'):'missing',
        description:'AI-видео, сцены и референсные персонажи',
        detail:higgsfield?(higgsfieldCallbackVerified?'API и возврат готового видео проверены':'API и generation webhook подключены; финальный callback видео ещё проверяем'):'Higgsfield API не подключён',
        next:higgsfield&&!higgsfieldCallbackVerified?'Подтвердить возврат готового видео в карточку ролика':higgsfield?'':'Добавить API Key ID + Secret'
      },
      openai:{
        state:openai?'connected':'missing',
        description:'Сценарии, хуки, storyboard, промты и AI-проверка',
        detail:openai?'OpenAI API ключ подключён':'Production OpenAI API пока не подключён',
        next:openai?'':'Подключить OPENAI_API_KEY'
      },
      chatgpt:{
        state:chatgptControl?'connected':'missing',
        description:'Чат-пульт внутри Content Factory для управления заводом',
        detail:chatgptControl?'Action-agent активен: ChatGPT может менять настройки, кампании, товары и управлять запусками':'Встроенный управляющий чат ещё не создан',
        next:chatgptControl?'':'После OpenAI API добавить чат + tool calling'
      },
      assembly:{
        state:(ffmpeg&&remotion)?'connected':(ffmpeg||remotion)?'partial':'missing',
        description:'Сборка сцен, музыка, титры и финальный MP4',
        detail:'FFmpeg: '+(ffmpeg?'подключён':'нет')+' · Remotion: '+(remotion?'подключён':'нет'),
        next:(ffmpeg&&remotion)?'':'Добавить deterministic final assembly'
      },
      runway:{
        state:runway?'connected':'missing',
        description:'Дополнительная генерация и AI-редактирование видео',
        detail:runway?'Backend Runway API подключён':'Runway backend API не подключён',
        next:runway?'':'Опционально подключить API и кредиты'
      },
      descript:{
        state:descript?'connected':'missing',
        description:'Голос, субтитры и дополнительная обработка',
        detail:descript?'Descript backend token подключён':'Descript backend token не подключён',
        next:descript?'':'Опционально подключить API token'
      },
      socials:{
        state:(tiktok&&instagram&&youtube)?'connected':(tiktok||instagram||youtube)?'partial':'missing',
        description:'Автопубликация готовых роликов',
        detail:'TikTok: '+(tiktok?'да':'нет')+' · Instagram: '+(instagram?'да':'нет')+' · YouTube: '+(youtube?'да':'нет'),
        next:(tiktok&&instagram&&youtube)?'':'Подключить публикацию после готового монтажного конвейера'
      }
    };

    return json(res,200,{ok:true,services:{
      database,n8nServer,n8nWorkflow,higgsfield,n8nGeneration,runway,descript,drive,
      railway,github,n8nPostgres,openai,chatgptControl,ffmpeg,remotion,tiktok,instagram,youtube
    },details});
  }

  if(url.pathname==='/api/accounts' && req.method==='GET'){
    try{
      const registry=await ensureAccountsRegistry();
      return json(res,200,{ok:true,accounts:registry.accounts||[]});
    }catch(e){
      return json(res,502,{ok:false,error:'Не удалось загрузить аккаунты.',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/accounts' && req.method==='POST'){
    try{
      const body=await readBody(req);
      const registry=await ensureAccountsRegistry();
      const id='acc_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7);
      const account={
        id,
        name:String(body?.name||'Новый аккаунт').trim().slice(0,120)||'Новый аккаунт',
        owner:String(body?.owner||'').trim().slice(0,160),
        company:String(body?.company||'').trim().slice(0,200),
        email:String(body?.email||'').trim().slice(0,240),
        phone:String(body?.phone||'').trim().slice(0,80),
        notes:String(body?.notes||'').trim().slice(0,5000),
        memory:String(body?.memory||'').trim().slice(0,12000),
        avatarUrl:String(body?.avatarUrl||'').trim().slice(0,2000),
        avatarPath:String(body?.avatarPath||'').trim().slice(0,2000),
        createdAt:new Date().toISOString()
      };
      registry.accounts.push(account);
      await writeAccountsRegistry(registry);
      await writeAppState(blankFactoryState(),id);
      return json(res,201,{ok:true,account});
    }catch(e){
      return json(res,502,{ok:false,error:'Не удалось создать аккаунт.',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/accounts' && req.method==='PUT'){
    try{
      const body=await readBody(req);
      const id=sanitizeAccountId(body?.id||url.searchParams.get('id')||'');
      const registry=await ensureAccountsRegistry();
      const account=registry.accounts.find(x=>x.id===id);
      if(!account) return json(res,404,{ok:false,error:'Аккаунт не найден'});
      for(const key of ['name','owner','company','email','phone','notes','memory','avatarUrl','avatarPath']){
        if(body?.[key]!==undefined){
          const limit=key==='memory'?12000:key==='notes'?5000:(key==='avatarUrl'||key==='avatarPath'?2000:240);
          account[key]=String(body[key]||'').trim().slice(0,limit);
        }
      }
      if(!account.name) account.name='Аккаунт';
      account.updatedAt=new Date().toISOString();
      await writeAccountsRegistry(registry);
      return json(res,200,{ok:true,account});
    }catch(e){
      return json(res,502,{ok:false,error:'Не удалось сохранить аккаунт.',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/accounts' && req.method==='DELETE'){
    try{
      const id=sanitizeAccountId(url.searchParams.get('id')||'');
      if(id===DEFAULT_ACCOUNT_ID) return json(res,400,{ok:false,error:'Основной аккаунт нельзя удалить.'});
      const registry=await ensureAccountsRegistry();
      if(!registry.accounts.some(x=>x.id===id)) return json(res,404,{ok:false,error:'Аккаунт не найден'});
      registry.accounts=registry.accounts.filter(x=>x.id!==id);
      await writeAccountsRegistry(registry);
      await deleteStateRow(accountStateRowId(id));
      return json(res,200,{ok:true,deletedId:id});
    }catch(e){
      return json(res,502,{ok:false,error:'Не удалось удалить аккаунт.',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/expenses' && req.method==='POST'){
    try{
      const body=await readBody(req);
      const accountId=sanitizeAccountId(body?.accountId||DEFAULT_ACCOUNT_ID);
      const expense=await recordExpense(accountId,{
        provider:body?.provider||'Другое',
        category:body?.category||'manual',
        description:body?.description||'Ручной расход',
        amountRub:body?.amountRub,
        amountUsd:body?.amountUsd,
        recurring:body?.recurring||'',
        source:'manual',
        createdAt:body?.createdAt||new Date().toISOString()
      });
      return json(res,201,{ok:true,expense});
    }catch(e){
      return json(res,502,{ok:false,error:'Не удалось сохранить расход',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/expenses' && req.method==='DELETE'){
    try{
      const accountId=sanitizeAccountId(url.searchParams.get('account')||DEFAULT_ACCOUNT_ID);
      const id=String(url.searchParams.get('id')||'');
      const state=await readAppState(accountId);
      const data=state?.data||blankFactoryState();
      data.expenses=(Array.isArray(data.expenses)?data.expenses:[]).filter(x=>x.id!==id);
      await writeAppState(data,accountId);
      return json(res,200,{ok:true});
    }catch(e){
      return json(res,502,{ok:false,error:'Не удалось удалить расход',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/state' && req.method==='GET'){
    if(!supabaseConfigured()){
      return json(res,503,{ok:false,configured:false,error:'Серверная база ещё не подключена.'});
    }
    try{
      const accountId=sanitizeAccountId(url.searchParams.get('account')||req.headers['x-content-account']||DEFAULT_ACCOUNT_ID);
      const state=await readAppState(accountId);
      return json(res,200,{ok:true,accountId,...state});
    }catch(e){
      return json(res,502,{ok:false,configured:true,error:'Не удалось прочитать серверное состояние.',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/state' && (req.method==='PUT'||req.method==='POST')){
    if(!supabaseConfigured()){
      return json(res,503,{ok:false,configured:false,error:'Серверная база ещё не подключена.'});
    }
    try{
      const body=await readBody(req);
      const accountId=sanitizeAccountId(url.searchParams.get('account')||req.headers['x-content-account']||body?.accountId||DEFAULT_ACCOUNT_ID);
      const data=body?.data ?? body;
      await writeAppState(data,accountId);
      return json(res,200,{ok:true,configured:true,accountId,savedAt:new Date().toISOString()});
    }catch(e){
      return json(res,502,{ok:false,configured:true,error:'Не удалось сохранить серверное состояние.',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/media/upload' && req.method==='POST'){
    try{
      const body=await readBody(req);
      const data=await callProductMedia({
        action:'upload',
        productId:body.productId,
        fileName:body.fileName,
        mimeType:body.mimeType,
        dataBase64:body.dataBase64
      });
      return json(res,200,data);
    }catch(e){
      return json(res,502,{ok:false,error:'Не удалось загрузить фото.',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/media/delete' && req.method==='POST'){
    try{
      const body=await readBody(req);
      const data=await callProductMedia({action:'delete',path:body.path});
      return json(res,200,data);
    }catch(e){
      return json(res,502,{ok:false,error:'Не удалось удалить фото.',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/runway/generate-scene' && req.method==='POST'){
    if(!internalRequestAllowed(req)) return json(res,401,{ok:false,error:'Unauthorized internal request'});
    try{
      const body=await readBody(req);
      const result=await generateRunwayScene(body);
      return json(res,200,result);
    }catch(e){
      return json(res,502,{ok:false,error:'Runway generation failed',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/descript/import' && req.method==='POST'){
    if(!internalRequestAllowed(req)) return json(res,401,{ok:false,error:'Unauthorized internal request'});
    try{
      const body=await readBody(req);
      return json(res,202,{ok:true,data:await descriptImport(body)});
    }catch(e){
      return json(res,502,{ok:false,error:'Descript import failed',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/descript/agent' && req.method==='POST'){
    if(!internalRequestAllowed(req)) return json(res,401,{ok:false,error:'Unauthorized internal request'});
    try{
      const body=await readBody(req);
      return json(res,202,{ok:true,data:await descriptAgent(body)});
    }catch(e){
      return json(res,502,{ok:false,error:'Descript agent failed',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/higgsfield/generate-scene' && req.method==='POST'){
    if(!internalRequestAllowed(req)){
      return json(res,401,{ok:false,error:'Unauthorized internal request'});
    }
    try{
      const body=await readBody(req);
      const result=await generateHiggsfieldScene(body);
      return json(res,200,result);
    }catch(e){
      return json(res,502,{ok:false,error:'Higgsfield generation failed',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/generation/callback' && req.method==='POST'){
    if(!internalRequestAllowed(req)){
      return json(res,401,{ok:false,error:'Unauthorized internal request'});
    }
    try{
      const body=await readBody(req);
      const saved=await applyGenerationCallback(body);
      return json(res,200,{ok:true,...saved});
    }catch(e){
      return json(res,502,{ok:false,error:'Generation callback failed',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/chat' && req.method==='POST'){
    if(!openaiConfigured() || process.env.CHATGPT_CONTROL_ENABLED!=='true'){
      return json(res,503,{ok:false,error:'ChatGPT-пульт ещё не подключён. Нужен OpenAI API и включение управляющего чата.'});
    }
    try{
      const body=await readBody(req);
      const message=String(body?.message||'').trim();
      if(!message) return json(res,400,{ok:false,error:'Пустое сообщение'});
      const accountId=sanitizeAccountId(body?.accountId||DEFAULT_ACCOUNT_ID);
      const result=await callOpenAIChat(message,body?.history||[],accountId);
      return json(res,200,{ok:true,...result});
    }catch(e){
      return json(res,502,{ok:false,error:'OpenAI chat failed',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/start' && req.method==='POST'){
    try{
      const payload=await readBody(req);
      const result=await dispatchFactoryStart(payload);
      return json(res,result.ok?202:502,result);
    }catch(e){
      return json(res,502,{ok:false,error:'Не удалось связаться с рабочими процессами n8n.',detail:String(e?.message||e)});
    }
  }

  let filePath=path.join(publicDir,url.pathname==='/'?'index.html':url.pathname);
  if(!filePath.startsWith(publicDir)) return json(res,403,{ok:false});

  try{
    const st=fs.statSync(filePath);
    if(st.isDirectory()) filePath=path.join(filePath,'index.html');
    const ext=path.extname(filePath);
    const noCache=['.html','.js','.css','.webmanifest'].includes(ext)||url.pathname==='/sw.js';
    res.writeHead(200,{
      'content-type':mime[ext]||'application/octet-stream',
      'cache-control':noCache?'no-store, max-age=0':'public, max-age=3600'
    });
    fs.createReadStream(filePath).pipe(res);
  }catch{
    const index=path.join(publicDir,'index.html');
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store, max-age=0'});
    fs.createReadStream(index).pipe(res);
  }
});

server.listen(port,'0.0.0.0',()=>console.log(`Content Factory запущен на порту ${port}`));
