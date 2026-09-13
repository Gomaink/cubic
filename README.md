# Cubic

Cubic is being rebuilt as a fast, lightweight and self-hosted messenger with a reactive web UI, group conversations, low-latency voice rooms and screen sharing.

> **Current version:** `v2.0.0-alpha.2` — identity & security. This alpha is still not a feature-complete replacement for Cubic v1.

## What alpha.2 adds

- PostgreSQL-backed users, settings and revocable sessions.
- Argon2id password hashing for all new passwords.
- Seamless bcrypt verification/rehash for imported Cubic v1 accounts.
- Register, login, logout and current-session API routes.
- Server-authoritative authentication middleware.
- HttpOnly, SameSite session cookies; only token digests are stored in PostgreSQL.
- Global and authentication-specific Fastify rate limits.
- Protected SvelteKit `/app` route and functional login/register screens.
- Same-origin SvelteKit `/api/*` proxy so the browser does not need to know the API container address.
- User settings API for theme, compact/reduced-motion preferences and future voice input/output volume.
- Cubic v1 user/config importer.

## Stack

- Node.js 24 LTS
- TypeScript
- Svelte 5 + SvelteKit
- Fastify
- PostgreSQL 18
- Drizzle ORM / Drizzle Kit
- Argon2id
- Docker Compose

Socket.IO is now wired into the authenticated session boundary for realtime messaging. LiveKit is now wired into the authenticated conversation boundary for direct/group voice; camera and screen sharing arrive in alpha.6.

## Repository layout

```text
apps/
  api/          Fastify API, auth, import tooling
  web/          SvelteKit web application + same-origin API proxy
packages/
  database/     PostgreSQL + Drizzle schema
  shared/       shared contracts/version metadata
infra/docker/   production Dockerfiles
docs/           architecture, security, roadmap and migration notes
```

## Quick start with Docker

```bash
cp .env.example .env
# Fill every blank required credential with a unique value.
# Generate URL-safe values with: openssl rand -hex 32
docker compose config -q
docker compose up -d --build
```

The default Compose configuration is production-oriented and fails during
configuration when `POSTGRES_PASSWORD`, `LIVEKIT_API_KEY`,
`LIVEKIT_API_SECRET` or `SESSION_COOKIE_SECURE` is missing or empty. The API
also refuses to start in production unless `SESSION_COOKIE_SECURE=true`.
Repository examples are public information and must never be reused as
production credentials.

The one-shot `migrate` service applies the committed, versioned Drizzle
migrations before the API starts.

Open:

- Web: `http://localhost:3010`
- API health through the web proxy: `http://localhost:3010/api/v1/health`

Create an account at `/register`, then verify protected routing at `/app`.

Check the stack:

```bash
docker compose ps
curl http://localhost:3010/api/v1/health
```

## Cookies and HTTPS

When Cubic is behind Traefik or another HTTPS reverse proxy, production must
use:

```env
SESSION_COOKIE_SECURE=true
TRUST_PROXY_CIDRS=<dedicated Cubic Docker network CIDR>
```

Determine the exact subnet attached to both `web` and `api` with
`docker network inspect <project>_cubic`; do not substitute a broad private
network range. Both services reject missing or malformed CIDRs at startup.
The web service accepts incoming forwarded headers only from this boundary,
canonicalizes them, and the API accepts the canonical headers only from the
same boundary. Numeric proxy-hop trust is not supported.

Do not expose a production login over plain HTTP. The API is not published to
the host by the default Compose stack; browser traffic goes through the
SvelteKit `/api/*` proxy. Plain-HTTP development is isolated in the explicitly
opt-in development configuration described below.

## Local development

Requirements: Node.js 24, npm 11+, PostgreSQL 18 (or Docker for PostgreSQL).

```bash
npm ci

docker compose --env-file docker-compose.dev.env \
  -f docker-compose.yml -f docker-compose.dev.yml up -d db
export DATABASE_URL='postgresql://cubic:cubic-local-development-only-password@localhost:5432/cubic'
export LIVEKIT_PUBLIC_URL='ws://localhost:7880'
export LIVEKIT_API_KEY='CUBIC_LOCAL_DEVELOPMENT_KEY'
export LIVEKIT_API_SECRET='cubic-local-development-only-secret-000000000000'
export SESSION_COOKIE_SECURE='false'
export TRUST_PROXY_CIDRS='127.0.0.1/32,::1/128'
npm run db:migrate
npm run dev
```

`docker-compose.dev.env` contains public, development-only credentials. It is
loaded only when named with `--env-file`; never use it for an exposed or
production deployment. To run the complete local HTTP stack, use the same
command without the trailing `db` service name and add `--build` as needed.

See [`docs/SECURITY.md`](docs/SECURITY.md) for credential generation and
rotation guidance.

## Useful commands

```bash
npm run dev
npm run check
npm run test
npm run build
npm run db:generate
npm run db:migrate
npm run db:push
npm run db:studio
```

## Import Cubic v1 accounts

Export the old Mongo collections first, then run:

```bash
DATABASE_URL='postgresql://...' \
  npm run import:v1-users -- --users users.json --configs userconfigs.json
```

Imported bcrypt password hashes are not decrypted. On the user's first successful login, Cubic verifies the existing bcrypt hash and replaces it with Argon2id.

See [`docs/MIGRATION_V1.md`](docs/MIGRATION_V1.md) for the supported alpha.2 migration scope.

## Legacy v1

Keep the original implementation available through:

```text
tag:    v1.0.0-legacy
branch: legacy/v1
```

v2 development lives on `refactor/v2` until it is ready to replace `main`.

## Release plan

See [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Current alpha milestone

`v2.0.0-alpha.5` completes the voice layer: authenticated LiveKit rooms, direct-call ringing lifecycle, group voice, mute/deafen, persisted call history, incremental message history and the unified message stream. Alpha.6 moves to camera and screen sharing.

## Current alpha milestone

`v2.0.0-alpha.6.1` completes Cubic's media interaction layer on top of alpha.6: camera/Go Live preflight quality selection, explicit shared-audio capability handling, and independent remote screen-share volume controls.
