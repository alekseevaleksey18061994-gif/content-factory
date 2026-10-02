# Cost / media balance v0.47.0

News Factory now spends expensive AI only after a post has a realistic path to publication.

## Pipeline

1. Sources, URL/hash dedupe, freshness and headline prefilter stay cheap.
2. Capacity gate pauses ordinary candidates when the channel already has enough approved queue items. Top-score and video stories bypass it.
3. Media discovery caches source images and applies a deterministic quality gate before editorial generation.
4. Writer -> GPT checker -> Claude final checker remains unchanged.
5. Only after editorial approval is media finalized:
   - good source photo/video is kept;
   - technical image enhancement is local;
   - Tier 1 stories may receive an AI-generated cover;
   - Tier 2/3 stories use a zero-API-cost branded local card when no good source photo exists.
6. Telegram and VK publication jobs run independently. One network failing no longer prevents the other from attempting the same post.

## Media quality gate

The gate rejects or heavily penalizes:
- tiny images;
- low-entropy flags, logos and flat cards;
- screenshot-like white UI captures;
- social-post screenshots;
- thumbnails;
- extreme aspect ratios.

Each source accumulates media-good/media-bad counters. Persistently poor media slightly lowers that source's ranking, without overriding editorial usefulness.

## Defaults

- `MEDIA_DEFER_EXPENSIVE=true`
- `MEDIA_QUALITY_MIN_SCORE=62`
- `EDITORIAL_QUEUE_TARGET=4`
- `EDITORIAL_CAPACITY_BYPASS_SCORE=9`
- `MEDIA_AI_COVER_MIN_IMPORTANCE=8`

All are optional. Existing deployments need no new variable to receive these defaults.

## Rollback / tuning

- `MEDIA_DEFER_EXPENSIVE=false` restores immediate media finalization.
- Lower `MEDIA_QUALITY_MIN_SCORE` if too many source photos are rejected.
- Raise `EDITORIAL_QUEUE_TARGET` if a channel starts running short of prepared posts.
- Lower `MEDIA_AI_COVER_MIN_IMPORTANCE` if you want more AI-generated covers.


## Provider request economy

- Claude health-check is cached for 120 minutes by default (`ANTHROPIC_HEALTH_CACHE_MIN`), and no health API call is made while the Anthropic breaker is already open.
- Circuit-breaker cooldown depends on the failure: transient outage retries quickly; billing/auth failures sleep much longer, so an empty balance or invalid key is not probed on every post.
- Final media sanitization re-checks even a single legacy/backfill image, so an old screenshot/logo cannot bypass the new media gate.
