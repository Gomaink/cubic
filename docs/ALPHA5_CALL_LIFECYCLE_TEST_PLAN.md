# Cubic v2.0.0-alpha.5 — Ringing / Call Lifecycle Test Plan

## Direct calls

1. Open a DM on device A and tap the phone icon.
2. Device A shows `Calling…`; device B shows an incoming-call card without a reload.
3. Accept on B. Only the initiating caller socket and accepting callee socket auto-join LiveKit.
4. Both clients transition through connecting to the normal in-call voice dock.
5. Audio works in both directions.
6. Mute/unmute continues to work after the ringing lifecycle.
7. Leaving the connected direct call emits `call:end` and disconnects both clients from that call.
8. A declined call disappears on both clients and never joins LiveKit.
9. Caller cancellation disappears on both clients and never joins LiveKit.
10. An unanswered call expires after 45 seconds and shows `No answer`.

## Busy / authorization

1. A user already in a direct call cannot start another direct call.
2. A user already targeted by a ringing/accepted direct call cannot receive another direct call.
3. Calls can only be started from a valid direct conversation containing the authenticated user.
4. Active blocks still prevent voice calls.
5. Only the recipient can accept/decline.
6. Only the caller can cancel while ringing.
7. Either participant can end an accepted call.

## Multi-device / reconnect

1. Incoming ringing state reaches every authenticated device for the recipient.
2. Accepting on one recipient device does not automatically publish microphones from the recipient's other devices.
3. A Socket.IO reconnect requests the current call state with `call:sync`.
4. An accepted call restored after reconnect offers `Rejoin` instead of silently opening a second microphone.
5. Text realtime remains functional before, during and after calls.

## Group voice regression

1. Group voice remains Discord-like: members join the room directly instead of ringing every member.
2. Switching from a direct call to a group voice room ends the direct call first.
3. Switching from group voice to an incoming direct call leaves the group voice room before joining the direct call.
4. Group participants, active speaker, mute/unmute and leave/rejoin still work.

## Layout / Onyx UI

1. Desktop document itself does not scroll while `/app` is open.
2. Chat header and composer remain fixed while only `.messages` scrolls.
3. Conversation list scrolls independently.
4. Mobile uses one `100dvh` messenger viewport and preserves the existing back-navigation behavior.
5. Phone, group voice, group settings, send, navigation and logout controls use icon-led controls with accessible labels/tooltips.
6. Incoming/outgoing call cards remain usable at narrow mobile widths.
