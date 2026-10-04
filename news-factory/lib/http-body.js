export async function readJsonBody(req, maxBytes) {
  const limit = Math.max(1024, Number(maxBytes || 1024 * 1024));
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > limit) throw new Error("request too large");
    chunks.push(buf);
  }

  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
}
