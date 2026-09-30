# Cubic v2 — engineering rules

This file is operational guidance. Implemented behavior is summarized in [README.md](README.md); planned features and UX decisions belong in [ROADMAP.md](ROADMAP.md) and [PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md).

## Repository and scope

- Active v2 base: `refactor/v2`. Work on a scoped `codex/...` branch. Record the exact base and inspect the current tree before editing; never reconstruct large files from stale snapshots.
- Runtime: Node.js 24, TypeScript, Svelte 5/SvelteKit, Fastify, PostgreSQL 18, Drizzle, Socket.IO, self-hosted LiveKit and Docker Compose. Operator HTTPS reverse proxy: Traefik in the validated deployment.
- Release metadata currently reports `2.0.0-alpha.7`. `VERSION` is the release reference; workspace manifests and `CUBIC_VERSION` must match it. Web unit tests enforce this mirror.
- **Do not touch `backups/`**, which may contain untracked operator data. Do not delete databases, volumes, media or other persistent state. Do not print `.env`, credentials, cookies, tokens, hashes, assertions or private media.
- Preserve existing behavior and the Onyx visual system. Read affected source and tests first. Prefer narrow changes; never replace `apps/web/src/routes/app/+page.svelte`, `apps/web/src/app.css`, `packages/shared/src/index.ts` or `packages/database/src/schema.ts` wholesale.

## Development and validation

From the repository root:

```sh
npm ci
npm run check
npm test
npm run build
npm audit --omit=dev
git diff --check
```

The expected Svelte baseline is **0 errors / 0 warnings**. Diagnose failures rather than weakening tests or hiding warnings. Inspect `git status --short --branch`, `git diff --stat`, `git diff --name-status` and the full affected diff before reporting.

Run Playwright from `apps/web`, with `PLAYWRIGHT_BROWSERS_PATH=/tmp/cubic-playwright` where that cache is present, and always `--workers=1`. `apps/web/playwright.config.ts` defines five Chromium viewport projects; Firefox/WebKit require an explicit appropriate harness. Browser fixtures are not production or physical Safari. The user performs final physical-device acceptance. Keep heavy checks sequential on this host.

If runtime behavior changes, inspect only affected Docker services and health. Public health is **`/api/v1/health`**, not `/health`. Do not claim a browser, device, database or production check that was not run.

## Database and rollout discipline

- Use new numbered Drizzle migrations. Do not rewrite a migration already applied in production and never use Drizzle `push` on persistent environments.
- Validate migrations against disposable PostgreSQL. Before production migration, build the migration image, verify the SQL is inside it, take and validate a logical backup, then use the official migrate service.
- Build and recreate only affected services. Do not use `docker compose down -v`; do not restart PostgreSQL or LiveKit during a web/API-only rollout. Record container IDs/start times when isolation matters.
- Do not commit, push, open PRs, merge or deploy unless the specific task authorizes it. Never use `git reset --hard`, `git clean -fd` or force push without explicit authorization.

## Security invariants

- Browser account auth uses opaque random server sessions, digest-only database storage and HttpOnly, host-only, SameSite=Lax cookies; production requires Secure. Never add primary account auth to localStorage, sessionStorage, IndexedDB, JS-readable cookies, URLs or logs.
- Realtime identity derives from the authenticated Cubic session. LiveKit tokens are short-lived, room-scoped media capabilities, never Cubic account credentials. Changes to media authorization require negative tests.
- Enforce authorization on the server for messages, conversations, attachments, server/channel membership, invites and voice. A UUID or visible UI control is not authority. Sensitive routes require origin/cookie protections; do not relax trusted-proxy boundaries, CSP or WebAuthn RP/origin/user-verification/signature checks.
- Treat all user content as hostile. Avoid raw HTML rendering, verify uploads by bytes and path containment, and keep private media behind authorization. Never use client MIME, filename, role or user ID as an authorization source.
- Mail uses external provider-neutral SMTP; never log credentials, reset/verification links or raw tokens. Password recovery and email verification use distinct digest-only tokens. Passkey assertions are verified by SimpleWebAuthn; enrollment and sensitive credential management require password or session-bound recent passkey proof.
- LiveKit browser code is lazy-loaded on media use. Do not reintroduce an eager `livekit-client` import into `/app` without measured justification.
- Security-sensitive work requires explicit threat analysis and negative authorization tests. Keep dependencies minimal and review production audit findings individually; do not run `npm audit fix --force` blindly.

## Completion report

Report the exact files changed, tests and results, relevant runtime checks, diff/status, limitations and remaining physical smoke. State whether backups, production, migrations and LiveKit were touched.
