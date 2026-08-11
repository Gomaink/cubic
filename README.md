# Cubic

Cubic is being rebuilt as a fast, lightweight and self-hosted messenger with a reactive web UI, group conversations, low-latency voice rooms and screen sharing.

> **Current version:** `v2.0.0-alpha.1` — foundation release. This alpha is intentionally not a feature-complete replacement for Cubic v1.

## Why v2 exists

The legacy implementation was designed around 1:1 messages and 1:1 PeerJS calls. That made groups, authorization, group voice, screen sharing and reliable realtime state much harder to add safely. v2 starts from a conversation-centric architecture and separates text realtime from media realtime.

## Alpha.1 stack

- Node.js 24 LTS
- TypeScript
- Svelte 5 + SvelteKit
- Fastify
- PostgreSQL 18
- Drizzle ORM / Drizzle Kit
- Docker Compose

LiveKit and Socket.IO are deliberately not wired in yet. They enter after the identity/conversation foundation exists.

## Repository layout

```text
apps/
  api/          Fastify API
  web/          SvelteKit web application
packages/
  database/     PostgreSQL + Drizzle
  shared/       shared contracts/version metadata
infra/docker/   production Dockerfiles
docs/           architecture, roadmap and migration notes
```

## Quick start with Docker

```bash
cp .env.example .env
# Change POSTGRES_PASSWORD before exposing this stack.
docker compose up -d --build
```

The one-shot `migrate` service applies the alpha schema with `drizzle-kit push` before the API starts. This is intentionally temporary for the alpha phase; committed SQL migrations replace it before v2 stable.

Open:

- Web: `http://localhost:3000`
- API health: `http://localhost:3001/api/v1/health`

Check the stack:

```bash
docker compose ps
curl http://localhost:3001/api/v1/health
```

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

`npm run db:push` is convenient during the alpha foundation. Before stable releases, database changes must be represented by generated migrations committed under `packages/database/drizzle`.

## Useful commands

```bash
npm run dev
npm run check
npm run build
npm run db:generate
npm run db:migrate
npm run db:push
npm run db:studio
```

## Legacy v1

Do not delete the old code history. Keep the original implementation available through:

```text
tag:    v1.0.0-legacy
branch: legacy/v1
```

v2 development lives on `refactor/v2` until it is ready to replace `main`.

## Release plan

See [`docs/ROADMAP.md`](docs/ROADMAP.md).
