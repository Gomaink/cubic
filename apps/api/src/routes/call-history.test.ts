import assert from 'node:assert/strict';
import test from 'node:test';
import { callDurationSeconds } from './call-history.js';

test('call history duration starts at answer time', () => {
  assert.equal(
    callDurationSeconds(
      new Date('2026-09-10T20:00:10.000Z'),
      new Date('2026-09-10T20:01:15.900Z')
    ),
    65
  );
});

test('unanswered calls do not report a talk duration', () => {
  assert.equal(callDurationSeconds(null, new Date('2026-09-10T20:00:45.000Z')), null);
});
