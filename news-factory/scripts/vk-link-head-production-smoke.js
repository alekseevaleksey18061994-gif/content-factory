const token = String(process.env.VK_ACCESS_TOKEN || "").trim();
const groupId = Math.abs(Number(process.env.VK_GROUP_ID || 0));
const ownerId = Number(process.env.VK_OWNER_ID || (groupId ? -groupId : 0));
const apiVersion = String(process.env.VK_API_VERSION || "5.199").trim();
const confirm = String(process.env.VK_LINK_SMOKE_CONFIRM || "").trim();
const baseUrl = String(process.env.NEWS_FACTORY_PUBLIC_URL || "").replace(/\/$/, "");
const slug = String(process.env.VK_LINK_SMOKE_SLUG || "").trim();

if (confirm !== "chtotamai-link-head") throw new Error("VK_LINK_SMOKE_CONFIRM mismatch");
if (!token) throw new Error("VK_ACCESS_TOKEN is required");
if (groupId !== 241910449 || ownerId !== -241910449) throw new Error("Refusing smoke: unexpected production VK group");
if (!/^https:\/\//i.test(baseUrl)) throw new Error("NEWS_FACTORY_PUBLIC_URL must be https");
if (!/^[a-z0-9_-]{8,120}$/i.test(slug)) throw new Error("VK_LINK_SMOKE_SLUG is invalid");

function log(payload) {
  console.log("VK_LINK_HEAD_SMOKE " + JSON.stringify(payload));
}

async function vk(method, params = {}) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") body.set(key, String(value));
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
    const error = data.error || {};
    log({
      stage: method,
      ok: false,
      error_code: error.error_code ?? response.status,
      error_msg: error.error_msg || ("HTTP " + response.status)
    });
    throw new Error("VK " + method + " failed");
  }
  log({ stage: method, ok: true });
  return data.response;
}

const pageUrl = baseUrl + "/p/" + encodeURIComponent(slug);
const ua = "Mozilla/5.0 (compatible; NewsFactoryVKLinkHeadSmoke/1.0)";

const pageHead = await fetch(pageUrl, {
  method: "HEAD",
  redirect: "manual",
  headers: { "user-agent": ua },
  signal: AbortSignal.timeout(15000)
});
log({
  stage: "page_head",
  status: pageHead.status,
  content_type: pageHead.headers.get("content-type") || "",
  content_length: Number(pageHead.headers.get("content-length") || 0)
});
if (pageHead.status !== 200) throw new Error("Preview page HEAD failed");

const pageGet = await fetch(pageUrl, {
  redirect: "manual",
  headers: { "user-agent": ua },
  signal: AbortSignal.timeout(15000)
});
const html = await pageGet.text();
const match = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
  html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
const imageUrl = match && match[1] ? match[1] : "";
log({
  stage: "page_get",
  status: pageGet.status,
  content_type: pageGet.headers.get("content-type") || "",
  has_og_image: Boolean(imageUrl)
});
if (pageGet.status !== 200 || !/^https:\/\//i.test(imageUrl)) throw new Error("Preview page GET/og:image failed");

const imageHead = await fetch(imageUrl, {
  method: "HEAD",
  redirect: "manual",
  headers: { "user-agent": ua },
  signal: AbortSignal.timeout(15000)
});
log({
  stage: "image_head",
  status: imageHead.status,
  content_type: imageHead.headers.get("content-type") || "",
  content_length: Number(imageHead.headers.get("content-length") || 0)
});
if (imageHead.status !== 200) throw new Error("Preview image HEAD failed");

const imageGet = await fetch(imageUrl, {
  redirect: "manual",
  headers: { "user-agent": ua },
  signal: AbortSignal.timeout(15000)
});
const imageBytes = Buffer.from(await imageGet.arrayBuffer());
log({
  stage: "image_get",
  status: imageGet.status,
  content_type: imageGet.headers.get("content-type") || "",
  bytes: imageBytes.length
});
if (imageGet.status !== 200 || !imageBytes.length) throw new Error("Preview image GET failed");

const posted = await vk("wall.post", {
  owner_id: ownerId,
  from_group: 1,
  message: [
    "Тест VK link preview после HEAD-исправления 🧪",
    "",
    "Проверяем, сможет ли ВКонтакте забрать Open Graph-изображение News Factory.",
    "",
    "#тест"
  ].join("\n"),
  attachments: pageUrl,
  guid: "nf_link_head_smoke_20261001_v1"
});

if (!posted?.post_id) throw new Error("wall.post did not return post_id");
const postId = Number(posted.post_id);

const verified = await vk("wall.getById", {
  posts: ownerId + "_" + postId
});
const item = Array.isArray(verified) ? verified[0] : (verified?.items?.[0] || null);
const attachments = Array.isArray(item?.attachments) ? item.attachments : [];
const summary = attachments.map((attachment) => ({
  type: attachment?.type || "",
  has_photo: Boolean(attachment?.photo),
  link_has_photo: Boolean(attachment?.link?.photo),
  link_url: attachment?.link?.url || ""
}));

log({
  stage: "verify",
  ok: true,
  post_id: postId,
  attachment_count: attachments.length,
  attachments: summary
});

const visibleMedia = summary.some((x) => x.type === "photo" || (x.type === "link" && x.link_has_photo));
if (!visibleMedia) {
  throw new Error("VK created the post but no visible photo/link photo attachment was returned");
}

log({
  stage: "done",
  ok: true,
  post_id: postId,
  page_url: pageUrl,
  image_url: imageUrl
});
