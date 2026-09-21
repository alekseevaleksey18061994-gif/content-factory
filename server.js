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
  try { const r=await fetch(u.replace(/\/$/,'')+'/'); return r.status<500; } catch { return false; }
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');

  if((url.pathname==='/health'||url.pathname==='/api/health') && req.method==='GET'){
    return json(res,200,{ok:true,service:'Content Factory',version:'1.2.0',time:new Date().toISOString()});
  }

  if(url.pathname==='/api/status' && req.method==='GET'){
    return json(res,200,{ok:true,services:{
      n8nServer:await n8nAlive(),
      n8nWorkflow:Boolean(process.env.N8N_CONTENT_WEBHOOK || process.env.N8N_WEBHOOK_BASE),
      higgsfield:Boolean(process.env.HIGGSFIELD_API_KEY),
      runway:Boolean(process.env.RUNWAY_API_KEY),
      descript:Boolean(process.env.DESCRIPT_API_KEY),
      drive:Boolean(process.env.GOOGLE_DRIVE_CONNECTED),
    }});
  }

  if(url.pathname==='/api/start' && req.method==='POST'){
    const direct=process.env.N8N_CONTENT_WEBHOOK;
    const base=process.env.N8N_WEBHOOK_BASE;
    const webhook=direct || (base ? `${base.replace(/\/$/,'')}/content-factory-run` : '');
    if(!webhook) return json(res,503,{ok:false,code:'workflow_not_connected',error:'Рабочий процесс n8n ещё не подключён к кнопке запуска.'});
    try{
      const payload=await readBody(req);
      const r=await fetch(webhook,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
      const text=await r.text();
      let data; try{data=JSON.parse(text)}catch{data={message:text}}
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
    const noCache = ['.html','.js','.css','.webmanifest'].includes(ext) || url.pathname==='/sw.js';
    res.writeHead(200,{'content-type':mime[ext]||'application/octet-stream','cache-control':noCache?'no-store, max-age=0':'public, max-age=3600'});
    fs.createReadStream(filePath).pipe(res);
  }catch{
    const index=path.join(publicDir,'index.html');
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache'});
    fs.createReadStream(index).pipe(res);
  }
});

server.listen(port,'0.0.0.0',()=>console.log(`Content Factory запущен на порту ${port}`));
