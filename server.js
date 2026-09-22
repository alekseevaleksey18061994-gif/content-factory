import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  return {
    apikey:process.env.SUPABASE_PUBLISHABLE_KEY,
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

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');

  if((url.pathname==='/health'||url.pathname==='/api/health') && req.method==='GET'){
    let database=false;
    if(supabaseConfigured()){
      try{
        await readAppState();
        database=true;
      }catch(e){
        return json(res,503,{ok:false,service:'Content Factory',version:'1.4.1',database:false,error:'Database connection failed',detail:String(e?.message||e),time:new Date().toISOString()});
      }
    }
    return json(res,200,{ok:true,service:'Content Factory',version:'1.4.0',database,time:new Date().toISOString()});
  }

  if(url.pathname==='/api/status' && req.method==='GET'){
    return json(res,200,{ok:true,services:{
      database:supabaseConfigured(),
      n8nServer:await n8nAlive(),
      n8nWorkflow:Boolean(process.env.N8N_CONTENT_WEBHOOK || process.env.N8N_WEBHOOK_BASE),
      higgsfield:Boolean(process.env.HIGGSFIELD_API_KEY),
      runway:Boolean(process.env.RUNWAY_API_KEY),
      descript:Boolean(process.env.DESCRIPT_API_KEY),
      drive:Boolean(process.env.GOOGLE_DRIVE_CONNECTED),
    }});
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

  if(url.pathname==='/api/start' && req.method==='POST'){
    const direct=process.env.N8N_CONTENT_WEBHOOK;
    const base=process.env.N8N_WEBHOOK_BASE;
    const webhook=direct || (base ? `${base.replace(/\/$/,'')}/content-factory-run` : '');
    if(!webhook){
      return json(res,503,{ok:false,code:'workflow_not_connected',error:'Рабочий процесс n8n ещё не подключён к кнопке запуска.'});
    }
    try{
      const payload=await readBody(req);
      const r=await fetch(webhook,{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify(payload)
      });
      const text=await r.text();
      let data;
      try{ data=JSON.parse(text); } catch { data={message:text}; }
      return json(res,r.status,{ok:r.ok,data});
    }catch(e){
      return json(res,502,{ok:false,error:'Не удалось связаться с рабочим процессом n8n.',detail:String(e?.message||e)});
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
