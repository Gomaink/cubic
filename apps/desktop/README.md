# Cubic Desktop Preview shell

This workspace is the **11.9 Desktop Preview foundation**, not a packaged desktop release. Electron main creates one sandboxed BrowserWindow for `https://cubic.goma.ink`. The existing web service, same-origin API proxy, Socket.IO and LiveKit continue to supply the application. A future local renderer can replace the remote load target without changing account sessions or adding a privileged renderer bridge.

## Security boundary

- The remote renderer has `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, `allowRunningInsecureContent: false`, and no webview or preload. There is no IPC or exposed Electron API.
- Main-frame navigation and redirects are limited to the exact Cubic HTTPS origin. External HTTP(S) destinations open in the system browser. Other schemes, malformed URLs and HTTP or alternate-port Cubic URLs are denied. New Electron windows are denied.
- Electron's default persistent Chromium session manages the ordinary Cubic HttpOnly cookie. The shell does not read, log or copy account credentials, and it does not introduce a second login system.
- Permission checks and requests require the current Cubic main frame. Explicit camera/microphone media types, speaker selection, sanitized clipboard write and fullscreen are eligible there. Display capture has a separate exact-origin policy and requires explicit source selection. Notifications, filesystem and unrelated permissions remain denied.
- Certificate errors are not bypassed. The Web CSP and other response headers are not rewritten. DevTools are never opened automatically.

## Account and navigation (11.9.2)

The renderer uses Cubic's existing password login, logout and server-validated Web session. Electron's default persistent Chromium profile keeps the ordinary HttpOnly cookie across window reloads and app restarts; the shell does not access cookies, store passwords or bridge account tokens. Logout revokes the server session and clears the browser cookie through the existing Web/API flow. An expired or invalid session is handled by the Web route guard, which redirects `/app` to `/login` on the same origin. No desktop-specific authentication or session recovery is added.

The same exact-origin policy applies to normal navigation, redirects and new-window requests. Cubic routes such as `/`, `/login`, `/app`, `/verify-email`, `/reset-password` and `/invite` remain internal; external HTTP(S) links open in the system browser; unsafe schemes are denied. The shell keeps the existing single-instance window and normal in-app history. A failed network/TLS load does not downgrade to HTTP or enter a reload loop. Physical Windows testing of password login, persistence, logout, redirects and history is still pending. Passkeys are not yet certified in Electron; the Web page retains its password option and no WebAuthn policy is changed here.

## Media compatibility (11.9.3)

**Implemented policy:** Electron permission checks and requests allow `media` only for the Cubic main frame at the exact HTTPS origin and only when the requested types are explicitly `audio`, `video`, or both. Missing, empty, unknown, and screen types are denied. The existing `speaker-selection` permission remains origin- and main-frame-bound; output selection also depends on Chromium exposing `setSinkId` and the OS device. The remote renderer receives no device or capture API from Electron. The existing Web/LiveKit media flow is unchanged.

**Electron 44.5.1 API audit:** `setDevicePermissionHandler` applies to HID, serial and USB devices; it is not needed for microphone, camera or speaker selection. `setDisplayMediaRequestHandler` requires the application to provide a capture source. Its `useSystemPicker` option is experimental and documented for macOS 15+ only, so the Windows x64 preview uses a native Electron Menu in the main process. `desktopCapturer.getSources` enumerates screens and windows without thumbnails or icons. The menu shows names locally; only an explicitly selected source is returned to Electron. No source list, source ID, `desktopCapturer`, preload or IPC is exposed to the remote page. Closing or cancelling the menu, stale frames, source enumeration errors and concurrent requests deny capture. The callback is settled at most once.

**Screen audio:** The Web preflight currently starts with “Request shared audio” checked, so Electron's `audioRequested` flag alone does not prove the user deliberately opted in. This slice grants video only; it never requests Windows `loopback` or substitutes microphone audio. The existing Web notice reports when requested shared audio is unavailable. A separately reviewed explicit audio opt-in contract is needed before enabling system audio.

**Validated here:** pure policy tests cover explicit mic/camera types, denied missing/unknown types, exact origin, subframes, output permission, display permission and display-request eligibility. TypeScript compilation and tests need no GUI. **Still requires physical Windows smoke:** OS permission prompts, mic/camera capture, voice/video join and reconnect, output-device selection, native screen/window menu selection, cancellation, repeat capture and stop. These tests do not claim working hardware capture or screen audio.

## Development

From the repository root, run `npm ci`, then `npm run check --workspace @cubic/desktop`, `npm test --workspace @cubic/desktop`, and `npm run build --workspace @cubic/desktop`. These run without a GUI. `npm run desktop:dev` launches Electron only on a machine with a GUI and network access to the production Cubic site. This build compiles TypeScript; it does not produce an installer.

## Later Windows x64 smoke

On a Windows test machine, open the shell and verify the production site loads; sign in with a test account; restart and reload the app to verify normal cookie-backed session persistence; navigate internally between landing, login and app; follow an invite/login redirect; use normal back/forward history; open an external HTTP(S) link in the default browser; confirm dangerous schemes and lookalike hosts never replace the Cubic window; launch a second instance and verify it focuses the first; log out and confirm that reopening remains logged out; verify an expired session returns to login without a loop or duplicate window. With test accounts, then exercise microphone, camera, voice/video, output selection and reconnect using real hardware. Start Go Live and confirm no source is preselected; choose a Window and then a Screen, verify the correct stream and stop each; cancel the menu and confirm no capture; repeat and try a second request while the picker is open; confirm audio OFF never captures system audio and audio ON currently remains video-only; check microphone stays independent and an external origin cannot capture. Passkey providers need separate smoke. No Windows GUI or installer was exercised in this slice.
