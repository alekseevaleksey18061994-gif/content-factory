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
const APP_VERSION='2.6.36';
const BUILD_ID=String(process.env.RAILWAY_GIT_COMMIT_SHA||process.env.GIT_COMMIT_SHA||'dev').slice(0,7);

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
  let lastError=null;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const r=await fetch(base+'/rest/v1/app_state?id=eq.'+encodeURIComponent(rowId)+'&select=data,updated_at&limit=1',{
        headers:supabaseHeaders()
      });
      if(r.ok){
        const rows=await r.json();
        return {configured:true,data:rows?.[0]?.data??null,updatedAt:rows?.[0]?.updated_at??null};
      }
      const detail=await r.text();
      const retryable=r.status>=500||/57014|statement timeout|canceling statement/i.test(detail);
      lastError=new Error('Supabase read failed: '+r.status+' '+detail);
      if(!retryable||attempt===3)throw lastError;
    }catch(e){
      lastError=e;
      const retryable=/57014|statement timeout|canceling statement|fetch failed|ECONNRESET|ETIMEDOUT/i.test(String(e?.message||e));
      if(!retryable||attempt===3)throw e;
    }
    await new Promise(resolve=>setTimeout(resolve,attempt===1?500:1500));
  }
  throw lastError||new Error('Supabase read failed');
}

async function writeStateRow(rowId,data){
  if(!supabaseConfigured()) return {configured:false};
  const base=process.env.SUPABASE_URL.replace(/\/$/,'');
  let lastError=null;
  for(let attempt=1;attempt<=3;attempt++){
    const updatedAt=new Date().toISOString();
    try{
      const r=await fetch(base+'/rest/v1/app_state?on_conflict=id',{
        method:'POST',
        headers:supabaseHeaders({'prefer':'resolution=merge-duplicates,return=minimal'}),
        body:JSON.stringify([{id:rowId,data,updated_at:updatedAt}])
      });
      if(r.ok)return {configured:true,updatedAt};
      const detail=await r.text();
      const retryable=r.status>=500||/57014|statement timeout|canceling statement/i.test(detail);
      lastError=new Error('Supabase write failed: '+r.status+' '+detail);
      if(!retryable||attempt===3)throw lastError;
    }catch(e){
      lastError=e;
      const retryable=/57014|statement timeout|canceling statement|fetch failed|ECONNRESET|ETIMEDOUT/i.test(String(e?.message||e));
      if(!retryable||attempt===3)throw e;
    }
    await new Promise(resolve=>setTimeout(resolve,attempt===1?500:1500));
  }
  throw lastError||new Error('Supabase write failed');
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

function stateEntityTime(item){
  const raw=item?.updatedAt||item?.updated_at||item?.finishedAt||item?.failedAt||item?.createdAt||item?.created||'';
  const ts=Date.parse(String(raw||''));
  return Number.isFinite(ts)?ts:0;
}
function mergeNewestById(existing=[],incoming=[],limit=5000){
  const map=new Map();
  for(const item of (Array.isArray(existing)?existing:[])){
    if(item&&item.id!=null)map.set(String(item.id),item);
  }
  for(const item of (Array.isArray(incoming)?incoming:[])){
    if(!item||item.id==null)continue;
    const key=String(item.id),prev=map.get(key);
    if(!prev){map.set(key,item);continue}
    const prevTs=stateEntityTime(prev),nextTs=stateEntityTime(item);
    if(prevTs&&(!nextTs||nextTs<prevTs))continue;
    map.set(key,{...prev,...item});
  }
  return [...map.values()].slice(-limit);
}
function markStateSnapshot(data,updatedAt){
  if(data&&typeof data==='object'){
    try{
      Object.defineProperty(data,'__stateUpdatedAt',{value:String(updatedAt||''),writable:true,configurable:true,enumerable:false});
    }catch{}
  }
  return data;
}
async function readAppState(accountId=DEFAULT_ACCOUNT_ID){
  const state=await readStateRow(accountStateRowId(accountId));
  if(state?.data)markStateSnapshot(state.data,state.updatedAt);
  return state;
}

async function writeAppState(data,accountId=DEFAULT_ACCOUNT_ID){
  const rowId=accountStateRowId(accountId);
  const baseUpdatedAt=String(data?.__stateUpdatedAt||'');
  const current=await readStateRow(rowId).catch(()=>({configured:false,data:null,updatedAt:null}));
  let output=data;
  const stale=Boolean(
    current?.data&&
    baseUpdatedAt&&
    current?.updatedAt&&
    String(current.updatedAt)!==baseUpdatedAt
  );
  if(stale){
    // A long-running media job may be holding an old full-state snapshot.
    // Merge versioned entities instead of rolling newer neighboring runs/products/ideas back.
    output={...current.data,...data};
    output.runs=mergeNewestById(current.data.runs,data?.runs,5000);
    output.products=mergeNewestById(current.data.products,data?.products,2000);
    output.characters=mergeNewestById(current.data.characters,data?.characters,1000);
    output.savedIdeas=mergeNewestById(current.data.savedIdeas,data?.savedIdeas,5000);
    output.mediaLibrary=mergeNewestById(current.data.mediaLibrary,data?.mediaLibrary,10000);
    output.expenses=mergeNewestById(current.data.expenses,data?.expenses,5000);
    output.journal=mergeNewestById(current.data.journal,data?.journal,1000);
    output.scripts=mergeNewestById(current.data.scripts,data?.scripts,3000);
    output.videoAnalyses=mergeNewestById(current.data.videoAnalyses,data?.videoAnalyses,500);
    output.campaigns=mergeNewestById(current.data.campaigns,data?.campaigns,1000);
    // Chat/settings are not background-pipeline outputs. Preserve the freshest server copy
    // when this writer is known to be stale.
    output.chatHistory=current.data.chatHistory??data?.chatHistory;
    output.settings=current.data.settings??data?.settings;
    Object.assign(data,output);
  }
  const written=await writeStateRow(rowId,output);
  markStateSnapshot(data,written?.updatedAt||current?.updatedAt||'');
  return written;
}

function blankFactoryState(){
  return {
    version:1,
    products:[],
    runs:[],
    campaigns:[],
    scripts:[],
    savedIdeas:[],
    mediaLibrary:[],
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

function characterSnapshot(character){
  if(!character)return null;
  return {
    id:String(character.id||''),
    name:String(character.name||''),
    age:String(character.age||''),
    look:String(character.look||''),
    voice:String(character.voice||''),
    topics:String(character.topics||''),
    locks:String(character.locks||''),
    voiceLinked:!!character.voiceLinked,
    media:(Array.isArray(character.media)?character.media:[]).map(m=>({
      id:m?.id,url:m?.url,path:m?.path,fileName:m?.fileName,isPrimary:!!m?.isPrimary
    })).filter(m=>m.url)
  };
}
function resolveProductCharacter(data,product,payload={}){
  const explicitId=String(payload.characterId||payload.character?.id||'').trim();
  if(payload.characterOverride===true){
    return explicitId?findCharacterInState(data,explicitId):null;
  }
  if(explicitId){
    const explicit=findCharacterInState(data,explicitId);
    if(explicit)return explicit;
  }
  const linkedId=String(product?.defaultCharacterId||'').trim();
  return linkedId?findCharacterInState(data,linkedId):null;
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

function higgsfieldUsageUsd(model,usage={}){
  const m=String(model||'').toLowerCase();
  const seconds=Math.max(0,Number(usage.duration||usage.seconds)||0);
  const jobs=Math.max(1,Number(usage.jobs)||1);
  // Current working estimates used only when the provider response does not expose USD.
  // Nano Banana Pro 2K ≈ 2 credits/image ≈ $0.10 at the 20 credits/$1 reference rate.
  if(/nano[-_ ]?banana[-_ ]?pro/.test(m))return 0.10*jobs;
  // Seedance 2.0 720p estimate: 27 credits for 6 sec = 4.5 credits/sec.
  if(/seedance[-_. /]?2(?:\.0)?/.test(m)&&seconds>0)return (4.5*seconds*jobs)/20;
  // Conservative generic fallback for Higgsfield image jobs only.
  if(String(usage.kind||'').toLowerCase()==='image')return 0.10*jobs;
  return 0;
}
function runwayCreditsPerSecond(model){
  const m=String(model||'gen4.5').toLowerCase();
  if(m.includes('gen4_turbo'))return 5;
  if(m.includes('gen4.5'))return 12;
  if(m.includes('veo3.1_fast'))return 10;
  if(m.includes('veo3.1'))return 20;
  if(m.includes('wan3'))return 10;
  if(m.includes('seedance2_5'))return 30;
  if(m.includes('hailuo3'))return 15;
  return 12;
}
function runwayUsageUsd(model,seconds){
  return (runwayCreditsPerSecond(model)*Math.max(0,Number(seconds)||0))*0.01;
}

function openAIUsageCost(model,usage={}){
  const name=String(model||'gpt-6-astra').toLowerCase();
  let inputRate=0.20,cachedRate=0.02,outputRate=1.20;
  if(name.includes('gpt-6-astra')){inputRate=10;cachedRate=1;outputRate=50}
  else if(name.includes('gpt-6-sol')){inputRate=2;cachedRate=.2;outputRate=10}
  else if(name.includes('gpt-5.6-terra')){inputRate=2;cachedRate=.2;outputRate=12}
  else if(name.includes('gpt-6-astra')){inputRate=4;cachedRate=.4;outputRate=20}
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
  const taskId=factoryId('dispatch');
  Promise.resolve().then(async()=>{
    const results={archive:null,generation:null};
    if(webhook){
      try{
        const r=await fetch(webhook,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...payload,backgroundTaskId:taskId})});
        results.archive={ok:r.ok,status:r.status};
      }catch(e){results.archive={ok:false,status:0,error:String(e?.message||e)}}
    }
    if(generationWebhook){
      try{
        const r=await fetch(generationWebhook,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...payload,backgroundTaskId:taskId})});
        results.generation={ok:r.ok,status:r.status};
      }catch(e){results.generation={ok:false,status:0,error:String(e?.message||e)}}
    }
    console.log('[dispatch-background] '+taskId+' '+JSON.stringify(results));
  }).catch(e=>console.error('[dispatch-background] '+taskId+' '+String(e?.message||e)));
  return {ok:true,accepted:true,taskId,data:{archive:webhook?{status:'queued'}:null,generation:generationWebhook?{status:'queued'}:null}};
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
function parseIdeaJsonLoose(value){
  if(value&&typeof value==='object'&&!Array.isArray(value))return value;
  const raw=String(value||'').trim().replace(/^\`\`\`(?:json)?\s*/i,'').replace(/\s*\`\`\`$/,'');
  if(!raw)return null;
  const candidates=[
    raw,
    raw.replace(/,\s*""\s*}/g,'}').replace(/,\s*([}\]])/g,'$1')
  ];
  for(const c of candidates){
    try{return JSON.parse(c)}catch{}
    const start=c.indexOf('{'),end=c.lastIndexOf('}');
    if(start>=0&&end>start){try{return JSON.parse(c.slice(start,end+1))}catch{}}
  }
  return null;
}
function ideaStageComplete(idea){
  const required=['title','audience','hook','first3Seconds','concept','mechanic','angle','productRole','retention','payoff','ctaDirection','production','why'];
  const missing=required.filter(k=>!String(idea?.[k]||'').trim());
  const alternatives=Array.isArray(idea?.alternatives)?idea.alternatives:[];
  const altRequired=['title','audience','hook','first3Seconds','concept','mechanic','angle','productRole','retention','payoff','ctaDirection','production','why'];
  const altQualityRequired=['hook','retention','nativeTikTok','proofVariety','shareability','originality','generatability','overall'];
  const badAlt=alternatives.length<4||alternatives.slice(0,4).some(x=>
    altRequired.some(k=>!String(x?.[k]||'').trim()) ||
    altQualityRequired.some(k=>!Number.isFinite(Number(x?.quality?.[k])))
  );
  return {ok:missing.length===0&&!badAlt,missing,badAlt};
}

function normalizeIdeaStage(raw,payload={}){
  let source=raw;
  if(source&&typeof source==='object'&&typeof source.summary==='string'){
    const nested=parseIdeaJsonLoose(source.summary);
    if(nested)source=nested;
  }
  if(source&&typeof source==='object'&&typeof source.concept==='string'&&/^\s*\{/.test(source.concept)){
    const nested=parseIdeaJsonLoose(source.concept);
    if(nested?.selected)source=nested;
  }
  const src=source&&typeof source==='object'?(source.selected||source.idea||source):{};
  const alts=Array.isArray(source?.alternatives)?source.alternatives:(Array.isArray(src?.alternatives)?src.alternatives:[]);
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
    formatPattern:String(src.formatPattern||'').slice(0,500),
    hookLab:src.hookLab&&typeof src.hookLab==='object'?src.hookLab:null,
    alternatives:alts.slice(0,5).map(x=>({
      title:String(x?.title||'').slice(0,240),
      audience:String(x?.audience||'').slice(0,2000),
      hook:String(x?.hook||'').slice(0,2000),
      first3Seconds:String(x?.first3Seconds||x?.hook||'').slice(0,3000),
      concept:String(x?.concept||'').slice(0,5000),
      mechanic:String(x?.mechanic||'').slice(0,3000),
      angle:String(x?.angle||'').slice(0,2000),
      productRole:String(x?.productRole||'').slice(0,3000),
      retention:String(x?.retention||'').slice(0,3000),
      payoff:String(x?.payoff||'').slice(0,3000),
      ctaDirection:String(x?.ctaDirection||'').slice(0,2000),
      production:String(x?.production||'').slice(0,1600),
      why:String(x?.why||'').slice(0,4000),
      quality:x?.quality&&typeof x.quality==='object'?x.quality:{}
    }))
  };
}
function productDNAFromPayload(payload={}){
  const dna=payload?.productDNA || payload?.product?.productDNA || payload?.product?.dna || null;
  return dna&&typeof dna==='object'?dna:null;
}
function productDNAText(payload={}){
  const dna=productDNAFromPayload(payload);
  if(!dna)return '';
  return [
    'PRODUCT DNA — extracted from original source photos and explicit product facts. Treat as hard factual constraints:',
    JSON.stringify(dna)
  ].join(' ');
}
function universalProductIdentityLock(payload={}){
  return [
    'GLOBAL SOURCE PRODUCT IDENTITY LOCK — applies to EVERY product and EVERY generation stage.',
    'The uploaded ORIGINAL product photos are the single authoritative source of truth for the physical product.',
    'Never redesign, beautify, simplify, stylize, mirror, substitute, merge, reinterpret or improve the product itself.',
    'Preserve exactly the same silhouette, geometry, proportions, dimensions as visually observable, number and placement of parts, openings, edges, caps, buttons, fasteners, supports, mounts, seams, textures, materials, colors, transparency, labels/markings and visible construction.',
    'Do not invent hidden mechanisms, removable parts, hinges, caps, supports, attachments, controls, accessories or functions that are not clearly confirmed by the source photos or explicit product rules.',
    'Do not copy product geometry from AI-generated previz or previous generated frames when it conflicts with the ORIGINAL source photos. Generated frames are continuity/composition references only; source photos always win for product identity.',
    'Camera angle, lighting, perspective, occlusion, hand position and scene context may change, but the physical product model must remain the same.',
    'If an action cannot be shown without changing the real product construction, change the ACTION/SHOT — never change the product.',
    'Any visible product geometry drift is a critical QC failure and must be regenerated before the pipeline continues.',
    productDNAText(payload)
  ].filter(Boolean).join(' ');
}
function productMediaFingerprint(product={}){
  const media=(Array.isArray(product.media)?product.media:[])
    .map(m=>String(m?.url||m?.path||m?.id||'')).filter(Boolean).sort();
  return media.join('|');
}
async function analyzeProductDNA(product,accountId){
  const refs=(Array.isArray(product?.media)?product.media:[])
    .map(m=>m?.url).filter(u=>/^https:\/\//i.test(String(u||''))).slice(0,6);
  if(!refs.length)return {
    status:'no-source-photos',
    summary:'Нет исходных фото для визуального Product DNA.',
    geometry:'unknown',components:[],materials:[],colors:[],markings:[],usageMechanics:[],
    removableParts:[],fixedParts:[],prohibitedChanges:['Не менять внешний вид товара без подтверждения исходными фото.'],
    unknowns:['Визуальные детали не определены без исходных фото.']
  };
  if(!openaiConfigured())return {
    status:'pending-openai',
    summary:'Product DNA будет уточнён при доступном OpenAI vision.',
    geometry:'use source photos exactly',components:[],materials:[],colors:[],markings:[],usageMechanics:[],
    removableParts:[],fixedParts:[],prohibitedChanges:['Исходные фото — абсолютный эталон товара.'],
    unknowns:['Автоматический визуальный разбор временно недоступен.']
  };
  const schema={
    type:'object',additionalProperties:false,
    required:['summary','geometry','components','materials','colors','markings','usageMechanics','removableParts','fixedParts','prohibitedChanges','unknowns'],
    properties:{
      summary:{type:'string'},geometry:{type:'string'},
      components:{type:'array',items:{type:'string'},maxItems:30},
      materials:{type:'array',items:{type:'string'},maxItems:20},
      colors:{type:'array',items:{type:'string'},maxItems:20},
      markings:{type:'array',items:{type:'string'},maxItems:20},
      usageMechanics:{type:'array',items:{type:'string'},maxItems:30},
      removableParts:{type:'array',items:{type:'string'},maxItems:30},
      fixedParts:{type:'array',items:{type:'string'},maxItems:30},
      prohibitedChanges:{type:'array',items:{type:'string'},maxItems:40},
      unknowns:{type:'array',items:{type:'string'},maxItems:30}
    }
  };
  const prompt=[
    'ROLE: forensic product identity analyst for AI image/video generation.',
    'Analyze ONLY what is visually confirmed by ORIGINAL source product photos plus explicit text facts below.',
    'Product: '+String(product?.name||''),
    'Category: '+String(product?.category||''),
    'UTP: '+String(product?.utp||''),
    'Explicit rules: '+String(product?.rules||''),
    'Create a PRODUCT DNA that prevents model drift in future image/video generation.',
    'Describe geometry, visible components, fixed vs removable parts, materials/colors/markings, and only usage mechanics clearly proven by photos/text.',
    'NEVER infer hidden mechanisms. If uncertain, put it in unknowns.',
    'prohibitedChanges must list concrete visual/model changes that future generators must not make.',
    'Return JSON only.'
  ].join('\n');
  const input=[{role:'user',content:[
    {type:'input_text',text:prompt},
    ...refs.map(url=>({type:'input_image',image_url:String(url),detail:'high'}))
  ]}];
  const model=process.env.OPENAI_MODEL||'gpt-6-astra';
  const r=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'content-type':'application/json'},
    body:JSON.stringify({
      model,input,reasoning:{effort:'medium'},max_output_tokens:3000,
      text:{format:{type:'json_schema',name:'product_dna',strict:true,schema}}
    })
  });
  const raw=await r.text();let data;try{data=raw?JSON.parse(raw):{}}catch{data={raw}}
  if(!r.ok)throw new Error(data?.error?.message||('Product DNA error '+r.status));
  const parsed=safeAnalysisJson(openAIText(data))||{};
  const priced=openAIUsageCost(data?.model||model,data?.usage||{});
  if(priced.amountUsd>0)await recordExpense(accountId,{
    provider:'OpenAI',category:'product-dna',description:'Product DNA · '+String(product?.name||'товар'),
    amountUsd:priced.amountUsd,model:data?.model||model,usage:priced.details,source:'auto'
  }).catch(()=>{});
  return {...parsed,status:'ready',sourcePhotos:refs.length,generatedAt:new Date().toISOString()};
}
async function ensureProductDNA(data,product,accountId){
  if(!product)return null;
  const fingerprint=productMediaFingerprint(product);
  if(product.productDNA && product.productDNAFingerprint===fingerprint)return product.productDNA;
  try{
    const dna=await analyzeProductDNA(product,accountId);
    product.productDNA=dna;
    product.productDNAFingerprint=fingerprint;
    product.productDNAUpdatedAt=new Date().toISOString();
    product.updatedAt=product.productDNAUpdatedAt;
    return dna;
  }catch(e){
    console.error('[product-dna] '+String(product?.id||product?.name||'')+' '+String(e?.message||e));
    product.productDNA=product.productDNA||{
      status:'fallback',
      summary:'Использовать исходные фото как абсолютный визуальный эталон.',
      prohibitedChanges:['Не менять форму, геометрию, пропорции, детали, цвет, материал и конструкцию товара.'],
      unknowns:['Автоматический Product DNA временно не обновлён.']
    };
    product.productDNAFingerprint=fingerprint;
    return product.productDNA;
  }
}

async function recentIdeaContext(accountId,productId){
  try{
    const state=await readAppState(accountId);
    const data=state?.data||{};
    const allRuns=Array.isArray(data.runs)?data.runs:[];
    const recent=allRuns
      .filter(r=>r?.idea && (!productId||r.productId===productId))
      .slice(-16)
      .map(r=>({
        title:r.idea?.title||'',hook:r.idea?.hook||'',concept:r.idea?.concept||'',
        mechanic:r.idea?.mechanic||'',formatPattern:r.idea?.formatPattern||''
      }));
    const analyses=(Array.isArray(data.videoAnalyses)?data.videoAnalyses:[])
      .slice(-12)
      .map(v=>{
        const a=v?.analysis&&typeof v.analysis==='object'?v.analysis:{};
        const src=a?.sourceBlueprint||a?.sourceReconstruction||{};
        const adapt=a?.adaptation||{};
        return {
          title:String(v?.title||v?.name||v?.sourceName||'').slice(0,200),
          summary:String(v?.summary||a?.summary||v?.result?.summary||'').slice(0,1800),
          hook:String(a?.hook||src?.sourceHook||'').slice(0,1200),
          sourceHook:String(src?.sourceHook||'').slice(0,1000),
          scriptSummary:String(src?.scriptSummary||'').slice(0,1600),
          visualDNA:String(src?.visualDNA||'').slice(0,1600),
          cameraGrammar:String(src?.cameraGrammar||a?.cameraLanguage||'').slice(0,1600),
          lightingGrammar:String(src?.lightingGrammar||'').slice(0,1200),
          setGrammar:String(src?.setGrammar||a?.setDesign||'').slice(0,1600),
          editingGrammar:String(src?.editingGrammar||'').slice(0,1600),
          audioGrammar:String(src?.audioGrammar||a?.soundDesign||'').slice(0,1600),
          sourceShots:Array.isArray(src?.shots)?src.shots.slice(0,12):[],
          improvedConcept:String(adapt?.concept||'').slice(0,1600),
          improvedHook:String(adapt?.hook||'').slice(0,1200),
          improvedScenes:Array.isArray(adapt?.scenes)?adapt.scenes.slice(0,10):[],
          retentionMap:Array.isArray(a?.retentionMap)?a.retentionMap.slice(0,10):[],
          patternInterrupts:Array.isArray(a?.patternInterrupts)?a.patternInterrupts.slice(0,10):[],
          visualContrasts:Array.isArray(a?.visualContrasts)?a.visualContrasts.slice(0,10):[],
          microPayoffs:Array.isArray(a?.microPayoffs)?a.microPayoffs.slice(0,10):[],
          scenes:Array.isArray(a?.scenes)?a.scenes.slice(0,10):[],
          whyWorks:Array.isArray(a?.whyWorks)?a.whyWorks.slice(0,10):[]
        };
      });
    const performanceRuns=allRuns
      .filter(r=>(!productId||r.productId===productId)&&r?.idea&&r?.metrics&&typeof r.metrics==='object')
      .map(r=>{
        const m=r.metrics||{};
        const views=Number(m.views)||0;
        const retention=Number(m.retention??m.averageRetention??m.completionRate)||0;
        const rewatch=Number(m.rewatchRate??m.rewatches)||0;
        const clicks=Number(m.clicks)||0;
        const ctr=Number(m.ctr)||0;
        const sales=Number(m.sales)||0;
        const signal=(retention*4)+(rewatch*2)+(ctr*3)+Math.log10(Math.max(1,views))*2+Math.min(10,sales);
        return {
          title:String(r.idea?.title||''),hook:String(r.idea?.hook||''),mechanic:String(r.idea?.mechanic||''),
          formatPattern:String(r.idea?.formatPattern||''),views,retention,rewatch,ctr,clicks,sales,signal
        };
      }).sort((a,b)=>b.signal-a.signal);
    const performance={
      winners:performanceRuns.slice(0,5).map(({signal,...x})=>x),
      weaker:performanceRuns.length>5?performanceRuns.slice(-3).map(({signal,...x})=>x):[],
      sampleSize:performanceRuns.length
    };
    return {recent,analyses,performance};
  }catch{return {recent:[],analyses:[],performance:{winners:[],weaker:[],sampleSize:0}}}
}
async function generateIdeaStage(payload,accountId,variant=1,feedback=''){
  if(!openaiConfigured())throw new Error('OpenAI API is not configured');
  const ctx=await recentIdeaContext(accountId,payload.productId||payload.product?.id);
  const productRefs=(payload.media||payload.product?.media||[])
    .map(x=>x?.url).filter(x=>/^https:\/\//i.test(String(x||''))).slice(0,3);
  const avatarRefs=(payload.avatarReferences||payload.character?.media||[])
    .map(x=>x?.url).filter(x=>/^https:\/\//i.test(String(x||''))).slice(0,2);
  const refs=[productRefs[0],avatarRefs[0]].filter(Boolean);
  const model=process.env.OPENAI_MODEL||'gpt-6-astra';
  async function markIdeaProgress(progress,step){
    if(!payload?.id)return;
    try{
      const state=await readAppState(accountId),data=state?.data||blankFactoryState(),run=findRunById(data,payload.id);
      if(!run||run.stage!=='Идея')return;
      run.progress=Math.max(Number(run.progress)||0,Number(progress)||0);
      run.backgroundTask={...(run.backgroundTask||{}),step:String(step||''),heartbeatAt:new Date().toISOString()};
      run.updatedAt=new Date().toISOString();
      await writeAppState(data,accountId);
    }catch{}
  }

  const candidateSchema={
    type:'object',
    additionalProperties:false,
    required:['candidates'],
    properties:{
      candidates:{
        type:'array',minItems:20,maxItems:20,
        items:{
          type:'object',additionalProperties:false,
          required:['title','formatPattern','hook','concept','mechanic','payoff'],
          properties:{
            title:{type:'string'},formatPattern:{type:'string'},hook:{type:'string'},
            concept:{type:'string'},mechanic:{type:'string'},payoff:{type:'string'}
          }
        }
      }
    }
  };
  const finalSchema={
    type:'object',
    additionalProperties:false,
    required:['selected','alternatives','quality'],
    properties:{
      selected:{
        type:'object',additionalProperties:false,
        required:['title','audience','hook','first3Seconds','concept','mechanic','angle','productRole','retention','payoff','ctaDirection','production','why'],
        properties:{
          title:{type:'string'},audience:{type:'string'},hook:{type:'string'},first3Seconds:{type:'string'},
          concept:{type:'string'},mechanic:{type:'string'},angle:{type:'string'},productRole:{type:'string'},
          retention:{type:'string'},payoff:{type:'string'},ctaDirection:{type:'string'},production:{type:'string'},why:{type:'string'}
        }
      },
      alternatives:{
        type:'array',minItems:4,maxItems:4,
        items:{
          type:'object',additionalProperties:false,
          required:['title','audience','hook','first3Seconds','concept','mechanic','angle','productRole','retention','payoff','ctaDirection','production','why','quality'],
          properties:{
            title:{type:'string'},audience:{type:'string'},hook:{type:'string'},first3Seconds:{type:'string'},
            concept:{type:'string'},mechanic:{type:'string'},angle:{type:'string'},productRole:{type:'string'},
            retention:{type:'string'},payoff:{type:'string'},ctaDirection:{type:'string'},production:{type:'string'},why:{type:'string'},
            quality:{
              type:'object',additionalProperties:false,
              required:['hook','retention','nativeTikTok','proofVariety','shareability','originality','generatability','overall'],
              properties:{
                hook:{type:'integer',minimum:1,maximum:10},
                retention:{type:'integer',minimum:1,maximum:10},
                nativeTikTok:{type:'integer',minimum:1,maximum:10},
                proofVariety:{type:'integer',minimum:1,maximum:10},
                shareability:{type:'integer',minimum:1,maximum:10},
                originality:{type:'integer',minimum:1,maximum:10},
                generatability:{type:'integer',minimum:1,maximum:10},
                overall:{type:'integer',minimum:1,maximum:10}
              }
            }
          }
        }
      },
      quality:{
        type:'object',additionalProperties:false,
        required:['hook','scrollStop','curiosityGap','retention','pacing','nativeTikTok','dialogueNaturalness','humanNaturalness','proofVariety','shareability','loopPotential','productNecessity','visualClarity','originality','avatarFit','generatability','payoff','factualSafety','conversionPotential','overall'],
        properties:{
          hook:{type:'integer',minimum:1,maximum:10},
          scrollStop:{type:'integer',minimum:1,maximum:10},
          curiosityGap:{type:'integer',minimum:1,maximum:10},
          retention:{type:'integer',minimum:1,maximum:10},
          pacing:{type:'integer',minimum:1,maximum:10},
          nativeTikTok:{type:'integer',minimum:1,maximum:10},
          dialogueNaturalness:{type:'integer',minimum:1,maximum:10},
          humanNaturalness:{type:'integer',minimum:1,maximum:10},
          proofVariety:{type:'integer',minimum:1,maximum:10},
          shareability:{type:'integer',minimum:1,maximum:10},
          loopPotential:{type:'integer',minimum:1,maximum:10},
          productNecessity:{type:'integer',minimum:1,maximum:10},
          visualClarity:{type:'integer',minimum:1,maximum:10},
          originality:{type:'integer',minimum:1,maximum:10},
          avatarFit:{type:'integer',minimum:1,maximum:10},
          generatability:{type:'integer',minimum:1,maximum:10},
          payoff:{type:'integer',minimum:1,maximum:10},
          factualSafety:{type:'integer',minimum:1,maximum:10},
          conversionPotential:{type:'integer',minimum:1,maximum:10},
          overall:{type:'integer',minimum:1,maximum:10}
        }
      }
    }
  };

  async function callIdeaAI({prompt,schema,name,images=[]}){
    const input=[{role:'user',content:[
      {type:'input_text',text:prompt},
      ...images.map(url=>({type:'input_image',image_url:String(url),detail:'low'}))
    ]}];
    const controller=new AbortController();
    const timeoutMs=name==='idea_candidates'?85000:75000;
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    let r;
    try{
      r=await fetch('https://api.openai.com/v1/responses',{
        method:'POST',
        signal:controller.signal,
        headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'content-type':'application/json'},
        body:JSON.stringify({
          model,input,reasoning:{effort:'medium'},max_output_tokens:name==='idea_candidates'?7000:4800,
          text:{format:{type:'json_schema',name,strict:true,schema}}
        })
      });
    }catch(e){
      if(e?.name==='AbortError')throw new Error('OpenAI превысил лимит времени на этапе '+name+' ('+Math.round(timeoutMs/1000)+' сек)');
      throw e;
    }finally{clearTimeout(timer)}
    const txt=await r.text();
    let data;try{data=txt?JSON.parse(txt):{}}catch{data={raw:txt}}
    if(!r.ok)throw new Error(data?.error?.message||('OpenAI idea error '+r.status));
    const priced=openAIUsageCost(data?.model||model,data?.usage||{});
    if(priced.amountUsd>0)await recordExpense(accountId,{
      provider:'OpenAI',category:'idea',description:name==='idea_candidates'?'20 TikTok-концепций идеи':name==='hook_lab'?'Hook Lab · 5 хуков':'TikTok Creative Critic идеи',
      amountUsd:priced.amountUsd,model:data?.model||model,usage:priced.details,source:'auto'
    }).catch(()=>{});
    const parsed=safeAnalysisJson(openAIText(data));
    if(!parsed||typeof parsed!=='object')throw new Error('AI вернул некорректную структуру идеи');
    return parsed;
  }

  const context=[
    'Товар: '+String(payload.productName||payload.product?.name||'Товар'),
    'Категория: '+String(payload.product?.category||payload.category||''),
    'УТП: '+String(payload.productUtp||payload.product?.utp||''),
    'Правила товара: '+String(payload.productRules||payload.product?.rules||''),
    universalProductIdentityLock(payload),
    'Формат: 9:16',
    'Длительность: '+String(payload.duration||'30 сек'),
    'Стиль: '+String(payload.style||'UGC'),
    'Бриф: '+String(payload.brief||''),
    payload.character?.name?('Привязанный AI-аватар: '+String(payload.character.name)+'. Возраст/образ: '+String(payload.character.age||'')+'. Внешность: '+String(payload.character.look||'')+'. Манера речи: '+String(payload.character.voice||'')+'. Темы: '+String(payload.character.topics||'')+'. Locks: '+String(payload.character.locks||'')):'',
    'Недавние идеи, которые нельзя повторять: '+JSON.stringify(ctx.recent),
    'Паттерны из анализов конкурентов, если есть: '+JSON.stringify(ctx.analyses),
    'LEARNING LOOP — реальные результаты опубликованных роликов этого товара, если есть. Усиливай подтверждённые механики, но не копируй сюжет; слабые паттерны не повторяй: '+JSON.stringify(ctx.performance),
    feedback?('Комментарий пользователя к переделке: '+feedback):''
  ].filter(Boolean).join('\n');

  const generatorPrompt=[
    'ROLE: senior TikTok creative director + performance UGC director. Ты придумываешь не «рекламный ролик», а нативное короткое видео, которое должно остановить скролл и удержать зрителя.',
    'Сгенерируй РОВНО 20 принципиально разных концепций. Различаться должна МЕХАНИКА просмотра и причина досмотреть, а не только формулировка.',
    context,
    '',
    '20 FORMAT PATTERNS — используй каждый максимум один раз и укажи его в formatPattern:',
    '1) relatable fail / бытовой микро-провал;',
    '2) visual test / challenge / проверка в кадре;',
    '3) POV / личное признание / наблюдение;',
    '4) ответ на сомнение или типичный вопрос зрителя;',
    '5) open loop / загадка «что сейчас изменится?»;',
    '6) satisfying transformation / визуально приятное преобразование;',
    '7) A/B comparison с дополнительным поворотом, а не простое до/после;',
    '8) mini-story с 2–3 эскалациями;',
    '9) pattern interrupt / неожиданное действие или смена ожидания;',
    '10) loop/reveal — финал естественно возвращает к первому кадру или переосмысливает его;',
    '11) wrong-way / сначала намеренно неправильное бытовое действие → исправление;',
    '12) micro-experiment / маленький визуальный эксперимент с измеримым результатом без выдуманных цифр;',
    '13) split-decision / герой выбирает между двумя способами и быстро понимает разницу;',
    '14) silent visual comedy / понятный без слов микро-гэг вокруг бытовой боли;',
    '15) one-take discovery / ощущение случайного открытия в одном непрерывном действии;',
    '16) objection-first / начать с сомнения и доказать его действием;',
    '17) reverse reveal / показать результат первым, затем коротко раскрыть как к нему пришли;',
    '18) constraint challenge / решить задачу с ограничением по времени/пространству без фальшивых таймеров;',
    '19) tactile ASMR / визуально-тактильное действие и звук как основной retention;',
    '20) reaction-payoff / короткая естественная реакция после неожиданно наглядного результата.',
    '',
    'VIRAL-FIRST ПРАВИЛА:',
    '1. ПЕРВЫЙ КАДР 0–1 сек должен быть понятен без звука и останавливать палец: конкретное действие, ошибка, странность, конфликт, резкое следствие или визуальный вопрос. Никаких заставок, общего плана кухни, логотипа и «девушка стоит с товаром».',
    '2. К 2–3 секунде зритель должен понимать проблему/интригу, но ещё не знать весь ответ. Создай curiosity gap.',
    '3. Если есть первая реплика, она короткая и разговорная — обычно до 5–8 слов. Запрещён рекламный язык типа «Проверим этот удобный товар», «Идеальное решение», «Незаменимая вещь», «Наконец-то порядок».',
    '4. Каждые 2–4 секунды нужен новый beat: новое действие, реакция, ракурс, доказательство, микро-поворот или новая информация. Для 30 секунд — ориентир 7–10 осмысленных beats, а не растягивание одного теста.',
    '5. Обязательная структура удержания: SCROLL STOP → OPEN LOOP → ESCALATION → PRODUCT ACTION → PROOF → SECOND PROOF/TWIST → VISUAL PAYOFF. Можно менять порядок, но нельзя выкидывать удержание и доказательство.',
    '6. Не делай примитивное «проблема → показали товар → конец». После первого решения обязательно нужен второй proof/beat или неожиданный payoff.',
    '7. Товар должен физически участвовать в результате. Если товар можно убрать и ролик почти не изменится — концепцию считай провальной.',
    '8. Один ролик = одна главная мысль. Не перечисляй 5 преимуществ. Доказательство важнее обещания.',
    '9. Нативность TikTok: живая бытовая ситуация, близкие планы, руки/реакции, телефонная динамика, jump-cut или match action — только когда это помогает истории. Не превращай всё в стерильную студийную рекламу.',
    '10. Герой ведёт себя как реальный человек, а не телеведущий. Реплики звучат как бытовая речь. Лучше реакция/действие, чем объяснение того, что зритель уже видит.',
    '11. Не используй фальшивый кликбейт, выдуманные отзывы, fake comments, «вы не поверите», ложные скидки, опасные тесты и неподтверждённые обещания.',
    '12. Финальный payoff должен быть визуальным. CTA максимум короткий и после результата. Если уместно — сделай естественный loop, чтобы финальный кадр подталкивал пересмотреть начало.',
    '13. AUDIO PLAN: звук начинается осознанно с первых 0–2 секунд — реплика, естественный бытовой звук или SFX. Не планируй случайные длинные участки полной тишины. Ролик при этом обязан работать и без звука.',
    '14. FACT LOCK: не придумывай способ крепления, размеры, материал, прочность и другие свойства, если их нет в УТП/правилах/брифе. Фото подтверждает внешний вид, а не скрытые характеристики.',
    '15. Если к товару привязан AI-аватар — используй именно его, когда нужен человек. Сохраняй внешность, голос и характер; не заменяй случайной моделью.',
    '16. Концепция должна быть реально генерируема покадрово: без невозможной физики, толпы, сложных рук, чрезмерных проливов/разрушений и длинного читаемого текста.',
    '17. Используй анализы конкурентов только как источник ПАТТЕРНОВ удержания. Не копируй чужой сюжет, формулировки и визуальную последовательность.',
    '18. Недавние идеи для этого товара не повторяй. Если механика уже использовалась — придумай другую причину досмотреть.',
    '19. ВТОРОЕ ДОКАЗАТЕЛЬСТВО должно быть визуально и физически другим, а не тем же действием с другим предметом в руке. Меняй контекст, цель действия, масштаб, реакцию или последствие.',
    '20. Не придумывай комментарии зрителей, отзывы, реакции покупателей, цифры продаж и социальные доказательства, которых нет во входных данных.',
    '21. Запрещены мета-реплики ведущего вроде «сейчас покажу», «сейчас повторю», «давайте проверим», если без них история понятна. Герой реагирует как живой человек, а не объясняет структуру ролика.',
    '22. В каждой концепции должен быть хотя бы один social-native момент: узнаваемый микро-провал, неожиданное визуальное следствие, короткая эмоция или satisfying-результат, которым хочется поделиться/пересмотреть.',
    '23. Payoff — действие или видимый результат, а не статичный beauty-shot товара. Финальные 2–3 секунды должны оставаться частью истории.',
    '',
    'СЕЙЧАС НУЖНЫ ТОЛЬКО КОРОТКИЕ КАНДИДАТЫ — не расписывай полный сценарий.',
    'Для каждой концепции заполни: title, formatPattern, hook, concept, mechanic, payoff.',
    'Каждое поле — максимум 1–3 коротких предложения. Полную проработку сделает Creative Critic после отбора.',
    'Не повторяй одну и ту же механику под разными названиями.'
  ].join('\n');

  await markIdeaProgress(4,'Генерирую 20 разных механик');
  const candidateData=await callIdeaAI({
    prompt:generatorPrompt,schema:candidateSchema,name:'idea_candidates',images:refs
  });
  const candidates=Array.isArray(candidateData?.candidates)?candidateData.candidates:[];
  if(candidates.length!==20)throw new Error('Генератор идеи вернул не 20 концепций');
  await markIdeaProgress(5,'Creative Critic выбирает и усиливает лучшую');

  const criticBase=[
    'ROLE: TikTok Creative Critic + retention editor. Ты отбираешь идею так, будто решаешь, переживёт ли она первые секунды в реальной ленте.',
    'Сначала безжалостно отсей слабые и рекламные варианты из 20 кандидатов. Затем возьми сильные элементы 2–3 лучших и собери ОДНУ финальную концепцию. Не обязан сохранять победителя как есть.',
    'ВНУТРИ ОДНОГО ОТВЕТА проведи ДВЕ независимые проверки финала: (1) TikTok retention editor — хук, curiosity gap, темп, shareability; (2) AI-production director — FACT LOCK, естественность героя, разнообразие proof и генерируемость. После обеих проверок молча исправь найденные слабости и только затем верни результат.',
    context,
    '',
    'КАНДИДАТЫ:',
    JSON.stringify(candidates),
    '',
    'ОЦЕНИВАЙ финальную усиленную идею по шкале 1–10:',
    'hook, scrollStop, curiosityGap, retention, pacing, nativeTikTok, dialogueNaturalness, humanNaturalness, proofVariety, shareability, loopPotential, productNecessity, visualClarity, originality, avatarFit, generatability, payoff, factualSafety, conversionPotential, overall.',
    '',
    'КАЛИБРОВКА ОЦЕНОК:',
    '- 9–10 ставь только если качество реально исключительное; не завышай оценки, чтобы пройти фильтр;',
    '- если первый кадр похож на обычную рекламу — scrollStop максимум 6;',
    '- если реплика звучит как копирайтинг/презентация — dialogueNaturalness максимум 6;',
    '- если 30 секунд держатся на одном действии — pacing/retention максимум 6;',
    '- если ролик можно понять как «показали товар и перечислили плюсы» — nativeTikTok максимум 5;',
    '- если товар можно заменить любым похожим предметом без потери сюжета — productNecessity максимум 6.',
    '- если второе/третье доказательство повторяет тот же жест и отличается только реквизитом — proofVariety максимум 6;',
    '- если герой проговаривает монтажную механику («сейчас покажу/повторю/проверю») вместо естественной реакции — humanNaturalness максимум 6;',
    '- если ролик полезный, но в нём нет ни одного узнаваемого/удивляющего/satisfying момента — shareability максимум 6.',
    '',
    'КРИТИЧЕСКИЙ ПОРОГ >=8:',
    'scrollStop, curiosityGap, retention, pacing, nativeTikTok, dialogueNaturalness, humanNaturalness, proofVariety, shareability, productNecessity, originality и generatability.',
    '',
    'АНТИСКУКА — ФИНАЛ НЕ ПРОХОДИТ, ЕСЛИ:',
    '- первые 1–2 сек можно вырезать без потери ролика;',
    '- первая реплика универсальна и могла бы рекламировать любой товар;',
    '- товар раскрывается как «вот наш продукт», а не через действие;',
    '- после reveal ничего нового не происходит;',
    '- нет второго proof/twist;',
    '- герой объясняет словами то, что уже видно;',
    '- ролик выглядит как карточка маркетплейса, перенесённая в видео;',
    '- есть длинный статичный beauty-shot вместо события;',
    '- второй proof фактически повторяет первый тем же движением;',
    '- герой объясняет зрителю структуру видео вместо естественной реакции;',
    '- финал — только CTA/логотип без визуального результата.',
    '',
    'ТАЙМИНГ ДЛЯ 25–35 СЕК:',
    '- 0–1 сек: scroll stop;',
    '- 1–3 сек: вопрос/проблема/open loop;',
    '- 3–8 сек: эскалация и первый reveal/action;',
    '- 8–18 сек: доказательство + новый beat;',
    '- 18–25 сек: второй proof/twist или усиление результата;',
    '- последние секунды: visual payoff + короткий CTA/loop.',
    'Если длительность другая — масштабируй структуру пропорционально.',
    '',
    'АУДИО:',
    '- не допускай случайного «голос только в середине»;',
    '- первые 0–2 сек имеют осмысленный звук/реплику/SFX или намеренную визуальную тишину;',
    '- далее звук/атмосфера/речь имеют непрерывную драматургическую логику;',
    '- реплики короткие, бытовые, без дикторской канцелярщины.',
    '',
    'ФИНАЛЬНАЯ ИДЕЯ ОБЯЗАТЕЛЬНО:',
    '- выглядит как TikTok/Reels-контент, а не классическая реклама;',
    '- имеет конкретный scroll-stop кадр;',
    '- создаёт curiosity gap;',
    '- меняет beat каждые несколько секунд;',
    '- имеет минимум два визуальных доказательства/поворота;',
    '- использует товар как необходимую часть действия;',
    '- органично использует привязанного аватара;',
    '- сохраняет FACT LOCK и внешний вид товара;',
    '- реально генерируема нейросетями с устойчивой continuity;',
    '- заканчивается сильным визуальным payoff; loop желателен, но не должен быть натянут.',
    '',
    'В поле why кратко объясни, почему зритель не свайпнет и почему досмотрит. Не пересказывай весь процесс выбора.',
    'Каждая из 4 альтернатив должна быть ПОЛНОЙ самостоятельной идеей, а не короткой заметкой: audience, first3Seconds, mechanic, productRole, retention, payoff, ctaDirection, production, why и собственная quality-оценка должны относиться именно к этой механике, а не копироваться из selected.',
    'Верни 1 финальную усиленную идею + 4 действительно разные полностью заполненные альтернативы + честные оценки quality.'
  ].join('\n');

  async function criticPass(prompt){
    let out=await callIdeaAI({prompt,schema:finalSchema,name:'idea_critic',images:[]});
    let idea=normalizeIdeaStage(out,payload);
    idea.quality=out.quality||{};
    let complete=ideaStageComplete(idea);
    if(!complete.ok){
      const repair=[
        prompt,
        '',
        'ТЕХНИЧЕСКАЯ ПРОВЕРКА ФОРМЫ: предыдущий ответ оказался неполным.',
        'Предыдущий ответ: '+JSON.stringify(out),
        'Пустые обязательные поля: '+complete.missing.join(', ')+(complete.badAlt?' · альтернативы неполные':'')+'.',
        'Верни полный объект по той же схеме. КАЖДОЕ текстовое поле selected и всех 4 alternatives должно быть непустым; у каждой alternative должны быть собственные retention/payoff/production/why и quality, а не копии selected.',
        'Если отдельный CTA не нужен, ctaDirection всё равно заполни формулировкой «без отдельного CTA; финал через визуальный payoff».',
        'Не сокращай и не удаляй поля ради экономии токенов.'
      ].join('\n');
      out=await callIdeaAI({prompt:repair,schema:finalSchema,name:'idea_critic',images:[]});
      idea=normalizeIdeaStage(out,payload);
      idea.quality=out.quality||{};
      complete=ideaStageComplete(idea);
    }
    if(!complete.ok)throw new Error('Creative Critic вернул неполную идею: '+complete.missing.join(', ')+(complete.badAlt?' · alternatives':''));
    return idea;
  }

  let idea=await criticPass(criticBase);
  await markIdeaProgress(7,'Проверяю вирусность и производственную реализуемость');
  const criticalKeys=['scrollStop','curiosityGap','retention','pacing','nativeTikTok','dialogueNaturalness','humanNaturalness','proofVariety','shareability','productNecessity','originality','generatability'];
  const failed=()=>criticalKeys.filter(k=>Number(idea?.quality?.[k]||0)<8);
  const textCheck=[idea.hook,idea.first3Seconds,idea.concept,idea.retention,idea.payoff,idea.ctaDirection].join(' ');
  const heuristicIssues=[];
  if(/сейчас\s+(покаж|провер|повтор)|давайте\s+(провер|посмотр)/i.test(textCheck))heuristicIssues.push('мета-реплика вместо естественной реакции');
  if(/beauty[- ]?shot|бьюти[- ]?шот/i.test(String(idea.payoff||'')))heuristicIssues.push('финал уходит в beauty-shot');
  if(failed().length||heuristicIssues.length){
    await markIdeaProgress(7,'Докручиваю слабые места');
    const repairPrompt=[
      criticBase,
      '',
      'ФИНАЛЬНАЯ ДОКРУТКА НУЖНА ТОЛЬКО ПО ПРОБЛЕМАМ:',
      'Текущая версия: '+JSON.stringify({selected:idea,quality:idea.quality}),
      failed().length?('Критерии ниже 8: '+failed().join(', ')):'',
      heuristicIssues.length?('Структурные замечания: '+heuristicIssues.join('; ')):'',
      'Исправь эти проблемы глубоко, но не меняй товар, FACT LOCK и привязанного аватара. Верни полную финальную идею + 4 альтернативы + честные quality scores.'
    ].filter(Boolean).join('\n');
    idea=await criticPass(repairPrompt);
  }
  const finalFailed=failed();
  if(finalFailed.length){
    throw new Error('Идея не прошла Creative Critic: '+finalFailed.join(', ')+' ниже 8/10');
  }

  await markIdeaProgress(7.5,'Hook Lab: тестирую 5 разных первых 3 секунд');
  const hookLabSchema={
    type:'object',additionalProperties:false,required:['variants','selectedIndex','selectionReason'],
    properties:{
      variants:{
        type:'array',minItems:5,maxItems:5,
        items:{
          type:'object',additionalProperties:false,
          required:['type','firstFrame','action','line','audio','openLoop','why'],
          properties:{
            type:{type:'string'},firstFrame:{type:'string'},action:{type:'string'},
            line:{type:'string'},audio:{type:'string'},openLoop:{type:'string'},why:{type:'string'}
          }
        }
      },
      selectedIndex:{type:'integer',minimum:1,maximum:5},
      selectionReason:{type:'string'}
    }
  };
  const hookPrompt=[
    'ROLE: Hook Lab director for TikTok/Reels/Shorts.',
    context,
    'Approved concept: '+JSON.stringify(idea),
    'Create EXACTLY 5 radically different first-3-second executions for the SAME approved concept.',
    'Each must start with a different visual mechanism, not just different wording.',
    'Use these five families once each: visual fail/conflict; unexpected action; result-first/reverse reveal; POV/reaction; tactile/satisfying detail.',
    'The first frame must stop scroll without sound. Spoken line, if any, max 3–8 natural words.',
    'No logos, intro cards, generic product holding, fake comments, fake numbers or ad-copy language.',
    'Respect Product DNA and source-product identity lock. If a hook requires changing the real product, change the hook instead.',
    'Choose selectedIndex for the hook most likely to create curiosity while remaining easy to generate accurately.',
    'Return JSON only.'
  ].join('\n');
  try{
    const hookLab=await callIdeaAI({prompt:hookPrompt,schema:hookLabSchema,name:'hook_lab',images:refs});
    const variants=Array.isArray(hookLab?.variants)?hookLab.variants:[];
    const selectedIndex=Math.max(1,Math.min(5,Number(hookLab?.selectedIndex)||1));
    idea.hookLab={variants,selectedIndex,selectionReason:String(hookLab?.selectionReason||''),generatedAt:new Date().toISOString()};
    const hookPreviewRefs=[...productRefs.slice(0,2),avatarRefs[0]].filter(Boolean);
    for(let i=0;i<variants.length;i++){
      const h=variants[i]||{};
      try{
        const frame={
          scene:0,frame:i+1,frameType:'start',hookLab:true,productInFrame:true,
          action:String(h.action||''),composition:String(h.firstFrame||''),
          framing:'vertical 9:16 scroll-stop close/medium composition',
          environment:'natural believable environment for the approved concept',
          lighting:'realistic social-video lighting',
          avatarInFrame:Boolean(payload.character),
          avatarDescription:payload.character?String(payload.character.look||payload.character.name||''):'',
          productPlacement:'Product must remain the exact source product while supporting the hook action.',
          continuityNotes:'Hook Lab preview only; preserve exact product/avatar identity.',
          imagePromptEn:[
            'TikTok/Reels first-frame scroll stopper.',
            'Visual hook type: '+String(h.type||''),
            'First frame: '+String(h.firstFrame||''),
            'Action beginning: '+String(h.action||''),
            'Open loop: '+String(h.openLoop||''),
            'Natural UGC, immediately readable without sound.'
          ].join(' ')
        };
        const preview=await generateOpenAIPrevisImage(accountId,payload,frame,hookPreviewRefs);
        h.previewUrl=preview?.url||'';
        h.previewPath=preview?.path||'';
        h.previewModel=preview?.model||'gpt-image-2';
      }catch(e){
        h.previewError=String(e?.message||e).slice(0,500);
      }
    }
    idea.hookLab.variants=variants;
    const selectedHook=variants[selectedIndex-1];
    if(selectedHook){
      idea.hook=[selectedHook.firstFrame,selectedHook.line].filter(Boolean).join(' · ').slice(0,2000);
      idea.first3Seconds=[selectedHook.firstFrame,selectedHook.action,selectedHook.line,selectedHook.audio,selectedHook.openLoop].filter(Boolean).join(' | ').slice(0,3000);
    }
  }catch(e){
    idea.hookLab={variants:[],selectedIndex:1,selectionReason:'Hook Lab временно недоступен: '+String(e?.message||e),generatedAt:new Date().toISOString()};
  }

  await markIdeaProgress(8,'Идея и Hook Lab готовы');
  idea.creativeProcess={
    generatedCandidates:20,
    critic:true,
    criticPasses:failed().length||heuristicIssues.length?2:1,
    refined:true,
    criticalThreshold:8,
    evaluatedAt:new Date().toISOString()
  };
  return idea;
}

function scenarioTargetCount(payload={}){
  const seconds=Number(String(payload.duration||'30').match(/\d+/)?.[0]||30);
  return Math.max(5,Math.min(10,Math.round(seconds/4)));
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
    productRole:String(x?.productRole||'').slice(0,2500),
    retentionMechanic:String(x?.retentionMechanic||'').slice(0,1800),
    openLoop:String(x?.openLoop||'').slice(0,1800),
    patternInterrupt:String(x?.patternInterrupt||'').slice(0,1800),
    visualContrast:String(x?.visualContrast||'').slice(0,1800),
    microConflict:String(x?.microConflict||'').slice(0,1800),
    microPayoff:String(x?.microPayoff||'').slice(0,1800),
    environmentStory:String(x?.environmentStory||'').slice(0,3000),
    performanceBeat:String(x?.performanceBeat||'').slice(0,2200),
    soundBridge:String(x?.soundBridge||'').slice(0,1800),
    nextQuestion:String(x?.nextQuestion||'').slice(0,1800)
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
    quality:src.quality&&typeof src.quality==='object'?src.quality:{},
    reviewProcess:src.reviewProcess&&typeof src.reviewProcess==='object'?src.reviewProcess:null,
    scenes
  };
}
function scriptStageComplete(script){
  const required=['title','logline','hook','structure','cta','tone','duration','globalContinuity','subtitleRules','productRules'];
  const missing=required.filter(k=>!String(script?.[k]||'').trim());
  const scenes=Array.isArray(script?.scenes)?script.scenes:[];
  const badScenes=scenes.length<5||scenes.some((x,i)=>{
    const fields=['time','purpose','visual','action','sound','continuity','productRole','retentionMechanic','openLoop','patternInterrupt','visualContrast','microConflict','microPayoff','environmentStory','performanceBeat','soundBridge','nextQuestion'];
    return fields.some(k=>!String(x?.[k]||'').trim())||Number(x?.scene||0)!==i+1;
  });
  return {ok:missing.length===0&&!badScenes,missing,badScenes};
}
async function generateScriptStage(payload,accountId,feedback=''){
  if(!openaiConfigured())throw new Error('OpenAI API is not configured');
  const idea=normalizeIdeaStage(payload.idea||{},payload);
  if(!idea.title&&!idea.concept)throw new Error('Сначала нужна утверждённая идея');
  const target=scenarioTargetCount(payload);
  const ctx=await recentIdeaContext(accountId,payload.productId||payload.product?.id);
  const productRefs=(payload.media||payload.product?.media||[]).map(x=>x?.url).filter(x=>/^https:\/\//i.test(String(x||'')));
  const avatarRefs=(payload.avatarReferences||payload.character?.media||[]).map(x=>x?.url).filter(x=>/^https:\/\//i.test(String(x||'')));
  const refs=[productRefs[0],avatarRefs[0]].filter(Boolean);
  const model=process.env.OPENAI_MODEL||'gpt-6-astra';
  async function markScriptProgress(progress,step){
    if(!payload?.id)return;
    try{
      const state=await readAppState(accountId),data=state?.data||blankFactoryState(),run=findRunById(data,payload.id);
      if(!run||run.stage!=='Сценарий')return;
      run.progress=Math.max(Number(run.progress)||0,Number(progress)||0);
      run.backgroundTask={...(run.backgroundTask||{}),step:String(step||''),heartbeatAt:new Date().toISOString()};
      run.updatedAt=new Date().toISOString();
      await writeAppState(data,accountId);
    }catch{}
  }

  const sceneProperties={
    scene:{type:'integer',minimum:1,maximum:10},
    time:{type:'string'},
    purpose:{type:'string'},
    visual:{type:'string'},
    action:{type:'string'},
    dialogue:{type:'string'},
    voiceover:{type:'string'},
    onscreen:{type:'string'},
    sound:{type:'string'},
    transition:{type:'string'},
    continuity:{type:'string'},
    productRole:{type:'string'},
    retentionMechanic:{type:'string'},
    openLoop:{type:'string'},
    patternInterrupt:{type:'string'},
    visualContrast:{type:'string'},
    microConflict:{type:'string'},
    microPayoff:{type:'string'},
    environmentStory:{type:'string'},
    performanceBeat:{type:'string'},
    soundBridge:{type:'string'},
    nextQuestion:{type:'string'}
  };
  const characterProperties={
    name:{type:'string'},role:{type:'string'},look:{type:'string'},voice:{type:'string'},locks:{type:'string'}
  };
  const scriptObjectSchema={
    type:'object',additionalProperties:false,
    required:['title','logline','hook','structure','cta','tone','duration','characters','globalContinuity','subtitleRules','productRules','scenes'],
    properties:{
      title:{type:'string'},logline:{type:'string'},hook:{type:'string'},structure:{type:'string'},
      cta:{type:'string'},tone:{type:'string'},duration:{type:'string'},
      characters:{type:'array',maxItems:4,items:{type:'object',additionalProperties:false,required:['name','role','look','voice','locks'],properties:characterProperties}},
      globalContinuity:{type:'string'},subtitleRules:{type:'string'},productRules:{type:'string'},
      scenes:{type:'array',minItems:5,maxItems:10,items:{type:'object',additionalProperties:false,required:Object.keys(sceneProperties),properties:sceneProperties}}
    }
  };
  const draftSchema={
    type:'object',additionalProperties:false,required:['script'],
    properties:{script:scriptObjectSchema}
  };
  const scoreProperties={
    scrollStop:{type:'integer',minimum:1,maximum:10},
    curiosityGap:{type:'integer',minimum:1,maximum:10},
    retention:{type:'integer',minimum:1,maximum:10},
    pacing:{type:'integer',minimum:1,maximum:10},
    nativeTikTok:{type:'integer',minimum:1,maximum:10},
    dialogueNaturalness:{type:'integer',minimum:1,maximum:10},
    hookSpecificity:{type:'integer',minimum:1,maximum:10},
    beatVariety:{type:'integer',minimum:1,maximum:10},
    proofVariety:{type:'integer',minimum:1,maximum:10},
    speechEconomy:{type:'integer',minimum:1,maximum:10},
    visualStorytelling:{type:'integer',minimum:1,maximum:10},
    productIntegration:{type:'integer',minimum:1,maximum:10},
    audioPlan:{type:'integer',minimum:1,maximum:10},
    continuity:{type:'integer',minimum:1,maximum:10},
    factualSafety:{type:'integer',minimum:1,maximum:10},
    generatability:{type:'integer',minimum:1,maximum:10},
    payoff:{type:'integer',minimum:1,maximum:10},
    sceneDensity:{type:'integer',minimum:1,maximum:10},
    patternInterruptQuality:{type:'integer',minimum:1,maximum:10},
    environmentSpecificity:{type:'integer',minimum:1,maximum:10},
    visualContrast:{type:'integer',minimum:1,maximum:10},
    microPayoffCadence:{type:'integer',minimum:1,maximum:10},
    overall:{type:'integer',minimum:1,maximum:10}
  };
  const reviewSchema={
    type:'object',additionalProperties:false,required:['scores','issues','changes','script'],
    properties:{
      scores:{type:'object',additionalProperties:false,required:Object.keys(scoreProperties),properties:scoreProperties},
      issues:{type:'array',maxItems:12,items:{type:'string'}},
      changes:{type:'array',maxItems:12,items:{type:'string'}},
      script:scriptObjectSchema
    }
  };

  async function callScriptAI({prompt,schema,name,images=[],effort='high'}){
    const input=[{role:'user',content:[
      {type:'input_text',text:prompt},
      ...images.map(url=>({type:'input_image',image_url:String(url),detail:'low'}))
    ]}];
    const controller=new AbortController();
    const timeoutMs=name==='script_draft'?90000:(String(name).startsWith('script_review_')?105000:90000);
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    let r;
    try{
      r=await fetch('https://api.openai.com/v1/responses',{
        method:'POST',
        signal:controller.signal,
        headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'content-type':'application/json'},
        body:JSON.stringify({
          model,input,reasoning:{effort},max_output_tokens:name==='script_draft'?7000:6500,
          text:{format:{type:'json_schema',name,strict:true,schema}}
        })
      });
    }catch(e){
      if(e?.name==='AbortError')throw new Error('OpenAI превысил лимит времени на этапе '+name+' ('+Math.round(timeoutMs/1000)+' сек)');
      throw e;
    }finally{clearTimeout(timer)}
    const txt=await r.text();
    let data;try{data=txt?JSON.parse(txt):{}}catch{data={raw:txt}}
    if(!r.ok)throw new Error(data?.error?.message||('OpenAI script error '+r.status));
    const priced=openAIUsageCost(data?.model||model,data?.usage||{});
    if(priced.amountUsd>0)await recordExpense(accountId,{
      provider:'OpenAI',category:'script',
      description:name==='script_draft'?'Черновик сценария':'AI-проверка и докрутка сценария',
      amountUsd:priced.amountUsd,model:data?.model||model,usage:priced.details,source:'auto'
    }).catch(()=>{});
    const parsed=safeAnalysisJson(openAIText(data));
    if(!parsed||typeof parsed!=='object')throw new Error('AI вернул некорректную структуру сценария');
    return parsed;
  }

  async function callScriptAIResilient(args){
    try{
      return await callScriptAI(args);
    }catch(e){
      const message=String(e?.message||e);
      if(!/превысил лимит времени/i.test(message))throw e;
      await markScriptProgress(15,'OpenAI отвечает долго — повторяю этап в более лёгком режиме');
      return await callScriptAI({...args,effort:'medium'});
    }
  }

  const context=[
    'УТВЕРЖДЁННАЯ ИДЕЯ: '+JSON.stringify(idea),
    'Товар: '+String(payload.productName||payload.product?.name||'Товар'),
    'Категория: '+String(payload.product?.category||payload.category||''),
    'УТП: '+String(payload.productUtp||payload.product?.utp||''),
    'Факты/ограничения товара: '+String(payload.productRules||payload.product?.rules||''),
    universalProductIdentityLock(payload),
    'Длительность: '+String(payload.duration||'30 сек'),
    'Формат: вертикальный 9:16',
    'Стиль: '+String(payload.style||'UGC'),
    'Бриф пользователя: '+String(payload.brief||''),
    payload.character?.name?('Привязанный AI-аватар: '+String(payload.character.name)+'. Возраст/образ: '+String(payload.character.age||'')+'. Внешность: '+String(payload.character.look||'')+'. Голос: '+String(payload.character.voice||'')+'. Темы: '+String(payload.character.topics||'')+'. Locks: '+String(payload.character.locks||'')):'',
    'Разборы конкурентов — только структурные паттерны, не копировать: '+JSON.stringify(ctx.analyses),
    feedback?('Комментарий пользователя к переделке: '+feedback):''
  ].filter(Boolean).join('\n');

  const master=[
    'ROLE: senior TikTok showrunner, сценарист, retention editor и режиссёр AI-видео.',
    'Идея уже утверждена. Нельзя менять её ключевую механику, обещание, товар или героя. Можно и нужно радикально улучшать ИСПОЛНЕНИЕ: темп, порядок beats, хук, реплики, доказательства, переходы, payoff и звук.',
    context,
    '',
    'ЦЕЛЬ: написать сценарий, который выглядит как нативный TikTok/Reels/Shorts, а не как карточка маркетплейса в видео.',
    'Ориентир для этой длительности: около '+target+' коротких сцен/beats. Каждая сцена должна добавлять новое действие, информацию, реакцию или доказательство.',
    '',
    'VIRAL SHORT-FORM PLAYBOOK — применять как набор механик, а не как шаблон один-в-один:',
    '- TikTok-first: ощущение нативного контента, а не рекламного ролика. Человек/быт/ошибка/действие раньше рекламной формулировки.',
    '- Первые 0–2 сек: движение, эмоция, визуальный конфликт, необычный предметный state или результат ДО объяснения. Начинать можно mid-action/mid-sentence, если это естественно.',
    '- Hook должен одновременно обещать ценность и оставлять информационный пробел. Не раскрывай весь ответ в первой фразе.',
    '- Используй micro open loops: каждый beat отвечает на один вопрос и тут же создаёт следующий маленький вопрос.',
    '- Pattern interrupt каждые 2–4 сек, но осмысленный: смена масштаба, направления движения, POV, эмоции, контекста, звука или состояния предмета. Не делай эффект ради эффекта.',
    '- Чередуй tension → proof → reaction → escalation → payoff. Не делай линейное «показали товар → перечислили преимущества».',
    '- Результат можно показать рано, но объяснение/механика раскрывается позже. Reverse reveal, wrong-way/right-way, before/after, tactile ASMR, POV, objection-first, mini-experiment, relatable fail, reaction payoff — использовать как разные семейства.',
    '- В ролике должна быть хотя бы одна физически наглядная micro-proof и хотя бы один эмоциональный/reaction beat, если герой присутствует.',
    '- Используй visual contrast между соседними сценами: macro→medium, static→motion, clean→messy, problem→solution, hand POV→face reaction и т.п.',
    '- Sound design участвует в retention: J-cut/sound bridge перед склейкой, короткий impact/foley на действие, иногда 0.2–0.5 сек намеренной тишины перед reveal. Без постоянных бессмысленных whoosh.',
    '- Финал = payoff/результат/реакция, который естественно может вернуть к первому кадру. CTA короткий и не убивает entertainment.',
    '- Никаких неподтверждённых «вирусный», «миллионы купили», рейтингов, цифр и social proof без данных.',
    '',
    'ЖЁСТКАЯ ДРАМАТУРГИЯ:',
    '1) 0–1 сек — scroll-stop: конкретное действие/ошибка/неожиданность, понятные без звука.',
    '2) К 2–3 сек — open loop: зритель понимает проблему, но ещё хочет увидеть решение/результат.',
    '3) Каждые 2–4 секунды — новый beat. Не растягивай одно действие на 6–8 секунд, если внутри ничего не меняется.',
    '4) Reveal товара происходит через действие, а не через «вот наш товар».',
    '5) После первого доказательства обязательно второй proof, twist, новый бытовой контекст или усиление результата.',
    '6) Последние секунды — визуальный payoff. Beauty-shot максимум короткий; CTA не должен съедать финал.',
    '7) По возможности финальный кадр создаёт естественный loop к первому, но не натягивай его.',
    '7a) Для 25–35 секунд хотя бы 2 ключевых proof/beats должны быть РАЗНЫМИ по действию или результату; одинаковый жест с миской/лопаткой/тарелкой считается одним и тем же proof.',
    '',
    'РЕЧЬ И ЗВУК:',
    '8) Реплики короткие, бытовые, живые. Никаких «Проверим один и тот же жест», «идеальное решение», «организуйте пространство» и другого рекламного канцелярита.',
    '9) Не проговаривай то, что зритель уже видит. Голос должен добавлять эмоцию, контекст, вопрос или вывод.',
    '10) Первая реплика, если есть, обычно 3–8 слов. Текст обязан помещаться в тайминг.',
    '11) Экранный текст не дублирует длинную озвучку. Короткая фраза — максимум одна мысль.',
    '12) Звук начинается осознанно с первых 0–2 сек: голос, бытовой звук или SFX. Не допускай случайной тишины и ситуации, когда голос появляется только в середине ролика.',
    '13) Для ролика 25–35 секунд, если выбран голосовой формат, распределяй речь минимум по 3 смысловым точкам: начало, развитие, payoff.',
    '13a) Не используй мета-реплики «сейчас покажу», «сейчас повторю», «давайте проверим». Если зритель видит действие, герой не должен объяснять монтажную механику.',
    '13b) Не повторяй один и тот же proof 3 раза с разным реквизитом. После первого доказательства второй beat должен отличаться целью действия, контекстом или визуальным последствием.',
    '',
    'AI-ГЕНЕРИРУЕМОСТЬ И CONTINUITY:',
    '14) Одна сцена = одно главное физическое действие. Избегай сложной хореографии рук, невозможной физики, толпы, большого пролива и мелкого читаемого текста.',
    '15) Товар, рулон, герой, одежда, кухня и освещение должны сохраняться. В continuity каждой сцены укажи только реально важные locks.',
    '16) FACT LOCK: запрещено придумывать материал, размеры, прочность, способ крепления/установки и скрытые функции. Фото подтверждают только внешний вид.',
    '17) Если способ крепления товара не подтверждён, НЕ показывай и НЕ описывай выдуманное крепление. Используй нейтральный ракурс/размещение, подтверждаемое референсом.',
    '18) Привязанный аватар нельзя заменять другим человеком. Его образ и манера речи сохраняются.',
    '',
    'СТРУКТУРА СЦЕН:',
    'Для каждой сцены заполни time, purpose, visual, action, dialogue, voiceover, onscreen, sound, transition, continuity, productRole, retentionMechanic, openLoop, patternInterrupt, visualContrast, microConflict, microPayoff, environmentStory, performanceBeat, soundBridge, nextQuestion.',
    'visual = что реально видит зритель с конкретной композицией и изменением состояния; action = последовательность одного главного действия; purpose = зачем сцена нужна удержанию.',
    'environmentStory = очень конкретная бытовая среда: тип комнаты/зоны, мебель, материалы поверхностей, 3–6 правдоподобных предметов, признаки жизни, время суток/состояние пространства. Не используй абстракции вроде «современная кухня».',
    'performanceBeat = точная микро-игра героя: взгляд, дыхание, выражение, направление внимания, движение плеч/рук, реакция; без театральности.',
    'retentionMechanic/openLoop/nextQuestion должны объяснять, почему зритель остаётся на следующий beat. patternInterrupt — конкретно ЧТО меняется в восприятии кадра.',
    'visualContrast должен быть сформулирован относительно предыдущего beat. microConflict = маленькое трение/проблема/сомнение внутри сцены. microPayoff = что именно зритель получает к концу beat.',
    'soundBridge = какой звук начинается до склейки или продолжается после неё, чтобы монтаж ощущался связным и ритмичным.',
    'dialogue — только синхронная реплика героя в кадре; voiceover — только закадровая речь.',
    'transition должен быть мотивирован действием. Не вставляй модный переход просто ради эффекта.',
    'productRole объясняет, зачем товар нужен именно в этой сцене, без выдуманных свойств.',
    '',
    'SAFE ZONE: важный текст — в центральной области 9:16; не у правого края и не в самом низу.',
    'Тайминги обязаны непрерывно покрывать всю длительность без дыр и пересечений.',
    '',
    'Перед ответом внутренне проверь: scroll-stop, open loop, смену beats, второй proof/twist, естественность речи, звук с начала, FACT LOCK, continuity, тайминг и финальный payoff. Не показывай внутренние рассуждения.'
  ].join('\n');

  await markScriptProgress(13,'Пишу черновик сценария');
  let draftData=await callScriptAIResilient({prompt:master,schema:draftSchema,name:'script_draft',images:refs,effort:'high'});
  let script=normalizeScriptStage(draftData,payload);
  let complete=scriptStageComplete(script);
  if(!complete.ok){
    await markScriptProgress(14,'Автоматически дополняю черновик');
    const repairDraftPrompt=[
      master,
      '',
      'ТЕХНИЧЕСКИЙ REPAIR. Предыдущий черновик вернулся неполным.',
      'Текущий черновик: '+JSON.stringify(script),
      complete.missing.length?('Пустые обязательные поля верхнего уровня: '+complete.missing.join(', ')+'.'):'',
      complete.badScenes?'Есть неполные сцены или меньше 5 сцен.':'',
      'Не меняй утверждённую идею. Сохрани сильные части черновика и ДОПОЛНИ всё недостающее.',
      'Каждая сцена обязана иметь непустые time, purpose, visual, action, sound, continuity, productRole, retentionMechanic, openLoop, patternInterrupt, visualContrast, microConflict, microPayoff, environmentStory, performanceBeat, soundBridge, nextQuestion.',
      'dialogue, voiceover и onscreen могут быть пустыми только если они реально не нужны в конкретной сцене.',
      'Нумерация сцен строго 1..N, тайминги непрерывны, 5–10 сцен.',
      'Если отдельный CTA не нужен, поле cta заполни: «Без отдельного CTA — финал через визуальный payoff».',
      'Верни полный script по схеме.'
    ].filter(Boolean).join('\n');
    draftData=await callScriptAIResilient({prompt:repairDraftPrompt,schema:draftSchema,name:'script_draft_repair',images:[],effort:'medium'});
    script=normalizeScriptStage(draftData,payload);
    complete=scriptStageComplete(script);
  }
  if(!complete.ok)throw new Error('Черновик сценария не удалось автоматически восстановить: '+complete.missing.join(', ')+(complete.badScenes?' · неполные сцены':''));
  await markScriptProgress(15,'Черновик готов — запускаю проверки');

  const reviewRoles=[
    {
      name:'retention',
      role:'Ты TikTok retention editor. Ищи места, где зритель свайпнет: слабый первый кадр, отсутствие curiosity gap, длинные сцены без нового beat, раннее раскрытие всего решения, повторяющиеся доказательства, затянутый CTA.',
      focus:'Перепиши исполнение так, чтобы каждые 2–4 секунды происходило новое осмысленное событие. Для 25–35 сек должны ощущаться 7–10 beats. Запрещай три одинаковых proof-жеста с разным реквизитом: минимум два доказательства должны отличаться физически и визуально. Не меняй утверждённую идею.'
    },
    {
      name:'native_audio',
      role:'Ты UGC dialogue director и sound editor. Ищи рекламные формулировки, дикторский тон, дублирование картинки словами, неестественные реплики, тишину в начале, голос только в середине и перегруженные субтитры.',
      focus:'Сделай речь бытовой и короткой, звук драматургически непрерывным, а onscreen-текст минимальным. Удали мета-фразы «сейчас покажу/проверю/повторю» и всё, что просто проговаривает видимое действие. Видео должно работать без звука, но со звуком становиться лучше.'
    },
    {
      name:'viral_mechanics',
      role:'Ты performance creative strategist по TikTok/Reels/Shorts. Ищи линейную рекламу, отсутствие информационных пробелов, одинаковые кадры, слабые pattern interrupts, недостаток micro-payoff, отсутствие контраста и нативной бытовой конкретики.',
      focus:'Перепиши beats так, чтобы каждый отвечал на один вопрос и порождал следующий; соседние сцены визуально контрастировали; каждые 2–4 секунды менялись состояние/масштаб/POV/эмоция/звук; среда и микро-игра героя были конкретными. Не превращай ролик в клиповый хаос и не меняй утверждённую идею.'
    },
    {
      name:'showrunner',
      role:'Ты финальный showrunner и supervisor AI-production. Проверяй FACT LOCK, continuity, физическую реализуемость, продуктовую необходимость, два доказательства/pivot, тайминг, визуальный payoff и отсутствие скучного beauty-shot.',
      focus:'Собери финальную версию, которую можно без ручной починки передавать в storyboard и AI-превиз. Проверь, что второй proof отличается от первого, финал остаётся действием, а не beauty-shot/CTA, и нет сложной физики рук. Не завышай оценки ради прохождения порога.'
    }
  ];
  let lastReview=null;
  await markScriptProgress(15,'Запускаю 4 независимые проверки сценария');
  for(let i=0;i<reviewRoles.length;i++){
    const rv=reviewRoles[i];
    const prompt=[
      rv.role,
      rv.focus,
      '',
      'УТВЕРЖДЁННАЯ ИДЕЯ И КОНТЕКСТ:',
      context,
      '',
      'ТЕКУЩАЯ ВЕРСИЯ СЦЕНАРИЯ:',
      JSON.stringify(script),
      '',
      'ПРОВЕРЬ И СРАЗУ ПЕРЕПИШИ СЦЕНАРИЙ. Не ограничивайся комментариями.',
      'Оцени честно по 1–10: scrollStop, curiosityGap, retention, pacing, nativeTikTok, dialogueNaturalness, hookSpecificity, beatVariety, proofVariety, speechEconomy, visualStorytelling, productIntegration, audioPlan, continuity, factualSafety, generatability, payoff, sceneDensity, patternInterruptQuality, environmentSpecificity, visualContrast, microPayoffCadence, overall.',
      '9–10 — только действительно сильный результат. Если критерий ниже 8, исправь причину прямо в revised script.',
      'Запрещено менять ключевую механику утверждённой идеи. Разрешено менять тайминг, количество сцен в пределах 5–10, порядок микро-beats, реплики, SFX, onscreen, переходы и способ визуального доказательства.',
      'Верни issues и changes кратко, а в script — полную улучшенную версию.'
    ].join('\n');
    await markScriptProgress(16+i,'Проверка '+(i+1)+' из '+reviewRoles.length+': '+rv.name);
    lastReview=await callScriptAIResilient({
      prompt,schema:reviewSchema,name:'script_review_'+rv.name,images:[],effort:'high'
    });
    script=normalizeScriptStage(lastReview?.script||{},payload);
    script.quality=lastReview?.scores||{};
    let check=scriptStageComplete(script);
    if(!check.ok){
      await markScriptProgress(15+i,'Исправляю структуру после проверки '+(i+1));
      const repairReviewPrompt=[
        'ROLE: технический script repair editor.',
        context,
        '',
        'После редакторской проверки структура сценария стала неполной.',
        'Текущая версия: '+JSON.stringify(script),
        check.missing.length?('Пустые поля: '+check.missing.join(', ')+'.'):'',
        check.badScenes?'Есть неполные/неправильно пронумерованные сцены.':'',
        'Сохрани все улучшения предыдущего редактора и восстанови только недостающее.',
        'Каждая сцена: time, purpose, visual, action, sound, continuity, productRole, retentionMechanic, openLoop, patternInterrupt, visualContrast, microConflict, microPayoff, environmentStory, performanceBeat, soundBridge, nextQuestion — непустые; сцены 1..N; 5–10 сцен.',
        'Верни полный сценарий и честные scores.'
      ].filter(Boolean).join('\n');
      lastReview=await callScriptAIResilient({prompt:repairReviewPrompt,schema:reviewSchema,name:'script_review_structure_repair',images:[],effort:'medium'});
      script=normalizeScriptStage(lastReview?.script||{},payload);
      script.quality=lastReview?.scores||script.quality||{};
      check=scriptStageComplete(script);
    }
    if(!check.ok)throw new Error('AI-проверка сценария не восстановилась автоматически');
    await markScriptProgress(16+i,'Проверка '+(i+1)+' из '+reviewRoles.length+' завершена');
  }

  const criticalKeys=['scrollStop','curiosityGap','retention','pacing','nativeTikTok','dialogueNaturalness','hookSpecificity','beatVariety','proofVariety','speechEconomy','productIntegration','audioPlan','continuity','factualSafety','generatability','payoff','sceneDensity','patternInterruptQuality','environmentSpecificity','visualContrast','microPayoffCadence','overall'];
  const failed=()=>criticalKeys.filter(k=>Number(script?.quality?.[k]||0)<8);
  let passes=reviewRoles.length;
  if(failed().length){
    await markScriptProgress(19,'Финальный Script Doctor исправляет оценки ниже 8');
    const repairPrompt=[
      'ROLE: финальный emergency script doctor.',
      'Ниже сценарий уже прошёл несколько независимых AI-проверок, но часть критических критериев всё ещё ниже 8/10.',
      'НЕ меняй утверждённую идею. Исправь именно проваленные критерии глубокой правкой, а не косметикой.',
      context,
      '',
      'ПРОВАЛЕННЫЕ КРИТЕРИИ: '+failed().join(', '),
      'ТЕКУЩИЙ СЦЕНАРИЙ: '+JSON.stringify(script),
      '',
      'Обязательно сохрани factual safety и generatability. Верни полную финальную версию и честные scores.'
    ].join('\n');
    lastReview=await callScriptAIResilient({prompt:repairPrompt,schema:reviewSchema,name:'script_review_repair',images:[],effort:'high'});
    script=normalizeScriptStage(lastReview?.script||{},payload);
    script.quality=lastReview?.scores||{};
    passes++;
  }

  const finalCheck=scriptStageComplete(script);
  if(!finalCheck.ok)throw new Error('Финальный сценарий неполный после всех автоматических восстановлений');
  await markScriptProgress(20,'Сценарий готов');
  const finalFailed=failed();
  script.reviewProcess={
    passes,
    autoRefined:true,
    criticalThreshold:8,
    passed:finalFailed.length===0,
    failedCriteria:finalFailed,
    finalIssues:Array.isArray(lastReview?.issues)?lastReview.issues.slice(0,12):[],
    finalChanges:Array.isArray(lastReview?.changes)?lastReview.changes.slice(0,12):[],
    evaluatedAt:new Date().toISOString()
  };
  return script;
}

const STORYBOARD_REQUIRED_FIELDS=[
  'title','duration','purpose','shot','framing','camera','lens','angle','cameraHeight','focus','depth','motionTiming',
  'environment','setDesign','foreground','midground','background','props','materials','colorPalette','lighting','practicalLights',
  'characters','performance','blocking','product','action','startFrame','endFrame','continuity','retentionMechanic','patternInterrupt','microPayoff',
  'sound','soundDesign','transition','editorNote','negative','promptEn'
];
function storyboardSceneMissing(scene){
  return STORYBOARD_REQUIRED_FIELDS.filter(k=>!String(scene?.[k]||'').trim());
}
function storyboardSceneComplete(scene){return storyboardSceneMissing(scene).length===0}
function storyboardStageComplete(board,expectedCount){
  const arr=Array.isArray(board)?board:[];
  const missing=arr.map((x,i)=>({scene:i+1,fields:storyboardSceneMissing(x)})).filter(x=>x.fields.length);
  return {ok:arr.length===expectedCount&&missing.length===0,count:arr.length,expectedCount,missing};
}
function storyboardSceneJsonSchema(){
  return {
    type:'object',additionalProperties:false,
    required:['scene','title','duration','purpose','shot','framing','camera','lens','angle','cameraHeight','focus','depth','motionTiming','environment','setDesign','foreground','midground','background','props','materials','colorPalette','lighting','practicalLights','characters','performance','blocking','product','action','startFrame','endFrame','continuity','retentionMechanic','patternInterrupt','microPayoff','dialogue','voiceover','onscreen','sound','soundDesign','transition','editorNote','negative','promptEn'],
    properties:{
      scene:{type:'integer',minimum:1,maximum:30},
      title:{type:'string'},duration:{type:'string'},purpose:{type:'string'},shot:{type:'string'},
      framing:{type:'string'},camera:{type:'string'},lens:{type:'string'},angle:{type:'string'},cameraHeight:{type:'string'},focus:{type:'string'},depth:{type:'string'},motionTiming:{type:'string'},
      environment:{type:'string'},setDesign:{type:'string'},foreground:{type:'string'},midground:{type:'string'},background:{type:'string'},props:{type:'string'},materials:{type:'string'},colorPalette:{type:'string'},lighting:{type:'string'},practicalLights:{type:'string'},
      characters:{type:'string'},performance:{type:'string'},blocking:{type:'string'},product:{type:'string'},
      action:{type:'string'},startFrame:{type:'string'},endFrame:{type:'string'},continuity:{type:'string'},retentionMechanic:{type:'string'},patternInterrupt:{type:'string'},microPayoff:{type:'string'},
      dialogue:{type:'string'},voiceover:{type:'string'},onscreen:{type:'string'},sound:{type:'string'},soundDesign:{type:'string'},
      transition:{type:'string'},editorNote:{type:'string'},negative:{type:'string'},promptEn:{type:'string'}
    }
  };
}
function normalizeStoryboardScene(raw,scriptScene={},index=0){
  const x=raw&&typeof raw==='object'?raw:{};
  const sc=scriptScene&&typeof scriptScene==='object'?scriptScene:{};
  return {
    scene:index+1,
    title:String(x.title||sc.purpose||('Сцена '+(index+1))).slice(0,240),
    duration:String(x.duration||x.time||sc.time||'').slice(0,120),
    purpose:String(x.purpose||sc.purpose||'').slice(0,1800),
    shot:String(x.shot||x.framing||sc.visual||'').slice(0,3500),
    framing:String(x.framing||'').slice(0,1800),
    camera:String(x.camera||'').slice(0,3000),
    lens:String(x.lens||'').slice(0,1000),
    angle:String(x.angle||'').slice(0,1800),
    cameraHeight:String(x.cameraHeight||'').slice(0,1200),
    focus:String(x.focus||'').slice(0,1600),
    depth:String(x.depth||'').slice(0,1600),
    motionTiming:String(x.motionTiming||'').slice(0,1800),
    environment:String(x.environment||x.location||'').slice(0,4500),
    setDesign:String(x.setDesign||'').slice(0,5000),
    foreground:String(x.foreground||'').slice(0,2500),
    midground:String(x.midground||'').slice(0,2500),
    background:String(x.background||'').slice(0,2500),
    props:String(x.props||'').slice(0,3500),
    materials:String(x.materials||'').slice(0,2500),
    colorPalette:String(x.colorPalette||'').slice(0,2200),
    lighting:String(x.lighting||'').slice(0,3200),
    practicalLights:String(x.practicalLights||'').slice(0,2200),
    characters:String(x.characters||'').slice(0,4500),
    performance:String(x.performance||'').slice(0,3000),
    blocking:String(x.blocking||'').slice(0,3000),
    product:String(x.product||'').slice(0,4000),
    action:String(x.action||sc.action||'').slice(0,4500),
    startFrame:String(x.startFrame||'').slice(0,3000),
    endFrame:String(x.endFrame||'').slice(0,3000),
    continuity:String(x.continuity||sc.continuity||'').slice(0,5000),
    retentionMechanic:String(x.retentionMechanic||sc.retentionMechanic||'').slice(0,2400),
    patternInterrupt:String(x.patternInterrupt||sc.patternInterrupt||'').slice(0,2400),
    microPayoff:String(x.microPayoff||sc.microPayoff||'').slice(0,2400),
    voiceover:String(x.voiceover??sc.voiceover??'').slice(0,4500),
    dialogue:String(x.dialogue??sc.dialogue??'').slice(0,4500),
    onscreen:String(x.onscreen??sc.onscreen??'').slice(0,2500),
    sound:String(x.sound||sc.sound||'').slice(0,2500),
    soundDesign:String(x.soundDesign||sc.soundBridge||'').slice(0,3000),
    transition:String(x.transition||sc.transition||'').slice(0,2200),
    editorNote:String(x.editorNote||'').slice(0,3000),
    negative:String(x.negative||'').slice(0,4500),
    prompt:String(x.promptEn||x.prompt||'').slice(0,9000),
    promptEn:String(x.promptEn||x.prompt||'').slice(0,9000)
  };
}
function normalizeStoryboardStage(raw,payload={}){
  const src=raw&&typeof raw==='object'?(raw.storyboard||raw):[];
  const script=normalizeScriptStage(payload.script||{},payload);
  const scriptScenes=Array.isArray(script.scenes)?script.scenes:[];
  const arr=Array.isArray(src)?src:(Array.isArray(raw?.scenes)?raw.scenes:[]);
  return scriptScenes.map((sc,i)=>normalizeStoryboardScene(arr[i],sc,i));
}
async function callStoryboardAI(accountId,{prompt,schema,name,images=[],effort='medium'}){
  const model=process.env.OPENAI_MODEL||'gpt-6-astra';
  const controller=new AbortController();
  const timeoutMs=125000;
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  let r;
  try{
    r=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',signal:controller.signal,
      headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'content-type':'application/json'},
      body:JSON.stringify({
        model,
        input:[{role:'user',content:[
          {type:'input_text',text:prompt},
          ...images.map(url=>({type:'input_image',image_url:String(url),detail:'low'}))
        ]}],
        reasoning:{effort},max_output_tokens:12000,
        text:{format:{type:'json_schema',name,strict:true,schema}}
      })
    });
  }catch(e){
    if(e?.name==='AbortError')throw new Error('OpenAI превысил лимит времени Storyboard ('+Math.round(timeoutMs/1000)+' сек)');
    throw e;
  }finally{clearTimeout(timer)}
  const txt=await r.text();
  let data;try{data=txt?JSON.parse(txt):{}}catch{data={raw:txt}}
  if(!r.ok)throw new Error(data?.error?.message||('OpenAI storyboard error '+r.status));
  const priced=openAIUsageCost(data?.model||model,data?.usage||{});
  if(priced.amountUsd>0)await recordExpense(accountId,{
    provider:'OpenAI',category:'storyboard',
    description:name==='storyboard_scene'?'Перегенерация одной storyboard-сцены':'Генерация storyboard по утверждённому сценарию',
    amountUsd:priced.amountUsd,model:data?.model||model,usage:priced.details,source:'auto'
  }).catch(()=>{});
  const outputText=openAIText(data);
  const incompleteReason=String(data?.incomplete_details?.reason||'');
  if(data?.status==='incomplete'||incompleteReason){
    const reason=incompleteReason||'incomplete';
    throw new Error('OpenAI вернул незавершённый Storyboard: '+reason);
  }
  const rawJson=String(outputText||'').trim().replace(/^\`\`\`(?:json)?\\s*/i,'').replace(/\\s*\`\`\`$/,'');
  let parsed;
  try{parsed=JSON.parse(rawJson)}catch{
    throw new Error('OpenAI вернул обрезанный или некорректный JSON Storyboard');
  }
  if(!parsed||typeof parsed!=='object')throw new Error('AI вернул некорректную структуру Storyboard');
  return parsed;
}
function storyboardContext(payload,script,idea,feedback=''){
  return [
    'ИДЕЯ И СЦЕНАРИЙ УЖЕ УТВЕРЖДЕНЫ. Не меняй сюжет, порядок, тайминг, реплики, свойства товара или смысл сцен.',
    'УТВЕРЖДЁННАЯ ИДЕЯ: '+JSON.stringify(idea),
    'УТВЕРЖДЁННЫЙ СЦЕНАРИЙ: '+JSON.stringify(script),
    'Товар: '+String(payload.productName||payload.product?.name||'Товар'),
    'УТП: '+String(payload.productUtp||payload.product?.utp||''),
    'Ограничения товара: '+String(payload.productRules||payload.product?.rules||''),
    'FACT LOCK: не придумывай способ установки/крепления, размеры, материал или функции, которых нет в исходных данных.',
    'Персонаж: '+String(payload.character?.name||'не задан'),
    'Внешность: '+String(payload.character?.look||''),
    'Locks персонажа: '+String(payload.character?.locks||''),
    'Формат: вертикальный 9:16. Стиль: '+String(payload.style||'UGC')+'.',
    feedback?('Комментарий пользователя: '+feedback):'',
    'В каждой сцене ОБЯЗАТЕЛЬНО конкретно заполни ВСЮ production-дирекцию: environment, setDesign, foreground, midground, background, props, materials, colorPalette, lighting, practicalLights, characters, performance, blocking, product, startFrame, endFrame. Нельзя оставлять эти поля пустыми или ставить прочерк.',
    'SET DESIGN должен быть как production bible: точный тип комнаты/зоны, стиль, мебель и её положение, поверхности/фактуры, стены/пол, бытовые следы жизни, 4–8 уместных предметов, окна/двери, глубина пространства. Не пиши просто «современная кухня/ванная».',
    'FOREGROUND/MIDGROUND/BACKGROUND: опиши отдельными слоями, что находится перед камерой, в зоне действия и позади героя. Это создаёт глубину и не даёт генератору делать пустую студию.',
    'PROPS: перечисли только логичные предметы, закрепи их положение и не меняй без причины между соседними сценами. MATERIALS/COLOR PALETTE должны быть конкретными, физически правдоподобными и непротиворечивыми.',
    'LIGHTING: укажи источник, направление, мягкость, цветовую температуру/время суток, practicals в кадре, fill/negative fill, highlight roll-off и характер теней. Свет обязан иметь физическую причину.',
    'PERFORMANCE/BLOCKING: микро-игра героя, взгляд, лицо, плечи, руки, точка внимания, где он стоит/сидит, траектория движения и связь с товаром. Без театральной рекламы.',
    'Также обязательно заполни framing, camera, lens, angle, cameraHeight, focus, depth, motionTiming, retentionMechanic, patternInterrupt, microPayoff, soundDesign, editorNote, negative и promptEn.',
    'CAMERA: конкретный старт камеры, высота, угол, траектория, скорость, acceleration/ease и финальная позиция. LENS: конкретное фокусное расстояние и причина выбора. FOCUS/DEPTH: что резко, что уходит в bokeh, как меняется focus при движении.',
    'MOTION TIMING: разложи действие внутри сцены примерно по времени, например 0.0–0.7s start tension → 0.7–2.1s hand action → 2.1–3.4s reveal → 3.4–4.2s reaction. Не пихай несколько сложных действий одновременно.',
    'dialogue/voiceover/onscreen переноси из сценария без сочинения новых реплик; они могут быть пустой строкой, если речи/текста в сцене нет.',
    'Локация и свет должны быть физически конкретными и совместимыми между соседними сценами.',
    'characters должен повторять ключевые identity-признаки аватара в каждой сцене, где он виден.',
    'product должен явно описывать положение реального товара и его видимые детали, без изменения конструкции.',
    'Storyboard сразу является планом превиза: на КАЖДУЮ сцену планируй ровно 2 ключевых изображения — START и END.',
    'startFrame = точный план первого превиз-кадра сцены: исходное состояние, начало микро-действия, конкретная композиция, поза, положение рук/товара и камера.',
    'endFrame = точный план второго превиз-кадра сцены: действие заметно продвинулось или завершилось; это не дубль START.',
    'START и END должны отличаться с первого взгляда минимум по 2 признакам из: фаза действия, положение рук/тела, положение товара, крупность, угол камеры, взаимодействие с окружением.',
    universalProductIdentityLock(payload),
    'При этом сохраняй continuity: тот же персонаж, одежда, реальный товар и его геометрия, локация, свет и направление действия.',
    'Между соседними сценами разнообразь киноязык: wide/medium/close-up/detail, front/3/4/side; не повторяй одну и ту же композицию без сюжетной причины.',
    'endFrame одной сцены должен логично готовить startFrame следующей сцены.',
    'promptEn — ОЧЕНЬ подробный английский production prompt для ВИДЕО всей сцены от START к END. Структура: SUBJECT/PRODUCT IDENTITY → EXACT SET DESIGN AND SPATIAL LAYERS → LIGHTING → CAMERA/LENS/HEIGHT/FOCUS → START STATE → TIMED ACTION BEATS → END STATE → PERFORMANCE/BLOCKING → PHYSICS → SOUND INTENT → CONTINUITY → NEGATIVE CONSTRAINTS. Он должен быть самодостаточным и конкретным, но не противоречить исходным фото товара.'
  ].filter(Boolean).join('\n');
}
async function generateStoryboardStage(payload,accountId,feedback=''){
  if(!openaiConfigured())throw new Error('OpenAI API is not configured');
  const idea=normalizeIdeaStage(payload.idea||{},payload);
  const script=normalizeScriptStage(payload.script||{},payload);
  const scriptScenes=Array.isArray(script.scenes)?script.scenes:[];
  if(!scriptScenes.length)throw new Error('Сначала нужен утверждённый сценарий');
  const productRefs=(payload.media||payload.product?.media||[]).map(x=>x?.url).filter(x=>/^https:\/\//i.test(String(x||'')));
  const avatarRefs=(payload.avatarReferences||payload.character?.media||[]).map(x=>x?.url).filter(x=>/^https:\/\//i.test(String(x||'')));
  const refs=[productRefs[0],avatarRefs[0]].filter(Boolean);
  const sceneSchema=storyboardSceneJsonSchema();
  const chunkSize=3;
  const board=[];

  for(let from=0;from<scriptScenes.length;from+=chunkSize){
    const chunkScenes=scriptScenes.slice(from,from+chunkSize);
    const to=from+chunkScenes.length;
    const chunkScript={...script,scenes:chunkScenes,sceneCount:chunkScenes.length};
    const schema={
      type:'object',additionalProperties:false,required:['storyboard'],
      properties:{storyboard:{type:'array',minItems:chunkScenes.length,maxItems:chunkScenes.length,items:sceneSchema}}
    };
    const prompt=[
      'ROLE: senior storyboard director, cinematographer and AI-video prompt engineer.',
      storyboardContext(payload,chunkScript,idea,feedback),
      'Ты создаёшь ТОЛЬКО сцены '+(from+1)+'–'+to+' из общего сценария на '+scriptScenes.length+' сцен.',
      from>0?('Предыдущая сценарная сцена для continuity: '+JSON.stringify(scriptScenes[from-1])):'',
      to<scriptScenes.length?('Следующая сценарная сцена для continuity: '+JSON.stringify(scriptScenes[to])):'',
      'Верни ровно '+chunkScenes.length+' storyboard-сцен в том же порядке.',
      'Номера scene должны быть '+chunkScenes.map((_,i)=>from+i+1).join(', ')+'.',
      'Для каждой сцены заранее спроектируй ровно 2 превиз-кадра через startFrame и endFrame.',
      'START и END — разные моменты действия; минимум 2 заметных визуальных отличия при сохранении continuity.',
      'Пиши production-ready подробно. Для environment/setDesign/lighting/camera/action/startFrame/endFrame/promptEn допускаются 2–5 насыщенных предложений. Не повторяй текст механически: каждое поле отвечает за свой слой постановки.',
      'Все обязательные поля должны быть непустыми.',
      'Верни JSON по заданной схеме.'
    ].filter(Boolean).join('\n\n');

    let raw=await callStoryboardAI(accountId,{prompt,schema,name:'storyboard_chunk',images:refs,effort:'high'});
    let arr=Array.isArray(raw?.storyboard)?raw.storyboard:[];
    let normalized=chunkScenes.map((sc,i)=>normalizeStoryboardScene(arr[i],sc,from+i));
    let missing=normalized.map((x,i)=>({scene:from+i+1,fields:storyboardSceneMissing(x)})).filter(x=>x.fields.length);

    if(missing.length){
      const repair=[
        'ROLE: technical storyboard repair editor.',
        storyboardContext(payload,chunkScript,idea,feedback),
        'Исправляешь только сцены '+(from+1)+'–'+to+'.',
        'Текущий chunk: '+JSON.stringify(normalized),
        'Недостающие поля: '+JSON.stringify(missing),
        'Верни ровно '+chunkScenes.length+' полностью заполненных сцен. Сохрани хорошие данные, дополни недостающее. Кратко и конкретно.'
      ].join('\n\n');
      raw=await callStoryboardAI(accountId,{prompt:repair,schema,name:'storyboard_chunk_repair',images:refs,effort:'medium'});
      arr=Array.isArray(raw?.storyboard)?raw.storyboard:[];
      normalized=chunkScenes.map((sc,i)=>normalizeStoryboardScene(arr[i],sc,from+i));
      missing=normalized.map((x,i)=>({scene:from+i+1,fields:storyboardSceneMissing(x)})).filter(x=>x.fields.length);
    }

    if(missing.length){
      throw new Error('Storyboard неполный после автодокрутки: '+missing.map(x=>'сцена '+x.scene+' ['+x.fields.join(', ')+']').join('; '));
    }
    board.push(...normalized);
  }

  const check=storyboardStageComplete(board,scriptScenes.length);
  if(!check.ok)throw new Error('Storyboard неполный: '+check.missing.map(x=>'сцена '+x.scene+' ['+x.fields.join(', ')+']').join('; '));
  return board;
}
async function generateStoryboardScene(payload,accountId,sceneNo,feedback=''){
  if(!openaiConfigured())throw new Error('OpenAI API is not configured');
  const idea=normalizeIdeaStage(payload.idea||{},payload);
  const script=normalizeScriptStage(payload.script||{},payload);
  const scriptScenes=Array.isArray(script.scenes)?script.scenes:[];
  const index=Number(sceneNo)-1;
  const scriptScene=scriptScenes[index];
  if(!scriptScene)throw new Error('Сцена '+sceneNo+' отсутствует в сценарии');
  const board=Array.isArray(payload.storyboard)?payload.storyboard:[];
  const current=board[index]||{};
  const prev=index>0?board[index-1]:null;
  const next=index<board.length-1?board[index+1]:null;
  const productRefs=(payload.media||payload.product?.media||[]).map(x=>x?.url).filter(x=>/^https:\/\//i.test(String(x||'')));
  const avatarRefs=(payload.avatarReferences||payload.character?.media||[]).map(x=>x?.url).filter(x=>/^https:\/\//i.test(String(x||'')));
  const refs=[productRefs[0],avatarRefs[0]].filter(Boolean);
  const schema={
    type:'object',additionalProperties:false,required:['scene'],
    properties:{scene:storyboardSceneJsonSchema()}
  };
  const prompt=[
    'ROLE: senior storyboard scene editor.',
    storyboardContext(payload,script,idea,feedback),
    'ПЕРЕДЕЛАЙ ТОЛЬКО СЦЕНУ '+sceneNo+'. Остальные сцены не меняй.',
    'Сценарная сцена '+sceneNo+': '+JSON.stringify(scriptScene),
    'Текущая storyboard-сцена: '+JSON.stringify(current),
    prev?('Предыдущая сцена для continuity: '+JSON.stringify(prev)):'',
    next?('Следующая сцена для continuity: '+JSON.stringify(next)):'',
    'Верни одну полностью заполненную production-ready сцену. Все технические поля обязаны быть конкретными; никаких "—", "не задано" или пустых location/light/character/product/start/end.',
    'Обязательно перепроектируй пару START/END как 2 разных ключевых превиз-кадра одной сцены: START — начало действия, END — заметно продвинутый или завершённый момент.',
    'START и END должны визуально отличаться минимум по 2 признакам, сохраняя continuity и точную геометрию товара.',
    'Если комментарий пользователя пустой, улучшай сцену без изменения её смысла.'
  ].filter(Boolean).join('\n\n');
  let raw=await callStoryboardAI(accountId,{prompt,schema,name:'storyboard_scene',images:refs,effort:'high'});
  let scene=normalizeStoryboardScene(raw.scene||raw,scriptScene,index);
  let missing=storyboardSceneMissing(scene);
  if(missing.length){
    const repair=[
      prompt,
      'Предыдущий ответ неполный: '+JSON.stringify(scene),
      'Заполни недостающие поля: '+missing.join(', ')+'. Верни одну полную сцену по схеме.'
    ].join('\n\n');
    raw=await callStoryboardAI(accountId,{prompt:repair,schema,name:'storyboard_scene_repair',images:[],effort:'medium'});
    scene=normalizeStoryboardScene(raw.scene||raw,scriptScene,index);
    missing=storyboardSceneMissing(scene);
  }
  if(missing.length)throw new Error('Сцена '+sceneNo+' осталась неполной: '+missing.join(', '));
  return scene;
}

function previsFrameShowsProduct(frame={},scene={}){
  if(frame?.productInFrame===true)return true;
  if(frame?.productInFrame===false)return false;
  const visual=[
    frame?.composition,frame?.framing,frame?.action,frame?.environment,frame?.location,
    frame?.productRole,frame?.productPlacement,frame?.productVisibility,frame?.productConsistency,
    scene?.startFrame,scene?.endFrame,scene?.action,scene?.product,scene?.productRole,scene?.environment
  ].filter(Boolean).join(' ').toLowerCase();
  if(/(?:товар|продукт|product|item)[^.]{0,80}(?:не\s+виден|отсутствует|за\s+кадром|not\s+visible|off[- ]?screen|absent)|(?:без\s+товара|no\s+product)/i.test(visual))return false;
  return Boolean(
    String(frame?.productRole||'').trim() ||
    String(frame?.productPlacement||'').trim() ||
    String(frame?.productVisibility||'').trim() ||
    String(scene?.product||'').trim() ||
    String(scene?.productRole||'').trim() ||
    /товар|продукт|product|item|держ|использ|установ|сним|надев|показыв|демонстр|в\s+рук|в\s+кадр|рулон|мочал|щ[её]тк|sprayer|holder|mat|fan|curler|roll/i.test(visual)
  );
}

function normalizePrevisPlan(raw,payload={}){
  const board=Array.isArray(payload.storyboard)?payload.storyboard:[];
  const src=raw&&typeof raw==='object'?(raw.previsPlan||raw):{};
  const incoming=Array.isArray(src.frames)?src.frames:(Array.isArray(raw?.frames)?raw.frames:[]);
  const frames=[];
  for(let i=0;i<board.length;i++){
    const sceneNo=i+1,scene=board[i]||{};
    const sceneFrames=incoming
      .filter(x=>Number(x?.scene)===sceneNo)
      .sort((a,b)=>Number(a?.frame||0)-Number(b?.frame||0));
    const startRaw=sceneFrames.find(x=>String(x?.frameType||'').toLowerCase()==='start')||sceneFrames[0]||{};
    const endRaw=sceneFrames.find(x=>String(x?.frameType||'').toLowerCase()==='end')||sceneFrames[sceneFrames.length-1]||sceneFrames[1]||{};
    const selected=[startRaw,endRaw];
    const fallbackTypes=['start','end'];
    for(let j=0;j<2;j++){
      const x=selected[j]||{};
      frames.push({
        id:String(x.id||('s'+sceneNo+'f'+(j+1))),
        scene:sceneNo,
        frame:j+1,
        frameType:fallbackTypes[j],
        timecode:String(x.timecode||scene.duration||'').slice(0,120),
        durationHint:String(x.durationHint||'0.8s').slice(0,60),
        goal:String(x.goal||scene.purpose||'').slice(0,2200),
        storyFunction:String(x.storyFunction||'').slice(0,900),
        continuityRole:String(x.continuityRole||'').slice(0,1800),
        composition:String(
          j===0
            ? (x.composition||scene.startFrame||scene.shot||'')
            : (x.composition||scene.endFrame||scene.shot||'')
        ).slice(0,3500),
        framing:String(x.framing||scene.framing||'').slice(0,1000),
        cameraAngle:String(x.cameraAngle||scene.angle||'').slice(0,1000),
        cameraPosition:String(x.cameraPosition||'').slice(0,1200),
        lensFeel:String(x.lensFeel||scene.lens||'').slice(0,700),
        cameraMotion:String(x.cameraMotion||scene.camera||'').slice(0,1200),
        depth:String(x.depth||'').slice(0,900),
        focus:String(x.focus||'').slice(0,1200),
        location:String(x.location||scene.environment||'').slice(0,1800),
        environment:String(x.environment||scene.environment||'').slice(0,2400),
        lighting:String(x.lighting||scene.lighting||'').slice(0,1600),
        mood:String(x.mood||'').slice(0,1000),
        colorMood:String(x.colorMood||'').slice(0,1000),
        avatarInFrame:Boolean(x.avatarInFrame ?? !!scene.characters),
        avatarDescription:String(x.avatarDescription||scene.characters||'').slice(0,3000),
        expression:String(x.expression||'').slice(0,900),
        pose:String(x.pose||'').slice(0,1200),
        action:String(
          j===0
            ? ('START STATE — отчётливое начало микро-действия, до результата. '+String(scene.startFrame||x.action||scene.action||''))
            : ('END STATE — микро-действие заметно продвинулось или завершено; результат визуально отличается от START. '+String(scene.endFrame||x.action||scene.action||''))
        ).slice(0,3500),
        productInFrame:previsFrameShowsProduct(x,scene),
        productRole:String(x.productRole||scene.product||'').slice(0,2200),
        productPlacement:String(x.productPlacement||'').slice(0,1200),
        productVisibility:String(x.productVisibility||'').slice(0,1000),
        productConsistency:String(x.productConsistency||payload.productRules||payload.product?.rules||'').slice(0,2800),
        dialogue:String(x.dialogue||scene.dialogue||'').slice(0,2500),
        voiceover:String(x.voiceover||scene.voiceover||'').slice(0,2500),
        onscreenText:String(x.onscreenText||scene.onscreen||'').slice(0,1400),
        soundCue:String(x.soundCue||scene.sound||'').slice(0,1200),
        previousAnchor:String(x.previousAnchor||'').slice(0,500),
        nextIntent:String(x.nextIntent||'').slice(0,1600),
        continuityNotes:String(x.continuityNotes||scene.continuity||'').slice(0,2800),
        referenceMode:String(x.referenceMode||((i===0&&j===0)?'identity-led':'anchor-led')).slice(0,60),
        identityRefs:Array.isArray(x.identityRefs)?x.identityRefs.slice(0,4).map(String):[],
        anchorFrames:Array.isArray(x.anchorFrames)?x.anchorFrames.slice(0,4).map(String):[],
        continuityFrames:Array.isArray(x.continuityFrames)?x.continuityFrames.slice(0,4).map(String):[],
        imagePromptRu:String(x.imagePromptRu||'').slice(0,8000),
        imagePromptEn:String(x.imagePromptEn||'').slice(0,8000),
        negativePrompt:String(x.negativePrompt||scene.negative||'').slice(0,3500),
        qualityNotes:String(x.qualityNotes||'').slice(0,2200)
      });
    }
  }
  const b=src.cinemaBible&&typeof src.cinemaBible==='object'?src.cinemaBible:{};
  const cinemaBible={
    cameraSystem:String(b.cameraSystem||'natural digital cinema, realistic perspective').slice(0,800),
    lensPackage:String(b.lensPackage||'28mm / 50mm / 85mm macro-like detail, selected by shot purpose').slice(0,1000),
    lightingBible:String(b.lightingBible||'motivated practical lighting with one consistent key direction per location').slice(0,1400),
    colorBible:String(b.colorBible||'natural skin and materials, controlled contrast, protected highlights, coherent palette').slice(0,1200),
    motionBible:String(b.motionBible||'intentional camera movement, natural acceleration/deceleration, believable inertia').slice(0,1200),
    textureBible:String(b.textureBible||'real skin pores and material texture; no waxy/plastic surfaces').slice(0,1000),
    continuityRules:Array.isArray(b.continuityRules)?b.continuityRules.slice(0,12).map(x=>String(x).slice(0,500)):[],
    shotVarietyRules:Array.isArray(b.shotVarietyRules)?b.shotVarietyRules.slice(0,12).map(x=>String(x).slice(0,500)):[]
  };
  return {
    totalScenes:board.length,
    totalFrames:frames.length,
    logic:String(src.logic||'2 превиз-кадра на сцену: START и END. Кадры должны показывать заметное развитие действия, а не два почти одинаковых фото. Исходные фото используются для identity, generated anchors — для continuity.').slice(0,3000),
    cinemaBible,
    frames
  };
}
async function generatePrevisPlan(payload,accountId,feedback=''){
  if(!openaiConfigured())throw new Error('OpenAI API is not configured');
  const board=Array.isArray(payload.storyboard)?payload.storyboard:[];
  if(!board.length)throw new Error('Сначала нужен утверждённый Storyboard');
  const master=[
    'ROLE: Ты film director, storyboard supervisor, cinematographer и AI previsualization planner.',
    'ИДЕЯ, СЦЕНАРИЙ И STORYBOARD УЖЕ УТВЕРЖДЕНЫ. Не менять сюжет и реплики.',
    'Нужно построить кинематографический превиз будущего вертикального ролика 9:16 ДО видеогенерации.',
    'Для КАЖДОЙ storyboard-сцены сделай ровно 2 ключевых кадра: START и END.',
    'При '+board.length+' сценах итог должен быть '+(board.length*2)+' кадров.',
    'START и END — это два момента ОДНОГО микро-действия, а не два варианта одной и той же фотографии.',
    'CINEMA BIBLE: строй ролик как оператор-постановщик, а не как генератор красивых картинок. Для каждой сцены фиксируй физически понятную камеру, оптику, свет и движение.',
    'Указывай конкретную оптику: 24–35mm только для среды/широких кадров; 50–65mm для естественного medium/product shot; 85–100mm macro/close-up для деталей товара без широкоугольной деформации.',
    'Указывай depth/aperture feel (например f/2.8 shallow, f/4 moderate), мотивированный источник света и направление: окно/практикал/key слева или справа, мягкий fill/negative fill, правдоподобный falloff.',
    'cameraMotion должен задавать старт, траекторию, скорость и конец движения: например slow 10% dolly-in with ease-in/ease-out, subtle handheld micro-drift, locked tripod, short lateral track.',
    'В одной локации сохраняй одинаковую цветовую температуру, направление ключевого света, характер оптики и общий contrast/color palette между сценами.',
    'SHOT VARIETY: соседние сцены не должны повторять одинаковые крупность+угол+движение камеры. Чередуй macro/detail, close-up, medium, POV/OTS/top-down/wide только когда это помогает истории.',
    'REALISM: свет всегда имеет понятный источник; движение тела и рук ощущает вес, контакт, инерцию и трение; камера не должна выглядеть стерильно-плавающей без причины.',
    '',
    'СНАЧАЛА СОЗДАЙ ЕДИНЫЙ cinemaBible на весь ролик: cameraSystem, lensPackage, lightingBible, colorBible, motionBible, textureBible, continuityRules[], shotVarietyRules[]. Он должен быть конкретным и применимым ко всем сценам.',
    'Все кадры обязаны следовать этому cinemaBible; меняй крупность/угол, но не меняй визуальную вселенную, характер света и материализацию людей/товара.',
    '',
    'КРИТИЧЕСКО: ДИНАМИКА И ВИЗУАЛЬНОЕ РАЗЛИЧИЕ:',
    '- START показывает исходное состояние и начало движения; END показывает заметно продвинувшееся действие или его результат;',
    '- START и END должны отличаться с первого взгляда. Запрещены почти одинаковые поза, композиция и положение товара;',
    '- между START и END измени минимум 2 из признаков: состояние/позиция товара, положение рук/тела, крупность кадра, угол камеры, положение объекта в кадре, взаимодействие с окружением;',
    '- при этом НЕ ломай continuity: тот же человек, одежда, товар, геометрия товара, локация, общий свет и направление действия;',
    '- чередуй киноязык между сценами: wide/medium/close-up/detail и front/3/4/side; не повторяй одну композицию сцену за сценой без причины;',
    '- каждый END должен создавать ощущение движения вперёд и визуально подготавливать START следующей сцены;',
    '- не делай статичный beauty-shot вместо действия, если storyboard требует действие;',
    '',
    'КРИТИЧЕСКОЕ ПРАВИЛО РЕФЕРЕНСОВ:',
    '- исходные фото товара/аватара нужны только для понимания identity: формы, цвета, фактуры, лица, одежды, locks;',
    '- НЕ делай исходное фото товара главным anchor каждого нового кадра;',
    '- после первого сгенерированного кадра основой следующих кадров становятся уже СГЕНЕРИРОВАННЫЕ кадры;',
    '- приоритет: generated anchorFrames > continuityFrames > source identityRefs;',
    '- reference frame задаёт continuity, но НЕ разрешает копировать ту же позу и композицию;',
    '- первый кадр первой сцены может быть identity-led; далее преимущественно anchor-led;',
    '- productInFrame=true ВСЕГДА, когда исходный товар виден хотя бы частично: крупно, сбоку, в фоне, перекрыт рукой/другим объектом или занимает небольшую часть кадра. false разрешён только когда товар полностью отсутствует из видимой области кадра;',
    '- если персонаж впервые появляется позднее, разрешено один раз подключить его source identity reference для фиксации лица.',
    '',
    'Товар: '+String(payload.productName||payload.product?.name||'Товар'),
    'Правила товара: '+String(payload.productRules||payload.product?.rules||''),
    'FACT LOCK: не дорисовывай и не демонстрируй неподтверждённый механизм крепления, скрытые детали или свойства. Исходные фото задают только реальную видимую геометрию товара.',
    'AI-аватар: '+String(payload.character?.name||'не задан'),
    'Avatar locks: '+String(payload.character?.look||'')+' '+String(payload.character?.locks||''),
    'Идея: '+JSON.stringify(payload.idea||{}),
    'Сценарий: '+JSON.stringify(payload.script||{}),
    'Storyboard: '+JSON.stringify(board),
    feedback?('Комментарий пользователя: '+feedback):'',
    '',
    'ДЛЯ КАЖДОГО КАДРА ВЕРНИ:',
    'scene, frame, frameType, timecode, durationHint, goal, storyFunction, continuityRole, composition, framing, cameraAngle, cameraPosition, lensFeel, cameraMotion, depth, focus, location, environment, lighting, mood, colorMood, avatarInFrame, avatarDescription, expression, pose, action, productInFrame, productRole, productPlacement, productVisibility, productConsistency, dialogue, voiceover, onscreenText, soundCue, previousAnchor, nextIntent, continuityNotes, referenceMode, identityRefs, anchorFrames, continuityFrames, imagePromptRu, imagePromptEn, negativePrompt, qualityNotes.',
    '',
    'imagePromptEn должен быть подробным cinematic prompt для ОДНОГО статичного 9:16 keyframe: realistic commercial film still, exact composition, motivated light source/direction, camera body feel, exact focal length, aperture/depth, action phase, character/product continuity. Описывай желаемое позитивно и физически конкретно, а не общими словами cinematic/beautiful. No baked-in text, no random logo, no product deformation.',
    'Кадры START/END одной сцены обязаны показывать разные фазы действия и заметное визуальное развитие.',
    'END кадр сцены должен визуально готовить START следующей сцены.',
    'Не показывай внутренние рассуждения.',
    '',
    'Верни ТОЛЬКО JSON:',
    '{"previsPlan":{"totalScenes":'+board.length+',"totalFrames":'+(board.length*2)+',"logic":"","cinemaBible":{"cameraSystem":"","lensPackage":"","lightingBible":"","colorBible":"","motionBible":"","textureBible":"","continuityRules":[],"shotVarietyRules":[]},"frames":[{"id":"s1f1","scene":1,"frame":1,"frameType":"start","timecode":"","durationHint":"0.8s","goal":"","storyFunction":"","continuityRole":"","composition":"","framing":"","cameraAngle":"","cameraPosition":"","lensFeel":"","cameraMotion":"","depth":"","focus":"","location":"","environment":"","lighting":"","mood":"","colorMood":"","avatarInFrame":false,"avatarDescription":"","expression":"","pose":"","action":"","productInFrame":true,"productRole":"","productPlacement":"","productVisibility":"","productConsistency":"","dialogue":"","voiceover":"","onscreenText":"","soundCue":"","previousAnchor":"","nextIntent":"","continuityNotes":"","referenceMode":"identity-led","identityRefs":[],"anchorFrames":[],"continuityFrames":[],"imagePromptRu":"","imagePromptEn":"","negativePrompt":"","qualityNotes":""}]}}'
  ].filter(Boolean).join('\n');
  const model=process.env.OPENAI_MODEL||'gpt-6-astra';
  const r=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'content-type':'application/json'},
    body:JSON.stringify({model,input:master,reasoning:{effort:'medium'},max_output_tokens:12000})
  });
  const raw=await r.text();let data;try{data=raw?JSON.parse(raw):{}}catch{data={raw}}
  if(!r.ok)throw new Error(data?.error?.message||('OpenAI previs plan error '+r.status));
  const priced=openAIUsageCost(data?.model||model,data?.usage||{});
  if(priced.amountUsd>0)await recordExpense(accountId,{provider:'OpenAI',category:'previs-plan',description:'План START/END превиз-кадров',amountUsd:priced.amountUsd,model:data?.model||model,usage:priced.details,source:'auto'}).catch(()=>{});
  return normalizePrevisPlan(safeAnalysisJson(openAIText(data)),payload);
}
function productIdentityUrls(run,limit=3){
  const productMedia=Array.isArray(run.media)?run.media:(Array.isArray(run.product?.media)?run.product.media:[]);
  const urls=productMedia
    .filter(x=>/^https:\/\//i.test(String(x?.url||'')))
    .sort((a,b)=>Number(!!b?.isPrimary)-Number(!!a?.isPrimary))
    .map(x=>String(x.url));
  return [...new Set(urls)].slice(0,Math.max(1,limit));
}
function avatarIdentityUrls(run,limit=1){
  const avatarMedia=Array.isArray(run.avatarReferences)?run.avatarReferences:(Array.isArray(run.character?.media)?run.character.media:[]);
  const urls=avatarMedia
    .filter(x=>/^https:\/\//i.test(String(x?.url||'')))
    .sort((a,b)=>Number(!!b?.isPrimary)-Number(!!a?.isPrimary))
    .map(x=>String(x.url));
  return [...new Set(urls)].slice(0,Math.max(1,limit));
}
function primaryIdentityUrls(run){
  return {product:productIdentityUrls(run,1)[0]||'',avatar:avatarIdentityUrls(run,1)[0]||''};
}
function paperTowelHolderLock(run,context=''){
  const text=[
    run?.productName,run?.product?.name,run?.productUtp,run?.product?.utp,
    run?.productRules,run?.product?.rules,context
  ].filter(Boolean).join(' ').toLowerCase();
  if(!/держател|holder/.test(text) || !/бумаж|рулон|paper\s*towel|kitchen\s*roll|держатель\s+полотенец/.test(text))return '';
  return [
    'HOLDER ABSOLUTE LOCK: exact one-sided open-end paper-roll holder; do not mirror or redesign.',
    'Source orientation: fixed base/support LEFT, permanently free loading end RIGHT.',
    'The right end/cap is NOT removable: never unscrew, detach, hinge, split or remove the rod.',
    'Load roll only through the free RIGHT end, sliding RIGHT→LEFT toward the base. Remove by sliding LEFT→RIGHT.',
    'Never invent a spring spindle, second support, latch, detachable axle, extra stopper or different mount.'
  ].join(' ');
}
function previsRefsForFrame(run,frame,done=[]){
  const urls=[];
  const lockProduct=previsFrameShowsProduct(frame,{});
  const productRefs=lockProduct?productIdentityUrls(run,3):[];
  urls.push(...productRefs);

  const byId=new Map(done.filter(x=>x?.url).map(x=>[String(x.id),x.url]));
  for(const id of [...(frame.anchorFrames||[]),...(frame.continuityFrames||[])]){
    const u=byId.get(String(id));if(u)urls.push(u);
  }
  if(frame.frame===1&&frame.scene>1){
    const prevScene=done.filter(x=>Number(x.scene)===Number(frame.scene)-1&&x.url).slice(-1)[0];
    if(prevScene?.url)urls.push(prevScene.url);
  }
  if(urls.length===productRefs.length&&done.length)urls.push(done[done.length-1]?.url);

  if(frame.avatarInFrame)urls.push(...avatarIdentityUrls(run,1));
  return [...new Set(urls.filter(Boolean))].slice(0,4);
}
async function generateOpenAIPrevisImage(accountId,run,frame,referenceUrls=[]){
  if(!openaiConfigured())throw new Error('OpenAI API is not configured');
  const phase=String(frame.frameType||'').toLowerCase();
  const phaseRule=phase==='start'
    ? 'FRAME PHASE: START. Show the initial state and the beginning of the micro-action, before the result.'
    : 'FRAME PHASE: END. Show a clearly advanced or completed state. It must differ visibly from START in at least two aspects such as action state, hand/body pose, product position, framing, camera angle or object interaction. Preserve identity and scene continuity, but do not clone the START composition.';
  const prompt=[
    'Generate exactly one cinematic vertical 9:16 previsualization keyframe for a future commercial video.',
    'This is frame '+frame.frame+' ('+frame.frameType+') of scene '+frame.scene+'.',
    phaseRule,
    'Product: '+String(run.productName||''),
    'Product identity locks: '+String(run.productRules||run.product?.rules||''),
    universalProductIdentityLock(run),
    paperTowelHolderLock(run,[frame.action,frame.productPlacement,frame.productRole,frame.composition].filter(Boolean).join(' ')),
    previsFrameShowsProduct(frame,{})
      ? 'CRITICAL PRODUCT LOCK: the first source-product reference images are authoritative ORIGINAL PRODUCT photos. Reproduce this exact physical product: silhouette, geometry, proportions, number and placement of parts, edges/ends, openings, mounts, controls, seams, material, texture, color, transparency and markings. Do not redesign, simplify, mirror, thicken, shorten, add/remove parts, invent mechanisms or copy product geometry from generated anchors when it differs from the source photos. Generated frames control composition only; ORIGINAL PRODUCT photos always win for product identity.'
      : '',
    run.character?.name?('Avatar identity locks: '+String(run.character.name)+'; '+String(run.character.look||'')+'; '+String(run.character.locks||'')):'',
    'Composition: '+String(frame.composition||''),
    'Framing: '+String(frame.framing||''),
    'Camera angle/position/lens: '+[frame.cameraAngle,frame.cameraPosition,frame.lensFeel].filter(Boolean).join('; '),
    'Environment: '+String(frame.environment||frame.location||''),
    'Lighting: '+String(frame.lighting||''),
    'CINEMA BIBLE FOR THIS FILM: '+JSON.stringify(run.previsPlan?.cinemaBible||{}),
    'Action phase: '+String(frame.action||''),
    'Avatar: '+String(frame.avatarDescription||''),
    'Product placement: '+String(frame.productPlacement||frame.productRole||''),
    'Continuity: '+String(frame.continuityNotes||''),
    'Next visual intent: '+String(frame.nextIntent||''),
    frame.qualityNotes?('QC CORRECTION NOTES: '+String(frame.qualityNotes)):'',
    String(frame.imagePromptEn||frame.imagePromptRu||''),
    'REFERENCE POLICY: generated frames control composition and continuity. Source product/avatar photos are strict identity locks only. Never copy the source composition, but NEVER let generated anchors override the real product geometry, proportions, mounting parts, color, texture or the avatar identity.',
    'ENVIRONMENT QUALITY: make the location feel real, inhabited and commercially believable. Keep recurring contextual props appropriate to the approved scene; avoid empty sterile showroom backgrounds unless the storyboard explicitly requires them.',
    'No baked-in text, no random logos, no extra fingers, no product deformation, no face change, no wardrobe change unless the approved scenario explicitly requires it.',
    frame.negativePrompt?('Negative: '+frame.negativePrompt):''
  ].filter(Boolean).join('\n').slice(0,15000);
  const sourceProductRefs=previsFrameShowsProduct(frame,{})?productIdentityUrls(run,3):[];
  const sourceProductSet=new Set(sourceProductRefs);
  const input=[{role:'user',content:[
    {type:'input_text',text:prompt},
    ...referenceUrls.map(url=>({
      type:'input_image',
      image_url:url,
      detail:sourceProductSet.has(url)?'high':'low'
    }))
  ]}];
  const model=process.env.OPENAI_MODEL||'gpt-6-astra';
  const imageModel=frame?.hookLab?'gpt-image-2.5-flare':'gpt-image-2.5-sunburst';
  const imageSize='1152x2048';
  const imageQuality=frame?.hookLab?'low':(previsFrameShowsProduct(frame,{})?'xhigh':'high');
  const body={
    model,input,
    tools:[{type:'image_generation',model:imageModel,action:'auto',size:imageSize,quality:imageQuality,output_format:'png'}],
    tool_choice:'required'
  };
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'content-type':'application/json'},body:JSON.stringify(body)});
  const raw=await r.text();let data;try{data=raw?JSON.parse(raw):{}}catch{data={raw}}
  if(!r.ok)throw new Error(data?.error?.message||('OpenAI previs image error '+r.status));
  const call=(Array.isArray(data?.output)?data.output:[]).find(x=>x?.type==='image_generation_call'&&x?.result);
  const b64=String(call?.result||'');
  if(!b64)throw new Error('OpenAI не вернул превиз-кадр');
  const scoped=(sanitizeAccountId(accountId)+'__previs_'+String(run.id||'run')).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);
  const uploaded=await callProductMedia({action:'upload',productId:scoped,fileName:'previs-s'+frame.scene+'-f'+frame.frame+'-'+Date.now()+'.png',mimeType:'image/png',dataBase64:'data:image/png;base64,'+b64});
  if(!uploaded?.media?.url)throw new Error('Не удалось сохранить превиз-кадр');
  const priced=openAIUsageCost(data?.model||model,data?.usage||{});
  const previewQuality=imageQuality;
  const amountUsd=priced.amountUsd>0?priced.amountUsd:imageGenerationFallbackUsd(previewQuality,imageSize);
  await recordExpense(accountId,{provider:'OpenAI',category:frame?.hookLab?'hook-preview':'previs-image',description:(frame?.hookLab?'Hook Lab превиз ':'Превиз-кадр сцены '+frame.scene+' · ')+frame.frame,amountUsd,model:imageModel,usage:{size:imageSize,quality:previewQuality,references:referenceUrls.length},source:'auto'}).catch(()=>{});
  return {
    url:uploaded.media.url,
    path:uploaded.media.path||'',
    model:imageModel,
    references:referenceUrls,
    productLockVersion:previsFrameShowsProduct(frame,{})?'source-v2':''
  };
}
const accountBackgroundQueues=new Map();
const accountBackgroundJobs=new Map();
function enqueueAccountBackground(accountId,jobKey,worker,label='background'){
  const account=sanitizeAccountId(accountId||DEFAULT_ACCOUNT_ID);
  const rawKey=String(jobKey||'background');
  const dedupeKey=account+'::'+rawKey;
  if(accountBackgroundJobs.has(dedupeKey))return accountBackgroundJobs.get(dedupeKey);

  // Serialize only work belonging to the SAME run. Different runs may execute in
  // parallel because writeAppState now performs conflict-safe newest-by-id merging.
  // jobKey format is <task>:<runId>[:detail].
  const parts=rawKey.split(':');
  const runScope=parts.length>1&&parts[1]?parts[1]:rawKey;
  const queueKey=account+'::run::'+runScope;
  const previous=accountBackgroundQueues.get(queueKey)||Promise.resolve();
  let next;
  next=previous.catch(()=>{}).then(worker)
    .catch(e=>{console.error('['+label+'] '+rawKey+' '+String(e?.message||e));return {ok:false,error:String(e?.message||e)}})
    .finally(()=>{
      accountBackgroundJobs.delete(dedupeKey);
      if(accountBackgroundQueues.get(queueKey)===next)accountBackgroundQueues.delete(queueKey);
    });
  accountBackgroundQueues.set(queueKey,next);
  accountBackgroundJobs.set(dedupeKey,next);
  return next;
}

function enqueueRunPrevis(accountId,runId,label='previs'){
  const account=sanitizeAccountId(accountId||DEFAULT_ACCOUNT_ID);
  return enqueueAccountBackground(account,'previs:'+String(runId),()=>processRunPrevis(account,runId),label);
}
async function generateHiggsfieldPrevisImage(accountId,run,frame,referenceUrls=[]){
  if(!higgsfieldConfigured())throw new Error('Higgsfield API is not configured');
  const phase=String(frame.frameType||'').toLowerCase();
  const phaseRule=phase==='start'
    ? 'START: show the initial state and the beginning of the micro-action, before the result.'
    : 'END: show a clearly advanced or completed state. Make it visibly different from START in at least two aspects: action state, hand/body pose, product position, framing, camera angle or object interaction. Preserve identity and continuity; do not clone the START composition.';
  const prompt=[
    'Create one photorealistic cinematic vertical 9:16 PREVIZ frame for an ecommerce video ad.',
    'Scene '+frame.scene+', frame '+frame.frame+' ('+String(frame.frameType||'')+').',
    phaseRule,
    'Product: '+String(run.productName||''),
    'STRICT PRODUCT IDENTITY: preserve exact geometry, proportions, mounting parts, ends, material, color and texture from source product references.',
    'Product rules: '+String(run.productRules||run.product?.rules||''),
    universalProductIdentityLock(run),
    paperTowelHolderLock(run,[frame.action,frame.productPlacement,frame.productRole,frame.composition].filter(Boolean).join(' ')),
    run.character?.name?('STRICT AVATAR IDENTITY: '+String(run.character.name)+'; '+String(run.character.look||'')+'; '+String(run.character.locks||'')):'',
    'Composition: '+String(frame.composition||''),
    'Framing: '+String(frame.framing||''),
    'Camera: '+[frame.cameraAngle,frame.cameraPosition,frame.lensFeel].filter(Boolean).join('; '),
    'Environment: '+String(frame.environment||frame.location||''),
    'Lighting: '+String(frame.lighting||''),
    'Action: '+String(frame.action||''),
    'Avatar: '+String(frame.avatarDescription||''),
    'Product placement: '+String(frame.productPlacement||frame.productRole||''),
    'Continuity: '+String(frame.continuityNotes||''),
    frame.qualityNotes?('QC CORRECTION NOTES: '+String(frame.qualityNotes)):'',
    String(frame.imagePromptEn||frame.imagePromptRu||''),
    'REFERENCE HIERARCHY: generated prior frames control composition/continuity; source product and avatar references remain absolute identity locks.',
    'Make the environment lived-in, believable and commercially polished, not an empty sterile showroom.',
    'No text, no logos, no extra fingers, no product redesign, no geometry drift, no face drift.',
    frame.negativePrompt?('Negative: '+frame.negativePrompt):''
  ].filter(Boolean).join('\n').slice(0,15000);

  const credentials=higgsfieldCredentialParts();
  const client=createHiggsfieldClient({
    apiKey:credentials.apiKey,
    apiSecret:credentials.apiSecret,
    timeout:120000,
    maxRetries:2,
    pollInterval:2000,
    maxPollTime:300000
  });
  const configured=String(process.env.HIGGSFIELD_PREVIS_MODEL||'').trim();
  const models=[...new Set([configured,'nano-banana-pro','nano_banana_pro','nano_banana_2'].filter(Boolean))];
  let result=null,usedModel='',lastError=null;
  for(const model of models){
    try{
      result=await client.subscribe(model,{
        input:{
          prompt,
          aspect_ratio:'9:16',
          resolution:String(process.env.HIGGSFIELD_PREVIS_RESOLUTION||'2k'),
          ...(referenceUrls.length?{image_urls:referenceUrls.slice(0,14)}:{})
        },
        withPolling:true
      });
      const imgs=Array.isArray(result?.images)?result.images.map(x=>x?.url).filter(Boolean):[];
      if(imgs.length){usedModel=model;break}
      const status=String(result?.status||'');
      throw new Error('Higgsfield image returned no image'+(status?' · '+status:''));
    }catch(e){
      lastError=e;result=null;
      console.warn('[higgsfield-previs-model] '+model+' · '+String(e?.message||e));
    }
  }
  if(!result||!usedModel)throw new Error('Nano Banana Pro: '+String(lastError?.message||'не удалось получить изображение'));
  const imageUrl=(result.images||[]).map(x=>x?.url).find(Boolean);
  if(!imageUrl)throw new Error('Nano Banana Pro не вернул изображение');

  const rr=await fetch(imageUrl);
  if(!rr.ok)throw new Error('Не удалось скачать кадр Nano Banana Pro: HTTP '+rr.status);
  const buf=Buffer.from(await rr.arrayBuffer());
  const mimeType=rr.headers.get('content-type')||'image/png';
  const ext=mimeType.includes('jpeg')?'jpg':mimeType.includes('webp')?'webp':'png';
  const scoped=(sanitizeAccountId(accountId)+'__previs_'+String(run.id||'run')).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);
  const uploaded=await callProductMedia({
    action:'upload',
    productId:scoped,
    fileName:'previs-s'+frame.scene+'-f'+frame.frame+'-'+Date.now()+'.'+ext,
    mimeType,
    dataBase64:'data:'+mimeType+';base64,'+buf.toString('base64')
  });
  if(!uploaded?.media?.url)throw new Error('Не удалось сохранить кадр Nano Banana Pro');
  const rates=await costRates(accountId).catch(()=>({}));
  const rub=Number(rates.higgsfieldRubPerGeneration)||0;
  const usage={resolution:String(process.env.HIGGSFIELD_PREVIS_RESOLUTION||'2k'),aspectRatio:'9:16',references:referenceUrls.length,kind:'image',jobs:1,estimatedCredits:2};
  await recordExpense(accountId,{
    provider:'Higgsfield',category:'previs-image',
    description:'Nano Banana Pro · превиз сцены '+frame.scene+' · '+frame.frame,
    amountRub:rub,amountUsd:rub>0?0:higgsfieldUsageUsd('nano-banana-pro',usage),model:'Nano Banana Pro',
    usage,source:'auto-estimated'
  }).catch(()=>{});
  return {
    url:uploaded.media.url,path:uploaded.media.path||'',
    provider:'Higgsfield',model:'Nano Banana Pro',modelId:usedModel,
    references:referenceUrls,fallbackFrom:''
  };
}

async function generatePrevisImage(accountId,run,frame,referenceUrls=[],provider='openai'){
  if(provider==='openai'){
    const img=await generateOpenAIPrevisImage(accountId,run,frame,referenceUrls);
    return {...img,provider:'OpenAI',fallbackFrom:''};
  }
  return generateHiggsfieldPrevisImage(accountId,run,frame,referenceUrls);
}

async function runPrevisFrameQc(run,frame,imageUrl,accountId,previousUrl=''){
  if(!openaiConfigured())return {passed:null,score:null,summary:'OpenAI QC недоступен',issues:[]};
  const identity=primaryIdentityUrls(run);
  const productRefs=productIdentityUrls(run,3);
  const lockProduct=previsFrameShowsProduct(frame,{});
  const content=[
    {type:'input_text',text:[
      'ROLE: строгий QC-контролёр рекламного PREVIZ-кадра.',
      'Проверь КАНДИДАТ на соответствие утверждённому storyboard, фазе кадра и реальному товару.',
      'Кандидат должен быть пригоден как визуальный anchor будущего видео.',
      'Товар: '+String(run.productName||''),
      'Фаза: '+String(frame.frameType||'')+'. Сцена '+frame.scene+', кадр '+frame.frame+'.',
      'Задача/действие: '+String(frame.action||frame.goal||''),
      'Композиция: '+String(frame.composition||''),
      'Локация: '+String(frame.environment||frame.location||''),
      'ОЖИДАНИЕ ТОВАРА В ЭТОМ КАДРЕ: '+(lockProduct?'товар виден и ОБЯЗАН совпадать с исходными фото':'товар может отсутствовать'),
      universalProductIdentityLock(run),
      paperTowelHolderLock(run,[frame.action,frame.productPlacement,frame.productRole,frame.composition].filter(Boolean).join(' ')),
      paperTowelHolderLock(run,[frame.action,frame.productPlacement,frame.productRole,frame.composition].filter(Boolean).join(' ')) ? 'CRITICAL HOLDER ACTION FAIL: для этого держателя свободный конец справа и он несъёмный; рулон надевается справа налево к основанию. Снятие/откручивание торца, загрузка со стороны основания, зеркальная конструкция, съёмная ось или дополнительная опора — FAIL.' : '',
      'CRITICAL PRODUCT FAIL когда lockProduct=true и есть ЛЮБОЕ заметное изменение исходного товара: другая форма/силуэт, геометрия, пропорции, количество или расположение деталей, края/торцы/отверстия/крепления/кнопки, материал, текстура, цвет, маркировка, либо товар выглядит как другая модель.',
      "CRITICAL ACTION FAIL: START показывает уже завершённый результат, либо END почти не продвигает микро-действие относительно PREVIOUS GENERATED FRAME.",
      "Для END желательны минимум 2 заметных отличия из: действие/состояние товара, руки/поза, положение товара, крупность, угол камеры, взаимодействие с окружением. Но изменение ракурса само по себе не обязательно, если само действие визуально продвинулось.",
      'SOFT DIFFERENCES — только WARN, не FAIL: точная позиция предметов на несколько сантиметров, частичное перекрытие/неперекрытие товара телом, небольшая разница крупности, ракурса, позы, композиции, декора или расположения героя, если смысл действия сохранён.',
      'Локация должна выглядеть правдоподобно и обжито, если storyboard не требует стерильной студии.',
      'FAIL только за критическое: неверная фаза/действие, заметно неправильный товар когда он должен быть виден, другой персонаж, серьёзные артефакты рук/товара или противоречие смыслу сцены. Не требуй пиксельного совпадения со storyboard.',
      'КРИТИЧНОСТЬ: critical=true только если кадр нельзя использовать дальше без переделки: реально неправильный товар, перепутана START/END фаза целиком, другой персонаж или серьёзный артефакт. Точная поза кисти, положение миски, небольшое отличие траектории/ракурса/кадрирования — WARN и critical=false.',
      'Верни ТОЛЬКО JSON: {"passed":true,"critical":false,"score":10,"summary":"","checks":{"product":"ok|warn|fail","actionPhase":"ok|warn|fail","environment":"ok|warn|fail","avatar":"ok|warn|fail","artifacts":"ok|warn|fail"},"issues":[""]}'
    ].join('\n')},
    {type:'input_text',text:'CANDIDATE PREVIZ:'},
    {type:'input_image',image_url:imageUrl,detail:'low'}
  ];
  if(lockProduct&&productRefs.length){
    content.push({type:'input_text',text:'SOURCE PRODUCT IDENTITY — AUTHORITATIVE geometry references. Candidate must depict the same physical product model:'});
    for(const url of productRefs)content.push({type:'input_image',image_url:url,detail:'high'});
  }
  if(frame.avatarInFrame&&identity.avatar){
    content.push({type:'input_text',text:'SOURCE AVATAR IDENTITY:'});
    content.push({type:'input_image',image_url:identity.avatar,detail:'low'});
  }
  if(previousUrl){
    content.push({type:'input_text',text:'PREVIOUS GENERATED FRAME — только continuity/composition reference:'});
    content.push({type:'input_image',image_url:previousUrl,detail:'low'});
  }
  const model=process.env.OPENAI_MODEL||'gpt-6-astra';
  const r=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'content-type':'application/json'},
    body:JSON.stringify({model,input:[{role:'user',content}],reasoning:{effort:'low'},max_output_tokens:1200})
  });
  const raw=await r.text();let data;try{data=raw?JSON.parse(raw):{}}catch{data={raw}}
  if(!r.ok)throw new Error(data?.error?.message||('Previs QC error '+r.status));
  const parsed=safeAnalysisJson(openAIText(data))||{};
  const priced=openAIUsageCost(data?.model||model,data?.usage||{});
  if(priced.amountUsd>0)await recordExpense(accountId,{provider:'OpenAI',category:'previs-qc',description:'QC превиз-кадра '+frame.scene+'.'+frame.frame,amountUsd:priced.amountUsd,model:data?.model||model,usage:priced.details,source:'auto'}).catch(()=>{});
  const score=Number(parsed.score);
  const checks=parsed.checks&&typeof parsed.checks==='object'?parsed.checks:{};
  const productFail=lockProduct&&String(checks.product||'').toLowerCase()!=='ok';
  const actionFail=String(checks.actionPhase||'').toLowerCase()==='fail';
  const avatarFail=frame.avatarInFrame===true&&String(checks.avatar||'').toLowerCase()==='fail';
  const artifactsFail=String(checks.artifacts||'').toLowerCase()==='fail';
  const declaredCritical=parsed.critical===true;
  const criticalFail=productFail||avatarFail||artifactsFail||(declaredCritical&&actionFail);
  return {
    passed:!criticalFail,
    score:Number.isFinite(score)?score:null,
    summary:String(parsed.summary||'').slice(0,1200),
    checks,
    issues:Array.isArray(parsed.issues)?parsed.issues.map(String).slice(0,10):[],
    criticalFail
  };
}

async function runGeneratedSceneQc(run,scene,sceneNo,videoUrl,accountId){
  if(!openaiConfigured())return {passed:null,score:null,summary:'OpenAI QC недоступен',issues:[]};
  const dir=fs.mkdtempSync('/tmp/cf-scene-qc-');
  let evidence=null;
  try{
    const videoPath=path.join(dir,'scene.mp4');
    await downloadUrlFile(videoUrl,videoPath);
    evidence=await extractVideoEvidence(videoPath);
    const identity=primaryIdentityUrls(run);
    const sourceProducts=productIdentityUrls(run,3);
    const previs=(Array.isArray(run.previsFrames)?run.previsFrames:[])
      .filter(x=>Number(x?.scene)===Number(sceneNo)&&x?.url).sort((a,b)=>Number(a.frame)-Number(b.frame));
    const content=[{type:'input_text',text:[
      'ROLE: строгий QC-контролёр отдельной рекламной видео-сцены.',
      'Проверь реальные кадры видео против утверждённого Storyboard и референсов.',
      'Товар: '+String(run.productName||''),
      'Сцена '+sceneNo+'. Storyboard кадр: '+String(scene.shot||''),
      'Действие: '+String(scene.action||''),
      'Начало: '+String(scene.startFrame||''),
      'Конец: '+String(scene.endFrame||''),
      'Continuity: '+String(scene.continuity||''),
      universalProductIdentityLock(run),
      paperTowelHolderLock(run,[scene.action,scene.startFrame,scene.endFrame,scene.shot].filter(Boolean).join(' ')),
      paperTowelHolderLock(run,[scene.action,scene.startFrame,scene.endFrame,scene.shot].filter(Boolean).join(' ')) ? 'CRITICAL HOLDER FAIL: если есть установка/снятие рулона, свободный правый конец остаётся несъёмным; установка идёт справа налево к основанию. Нельзя откручивать/снимать торец или ось, загружать со стороны основания или зеркалить конструкцию.' : '',
      'CRITICAL FAIL только если: видимый товар заметно неправильной геометрии/конструкции; ролик показывает другое действие или обратную смысловую фазу; другой персонаж; серьёзные артефакты рук/товара.',
      'SOFT WARN, НЕ FAIL: рука движется немного в другом направлении, предмет расположен иначе, миска/реквизит частично обрезаны, небольшая разница в позе, кадрировании, траектории, крупности или композиции — если рекламный смысл и микро-действие читаются.',
      'Не требуй буквального покадрового совпадения с текстом storyboard. Storyboard задаёт смысл START→END и continuity, а не пиксельную хореографию.',
      'Среда должна выглядеть естественно и достаточно живо для рекламного ролика, но без случайного визуального мусора.',
      'CINEMA QUALITY: отдельно оцени cameraNaturalness, lightingPhysics, motionPhysics, materialRealism и cinematicComposition. Это не critical само по себе, но должно снижать score и давать точные issues для улучшения следующего дубля.',
      'Cinema Bible: '+JSON.stringify(run.previsPlan?.cinemaBible||{}),
      'Верни ТОЛЬКО JSON: {"passed":true,"critical":false,"score":10,"summary":"","checks":{"product":"ok|warn|fail","storyAction":"ok|warn|fail","avatar":"ok|warn|fail","continuity":"ok|warn|fail","environment":"ok|warn|fail","artifacts":"ok|warn|fail","cameraNaturalness":"ok|warn|fail","lightingPhysics":"ok|warn|fail","motionPhysics":"ok|warn|fail","materialRealism":"ok|warn|fail","cinematicComposition":"ok|warn|fail"},"issues":[""]}'
    ].join('\n')},...(evidence?.frames||[]).slice(0,8)];
    for(const [idx,url] of sourceProducts.entries())content.push({type:'input_text',text:'SOURCE PRODUCT IDENTITY ANGLE '+(idx+1)+':'},{type:'input_image',image_url:url,detail:'high'});
    if(identity.avatar){content.push({type:'input_text',text:'SOURCE AVATAR IDENTITY:'},{type:'input_image',image_url:identity.avatar,detail:'low'})}
    for(const f of [previs[0],previs[previs.length-1]].filter(Boolean)){
      content.push({type:'input_text',text:'APPROVED PREVIZ ANCHOR:'},{type:'input_image',image_url:f.url,detail:'low'});
    }
    const model=process.env.OPENAI_MODEL||'gpt-6-astra';
    const r=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'content-type':'application/json'},
      body:JSON.stringify({model,input:[{role:'user',content}],reasoning:{effort:'low'},max_output_tokens:1400})
    });
    const raw=await r.text();let data;try{data=raw?JSON.parse(raw):{}}catch{data={raw}}
    if(!r.ok)throw new Error(data?.error?.message||('Scene QC error '+r.status));
    const parsed=safeAnalysisJson(openAIText(data))||{};
    const priced=openAIUsageCost(data?.model||model,data?.usage||{});
    if(priced.amountUsd>0)await recordExpense(accountId,{provider:'OpenAI',category:'scene-qc',description:'QC видео-сцены '+sceneNo,amountUsd:priced.amountUsd,model:data?.model||model,usage:priced.details,source:'auto'}).catch(()=>{});
    const score=Number(parsed.score);
    const checks=parsed.checks&&typeof parsed.checks==='object'?parsed.checks:{};
    const productFail=String(checks.product||'').toLowerCase()==='fail';
    const avatarFail=String(checks.avatar||'').toLowerCase()==='fail';
    const artifactsFail=String(checks.artifacts||'').toLowerCase()==='fail';
    const storyFail=String(checks.storyAction||'').toLowerCase()==='fail';
    const criticalFail=productFail||avatarFail||artifactsFail||(parsed.critical===true&&storyFail);
    return {
      passed:!criticalFail,
      score:Number.isFinite(score)?score:null,
      summary:String(parsed.summary||'').slice(0,1600),
      checks,
      issues:Array.isArray(parsed.issues)?parsed.issues.map(String).slice(0,12):[],
      criticalFail
    };
  }finally{
    try{fs.rmSync(dir,{recursive:true,force:true})}catch{}
  }
}

async function processRunPrevis(accountId,runId){
  let state=await readAppState(accountId),data=state?.data||blankFactoryState(),run=findRunById(data,runId);
  if(!run||run.paused||run.status==='Остановлено')return {ok:false,stopped:true};
  if(run.previsResult?.completed)return {ok:true,alreadyCompleted:true};
  // previsRunning is persisted only as UI/status metadata. It must never be used as
  // a process lock because a Railway restart can leave it stuck at true forever.
  run.previsRunning=true;run.previsStartedAt=new Date().toISOString();run.previsHeartbeatAt=run.previsStartedAt;
  run.stage='Превиз-кадры';run.status='В работе';run.awaitingApproval=false;run.progress=Math.max(28,Number(run.progress)||0);run.error='';run.previsError='';run.updatedAt=new Date().toISOString();
  await writeAppState(data,accountId);
  try{
    let plan=run.previsPlan&&Array.isArray(run.previsPlan.frames)?normalizePrevisPlan(run.previsPlan,run):await generatePrevisPlan(run,accountId);
    state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
    run.previsPlan=plan;run.previsFrames=Array.isArray(run.previsFrames)?run.previsFrames:[];
    await writeAppState(data,accountId);

    for(const spec of plan.frames){
      state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
      if(!run||run.paused||run.status==='Остановлено')return {ok:false,stopped:true};
      run.previsFrames=Array.isArray(run.previsFrames)?run.previsFrames:[];
      if(run.previsFrames.some(x=>x?.id===spec.id&&x?.url))continue;

      let img=null,qc=null,lastQcError='',lastGenerationError='';
      const previous=run.previsFrames.filter(x=>Number(x?.scene)===Number(spec.scene)&&x?.url).sort((a,b)=>Number(a.frame)-Number(b.frame)).slice(-1)[0];
      const attempts=['openai','openai','openai'];

      for(let attempt=0;attempt<attempts.length;attempt++){
        const provider=attempts[attempt];
        const correction=lastQcError
          ? ('Previous candidate failed QC. Correct ALL of these issues in the new image: '+lastQcError)
          : '';
        const attemptSpec={...spec,productInFrame:previsFrameShowsProduct(spec,{}),qualityNotes:[String(spec.qualityNotes||''),correction].filter(Boolean).join('\n').slice(0,3500)};
        const refs=previsRefsForFrame(run,attemptSpec,run.previsFrames);
        try{
          img=await generatePrevisImage(accountId,run,attemptSpec,refs,provider);
        }catch(e){
          lastGenerationError=String(e?.message||e);
          img=null;
          console.warn('[previs-generator] '+provider+' · scene '+spec.scene+' frame '+spec.frame+' · '+lastGenerationError);
          continue;
        }
        try{
          qc=await runPrevisFrameQc(run,attemptSpec,img.url,accountId,previous?.url||'');
        }catch(e){
          qc={passed:null,score:null,summary:'QC недоступен: '+String(e?.message||e),issues:[]};
        }
        if(qc.passed!==false)break;
        lastQcError=(qc.issues||[]).join('; ')||qc.summary||'кадр не прошёл QC';
        if(img?.path){try{await callProductMedia({action:'delete',path:img.path})}catch{}}
        img=null;
      }

      if(!img)throw new Error(
        'Сцена '+spec.scene+', кадр '+spec.frame+' не получен после '+attempts.length+' попыток. '+
        (lastQcError?('Критический QC: '+lastQcError):('Генерация: '+lastGenerationError))
      );

      state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
      run.previsFrames=Array.isArray(run.previsFrames)?run.previsFrames:[];
      run.previsFrames.push({...spec,...img,qc,generatedAt:new Date().toISOString()});
      run.progress=Math.min(36,28+Math.round((run.previsFrames.filter(x=>x?.url).length/Math.max(1,plan.frames.length))*8));
      run.previsHeartbeatAt=new Date().toISOString();
      run.updatedAt=run.previsHeartbeatAt;
      appendFactoryJournal(
        data,'Превиз-кадр готов',
        (run.productName||run.id)+' · сцена '+spec.scene+' · кадр '+spec.frame+
        ' · '+String(img.provider||img.model||'generator')+
        (img.fallbackFrom?' · fallback':'')+
        (qc?.score?' · QC '+qc.score+'/10':'')
      );
      await writeAppState(data,accountId);
    }

    state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
    const expected=Number(plan.totalFrames)||plan.frames.length;
    const ready=(run.previsFrames||[]).filter(x=>x?.url).length;
    run.previsRunning=false;run.previsStartedAt=null;run.previsHeartbeatAt=new Date().toISOString();
    run.previsResult={
      completed:Boolean(expected&&ready>=expected),
      totalFrames:ready,totalScenes:plan.totalScenes,
      generator:'OpenAI GPT Image',
      fallback:'',
      completedAt:ready>=expected?new Date().toISOString():null
    };
    run.references={
      ...(run.references||{}),
      style:String(run.style||''),
      notes:'Generated previz controls composition; source product/avatar remain strict identity locks.',
      product:(run.media||run.product?.media||[]).map(x=>x?.url).filter(Boolean),
      avatar:(run.avatarReferences||run.character?.media||[]).map(x=>x?.url).filter(Boolean)
    };
    run.updatedAt=new Date().toISOString();
    appendFactoryJournal(data,'Превиз готов',(run.productName||run.id)+' · '+ready+'/'+expected+' кадров · OpenAI GPT Image');

    if(run.mode==='manual'){
      run.status='На проверке';run.stage='Превиз-кадры';run.progress=36;run.awaitingApproval=true;
      await writeAppState(data,accountId);
    }else{
      if(!run.previsResult.completed)throw new Error('Превиз неполный: '+ready+' из '+expected);
      run.status='В работе';run.stage='Генерация';run.progress=38;run.awaitingApproval=false;
      await writeAppState(data,accountId);
      await dispatchExistingRun(accountId,run);
    }
    return {ok:true,totalFrames:ready};
  }catch(e){
    state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
    if(run){
      run.previsRunning=false;run.previsStartedAt=null;run.previsHeartbeatAt=new Date().toISOString();run.status='Ошибка';run.stage='Превиз-кадры';run.previsError=String(e?.message||e);run.error='Превиз: '+run.previsError;run.updatedAt=run.previsHeartbeatAt;
      appendFactoryJournal(data,'Ошибка превиза',(run.productName||run.id)+' · '+run.previsError);
      await writeAppState(data,accountId);
    }
    return {ok:false,error:String(e?.message||e)};
  }
}
function previsSceneReferenceUrls(run,sceneNo){
  const frames=(Array.isArray(run?.previsFrames)?run.previsFrames:[])
    .filter(x=>Number(x?.scene)===Number(sceneNo)&&/^https:\/\//i.test(String(x?.url||'')))
    .sort((a,b)=>Number(a.frame)-Number(b.frame));
  const identity=runReferenceUrls(run);
  const anchors=frames.length
    ? [frames[0]?.url,frames[Math.floor((frames.length-1)/2)]?.url,frames[frames.length-1]?.url].filter(Boolean)
    : [];
  return [...new Set([...anchors.slice(0,2),...identity])].slice(0,6);
}
async function processAutoPipeline(accountId,runId){
  let state=await readAppState(accountId),data=state?.data||blankFactoryState(),run=findRunById(data,runId);
  if(!run||run.paused||run.status==='Остановлено')return {ok:false,stopped:true};
  if(run.mode==='manual')return {ok:true,manual:true};
  try{
    if(!run.idea){
      const idea=await generateIdeaStage(run,accountId,run.variant||1);
      state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
      run.idea=idea;syncRunIdeaLibrary(data,run);run.progress=10;run.updatedAt=new Date().toISOString();
      if(run.mode==='manual'){
        run.stage='Идея';run.status='На проверке';run.awaitingApproval=true;
        await writeAppState(data,accountId);
        return {ok:true,manual:true,stage:'Идея'};
      }
      run.stage='Сценарий';run.status='В работе';run.awaitingApproval=false;
      await writeAppState(data,accountId);
    }
    if(!run.script){
      const script=await generateScriptStage(run,accountId);
      state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
      run.script=script;run.progress=18;run.updatedAt=new Date().toISOString();
      if(run.mode==='manual'){
        run.stage='Сценарий';run.status='На проверке';run.awaitingApproval=true;
        await writeAppState(data,accountId);
        return {ok:true,manual:true,stage:'Сценарий'};
      }
      run.stage='Storyboard';run.status='В работе';run.awaitingApproval=false;
      await writeAppState(data,accountId);
    }
    if(!Array.isArray(run.storyboard)||!run.storyboard.length){
      const storyboard=await generateStoryboardStage(run,accountId);
      state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
      run.storyboard=storyboard;run.sceneCount=storyboard.length;run.sceneVersions=Object.fromEntries(storyboard.map((_,i)=>[i+1,1]));run.progress=26;run.updatedAt=new Date().toISOString();
      if(run.mode==='manual'){
        run.stage='Storyboard';run.status='На проверке';run.awaitingApproval=true;
        await writeAppState(data,accountId);
        return {ok:true,manual:true,stage:'Storyboard'};
      }
      run.stage='Превиз-кадры';run.status='В работе';run.awaitingApproval=false;
      await writeAppState(data,accountId);
    }
    state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
    if(run?.mode==='manual')return {ok:true,manual:true,stage:run.stage};
    return await processRunPrevis(accountId,runId);
  }catch(e){
    state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
    if(run){run.status='Ошибка';run.error='Автопилот: '+String(e?.message||e);run.updatedAt=new Date().toISOString();await writeAppState(data,accountId)}
    return {ok:false,error:String(e?.message||e)};
  }
}
function enqueueAutoPipeline(accountId,runId){
  const account=sanitizeAccountId(accountId||DEFAULT_ACCOUNT_ID);
  return enqueueAccountBackground(account,'autopilot:'+String(runId),()=>processAutoPipeline(account,runId),'autopilot-background');
}

async function buildRunPlan(payload,accountId,variant=1,feedback=''){
  if(!openaiConfigured())throw new Error('OpenAI API is not configured');
  const lockedIdea=payload.idea?normalizeIdeaStage(payload.idea,payload):await generateIdeaStage(payload,accountId,variant,feedback);
  const scriptPayload={...payload,idea:lockedIdea};
  const lockedScript=payload.script?normalizeScriptStage(payload.script,scriptPayload):await generateScriptStage(scriptPayload,accountId,feedback);
  const storyboardPayload={...payload,idea:lockedIdea,script:lockedScript};
  const lockedStoryboard=Array.isArray(payload.storyboard)&&payload.storyboard.length
    ? normalizeStoryboardStage(payload.storyboard,storyboardPayload)
    : await generateStoryboardStage(storyboardPayload,accountId,feedback);
  const productRefs=(payload.media||payload.product?.media||[]).map(x=>x?.url).filter(Boolean).slice(0,6);
  const avatarRefs=(payload.avatarReferences||payload.character?.media||[]).map(x=>x?.url).filter(Boolean).slice(0,6);
  return {
    idea:lockedIdea,
    script:lockedScript,
    storyboard:lockedStoryboard,
    references:{
      product:productRefs,
      avatar:avatarRefs,
      style:String(payload.style||'').slice(0,2000),
      notes:'Главное фото товара — эталон. Сохранять реальный товар и внешность выбранного AI-аватара.'
    }
  };
}

function findRunById(data,runId){
  return (Array.isArray(data?.runs)?data.runs:[]).find(r=>r?.id===runId)||null;
}
function invalidateAfterPrevisChange(run){
  run.sceneResults={};
  run.generationResult=null;
  run.acceptedScenes=[];
  run.voiceoverResult=null;
  run.montageResult=null;
  run.qcResult=null;
  run.backendGenerationRunning=false;
  run.postProductionRunning=false;
  run.generationError='';
  run.error='';
  run.stage='Превиз-кадры';
  run.status='На проверке';
  run.awaitingApproval=true;
  run.progress=Math.min(36,Math.max(28,Number(run.progress)||28));
  run.updatedAt=new Date().toISOString();
}
function runKnownMediaUrls(data,accountId){
  const set=new Set();
  for(const product of (Array.isArray(data?.products)?data.products:[])){
    for(const m of (Array.isArray(product?.media)?product.media:[]))if(m?.url)set.add(String(m.url));
  }
  for(const c of (Array.isArray(data?.characters)?data.characters:[])){
    for(const m of (Array.isArray(c?.media)?c.media:[]))if(m?.url)set.add(String(m.url));
  }
  for(const run of (Array.isArray(data?.runs)?data.runs:[])){
    for(const f of (Array.isArray(run?.previsFrames)?run.previsFrames:[]))if(f?.url)set.add(String(f.url));
    for(const u of (Array.isArray(run?.generationResult?.urls)?run.generationResult.urls:[]))if(u)set.add(String(u));
    for(const sr of Object.values(run?.sceneResults||{})){
      if(sr?.url)set.add(String(sr.url));
      for(const u of (Array.isArray(sr?.urls)?sr.urls:[]))if(u)set.add(String(u));
    }
    if(run?.montageResult?.url)set.add(String(run.montageResult.url));
    if(run?.finalMedia?.url)set.add(String(run.finalMedia.url));
  }
  for(const m of (Array.isArray(data?.mediaLibrary)?data.mediaLibrary:[]))if(m?.url)set.add(String(m.url));
  return set;
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
  out.savedIdeas=Array.isArray(existingData.savedIdeas)?existingData.savedIdeas:[];
  out.mediaLibrary=mergeByIdPreserveExisting(existingData.mediaLibrary,incomingData.mediaLibrary,10000);
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
  const productRefs=productIdentityUrls(run,2);
  const avatarRefs=avatarIdentityUrls(run,1);
  return [...new Set([...productRefs,...avatarRefs].filter(Boolean))];
}
function sceneDurationSeconds(scene){
  const nums=String(scene?.duration||'').match(/\d+(?:[.,]\d+)?/g)||[];
  let base=5;
  if(nums.length>=2){
    const a=Number(nums[0].replace(',','.')),b=Number(nums[1].replace(',','.'));
    if(Number.isFinite(a)&&Number.isFinite(b)&&b>a)base=Math.max(4,Math.min(15,Math.round(b-a)));
  }else if(nums.length===1){
    const n=Number(nums[0].replace(',','.'));if(Number.isFinite(n))base=Math.max(4,Math.min(15,Math.round(n)));
  }
  const text=[scene?.action,scene?.startFrame,scene?.endFrame,scene?.shot].filter(Boolean).join(' ').toLowerCase();
  const physical=(text.match(/рук|кист|пальц|hand|встав|надев|сним|устанав|закреп|тян|вращ|скольз|налив|pour|attach|install|remove|slide|twist/g)||[]).length;
  const multi=(text.match(/затем|после|потом|одновременно|then|while|and then/g)||[]).length;
  if(physical>=2)base=Math.max(base,6);
  if(physical>=3||multi>=2)base=Math.max(base,7);
  return Math.max(4,Math.min(15,base));
}
function enqueueRunGeneration(accountId,runId,label='backend-generation'){
  const account=sanitizeAccountId(accountId||DEFAULT_ACCOUNT_ID);
  return enqueueAccountBackground(account,'generation:'+String(runId),()=>processRunGeneration(account,runId),label);
}
function enqueuePostProduction(accountId,runId,label='post-production'){
  const account=sanitizeAccountId(accountId||DEFAULT_ACCOUNT_ID);
  return enqueueAccountBackground(account,'post-production:'+String(runId),()=>processRunPostProduction(account,runId),label);
}
async function fileHasAudio(filePath){
  try{
    const {stdout}=await execFile('ffprobe',['-v','error','-select_streams','a','-show_entries','stream=index','-of','csv=p=0',filePath],{timeout:15000});
    return Boolean(String(stdout||'').trim());
  }catch{return false}
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
  return board.map((scene,i)=>{
    const voiceover=String(scene?.voiceover||'').trim();
    const dialogue=String(scene?.dialogue||'').trim();
    const text=voiceover || dialogue;
    return {
      scene:i+1,
      duration:sceneDurationSeconds(scene),
      text,
      source:voiceover?'voiceover':dialogue?'dialogue-as-narration':'none'
    };
  });
}

async function generateOpenAITts(text,instructions='',voice='coral'){
  if(!openaiConfigured())throw new Error('OpenAI TTS не настроен');
  const body={model:'gpt-4o-mini-tts',voice:String(voice||'coral'),input:String(text||'').slice(0,4000),response_format:'mp3'};
  if(String(instructions||'').trim())body.instructions=String(instructions).slice(0,1800);
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
  const avatarVoice=String(run?.character?.voice||'').trim();
  const instructions=[
    'Говори на естественном разговорном русском языке как живой UGC-автор, а не диктор рекламы.',
    'Один и тот же голос и характер на всём ролике. Тёплая, уверенная, спокойная подача.',
    'Короткие естественные фразы, микропаузы между смысловыми частями, лёгкая улыбка там, где уместно.',
    'Без театральности, без радиодикторской интонации, без чрезмерных ударений, без монотонного роботизированного ритма.',
    'Не спеши; окончания фраз не проглатывай.',
    avatarVoice?('Манера конкретного AI-аватара: '+avatarVoice):''
  ].filter(Boolean).join(' ');
  const voice='coral';
  const wavs=[],spoken=[];
  for(const line of lines){
    const wav=path.join(dir,'voice-'+line.scene+'.wav');
    if(line.text){
      const mp3=path.join(dir,'voice-'+line.scene+'.mp3');
      fs.writeFileSync(mp3,await generateOpenAITts(line.text,instructions,voice));
      const rawDur=await probeDuration(mp3);
      const target=Math.max(0.8,Number(line.duration)||5);
      const available=Math.max(0.6,target-0.35);
      const tempo=rawDur>available?Math.min(1.22,rawDur/available):1;
      const filters=[];
      if(tempo>1.001)filters.push('atempo='+tempo.toFixed(4));
      filters.push('afade=t=in:st=0:d=0.04');
      filters.push('adelay=120|120');
      filters.push('apad');
      filters.push('atrim=0:'+target.toFixed(3));
      filters.push('afade=t=out:st='+Math.max(0,target-0.08).toFixed(3)+':d=0.08');
      filters.push('loudnorm=I=-18:TP=-2:LRA=7');
      await execFile('ffmpeg',['-hide_banner','-loglevel','error','-i',mp3,'-af',filters.join(','),'-ar','48000','-ac','2','-c:a','pcm_s16le','-y',wav],{timeout:120000});
      spoken.push({scene:line.scene,text:line.text,duration:target,source:line.source,rawDuration:Math.round(rawDur*100)/100});
    }else{
      await execFile('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t',String(line.duration),'-c:a','pcm_s16le','-y',wav],{timeout:30000});
    }
    wavs.push(wav);
  }
  const list=path.join(dir,'voice-list.txt');
  fs.writeFileSync(list,wavs.map(x=>"file '"+x.replace(/'/g,"'\\''")+"'").join('\n'));
  const out=path.join(dir,'voiceover.wav');
  await execFile('ffmpeg',['-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',list,'-c:a','pcm_s16le','-y',out],{timeout:120000});
  return {path:out,spoken,provider:'openai',model:'gpt-4o-mini-tts',voice,instructions};
}

async function assembleRunVideo(run,dir,voicePath){
  const urls=(run?.generationResult?.urls||[]).filter(Boolean);
  if(!urls.length)throw new Error('Нет сгенерированных сцен для монтажа');
  const normalized=[];
  for(let i=0;i<urls.length;i++){
    const srcFile=path.join(dir,'scene-'+(i+1)+'.mp4');
    const norm=path.join(dir,'scene-'+(i+1)+'-norm.mp4');
    await downloadUrlFile(urls[i],srcFile);
    const dur=Math.max(0.5,await probeDuration(srcFile));
    const hasAudio=await fileHasAudio(srcFile);
    if(hasAudio){
      await execFile('ffmpeg',[
        '-hide_banner','-loglevel','error','-i',srcFile,
        '-vf','scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black,fps=30',
        '-map','0:v:0','-map','0:a:0',
        '-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p',
        '-c:a','aac','-b:a','128k','-ar','48000','-ac','2',
        '-movflags','+faststart','-y',norm
      ],{timeout:240000});
    }else{
      await execFile('ffmpeg',[
        '-hide_banner','-loglevel','error','-i',srcFile,
        '-f','lavfi','-t',String(dur),'-i','anullsrc=r=48000:cl=stereo',
        '-vf','scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black,fps=30',
        '-map','0:v:0','-map','1:a:0','-shortest',
        '-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p',
        '-c:a','aac','-b:a','128k','-ar','48000','-ac','2',
        '-movflags','+faststart','-y',norm
      ],{timeout:240000});
    }
    normalized.push(norm);
  }
  const list=path.join(dir,'video-list.txt');
  fs.writeFileSync(list,normalized.map(x=>"file '"+x.replace(/'/g,"'\\''")+"'").join('\n'));
  const combined=path.join(dir,'combined.mp4');
  await execFile('ffmpeg',['-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',list,'-c','copy','-movflags','+faststart','-y',combined],{timeout:120000});
  const totalDur=Math.max(1,await probeDuration(combined));
  const finalPath=path.join(dir,'final.mp4');
  const hasVoice=Boolean(voicePath&&fs.existsSync(voicePath));
  const args=['-hide_banner','-loglevel','error','-i',combined];
  if(hasVoice)args.push('-i',voicePath);
  args.push('-f','lavfi','-t',String(totalDur),'-i','anoisesrc=color=pink:amplitude=0.015:r=48000');
  const roomIndex=hasVoice?2:1;
  const filters=[
    '[0:a]volume=0.28[scene]',
    '['+roomIndex+':a]highpass=f=80,lowpass=f=5500,volume=0.06[room]'
  ];
  if(hasVoice){
    filters.push('[1:a]volume=1.0[voice]');
    filters.push('[scene][room][voice]amix=inputs=3:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]');
  }else{
    filters.push('[scene][room]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]');
  }
  args.push('-filter_complex',filters.join(';'),'-map','0:v:0','-map','[aout]','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-shortest','-movflags','+faststart','-y',finalPath);
  try{
    await execFile('ffmpeg',args,{timeout:180000});
  }catch(e){
    const fallback=['-hide_banner','-loglevel','error','-i',combined];
    if(hasVoice){
      fallback.push('-i',voicePath,'-filter_complex','[0:a]volume=0.25[a0];[1:a]volume=1.0[a1];[a0][a1]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]','-map','0:v:0','-map','[aout]');
    }else fallback.push('-map','0:v:0','-map','0:a:0');
    fallback.push('-c:v','copy','-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart','-y',finalPath);
    await execFile('ffmpeg',fallback,{timeout:180000});
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
  if(!openaiConfigured())return {passed:null,score:null,summary:'OpenAI недоступен — визуальная AI-проверка не выполнена.',issues:[]};
  let evidence=null;
  try{
    evidence=await extractVideoEvidence(finalPath);
    const identity=primaryIdentityUrls(run);
    const sourceProducts=productIdentityUrls(run,3);
    const content=[{type:'input_text',text:[
      'ROLE: финальный строгий QC-аудитор вертикального рекламного ролика.',
      'Проверяй только видимое. Сравни финал с утверждённой идеей, сценарием, storyboard, исходным товаром и continuity.',
      'Товар: '+String(run.productName||''),
      'Правила товара: '+String(run.productRules||run.product?.rules||''),
      universalProductIdentityLock(run),
      'Идея: '+JSON.stringify(run.idea||{}),
      'Сценарий: '+JSON.stringify(run.script||{}),
      'CRITICAL FAIL: любое заметное изменение исходного товара — геометрии, пропорций, количества/расположения деталей, креплений, торцов, материала, цвета или конструкции; также потеря ключевого действия/payoff, грубая смена персонажа/локации, серьёзные артефакты, пропущенная/дублированная сцена, неправильный формат.',
      'Оцени также живость окружения, монтажную связность, понятность проблемы→решения, естественность рекламы и соответствие 9:16.',
      'CINEMA QC: оцени физическую мотивированность света, естественность camera movement, отсутствие стерильно-плавающей камеры, правдоподобный вес/контакт движений, разнообразие крупностей и углов, цветовую/световую continuity между соседними сценами. Эти пункты дают WARN/снижают score, но становятся critical только если реально ломают сцену.',
      'DIRECTOR CUT: смотри ролик как режиссёр после первого монтажа. Если 1–2 конкретные сцены заметно тянут ролик вниз по удержанию/динамике/киношности, укажи их номера для пересъёмки. Не отправляй сцену на пересъёмку ради мелочи. Для каждой такой сцены дай точную постановочную правку и preferredProvider runway|seedance. Также дай монтажные замечания, которые не требуют пересъёмки.',
      'Storyboard для нумерации сцен: '+JSON.stringify(run.storyboard||[]),
      'Scene QC map: '+JSON.stringify(Object.fromEntries(Object.entries(run.sceneResults||{}).map(([k,v])=>[k,{score:v?.qc?.score,checks:v?.qc?.checks,issues:v?.qc?.issues,provider:v?.routerProvider||v?.provider}]))),
      'Верни ТОЛЬКО JSON: {"passed":true,"score":10,"summary":"","checks":{"productConsistency":"ok|warn|fail","scriptCompliance":"ok|warn|fail","storyboardCompliance":"ok|warn|fail","avatarConsistency":"ok|warn|fail","environment":"ok|warn|fail","visualArtifacts":"ok|warn|fail","continuity":"ok|warn|fail","verticalFormat":"ok|warn|fail","payoff":"ok|warn|fail","lightingPhysics":"ok|warn|fail","cameraNaturalness":"ok|warn|fail","motionPhysics":"ok|warn|fail","shotVariety":"ok|warn|fail","colorContinuity":"ok|warn|fail"},"issues":[""],"directorCut":{"score":10,"reshootScenes":[1],"sceneNotes":[{"scene":1,"issue":"","fix":"","preferredProvider":"runway|seedance"}],"montageActions":[""],"reason":""}}'
    ].join('\n')},...(evidence.frames||[]).slice(0,8)];
    for(const [idx,url] of sourceProducts.entries())content.push({type:'input_text',text:'SOURCE PRODUCT IDENTITY ANGLE '+(idx+1)+':'},{type:'input_image',image_url:url,detail:'high'});
    if(identity.avatar){content.push({type:'input_text',text:'SOURCE AVATAR IDENTITY:'},{type:'input_image',image_url:identity.avatar,detail:'low'})}
    const model=process.env.OPENAI_MODEL||'gpt-6-astra';
    const r=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',
      headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'content-type':'application/json'},
      body:JSON.stringify({model,input:[{role:'user',content}],reasoning:{effort:'medium'},max_output_tokens:2200})
    });
    const raw=await r.text();let response;try{response=raw?JSON.parse(raw):{}}catch{response={raw}}
    if(!r.ok)throw new Error(response?.error?.message||('OpenAI QC error '+r.status));
    const parsed=safeAnalysisJson(openAIText(response))||{};
    const priced=openAIUsageCost(response?.model||model,response?.usage||{});
    if(priced.amountUsd>0)await recordExpense(accountId,{provider:'OpenAI',category:'qc',description:'AI-проверка финального ролика',amountUsd:priced.amountUsd,model:response?.model||model,usage:priced.details,source:'auto'}).catch(()=>{});
    const score=Number(parsed.score);
    return {
      passed:parsed?.passed!==false&&(!Number.isFinite(score)||score>=8),
      score:Number.isFinite(score)?score:null,
      summary:String(parsed?.summary||'AI-проверка завершена.').slice(0,3000),
      checks:parsed?.checks&&typeof parsed.checks==='object'?parsed.checks:{},
      issues:Array.isArray(parsed?.issues)?parsed.issues.map(x=>String(x)).slice(0,20):[],
      directorCut:parsed?.directorCut&&typeof parsed.directorCut==='object'?{
        score:Number.isFinite(Number(parsed.directorCut.score))?Number(parsed.directorCut.score):null,
        reshootScenes:Array.isArray(parsed.directorCut.reshootScenes)?[...new Set(parsed.directorCut.reshootScenes.map(Number).filter(n=>Number.isInteger(n)&&n>0))].slice(0,2):[],
        sceneNotes:Array.isArray(parsed.directorCut.sceneNotes)?parsed.directorCut.sceneNotes.slice(0,4).map(x=>({scene:Number(x?.scene)||0,issue:String(x?.issue||'').slice(0,1200),fix:String(x?.fix||'').slice(0,1800),preferredProvider:/seedance/i.test(String(x?.preferredProvider||''))?'seedance':'runway'})):[],
        montageActions:Array.isArray(parsed.directorCut.montageActions)?parsed.directorCut.montageActions.map(String).slice(0,8):[],
        reason:String(parsed.directorCut.reason||'').slice(0,2000)
      }:{score:null,reshootScenes:[],sceneNotes:[],montageActions:[],reason:''},
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
  const total=Number(run.generationResult?.totalScenes||0);
  const generatedUrls=Array.isArray(run.generationResult?.urls)?run.generationResult.urls.filter(Boolean):[];
  const accepted=new Set((Array.isArray(run.acceptedScenes)?run.acceptedScenes:[]).map(Number).filter(n=>n>=1&&n<=total));
  if(!run.generationResult?.completed||!total||generatedUrls.length<total){
    return {ok:false,error:'Видео-сцены ещё не сгенерированы полностью'};
  }
  if(accepted.size<total)return {ok:false,error:'Не все видео-сцены подтверждены'};
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
      run.voiceoverResult={ok:true,provider:voice.provider,model:voice.model,voice:voice.voice,voiceStyle:voice.instructions,soundDesign:'scene-audio + continuous room tone + narration',spokenScenes:voice.spoken,completedAt:new Date().toISOString()};
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
    run.postProductionRunning=false;run.error='';run.updatedAt=new Date().toISOString();

    const dc=qc?.directorCut&&typeof qc.directorCut==='object'?qc.directorCut:{reshootScenes:[]};
    const dcPass=Number(run.directorCut?.pass)||0;
    const dcScenes=(Array.isArray(dc.reshootScenes)?dc.reshootScenes:[])
      .map(Number).filter(n=>Number.isInteger(n)&&n>=1&&n<=(run.storyboard||[]).length).slice(0,2);
    const finalScore=Number(qc?.score);
    if(run.mode!=='manual'&&dcPass<1&&dcScenes.length&&(!Number.isFinite(finalScore)||finalScore<9.3)){
      run.sceneVersions=run.sceneVersions&&typeof run.sceneVersions==='object'?run.sceneVersions:{};
      const noteMap=new Map((Array.isArray(dc.sceneNotes)?dc.sceneNotes:[]).map(x=>[Number(x?.scene),x]));
      for(const sceneNo of dcScenes){
        const old=run.sceneResults?.[sceneNo];
        if(old){
          run.sceneVersions[sceneNo]=Array.isArray(run.sceneVersions[sceneNo])?run.sceneVersions[sceneNo]:[];
          run.sceneVersions[sceneNo].push({...old,archivedAt:new Date().toISOString(),reason:'director-cut'});
          run.sceneVersions[sceneNo]=run.sceneVersions[sceneNo].slice(-5);
        }
        if(run.sceneResults)delete run.sceneResults[sceneNo];
        const note=noteMap.get(sceneNo)||{};
        if(run.storyboard?.[sceneNo-1])run.storyboard[sceneNo-1].directorCutNotes=[note.issue,note.fix].filter(Boolean).join(' | ').slice(0,2600);
        if(run.sceneRouting?.[sceneNo]){
          const preferred=note.preferredProvider==='seedance'?'seedance':'runway';
          run.sceneRouting[sceneNo]={...run.sceneRouting[sceneNo],provider:preferred,source:'director-cut',reason:'Director Cut: '+String(note.fix||note.issue||dc.reason||'улучшить слабую сцену').slice(0,700)};
        }
      }
      run.directorCut={
        pass:dcPass+1,status:'reshooting',score:Number.isFinite(Number(dc.score))?Number(dc.score):null,
        reshootScenes:dcScenes,sceneNotes:dc.sceneNotes||[],montageActions:dc.montageActions||[],reason:dc.reason||'',
        requestedAt:new Date().toISOString()
      };
      const remaining=Object.values(run.sceneResults||{}).filter(x=>x?.ok&&x?.urls?.length&&x?.qc?.passed!==false).length;
      run.generationResult={provider:'mixed',urls:Object.keys(run.sceneResults||{}).sort((a,b)=>Number(a)-Number(b)).flatMap(k=>run.sceneResults[k]?.urls||[]),completedScenes:remaining,totalScenes:(run.storyboard||[]).length,completed:false};
      run.acceptedScenes=[];
      run.montageResult=null;run.qcResult=null;
      run.backendGenerationRunning=false;run.postProductionRunning=false;
      run.stage='Director Cut · пересъёмка';run.status='В работе';run.progress=42;run.awaitingApproval=false;
      appendFactoryJournal(data,'Director Cut отправил сцены на пересъёмку',(run.productName||run.id)+' · сцены '+dcScenes.join(', ')+' · '+String(dc.reason||'улучшение удержания/киношности'));
      await writeAppState(data,accountId);
      enqueueRunGeneration(accountId,run.id,'director-cut-reshoot');
      return {ok:true,directorCut:true,reshootScenes:dcScenes};
    }
    if(run.directorCut?.status==='reshooting'){
      run.directorCut={...run.directorCut,status:'completed',completedAt:new Date().toISOString(),finalScore:Number.isFinite(finalScore)?finalScore:null};
    }
    if(run.mode==='manual'){
      run.stage='На проверке';run.status='На проверке';run.awaitingApproval=true;run.progress=95;
      appendFactoryJournal(data,'Финальный ролик готов к проверке',(run.productName||run.id)+' · '+String(qc?.summary||''));
    }else if(qc?.passed===false){
      run.stage='AI-проверка';run.status='Ошибка';run.awaitingApproval=false;run.progress=92;
      run.error='Финальный QC не пройден: '+String((qc?.issues||[]).join('; ')||qc?.summary||'качество ниже порога');
      appendFactoryJournal(data,'Финальный QC не пройден',(run.productName||run.id)+' · '+run.error);
    }else{
      run.stage='Готово';run.status='Готово';run.awaitingApproval=false;run.progress=100;
      appendFactoryJournal(data,'Автопилот завершил ролик',(run.productName||run.id)+' · '+String(qc?.summary||''));
    }
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

function enqueueSpecificPostStage(accountId,runId,stage){
  const account=sanitizeAccountId(accountId||DEFAULT_ACCOUNT_ID);
  return enqueueAccountBackground(account,'post-stage:'+String(runId)+':'+String(stage),()=>processSpecificPostStage(account,runId,stage),'post-stage');
}
async function processSpecificPostStage(accountId,runId,stage){
  let state=await readAppState(accountId),data=state?.data||blankFactoryState(),run=findRunById(data,runId);
  if(!run||run.paused||run.status==='Остановлено')return {ok:false,stopped:true};
  if(run.postProductionRunning)return {ok:true,alreadyRunning:true};
  const total=Number(run.generationResult?.totalScenes||0);
  const generatedUrls=Array.isArray(run.generationResult?.urls)?run.generationResult.urls.filter(Boolean):[];
  const accepted=new Set((Array.isArray(run.acceptedScenes)?run.acceptedScenes:[]).map(Number).filter(n=>n>=1&&n<=total));
  if(!run.generationResult?.completed||!total||generatedUrls.length<total)throw new Error('Видео-сцены ещё не сгенерированы полностью');
  if(accepted.size<total)throw new Error('Не все видео-сцены подтверждены');
  const dir=fs.mkdtempSync('/tmp/cf-post-stage-');
  try{
    run.postProductionRunning=true;run.status='В работе';run.stage=stage;run.awaitingApproval=false;run.error='';
    run.updatedAt=new Date().toISOString();
    appendFactoryJournal(data,'Переделывается этап',(run.productName||run.id)+' · '+stage);
    await writeAppState(data,accountId);

    let voicePath=null;
    if(stage==='Озвучка'||stage==='Монтаж'){
      const voice=await createRunVoiceover(run,dir);
      voicePath=voice.path;
      if(stage==='Озвучка'){
        state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
        run.voiceoverResult={ok:true,provider:voice.provider,model:voice.model,voice:voice.voice,voiceStyle:voice.instructions,soundDesign:'scene-audio + continuous room tone + narration',spokenScenes:voice.spoken,completedAt:new Date().toISOString()};
        run.montageResult=null;run.qcResult=null;run.progress=80;run.updatedAt=new Date().toISOString();
        appendFactoryJournal(data,'Озвучка переделана',(run.productName||run.id)+' · '+voice.spoken.length+' сцен');
        await writeAppState(data,accountId);
      }
    }

    if(stage==='Озвучка'||stage==='Монтаж'){
      state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
      run.stage='Монтаж';run.status='В работе';run.updatedAt=new Date().toISOString();await writeAppState(data,accountId);
      const finalPath=await assembleRunVideo(run,dir,voicePath);
      const media=await uploadRunMedia(accountId,runId,finalPath,'final-'+runId+'.mp4','video/mp4');
      state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
      run.montageResult={ok:true,url:media?.url||'',path:media?.path||'',fileName:media?.fileName||('final-'+runId+'.mp4'),durationSeconds:Math.round(await probeDuration(finalPath)),completedAt:new Date().toISOString()};
      run.qcResult=null;run.stage='AI-проверка';run.progress=88;run.updatedAt=new Date().toISOString();
      appendFactoryJournal(data,'Монтаж переделан',run.productName||run.id);await writeAppState(data,accountId);

      const qc=await runFinalQc(run,finalPath,accountId);
      state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
      run.qcResult={...qc,completedAt:new Date().toISOString()};
      run.postProductionRunning=false;run.error='';run.updatedAt=new Date().toISOString();
      run.stage='На проверке';run.status='На проверке';run.awaitingApproval=true;run.progress=95;
      appendFactoryJournal(data,'Зависимые этапы обновлены',(run.productName||run.id)+' · '+stage+' → монтаж → AI-проверка');
      await writeAppState(data,accountId);
      return {ok:true,run};
    }

    if(stage==='AI-проверка'){
      if(!run.montageResult?.url)throw new Error('Сначала нужен готовый монтаж');
      const finalPath=path.join(dir,'final.mp4');
      await downloadUrlFile(run.montageResult.url,finalPath);
      const qc=await runFinalQc(run,finalPath,accountId);
      state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
      run.qcResult={...qc,completedAt:new Date().toISOString()};
      run.postProductionRunning=false;run.error='';run.updatedAt=new Date().toISOString();
      run.stage='На проверке';run.status='На проверке';run.awaitingApproval=true;run.progress=95;
      appendFactoryJournal(data,'AI-проверка переделана',(run.productName||run.id)+' · '+String(qc?.summary||''));
      await writeAppState(data,accountId);
      return {ok:true,run};
    }
    throw new Error('Неизвестный этап постобработки');
  }catch(e){
    state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
    if(run){
      run.postProductionRunning=false;run.status='Ошибка';run.stage=stage;run.error=stage+': '+String(e?.message||e);run.updatedAt=new Date().toISOString();
      appendFactoryJournal(data,'Ошибка переделки этапа',(run.productName||run.id)+' · '+run.error);
      await writeAppState(data,accountId);
    }
    return {ok:false,error:String(e?.message||e)};
  }finally{
    try{fs.rmSync(dir,{recursive:true,force:true})}catch{}
  }
}

function cinemaBibleText(run){
  const b=run?.previsPlan?.cinemaBible;
  if(!b||typeof b!=='object')return '';
  return [b.cameraSystem,b.lensPackage,b.lightingBible,b.colorBible,b.motionBible,b.textureBible].filter(Boolean).join(' | ').slice(0,1800);
}
function positiveProductMotionLock(run,scene={}){
  const parts=[
    'The physical product remains the exact same physical model throughout the shot: same visible geometry, proportions, construction, material and color.'
  ];
  const holder=paperTowelHolderLock(run,[scene.action,scene.startFrame,scene.endFrame,scene.shot].filter(Boolean).join(' '));
  if(holder)parts.push('For this holder, the base stays fixed on the left, the continuous free loading side stays on the right, and a paper roll moves from right to left toward the base during installation.');
  return parts.filter(Boolean).join(' ');
}
function cleanMotionText(value=''){
  return String(value||'').replace(/\s+/g,' ').trim();
}
function buildRunwayMotionPrompt(run,scene,qcCorrection=''){
  const camera=cleanMotionText(scene.camera||scene.cameraMotion||scene.shot||'');
  const action=cleanMotionText(scene.action||'');
  const end=cleanMotionText(scene.endFrame||'');
  const environment=cleanMotionText(scene.environment||'');
  const motionStyle=/ugc|натив|phone|handheld/i.test(String(run.style||'')+' '+String(scene.shot||''))
    ? 'Natural handheld camera with subtle human micro-drift and believable inertia.'
    : 'Controlled cinematic camera motion with natural acceleration and deceleration.';
  return [
    'Continuous seamless single shot.',
    camera?('Camera movement: '+camera+'.'):'Camera remains intentionally composed with only subtle natural drift.',
    action?('The subject performs one clear physical action: '+action+'.'):'',
    end?('The motion resolves clearly into this end state: '+end+'.'):'',
    environment?('The surrounding scene reacts naturally to the action in '+environment+'.'):'',
    motionStyle,
    run?.previsPlan?.cinemaBible?.motionBible?('Motion character: '+cleanMotionText(run.previsPlan.cinemaBible.motionBible)+'.'):'',
    'Body, hand and object movement has believable weight, contact, friction and inertia.',
    positiveProductMotionLock(run,scene),
    scene?.directorCutNotes?('Director cut correction: '+cleanMotionText(scene.directorCutNotes)+'.'):'',
    qcCorrection?('Correction for this take: '+cleanMotionText(qcCorrection)+'.'):''
  ].filter(Boolean).join(' ').slice(0,900);
}
function buildSeedanceMotionPrompt(run,scene,qcCorrection=''){
  return [
    'ONE continuous cinematic shot. Preserve temporal continuity from START to END.',
    'START: '+cleanMotionText(scene.startFrame||scene.shot||''),
    'ACTION: '+cleanMotionText(scene.action||''),
    'END: '+cleanMotionText(scene.endFrame||''),
    'CAMERA: '+cleanMotionText(scene.camera||scene.shot||'subtle controlled handheld motion'),
    'FRAMING: '+cleanMotionText(scene.framing||''),
    'LIGHTING: '+cleanMotionText(scene.lighting||'motivated practical light with physically believable shadows and falloff'),
    'ENVIRONMENT: '+cleanMotionText(scene.environment||''),
    cinemaBibleText(run)?('CINEMA BIBLE: '+cinemaBibleText(run)):'',
    'PHYSICS: realistic weight transfer, contact, inertia, friction and material response. Hands interact with the object using plausible grip and pressure.',
    positiveProductMotionLock(run,scene),
    'The first frame and last frame are hard visual anchors; create a physically plausible transition between them.',
    scene?.directorCutNotes?('DIRECTOR CUT CORRECTION: '+cleanMotionText(scene.directorCutNotes)):'',
    qcCorrection?('RETRY CORRECTION: '+cleanMotionText(qcCorrection)):''
  ].filter(Boolean).join('\n').slice(0,1800);
}

function providerCreditError(error){
  const msg=String(error?.message||error||'').toLowerCase();
  return /not enough credits|insufficient credits|credit balance is too low|out of credits|low credit balance/.test(msg);
}

function videoProviderMode(run){
  const mode=String(run?.modelMode||'').toLowerCase();
  if(mode.includes('только higgsfield')||mode.includes('только seedance'))return 'higgsfield-only';
  if(mode.includes('только runway'))return 'runway-only';
  return 'auto';
}
function manualSceneProvider(run,sceneNo){
  const raw=String(run?.sceneModels?.[sceneNo]||'').trim().toLowerCase();
  if(!raw||raw==='авто'||raw==='auto')return '';
  if(raw.includes('runway'))return 'runway';
  if(raw.includes('seedance')||raw.includes('higgsfield'))return 'seedance';
  return '';
}
function heuristicSceneRoute(scene={}){
  const text=[scene.title,scene.shot,scene.action,scene.startFrame,scene.endFrame,scene.product,scene.productRole,scene.environment,scene.promptEn,scene.prompt]
    .filter(Boolean).join(' ').toLowerCase();
  let score=0;
  const reasons=[];
  const add=(rx,n,label)=>{if(rx.test(text)){score+=n;reasons.push(label)}};
  add(/рук|кист|пальц|hand|grip|держит|бер[её]т|встав|надев|сним|устанав|закреп|откруч|нажим|тян|вращ|скольз/,3,'точное взаимодействие рук с товаром');
  add(/несколько|две|два|three|multiple|одновременно|переклад|перемещ/,2,'несколько объектов/действий');
  add(/крупн|макро|detail|close[- ]?up|торец|креп|механ|детал/,2,'крупный план конструкции');
  add(/вода|жидк|ль[её]т|сып|ткан|деформ|сгиб|натяг|скруч|физик/,2,'сложная физика/материал');
  add(/аватар|девуш|мужчин|геро.{0,20}(товар|держ|использ)/,1,'герой и товар одновременно');
  add(/камера.{0,30}(обход|orbit|вращ)|tracking|динамичн/,1,'сложное движение камеры');
  if(score>=4)return {provider:'seedance',complexity:'complex',risk:score>=7?'high':'medium',reason:reasons.join('; ')||'сложная сцена'};
  return {provider:'runway',complexity:'simple',risk:score>=2?'medium':'low',reason:reasons.join('; ')||'простое движение/камера'};
}
async function buildSceneRouting(run,accountId){
  const board=Array.isArray(run?.storyboard)?run.storyboard:[];
  const forced=videoProviderMode(run);
  const fallback=Object.fromEntries(board.map((scene,i)=>{
    const sceneNo=i+1;
    const manual=manualSceneProvider(run,sceneNo);
    const base=heuristicSceneRoute(scene);
    const provider=manual||(forced==='runway-only'?'runway':forced==='higgsfield-only'?'seedance':base.provider);
    return [sceneNo,{scene:sceneNo,provider,complexity:base.complexity,risk:base.risk,reason:manual?'Ручной выбор модели':forced!=='auto'?'Принудительный режим запуска':base.reason,source:manual?'manual':forced!=='auto'?'run-mode':'heuristic'}];
  }));
  if(!openaiConfigured()||forced!=='auto')return fallback;
  const unresolved=board.map((scene,i)=>({scene:i+1,...scene})).filter(x=>!manualSceneProvider(run,x.scene));
  if(!unresolved.length)return fallback;
  const schema={
    type:'object',additionalProperties:false,required:['routes'],
    properties:{routes:{type:'array',minItems:unresolved.length,maxItems:unresolved.length,items:{
      type:'object',additionalProperties:false,required:['scene','provider','complexity','risk','reason'],
      properties:{
        scene:{type:'integer',minimum:1,maximum:20},
        provider:{type:'string',enum:['runway','seedance']},
        complexity:{type:'string',enum:['simple','complex']},
        risk:{type:'string',enum:['low','medium','high']},
        reason:{type:'string'}
      }
    }}}
  };
  const prompt=[
    'ROLE: AI video scene router.',
    'Choose the production model separately for every storyboard scene.',
    'RUNWAY = default for SIMPLE scenes: camera motion, talking/holding product, beauty shots, simple object motion, low product-geometry risk.',
    'SEEDANCE 2.0 reference-to-video = COMPLEX scenes: hands physically manipulate product; install/remove/load/attach actions; multiple objects; complex physics; macro product geometry; simultaneous avatar+product motion; strict START→END mechanics; high identity risk.',
    'Goal: use Runway whenever it can reliably do the scene, but route risky interaction scenes to Seedance before spending attempts.',
    'Product source photos/Product DNA are absolute identity truth.',
    universalProductIdentityLock(run),
    'Storyboard: '+JSON.stringify(unresolved.map(x=>({
      scene:x.scene,title:x.title,shot:x.shot,action:x.action,startFrame:x.startFrame,endFrame:x.endFrame,
      product:x.product,productRole:x.productRole,camera:x.camera,framing:x.framing,environment:x.environment
    }))),
    'Return one route per scene, in scene order.'
  ].join('\n');
  try{
    const model=process.env.OPENAI_MODEL||'gpt-6-astra';
    const r=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',
      headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'content-type':'application/json'},
      body:JSON.stringify({
        model,input:[{role:'user',content:[{type:'input_text',text:prompt}]}],
        reasoning:{effort:'low'},max_output_tokens:2200,
        text:{format:{type:'json_schema',name:'scene_router',strict:true,schema}}
      })
    });
    const raw=await r.text();let data;try{data=raw?JSON.parse(raw):{}}catch{data={raw}}
    if(!r.ok)throw new Error(data?.error?.message||('Scene router error '+r.status));
    const parsed=safeAnalysisJson(openAIText(data))||{};
    for(const route of (Array.isArray(parsed.routes)?parsed.routes:[])){
      const n=Number(route?.scene);
      if(!fallback[n]||manualSceneProvider(run,n))continue;
      fallback[n]={...fallback[n],...route,scene:n,source:'ai-router'};
    }
    const priced=openAIUsageCost(data?.model||model,data?.usage||{});
    if(priced.amountUsd>0)await recordExpense(accountId,{
      provider:'OpenAI',category:'scene-router',description:'AI Scene Router · '+String(run.productName||run.id),
      amountUsd:priced.amountUsd,model:data?.model||model,usage:priced.details,source:'auto'
    }).catch(()=>{});
  }catch(e){
    console.warn('[scene-router] '+String(run?.id||'')+' '+String(e?.message||e));
  }
  return fallback;
}

async function processRunGeneration(accountId,runId){
  let state=await readAppState(accountId),data=state?.data||blankFactoryState(),run=findRunById(data,runId);
  if(!run||run.paused||run.status==='Остановлено')return {ok:false,stopped:true};
  if(run.backendGenerationRunning)return {ok:true,alreadyRunning:true};
  const expectedPrevis=Number(run.previsPlan?.totalFrames)||((run.storyboard||[]).length*2);
  const readyPrevis=(Array.isArray(run.previsFrames)?run.previsFrames:[]).filter(x=>x?.url).length;
  if(!run.previsResult?.completed||!expectedPrevis||readyPrevis<expectedPrevis)return {ok:false,error:'Нельзя запускать видео: превиз готов не полностью ('+readyPrevis+'/'+expectedPrevis+')'};
  run.backendGenerationRunning=true;
  run.backendGenerationStartedAt=new Date().toISOString();
  run.stage='Генерация';run.status='В работе';run.progress=Math.max(38,Number(run.progress)||0);
  run.sceneResults=run.sceneResults&&typeof run.sceneResults==='object'?run.sceneResults:{};
  run.error='';run.generationError='';
  await writeAppState(data,accountId);

  const board=Array.isArray(run.storyboard)&&run.storyboard.length?run.storyboard:[planSceneDefaults(0,1)];
  const total=board.length;
  try{
    if(!run.sceneRouting||Object.keys(run.sceneRouting||{}).length!==board.length){
      run.sceneRouting=await buildSceneRouting(run,accountId);
      run.sceneRoutingUpdatedAt=new Date().toISOString();
      appendFactoryJournal(data,'AI Scene Router',(run.productName||run.id)+' · '+Object.values(run.sceneRouting).map(x=>'S'+x.scene+'→'+(x.provider==='seedance'?'Seedance':'Runway')).join(', '));
      await writeAppState(data,accountId);
    }
    for(let i=0;i<board.length;i++){
      state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
      if(!run||run.paused||run.status==='Остановлено'){
        if(run){run.backendGenerationRunning=false;run.updatedAt=new Date().toISOString();await writeAppState(data,accountId)}
        return {ok:false,stopped:true};
      }
      const scene=board[i]||{};
      const sceneNo=i+1;
      const refs=previsSceneReferenceUrls(run,sceneNo);
      if(run.sceneResults?.[sceneNo]?.ok&&run.sceneResults?.[sceneNo]?.urls?.length&&run.sceneResults?.[sceneNo]?.qc?.passed!==false)continue;
      const prompt=[
        'Вертикальный рекламный ролик 9:16. ОДНА утверждённая сцена, не меняй её смысл.',
        'Товар: '+String(run.productName||''),
        'Подтверждённые правила товара: '+String(run.productRules||run.product?.rules||''),
        universalProductIdentityLock(run),
        paperTowelHolderLock(run,[scene.action,scene.startFrame,scene.endFrame,scene.shot].filter(Boolean).join(' ')),
        'FACT LOCK: не показывай и не заявляй неподтверждённый механизм, функцию или характеристику. Исходное фото товара — абсолютный геометрический identity-lock.',
        run.character?.name?('AI-аватар: '+run.character.name+'. '+String(run.character.look||'')+' '+String(run.character.locks||'')):'',
        'Сцена '+sceneNo+': '+String(scene.title||''),
        'Кадр: '+String(scene.shot||''),
        'START: '+String(scene.startFrame||''),
        'Действие: '+String(scene.action||''),
        'END: '+String(scene.endFrame||''),
        'Continuity: '+String(scene.continuity||''),
        'Environment: '+String(scene.environment||''),
        String(scene.promptEn||scene.prompt||''),
        'PREVIZ LOCK: используй превиз-кадры как композиционные anchors и реально разыграй заданное действие во времени. Не превращай сцену в статичную девушку, которая просто держит товар.',
        'PRODUCT LOCK: источник товара важнее previz при конфликте формы. Не менять силуэт, пропорции, крепёж, торцы, материал, цвет и ключевые детали.',
        'ENVIRONMENT: сохраняй ту же обжитую локацию и повторяющийся реквизит. Не делай пустой стерильный фон, если storyboard этого не требует.',
        'SOUND: generate only natural diegetic room/action sounds for the scene (paper, fabric, kitchen/bathroom ambience, object handling as appropriate). NO generated speech, NO narration, NO random music; narration is added in post-production.',
        'Без случайных надписей, логотипов, лишних деталей товара, деформированных рук.'
      ].filter(Boolean).join('\n').slice(0,1000);
      let result=null,lastError=null,sceneQc=null,qcCorrection='',creditBlock=null;
      let bestCandidate=null,bestQc=null,bestScore=-Infinity;
      const route=(run.sceneRouting&&run.sceneRouting[sceneNo])||heuristicSceneRoute(scene);
      const providerMode=videoProviderMode(run);
      let preferred=manualSceneProvider(run,sceneNo)||(providerMode==='runway-only'?'runway':providerMode==='higgsfield-only'?'seedance':String(route?.provider||'runway'));
      let escalatedFrom='';
      const maxAttempts=Math.max(1,Math.min(3,Number(run.maxAttempts)||2));
      const targetQcScore=sceneNo===1?9.2:(String(route?.risk||'').toLowerCase()==='high'?9.0:String(route?.risk||'').toLowerCase()==='medium'?8.8:8.6);
      const generateByProvider=async(provider,providerPrompt)=>{
        if(provider==='seedance'){
          return await generateHiggsfieldScene({
            accountId,prompt:providerPrompt,referenceMedia:refs,
            startImageUrl:refs[0]||'',endImageUrl:refs[1]||'',useKeyframes:true,
            duration:sceneDurationSeconds(scene),aspectRatio:'9:16',resolution:'720p',bitrateMode:'high',generateAudio:true,
            model:'bytedance/seedance-2.5/image-to-video'
          });
        }
        if(!process.env.RUNWAYML_API_SECRET)throw new Error('Runway API is not configured');
        return await generateRunwayScene({
          accountId,prompt:providerPrompt,referenceMedia:refs,duration:sceneDurationSeconds(scene),ratio:'720:1280',model:'gen4.5'
        });
      };
      for(let attempt=1;attempt<=maxAttempts;attempt++){
        let candidate=null;
        const runwayPrompt=buildRunwayMotionPrompt(run,scene,qcCorrection);
        const seedancePrompt=buildSeedanceMotionPrompt(run,scene,qcCorrection);
        const order=preferred==='seedance'?['seedance','runway']:['runway','seedance'];
        for(const provider of order){
          if(provider==='seedance'&&!higgsfieldConfigured())continue;
          if(provider==='runway'&&!process.env.RUNWAYML_API_SECRET)continue;
          try{
            candidate=await generateByProvider(provider,provider==='seedance'?seedancePrompt:runwayPrompt);
            if(candidate?.ok&&candidate?.urls?.length){
              candidate.routerProvider=provider;
              candidate.routerReason=String(route?.reason||'');
              candidate.escalatedFrom=escalatedFrom;
              break;
            }
            candidate=null;
          }catch(e){
            lastError=e;
            console.error('['+provider+'-scene] '+runId+' scene '+sceneNo+' '+String(e?.message||e));
            if(providerCreditError(e))creditBlock={provider:provider==='seedance'?'Higgsfield/Seedance':'Runway',message:String(e?.message||e)};
          }
        }
        if(!candidate){
          if(creditBlock&&attempt>=maxAttempts)break;
          continue;
        }
        try{
          sceneQc=await runGeneratedSceneQc(run,scene,sceneNo,candidate.urls[0],accountId);
        }catch(e){
          sceneQc={passed:null,score:null,summary:'QC недоступен: '+String(e?.message||e),issues:[]};
        }
        if(sceneQc.passed!==false){
          const candidateScore=Number.isFinite(Number(sceneQc.score))?Number(sceneQc.score):8.5;
          if(candidateScore>bestScore){bestScore=candidateScore;bestCandidate=candidate;bestQc=sceneQc}
          if(candidateScore>=targetQcScore||attempt===maxAttempts){result=bestCandidate;sceneQc=bestQc;break}
          qcCorrection=((sceneQc.issues||[]).join('; ')||('Сцена допустима, но cinematic score '+candidateScore+'/10. Улучши естественность камеры, свет, физику движения, материалы и композицию без изменения товара/действия.')).slice(0,1400);
          console.warn('[scene-best-of-n] '+runId+' scene '+sceneNo+' score '+candidateScore+' < '+targetQcScore+'; генерирую ещё дубль');
          continue;
        }
        qcCorrection=((sceneQc.issues||[]).join('; ')||sceneQc.summary||'Исправь критическое несоответствие действию/товару').slice(0,1400);
        lastError=new Error('AI-QC сцены: '+qcCorrection);
        if((candidate.routerProvider||preferred)==='runway'&&providerMode==='auto'&&!manualSceneProvider(run,sceneNo)){
          escalatedFrom='runway';
          preferred='seedance';
          if(run.sceneRouting?.[sceneNo])run.sceneRouting[sceneNo]={...run.sceneRouting[sceneNo],provider:'seedance',complexity:'complex',risk:'high',source:'qc-escalation',escalatedFrom:'runway',reason:'Runway не прошёл AI-QC: '+qcCorrection.slice(0,500)};
          appendFactoryJournal(data,'Эскалация сцены в Seedance',(run.productName||run.id)+' · сцена '+sceneNo+' · Runway → Seedance после QC');
          run.updatedAt=new Date().toISOString();
          await writeAppState(data,accountId);
        }
        console.warn('[scene-qc-retry] '+runId+' scene '+sceneNo+' attempt '+attempt+' '+String(lastError.message));
      }
      if(!result&&bestCandidate){result=bestCandidate;sceneQc=bestQc}
      state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
      if(!run)return {ok:false,error:'Ролик удалён во время генерации'};
      run.sceneResults=run.sceneResults&&typeof run.sceneResults==='object'?run.sceneResults:{};
      if(result?.ok&&result?.urls?.length){
        const persisted=await persistRunVideoUrls(accountId,run.id,result.urls,'scene-'+sceneNo).catch(e=>({urls:result.urls,media:[],failed:[{error:String(e?.message||e)}]}));
        const savedUrls=persisted.urls?.length?persisted.urls:result.urls;
        run.sceneResults[sceneNo]={ok:true,urls:savedUrls,persistedMedia:persisted.media||[],storageWarnings:persisted.failed||[],provider:result.provider,model:result.model,routerProvider:result.routerProvider||'',routerReason:result.routerReason||'',escalatedFrom:result.escalatedFrom||'',requestId:result.requestId||result.taskId||null,fallbackFrom:result.fallbackFrom||'',qc:sceneQc,bestOfN:{targetScore:targetQcScore,bestScore:Number.isFinite(bestScore)?bestScore:null,maxAttempts},completedAt:new Date().toISOString()};
        appendFactoryJournal(data,'Сцена готова',(run.productName||run.id)+' · сцена '+sceneNo+'/'+total+(sceneQc?.score?' · QC '+sceneQc.score+'/10':'')+(persisted.failed?.length?' · резервная копия: частично':' · сохранена в медиатеке'));
      }else{
        const err=creditBlock
          ? (creditBlock.provider+': недостаточно кредитов в API-аккаунте, подключённом к Railway. Генерация остановлена без повторных попыток. '+creditBlock.message)
          : String(lastError?.message||'Не удалось получить качественную сцену');
        run.sceneResults[sceneNo]={ok:false,error:err,qc:sceneQc,completedAt:new Date().toISOString()};
        run.backendGenerationRunning=false;run.status='Ошибка';run.stage='Генерация';run.generationError='Сцена '+sceneNo+': '+err;run.error=run.generationError;
        run.updatedAt=new Date().toISOString();
        appendFactoryJournal(data,'Ошибка генерации сцены',(run.productName||run.id)+' · сцена '+sceneNo+' · '+err);
        await writeAppState(data,accountId);
        return {ok:false,error:err,scene:sceneNo};
      }
      const completed=Object.values(run.sceneResults).filter(x=>x?.ok&&x?.urls?.length&&x?.qc?.passed!==false).length;
      const urls=Object.keys(run.sceneResults).sort((a,b)=>Number(a)-Number(b)).flatMap(k=>run.sceneResults[k]?.urls||[]);
      run.generationResult={provider:'mixed',urls,completedScenes:completed,totalScenes:total,completed:completed>=total};
      run.progress=Math.min(65,38+Math.round((completed/Math.max(1,total))*27));
      run.updatedAt=new Date().toISOString();
      await writeAppState(data,accountId);
    }
    state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
    if(run){
      const goodScenes=Object.values(run.sceneResults||{}).filter(x=>x?.ok&&x?.urls?.length&&x?.qc?.passed!==false).length;
      const urls=Object.keys(run.sceneResults||{}).sort((a,b)=>Number(a)-Number(b)).flatMap(k=>run.sceneResults[k]?.urls||[]);
      if(goodScenes<board.length||urls.length<board.length)throw new Error('Не все видео-сцены прошли QC: '+goodScenes+'/'+board.length);
      run.generationResult={provider:'mixed',urls,completedScenes:board.length,totalScenes:board.length,completed:true};
      run.backendGenerationRunning=false;run.error='';run.generationError='';run.updatedAt=new Date().toISOString();
      appendFactoryJournal(data,'Генерация сцен завершена',(run.productName||run.id)+' · '+board.length+' сцен прошли QC');
      if(run.mode==='manual'){
        run.stage='На проверке';run.status='На проверке';run.progress=70;run.awaitingApproval=true;
        await writeAppState(data,accountId);
      }else{
        run.acceptedScenes=Array.from({length:board.length},(_,i)=>i+1);
        run.stage='Озвучка';run.status='В работе';run.progress=74;run.awaitingApproval=false;run.postProductionRunning=false;
        await writeAppState(data,accountId);
        enqueuePostProduction(accountId,run.id,'autopilot-post-production');
      }
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
  enqueueRunGeneration(accountId,run.id,'backend-generation');
  notifyN8nArchive(payload).then(archive=>{
    enqueueAccountBackground(accountId,'archive:'+String(run.id),async()=>{
      const state=await readAppState(accountId);
      const data=state?.data||blankFactoryState();
      const current=findRunById(data,run.id);
      if(current){
        current.workflow={sentAt:new Date().toISOString(),archiveStatus:archive.status||0,generationStatus:'backend-direct',ok:true};
        current.updatedAt=new Date().toISOString();
        await writeAppState(data,accountId);
      }
      return {ok:true};
    },'archive-background');
  }).catch(e=>console.error('[archive-background] '+run.id+' '+String(e?.message||e)));
  return {ok:true,data:{archive:{ok:true,status:'background'},generation:{ok:true,status:'backend-direct'}}};
}



function buildIdeaOptions(run){
  const base=run?.idea&&typeof run.idea==='object'?run.idea:{};
  const raw=[base,...(Array.isArray(base.alternatives)?base.alternatives:[])].slice(0,5);
  const required=['title','audience','hook','first3Seconds','concept','mechanic','angle','productRole','retention','payoff','ctaDirection','production','why'];
  return raw.map((src,i)=>{
    const primary=i===0;
    const optionIdea={
      title:String(src?.title||(primary?base.title:'')||('Идея '+(i+1))).slice(0,240),
      concept:String(src?.concept||(primary?base.concept:'')||'').slice(0,5000),
      hook:String(src?.hook||(primary?base.hook:'')||'').slice(0,2000),
      angle:String(src?.angle||(primary?base.angle:'')||'').slice(0,2000),
      why:String(src?.why||(primary?base.why:'')||'').slice(0,4000),
      audience:String(src?.audience||(primary?base.audience:'')||'').slice(0,2000),
      first3Seconds:String(src?.first3Seconds||src?.hook||(primary?(base.first3Seconds||base.hook):'')||'').slice(0,3000),
      mechanic:String(src?.mechanic||(primary?base.mechanic:'')||'').slice(0,3000),
      productRole:String(src?.productRole||(primary?base.productRole:'')||'').slice(0,3000),
      retention:String(src?.retention||(primary?base.retention:'')||'').slice(0,3000),
      payoff:String(src?.payoff||(primary?base.payoff:'')||'').slice(0,3000),
      ctaDirection:String(src?.ctaDirection||(primary?base.ctaDirection:'')||'').slice(0,2000),
      production:String(src?.production||(primary?base.production:'')||'').slice(0,1600),
      formatPattern:String(src?.formatPattern||(primary?base.formatPattern:'')||'').slice(0,500),
      hookLab:primary&&base.hookLab&&typeof base.hookLab==='object'?base.hookLab:null,
      quality:src?.quality&&typeof src.quality==='object'?src.quality:{}
    };
    const missing=required.filter(k=>!String(optionIdea[k]||'').trim());
    return {
      id:'idea-'+String(run.id||'run')+'-'+(i+1),
      index:i+1,
      sourceRunId:String(run.id||''),
      productId:String(run.productId||''),
      productName:String(run.productName||run.product?.name||''),
      complete:missing.length===0,
      missing,
      idea:optionIdea
    };
  });
}
function syncRunIdeaLibrary(data,run){
  if(!run?.idea)return [];
  const options=buildIdeaOptions(run);
  run.ideaOptions=options;
  if(!run.selectedIdeaOptionId)run.selectedIdeaOptionId=options[0]?.id||'';
  data.savedIdeas=Array.isArray(data.savedIdeas)?data.savedIdeas:[];
  for(const opt of options){
    const existing=data.savedIdeas.find(x=>String(x?.id)===String(opt.id));
    const productSnapshot={
      id:String(run.productId||run.product?.id||''),
      name:String(run.productName||run.product?.name||''),
      category:String(run.product?.category||''),
      utp:String(run.productUtp||run.product?.utp||''),
      rules:String(run.productRules||run.product?.rules||''),
      productDNA:run.productDNA||run.product?.productDNA||null,
      defaultCharacterId:run.product?.defaultCharacterId||null,
      media:(Array.isArray(run.media)?run.media:(run.product?.media||[])).map(m=>({
        id:m?.id,url:m?.url,path:m?.path,fileName:m?.fileName,isPrimary:!!m?.isPrimary
      })).filter(m=>m.url)
    };
    const characterSnap=run.character?JSON.parse(JSON.stringify(run.character)):null;
    const item={
      ...opt,
      selected:String(run.selectedIdeaOptionId||'')===String(opt.id),
      productSnapshot,
      characterSnapshot:characterSnap,
      avatarReferencesSnapshot:(Array.isArray(run.avatarReferences)?run.avatarReferences:(characterSnap?.media||[])).map(m=>({
        id:m?.id,url:m?.url,path:m?.path,fileName:m?.fileName,isPrimary:!!m?.isPrimary
      })).filter(m=>m.url),
      launchConfig:{
        brief:String(run.brief||''),style:String(run.style||'UGC'),duration:String(run.duration||'30 сек'),
        format:String(run.format||'9:16'),modelMode:String(run.modelMode||'Авто — умный выбор'),
        budget:Number(run.budget)||500,maxAttempts:Number(run.maxAttempts)||3
      },
      createdAt:existing?.createdAt||new Date().toISOString(),
      updatedAt:new Date().toISOString()
    };
    if(existing)Object.assign(existing,item);else data.savedIdeas.push(item);
  }
  return options;
}
function applyIdeaOptionToRun(data,run,optionIdOrIndex){
  const options=(Array.isArray(run.ideaOptions)&&run.ideaOptions.length?run.ideaOptions:syncRunIdeaLibrary(data,run));
  const key=String(optionIdOrIndex||'');
  const option=options.find(x=>String(x.id)===key)||options.find(x=>String(x.index)===key);
  if(!option)throw new Error('Вариант идеи не найден');
  const others=options.filter(x=>x.id!==option.id).map(x=>({...x.idea}));
  run.idea={...option.idea,alternatives:others};
  run.selectedIdeaOptionId=option.id;
  run.script=null;run.storyboard=[];run.references=null;run.previsPlan=null;run.previsFrames=[];run.previsResult=null;run.sceneCount=0;
  run.stage='Идея';run.status='На проверке';run.progress=8;run.awaitingApproval=true;run.error='';
  run.updatedAt=new Date().toISOString();
  data.savedIdeas=Array.isArray(data.savedIdeas)?data.savedIdeas:[];
  for(const x of data.savedIdeas){
    if(String(x?.sourceRunId)===String(run.id))x.selected=String(x.id)===String(option.id);
  }
  return option;
}
async function launchSavedIdea(accountId,savedIdeaId){
  const state=await readAppState(accountId),data=state?.data||blankFactoryState();
  data.savedIdeas=Array.isArray(data.savedIdeas)?data.savedIdeas:[];
  const saved=data.savedIdeas.find(x=>String(x?.id)===String(savedIdeaId));
  if(!saved)throw new Error('Сохранённая идея не найдена');

  const source=findRunById(data,saved.sourceRunId);
  const currentProduct=findProductInState(data,saved.productId||saved.productName);
  const snap=saved.productSnapshot&&typeof saved.productSnapshot==='object'?saved.productSnapshot:null;
  const product=currentProduct||snap;
  if(!product)throw new Error('В сохранённой идее нет снимка товара');

  const media=(Array.isArray(product.media)?product.media:(snap?.media||[])).map(m=>({
    id:m?.id,url:m?.url,path:m?.path,fileName:m?.fileName,isPrimary:!!m?.isPrimary
  })).filter(m=>m.url);

  const character=saved.characterSnapshot||source?.character||characterSnapshot(resolveProductCharacter(data,currentProduct||product,{}));
  const avatarRefs=(Array.isArray(saved.avatarReferencesSnapshot)&&saved.avatarReferencesSnapshot.length
    ?saved.avatarReferencesSnapshot
    :(character?.media||[])).map(m=>({
      id:m?.id,url:m?.url,path:m?.path,fileName:m?.fileName,isPrimary:!!m?.isPrimary
    })).filter(m=>m.url);

  const cfg=saved.launchConfig&&typeof saved.launchConfig==='object'?saved.launchConfig:{};
  const id=factoryId('r');
  const run={
    brief:String(cfg.brief??source?.brief??''),style:String(cfg.style??source?.style??'UGC'),
    duration:String(cfg.duration??source?.duration??'30 сек'),format:String(cfg.format??source?.format??'9:16'),
    modelMode:String(cfg.modelMode??source?.modelMode??'Авто — умный выбор'),
    budget:Number(cfg.budget??source?.budget)||500,maxAttempts:Number(cfg.maxAttempts??source?.maxAttempts)||3,
    id,accountId,batchId:factoryId('batch'),mode:'manual',variant:null,
    modeUpdatedAt:new Date().toISOString(),modeUpdatedBy:'saved-idea-launch',
    productId:String(product.id||saved.productId||''),productName:String(product.name||saved.productName||'Товар'),
    productUtp:String(product.utp||''),productRules:String(product.rules||''),
    media,product:{
      id:String(product.id||saved.productId||''),name:String(product.name||saved.productName||'Товар'),
      category:String(product.category||''),utp:String(product.utp||''),rules:String(product.rules||''),
      media,defaultCharacterId:product.defaultCharacterId||null
    },
    characterId:character?.id||null,character,avatarReferences:avatarRefs,characterSource:character?'saved-idea-snapshot':'none',
    idea:{...saved.idea,alternatives:[]},selectedIdeaOptionId:'idea-'+id+'-1',
    status:'На проверке',stage:'Идея',progress:8,attempt:1,awaitingApproval:true,
    pipelineVersion:'previs-v3-background',script:null,storyboard:[],references:null,previsPlan:null,previsFrames:[],previsResult:null,
    sceneCount:0,sceneVersions:{},acceptedScenes:[],generationResult:null,
    created:new Date().toISOString(),updatedAt:new Date().toISOString()
  };
  data.runs=Array.isArray(data.runs)?data.runs:[];
  data.runs.push(run);
  syncRunIdeaLibrary(data,run);
  appendFactoryJournal(data,'Запущена сохранённая идея',run.productName+' · '+saved.idea?.title);
  await writeAppState(data,accountId);
  return run;
}

function invalidateAfterStoryboardSceneChange(run,sceneNo){
  const n=Number(sceneNo);
  if(run.previsPlan?.frames){
    run.previsPlan=null;
    run.previsFrames=(Array.isArray(run.previsFrames)?run.previsFrames:[]).filter(x=>Number(x?.scene)!==n);
    if(run.previsResult){
      run.previsResult={...run.previsResult,completed:false,totalFrames:run.previsFrames.filter(x=>x?.url).length,completedAt:null};
    }
  }
  run.sceneResults=run.sceneResults&&typeof run.sceneResults==='object'?run.sceneResults:{};
  delete run.sceneResults[n];
  run.generationResult=null;
  run.acceptedScenes=(Array.isArray(run.acceptedScenes)?run.acceptedScenes:[]).filter(x=>Number(x)!==n);
  run.voiceoverResult=null;run.montageResult=null;run.qcResult=null;
  run.backendGenerationRunning=false;run.postProductionRunning=false;
}
function enqueueStoryboardSceneTask(accountId,runId,sceneNo,note=''){
  const account=sanitizeAccountId(accountId||DEFAULT_ACCOUNT_ID);
  const scene=Math.max(1,Math.min(30,Number(sceneNo)||1));
  return enqueueAccountBackground(account,'storyboard-scene:'+String(runId)+':'+scene,async()=>{
    let state=await readAppState(account),data=state?.data||blankFactoryState(),run=findRunById(data,runId);
    if(!run||run.paused||run.status==='Остановлено')return {ok:false,stopped:true};
    run.storyboardSceneJobs=run.storyboardSceneJobs&&typeof run.storyboardSceneJobs==='object'?run.storyboardSceneJobs:{};
    const jobId=factoryId('job');
    run.storyboardSceneJobs[scene]={id:jobId,status:'processing',startedAt:new Date().toISOString(),note:String(note||'').slice(0,2000)};
    run.status='В работе';run.stage='Storyboard';run.awaitingApproval=false;run.error='';run.updatedAt=new Date().toISOString();
    await writeAppState(data,account);
    try{
      const updated=await generateStoryboardScene(run,account,scene,String(note||''));
      state=await readAppState(account);data=state?.data||blankFactoryState();run=findRunById(data,runId);
      if(!run)return {ok:false,error:'Ролик удалён во время обновления сцены'};
      run.storyboard=Array.isArray(run.storyboard)?run.storyboard:[];
      run.storyboard[scene-1]=updated;
      run.sceneCount=Math.max(run.sceneCount||0,run.storyboard.length);
      run.storyboardSceneVersions=run.storyboardSceneVersions&&typeof run.storyboardSceneVersions==='object'?run.storyboardSceneVersions:{};
      run.storyboardSceneVersions[scene]=(Number(run.storyboardSceneVersions[scene])||1)+1;
      invalidateAfterStoryboardSceneChange(run,scene);
      run.storyboardSceneJobs[scene]={id:jobId,status:'done',finishedAt:new Date().toISOString()};
      run.status='На проверке';run.stage='Storyboard';run.awaitingApproval=true;run.progress=Math.max(26,Number(run.progress)||0);run.error='';run.updatedAt=new Date().toISOString();
      appendFactoryJournal(data,'Storyboard-сцена переделана',(run.productName||run.id)+' · сцена '+scene+' · V'+run.storyboardSceneVersions[scene]);
      await writeAppState(data,account);
      return {ok:true,scene};
    }catch(e){
      state=await readAppState(account);data=state?.data||blankFactoryState();run=findRunById(data,runId);
      if(run){
        run.storyboardSceneJobs=run.storyboardSceneJobs&&typeof run.storyboardSceneJobs==='object'?run.storyboardSceneJobs:{};
        run.storyboardSceneJobs[scene]={...(run.storyboardSceneJobs[scene]||{}),status:'failed',failedAt:new Date().toISOString(),error:String(e?.message||e)};
        run.status='Ошибка';run.stage='Storyboard';run.awaitingApproval=false;run.error='Storyboard сцена '+scene+': '+String(e?.message||e);run.updatedAt=new Date().toISOString();
        appendFactoryJournal(data,'Ошибка storyboard-сцены',(run.productName||run.id)+' · сцена '+scene+' · '+String(e?.message||e));
        await writeAppState(data,account);
      }
      return {ok:false,error:String(e?.message||e)};
    }
  },'storyboard-scene');
}

function stageTaskName(task){
  return task==='idea'?'Идея':task==='script'?'Сценарий':task==='storyboard'?'Storyboard':String(task||'Этап');
}
function stageTaskProgress(task){
  return task==='idea'?3:task==='script'?12:task==='storyboard'?21:3;
}
async function queueRunStageTask(accountId,runId,task,note=''){
  accountId=sanitizeAccountId(accountId||DEFAULT_ACCOUNT_ID);
  const state=await readAppState(accountId),data=state?.data||blankFactoryState(),run=findRunById(data,runId);
  if(!run)throw new Error('Ролик не найден');
  const jobId=factoryId('job');
  run.status='В работе';run.stage=stageTaskName(task);run.awaitingApproval=false;run.error='';
  run.backgroundTask={id:jobId,type:task,status:'queued',queuedAt:new Date().toISOString(),note:String(note||'').slice(0,2000)};
  run.progress=Math.max(stageTaskProgress(task),Number(run.progress)||0);
  run.updatedAt=new Date().toISOString();
  appendFactoryJournal(data,'Этап поставлен в фон',(run.productName||run.id)+' · '+stageTaskName(task));
  await writeAppState(data,accountId);
  enqueueStageTask(accountId,runId,task,note,jobId);
  return run;
}
async function processStageTask(accountId,runId,task,note='',jobId=''){
  let state=await readAppState(accountId),data=state?.data||blankFactoryState(),run=findRunById(data,runId);
  if(!run||run.paused||run.status==='Остановлено')return {ok:false,stopped:true};
  if(jobId&&run.backgroundTask?.id&&run.backgroundTask.id!==jobId)return {ok:false,superseded:true};
  run.status='В работе';run.stage=stageTaskName(task);run.awaitingApproval=false;run.error='';
  run.backgroundTask={...(run.backgroundTask||{}),id:jobId||run.backgroundTask?.id||factoryId('job'),type:task,status:'processing',startedAt:new Date().toISOString()};
  run.updatedAt=new Date().toISOString();
  await writeAppState(data,accountId);
  const activeJobId=run.backgroundTask.id;
  try{
    let result;
    if(task==='idea'){
      result=await generateIdeaStage(run,accountId,run.variant||1,String(note||''));
    }else if(task==='script'){
      if(!run.idea)throw new Error('Нельзя создать сценарий: утверждённая идея отсутствует');
      result=await generateScriptStage(run,accountId,String(note||''));
    }else if(task==='storyboard'){
      if(!run.idea)throw new Error('Нельзя создать Storyboard: идея отсутствует');
      if(!run.script)throw new Error('Нельзя создать Storyboard: сценарий ещё не создан');
      result=await generateStoryboardStage(run,accountId,String(note||''));
    }else{
      throw new Error('Неизвестный фоновый этап: '+task);
    }

    state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
    if(!run)return {ok:false,error:'Ролик удалён во время генерации'};
    if(run.backgroundTask?.id&&run.backgroundTask.id!==activeJobId)return {ok:false,superseded:true};

    if(task==='idea'){
      run.idea=result;
      run.script=null;run.storyboard=[];run.references=null;run.previsPlan=null;run.previsFrames=[];run.previsResult=null;run.sceneCount=0;
      run.progress=8;
      syncRunIdeaLibrary(data,run);
      appendFactoryJournal(data,'Идея готова',(run.productName||run.id)+' · '+String(result?.title||''));
    }else if(task==='script'){
      const complete=scriptStageComplete(result);
      if(!complete.ok)throw new Error('Сценарий не прошёл структурную проверку');
      run.script=result;
      run.storyboard=[];run.references=null;run.previsPlan=null;run.previsFrames=[];run.previsResult=null;run.sceneCount=0;
      run.progress=18;
      appendFactoryJournal(data,'Сценарий готов',(run.productName||run.id)+' · '+String(result?.title||''));
    }else if(task==='storyboard'){
      if(!Array.isArray(result)||!result.length)throw new Error('Storyboard пустой');
      run.storyboard=result;run.sceneCount=result.length;
      run.sceneVersions=Object.fromEntries(result.map((_,i)=>[i+1,1]));
      run.references=null;run.previsPlan=null;run.previsFrames=[];run.previsResult=null;
      run.progress=26;
      appendFactoryJournal(data,'Storyboard готов',(run.productName||run.id)+' · '+result.length+' сцен');
    }
    run.backgroundTask={...(run.backgroundTask||{}),status:'done',finishedAt:new Date().toISOString()};
    run.error='';run.updatedAt=new Date().toISOString();
    if(run.mode==='manual'){
      run.status='На проверке';run.stage=stageTaskName(task);run.awaitingApproval=true;
      await writeAppState(data,accountId);
      return {ok:true,stage:run.stage};
    }
    run.status='В работе';run.awaitingApproval=false;
    run.stage=task==='idea'?'Сценарий':task==='script'?'Storyboard':'Превиз-кадры';
    await writeAppState(data,accountId);
    enqueueAutoPipeline(accountId,run.id);
    return {ok:true,stage:run.stage,autopilot:true};
  }catch(e){
    state=await readAppState(accountId);data=state?.data||blankFactoryState();run=findRunById(data,runId);
    if(run&&(!run.backgroundTask?.id||run.backgroundTask.id===activeJobId)){
      run.status='Ошибка';run.stage=stageTaskName(task);run.awaitingApproval=false;
      run.error=stageTaskName(task)+': '+String(e?.message||e);
      run.backgroundTask={...(run.backgroundTask||{}),status:'failed',failedAt:new Date().toISOString(),error:String(e?.message||e)};
      run.updatedAt=new Date().toISOString();
      appendFactoryJournal(data,'Ошибка фонового этапа',(run.productName||run.id)+' · '+run.error);
      await writeAppState(data,accountId);
    }
    console.error('[stage-task] '+accountId+' '+runId+' '+task+' '+String(e?.message||e));
    return {ok:false,error:String(e?.message||e)};
  }
}
function enqueueStageTask(accountId,runId,task,note='',jobId=''){
  const account=sanitizeAccountId(accountId||DEFAULT_ACCOUNT_ID);
  return enqueueAccountBackground(account,'stage:'+String(runId)+':'+String(task),()=>processStageTask(account,runId,task,note,jobId),'stage-queue');
}

async function createBatchRuns(payload,accountId){
  const state=await readAppState(accountId);
  const data=state?.data||blankFactoryState();
  data.runs=Array.isArray(data.runs)?data.runs:[];
  const product=findProductInState(data,payload.productId||payload.productName);
  if(!product)throw new Error('Товар не найден');
  await ensureProductDNA(data,product,accountId);
  const resolvedCharacter=resolveProductCharacter(data,product,payload);
  const character=characterSnapshot(resolvedCharacter);
  const productMedia=(Array.isArray(product.media)?product.media:[]).map(m=>({id:m?.id,url:m?.url,path:m?.path,fileName:m?.fileName,isPrimary:!!m?.isPrimary})).filter(m=>m.url);
  const basePayload={
    ...payload,
    productId:product.id,productName:product.name,productUtp:product.utp||'',productRules:product.rules||'',productDNA:product.productDNA||null,
    media:productMedia,
    product:{id:product.id,name:product.name,category:product.category||'',utp:product.utp||'',rules:product.rules||'',productDNA:product.productDNA||null,media:productMedia,defaultCharacterId:product.defaultCharacterId||null},
    characterId:character?.id||null,character,avatarReferences:character?.media||[],
    characterSource:character?(String(payload.characterId||payload.character?.id||'')?'launch-selection':'product-default'):'none'
  };
  const count=Math.max(1,Math.min(20,parseInt(payload.count)||1));
  const batchId=String(payload.batchId||factoryId('batch'));
  const created=[];
  for(let i=1;i<=count;i++){
    const id=factoryId('r');
    const jobId=factoryId('job');
    const run={
      id,...basePayload,accountId,batchId,variant:count>1?i:null,
      modeUpdatedAt:payload.created||new Date().toISOString(),modeUpdatedBy:'launch',
      status:'В работе',stage:'Идея',progress:3,attempt:1,awaitingApproval:false,
      backgroundTask:payload.mode==='manual'?{id:jobId,type:'idea',status:'queued',queuedAt:new Date().toISOString()}:null,
      sceneCount:0,sceneVersions:{},acceptedScenes:[],
      pipelineVersion:'previs-v3-background',idea:null,script:null,storyboard:[],references:null,previsPlan:null,previsFrames:[],previsResult:null,generationResult:null,
      created:payload.created||new Date().toISOString(),updatedAt:new Date().toISOString()
    };
    data.runs.push(run);created.push(run);
  }
  appendFactoryJournal(data,'Создан запуск',product.name+' · '+count+' ролик(а/ов) · '+(payload.mode==='manual'?'ручной режим':'автопилот')+(character?' · аватар '+character.name:''));
  await writeAppState(data,accountId);

  for(const run of created){
    if(run.mode==='manual')enqueueStageTask(accountId,run.id,'idea','',run.backgroundTask?.id||'');
    else enqueueAutoPipeline(accountId,run.id);
  }
  return {batchId,runs:created};
}

async function createIdeaDraft(body,accountId){
  const state=await readAppState(accountId);
  const data=state?.data||blankFactoryState();
  const product=findProductInState(data,body.productId||body.product);
  if(!product)throw new Error('Товар не найден');
  await ensureProductDNA(data,product,accountId);
  const resolvedCharacter=resolveProductCharacter(data,product,{});
  const character=characterSnapshot(resolvedCharacter);
  const productMedia=(product.media||[]);
  const payload={
    accountId,productId:product.id,productName:product.name,productUtp:product.utp||'',productRules:product.rules||'',productDNA:product.productDNA||null,
    media:productMedia,product:{id:product.id,name:product.name,category:product.category||'',utp:product.utp||'',rules:product.rules||'',productDNA:product.productDNA||null,media:productMedia,defaultCharacterId:product.defaultCharacterId||null},
    characterId:character?.id||null,character,avatarReferences:character?.media||[],characterSource:character?'product-default':'none',
    brief:String(body.brief||''),style:String(body.style||'UGC'),duration:String(body.duration||'30 сек'),
    format:'9:16',mode:'manual',modelMode:'Авто — умный выбор',budget:Number(body.budget)||500,maxAttempts:3,
    created:new Date().toISOString()
  };
  const jobId=factoryId('job');
  const run={id:factoryId('r'),...payload,batchId:factoryId('batch'),pipelineVersion:'previs-v3-background',
    modeUpdatedAt:payload.created||new Date().toISOString(),modeUpdatedBy:'idea-draft',
    status:'В работе',stage:'Идея',progress:3,attempt:0,awaitingApproval:false,
    backgroundTask:{id:jobId,type:'idea',status:'queued',queuedAt:new Date().toISOString()},
    idea:null,script:null,storyboard:[],references:null,previsPlan:null,previsFrames:[],previsResult:null,sceneCount:0,
    sceneVersions:{},acceptedScenes:[],generationResult:null,updatedAt:new Date().toISOString()};
  data.runs=Array.isArray(data.runs)?data.runs:[];
  data.runs.push(run);
  appendFactoryJournal(data,'Создана фоновая идея',product.name+(character?' · аватар '+character.name:''));
  await writeAppState(data,accountId);
  enqueueStageTask(accountId,run.id,'idea','',jobId);
  return run;
}

async function processManualModeCheckpoint(accountId,runId){
  let state=await readAppState(accountId),data=state?.data||blankFactoryState(),run=findRunById(data,runId);
  if(!run||run.mode!=='manual'||run.paused||run.status==='Остановлено'||run.status==='Ошибка'||run.status==='Готово')return {ok:true,skipped:true};
  if(run.status==='На проверке'||run.awaitingApproval===true)return {ok:true,alreadyWaiting:true};

  if(!run.idea){
    const jobId=factoryId('job');
    run.status='В работе';run.stage='Идея';run.awaitingApproval=false;
    run.backgroundTask={id:jobId,type:'idea',status:'queued',queuedAt:new Date().toISOString(),note:'Продолжение после переключения в ручной режим'};
    run.updatedAt=new Date().toISOString();
    await writeAppState(data,accountId);
    return await processStageTask(accountId,runId,'idea','',jobId);
  }
  if(!run.script){
    const jobId=factoryId('job');
    run.status='В работе';run.stage='Сценарий';run.awaitingApproval=false;
    run.backgroundTask={id:jobId,type:'script',status:'queued',queuedAt:new Date().toISOString(),note:'Продолжение после переключения в ручной режим'};
    run.updatedAt=new Date().toISOString();
    await writeAppState(data,accountId);
    return await processStageTask(accountId,runId,'script','',jobId);
  }
  if(!Array.isArray(run.storyboard)||!run.storyboard.length){
    const jobId=factoryId('job');
    run.status='В работе';run.stage='Storyboard';run.awaitingApproval=false;
    run.backgroundTask={id:jobId,type:'storyboard',status:'queued',queuedAt:new Date().toISOString(),note:'Продолжение после переключения в ручной режим'};
    run.updatedAt=new Date().toISOString();
    await writeAppState(data,accountId);
    return await processStageTask(accountId,runId,'storyboard','',jobId);
  }
  if(!run.previsResult?.completed){
    run.status='В работе';run.stage='Превиз-кадры';run.awaitingApproval=false;run.previsRunning=false;
    run.error='';run.previsError='';run.updatedAt=new Date().toISOString();
    await writeAppState(data,accountId);
    return await processRunPrevis(accountId,runId);
  }
  if(!run.generationResult?.completed){
    run.status='В работе';run.stage='Генерация';run.awaitingApproval=false;run.backendGenerationRunning=false;
    run.error='';run.generationError='';run.updatedAt=new Date().toISOString();
    await writeAppState(data,accountId);
    return await processRunGeneration(accountId,runId);
  }

  if(!run.montageResult?.url){
    run.status='На проверке';run.stage='На проверке';run.awaitingApproval=true;run.progress=Math.max(70,Number(run.progress)||0);
    run.updatedAt=new Date().toISOString();
    await writeAppState(data,accountId);
    return {ok:true,stage:'На проверке'};
  }

  run.status='На проверке';run.stage='На проверке';run.awaitingApproval=true;run.progress=Math.max(95,Number(run.progress)||0);
  run.updatedAt=new Date().toISOString();
  await writeAppState(data,accountId);
  return {ok:true,stage:'На проверке'};
}
function enqueueManualModeCheckpoint(accountId,runId){
  const account=sanitizeAccountId(accountId||DEFAULT_ACCOUNT_ID);
  return enqueueAccountBackground(
    account,
    'manual-mode-checkpoint:'+String(runId),
    ()=>processManualModeCheckpoint(account,runId),
    'manual-mode-checkpoint'
  );
}

async function runControlAction(body,accountId){
  const runId=String(body?.runId||'');
  const action=String(body?.action||'');
  let state=await readAppState(accountId),data=state?.data||blankFactoryState(),run=findRunById(data,runId);
  if(!run)throw new Error('Ролик не найден');
  if(action==='set_mode'){
    const nextMode=String(body?.mode||'').toLowerCase()==='manual'?'manual':'auto';
    const previousMode=run.mode==='manual'?'manual':'auto';
    if(previousMode===nextMode)return run;
    const changedAt=new Date().toISOString();
    run.mode=nextMode;
    run.modeUpdatedAt=changedAt;
    run.modeUpdatedBy='user';
    run.updatedAt=changedAt;
    appendFactoryJournal(
      data,
      'Режим процесса изменён',
      (run.productName||run.id)+' · '+(previousMode==='manual'?'Ручной':'Автопилот')+' → '+(nextMode==='manual'?'Ручной':'Автопилот')
    );

    // Switching to Manual never kills the current worker. The worker finishes its
    // current atomic stage and then sees run.mode === 'manual' and stops for approval.
    if(nextMode==='manual'){
      await writeAppState(data,accountId);
      if(!run.paused&&run.status!=='Остановлено'&&run.status!=='Ошибка'&&run.status!=='Готово'){
        enqueueManualModeCheckpoint(accountId,run.id);
      }
      return run;
    }

    // Switching to Auto preserves every artifact and continues from the furthest
    // completed point. Stopped/error runs only store the new mode; Resume remains explicit.
    if(run.paused||run.status==='Остановлено'||run.status==='Ошибка'){
      await writeAppState(data,accountId);
      return run;
    }

    run.awaitingApproval=false;
    run.status='В работе';
    run.error='';

    // Final manual review -> apply the same finish policy as autopilot.
    if(run.montageResult?.url&&run.qcResult){
      if(run.qcResult?.passed===false){
        run.stage='AI-проверка';run.status='Ошибка';run.progress=Math.max(92,Number(run.progress)||0);
        run.error='Финальный QC не пройден: '+String((run.qcResult?.issues||[]).join('; ')||run.qcResult?.summary||'качество ниже порога');
      }else{
        run.stage='Готово';run.status='Готово';run.progress=100;
      }
      await writeAppState(data,accountId);
      return run;
    }

    // Manual scene review -> accept all generated scenes and continue to post-production.
    if(run.generationResult?.completed){
      const total=Math.max(0,Number(run.generationResult?.totalScenes)||0);
      run.acceptedScenes=Array.from({length:total},(_,i)=>i+1);
      run.stage='Озвучка';run.progress=Math.max(74,Number(run.progress)||0);run.postProductionRunning=false;
      await writeAppState(data,accountId);
      enqueuePostProduction(accountId,run.id,'mode-switch-auto-post-production');
      return run;
    }

    // Completed previz waiting for approval -> start video without rebuilding previz.
    if(run.previsResult?.completed){
      run.stage='Генерация';run.progress=Math.max(38,Number(run.progress)||0);
      await writeAppState(data,accountId);
      dispatchExistingRun(accountId,run).catch(e=>console.error('[mode-switch-generation] '+run.id+' '+String(e?.message||e)));
      return run;
    }

    // Idea/script/storyboard or an active atomic job: queue autopilot behind the
    // current per-account worker. Dedupe prevents a second copy of the same job.
    await writeAppState(data,accountId);
    enqueueAutoPipeline(accountId,run.id);
    return run;
  }
  if(action==='stop'){
    run.status='Остановлено';run.paused=true;run.updatedAt=new Date().toISOString();
    appendFactoryJournal(data,'Производство остановлено',run.productName||run.id);await writeAppState(data,accountId);return run;
  }
  if(action==='regenerate_storyboard_scene'){
    const scene=Math.max(1,Math.min(30,Number(body?.scene)||1));
    if(!run.script)throw new Error('Сначала нужен готовый сценарий');
    if(!Array.isArray(run.storyboard)||!run.storyboard[scene-1])throw new Error('Storyboard-сцена '+scene+' не найдена');
    run.storyboardSceneJobs=run.storyboardSceneJobs&&typeof run.storyboardSceneJobs==='object'?run.storyboardSceneJobs:{};
    run.storyboardSceneJobs[scene]={id:factoryId('job'),status:'queued',queuedAt:new Date().toISOString(),note:String(body?.note||'').slice(0,2000)};
    run.status='В работе';run.stage='Storyboard';run.awaitingApproval=false;run.error='';run.updatedAt=new Date().toISOString();
    appendFactoryJournal(data,'Storyboard-сцена поставлена на переделку',(run.productName||run.id)+' · сцена '+scene);
    await writeAppState(data,accountId);
    enqueueStoryboardSceneTask(accountId,run.id,scene,String(body?.note||''));
    return run;
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
  if(action==='delete_scene_video'){
    const scene=Math.max(1,Math.min(20,Number(body?.scene)||1));
    run.sceneResults=run.sceneResults&&typeof run.sceneResults==='object'?run.sceneResults:{};
    const old=run.sceneResults[scene];
    if(!old)throw new Error('Видео сцены не найдено');
    for(const pm of (Array.isArray(old.persistedMedia)?old.persistedMedia:[])){
      if(pm?.path)try{await callProductMedia({action:'delete',path:String(pm.path)})}catch(e){console.warn('[scene-video-delete] '+String(e?.message||e))}
    }
    delete run.sceneResults[scene];
    run.acceptedScenes=(Array.isArray(run.acceptedScenes)?run.acceptedScenes:[]).filter(x=>Number(x)!==scene);
    const urls=Object.keys(run.sceneResults).sort((a,b)=>Number(a)-Number(b)).flatMap(k=>run.sceneResults[k]?.urls||[]);
    run.generationResult={...(run.generationResult||{}),urls,completedScenes:Object.values(run.sceneResults).filter(x=>x?.ok&&x?.urls?.length).length,totalScenes:(run.storyboard||[]).length,completed:false};
    run.voiceoverResult=null;run.montageResult=null;run.qcResult=null;run.postProductionRunning=false;run.backendGenerationRunning=false;
    run.stage='Генерация';run.status='На проверке';run.awaitingApproval=true;run.progress=Math.min(65,Math.max(38,Number(run.progress)||38));run.updatedAt=new Date().toISOString();
    appendFactoryJournal(data,'Удалено видео сцены',(run.productName||run.id)+' · сцена '+scene);
    await writeAppState(data,accountId);return run;
  }
  if(action==='delete_previs_frame'){
    const frameId=String(body?.frameId||'');
    const scene=Math.max(1,Math.min(50,Number(body?.scene)||1));
    const frameNo=Math.max(1,Math.min(10,Number(body?.frame)||1));
    run.previsFrames=Array.isArray(run.previsFrames)?run.previsFrames:[];
    const pos=run.previsFrames.findIndex(x=>frameId?String(x?.id)===frameId:(Number(x?.scene)===scene&&Number(x?.frame)===frameNo));
    if(pos<0)throw new Error('Превиз-кадр не найден');
    const old=run.previsFrames[pos];
    if(old?.path){
      try{await callProductMedia({action:'delete',path:String(old.path)})}catch(e){console.warn('[previs-delete] '+String(e?.message||e))}
    }
    run.previsFrames.splice(pos,1);
    const expected=Number(run.previsPlan?.totalFrames)||((run.storyboard||[]).length*2);
    const ready=run.previsFrames.filter(x=>x?.url).length;
    run.previsResult={completed:false,totalFrames:ready,totalScenes:Number(run.previsPlan?.totalScenes)||run.sceneCount||0};
    invalidateAfterPrevisChange(run);
    appendFactoryJournal(data,'Удалён превиз-кадр',(run.productName||run.id)+' · сцена '+(old?.scene||scene)+' · кадр '+(old?.frame||frameNo));
    await writeAppState(data,accountId);
    return run;
  }
  if(action==='replace_previs_frame'){
    const frameId=String(body?.frameId||'');
    const scene=Math.max(1,Math.min(50,Number(body?.scene)||1));
    const frameNo=Math.max(1,Math.min(10,Number(body?.frame)||1));
    const media=body?.media&&typeof body.media==='object'?body.media:null;
    if(!media?.url||!media?.path)throw new Error('Загруженный кадр не передан');
    const prefix=(sanitizeAccountId(accountId)+'__').replace(/[^a-zA-Z0-9_-]/g,'');
    if(!String(media.path).startsWith(prefix))throw new Error('Этот файл не принадлежит текущему аккаунту');
    const planFrames=Array.isArray(run.previsPlan?.frames)?run.previsPlan.frames:[];
    const spec=planFrames.find(x=>frameId?String(x?.id)===frameId:(Number(x?.scene)===scene&&Number(x?.frame)===frameNo));
    if(!spec)throw new Error('Слот превиз-кадра не найден');
    run.previsFrames=Array.isArray(run.previsFrames)?run.previsFrames:[];
    const pos=run.previsFrames.findIndex(x=>String(x?.id)===String(spec.id));
    const old=pos>=0?run.previsFrames[pos]:null;
    if(old?.path&&old.path!==media.path){
      try{await callProductMedia({action:'delete',path:String(old.path)})}catch(e){console.warn('[previs-replace-delete] '+String(e?.message||e))}
    }
    const item={
      ...spec,
      ...(old||{}),
      url:String(media.url),
      path:String(media.path),
      fileName:String(media.fileName||('previs-'+spec.id+'.jpg')),
      mimeType:String(media.mimeType||'image/jpeg'),
      model:'user-upload',
      provider:'user',
      source:'user-upload',
      generatedAt:new Date().toISOString()
    };
    if(pos>=0)run.previsFrames[pos]=item;else run.previsFrames.push(item);
    run.previsFrames.sort((a,b)=>(Number(a.scene)-Number(b.scene))||(Number(a.frame)-Number(b.frame)));
    const expected=Number(run.previsPlan?.totalFrames)||planFrames.length||((run.storyboard||[]).length*2);
    const ready=run.previsFrames.filter(x=>x?.url).length;
    run.previsResult={
      completed:Boolean(expected&&ready>=expected),
      totalFrames:ready,
      totalScenes:Number(run.previsPlan?.totalScenes)||run.sceneCount||0,
      completedAt:expected&&ready>=expected?new Date().toISOString():null
    };
    invalidateAfterPrevisChange(run);
    if(run.previsResult.completed)run.progress=36;
    appendFactoryJournal(data,'Загружен свой превиз-кадр',(run.productName||run.id)+' · сцена '+spec.scene+' · кадр '+spec.frame);
    await writeAppState(data,accountId);
    return run;
  }
  if(action==='accept_scene'){
    const scene=Math.max(1,Math.min(20,Number(body?.scene)||1));
    const total=Number(run.generationResult?.totalScenes||0);
    const sceneResult=run.sceneResults?.[scene];
    const generatedUrls=Array.isArray(sceneResult?.urls)?sceneResult.urls.filter(Boolean):[];
    if(
      run.mode!=='manual' ||
      run.stage!=='На проверке' ||
      run.status!=='На проверке' ||
      !run.generationResult?.completed ||
      !total ||
      !sceneResult?.ok ||
      !generatedUrls.length
    ){
      throw new Error('Нельзя принять сцену до фактической генерации её видео.');
    }
    run.acceptedScenes=[...new Set([...(Array.isArray(run.acceptedScenes)?run.acceptedScenes:[]),scene])]
      .filter(n=>Number(n)>=1&&Number(n)<=total);
    const acceptedCount=new Set(run.acceptedScenes.map(Number)).size;
    run.updatedAt=new Date().toISOString();
    appendFactoryJournal(data,'Сцена утверждена',(run.productName||run.id)+' · сцена '+scene);
    if(acceptedCount>=total){
      run.status='В работе';run.stage='Озвучка';run.progress=Math.max(Number(run.progress)||0,74);run.awaitingApproval=false;run.postProductionRunning=false;
      appendFactoryJournal(data,'Все видео-сцены утверждены',(run.productName||run.id)+' · запускаю озвучку и монтаж');
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
    run.sceneRouting=null;
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
  if(action==='select_idea_option'){
    const option=applyIdeaOptionToRun(data,run,body?.optionId||body?.optionIndex);
    appendFactoryJournal(data,'Выбрана идея',(run.productName||run.id)+' · '+option.idea.title);
    await writeAppState(data,accountId);
    return run;
  }
  if(action==='launch_idea_option'){
    const options=(Array.isArray(run.ideaOptions)&&run.ideaOptions.length?run.ideaOptions:syncRunIdeaLibrary(data,run));
    const key=String(body?.optionId||body?.optionIndex||'');
    const option=options.find(x=>String(x.id)===key)||options.find(x=>String(x.index)===key);
    if(!option)throw new Error('Вариант идеи не найден');
    await writeAppState(data,accountId);
    return await launchSavedIdea(accountId,option.id);
  }
  if(action==='advance_stage'){
    const current=String(run.stage||'Идея');
    if(current==='Идея'){
      if(!run.idea)throw new Error('Идея ещё не готова');
      return await queueRunStageTask(accountId,runId,'script',String(body?.note||''));
    }
    if(current==='Сценарий'){
      if(!run.script)throw new Error('Сценарий ещё не готов — Storyboard запускать нельзя');
      const complete=scriptStageComplete(run.script);
      if(!complete.ok)throw new Error('Сценарий не прошёл проверку полноты');
      return await queueRunStageTask(accountId,runId,'storyboard',String(body?.note||''));
    }
    if(current==='Storyboard'){
      const storyboardBusy=(run.backgroundTask?.type==='storyboard'&&['queued','processing'].includes(String(run.backgroundTask?.status||''))) ||
        Object.values(run.storyboardSceneJobs||{}).some(j=>['queued','processing'].includes(String(j?.status||'')));
      if(storyboardBusy)throw new Error('Storyboard ещё обновляется. Дождись завершения текущей генерации сцены.');
      if(!run.script)throw new Error('Нельзя запускать превиз: сценарий отсутствует');
      if(!Array.isArray(run.storyboard)||!run.storyboard.length)throw new Error('Storyboard ещё не готов');
      const sbCheck=storyboardStageComplete(run.storyboard,(run.script?.scenes||[]).length);
      if(!sbCheck.ok)throw new Error('Storyboard заполнен не полностью: '+sbCheck.missing.map(x=>'сцена '+x.scene+' — '+x.fields.join(', ')).join('; '));
      run.previsRunning=false;run.previsStartedAt=null;run.previsHeartbeatAt=null;
      run.status='В работе';run.stage='Превиз-кадры';run.progress=28;run.awaitingApproval=false;run.previsPlan=null;run.previsFrames=[];run.previsResult=null;run.updatedAt=new Date().toISOString();
      appendFactoryJournal(data,'Запущен превиз',(run.productName||run.id)+' · фоновая генерация');
      await writeAppState(data,accountId);
      enqueueRunPrevis(accountId,run.id,'manual-previs');
      return run;
    }
    if(current==='Превиз-кадры'||current==='Референсы'){
      const expected=Number(run.previsPlan?.totalFrames)||((run.storyboard||[]).length*2);
      const ready=(Array.isArray(run.previsFrames)?run.previsFrames:[]).filter(x=>x?.url).length;
      if(!run.script)throw new Error('Нельзя запускать видео: сценарий отсутствует');
      if(!Array.isArray(run.storyboard)||!run.storyboard.length)throw new Error('Нельзя запускать видео: Storyboard отсутствует');
      if(!run.previsResult?.completed||!expected||ready<expected)throw new Error('Превиз ещё не готов полностью: '+ready+' из '+expected+' кадров');
      run.status='В работе';run.stage='Генерация';run.progress=38;run.awaitingApproval=false;run.updatedAt=new Date().toISOString();
      appendFactoryJournal(data,'Превиз утверждён',(run.productName||run.id)+' · запускаю видео в фоне');
      await writeAppState(data,accountId);
      dispatchExistingRun(accountId,run).catch(e=>console.error('[dispatch-existing] '+run.id+' '+String(e?.message||e)));
      return run;
    }
    throw new Error('Переход для этапа «'+current+'» ещё не настроен');
  }
  if(action==='start'||action==='resume'){
    run.paused=false;run.error='';run.updatedAt=new Date().toISOString();
    if(run.mode!=='manual'){
      run.status='В работе';run.awaitingApproval=false;
      await writeAppState(data,accountId);
      enqueueAutoPipeline(accountId,run.id);
      return run;
    }
    if(!run.idea){
      await writeAppState(data,accountId);
      return await queueRunStageTask(accountId,runId,'idea',String(body?.note||''));
    }
    if(!run.script&&['Сценарий','Storyboard'].includes(String(run.stage||''))){
      await writeAppState(data,accountId);
      return await queueRunStageTask(accountId,runId,'script',String(body?.note||''));
    }
    if(run.script&&(!Array.isArray(run.storyboard)||!run.storyboard.length)&&run.stage==='Storyboard'){
      await writeAppState(data,accountId);
      return await queueRunStageTask(accountId,runId,'storyboard',String(body?.note||''));
    }
    if(run.stage==='Генерация'){
      run.status='В работе';run.awaitingApproval=false;await writeAppState(data,accountId);
      dispatchExistingRun(accountId,run).catch(e=>console.error('[resume-generation] '+run.id+' '+String(e?.message||e)));
      return run;
    }
    if(run.stage==='Превиз-кадры'&&!run.previsResult?.completed){
      run.status='В работе';run.awaitingApproval=false;await writeAppState(data,accountId);enqueueRunPrevis(accountId,run.id,'resume-previs');return run;
    }
    run.status='На проверке';run.stage=run.stage==='Референсы'?'Превиз-кадры':(run.stage||'Идея');run.awaitingApproval=true;run.progress=Math.max(Number(run.progress)||0,8);
    await writeAppState(data,accountId);return run;
  }
  if(action==='regenerate'){
    const stage=String(body?.stage||'Идея');
    const note=String(body?.note||'');
    if(stage==='Идея'){
      run.idea=null;run.script=null;run.storyboard=[];run.references=null;run.previsPlan=null;run.previsFrames=[];run.previsResult=null;run.sceneCount=0;
      await writeAppState(data,accountId);
      return await queueRunStageTask(accountId,runId,'idea',note);
    }
    if(stage==='Сценарий'){
      if(!run.idea)throw new Error('Сначала нужна утверждённая идея');
      run.script=null;run.storyboard=[];run.references=null;run.previsPlan=null;run.previsFrames=[];run.previsResult=null;run.sceneCount=0;
      await writeAppState(data,accountId);
      return await queueRunStageTask(accountId,runId,'script',note);
    }
    if(stage==='Storyboard'){
      if(!run.script)throw new Error('Сначала нужен готовый сценарий');
      run.storyboard=[];run.references=null;run.previsPlan=null;run.previsFrames=[];run.previsResult=null;run.sceneCount=0;
      await writeAppState(data,accountId);
      return await queueRunStageTask(accountId,runId,'storyboard',note);
    }
    if(stage==='Превиз-кадры'||stage==='Референсы'){
      run.previsPlan=null;run.previsFrames=[];run.previsResult=null;run.previsError='';run.error='';run.status='В работе';run.stage='Превиз-кадры';run.progress=28;run.awaitingApproval=false;run.updatedAt=new Date().toISOString();
      appendFactoryJournal(data,'Превиз переделывается',run.productName||run.id);
      await writeAppState(data,accountId);
      enqueueRunPrevis(accountId,run.id,'regenerate-previs');
      return run;
    }
    if(stage==='Генерация'){
      run.sceneResults={};run.generationResult=null;run.acceptedScenes=[];
      run.voiceoverResult=null;run.montageResult=null;run.qcResult=null;run.postProductionRunning=false;
      run.status='В работе';run.stage='Генерация';run.progress=38;run.attempt=(Number(run.attempt)||0)+1;run.awaitingApproval=false;run.error='';run.generationError='';
      await writeAppState(data,accountId);
      dispatchExistingRun(accountId,run).catch(e=>console.error('[regen-generation] '+run.id+' '+String(e?.message||e)));
      return run;
    }
    if(stage==='Озвучка'){
      run.voiceoverResult=null;run.montageResult=null;run.qcResult=null;run.postProductionRunning=false;
      run.status='В работе';run.stage='Озвучка';run.progress=74;run.awaitingApproval=false;run.error='';
      await writeAppState(data,accountId);
      enqueueSpecificPostStage(accountId,run.id,'Озвучка');
      return run;
    }
    if(stage==='Монтаж'){
      run.montageResult=null;run.qcResult=null;run.postProductionRunning=false;
      run.status='В работе';run.stage='Монтаж';run.progress=80;run.awaitingApproval=false;run.error='';
      await writeAppState(data,accountId);
      enqueueSpecificPostStage(accountId,run.id,'Монтаж');
      return run;
    }
    if(stage==='AI-проверка'){
      if(!run.montageResult?.url)throw new Error('Сначала нужен готовый монтаж');
      run.qcResult=null;run.postProductionRunning=false;
      run.status='В работе';run.stage='AI-проверка';run.progress=88;run.awaitingApproval=false;run.error='';
      await writeAppState(data,accountId);
      enqueueSpecificPostStage(accountId,run.id,'AI-проверка');
      return run;
    }
    throw new Error('Переделка этапа «'+stage+'» не поддерживается');
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
    version:1,products:[],runs:[],campaigns:[],scripts:[],savedIdeas:[],characters:[],journal:[],expenses:[],settings:{}
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
    const payload={
      action:'create_batch',
      accountId,
      batchId:factoryId('batch'),
      productId:product.id,
      productName:product.name,
      brief:String(args.brief||'').slice(0,12000),
      style:String(args.style||'UGC').slice(0,120),
      duration:String(args.duration||'30 сек').slice(0,80),
      count:String(count),
      variantCount:count,
      format:'9:16',
      platforms:[],
      mode:data.settings.mode||'auto',
      modelMode:String(args.modelMode||'Авто — умный выбор').slice(0,120),
      budget:clampNumber(args.budget,0,1000000,500),
      maxAttempts:Math.round(clampNumber(args.maxAttempts,1,10,data.settings.budgetAttempts||3)),
      created:new Date().toISOString()
    };
    const created=await createBatchRuns(payload,accountId);
    return {
      ok:true,accepted:true,background:true,
      batchId:created.batchId,count:created.runs.length,product:product.name,
      runs:created.runs.map(r=>({id:r.id,status:r.status,stage:r.stage,progress:r.progress}))
    };
  }

  if(name==='retry_failed_runs'){
    const product=args.product?findProductInState(data,args.product):null;
    const retryIds=data.runs.filter(run=>run.status==='Ошибка' && (!product||run.productId===product.id)).map(run=>run.id);
    for(const id of retryIds){
      const run=findRunById(data,id);
      if(!run)continue;
      run.status='В работе';run.paused=false;run.error='';run.attempt=(Number(run.attempt)||1)+1;run.updatedAt=new Date().toISOString();
    }
    if(retryIds.length){
      appendFactoryJournal(data,'ChatGPT перезапустил ошибки','Запусков: '+retryIds.length+' · в фоне');
      await writeAppState(data,accountId);
      for(const id of retryIds){
        runControlAction({runId:id,action:'resume',note:'Фоновый повтор ошибочного этапа'},accountId)
          .catch(e=>console.error('[retry-failed-background] '+id+' '+String(e?.message||e)));
      }
    }
    return {ok:true,accepted:true,background:true,retried:retryIds.length,runIds:retryIds};
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
    appendFactoryJournal(data,'ChatGPT удалил запуск',(run.productName||'Ролик')+' · '+run.id+' · идеи сохранены отдельно');
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
      model:process.env.OPENAI_MODEL||'gpt-6-astra',
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
        model:process.env.OPENAI_MODEL||'gpt-6-astra',
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

  const usedModel=data?.model||process.env.OPENAI_MODEL||'gpt-6-astra';
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
    model:data?.model||process.env.OPENAI_MODEL||'gpt-6-astra'
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
  const startImageUrl=String(body?.startImageUrl||refs[0]||'').trim();
  const endImageUrl=String(body?.endImageUrl||refs[1]||'').trim();
  const duration=clampNumber(body?.duration,4,30,5);
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

  const useKeyframes=body?.useKeyframes!==false&&Boolean(startImageUrl);
  const model=String(
    body?.model ||
    (useKeyframes ? 'bytedance/seedance-2.5/image-to-video' : (refs.length ? 'bytedance/seedance-2.5/reference-to-video' : 'bytedance/seedance-2.5/text-to-video'))
  );

  const input={
    prompt,
    duration,
    resolution:String(body?.resolution || '720p'),
    output_format:'mp4',
    bitrate_mode:String(body?.bitrateMode||'high'),
    generate_audio:generateAudio
  };
  if(useKeyframes){
    input.image_url=startImageUrl;
    if(endImageUrl&&endImageUrl!==startImageUrl)input.end_image_url=endImageUrl;
  }else{
    input.aspect_ratio=aspectRatio;
    if(refs.length) input.image_urls=refs;
  }

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
  const hfJobs=Math.max(1,jobs.length||1);
  const hfRub=(Number(hfRates.higgsfieldRubPerGeneration)||0)*hfJobs;
  const hfUsage={jobs:hfJobs,duration,estimatedCredits:/seedance[-_. /]?2(?:\.0)?/i.test(String(model||''))?4.5*duration*hfJobs:null};
  await recordExpense(hfAccount,{
    provider:'Higgsfield',category:'generation',description:'Генерация видео',amountRub:hfRub,
    amountUsd:hfRub>0?0:higgsfieldUsageUsd(model,hfUsage),
    usage:hfUsage,model,source:hfRub>0?'auto':'auto-estimated'
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
  const duration=Math.max(2,Math.min(10,Math.round(requested)));
  const ratio=String(body?.ratio||'720:1280');
  const client=new RunwayML({apiKey:process.env.RUNWAYML_API_SECRET});
  const model=normalizedRunwayModel(body?.model||process.env.RUNWAY_MODEL);

  try{
    const pending=client.imageToVideo.create({
      model,
      ...(refs[0]?{promptImage:(refs[1]&&refs[1]!==refs[0]?[{uri:refs[0],position:'first'},{uri:refs[1],position:'last'}]:refs[0])}:{}),
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
    const rwUsd=rwRub>0?0:runwayUsageUsd(model,duration);
    await recordExpense(rwAccount,{
      provider:'Runway',category:'generation',description:'Генерация видео',amountRub:rwRub,amountUsd:rwUsd,
      usage:{seconds:duration,credits:runwayCreditsPerSecond(model)*duration,usdPerCredit:0.01},
      model,source:rwRub>0?'auto':'auto-priced'
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
async function detectVideoShots(filePath,duration,maxShots=10){
  let cuts=[];
  try{
    const {stderr}=await execFile('ffmpeg',[
      '-hide_banner','-loglevel','info','-i',filePath,
      '-vf','select=gt(scene\\,0.18),showinfo','-an','-f','null','-'
    ],{timeout:120000,maxBuffer:12*1024*1024});
    const rx=/pts_time:([0-9.]+)/g;let m;
    while((m=rx.exec(String(stderr||''))))cuts.push(Number(m[1]));
  }catch{}
  cuts=cuts.filter(x=>Number.isFinite(x)&&x>0.25&&x<duration-0.2).sort((a,b)=>a-b);
  const cleaned=[];
  for(const t of cuts){
    if(!cleaned.length||t-cleaned[cleaned.length-1]>=0.45)cleaned.push(t);
  }
  cuts=cleaned.slice(0,Math.max(0,maxShots-1));
  if(!cuts.length&&duration>2.4){
    const target=Math.max(1,Math.min(maxShots,Math.round(duration/2)));
    cuts=Array.from({length:target-1},(_,i)=>Number((((i+1)*duration)/target).toFixed(3)));
  }
  const boundaries=[0,...cuts,duration];
  const shots=[];
  for(let i=0;i<boundaries.length-1;i++){
    const a=boundaries[i],b=boundaries[i+1];
    if(b-a<0.35&&shots.length){
      shots[shots.length-1].end=b;
      shots[shots.length-1].duration=Number((shots[shots.length-1].end-shots[shots.length-1].start).toFixed(3));
      continue;
    }
    shots.push({shot:i+1,start:Number(a.toFixed(3)),end:Number(b.toFixed(3)),duration:Number((b-a).toFixed(3))});
  }
  return shots.slice(0,maxShots);
}
async function extractFrameAt(filePath,dir,time,name){
  const out=path.join(dir,name+'.jpg');
  await execFile('ffmpeg',[
    '-hide_banner','-loglevel','error','-ss',String(Math.max(0,Number(time)||0)),'-i',filePath,
    '-frames:v','1','-vf','scale=900:-2:force_original_aspect_ratio=decrease','-q:v','2','-y',out
  ],{timeout:45000});
  return out;
}
async function persistAnalysisKeyframes(accountId,sourceName,keyframes=[]){
  const scope=(String(accountId||'main')+'__analysis_'+Date.now().toString(36)).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);
  const saved=[];
  for(const kf of keyframes){
    try{
      const fileName=('shot-'+kf.shot+'-'+kf.phase+'-'+String(kf.time).replace('.','_')+'.jpg').slice(0,120);
      const data=await callProductMedia({
        action:'upload',productId:scope,fileName,mimeType:'image/jpeg',
        dataBase64:fs.readFileSync(kf.path).toString('base64')
      });
      if(data?.media?.url)saved.push({...kf,url:data.media.url,storagePath:data.media.path||'',fileName});
    }catch(e){
      saved.push({...kf,uploadError:String(e?.message||e)});
    }
  }
  return saved;
}
async function extractVideoEvidence(filePath,opts={}){
  const duration=await probeDuration(filePath);
  const dir=fs.mkdtempSync('/tmp/cf-video-');
  const detailed=opts?.detailed===true;
  const audioPath=path.join(dir,'audio.mp3');
  let hasAudio=false;
  try{
    await execFile('ffmpeg',['-hide_banner','-loglevel','error','-i',filePath,'-vn','-ac','1','-ar','16000','-b:a','96k','-y',audioPath],{timeout:120000});
    hasAudio=fs.existsSync(audioPath)&&fs.statSync(audioPath).size>1000;
  }catch{}
  if(!detailed){
    const fps=Math.max(.02,Math.min(2,10/Math.max(1,duration)));
    const framePattern=path.join(dir,'frame-%02d.jpg');
    await execFile('ffmpeg',['-hide_banner','-loglevel','error','-i',filePath,'-vf','fps='+fps+',scale=768:-2:force_original_aspect_ratio=decrease','-q:v','3','-frames:v','10','-y',framePattern],{timeout:120000});
    const names=fs.readdirSync(dir).filter(x=>/^frame-.*\.jpg$/i.test(x)).sort().slice(0,10);
    const frameSamples=names.map((name,index)=>{
      const filePath=path.join(dir,name),b=fs.readFileSync(filePath);
      const dataUrl='data:image/jpeg;base64,'+b.toString('base64');
      return {index:index+1,timeSec:Number(Math.min(duration,(index+0.5)/Math.max(.02,fps)).toFixed(3)),filePath,dataUrl};
    });
    const frames=frameSamples.map(x=>({type:'input_image',image_url:x.dataUrl,detail:'low'}));
    return {duration,dir,frames,analysisParts:frames,frameSamples,audioPath:hasAudio?audioPath:null,audioPresent:hasAudio,shots:[],keyframes:[]};
  }
  const shots=await detectVideoShots(filePath,duration,10);
  const keyframes=[];
  for(const shot of shots){
    const phases=shots.length<=6
      ? [
          ['start',Math.min(shot.end-0.05,shot.start+0.08)],
          ['mid',shot.start+(shot.duration/2)],
          ['end',Math.max(shot.start+0.05,shot.end-0.08)]
        ]
      : [
          ['start',Math.min(shot.end-0.05,shot.start+0.08)],
          ['end',Math.max(shot.start+0.05,shot.end-0.08)]
        ];
    for(const [phase,tRaw] of phases){
      const t=Number(Math.max(0,Math.min(duration,Number(tRaw)||0)).toFixed(3));
      try{
        const p=await extractFrameAt(filePath,dir,t,'shot-'+shot.shot+'-'+phase);
        keyframes.push({shot:shot.shot,phase,time:t,path:p,start:shot.start,end:shot.end});
      }catch{}
    }
  }
  const analysisParts=[];
  const frames=[];
  const frameSamples=[];
  for(let i=0;i<keyframes.length;i++){
    const kf=keyframes[i],b=fs.readFileSync(kf.path),dataUrl='data:image/jpeg;base64,'+b.toString('base64');
    analysisParts.push({type:'input_text',text:'SOURCE VIDEO · SHOT '+kf.shot+' · '+String(kf.phase).toUpperCase()+' · t='+kf.time.toFixed(3)+'s · shot range '+kf.start.toFixed(3)+'–'+kf.end.toFixed(3)+'s'});
    const img={type:'input_image',image_url:dataUrl,detail:'high'};
    analysisParts.push(img);frames.push(img);
    frameSamples.push({index:i+1,timeSec:kf.time,filePath:kf.path,dataUrl,shot:kf.shot,phase:kf.phase,start:kf.start,end:kf.end});
  }
  return {duration,dir,frames,analysisParts,frameSamples,audioPath:hasAudio?audioPath:null,audioPresent:hasAudio,shots,keyframes};
}
function openAIQuotaError(error){
  const msg=String(error?.message||error||'').toLowerCase();
  return /no credits remaining|insufficient_quota|insufficient quota|billing|quota|credit balance|out of credits/.test(msg);
}
function humanVideoAnalysisError(error){
  const msg=String(error?.message||error||'');
  if(openAIQuotaError(error))return 'На OpenAI API закончился баланс. Автоматически пробую резервный разбор через Descript.';
  if(/401|invalid api key|incorrect api key|unauthorized/i.test(msg))return 'OpenAI API ключ недействителен. Автоматически пробую резервный разбор через Descript.';
  if(/429|rate limit/i.test(msg))return 'OpenAI временно ограничил запросы. Автоматически пробую резервный разбор через Descript.';
  return msg;
}
async function waitDescriptJob(jobId,timeoutMs=240000){
  const started=Date.now();
  while(Date.now()-started<timeoutMs){
    const job=await descriptRequest('/jobs/'+encodeURIComponent(jobId));
    if(String(job?.job_state||'').toLowerCase()==='stopped'){
      if(String(job?.result?.status||'').toLowerCase()!=='success'){
        throw new Error('Descript job failed: '+String(job?.result?.error||job?.result?.message||job?.result?.status||'unknown'));
      }
      return job;
    }
    if(String(job?.job_state||'').toLowerCase()==='cancelled')throw new Error('Descript job cancelled');
    await new Promise(r=>setTimeout(r,2500));
  }
  throw new Error('Descript превысил время ожидания');
}
function videoAnalysisJsonSchema(){
  const shotProps={
    shot:{type:'integer',minimum:1,maximum:30},
    start:{type:'number',minimum:0},end:{type:'number',minimum:0},duration:{type:'number',minimum:0},
    purpose:{type:'string'},frameSummary:{type:'string'},framing:{type:'string'},cameraAngle:{type:'string'},cameraHeight:{type:'string'},
    lensEstimate:{type:'string'},cameraMotion:{type:'string'},focusDepth:{type:'string'},lighting:{type:'string'},
    environment:{type:'string'},setDesign:{type:'string'},foreground:{type:'string'},midground:{type:'string'},background:{type:'string'},
    props:{type:'string'},materials:{type:'string'},colorPalette:{type:'string'},characterBlocking:{type:'string'},handAction:{type:'string'},
    productStateStart:{type:'string'},action:{type:'string'},productStateEnd:{type:'string'},spokenLine:{type:'string'},onscreenText:{type:'string'},
    sfx:{type:'string'},music:{type:'string'},transitionIn:{type:'string'},transitionOut:{type:'string'},
    retentionMechanic:{type:'string'},openLoop:{type:'string'},microPayoff:{type:'string'},whyWorks:{type:'string'},weakness:{type:'string'},improvement:{type:'string'}
  };
  const adaptSceneProps={
    scene:{type:'integer',minimum:1,maximum:30},time:{type:'string'},duration:{type:'number',minimum:0},
    purpose:{type:'string'},shot:{type:'string'},environment:{type:'string'},setDesign:{type:'string'},camera:{type:'string'},lens:{type:'string'},
    lighting:{type:'string'},avatarAction:{type:'string'},productAction:{type:'string'},voiceover:{type:'string'},onscreen:{type:'string'},
    sound:{type:'string'},transition:{type:'string'},retentionMechanic:{type:'string'},productLock:{type:'string'}
  };
  return {
    type:'object',additionalProperties:false,
    required:['summary','hook','whyWorks','weaknesses','sourceBlueprint','adaptation'],
    properties:{
      summary:{type:'string'},hook:{type:'string'},
      whyWorks:{type:'array',maxItems:20,items:{type:'string'}},
      weaknesses:{type:'array',maxItems:20,items:{type:'string'}},
      sourceBlueprint:{
        type:'object',additionalProperties:false,
        required:['durationSeconds','sourceHook','scriptSummary','exactVoiceover','onscreenTextTimeline','visualDNA','cameraGrammar','lightingGrammar','setGrammar','editingGrammar','audioGrammar','shots'],
        properties:{
          durationSeconds:{type:'number',minimum:0},sourceHook:{type:'string'},scriptSummary:{type:'string'},exactVoiceover:{type:'string'},
          onscreenTextTimeline:{type:'array',maxItems:30,items:{type:'string'}},
          visualDNA:{type:'string'},cameraGrammar:{type:'string'},lightingGrammar:{type:'string'},setGrammar:{type:'string'},
          editingGrammar:{type:'string'},audioGrammar:{type:'string'},
          shots:{type:'array',minItems:1,maxItems:30,items:{type:'object',additionalProperties:false,required:Object.keys(shotProps),properties:shotProps}}
        }
      },
      adaptation:{
        type:'object',additionalProperties:false,
        required:['concept','hook','structure','voiceover','productionBible','differencesFromSource','scenes','cta'],
        properties:{
          concept:{type:'string'},hook:{type:'string'},structure:{type:'string'},voiceover:{type:'string'},productionBible:{type:'string'},
          differencesFromSource:{type:'array',maxItems:20,items:{type:'string'}},
          scenes:{type:'array',minItems:1,maxItems:30,items:{type:'object',additionalProperties:false,required:Object.keys(adaptSceneProps),properties:adaptSceneProps}},
          cta:{type:'string'}
        }
      }
    }
  };
}
function videoAnalysisPrompt({sourceName='',sourceType='video',product=null,avatar=null,metadata={},transcript='',timedTranscript='',shotMap=[]}) {
  return [
    'ROLE: forensic video reverse-engineering director + performance creative strategist.',
    'Задача состоит из ДВУХ последовательных частей. Сначала максимально точно восстанови устройство ИСХОДНОГО ролика. Только после этого создай улучшенную самостоятельную адаптацию.',
    '',
    'PART 1 — SOURCE BLUEPRINT. Не пересказывай ролик общими словами. Восстанови его как монтажный проект:',
    '- таймкод каждой склейки и длительность каждого shot;',
    '- START/MID/END состояние действия в shot;',
    '- крупность, ракурс, высоту камеры, приблизительное focal-length feel, движение камеры, focus/depth;',
    '- точный интерьер: тип помещения, мебель, поверхности, foreground/midground/background, props и их положение, материалы, цветовую палитру;',
    '- свет: источник, направление, мягкость, цветовую температуру, practicals, характер теней и highlights;',
    '- положение героя, рук и товара; хват, траекторию и физическую последовательность действий;',
    '- весь видимый текст на экране с примерным временем;',
    '- речь/озвучку из транскрипта с таймингами; если речи нет — прямо укажи это;',
    '- foley/SFX/music/silence/J-cut/L-cut только там, где это реально подтверждается данными. Не выдумывай звук;',
    '- тип входящей/исходящей склейки, cut-on-action/match-on-action если видимо;',
    '- retention mechanic, open loop и micro-payoff каждого shot;',
    '- почему конкретный shot работает и что в нём можно улучшить.',
    'SOURCE BLUEPRINT должен позволять другому режиссёру восстановить структуру ролика без просмотра оригинала.',
    '',
    'PART 2 — IMPROVED COPY. Создай НОВУЮ версию под наш товар и AI-аватара.',
    'Сохраняй рабочую механику, ритм, порядок доказательств и типы визуальных beats, но НЕ копируй дословные чужие реплики, брендинг, музыку, водяные знаки или уникальную художественную постановку.',
    'Улучшенная версия должна быть сильнее исходника: более быстрый scroll-stop, понятнее open loop, больше визуального контраста, точнее proof, насыщеннее set design, естественнее герой, лучше sound bridges и более сильный payoff.',
    'Если наш товар отличается по конструкции — адаптируй ДЕЙСТВИЕ под реальный товар. Никогда не изменяй товар ради повторения исходника.',
    'Каждая adaptation.scenes должна быть production-ready: time, duration, purpose, shot, environment, setDesign, camera, lens, lighting, avatarAction, productAction, voiceover, onscreen, sound, transition, retentionMechanic, productLock.',
    '',
    'КЛЮЧЕВОЕ ПРАВИЛО КАДРОВ: изображения после этого текста подписаны SOURCE VIDEO · SHOT N · START/MID/END с точным timestamp. Используй их как доказательства, а не как вдохновение. Не смешивай разные shots.',
    'Автоматически найденные shot ranges: '+JSON.stringify(shotMap||[]),
    'Источник: '+String(sourceType)+'. Название: '+String(sourceName||'без названия')+'.',
    'Метаданные: '+JSON.stringify(metadata||{}),
    timedTranscript?('ТОЧНЫЙ ТРАНСКРИПТ С ТАЙМКОДАМИ:\n'+String(timedTranscript).slice(0,45000)):(transcript?('ТРАНСКРИПТ:\n'+String(transcript).slice(0,45000)):'Речь не извлечена или в ролике нет речи. Не придумывай точные реплики.'),
    'Наш товар: '+(product?JSON.stringify({name:product.name,category:product.category,utp:product.utp,rules:product.rules,productDNA:product.productDNA||null}):'НЕ ВЫБРАН — Source Blueprint делай полностью, а adaptation пометь как предварительную без конкретных неподтверждённых свойств товара')+'.',
    'Наш AI-аватар: '+(avatar?JSON.stringify({name:avatar.name,age:avatar.age,look:avatar.look,voice:avatar.voice,topics:avatar.topics,locks:avatar.locks}):'не выбран')+'.',
    product?universalProductIdentityLock({product,productDNA:product.productDNA}):'',
    'Не выдумывай то, чего не видно/не слышно. Lens — только оценка типа 24–35mm feel / 50mm feel / 85mm macro feel, а не утверждение о реальной камере.',
    'Верни только JSON по заданной схеме.'
  ].filter(Boolean).join('\n');
}
async function saveVideoAnalysisResult(opts,analysis,provider,extra={}){
  const accountId=opts.accountId;
  const state=await readAppState(accountId);
  const data=state?.data||blankFactoryState();
  data.videoAnalyses=Array.isArray(data.videoAnalyses)?data.videoAnalyses:[];
  const product=findProductInState(data,opts.productId)||null;
  const avatar=findCharacterInState(data,opts.avatarId)||null;
  const item={
    id:String(opts.analysisId||factoryId('va')),
    sourceType:String(opts.sourceType||'video'),
    sourceName:String(opts.sourceName||'Видео').slice(0,240),
    sourceUrl:String(opts.sourceUrl||'').slice(0,2000),
    productId:product?.id||'',productName:product?.name||'',
    avatarId:avatar?.id||'',avatarName:avatar?.name||'',
    transcript:String(opts.transcript||'').slice(0,50000),
    timedTranscript:String(opts.timedTranscript||'').slice(0,70000),
    transcriptStatus:String(opts.transcriptStatus||opts.transcription?.status||'').slice(0,80),
    transcriptError:String(opts.transcriptError||'').slice(0,1000),
    transcription:opts.transcription&&typeof opts.transcription==='object'?{
      status:String(opts.transcription.status||''),model:String(opts.transcription.model||''),fallback:String(opts.transcription.fallback||'').slice(0,1000),
      segments:Array.isArray(opts.transcription.segments)?opts.transcription.segments.slice(0,200):[]
    }:null,
    audioPresent:Boolean(opts.audioPresent),
    shotMap:Array.isArray(opts.shotMap)?opts.shotMap.slice(0,30):[],
    keyframes:Array.isArray(opts.keyframes)?opts.keyframes.slice(0,40).map(x=>({
      shot:Number(x?.shot)||0,phase:String(x?.phase||''),time:Number(x?.time)||0,url:String(x?.url||'').slice(0,2000),
      storagePath:String(x?.storagePath||'').slice(0,2000),fileName:String(x?.fileName||'').slice(0,240)
    })):[],
    frameSamples:Array.isArray(opts.frameSamples)?opts.frameSamples.slice(0,30).map(x=>({index:Number(x.index)||0,timeSec:Number(x.timeSec)||0,url:String(x.url||'').slice(0,2000),path:String(x.path||'').slice(0,2000)})):[],
    analysis,
    provider:String(provider||''),
    fallbackFrom:String(extra.fallbackFrom||''),
    providerNote:String(extra.providerNote||''),
    descriptProjectUrl:String(extra.descriptProjectUrl||''),
    createdAt:new Date().toISOString()
  };
  data.videoAnalyses.push(item);
  data.videoAnalyses=data.videoAnalyses.slice(-100);
  appendFactoryJournal(data,'Разобрано видео',item.sourceName+' · '+String(provider||'AI'));
  await writeAppState(data,accountId);
  return item;
}
async function analyzeTranscriptWithDescript(opts){
  if(!process.env.DESCRIPT_API_TOKEN)throw new Error('Descript API не подключён');
  const state=await readAppState(opts.accountId),data=state?.data||blankFactoryState();
  const product=findProductInState(data,opts.productId)||null;
  const avatar=findCharacterInState(data,opts.avatarId)||null;
  const created=await descriptRequest('/jobs/agent',{
    method:'POST',
    body:{
      project_name:'Content Factory analysis '+Date.now(),
      prompt:videoAnalysisPrompt({...opts,product,avatar})
    }
  });
  if(!created?.job_id)throw new Error('Descript не вернул job_id');
  const done=await waitDescriptJob(created.job_id,240000);
  const raw=String(done?.result?.agent_response||'').trim();
  const analysis=safeAnalysisJson(raw);
  return await saveVideoAnalysisResult(opts,analysis,'Descript',{
    fallbackFrom:'OpenAI',
    providerNote:'Резервный анализ через Descript Agent',
    descriptProjectUrl:done?.project_url||created?.project_url||''
  });
}
async function analyzeUploadedVideoWithDescript(filePath,opts){
  if(!process.env.DESCRIPT_API_TOKEN)throw new Error('Descript API не подключён');
  const stat=fs.statSync(filePath);
  const mediaKey='source'+(path.extname(opts.sourceName||filePath)||'.mp4');
  const mimeType=String(opts.mimeType||'video/mp4');
  const importJob=await descriptRequest('/jobs/import/project_media',{
    method:'POST',
    body:{
      project_name:'Content Factory competitor '+Date.now(),
      add_media:{[mediaKey]:{content_type:mimeType,file_size:stat.size}},
      add_compositions:[{name:'Source',clips:[{media:mediaKey}],width:1080,height:1920,fps:30}]
    }
  });
  if(!importJob?.job_id)throw new Error('Descript import не вернул job_id');
  const uploadUrl=importJob?.upload_urls?.[mediaKey]?.upload_url;
  if(!uploadUrl)throw new Error('Descript не вернул URL для загрузки видео');
  const put=await fetch(uploadUrl,{
    method:'PUT',
    headers:{'content-type':'application/octet-stream'},
    body:fs.readFileSync(filePath)
  });
  if(!put.ok)throw new Error('Descript upload error '+put.status);
  const imported=await waitDescriptJob(importJob.job_id,300000);
  const projectId=imported?.project_id||importJob?.project_id;
  if(!projectId)throw new Error('Descript не вернул project_id');
  const state=await readAppState(opts.accountId),data=state?.data||blankFactoryState();
  const product=findProductInState(data,opts.productId)||null;
  const avatar=findCharacterInState(data,opts.avatarId)||null;
  const agentJob=await descriptRequest('/jobs/agent',{
    method:'POST',
    body:{project_id:projectId,prompt:videoAnalysisPrompt({...opts,product,avatar,transcript:''})}
  });
  if(!agentJob?.job_id)throw new Error('Descript Agent не вернул job_id');
  const done=await waitDescriptJob(agentJob.job_id,300000);
  const raw=String(done?.result?.agent_response||'').trim();
  const analysis=safeAnalysisJson(raw);
  return await saveVideoAnalysisResult(opts,analysis,'Descript',{
    fallbackFrom:'OpenAI',
    providerNote:'OpenAI недоступен; видео разобрано резервно через Descript',
    descriptProjectUrl:done?.project_url||imported?.project_url||importJob?.project_url||''
  });
}

async function persistVideoAnalysisFrames(accountId,analysisId,samples=[]){
  const scoped=(sanitizeAccountId(accountId)+'__analysis_'+String(analysisId||factoryId('va'))).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);
  const out=[];
  const list=(Array.isArray(samples)?samples:[]).slice(0,24);
  for(let from=0;from<list.length;from+=4){
    const batch=list.slice(from,from+4);
    const rows=await Promise.all(batch.map(async x=>{
      try{
        const phase=String(x.phase||'frame').replace(/[^a-z0-9_-]/gi,'');
        const data=await callProductMedia({
          action:'upload',productId:scoped,
          fileName:'shot-'+String(x.shot||x.index||0).padStart(2,'0')+'-'+phase+'-'+Math.round((Number(x.timeSec)||0)*1000)+'.jpg',
          mimeType:'image/jpeg',
          dataBase64:fs.readFileSync(x.filePath).toString('base64')
        });
        return {index:x.index,timeSec:x.timeSec,shot:Number(x.shot)||0,phase:String(x.phase||''),start:Number(x.start)||0,end:Number(x.end)||0,url:data?.media?.url||'',path:data?.media?.path||''};
      }catch(e){
        console.warn('[video-analysis-frame-upload] '+String(e?.message||e));
        return {index:x.index,timeSec:x.timeSec,url:'',path:''};
      }
    }));
    out.push(...rows.filter(x=>x.url));
  }
  return out;
}
function analysisImageParts(frameSamples=[]){
  const parts=[];
  for(const x of (Array.isArray(frameSamples)?frameSamples:[])){
    parts.push({type:'input_text',text:'SOURCE FRAME '+x.index+' · approx '+Number(x.timeSec||0).toFixed(2)+'s'});
    parts.push({type:'input_image',image_url:x.dataUrl,detail:'low'});
  }
  return parts;
}
async function transcribeAudioDetailed(audioPath){
  if(!audioPath||!fs.existsSync(audioPath))return {text:'',timedText:'',segments:[],status:'no-audio',model:''};
  const stat=fs.statSync(audioPath);
  if(stat.size>25*1024*1024)return {text:'',timedText:'',segments:[],status:'too-large',model:''};
  const call=async(model,responseFormat)=>{
    const form=new FormData();
    form.append('model',model);
    form.append('file',new Blob([fs.readFileSync(audioPath)],{type:'audio/mpeg'}),'audio.mp3');
    form.append('response_format',responseFormat);
    if(model==='gpt-4o-transcribe-diarize')form.append('chunking_strategy','auto');
    if(model==='whisper-1'){
      form.append('timestamp_granularities[]','segment');
      form.append('temperature','0');
    }
    const r=await fetch('https://api.openai.com/v1/audio/transcriptions',{
      method:'POST',headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY},body:form
    });
    const txt=await r.text();let data;try{data=txt?JSON.parse(txt):{}}catch{data={raw:txt}}
    if(!r.ok){
      const e=new Error(data?.error?.message||('Transcription error '+r.status));
      e.status=r.status;e.code=data?.error?.code||'';throw e;
    }
    return data;
  };
  let data=null,model='gpt-4o-transcribe-diarize',fallback='';
  try{
    data=await call(model,'diarized_json');
  }catch(e){
    fallback=String(e?.message||e);
    model='whisper-1';
    data=await call(model,'verbose_json');
  }
  const rawSegments=Array.isArray(data?.segments)?data.segments:[];
  const segments=rawSegments.map((x,i)=>({
    index:i+1,
    start:Number(x?.start)||0,
    end:Number(x?.end)||0,
    speaker:String(x?.speaker||''),
    text:String(x?.text||'').trim()
  })).filter(x=>x.text);
  const text=String(data?.text||segments.map(x=>x.text).join(' ')).trim();
  const timedText=segments.map(x=>{
    const speaker=x.speaker?(' '+x.speaker):'';
    return '['+x.start.toFixed(2)+'–'+x.end.toFixed(2)+'s'+speaker+'] '+x.text;
  }).join('\n');
  return {text,timedText,segments,status:text?'ready':'no-speech',model,fallback};
}
async function transcribeAudio(audioPath){
  return (await transcribeAudioDetailed(audioPath)).text;
}
async function analyzeReferenceMaterial(opts){
  const accountId=opts.accountId;
  const state=await readAppState(accountId);
  const data=state?.data||blankFactoryState();
  data.videoAnalyses=Array.isArray(data.videoAnalyses)?data.videoAnalyses:[];
  const product=findProductInState(data,opts.productId)||null;
  const avatar=findCharacterInState(data,opts.avatarId)||null;
  const prompt=videoAnalysisPrompt({
    sourceName:opts.sourceName,sourceType:opts.sourceType,product,avatar,
    metadata:opts.metadata||{},transcript:opts.transcript||'',timedTranscript:opts.timedTranscript||'',shotMap:opts.shotMap||[]
  });
  const extraImages=[];
  const productMedia=(Array.isArray(product?.media)?product.media:[]).filter(m=>/^https:\/\//i.test(String(m?.url||''))).sort((a,b)=>Number(!!b?.isPrimary)-Number(!!a?.isPrimary)).slice(0,3);
  if(productMedia.length){
    extraImages.push({type:'input_text',text:'TARGET PRODUCT REFERENCES — use ONLY for the improved adaptation, NEVER as evidence of what appears in the source video.'});
    for(const m of productMedia)extraImages.push({type:'input_image',image_url:m.url,detail:'high'});
  }
  const am=(avatar?.media||[]).find(m=>m.isPrimary)||(avatar?.media||[])[0];
  if(am?.url){
    extraImages.push({type:'input_text',text:'TARGET AI AVATAR REFERENCE — use ONLY for the improved adaptation.'});
    extraImages.push({type:'input_image',image_url:am.url,detail:'high'});
  }
  const model=process.env.OPENAI_MODEL||'gpt-6-astra';
  const r=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'content-type':'application/json'},
    body:JSON.stringify({
      model,
      input:[{role:'user',content:[{type:'input_text',text:prompt},...(opts.imageParts||[]),...extraImages]}],
      reasoning:{effort:'high'},max_output_tokens:14000,
      text:{format:{type:'json_schema',name:'forensic_video_analysis',strict:true,schema:videoAnalysisJsonSchema()}}
    })
  });
  const raw=await r.text();
  let response;try{response=raw?JSON.parse(raw):{}}catch{response={raw}}
  if(!r.ok){
    const err=new Error(response?.error?.message||('OpenAI analysis error '+r.status));
    err.status=r.status;err.code=response?.error?.code||'';
    throw err;
  }
  const analysis=safeAnalysisJson(openAIText(response));
  const priced=openAIUsageCost(model,response?.usage||{});
  if(priced.amountUsd>0)await recordExpense(accountId,{provider:'OpenAI',category:'analysis',description:'Разбор видео',amountUsd:priced.amountUsd,model,usage:priced.details,source:'auto'}).catch(()=>{});
  return await saveVideoAnalysisResult(opts,analysis,'OpenAI',{providerNote:'Основной анализ по кадрам и транскрипту'});
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
    evidence=await extractVideoEvidence(filePath,{detailed:true});
    const analysisId=factoryId('va');
    const persistedFrames=await persistVideoAnalysisFrames(accountId,analysisId,evidence.frameSamples||[]);
    let transcription={text:'',timedText:'',segments:[],status:evidence.audioPresent?'pending':'no-audio',model:'',fallback:''};
    let transcriptError='';
    if(evidence.audioPath){
      try{
        transcription=await transcribeAudioDetailed(evidence.audioPath);
      }catch(e){
        transcriptError=String(e?.message||e).slice(0,1000);
        transcription={text:'',timedText:'',segments:[],status:'failed',model:'',fallback:transcriptError};
        console.warn('[video-analysis-transcript] '+transcriptError);
      }
    }
    const transcript=String(transcription.text||'');
    const timedTranscript=String(transcription.timedText||'');
    const transcriptStatus=String(transcription.status||'');
    const keyframes=persistedFrames.map(x=>({
      shot:Number(x.shot)||0,phase:String(x.phase||''),time:Number(x.timeSec)||0,url:x.url||'',storagePath:x.path||'',fileName:''
    }));
    const opts={
      analysisId,
      accountId,
      sourceType:'upload',
      sourceName:fileName,
      transcript,timedTranscript,transcription,transcriptStatus,transcriptError,
      audioPresent:Boolean(evidence.audioPresent),
      frameSamples:persistedFrames,
      keyframes,
      shotMap:evidence.shots||[],
      imageParts:evidence.analysisParts||analysisImageParts(evidence.frameSamples||[]),
      productId:url.searchParams.get('productId')||'',
      avatarId:url.searchParams.get('avatarId')||'',
      metadata:{
        durationSeconds:Number(evidence.duration.toFixed(2)),
        detectedShots:(evidence.shots||[]).length,
        extractedKeyframes:(evidence.frameSamples||[]).length,
        audioPresent:Boolean(evidence.audioPresent),
        transcriptStatus,
        transcriptionModel:String(transcription.model||''),
        shotRanges:evidence.shots||[],
        frameTimeline:(evidence.frameSamples||[]).map(x=>({index:x.index,shot:x.shot,phase:x.phase,timeSec:x.timeSec}))
      },
      mimeType:String(req.headers['content-type']||'video/mp4').split(';')[0]
    };
    try{
      return await analyzeReferenceMaterial(opts);
    }catch(e){
      console.warn('[video-analysis-openai] '+humanVideoAnalysisError(e));
      try{
        return await analyzeUploadedVideoWithDescript(filePath,opts);
      }catch(de){
        throw new Error('Разбор не выполнен. OpenAI: '+humanVideoAnalysisError(e)+' Descript: '+String(de?.message||de));
      }
    }
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
  const opts={
    accountId,
    sourceType:'youtube',
    sourceName:meta.title||videoUrl,
    sourceUrl:videoUrl,
    transcript,
    imageParts,
    productId:body?.productId||'',
    avatarId:body?.avatarId||'',
    metadata:{author:meta.author_name||'',transcriptAvailable:!!transcript,analysisDepth:transcript?'transcript+thumbnail':'thumbnail+metadata'}
  };
  try{
    return await analyzeReferenceMaterial(opts);
  }catch(e){
    console.warn('[youtube-analysis-openai] '+humanVideoAnalysisError(e));
    if(!transcript)throw new Error('Не удалось разобрать YouTube: OpenAI недоступен, а субтитры у видео не получены.');
    try{
      return await analyzeTranscriptWithDescript(opts);
    }catch(de){
      throw new Error('Разбор YouTube не выполнен. OpenAI: '+humanVideoAnalysisError(e)+' Descript: '+String(de?.message||de));
    }
  }
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

async function recoverPendingPrevisAndAutopilot(){
  try{
    const registry=await ensureAccountsRegistry();
    for(const account of (registry.accounts||[])){
      const accountId=sanitizeAccountId(account.id||DEFAULT_ACCOUNT_ID);
      const state=await readAppState(accountId),data=state?.data||blankFactoryState();
      for(const run of (data.runs||[])){
        if(!run||run.paused||run.status==='Остановлено')continue;
        const stage=String(run.stage||'');
        if(run.mode!=='manual'){
          if(['Идея','Сценарий','Storyboard'].includes(stage)&&(!run.idea||!run.script||!Array.isArray(run.storyboard)||!run.storyboard.length)&&!run.generationResult?.completed){
            run.status='В работе';run.error='';run.updatedAt=new Date().toISOString();
            await writeAppState(data,accountId);
            enqueueAutoPipeline(accountId,run.id);
            continue;
          }
        }else{
          const pending=['В работе','Ошибка'].includes(String(run.status||''))||['queued','processing'].includes(String(run.backgroundTask?.status||''));
          if(pending){
            let task='';
            const queuedType=String(run.backgroundTask?.type||'');
            if(['idea','script','storyboard'].includes(queuedType)&&['queued','processing'].includes(String(run.backgroundTask?.status||'')))task=queuedType;
            else if(!run.idea)task='idea';
            else if(!run.script&&['Сценарий','Storyboard'].includes(stage))task='script';
            else if(run.script&&(!Array.isArray(run.storyboard)||!run.storyboard.length)&&stage==='Storyboard')task='storyboard';
            if(task){
              const jobId=factoryId('job');
              run.stage=stageTaskName(task);run.status='В работе';run.awaitingApproval=false;run.error='';
              run.backgroundTask={id:jobId,type:task,status:'queued',queuedAt:new Date().toISOString(),recovered:true};
              run.updatedAt=new Date().toISOString();
              appendFactoryJournal(data,'Восстановлен фоновый этап',(run.productName||run.id)+' · '+stageTaskName(task));
              await writeAppState(data,accountId);
              enqueueStageTask(accountId,run.id,task,'Автовосстановление после перезапуска',jobId);
              continue;
            }
          }
        }

        if(run.mode!=='manual'&&stage==='Превиз-кадры'&&!run.previsResult?.completed&&String(run.status||'')==='В работе'){
          run.previsRunning=false;
          run.error='';
          run.previsError='';
          run.updatedAt=new Date().toISOString();
          await writeAppState(data,accountId);
          enqueueRunPrevis(accountId,run.id,'previs-recovery');
          continue;
        }
        const pendingStoryboardScenes=Object.entries(run.storyboardSceneJobs||{})
          .filter(([,job])=>['queued','processing'].includes(String(job?.status||'')))
          .map(([scene])=>Number(scene)).filter(Number.isFinite);
        if(run.mode==='manual'&&pendingStoryboardScenes.length){
          for(const scene of pendingStoryboardScenes){
            run.storyboardSceneJobs[scene]={...(run.storyboardSceneJobs[scene]||{}),status:'queued',recovered:true,queuedAt:new Date().toISOString()};
            await writeAppState(data,accountId);
            enqueueStoryboardSceneTask(accountId,run.id,scene,String(run.storyboardSceneJobs[scene]?.note||'Автовосстановление после перезапуска'));
          }
          continue;
        }
        if(run.mode==='manual'&&stage==='Превиз-кадры'&&!run.previsResult?.completed&&(run.previsRunning===true||['В работе','Ошибка'].includes(String(run.status||'')))){
          run.previsRunning=false;run.status='В работе';run.stage='Превиз-кадры';run.error='';run.previsError='';run.updatedAt=new Date().toISOString();
          await writeAppState(data,accountId);
          enqueueRunPrevis(accountId,run.id,'previs-recovery');
        }
      }
    }
  }catch(e){console.error('[pipeline-recovery] '+String(e?.message||e))}
}

async function recoverFailedAutoPrevisRuns(){
  try{
    const registry=await ensureAccountsRegistry();
    for(const account of (registry.accounts||[])){
      const accountId=sanitizeAccountId(account.id||DEFAULT_ACCOUNT_ID);
      const state=await readAppState(accountId);
      const data=state?.data||blankFactoryState();
      const candidateIds=[];
      for(const run of (Array.isArray(data.runs)?data.runs:[])){
        if(!run||run.mode==='manual'||run.paused||run.status!=='Ошибка'||String(run.stage||'')!=='Превиз-кадры'||run.previsResult?.completed)continue;
        candidateIds.push(String(run.id));
        run.previsRunning=false;
        run.status='В работе';
        run.error='';
        run.previsError='';
        run.previsPlan=null;
        run.previsFrames=Array.isArray(run.previsFrames)?run.previsFrames:[];
        run.previsResult=null;
        run.updatedAt=new Date().toISOString();
        appendFactoryJournal(data,'Автовосстановление превиза',(run.productName||run.id)+' · продолжаю с сохранением готовых кадров');
      }
      if(!candidateIds.length)continue;
      // Important: persist every recovery together BEFORE any worker starts,
      // otherwise the first worker can write an older full-state snapshot and
      // restore neighboring runs back to Error.
      await writeAppState(data,accountId);
      for(const runId of candidateIds){
        enqueueRunPrevis(accountId,runId,'failed-previs-recovery');
      }
    }
  }catch(e){
    console.error('[failed-previs-recovery] '+String(e?.message||e));
  }
}

async function recoverPendingBackendGenerations(){
  try{
    const registry=await ensureAccountsRegistry();
    for(const account of (registry.accounts||[])){
      const accountId=sanitizeAccountId(account.id||DEFAULT_ACCOUNT_ID);
      const state=await readAppState(accountId),data=state?.data||blankFactoryState();
      const ids=[];
      for(const run of (data.runs||[])){
        const hasPlan=!!run?.idea&&!!run?.script&&Array.isArray(run?.storyboard)&&run.storyboard.length>0;
        const complete=!!run?.generationResult?.completed;
        const creditBlocked=providerCreditError(run?.generationError||run?.error||'');
        if(run&&hasPlan&&!complete&&!run.paused&&['В работе','Ошибка'].includes(run.status)&&run.stage==='Генерация'&&!creditBlocked){
          ids.push(String(run.id));
          run.backendGenerationRunning=false;
          run.status='В работе';
          run.error='';
          run.generationError='';
          run.updatedAt=new Date().toISOString();
        }
      }
      if(!ids.length)continue;
      await writeAppState(data,accountId);
      for(const runId of ids)enqueueRunGeneration(accountId,runId,'backend-generation-recovery');
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

async function persistRunVideoUrls(accountId,runId,urls=[],prefix='scene'){
  const result={urls:[],media:[],failed:[]};
  const scoped=(sanitizeAccountId(accountId)+'__run_'+String(runId||'run')).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);
  const seen=new Map();
  for(let i=0;i<(Array.isArray(urls)?urls:[]).length;i++){
    const originalUrl=String(urls[i]||'').trim();
    if(!originalUrl)continue;
    if(seen.has(originalUrl)){
      const prev=seen.get(originalUrl);
      result.urls.push(prev.url);
      if(prev.media)result.media.push({...prev.media,index:i,originalUrl});
      continue;
    }
    try{
      const remote=await fetch(originalUrl);
      if(!remote.ok)throw new Error('HTTP '+remote.status);
      const buf=Buffer.from(await remote.arrayBuffer());
      if(!buf.length)throw new Error('пустой файл');
      if(buf.length>145*1024*1024)throw new Error('файл больше 145 МБ');
      const mimeType=String(remote.headers.get('content-type')||'video/mp4').split(';')[0]||'video/mp4';
      const ext=mimeType.includes('webm')?'webm':'mp4';
      const fileName=String(prefix||'scene')+'-'+String(i+1)+'-'+Date.now()+'.'+ext;
      const uploaded=await callProductMedia({
        action:'upload',
        productId:scoped,
        fileName,
        mimeType,
        dataBase64:buf.toString('base64')
      });
      const media=uploaded?.media||null;
      if(!media?.url)throw new Error('хранилище не вернуло URL');
      const saved={url:String(media.url),path:String(media.path||''),fileName:String(media.fileName||fileName),mimeType:String(media.mimeType||mimeType)};
      seen.set(originalUrl,{url:saved.url,media:saved});
      result.urls.push(saved.url);
      result.media.push({...saved,index:i,originalUrl});
    }catch(e){
      result.urls.push(originalUrl);
      result.failed.push({index:i,url:originalUrl,error:String(e?.message||e)});
      seen.set(originalUrl,{url:originalUrl,media:null});
    }
  }
  return result;
}

async function persistExistingRunVideos(accountId,run){
  let copied=0,failed=0;
  run.sceneResults=run.sceneResults&&typeof run.sceneResults==='object'?run.sceneResults:{};
  for(const [sceneKey,sr] of Object.entries(run.sceneResults)){
    const urls=Array.isArray(sr?.urls)?sr.urls.filter(Boolean):(sr?.url?[sr.url]:[]);
    if(!urls.length)continue;
    const existing=Array.isArray(sr.persistedMedia)?sr.persistedMedia:[];
    const existingOriginals=new Set(existing.map(x=>String(x?.originalUrl||'')).filter(Boolean));
    const needs=urls.filter(u=>!existingOriginals.has(String(u)));
    if(!needs.length)continue;
    const persisted=await persistRunVideoUrls(accountId,run.id,needs,'scene-'+sceneKey);
    copied+=persisted.media.length;failed+=persisted.failed.length;
    if(persisted.urls.length){
      const replacement=new Map();
      needs.forEach((u,i)=>replacement.set(String(u),persisted.urls[i]||String(u)));
      sr.urls=urls.map(u=>replacement.get(String(u))||String(u));
      if(sr.url)sr.url=replacement.get(String(sr.url))||sr.url;
    }
    sr.persistedMedia=[...existing,...persisted.media];
  }
  const ordered=Object.keys(run.sceneResults).sort((a,b)=>Number(a)-Number(b)).flatMap(k=>run.sceneResults[k]?.urls||[]);
  if(ordered.length){
    run.generationResult={...(run.generationResult||{}),urls:ordered};
  }else if(Array.isArray(run.generationResult?.urls)&&run.generationResult.urls.length){
    const persisted=await persistRunVideoUrls(accountId,run.id,run.generationResult.urls,'generated');
    copied+=persisted.media.length;failed+=persisted.failed.length;
    run.generationResult={...(run.generationResult||{}),urls:persisted.urls,persistedMedia:persisted.media};
  }
  return {copied,failed};
}

function archiveRunMediaToLibrary(data,run){
  data.mediaLibrary=Array.isArray(data.mediaLibrary)?data.mediaLibrary:[];
  const existingKeys=new Set(data.mediaLibrary.map(x=>String(x?.sourceKey||x?.url||x?.path||'')).filter(Boolean));
  const archivedAt=new Date().toISOString();
  const added=[];
  const add=(kind,url='',pathValue='',meta={})=>{
    url=String(url||'').trim();
    pathValue=String(pathValue||'').trim();
    if(!url&&!pathValue)return;
    const sourceKey=String(meta.sourceKey||url||pathValue);
    if(existingKeys.has(sourceKey))return;
    existingKeys.add(sourceKey);
    added.push({
      id:factoryId('media'),
      sourceKey,
      kind:kind==='video'?'video':'image',
      url,
      path:pathValue,
      fileName:String(meta.fileName||''),
      mimeType:String(meta.mimeType||''),
      productId:String(run?.productId||''),
      productName:String(run?.productName||run?.product?.name||''),
      sourceRunId:String(run?.id||''),
      sourceStage:String(meta.sourceStage||''),
      scene:Number(meta.scene)||null,
      frame:Number(meta.frame)||null,
      provider:String(meta.provider||''),
      model:String(meta.model||''),
      archivedAt,
      createdAt:String(meta.createdAt||archivedAt)
    });
  };

  for(const frame of (Array.isArray(run?.previsFrames)?run.previsFrames:[])){
    add('image',frame?.url,frame?.path,{
      sourceKey:'previs:'+String(run?.id||'')+':'+String(frame?.id||frame?.scene+'-'+frame?.frame||frame?.url||''),
      fileName:frame?.fileName||'',
      mimeType:frame?.mimeType||'image/png',
      sourceStage:'Превиз-кадры',
      scene:frame?.scene,
      frame:frame?.frame,
      provider:frame?.provider,
      model:frame?.model,
      createdAt:frame?.generatedAt
    });
  }

  const seenVideoUrls=new Set();
  for(const [sceneKey,result] of Object.entries(run?.sceneResults||{})){
    const urls=[...(Array.isArray(result?.urls)?result.urls:[]),result?.url].filter(Boolean);
    const persisted=Array.isArray(result?.persistedMedia)?result.persistedMedia:[];
    for(const videoUrl of urls){
      const key=String(videoUrl);
      if(seenVideoUrls.has(key))continue;
      seenVideoUrls.add(key);
      const pm=persisted.find(x=>String(x?.url||'')===key||String(x?.originalUrl||'')===key)||null;
      add('video',videoUrl,pm?.path||'',{
        sourceKey:'scene:'+String(run?.id||'')+':'+String(sceneKey)+':'+key,
        fileName:pm?.fileName||('scene-'+sceneKey+'.mp4'),
        mimeType:pm?.mimeType||'video/mp4',
        sourceStage:'Генерация',
        scene:Number(sceneKey),
        provider:result?.provider,
        model:result?.model,
        createdAt:result?.completedAt
      });
    }
  }
  for(const videoUrl of (Array.isArray(run?.generationResult?.urls)?run.generationResult.urls:[])){
    const key=String(videoUrl);
    if(seenVideoUrls.has(key))continue;
    seenVideoUrls.add(key);
    add('video',videoUrl,'',{
      sourceKey:'generation:'+String(run?.id||'')+':'+key,
      fileName:'generated-scene.mp4',
      mimeType:'video/mp4',
      sourceStage:'Генерация'
    });
  }

  if(run?.montageResult?.url||run?.montageResult?.path){
    add('video',run.montageResult?.url,run.montageResult?.path,{
      sourceKey:'montage:'+String(run?.id||''),
      fileName:run.montageResult?.fileName||('final-'+String(run?.id||'')+'.mp4'),
      mimeType:'video/mp4',
      sourceStage:'Монтаж',
      createdAt:run.montageResult?.completedAt
    });
  }
  if(run?.finalMedia?.url||run?.finalMedia?.path){
    add('video',run.finalMedia?.url,run.finalMedia?.path,{
      sourceKey:'final:'+String(run?.id||''),
      fileName:run.finalMedia?.fileName||('final-'+String(run?.id||'')+'.mp4'),
      mimeType:run.finalMedia?.mimeType||'video/mp4',
      sourceStage:'Готово',
      createdAt:run.finalMedia?.completedAt
    });
  }

  if(added.length)data.mediaLibrary=[...data.mediaLibrary,...added].slice(-10000);
  return added;
}

async function deleteFactoryEntity(accountId,type,id){
  accountId=sanitizeAccountId(accountId||DEFAULT_ACCOUNT_ID);
  type=String(type||'').trim();
  id=String(id||'').trim();
  if(!type||!id)throw new Error('Не указан объект для удаления');
  const state=await readAppState(accountId);
  const data=state?.data||blankFactoryState();
  let deleted=null;

  if(type==='run'){
    data.runs=Array.isArray(data.runs)?data.runs:[];
    deleted=data.runs.find(x=>String(x?.id||'')===id)||null;
    if(!deleted)throw new Error('Процесс не найден');
    const persistence=await persistExistingRunVideos(accountId,deleted).catch(e=>({copied:0,failed:1,error:String(e?.message||e)}));
    const archivedMedia=archiveRunMediaToLibrary(data,deleted);
    data.runs=data.runs.filter(x=>String(x?.id||'')!==id);
    data.scripts=(Array.isArray(data.scripts)?data.scripts:[]).map(x=>
      String(x?.runId||'')===id
        ? {...x,sourceRunId:id,runId:null,archivedFromRun:true,updatedAt:new Date().toISOString()}
        : x
    );
    appendFactoryJournal(
      data,
      'Удалён процесс',
      (deleted.productName||deleted.id)+' · '+(deleted.status||deleted.stage||'')+' · медиа сохранено: '+archivedMedia.length+' · видео скопировано: '+(persistence.copied||0)+(persistence.failed?(' · ошибок копирования: '+persistence.failed):'')
    );
  }else if(type==='media'){
    data.mediaLibrary=Array.isArray(data.mediaLibrary)?data.mediaLibrary:[];
    deleted=data.mediaLibrary.find(x=>String(x?.id||'')===id)||null;
    if(!deleted)throw new Error('Медиафайл не найден');
    if(deleted?.path){try{await callProductMedia({action:'delete',path:String(deleted.path)})}catch(e){console.warn('[media-library-delete] '+String(e?.message||e))}}
    data.mediaLibrary=data.mediaLibrary.filter(x=>String(x?.id||'')!==id);
    appendFactoryJournal(data,'Удалён файл из медиатеки',(deleted.productName||'')+' · '+(deleted.kind==='video'?'видео':'фото')+' · '+(deleted.sourceStage||''));
  }else if(type==='script'){
    data.scripts=Array.isArray(data.scripts)?data.scripts:[];
    deleted=data.scripts.find(x=>String(x?.id||'')===id)||null;
    if(!deleted)throw new Error('Сценарий не найден');
    data.scripts=data.scripts.filter(x=>String(x?.id||'')!==id);
    appendFactoryJournal(data,'Удалён сценарий',deleted.title||id);
  }else if(type==='campaign'){
    data.campaigns=Array.isArray(data.campaigns)?data.campaigns:[];
    deleted=data.campaigns.find(x=>String(x?.id||'')===id)||null;
    if(!deleted)throw new Error('Кампания не найдена');
    data.campaigns=data.campaigns.filter(x=>String(x?.id||'')!==id);
    for(const run of (Array.isArray(data.runs)?data.runs:[]))if(String(run?.campaignId||'')===id)run.campaignId=null;
    appendFactoryJournal(data,'Удалена кампания',deleted.name||id);
  }else if(type==='character'){
    data.characters=Array.isArray(data.characters)?data.characters:[];
    deleted=data.characters.find(x=>String(x?.id||'')===id)||null;
    if(!deleted)throw new Error('AI-аватар не найден');
    for(const m of (Array.isArray(deleted.media)?deleted.media:[])){
      if(m?.path)try{await callProductMedia({action:'delete',path:String(m.path)})}catch{}
    }
    data.characters=data.characters.filter(x=>String(x?.id||'')!==id);
    appendFactoryJournal(data,'Удалён AI-аватар',deleted.name||id);
  }else if(type==='videoAnalysis'){
    data.videoAnalyses=Array.isArray(data.videoAnalyses)?data.videoAnalyses:[];
    deleted=data.videoAnalyses.find(x=>String(x?.id||'')===id)||null;
    if(!deleted)throw new Error('Разбор видео не найден');
    data.videoAnalyses=data.videoAnalyses.filter(x=>String(x?.id||'')!==id);
    appendFactoryJournal(data,'Удалён разбор видео',deleted.sourceName||id);
  }else if(type==='journal'){
    data.journal=Array.isArray(data.journal)?data.journal:[];
    deleted=data.journal.find(x=>String(x?.id||'')===id)||null;
    if(!deleted)throw new Error('Запись журнала не найдена');
    data.journal=data.journal.filter(x=>String(x?.id||'')!==id);
  }else if(type==='expense'){
    data.expenses=Array.isArray(data.expenses)?data.expenses:[];
    deleted=data.expenses.find(x=>String(x?.id||'')===id)||null;
    if(!deleted)throw new Error('Расход не найден');
    data.expenses=data.expenses.filter(x=>String(x?.id||'')!==id);
  }else{
    throw new Error('Этот тип объекта нельзя удалить');
  }
  await writeAppState(data,accountId);
  return {type,id,label:String(deleted?.name||deleted?.title||deleted?.sourceName||deleted?.productName||id)};
}


async function recoverSavedIdeaLibrary(){
  try{
    const registry=await ensureAccountsRegistry();
    for(const account of (registry.accounts||[])){
      const accountId=sanitizeAccountId(account.id||DEFAULT_ACCOUNT_ID);
      const state=await readAppState(accountId);
      const data=state?.data||blankFactoryState();
      data.runs=Array.isArray(data.runs)?data.runs:[];
      data.savedIdeas=Array.isArray(data.savedIdeas)?data.savedIdeas:[];
      let changed=false;
      for(const run of data.runs){
        if(!run?.idea)continue;
        const before=JSON.stringify({selectedIdeaOptionId:run.selectedIdeaOptionId,ideaOptions:run.ideaOptions});
        const beforeCount=data.savedIdeas.length;
        syncRunIdeaLibrary(data,run);
        if(before!==JSON.stringify({selectedIdeaOptionId:run.selectedIdeaOptionId,ideaOptions:run.ideaOptions})||beforeCount!==data.savedIdeas.length)changed=true;
      }
      if(changed)await writeAppState(data,accountId);
    }
  }catch(e){console.error('[idea-library-recovery] '+String(e?.message||e))}
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
    return json(res,200,{ok:true,service:'Content Factory',version:APP_VERSION,build:BUILD_ID,database,databaseError,time:new Date().toISOString()});
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
    const higgsfieldCallbackVerified=process.env.HIGGSFIELD_FINAL_CALLBACK_VERIFIED === 'true'; // legacy flag; current pipeline uses polling
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
        state:higgsfield?'connected':'missing',
        description:'Превиз Nano Banana Pro + основная генерация AI-видео',
        detail:higgsfield?'API подключён · превиз: Nano Banana Pro (2K) · видео: Higgsfield · получение результата: server polling':'Higgsfield API не подключён',
        next:higgsfield?'':'Добавить API Key ID + Secret'
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

    return json(res,200,{ok:true,version:APP_VERSION,build:BUILD_ID,services:{
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

  if(url.pathname==='/api/entities/delete' && req.method==='POST'){
    try{
      const body=await readBody(req);
      const accountId=sanitizeAccountId(body?.accountId||DEFAULT_ACCOUNT_ID);
      if(!(await userOwnsAccount(req.cfUser?.id,accountId))) return json(res,403,{ok:false,error:'Нет доступа к этому аккаунту.'});
      if(body?.confirmed!==true) return json(res,400,{ok:false,error:'Нужно подтверждение удаления.'});
      const deleted=await deleteFactoryEntity(accountId,body?.type,body?.id);
      return json(res,200,{ok:true,deleted});
    }catch(e){
      return json(res,502,{ok:false,error:'Не удалось удалить объект',detail:String(e?.message||e)});
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
      return json(res,502,{ok:false,error:'Не удалось разобрать видео',detail:String(e?.message||e),code:openAIQuotaError(e)?'OPENAI_CREDITS_EXHAUSTED':'VIDEO_ANALYSIS_FAILED'});
    }
  }

  if(url.pathname==='/api/video-analysis/youtube' && req.method==='POST'){
    try{
      const body=await readBody(req);
      const item=await analyzeYoutubeUrl(body,req);
      return json(res,200,{ok:true,item});
    }catch(e){
      return json(res,502,{ok:false,error:'Не удалось разобрать YouTube-видео',detail:String(e?.message||e),code:openAIQuotaError(e)?'OPENAI_CREDITS_EXHAUSTED':'VIDEO_ANALYSIS_FAILED'});
    }
  }

  if(url.pathname==='/api/media/download' && req.method==='GET'){
    try{
      const accountId=sanitizeAccountId(url.searchParams.get('account')||req.headers['x-content-account']||DEFAULT_ACCOUNT_ID);
      if(!(await userOwnsAccount(req.cfUser?.id,accountId))) return json(res,403,{ok:false,error:'Нет доступа к этому аккаунту.'});
      const target=String(url.searchParams.get('url')||'');
      if(!/^https:\/\//i.test(target))return json(res,400,{ok:false,error:'Некорректная ссылка'});
      const state=await readAppState(accountId);
      const data=state?.data||{};
      const known=runKnownMediaUrls(data,accountId);
      if(!known.has(target))return json(res,403,{ok:false,error:'Файл не принадлежит текущему проекту.'});
      const remote=await fetch(target,{redirect:'follow'});
      if(!remote.ok)throw new Error('Источник вернул HTTP '+remote.status);
      const len=Number(remote.headers.get('content-length')||0);
      if(len>180*1024*1024)throw new Error('Файл слишком большой для скачивания через приложение');
      const type=remote.headers.get('content-type')||'application/octet-stream';
      const rawName=String(url.searchParams.get('name')||'content-factory-file').replace(/[\r\n"]/g,'_').slice(0,180);
      const buf=Buffer.from(await remote.arrayBuffer());
      res.writeHead(200,{
        'content-type':type,
        'content-length':buf.length,
        'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(rawName),
        'cache-control':'private, no-store'
      });
      res.end(buf);
      return;
    }catch(e){
      return json(res,502,{ok:false,error:'Не удалось скачать файл.',detail:String(e?.message||e)});
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
        for(const media of (Array.isArray(data.mediaLibrary)?data.mediaLibrary:[])) if(media?.path) knownPaths.add(String(media.path));
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

  if(url.pathname==='/api/ideas/action' && req.method==='POST'){
    try{
      const body=await readBody(req);
      const accountId=sanitizeAccountId(body?.accountId||DEFAULT_ACCOUNT_ID);
      if(!(await userOwnsAccount(req.cfUser?.id,accountId))) return json(res,403,{ok:false,error:'Нет доступа к этому аккаунту.'});
      if(body?.action==='launch_saved'){
        const run=await launchSavedIdea(accountId,String(body?.ideaId||''));
        return json(res,201,{ok:true,run});
      }
      if(body?.action==='delete_saved'){
        const state=await readAppState(accountId),data=state?.data||blankFactoryState();
        data.savedIdeas=Array.isArray(data.savedIdeas)?data.savedIdeas:[];
        const ideaId=String(body?.ideaId||'');
        const before=data.savedIdeas.length;
        data.savedIdeas=data.savedIdeas.filter(x=>String(x?.id)!==ideaId);
        if(data.savedIdeas.length===before)return json(res,404,{ok:false,error:'Сохранённая идея не найдена'});
        appendFactoryJournal(data,'Удалена идея из библиотеки',ideaId);
        await writeAppState(data,accountId);
        return json(res,200,{ok:true,deleted:ideaId});
      }
      return json(res,400,{ok:false,error:'Неизвестное действие идеи'});
    }catch(e){
      return json(res,502,{ok:false,error:'Не удалось выполнить действие с сохранённой идеей',detail:String(e?.message||e)});
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
    const headers={
      'content-type':mime[ext]||'application/octet-stream',
      'cache-control':noCache?'no-store, no-cache, must-revalidate, max-age=0':'public, max-age=3600'
    };
    if(noCache){
      headers['pragma']='no-cache';
      headers['expires']='0';
      headers['surrogate-control']='no-store';
    }
    if(path.basename(filePath)==='index.html'){
      let html=fs.readFileSync(filePath,'utf8');
      html=html.replace(/<span id="appVersion">[\s\S]*?<\/span>/,'<span id="appVersion">v'+APP_VERSION+' · '+BUILD_ID+'</span>');
      res.writeHead(200,headers);
      res.end(html);
      return;
    }
    res.writeHead(200,headers);
    fs.createReadStream(filePath).pipe(res);
  }catch{
    const index=path.join(publicDir,'index.html');
    let html=fs.readFileSync(index,'utf8');
    html=html.replace(/<span id="appVersion">[\s\S]*?<\/span>/,'<span id="appVersion">v'+APP_VERSION+' · '+BUILD_ID+'</span>');
    res.writeHead(200,{
      'content-type':'text/html; charset=utf-8',
      'cache-control':'no-store, no-cache, must-revalidate, max-age=0',
      'pragma':'no-cache','expires':'0','surrogate-control':'no-store'
    });
    res.end(html);
  }
});

server.listen(port,'0.0.0.0',async()=>{
  console.log(`Content Factory запущен на порту ${port}`);
  setTimeout(async()=>{
    try{
      await recoverSavedIdeaLibrary();
    }catch(e){
      console.error('[startup-recovery] idea-library '+String(e?.message||e));
    }
    try{
      await recoverLegacyPlaceholderRuns();
    }catch(e){
      console.error('[startup-recovery] legacy '+String(e?.message||e));
    }
    try{
      await recoverPendingPrevisAndAutopilot();
    }catch(e){
      console.error('[startup-recovery] previs '+String(e?.message||e));
    }
    try{
      await recoverFailedAutoPrevisRuns();
    }catch(e){
      console.error('[startup-recovery] failed-previs '+String(e?.message||e));
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
