# Cubic v2.0.0-alpha.2

Alpha.2 turns the v2 foundation into the first usable slice of Cubic: **identity and authentication now work end to end**.

## Highlights

- Create an account from the SvelteKit UI and immediately receive a persisted Cubic session.
- Log in with e-mail or username.
- Access a protected `/app` route whose identity is resolved by the server.
- Log out and revoke the current PostgreSQL session.
- New passwords are hashed with Argon2id.
- Legacy Cubic v1 bcrypt accounts can be imported and upgraded to Argon2id automatically after their first successful login.
- Session cookies are HttpOnly and SameSite=Lax; PostgreSQL stores only a SHA-256 digest of the random session token.
- Fastify rate limiting is enabled globally and tightened on login/registration.
- The browser uses a same-origin `/api/*` proxy through SvelteKit, avoiding hard-coded LAN/API addresses in client code.

## Data model

Alpha.2 adds:

```text
users
user_settings
sessions
```

`users.legacy_id` is intentionally retained so future friendship/message migration can map Mongo ObjectIds to new PostgreSQL UUIDs without guessing.

## Migration note

The included `import:v1-users` command only migrates identity and user audio-volume config in this alpha. Friendships and messages wait for their relational tables in alpha.3/alpha.4.

## Not included yet

The app screen is intentionally a protected identity/status screen rather than a chat UI. DMs, groups and realtime messaging arrive when the conversation engine is introduced in alpha.3.
