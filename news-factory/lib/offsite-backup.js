// Off-site backups: a gzip (+ AES-256-GCM) copy of the workspace store and the latest per-channel snapshots,
// uploaded to any S3-compatible bucket (AWS S3, Backblaze B2, Cloudflare R2, Railway buckets, MinIO).
//
// No extra dependencies: the request is signed with AWS Signature V4 using node:crypto. The feature is opt-in
// (BACKUP_S3_* variables). Backups are encrypted by default; an unencrypted upload needs BACKUP_ALLOW_UNENCRYPTED=true
// because the workspace state can hold operational data that must not sit in a bucket in clear text.
import crypto from "node:crypto";
import zlib from "node:zlib";

export const BACKUP_MAGIC = "NFB1";

function envBool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return !/^(0|false|no|off)$/i.test(String(value).trim());
}

// Returns null when the feature is not configured, otherwise a normalised config.
export function backupConfig(env) {
  const e = env || process.env;
  const endpoint = String(e.BACKUP_S3_ENDPOINT || "").trim().replace(/\/+$/, "");
  const bucket = String(e.BACKUP_S3_BUCKET || "").trim();
  const accessKeyId = String(e.BACKUP_S3_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(e.BACKUP_S3_SECRET_ACCESS_KEY || "").trim();
  if (!envBool(e.BACKUP_ENABLED, true) || !endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  let prefix = String(e.BACKUP_S3_PREFIX || "news-factory/").trim().replace(/^\/+/, "");
  if (prefix && !prefix.endsWith("/")) prefix += "/";
  return {
    endpoint: endpoint,
    bucket: bucket,
    region: String(e.BACKUP_S3_REGION || "auto").trim() || "auto",
    accessKeyId: accessKeyId,
    secretAccessKey: secretAccessKey,
    prefix: prefix,
    passphrase: String(e.BACKUP_ENCRYPTION_KEY || ""),
    allowUnencrypted: envBool(e.BACKUP_ALLOW_UNENCRYPTED, false),
    intervalHours: Math.max(1, Math.min(168, Number(e.BACKUP_INTERVAL_HOURS || 24) || 24))
  };
}

// Why the config cannot be used right now ("" when it is fine).
export function backupConfigProblem(cfg) {
  if (!cfg) return "not_configured";
  if (!cfg.passphrase && !cfg.allowUnencrypted) return "encryption_key_missing";
  if (cfg.passphrase && cfg.passphrase.length < 16) return "encryption_key_too_short";
  return "";
}

export function encryptBuffer(buffer, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(String(passphrase), salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([Buffer.from(BACKUP_MAGIC), salt, iv, cipher.getAuthTag(), body]);
}

export function decryptBuffer(buffer, passphrase) {
  if (buffer.length < 4 + 16 + 12 + 16 || buffer.subarray(0, 4).toString() !== BACKUP_MAGIC) throw new Error("not an encrypted News Factory backup");
  const salt = buffer.subarray(4, 20);
  const iv = buffer.subarray(20, 32);
  const tag = buffer.subarray(32, 48);
  const key = crypto.scryptSync(String(passphrase), salt, 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(buffer.subarray(48)), decipher.final()]);
}

// JSON payload -> gzip -> optional AES-256-GCM. Returns { buffer, ext, encrypted }.
export function packBackup(payload, passphrase) {
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 6 }) /* level 9 blocked the server ~2 s for little gain */;
  if (passphrase) return { buffer: encryptBuffer(gz, passphrase), ext: "json.gz.enc", encrypted: true };
  return { buffer: gz, ext: "json.gz", encrypted: false };
}

export function unpackBackup(buffer, passphrase) {
  let data = buffer;
  if (data.subarray(0, 4).toString() === BACKUP_MAGIC) {
    if (!passphrase) throw new Error("backup is encrypted: passphrase required");
    data = decryptBuffer(data, passphrase);
  }
  return JSON.parse(zlib.gunzipSync(data).toString("utf8"));
}

export function backupObjectKey(prefix, date, ext) {
  const d = date instanceof Date ? date : new Date(date);
  const p = function(n) { return String(n).padStart(2, "0"); };
  const day = d.getUTCFullYear() + "/" + p(d.getUTCMonth() + 1) + "/" + p(d.getUTCDate());
  const stamp = d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + "T" + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + "Z";
  return String(prefix || "") + day + "/news-factory-" + stamp + "." + ext;
}

function sha256Hex(data) { return crypto.createHash("sha256").update(data).digest("hex"); }
function hmac(key, data) { return crypto.createHmac("sha256", key).update(data).digest(); }
function uriEncode(s) { return encodeURIComponent(s).replace(/[!'()*]/g, function(c) { return "%" + c.charCodeAt(0).toString(16).toUpperCase(); }); }

// AWS Signature V4 for a path-style PUT object request.
export function signS3Put(cfg, key, body, now) {
  const date = now instanceof Date ? now : new Date(now || Date.now());
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const url = new URL(cfg.endpoint);
  const canonicalUri = "/" + [cfg.bucket].concat(String(key).split("/")).map(uriEncode).join("/");
  const payloadHash = sha256Hex(body);
  const host = url.host;
  const headers = { "host": host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort().map(function(k) { return k + ":" + headers[k] + "\n"; }).join("");
  const canonicalRequest = ["PUT", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = dateStamp + "/" + cfg.region + "/s3/aws4_request";
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac("AWS4" + cfg.secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, cfg.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return {
    url: url.origin + canonicalUri,
    headers: {
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      "Authorization": "AWS4-HMAC-SHA256 Credential=" + cfg.accessKeyId + "/" + scope + ", SignedHeaders=" + signedHeaders + ", Signature=" + signature,
      "Content-Type": "application/octet-stream"
    }
  };
}

export async function uploadBackup(cfg, key, buffer, fetchImpl) {
  const doFetch = fetchImpl || fetch;
  const signed = signS3Put(cfg, key, buffer, new Date());
  const response = await doFetch(signed.url, { method: "PUT", headers: signed.headers, body: buffer, signal: AbortSignal.timeout(120000) });
  if (!response.ok) {
    let text = "";
    try { text = String(await response.text()).slice(0, 300); } catch {}
    throw new Error("backup upload failed: HTTP " + response.status + (text ? " " + text.replace(/\s+/g, " ") : ""));
  }
  return { key: key, bytes: buffer.length, etag: response.headers && response.headers.get ? response.headers.get("etag") || "" : "" };
}

export function backupDue(lastSuccessIso, intervalHours, nowMs) {
  const last = Date.parse(lastSuccessIso || "");
  if (!Number.isFinite(last)) return true;
  return (nowMs || Date.now()) - last >= intervalHours * 3600000;
}
