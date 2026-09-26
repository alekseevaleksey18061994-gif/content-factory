const ANTHROPIC_API='https://api.anthropic.com/v1/messages';

export function claudeConfigured(){
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function callClaude({
  prompt,
  system='',
  model=process.env.ANTHROPIC_MODEL||'claude-sonnet-5',
  maxTokens=5000,
  timeoutMs=120000
}={}){
  if(!claudeConfigured()) throw new Error('Claude API не настроен');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  let r;
  try{
    r=await fetch(ANTHROPIC_API,{
      method:'POST',signal:controller.signal,
      headers:{
        'x-api-key':process.env.ANTHROPIC_API_KEY,
        'anthropic-version':'2023-06-01',
        'content-type':'application/json'
      },
      body:JSON.stringify({
        model,
        max_tokens:maxTokens,
        ...(system?{system}:{}),
        messages:[{role:'user',content:String(prompt||'')}]
      })
    });
  }catch(e){
    if(e?.name==='AbortError')throw new Error('Claude превысил лимит времени');
    throw e;
  }finally{clearTimeout(timer)}
  const raw=await r.text();
  let data;try{data=raw?JSON.parse(raw):{}}catch{data={raw}}
  if(!r.ok)throw new Error(data?.error?.message||('Claude API error '+r.status));
  const text=(Array.isArray(data?.content)?data.content:[])
    .filter(x=>x?.type==='text').map(x=>x.text||'').join('\n').trim();
  return {text,model:data?.model||model,usage:data?.usage||{},id:data?.id||''};
}

export async function claudeCritique({artifact,stage='script',context='',masterRules=''}){
  const prompt=[
    'Ты независимый Creative Critic / Showrunner Content Factory.',
    'Не переписывай утверждённую идею без необходимости. Найди конкретные слабые места и предложи точечные исправления.',
    'Проверь: Product DNA, factual safety, hook, retention, pacing, естественность речи, generatability, continuity, физику, повторяемость beats, payoff.',
    'Ответ на русском. Формат: VERDICT, ISSUES, FIXES. Кратко, но конкретно.',
    masterRules||'',context||'',
    'STAGE: '+stage,
    'ARTIFACT:',typeof artifact==='string'?artifact:JSON.stringify(artifact)
  ].filter(Boolean).join('\n\n');
  return callClaude({prompt,system:'Ты Claude, независимый второй AI-критик в производственном конвейере Content Factory.'});
}
