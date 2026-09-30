import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = async (path) => readFile(new URL(path, root), 'utf8');

test('release version mirrors VERSION across runtime and workspaces', async () => {
  const version = (await read('VERSION')).trim();
  const packages = ['package.json', 'apps/api/package.json', 'apps/web/package.json', 'packages/shared/package.json', 'packages/database/package.json'];
  for (const path of packages) {
    assert.equal(JSON.parse(await read(path)).version, version, path);
  }
  const lock = JSON.parse(await read('package-lock.json'));
  assert.equal(lock.version, version, 'package-lock.json');
  assert.equal(lock.packages[''].version, version, 'package-lock.json root');
  assert.match(await read('packages/shared/src/index.ts'), new RegExp(`CUBIC_VERSION = '${version.replaceAll('.', '\\.')}'`));
});
