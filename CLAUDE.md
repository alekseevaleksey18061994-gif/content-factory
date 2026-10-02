# Claude instructions for News Factory

## Production project

The production application lives in `/news-factory`.
It is deployed from the `main` branch to Railway as service `news-factory-api` with PostgreSQL and a persistent `/data` volume.

This repository is now dedicated to News Factory. The old video Content Factory application has been removed and must not be recreated.

## Working rules

- Inspect the existing code and database migrations before changing behavior.
- Do not delete production data unless the user explicitly requests that exact deletion.
- Database schema changes require an additive migration in `news-factory/migrations/`.
- Keep changes backward compatible unless the task explicitly requires otherwise.
- Never force-push.
- Never commit or print secrets, tokens, passwords, API keys, cookies, or Railway credentials.
- Secrets belong only in environment variables / GitHub Secrets / Railway variables.
- Do not log secret values.
- Prefer small, reviewable commits.
- Do not silently fall back to degraded production behavior unless an existing product setting explicitly allows it.
- Preserve Telegram publishing unless the task explicitly changes it.
- For VK, log method, error_code, error_msg, post id and slug when relevant, but never tokens.
- Preserve PostgreSQL and the persistent `/data` volume.

## Verification

For changes under `news-factory`:

1. Read `news-factory/package.json` first and use the scripts it defines.
2. Run the relevant tests/smoke checks available in the repository.
3. Check JavaScript syntax/build/startup impact.
4. For DB changes, verify the migration is additive and idempotent where practical.
5. Adversarial review for non-trivial changes (before deploying to `main`, after a long session, or when confident the change is right): launch a sub-agent with a fresh context whose only goal is to prove the change breaks; every attack must be reproduced by a runnable script; the sub-agent fixes nothing. Fix confirmed findings yourself, add regression tests, re-run the scripts. A nightly GitHub Action (`.github/workflows/adversarial-review.yml`) does the same for the last day of changes and files a GitHub issue.
6. In the PR/response, state:
   - what was found;
   - what changed;
   - how it was tested;
   - any new environment variables;
   - exact post-deploy verification steps.

## Collaboration

- Prefer a branch + pull request for non-trivial changes.
- Do not merge to `main` unless explicitly asked.
- If requirements are ambiguous and a wrong choice could affect production data, publishing, auth, billing, or secrets, ask before making that choice.
