# Server permission engine (Alpha 12.2)

Server role permissions are a nonnegative PostgreSQL `BIGINT` mask. The shared catalog assigns stable bit numbers; append future bits without renumbering. The database accepts only bits 0–15. The API serializes canonical names, never a raw `BigInt`. Unknown names and unknown stored bits fail closed. There is no `ADMINISTRATOR` bit: the owner is structurally distinct.

| Bit | Permission | Meaning |
| ---: | --- | --- |
| 0 | `VIEW_SERVER` | View the server and its basic read model. |
| 1 | `MANAGE_SERVER` | Change server identity and settings in later slices. |
| 2 | `MANAGE_ROLES` | Manage eligible custom roles and assignments. |
| 3 | `MANAGE_CHANNELS` | Manage server channels and categories (Alpha 12.3). |
| 4 | `MANAGE_INVITES` | Create, list and revoke server invite links. |
| 5 | `KICK_MEMBERS` | Remove a lower member when the route is migrated. |
| 6 | `SEND_MESSAGES` | Send server channel messages. |
| 7 | `MANAGE_MESSAGES` | Moderate server channel messages when an administrative route is added. |
| 8 | `CONNECT` | Join server voice. |
| 9 | `SPEAK` | Publish microphone audio in server voice. |
| 10 | `VIDEO` | Publish camera video in server voice. |
| 11 | `SCREEN_SHARE` | Publish screen content in server voice. |
| 12 | `VIEW_CHANNEL` | Discover and access an individual text or voice channel. `VIEW_SERVER` does not grant this. |
| 13 | `MENTION_EVERYONE` | Reserved for a future structured `@everyone` ping in text channels. |
| 14 | `MENTION_HERE` | Reserved for a future structured `@here` ping in text channels. |
| 15 | `MENTION_ROLES` | Reserved for future structured role pings in text channels. |

The implicit default role starts with bits 0, 6 and 8–12 (mask 8001), preserving current membership capabilities and channel visibility. Migration 0022 created mask 3905; migration 0023 adds VIEW_CHANNEL to existing defaults and updates the server insert trigger for future servers. Custom roles start at zero. Changing the default mask immediately changes every member's effective mask without assignments. The engine obtains membership and owner from the server, joins only same-server assignments, and uses PostgreSQL `bit_or` to combine custom masks with the default mask in one query. A duplicate assignment cannot change the result. An owner who is a member receives all defined server permissions regardless of assignments or default mask. If the owner's membership is absent or corrupted, the engine returns no authority and fails closed. `servers.owner_user_id` remains the ownership source.

Alpha 12.6 adds bits 13–15 to roles and text-channel overrides without granting them to existing roles or the default role. These settings do not create pings: message bodies remain plain text, including literal `@everyone` and `@here`. Alpha 13.3 must implement structured mentions and enforce the effective text-channel mention bit on the server for both message creation and editing. In particular, PATCH must validate newly created mentions even though today's own-message edit path does not recheck `SEND_MESSAGES`. Unread counts and notification preferences remain planned for 13.4 and 13.5.

Hierarchy is separate from permission bits. Higher `position` means higher role; default is zero. An actor must hold the required permission and have a strictly higher highest assigned role than the target for hierarchical actions. Equal positions deny. The owner can act on any other non-owner member regardless of position; nobody acts on the owner or self through this helper. The helper requires both authorities to belong to the same server. Channel overrides do not change role hierarchy; reorder behavior remains unimplemented.

Invite-link creation, listing and revocation are the first routes using `MANAGE_INVITES`. The owner keeps access through the structural bypass. A member explicitly assigned that bit can manage invite links; others keep the previous denial behavior. This is one administrative capability; a future create-only permission would require a separate bit and route policy. The route derives the actor from the authenticated session and evaluates permission while holding the existing server lock. Future permission writers should use the same server lock to serialize changes with these operations. Existing membership-based reads remain as they were; channel and category mutations use `MANAGE_CHANNELS` in Alpha 12.3.

The single-member engine query is suitable for point authorization and avoids an N+1 join over assigned roles. A future member-list endpoint should aggregate all requested members in one grouped query rather than calling this helper once per row. Alpha 12.4 computes channel permissions as **base server mask → channel overrides → effective channel mask**. Server administration bits remain server-scoped. See [channel permission overrides](channel-permission-overrides.md) for resolution and enforcement.
