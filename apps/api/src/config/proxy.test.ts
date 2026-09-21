import assert from 'node:assert/strict';
import test from 'node:test';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { parseTrustedProxyCidrs } from './proxy.js';

const trustedProxyCidrs = parseTrustedProxyCidrs('172.30.0.0/16');

async function createProxyTestApp() {
  const app = Fastify({ logger: false, trustProxy: trustedProxyCidrs });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.get('/identity', async (request) => ({
    ip: request.ip,
    ips: request.ips,
    protocol: request.protocol,
    hostname: request.hostname
  }));

  app.get(
    '/limited',
    { config: { rateLimit: { max: 1, timeWindow: '1 minute' } } },
    async (request) => ({ ip: request.ip })
  );

  app.get('/secure-cookie', async (request, reply) => {
    reply.setCookie('cubic_session', 'test-token', {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/'
    });
    return { protocol: request.protocol };
  });

  await app.ready();
  return app;
}

test('an untrusted peer cannot spoof client IP, protocol, or host', async (context) => {
  const app = await createProxyTestApp();
  context.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/identity',
    remoteAddress: '198.51.100.20',
    headers: {
      host: 'cubic.example',
      'x-forwarded-for': '203.0.113.99',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'attacker.example'
    }
  });

  assert.deepEqual(response.json(), {
    ip: '198.51.100.20',
    ips: ['198.51.100.20'],
    protocol: 'http',
    hostname: 'cubic.example'
  });
});

test('forwarded identity is honored only from the configured proxy CIDR', async (context) => {
  const app = await createProxyTestApp();
  context.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/identity',
    remoteAddress: '172.30.0.5',
    headers: {
      host: 'api:3001',
      'x-forwarded-for': '198.51.100.20',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'cubic.example'
    }
  });

  assert.deepEqual(response.json(), {
    ip: '198.51.100.20',
    ips: ['172.30.0.5', '198.51.100.20'],
    protocol: 'https',
    hostname: 'cubic.example'
  });
});

test('multi-value forwarding stops at the first untrusted address', async (context) => {
  const app = await createProxyTestApp();
  context.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/identity',
    remoteAddress: '172.30.0.5',
    headers: {
      'x-forwarded-for': '203.0.113.200, 198.51.100.20, 172.30.0.1'
    }
  });

  assert.equal(response.json().ip, '198.51.100.20');
  assert.deepEqual(response.json().ips, ['172.30.0.5', '172.30.0.1', '198.51.100.20']);
});

test('rate limiting uses the resolved client and cannot be evaded with an added hop', async (context) => {
  const app = await createProxyTestApp();
  context.after(() => app.close());

  const first = await app.inject({
    method: 'GET',
    url: '/limited',
    remoteAddress: '172.30.0.5',
    headers: { 'x-forwarded-for': '203.0.113.1, 198.51.100.20' }
  });
  const spoofedRetry = await app.inject({
    method: 'GET',
    url: '/limited',
    remoteAddress: '172.30.0.5',
    headers: { 'x-forwarded-for': '203.0.113.2, 198.51.100.20' }
  });
  const otherClient = await app.inject({
    method: 'GET',
    url: '/limited',
    remoteAddress: '172.30.0.5',
    headers: { 'x-forwarded-for': '198.51.100.21' }
  });

  assert.equal(first.statusCode, 200);
  assert.equal(spoofedRetry.statusCode, 429);
  assert.equal(otherClient.statusCode, 200);
});

test('secure session-cookie attributes remain enabled behind HTTPS proxying', async (context) => {
  const app = await createProxyTestApp();
  context.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/secure-cookie',
    remoteAddress: '172.30.0.5',
    headers: { 'x-forwarded-proto': 'https' }
  });

  assert.equal(response.json().protocol, 'https');
  const setCookie = response.headers['set-cookie'];
  assert.match(Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? ''), /; HttpOnly; Secure; SameSite=Lax/);
});
