# Content Factory — Recovery Runbook

Updated: 2026-09-22

## Source of truth
- Application code: this GitHub repository
- Production workflow JSON: `public/content-factory-workflow.json`
- Website state: Supabase project `content-factory` (`qpmbjdtvhgynzwnrrfcu`)
- Product media: Supabase Storage bucket `product-media`
- Content archive: Google Drive folder `Content Factory`

## Production endpoints
- App: https://content-factory-live-production.up.railway.app
- n8n: https://n8n-production-51bc.up.railway.app
- Production webhook: `/webhook/content-factory-run`

## Google Drive folders
- Root: `1ui364_AC5LlMEjbK-FCcajreHHYQWx4h`
- 01 Исходники: `1PqHJYLzmDE9-u5QQdRaEYGMI-hcgQ1CS`
- 02 Генерации: `1LFskm8RLceOAnGXHLLMOW5rY6Cv0tVFu`
- 03 Готовые ролики: `13OYtWuttdQPTjKDRWQlHxVD7GA5FlLjE`
- 04 Публикация: `1ROXK5ujRZPj9iEZTfcZn5_n7JY30DUrC`
- 05 Архив: `13nOqxP3G6iUcnqlPC9FFqTEu8y3gDXSm`
- 99 Backup: `1KKvAplrBGxt5Xw8AqkngWDu36R2_prN3`

## n8n critical notes
- Current n8n uses SQLite at `/home/node/.n8n/database.sqlite`.
- Railway currently reports no attached persistent volume for n8n.
- `N8N_ENCRYPTION_KEY` is set as a Railway environment variable. Do not remove or rotate it during recovery.
- Avoid redeploying/recreating n8n until persistent storage is attached or a database backup exists.
- The workflow itself is already recoverable from GitHub.
- Google Drive OAuth can be recreated from the Google Cloud OAuth client if n8n credentials are lost.

## Recovery sequence
1. Deploy the same/compatible n8n image.
2. Restore the same `N8N_ENCRYPTION_KEY`.
3. Restore `database.sqlite` if a binary backup exists.
4. Otherwise import `public/content-factory-workflow.json`.
5. Reconnect the Google Drive credential.
6. Publish the workflow.
7. Verify POST `/webhook/content-factory-run` returns 202.
8. Verify a JSON task appears in Google Drive / Content Factory / 01 Исходники.
9. Point Content Factory backend to the verified webhook.

## Current verification
On 2026-09-22 a full request through Content Factory -> n8n -> Google Drive returned HTTP 202 and created a task file in 01 Исходники.


## 2026-09-22 persistent n8n preparation
A dedicated PostgreSQL schema named `n8n` has been created in the existing Supabase project `qpmbjdtvhgynzwnrrfcu`.

Database host:
- `db.qpmbjdtvhgynzwnrrfcu.supabase.co`
- database: `postgres`
- schema: `n8n`
- region: `eu-central-1`

This is preparation only. The current production n8n has NOT been switched and remains the fallback.

Safe migration target variables for a future second n8n instance:
- `DB_TYPE=postgresdb`
- `DB_POSTGRESDB_DATABASE=postgres`
- `DB_POSTGRESDB_HOST=db.qpmbjdtvhgynzwnrrfcu.supabase.co`
- `DB_POSTGRESDB_PORT=5432`
- `DB_POSTGRESDB_USER=postgres`
- `DB_POSTGRESDB_PASSWORD=<set securely in Railway, never commit>`
- `DB_POSTGRESDB_SCHEMA=n8n`

Before switching production:
1. Start a second n8n instance against this schema.
2. Restore/use the same N8N_ENCRYPTION_KEY where applicable.
3. Import `public/content-factory-workflow.json`.
4. Reconnect Google Drive credential securely.
5. Publish and verify the new webhook.
6. Test Content Factory -> new n8n -> Google Drive.
7. Only after success, change `N8N_CONTENT_WEBHOOK` in Content Factory.
