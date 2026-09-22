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
