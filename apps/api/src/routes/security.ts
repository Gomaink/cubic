import type { FastifyPluginAsync } from 'fastify';

const CSP_REPORT_BODY_LIMIT = 16 * 1024;
const CSP_REPORT_RATE_LIMIT_MAX = 30;

interface SecurityRoutesOptions {
  browserOrigin: string;
  livekitPublicUrl: string;
}

type ReportRecord = Record<string, unknown>;

function boundedDirective(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  const directive = value.toLowerCase().match(/^[a-z][a-z-]{0,63}/)?.[0];
  return directive ?? 'unknown';
}

function reportDetails(body: unknown): { directive: string; blocked: string | null } | null {
  if (!body || typeof body !== 'object') return null;
  if (Array.isArray(body)) {
    const report = body[0] as ReportRecord | undefined;
    const reportBody = report?.body;
    if (!reportBody || typeof reportBody !== 'object' || Array.isArray(reportBody)) return null;
    const value = reportBody as ReportRecord;
    return {
      directive: boundedDirective(value.effectiveDirective ?? value.effective_directive),
      blocked: typeof value.blockedURL === 'string' ? value.blockedURL : null
    };
  }

  const envelope = body as ReportRecord;
  const legacy = envelope['csp-report'];
  const value = legacy && typeof legacy === 'object' && !Array.isArray(legacy)
    ? legacy as ReportRecord
    : envelope;
  return {
    directive: boundedDirective(
      value['effective-directive'] ?? value['violated-directive'] ?? value.effectiveDirective
    ),
    blocked: typeof value['blocked-uri'] === 'string'
      ? value['blocked-uri']
      : typeof value.blockedURL === 'string'
        ? value.blockedURL
        : null
  };
}

function classifyBlockedTarget(
  blocked: string | null,
  browserOrigin: string,
  livekitOrigin: string
): { blockedScheme: string; blockedTarget: 'self' | 'configured-livekit' | 'other' } {
  if (!blocked) return { blockedScheme: 'unknown', blockedTarget: 'other' };
  if (blocked === 'self') return { blockedScheme: 'self', blockedTarget: 'self' };
  if (blocked === 'inline' || blocked === 'eval') {
    return { blockedScheme: blocked, blockedTarget: 'other' };
  }

  try {
    const parsed = new URL(blocked, browserOrigin);
    const blockedScheme = parsed.protocol.slice(0, -1).toLowerCase().slice(0, 16) || 'unknown';
    return {
      blockedScheme,
      blockedTarget: parsed.origin === browserOrigin
        ? 'self'
        : parsed.origin === livekitOrigin
          ? 'configured-livekit'
          : 'other'
    };
  } catch {
    return { blockedScheme: 'unknown', blockedTarget: 'other' };
  }
}

function jsonParser(_request: unknown, body: string, done: (error: Error | null, value?: unknown) => void) {
  try {
    done(null, JSON.parse(body));
  } catch {
    done(null, null);
  }
}

export const securityRoutes: FastifyPluginAsync<SecurityRoutesOptions> = async (app, options) => {
  for (const contentType of ['application/csp-report', 'application/reports+json']) {
    if (!app.hasContentTypeParser(contentType)) {
      app.addContentTypeParser(contentType, { parseAs: 'string' }, jsonParser);
    }
  }

  const browserOrigin = new URL(options.browserOrigin).origin;
  const livekitOrigin = new URL(options.livekitPublicUrl).origin;

  app.post('/csp-report', {
    bodyLimit: CSP_REPORT_BODY_LIMIT,
    config: {
      rateLimit: {
        max: CSP_REPORT_RATE_LIMIT_MAX,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const details = reportDetails(request.body);
    if (details) {
      request.log.warn({
        violatedDirective: details.directive,
        ...classifyBlockedTarget(details.blocked, browserOrigin, livekitOrigin)
      }, 'Browser reported a Content Security Policy violation');
    }
    return reply.code(204).send();
  });
};

export const securityRouteInternals = {
  CSP_REPORT_BODY_LIMIT,
  CSP_REPORT_RATE_LIMIT_MAX,
  boundedDirective,
  classifyBlockedTarget,
  reportDetails
};
