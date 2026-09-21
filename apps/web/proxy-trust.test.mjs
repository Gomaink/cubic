import assert from 'node:assert/strict';
import test from 'node:test';
import { createForwardedHeaderPolicy, parseTrustedProxyCidrs } from './proxy-trust.mjs';

test('web proxy CIDR configuration is strict', () => {
  assert.deepEqual(parseTrustedProxyCidrs('172.30.0.0/16, ::1/128'), [
    '172.30.0.0/16',
    '::1/128'
  ]);
  assert.throws(() => parseTrustedProxyCidrs('1'), /invalid CIDR/);
  assert.throws(() => parseTrustedProxyCidrs('10.0.0.0/8,'), /comma-separated list/);
  assert.throws(() => parseTrustedProxyCidrs('2001:db8::/129'), /invalid CIDR/);
  assert.throws(() => parseTrustedProxyCidrs('0.0.0.0/0'), /invalid CIDR/);
});

test('untrusted peers cannot supply forwarded client, protocol, or host', () => {
  const applyPolicy = createForwardedHeaderPolicy(parseTrustedProxyCidrs('172.30.0.0/16'));
  const result = applyPolicy({
    remoteAddress: '192.168.15.50',
    encrypted: false,
    headers: {
      host: 'cubic.example:3010',
      'x-forwarded-for': '203.0.113.99',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'attacker.example'
    }
  });

  assert.deepEqual(result, {
    clientAddress: '192.168.15.50',
    host: 'cubic.example:3010',
    protocol: 'http',
    trustedPeer: false
  });
});

test('trusted edge values are canonicalized at the first untrusted client', () => {
  const applyPolicy = createForwardedHeaderPolicy(parseTrustedProxyCidrs('172.30.0.0/16'));
  const result = applyPolicy({
    remoteAddress: '::ffff:172.30.0.1',
    encrypted: false,
    headers: {
      host: '192.168.15.172:3010',
      'x-forwarded-for': '203.0.113.200, 198.51.100.20, 172.30.0.9',
      'x-forwarded-proto': 'attacker-value, https',
      'x-forwarded-host': 'attacker.example, cubic.example'
    }
  });

  assert.deepEqual(result, {
    clientAddress: '198.51.100.20',
    host: 'cubic.example',
    protocol: 'https',
    trustedPeer: true
  });
});

test('trusted websocket forwarding normalizes ws and wss to HTTP semantics', () => {
  const applyPolicy = createForwardedHeaderPolicy(parseTrustedProxyCidrs('172.30.0.0/16'));
  const base = {
    remoteAddress: '172.30.0.1',
    encrypted: false,
    headers: { host: 'cubic.example:3010' }
  };

  assert.equal(applyPolicy({ ...base, headers: { ...base.headers, 'x-forwarded-proto': 'wss' } }).protocol, 'https');
  assert.equal(applyPolicy({ ...base, headers: { ...base.headers, 'x-forwarded-proto': 'ws' } }).protocol, 'http');
  assert.equal(applyPolicy({ ...base, headers: { ...base.headers, 'x-forwarded-proto': 'https' } }).protocol, 'https');
  assert.equal(applyPolicy({ ...base, headers: { ...base.headers, 'x-forwarded-proto': 'http' } }).protocol, 'http');
});

test('untrusted websocket forwarding cannot assert HTTPS', () => {
  const applyPolicy = createForwardedHeaderPolicy(parseTrustedProxyCidrs('172.30.0.0/16'));
  const result = applyPolicy({
    remoteAddress: '192.168.15.50',
    encrypted: false,
    headers: {
      host: 'cubic.example:3010',
      'x-forwarded-proto': 'wss'
    }
  });
  assert.equal(result.protocol, 'http');
  assert.equal(result.trustedPeer, false);
});

test('unknown forwarded protocols retain encrypted-socket fallback behavior', () => {
  const applyPolicy = createForwardedHeaderPolicy(parseTrustedProxyCidrs('172.30.0.0/16'));
  const headers = { host: 'cubic.example:3010', 'x-forwarded-proto': 'quic' };
  assert.equal(applyPolicy({ remoteAddress: '172.30.0.1', encrypted: true, headers }).protocol, 'https');
  assert.equal(applyPolicy({ remoteAddress: '172.30.0.1', encrypted: false, headers }).protocol, 'http');
});
