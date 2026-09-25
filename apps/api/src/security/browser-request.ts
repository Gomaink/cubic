import type { FastifyReply, FastifyRequest } from 'fastify';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const NON_BROWSER_AUTH_PATHS = new Set([
  '/api/v1/auth/login',
  '/api/v1/auth/register'
]);
const CSP_REPORT_PATH = '/api/v1/security/csp-report';
const LIVEKIT_WEBHOOK_PATH = '/api/v1/server-voice/webhook';
const FETCH_METADATA_HEADERS = [
  'sec-fetch-site',
  'sec-fetch-mode',
  'sec-fetch-dest',
  'sec-fetch-user'
] as const;

export const BROWSER_ORIGIN_ERROR = 'Request origin is not allowed.';
export const BROWSER_CORS_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

export function canonicalBrowserOrigin(value: string): string {
  if (!value || value.includes('*') || value.includes(',')) {
    throw new Error('must be one exact HTTP or HTTPS origin');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('must be one exact HTTP or HTTPS origin');
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    parsed.origin === 'null'
  ) {
    throw new Error('must be one exact HTTP or HTTPS origin');
  }

  return parsed.origin;
}

export function browserOriginMatches(value: string, expectedOrigin: string): boolean {
  try {
    return canonicalBrowserOrigin(value) === expectedOrigin;
  } catch {
    return false;
  }
}

export function browserCorsOptions(allowedOriginValue: string) {
  return {
    origin: canonicalBrowserOrigin(allowedOriginValue),
    credentials: true,
    methods: [...BROWSER_CORS_METHODS]
  };
}

export interface BrowserMutationRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
}

function singleHeader(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string' || value.includes(',')) return null;
  return value;
}

function hasFetchMetadata(headers: BrowserMutationRequest['headers']): boolean {
  return FETCH_METADATA_HEADERS.some((name) => headers[name] !== undefined);
}

function isJsonContentType(value: string | string[] | undefined): boolean {
  return typeof value === 'string' &&
    value.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}

export function browserMutationAllowed(
  request: BrowserMutationRequest,
  allowedOrigin: string
): boolean {
  const method = request.method.toUpperCase();
  if (SAFE_METHODS.has(method)) return true;
  if (request.path === CSP_REPORT_PATH) return true;
  // This non-browser ingress is independently authenticated by LiveKit's
  // signed body digest. It carries no Cubic browser session authority.
  if (request.path === LIVEKIT_WEBHOOK_PATH && request.headers.origin === undefined &&
      request.headers.cookie === undefined && !hasFetchMetadata(request.headers)) return true;

  const originHeader = request.headers.origin;
  if (originHeader === undefined) {
    const nonBrowserAuthRequest =
      NON_BROWSER_AUTH_PATHS.has(request.path) &&
      request.headers.cookie === undefined &&
      !hasFetchMetadata(request.headers) &&
      isJsonContentType(request.headers['content-type']);
    return nonBrowserAuthRequest;
  }

  const origin = singleHeader(originHeader);
  if (!origin || origin === 'null') return false;

  if (!browserOriginMatches(origin, allowedOrigin)) return false;

  const fetchSite = singleHeader(request.headers['sec-fetch-site']);
  return fetchSite === null
    ? request.headers['sec-fetch-site'] === undefined
    : fetchSite === 'same-origin';
}

export function createBrowserMutationProtection(allowedOriginValue: string) {
  const allowedOrigin = canonicalBrowserOrigin(allowedOriginValue);

  return async function browserMutationProtection(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const path = request.url.split('?', 1)[0] ?? request.url;
    if (browserMutationAllowed({
      method: request.method,
      path,
      headers: request.headers
    }, allowedOrigin)) return;

    await reply.code(403).send({ error: BROWSER_ORIGIN_ERROR });
  };
}

export const browserRequestInternals = {
  CSP_REPORT_PATH,
  FETCH_METADATA_HEADERS,
  NON_BROWSER_AUTH_PATHS,
  SAFE_METHODS
};
