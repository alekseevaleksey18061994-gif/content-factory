# Claude instructions for content-factory

## Primary production project: News Factory

The production news application lives in `/news-factory`.
It is deployed from the `main` branch to Railway as service `news-factory-api` with PostgreSQL and a persistent `/data` volume.

## Working rules

- Inspect the existing code and database migrations before changing behavior.
- Do not delete production data.
- Database schema changes require an additive migration in `news-factory/migrations/`.
- Keep changes backward compatible unless the task explicitly requires otherwise.
- Never force-push.
- Never commit or print secrets, tokens, passwords, API keys, cookies, or Railway credentials.
- Secrets belong only in environment variables / GitHub Secrets / Railway variables.
- Do not log secret values.
- Prefer small, reviewable commits.
- Do not silently fall back to a degraded production behavior unless the existing product setting explicitly allows it.
- Preserve existing Telegram publishing unless the task explicitly changes it.
- For VK, log method, error_code, error_msg, post id and slug when relevant, but never tokens.
- Preserve the persistent `/data` volume and PostgreSQL data.
- Before changing deployment configuration, confirm the existing Railway service/root directory expectations in the repository.
- Do not create duplicate services or databases.

## Verification

For changes under `news-factory`:

1. Read `news-factory/package.json` first and use the scripts it defines.
2. Run the relevant tests/smoke checks available in the repository.
3. Check JavaScript syntax/build/startup impact.
4. For DB changes, verify the migration is additive and idempotent where practical.
5. In the PR/response, state:
   - what was found;
   - what changed;
   - how it was tested;
   - any new environment variables;
   - exact post-deploy verification steps.

## Collaboration

- Prefer a branch + pull request for non-trivial changes.
- Do not merge to `main` unless explicitly asked.
- If requirements are ambiguous and a wrong choice could affect production data, publishing, auth, billing, or secrets, ask before making that choice.
