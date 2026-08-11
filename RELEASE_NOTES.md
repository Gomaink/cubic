# Cubic v2.0.0-alpha.1

This is the first release of the Cubic v2 rewrite.

It is a **foundation release**, not a replacement for the legacy chat yet. The goal is to establish a maintainable, secure and self-host-friendly base before rebuilding user-facing features.

## Highlights

- SvelteKit replaces the non-reactive EJS/jQuery frontend.
- Fastify + TypeScript replaces the monolithic Express JavaScript backend.
- PostgreSQL + Drizzle replaces MongoDB/Mongoose as the v2 persistence direction.
- Docker Compose starts the web app, API and PostgreSQL as one self-hostable stack.
- The API now exposes proper health/readiness endpoints.
- The repository is split into clear app/database/shared boundaries.
- CI performs type/framework checks and production builds.

## Not included yet

Login, friends, messages, groups and calls from Cubic v1 are not wired into this alpha. They remain available on the legacy branch/tag while their v2 replacements are implemented incrementally.

## Upgrade strategy

Develop this release from `refactor/v2`. Do not merge it into `main` as a production replacement for v1 yet.
