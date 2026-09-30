# Cubic 2.0.0-alpha.7 — current development-line notes

Cubic is still an **alpha**. These notes describe the current repository state; they do not announce a new tag or claim that every device combination has been physically tested.

## Highlights for testers

- Message friends and groups with history, replies, reactions, edits, deletion and attachments.
- Create servers with text channels and audio-only voice channels, organize channels in categories, manage members and share invite links.
- Move from text to direct/group voice, camera video or screen sharing. Device and quality options depend on browser support.
- Manage your profile, account email, password and active sessions. Verify email, recover a password for an eligible verified account, and enroll or use a passkey on a supported device.
- Use the Onyx interface on desktop and mobile browsers. Recent work improved keyboard/focus behavior and reduced initial app JavaScript by loading LiveKit when media is needed.

## Security and account behavior

New and historical accounts remain unverified until their current email is verified; ordinary login and messaging remain available. Password recovery requires a verified current email. A successful email change or password recovery revokes sessions; current-email verification does not. Passkeys require verified current email and WebAuthn user verification. Password login remains available.

## Known limits

- This is an evolving self-hosted alpha, not a stable v2 release. Operators must configure PostgreSQL, LiveKit, HTTPS and, for email delivery, an external SMTP service.
- Browser support varies for output-device selection, screen capture/audio and passkey providers. Playwright WebKit is not a substitute for physical Safari/iPhone checks; Chrome iOS with Bitwarden has previously returned a client/provider `NotAllowedError` before the Cubic completion endpoint.
- Advanced server roles and permissions, Discover, rich-text/mentions, extended profiles, localization and desktop preview are **planned**, not available. See [ROADMAP.md](ROADMAP.md).
- The LiveKit client remains a large **lazy** chunk; its build-size warning does not mean that it is in the initial `/app` import path.

See [CHANGELOG.md](CHANGELOG.md) for implementation history and [SECURITY.md](SECURITY.md) for the security model.
