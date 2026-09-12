# Security Policy

Security is a core requirement of Cubic.

Cubic is designed under the assumption that its complete source code and
architecture are public.

## Reporting a vulnerability

Please do not disclose suspected security vulnerabilities in a public issue
before maintainers have had a reasonable opportunity to investigate.

Prefer GitHub's private Security Advisory / private vulnerability reporting
mechanism when it is available for the repository.

Include when possible:

- affected version/commit
- affected component
- reproduction steps
- expected security boundary
- demonstrated impact
- relevant logs or requests with secrets removed
- suggested mitigation, if known

Never include real user passwords, session cookies, private tokens or other
credentials in a report.

## Scope

Particularly important areas include:

- authentication
- session management
- authorization / IDOR
- server/channel permissions
- account recovery
- user-generated content / XSS
- attachments/uploads
- realtime/WebSocket authorization
- LiveKit token issuance
- dependency/supply-chain security
- secrets handling

## Security design principles

- security must not depend on obscurity
- authorization is enforced server-side
- object identifiers are not authorization
- primary browser credentials must not be exposed to frontend JavaScript
- secrets must never be committed to the repository
- destructive security fixes must be reviewed rather than blindly automated

See `THREAT_MODEL.md` for the project's current threat model.

