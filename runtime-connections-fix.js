const fs=require('fs');

function replaceOnce(file,from,to){
  const src=fs.readFileSync(file,'utf8');
  if(src.includes(to)) return;
  if(!src.includes(from)) throw new Error(`Patch target not found in ${file}`);
  fs.writeFileSync(file,src.replace(from,to));
}

replaceOnce('public/app.js',
`    ["Supabase","supabase"],\n    ["n8n + PostgreSQL","n8n"],\n    ["Google Drive","drive"],`,
`    ["Supabase","supabase"],\n    ["PostgreSQL","postgresql"],\n    ["n8n","n8n"],\n    ["Google Drive","drive"],`
);

replaceOnce('server.js',
`      n8n:{\n        state:(n8nServer&&n8nWorkflow&&n8nGeneration&&n8nPostgres)?'connected':(n8nServer&&(n8nWorkflow||n8nGeneration))?'partial':'missing',\n        description:'Оркестрация автоматизаций + постоянная PostgreSQL',\n        detail:'Сервер: '+(n8nServer?'онлайн':'нет')+' · архив: '+(n8nWorkflow?'подключён':'нет')+' · генерация: '+(n8nGeneration?'подключена':'нет')+' · PostgreSQL: '+(n8nPostgres?'подключён':'не подтверждён'),\n        next:(n8nServer&&n8nWorkflow&&n8nGeneration&&n8nPostgres)?'':'Довести все workflow до постоянного n8n'\n      },`,
`      postgresql:{\n        state:n8nPostgres?'connected':'missing',\n        description:'Постоянная база данных для автоматизаций',\n        detail:n8nPostgres?'PostgreSQL подключён и подтверждён':'Подключение PostgreSQL не подтверждено',\n        next:n8nPostgres?'':'Подключить PostgreSQL'\n      },\n      n8n:{\n        state:(n8nServer&&n8nWorkflow&&n8nGeneration)?'connected':(n8nServer&&(n8nWorkflow||n8nGeneration))?'partial':'missing',\n        description:'Оркестрация автоматизаций',\n        detail:'Сервер: '+(n8nServer?'онлайн':'нет')+' · архив: '+(n8nWorkflow?'подключён':'нет')+' · генерация: '+(n8nGeneration?'подключена':'нет'),\n        next:(n8nServer&&n8nWorkflow&&n8nGeneration)?'':'Подключить и настроить n8n workflow'\n      },`
);

console.log('[runtime-connections-fix] applied');
