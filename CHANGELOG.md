# Changelog

All notable changes to Cubic v2 will be documented here.

## [2.0.0-alpha.1] - 2026-08-11

### Added

- New TypeScript monorepo foundation.
- Svelte 5 + SvelteKit web application.
- Fastify API with `/api/v1/health` and `/api/v1/ready` endpoints.
- PostgreSQL 18 database service.
- Drizzle ORM schema package and Drizzle Kit commands.
- Docker Compose stack and production Dockerfiles.
- Shared type/version package.
- GitHub Actions CI baseline.
- Architecture, roadmap and v1 migration documentation.
- Responsive foundation status page using Cubic's existing visual assets.

### Changed

- v2 no longer depends on EJS, jQuery, Express, Mongoose or PeerJS at the foundation level.
- TLS is expected to terminate at a reverse proxy rather than inside the Node.js application.

### Intentionally deferred

- Authentication and sessions: alpha.2.
- DMs/groups/message schema and Socket.IO: alpha.3+.
- LiveKit group voice: alpha.5.
- Screen sharing/video: alpha.6.
