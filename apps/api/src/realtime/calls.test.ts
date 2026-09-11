import assert from 'node:assert/strict';
import test from 'node:test';
import { CallLifecycleError, DirectCallCoordinator } from './calls.js';

function coordinator() {
  let index = 0;
  let nowMs = Date.parse('2026-09-10T20:00:00.000Z');
  return new DirectCallCoordinator(
    () => `00000000-0000-4000-8000-${String(++index).padStart(12, '0')}`,
    () => new Date(nowMs += 1000)
  );
}

function start(manager: DirectCallCoordinator, overrides: Partial<Parameters<DirectCallCoordinator['start']>[0]> = {}) {
  return manager.start({
    conversationId: '11111111-1111-4111-8111-111111111111',
    callerId: '22222222-2222-4222-8222-222222222222',
    calleeId: '33333333-3333-4333-8333-333333333333',
    callerDisplayName: 'Samuel',
    callerUsername: 'gomaink',
    callerSocketId: 'socket-a',
    ...overrides
  });
}

test('direct call moves from ringing to accepted and then ended', () => {
  const manager = coordinator();
  const call = start(manager);

  assert.equal(call.state, 'ringing');
  assert.equal(manager.getForUser(call.callerId)?.id, call.id);
  assert.equal(manager.getForUser(call.calleeId)?.id, call.id);

  const accepted = manager.accept(call.id, call.calleeId, 'socket-b');
  assert.equal(accepted.state, 'accepted');
  assert.equal(accepted.acceptedSocketId, 'socket-b');
  assert.ok(accepted.acceptedAt);

  const ended = manager.end(call.id, call.callerId);
  assert.equal(ended.state, 'ended');
  assert.equal(manager.get(call.id), null);
  assert.equal(manager.getForUser(call.calleeId), null);
});

test('recipient can decline and caller can cancel a ringing call', () => {
  const first = coordinator();
  const declined = first.decline(start(first).id, '33333333-3333-4333-8333-333333333333');
  assert.equal(declined.state, 'declined');

  const second = coordinator();
  const active = start(second);
  const cancelled = second.cancel(active.id, active.callerId);
  assert.equal(cancelled.state, 'cancelled');
});

test('ringing call expires as missed', () => {
  const manager = coordinator();
  const call = start(manager);
  assert.equal(manager.expire(call.id)?.state, 'missed');
  assert.equal(manager.get(call.id), null);
});

test('one user cannot participate in two simultaneous calls', () => {
  const manager = coordinator();
  start(manager);

  assert.throws(
    () => start(manager, {
      conversationId: '44444444-4444-4444-8444-444444444444',
      calleeId: '55555555-5555-4555-8555-555555555555'
    }),
    (error: unknown) => error instanceof CallLifecycleError && error.code === 'busy'
  );
});

test('only the recipient can accept and only the caller can cancel', () => {
  const manager = coordinator();
  const call = start(manager);

  assert.throws(
    () => manager.accept(call.id, call.callerId, 'socket-c'),
    (error: unknown) => error instanceof CallLifecycleError && error.code === 'forbidden'
  );
  assert.throws(
    () => manager.cancel(call.id, call.calleeId),
    (error: unknown) => error instanceof CallLifecycleError && error.code === 'forbidden'
  );
});
