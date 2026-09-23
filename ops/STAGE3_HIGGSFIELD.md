# Stage 3 — Higgsfield generation worker

Production-oriented worker without OpenAI dependency:

Content Factory -> n8n webhook `content-factory-generate-v3` -> Higgsfield Seedance 2.0 -> polling -> Content Factory callback.

## Required n8n environment variables

- HIGGSFIELD_API_KEY_ID
- HIGGSFIELD_API_KEY_SECRET
- CONTENT_FACTORY_CALLBACK_URL
- CONTENT_FACTORY_DB_SECRET

## Generation defaults

- 5 seconds
- 720p
- 9:16
- Seedance 2.0
- reference-to-video when product/avatar images exist
- text-to-video otherwise

The app now sends product media plus avatar media with the job. Results are written back into the matching run using `batchId` and appear as a video preview in the run detail.

OpenAI storyboard remains a later layer and is not required for this worker to function.
