# Cubic v2.0.0-alpha.5 — Voice Core Test Plan

## Authorization
- Unauthenticated users cannot mint LiveKit tokens.
- Non-members cannot mint a token for a conversation.
- A blocked direct conversation cannot mint a voice token.
- Tokens are scoped to exactly one conversation room.
- Tokens permit microphone publishing and subscription, but not camera, screen share, or data.

## Direct voice
- Two members of a DM can join the same voice room.
- Audio works in both directions.
- Mute/unmute is reflected in the participant UI.
- Leave and rejoin work without affecting text messaging.

## Group voice
- Multiple group members can join the same room.
- Participant and active-speaker state updates live.
- Removed members cannot mint new voice tokens.
- If the current user is removed from a group while connected, Cubic leaves that voice room.

## Mobile
- Voice refuses to start from an insecure browser context and explains that HTTPS is required.
- Returning from background keeps the messenger responsive.
- LiveKit reconnect/reconnected state is visible.
- Logout disconnects voice first.

## Voice Core status
The transport slice is validated. Ringing/call lifecycle is implemented in the next alpha.5 increment. Persistent call history, TURN, camera, and screen sharing remain deferred.

## Message history UX

- Opening a conversation renders the latest page and lands at the newest message.
- Reaching the top incrementally loads the previous page using the existing cursor endpoint.
- Prepending older messages preserves the visible scroll position.
- New realtime messages auto-follow only while the reader is already near the latest message.
- While reading history, a jump-to-latest control appears and counts new messages.
- Sending your own message returns the viewport to the latest message.

## Deafen

- Deafen silences attached remote audio and disables the local microphone.
- Undeafen restores the microphone state that existed before deafen.
- New remote tracks subscribed while deafened start muted.
- Leaving/disconnecting resets the local deafen state.

## Final alpha.5 validation

Validated manually on the self-hosted deployment:

- direct voice on two devices with bidirectional audio
- group voice
- mute/unmute
- deafen/undeafen with microphone-state restoration
- leave/rejoin
- switching between DM and group voice
- direct-call accept/decline/cancel/missed/end lifecycle
- secure-context mobile microphone access
- LiveKit reconnect behavior
- message viewport isolation
- open-at-latest history behavior
- cursor-based older-message loading
- anchored prepend without scroll jump
- jump-to-latest/new-message count
- Discord-style unified left-aligned message stream
