import assert from 'node:assert/strict';
import test from 'node:test';
import { canStartUpdateCheck, isEligiblePreviewUpdate, isTrustedUpdateConfig, updateMenuAction, UPDATE_CHECK_INTERVAL_MS } from '../update-policy.js';

test('only a newer alpha on the current preview line is eligible', () => {
  assert.equal(isEligiblePreviewUpdate('2.0.0-alpha.7', '2.0.0-alpha.8'), true);
  assert.equal(isEligiblePreviewUpdate('2.0.0-alpha.7', '2.0.0-alpha.9'), true);
  for (const candidate of [
    '2.0.0-alpha.7', '2.0.0-alpha.6', '2.0.0-beta.1', '2.0.0',
    '2.0.1-alpha.1', '3.0.0-alpha.1', '2.0.0-alpha.99999999999999999999', 'invalid'
  ]) assert.equal(isEligiblePreviewUpdate('2.0.0-alpha.7', candidate), false, candidate);
  assert.equal(isEligiblePreviewUpdate('invalid', '2.0.0-alpha.8'), false);
});

test('the tray has exactly one deterministic update action', () => {
  assert.deepEqual(updateMenuAction('idle', true), { label: 'Check for Updates', enabled: true, action: 'check' });
  assert.deepEqual(updateMenuAction('idle', false), { label: 'Check for Updates', enabled: false, action: 'check' });
  assert.deepEqual(updateMenuAction('checking', true), { label: 'Checking for Updates…', enabled: false, action: null });
  assert.deepEqual(updateMenuAction('downloading', true), { label: 'Downloading Update…', enabled: false, action: null });
  assert.deepEqual(updateMenuAction('ready', true), { label: 'Restart to Update', enabled: true, action: 'install' });
  assert.equal(UPDATE_CHECK_INTERVAL_MS, 6 * 60 * 60 * 1000);
});

test('update checks cannot overlap downloads, pending checks, or install', () => {
  assert.equal(canStartUpdateCheck(true, 'idle', false, false), true);
  assert.equal(canStartUpdateCheck(false, 'idle', false, false), false);
  assert.equal(canStartUpdateCheck(true, 'checking', false, false), false);
  assert.equal(canStartUpdateCheck(true, 'downloading', false, false), false);
  assert.equal(canStartUpdateCheck(true, 'ready', false, false), false);
  assert.equal(canStartUpdateCheck(true, 'idle', true, false), false);
  assert.equal(canStartUpdateCheck(true, 'idle', false, true), false);
});

test('packaged feed requires the pinned alpha repo and a signing publisher', () => {
  const config = { provider: 'github', owner: 'Gomaink', repo: 'cubic', channel: 'alpha', publisherName: 'Cubic Publisher' };
  assert.equal(isTrustedUpdateConfig(config), true);
  assert.equal(isTrustedUpdateConfig({ ...config, publisherName: ['Cubic Publisher'] }), true);
  for (const change of [
    { publisherName: undefined }, { publisherName: '' }, { publisherName: [] },
    { provider: 'generic' }, { owner: 'Other' }, { repo: 'other' },
    { channel: 'latest' }, { protocol: 'http' }, { host: 'evil.example' },
    { private: true }, { token: 'embedded-secret' }, { requestHeaders: {} }
  ]) assert.equal(isTrustedUpdateConfig({ ...config, ...change }), false, JSON.stringify(change));
  assert.equal(isTrustedUpdateConfig(null), false);
  assert.equal(isTrustedUpdateConfig('github'), false);
});
