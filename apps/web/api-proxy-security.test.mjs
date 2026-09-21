import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('./src/routes/api/[...path]/+server.ts', import.meta.url);

test('fallback API proxy preserves browser security metadata', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  for (const header of ['origin', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest']) {
    assert.match(source, new RegExp(`['"]${header}['"]`));
  }
  assert.match(source, /headers\.set\('x-forwarded-proto', url\.protocol\.slice/);
  assert.match(source, /headers\.set\('x-forwarded-host', url\.host\)/);
  assert.doesNotMatch(source, /request\.headers\.get\(['"]x-forwarded-/);
});
