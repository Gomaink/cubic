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

Socket.IO and LiveKit are deliberately not wired in yet. Auth must be trustworthy before realtime messaging or media can depend on it.

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
# Change POSTGRES_PASSWORD before exposing this stack.
docker compose up -d --build
```

The one-shot `migrate` service currently applies alpha schemas with `drizzle-kit push` before the API starts. Committed SQL migrations replace this convenience path before v2 stable.

Open:

- Web: `http://localhost:3000`
- API health from the host: `http://localhost:3001/api/v1/health`

Create an account at `/register`, then verify protected routing at `/app`.

Check the stack:

```bash
docker compose ps
curl http://localhost:3001/api/v1/health
```

## Cookies and HTTPS

For local/LAN HTTP testing:

```env
SESSION_COOKIE_SECURE=false
```

When Cubic is behind Traefik or another HTTPS reverse proxy:

```env
SESSION_COOKIE_SECURE=true
TRUST_PROXY_HOPS=1
```

Do not expose a production login over plain HTTP. The Compose stack binds the host API port to `127.0.0.1` by default; browser traffic goes through the SvelteKit `/api/*` proxy.

## Local development

Requirements: Node.js 24, npm 11+, PostgreSQL 18 (or Docker for PostgreSQL).

```bash
cp .env.example .env
npm install

docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db
export DATABASE_URL='postgresql://cubic:change-me-in-production@localhost:5432/cubic'
npm run db:push
npm run dev
```

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
