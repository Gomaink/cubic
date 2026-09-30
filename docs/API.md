# Cubic v2 API orientation

**Current development line:** `2.0.0-alpha.7`. The Fastify API registers versioned routes under `/api/v1`. Browser callers use the SvelteKit same-origin `/api/*` proxy and the HttpOnly Cubic session cookie. The authoritative route definitions, schemas and access checks are in `apps/api/src/app.ts` and `apps/api/src/routes/`; this is an orientation, not a generated OpenAPI contract.

## Health and account

- `GET /api/v1/health` — public health/version endpoint. Use this path through the public web proxy, **not** `/health`.
- `/api/v1/auth/*` — registration, password login/logout, capabilities, current account and active sessions, private security state, email verification/change, password recovery/reset and passkey enrollment/login/management/reauthentication. Public requests never receive raw verification or reset tokens.
- `/api/v1/users/me/*` — authenticated profile, settings and avatar controls.

## Messaging and communities

- `/api/v1/social/*` — friend requests, friendships, blocks and related social actions.
- `/api/v1/conversations/*` — authorized DM/group/message history, actions, reactions, attachments and direct/group call boundaries.
- `/api/v1/servers/*` — authorized server identity, members, categories, text/voice channels, layout, invites and server icons.
- `/api/v1/server-invite-links/*` — invite-link preview/join lifecycle.
- `/api/v1/attachments/*` — authenticated upload/content lifecycle.
- Socket.IO identity and room membership derive from the same database-backed Cubic session; client-supplied user IDs are never authority.

## Browser example

```js
const response = await fetch('/api/v1/auth/me', { credentials: 'include' });
```

State-changing browser requests retain the configured exact-origin protection. The API is not exposed as a host port by the production Compose stack. See [../SECURITY.md](../SECURITY.md) and [ARCHITECTURE.md](ARCHITECTURE.md).
