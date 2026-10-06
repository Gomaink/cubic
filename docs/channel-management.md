# Channel model and management (Alpha 12.3)

`MANAGE_CHANNELS` is a server permission. A session member with that bit can create, rename, delete and move text channels, voice channels and categories. The owner has the bit only while a member. Every write locks the server row and recalculates membership and server permissions inside the same transaction. An unknown permission mask or database error fails the operation. Resource IDs and category IDs must belong to the selected server. A member without the bit receives 403; a nonmember or foreign resource receives 404.

`GET /servers/:serverId/channel-management` returns `canManageChannels` and administrative metadata for text channels, voice channels and categories. It may include channels hidden from the manager by `VIEW_CHANNEL` overrides. It never includes messages or attachments. Ordinary channel lists and content routes continue to enforce `VIEW_CHANNEL`; management does not imply reading, posting or joining voice.

Text rename retains the conversation and history. Text delete removes the server channel mapping before its `server_text` conversation in one transaction. Existing cascades remove messages, reactions and attachment rows; the attachment deletion trigger creates durable file deletion jobs. After commit, sockets in the deleted conversation room receive `conversation:removed` and leave the room. Members receive only `server:layout:changed` with `serverId`, then reload their filtered lists. No channel ID is sent in that generic event.

Voice delete removes the channel and compacts its layout in one transaction. New tickets fail because the row is gone. After commit the voice service evicts participants; if that immediate step fails, the API returns success with `voiceRevocationPending: true`. Periodic voice reconciliation evicts participants from deleted rooms when the control plane recovers. Layout events are emitted only after committed writes.

This slice has no schema migration. Channel override editing, category permission inheritance, duplicate, copy link, favorites, pin, mute, notification overrides, topic and slowmode remain outside this boundary.
