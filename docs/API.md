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
