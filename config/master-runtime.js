import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const read=name=>{try{return fs.readFileSync(path.join(here,name),'utf8')}catch{return ''}};
const master=read('CONTENT_FACTORY_MASTER_SYSTEM.md');
const cinema=read('MASTER_PROMPT_AI_CINEMA.md');

function section(doc,needle){
  const parts=String(doc||'').split(/^##\s+/m);
  const hit=parts.find(x=>x.toUpperCase().startsWith(String(needle).toUpperCase()));
  return hit?('## '+hit.trim()):'';
}
function compact(stage){
  const common=[
    section(master,'0. GLOBAL PRIORITY'),
    section(master,'2. PRODUCT DNA'),
    section(master,'18. NON-NEGOTIABLE')
  ];
  const map={
    idea:['4. IDEA ENGINE','5. CREATIVE CRITIC'],
    script:['6. SCRIPT','7. RETENTION'],
    storyboard:['3. CHARACTER','8. STORYBOARD','9. IMAGE DIRECTOR','10. VISUAL CONTINUITY'],
    previs:['8. STORYBOARD','9. IMAGE DIRECTOR','10. VISUAL CONTINUITY','11. VISUAL QC'],
    image:['9. IMAGE DIRECTOR','10. VISUAL CONTINUITY','11. VISUAL QC'],
    video:['10. VISUAL CONTINUITY','11. VISUAL QC','12. VIDEO PROMPT','14. AUDIO'],
    final:['11. VISUAL QC','14. AUDIO','15. EDIT + FINAL QC'],
    general:['1. PIPELINE','16. AUTOMATION BEHAVIOR','17. COST POLICY']
  };
  const extra=(map[stage]||map.general).map(x=>section(master,x));
  const cinemaExtra=['storyboard','previs','image','video'].includes(stage)
    ?['REFERENCE HIERARCHY','IDENTITY LOCK','LOCATION LOCK','PRODUCT LOCK','SHOT PROMPT LAYERS','MOTION','SEQUENTIAL METHOD','REPAIR'].map(x=>section(cinema,x))
    :[];
  return ['CONTENT FACTORY MASTER SYSTEM — ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА',...common,...extra,...cinemaExtra]
    .filter(Boolean).join('\n\n').slice(0,12000);
}
function inferStage(body){
  const name=String(body?.text?.format?.name||'').toLowerCase();
  if(name.includes('idea')||name.includes('hook'))return 'idea';
  if(name.includes('script'))return 'script';
  if(name.includes('storyboard'))return 'storyboard';
  const raw=JSON.stringify(body?.input||'').toLowerCase();
  if(raw.includes('previs')||raw.includes('превиз'))return 'previs';
  if(raw.includes('final director')||raw.includes('финальн')&&raw.includes('qc'))return 'final';
  return 'general';
}
function prependInput(body,rules){
  if(!Array.isArray(body?.input)||!rules)return body;
  const copy={...body,input:body.input.map((msg,i)=>{
    if(i!==0||!msg||typeof msg!=='object')return msg;
    if(typeof msg.content==='string')return {...msg,content:rules+'\n\n'+msg.content};
    if(Array.isArray(msg.content)){
      let done=false;
      const content=msg.content.map(part=>{
        if(!done&&part?.type==='input_text'){
          done=true;
          return {...part,text:rules+'\n\n'+String(part.text||'')};
        }
        return part;
      });
      if(!done)content.unshift({type:'input_text',text:rules});
      return {...msg,content};
    }
    return msg;
  })};
  return copy;
}

const nativeFetch=globalThis.fetch.bind(globalThis);
globalThis.fetch=async(input,init={})=>{
  const url=typeof input==='string'?input:String(input?.url||'');
  try{
    if(init?.body&&typeof init.body==='string'&&url.includes('api.openai.com/v1/responses')){
      const body=JSON.parse(init.body);
      const stage=inferStage(body);
      const next=prependInput(body,compact(stage));
      init={...init,body:JSON.stringify(next)};
    }else if(init?.body&&typeof init.body==='string'&&url.includes('api.openai.com/v1/images/generations')){
      const body=JSON.parse(init.body);
      if(body&&typeof body.prompt==='string'){
        body.prompt=compact('image')+'\n\n'+body.prompt;
        init={...init,body:JSON.stringify(body)};
      }
    }
  }catch(e){
    console.warn('[master-runtime] prompt injection skipped: '+String(e?.message||e));
  }
  return nativeFetch(input,init);
};

globalThis.__CONTENT_FACTORY_MASTER__={
  active:true,
  systemLoaded:Boolean(master),
  cinemaLoaded:Boolean(cinema),
  version:'2026-09-26'
};
console.log('[master-runtime] active system='+Boolean(master)+' cinema='+Boolean(cinema));
