# Content Factory — Stage 2 AI planning

Status: draft, isolated from production.

## What this adds
- keeps the existing intake and Google Drive source archive;
- returns HTTP 202 immediately after intake;
- asks OpenAI to create several creative hooks, full voiceover, scene-by-scene storyboard and generation prompts;
- validates JSON and limits variants to the requested count;
- strips unknown reference media from the AI result;
- creates a generationQueue;
- stores the plan in Google Drive / 02 Генерации.

## Required before import
- add OPENAI_API_KEY to the persistent n8n service only;
- optional OPENAI_MODEL; default in the draft is gpt-5.6-luna;
- keep the existing Google Drive credential named "Google Drive account";
- import and test this as a separate workflow/webhook before switching the app.

## Safety
The production workflow public/content-factory-workflow.json is intentionally unchanged.
Do not replace N8N_CONTENT_WEBHOOK until the new workflow passes an end-to-end test.
