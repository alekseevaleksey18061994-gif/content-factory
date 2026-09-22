# Content Factory — ChatGPT Work Handoff

Updated: 2026-09-22

## Goal
Continue development of Alexey's private AI content factory for product videos for Instagram Reels, TikTok and YouTube Shorts with maximum automation, quality control and low manual overhead.

Do NOT rebuild from scratch unless explicitly requested. Preserve the existing UI, backend contracts, data model and working integrations.

## Current production
- Main site: https://content-factory-live-production.up.railway.app
- GitHub repo: https://github.com/alekseevaleksey18061994-gif/content-factory
- Railway project: Content Factory
- Railway production environment ID: 9fc07066-4f38-425d-8dc6-101626f8660a
- Content Factory live service ID: fad99f37-9c56-4bff-96ef-990cc9a65158
- n8n service ID: a8680223-7e34-43c4-abcf-a2217be7e174
- n8n URL: https://n8n-production-51bc.up.railway.app
- Supabase project ID: qpmbjdtvhgynzwnrrfcu
- Supabase URL: https://qpmbjdtvhgynzwnrrfcu.supabase.co

## Repository structure
- server.js — Node HTTP backend + static server
- package.json — npm start -> node server.js
- public/index.html — app markup
- public/style.css — premium dark-green/black mobile UI
- public/app.js — front-end application logic
- public/sw.js — service worker
- public/manifest.webmanifest — PWA manifest
- public/content-factory-workflow.json — production n8n workflow export
- ops/RECOVERY.md — recovery runbook
- WORK_HANDOFF.md — this file
- .env.example — safe variable template

## Current app version / UI
The app identifies as Content Factory, AI-контент-завод, v1.4.
Primary mobile navigation:
- Главная
- Производство
- Товары
- Публикация
- Система

Target pipeline:
Идея → Сценарий → Storyboard → Озвучка → Генерация → Монтаж → Проверка → Готово → Запланировано → Опубликовано

Keep the existing design language unless Alexey explicitly requests changes.

## Persistence
### Supabase
Persistent app state:
- public.app_state
- id = main

Product media:
- Storage bucket: product-media
- Edge Function: product-media
- Product photos upload/delete through backend endpoints:
  - POST /api/media/upload
  - POST /api/media/delete

Backend state endpoints:
- GET /api/state
- POST/PUT /api/state

Backend health:
- GET /health
- GET /api/health
- GET /api/status

### Google Drive
Root folder:
- Content Factory — 1ui364_AC5LlMEjbK-FCcajreHHYQWx4h

Folders:
- 01 Исходники — 1PqHJYLzmDE9-u5QQdRaEYGMI-hcgQ1CS
- 02 Генерации — 1LFskm8RLceOAnGXHLLMOW5rY6Cv0tVFu
- 03 Готовые ролики — 13OYtWuttdQPTjKDRWQlHxVD7GA5FlLjE
- 04 Публикация — 1ROXK5ujRZPj9iEZTfcZn5_n7JY30DUrC
- 05 Архив — 13nOqxP3G6iUcnqlPC9FFqTEu8y3gDXSm
- 99 Backup — 1KKvAplrBGxt5Xw8AqkngWDu36R2_prN3

## n8n
Production workflow:
- name: Content Factory — приём задания и Google Drive
- source export: public/content-factory-workflow.json
- webhook path: content-factory-run
- production webhook: https://n8n-production-51bc.up.railway.app/webhook/content-factory-run

Current first stage is VERIFIED end-to-end:
Content Factory → /api/start → n8n → Google Drive / 01 Исходники

Verified behavior:
- HTTP 202 from workflow
- generated JSON task file appears in 01 Исходники

Google Drive credential name in n8n:
- Google Drive account

IMPORTANT:
The current n8n Railway service has no persistent Railway Volume attached.
Its local SQLite data can be lost on full container recreation.
Do NOT casually redeploy/recreate/delete n8n until persistence is solved.
N8N_ENCRYPTION_KEY exists in Railway and must not be rotated during migration/recovery.
Workflow JSON is backed up in GitHub.

Preferred safe persistence migration:
1. Keep current n8n untouched as fallback.
2. Create a second persistent n8n (Volume or PostgreSQL).
3. Import workflow.
4. Reconnect/restore credentials.
5. Verify webhook + Drive.
6. Only then switch Content Factory N8N_CONTENT_WEBHOOK.
7. Keep old n8n until new one passes production tests.

## Current backend environment interface
Required/used application variables:
- PORT
- SUPABASE_URL
- SUPABASE_PUBLISHABLE_KEY
- CONTENT_FACTORY_DB_SECRET
- N8N_BASE_URL
- N8N_CONTENT_WEBHOOK
- N8N_CONTENT_WEBHOOK_ACTIVE
- N8N_WEBHOOK_BASE
- GOOGLE_DRIVE_CONNECTED
- GOOGLE_DRIVE_ROOT_FOLDER_ID
- GOOGLE_DRIVE_SOURCES_FOLDER_ID
- GOOGLE_DRIVE_GENERATIONS_FOLDER_ID
- GOOGLE_DRIVE_READY_FOLDER_ID
- GOOGLE_DRIVE_PUBLISH_FOLDER_ID
- GOOGLE_DRIVE_ARCHIVE_FOLDER_ID

Future provider variables supported by server status:
- HIGGSFIELD_API_KEY_ID
- HIGGSFIELD_API_KEY_SECRET
- HF_CREDENTIALS
- RUNWAYML_API_SECRET
- DESCRIPT_API_TOKEN

Do not store secrets in GitHub or source files. Use Work/Railway/secret-store connections.

## Existing API behavior
POST /api/start:
- forwards JSON body to N8N_CONTENT_WEBHOOK
- fallback: N8N_WEBHOOK_BASE + /content-factory-run
- returns upstream n8n status/data

GET /api/status checks:
- database
- n8nServer
- n8nWorkflow
- higgsfield
- runway
- descript
- drive

## Generation stack direction
Intended stack:
- OpenAI / ChatGPT — hooks, scripts, prompts, QC
- n8n — orchestration
- Railway — hosting
- Supabase — state/product data/media
- Google Drive — source/generated/final/archive files
- Higgsfield — primary visual/video generation candidate
- Runway — generation/editing/voice/music/SFX candidate
- Descript — editing/captions/final assembly fallback
- Remotion + FFmpeg — deterministic final assembly later
- Social publishing connectors — later

Provider account state at last check:
- Higgsfield connected to ChatGPT, but backend API not yet connected and account had no usable paid generation credits
- Runway connected to ChatGPT, backend API not yet connected and workspace had no credits for generation
- Descript connected and a 5-second vertical test project/video was successfully created in ChatGPT, backend token not yet wired into n8n

## Product workflow requirements
Exact product identity matters. Use actual uploaded product images as references; do not invent or substitute product shape/specifications.

For marketplace/product creative:
- preserve real product
- mobile-readable text
- unique information per slide/scene
- no invented specs
- premium realism
- reuse approved master style across variants when requested

## Content factory product-video objective
The system should eventually:
1. Receive product + media.
2. Generate several concepts/hooks.
3. Generate script.
4. Build storyboard.
5. Create or reuse consistent AI presenter/avatar/character.
6. Generate voice/audio.
7. Generate visual shots/video.
8. Assemble deterministic final video.
9. Run QC.
10. Save source, generations and final media.
11. Queue/schedule publishing.
12. Track status and later performance analytics.

## Stable AI character requirement
Future feature:
- persistent character/avatar profile per brand/page
- visual identity/reference pack
- voice profile
- personality/role
- reusable prompt/system profile
- consistency across multiple product videos

## Security / recovery rules
- Never expose API secrets in chat, GitHub, logs or UI.
- Never delete the current n8n before a tested persistent replacement exists.
- Do not rotate N8N_ENCRYPTION_KEY during migration.
- Keep workflow exports in GitHub.
- Keep important media/results in Google Drive/Supabase rather than ephemeral filesystem.
- Test every infrastructure switch end-to-end before removing fallback.

## Next development priority
1. Make n8n persistent safely.
2. Expand workflow from intake to:
   intake → AI script → storyboard → generation queue
3. Add provider API credentials securely.
4. Add production job state updates back to Supabase.
5. Add retries/error handling/cost controls.
6. Add final assembly + QC.
7. Add publishing.

## Working style
Alexey prefers execution over long explanations.
When a safe action can be done with connected tools, do it.
Only ask him for actions that require login/OAuth/payment/secret entry/explicit approval.
Do not repeat manual setup steps unnecessarily.
Report verified results, not assumptions.
