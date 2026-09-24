import assert from 'node:assert/strict';
import test from 'node:test';
import {
  firstTrustedServerInviteToken, ServerInvitePreviewQueue, validServerInviteToken
} from './src/lib/server-invite-links.ts';

const origin = 'https://cubic.goma.ink';
const token = 'A'.repeat(43);
const second = 'B'.repeat(43);

test('invite recognition requires one exact trusted origin, path and bearer', () => {
  assert.equal(validServerInviteToken(token), true);
  assert.equal(firstTrustedServerInviteToken(`Join us (${origin}/invite#${token}).`, origin), token);
  for (const body of [
    `https://cubic.goma.ink.evil.example/invite#${token}`,
    `https://evil.example/?x=${origin}/invite#${token}`,
    `http://cubic.goma.ink/invite#${token}`,
    `${origin}/invite/other#${token}`,
    `${origin}/invite?next=here#${token}`,
    `${origin}/invite`,
    `${origin}/invite#not-valid`,
    `${origin}/invite#${'a'.repeat(500)}`,
    `${origin}/%69nvite#${token}`,
    `${origin.replace('://', '://name:password@')}/invite#${token}`,
    'https://example.com'
  ]) assert.equal(firstTrustedServerInviteToken(body, origin), null, body.slice(0, 90));
  assert.equal(firstTrustedServerInviteToken(`${origin}/invite#${token}`, 'http://cubic.goma.ink'), null);
});

test('only the first genuine invite in message order is selected', () => {
  assert.equal(firstTrustedServerInviteToken(
    `https://example.com ${origin}/invite#bad ${origin}/invite#${token} and ${origin}/invite#${second}`,
    origin
  ), token);
  assert.equal(firstTrustedServerInviteToken(`prefix${origin}/invite#${token}`, origin), null);
});

test('preview requests are same-origin, deduplicated and bounded', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (path, init) => {
    calls.push({ path, init });
    return { ok: true, status: 200, json: async () => ({ valid: true, server: { id: 'server', name: 'Safe' } }) };
  };
  const queue = new ServerInvitePreviewQueue();
  try {
    const [first, same] = await Promise.all([queue.preview(token), queue.preview(token)]);
    assert.deepEqual(first, same);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/api/v1/server-invite-links/preview');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].init.body), { token });
    assert.equal(calls[0].init.cache, 'no-store');
    assert.equal(await queue.preview(token), first);
    assert.equal(calls.length, 1);
    for (let index = 0; index < 19; index += 1) await queue.preview(String(index).padStart(43, 'A'));
    assert.deepEqual(await queue.preview(second), { kind: 'deferred' });
    assert.equal(calls.length, 20);
  } finally {
    queue.dispose();
    globalThis.fetch = originalFetch;
  }
});
