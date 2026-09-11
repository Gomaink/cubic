# Cubic v2.0.0-alpha.6 — Device, Quality and Media UX Test Plan

## Media devices

1. Voice & Video settings opens from the call dock and media stage.
2. Microphones, cameras and audio outputs are listed without forcing a new permission prompt.
3. Switching microphone while connected changes the active input without leaving the room.
4. Switching camera while connected changes the active camera without leaving the room.
5. Output-device selection works where the browser implements `setSinkId`.
6. Browsers without output-device selection show a disabled browser-default control instead of failing.
7. Device removal/connection refreshes the list while settings is open.
8. Selected devices are saved in local storage for this browser.

## Camera quality

1. Data saver publishes 640×360 at up to 24 fps / 600 kbps.
2. Balanced publishes 1280×720 at up to 30 fps / 1.5 Mbps.
3. High publishes 1920×1080 at up to 30 fps / 3.5 Mbps.
4. Changing quality while camera is active republishes only the camera track.
5. Changing quality while camera is off does not unexpectedly turn the camera on.
6. Camera errors remain non-fatal to the call.
7. The selected preset persists after reload.

## Screen-share quality

1. Text mode requests 1080p / 15 fps with detail/text content hint and 2.5 Mbps ceiling.
2. Balanced requests 1080p / 30 fps with 4.5 Mbps ceiling.
3. Motion requests 720p / 30 fps with motion content hint and 3 Mbps ceiling.
4. A changed preset while already sharing applies to the next share instead of reopening the browser picker.
5. Shared audio remains requested and browser support remains optional.
6. The selected preset persists after reload.

## Bandwidth adaptation

1. New LiveKit rooms enable Adaptive Stream.
2. New LiveKit rooms enable Dynacast.
3. Camera uses simulcast and maintain-framerate degradation.
4. Text/Balanced screen share prioritizes resolution.
5. Motion screen share uses balanced degradation.

## UI / Onyx polish

1. Pure voice calls do not reserve a large empty video stage.
2. The media stage appears when at least one camera or screen share is active.
3. While the media stage is visible, participant duplication is removed from the floating dock.
4. The floating dock remains focused on call controls.
5. Voice & Video settings stays inside the viewport at desktop zoom and on mobile.
6. Presentation mode, filmstrip, fullscreen and Return to grid remain functional.

## Regression

- direct-call ringing, accept, decline, cancel, missed and end
- group voice
- mute / unmute
- deafen / undeafen
- camera on/off
- screen share / stop share / browser-native stop
- multiple simultaneous screen shares
- call persistence/history
- message history paging and jump-to-latest
- low-height / high-zoom call-stage layout
- Firefox and no-camera error handling
