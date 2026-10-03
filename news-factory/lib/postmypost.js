// Postmypost (https://postmypost.io) REST API v4.1 client: publishes VK posts WITH a picture through an app VK has
// approved for photo access (a community token cannot attach a visible photo to a wall post, a user token from our own
// VK app is refused the photo scope).
//
// Flow used here: GET /projects + GET /accounts + GET /channels (find the connected VK community once, cached),
// POST /upload/init {project_id, url} -> poll GET /upload/status?id= until status 1 -> file_id,
// POST /publications {project_id, post_at, account_ids, publication_status: 5, details: [{account_id, publication_type: 1,
// content, file_ids}]}, then GET /publications/{id} until status 1 (published) or 3 (error).
//
// Auth: "Authorization: Bearer <POSTMYPOST_TOKEN>". The token is never logged.

export const POSTMYPOST_BASE = "https://api.postmypost.io/v4.1";
export const UPLOAD_STATUS = { DONE: 1, ERROR: 2, PROCESSING: 3, UPLOADING: 4, WAITING: 5 };
export const PUBLICATION_STATUS = { DELETED: 0, PUBLISHED: 1, PUBLISHING: 2, ERROR: 3, DRAFT: 4, PENDING: 5 };
const CONNECTED = 1;

export class PostmypostError extends Error {
  constructor(message, details) {
    super(message);
    Object.assign(this, details || {});
  }
}

function sleep(ms) { return new Promise(function(resolve) { setTimeout(resolve, ms); }); }

function apiErrorMessage(data, status) {
  if (!data || typeof data !== "object") return "HTTP " + status;
  const parts = [];
  if (data.message) parts.push(String(data.message));
  if (data.error && typeof data.error === "string") parts.push(data.error);
  if (Array.isArray(data.errors)) parts.push(data.errors.map(function(e) { return e && (e.message || e.field) ? (e.field ? e.field + ": " : "") + (e.message || "") : String(e); }).join("; "));
  else if (data.errors && typeof data.errors === "object") parts.push(JSON.stringify(data.errors).slice(0, 300));
  return (parts.filter(Boolean).join(" | ") || ("HTTP " + status)).slice(0, 500);
}

export function createPostmypostClient(options) {
  const opt = options || {};
  const token = String(opt.token || "").trim();
  const base = String(opt.baseUrl || POSTMYPOST_BASE).replace(/\/+$/, "");
  const doFetch = function(url, init) { return (opt.fetch || globalThis.fetch)(url, init); };
  const pollMs = Number(opt.pollMs == null ? 2000 : opt.pollMs);
  const timeoutMs = Number(opt.timeoutMs || 20000);

  async function request(method, path, query, body) {
    if (!token) throw new PostmypostError("POSTMYPOST_TOKEN не задан", { pmpCode: "config_missing" });
    const qs = query ? "?" + new URLSearchParams(Object.entries(query).filter(function(e) { return e[1] !== undefined && e[1] !== null && e[1] !== ""; }).map(function(e) { return [e[0], String(e[1])]; })).toString() : "";
    let response;
    try {
      response = await doFetch(base + path + (qs === "?" ? "" : qs), {
        method: method,
        headers: Object.assign({ authorization: "Bearer " + token, accept: "application/json" }, body ? { "content-type": "application/json" } : {}),
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      throw new PostmypostError("Postmypost недоступен: " + String(error && error.message || error), { pmpCode: "network", pmpMethod: method + " " + path });
    }
    const text = await response.text().catch(function() { return ""; });
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) {
      throw new PostmypostError("Postmypost " + method + " " + path + " → " + response.status + ": " + apiErrorMessage(data, response.status), { pmpCode: response.status, pmpMethod: method + " " + path, pmpStatus: response.status });
    }
    return data;
  }

  async function listAll(path, query) {
    const out = [];
    for (let page = 1; page <= 10; page++) {
      const data = await request("GET", path, Object.assign({}, query || {}, { page: page, per_page: 50 }));
      const items = data && Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
      out.push.apply(out, items);
      const pages = data && data.pages;
      if (!pages || !pages.next || items.length === 0 || (pages.total_pages && page >= pages.total_pages)) break;
    }
    return out;
  }

  return {
    listProjects: function() { return listAll("/projects"); },
    listAccounts: function(projectId) { return listAll("/accounts", { project_id: projectId }); },
    listChannels: function() { return listAll("/channels"); },

    // -> file_id. Postmypost downloads the file itself from a public URL.
    uploadByUrl: async function(projectId, url, maxWaitMs) {
      const init = await request("POST", "/upload/init", null, { project_id: Number(projectId), url: String(url) });
      const uploadId = init && init.id;
      if (!uploadId) throw new PostmypostError("Postmypost не вернул id загрузки", { pmpCode: "upload_no_id" });
      const deadline = Date.now() + Number(maxWaitMs || 90000);
      let status = Number(init.status || 0);
      let fileId = init.file_id || null;
      while (true) {
        if (status === UPLOAD_STATUS.DONE && fileId) return Number(fileId);
        if (status === UPLOAD_STATUS.ERROR) throw new PostmypostError("Postmypost не смог загрузить картинку", { pmpCode: "upload_error", pmpUploadId: uploadId });
        if (Date.now() > deadline) throw new PostmypostError("Postmypost: загрузка картинки не завершилась вовремя", { pmpCode: "upload_timeout", pmpUploadId: uploadId });
        await sleep(pollMs);
        const st = await request("GET", "/upload/status", { id: uploadId });
        status = Number(st && st.status || 0);
        fileId = st && st.file_id || null;
      }
    },

    createPublication: function(params) {
      const p = params || {};
      return request("POST", "/publications", null, {
        project_id: Number(p.projectId),
        post_at: p.postAt,
        account_ids: [Number(p.accountId)],
        publication_status: PUBLICATION_STATUS.PENDING,
        details: [{
          account_id: Number(p.accountId),
          publication_type: 1,
          content: String(p.content || ""),
          file_ids: (p.fileIds || []).map(Number)
        }]
      });
    },

    getPublication: function(id) { return request("GET", "/publications/" + encodeURIComponent(id)); },

    // Waits for the post to actually go out. -> {status, publication}; status PUBLISHED/ERROR or the last seen one.
    waitPublished: async function(id, maxWaitMs) {
      const deadline = Date.now() + Number(maxWaitMs || 60000);
      let last = null;
      while (Date.now() <= deadline) {
        last = await request("GET", "/publications/" + encodeURIComponent(id));
        const status = Number(last && last.publication_status);
        if (status === PUBLICATION_STATUS.PUBLISHED || status === PUBLICATION_STATUS.ERROR || status === PUBLICATION_STATUS.DELETED) return { status: status, publication: last };
        await sleep(pollMs);
      }
      return { status: Number(last && last.publication_status), publication: last, timedOut: true };
    }
  };
}

// Picks the connected VK community among the Postmypost accounts.
//  explicit: { projectId, accountId } from env (win when set)
//  vkGroupId: our VK_GROUP_ID, matched against the account's external_id ("241910449", "-241910449", "club241910449")
// -> { projectId, accountId, accountName, candidates: [...] } or throws with a readable list of what was found.
export async function resolvePostmypostTarget(client, explicit, vkGroupId) {
  const ex = explicit || {};
  const projects = ex.projectId ? [{ id: Number(ex.projectId), name: "(POSTMYPOST_PROJECT_ID)" }] : await client.listProjects();
  let vkChannelIds = null;
  try {
    const channels = await client.listChannels();
    vkChannelIds = new Set(channels.filter(function(c) { return /vk|vkontakte|вконтакте/i.test(String(c.code || "") + " " + String(c.name || "")); }).map(function(c) { return Number(c.id); }));
  } catch { vkChannelIds = null; }
  const group = String(Math.abs(Number(vkGroupId) || 0) || "");
  const candidates = [];
  for (const project of projects) {
    const accounts = await client.listAccounts(project.id);
    for (const a of accounts) {
      const isVk = vkChannelIds ? vkChannelIds.has(Number(a.chanel_id != null ? a.chanel_id : a.channel_id)) : true;
      candidates.push({
        projectId: Number(project.id), projectName: String(project.name || ""), accountId: Number(a.id), accountName: String(a.name || ""),
        externalId: String(a.external_id || ""), channelId: Number(a.chanel_id != null ? a.chanel_id : a.channel_id), vk: isVk,
        connected: Number(a.connection_status) === CONNECTED
      });
    }
  }
  const usable = candidates.filter(function(c) { return c.vk && c.connected; });
  let pick = null;
  if (ex.accountId) pick = candidates.find(function(c) { return c.accountId === Number(ex.accountId); }) || null;
  if (!pick && group) pick = usable.find(function(c) { return c.externalId.replace(/^(club|public|-)/i, "") === group; }) || null;
  if (!pick && usable.length === 1) pick = usable[0];
  if (!pick) {
    throw new PostmypostError("Postmypost: не найдено подключённое VK-сообщество" + (usable.length > 1 ? " (их несколько — задайте POSTMYPOST_ACCOUNT_ID)" : ""), { pmpCode: "target_not_found", candidates: candidates });
  }
  if (!pick.connected) throw new PostmypostError("Postmypost: аккаунт «" + pick.accountName + "» требует повторной авторизации", { pmpCode: "account_auth_required", candidates: candidates });
  return Object.assign({}, pick, { candidates: candidates });
}
