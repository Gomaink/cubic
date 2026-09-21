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

The API has a general per-client rate limit, stricter limits for authentication
attempts, and a dedicated attachment-upload limit keyed by the authenticated
user. The current local-memory limiter is appropriate for the single API
process used by the alpha stack. When Cubic supports multiple API replicas, the
limiter store must move to shared Redis state. Attachment count and byte quotas
do not share that limitation: PostgreSQL serializes them across API processes.

## Reverse proxies

Numeric proxy-hop trust is forbidden. `TRUST_PROXY_CIDRS` is a required,
comma-separated list of explicit IPv4 or IPv6 CIDRs. Malformed entries and the
removed `TRUST_PROXY_HOPS` setting fail startup. In production, configure the
smallest dedicated Docker network that contains Cubic's web-to-API hop and the
host bridge gateway used by the external reverse proxy. Do not configure all
RFC1918 space merely because the deployment uses private addresses.

For the validated deployment, the request path is:

```text
browser -> HTTPS Traefik -> host-published Cubic web -> private Cubic API
```

Traefik terminates TLS and reaches the published web port through the Cubic
bridge gateway. The web proxy validates its immediate peer against
`TRUST_PROXY_CIDRS`, walks `X-Forwarded-For` from the nearest hop to the first
untrusted address, and emits a single canonical client address, protocol and
host to the API. Headers supplied through an untrusted direct connection are
discarded. Fastify then trusts canonical forwarding only when its immediate
peer is within the configured boundary. The API remains unpublished by the
default Compose stack.

Inspect the actual network before setting the value:

```bash
docker network inspect <compose-project>_cubic
```

The checked-in development env uses only loopback CIDRs for host-run Vite and
Fastify. A full development Compose stack needs CIDRs matching its actual
private network instead; never carry a development value into production.

## Deployment secrets and fail-closed startup

The default `docker-compose.yml` is production-oriented. These values must be
set explicitly in the operator's private `.env` before Compose can resolve the
configuration:

- `POSTGRES_PASSWORD`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `SESSION_COOKIE_SECURE` (must be `true` in production)
- `TRUST_PROXY_CIDRS` (must match the deployment's dedicated Cubic network)

Missing or empty values cause `docker compose config` and startup to fail with
the name of the missing setting. Secret values are not included in those error
messages. The API independently rejects production startup when secure cookies
are disabled.

Generate unique, URL-safe credentials locally. For example, run
`openssl rand -hex 32` separately for the PostgreSQL password and LiveKit
secret, and `openssl rand -hex 16` for the LiveKit key. Paste each output into
the private `.env`; do not paste outputs into logs, issues or shell history on
shared systems. Files and examples in this repository are public and no value
copied from them is a production secret.

The checked-in `docker-compose.dev.env` and `docker-compose.dev.yml` are an
explicit local-development path. Their public credentials and insecure cookie
setting are safe only for an isolated local HTTP environment. They are not
loaded by the default `docker compose` command.

### Rotation overview

Plan credential rotation during a maintenance window, take and verify a backup,
and keep a tested recovery path. Never recreate or remove the PostgreSQL volume
as part of rotation.

- PostgreSQL: change the existing role password in PostgreSQL, update the
  private `.env` to the same value, then recreate only the migrate/API services
  and verify migrations, health and application data. Coordinate these steps
  closely so new database connections do not remain locked out.
- LiveKit: replace the key and secret in the private `.env`, then recreate the
  LiveKit and API services together. Existing short-lived LiveKit tokens and
  calls may need to reconnect; verify token issuance and media joins afterward.

Do not rotate credentials merely because repository defaults changed. Existing
persistent deployments using unique private credentials can continue using
those credentials.

## HTTPS cookies

HTTPS deployments require `SESSION_COOKIE_SECURE=true`, so browsers transmit
the session cookie only over secure connections. TLS normally terminates at a
trusted reverse proxy, which forwards traffic to Cubic's internal web service.
The plain-HTTP development exception is intentionally limited to API processes
running with `NODE_ENV=development` through the documented development
configuration.

## Uploads

Attachments stream into UUID-named files beneath the private media root. The
streaming path enforces the individual byte limit, removes partial files after
errors, and detects supported formats from file signatures rather than trusting
the browser's filename, extension, or MIME claim. Content delivery remains
authenticated and authorization depends on pending ownership or current
conversation membership.

Attachment storage controls use the following finite self-hosted defaults. Byte
settings are raw bytes; time settings are milliseconds.

| Setting | Default | Purpose |
| --- | ---: | --- |
| `ATTACHMENT_MAX_BYTES` | `26214400` | Maximum bytes for one attachment |
| `ATTACHMENT_PENDING_MAX_COUNT` | `20` | Maximum unbound attachments per user |
| `ATTACHMENT_PENDING_MAX_BYTES` | `262144000` | Maximum total unbound bytes per user |
| `ATTACHMENT_MIN_FREE_BYTES` | `1073741824` | Free-space reserve on the media filesystem |
| `ATTACHMENT_UPLOAD_RATE_LIMIT_MAX` | `20` | Upload attempts per rate window per user |
| `ATTACHMENT_UPLOAD_RATE_LIMIT_WINDOW_MS` | `60000` | Upload rate window |
| `ATTACHMENT_CLEANUP_INTERVAL_MS` | `900000` | Recurring stale-cleanup interval |
| `ATTACHMENT_STALE_AGE_MS` | `86400000` | Age before an unbound upload is stale |
| `ATTACHMENT_CLEANUP_BATCH_SIZE` | `250` | Maximum rows processed per interval |

Pending quota checks and inserts are serialized by an uploader-scoped
PostgreSQL advisory lock. Binding an attachment to a message immediately removes
it from pending quota usage. The stale cleaner runs independently of uploads,
locks rows while deleting their files, never selects bound rows, and retries
remaining work on later intervals.

The minimum-free-space check uses filesystem statistics from the attachment
directory itself and reserves enough capacity for one maximum-size upload. It
is deliberately a last-resort guard, not a perfect concurrent disk reservation.
Crash-safe generalized orphan reconciliation and a durable deletion queue are
deferred to the next storage-hardening slice.
