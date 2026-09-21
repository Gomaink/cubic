import assert from 'node:assert/strict';
import test from 'node:test';
import { securityRouteInternals, securityRoutes } from './security.js';

test('CSP report parsing supports legacy and Reporting API shapes without retaining URLs', () => {
  assert.deepEqual(securityRouteInternals.reportDetails({
    'csp-report': {
      'effective-directive': 'script-src-elem',
      'blocked-uri': 'https://evil.example/private?token=secret'
    }
  }), {
    directive: 'script-src-elem',
    blocked: 'https://evil.example/private?token=secret'
  });
  assert.deepEqual(securityRouteInternals.reportDetails([{
    type: 'csp-violation',
    body: { effectiveDirective: 'connect-src', blockedURL: 'wss://livekit.example/rtc' }
  }]), {
    directive: 'connect-src',
    blocked: 'wss://livekit.example/rtc'
  });
  assert.deepEqual(
    securityRouteInternals.classifyBlockedTarget(
      'https://evil.example/private?token=secret',
      'https://cubic.example',
      'wss://livekit.example'
    ),
    { blockedScheme: 'https', blockedTarget: 'other' }
  );
  assert.deepEqual(
    securityRouteInternals.classifyBlockedTarget(
      'wss://livekit.example/rtc?access_token=secret',
      'https://cubic.example',
      'wss://livekit.example'
    ),
    { blockedScheme: 'wss', blockedTarget: 'configured-livekit' }
  );
});

test('CSP report endpoint is unauthenticated, bounded, rate limited, and logs categories only', async () => {
  let route: any;
  const parsers: string[] = [];
  const app = {
    hasContentTypeParser: () => false,
    addContentTypeParser: (contentType: string) => parsers.push(contentType),
    post: (_path: string, options: unknown, handler: unknown) => { route = { options, handler }; }
  };
  await securityRoutes(app as never, {
    browserOrigin: 'https://cubic.example',
    livekitPublicUrl: 'wss://livekit.example'
  });

  assert.deepEqual(parsers, ['application/csp-report', 'application/reports+json']);
  assert.equal(route.options.bodyLimit, 16 * 1024);
  assert.deepEqual(route.options.config.rateLimit, { max: 30, timeWindow: '1 minute' });

  let logFields: Record<string, unknown> | undefined;
  let status = 200;
  await route.handler({
    body: {
      'csp-report': {
        'violated-directive': 'img-src',
        'blocked-uri': 'https://other.example/avatar.png?secret=value',
        'document-uri': 'https://cubic.example/app/private'
      }
    },
    log: { warn(fields: Record<string, unknown>) { logFields = fields; } }
  }, {
    code(value: number) { status = value; return this; },
    send() {}
  });

  assert.equal(status, 204);
  assert.deepEqual(logFields, {
    violatedDirective: 'img-src',
    blockedScheme: 'https',
    blockedTarget: 'other'
  });
  assert.equal(JSON.stringify(logFields).includes('secret'), false);
});
