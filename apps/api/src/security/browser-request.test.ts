import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import {
  browserCorsOptions,
  browserMutationAllowed,
  canonicalBrowserOrigin,
  createBrowserMutationProtection
} from './browser-request.js';

const allowedOrigin = 'https://cubic.example';
const request = (
  method: string,
  headers: Record<string, string | string[] | undefined> = {},
  path = '/api/v1/users/me/profile'
) => browserMutationAllowed({ method, path, headers }, allowedOrigin);

test('canonical browser origins are exact HTTP(S) origins', () => {
  assert.equal(canonicalBrowserOrigin('https://EXAMPLE.test:443/'), 'https://example.test');
  assert.equal(canonicalBrowserOrigin('http://localhost:3010'), 'http://localhost:3010');
  for (const invalid of [
    '', '*', 'null', 'file:///app', 'https://user@example.test',
    'https://example.test/path', 'https://example.test/?query=1',
    'https://example.test/#fragment', 'https://example.test,https://evil.test'
  ]) {
    assert.throws(() => canonicalBrowserOrigin(invalid));
  }
});

test('safe methods and the CSP collector are exempt', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) assert.equal(request(method), true);
  assert.equal(request('POST', {}, '/api/v1/security/csp-report'), true);
});

test('credentialed CORS uses one exact origin and the complete browser method set', () => {
  assert.deepEqual(browserCorsOptions('https://CUBIC.example:443/'), {
    origin: 'https://cubic.example',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  });
});

test('unsafe browser requests require an exact origin and same-origin fetch metadata', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'CONNECT']) {
    assert.equal(request(method, { origin: allowedOrigin }), true);
    assert.equal(request(method, {
      origin: allowedOrigin,
      'sec-fetch-site': 'same-origin'
    }), true);
  }

  for (const origin of [
    'http://cubic.example',
    'https://cubic.example:444',
    'https://chat.cubic.example',
    'https://evil.example',
    'null',
    'not a url',
    'https://cubic.example, https://evil.example'
  ]) assert.equal(request('POST', { origin }), false);

  assert.equal(request('POST', { origin: [allowedOrigin, 'https://evil.example'] }), false);
  for (const site of ['same-site', 'cross-site', 'none', 'unknown']) {
    assert.equal(request('POST', { origin: allowedOrigin, 'sec-fetch-site': site }), false);
  }
});

test('missing origin fails closed except for bounded non-browser JSON login/register', () => {
  assert.equal(request('POST', { cookie: 'session=opaque' }), false);
  assert.equal(request('POST', { 'sec-fetch-site': 'same-origin' }), false);
  assert.equal(request('POST'), false);

  for (const path of ['/api/v1/auth/login', '/api/v1/auth/register']) {
    assert.equal(request('POST', { 'content-type': 'application/json; charset=utf-8' }, path), true);
    assert.equal(request('POST', { 'content-type': 'text/plain' }, path), false);
    assert.equal(request('POST', {
      'content-type': 'application/json',
      cookie: 'session=opaque'
    }, path), false);
    assert.equal(request('POST', {
      'content-type': 'application/json',
      'sec-fetch-mode': 'cors'
    }, path), false);
  }

  assert.equal(request('POST', { 'content-type': 'application/json' }, '/api/v1/auth/logout'), false);
});

test('origin rejection runs before content parsing and route mutation', async () => {
  const app = Fastify({ logger: false });
  let parsedBodies = 0;
  let mutations = 0;
  app.addHook('onRequest', createBrowserMutationProtection(allowedOrigin));
  app.addContentTypeParser('application/x-cubic-test', { parseAs: 'string' }, (_request, body, done) => {
    parsedBodies += 1;
    done(null, body);
  });
  app.post('/mutate', async () => { mutations += 1; return { ok: true }; });

  const rejected = await app.inject({
    method: 'POST',
    url: '/mutate',
    headers: { origin: 'https://evil.example', 'content-type': 'application/x-cubic-test' },
    payload: 'must-not-be-parsed'
  });
  assert.equal(rejected.statusCode, 403);
  assert.equal(parsedBodies, 0);
  assert.equal(mutations, 0);

  const accepted = await app.inject({
    method: 'POST',
    url: '/mutate',
    headers: { origin: allowedOrigin, 'content-type': 'application/x-cubic-test' },
    payload: 'allowed'
  });
  assert.equal(accepted.statusCode, 200);
  assert.equal(parsedBodies, 1);
  assert.equal(mutations, 1);
  await app.close();
});
