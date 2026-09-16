# Cubic Threat Model

## Security objective

Cubic must remain secure while its complete source code and architecture are
publicly available.

Source-code secrecy is not a security boundary.

## Primary assets

- user accounts
- sessions
- passwords/password hashes
- private messages
- attachments
- server/channel membership
- roles and permissions
- voice/video access
- LiveKit capabilities
- account recovery credentials
- administrative capabilities

## Threat actors

Cubic should consider:

1. unauthenticated internet attackers
2. authenticated malicious users
3. members of the same server/conversation attempting unauthorized access
4. attackers possessing leaked object UUIDs
5. malicious uploads
6. XSS payload authors
7. compromised/transitive dependencies
8. malicious browser extensions
9. malware on an endpoint
10. malicious or compromised reverse proxies/deployments
11. attackers with knowledge of the entire source tree

## Credential theft / token grabbers

A major design objective is preventing Discord-style reusable token theft.

Requirements:

- no long-lived reusable Cubic bearer credential exposed to frontend JS
- primary browser sessions use HttpOnly cookies
- sessions are stored and revocable server-side
- logout invalidates server-side session state
- sessions have independent absolute and finite idle expiration boundaries
- established Socket.IO connections are associated with the database session
  and are disconnected after logout or confirmed revalidation failure
- session identifiers are cryptographically random
- session secrets are never placed in URLs or logs
- WebSocket identity derives from authenticated session state
- third-party/media tokens do not grant Cubic account access

A compromised browser context may still perform actions as the logged-in user
while that context remains compromised.

HttpOnly prevents straightforward JavaScript extraction of the session token;
it does not prevent XSS from issuing authenticated actions through the browser.
An attacker who has already copied a raw cookie can continue acting while the
session remains valid and active. Absolute expiry, idle expiry, server-side
revocation and realtime disconnect bound or terminate that reuse; per-device
management and broader credential rotation remain future controls.

The architecture should minimize the ability to steal one credential and reuse
it indefinitely from another device.

## Authorization / IDOR

Object identifiers are not authorization.

Every access to private resources must verify membership/permissions.

Group metadata, direct-member, role, ownership, leave and deletion mutations
revalidate the actor's current membership and role after acquiring the group's
PostgreSQL advisory transaction lock. Target membership, role and deletion
snapshots used by the mutation are resolved in that same transaction; realtime
events and media deletion occur only after a successful commit.

Group invite transitions resolve the group without retaining an invite-row
lock, acquire that same group advisory lock, and only then lock and revalidate
the current invite row. Create/reopen, accept, decline and cancel therefore use
one lock order, serialize capacity and membership changes, and publish their
existing realtime events only after commit.

Particular attention is required for:

- messages
- attachments
- DMs
- servers
- channels
- member lists
- voice rooms
- invites
- moderation endpoints

Negative authorization tests are required.

## User-generated content / XSS

Messages, names, bios, filenames, server names and future Markdown are
untrusted input.

Raw HTML rendering is forbidden by default.

Future rich-text/Markdown support requires sanitization and dedicated XSS
tests.

## File uploads

Threats include:

- path traversal
- MIME spoofing
- oversized uploads
- malicious SVG/HTML
- executable content
- unauthorized attachment access
- stored-XSS via content disposition/type

Uploads must be stored outside directly executable web roots and delivered
through authorized routes where required.

### Attachment storage exhaustion

Threat: an authenticated user repeatedly creates unbound attachment uploads,
or abandoned pending uploads accumulate indefinitely, until the instance media
filesystem is exhausted. Concurrent requests must not bypass a quota by reading
the same stale usage value.

Controls:

- only pending rows (`message_id IS NULL`) count toward finite per-user count
  and byte quotas
- a short PostgreSQL transaction and uploader-scoped advisory lock serialize
  quota calculation with pending-row insertion across API processes
- upload streams finish before that transaction begins; rejected quota files
  are removed best-effort
- the local media backend uses Node's filesystem statistics for the filesystem
  containing the attachment directory and reserves configurable free space
- attachment uploads have a stricter authenticated-user rate limit than normal
  API traffic
- a lifecycle-managed recurring cleaner selects only stale pending rows in
  bounded batches, locks selected rows, and uses a PostgreSQL advisory lock to
  prevent cleanup overlap across API processes
- cleanup file deletion is idempotent when a file is already absent; failed
  batches or individual file deletions are retried on later intervals

Residual risk: the free-space check is a final guard rather than a reservation,
so simultaneous writes or unrelated processes can consume space after the
check. The alpha stack's rate-limit counters are local to its single API
process. Crashes can still create filesystem/database orphans; generalized
reconciliation and a durable deletion queue are deferred to Slice 0A.4b.

## Sessions

Current controls:

- PostgreSQL stores only SHA-256 session-token digests
- browser tokens are host-only, HttpOnly, SameSite=Lax cookies and are Secure
  in production
- absolute expiration defaults to 30 days
- idle expiration defaults to 7 days and is evaluated in addition to absolute
  expiration
- ordinary authenticated HTTP requests and authenticated client-originated
  Socket.IO application events refresh `last_seen_at` through a bounded
  server-side touch (at most once per five minutes, or half the configured idle
  window when shorter)
- Socket.IO handshakes, Engine.IO heartbeat traffic, server-originated realtime
  events and database revalidation sweeps do not refresh activity
- logout deletes the authoritative database session before disconnecting all
  registered sockets for that exact session
- active-session management is scoped to the authenticated user and exposes only
  the session UUID, a server-defined coarse client label, and lifecycle timestamps
- the session UUID is an opaque management handle, not an authentication
  credential; foreign, missing and already-revoked UUIDs have uniform mutation
  responses
- raw User-Agent values and IP addresses or prefixes are not persisted as session
  metadata

New login and registration continue to issue a fresh server-generated token.
Idle and absolute expiry retain their existing boundaries, and logout-all issues
no replacement. Transparent periodic rotation is intentionally deferred: future
password, recovery and MFA-sensitive flows should confirm credentials and perform
atomic session replacement/revocation. Ordinary profile and server/channel
changes do not rotate sessions.

Required controls should include:

- HttpOnly
- Secure in production
- appropriate SameSite
- server-side expiration
- session rotation
- session revocation
- active-session management
- logout-all
- fixation resistance

CSRF risks must be reviewed for cookie-authenticated state-changing routes.

## Realtime

Socket identity and room membership are server-controlled.

Established sockets retain only the database session ID and the minimum user
identity required by current events. A process-local registry groups all tabs
by session. Client-originated application packets validate the authoritative
session before their handlers run, while a single shared five-minute sweep
checks each unique active session for revocation, absolute/idle expiry and
account disablement. Confirmed invalid sessions are disconnected. A transient
database error does not by itself revoke otherwise established connections;
the sweep retries later, and application events fail closed while validation
is unavailable.

Clients must not be able to claim:
- another user ID
- unauthorized conversation membership
- unauthorized server/channel membership
- elevated permissions

The current deployment has one API process. Session revocation notifications and
the session-to-sockets registry are process-local. In a hypothetical multi-process
deployment, HTTP requests, new handshakes and client application packets still
validate against PostgreSQL, and the periodic sweep remains a recovery path, but
another process would not receive the immediate local revocation event. Cubic does
not claim immediate distributed socket revocation until a distributed Socket.IO
adapter and invalidation mechanism are designed together.

## Voice/video

LiveKit tokens are short-lived scoped capabilities.

Cubic performs authorization before issuing them.

Possession of a LiveKit token must not authenticate a user to the Cubic API.

The ten-minute LiveKit token lifetime is an entry/reconnect window, not the
revocation mechanism for an established participant. The single API process
maintains an issued-participant registry keyed to the authoritative Cubic
session, consumes post-commit session/membership/block/call events, and uses
LiveKit's server API to remove participants or delete ended direct-call rooms.
Periodic reconciliation defaults to 30 seconds and independently checks active
Cubic-managed rooms against PostgreSQL. Confirmed invalid participants are
removed; database uncertainty is not treated as proof of revocation.

Direct calls use a room derived from the accepted call ID, while group voice
retains its conversation-derived room. A direct token is issued only while that
call is accepted. Participant identities include a versioned, room-scoped
HMAC tag and a random participant instance UUID. They never contain the Cubic
session UUID, session token or stored token digest. LiveKit attributes retain
only the existing Cubic user and conversation identifiers and participants
cannot update their own metadata.

LiveKit 1.13.6 cannot remove or pre-revoke an issued identity that has never
connected because `RemoveParticipant` returns not-found for an absent
participant. Such a JWT remains an entry capability until its ten-minute
expiry. Call-specific direct rooms prevent it from authorizing a future call,
and reconciliation removes it if it appears after Cubic authorization has
changed. Eliminating that residual admission window requires additional
LiveKit admission/custom-server integration and is outside this slice.

If the LiveKit administrative control plane is known to be unavailable, Cubic
denies new media tickets with a generic temporary-unavailability response.
Established media may continue until bounded in-memory retries or reconciliation
can reach LiveKit again. A direct/manual SQL account disable is discovered
within the reconciliation interval plus LiveKit administrative latency; a
future application account-disable mutation must emit its authorization event
only after the database mutation commits.

These immediate event and registry guarantees are process-local. A future
multi-process API deployment requires distributed authorization events and
Socket.IO coordination; this release does not add Redis, NATS or PostgreSQL
notification infrastructure.

## Future servers/roles

Permission evaluation should become centralized and deterministic.

Future permission tests must cover:
- inherited roles
- multiple roles
- deny/allow behavior
- channel/category overrides
- owner/admin semantics
- former members
- banned users

## Dependencies and supply chain

Use minimal dependencies.

Lock dependencies.

Review security advisories.

Automate dependency and static-code scanning where useful.

Never assume a library is safe solely because it is popular.

## Deployment credential configuration

Threat: an operator starts the public Compose configuration without supplying
private credentials, causing Cubic to use repository-known database or LiveKit
credentials. A second failure mode is an HTTPS deployment that silently emits
session cookies without the `Secure` attribute.

Controls:

- production Compose requires non-empty PostgreSQL and LiveKit credentials
  during interpolation and contains no secret fallback values
- the production API refuses to start unless secure session cookies are enabled
- example production secret fields are blank
- public development credentials and plain-HTTP cookies require an explicitly
  selected development env file and override
- startup validation identifies invalid setting names without logging their
  values

Residual risk: an operator can still choose a weak or reused private secret,
expose a development deployment, mishandle the `.env`, or misconfigure TLS and
proxy routing. Documentation, unique random credential generation and careful
rotation reduce these operator-controlled risks but cannot eliminate them.

## Forwarded-header trust

Threat: an untrusted client supplies `X-Forwarded-For`, `X-Forwarded-Proto` or
`X-Forwarded-Host` and is mistaken for another client, changes rate-limit
identity, or influences protocol/host security decisions. Numeric hop counts
are especially unsafe when the path length can differ.

Controls:

- Fastify is pinned to the audited 5.12.4 security release
- numeric and unrestricted proxy trust are rejected
- operators must provide explicit trusted proxy CIDRs
- the public web proxy discards forwarded identity from peers outside that
  boundary and canonicalizes trusted forwarding chains
- the API accepts canonical forwarding only from a peer inside that boundary
- regression tests cover untrusted spoofing, trusted forwarding, multi-value
  chains, rate-limit identity and secure cookies behind HTTPS

Residual risk: a compromised process or host inside the explicitly trusted
network can forge forwarding metadata. Operators must therefore use the
smallest dedicated network practical, avoid attaching unrelated containers,
and update the CIDRs when network topology changes.

## Out of scope / unavoidable limits

If an endpoint device is fully compromised, malware may control the browser,
capture input/screen contents or act through an authenticated session.

Cubic should nevertheless prevent such compromise from trivially yielding a
long-lived portable account credential.
