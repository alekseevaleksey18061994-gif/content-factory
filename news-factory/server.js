import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL = process.env.TELEGRAM_CHANNEL;
const ADMIN_KEY = process.env.ADMIN_KEY || crypto.randomBytes(32).toString("hex");
const ADMIN_UI_PASSWORD = process.env.ADMIN_UI_PASSWORD;
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || "/data";
const STATE_FILE = path.join(DATA_DIR, "state.json");

if (!BOT_TOKEN) console.warn("TELEGRAM_BOT_TOKEN is not set");
if (!CHANNEL) console.warn("TELEGRAM_CHANNEL is not set");
if (!ADMIN_UI_PASSWORD) console.warn("ADMIN_UI_PASSWORD is not set");

const defaultState = {
  mode: "REVIEW",
  sources: [
    { id: "openai", name: "OpenAI News", type: "web", url: "https://openai.com/news/", enabled: true },
    { id: "anthropic", name: "Anthropic News", type: "web", url: "https://www.anthropic.com/news", enabled: true },
    { id: "google-ai", name: "Google AI", type: "web", url: "https://blog.google/technology/ai/", enabled: true },
    { id: "meta-ai", name: "Meta AI", type: "web", url: "https://ai.meta.com/blog/", enabled: true },
    { id: "microsoft-ai", name: "Microsoft AI", type: "web", url: "https://blogs.microsoft.com/ai/", enabled: true }
  ],
  queue: [],
  history: [],
  stats: { discovered: 0, rewritten: 0, published: 0, skipped: 0 },
  updatedAt: new Date().toISOString()
};

function ensureDataDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}

function loadState() {
  ensureDataDir();
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    return { ...structuredClone(defaultState), ...JSON.parse(raw) };
  } catch {
    return structuredClone(defaultState);
  }
}

let state = loadState();

function saveState() {
  state.updatedAt = new Date().toISOString();
  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function json(res, status, payload, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(payload));
}

function html(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1024 * 1024) throw new Error("request too large");
  }
  return body ? JSON.parse(body) : {};
}

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  return Object.fromEntries(raw.split(";").map(v => v.trim()).filter(Boolean).map(v => {
    const i = v.indexOf("=");
    return i === -1 ? [v, ""] : [v.slice(0, i), decodeURIComponent(v.slice(i + 1))];
  }));
}

function sessionToken() {
  return crypto.createHmac("sha256", ADMIN_KEY).update("news-factory-admin").digest("hex");
}

function isAuthed(req) {
  return parseCookies(req).nf_session === sessionToken();
}

function requireAuth(req, res) {
  if (!isAuthed(req)) {
    json(res, 401, { ok: false, error: "unauthorized" });
    return false;
  }
  return true;
}

async function sendTelegram(text) {
  if (!BOT_TOKEN || !CHANNEL) throw new Error("Telegram configuration is incomplete");
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: CHANNEL,
      text,
      disable_web_page_preview: true
    })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data?.description || "Telegram API error");
  return data.result;
}

function newId(prefix = "item") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
}

const loginPage = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>News Factory — вход</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#080a0f;color:#f7f8fb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}
.card{width:min(430px,100%);background:#121620;border:1px solid #242b39;border-radius:24px;padding:26px;box-shadow:0 30px 80px rgba(0,0,0,.35)}
.logo{width:64px;height:64px;border-radius:18px;background:linear-gradient(135deg,#27c2ff,#6e5cff 55%,#b84cff);display:grid;place-items:center;font-weight:900;font-size:27px;margin-bottom:22px}
h1{margin:0 0 8px;font-size:30px}.muted{color:#8f99aa;margin:0 0 22px}
input{width:100%;padding:15px 16px;border-radius:14px;border:1px solid #303849;background:#0b0e14;color:white;font-size:17px;outline:none}
button{width:100%;margin-top:12px;padding:15px;border:0;border-radius:14px;background:#fff;color:#080a0f;font-size:16px;font-weight:700}
.err{color:#ff7373;min-height:22px;margin-top:10px;font-size:14px}
</style>
</head>
<body><div class="card"><div class="logo">AI</div><h1>News Factory</h1><p class="muted">Панель управления AI Pulse</p>
<form id="f"><input id="p" type="password" placeholder="Пароль" autocomplete="current-password"><button>Войти</button><div class="err" id="e"></div></form>
<script>
f.onsubmit=async(e)=>{e.preventDefault();const r=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:p.value})});if(r.ok)location='/admin';else document.getElementById('e').textContent='Неверный пароль';}
</script></div></body></html>`;

const adminPage = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#090b10"><title>News Factory</title>
<style>
:root{--bg:#080a0f;--panel:#11151d;--panel2:#171c26;--line:#262d3a;--text:#f5f7fa;--muted:#8f99aa;--green:#4bd08b;--blue:#4b8cff;--red:#ff6464;--amber:#ffbd4a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.shell{max-width:1180px;margin:auto;padding:22px}.top{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:20px}
.brand{display:flex;gap:13px;align-items:center}.mark{width:48px;height:48px;border-radius:15px;background:linear-gradient(135deg,#16c7ff,#6557ff 55%,#b74cff);display:grid;place-items:center;font-weight:900;font-size:21px}
h1{font-size:25px;margin:0}.sub{color:var(--muted);font-size:13px;margin-top:3px}.status{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted)}.dot{width:9px;height:9px;border-radius:50%;background:var(--green);box-shadow:0 0 14px var(--green)}
.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:14px}.card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:18px}.span12{grid-column:span 12}.span8{grid-column:span 8}.span7{grid-column:span 7}.span6{grid-column:span 6}.span5{grid-column:span 5}.span4{grid-column:span 4}
.label{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:9px}.big{font-size:28px;font-weight:750}.row{display:flex;align-items:center;justify-content:space-between;gap:12px}.modes{display:flex;gap:8px;flex-wrap:wrap}
button,.btn{border:1px solid #303849;background:var(--panel2);color:var(--text);border-radius:12px;padding:10px 13px;font-size:14px;cursor:pointer}.primary{background:#f5f7fa;color:#080a0f;border-color:#f5f7fa;font-weight:700}.danger{color:#ff8a8a}.active{border-color:#628fff;background:#152342}.green{color:var(--green)}
input,textarea,select{width:100%;border:1px solid #303849;background:#0c0f15;color:white;border-radius:12px;padding:12px;font:inherit;outline:none}textarea{min-height:128px;resize:vertical}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.stat{background:#0d1016;border:1px solid #222937;border-radius:13px;padding:13px}.stat b{font-size:22px;display:block}.stat span{color:var(--muted);font-size:12px}
.source,.queueItem,.hist{display:grid;grid-template-columns:1fr auto;gap:10px;padding:12px 0;border-top:1px solid #232a36}.source:first-child,.queueItem:first-child,.hist:first-child{border-top:0}.name{font-weight:650}.url,.meta{font-size:12px;color:var(--muted);word-break:break-all;margin-top:3px}.chip{display:inline-block;border:1px solid #303849;border-radius:99px;padding:4px 8px;font-size:11px;color:var(--muted)}.empty{color:var(--muted);padding:14px 0}
.actions{display:flex;gap:7px;align-items:center}.toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(100px);background:#fff;color:#0a0c10;padding:12px 16px;border-radius:12px;font-weight:650;transition:.25s;z-index:20;box-shadow:0 14px 40px #0008}.toast.show{transform:translateX(-50%) translateY(0)}
@media(max-width:780px){.shell{padding:15px}.span8,.span7,.span6,.span5,.span4{grid-column:span 12}.stats{grid-template-columns:repeat(2,1fr)}.top{align-items:flex-start}.top .status{margin-top:8px}.row.mobileStack{align-items:stretch;flex-direction:column}}
</style>
</head>
<body><div class="shell">
<div class="top"><div class="brand"><div class="mark">AI</div><div><h1>News Factory</h1><div class="sub">AI Pulse · @aipulserussia</div></div></div><div class="status"><span class="dot"></span><span id="healthText">Сервис работает</span></div></div>

<div class="grid">
<section class="card span12"><div class="row mobileStack"><div><div class="label">Режим работы</div><div class="modes" id="modes"></div></div><div class="actions"><button onclick="testPost()">Тест в Telegram</button><button class="danger" onclick="logout()">Выйти</button></div></div></section>

<section class="card span12"><div class="label">Статистика</div><div class="stats">
<div class="stat"><b id="s_discovered">0</b><span>Найдено</span></div><div class="stat"><b id="s_rewritten">0</b><span>Переписано</span></div><div class="stat"><b id="s_published">0</b><span>Опубликовано</span></div><div class="stat"><b id="s_skipped">0</b><span>Пропущено</span></div>
</div></section>

<section class="card span7"><div class="row"><div><div class="label">Источники</div><div class="big" id="sourceCount">0</div></div></div><div id="sources"></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px"><input id="sourceName" placeholder="Название источника"><input id="sourceUrl" placeholder="https://..."></div><button style="margin-top:8px" onclick="addSource()">+ Добавить источник</button></section>

<section class="card span5"><div class="label">Быстрая публикация</div><textarea id="publishText" placeholder="Текст поста..."></textarea><button class="primary" style="margin-top:8px;width:100%" onclick="publishNow()">Опубликовать в Telegram</button></section>

<section class="card span7"><div class="row"><div><div class="label">Очередь</div><div class="big" id="queueCount">0</div></div><button onclick="addDraft()">+ Черновик</button></div><div id="queue"></div></section>

<section class="card span5"><div class="label">Последние публикации</div><div id="history"></div></section>
</div></div><div class="toast" id="toast"></div>

<script>
let data={};
const $=id=>document.getElementById(id);
function showToast(t){toast.textContent=t;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),2200)}
async function api(url,opt={}){const r=await fetch(url,{...opt,headers:{'content-type':'application/json',...(opt.headers||{})}});if(r.status===401){location='/login';throw new Error('unauthorized')}const j=await r.json();if(!r.ok)throw new Error(j.error||'Ошибка');return j}
async function load(){data=(await api('/api/dashboard')).state;render()}
function render(){
  const modes=['AUTO','REVIEW','PAUSED'];modesEl=$('modes');modesEl.innerHTML=modes.map(m=>'<button class="'+(data.mode===m?'active':'')+'" onclick="setMode(\\''+m+'\\')">'+({AUTO:'AUTO · всё автоматически',REVIEW:'REVIEW · на проверку',PAUSED:'PAUSED · стоп'}[m])+'</button>').join('');
  ['discovered','rewritten','published','skipped'].forEach(k=>$('s_'+k).textContent=data.stats[k]||0);
  $('sourceCount').textContent=data.sources.length;$('sources').innerHTML=data.sources.map(s=>'<div class="source"><div><div class="name">'+esc(s.name)+'</div><div class="url">'+esc(s.url)+'</div></div><div class="actions"><span class="chip">'+(s.enabled?'Вкл':'Выкл')+'</span><button onclick="toggleSource(\\''+s.id+'\\')">'+(s.enabled?'Откл':'Вкл')+'</button><button class="danger" onclick="removeSource(\\''+s.id+'\\')">×</button></div></div>').join('');
  $('queueCount').textContent=data.queue.length;$('queue').innerHTML=data.queue.length?data.queue.map(q=>'<div class="queueItem"><div><div class="name">'+esc(q.title||'Без заголовка')+'</div><div class="meta">'+esc(q.text).slice(0,150)+'</div></div><div class="actions"><button class="primary" onclick="publishQueue(\\''+q.id+'\\')">Пост</button><button class="danger" onclick="removeQueue(\\''+q.id+'\\')">×</button></div></div>').join(''):'<div class="empty">Очередь пока пустая</div>';
  $('history').innerHTML=data.history.length?data.history.slice(0,8).map(h=>'<div class="hist"><div><div class="name">'+esc(h.title||'Публикация')+'</div><div class="meta">'+new Date(h.publishedAt).toLocaleString('ru-RU')+' · #'+h.messageId+'</div></div></div>').join(''):'<div class="empty">Публикаций пока нет</div>';
}
function esc(v){return String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function setMode(mode){await api('/api/mode',{method:'POST',body:JSON.stringify({mode})});await load();showToast('Режим: '+mode)}
async function testPost(){const j=await api('/api/test',{method:'POST',body:'{}'});showToast('Тест опубликован #'+j.messageId);await load()}
async function publishNow(){const text=$('publishText').value.trim();if(!text)return showToast('Введите текст');const j=await api('/api/publish',{method:'POST',body:JSON.stringify({text,title:'Ручная публикация'})});$('publishText').value='';showToast('Опубликовано #'+j.messageId);await load()}
async function addSource(){const name=$('sourceName').value.trim(),url=$('sourceUrl').value.trim();if(!name||!url)return showToast('Заполните название и ссылку');await api('/api/sources',{method:'POST',body:JSON.stringify({name,url})});$('sourceName').value='';$('sourceUrl').value='';await load();showToast('Источник добавлен')}
async function toggleSource(id){await api('/api/sources/toggle',{method:'POST',body:JSON.stringify({id})});await load()}
async function removeSource(id){await api('/api/sources/remove',{method:'POST',body:JSON.stringify({id})});await load()}
async function addDraft(){const title=prompt('Заголовок черновика');if(title===null)return;const text=prompt('Текст поста');if(!text)return;await api('/api/queue',{method:'POST',body:JSON.stringify({title,text})});await load()}
async function publishQueue(id){await api('/api/queue/publish',{method:'POST',body:JSON.stringify({id})});showToast('Пост опубликован');await load()}
async function removeQueue(id){await api('/api/queue/remove',{method:'POST',body:JSON.stringify({id})});await load()}
async function logout(){await api('/api/logout',{method:'POST',body:'{}'});location='/login'}
load().catch(e=>showToast(e.message));
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, {
        ok: true,
        service: "news-factory",
        telegramConfigured: Boolean(BOT_TOKEN && CHANNEL),
        uiConfigured: Boolean(ADMIN_UI_PASSWORD)
      });
    }

    if (req.method === "GET" && url.pathname === "/") return redirect(res, "/admin");
    if (req.method === "GET" && url.pathname === "/login") {
      if (isAuthed(req)) return redirect(res, "/admin");
      return html(res, 200, loginPage);
    }
    if (req.method === "GET" && url.pathname === "/admin") {
      if (!isAuthed(req)) return redirect(res, "/login");
      return html(res, 200, adminPage);
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      const body = await readJson(req);
      if (!ADMIN_UI_PASSWORD || body.password !== ADMIN_UI_PASSWORD) return json(res, 401, { ok: false });
      return json(res, 200, { ok: true }, {
        "set-cookie": `nf_session=${sessionToken()}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`
      });
    }

    if (req.method === "POST" && url.pathname === "/api/logout") {
      return json(res, 200, { ok: true }, {
        "set-cookie": "nf_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
      });
    }

    if (url.pathname.startsWith("/api/") && !requireAuth(req, res)) return;

    if (req.method === "GET" && url.pathname === "/api/dashboard") {
      return json(res, 200, { ok: true, state });
    }

    if (req.method === "POST" && url.pathname === "/api/mode") {
      const { mode } = await readJson(req);
      if (!["AUTO", "REVIEW", "PAUSED"].includes(mode)) return json(res, 400, { ok: false, error: "invalid mode" });
      state.mode = mode; saveState();
      return json(res, 200, { ok: true, mode });
    }

    if (req.method === "POST" && url.pathname === "/api/test") {
      const marker = crypto.randomBytes(3).toString("hex");
      const result = await sendTelegram(`✅ News Factory подключён\\n\\nАвтопубликация в AI Pulse работает.\\nТест: ${marker}`);
      state.history.unshift({ id: newId("hist"), title: "Тест News Factory", messageId: result.message_id, publishedAt: new Date().toISOString() });
      state.history = state.history.slice(0, 100);
      state.stats.published += 1; saveState();
      return json(res, 200, { ok: true, messageId: result.message_id });
    }

    if (req.method === "POST" && url.pathname === "/api/publish") {
      const { text, title } = await readJson(req);
      const clean = String(text || "").trim();
      if (!clean) return json(res, 400, { ok: false, error: "Введите текст" });
      const result = await sendTelegram(clean);
      state.history.unshift({ id: newId("hist"), title: String(title || "Публикация"), text: clean, messageId: result.message_id, publishedAt: new Date().toISOString() });
      state.history = state.history.slice(0, 100);
      state.stats.published += 1; saveState();
      return json(res, 200, { ok: true, messageId: result.message_id });
    }

    if (req.method === "POST" && url.pathname === "/api/sources") {
      const { name, url: sourceUrl } = await readJson(req);
      if (!name || !sourceUrl) return json(res, 400, { ok: false, error: "Заполните название и ссылку" });
      state.sources.push({ id: newId("src"), name: String(name), type: "web", url: String(sourceUrl), enabled: true });
      saveState(); return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/sources/toggle") {
      const { id } = await readJson(req); const src = state.sources.find(x => x.id === id);
      if (!src) return json(res, 404, { ok: false, error: "Источник не найден" });
      src.enabled = !src.enabled; saveState(); return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/sources/remove") {
      const { id } = await readJson(req); state.sources = state.sources.filter(x => x.id !== id);
      saveState(); return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/queue") {
      const { title, text } = await readJson(req);
      if (!text) return json(res, 400, { ok: false, error: "Нужен текст" });
      state.queue.unshift({ id: newId("q"), title: String(title || "Черновик"), text: String(text), createdAt: new Date().toISOString() });
      saveState(); return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/queue/remove") {
      const { id } = await readJson(req); state.queue = state.queue.filter(x => x.id !== id);
      saveState(); return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/queue/publish") {
      const { id } = await readJson(req); const item = state.queue.find(x => x.id === id);
      if (!item) return json(res, 404, { ok: false, error: "Черновик не найден" });
      const result = await sendTelegram(item.text);
      state.queue = state.queue.filter(x => x.id !== id);
      state.history.unshift({ id: newId("hist"), title: item.title, text: item.text, messageId: result.message_id, publishedAt: new Date().toISOString() });
      state.history = state.history.slice(0, 100);
      state.stats.published += 1; saveState();
      return json(res, 200, { ok: true, messageId: result.message_id });
    }

    // Legacy authenticated API for server-to-server calls.
    if (req.method === "POST" && url.pathname === "/publish") {
      if (req.headers["x-admin-key"] !== ADMIN_KEY) return json(res, 401, { ok: false, error: "unauthorized" });
      const { text } = await readJson(req);
      const clean = String(text || "").trim();
      if (!clean) return json(res, 400, { ok: false, error: "text is required" });
      const result = await sendTelegram(clean);
      return json(res, 200, { ok: true, messageId: result.message_id });
    }

    json(res, 404, { ok: false, error: "not found" });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) json(res, 500, { ok: false, error: error.message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`News Factory listening on :${PORT}`);
});
