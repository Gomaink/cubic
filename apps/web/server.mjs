import { createServer } from 'node:http';
import httpProxy from 'http-proxy';
import { handler } from './build/handler.js';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);
const apiTarget = process.env.API_INTERNAL_URL ?? 'http://api:3001';

const proxy = httpProxy.createProxyServer({
  target: apiTarget,
  ws: true,
  xfwd: true,
  changeOrigin: false
});

proxy.on('error', (error, _request, response) => {
  console.error('[cubic-web] realtime proxy error', error);

  if (response && 'writeHead' in response && !response.headersSent) {
    response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Realtime upstream unavailable.');
  }
});

const server = createServer((request, response) => {
  if (request.url?.startsWith('/socket.io')) {
    proxy.web(request, response, { target: apiTarget });
    return;
  }

  handler(request, response);
});

server.on('upgrade', (request, socket, head) => {
  if (request.url?.startsWith('/socket.io')) {
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
