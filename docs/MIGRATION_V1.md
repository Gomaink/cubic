# Migration from Cubic v1

Alpha.2 introduces the first migration step: **users and user audio settings**.

The legacy MongoDB message model still cannot be migrated correctly until the conversation tables exist, so messages/friendships remain untouched in this alpha.

## Export the legacy collections

From the MongoDB host, export users as either a JSON array or newline-delimited JSON. For example with `mongoexport`:

```bash
mongoexport --uri="$MONGO_URI" --collection=users --jsonArray --out=users.json
mongoexport --uri="$MONGO_URI" --collection=userconfigs --jsonArray --out=userconfigs.json
```

The exact collection casing/name depends on how the legacy Mongoose deployment created it; verify with your MongoDB instance first.

## Import into PostgreSQL

After building alpha.2 and applying the schema, the easiest path on a self-hosted Docker install is to place both exports in an `import/` folder beside `docker-compose.yml` and run the compiled importer inside the API image:

```bash
mkdir -p import
# copy users.json and userconfigs.json into ./import first

docker compose run --rm \
  -v "$PWD/import:/import:ro" \
  api \
  node apps/api/dist/cli/import-v1-users.js \
  --users /import/users.json \
  --configs /import/userconfigs.json
```

For a local Node development checkout, the equivalent command is:

```bash
DATABASE_URL='postgresql://cubic:password@localhost:5432/cubic' \
  npm run import:v1-users -- --users users.json --configs userconfigs.json
```

The importer:

- creates a new PostgreSQL UUID for each user;
- stores the Mongo ObjectId in `users.legacy_id` for future relationship/message migration;
- normalizes e-mail and username for case-insensitive uniqueness;
- maps legacy `nickname` -> `display_name`;
- preserves `avatarUrl` as metadata;
- preserves the existing bcrypt password hash;
- imports input/output volume when a matching legacy `UserConfigs` record exists;
- skips malformed/already-imported rows rather than inventing identity data.

## Password transition

Cubic v1 used bcryptjs. Alpha.2 does **not** decrypt, reset or double-hash migrated passwords.

On first login:

```text
legacy bcrypt hash
   -> bcrypt verify
   -> success
   -> Argon2id hash of submitted password
   -> replace password_hash
```

From then on, the account uses Argon2id.

## Fields intentionally not migrated yet

- `online`: presence becomes ephemeral realtime state rather than a durable user boolean.
- `peerid`: PeerJS is removed; LiveKit handles media identity later.
- `birthdate`: v2 currently has no product requirement for storing birth dates, so alpha.2 does not copy it into the new identity table.
- friendships, requests and messages: wait for their relational schemas.

## Future migration sequence

1. **alpha.2:** users/settings and stable legacy IDs.
2. **alpha.3:** create conversations/messages and re-home legacy DM history.
3. **alpha.4:** friendships, requests, groups and membership semantics.
4. Produce count/conflict reports before any v1 -> v2 production cutover.
