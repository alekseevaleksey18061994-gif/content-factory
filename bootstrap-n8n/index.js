import fs from 'node:fs/promises';

const base=(process.env.N8N_BOOTSTRAP_BASE_URL||'').replace(/\/$/,'');
const email=process.env.N8N_BOOTSTRAP_EMAIL||'';
const password=process.env.N8N_BOOTSTRAP_PASSWORD||'';

if(!base||!email||!password){
  console.error('Missing N8N_BOOTSTRAP_* variables');
  process.exit(1);
}

let cookie='';

function captureCookie(res){
  const all=typeof res.headers.getSetCookie==='function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  if(all.length){
    cookie=all.map(x=>x.split(';')[0]).join('; ');
  }
}

async function request(path,{method='GET',body,auth=true}={}){
  const headers={accept:'application/json'};
  if(body!==undefined) headers['content-type']='application/json';
  if(auth&&cookie) headers.cookie=cookie;
  const res=await fetch(base+path,{
    method,
    headers,
    body:body===undefined?undefined:JSON.stringify(body),
    redirect:'manual'
  });
  captureCookie(res);
  const text=await res.text();
  let parsed;
  try{parsed=text?JSON.parse(text):{};}catch{parsed={raw:text};}
  if(!res.ok){
    throw new Error(method+' '+path+' -> '+res.status+' '+JSON.stringify(parsed).slice(0,800));
  }
  return parsed?.data ?? parsed;
}

async function main(){
  const settings=await request('/rest/settings',{auth:false});
  if(settings?.userManagement?.showSetupOnFirstLoad){
    await request('/rest/owner/setup',{
      method:'POST',
      auth:false,
      body:{email,firstName:'Алексей',lastName:'Алексеев',password}
    });
    console.log('N8N_BOOTSTRAP_OWNER=created');
  }else{
    console.log('N8N_BOOTSTRAP_OWNER=exists');
  }

  await request('/rest/login',{
    method:'POST',
    auth:false,
    body:{emailOrLdapLoginId:email,password}
  });
  console.log('N8N_BOOTSTRAP_LOGIN=ok');

  const me=await request('/rest/login');
  console.log('N8N_BOOTSTRAP_USER='+JSON.stringify({
    id:me?.id||null,
    email:me?.email||null,
    role:me?.role||null
  }));

  const project=await request('/rest/projects/personal');
  if(!project?.id) throw new Error('Personal project id not found');

  const wf=JSON.parse(await fs.readFile(new URL('./workflow.json',import.meta.url),'utf8'));
  const targetName=wf.name;

  let existing=null;
  try{
    const listing=await request('/rest/workflows?take=100');
    const candidates=Array.isArray(listing)
      ? listing
      : (listing?.results||listing?.data||[]);
    existing=(Array.isArray(candidates)?candidates:[]).find(x=>x?.name===targetName)||null;
  }catch(e){
    console.log('N8N_BOOTSTRAP_LIST_WARNING='+String(e?.message||e));
  }

  let created=existing;
  if(!created){
    created=await request('/rest/workflows',{
      method:'POST',
      body:{
        name:wf.name,
        nodes:wf.nodes,
        connections:wf.connections,
        settings:wf.settings||{},
        active:false,
        projectId:project.id
      }
    });
    console.log('N8N_BOOTSTRAP_WORKFLOW=created');
  }else{
    console.log('N8N_BOOTSTRAP_WORKFLOW=exists');
  }

  const workflowId=created?.id;
  if(!workflowId) throw new Error('Workflow id missing');

  let current=created;
  if(!current?.versionId){
    current=await request('/rest/workflows/'+encodeURIComponent(workflowId));
  }

  if(!current?.active){
    await request('/rest/workflows/'+encodeURIComponent(workflowId)+'/activate',{
      method:'POST',
      body:{
        versionId:current.versionId,
        name:current.name||targetName
      }
    });
    console.log('N8N_BOOTSTRAP_WORKFLOW=activated');
  }

  const final=await request('/rest/workflows/'+encodeURIComponent(workflowId));
  console.log('N8N_BOOTSTRAP_RESULT='+JSON.stringify({
    id:final?.id||workflowId,
    name:final?.name||targetName,
    active:Boolean(final?.active),
    versionId:final?.versionId||null
  }));
}

main().then(()=>process.exit(0)).catch(e=>{
  console.error('N8N_BOOTSTRAP_ERROR='+String(e?.stack||e));
  process.exit(1);
});
