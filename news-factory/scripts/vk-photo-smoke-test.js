const API_VERSION = process.env.VK_API_VERSION || "5.199";
const USER_TOKEN = String(process.env.VK_USER_TOKEN || "").trim();
const COMMUNITY_TOKEN = String(process.env.VK_ACCESS_TOKEN || "").trim();
const GROUP_ID = Math.abs(Number(process.env.VK_TEST_GROUP_ID || 0)) || 0;
const OWNER_ID = Number(process.env.VK_TEST_OWNER_ID || (GROUP_ID ? -GROUP_ID : 0)) || 0;

if (!USER_TOKEN) throw new Error("VK_USER_TOKEN is required");
if (!COMMUNITY_TOKEN) throw new Error("VK_ACCESS_TOKEN is required");
if (!GROUP_ID || !OWNER_ID) throw new Error("VK_TEST_GROUP_ID is required; production group is never used implicitly");

function logError(method, data) {
  const err = data && data.error;
  console.error(JSON.stringify({
    method,
    error_code: err ? err.error_code : "unknown",
    error_msg: err ? err.error_msg : "unknown VK error"
  }));
}

async function vkApi(method, params, token) {
  const body = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") body.set(key, String(value));
  });
  body.set("access_token", token);
  body.set("v", API_VERSION);
  const response = await fetch("https://api.vk.com/method/" + method, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    logError(method, data);
    throw new Error("VK " + method + " failed");
  }
  console.log(method + ": OK");
  return data.response;
}

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl3cxsAAAAASUVORK5CYII=";
const imageBytes = Buffer.from(pngBase64, "base64");

const uploadServer = await vkApi(
  "photos.getWallUploadServer",
  { group_id: GROUP_ID },
  USER_TOKEN
);

const form = new FormData();
form.append("photo", new Blob([imageBytes], { type: "image/png" }), "vk-smoke-test.png");

const uploadResponse = await fetch(uploadServer.upload_url, { method: "POST", body: form });
const uploaded = await uploadResponse.json();
if (!uploadResponse.ok || !uploaded.server || !uploaded.photo || !uploaded.hash) {
  console.error(JSON.stringify({
    method: "photo.upload",
    error_code: uploadResponse.status,
    error_msg: "Invalid upload response"
  }));
  process.exit(1);
}
console.log("photo.upload: OK");

const saved = await vkApi(
  "photos.saveWallPhoto",
  {
    group_id: GROUP_ID,
    server: uploaded.server,
    photo: uploaded.photo,
    hash: uploaded.hash
  },
  USER_TOKEN
);
const photo = Array.isArray(saved) ? saved[0] : null;
if (!photo || !photo.owner_id || !photo.id) throw new Error("photos.saveWallPhoto returned no photo id");

const attachment = "photo" + photo.owner_id + "_" + photo.id;
const post = await vkApi(
  "wall.post",
  {
    owner_id: OWNER_ID,
    from_group: 1,
    message: "News Factory VK photo smoke test " + new Date().toISOString(),
    attachments: attachment
  },
  COMMUNITY_TOKEN
);

console.log(JSON.stringify({
  ok: true,
  group_id: GROUP_ID,
  post_id: post && post.post_id ? post.post_id : null,
  attachment
}));