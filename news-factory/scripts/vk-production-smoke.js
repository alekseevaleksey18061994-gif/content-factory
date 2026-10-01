import sharp from "sharp";

const token = String(process.env.VK_ACCESS_TOKEN || "").trim();
const groupId = Math.abs(Number(process.env.VK_GROUP_ID || 0));
const ownerId = Number(process.env.VK_OWNER_ID || (groupId ? -groupId : 0));
const apiVersion = String(process.env.VK_API_VERSION || "5.199").trim();
const confirm = String(process.env.VK_PRODUCTION_SMOKE_CONFIRM || "").trim();

if (confirm !== "chtotamai") throw new Error("VK_PRODUCTION_SMOKE_CONFIRM must equal chtotamai");
if (!token) throw new Error("VK_ACCESS_TOKEN is required");
if (groupId !== 241910449 || ownerId !== -241910449) {
  throw new Error("Refusing smoke: unexpected production VK group");
}

const message = [
  "Тест публикации News Factory 🚀",
  "",
  "Проверяем автоматическую публикацию поста с изображением во ВКонтакте. Если вы видите картинку — новый VK-пайплайн работает корректно.",
  "",
  "#тест"
].join("\n");

function log(obj) {
  console.log("VK_PROD_SMOKE " + JSON.stringify(obj));
}

async function vk(method, params = {}) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") body.set(k, String(v));
  }
  body.set("access_token", token);
  body.set("v", apiVersion);

  const response = await fetch("https://api.vk.com/method/" + method, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const e = data.error || {};
    log({ stage: method, ok: false, error_code: e.error_code ?? response.status, error_msg: e.error_msg || ("HTTP " + response.status) });
    throw new Error("VK " + method + " failed");
  }
  log({ stage: method, ok: true });
  return data.response;
}

const image = await sharp({
  create: {
    width: 1200,
    height: 630,
    channels: 3,
    background: { r: 20, g: 24, b: 33 }
  }
})
.composite([
  { input: Buffer.from('<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg"><rect x="90" y="90" width="1020" height="450" rx="48" fill="#2f6fed"/><circle cx="600" cy="315" r="120" fill="#ffffff" opacity="0.95"/><circle cx="600" cy="315" r="58" fill="#2f6fed"/></svg>') }
])
.jpeg({ quality: 88 })
.toBuffer();

log({ stage: "image", ok: true, bytes: image.length, width: 1200, height: 630 });

let savedPhoto = null;
for (let attempt = 1; attempt <= 3 && !savedPhoto; attempt++) {
  const uploadServer = await vk("photos.getMessagesUploadServer", {});
  if (!uploadServer?.upload_url) throw new Error("VK did not return upload_url");

  const form = new FormData();
  form.append("photo", new Blob([image], { type: "image/jpeg" }), "news-factory-test.jpg");

  const uploadResponse = await fetch(uploadServer.upload_url, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(45000)
  });
  const uploaded = await uploadResponse.json().catch(() => ({}));

  log({
    stage: "upload",
    attempt,
    ok: Boolean(uploadResponse.ok && uploaded.server && uploaded.photo && uploaded.hash),
    http_status: uploadResponse.status,
    has_server: Boolean(uploaded.server),
    photo_length: uploaded.photo != null ? String(uploaded.photo).length : 0,
    hash_length: uploaded.hash != null ? String(uploaded.hash).length : 0
  });

  if (!uploadResponse.ok || !uploaded.server || !uploaded.photo || !uploaded.hash) {
    if (attempt < 3) await new Promise(r => setTimeout(r, attempt === 1 ? 1500 : 4000));
    continue;
  }

  const saved = await vk("photos.saveMessagesPhoto", {
    server: uploaded.server,
    photo: uploaded.photo,
    hash: uploaded.hash
  });
  savedPhoto = Array.isArray(saved) ? saved[0] : (saved?.items?.[0] || null);
}

if (!savedPhoto?.id || !savedPhoto?.owner_id) throw new Error("VK photo save failed after retries");

let attachment = "photo" + savedPhoto.owner_id + "_" + savedPhoto.id;
if (savedPhoto.access_key) attachment += "_" + savedPhoto.access_key;

const posted = await vk("wall.post", {
  owner_id: ownerId,
  from_group: 1,
  message,
  attachments: attachment,
  guid: "nf_prod_smoke_20261001_v1"
});

if (!posted?.post_id) throw new Error("VK wall.post did not return post_id");

log({
  stage: "done",
  ok: true,
  post_id: posted.post_id,
  attachment: attachment.replace(/_[^_]+$/, "_***")
});
