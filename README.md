# Cubic

Cubic is an open-source, self-hosted realtime messenger for direct messages, groups and servers. It combines persistent text conversations with voice, video and screen sharing in a responsive web app.

**Status:** active alpha, not a stable v2 release. The release version is in [`VERSION`](VERSION); package metadata and the API runtime version are checked against it by the web unit suite. This documentation describes the implementation on the current v2 development line, not a promise of future features.

## Available now

- Direct messages and groups, friend requests and blocks, replies, reactions, editing, deletion, attachments, cursor-paginated history and realtime delivery.
- Servers with membership, text channels, categories, audio-only voice channels, server icons and shareable invite links. The existing targeted server invitations are also still implemented.
- Direct calls and group voice, camera video, screen sharing, media preflight, device preferences and per-stream audio controls where the browser supports them.
- Registration and password login; verified email and email change; password recovery for eligible accounts; passkey enrollment, login, management and reauthentication; revocable sessions.
- Onyx web UI for desktop and mobile browsers, with keyboard and accessibility work completed in Alpha 11.8.2.

This is an alpha. Advanced server roles, channel permission overrides, Discover, rich-text messaging, native desktop packaging and localization are **planned**, not available. See [`ROADMAP.md`](ROADMAP.md) and [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md).

## Desktop Preview foundation

`apps/desktop` contains a secure Electron shell that loads the existing production web app at `https://cubic.goma.ink`. It is source for an early Windows x64 preview, **not** a packaged installer or a tested Windows release. The browser renderer continues to use the existing Web/API/Socket.IO/LiveKit paths:

```text
Electron main process → sandboxed BrowserWindow → https://cubic.goma.ink
                                              → existing Web/API/Socket.IO/LiveKit
```

The remote page has no Node integration, preload bridge or generic IPC. The shell keeps navigation on the exact Cubic HTTPS origin, sends external HTTP(S) links to the system browser and denies other schemes. Browser permissions are limited to the current Cubic main frame and necessary media/basic browser capabilities; screen capture and unrelated privileges remain denied pending later desktop media work. Chromium's persistent session holds the ordinary Cubic HttpOnly cookie; the shell never reads or copies it. TLS verification and web CSP remain intact.

From the repository root, `npm run check`, `npm test` and `npm run build` include the desktop workspace. `npm run desktop:dev` compiles and opens the shell on a machine with a GUI. This slice does not add an updater, installer or bundled renderer. See [`apps/desktop/README.md`](apps/desktop/README.md) for the boundary and Windows smoke plan.

## Architecture

- Node.js 24 / TypeScript, Svelte 5 / SvelteKit web, Fastify API.
- PostgreSQL 18 with Drizzle versioned migrations.
- Socket.IO for authenticated messaging and presence; self-hosted LiveKit for voice and media.
- Docker Compose services for web, API, migrations, PostgreSQL and LiveKit. An operator-managed HTTPS reverse proxy such as Traefik fronts the web service.
- Local controlled media storage with authenticated access to private files.

Browser requests use the same-origin web `/api/*` proxy. The API is not host-published in the production Compose configuration. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for implementation detail.

## Security model

Cubic uses opaque server-side sessions in HttpOnly cookies, server-side authorization and scoped LiveKit capabilities. Passwords use Argon2id; imported legacy bcrypt hashes are upgraded after successful login. Email and recovery tokens are stored as digests, and passkeys use verified WebAuthn ceremonies. See [`SECURITY.md`](SECURITY.md), [`THREAT_MODEL.md`](THREAT_MODEL.md) and [`docs/SECURITY.md`](docs/SECURITY.md).

Production mail delivery uses an **external** SMTP-compatible service; `MAIL_TRANSPORT=disabled` is the backward-compatible default. A working email verification or recovery email requires configured SMTP delivery. See [`.env.example`](.env.example) for the provider-neutral contract. Keep all credentials out of Git and logs.

## Development

Requirements: Node.js 24, npm 11+, PostgreSQL 18 (or the development Compose database). Start from the repository root:

```sh
npm ci
npm run check
npm test
npm run build
```

`npm run dev` starts web and API after building shared packages; configure the required local environment first. The explicitly selected `docker-compose.dev.yml` and `docker-compose.dev.env` support a local HTTP stack. Never use development credentials or insecure cookies on an exposed deployment.

Database changes require a **new** versioned Drizzle migration. Do not use `db:push` on a persistent database. Test migrations on disposable PostgreSQL before a production rollout. The v1 import scope is documented in [`docs/MIGRATION_V1.md`](docs/MIGRATION_V1.md).

## Browser testing

Playwright runs from `apps/web` so its local config and fixture server load correctly:

```sh
cd apps/web
PLAYWRIGHT_BROWSERS_PATH=/tmp/cubic-playwright npx playwright test --workers=1
```

The repository's five default viewport projects use Chromium. Firefox and WebKit require explicit local browser setup; Playwright WebKit does not replace physical iPhone Safari testing. Browser fixtures do not access production accounts or media. See [`apps/web/tests/browser/README.md`](apps/web/tests/browser/README.md).

## Deployment

Review [`.env.example`](.env.example), supply private values through your operator environment, and verify `docker compose config --quiet`. Production requires HTTPS and secure session cookies. Build the `migrate` image explicitly and confirm it contains the expected migration before running the one-shot migration service; back up the database first. Build and update only the affected `api` or `web` services, without recreating PostgreSQL or LiveKit. Health is exposed through the web proxy at **`/api/v1/health`**.

The development line is `refactor/v2`; work is prepared on scoped `codex/...` branches. This README does not authorize a production migration or deployment.

## Project documents

- [`CHANGELOG.md`](CHANGELOG.md) — implemented historical changes.
- [`RELEASE_NOTES.md`](RELEASE_NOTES.md) — tester-facing current alpha summary.
- [`ROADMAP.md`](ROADMAP.md) — planned work, separate from implemented behavior.
- [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md) — approved product and UX decisions.
