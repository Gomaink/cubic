# Cubic security policy and implemented controls

Cubic assumes its source code, routes and schema are public. Report suspected vulnerabilities through the repository's private GitHub Security Advisory / vulnerability-reporting mechanism when available. Give maintainers time to investigate before public disclosure. Include affected version, a minimal reproduction and impact, with credentials and private data removed. Do not put passwords, cookies, tokens, assertions or real account data in issues or logs.

The current implementation is an **alpha**, not a claim of complete security coverage. See [THREAT_MODEL.md](THREAT_MODEL.md) for residual risks and [docs/SECURITY.md](docs/SECURITY.md) for operator configuration.

## Sessions and passwords

- Browser authentication uses a random opaque session token in a host-only, HttpOnly, SameSite=Lax cookie. Production requires `Secure`. PostgreSQL stores the SHA-256 digest, never the raw token.
- Sessions have independent absolute and idle expiry, server-side revocation and authenticated session management. Logout revokes the session and disconnects its registered Socket.IO connections. Password recovery and verified email change revoke all account sessions.
- New passwords use Argon2id. Imported legacy bcrypt hashes remain login-compatible and are upgraded to Argon2id after successful verification. Password change and recovery use the current password policy and Argon2id; no primary account bearer token is stored in browser JavaScript storage.
- Authentication-sensitive mutations require password confirmation or, where implemented for passkey management, recent WebAuthn reauthentication bound to the same Cubic session.

## Email and account recovery

- Current-email verification, email change and password recovery use separate finite, single-use token records. Only SHA-256 token digests are persisted; raw tokens are delivered in URL fragments and posted in request bodies, not paths or query strings.
- Existing and new accounts begin unverified until their current email is verified. Ordinary Cubic use remains available; password recovery and passkey use enforce their verified-email eligibility rules.
- Email change keeps the old address authoritative until the new address is verified, then revokes all sessions. Password recovery revokes all sessions and pending email-change tokens, while preserving independent passkey credentials.
- Mail delivery is provider-neutral SMTP. Disabled mode keeps the API usable; SMTP mode requires validated configuration and HTTPS public origin in production. `SMTP_SECURE=false` requires STARTTLS, without plaintext fallback. Delivery failures do not falsely claim a message was sent.

## Passkeys

- WebAuthn enrollment requires a current session, verified email and password or recent session-bound passkey proof. Discoverable login resolves credential ownership on the server; disabled or currently unverified accounts cannot use it.
- Registration and authentication use the SimpleWebAuthn verifier, exact configured origin/RP ID, required user verification, single-use approximately five-minute challenges and SHA-256 challenge digests in PostgreSQL. Enrollment/reauthentication challenges bind to user and session; public login challenges are separate.
- Credential IDs are unique. Cubic stores public credential material, counters and limited authenticator metadata, never private keys or biometric data. Verified assertions alone update counters and last-used timestamps. Removed credentials cannot authenticate.
- Passkey login creates the ordinary Cubic session cookie; reauthentication creates no parallel account session or JavaScript bearer credential.

## Browser, origin and authorization boundaries

- Browser mutations require the configured exact Origin; Fetch Metadata adds defense but does not replace that requirement. The web proxy and API accept forwarded identity only from configured trusted proxy CIDRs, not arbitrary client headers.
- The web service applies a Content Security Policy. HTTPS/HSTS deployment remains an operator responsibility at the reverse proxy. Browser account credentials stay in HttpOnly cookies, not localStorage or sessionStorage.
- Protected objects, including conversations, server channels, attachments, invites and voice rooms, require server-side membership/permission checks. Knowing a UUID or seeing a control in the UI is not authorization. Realtime connections derive identity from the same Cubic session.

## Attachments, media and LiveKit

- Uploads are size/quota limited, staged and bound to messages transactionally. Server-side content sniffing, safe filename handling, controlled paths and content-disposition policy protect delivery. Private files are authorized on read; storage operations reject unsafe paths/symlinks and reconcile stale or orphaned files.
- Server icons and group avatars use their own controlled media flows. Active content is not granted an executable inline delivery path merely because a filename or client MIME type claims a safe format.
- Cubic authorizes LiveKit access before issuing short-lived, room-scoped capabilities. LiveKit tokens are not Cubic account tokens. Session/membership/call changes and periodic reconciliation remove unauthorized participants where the LiveKit administrative channel is available.

## Dependencies and operational practice

Use the lockfile, review production advisories with `npm audit --omit=dev`, and avoid blind broad upgrades. Keep secrets out of the repository and output. Rebuild the migration image and verify the expected versioned SQL is inside it before a production migration; back up the database first. Never use Drizzle `push` on persistent environments.
