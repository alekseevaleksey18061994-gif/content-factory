import sharp from "sharp";

const token = String(process.env.VK_ACCESS_TOKEN || "").trim();
const groupId = Math.abs(Number(process.env.VK_GROUP_ID || 0));
const ownerId = Number(process.env.VK_OWNER_ID || (groupId ? -groupId : 0));
const apiVersion = String(process.env.VK_API_VERSION || "5.199").trim();
const confirm = String(process.env.VK_PRODUCTION_SMOKE_CONFIRM || "").trim();

if (confirm !== "chtotamai-doc") throw new Error("VK_PRODUCTION_SMOKE_CONFIRM must equal chtotamai-doc");
if (!token) throw new Error("VK_ACCESS_TOKEN is required");
if (groupId !== 241910449 || ownerId !== -241910449) throw new Error("Refusing smoke: unexpected VK group");

const message = [
  "Тест изображения News Factory №2 🖼️",
  "",
  "Проверяем альтернативную загрузку изображения через VK wall document upload.",
  "",
  "#тест"
].join("\n");

function log(obj) { console.log("VK_DOC_SMOKE " + JSON.stringify(obj)); }

async function vk(method, params = {}) {
  const body = new URLSearchParams();
  for (const [k,v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") body.set(k, String(v));
  body.set("access_token", token);
  body.set("v", apiVersion);
  const response = await fetch("https://api.vk.com/method/" + method, {
    method:"POST",
    headers:{"content-type":"application/x-www-form-urlencoded"},
    body:body.toString(),
    signal:AbortSignal.timeout(20000)
  });
  const data = await response.json().catch(()=>({}));
  if (!response.ok || data.error) {
    const e=data.error||{};
    log({stage:method,ok:false,error_code:e.error_code??response.status,error_msg:e.error_msg||("HTTP "+response.status)});
    throw new Error("VK "+method+" failed");
  }
  log({stage:method,ok:true});
  return data.response;
}

const svg = Buffer.from('<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="630" fill="#111827"/><rect x="70" y="70" width="1060" height="490" rx="48" fill="#2563eb"/><text x="600" y="280" font-size="72" text-anchor="middle" fill="white" font-family="Arial">NEWS FACTORY</text><text x="600" y="380" font-size="56" text-anchor="middle" fill="white" font-family="Arial">VK IMAGE TEST №2</text></svg>');
const image=await sharp(svg).jpeg({quality:90}).toBuffer();
log({stage:"image",ok:true,bytes:image.length,width:1200,height:630});

const uploadServer=await vk("docs.getWallUploadServer",{group_id:groupId});
if(!uploadServer?.upload_url) throw new Error("No docs wall upload_url");

const form=new FormData();
form.append("file",new Blob([image],{type:"image/jpeg"}),"news-factory-vk-image-test.jpg");
const uploadResponse=await fetch(uploadServer.upload_url,{method:"POST",body:form,signal:AbortSignal.timeout(45000)});
const uploaded=await uploadResponse.json().catch(()=>({}));
log({stage:"upload",ok:Boolean(uploadResponse.ok&&uploaded.file),http_status:uploadResponse.status,has_file:Boolean(uploaded.file)});
if(!uploadResponse.ok||!uploaded.file) throw new Error("VK doc upload failed");

const saved=await vk("docs.save",{file:uploaded.file,title:"News Factory VK image test"});
const doc=saved?.doc || (Array.isArray(saved)?saved[0]:null);
if(!doc?.id||!doc?.owner_id) {
  log({stage:"docs.save.shape",ok:false,keys:saved&&typeof saved==="object"?Object.keys(saved):[]});
  throw new Error("VK docs.save returned no document");
}
let attachment="doc"+doc.owner_id+"_"+doc.id;
if(doc.access_key) attachment+="_"+doc.access_key;
log({stage:"doc",ok:true,owner_id:doc.owner_id,doc_id:doc.id,type:doc.type??null,ext:doc.ext??null});

const posted=await vk("wall.post",{
  owner_id:ownerId,
  from_group:1,
  message,
  attachments:attachment,
  guid:"nf_doc_smoke_20261001_v1"
});
if(!posted?.post_id) throw new Error("No wall post id");
log({stage:"done",ok:true,post_id:posted.post_id});
