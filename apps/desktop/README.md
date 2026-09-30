# Cubic Desktop Preview shell

This workspace is the **11.9 Desktop Preview foundation**, not a packaged desktop release. Electron main creates one sandboxed BrowserWindow for `https://cubic.goma.ink`. The existing web service, same-origin API proxy, Socket.IO and LiveKit continue to supply the application. A future local renderer can replace the remote load target without changing account sessions or adding a privileged renderer bridge.

## Security boundary

- The remote renderer has `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, `allowRunningInsecureContent: false`, and no webview or preload. There is no IPC or exposed Electron API.
- Main-frame navigation and redirects are limited to the exact Cubic HTTPS origin. External HTTP(S) destinations open in the system browser. Other schemes, malformed URLs and HTTP or alternate-port Cubic URLs are denied. New Electron windows are denied.
- Electron's default persistent Chromium session manages the ordinary Cubic HttpOnly cookie. The shell does not read, log or copy account credentials, and it does not introduce a second login system.
- Permission checks and requests require the current Cubic main frame. Camera/microphone media, speaker selection, sanitized clipboard write and fullscreen are allowed there. Screen capture, notifications, filesystem and all unrelated permissions are denied in this foundation; desktop media integration is later work.
- Certificate errors are not bypassed. The Web CSP and other response headers are not rewritten. DevTools are never opened automatically.

## Account and navigation (11.9.2)

The renderer uses Cubic's existing password login, logout and server-validated Web session. Electron's default persistent Chromium profile keeps the ordinary HttpOnly cookie across window reloads and app restarts; the shell does not access cookies, store passwords or bridge account tokens. Logout revokes the server session and clears the browser cookie through the existing Web/API flow. An expired or invalid session is handled by the Web route guard, which redirects `/app` to `/login` on the same origin. No desktop-specific authentication or session recovery is added.

The same exact-origin policy applies to normal navigation, redirects and new-window requests. Cubic routes such as `/`, `/login`, `/app`, `/verify-email`, `/reset-password` and `/invite` remain internal; external HTTP(S) links open in the system browser; unsafe schemes are denied. The shell keeps the existing single-instance window and normal in-app history. A failed network/TLS load does not downgrade to HTTP or enter a reload loop. Physical Windows testing of password login, persistence, logout, redirects and history is still pending. Passkeys are not yet certified in Electron; the Web page retains its password option and no WebAuthn policy is changed here.

## Development

From the repository root, run `npm ci`, then `npm run check --workspace @cubic/desktop`, `npm test --workspace @cubic/desktop`, and `npm run build --workspace @cubic/desktop`. These run without a GUI. `npm run desktop:dev` launches Electron only on a machine with a GUI and network access to the production Cubic site. This build compiles TypeScript; it does not produce an installer.

## Later Windows x64 smoke

On a Windows test machine, open the shell and verify the production site loads; sign in with a test account; restart and reload the app to verify normal cookie-backed session persistence; navigate internally between landing, login and app; follow an invite/login redirect; use normal back/forward history; open an external HTTP(S) link in the default browser; confirm dangerous schemes and lookalike hosts never replace the Cubic window; launch a second instance and verify it focuses the first; log out and confirm that reopening remains logged out; verify an expired session returns to login without a loop or duplicate window. Passkey providers, native permission prompts, camera/microphone and screen capture need their dedicated later desktop smoke. No Windows GUI or installer was exercised in this slice.
