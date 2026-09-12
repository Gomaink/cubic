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

# Cubic Product Direction

Cubic is evolving into a complete open-source, self-hosted Discord-like
realtime communication platform.

Long-term product concepts:

- Direct Messages
- Servers
- Server Members
- Categories
- Text Channels
- Voice Channels
- Roles
- Permission Overrides
- Presence
- Invites
- Moderation

The current group-conversation model is transitional.

Future architecture MUST NOT deepen the assumption that:

    group === conversation

A Server is not a Conversation.

The intended long-term model is approximately:

User

Direct Conversation
  -> Messages

Server
  -> Server Members
  -> Roles
  -> Categories
  -> Channels
       -> Text Channel
            -> messaging/conversation layer
       -> Voice Channel
            -> realtime voice presence / LiveKit room

Existing messaging capabilities must remain reusable by both:
- DMs
- future text channels

Existing voice/video infrastructure must remain reusable by:
- current calls
- future voice channels

Do not implement server-like functionality by continually expanding the
legacy group model when a reusable server/channel abstraction is more
appropriate.

# Security Philosophy

Cubic security must never depend on source-code secrecy.

Assume that an attacker:
- can read the complete Cubic source code
- knows every public route
- understands the database schema
- understands authentication/session architecture
- understands permission evaluation logic

The system must remain secure under those assumptions.

Security through obscurity is not an acceptable control.

Authentication, authorization, permissions, cryptographic decisions and
data isolation must be enforced explicitly and server-side.

Security is a first-class architectural requirement, alongside correctness,
realtime behavior, performance and UX.

# Credential and Token Security

Cubic must specifically avoid reusable token-grabber-style account compromise.

There must be no long-lived reusable Cubic bearer credential exposed to
frontend JavaScript.

Preferred browser authentication architecture:

- server-side sessions
- cryptographically random session identifiers
- HttpOnly cookies
- Secure cookies in production
- appropriate SameSite policy
- server-side expiration
- server-side revocation

Do not store primary authentication credentials in:
- localStorage
- sessionStorage
- IndexedDB
- client-readable cookies
- query strings
- URLs
- frontend source/state intended for persistence

Never log:
- passwords
- session secrets
- authentication cookies
- API secrets
- LiveKit secrets
- password-reset secrets

Logout must invalidate the session server-side.

Future account security must support:
- active session listing
- individual session/device revocation
- revoke all other sessions
- idle expiration
- absolute expiration
- session rotation after authentication/security-sensitive transitions

# WebSocket Authentication

Realtime connections must derive identity from an authenticated Cubic session.

Never trust a client-provided userId, role, membership or permission claim.

Do not introduce a persistent JavaScript-readable bearer token solely for
Socket.IO/WebSocket authentication.

# LiveKit Security

LiveKit credentials are capabilities, not Cubic account credentials.

LiveKit access tokens must:
- be issued only after Cubic authorization
- have minimal grants
- be scoped to the relevant room/channel
- have short lifetimes where practical
- never grant access to the Cubic account itself

Compromise of a LiveKit token must not imply compromise of a Cubic session.

# Authorization

Knowing a UUID is never authorization.

Every protected object access must verify appropriate authorization,
including:
- messages
- attachments
- conversations
- future servers
- future channels
- future roles
- future voice rooms

Client-side visibility checks are UX only and never replace server-side
authorization.

Future server/channel permissions must be evaluated centrally rather than
reimplemented ad hoc in individual routes.

# XSS and User Content

Treat all user-provided content as hostile.

Do not render raw user input as HTML.

Do not introduce {@html ...} for messages, usernames, bios, filenames or
other user-controlled data without an explicit security design and robust
sanitization.

If Markdown/rich text is added later:
- use a constrained parser
- sanitize generated HTML
- disallow dangerous protocols/elements/attributes
- add security regression tests

Maintain and progressively strengthen Content-Security-Policy.

# Upload Security

Never trust:
- filename
- extension
- client-provided MIME type

Uploaded files must have:
- size limits
- server-side authorization
- controlled storage paths
- path traversal protection
- defensive content-type handling
- authenticated delivery where content is private

UUID knowledge must never bypass attachment authorization.

# Dependency Security

Avoid unnecessary dependencies.

A dependency must not be added merely to save a small amount of code.

Security maintenance should include:
- Dependabot
- dependency review
- CodeQL/SAST where appropriate
- secret scanning
- lockfile review
- explicit audit of production vs development vulnerabilities

Never blindly run:

    npm audit fix --force

Evaluate upgrades and compatibility individually.

# Security Development Rule

Features involving any of the following require explicit threat analysis:

- authentication
- authorization
- sessions
- permissions
- user-generated HTML/content
- file uploads
- realtime communication
- server/channel membership
- invites
- moderation
- secrets
- cryptographic material
- account recovery
- third-party capability tokens

Negative authorization tests are mandatory for security-sensitive features.

