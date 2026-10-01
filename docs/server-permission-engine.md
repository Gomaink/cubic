# Server permission engine (Alpha 12.2)

Server role permissions are a nonnegative PostgreSQL `BIGINT` mask. The shared catalog assigns stable bit numbers; append future bits without renumbering. The database currently accepts only bits 0–11. The API serializes canonical names, never a raw `BigInt`. Unknown names and unknown stored bits fail closed. There is no `ADMINISTRATOR` bit: the owner is structurally distinct, and channel override semantics belong to Alpha 12.3.

| Bit | Permission | Meaning |
| ---: | --- | --- |
| 0 | `VIEW_SERVER` | View the server and its basic read model. |
| 1 | `MANAGE_SERVER` | Change server identity and settings in later slices. |
| 2 | `MANAGE_ROLES` | Manage custom roles and assignments in Alpha 12.4. |
| 3 | `MANAGE_CHANNELS` | Manage server channels when routes are migrated. |
| 4 | `MANAGE_INVITES` | Create, list and revoke server invite links. |
| 5 | `KICK_MEMBERS` | Remove a lower member when the route is migrated. |
| 6 | `SEND_MESSAGES` | Send server channel messages when routes are migrated. |
| 7 | `MANAGE_MESSAGES` | Moderate server channel messages in a later slice. |
| 8 | `CONNECT` | Join server voice when media routes are migrated. |
| 9 | `SPEAK` | Publish microphone audio when media routes are migrated. |
| 10 | `VIDEO` | Publish camera video when media routes are migrated. |
| 11 | `SCREEN_SHARE` | Publish screen content when media routes are migrated. |

The implicit default role starts with bits 0, 6 and 8–11, preserving current membership capabilities. Existing default rows are backfilled by migration 0022; the server insert trigger creates the same mask for future servers. Custom roles start at zero. Changing the default mask immediately changes every member's effective mask without assignments. The engine obtains membership and owner from the server, joins only same-server assignments, and uses PostgreSQL `bit_or` to combine custom masks with the default mask in one query. A duplicate assignment cannot change the result. An owner who is a member receives all defined server permissions regardless of assignments or default mask. If the owner's membership is absent or corrupted, the engine returns no authority and fails closed. `servers.owner_user_id` remains the ownership source.

Hierarchy is separate from permission bits. Higher `position` means higher role; default is zero. An actor must hold the required permission and have a strictly higher highest assigned role than the target for hierarchical actions. Equal positions deny. The owner can act on any other non-owner member regardless of position; nobody acts on the owner or self through this helper. The helper requires both authorities to belong to the same server. No channel overrides or reorder behavior are implemented here.

Invite-link creation, listing and revocation are the first routes using `MANAGE_INVITES`. The owner keeps access through the structural bypass. A member explicitly assigned that bit can manage invite links; others keep the previous denial behavior. This is one administrative capability; a future create-only permission would require a separate bit and route policy. The route derives the actor from the authenticated session and evaluates permission while holding the existing server lock. Future permission writers should use the same server lock to serialize changes with these operations. Existing membership-based reads and other owner-only routes remain as they were until explicitly migrated.

The single-member engine query is suitable for point authorization and avoids an N+1 join over assigned roles. A future member-list endpoint should aggregate all requested members in one grouped query rather than calling this helper once per row. Alpha 12.3 can compute channel permissions as **base server mask → channel overwrites → effective channel mask**. `SEND_MESSAGES`, `MANAGE_MESSAGES`, `CONNECT`, `SPEAK`, `VIDEO`, and `SCREEN_SHARE` are candidates for channel scope. Server administration bits (`MANAGE_SERVER`, `MANAGE_ROLES`, `MANAGE_CHANNELS`, `MANAGE_INVITES`, `KICK_MEMBERS`) remain server-scoped. `VIEW_SERVER` is server membership visibility, not channel visibility; a future channel-view permission needs its own bit. Channel overwrites must not treat the owner as an ordinary role.
