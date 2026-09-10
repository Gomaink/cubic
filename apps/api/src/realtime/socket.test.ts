import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { isSameOriginRequest, readCookie } from './socket.js';

test('readCookie extracts and decodes the requested cookie', () => {
  assert.equal(readCookie('a=1; cubic_session=hello%2Fworld; b=2', 'cubic_session'), 'hello/world');
  assert.equal(readCookie('a=1', 'cubic_session'), null);
});

test('isSameOriginRequest validates the browser origin against the forwarded host', () => {
  const accepted = {
    headers: {
      origin: 'http://192.168.15.172:3010',
      host: 'api:3001',
      'x-forwarded-host': '192.168.15.172:3010'
    }
  } as unknown as IncomingMessage;

  const rejected = {
    headers: {
      origin: 'https://evil.example',
      host: 'api:3001',
      'x-forwarded-host': '192.168.15.172:3010'
    }
  } as unknown as IncomingMessage;

  assert.equal(isSameOriginRequest(accepted), true);
  assert.equal(isSameOriginRequest(rejected), false);
});
