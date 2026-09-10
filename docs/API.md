# Cubic alpha.2 API

Base prefix: `/api/v1`.

## Public

- `GET /health` — database/auth health.
- `GET /ready` — readiness probe.
- `POST /auth/register` — create an account and session.
- `POST /auth/login` — authenticate by e-mail or username and create a session.
- `POST /auth/logout` — revoke the current session (safe to call without a session).
- `GET /auth/session` — lightweight session state check.

## Authenticated

- `GET /auth/me` — current public user.
- `GET /users/me/settings` — current settings.
- `PATCH /users/me/settings` — update theme/compact/reduced-motion/voice volume settings.
- `PATCH /users/me/profile` — update display name.

Authenticated endpoints derive the user ID from the server-side session. They do not accept a `userId`/`senderId` as an authorization source.

## Browser access

The SvelteKit app proxies `/api/*` to the internal Fastify service. Browser code should use relative URLs such as:

```js
fetch('/api/v1/auth/me', { credentials: 'include' })
```

This prevents LAN/docker API addresses from leaking into client configuration and makes the authentication cookie same-origin from the browser's perspective.


## Group routes (alpha.4)

- `POST /api/v1/groups` — create a group from friends
- `GET /api/v1/groups/:id` — group details and members
- `PATCH /api/v1/groups/:id` — rename (owner/admin)
- `POST /api/v1/groups/:id/members` — add a friend (owner/admin)
- `PATCH /api/v1/groups/:id/members/:userId` — admin/member role (owner)
- `DELETE /api/v1/groups/:id/members/:userId` — remove member according to role hierarchy
- `POST /api/v1/groups/:id/transfer-owner` — transfer ownership
- `POST /api/v1/groups/:id/leave` — leave a group
- `DELETE /api/v1/groups/:id` — delete a group (owner)

## Group invites and media (alpha.4)

- `GET /api/v1/groups/invites` — pending invitations for the authenticated user
- `POST /api/v1/groups/:id/invites` — invite an available friend (owner/admin)
- `POST /api/v1/groups/invites/:inviteId/accept` — accept invitation
- `POST /api/v1/groups/invites/:inviteId/decline` — decline invitation
- `DELETE /api/v1/groups/invites/:inviteId` — cancel pending invitation
- `GET /api/v1/groups/:id/avatar` — authenticated group avatar
- `POST /api/v1/groups/:id/avatar` — replace avatar (owner/admin, multipart field `avatar`)
- `DELETE /api/v1/groups/:id/avatar` — remove avatar (owner/admin)
