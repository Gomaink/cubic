# Cubic v2.0.0-alpha.5 — Voice hardening, call history and message UI

## Call persistence

1. Starting a DM call inserts one `calls` row and caller/callee `call_participants`.
2. Accepting sets `calls.status=accepted`, `answered_at`, and `joined_at` for both participants.
3. Ending, declining, cancelling or timing out records the terminal status and `ended_at`.
4. Talk duration is measured from `answered_at`, not from ringing start.
5. API startup marks stale `ringing`/`accepted` rows as `interrupted`.
6. `GET /api/v1/calls` only returns calls from conversations the current user belongs to.
7. History uses cursor pagination.

## Network hardening

The existing direct ICE/UDP, ICE/TCP and WSS paths remain unchanged.

This slice adds opt-in embedded TURN/UDP configuration. It stays disabled by default so the
validated LAN deployment is not changed unexpectedly. For an Internet-facing test, enable
external IP discovery and TURN/UDP, then forward the configured ports on the router.

TURN/TLS is intentionally not enabled in this slice because it needs a dedicated TURN domain
and certificate/L4 TLS path. It should be added only if external tests show that UDP + ICE/TCP
coverage is insufficient.

## Message stream

1. Own and remote messages both start from the left.
2. First message in a run shows avatar, display name and timestamp.
3. Consecutive messages from the same sender within seven minutes are compacted.
4. Hovering a compact message reveals its timestamp.
5. Day changes receive a divider.
6. DMs and group chats use the same stream layout.
7. Existing 50-message paging, scroll anchoring and jump-to-latest behavior still work.
8. No right-aligned purple bubble remains for own messages.

## Regression

- DM ring / accept / decline / cancel / timeout / end.
- Group voice direct join.
- Mute / unmute / deafen / undeafen.
- iOS background and reconnect.
- Group settings and invites.

## Final persistence validation

Migration `0003` was applied and verified with both `calls` and `call_participants`.

Persisted lifecycle states were validated for:

- `declined`
- `cancelled`
- `missed`
- `ended`

Accepted calls correctly populate `answered_at`, participant `joined_at` / `left_at`, and talk duration from answer time to end time. Unanswered calls keep `answered_at` and participant join timestamps null.
