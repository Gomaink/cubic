import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { isSameOriginRequest, readCookie } from './socket.js';

const trustCubicNetwork = (address: string) => address === '172.30.0.5';

test('readCookie extracts and decodes the requested cookie', () => {
  assert.equal(readCookie('a=1; cubic_session=hello%2Fworld; b=2', 'cubic_session'), 'hello/world');
  assert.equal(readCookie('a=1', 'cubic_session'), null);
});

test('isSameOriginRequest uses forwarded host only for a trusted proxy', () => {
  const accepted = {
    headers: {
      origin: 'http://192.168.15.172:3010',
      host: 'api:3001',
      'x-forwarded-host': '192.168.15.172:3010'
    },
    socket: { remoteAddress: '172.30.0.5' }
  } as unknown as IncomingMessage;

  const rejected = {
    headers: {
      origin: 'https://evil.example',
      host: 'api:3001',
      'x-forwarded-host': '192.168.15.172:3010'
    },
    socket: { remoteAddress: '172.30.0.5' }
  } as unknown as IncomingMessage;

  const untrustedSpoof = {
    headers: {
      origin: 'https://evil.example',
      host: 'cubic.example',
      'x-forwarded-host': 'evil.example'
    },
    socket: { remoteAddress: '198.51.100.20' }
  } as unknown as IncomingMessage;

  assert.equal(isSameOriginRequest(accepted, trustCubicNetwork), true);
  assert.equal(isSameOriginRequest(rejected, trustCubicNetwork), false);
  assert.equal(isSameOriginRequest(untrustedSpoof, trustCubicNetwork), false);
});
