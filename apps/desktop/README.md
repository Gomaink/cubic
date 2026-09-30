# Cubic Desktop Preview shell

This workspace is the **11.9.1 foundation**, not a packaged desktop release. Electron main creates one sandboxed BrowserWindow for `https://cubic.goma.ink`. The existing web service, same-origin API proxy, Socket.IO and LiveKit continue to supply the application. A future local renderer can replace the remote load target without changing account sessions or adding a privileged renderer bridge.

## Security boundary

- The remote renderer has `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, `allowRunningInsecureContent: false`, and no webview or preload. There is no IPC or exposed Electron API.
- Main-frame navigation and redirects are limited to the exact Cubic HTTPS origin. External HTTP(S) destinations open in the system browser. Other schemes, malformed URLs and HTTP or alternate-port Cubic URLs are denied. New Electron windows are denied.
- Electron's default persistent Chromium session manages the ordinary Cubic HttpOnly cookie. The shell does not read, log or copy account credentials, and it does not introduce a second login system.
- Permission checks and requests require the current Cubic main frame. Camera/microphone media, speaker selection, sanitized clipboard write and fullscreen are allowed there. Screen capture, notifications, filesystem and all unrelated permissions are denied in this foundation; desktop media integration is later work.
- Certificate errors are not bypassed. The Web CSP and other response headers are not rewritten. DevTools are never opened automatically.

## Development

From the repository root, run `npm ci`, then `npm run check --workspace @cubic/desktop`, `npm test --workspace @cubic/desktop`, and `npm run build --workspace @cubic/desktop`. These run without a GUI. `npm run desktop:dev` launches Electron only on a machine with a GUI and network access to the production Cubic site. This build compiles TypeScript; it does not produce an installer.

## Later Windows x64 smoke

On a Windows test machine, open the shell and verify the production site loads; sign in with a test account; restart the app and verify normal cookie-backed session persistence; navigate internally; open an external HTTP(S) link in the default browser; confirm dangerous schemes and lookalike hosts never replace the Cubic window; log out; close and reopen the window. Passkey providers, native permission prompts, camera/microphone and screen capture need their dedicated later desktop smoke. No Windows GUI or installer was exercised in this slice.
