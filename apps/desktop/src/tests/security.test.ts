import assert from 'node:assert/strict';
import test from 'node:test';
import { allowsPermission, classifyNavigation } from '../security.js';

test('navigation uses exact HTTPS origin and blocks unsafe schemes', () => {
  for (const url of ['https://cubic.goma.ink', 'https://cubic.goma.ink/app']) {
    assert.equal(classifyNavigation(url), 'internal', url);
  }
  for (const url of [
    'https://github.com/', 'https://evil.example/?next=https://cubic.goma.ink',
    'https://cubic.goma.ink.evil.example/'
  ]) {
    assert.equal(classifyNavigation(url), 'external', url);
  }
  for (const url of [
    'http://cubic.goma.ink',
    'https://cubic.goma.ink:444/', 'https://user:pass@cubic.goma.ink/',
    'javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/test',
    'cubic://app', '/app', 'not a URL'
  ]) {
    assert.equal(classifyNavigation(url), 'blocked', url);
  }
});

test('permissions require the main Cubic frame and a small capability set', () => {
  const origin = 'https://cubic.goma.ink/app';
  assert.equal(allowsPermission('media', origin, true, ['audio']), true);
  assert.equal(allowsPermission('media', origin, true, ['video']), true);
  assert.equal(allowsPermission('media', origin, true, ['audio', 'video']), true);
  assert.equal(allowsPermission('media', origin, true, undefined), false);
  assert.equal(allowsPermission('media', origin, true, ['unknown']), false);
  assert.equal(allowsPermission('media', origin, true, ['screen']), false);
  assert.equal(allowsPermission('media', origin, true, []), false);
  for (const permission of ['speaker-selection', 'clipboard-sanitized-write', 'fullscreen']) {
    assert.equal(allowsPermission(permission, origin, true), true, permission);
  }
  for (const permission of ['display-capture', 'notifications', 'openExternal', 'fileSystem', 'geolocation']) {
    assert.equal(allowsPermission(permission, origin, true), false, permission);
  }
  assert.equal(allowsPermission('media', origin, false, ['audio']), false);
  assert.equal(allowsPermission('media', 'https://evil.example/', true, ['audio']), false);
});
