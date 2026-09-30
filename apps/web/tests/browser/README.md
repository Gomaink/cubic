Run after `npm ci` from `apps/web` so `playwright.config.ts` and the fixture
server use the correct paths:

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/cubic-playwright npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/tmp/cubic-playwright npx playwright test --workers=1
```

The suite runs the production web server on loopback port 3197 with an in-memory
API and Socket.IO fixture on port 3198. Both ports must be free. It does not use
the deployed API, PostgreSQL, real accounts, or persistent media. Test artifacts
are written to `/tmp/cubic-media-browser-results`.

The checked-in configuration uses Chromium for five viewport sizes, including
phone portrait and landscape. Firefox/WebKit require explicitly configured
projects and their browser/system dependencies; do not assume the five default
projects exercise different engines.
These checks do not substitute for physical iPhone/Safari acceptance. Fixture
authentication and message binding are simulated; backend integration is not
covered by this suite.
