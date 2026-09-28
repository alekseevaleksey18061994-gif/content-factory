# Stage 2 — тест без риска для production

## Test product
Use `ops/test-payload-korean-washcloth.json`.

This fixture is intentionally isolated from Supabase and contains only confirmed product facts:
- 100×30 cm
- hardness 8/10

No real product media is included because the product and its media are currently absent from the Content Factory database/storage.

## Pass criteria
A successful Stage 2 test must:
1. accept the POST on the separate v2 webhook;
2. write the source job to Google Drive / 01 Исходники;
3. return HTTP 202;
4. call OpenAI Responses API;
5. return strict schema-valid JSON;
6. create 1–2 distinct creative variants without inventing specs;
7. create scene-level generation prompts;
8. create generationQueue entries;
9. write storyboard JSON to Google Drive / 02 Генерации.

## Do not switch production yet
Keep the current `content-factory-run` webhook and app variable `N8N_CONTENT_WEBHOOK` unchanged until all pass criteria succeed.
