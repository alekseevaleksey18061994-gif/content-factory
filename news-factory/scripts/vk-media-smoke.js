import zlib from "node:zlib";

const API_VERSION = process.env.VK_API_VERSION || "5.199";
const USER_TOKEN = String(process.env.VK_USER_TOKEN || "").trim();
const WALL_TOKEN = String(process.env.VK_TEST_GROUP_TOKEN || process.env.VK_ACCESS_TOKEN || "").trim();
const GROUP_ID = Math.abs(Number(process.env.VK_TEST_GROUP_ID || 0));

if (!USER_TOKEN) throw new Error("VK_USER_TOKEN is required");
if (!WALL_TOKEN) throw new Error("VK_TEST_GROUP_TOKEN or VK_ACCESS_TOKEN is required");
if (!GROUP_ID) throw new Error("VK_TEST_GROUP_ID is required");

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function testPng(width = 320, height = 180) {
  const signature = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width,0);
  ihdr.writeUInt32BE(height,4);
  ihdr[8]=8; ihdr[9]=6;
  const rows=[];
  for(let y=0;y<height;y++){
    const row=Buffer.alloc(1+width*4);
    row[0]=0;
    for(let x=0;x<width;x++){
      const i=1+x*4;
      row[i]=18 + Math.floor((x/width)*20);
      row[i+1]=35 + Math.floor((y/height)*40);
      row[i+2]=120 + Math.floor((x/width)*90);
      row[i+3]=255;
    }
    rows.push(row);
  }
  return Buffer.concat([
    signature,
    pngChunk("IHDR",ihdr),
    pngChunk("IDAT",zlib.deflateSync(Buffer.concat(rows))),
    pngChunk("IEND",Buffer.alloc(0))
  ]);
}

async function vk(method, params, token) {
  const body = new URLSearchParams();
  for (const [k,v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== "") body.set(k,String(v));
  }
  body.set("access_token",token);
  body.set("v",API_VERSION);
  const res = await fetch("https://api.vk.com/method/"+method,{
    method:"POST",
    headers:{"content-type":"application/x-www-form-urlencoded"},
    body:body.toString()
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    const e=data.error || {};
    throw new Error(method+" failed: "+(e.error_code ?? res.status)+" "+(e.error_msg || res.statusText));
  }
  return data.response;
}

console.log("VK smoke: requesting wall upload server");
const upload = await vk("photos.getWallUploadServer",{group_id:GROUP_ID},USER_TOKEN);
if (!upload?.upload_url) throw new Error("photos.getWallUploadServer returned no upload_url");

console.log("VK smoke: uploading test photo");
const form = new FormData();
form.append("photo",new Blob([testPng()],{type:"image/png"}),"news-factory-smoke.png");
const uploadRes = await fetch(upload.upload_url,{method:"POST",body:form});
const uploaded = await uploadRes.json();
if (!uploadRes.ok || !uploaded.server || !uploaded.photo || !uploaded.hash) {
  throw new Error("VK upload server rejected test image");
}

console.log("VK smoke: saving wall photo");
const saved = await vk("photos.saveWallPhoto",{
  group_id:GROUP_ID,
  server:uploaded.server,
  photo:uploaded.photo,
  hash:uploaded.hash
},USER_TOKEN);
const photo = Array.isArray(saved) ? saved[0] : saved?.items?.[0];
if (!photo?.id || !photo?.owner_id) throw new Error("photos.saveWallPhoto returned no photo");

const attachment="photo"+photo.owner_id+"_"+photo.id;
console.log("VK smoke: publishing test wall post");
const posted = await vk("wall.post",{
  owner_id:-GROUP_ID,
  from_group:1,
  message:"News Factory VK media smoke test",
  attachments:attachment
},WALL_TOKEN);

console.log("VK smoke: success, post_id="+String(posted?.post_id || "unknown"));
