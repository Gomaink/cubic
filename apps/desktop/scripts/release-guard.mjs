import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const root = fileURLToPath(new URL('../../..', import.meta.url));

export function expectedInstaller(version) {
  return `Cubic-Desktop-Setup-${version}-win-x64.exe`;
}

export function validateSource(version, rootPackage, desktopPackage, lock, config, tag) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-alpha\.(0|[1-9]\d*)$/u.exec(version);
  assert.ok(match, 'VERSION must be an alpha SemVer');
  assert.ok(match.slice(1).every((part) => Number.isSafeInteger(Number(part))),
    'VERSION components must be safe integers');
  if (tag !== undefined) assert.equal(tag, `v${version}`, 'tag must match VERSION exactly');
  assert.equal(rootPackage.version, version);
  assert.equal(desktopPackage.version, version);
  assert.equal(lock.version, version);
  assert.equal(lock.packages[''].version, version);
  assert.equal(lock.packages['apps/desktop'].version, version);
  assert.equal(config.appId, 'ink.goma.cubic.preview');
  assert.equal(config.productName, 'Cubic');
  assert.equal(config.directories.output, 'release');
  assert.deepEqual(config.files, ['dist/**', '!dist/tests/**', 'package.json']);
  assert.deepEqual(config.extraResources, [{ from: '../web/static/favicon.ico', to: 'icons/favicon.ico' }]);
  assert.equal(config.win.executableName, 'Cubic');
  assert.deepEqual(config.win.target, [{ target: 'nsis', arch: ['x64'] }]);
  assert.equal(config.win.verifyUpdateCodeSignature, true);
  assert.equal(config.forceCodeSigning, true);
  assert.equal(config.nsis.oneClick, true);
  assert.equal(config.nsis.perMachine, false);
  assert.equal(config.nsis.buildUniversalInstaller, false);
  assert.equal(config.nsis.artifactName, 'Cubic-Desktop-Setup-${version}-win-x64.${ext}');
  assert.deepEqual(config.publish, {
    provider: 'github', owner: 'Gomaink', repo: 'cubic', channel: 'alpha', releaseType: 'prerelease'
  });
  assert.equal(desktopPackage.scripts['package:win'],
    'npm run build && electron-builder --win nsis --x64 --publish never');
  return { version, installer: expectedInstaller(version) };
}

export function validateUpdateMetadata(version, installer, manifest, appUpdate, expectedPublisher) {
  assert.equal(manifest.version, version);
  assert.equal(manifest.path, installer);
  assert.ok(Array.isArray(manifest.files) && manifest.files.length === 1);
  assert.equal(manifest.files[0].url, installer);
  assert.match(manifest.files[0].sha512, /^[A-Za-z0-9+/]{86}==$/u);
  assert.equal(appUpdate.provider, 'github');
  assert.equal(appUpdate.owner, 'Gomaink');
  assert.equal(appUpdate.repo, 'cubic');
  assert.equal(appUpdate.channel, 'alpha');
  assert.ok(appUpdate.protocol === undefined || appUpdate.protocol === 'https');
  assert.equal(appUpdate.host, undefined);
  assert.notEqual(appUpdate.private, true);
  assert.equal(appUpdate.token, undefined);
  assert.equal(appUpdate.requestHeaders, undefined);
  const publishers = typeof appUpdate.publisherName === 'string'
    ? [appUpdate.publisherName] : appUpdate.publisherName;
  assert.ok(Array.isArray(publishers) && publishers.length > 0);
  assert.ok(publishers.every((name) => typeof name === 'string' && name.trim() !== ''));
  assert.ok(publishers.includes(expectedPublisher), 'expected signing publisher missing');
}

function readSource() {
  const version = readFileSync(join(root, 'VERSION'), 'utf8').trim();
  const rootPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const desktopPackage = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const config = yaml.load(readFileSync(join(desktop, 'electron-builder.yml'), 'utf8'));
  return { version, rootPackage, desktopPackage, lock, config };
}

async function verifyArtifacts(version, publisher) {
  assert.ok(publisher && publisher.trim(), 'expected publisher is required');
  const release = join(desktop, 'release');
  const installer = expectedInstaller(version);
  const exe = join(release, installer);
  const blockmap = `${exe}.blockmap`;
  const manifest = yaml.load(readFileSync(join(release, 'alpha.yml'), 'utf8'));
  const appUpdate = yaml.load(readFileSync(join(release, 'win-unpacked', 'resources', 'app-update.yml'), 'utf8'));
  validateUpdateMetadata(version, installer, manifest, appUpdate, publisher);
  assert.ok(statSync(exe).size > 0);
  assert.ok(statSync(blockmap).size > 0);
  assert.ok(statSync(join(release, 'win-unpacked', 'Cubic.exe')).size > 0);
  assert.ok(statSync(join(release, 'win-unpacked', 'resources', 'icons', 'favicon.ico')).size > 0);
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(exe)) hash.update(chunk);
  const actualHash = hash.digest('base64');
  assert.equal(manifest.files[0].sha512, actualHash, 'installer SHA-512 differs from alpha.yml');
  const installers = readdirSync(release).filter((name) => name.endsWith('.exe'));
  assert.deepEqual(installers, [installer], 'unexpected installer artifact');
  return { installer: basename(exe), blockmap: basename(blockmap), metadata: 'alpha.yml' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const source = readSource();
    const result = validateSource(source.version, source.rootPackage, source.desktopPackage,
      source.lock, source.config, process.argv[3]);
    if (process.argv[2] === 'source') {
      console.log(`Desktop release source verified: ${result.version}`);
    } else if (process.argv[2] === 'artifacts') {
      const artifacts = await verifyArtifacts(source.version, process.env.WIN_SIGNING_PUBLISHER);
      console.log(`Desktop release artifacts verified: ${artifacts.installer}, ${artifacts.blockmap}, ${artifacts.metadata}`);
    } else {
      throw new Error('Use source [tag] or artifacts');
    }
  } catch (error) {
    console.error(`Desktop release verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
