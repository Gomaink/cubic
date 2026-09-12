// Isolated, in-memory API fixtures: never connects to PostgreSQL or live services.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';

const user = { id: 'fixture-user', username: 'tester', displayName: 'Tester', avatarUrl: null };
const peer = { id: 'fixture-peer', username: 'peer', displayName: 'Fixture DM', avatarUrl: null };
const dm = '11111111-1111-4111-8111-111111111111';
const group = '22222222-2222-4222-8222-222222222222';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
let messages;
let staged;
let videoBytes;

function attachment(name, contentType = 'image/png', dimensions = { width: 800, height: 600 }) {
  const id = randomUUID();
  return { id, conversationId: dm, messageId: null, originalName: name, contentType, sizeBytes: png.length,
    ...dimensions, url: `/api/v1/attachments/${id}/content` };
}

function reset() {
  staged = new Map();
  videoBytes = null;
  messages = Array.from({ length: 80 }, (_, index) => ({
    id: `message-${index}`, conversationId: dm, senderId: peer.id, senderDisplayName: peer.displayName,
    createdAt: new Date(Date.UTC(2026, 8, 1, 12, index)).toISOString(),
    body: `History message ${index}`, attachments: [], editedAt: null, deletedAt: null, replyTo: null
  }));
  messages[70].attachments = [attachment('single.png')];
  messages[71].attachments = Array.from({ length: 3 }, (_, i) => attachment(`gallery-${i}.png`));
  messages[72].attachments = Array.from({ length: 10 }, (_, i) => attachment(`ten-${i}.png`));
  messages[73].attachments = [attachment('document.pdf', 'application/pdf'), attachment('audio.ogg', 'audio/ogg'), attachment('a'.repeat(180) + '.zip', 'application/zip')];
  messages[74].attachments = [attachment('clip.webm', 'video/webm')];
  messages[75].attachments = [attachment('broken.png')];
  messages[76].attachments = [attachment('portrait.png', 'image/png', { width: 600, height: 1800 })];
  messages[77].body = 'Long text '.repeat(90);
  messages[78].attachments = [attachment('mixed-0.png'), attachment('mixed-1.png'), attachment('mixed-video.webm', 'video/webm')];
}
reset();

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:3198');
  const json = (value, status = 200) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  const body = async () => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    return Buffer.concat(chunks);
  };

  if (url.pathname === '/__test/reset') { reset(); return json({ ok: true }); }
  if (url.pathname === '/__test/video') { videoBytes = await body(); return json({ ok: true }); }
  if (url.pathname === '/__test/realtime') {
    const message = { ...messages.at(-1), id: randomUUID(), createdAt: new Date().toISOString(), body: 'Realtime attachment', attachments: [attachment('realtime.png')] };
    messages.push(message);
    io.emit('message:created', message);
    return json(message);
  }
  if (!request.headers.cookie?.includes('cubic_session=browser-fixture')) return json({ error: 'Authentication required.' }, 401);
  if (url.pathname === '/api/v1/auth/me') return json({ user });
  if (url.pathname === '/api/v1/social/friends') return json({ friends: [] });
  if (url.pathname === '/api/v1/social/requests') return json({ requests: [] });
  if (url.pathname === '/api/v1/groups/invites') return json({ invites: [] });
  if (url.pathname === `/api/v1/groups/${group}`) return json({ group: { id: group, title: 'Fixture group', members: [], invites: [], currentRole: 'member' } });
  if (url.pathname === '/api/v1/conversations') return json({ conversations: [
    { id: dm, kind: 'direct', peer },
    { id: group, kind: 'group', title: 'Fixture group', memberCount: 2 }
  ] });
  if (url.pathname.endsWith('/messages')) {
    const conversationId = url.pathname.split('/')[4];
    if (request.method === 'POST') {
      const payload = JSON.parse((await body()).toString());
      const target = messages.find((item) => item.id === payload.replyToMessageId);
      const message = { id: randomUUID(), conversationId, senderId: user.id, createdAt: new Date().toISOString(), body: payload.body,
        editedAt: null, deletedAt: null, attachments: payload.attachmentIds.map((id) => staged.get(id)), clientMessageId: payload.clientMessageId,
        replyTo: target ? { id: target.id, senderId: target.senderId, senderUsername: target.senderUsername ?? peer.username,
          senderDisplayName: target.senderDisplayName ?? peer.displayName, body: target.deletedAt ? '' : target.body,
          deletedAt: target.deletedAt, attachmentKind: target.deletedAt ? null : target.attachments[0]?.contentType?.startsWith('image/') ? 'image'
            : target.attachments[0]?.contentType?.startsWith('video/') ? 'video' : target.attachments.length ? 'file' : null } : null };
      messages.push(message);
      io.emit('message:created', message);
      return json({ message }, 201);
    }
    const before = url.searchParams.get('before');
    const filtered = messages.filter((message) => message.conversationId === conversationId && (!before || message.createdAt < before));
    const page = filtered.slice(-50);
    return json({ messages: page, nextCursor: filtered.length > 50 ? page[0].createdAt : null });
  }
  const messageAction = /^\/api\/v1\/conversations\/([^/]+)\/messages\/([^/]+)$/.exec(url.pathname);
  if (messageAction && request.method === 'PATCH') {
    const payload = JSON.parse((await body()).toString());
    const message = messages.find((item) => item.conversationId === messageAction[1] && item.id === messageAction[2]);
    if (!message) return json({ error: 'Message not found.' }, 404);
    message.body = payload.body.trim();
    message.editedAt = new Date().toISOString();
    io.emit('message:updated', message);
    return json({ message });
  }
  if (messageAction && request.method === 'DELETE') {
    const message = messages.find((item) => item.conversationId === messageAction[1] && item.id === messageAction[2]);
    if (!message) return json({ error: 'Message not found.' }, 404);
    message.body = '';
    message.deletedAt = new Date().toISOString();
    io.emit('message:deleted', message);
    return json({ message });
  }
  if (url.pathname.endsWith('/attachments') && request.method === 'POST') {
    const upload = (await body()).toString();
    const name = /filename="([^"]+)"/.exec(upload)?.[1] ?? 'upload.png';
    const item = attachment(name);
    staged.set(item.id, item);
    return json({ attachment: item }, 201);
  }
  if (url.pathname.startsWith('/api/v1/attachments/')) {
    const id = url.pathname.split('/')[4];
    if (request.method === 'DELETE') { staged.delete(id); response.writeHead(204); return response.end(); }
    const item = messages.flatMap((message) => message.attachments).find((item) => item.id === id) ?? staged.get(id);
    if (!item || item.originalName === 'broken.png') return json({ error: 'Attachment not found.' }, 404);
    response.writeHead(200, { 'content-type': item.contentType, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    return response.end(item.contentType.startsWith('video/') ? videoBytes ?? Buffer.alloc(0) : png);
  }
  return json({ error: `Unexpected fixture request: ${url.pathname}` }, 404);
});

const io = new Server(server, { path: '/socket.io' });
io.on('connection', (socket) => {
  socket.on('conversation:join', (_event, ack) => ack?.({ ok: true }));
  socket.on('call:sync', (_event, ack) => ack?.({ ok: true, call: null }));
});
server.listen(3198, '127.0.0.1');
const web = spawn(process.execPath, ['server.mjs'], {
  env: { ...process.env, HOST: '127.0.0.1', PORT: '3197', API_INTERNAL_URL: 'http://127.0.0.1:3198' },
  stdio: 'inherit'
});
function shutdown() {
  web.kill('SIGTERM');
  io.close();
  server.close();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
web.on('exit', (code) => { shutdown(); process.exitCode = code ?? 0; });
