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

// Anthropic не поддерживает text.format:{type:'json_schema'} как OpenAI Responses API —
// строгий JSON получаем через forced tool_use: описываем один tool с input_schema=нужная
// схема и tool_choice заставляет модель ответить только вызовом этого tool.
export async function callClaudeStructured({
  prompt,
  system='',
  schema,
  name='structured_output',
  images=[],
  model=process.env.ANTHROPIC_MODEL||'claude-sonnet-5',
  maxTokens=5000,
  timeoutMs=120000
}={}){
  if(!claudeConfigured()) throw new Error('Claude API не настроен');
  const content=[
    ...images.map(url=>({type:'image',source:{type:'url',url:String(url)}})),
    {type:'text',text:String(prompt||'')}
  ];
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
        messages:[{role:'user',content}],
        tools:[{name,description:'Верни результат строго в этой структуре.',input_schema:schema}],
        tool_choice:{type:'tool',name}
      })
    });
  }catch(e){
    if(e?.name==='AbortError')throw new Error('Claude превысил лимит времени на этапе '+name+' ('+Math.round(timeoutMs/1000)+' сек)');
    throw e;
  }finally{clearTimeout(timer)}
  const raw=await r.text();
  let data;try{data=raw?JSON.parse(raw):{}}catch{data={raw}}
  if(!r.ok)throw new Error(data?.error?.message||('Claude API error '+r.status));
  const toolUse=(Array.isArray(data?.content)?data.content:[]).find(x=>x?.type==='tool_use'&&x?.name===name);
  if(!toolUse||typeof toolUse.input!=='object')throw new Error('Claude не вернул structured output для '+name);
  return {json:toolUse.input,model:data?.model||model,usage:data?.usage||{},id:data?.id||''};
}

// Прайсинг по официальным тарифам Anthropic на конец сентября 2026 (platform.claude.com/docs/en/about-claude/pricing).
// Это оценка для внутреннего учёта расходов, не замена реального счёта в console.anthropic.com —
// Anthropic периодически меняет цены (например, у Sonnet 5 была вводная цена $2/$10 до 31.08.2026, затем $3/$15).
const CLAUDE_PRICING={
  'claude-sonnet-5':{in:3,out:15},
  'claude-opus-5-5':{in:5,out:25},
  'claude-haiku-4-5':{in:1,out:5},
  'claude-haiku-4-5-20251001':{in:1,out:5}
};
export function claudeUsageCost(model,usage={}){
  const key=Object.keys(CLAUDE_PRICING).find(k=>String(model||'').startsWith(k))||'claude-sonnet-5';
  const rate=CLAUDE_PRICING[key];
  const inTok=Number(usage?.input_tokens||0),outTok=Number(usage?.output_tokens||0);
  const amountUsd=(inTok/1e6)*rate.in+(outTok/1e6)*rate.out;
  return {amountUsd,details:{inputTokens:inTok,outputTokens:outTok,model:key}};
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
