import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { expectedInstaller, validateSource, validateUpdateMetadata } from './release-guard.mjs';

const version = '2.0.0-alpha.7';
const installer = expectedInstaller(version);
const config = {
  appId: 'ink.goma.cubic.preview', productName: 'Cubic', forceCodeSigning: true,
  directories: { output: 'release' }, files: ['dist/**', '!dist/tests/**', 'package.json'],
  extraResources: [{ from: '../web/static/favicon.ico', to: 'icons/favicon.ico' }],
  win: { executableName: 'Cubic', target: [{ target: 'nsis', arch: ['x64'] }], verifyUpdateCodeSignature: true },
  nsis: { oneClick: true, perMachine: false, buildUniversalInstaller: false,
    artifactName: 'Cubic-Desktop-Setup-${version}-win-x64.${ext}' },
  publish: { provider: 'github', owner: 'Gomaink', repo: 'cubic', channel: 'alpha', releaseType: 'prerelease' }
};
const desktopPackage = { version, scripts: {
  'package:win': 'npm run build && electron-builder --win nsis --x64 --publish never'
} };
const lock = { version, packages: { '': { version }, 'apps/desktop': { version } } };

test('release source pins alpha version, Windows x64 signing, and public provider', () => {
  assert.deepEqual(validateSource(version, { version }, desktopPackage, lock, config, `v${version}`),
    { version, installer });
  assert.throws(() => validateSource(version, { version }, desktopPackage, lock, config, 'v2.0.0-alpha.8'));
  assert.throws(() => validateSource('2.0.0-beta.1', { version }, desktopPackage, lock, config));
  assert.throws(() => validateSource('2.0.0-alpha.99999999999999999999', { version }, desktopPackage, lock, config));
  assert.throws(() => validateSource(version, { version }, desktopPackage, lock,
    { ...config, forceCodeSigning: false }));
  assert.throws(() => validateSource(version, { version }, desktopPackage, lock,
    { ...config, files: ['**/*'] }));
  assert.throws(() => validateSource(version, { version }, desktopPackage, lock,
    { ...config, publish: { ...config.publish, repo: 'other' } }));
  assert.throws(() => validateSource(version, { version }, desktopPackage, lock,
    { ...config, win: { ...config.win, target: [{ target: 'nsis', arch: ['ia32'] }] } }));
});

test('release metadata requires the pinned feed, publisher and expected installer', () => {
  const manifest = { version, path: installer,
    files: [{ url: installer, sha512: Buffer.alloc(64).toString('base64') }] };
  const appUpdate = { provider: 'github', owner: 'Gomaink', repo: 'cubic',
    channel: 'alpha', publisherName: ['Cubic Publisher'] };
  assert.doesNotThrow(() => validateUpdateMetadata(version, installer, manifest, appUpdate, 'Cubic Publisher'));
  assert.throws(() => validateUpdateMetadata(version, installer, manifest, appUpdate, 'Other Publisher'));
  assert.throws(() => validateUpdateMetadata(version, installer,
    { ...manifest, path: 'other.exe' }, appUpdate, 'Cubic Publisher'));
  assert.throws(() => validateUpdateMetadata(version, installer, manifest,
    { ...appUpdate, host: 'evil.example' }, 'Cubic Publisher'));
  assert.throws(() => validateUpdateMetadata(version, installer, manifest,
    { ...appUpdate, publisherName: [] }, 'Cubic Publisher'));
});

test('desktop release workflow is manual and isolates signing secrets behind its release job', () => {
  const workflow = yaml.load(readFileSync(fileURLToPath(
    new URL('../../../.github/workflows/desktop-alpha.yml', import.meta.url)), 'utf8'));
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(workflow.permissions.contents, 'read');
  assert.equal(workflow.jobs.validate['runs-on'], 'windows-latest');
  assert.equal(workflow.jobs.validate.environment, undefined);
  assert.equal(workflow.jobs.publish.environment, 'desktop-alpha-release');
  assert.equal(workflow.jobs.publish.permissions.contents, 'write');
  assert.match(workflow.jobs.publish.if, /inputs\.publish/u);
  const validationText = JSON.stringify(workflow.jobs.validate);
  assert.doesNotMatch(validationText, /secrets\./u);
});
