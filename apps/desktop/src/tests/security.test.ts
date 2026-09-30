import assert from 'node:assert/strict';
import test from 'node:test';
import { allowsDisplayCapture, allowsDisplayRequest, allowsPermission, classifyNavigation } from '../security.js';

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

test('account routes and their same-origin redirects stay in the Cubic window', () => {
  const routes = [
    '/', '/login', '/app', '/verify-email', '/reset-password', '/invite',
    '/forgot-password', '/register'
  ];
  for (const route of routes) {
    assert.equal(classifyNavigation(new URL(route, 'https://cubic.goma.ink').href), 'internal', route);
  }
  for (const target of [
    'https://cubic.goma.ink/login?returnTo=invite',
    'https://cubic.goma.ink/invite#invitation',
    'https://cubic.goma.ink/app'
  ]) {
    // will-frame-navigate and will-redirect use this same classifier.
    assert.equal(classifyNavigation(target), 'internal', target);
  }
  assert.equal(classifyNavigation('https://github.com/'), 'external');
  assert.notEqual(classifyNavigation('https://cubic.goma.ink.evil.example/login'), 'internal');
  for (const target of ['javascript:location.href="/login"', 'data:text/html,login', 'file:///login']) {
    assert.equal(classifyNavigation(target), 'blocked', target);
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
  assert.equal(allowsPermission('media', origin, true, ['audio', 'screen']), false);
  assert.equal(allowsPermission('media', origin, true, []), false);
  for (const permission of ['speaker-selection', 'clipboard-sanitized-write', 'fullscreen']) {
    assert.equal(allowsPermission(permission, origin, true), true, permission);
  }
  for (const permission of ['display-capture', 'notifications', 'openExternal', 'fileSystem', 'geolocation']) {
    assert.equal(allowsPermission(permission, origin, true), false, permission);
  }
  assert.equal(allowsPermission('media', origin, false, ['audio']), false);
  assert.equal(allowsPermission('media', 'https://evil.example/', true, ['audio']), false);
  assert.equal(allowsPermission('media', 'https://cubic.goma.ink.evil.example/', true, ['video']), false);
  assert.equal(allowsPermission('media', 'http://cubic.goma.ink/', true, ['audio']), false);
  assert.equal(allowsPermission('media', 'not a URL', true, ['audio']), false);
  for (const url of [origin, 'https://cubic.goma.ink.evil.example/', 'http://cubic.goma.ink/', 'https://evil.example/', 'not a URL']) {
    assert.equal(allowsPermission('display-capture', url, true), false, url);
  }
  assert.equal(allowsPermission('display-capture', origin, false), false);
  assert.equal(allowsPermission('speaker-selection', origin, false), false);
  assert.equal(allowsPermission('speaker-selection', 'https://evil.example/', true), false);
});

test('display permission requires an exact Cubic main-frame origin and URL', () => {
  const origin = 'https://cubic.goma.ink';
  const url = `${origin}/app`;
  assert.equal(allowsDisplayCapture(origin, url, true), true);
  for (const invalidOrigin of [undefined, '', 'http://cubic.goma.ink',
    'https://cubic.goma.ink:444', 'https://cubic.goma.ink.evil.example', 'https://evil.example', 'not a URL']) {
    assert.equal(allowsDisplayCapture(invalidOrigin, url, true), false, String(invalidOrigin));
  }
  for (const invalidUrl of [undefined, '', 'http://cubic.goma.ink/app',
    'https://cubic.goma.ink:444/app', 'https://cubic.goma.ink.evil.example/app',
    'https://evil.example/app', 'not a URL']) {
    assert.equal(allowsDisplayCapture(origin, invalidUrl, true), false, String(invalidUrl));
  }
  assert.equal(allowsDisplayCapture(origin, url, false), false);
});

test('display request requires a live expected top frame, gesture, and video', () => {
  const origin = 'https://cubic.goma.ink';
  const url = `${origin}/app`;
  assert.equal(allowsDisplayRequest(origin, url, true, true, true), true);
  assert.equal(allowsDisplayRequest(origin, url, true, false, true), false);
  assert.equal(allowsDisplayRequest(origin, url, true, true, false), false);
  assert.equal(allowsDisplayRequest(undefined, url, true, true, true), false);
  assert.equal(allowsDisplayRequest('https://evil.example', url, true, true, true), false);
  assert.equal(allowsDisplayRequest(origin, 'https://evil.example/app', true, true, true), false);
  assert.equal(allowsDisplayRequest(origin, undefined, true, true, true), false);
  assert.equal(allowsDisplayRequest(origin, url, false, true, true), false);
});
