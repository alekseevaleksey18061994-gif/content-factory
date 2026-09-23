import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHiggsfieldClient } from '@higgsfield/client/v2';
import RunwayML, { TaskFailedError as RunwayTaskFailedError } from '@runwayml/sdk';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { once } from 'node:events';
import { fetchTranscript } from 'youtube-transcript';

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
const USERS_REGISTRY_ID='auth_users_registry';
const SESSION_COOKIE='cf_session';


function normalizeLogin(value){
  return String(value||'').trim().toLowerCase().replace(/\s+/g,'').slice(0,80);
}
function hashPassword(password,salt){
  return scryptSync(String(password||''),salt,64).toString('hex');
}
function parseCookies(req){
  const raw=String(req.headers.cookie||'');
  const out={};
  for(const part of raw.split(';')){
    const i=part.indexOf('=');
    if(i>0) out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());
  }
  return out;
}
function sessionSecret(){
  return process.env.AUTH_SESSION_SECRET || process.env.CONTENT_FACTORY_DB_SECRET || '';
}
function makeSessionToken(userId){
  const payload=Buffer.from(JSON.stringify({uid:userId,exp:Date.now()+30*24*60*60*1000})).toString('base64url');
  const sig=createHmac('sha256',sessionSecret()).update(payload).digest('base64url');
  return payload+'.'+sig;
}
function readSessionToken(token){
  try{
    const [payload,sig]=String(token||'').split('.');
    if(!payload||!sig||!sessionSecret()) return null;
    const expected=createHmac('sha256',sessionSecret()).update(payload).digest('base64url');
    const a=Buffer.from(sig),b=Buffer.from(expected);
    if(a.length!==b.length||!timingSafeEqual(a,b)) return null;
    const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    if(!data?.uid||Number(data.exp)<Date.now()) return null;
    return data;
  }catch{return null}
}
function setSessionCookie(res,token){
  res.setHeader('set-cookie',SESSION_COOKIE+'='+encodeURIComponent(token)+'; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure');
}
function clearSessionCookie(res){
  res.setHeader('set-cookie',SESSION_COOKIE+'=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure');
}
async function ensureUsersRegistry(){
  const row=await readStateRow(USERS_REGISTRY_ID);
  if(row.data?.users) return row.data;
  const registry={version:1,users:[]};
  await writeStateRow(USERS_REGISTRY_ID,registry);
  return registry;
}
async function writeUsersRegistry(registry){
  registry.version=1;
  registry.users=Array.isArray(registry.users)?registry.users:[];
  await writeStateRow(USERS_REGISTRY_ID,registry);
  return registry;
}
async function sessionUser(req){
  const session=readSessionToken(parseCookies(req)[SESSION_COOKIE]);
  if(!session) return null;
  const registry=await ensureUsersRegistry();
  const user=registry.users.find(u=>u.id===session.uid);
  return user?{id:user.id,login:user.login,displayName:user.displayName||user.login,createdAt:user.createdAt}:null;
}
async function userOwnsAccount(userId,accountId){
  if(!userId)return false;
  const registry=await ensureAccountsRegistry();
  return registry.accounts.some(a=>a.id===sanitizeAccountId(accountId)&&a.ownerUserId===userId);
}
async function firstUserAccount(userId){
  const registry=await ensureAccountsRegistry();
  return registry.accounts.find(a=>a.ownerUserId===userId)||null;
}

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
    chatHistory:[],
    videoAnalyses:[],
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
      ownerUserId:null,
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


function cleanCredentialPart(value){
  let v=String(value||'').trim();
  if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1).trim();
  return v;
}
function validHiggsfieldCombined(value){
  const v=cleanCredentialPart(value);
  const first=v.indexOf(':');
  return first>0 && first===v.lastIndexOf(':') && first<v.length-1;
}
function higgsfieldCredentialParts(){
  const id=cleanCredentialPart(process.env.HIGGSFIELD_API_KEY_ID);
  const secret=cleanCredentialPart(process.env.HIGGSFIELD_API_KEY_SECRET);
  if(validHiggsfieldCombined(id)){
    const p=id.indexOf(':');
    return {apiKey:id.slice(0,p),apiSecret:id.slice(p+1)};
  }
  if(!id&&validHiggsfieldCombined(secret)){
    const p=secret.indexOf(':');
    return {apiKey:secret.slice(0,p),apiSecret:secret.slice(p+1)};
  }
  return {apiKey:id,apiSecret:secret};
}
const higgsfieldConfigured = () => {
  const c=higgsfieldCredentialParts();
  return Boolean(c.apiKey&&c.apiSecret);
};

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

function findCharacterInState(data,query){
  const items=Array.isArray(data?.characters)?data.characters:[];
  const q=compactName(query);
  if(!q) return null;
  return items.find(x=>String(x?.id||'')===String(query))
    || items.find(x=>compactName(x?.name)===q)
    || items.find(x=>compactName(x?.name).includes(q)||q.includes(compactName(x?.name)))
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
  const branches=[results.archive,results.generation].filter(Boolean);
  const primaryOk=branches.length>0 && branches.every(x=>x.ok);
  return {ok:primaryOk,data:results};
}

function planSceneDefaults(i,count=5){
  const n=i+1;
  const titles=['Хук','Проблема','Демонстрация','Результат','CTA'];
  return {scene:n,title:titles[i]||('Сцена '+n),duration:'5–6 сек',shot:'Крупный план товара',action:'Показать товар и действие',voiceover:'',onscreen:'',prompt:''};
}
function normalizeRunPlan(raw,payload={}){
  const plan=raw&&typeof raw==='object'?raw:{};
  const idea=plan.idea&&typeof plan.idea==='object'?plan.idea:{};
  const script=plan.script&&typeof plan.script==='object'?plan.script:{};
  let storyboard=Array.isArray(plan.storyboard)?plan.storyboard:[];
  const targetCount=Math.max(3,Math.min(8,Number(plan.sceneCount)||Number(payload.sceneCount)||5));
  storyboard=storyboard.slice(0,targetCount).map((x,i)=>({
    ...planSceneDefaults(i,targetCount),
    ...(x&&typeof x==='object'?x:{}),
    scene:i+1
  }));
  while(storyboard.length<targetCount)storyboard.push(planSceneDefaults(storyboard.length,targetCount));
  const productRefs=(payload.media||payload.product?.media||[]).map(x=>x?.url).filter(Boolean).slice(0,6);
  const avatarRefs=(payload.avatarReferences||payload.character?.media||[]).map(x=>x?.url).filter(Boolean).slice(0,6);
  const references=plan.references&&typeof plan.references==='object'?plan.references:{};
  return {
    idea:{
      title:String(idea.title||payload.productName||'Идея ролика').slice(0,240),
      concept:String(idea.concept||idea.summary||payload.brief||'Демонстрация товара через проблему и решение').slice(0,5000),
      hook:String(idea.hook||script.hook||'').slice(0,2000),
      angle:String(idea.angle||'').slice(0,2000),
      why:String(idea.why||idea.whyWorks||'').slice(0,4000),
      audience:String(idea.audience||'').slice(0,2000),
      first3Seconds:String(idea.first3Seconds||idea.first3seconds||'').slice(0,3000),
      mechanic:String(idea.mechanic||'').slice(0,3000),
      productRole:String(idea.productRole||'').slice(0,3000),
      retention:String(idea.retention||idea.retentionMechanic||'').slice(0,3000),
      payoff:String(idea.payoff||'').slice(0,3000),
      ctaDirection:String(idea.ctaDirection||'').slice(0,2000),
      production:String(idea.production||idea.productionComplexity||'').slice(0,1200),
      alternatives:(Array.isArray(idea.alternatives)?idea.alternatives:[]).slice(0,5).map(x=>({
        title:String(x?.title||'').slice(0,240),
        hook:String(x?.hook||'').slice(0,1500),
        concept:String(x?.concept||'').slice(0,3000),
        angle:String(x?.angle||'').slice(0,1500)
      }))
    },
    script:{
      hook:String(script.hook||idea.hook||'').slice(0,4000),
      body:String(script.body||script.voiceover||'').slice(0,12000),
      cta:String(script.cta||'').slice(0,3000),
      voiceover:String(script.voiceover||script.body||'').slice(0,12000),
      scenes:(Array.isArray(script.scenes)?script.scenes:storyboard.map((x,i)=>({
        scene:i+1,
        time:x.duration||'',
        visual:[x.shot,x.action].filter(Boolean).join(' — '),
        dialogue:x.voiceover||x.onscreen||'',
        sound:x.sound||''
      }))).slice(0,targetCount).map((x,i)=>({
        scene:Number(x?.scene)||i+1,
        time:String(x?.time||x?.duration||storyboard[i]?.duration||'').slice(0,120),
        visual:String(x?.visual||x?.shot||x?.action||'').slice(0,5000),
        dialogue:String(x?.dialogue||x?.text||x?.voiceover||'').slice(0,5000),
        sound:String(x?.sound||'').slice(0,2000)
      }))
    },
    storyboard,
    references:{
      product:productRefs,
      avatar:avatarRefs,
      style:String(references.style||payload.style||'').slice(0,2000),
      notes:String(references.notes||'Сохранять реальный товар и внешность выбранного AI-аватара.').slice(0,4000)
    }
  };
}
function normalizeIdeaStage(raw,payload={}){
  const src=raw&&typeof raw==='object'?(raw.selected||raw.idea||raw):{};
  const alts=Array.isArray(raw?.alternatives)?raw.alternatives:(Array.isArray(src?.alternatives)?src.alternatives:[]);
  return {
    title:String(src.title||payload.productName||'Идея ролика').slice(0,240),
    concept:String(src.concept||src.summary||payload.brief||'').slice(0,5000),
    hook:String(src.hook||'').slice(0,2000),
    angle:String(src.angle||'').slice(0,2000),
    why:String(src.why||src.whyWorks||'').slice(0,4000),
    audience:String(src.audience||'').slice(0,2000),
    first3Seconds:String(src.first3Seconds||src.first3seconds||'').slice(0,3000),
    mechanic:String(src.mechanic||'').slice(0,3000),
    productRole:String(src.productRole||'').slice(0,3000),
    retention:String(src.retention||src.retentionMechanic||'').slice(0,3000),
    payoff:String(src.payoff||'').slice(0,3000),
    ctaDirection:String(src.ctaDirection||'').slice(0,2000),
    production:String(src.production||src.productionComplexity||'').slice(0,1200),
    alternatives:alts.slice(0,5).map(x=>({
      title:String(x?.title||'').slice(0,240),
      hook:String(x?.hook||'').slice(0,1500),
      concept:String(x?.concept||'').slice(0,3000),
      angle:String(x?.angle||'').slice(0,1500)
    }))
  };
}
async function recentIdeaContext(accountId,productId){
  try{
    const state=await readAppState(accountId);
    const data=state?.data||{};
    const recent=(Array.isArray(data.runs)?data.runs:[])
      .filter(r=>r?.idea && (!productId||r.productId===productId))
      .slice(-12)
      .map(r=>({title:r.idea?.title||'',hook:r.idea?.hook||'',concept:r.idea?.concept||''}));
    const analyses=(Array.isArray(data.videoAnalyses)?data.videoAnalyses:[])
      .slice(-5)
      .map(v=>({
        title:String(v?.title||v?.name||'').slice(0,200),
        summary:String(v?.summary||v?.analysis?.summary||v?.result?.summary||'').slice(0,1200),
        hooks:Array.isArray(v?.hooks)?v.hooks.slice(0,5):[]
      }));
    return {recent,analyses};
  }catch{return {recent:[],analyses:[]}}
}
async function generateIdeaStage(payload,accountId,variant=1,feedback=''){
  if(!openaiConfigured())throw new Error('OpenAI API is not configured');
  const ctx=await recentIdeaContext(accountId,payload.productId||payload.product?.id);
  const refs=(payload.media||payload.product?.media||[])
    .map(x=>x?.url).filter(x=>/^https:\/\//i.test(String(x||''))).slice(0,3);
  const master=[
    'ROLE: Ты senior creative director и performance-креатор коротких вертикальных видео для TikTok, Reels и YouTube Shorts.',
    'ЗАДАЧА: придумать не просто тему, а сильную КРЕАТИВНУЮ МЕХАНИКУ ролика, которую хочется досмотреть и которая органично продаёт товар.',
    '',
    'КОНТЕКСТ ТОВАРА',
    'Товар: '+String(payload.productName||payload.product?.name||'Товар'),
    'Категория: '+String(payload.product?.category||payload.category||''),
    'УТП: '+String(payload.productUtp||payload.product?.utp||''),
    'Правила/ограничения: '+String(payload.productRules||payload.product?.rules||''),
    'Формат: 9:16',
    'Длительность: '+String(payload.duration||'30 сек'),
    'Желаемый стиль: '+String(payload.style||'UGC'),
    'Бриф пользователя: '+String(payload.brief||''),
    'Вариант запуска: '+variant,
    feedback?('Комментарий пользователя к переделке: '+feedback):'',
    '',
    'ЦЕЛЬ ИДЕИ',
    '1) В первые 1–2 секунды должно быть понятно, почему не хочется свайпнуть.',
    '2) Идея должна работать ВИЗУАЛЬНО даже без звука; товар или интрига вокруг товара появляются максимально рано.',
    '3) Товар — часть действия и механики ролика, а не реквизит в руке.',
    '4) Нужен один сильный центральный приём: тест, неожиданность, проблема→решение, POV, мини-история, визуальное сравнение, эксперимент, демонстрация, экспертный разбор или другая понятная механика.',
    '5) Идея должна быть реально генерируемой нейросетями по отдельным сценам. Не предлагай сложные толпы, невозможную физику, мелкий текст в кадре или десятки объектов.',
    '6) Не придумывай характеристики, которых нет в данных товара. Не делай медицинских, гарантированных или недоказанных обещаний.',
    '7) Не делай банальную рекламу вида «красивая девушка держит товар, улыбается и рассказывает преимущества», если в этом нет отдельного сильного приёма.',
    '8) Не начинай с логотипа, упаковки на столе или общего плана ванной/комнаты без действия.',
    '9) Если есть анализы конкурентов, бери из них только ПАТТЕРНЫ удержания, структуру и приёмы. Не копируй чужие тексты, персонажей, шутки, сюжет или брендинг.',
    '10) Избегай повторения уже использованных нами идей.',
    '',
    'ПРОЦЕСС МЫШЛЕНИЯ',
    'Сначала придумай 8 принципиально разных концепций. Они должны отличаться не формулировкой, а механикой.',
    'Мысленно оцени каждую по пяти критериям: удержание первых секунд, органичность товара, визуальная понятность, оригинальность, простота/стоимость производства.',
    'Отбрось слабые, шаблонные и слишком дорогие. Выбери одну лучшую для текущего товара.',
    'Не показывай внутренние оценки и рассуждения.',
    '',
    'ОСНОВНАЯ ИДЕЯ ДОЛЖНА СОДЕРЖАТЬ',
    '- title: короткое рабочее название;',
    '- audience: кому это должно зацепить;',
    '- hook: сама идея хука, а не готовый сценарий;',
    '- first3Seconds: буквально что зритель увидит в первые 3 секунды;',
    '- concept: что происходит в ролике от начала до результата в 3–6 предложениях;',
    '- mechanic: центральная механика/приём;',
    '- angle: угол подачи;',
    '- productRole: как именно товар участвует в действии;',
    '- retention: что удерживает зрителя до конца;',
    '- payoff: какой визуальный/сюжетный результат получает зритель;',
    '- ctaDirection: естественное направление CTA без рекламного клише;',
    '- production: low / medium / high + коротко почему;',
    '- why: почему эта идея должна сработать именно для этого товара.',
    '',
    'АЛЬТЕРНАТИВЫ',
    'Верни ещё 4 действительно разные запасные идеи — каждая с title, hook, concept, angle.',
    '',
    'ПРОВЕРКА ПЕРЕД ОТВЕТОМ',
    '- Можно ли понять хук без звука?',
    '- Есть ли причина смотреть после 3-й секунды?',
    '- Товар действительно нужен для сюжета?',
    '- Не выглядит ли это как обычная реклама маркетплейса?',
    '- Можно ли разбить идею на 3–8 генерируемых сцен?',
    '- Не повторяет ли она прошлые идеи?',
    '',
    'Недавние наши идеи (НЕ ПОВТОРЯТЬ): '+JSON.stringify(ctx.recent),
    'Разборы конкурентов/референсных видео, если были (ТОЛЬКО КАК ПАТТЕРНЫ): '+JSON.stringify(ctx.analyses),
    '',
    'Верни ТОЛЬКО валидный JSON без markdown:',
    '{"selected":{"title":"","audience":"","hook":"","first3Seconds":"","concept":"","mechanic":"","angle":"","productRole":"","retention":"","payoff":"","ctaDirection":"","production":"","why":""},"alternatives":[{"title":"","hook":"","concept":"","angle":""}]}'
  ].filter(Boolean).join('\n');
  const input=[{role:'user',content:[
    {type:'input_text',text:master},
    ...refs.map(url=>({type:'input_image',image_url:String(url),detail:'low'}))
  ]}];
  const model=process.env.OPENAI_MODEL||'gpt-5.6-luna';
  const r=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'content-type':'application/json'},
    body:JSON.stringify({model,input,reasoning:{effort:'medium'},max_output_tokens:2800})
  });
  const txt=await r.text();
  let data;try{data=txt?JSON.parse(txt):{}}catch{data={raw:txt}}
  if(!r.ok)throw new Error(data?.error?.message||('OpenAI idea error '+r.status));
  const priced=openAIUsageCost(data?.model||model,data?.usage||{});
  if(priced.amountUsd>0)await recordExpense(accountId,{
    provider:'OpenAI',category:'idea',description:'Генерация креативной идеи ролика',
    amountUsd:priced.amountUsd,model:data?.model||model,usage:priced.details,source:'auto'
  }).catch(()=>{});
  return normalizeIdeaStage(safeAnalysisJson(openAIText(data)),payload);
}

function scenarioTargetCount(payload={}){
  const seconds=Number(String(payload.duration||'30').match(/\d+/)?.[0]||30);
  return Math.max(4,Math.min(8,Math.round(seconds/6)));
}
function normalizeScriptStage(raw,payload={}){
  const src=raw&&typeof raw==='object'?(raw.script||raw):{};
  const target=scenarioTargetCount(payload);
  let scenes=Array.isArray(src.scenes)?src.scenes:[];
  scenes=scenes.slice(0,10).map((x,i)=>({
    scene:Number(x?.scene)||i+1,
    time:String(x?.time||x?.duration||'').slice(0,120),
    purpose:String(x?.purpose||x?.goal||'').slice(0,1800),
    visual:String(x?.visual||x?.shot||'').slice(0,6000),
    action:String(x?.action||'').slice(0,4000),
    dialogue:String(x?.dialogue||x?.text||'').slice(0,5000),
    voiceover:String(x?.voiceover||'').slice(0,5000),
    onscreen:String(x?.onscreen||x?.subtitle||'').slice(0,3000),
    sound:String(x?.sound||'').slice(0,2500),
    transition:String(x?.transition||'').slice(0,1800),
    continuity:String(x?.continuity||'').slice(0,3000),
    productRole:String(x?.productRole||'').slice(0,2500)
  }));
  return {
    title:String(src.title||payload.idea?.title||payload.productName||'Сценарий').slice(0,240),
    logline:String(src.logline||'').slice(0,3000),
    hook:String(src.hook||payload.idea?.hook||'').slice(0,4000),
    structure:String(src.structure||'').slice(0,4000),
    body:String(src.body||src.voiceover||'').slice(0,12000),
    cta:String(src.cta||payload.idea?.ctaDirection||'').slice(0,3000),
    voiceover:String(src.voiceover||'').slice(0,12000),
    tone:String(src.tone||payload.style||'').slice(0,2000),
    duration:String(src.duration||payload.duration||'').slice(0,120),
    sceneCount:scenes.length||target,
    characters:Array.isArray(src.characters)?src.characters.slice(0,12).map(x=>({
      name:String(x?.name||'').slice(0,160),
      role:String(x?.role||'').slice(0,1000),
      look:String(x?.look||'').slice(0,2000),
      voice:String(x?.voice||'').slice(0,1200),
      locks:String(x?.locks||'').slice(0,1800)
    })):[],
    globalContinuity:String(src.globalContinuity||'').slice(0,5000),
    subtitleRules:String(src.subtitleRules||'').slice(0,3000),
    productRules:String(src.productRules||payload.productRules||payload.product?.rules||'').slice(0,5000),
    scenes
  };
}
async function generateScriptStage(payload,accountId,feedback=''){
  if(!openaiConfigured())throw new Error('OpenAI API is not configured');
  const idea=normalizeIdeaStage(payload.idea||{},payload);
  if(!idea.title&&!idea.concept)throw new Error('Сначала нужна утверждённая идея');
  const target=scenarioTargetCount(payload);
  const ctx=await recentIdeaContext(accountId,payload.productId||payload.product?.id);
  const refs=[
    ...(payload.media||payload.product?.media||[]).map(x=>x?.url),
    ...(payload.avatarReferences||payload.character?.media||[]).map(x=>x?.url)
  ].filter(x=>/^https:\/\//i.test(String(x||''))).slice(0,4);
  const master=[
    'ROLE: Ты сценарист, режиссёр и продюсер коротких вертикальных рекламных видео для TikTok, Reels и YouTube Shorts.',
    'ВАЖНО: идея уже утверждена. НЕ придумывай новую идею. Твоя задача — превратить утверждённую идею в полноценный съёмочный сценарий.',
    '',
    'УТВЕРЖДЁННАЯ ИДЕЯ',
    JSON.stringify(idea),
    '',
    'ТОВАР',
    'Название: '+String(payload.productName||payload.product?.name||'Товар'),
    'УТП: '+String(payload.productUtp||payload.product?.utp||''),
    'Факты/ограничения товара: '+String(payload.productRules||payload.product?.rules||''),
    'Длительность ролика: '+String(payload.duration||'30 сек'),
    'Формат: вертикальный 9:16.',
    'Стиль: '+String(payload.style||'UGC'),
    'Бриф пользователя: '+String(payload.brief||''),
    'AI-персонаж: '+String(payload.character?.name||'не задан'),
    'Внешность/locks персонажа: '+String(payload.character?.look||'')+' '+String(payload.character?.locks||''),
    feedback?('Комментарий пользователя к переделке: '+feedback):'',
    '',
    'ПРИНЦИПЫ',
    '1) Это СЦЕНАРИЙ, а не storyboard и не промпты генератора. Не пиши технические промпты для видеомоделей.',
    '2) Разбей ролик примерно на '+target+' сцен. Допустимо 4–8, если драматургия требует другого количества.',
    '3) Тайминг сцен обязан покрыть всю длительность без дыр и нелепых пересечений.',
    '4) Первые 1–3 секунды — сильный хук из утверждённой идеи. Никаких заставок, логотипов и медленного вступления.',
    '5) Для КАЖДОЙ сцены обязательно: time, purpose, visual, action, dialogue, voiceover, onscreen, sound, transition, continuity, productRole.',
    '6) visual = конкретно что видит зритель: место, персонажи, композиция, ключевое действие. Не абстрактное «показать продукт».',
    '7) action = последовательность действий внутри сцены, понятная режиссёру.',
    '8) dialogue = только реплики персонажей в кадре. voiceover = только закадровый голос. Не смешивай их.',
    '9) Текст должен реально помещаться в отведённое время. Не пиши 40 слов на 4 секунды.',
    '10) onscreen = только действительно нужный экранный текст/субтитр. Он должен быть коротким и читабельным.',
    '11) sound = музыка, SFX, пауза или тишина. Звук должен поддерживать действие, а не быть случайным.',
    '12) transition = как логично перейти в следующую сцену: cut, match cut, whip, jump cut, freeze frame и т.п. Только если оправдано.',
    '13) continuity = что ОБЯЗАНО сохраниться между сценами: внешность героя, одежда, помещение, положение товара, цвет, повреждения, реквизит и т.п.',
    '14) productRole = зачем товар находится именно в этой сцене и что зритель узнаёт/понимает о нём.',
    '15) Не добавляй характеристик, свойств, размеров, материалов, цветов, эффектов или обещаний, которых нет в данных товара.',
    '16) Внешность персонажа/аватара должна быть одинаковой во всех сценах. Если задана одежда/locks — не меняй.',
    '17) Товар должен оставаться визуально тем же товаром. Если мелкие детали критичны, пометь это в continuity/productRole, но не изобретай их.',
    '18) Не копируй сюжет, реплики, шутки или персонажей конкурентов. Можно использовать только паттерны структуры и удержания.',
    '19) Сценарий должен работать как история: причина → развитие → payoff/результат → естественный CTA.',
    '20) Если идея юмористическая, реклама может быть отложена к финалу; если демонстрационная — товар должен появиться раньше. Следуй утверждённой идее.',
    '',
    'КОНТРОЛЬ СУБТИТРОВ И ИНТЕРФЕЙСА',
    'Крупный читаемый текст, без длинных абзацев.',
    'Не закладывай важный текст у правого края и в самом низу кадра — там интерфейс TikTok/Reels/Shorts.',
    'Сохраняй смысл в центральной безопасной зоне кадра.',
    '',
    'ВНУТРЕННЯЯ ПРОВЕРКА ПЕРЕД ОТВЕТОМ',
    '- Хук понятен без дополнительного объяснения?',
    '- Есть ли у каждой сцены конкретная функция?',
    '- Сумма таймингов соответствует длительности?',
    '- Реплики реально произнести за указанное время?',
    '- Есть ли причинно-следственная связь между сценами?',
    '- Нет ли выдуманных характеристик товара?',
    '- Есть ли continuity для героя и товара?',
    '- Можно ли потом превратить каждую сцену в отдельный storyboard?',
    'Не показывай внутренние рассуждения.',
    '',
    'Разборы конкурентов, если были — использовать только как структурные паттерны, не копировать: '+JSON.stringify(ctx.analyses),
    '',
    'Верни ТОЛЬКО валидный JSON без markdown:',
    '{"script":{"title":"","logline":"","hook":"","structure":"","cta":"","tone":"","duration":"","characters":[{"name":"","role":"","look":"","voice":"","locks":""}],"globalContinuity":"","subtitleRules":"","productRules":"","scenes":[{"scene":1,"time":"0–4 сек","purpose":"","visual":"","action":"","dialogue":"","voiceover":"","onscreen":"","sound":"","transition":"","continuity":"","productRole":""}]}}'
  ].filter(Boolean).join('\n');
  const input=[{role:'user',content:[
    {type:'input_text',text:master},
    ...refs.map(url=>({type:'input_image',image_url:String(url),detail:'low'}))
  ]}];
  const model=process.env.OPENAI_MODEL||'gpt-5.6-luna';
  const r=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'content-type':'application/json'},
    body:JSON.stringify({model,input,reasoning:{effort:'medium'},max_output_tokens:5000})
  });
  const txt=await r.text();
  let data;try{data=txt?JSON.parse(txt):{}}catch{data={raw:txt}}
  if(!r.ok)throw new Error(data?.error?.message||('OpenAI script error '+r.status));
  const priced=openAIUsageCost(data?.model||model,data?.usage||{});
  if(priced.amountUsd>0)await recordExpense(accountId,{
    provider:'OpenAI',category:'script',description:'Генерация сценария ролика',
    amountUsd:priced.amountUsd,model:data?.model||model,usage:priced.details,source:'auto'
  }).catch(()=>{});
  return normalizeScriptStage(safeAnalysisJson(openAIText(data)),payload);
}

async function buildRunPlan(payload,accountId,variant=1,feedback=''){
  if(!openaiConfigured())throw new Error('OpenAI API is not configured');
  const duration=String(payload.duration||'30 сек');
  const lockedIdea=payload.idea?normalizeIdeaStage(payload.idea,payload):await generateIdeaStage(payload,accountId,variant,feedback);
  const scriptPayload={...payload,idea:lockedIdea};
  const lockedScript=payload.script?normalizeScriptStage(payload.script,scriptPayload):await generateScriptStage(scriptPayload,accountId,feedback);
  const refs=[
    ...(payload.media||payload.product?.media||[]).map(x=>x?.url),
    ...(payload.avatarReferences||payload.character?.media||[]).map(x=>x?.url)
  ].filter(x=>/^https:\/\//i.test(String(x||''))).slice(0,4);
  const prompt=[
    'Ты режиссёр-постановщик коротких рекламных Reels/TikTok/Shorts. ИДЕЯ И СЦЕНАРИЙ УЖЕ УТВЕРЖДЕНЫ.',
    'Утверждённая идея: '+JSON.stringify(lockedIdea),
    'Утверждённый сценарий: '+JSON.stringify(lockedScript),
    'НЕ переписывай сценарий и не меняй драматургию. Создай storyboard и производственные референсы строго по нему.',
    'Товар: '+String(payload.productName||payload.product?.name||'Товар'),
    'УТП: '+String(payload.productUtp||payload.product?.utp||''),
    'Ограничения товара: '+String(payload.productRules||payload.product?.rules||''),
    'AI-аватар: '+String(payload.character?.name||'без аватара'),
    'Внешность/locks: '+String(payload.character?.look||'')+' '+String(payload.character?.locks||''),
    'Стиль: '+String(payload.style||'UGC'),
    'Длительность: '+duration,
    'Бриф пользователя: '+String(payload.brief||''),
    'Вариант: '+variant,
    feedback?('Комментарий к переделке: '+feedback):'',
    'Верни ТОЛЬКО JSON без markdown. Структура:',
    '{"idea":{"title":"","concept":"","hook":"","angle":"","why":""},"script":{"hook":"","body":"","cta":"","voiceover":"","scenes":[{"scene":1,"time":"0–5 сек","visual":"","dialogue":"","sound":""}]},"sceneCount":5,"storyboard":[{"scene":1,"title":"Хук","duration":"0–5 сек","shot":"","action":"","voiceover":"","onscreen":"","sound":"","prompt":""}],"references":{"product":[],"avatar":[],"style":"","notes":""}}',
    'Storyboard должен быть визуальным продолжением уже утверждённого сценария и идти сцена-в-сцену по его таймингам, действиям, репликам и continuity.',
    'Не добавляй новые сюжетные линии, новые свойства товара или новые реплики, которых нет в утверждённом сценарии.',
    'Каждый prompt — готовый подробный промт для генерации вертикальной сцены 9:16. Товар всегда должен оставаться узнаваемым и соответствовать референсам.'
  ].filter(Boolean).join('\n');
  const input=[{role:'user',content:[
    {type:'input_text',text:prompt},
    ...refs.map(url=>({type:'input_image',image_url:String(url),detail:'low'}))
  ]}];
  const model=process.env.OPENAI_MODEL||'gpt-5.6-luna';
  const r=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'content-type':'application/json'},
    body:JSON.stringify({model,input,reasoning:{effort:'low'},max_output_tokens:3500})
  });
  const txt=await r.text();
  let data;try{data=txt?JSON.parse(txt):{}}catch{data={raw:txt}}
  if(!r.ok)throw new Error(data?.error?.message||('OpenAI planning error '+r.status));
  const priced=openAIUsageCost(data?.model||model,data?.usage||{});
  if(priced.amountUsd>0)await recordExpense(accountId,{
    provider:'OpenAI',category:'planning',description:'Storyboard + референсы по утверждённому сценарию',
    amountUsd:priced.amountUsd,model:data?.model||model,usage:priced.details,source:'auto'
  }).catch(()=>{});
  const planned=normalizeRunPlan(safeAnalysisJson(openAIText(data)),payload);
  planned.idea=lockedIdea;
  planned.script=lockedScript;
  return planned;
}
function findRunById(data,runId){
  return (Array.isArray(data?.runs)?data.runs:[]).find(r=>r?.id===runId)||null;
}
function mergeByIdPreserveExisting(existing=[],incoming=[],limit=5000){
  const map=new Map();
  for(const item of (Array.isArray(existing)?existing:[])){
    if(item&&item.id)map.set(String(item.id),item);
  }
  for(const item of (Array.isArray(incoming)?incoming:[])){
    if(item&&item.id&&!map.has(String(item.id)))map.set(String(item.id),item);
    else if(item&&item.id){
      const prev=map.get(String(item.id))||{};
      map.set(String(item.id),{...prev,...item});
    }
  }
  return [...map.values()].slice(-limit);
}
function mergeClientStateWithServer(existingData={},incomingData={}){
  const out={...existingData,...incomingData};
  // Production runs are server-authoritative. Client snapshots must never roll
  // backend stage/progress/results/errors backwards.
  out.runs=Array.isArray(existingData.runs)?existingData.runs:[];
  out.expenses=mergeByIdPreserveExisting(existingData.expenses,incomingData.expenses,3000);
  out.journal=mergeByIdPreserveExisting(existingData.journal,incomingData.journal,500);
  out.scripts=mergeByIdPreserveExisting(existingData.scripts,incomingData.scripts,2000);
  out.videoAnalyses=mergeByIdPreserveExisting(existingData.videoAnalyses,incomingData.videoAnalyses,200);
  if(Object.prototype.hasOwnProperty.call(existingData,'chatHistory')){
    out.chatHistory=normalizeStoredChatHistory(existingData.chatHistory||[]);
  }
  return out;
}
async function saveRunPatch(accountId,runId,patch={}){
  const state=await readAppState(accountId);
  const data=state?.data||blankFactoryState();
  data.runs=Array.isArray(data.runs)?data.runs:[];
  const run=findRunById(data,runId);
  if(!run)throw new Error('Ролик не найден');
  Object.assign(run,patch,{updatedAt:new Date().toISOString()});
  await writeAppState(data,accountId);
  return run;
}
async function notifyN8nArchive(payload){
  const direct=process.env.N8N_CONTENT_WEBHOOK;
  const base=process.env.N8N_WEBHOOK_BASE;
  const webhook=direct || (base ? base.replace(/\/$/,'')+'/content-factory-run' : '');
  if(!webhook)return {ok:true,status:0,skipped:true};
  try{
    const r=await fetch(webhook,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...payload,workerMode:'backend-direct'})});
    return {ok:r.ok,status:r.status};
  }catch(e){
    return {ok:false,status:0,error:String(e?.message||e)};
  }
}
function runReferenceUrls(run){
  const productMedia=Array.isArray(run.media)?run.media:(Array.isArray(run.product?.media)?run.product.media:[]);
  const avatarMedia=Array.isArray(run.avatarReferences)?run.avatarReferences:(Array.isArray(run.character?.media)?run.character.media:[]);
  const productPrimary=productMedia.find(x=>x?.isPrimary&&/^https:\/\//i.test(String(x?.url||''))) || productMedia.find(x=>/^https:\/\//i.test(String(x?.url||'')));
  const avatarPrimary=avatarMedia.find(x=>x?.isPrimary&&/^https:\/\//i.test(String(x?.url||''))) || avatarMedia.find(x=>/^https:\/\//i.test(String(x?.url||'')));
  return [productPrimary?.url,avatarPrimary?.url].filter(Boolean);
}
function sceneDurationSeconds(scene){
  const nums=String(scene?.duration||'').match(/\d+(?:[.,]\d+)?/g)||[];
  if(nums.length>=2){
    const a=Number(nums[0].replace(',','.')),b=Number(nums[1].replace(',','.'));
    if(Number.isFinite(a)&&Number.isFinite(b)&&b>a)return Math.max(4,Math.min(15,Math.round(b-a)));
  }
  return 5;
}
const generationQueues=new Map();
function enqueueRunGeneration(accountId,runId,label='backend-generation'){
  const key=sanitizeAccountId(accountId||DEFAULT_ACCOUNT_ID);
  const previous=generationQueues.get(key)||Promise.resolve();
  let next;
  next=previous.catch(()=>{}).then(()=>processRunGeneration(key,runId)).catch(e=>{
    console.error('['+label+'] '+runId+' '+String(e?.message||e));
    return {ok:false,error:String(e?.message||e)};
  }).finally(()=>{
    if(generationQueues.get(key)===next)generationQueues.delete(key);
  });
  generationQueues.set(key,next);
  return next;
}
const postProductionQueues=new Map();
function enqueuePostProduction(accountId,runId,label='post-production'){
  const key=sanitizeAccountId(accountId||DEFAULT_ACCOUNT_ID);
  const previous=postProductionQueues.get(key)||Promise.resolve();
  let next;
  next=previous.catch(()=>{}).then(()=>processRunPostProduction(key,runId)).catch(e=>{
    console.error('['+label+'] '+runId+' '+String(e?.message||e));
    return {ok:false,error:String(e?.message||e)};
  }).finally(()=>{
    if(postProductionQueues.get(key)===next)postProductionQueues.delete(key);
  });
  postProductionQueues.set(key,next);
  return next;
}
async function downloadUrlFile(url,filePath){
  const r=await fetch(String(url||''));
  if(!r.ok)throw new Error('Не удалось скачать сцену: HTTP '+r.status);
  const buf=Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(filePath,buf);
  return buf.length;
}
function runVoiceLines(run){
  const board=Array.isArray(run?.storyboard)?run.storyboard:[];
  return board.map((scene,i)=>({scene:i+1,duration:sceneDurationSeconds(scene),text:String(scene?.voiceover||'').trim()}));
}
async function generateOpenAITts(text,instructions=''){
  if(!openaiConfigured())throw new Error('OpenAI TTS не настроен');
  const body={model:'gpt-4o-mini-tts',voice:'coral',input:String(text||'').slice(0,4000),response_format:'mp3'};
  if(String(instructions||'').trim())body.instructions=String(instructions).slice(0,1200);
  const r=await fetch('https://api.openai.com/v1/audio/speech',{
    method:'POST',
    headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'content-type':'application/json'},
    body:JSON.stringify(body)
  });
  if(!r.ok){
    const raw=await r.text();
    let data;try{data=JSON.parse(raw)}catch{data={}}
    throw new Error(data?.error?.message||('OpenAI TTS error '+r.status));
  }
  return Buffer.from(await r.arrayBuffer());
}
async function createRunVoiceover(run,dir){
  const lines=runVoiceLines(run);
  const instructions=String(run?.character?.voice||'Спокойный, естественный, доброжелательный женский голос. Чёткая дикция, без навязчивой рекламной подачи.');
  const wavs=[],spoken=[];
  for(const line of lines){
    const wav=path.join(dir,'voice-'+line.scene+'.wav');
    if(line.text){
      const mp3=path.join(dir,'voice-'+line.scene+'.mp3');
      fs.writeFileSync(mp3,await generateOpenAITts(line.text,instructions));
      await execFile('ffmpeg',['-hide_banner','-loglevel','error','-i',mp3,'-af','apad','-t',String(line.duration),'-ar','48000','-ac','2','-c:a','pcm_s16le','-y',wav],{timeout:120000});
      spoken.push({scene:line.scene,text:line.text,duration:line.duration});
    }else{
      await execFile('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t',String(line.duration),'-c:a','pcm_s16le','-y',wav],{timeout:30000});
    }
    wavs.push(wav);
  }
  const list=path.join(dir,'voice-list.txt');
  fs.writeFileSync(list,wavs.map(x=>"file '"+x.replace(/'/g,"'\\''")+"'").join('\n'));
  const out=path.join(dir,'voiceover.wav');
  await execFile('ffmpeg',['-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',list,'-c:a','pcm_s16le','-y',out],{timeout:120000});
  return {path:out,spoken,provider:'openai',model:'gpt-4o-mini-tts',voice:'coral'};
}
async function assembleRunVideo(run,dir,voicePath){
  const urls=(run?.generationResult?.urls||[]).filter(Boolean);
  if(!urls.length)throw new Error('Нет сгенерированных сцен для монтажа');
  const normalized=[];
  for(let i=0;i<urls.length;i++){
    const src=path.join(dir,'scene-'+(i+1)+'.mp4');
    const norm=path.join(dir,'scene-'+(i+1)+'-norm.mp4');
    await downloadUrlFile(urls[i],src);
    await execFile('ffmpeg',[
      '-hide_banner','-loglevel','error','-i',src,
      '-vf','scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black,fps=30',
      '-an','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart','-y',norm
    ],{timeout:240000});
    normalized.push(norm);
  }
  const list=path.join(dir,'video-list.txt');
  fs.writeFileSync(list,normalized.map(x=>"file '"+x.replace(/'/g,"'\\''")+"'").join('\n'));
  const silent=path.join(dir,'combined-silent.mp4');
  await execFile('ffmpeg',['-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',list,'-c','copy','-movflags','+faststart','-y',silent],{timeout:120000});
  const finalPath=path.join(dir,'final.mp4');
  if(voicePath&&fs.existsSync(voicePath)){
    await execFile('ffmpeg',['-hide_banner','-loglevel','error','-i',silent,'-i',voicePath,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','160k','-shortest','-movflags','+faststart','-y',finalPath],{timeout:120000});
  }else{
    fs.copyFileSync(silent,finalPath);
  }
  return finalPath;
}
async function uploadRunMedia(accountId,runId,filePath,fileName,mimeType){
  const stat=fs.statSync(filePath);
  if(stat.size>145*1024*1024)throw new Error('Финальный файл слишком большой для хранилища');
  const scoped=(accountId+'__run_'+runId).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);
  const data=await callProductMedia({action:'upload',productId:scoped,fileName,mimeType,dataBase64:fs.readFileSync(filePath).toString('base64')});
  return data?.media||null;
}
async function runFinalQc(run,finalPath,accountId){
  if(!openaiConfigured())return {passed:null,summary:'OpenAI недоступен — визуальная AI-проверка не выполнена.',issues:[]};
  let evidence=null;
  try{
    evidence=await extractVideoEvidence(finalPath);
    const refs=runReferenceUrls(run).slice(0,2).map(url=>({type:'input_image',image_url:url,detail:'low'}));
    const prompt=[
      'Ты контролёр качества рекламного вертикального ролика.',
      'Проверь только то, что реально видно на кадрах. Не выдумывай.',
      'Товар: '+String(run.productName||''),
      'Правила товара: '+String(run.productRules||run.product?.rules||''),
      'Оцени: узнаваемость товара, явные визуальные артефакты, грубые скачки между сценами, пригодность для 9:16.',
      'Верни ТОЛЬКО JSON: {"passed":true,"summary":"","checks":{"productConsistency":"ok|warn|fail","visualArtifacts":"ok|warn|fail","continuity":"ok|warn|fail","verticalFormat":"ok|warn|fail"},"issues":[""]}'
    ].join('\n');
    const model=process.env.OPENAI_MODEL||'gpt-5.6-luna';
    const r=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',
      headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'content-type':'application/json'},
      body:JSON.stringify({model,input:[{role:'user',content:[{type:'input_text',text:prompt},...evidence.frames,...refs]}],reasoning:{effort:'low'},max_output_tokens:1800})
    });
    const raw=await r.text();
    let response;try{response=raw?JSON.parse(raw):{}}catch{response={raw}}
    if(!r.ok)throw new Error(response?.error?.message||('OpenAI QC error '+r.status));
    const parsed=safeAnalysisJson(openAIText(response));
    const priced=openAIUsageCost(response?.model||model,response?.usage||{});
    if(priced.amountUsd>0)await recordExpense(accountId,{provider:'OpenAI',category:'qc',description:'AI-проверка финального ролика',amountUsd:priced.amountUsd,model:response?.model||model,usage:priced.details,source:'auto'}).catch(()=>{});
    return {
      passed:parsed?.passed!==false,
      summary:String(parsed?.summary||'AI-проверка завершена.').slice(0,3000),
      checks:parsed?.checks&&typeof parsed.checks==='object'?parsed.checks:{},
      issues:Array.isArray(parsed?.issues)?parsed.issues.map(x=>String(x)).slice(0,20):[],
      durationSeconds:Math.round(evidence.duration||0),
      model:response?.model||model
    };
  }finally{
    if(evidence?.dir)try{fs.rmSync(evidence.dir,{recursive:true,force:true})}catch{}
  }
}
async function processRunPostProduction(accountId,runId){
  let state=await readAppState(accountId),data=state?.data||blankFactoryState(),run=findRunById(data,runId);
  if(!run||run.paused||run.status==='Остановлено')return {ok:false,stopped:true};
  if(run.postProductionRunning)return {ok:true,alreadyRunning:true};
  const total=Number(run.generationResult?.totalScenes||run.sceneCount||0);
  const accepted=new Set((Array.isArray(run.acceptedScenes)?run.acceptedScenes:[]).map(Number));
  if(!total||accepted.size<total)return {ok:false,error:'Не все сцены подтверждены'};
  const dir=fs.mkdtempSync('/tmp/cf-post-');
  try{
    run.postProductionRunning=true;run.awaitingApproval=false;run.status='В работе';run.stage=run.voiceoverResult?'Монтаж':'Озвучка';run.progress=Math.max(Number(run.progress)||0,74);run.updatedAt=new Date().toISOString();
    appendFactoryJournal(data,'Запущена постобработка',(run.productName||run.id)+' · сцены подтверждены '+accepted.size+'/'+total);
    await writeAppState(data,accountId);

    let voicePath=null;
    if(!run.voiceoverResult){
      const voice=await createRunVoiceover(run,dir);
      voicePath=voice.path;
      state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
      run.voiceoverResult={ok:true,provider:voice.provider,model:voice.model,voice:voice.voice,spokenScenes:voice.spoken,completedAt:new Date().toISOString()};
      run.stage='Монтаж';run.progress=80;run.updatedAt=new Date().toISOString();
      appendFactoryJournal(data,'Озвучка готова',(run.productName||run.id)+' · '+voice.spoken.length+' сцен с речью');
      await writeAppState(data,accountId);
    }else{
      voicePath=(await createRunVoiceover(run,dir)).path;
    }

    const finalPath=await assembleRunVideo(run,dir,voicePath);
    const media=await uploadRunMedia(accountId,runId,finalPath,'final-'+runId+'.mp4','video/mp4');
    state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
    run.montageResult={ok:true,url:media?.url||'',path:media?.path||'',fileName:media?.fileName||('final-'+runId+'.mp4'),durationSeconds:Math.round(await probeDuration(finalPath)),completedAt:new Date().toISOString()};
    run.stage='AI-проверка';run.progress=88;run.updatedAt=new Date().toISOString();
    appendFactoryJournal(data,'Монтаж готов',run.productName||run.id);
    await writeAppState(data,accountId);

    const qc=await runFinalQc(run,finalPath,accountId);
    state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
    run.qcResult={...qc,completedAt:new Date().toISOString()};
    run.postProductionRunning=false;run.stage='На проверке';run.status='На проверке';run.awaitingApproval=true;run.progress=95;run.error='';run.updatedAt=new Date().toISOString();
    appendFactoryJournal(data,'Финальный ролик готов к проверке',(run.productName||run.id)+' · '+String(qc?.summary||''));
    await writeAppState(data,accountId);
    return {ok:true,run};
  }catch(e){
    state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
    if(run){
      run.postProductionRunning=false;run.status='Ошибка';run.error='Постобработка: '+String(e?.message||e);run.updatedAt=new Date().toISOString();
      appendFactoryJournal(data,'Ошибка постобработки',(run.productName||run.id)+' · '+String(e?.message||e));
      await writeAppState(data,accountId);
    }
    return {ok:false,error:String(e?.message||e)};
  }finally{
    try{fs.rmSync(dir,{recursive:true,force:true})}catch{}
  }
}

async function processRunGeneration(accountId,runId){
  let state=await readAppState(accountId),data=state?.data||blankFactoryState(),run=findRunById(data,runId);
  if(!run||run.paused||run.status==='Остановлено')return {ok:false,stopped:true};
  if(run.backendGenerationRunning)return {ok:true,alreadyRunning:true};
  run.backendGenerationRunning=true;
  run.backendGenerationStartedAt=new Date().toISOString();
  run.stage='Генерация';run.status='В работе';run.progress=Math.max(38,Number(run.progress)||0);
  run.sceneResults=run.sceneResults&&typeof run.sceneResults==='object'?run.sceneResults:{};
  run.generationError='';
  await writeAppState(data,accountId);

  const board=Array.isArray(run.storyboard)&&run.storyboard.length?run.storyboard:[planSceneDefaults(0,1)];
  const refs=runReferenceUrls(run);
  const total=board.length;
  try{
    for(let i=0;i<board.length;i++){
      state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
      if(!run||run.paused||run.status==='Остановлено'){
        if(run){run.backendGenerationRunning=false;run.updatedAt=new Date().toISOString();await writeAppState(data,accountId)}
        return {ok:false,stopped:true};
      }
      const scene=board[i]||{};
      const sceneNo=i+1;
      if(run.sceneResults?.[sceneNo]?.ok&&run.sceneResults?.[sceneNo]?.urls?.length)continue;
      const prompt=[
        'Вертикальный рекламный ролик 9:16.',
        'Товар: '+String(run.productName||''),
        String(run.productRules||run.product?.rules||''),
        run.character?.name?('AI-аватар: '+run.character.name+'. '+String(run.character.look||'')+' '+String(run.character.locks||'')):'',
        'Сцена '+sceneNo+': '+String(scene.title||''),
        'Кадр: '+String(scene.shot||''),
        'Действие: '+String(scene.action||''),
        String(scene.prompt||''),
        'Сохраняй реальный внешний вид товара по референсам. Не меняй форму, цвет и рисунок товара. Без случайных надписей и логотипов.'
      ].filter(Boolean).join('\n');
      let result=null,lastError=null;
      const maxAttempts=Math.max(1,Math.min(2,Number(run.maxAttempts)||1));
      for(let attempt=1;attempt<=maxAttempts;attempt++){
        try{
          result=await generateHiggsfieldScene({
            accountId,prompt,referenceMedia:refs,duration:sceneDurationSeconds(scene),
            aspectRatio:'9:16',resolution:'720p',generateAudio:false
          });
          if(result?.ok&&result?.urls?.length)break;
          lastError=new Error('Higgsfield не вернул готовое видео'+(result?.status?' · статус '+result.status:''));
          if(process.env.RUNWAYML_API_SECRET){
            try{
              const fallback=await generateRunwayScene({
                accountId,prompt,referenceMedia:refs,duration:sceneDurationSeconds(scene),ratio:'720:1280'
              });
              if(fallback?.ok&&fallback?.urls?.length){
                fallback.fallbackFrom='higgsfield';
                result=fallback;
                break;
              }
            }catch(re){
              lastError=new Error(String(lastError.message)+'; Runway: '+String(re?.message||re));
            }
          }
        }catch(e){
          lastError=e;
          console.error('[higgsfield-scene] '+runId+' scene '+sceneNo+' '+String(e?.message||e));
          if(process.env.RUNWAYML_API_SECRET){
            try{
              result=await generateRunwayScene({
                accountId,prompt,referenceMedia:refs,duration:sceneDurationSeconds(scene),
                ratio:'720:1280'
              });
              if(result?.ok&&result?.urls?.length){
                result.fallbackFrom='higgsfield';
                break;
              }
            }catch(re){
              lastError=new Error('Higgsfield: '+String(e?.message||e)+'; Runway: '+String(re?.message||re));
              console.error('[runway-fallback] '+runId+' scene '+sceneNo+' '+String(re?.message||re));
            }
          }
        }
      }
      state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
      if(!run)return {ok:false,error:'Ролик удалён во время генерации'};
      run.sceneResults=run.sceneResults&&typeof run.sceneResults==='object'?run.sceneResults:{};
      if(result?.ok&&result?.urls?.length){
        run.sceneResults[sceneNo]={ok:true,urls:result.urls,provider:result.provider,model:result.model,requestId:result.requestId||result.taskId||null,fallbackFrom:result.fallbackFrom||'',completedAt:new Date().toISOString()};
        appendFactoryJournal(data,'Сцена готова',(run.productName||run.id)+' · сцена '+sceneNo+'/'+total);
      }else{
        const err=String(lastError?.message||'Ошибка Higgsfield');
        run.sceneResults[sceneNo]={ok:false,error:err,completedAt:new Date().toISOString()};
        run.backendGenerationRunning=false;run.status='Ошибка';run.stage='Генерация';run.generationError='Сцена '+sceneNo+': '+err;run.error=run.generationError;
        run.updatedAt=new Date().toISOString();
        appendFactoryJournal(data,'Ошибка генерации сцены',(run.productName||run.id)+' · сцена '+sceneNo+' · '+err);
        await writeAppState(data,accountId);
        return {ok:false,error:err,scene:sceneNo};
      }
      const completed=Object.values(run.sceneResults).filter(x=>x?.ok&&x?.urls?.length).length;
      const urls=Object.keys(run.sceneResults).sort((a,b)=>Number(a)-Number(b)).flatMap(k=>run.sceneResults[k]?.urls||[]);
      run.generationResult={provider:'higgsfield',urls,completedScenes:completed,totalScenes:total,completed:completed>=total};
      run.progress=Math.min(65,38+Math.round((completed/Math.max(1,total))*27));
      run.updatedAt=new Date().toISOString();
      await writeAppState(data,accountId);
    }
    state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
    if(run){
      const urls=Object.keys(run.sceneResults||{}).sort((a,b)=>Number(a)-Number(b)).flatMap(k=>run.sceneResults[k]?.urls||[]);
      run.generationResult={provider:'higgsfield',urls,completedScenes:board.length,totalScenes:board.length,completed:true};
      run.backendGenerationRunning=false;run.stage='На проверке';run.status='На проверке';run.progress=70;run.awaitingApproval=true;run.error='';run.generationError='';run.updatedAt=new Date().toISOString();
      appendFactoryJournal(data,'Генерация сцен завершена',(run.productName||run.id)+' · '+board.length+' сцен');
      await writeAppState(data,accountId);
    }
    return {ok:true,completedScenes:board.length};
  }catch(e){
    state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
    if(run){
      run.backendGenerationRunning=false;run.status='Ошибка';run.stage='Генерация';run.generationError=String(e?.message||e);run.error=run.generationError;run.updatedAt=new Date().toISOString();
      appendFactoryJournal(data,'Ошибка генерации',run.generationError);
      await writeAppState(data,accountId);
    }
    return {ok:false,error:String(e?.message||e)};
  }
}
async function dispatchExistingRun(accountId,run){
  const payload={...run,action:'create_batch',accountId,batchId:run.batchId,runId:run.id,runIds:[run.id]};
  const archive=await notifyN8nArchive(payload);
  const state=await readAppState(accountId);
  const data=state?.data||blankFactoryState();
  const current=findRunById(data,run.id);
  if(current){
    current.workflow={
      sentAt:new Date().toISOString(),
      archiveStatus:archive.status||0,
      generationStatus:'backend-direct',
      ok:true
    };
    current.updatedAt=new Date().toISOString();
    await writeAppState(data,accountId);
  }
  enqueueRunGeneration(accountId,run.id,'backend-generation');
  return {ok:true,data:{archive,generation:{ok:true,status:'backend-direct'}}};
}
async function createBatchRuns(payload,accountId){
  const state=await readAppState(accountId);
  const data=state?.data||blankFactoryState();
  data.runs=Array.isArray(data.runs)?data.runs:[];
  data.scripts=Array.isArray(data.scripts)?data.scripts:[];
  const product=findProductInState(data,payload.productId||payload.productName);
  if(!product)throw new Error('Товар не найден');
  const count=Math.max(1,Math.min(20,parseInt(payload.count)||1));
  const batchId=String(payload.batchId||factoryId('batch'));
  const created=[];
  for(let i=1;i<=count;i++){
    const run={
      id:factoryId('r'),
      ...payload,
      accountId,batchId,productId:product.id,productName:product.name,
      variant:count>1?i:null,status:'В работе',stage:'Идея',progress:3,attempt:1,
      sceneCount:5,sceneVersions:{1:1,2:1,3:1,4:1,5:1},acceptedScenes:[],
      idea:null,script:null,storyboard:[],references:null,generationResult:null,
      created:payload.created||new Date().toISOString(),updatedAt:new Date().toISOString()
    };
    data.runs.push(run);created.push(run);
  }
  appendFactoryJournal(data,'Создан запуск',product.name+' · '+count+' ролик(а/ов)');
  await writeAppState(data,accountId);

  for(const run of created){
    try{
      const plan=await buildRunPlan(run,accountId,run.variant||1);
      const fresh=await readAppState(accountId);
      const fd=fresh?.data||blankFactoryState();
      const rr=findRunById(fd,run.id);
      if(!rr)continue;
      rr.idea=plan.idea;rr.script=plan.script;rr.storyboard=plan.storyboard;rr.references=plan.references;
      rr.sceneCount=plan.storyboard.length;rr.stage='Референсы';rr.progress=32;rr.updatedAt=new Date().toISOString();
      fd.scripts=Array.isArray(fd.scripts)?fd.scripts:[];
      fd.scripts.push({id:factoryId('s'),runId:rr.id,title:plan.idea.title,hook:plan.script.hook,body:plan.script.body,cta:plan.script.cta,used:1,created:new Date().toISOString()});
      appendFactoryJournal(fd,'Подготовлен производственный план',product.name+' · идея, сценарий, storyboard и референсы');
      await writeAppState(fd,accountId);
      Object.assign(run,rr);
    }catch(e){
      await saveRunPatch(accountId,run.id,{status:'Ошибка',stage:'Идея',error:'Ошибка подготовки: '+String(e?.message||e)});
      continue;
    }
    if(run.mode==='manual'){
      await saveRunPatch(accountId,run.id,{status:'На проверке',stage:'Референсы',progress:32,awaitingApproval:true});
    }else{
      await saveRunPatch(accountId,run.id,{status:'В работе',stage:'Генерация',progress:38,awaitingApproval:false});
      await dispatchExistingRun(accountId,run);
    }
  }
  const final=await readAppState(accountId);
  return {batchId,runs:(final?.data?.runs||[]).filter(r=>r.batchId===batchId)};
}
async function createIdeaDraft(body,accountId){
  const state=await readAppState(accountId);
  const data=state?.data||blankFactoryState();
  const product=findProductInState(data,body.productId||body.product);
  if(!product)throw new Error('Товар не найден');
  const payload={
    accountId,productId:product.id,productName:product.name,productUtp:product.utp||'',productRules:product.rules||'',
    media:(product.media||[]),product:{id:product.id,name:product.name,utp:product.utp||'',rules:product.rules||'',media:(product.media||[])},
    brief:String(body.brief||''),style:String(body.style||'UGC'),duration:String(body.duration||'30 сек'),
    format:'9:16',mode:'manual',modelMode:'Авто — умный выбор',budget:Number(body.budget)||500,maxAttempts:3,
    created:new Date().toISOString()
  };
  const idea=await generateIdeaStage(payload,accountId,1);
  const fresh=await readAppState(accountId);
  const fd=fresh?.data||blankFactoryState();fd.runs=Array.isArray(fd.runs)?fd.runs:[];
  const run={id:factoryId('r'),...payload,batchId:factoryId('batch'),status:'Черновик',stage:'Идея',progress:8,attempt:0,
    idea,script:null,storyboard:[],references:null,sceneCount:0,
    sceneVersions:{},acceptedScenes:[],generationResult:null,updatedAt:new Date().toISOString()};
  fd.runs.push(run);appendFactoryJournal(fd,'Создана идея',product.name+' · '+idea.title);await writeAppState(fd,accountId);
  return run;
}
async function runControlAction(body,accountId){
  const runId=String(body?.runId||'');
  const action=String(body?.action||'');
  let state=await readAppState(accountId),data=state?.data||blankFactoryState(),run=findRunById(data,runId);
  if(!run)throw new Error('Ролик не найден');
  if(action==='stop'){
    run.status='Остановлено';run.paused=true;run.updatedAt=new Date().toISOString();
    appendFactoryJournal(data,'Производство остановлено',run.productName||run.id);await writeAppState(data,accountId);return run;
  }
  if(action==='regenerate_scene'){
    const scene=Math.max(1,Math.min(20,Number(body?.scene)||1));
    run.sceneResults=run.sceneResults&&typeof run.sceneResults==='object'?run.sceneResults:{};
    delete run.sceneResults[scene];
    run.sceneVersions=run.sceneVersions&&typeof run.sceneVersions==='object'?run.sceneVersions:{};
    run.sceneVersions[scene]=(Number(run.sceneVersions[scene])||1)+1;
    run.acceptedScenes=(Array.isArray(run.acceptedScenes)?run.acceptedScenes:[]).filter(x=>Number(x)!==scene);
    run.status='В работе';run.stage='Генерация';run.paused=false;run.backendGenerationRunning=false;run.generationResult=null;run.error='';run.generationError='';
    run.updatedAt=new Date().toISOString();
    appendFactoryJournal(data,'Перегенерация сцены',(run.productName||run.id)+' · сцена '+scene+' · V'+run.sceneVersions[scene]);
    await writeAppState(data,accountId);
    enqueueRunGeneration(accountId,run.id,'regenerate-scene');
    return run;
  }
  if(action==='accept_scene'){
    const scene=Math.max(1,Math.min(20,Number(body?.scene)||1));
    run.acceptedScenes=[...new Set([...(Array.isArray(run.acceptedScenes)?run.acceptedScenes:[]),scene])];
    const total=Number(run.generationResult?.totalScenes||run.sceneCount||0);
    const acceptedCount=new Set(run.acceptedScenes.map(Number)).size;
    run.updatedAt=new Date().toISOString();
    appendFactoryJournal(data,'Сцена утверждена',(run.productName||run.id)+' · сцена '+scene);
    if(total>0&&acceptedCount>=total){
      run.status='В работе';run.stage='Озвучка';run.progress=Math.max(Number(run.progress)||0,74);run.awaitingApproval=false;run.postProductionRunning=false;
      appendFactoryJournal(data,'Все сцены утверждены',(run.productName||run.id)+' · запускаю озвучку и монтаж');
      await writeAppState(data,accountId);
      enqueuePostProduction(accountId,run.id,'accept-all-scenes');
      return run;
    }
    await writeAppState(data,accountId);return run;
  }
  if(action==='update_scene_prompt'){
    const scene=Math.max(1,Math.min(20,Number(body?.scene)||1));
    const prompt=String(body?.prompt||'').trim().slice(0,12000);
    run.scenePrompts=run.scenePrompts&&typeof run.scenePrompts==='object'?run.scenePrompts:{};
    run.scenePrompts[scene]=prompt;
    if(Array.isArray(run.storyboard)&&run.storyboard[scene-1])run.storyboard[scene-1].prompt=prompt;
    run.updatedAt=new Date().toISOString();
    appendFactoryJournal(data,'Изменён промт сцены',(run.productName||run.id)+' · сцена '+scene);
    await writeAppState(data,accountId);return run;
  }
  if(action==='set_scene_model'){
    const scene=Math.max(1,Math.min(20,Number(body?.scene)||1));
    run.sceneModels=run.sceneModels&&typeof run.sceneModels==='object'?run.sceneModels:{};
    run.sceneModels[scene]=String(body?.model||'Авто').slice(0,120);
    run.updatedAt=new Date().toISOString();
    appendFactoryJournal(data,'Сменена модель сцены',(run.productName||run.id)+' · сцена '+scene+' → '+run.sceneModels[scene]);
    await writeAppState(data,accountId);return run;
  }
  if(action==='approve_montage'){
    run.status='На проверке';run.stage='На проверке';run.progress=Math.max(82,Number(run.progress)||0);run.updatedAt=new Date().toISOString();
    appendFactoryJournal(data,'Монтаж утверждён',run.productName||run.id);
    await writeAppState(data,accountId);return run;
  }
  if(action==='approve_run'){
    run.status='Готово';run.stage='Готово';run.progress=100;run.updatedAt=new Date().toISOString();
    appendFactoryJournal(data,'Ролик утверждён',run.productName||run.id);
    await writeAppState(data,accountId);return run;
  }
  if(action==='advance_stage'){
    const current=String(run.stage||'Идея');
    if(current==='Идея'){
      run.status='В работе';run.stage='Сценарий';run.progress=12;run.updatedAt=new Date().toISOString();
      await writeAppState(data,accountId);
      const script=await generateScriptStage(run,accountId,String(body?.note||''));
      state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
      run.script=script;run.storyboard=[];run.references=null;run.sceneCount=0;
      run.status='На проверке';run.stage='Сценарий';run.progress=18;run.updatedAt=new Date().toISOString();
      appendFactoryJournal(data,'Сценарий готов',(run.productName||run.id)+' · '+String(script.title||''));
      await writeAppState(data,accountId);return run;
    }
    throw new Error('Переход для этапа «'+current+'» ещё не настроен');
  }
  if(action==='start'||action==='resume'){
    run.paused=false;run.status='В работе';
    if(!run.idea||!run.script||!Array.isArray(run.storyboard)||!run.storyboard.length){
      run.stage='Идея';run.progress=5;await writeAppState(data,accountId);
      const plan=await buildRunPlan(run,accountId,run.variant||1,String(body?.note||''));
      state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
      run.idea=plan.idea;run.script=plan.script;run.storyboard=plan.storyboard;run.references=plan.references;run.sceneCount=plan.storyboard.length;
    }
    run.stage='Генерация';run.progress=Math.max(Number(run.progress)||0,38);run.status='В работе';run.updatedAt=new Date().toISOString();
    await writeAppState(data,accountId);
    await dispatchExistingRun(accountId,run);
    return (await readAppState(accountId)).data.runs.find(r=>r.id===runId);
  }
  if(action==='regenerate'){
    const stage=String(body?.stage||'Идея');
    if(stage==='Идея'){
      const idea=await generateIdeaStage(run,accountId,run.variant||1,String(body?.note||''));
      state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
      run.idea=idea;run.script=null;run.storyboard=[];run.references=null;run.sceneCount=0;
      run.status='Черновик';run.stage='Идея';run.progress=8;run.updatedAt=new Date().toISOString();
      appendFactoryJournal(data,'Идея переделана',(run.productName||run.id)+' · '+idea.title);
      await writeAppState(data,accountId);return run;
    }
    if(stage==='Сценарий'){
      const script=await generateScriptStage(run,accountId,String(body?.note||''));
      state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
      run.script=script;run.storyboard=[];run.references=null;run.sceneCount=0;
      run.status='На проверке';run.stage='Сценарий';run.progress=18;run.updatedAt=new Date().toISOString();
      appendFactoryJournal(data,'Сценарий переделан',(run.productName||run.id)+' · '+String(script.title||''));
      await writeAppState(data,accountId);return run;
    }
    if(stage==='Генерация'){
      run.status='В работе';run.stage='Генерация';run.progress=Math.max(38,Number(run.progress)||0);run.attempt=(Number(run.attempt)||0)+1;
      await writeAppState(data,accountId);await dispatchExistingRun(accountId,run);
      return (await readAppState(accountId)).data.runs.find(r=>r.id===runId);
    }
    const plan=await buildRunPlan(run,accountId,run.variant||1,(stage+'; '+String(body?.note||'')).trim());
    state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
    if(stage==='Идея')run.idea=plan.idea;
    else if(stage==='Сценарий')run.script=plan.script;
    else if(stage==='Storyboard')run.storyboard=plan.storyboard;
    else if(stage==='Референсы')run.references=plan.references;
    else {run.idea=plan.idea;run.script=plan.script;run.storyboard=plan.storyboard;run.references=plan.references}
    run.status='На проверке';run.stage=stage;run.progress=Math.max(8,Math.min(Number(run.progress)||8,35));run.updatedAt=new Date().toISOString();
    appendFactoryJournal(data,'Этап переделан',(run.productName||run.id)+' · '+stage);await writeAppState(data,accountId);return run;
  }
  throw new Error('Неизвестное действие');
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
    name:'update_avatar',
    description:'Изменить данные существующего AI-аватара активного аккаунта. Используй, когда пользователь просит заполнить или отредактировать данные аватара. Не меняй поля, которые пользователь не просил менять и которые нельзя надёжно определить.',
    parameters:{
      type:'object',
      properties:{
        avatar:{type:'string',description:'Имя или id AI-аватара'},
        name:{type:'string'},
        age:{type:'string'},
        look:{type:'string'},
        voice:{type:'string'},
        topics:{type:'string'},
        locks:{type:'string'}
      },
      required:['avatar'],
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
    name:'generate_image',
    description:'Сгенерировать отдельное изображение/фото по запросу пользователя через OpenAI GPT Image и вернуть готовую картинку в чат. Используй, когда пользователь просит создать, нарисовать, сгенерировать или сделать фото/изображение/кадр.',
    parameters:{
      type:'object',
      properties:{
        prompt:{type:'string',description:'Подробный промт для изображения. Не добавляй текст на изображение, если пользователь явно не просил.'},
        orientation:{type:'string',enum:['portrait','square','landscape']},
        quality:{type:'string',enum:['low','medium','high']}
      },
      required:['prompt'],
      additionalProperties:false
    }
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

function imageGenerationFallbackUsd(quality,size){
  const q=['low','medium','high'].includes(quality)?quality:'medium';
  const square=size==='1024x1024';
  if(q==='low')return square?0.006:0.005;
  if(q==='high')return square?0.211:0.165;
  return square?0.053:0.041;
}
async function generateOpenAIChatImage(accountId,args={}){
  if(!openaiConfigured())throw new Error('OpenAI API is not configured');
  const prompt=String(args?.prompt||'').trim().slice(0,16000);
  if(!prompt)throw new Error('Нужен промт для изображения');
  const orientation=['portrait','square','landscape'].includes(args?.orientation)?args.orientation:'portrait';
  const quality=['low','medium','high'].includes(args?.quality)?args.quality:'medium';
  const size=orientation==='square'?'1024x1024':orientation==='landscape'?'1360x1024':'1024x1360';
  const model='gpt-image-2';
  const r=await fetch('https://api.openai.com/v1/images/generations',{
    method:'POST',
    headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'content-type':'application/json'},
    body:JSON.stringify({model,prompt,size,quality,n:1,output_format:'png'})
  });
  const raw=await r.text();
  let response;try{response=raw?JSON.parse(raw):{}}catch{response={raw}}
  if(!r.ok)throw new Error(response?.error?.message||('OpenAI image error '+r.status));
  const b64=String(response?.data?.[0]?.b64_json||'');
  if(!b64)throw new Error('OpenAI не вернул изображение');
  const scopedProductId=(sanitizeAccountId(accountId)+'__chat_images').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);
  const uploaded=await callProductMedia({
    action:'upload',
    productId:scopedProductId,
    fileName:'chat-'+Date.now()+'.png',
    mimeType:'image/png',
    dataBase64:'data:image/png;base64,'+b64
  });
  if(!uploaded?.media?.url)throw new Error(uploaded?.error||'Не удалось сохранить изображение');
  const usage=response?.usage||{};
  const details=usage?.input_tokens_details||{};
  const outDetails=usage?.output_tokens_details||{};
  const textIn=Number(details.text_tokens)||Number(usage.input_tokens)||0;
  const imageIn=Number(details.image_tokens)||0;
  const imageOut=Number(outDetails.image_tokens)||Number(usage.output_tokens)||0;
  let amountUsd=(textIn/1e6*2.5)+(imageIn/1e6*4)+(imageOut/1e6*15);
  if(!(amountUsd>0))amountUsd=imageGenerationFallbackUsd(quality,size);
  await recordExpense(accountId,{
    provider:'OpenAI',
    category:'image',
    description:'Генерация изображения',
    amountUsd,
    model,
    usage:{...usage,size,quality},
    source:'auto'
  }).catch(()=>{});
  return {ok:true,image:{
    url:uploaded.media.url,
    path:uploaded.media.path||'',
    name:'AI image',
    model,
    prompt,
    size,
    quality
  }};
}

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
  data.characters=Array.isArray(data.characters)?data.characters:[];
  data.settings=data.settings&&typeof data.settings==='object'?data.settings:{};

  if(name==='generate_image'){
    return await generateOpenAIChatImage(accountId,args);
  }

  if(name==='get_factory_state'){
    return {
      ok:true,
      products:data.products.map(p=>({id:p.id,name:p.name,category:p.category,mediaCount:(p.media||[]).length})),
      campaigns:data.campaigns.slice(-20),
      avatars:data.characters.map(c=>({id:c.id,name:c.name,age:c.age,look:c.look,voice:c.voice,topics:c.topics,locks:c.locks,mediaCount:(c.media||[]).length,voiceLinked:!!c.voiceLinked})),
      runs:data.runs.slice(-30).map(r=>({id:r.id,batchId:r.batchId,productName:r.productName,status:r.status,stage:r.stage,progress:r.progress,style:r.style,duration:r.duration})),
      settings:data.settings
    };
  }

  if(name==='update_avatar'){
    const avatar=findCharacterInState(data,args.avatar);
    if(!avatar) return {ok:false,error:'AI-аватар не найден',availableAvatars:data.characters.map(c=>c.name)};
    const fields=['name','age','look','voice','topics','locks'];
    for(const key of fields){
      if(args[key]!==undefined && String(args[key]).trim()){
        avatar[key]=String(args[key]).trim().slice(0,key==='look'||key==='voice'||key==='topics'||key==='locks'?6000:300);
      }
    }
    avatar.updatedAt=new Date().toISOString();
    appendFactoryJournal(data,'ChatGPT изменил AI-аватара',avatar.name);
    await writeAppState(data,accountId);
    return {ok:true,avatar:{id:avatar.id,name:avatar.name,age:avatar.age,look:avatar.look,voice:avatar.voice,topics:avatar.topics,locks:avatar.locks,mediaCount:(avatar.media||[]).length}};
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

function normalizeChatAttachments(items=[]){
  return (Array.isArray(items)?items:[]).slice(0,4).map(x=>({
    fileId:String(x?.fileId||'').trim(),
    name:String(x?.name||'file').slice(0,180),
    mimeType:String(x?.mimeType||'application/octet-stream').slice(0,120),
    kind:x?.kind==='image'?'image':'file',
    size:Number(x?.size)||0
  })).filter(x=>/^file-[A-Za-z0-9_-]+$/.test(x.fileId));
}

function normalizeChatImages(items=[]){
  return (Array.isArray(items)?items:[]).slice(0,8).map(x=>({
    url:String(x?.url||'').trim().slice(0,2400),
    name:String(x?.name||'AI image').slice(0,180),
    model:String(x?.model||'').slice(0,120),
    prompt:String(x?.prompt||'').slice(0,4000)
  })).filter(x=>/^https:\/\//i.test(x.url));
}
function normalizeStoredChatHistory(history=[]){
  return (Array.isArray(history)?history:[]).slice(-200).map(m=>({
    role:m?.role==='assistant'?'assistant':'user',
    content:String(m?.content||'').slice(0,20000),
    attachments:normalizeChatAttachments(m?.attachments),
    images:normalizeChatImages(m?.images)
  })).filter(m=>m.content||m.attachments.length||m.images.length);
}

function chatAttachmentParts(items=[]){
  return normalizeChatAttachments(items).map(a=>a.kind==='image'
    ? {type:'input_image',file_id:a.fileId,detail:'auto'}
    : {type:'input_file',file_id:a.fileId}
  );
}

async function uploadOpenAIChatFile(body={}){
  if(!openaiConfigured()) throw new Error('OpenAI API is not configured');
  const fileName=String(body.fileName||'file').replace(/[\\/\0]/g,'_').slice(0,180);
  const mimeType=String(body.mimeType||'application/octet-stream').toLowerCase();
  const allowed=new Set([
    'image/jpeg','image/png','image/webp','image/gif',
    'application/pdf','text/plain','text/csv','application/json','text/markdown',
    'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]);
  if(!allowed.has(mimeType)) throw new Error('Этот формат файла пока не поддерживается');
  const raw=String(body.dataBase64||'');
  const match=raw.match(/^data:([^;]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if(!match) throw new Error('Некорректные данные файла');
  const buf=Buffer.from(match[2].replace(/\s+/g,''),'base64');
  if(!buf.length) throw new Error('Пустой файл');
  if(buf.length>15*1024*1024) throw new Error('Максимальный размер файла — 15 МБ');

  const kind=mimeType.startsWith('image/')?'image':'file';
  const form=new FormData();
  form.append('purpose',kind==='image'?'vision':'user_data');
  form.append('file',new Blob([buf],{type:mimeType}),fileName);
  const r=await fetch('https://api.openai.com/v1/files',{
    method:'POST',
    headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY},
    body:form
  });
  const text=await r.text();
  let data; try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
  if(!r.ok) throw new Error(data?.error?.message||data?.message||('OpenAI file upload error '+r.status));
  return {
    fileId:data.id,
    name:fileName,
    mimeType,
    kind,
    size:buf.length
  };
}

async function callOpenAIChat(message,history=[],accountId=DEFAULT_ACCOUNT_ID,attachments=[]){
  if(!openaiConfigured()) throw new Error('OpenAI API is not configured');
  const safeHistory=(Array.isArray(history)?history:[]).slice(-12).map(x=>({
    role:x?.role==='assistant'?'assistant':'user',
    content:String(x?.content||'').slice(0,8000),
    attachments:normalizeChatAttachments(x?.attachments)
  }));
  const currentAttachments=normalizeChatAttachments(attachments);
  accountId=sanitizeAccountId(accountId);
  const state=await readAppState(accountId).catch(()=>({data:null}));
  const snapshot=state?.data||{};
  const normalizedMessage=compactName(message);
  const mentionedAvatars=(snapshot.characters||[]).filter(c=>{
    const n=compactName(c?.name);
    return n && normalizedMessage.includes(n);
  });
  const avatarImageParts=[];
  for(const c of mentionedAvatars.slice(0,2)){
    for(const media of (Array.isArray(c?.media)?c.media:[]).slice(0,4)){
      if(/^https:\/\//i.test(String(media?.url||''))){
        avatarImageParts.push({type:'input_image',image_url:String(media.url),detail:'auto'});
      }
    }
  }
  const registry=await ensureAccountsRegistry().catch(()=>({accounts:[]}));
  const profile=(registry.accounts||[]).find(x=>x.id===accountId)||null;
  const context={
    account:profile?{id:profile.id,name:profile.name,owner:profile.owner,company:profile.company,email:profile.email,phone:profile.phone,notes:profile.notes,memory:profile.memory||''}:null,
    products:(snapshot.products||[]).map(p=>({id:p.id,name:p.name,category:p.category,utp:p.utp,rules:p.rules,mediaCount:(p.media||[]).length})),
    avatars:(snapshot.characters||[]).map(c=>({
      id:c.id,name:c.name,age:c.age||'',look:c.look||'',voice:c.voice||'',topics:c.topics||'',locks:c.locks||'',
      mediaCount:(c.media||[]).length,voiceLinked:!!c.voiceLinked,
      referenceImages:(c.media||[]).map(m=>m.url).filter(Boolean).slice(0,6)
    })),
    videoAnalyses:(snapshot.videoAnalyses||[]).slice(-10).map(v=>({id:v.id,sourceType:v.sourceType,sourceName:v.sourceName,productName:v.productName,avatarName:v.avatarName,summary:v.analysis?.summary,hook:v.analysis?.hook,adaptation:v.analysis?.adaptation})),
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
      'AI-аватары активного аккаунта перечислены в context. Если пользователь называет существующий аватар, не говори, что его нет. Для упомянутого аватара backend автоматически добавляет его сохранённые референсные фото в текущий запрос. Если пользователь просит заполнить или изменить данные аватара, проанализируй доступные фото и используй update_avatar для реального сохранения изменений. Не выдумывай сведения, которые нельзя определить по фото или контексту. '+
      'Если пользователь просит создать/сгенерировать отдельное фото, изображение, картинку или кадр — используй generate_image и реально верни готовое изображение; не говори, что инструмента генерации фото нет. '+
      'Если можно выполнить задачу инструментом, предпочитай выполнить её, а не объяснять пользователю ручные шаги. Контекст: '+JSON.stringify(context)
    }]} ,
    ...safeHistory.map(x=>({
      role:x.role,
      content:x.role==='assistant'
        ? [{type:'output_text',text:x.content}]
        : [
            {type:'input_text',text:x.content||'Посмотри вложение.'},
            ...chatAttachmentParts(x.attachments)
          ]
    })),
    {role:'user',content:[
      {type:'input_text',text:String(message||'').slice(0,12000)||'Посмотри вложение.'},
      ...chatAttachmentParts(currentAttachments),
      ...avatarImageParts
    ]}
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

  const images=actions
    .filter(a=>a?.name==='generate_image'&&a?.result?.ok&&a?.result?.image?.url)
    .map(a=>a.result.image);
  return {
    text:openAIText(data)|| (actions.length?'Готово.':''),
    actions,
    images,
    responseId:data?.id||null,
    model:data?.model||process.env.OPENAI_MODEL||'gpt-5.6-luna'
  };
}

let usdRubCache={rate:0,at:0,date:''};
async function currentUsdRubRate(){
  if(usdRubCache.rate>0 && Date.now()-usdRubCache.at<6*60*60*1000)return usdRubCache;
  const r=await fetch('https://www.cbr.ru/scripts/XML_daily.asp',{headers:{'user-agent':'ContentFactory/1.5'}});
  const xml=await r.text();
  if(!r.ok)throw new Error('CBR rate error '+r.status);
  const blocks=[...xml.matchAll(/<Valute\b[^>]*>[\s\S]*?<\/Valute>/gi)].map(m=>m[0]);
  const block=blocks.find(v=>/<CharCode>USD<\/CharCode>/i.test(v))||'';
  const nominal=Number((block.match(/<Nominal>([^<]+)<\/Nominal>/i)||[])[1]||1);
  const raw=(block.match(/<Value>([^<]+)<\/Value>/i)||[])[1]||'';
  const value=Number(String(raw).replace(',','.'));
  const rate=value/Math.max(1,nominal);
  if(!(rate>0))throw new Error('Не удалось определить курс USD/RUB');
  usdRubCache={rate:Math.round(rate*10000)/10000,at:Date.now(),date:(xml.match(/Date="([^"]+)"/i)||[])[1]||''};
  return usdRubCache;
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

let higgsfieldCreditBlockedUntil=0;
async function generateHiggsfieldScene(body){
  if(Date.now()<higgsfieldCreditBlockedUntil)throw new Error('Higgsfield: недостаточно кредитов, временно используем fallback');
  if(!higgsfieldConfigured()) throw new Error('Higgsfield API is not configured');

  const prompt=String(body?.prompt || '').trim();
  if(!prompt) throw new Error('Scene prompt is required');

  const refs=normalizeReferenceUrls(body?.referenceMedia || body?.references || body?.imageUrls || []);
  const duration=clampNumber(body?.duration,4,15,5);
  const aspectRatio=String(body?.aspectRatio || '9:16');
  const generateAudio=body?.generateAudio !== false;

  const credentials=higgsfieldCredentialParts();
  const client=createHiggsfieldClient({
    apiKey:credentials.apiKey,
    apiSecret:credentials.apiSecret,
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
  const deepUrls=[];
  const scanMediaUrls=(value,key='',depth=0)=>{
    if(depth>6||value==null)return;
    if(typeof value==='string'){
      if((key==='url'||/^(output|video|image|result|raw|min)$/i.test(key))&&/^https?:\/\//i.test(value))deepUrls.push(value);
      return;
    }
    if(Array.isArray(value)){for(const x of value)scanMediaUrls(x,key,depth+1);return}
    if(typeof value==='object'){
      for(const [k,v] of Object.entries(value)){
        if(k==='status_url'||k==='cancel_url')continue;
        scanMediaUrls(v,k,depth+1);
      }
    }
  };
  scanMediaUrls(result);
  const urls=[...new Set([
    ...jobs.map(job=>job?.results?.raw?.url || job?.results?.url || job?.result?.url),
    result?.video?.url,
    ...(Array.isArray(result?.images)?result.images.map(x=>x?.url):[]),
    ...deepUrls
  ].filter(x=>typeof x==='string'&&/^https?:\/\//i.test(x)))];
  const hfStatus=String(result?.status||'').toLowerCase();
  if(!urls.length)console.warn('[higgsfield-shape] status='+hfStatus+' keys='+Object.keys(result||{}).join(','));
  const hfCompleted=Boolean(result?.isCompleted || hfStatus==='completed' || urls.length);
  if(!hfCompleted && ['failed','nsfw','canceled','cancelled'].includes(hfStatus)){
    const hfError='Higgsfield '+hfStatus+(result?.error?': '+String(result.error):'');
    if(/credit balance is too low|insufficient.*credit|low.*balance/i.test(hfError))higgsfieldCreditBlockedUntil=Date.now()+6*60*60*1000;
    throw new Error(hfError);
  }

  const hfAccount=sanitizeAccountId(body?.accountId||DEFAULT_ACCOUNT_ID);
  const hfRates=await costRates(hfAccount).catch(()=>({}));
  const hfRub=(Number(hfRates.higgsfieldRubPerGeneration)||0)*Math.max(1,jobs.length||1);
  await recordExpense(hfAccount,{
    provider:'Higgsfield',category:'generation',description:'Генерация видео',amountRub:hfRub,
    usage:{jobs:Math.max(1,jobs.length||1),duration},model,source:'auto'
  }).catch(()=>{});

  return {
    ok:hfCompleted,
    provider:'higgsfield',
    model,
    input:{...input,image_urls:refs.length?refs:undefined},
    requestId:result?.requestId || result?.request_id || null,
    status:hfStatus||null,
    isCompleted:hfCompleted,
    isNsfw:Boolean(result?.isNsfw || hfStatus==='nsfw'),
    urls,
    jobs
  };
}


function normalizedRunwayModel(value){
  const allowed=new Set(['gen4_turbo','gen4','gen4.5','kling2.5_turbo_pro','kling3.0_pro','kling3.0_4k','kling3.0_standard','klingO3_pro','klingO3_standard','klingO3_4k','veo3.1','veo3.1_fast','robotics_v1','seedance2','seedance2_fast','seedance2_mini','seedance2_5','hailuo3','h3_max','happyhorse_1_0','gemini_omni_flash_1.1','grok_imagine_1_5','gemini_omni_flash','wan3','wan3_prime']);
  let raw=cleanCredentialPart(value||'').trim();
  const compact=raw.toLowerCase().replace(/\s+/g,'');
  if(['gen-4.5','gen4_5','gen-4-5','gen4-5'].includes(compact))raw='gen4.5';
  if(['gen-4','gen_4'].includes(compact))raw='gen4';
  return allowed.has(raw)?raw:'gen4.5';
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
  const model=normalizedRunwayModel(body?.model||process.env.RUNWAY_MODEL);

  try{
    const pending=client.imageToVideo.create({
      model,
      ...(refs[0]?{promptImage:refs[0]}:{}),
      promptText:prompt.slice(0,950),
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
      model,
      duration,
      ratio,
      promptChars:Math.min(prompt.length,950),
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


function hhmmss(seconds){
  const s=Math.max(0,Math.round(Number(seconds)||0));
  const m=Math.floor(s/60),sec=s%60;
  return String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0');
}
function safeAnalysisJson(text){
  const raw=String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try{return JSON.parse(raw)}catch{}
  const start=raw.indexOf('{'),end=raw.lastIndexOf('}');
  if(start>=0&&end>start){try{return JSON.parse(raw.slice(start,end+1))}catch{}}
  return {summary:raw,hook:'',scenes:[],whyWorks:[],adaptation:{concept:'',hook:'',scenes:[],cta:''}};
}
async function probeDuration(filePath){
  try{
    const result=await execFile('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',filePath],{timeout:15000});
    return Math.max(1,Number(String(result.stdout).trim())||1);
  }catch{return 1}
}
async function extractVideoEvidence(filePath){
  const duration=await probeDuration(filePath);
  const dir=fs.mkdtempSync('/tmp/cf-video-');
  const fps=Math.max(.02,Math.min(2,10/duration));
  const framePattern=path.join(dir,'frame-%02d.jpg');
  await execFile('ffmpeg',['-hide_banner','-loglevel','error','-i',filePath,'-vf','fps='+fps+',scale=768:-2:force_original_aspect_ratio=decrease','-q:v','3','-frames:v','10','-y',framePattern],{timeout:120000});
  const frames=fs.readdirSync(dir).filter(x=>x.endsWith('.jpg')).sort().slice(0,10).map(name=>{
    const b=fs.readFileSync(path.join(dir,name));
    return {type:'input_image',image_url:'data:image/jpeg;base64,'+b.toString('base64'),detail:'low'};
  });
  const audioPath=path.join(dir,'audio.mp3');
  let hasAudio=false;
  try{
    await execFile('ffmpeg',['-hide_banner','-loglevel','error','-i',filePath,'-vn','-ac','1','-ar','16000','-b:a','64k','-y',audioPath],{timeout:120000});
    hasAudio=fs.existsSync(audioPath)&&fs.statSync(audioPath).size>0;
  }catch{}
  return {duration,dir,frames,audioPath:hasAudio?audioPath:null};
}
async function transcribeAudio(audioPath){
  if(!audioPath||!fs.existsSync(audioPath))return '';
  const stat=fs.statSync(audioPath);
  if(stat.size>25*1024*1024)return '';
  const form=new FormData();
  form.append('model','gpt-transcribe');
  form.append('file',new Blob([fs.readFileSync(audioPath)],{type:'audio/mpeg'}),'audio.mp3');
  const r=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY},body:form});
  const text=await r.text();
  let data;try{data=text?JSON.parse(text):{}}catch{data={}}
  if(!r.ok)throw new Error(data?.error?.message||('Transcription error '+r.status));
  return String(data?.text||'').trim();
}
async function analyzeReferenceMaterial(opts){
  const accountId=opts.accountId;
  const state=await readAppState(accountId);
  const data=state?.data||blankFactoryState();
  data.videoAnalyses=Array.isArray(data.videoAnalyses)?data.videoAnalyses:[];
  const product=findProductInState(data,opts.productId)||null;
  const avatar=findCharacterInState(data,opts.avatarId)||null;
  const prompt=[
    'Ты аналитик коротких рекламных видео. Разбери исходный материал и создай НОВУЮ адаптацию под товар и AI-аватара Content Factory.',
    'Не копируй дословные реплики, уникальные формулировки, музыку, брендинг или точную постановку чужого ролика. Сохраняй только общие маркетинговые механики, темп, типы кадров и структуру.',
    'Верни только JSON с полями summary, hook, scenes, editing, whyWorks, weaknesses, adaptation.',
    'adaptation должна содержать concept, hook, scenes и cta. Каждая адаптированная сцена: duration, shot, avatarAction, productAction, voiceover, onscreen.',
    'Источник: '+String(opts.sourceType||'video')+'. Название: '+String(opts.sourceName||'без названия')+'.',
    'Метаданные: '+JSON.stringify(opts.metadata||{}),
    'Транскрипт: '+String(opts.transcript||'').slice(0,45000),
    'Наш товар: '+(product?JSON.stringify({name:product.name,category:product.category,utp:product.utp,rules:product.rules,mediaCount:(product.media||[]).length}):'не выбран')+'.',
    'Наш AI-аватар: '+(avatar?JSON.stringify({name:avatar.name,age:avatar.age,look:avatar.look,voice:avatar.voice,topics:avatar.topics,locks:avatar.locks}):'не выбран')+'.'
  ].join('\n');
  const extraImages=[];
  const pm=(product?.media||[]).find(m=>m.isPrimary)||(product?.media||[])[0];
  if(pm?.url)extraImages.push({type:'input_image',image_url:pm.url,detail:'low'});
  const am=(avatar?.media||[]).find(m=>m.isPrimary)||(avatar?.media||[])[0];
  if(am?.url)extraImages.push({type:'input_image',image_url:am.url,detail:'low'});
  const model=process.env.OPENAI_MODEL||'gpt-5.6-luna';
  const r=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'content-type':'application/json'},
    body:JSON.stringify({model,input:[{role:'user',content:[{type:'input_text',text:prompt},...(opts.imageParts||[]),...extraImages]}],max_output_tokens:6000})
  });
  const raw=await r.text();
  let response;try{response=raw?JSON.parse(raw):{}}catch{response={raw}}
  if(!r.ok)throw new Error(response?.error?.message||('OpenAI analysis error '+r.status));
  const analysis=safeAnalysisJson(openAIText(response));
  const priced=openAIUsageCost(model,response?.usage||{});
  const item={
    id:factoryId('va'),
    sourceType:String(opts.sourceType||'video'),
    sourceName:String(opts.sourceName||'Видео').slice(0,240),
    sourceUrl:String(opts.sourceUrl||'').slice(0,2000),
    productId:product?.id||'',productName:product?.name||'',
    avatarId:avatar?.id||'',avatarName:avatar?.name||'',
    transcript:String(opts.transcript||'').slice(0,50000),
    analysis,
    createdAt:new Date().toISOString()
  };
  data.videoAnalyses.push(item);
  data.videoAnalyses=data.videoAnalyses.slice(-100);
  appendFactoryJournal(data,'Разобрано видео',item.sourceName);
  await writeAppState(data,accountId);
  if(priced.amountUsd>0)await recordExpense(accountId,{provider:'OpenAI',category:'analysis',description:'Разбор видео',amountUsd:priced.amountUsd,model,usage:priced.details,source:'auto'}).catch(()=>{});
  return item;
}
async function streamRequestToFile(req,filePath,maxBytes=150*1024*1024){
  const out=fs.createWriteStream(filePath,{flags:'wx'});
  let total=0;
  try{
    for await(const chunk of req){
      total+=chunk.length;
      if(total>maxBytes)throw new Error('Видео больше 150 МБ');
      if(!out.write(chunk))await once(out,'drain');
    }
    out.end();
    await once(out,'finish');
    return total;
  }catch(e){
    out.destroy();
    try{fs.unlinkSync(filePath)}catch{}
    throw e;
  }
}
async function analyzeUploadedVideo(req,url){
  const accountId=sanitizeAccountId(url.searchParams.get('account')||DEFAULT_ACCOUNT_ID);
  if(!(await userOwnsAccount(req.cfUser?.id,accountId)))throw new Error('Нет доступа к этому аккаунту');
  const fileName=String(url.searchParams.get('fileName')||'competitor.mp4').replace(/[^\wа-яА-ЯёЁ ._-]+/g,'_').slice(0,180);
  const ext=path.extname(fileName)||'.mp4';
  const filePath='/tmp/cf-upload-'+randomBytes(8).toString('hex')+ext;
  let evidence=null;
  try{
    await streamRequestToFile(req,filePath);
    evidence=await extractVideoEvidence(filePath);
    const transcript=await transcribeAudio(evidence.audioPath).catch(()=> '');
    return await analyzeReferenceMaterial({
      accountId,
      sourceType:'upload',
      sourceName:fileName,
      transcript,
      imageParts:evidence.frames,
      productId:url.searchParams.get('productId')||'',
      avatarId:url.searchParams.get('avatarId')||'',
      metadata:{durationSeconds:Math.round(evidence.duration),frames:evidence.frames.length}
    });
  }finally{
    try{fs.unlinkSync(filePath)}catch{}
    if(evidence?.dir)try{fs.rmSync(evidence.dir,{recursive:true,force:true})}catch{}
  }
}
async function analyzeYoutubeUrl(body,req){
  const accountId=sanitizeAccountId(body?.accountId||DEFAULT_ACCOUNT_ID);
  if(!(await userOwnsAccount(req.cfUser?.id,accountId)))throw new Error('Нет доступа к этому аккаунту');
  const videoUrl=String(body?.url||'').trim();
  if(!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(videoUrl))throw new Error('Нужна ссылка YouTube');
  let meta={title:videoUrl,author_name:'',thumbnail_url:''};
  try{
    const r=await fetch('https://www.youtube.com/oembed?format=json&url='+encodeURIComponent(videoUrl));
    if(r.ok)meta=await r.json();
  }catch{}
  let transcriptRows=[];
  try{transcriptRows=await fetchTranscript(videoUrl)}catch{}
  const transcript=(transcriptRows||[]).slice(0,1500).map(x=>'['+hhmmss((Number(x.offset)||0)/1000)+'] '+String(x.text||'')).join('\n');
  const imageParts=meta.thumbnail_url?[{type:'input_image',image_url:meta.thumbnail_url,detail:'low'}]:[];
  return analyzeReferenceMaterial({
    accountId,
    sourceType:'youtube',
    sourceName:meta.title||videoUrl,
    sourceUrl:videoUrl,
    transcript,
    imageParts,
    productId:body?.productId||'',
    avatarId:body?.avatarId||'',
    metadata:{author:meta.author_name||'',transcriptAvailable:!!transcript,analysisDepth:transcript?'transcript+thumbnail':'thumbnail+metadata'}
  });
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
  if(!matched) throw new Error('Callback не нашёл запуск batchId='+batchId);
  data.runs=runs;
  appendFactoryJournal(data,body?.ok===false?'Ошибка генерации':'Получен результат генерации','batch '+batchId);
  await writeAppState(data,accountId);
  return {matched,accountId};
}

async function recoverAcceptedRunsForPostProduction(){
  try{
    const registry=await ensureAccountsRegistry();
    for(const account of (registry.accounts||[])){
      const accountId=sanitizeAccountId(account.id||DEFAULT_ACCOUNT_ID);
      const state=await readAppState(accountId),data=state?.data||blankFactoryState();
      for(const run of (data.runs||[])){
        const total=Number(run?.generationResult?.totalScenes||run?.sceneCount||0);
        const accepted=new Set((Array.isArray(run?.acceptedScenes)?run.acceptedScenes:[]).map(Number)).size;
        const needsPost=run&&total>0&&accepted>=total&&!run?.montageResult&&!run?.paused&&run?.status!=='Остановлено';
        if(needsPost){
          run.postProductionRunning=false;run.status='В работе';run.stage=run.voiceoverResult?'Монтаж':'Озвучка';run.progress=Math.max(Number(run.progress)||0,74);run.awaitingApproval=false;run.updatedAt=new Date().toISOString();
          await writeAppState(data,accountId);
          enqueuePostProduction(accountId,run.id,'post-production-recovery');
        }
      }
    }
  }catch(e){console.error('[post-production-recovery] '+String(e?.message||e))}
}

async function recoverPendingBackendGenerations(){
  try{
    const registry=await ensureAccountsRegistry();
    for(const account of (registry.accounts||[])){
      const accountId=sanitizeAccountId(account.id||DEFAULT_ACCOUNT_ID);
      const state=await readAppState(accountId),data=state?.data||blankFactoryState();
      for(const run of (data.runs||[])){
        const hasPlan=!!run?.idea&&!!run?.script&&Array.isArray(run?.storyboard)&&run.storyboard.length>0;
        const complete=!!run?.generationResult?.completed;
        if(run&&hasPlan&&!complete&&!run.paused&&['В работе','Ошибка'].includes(run.status)&&run.stage==='Генерация'){
          run.backendGenerationRunning=false;
          run.status='В работе';
          run.error='';
          run.generationError='';
          run.updatedAt=new Date().toISOString();
          await writeAppState(data,accountId);
          enqueueRunGeneration(accountId,run.id,'backend-generation-recovery');
        }
      }
    }
  }catch(e){console.error('[backend-generation-recovery] scan '+String(e?.message||e))}
}

async function recoverLegacyPlaceholderRuns(){
  try{
    const registry=await ensureAccountsRegistry();
    for(const account of (registry.accounts||[])){
      const accountId=sanitizeAccountId(account.id||DEFAULT_ACCOUNT_ID);
      const state=await readAppState(accountId);
      const data=state?.data||blankFactoryState();
      data.runs=Array.isArray(data.runs)?data.runs:[];
      const candidates=data.runs.filter(run=>
        run &&
        run.status==='В работе' &&
        !run.legacyRecoveryAttempted &&
        !run.idea &&
        !run.script &&
        (!Array.isArray(run.storyboard)||run.storyboard.length===0) &&
        Number(run.progress||0)<=10 &&
        ['Идея','Сценарий',''].includes(String(run.stage||''))
      );
      for(const run of candidates){
        run.legacyRecoveryAttempted=true;
        run.updatedAt=new Date().toISOString();
        appendFactoryJournal(data,'Автовосстановление запуска',(run.productName||run.id)+' · восстанавливаю идею, сценарий и storyboard');
        await writeAppState(data,accountId);
        try{
          await runControlAction({runId:run.id,action:'resume',note:'Автовосстановление запуска после обновления производственного конвейера'},accountId);
          console.log('[legacy-recovery] recovered '+accountId+' '+run.id);
        }catch(e){
          const fresh=await readAppState(accountId);
          const fd=fresh?.data||blankFactoryState();
          const rr=findRunById(fd,run.id);
          if(rr){
            rr.status='Ошибка';
            rr.error='Автовосстановление: '+String(e?.message||e);
            rr.updatedAt=new Date().toISOString();
            appendFactoryJournal(fd,'Ошибка автовосстановления',(rr.productName||rr.id)+' · '+String(e?.message||e));
            await writeAppState(fd,accountId);
          }
          console.error('[legacy-recovery] failed '+accountId+' '+run.id+' '+String(e?.message||e));
        }
      }
    }
  }catch(e){
    console.error('[legacy-recovery] scan failed '+String(e?.message||e));
  }
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


  if(url.pathname==='/api/auth/register' && req.method==='POST'){
    try{
      const body=await readBody(req);
      const login=normalizeLogin(body?.login);
      const password=String(body?.password||'');
      const displayName=String(body?.displayName||login).trim().slice(0,120)||login;
      if(login.length<3) return json(res,400,{ok:false,error:'Логин должен быть не короче 3 символов.'});
      if(password.length<8) return json(res,400,{ok:false,error:'Пароль должен быть не короче 8 символов.'});
      const users=await ensureUsersRegistry();
      if(users.users.some(u=>u.login===login)) return json(res,409,{ok:false,error:'Такой логин уже зарегистрирован.'});
      const salt=randomBytes(16).toString('hex');
      const user={id:'usr_'+randomBytes(10).toString('hex'),login,displayName,salt,passwordHash:hashPassword(password,salt),createdAt:new Date().toISOString()};
      const isFirst=users.users.length===0;
      users.users.push(user);
      await writeUsersRegistry(users);

      const accounts=await ensureAccountsRegistry();
      if(isFirst){
        let claimed=false;
        for(const account of accounts.accounts){
          if(!account.ownerUserId){account.ownerUserId=user.id;claimed=true}
        }
        if(!claimed){
          const id='acc_'+user.id+'_main';
          accounts.accounts.push({id,name:'Основной аккаунт',owner:displayName,company:'',email:'',phone:'',notes:'',memory:'',avatarUrl:'',avatarPath:'',ownerUserId:user.id,createdAt:new Date().toISOString()});
          await writeAppState(blankFactoryState(),id);
        }
      }else{
        const id='acc_'+user.id+'_main';
        accounts.accounts.push({id,name:'Основной аккаунт',owner:displayName,company:'',email:'',phone:'',notes:'',memory:'',avatarUrl:'',avatarPath:'',ownerUserId:user.id,createdAt:new Date().toISOString()});
        await writeAppState(blankFactoryState(),id);
      }
      await writeAccountsRegistry(accounts);
      setSessionCookie(res,makeSessionToken(user.id));
      return json(res,201,{ok:true,user:{id:user.id,login:user.login,displayName:user.displayName}});
    }catch(e){
      return json(res,502,{ok:false,error:'Не удалось зарегистрироваться.',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/auth/login' && req.method==='POST'){
    try{
      const body=await readBody(req);
      const login=normalizeLogin(body?.login);
      const password=String(body?.password||'');
      const users=await ensureUsersRegistry();
      const user=users.users.find(u=>u.login===login);
      if(!user) return json(res,401,{ok:false,error:'Неверный логин или пароль.'});
      const actual=Buffer.from(hashPassword(password,user.salt),'hex');
      const expected=Buffer.from(user.passwordHash,'hex');
      if(actual.length!==expected.length||!timingSafeEqual(actual,expected)) return json(res,401,{ok:false,error:'Неверный логин или пароль.'});
      setSessionCookie(res,makeSessionToken(user.id));
      return json(res,200,{ok:true,user:{id:user.id,login:user.login,displayName:user.displayName||user.login}});
    }catch(e){
      return json(res,502,{ok:false,error:'Не удалось войти.',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/auth/me' && req.method==='GET'){
    const user=await sessionUser(req).catch(()=>null);
    if(!user) return json(res,401,{ok:false});
    return json(res,200,{ok:true,user});
  }

  if(url.pathname==='/api/auth/logout' && req.method==='POST'){
    clearSessionCookie(res);
    return json(res,200,{ok:true});
  }

  if(url.pathname.startsWith('/api/') && !['/api/status','/api/health'].includes(url.pathname) && !internalRequestAllowed(req)){
    const user=await sessionUser(req).catch(()=>null);
    if(!user) return json(res,401,{ok:false,error:'Нужно войти в Content Factory.'});
    req.cfUser=user;
  }

  if(url.pathname==='/api/accounts' && req.method==='GET'){
    try{
      const registry=await ensureAccountsRegistry();
      return json(res,200,{ok:true,accounts:(registry.accounts||[]).filter(a=>a.ownerUserId===req.cfUser?.id)});
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
        ownerUserId:req.cfUser.id,
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
      const account=registry.accounts.find(x=>x.id===id&&x.ownerUserId===req.cfUser?.id);
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
      if(!registry.accounts.some(x=>x.id===id&&x.ownerUserId===req.cfUser?.id)) return json(res,404,{ok:false,error:'Аккаунт не найден'});
      registry.accounts=registry.accounts.filter(x=>!(x.id===id&&x.ownerUserId===req.cfUser?.id));
      await writeAccountsRegistry(registry);
      await deleteStateRow(accountStateRowId(id));
      return json(res,200,{ok:true,deletedId:id});
    }catch(e){
      return json(res,502,{ok:false,error:'Не удалось удалить аккаунт.',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/fx/usd-rub' && req.method==='GET'){
    try{
      const fx=await currentUsdRubRate();
      return json(res,200,{ok:true,rate:fx.rate,date:fx.date,source:'Банк России'});
    }catch(e){
      return json(res,502,{ok:false,error:'Не удалось получить курс USD/RUB',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/expenses' && req.method==='POST'){
    try{
      const body=await readBody(req);
      const accountId=sanitizeAccountId(body?.accountId||DEFAULT_ACCOUNT_ID);
      if(!(await userOwnsAccount(req.cfUser?.id,accountId))) return json(res,403,{ok:false,error:'Нет доступа к этому аккаунту.'});
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
      if(!(await userOwnsAccount(req.cfUser?.id,accountId))) return json(res,403,{ok:false,error:'Нет доступа к этому аккаунту.'});
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
      if(!(await userOwnsAccount(req.cfUser?.id,accountId))) return json(res,403,{ok:false,error:'Нет доступа к этому аккаунту.'});
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
      if(!(await userOwnsAccount(req.cfUser?.id,accountId))) return json(res,403,{ok:false,error:'Нет доступа к этому аккаунту.'});
      const incoming=body?.data ?? body;
      const incomingData=incoming&&typeof incoming==='object'?incoming:{};
      const existing=await readAppState(accountId);
      const data=mergeClientStateWithServer(existing?.data||{},incomingData);
      await writeAppState(data,accountId);
      return json(res,200,{ok:true,configured:true,accountId,savedAt:new Date().toISOString()});
    }catch(e){
      return json(res,502,{ok:false,configured:true,error:'Не удалось сохранить серверное состояние.',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/video-analysis/upload' && req.method==='POST'){
    try{
      const item=await analyzeUploadedVideo(req,url);
      return json(res,200,{ok:true,item});
    }catch(e){
      return json(res,502,{ok:false,error:'Не удалось разобрать видео',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/video-analysis/youtube' && req.method==='POST'){
    try{
      const body=await readBody(req);
      const item=await analyzeYoutubeUrl(body,req);
      return json(res,200,{ok:true,item});
    }catch(e){
      return json(res,502,{ok:false,error:'Не удалось разобрать YouTube-видео',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/media/upload' && req.method==='POST'){
    try{
      const body=await readBody(req);
      const accountId=sanitizeAccountId(body?.accountId||req.headers['x-content-account']||DEFAULT_ACCOUNT_ID);
      if(!(await userOwnsAccount(req.cfUser?.id,accountId))) return json(res,403,{ok:false,error:'Нет доступа к этому аккаунту.'});
      const scopedProductId=(accountId+'__'+String(body?.productId||'media')).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);
      const data=await callProductMedia({
        action:'upload',
        productId:scopedProductId,
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
      const accountId=sanitizeAccountId(body?.accountId||req.headers['x-content-account']||DEFAULT_ACCOUNT_ID);
      if(!(await userOwnsAccount(req.cfUser?.id,accountId))) return json(res,403,{ok:false,error:'Нет доступа к этому аккаунту.'});
      const objectPath=String(body?.path||'');
      const scopedPrefix=(accountId+'__').replace(/[^a-zA-Z0-9_-]/g,'');
      let allowed=Boolean(objectPath&&objectPath.startsWith(scopedPrefix));
      if(!allowed&&objectPath){
        const state=await readAppState(accountId);
        const data=state?.data||{};
        const knownPaths=new Set();
        for(const product of (Array.isArray(data.products)?data.products:[])){
          for(const media of (Array.isArray(product?.media)?product.media:[])) if(media?.path) knownPaths.add(String(media.path));
        }
        for(const character of (Array.isArray(data.characters)?data.characters:[])){
          for(const media of (Array.isArray(character?.media)?character.media:[])) if(media?.path) knownPaths.add(String(media.path));
        }
        const registry=await ensureAccountsRegistry();
        const account=registry.accounts.find(x=>x.id===accountId&&x.ownerUserId===req.cfUser?.id);
        if(account?.avatarPath)knownPaths.add(String(account.avatarPath));
        allowed=knownPaths.has(objectPath);
      }
      if(!allowed) return json(res,403,{ok:false,error:'Нет доступа к этому медиафайлу.'});
      const result=await callProductMedia({action:'delete',path:objectPath});
      return json(res,200,result);
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

  if(url.pathname==='/api/chat/history' && req.method==='GET'){
    try{
      const accountId=sanitizeAccountId(url.searchParams.get('account')||req.headers['x-content-account']||DEFAULT_ACCOUNT_ID);
      if(!(await userOwnsAccount(req.cfUser?.id,accountId))) return json(res,403,{ok:false,error:'Нет доступа к этому аккаунту.'});
      const state=await readAppState(accountId);
      const data=state?.data||{};
      const hasCloudHistory=Object.prototype.hasOwnProperty.call(data,'chatHistory');
      return json(res,200,{ok:true,accountId,hasCloudHistory,history:normalizeStoredChatHistory(data.chatHistory||[])});
    }catch(e){
      return json(res,502,{ok:false,error:'Не удалось загрузить историю чата',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/chat/history' && req.method==='PUT'){
    try{
      const body=await readBody(req);
      const accountId=sanitizeAccountId(body?.accountId||url.searchParams.get('account')||DEFAULT_ACCOUNT_ID);
      if(!(await userOwnsAccount(req.cfUser?.id,accountId))) return json(res,403,{ok:false,error:'Нет доступа к этому аккаунту.'});
      const state=await readAppState(accountId);
      const data=state?.data&&typeof state.data==='object'?state.data:blankFactoryState();
      data.chatHistory=normalizeStoredChatHistory(body?.history||[]);
      await writeAppState(data,accountId);
      return json(res,200,{ok:true,accountId,count:data.chatHistory.length});
    }catch(e){
      return json(res,502,{ok:false,error:'Не удалось сохранить историю чата',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/chat/history' && req.method==='DELETE'){
    try{
      const accountId=sanitizeAccountId(url.searchParams.get('account')||DEFAULT_ACCOUNT_ID);
      if(!(await userOwnsAccount(req.cfUser?.id,accountId))) return json(res,403,{ok:false,error:'Нет доступа к этому аккаунту.'});
      const state=await readAppState(accountId);
      const data=state?.data&&typeof state.data==='object'?state.data:blankFactoryState();
      data.chatHistory=[];
      await writeAppState(data,accountId);
      return json(res,200,{ok:true,accountId});
    }catch(e){
      return json(res,502,{ok:false,error:'Не удалось очистить историю чата',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/chat/upload' && req.method==='POST'){
    if(!openaiConfigured() || process.env.CHATGPT_CONTROL_ENABLED!=='true'){
      return json(res,503,{ok:false,error:'ChatGPT-пульт ещё не подключён.'});
    }
    try{
      const body=await readBody(req);
      const attachment=await uploadOpenAIChatFile(body);
      return json(res,201,{ok:true,attachment});
    }catch(e){
      return json(res,502,{ok:false,error:'Не удалось прикрепить файл',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/chat' && req.method==='POST'){
    if(!openaiConfigured() || process.env.CHATGPT_CONTROL_ENABLED!=='true'){
      return json(res,503,{ok:false,error:'ChatGPT-пульт ещё не подключён. Нужен OpenAI API и включение управляющего чата.'});
    }
    try{
      const body=await readBody(req);
      const message=String(body?.message||'').trim();
      const attachments=normalizeChatAttachments(body?.attachments);
      if(!message && !attachments.length) return json(res,400,{ok:false,error:'Пустое сообщение'});
      const accountId=sanitizeAccountId(body?.accountId||DEFAULT_ACCOUNT_ID);
      if(!(await userOwnsAccount(req.cfUser?.id,accountId))) return json(res,403,{ok:false,error:'Нет доступа к этому аккаунту.'});
      const result=await callOpenAIChat(message,body?.history||[],accountId,attachments);
      return json(res,200,{ok:true,...result});
    }catch(e){
      return json(res,502,{ok:false,error:'OpenAI chat failed',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/ideas/generate' && req.method==='POST'){
    try{
      const body=await readBody(req);
      const accountId=sanitizeAccountId(body?.accountId||DEFAULT_ACCOUNT_ID);
      if(!(await userOwnsAccount(req.cfUser?.id,accountId))) return json(res,403,{ok:false,error:'Нет доступа к этому аккаунту.'});
      const run=await createIdeaDraft(body,accountId);
      return json(res,201,{ok:true,run});
    }catch(e){
      return json(res,502,{ok:false,error:'Не удалось создать идею',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/runs/action' && req.method==='POST'){
    try{
      const body=await readBody(req);
      const accountId=sanitizeAccountId(body?.accountId||DEFAULT_ACCOUNT_ID);
      if(!internalRequestAllowed(req) && !(await userOwnsAccount(req.cfUser?.id,accountId))) return json(res,403,{ok:false,error:'Нет доступа к этому аккаунту.'});
      const run=await runControlAction(body,accountId);
      return json(res,200,{ok:true,run});
    }catch(e){
      return json(res,502,{ok:false,error:'Не удалось выполнить действие',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/start' && req.method==='POST'){
    try{
      const payload=await readBody(req);
      const accountId=sanitizeAccountId(payload?.accountId||DEFAULT_ACCOUNT_ID);
      if(!(await userOwnsAccount(req.cfUser?.id,accountId))) return json(res,403,{ok:false,error:'Нет доступа к этому аккаунту.'});
      payload.accountId=accountId;
      if(payload?.action==='create_batch'){
        const result=await createBatchRuns(payload,accountId);
        return json(res,201,{ok:true,...result});
      }
      if(payload?.action==='regenerate_scene'||payload?.action==='revise'){
        const run=await runControlAction({runId:payload.runId,action:'regenerate',stage:payload?.scene?'Генерация':(payload.part||'Сценарий'),note:payload.note||''},accountId);
        return json(res,200,{ok:true,run});
      }
      const result=await dispatchFactoryStart(payload);
      return json(res,result.ok?202:502,result);
    }catch(e){
      return json(res,502,{ok:false,error:'Не удалось запустить производство.',detail:String(e?.message||e)});
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

server.listen(port,'0.0.0.0',async()=>{
  console.log(`Content Factory запущен на порту ${port}`);
  setTimeout(async()=>{
    try{
      await recoverLegacyPlaceholderRuns();
    }catch(e){
      console.error('[startup-recovery] legacy '+String(e?.message||e));
    }
    try{
      await recoverPendingBackendGenerations();
    }catch(e){
      console.error('[startup-recovery] generation '+String(e?.message||e));
    }
    try{
      await recoverAcceptedRunsForPostProduction();
    }catch(e){
      console.error('[startup-recovery] post-production '+String(e?.message||e));
    }
  },1200);
  if(process.env.CF_CHAT_SELFTEST==='1'){
    try{
      const turn1=await callOpenAIChat('Ответь только: OK1',[],DEFAULT_ACCOUNT_ID);
      const history=[
        {role:'user',content:'Ответь только: OK1'},
        {role:'assistant',content:String(turn1?.text||'OK1')}
      ];
      const turn2=await callOpenAIChat('Ответь только: OK2',history,DEFAULT_ACCOUNT_ID);
      console.log('[chat-selftest] PASS turn1='+JSON.stringify(String(turn1?.text||''))+' turn2='+JSON.stringify(String(turn2?.text||'')));
    }catch(e){
      console.error('[chat-selftest] FAIL '+String(e?.message||e));
    }
  }
});
