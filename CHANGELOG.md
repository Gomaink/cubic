# Changelog

All notable changes to Cubic v2 will be documented here.

## [2.0.0-alpha.2] - 2026-08-11

### Added

- Relational `users`, `user_settings` and `sessions` tables.
- Stable `legacy_id` mapping for future MongoDB-to-PostgreSQL migration stages.
- Argon2id password hashing and verification.
- Legacy bcrypt verification with transparent Argon2id upgrade after successful login.
- Register, login, logout, `me` and session-check endpoints.
- Server-authoritative auth guard for protected API routes.
- Random 256-bit session tokens with SHA-256 token digests stored in PostgreSQL.
- HttpOnly + SameSite session cookies with configurable Secure flag and TTL.
- Global rate limiting plus stricter login/register limits.
- Basic response security headers.
- User settings endpoints for theme, compact mode, reduced motion and voice volume preferences.
- Protected `/app` page plus functional SvelteKit login/register UI.
- Same-origin SvelteKit API proxy for browser requests.
- Cubic v1 user/config import CLI.
- Security-focused unit tests.
- `docs/SECURITY.md`.

### Changed

- Cubic version metadata updated to `2.0.0-alpha.2` across all workspaces.
- TypeScript remains on the validated 6.x line for the current Svelte toolchain.
- PostgreSQL 18 persistent volume uses `/var/lib/postgresql`, matching the PostgreSQL 18 container layout.
- Root landing page now reports the identity layer rather than only the foundation stack.
- CI now executes API security unit tests after checks/build.

### Security

- New authenticated writes derive identity exclusively from a resolved server session.
- Session tokens are never persisted in plaintext.
- Login errors do not reveal whether an identifier exists or an account is disabled.
- Password input is bounded and new password hashes use Argon2id.

### Deferred

- Conversation/message authorization and Socket.IO: alpha.3.
- Group management: alpha.4.
- Avatar/file upload pipeline is postponed until a dedicated media-storage boundary is introduced; v2 will not revive the v1 MIME-only upload checks.
- LiveKit voice: alpha.5.

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
