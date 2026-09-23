# Higgsfield generation pipeline

## Architecture
- existing n8n remains responsible for Google Drive intake;
- n8n-v2-persistent is PostgreSQL-backed and owns generation orchestration;
- Content Factory backend owns Higgsfield API credentials;
- n8n never stores the Higgsfield secret;
- n8n calls the protected backend worker and receives completed generation results.

## Initial safe mode
- 1 scene per submitted Content Factory job;
- 5 seconds;
- 720p;
- 9:16;
- reference-to-video when avatar/product HTTPS references exist;
- text-to-video otherwise.

## Required n8n-v2 variables
- CONTENT_FACTORY_WORKER_URL
- CONTENT_FACTORY_INTERNAL_SECRET

## Required Content Factory variables
- HIGGSFIELD_API_KEY_ID
- HIGGSFIELD_API_KEY_SECRET
- N8N_GENERATION_WEBHOOK

## Cutover rule
Do not remove the old n8n service until Google Drive credentials have been migrated or Drive storage has been replaced.
