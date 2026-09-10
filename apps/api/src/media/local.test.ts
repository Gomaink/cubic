import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mediaInternals } from './local.js';

test('detects supported group avatar signatures instead of trusting MIME', () => {
  assert.equal(mediaInternals.detectImage(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])), 'image/png');
  assert.equal(mediaInternals.detectImage(Buffer.from([0xff,0xd8,0xff,0x00])), 'image/jpeg');
  assert.equal(mediaInternals.detectImage(Buffer.from('RIFF0000WEBP')), 'image/webp');
  assert.equal(mediaInternals.detectImage(Buffer.from('<svg></svg>')), null);
});

test('media keys cannot escape the configured storage root', () => {
  assert.equal(mediaInternals.safeKey('123e4567-e89b-12d3-a456-426614174000.webp'), '123e4567-e89b-12d3-a456-426614174000.webp');
  assert.throws(() => mediaInternals.safeKey('../avatar.webp'));
  assert.throws(() => mediaInternals.safeKey('avatar.svg'));
});
