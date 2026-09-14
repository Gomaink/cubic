import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('SvelteKit enforces the approved CSP without broad source allowances', async () => {
  process.env.LIVEKIT_PUBLIC_URL = 'wss://livekit.example:7443';
  const { default: config } = await import(`./svelte.config.js?test=${Date.now()}`);
  const csp = config.kit.csp;
  assert.equal(csp.mode, 'nonce');
  assert.deepEqual(csp.directives, {
    'default-src': ['none'],
    'script-src': ['self'],
    'script-src-attr': ['none'],
    'style-src': ['self'],
    'style-src-attr': ['none'],
    'img-src': ['self', 'https:'],
    'connect-src': ['self', 'wss://livekit.example:7443'],
    'media-src': ['self'],
    'worker-src': ['self'],
    'font-src': ['self'],
    'object-src': ['none'],
    'frame-src': ['none'],
    'frame-ancestors': ['none'],
    'base-uri': ['none'],
    'form-action': ['self'],
    'manifest-src': ['self'],
    'report-uri': ['/api/v1/security/csp-report']
  });
  assert.equal(Object.hasOwn(csp, 'reportOnly'), false);
  const serialized = JSON.stringify(csp);
  for (const forbidden of ['unsafe-eval', 'unsafe-inline', 'blob:', 'data:', 'ws:', 'https:/*']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('web response headers have one application owner and no inline app styles remain', async () => {
  const hooks = await readFile(new URL('./src/hooks.server.ts', import.meta.url), 'utf8');
  for (const header of ['referrer-policy', 'x-frame-options', 'x-content-type-options']) {
    assert.match(hooks, new RegExp(`headers\\.set\\(['"]${header}['"]`));
  }

  const sources = await Promise.all([
    './src/app.html',
    './src/routes/app/+page.svelte',
    './src/lib/ui/MessageAttachments.svelte'
  ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')));
  for (const source of sources) {
    assert.doesNotMatch(source, /\sstyle(?::[^=\s]+)?=/u);
  }
});

test('invalid LiveKit CSP origins fail configuration', async () => {
  process.env.LIVEKIT_PUBLIC_URL = 'wss://livekit.example/path';
  await assert.rejects(
    import(`./svelte.config.js?invalid=${Date.now()}`),
    /one exact ws:\/\/ or wss:\/\/ origin/
  );
});
