import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'transfer-encoding',
  'upgrade'
]);

const proxy: RequestHandler = async ({ request, params, url, fetch, getClientAddress }) => {
  const apiUrl = env.API_INTERNAL_URL ?? 'http://localhost:3001';
  const upstreamUrl = `${apiUrl}/api/${params.path ?? ''}${url.search}`;
  const headers = new Headers();

  for (const name of [
    'accept',
    'content-type',
    'cookie',
    'origin',
    'sec-fetch-site',
    'sec-fetch-mode',
    'sec-fetch-dest',
    'user-agent'
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    headers.set('x-forwarded-for', getClientAddress());
  } catch {
    // Adapter may not expose an address in every development environment.
  }
  headers.set('x-forwarded-proto', url.protocol.slice(0, -1));
  headers.set('x-forwarded-host', url.host);

  const method = request.method.toUpperCase();
  const init: RequestInit = { method, headers, redirect: 'manual' };
  if (method !== 'GET' && method !== 'HEAD') init.body = await request.arrayBuffer();

  const upstream = await fetch(upstreamUrl, init);

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, name) => {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) responseHeaders.append(name, value);
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders
  });
};

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
