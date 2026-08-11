# Migration from Cubic v1

Alpha.1 does **not** import production v1 data yet. This is intentional.

The legacy MongoDB model represents messages as `sender + receiver`, while v2 will represent messages as members of a conversation. Migrating before the final v2 identity/conversation schemas exist would create throwaway migration logic.

## Planned migration sequence

1. Export v1 users, friendships, requests, settings and messages from MongoDB.
2. Create v2 users while preserving stable migration identifiers.
3. Create one direct conversation for every unique participant pair.
4. Insert both users into `conversation_members`.
5. Re-home each legacy message under its corresponding conversation.
6. Convert friendship/request state into relational rows.
7. Validate counts and produce a migration report before cutover.

Passwords should not be decrypted or copied through a custom crypto mechanism. The alpha.2 migration plan will decide whether existing bcrypt hashes can be accepted temporarily and rehashed to Argon2id after successful login.
