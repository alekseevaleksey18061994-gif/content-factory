import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');

app.use(express.json({ limit: '12mb' }));
app.use(express.static(publicDir));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'Content Factory', version: '1.1.0' });
});

app.get('/api/status', (_req, res) => {
  res.json({
    ok: true,
    services: {
      n8nServer: Boolean(process.env.N8N_BASE_URL),
      n8nWorkflow: Boolean(process.env.N8N_CONTENT_WEBHOOK),
      higgsfield: Boolean(process.env.HIGGSFIELD_CONNECTED || process.env.HIGGSFIELD_API_KEY),
      runway: Boolean(process.env.RUNWAY_CONNECTED || process.env.RUNWAY_API_KEY),
      descript: Boolean(process.env.DESCRIPT_CONNECTED || process.env.DESCRIPT_API_KEY),
      drive: Boolean(process.env.GOOGLE_DRIVE_CONNECTED || process.env.GOOGLE_DRIVE_API_KEY),
    },
  });
});

app.post('/api/start', async (req, res) => {
  const webhook = process.env.N8N_CONTENT_WEBHOOK;
  if (!webhook) {
    return res.status(503).json({
      ok: false,
      code: 'workflow_not_connected',
      error: 'Рабочий процесс n8n ещё не подключён к кнопке запуска.',
    });
  }

  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { message: raw }; }
    return res.status(response.status).json({ ok: response.ok, data });
  } catch (error) {
    console.error('n8n request failed', error);
    return res.status(502).json({ ok: false, error: 'Не удалось связаться с рабочим процессом n8n.' });
  }
});

app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  return res.sendFile(path.join(publicDir, 'index.html'));
});

const port = Number(process.env.PORT || 3000);
app.listen(port, '0.0.0.0', () => console.log(`Content Factory запущен на порту ${port}`));
