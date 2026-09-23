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

async function readAppState(){
  if(!supabaseConfigured()) return {configured:false,data:null};
  const base=process.env.SUPABASE_URL.replace(/\/$/,'');
  const r=await fetch(`${base}/rest/v1/app_state?id=eq.main&select=data,updated_at&limit=1`,{
    headers:supabaseHeaders()
  });
  if(!r.ok){
    const detail=await r.text();
    throw new Error(`Supabase read failed: ${r.status} ${detail}`);
  }
  const rows=await r.json();
  return {
    configured:true,
    data:rows?.[0]?.data ?? null,
    updatedAt:rows?.[0]?.updated_at ?? null
  };
}

async function writeAppState(data){
  if(!supabaseConfigured()) return {configured:false};
  const base=process.env.SUPABASE_URL.replace(/\/$/,'');
  const r=await fetch(`${base}/rest/v1/app_state?on_conflict=id`,{
    method:'POST',
    headers:supabaseHeaders({'prefer':'resolution=merge-duplicates,return=minimal'}),
    body:JSON.stringify([{id:'main',data,updated_at:new Date().toISOString()}])
  });
  if(!r.ok){
    const detail=await r.text();
    throw new Error(`Supabase write failed: ${r.status} ${detail}`);
  }
  return {configured:true};
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

async function callOpenAIChat(message,history=[]){
  if(!openaiConfigured()) throw new Error('OpenAI API is not configured');
  const safeHistory=(Array.isArray(history)?history:[]).slice(-12).map(x=>({
    role:x?.role==='assistant'?'assistant':'user',
    content:String(x?.content||'').slice(0,8000)
  }));
  const state=await readAppState().catch(()=>({data:null}));
  const snapshot=state?.data||{};
  const context={
    products:(snapshot.products||[]).map(p=>({id:p.id,name:p.name,category:p.category,utp:p.utp,rules:p.rules,mediaCount:(p.media||[]).length})),
    runs:(snapshot.runs||[]).slice(-20).map(r=>({id:r.id,batchId:r.batchId,productName:r.productName,status:r.status,stage:r.stage,progress:r.progress,style:r.style,duration:r.duration})),
    settings:snapshot.settings||{}
  };
  const input=[
    {role:'system',content:[{type:'input_text',text:
      'Ты — управляющий Content Factory. Отвечай по-русски, коротко и по делу. '+
      'У тебя есть контекст товаров, запусков и настроек. Пока доступны только информационные действия: анализировать состояние, предлагать план, находить товар/запуск. '+
      'Не утверждай, что запустил, удалил, опубликовал или изменил что-либо, если backend явно не сообщает о выполненном действии. '+
      'Если пользователь просит действие, которое пока не подключено, скажи какой сервис/инструмент нужен. Контекст: '+JSON.stringify(context)
    }]} ,
    ...safeHistory.map(x=>({role:x.role,content:[{type:'input_text',text:x.content}]})),
    {role:'user',content:[{type:'input_text',text:String(message||'').slice(0,12000)}]}
  ];
  const r=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{
      'authorization':`Bearer ${process.env.OPENAI_API_KEY}`,
      'content-type':'application/json'
    },
    body:JSON.stringify({
      model:process.env.OPENAI_MODEL||'gpt-5.6-luna',
      input,
      reasoning:{effort:'low'},
      max_output_tokens:1800
    })
  });
  const text=await r.text();
  let data;
  try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
  if(!r.ok) throw new Error(data?.error?.message||data?.message||`OpenAI error ${r.status}`);
  return {text:openAIText(data),responseId:data?.id||null,model:data?.model||process.env.OPENAI_MODEL||'gpt-5.6-luna'};
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
  return descriptRequest('/jobs/import/project_media',{
    method:'POST',
    body:{
      project_name:String(body?.projectName||'Content Factory project'),
      add_media:body?.addMedia||{},
      ...(Array.isArray(body?.compositions)?{add_compositions:body.compositions}:{}),
      ...(body?.callbackUrl?{callback_url:String(body.callbackUrl)}:{})
    }
  });
}

async function descriptAgent(body){
  const projectId=String(body?.projectId||'').trim();
  const prompt=String(body?.prompt||'').trim();
  if(!projectId||!prompt) throw new Error('projectId and prompt are required');
  return descriptRequest('/jobs/agent',{
    method:'POST',
    body:{
      project_id:projectId,
      prompt,
      ...(body?.callbackUrl?{callback_url:String(body.callbackUrl)}:{})
    }
  });
}

async function applyGenerationCallback(body){
  if(!supabaseConfigured()) throw new Error('Server database is not configured');
  const state=await readAppState();
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
  await writeAppState(data);
  return {matched};
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
        detail:chatgptControl?'Управление задачами через встроенный ChatGPT активно':'Встроенный управляющий чат ещё не создан',
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

  if(url.pathname==='/api/state' && req.method==='GET'){
    if(!supabaseConfigured()){
      return json(res,503,{ok:false,configured:false,error:'Серверная база ещё не подключена.'});
    }
    try{
      const state=await readAppState();
      return json(res,200,{ok:true,...state});
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
      const data=body?.data ?? body;
      await writeAppState(data);
      return json(res,200,{ok:true,configured:true,savedAt:new Date().toISOString()});
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
      const result=await callOpenAIChat(message,body?.history||[]);
      return json(res,200,{ok:true,...result});
    }catch(e){
      return json(res,502,{ok:false,error:'OpenAI chat failed',detail:String(e?.message||e)});
    }
  }

  if(url.pathname==='/api/start' && req.method==='POST'){
    const direct=process.env.N8N_CONTENT_WEBHOOK;
    const base=process.env.N8N_WEBHOOK_BASE;
    const webhook=direct || (base ? `${base.replace(/\/$/,'')}/content-factory-run` : '');
    const generationWebhook=process.env.N8N_GENERATION_WEBHOOK || '';

    if(!webhook && !generationWebhook){
      return json(res,503,{ok:false,code:'workflow_not_connected',error:'Рабочие процессы n8n ещё не подключены к кнопке запуска.'});
    }

    try{
      const payload=await readBody(req);
      const results={archive:null,generation:null};

      if(webhook){
        const r=await fetch(webhook,{
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify(payload)
        });
        const text=await r.text();
        let data;
        try{ data=JSON.parse(text); } catch { data={message:text}; }
        results.archive={ok:r.ok,status:r.status,data};
      }

      if(generationWebhook){
        try{
          const r=await fetch(generationWebhook,{
            method:'POST',
            headers:{'content-type':'application/json'},
            body:JSON.stringify(payload)
          });
          const text=await r.text();
          let data;
          try{ data=JSON.parse(text); } catch { data={message:text}; }
          results.generation={ok:r.ok,status:r.status,data};
        }catch(e){
          results.generation={ok:false,status:0,error:String(e?.message||e)};
        }
      }

      const primaryOk=results.archive ? results.archive.ok : Boolean(results.generation?.ok);
      return json(res,primaryOk?202:502,{ok:primaryOk,data:results});
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
