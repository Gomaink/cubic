# Cubic v2.0.0-alpha.6 — Video Core Test Plan

## Authorization

1. Existing voice-token authorization remains server-authoritative and membership-scoped.
2. LiveKit grants permit microphone and camera publication.
3. Screen-share publication remains unavailable in this slice.
4. The LiveKit API secret never reaches the browser.

## Camera

1. Join a direct or group call with camera initially disabled.
2. Camera toggle requests browser permission on first enable.
3. Local preview appears immediately after permission is granted.
4. Local preview is mirrored, but transmitted video is not altered.
5. Remote participants receive camera video without page reload.
6. Turning camera off removes the live preview and restores the participant placeholder.
7. Leaving the room stops camera capture.
8. Rejoining starts with camera off.
9. Deafen does not disable camera.
10. Camera failures are surfaced in the existing voice error UI.

## Participant grid

1. One participant fills the available video stage.
2. Two participants render side-by-side on desktop.
3. Three or more participants use a responsive grid.
4. Mobile uses a single-column layout when space is constrained.
5. Camera-off participants show an avatar/initial placeholder.
6. Active speaker is visually indicated.
7. Clicking a tile focuses it; clicking again restores the grid.
8. Fullscreen control opens the video stage when browser support is available.
9. Switching to another chat hides the current video stage without leaving the room.
10. Returning to the call conversation restores the grid.

## Regression

- Direct-call ringing / accept / decline / cancel / missed / end.
- Group voice direct join.
- Mute / unmute.
- Deafen / undeafen with previous microphone-state restoration.
- Incremental message history and jump-to-latest.
- Discord-style left-aligned message stream.
- Call persistence/history.
- iOS background/resume and `playsinline`.
- Group settings/invites.

## Out of scope for this slice

Screen sharing, presentation focus mode, device selection, manual resolution/bitrate
selection, background blur and picture-in-picture are deferred to later alpha.6 slices.

## Browser/device failure handling

1. A browser that blocks microphone access still joins the room muted instead of being disconnected.
2. Retrying Unmute surfaces a human-readable permission/device error.
3. A machine with no camera reports `No camera was found on this device.` and remains in the call.
4. Camera permission denied/busy states do not terminate the LiveKit room.

## Call-stage layout regression

1. Video stage remains visible regardless of message count.
2. Adding enough messages to exceed the viewport only scrolls `.messages`.
3. Header, video stage and composer never get pushed outside the chat panel.
4. The same call remains usable in short browser windows and at browser zoom > 100%.
5. Mobile continues to fit inside the messenger `100dvh` viewport.
