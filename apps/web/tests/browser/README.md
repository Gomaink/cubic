Run from the repository root after `npm ci`:

```sh
npx playwright install chromium
npm run build
npm run test:browser --workspace @cubic/web
```

The suite runs the production web server on loopback port 3197 with an in-memory
API and Socket.IO fixture on port 3198. Both ports must be free. It does not use
the deployed API, PostgreSQL, real accounts, or persistent media. Test artifacts
are written to `/tmp/cubic-media-browser-results`.

Chromium checks five viewport sizes, including phone portrait and landscape.
These checks do not substitute for physical iPhone/Safari acceptance. Fixture
authentication and message binding are simulated; backend integration is not
covered by this suite.
