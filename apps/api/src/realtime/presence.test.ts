import test from 'node:test';
import assert from 'node:assert/strict';
import { PresenceRegistry, type PresenceStatus } from './presence.js';

test('presence aggregates active and idle sockets without redundant transitions', () => {
  const changes: Array<[string, PresenceStatus]> = [];
  const presence = new PresenceRegistry((userId, status) => changes.push([userId, status]));
  assert.equal(presence.status('user'), 'offline');

  presence.register('user', 'desktop');
  presence.register('user', 'phone');
  assert.deepEqual(changes, [['user', 'online']]);

  assert.equal(presence.setActivity('desktop', 'idle'), true);
  assert.equal(presence.status('user'), 'online');
  assert.equal(presence.setActivity('phone', 'idle'), true);
  assert.equal(presence.status('user'), 'idle');
  assert.equal(presence.setActivity('desktop', 'active'), true);
  assert.equal(presence.status('user'), 'online');

  presence.unregister('desktop');
  assert.equal(presence.status('user'), 'idle');
  presence.unregister('phone');
  assert.equal(presence.status('user'), 'offline');
  assert.deepEqual(changes, [
    ['user', 'online'], ['user', 'idle'], ['user', 'online'], ['user', 'idle'], ['user', 'offline']
  ]);
  assert.equal(presence.setActivity('desktop', 'active'), false);
  assert.equal(presence.setActivity('missing', 'idle'), false);
  presence.register('user', 'reconnect');
  assert.equal(presence.status('user'), 'online');
});

test('presence never lets another socket choose a user or arbitrary state', () => {
  const changes: PresenceStatus[] = [];
  const presence = new PresenceRegistry((_userId, status) => changes.push(status));
  presence.register('owner', 'socket');
  assert.equal(presence.setActivity('socket', 'invisible' as never), false);
  assert.equal(presence.status('owner'), 'online');
  assert.equal(presence.status('other'), 'offline');
  assert.deepEqual(changes, ['online']);
});
