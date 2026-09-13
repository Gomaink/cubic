import { createServer } from 'node:http';
import httpProxy from 'http-proxy';
import { handler } from './build/handler.js';
import { createForwardedHeaderPolicy, parseTrustedProxyCidrs } from './proxy-trust.mjs';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);
const apiTarget = process.env.API_INTERNAL_URL ?? 'http://api:3001';
const trustedProxySetting = process.env.TRUST_PROXY_CIDRS;

if (process.env.TRUST_PROXY_HOPS !== undefined) {
  throw new Error('TRUST_PROXY_HOPS has been removed; use TRUST_PROXY_CIDRS with explicit IP CIDRs');
}

if (!trustedProxySetting) {
  throw new Error('TRUST_PROXY_CIDRS is required and must contain explicit IP CIDRs');
}

const applyForwardedHeaderPolicy = createForwardedHeaderPolicy(
  parseTrustedProxyCidrs(trustedProxySetting)
);

const proxy = httpProxy.createProxyServer({
  target: apiTarget,
  ws: true,
  xfwd: false,
  changeOrigin: false
});

function canonicalizeForwardedHeaders(request) {
  const identity = applyForwardedHeaderPolicy({
    remoteAddress: request.socket.remoteAddress ?? '',
    encrypted: Boolean(request.socket.encrypted),
    headers: request.headers
  });

  request.headers['x-forwarded-for'] = identity.clientAddress;
  request.headers['x-forwarded-proto'] = identity.protocol;
  if (identity.host) request.headers['x-forwarded-host'] = identity.host;
  else delete request.headers['x-forwarded-host'];
  delete request.headers['x-forwarded-port'];
}

proxy.on('error', (error, _request, response) => {
  console.error('[cubic-web] realtime proxy error', error);

  if (response && 'writeHead' in response && !response.headersSent) {
    response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Realtime upstream unavailable.');
  }
});

const server = createServer((request, response) => {
  if (
    request.url?.startsWith('/socket.io') ||
    request.url?.startsWith('/api/')
  ) {
    canonicalizeForwardedHeaders(request);
    proxy.web(request, response, { target: apiTarget });
    return;
  }

  handler(request, response);
});

server.on('upgrade', (request, socket, head) => {
  if (request.url?.startsWith('/socket.io')) {
    canonicalizeForwardedHeaders(request);
    proxy.ws(request, socket, head, { target: apiTarget });
    return;
  }

  socket.destroy();
});

server.listen(port, host, () => {
  console.log(`Cubic web listening on http://${host}:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
