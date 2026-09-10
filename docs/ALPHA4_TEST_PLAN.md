# Cubic v2.0.0-alpha.4 — Test Plan

## Groups

1. Owner can create a group and founding members are added immediately.
2. Group messages use the same persistent conversation engine as DMs.
3. Messages arrive in realtime on all connected member devices.
4. Opening the same group does not create duplicate conversations.

## Roles and permissions

1. Creator starts as `owner`.
2. Owner can promote `member -> admin`.
3. Owner can demote `admin -> member`.
4. Owner can transfer ownership.
5. Previous owner becomes admin after ownership transfer.
6. Admin can rename the group and manage regular members.
7. Admin cannot transfer ownership, remove the owner or delete the group.
8. Member cannot access administrative controls.
9. Owner cannot leave while other members remain unless ownership is transferred first.
10. Group deletion is owner-only.

## Invitations

1. Owner/admin can invite an eligible friend.
2. Invite appears on the invitee device without reload.
3. Accept creates membership and joins realtime delivery immediately.
4. Decline records `declined` and does not create membership.
5. Cancel records `cancelled` and removes the pending invite from the invitee UI.
6. Re-invite after decline/cancel returns the invite to `pending`.
7. A group/member pair cannot accumulate duplicate invite rows.

## Group avatars / media

1. Owner/admin can upload PNG, JPEG or WebP.
2. Upload is signature-validated by the API.
3. File size limit is enforced.
4. Avatar bytes are stored in `/data/media/group-avatars`.
5. PostgreSQL stores only `avatar_key`.
6. Replacing an avatar removes the old file.
7. Removing an avatar clears `avatar_key` and deletes the file.
8. Avatar changes propagate to other connected clients.
9. The API can write to the persistent media volume as the non-root runtime user.
10. `/api/*` uses direct streaming proxying to Fastify in production.

## Mobile / iOS regression

1. Photo picker returns to the app without freezing the UI.
2. Avatar upload errors are shown inside the group panel.
3. Returning from another app keeps realtime and touch interaction responsive.
4. Landing/login/register remain scrollable.
5. Messenger viewport remains isolated from global page scrolling.

## Persistence / concurrency

1. Membership and ownership mutations are serialized per group.
2. Failed mutations roll back without leaving partial role/membership state.
3. `group_invites`, `conversation_members` and `conversations.avatar_key` remain consistent after restart.
4. Docker recreation preserves PostgreSQL and media volume data.
