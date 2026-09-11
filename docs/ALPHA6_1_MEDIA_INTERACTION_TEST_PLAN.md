# Cubic v2.0.0-alpha.6.1 — Media interaction test plan

## Camera preflight
1. Join a call with camera off.
2. Click Camera. Camera must not start immediately.
3. Choose 720p/1080p and 24/30/60 FPS.
4. Start camera and verify the selected capture profile.
5. Stop/start again and verify the last selection is restored.

## Screen-share preflight
1. Click Share with no active local share.
2. The browser picker must not open yet.
3. Choose 720p/1080p and 15/30/60 FPS.
4. Leave Request shared audio enabled.
5. Click Go Live. Only now should the native browser picker open.
6. Last resolution/FPS/audio-request choices should persist.

## Shared audio
1. Chromium/Brave: choose a source whose picker offers audio and enable Share audio.
2. Remote user should receive ScreenShareAudio independently from microphone audio.
3. If no ScreenShareAudio track is published, the stream must continue with a non-fatal notice.
4. Zen/Firefox-like browsers without display-audio support must still share video normally.

## Per-stream volume
1. Right-click a remote screen-share tile.
2. Context menu shows the sender and a 0–100% slider.
3. Set 25%; only stream audio gets quieter.
4. Sender microphone volume must not change.
5. Set 0% or Mute stream.
6. Reopen/reload/rejoin and verify the value persists for that participant.
7. Share without audio shows the slider disabled and explains why.

## Regression
- voice mute/deafen
- camera/video
- screen share and multiple shares
- presentation focus/fullscreen
- direct-call lifecycle/history
- Firefox missing-media handling
- message history/layout
