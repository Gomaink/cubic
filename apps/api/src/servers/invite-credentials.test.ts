import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { InviteCredentials, parseInviteCredentials } from './invite-credentials.js';

test('invite credentials use scoped HMAC, strict format, and retained keys', () => {
  const first = randomBytes(32).toString('base64url');
  const second = randomBytes(32).toString('base64url');
  const id = randomUUID();
  const old = new InviteCredentials('one', { one: first });
  const oldToken = old.issue(id);
  assert.equal(old.verify(oldToken), id);
  assert.equal(old.verify(oldToken.replace(/.$/, oldToken.endsWith('a') ? 'b' : 'a')), null);
  assert.equal(old.verify(oldToken.replace('v2.one.', 'v2.unknown.')), null);
  assert.equal(old.verify(oldToken.replace(id, randomUUID())), null);
  assert.equal(old.verify('v2.one.' + id + '.bad'), null);
  const rotated = new InviteCredentials('two', { one: first, two: second });
  assert.equal(rotated.verify(oldToken), id);
  assert.equal(rotated.verify(rotated.issue(id)), id);
  assert.notEqual(rotated.issue(id), oldToken);
  assert.equal(parseInviteCredentials('two', JSON.stringify({ one: first, two: second }))?.verify(oldToken), id);
  assert.throws(() => new InviteCredentials('one', { one: 'too-short' }), /Invalid invite link HMAC key configuration/);
  assert.throws(() => parseInviteCredentials('one', '{'), /Invalid invite link HMAC key configuration/);
  assert.equal(parseInviteCredentials(undefined, undefined), null);
});
