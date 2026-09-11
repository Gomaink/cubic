# Cubic v2.0.0-alpha.6 — Screen Share + Presentation UX Test Plan

## Grants and browser policy

1. LiveKit tokens allow microphone, camera, screen-share video and screen-share audio.
2. Publishing remains scoped to the authenticated conversation room.
3. `Permissions-Policy` includes `display-capture=(self)` for Cubic.
4. Screen sharing is started only by a user click/transient activation.

## Local screen sharing

1. Join an existing DM or group call.
2. Share button is enabled only where `getDisplayMedia()` exists.
3. Clicking Share opens the browser screen/window/tab picker.
4. Cancelling the picker keeps the call connected and shows a friendly message.
5. Starting a share automatically focuses the shared surface.
6. Camera may remain active while sharing.
7. Supported browsers can publish shared tab/system audio when the selected source exposes it.
8. Clicking Stop share unpublishes the screen without ending voice/camera.
9. Using the browser's own Stop sharing control updates Cubic automatically.
10. Leaving the call always stops a local screen share.

## Remote presentation

1. A remote screen-share publication appears without reload.
2. A new share enters presentation focus automatically unless the user explicitly returned to grid.
3. Presentation mode shows the shared surface as the main canvas and participants in a filmstrip.
4. Return to grid keeps the share active as a normal tile.
5. Clicking a share tile focuses it again.
6. Fullscreen works on the entire media stage where the browser supports it.
7. Multiple simultaneous screen shares remain individually selectable.
8. Screen share uses `object-fit: contain`; desktop content is not cropped.

## Mobile

1. Mobile browsers can receive/watch remote screen shares.
2. The Share control is disabled when the browser lacks `getDisplayMedia()`.
3. Receiving a share does not force native fullscreen.
4. Presentation mode remains inside the `100dvh` messenger layout.

## Regression

- camera on/off
- participant video grid/focus
- voice mute/unmute
- deafen/undeafen
- DM ring/accept/decline/cancel/missed/end
- group voice
- message history paging/jump-to-latest
- call persistence
- Firefox/no-device media failure handling
- call-stage message-count/layout hotfix
