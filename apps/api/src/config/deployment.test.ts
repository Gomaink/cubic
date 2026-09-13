import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryRoot = new URL('../../../../', import.meta.url);

test('default Compose requires private deployment credentials', async () => {
  const [compose, environmentExample] = await Promise.all([
    readFile(new URL('docker-compose.yml', repositoryRoot), 'utf8'),
    readFile(new URL('.env.example', repositoryRoot), 'utf8')
  ]);

  assert.match(compose, /\$\{POSTGRES_PASSWORD:\?/);
  assert.match(compose, /\$\{LIVEKIT_API_KEY:\?/);
  assert.match(compose, /\$\{LIVEKIT_API_SECRET:\?/);
  assert.match(compose, /\$\{SESSION_COOKIE_SECURE:\?/);
  assert.match(compose, /\$\{TRUST_PROXY_CIDRS:\?/);
  assert.doesNotMatch(compose, /POSTGRES_PASSWORD:-/);
  assert.doesNotMatch(compose, /LIVEKIT_API_KEY:-/);
  assert.doesNotMatch(compose, /LIVEKIT_API_SECRET:-/);
  assert.match(environmentExample, /^POSTGRES_PASSWORD=$/m);
  assert.match(environmentExample, /^LIVEKIT_API_KEY=$/m);
  assert.match(environmentExample, /^LIVEKIT_API_SECRET=$/m);
  assert.match(environmentExample, /^TRUST_PROXY_CIDRS=$/m);
  assert.doesNotMatch(`${compose}\n${environmentExample}`, /TRUST_PROXY_HOPS/);
  assert.match(compose, /web:[\s\S]*TRUST_PROXY_CIDRS: \$\{TRUST_PROXY_CIDRS:\?/);
  for (const setting of [
    'ATTACHMENT_PENDING_MAX_COUNT',
    'ATTACHMENT_PENDING_MAX_BYTES',
    'ATTACHMENT_MIN_FREE_BYTES',
    'ATTACHMENT_UPLOAD_RATE_LIMIT_MAX',
    'ATTACHMENT_UPLOAD_RATE_LIMIT_WINDOW_MS',
    'ATTACHMENT_CLEANUP_INTERVAL_MS',
    'ATTACHMENT_STALE_AGE_MS',
    'ATTACHMENT_CLEANUP_BATCH_SIZE'
  ]) {
    assert.match(compose, new RegExp(`${setting}: \\$\\{${setting}:-[0-9]+\\}`));
    assert.match(environmentExample, new RegExp(`^${setting}=[0-9]+$`, 'm'));
  }
  assert.doesNotMatch(
    `${compose}\n${environmentExample}`,
    /cubic-dev-password|CUBICDEVKEY|cubic-development-secret-change-me/
  );
});

test('Compose pins the audited LiveKit release', async () => {
  const compose = await readFile(new URL('docker-compose.yml', repositoryRoot), 'utf8');

  assert.match(compose, /image: livekit\/livekit-server:v1\.13\.6/);
  assert.doesNotMatch(compose, /livekit\/livekit-server:v1\.13\.5/);
});

test('plain HTTP mode is isolated to the development override', async () => {
  const [compose, developmentCompose] = await Promise.all([
    readFile(new URL('docker-compose.yml', repositoryRoot), 'utf8'),
    readFile(new URL('docker-compose.dev.yml', repositoryRoot), 'utf8')
  ]);

  assert.match(compose, /NODE_ENV: production/);
  assert.match(developmentCompose, /NODE_ENV: development/);
});
