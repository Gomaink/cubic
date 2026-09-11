# Cubic v2 — Engineering Rules

## Project

Cubic is a self-hosted realtime messenger.

Stack:
- Node.js 24 + TypeScript
- Svelte 5 / SvelteKit
- Fastify
- PostgreSQL 18
- Drizzle ORM / Drizzle Kit
- Socket.IO
- LiveKit self-hosted
- Docker Compose

Current development line:
- v2.0.0-alpha.7

Current validated checkpoint:
- commit f16d75e
- attachment core works end-to-end

Validated visual baseline:
- v2.0.0-alpha.6.1

The alpha.7 work MUST preserve the validated alpha.6.1 UI except where a
task explicitly requests a local UI change.

## Prime directive

PRESERVE WORKING BEHAVIOR.

Always inspect the current source before editing.

Never reconstruct files from memory or stale snapshots.

Prefer surgical changes over whole-file replacements.

Never replace wholesale:
- apps/web/src/routes/app/+page.svelte
- apps/web/src/app.css
- packages/shared/src/index.ts
- packages/database/src/schema.ts

Do not silently discard existing behavior while implementing a feature.

## Current alpha.7 attachment core

Already implemented and validated:

- attachments PostgreSQL table
- local attachment storage
- authenticated upload
- authenticated content serving
- staged uploads
- upload progress
- maximum 10 attachments per message
- default maximum 25 MB per attachment
- text + attachment messages
- attachment-only messages
- multiple attachments
- transactional attachment -> message binding
- history persistence
- Socket.IO realtime attachment delivery
- reload/history works
- files exist under /data/media/attachments

Do not redesign or replace this architecture unless strictly required.

## Known UI issues to fix in Slice 2

Two existing visual bugs are explicitly in scope:

1. Some attachment/message blocks can visually overlap adjacent messages.
   Fix document/message flow so every message reserves its correct height.

2. On narrow/mobile layouts, attachment and send controls can stack.
   Composer controls must remain on one horizontal row:

   [ attachment ] [ message input ] [ send ]

   Attachment staging remains above that row.

Do not solve either bug with broad global CSS overrides.

## UI design

Visual direction:
- Discord Onyx inspired
- compact
- icon-driven
- dark
- clear message grouping

Preserve unless specifically requested:
- main navigation
- mobile navigation
- conversation list
- landing page
- group settings
- voice dock
- call controls
- camera controls
- screen-share controls
- media stage
- ringing lifecycle
- deafen
- media quality settings

Do not introduce unrelated visual redesigns.

Avoid global !important fixes.

New feature-specific styles should use scoped/prefixed class names such as:
- cubic-media-*
- cubic-attachment-*

## Responsive requirements

Frontend changes must account for:
- desktop
- narrow desktop
- iPhone portrait
- iPhone landscape

Never claim iOS/browser-specific behavior was tested unless it actually was.

The user performs final physical-device/browser acceptance testing.

## Messages

Existing behavior to preserve:
- cursor pagination
- initial latest-message positioning
- load older history
- jump-to-latest
- unread-new-message indicator
- Discord-style sender grouping
- realtime delivery
- DM/group switching

Do not regress any of these while rendering attachments.

## Voice/video/media

Existing and validated:
- LiveKit voice
- DM/group voice
- ringing/call lifecycle
- mute
- deafen
- camera
- screen share
- 60 fps options
- media preflight
- adaptive bandwidth
- stream volume controls

Do not modify these unless the task explicitly requires it.

## Database

Use versioned Drizzle migrations.

Never use drizzle-kit push against persistent environments.

Migration workflow:
1. inspect current schema
2. update schema only if required
3. generate versioned migration
4. inspect SQL
5. run migration
6. verify resulting schema

Never:
- DROP DATABASE
- TRUNCATE application data
- remove PostgreSQL volumes
- docker compose down -v

unless explicitly authorized by the user.

## Git safety

Never execute:
- git reset --hard
- git clean -fd
- git push --force

unless explicitly authorized.

Never modify or commit:
- .env
- credentials
- session secrets
- LiveKit secrets
- API secrets

Do not push.
Do not create release tags.
Do not merge into refactor/v2.

Work only on the current Codex branch.

Local commits are allowed only after all automated checks for the task pass.

## Docker safety

Persistent environment contains valuable application state.

Do not delete volumes.

Prefer rebuilding only affected services.

Services:
- web internal 3000, host 3010
- api internal 3001, intentionally not published to host
- PostgreSQL persistent
- LiveKit persistent configuration

Use:
docker compose ps
docker compose logs <service>

for runtime validation.

## Required autonomous development loop

For every implementation task:

1. Inspect git status and current source.
2. Understand the implementation before editing.
3. Identify the smallest coherent change.
4. Implement it.
5. Run static/type checks.
6. Run tests.
7. Run build.
8. Diagnose failures yourself.
9. Fix them.
10. Repeat until automated checks are green.
11. Run git diff --check.
12. Review the complete diff for unrelated changes.
13. Run targeted runtime/API checks where appropriate.
14. Rebuild only affected Docker services if needed.
15. Inspect health/logs.
16. Report remaining manual acceptance tests.

Do not stop at the first build/test error.
Investigate and fix it autonomously.

## Mandatory validation before claiming completion

Run:

npm ci
npm run check
npm test
npm run build
git diff --check
git status

Inspect:
git diff
git diff --stat

If runtime behavior changed:
docker compose ps
docker compose logs <affected-service>

Use targeted API/database checks where appropriate.

## Completion report

When a task is complete, report:

- summary of implementation
- exact files changed
- automated tests/checks run
- result of each test/check
- Docker/runtime checks performed
- git diff summary
- git status
- manual tests still required
- any uncertainty or known limitation

Never claim something was tested when it was not.
