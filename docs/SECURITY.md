# Cubic v2 security model

## Identity boundary

Cubic v1 frequently accepted user IDs supplied by the browser. v2 treats that as untrusted input.

For authenticated routes, identity is resolved as:

```text
HttpOnly cookie
    -> random session token
    -> SHA-256 token digest
    -> PostgreSQL session
    -> PostgreSQL user
    -> request.auth.user
```

Future message, group and call writes must use `request.auth.user.id`. A `senderId` supplied in JSON must never become an authorization source.

## Passwords

New passwords use Argon2id. The implementation uses a memory-hard configuration and stores the PHC-format hash produced by `node-argon2`.

Cubic v1 used bcryptjs. During migration, an imported bcrypt hash remains valid only as a compatibility bridge. After a successful login, Cubic hashes the submitted password with Argon2id and replaces the legacy hash.

## Sessions

- Browser token: 32 random bytes encoded as base64url.
- Database value: SHA-256 digest of the token, never the raw token.
- Cookie: HttpOnly, SameSite=Lax, path `/`.
- `Secure`: configurable because LAN alpha testing may use HTTP; it must be enabled behind production HTTPS.
- Expiration: configurable, default 30 days.
- Logout deletes the current server-side session.
- Disabled users cannot resolve new or existing sessions.

## Rate limiting

The API has a general per-client rate limit and stricter limits for authentication attempts. The current local-memory limiter is appropriate for the single API process used by the alpha stack. When Cubic supports multiple API replicas, the limiter store must move to shared Redis state.

## Reverse proxies

`TRUST_PROXY_HOPS` defaults to one hop to match the SvelteKit/Traefik -> Cubic topology. The Docker Compose host binding for the API defaults to `127.0.0.1`, so untrusted clients cannot directly inject forwarded-address headers. If you intentionally bind the API to `0.0.0.0`, review proxy trust and rate-limit identity before exposing it.

## Uploads

The v1 avatar upload trusted browser MIME metadata. Alpha.2 intentionally does not restore that endpoint. The new upload pipeline will validate content and store files behind an explicit storage boundary instead of dropping arbitrary uploads into the public web root.
