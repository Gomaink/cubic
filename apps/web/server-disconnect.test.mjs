import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverAfterServerDisconnect } from './src/lib/realtime/server-disconnect.js';

function response(body, ok = true) {
  return { ok, async json() { return body; } };
}

test('server disconnect reconnects the active socket after authenticated session validation', async () => {
  let connects = 0;
  const socket = { connected: false, connect() { connects += 1; } };
  await recoverAfterServerDisconnect(socket, () => true, {
    fetchSession: async () => response({ authenticated: true })
  });
  assert.equal(connects, 1);
});

test('unauthenticated server disconnect redirects without reconnecting', async () => {
  let connects = 0;
  let destination = null;
  const socket = { connected: false, connect() { connects += 1; } };
  await recoverAfterServerDisconnect(socket, () => true, {
    fetchSession: async () => response({ authenticated: false }),
    redirect: (path) => { destination = path; }
  });
  assert.equal(destination, '/login');
  assert.equal(connects, 0);
});

test('unknown or failed session validation does not reconnect', async () => {
  for (const fetchSession of [
    async () => response({ authenticated: null }),
    async () => response({ authenticated: true }, false),
    async () => { throw new Error('temporary failure'); }
  ]) {
    let connects = 0;
    const socket = { connected: false, connect() { connects += 1; } };
    await recoverAfterServerDisconnect(socket, () => true, { fetchSession });
    assert.equal(connects, 0);
  }
});

test('stale sockets and already-connected sockets are not manually reconnected', async () => {
  let connects = 0;
  const socket = { connected: false, connect() { connects += 1; } };
  await recoverAfterServerDisconnect(socket, () => false, {
    fetchSession: async () => response({ authenticated: true })
  });
  assert.equal(connects, 0);

  socket.connected = true;
  await recoverAfterServerDisconnect(socket, () => true, {
    fetchSession: async () => response({ authenticated: true })
  });
  assert.equal(connects, 0);
});

test('transport disconnects do not invoke server-session recovery', async () => {
  // The component invokes recoverAfterServerDisconnect only for
  // "io server disconnect"; ordinary transport reasons never call it.
  const source = await (await import('node:fs/promises')).readFile(
    new URL('./src/routes/app/+page.svelte', import.meta.url),
    'utf8'
  );
  assert.match(source, /reason === 'io server disconnect'/u);
  assert.doesNotMatch(source, /recoverAfterServerDisconnect\(socket[\s\S]*reason/u);
});
