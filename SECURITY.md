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
- browser sessions require both absolute and finite idle validity, and are
  revalidated for established realtime connections
- current-session logout revokes server-side state before disconnecting every
  Socket.IO connection associated with that exact session
- authenticated users can review and revoke their own active sessions; the
  browser receives only a random session UUID management handle, coarse client
  label and session timestamps, never the session token or stored digest
- session presentation metadata excludes raw User-Agent values and IP addresses
- LiveKit participation is continuously revalidated against Cubic sessions,
  account state, conversation membership, DM blocks and accepted-call state
- LiveKit participant identities contain an opaque room-scoped session tag, not
  a Cubic session UUID, session token or stored token digest
- cookie-authenticated browser mutations require the exact configured browser
  Origin; Fetch Metadata may further restrict a request but never relaxes that
  check, and no JavaScript-readable CSRF credential is introduced
- the web application enforces a nonce-aware Content Security Policy after the
  alpha.8 0C report-only compatibility rollout; violation reports retain only
  bounded directive and target categories, never full URLs
- legacy user avatar URLs are exposed only when they are bounded,
  credential-free absolute HTTPS URLs; unsafe stored values serialize as null
- private group avatars and attachments are opened without following symlinks,
  checked as regular files, and re-sniffed before delivery; PDF files are
  download-only and active or unknown formats are octet-stream downloads
- HSTS remains owned by the operator-managed Traefik Cubic HTTPS router. Its
  later rollout starts at `max-age=300`, without `includeSubDomains` or
  `preload`, and increases only after runtime validation
- secrets must never be committed to the repository
- destructive security fixes must be reviewed rather than blindly automated

See `THREAT_MODEL.md` for the project's current threat model.
