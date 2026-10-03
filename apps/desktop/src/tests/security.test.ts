import assert from 'node:assert/strict';
import test from 'node:test';
import { allowsDisplayCapture, allowsDisplayRequest, allowsElectron44LegacyDisplayPermission, allowsNotifications, allowsPermission, classifyNavigation, inspectCubicSecurityOrigin, type LegacyDisplayPermissionContext } from '../security.js';

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

test('display security origin accepts equivalent serialization and rejects alternate authorities', () => {
  const frameUrl = 'https://cubic.goma.ink/app';
  for (const origin of ['https://cubic.goma.ink', 'https://cubic.goma.ink/',
    'https://cubic.goma.ink:443/']) {
    assert.deepEqual(inspectCubicSecurityOrigin(origin), {
      present: true, parseable: true, normalizedMatches: true
    });
    assert.equal(allowsDisplayCapture(origin, frameUrl, true), true);
    assert.equal(allowsDisplayRequest(origin, frameUrl, true, true, true), true);
  }
  for (const origin of ['http://cubic.goma.ink', 'https://cubic.goma.ink:444',
    'https://sub.cubic.goma.ink', 'https://cubic.goma.ink.evil.test',
    'https://user@cubic.goma.ink', 'null', 'not a URL']) {
    assert.equal(inspectCubicSecurityOrigin(origin).normalizedMatches, false, origin);
    assert.equal(allowsDisplayCapture(origin, frameUrl, true), false, origin);
    assert.equal(allowsDisplayRequest(origin, frameUrl, true, true, true), false, origin);
  }
  for (const origin of [null, undefined, '']) {
    assert.deepEqual(inspectCubicSecurityOrigin(origin), {
      present: false, parseable: false, normalizedMatches: false
    });
  }
  assert.deepEqual(inspectCubicSecurityOrigin('not a URL'), {
    present: true, parseable: false, normalizedMatches: false
  });
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

test('Electron 44 legacy screen capture proceeds only from the expected Cubic main frame', () => {
  const valid: LegacyDisplayPermissionContext = {
    phase: 'request', electronVersion: '44.5.1', permission: 'media', mediaTypes: [],
    requesterMatches: true, isMainFrame: true, requestingOrigin: 'https://cubic.goma.ink',
    requestingUrl: 'https://cubic.goma.ink/app',
    currentDocumentUrl: 'https://cubic.goma.ink/app', isWindows: true
  };
  assert.equal(allowsElectron44LegacyDisplayPermission(valid), true);
  assert.equal(allowsElectron44LegacyDisplayPermission({ ...valid, phase: 'check', mediaTypes: undefined }), true);
  assert.equal(allowsPermission('media', valid.requestingUrl!, true, []), false);

  for (const electronVersion of ['45.0.0', '43.9.0', 'invalid', '', undefined]) {
    assert.equal(allowsElectron44LegacyDisplayPermission({ ...valid, electronVersion }), false);
  }
  for (const permission of ['display-capture', 'notifications', 'unknown']) {
    assert.equal(allowsElectron44LegacyDisplayPermission({ ...valid, permission }), false);
  }
  for (const mediaTypes of [undefined, ['audio'], ['video'], ['audio', 'video'], ['unknown']]) {
    assert.equal(allowsElectron44LegacyDisplayPermission({ ...valid, mediaTypes }), false);
  }
  assert.equal(allowsElectron44LegacyDisplayPermission({ ...valid, phase: 'check', mediaType: 'audio' }), false);
  assert.equal(allowsElectron44LegacyDisplayPermission({ ...valid, phase: 'check', mediaTypes: [] }), false);
  assert.equal(allowsElectron44LegacyDisplayPermission({ ...valid, mediaType: 'audio' }), false);
  assert.equal(allowsElectron44LegacyDisplayPermission({ ...valid, requesterMatches: false }), false);
  assert.equal(allowsElectron44LegacyDisplayPermission({ ...valid, isMainFrame: false }), false);
  assert.equal(allowsElectron44LegacyDisplayPermission({ ...valid, isWindows: false }), false);
  for (const requestingOrigin of [undefined, 'http://cubic.goma.ink',
    'https://cubic.goma.ink:444', 'https://cubic.goma.ink.evil.example',
    'https://evil.example', 'https://user:pass@cubic.goma.ink', 'invalid']) {
    assert.equal(allowsElectron44LegacyDisplayPermission({ ...valid, requestingOrigin }), false);
  }
  for (const requestingUrl of [undefined, 'http://cubic.goma.ink/app',
    'https://cubic.goma.ink:444/app', 'https://cubic.goma.ink.evil.example/app',
    'https://evil.example/app', 'invalid']) {
    assert.equal(allowsElectron44LegacyDisplayPermission({ ...valid, requestingUrl }), false);
  }
  for (const currentDocumentUrl of [undefined, 'http://cubic.goma.ink/app',
    'https://cubic.goma.ink:444/app', 'https://user:pass@cubic.goma.ink/app',
    'https://evil.example/app', 'invalid']) {
    assert.equal(allowsElectron44LegacyDisplayPermission({ ...valid, currentDocumentUrl }), false);
  }
});

test('Web notifications require the exact Cubic origin and main document', () => {
  const origin = 'https://cubic.goma.ink';
  const url = `${origin}/app`;
  assert.equal(allowsNotifications(origin, url, true), true);
  for (const invalidOrigin of [undefined, '', 'http://cubic.goma.ink',
    'https://cubic.goma.ink:444', 'https://cubic.goma.ink.evil.example',
    'https://evil.example', 'not a URL']) {
    assert.equal(allowsNotifications(invalidOrigin, url, true), false, String(invalidOrigin));
  }
  for (const invalidUrl of [undefined, '', 'http://cubic.goma.ink/app',
    'https://cubic.goma.ink:444/app', 'https://cubic.goma.ink.evil.example/app',
    'https://evil.example/app', 'not a URL']) {
    assert.equal(allowsNotifications(origin, invalidUrl, true), false, String(invalidUrl));
  }
  assert.equal(allowsNotifications(origin, url, false), false);
  assert.equal(allowsPermission('notifications', url, true), false);
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
