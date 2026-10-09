# Server invite links 2.0

Invite-link management requires current server membership and the `MANAGE_INVITES` permission; the owner has the structural bypass. The API checks this on every request inside the server-row transaction. Link IDs from another server and missing resources do not grant access. Server permissions, group invites and channel overrides are unchanged.

## Validity and usage

Creation defaults to seven days and unlimited uses. Available expirations are one hour, one day, seven days, 30 days, and never. Available limits are one, five, ten, 25, 100, and unlimited. The PostgreSQL clock is authoritative when checking validity: a link is expired when `expires_at <= clock_timestamp()`. `NULL` expiry and limit mean never and unlimited. The counter starts at zero and increases only when a new `server_members` row is inserted. A current member's retry returns `joined: false, alreadyMember: true` without consuming a use. Leaving and joining again through an active link consumes another use. An exhausted link can be edited to raise its limit; editing never resets its counter. Editing an active link's expiration starts the selected duration from edit time. Expired and revoked links cannot be edited back into service. Revocation is permanent, idempotent, and does not remove existing members.

Pause Invites blocks preview, link redemption and acceptance of pending targeted server invitations. Pending invitations remain stored, can still be cancelled, and become acceptable again after resume if otherwise valid. Pausing and joining serialize on the server-row lock. New targeted server invitations return HTTP 410; the old pending acceptance and cancellation routes remain available during this transition. Group invitations are unaffected.

The management list is paginated in pages of 20 and includes active, exhausted, paused, expired and revoked links, usage counts and timestamps. It never returns credentials. A separate authenticated copy action returns a credential for an eligible link after rechecking `MANAGE_INVITES`. The UI displays a copyable URL using the `/invite#token` fragment; preview and join send the token in a POST body. Public unavailable responses remain generic.

## Credentials and key rotation

Legacy 43-character random tokens remain accepted through their stored SHA-256 digest. V2 credentials have the fixed form `v2.<key-id>.<link-uuid>.<signature>`. The signature is HMAC-SHA256 over a domain-separated link UUID using an independent 32-byte key. Validation uses a strict fixed format and timing-safe comparison; clients cannot choose an algorithm. The database never stores a raw v2 credential. A legacy row can be copied as a new v2 credential without changing its original digest; both credentials resolve to the same link, counter, expiry and revocation.

Provision `INVITE_LINK_ACTIVE_KEY_ID` and `INVITE_LINK_HMAC_KEYS` explicitly before starting a production API. The latter is a JSON object mapping key IDs to canonical base64url encodings of **independently generated 32-byte secret keys**. Keep the value in the operator's secret store and never place it in a URL, log or repository file. There is no automatic generation or fallback. Invalid or missing production configuration fails startup; development without keys cannot create or copy v2 links.

To rotate, add a new ID/key pair to the JSON map and change the active ID while retaining previous pairs. New copies use the active ID; previously shared v2 credentials continue to verify with their original ID. Removing a previous key invalidates credentials signed by it, including links originally created under that key; plan removal only after those URLs are retired. Legacy random tokens are independent of this keyring.

## Schema and rollout

Migration 0025 adds nullable expiry and limit, usage and update timestamps, the server pause timestamp, and changes the creator FK to `ON DELETE SET NULL` so history survives account deletion. Existing rows keep their link IDs, digests, expiry, revocation and memberships; they start with unlimited uses and a zero counter. Apply 0025 using the official migration process before running the new API. Provision persistent HMAC keys before starting the new API; then update Web. An old API can read the additively extended tables during a staged rollout, but new v2 links require the new API. Do not rotate away a key while credentials using it remain shared.
