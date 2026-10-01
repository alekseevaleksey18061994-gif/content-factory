const BASE_URL = String(process.env.NEWS_FACTORY_PUBLIC_URL || "").replace(/\/$/, "");
const ADMIN_KEY = String(process.env.ADMIN_KEY || "").trim();
const VK_TEST_GROUP_ID = Math.abs(Number(process.env.VK_TEST_GROUP_ID || 0));
const VK_TEST_GROUP_TOKEN = String(process.env.VK_TEST_GROUP_TOKEN || "").trim();
const VK_API_VERSION = String(process.env.VK_API_VERSION || "5.199").trim();
const VK_PRODUCTION_GROUP_ID = Math.abs(Number(process.env.VK_GROUP_ID || 241910449));

if (!BASE_URL || !/^https:\/\//i.test(BASE_URL)) throw new Error("NEWS_FACTORY_PUBLIC_URL with https is required");
if (!ADMIN_KEY) throw new Error("ADMIN_KEY is required");
if (!VK_TEST_GROUP_ID) throw new Error("VK_TEST_GROUP_ID is required");
if (!VK_TEST_GROUP_TOKEN) throw new Error("VK_TEST_GROUP_TOKEN is required");
if (VK_TEST_GROUP_ID === VK_PRODUCTION_GROUP_ID || VK_TEST_GROUP_ID === 241910449) {
  throw new Error("Refusing to run smoke test against production VK group");
}

function log(payload) {
  console.log(JSON.stringify(payload));
}

async function createPreview() {
  const response = await fetch(BASE_URL + "/internal/vk-preview-test-page", {
    method: "POST",
    headers: { "x-admin-key": ADMIN_KEY },
    signal: AbortSignal.timeout(30000)
  });
  const data = await response.json().catch(function(){ return {}; });
  if (!response.ok || !data.ok) throw new Error("Preview endpoint failed: " + (data.error || response.status));
  return data;
}

async function vk(method, params, context) {
  const body = new URLSearchParams();
  Object.entries(params || {}).forEach(function(entry) {
    const key = entry[0], value = entry[1];
    if (value !== undefined && value !== null && value !== "") body.set(key, String(value));
  });
  body.set("access_token", VK_TEST_GROUP_TOKEN);
  body.set("v", VK_API_VERSION);

  const response = await fetch("https://api.vk.com/method/" + method, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json().catch(function(){ return {}; });
  const ctx = context || {};
  if (!response.ok || data.error) {
    const error = data.error || {};
    log({
      stage: "vk_api",
      method,
      error_code: error.error_code == null ? response.status : error.error_code,
      error_msg: error.error_msg || ("HTTP " + response.status),
      post_id: ctx.postId || null,
      slug: ctx.slug || ""
    });
    throw new Error("VK " + method + " failed");
  }

  log({
    stage: "vk_api",
    method,
    error_code: null,
    error_msg: "",
    post_id: data.response && data.response.post_id || null,
    slug: ctx.slug || ""
  });
  return data.response;
}

const created = await createPreview();
const preview = created.preview || {};
const preflight = created.preflight || {};

log({
  stage: "preview",
  page_url: preview.url,
  image_url: preview.imageUrl,
  slug: preview.slug,
  page_status: preflight.pageStatus,
  image_status: preflight.imageStatus,
  image_bytes: preflight.imageBytes,
  width: preflight.width,
  height: preflight.height
});

if (!preview.imageUrl || preflight.pageStatus !== 200 || preflight.imageStatus !== 200) {
  throw new Error("Preview preflight is not ready");
}

const imageResponse = await fetch(preview.imageUrl, {
  headers: { "user-agent": "Mozilla/5.0 (compatible; NewsFactoryVKSmoke/1.0)" },
  signal: AbortSignal.timeout(30000)
});
if (!imageResponse.ok) throw new Error("Preview image HTTP " + imageResponse.status);
const imageBytes = Buffer.from(await imageResponse.arrayBuffer());
if (!imageBytes.length) throw new Error("Preview image is empty");

log({
  stage: "image_download",
  image_status: imageResponse.status,
  image_bytes: imageBytes.length,
  content_type: String(imageResponse.headers.get("content-type") || "")
});

const context = { postId: "smoke", slug: preview.slug };
const uploadServer = await vk("photos.getMessagesUploadServer", {
  peer_id: -VK_TEST_GROUP_ID
}, context);
if (!uploadServer || !uploadServer.upload_url) throw new Error("VK did not return messages upload_url");

const form = new FormData();
form.append("photo", new Blob([imageBytes], { type: "image/jpeg" }), "preview.jpg");

const uploadResponse = await fetch(uploadServer.upload_url, {
  method: "POST",
  body: form,
  signal: AbortSignal.timeout(45000)
});
const uploaded = await uploadResponse.json().catch(function(){ return {}; });

log({
  stage: "photo_upload",
  http_status: uploadResponse.status,
  response_keys: uploaded && typeof uploaded === "object" ? Object.keys(uploaded).sort() : [],
  has_server: Boolean(uploaded && uploaded.server),
  photo_length: uploaded && uploaded.photo != null ? String(uploaded.photo).length : 0,
  hash_length: uploaded && uploaded.hash != null ? String(uploaded.hash).length : 0,
  slug: preview.slug
});

if (!uploadResponse.ok || !uploaded.server || !uploaded.photo || !uploaded.hash) {
  throw new Error("VK messages photo upload returned invalid response");
}

const saved = await vk("photos.saveMessagesPhoto", {
  server: uploaded.server,
  photo: uploaded.photo,
  hash: uploaded.hash
}, context);

const photo = Array.isArray(saved) ? saved[0] : (saved && saved.items ? saved.items[0] : null);
if (!photo || !photo.id || !photo.owner_id) throw new Error("VK did not return saved photo owner_id/id");

let attachment = "photo" + photo.owner_id + "_" + photo.id;
if (photo.access_key) attachment += "_" + photo.access_key;

log({
  stage: "photo_saved",
  owner_id: photo.owner_id,
  photo_id: photo.id,
  has_access_key: Boolean(photo.access_key),
  slug: preview.slug
});

const message = "News Factory VK community-photo smoke test " + new Date().toISOString();
const posted = await vk("wall.post", {
  owner_id: -VK_TEST_GROUP_ID,
  from_group: 1,
  message,
  attachments: attachment,
  guid: "nf_photo_smoke_" + preview.slug.slice(-20)
}, context);

log({
  ok: true,
  mode: "community_photo_upload",
  group_id: VK_TEST_GROUP_ID,
  post_id: posted && posted.post_id ? posted.post_id : null,
  slug: preview.slug,
  page_url: preview.url,
  image_url: preview.imageUrl
});
