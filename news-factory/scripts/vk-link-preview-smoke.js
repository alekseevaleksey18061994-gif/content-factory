const BASE_URL = String(process.env.NEWS_FACTORY_PUBLIC_URL || "").replace(/\/$/, "");
const ADMIN_KEY = String(process.env.ADMIN_KEY || "").trim();
const VK_TEST_GROUP_ID = Math.abs(Number(process.env.VK_TEST_GROUP_ID || 0));
const VK_TEST_GROUP_TOKEN = String(process.env.VK_TEST_GROUP_TOKEN || "").trim();
const VK_API_VERSION = String(process.env.VK_API_VERSION || "5.199").trim();

if (!BASE_URL || !/^https:\/\//i.test(BASE_URL)) throw new Error("NEWS_FACTORY_PUBLIC_URL with https is required");
if (!ADMIN_KEY) throw new Error("ADMIN_KEY is required");
if (!VK_TEST_GROUP_ID) throw new Error("VK_TEST_GROUP_ID is required; production group is never used implicitly");
if (!VK_TEST_GROUP_TOKEN) throw new Error("VK_TEST_GROUP_TOKEN is required; production token is never used implicitly");

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

async function vk(method, params) {
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
  if (!response.ok || data.error) {
    const error = data.error || {};
    console.error(JSON.stringify({
      method: method,
      error_code: error.error_code == null ? response.status : error.error_code,
      error_msg: error.error_msg || ("HTTP " + response.status)
    }));
    throw new Error("VK " + method + " failed");
  }
  console.log(JSON.stringify({
    method: method,
    error_code: null,
    error_msg: ""
  }));
  return data.response;
}

const created = await createPreview();
const preview = created.preview || {};
const preflight = created.preflight || {};

console.log(JSON.stringify({
  stage: "preview",
  page_url: preview.url,
  image_url: preview.imageUrl,
  slug: preview.slug,
  page_status: preflight.pageStatus,
  image_status: preflight.imageStatus,
  image_bytes: preflight.imageBytes,
  width: preflight.width,
  height: preflight.height
}));

const message = "News Factory VK link-preview smoke test " + new Date().toISOString();
const posted = await vk("wall.post", {
  owner_id: -VK_TEST_GROUP_ID,
  from_group: 1,
  message: message,
  attachments: preview.url
});

console.log(JSON.stringify({
  ok: true,
  group_id: VK_TEST_GROUP_ID,
  post_id: posted && posted.post_id ? posted.post_id : null,
  slug: preview.slug,
  page_url: preview.url,
  image_url: preview.imageUrl
}));
