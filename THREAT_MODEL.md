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
- session identifiers are cryptographically random
- session secrets are never placed in URLs or logs
- WebSocket identity derives from authenticated session state
- third-party/media tokens do not grant Cubic account access

A compromised browser context may still perform actions as the logged-in user
while that context remains compromised.

The architecture should minimize the ability to steal one credential and reuse
it indefinitely from another device.

## Authorization / IDOR

Object identifiers are not authorization.

Every access to private resources must verify membership/permissions.

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

## Sessions

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

Clients must not be able to claim:
- another user ID
- unauthorized conversation membership
- unauthorized server/channel membership
- elevated permissions

## Voice/video

LiveKit tokens are short-lived scoped capabilities.

Cubic performs authorization before issuing them.

Possession of a LiveKit token must not authenticate a user to the Cubic API.

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

## Out of scope / unavoidable limits

If an endpoint device is fully compromised, malware may control the browser,
capture input/screen contents or act through an authenticated session.

Cubic should nevertheless prevent such compromise from trivially yielding a
long-lived portable account credential.

