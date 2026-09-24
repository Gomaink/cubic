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
const animatedGif = Buffer.from('47494638396101000100800000000000ffffff21f90400000000002c000000000100010000020244010021f90400000000002c00000000010001000002024c01003b', 'hex');
let messages;
let staged;
let videoBytes;
let sessionMode;
let activeSessions;
let groupMembers;
let fixtureServers;
let fixtureChannels;
let fixtureCategories;
let fixtureServerMembers;
let fixtureServerInvites;
let fixtureServerFriends;
let fixturePresence;
let holdPresenceSnapshots = false;
let heldPresenceSnapshots = [];
const fixtureSockets = new Map();

function attachment(name, contentType = 'image/png', dimensions = { width: 800, height: 600 }) {
  const id = randomUUID();
  return { id, conversationId: dm, messageId: null, originalName: name, contentType, sizeBytes: png.length,
    ...dimensions, url: `/api/v1/attachments/${id}/content` };
}

function reset() {
  fixtureServers = [];
  fixtureChannels = [];
  fixtureCategories = [];
  fixtureServerMembers = new Map();
  fixtureServerInvites = [];
  fixtureServerFriends = false;
  user.displayName = 'Tester';
  user.avatarUrl = null;
  peer.displayName = 'Fixture DM';
  peer.avatarUrl = null;
  groupMembers = [
    { ...user, role: 'owner' },
    { ...peer, role: 'member' }
  ];
  fixturePresence = new Map();
  holdPresenceSnapshots = false;
  heldPresenceSnapshots = [];
  staged = new Map();
  videoBytes = null;
  sessionMode = 'ok';
  activeSessions = [
    { id: '60000000-0000-4000-8000-000000000001', current: true, client: 'Firefox on Linux',
      createdAt: '2026-09-12T10:00:00.000Z', lastSeenAt: '2026-09-13T12:00:00.000Z', expiresAt: '2026-10-12T10:00:00.000Z' },
    { id: '60000000-0000-4000-8000-000000000002', current: false, client: 'Unknown client',
      createdAt: '2026-09-10T09:00:00.000Z', lastSeenAt: '2026-09-12T08:00:00.000Z', expiresAt: '2026-10-10T09:00:00.000Z' }
  ];
  messages = Array.from({ length: 80 }, (_, index) => ({
    id: `message-${index}`, conversationId: dm, senderId: peer.id, senderDisplayName: peer.displayName,
    createdAt: new Date(Date.UTC(2026, 8, 1, 12, index)).toISOString(),
    body: `History message ${index}`, attachments: [], editedAt: null, deletedAt: null, replyTo: null, reactions: []
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
  messages[70].reactions = [{ reaction: '👍', count: 2, reactedByCurrentUser: false }];
  messages[78].reactions = [{ reaction: '❤️', count: 1, reactedByCurrentUser: true }];
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
  if (url.pathname === '/__test/server-friends') { fixtureServerFriends = true; return json({ ok: true }); }
  if (url.pathname === '/__test/session-mode') {
    sessionMode = url.searchParams.get('value') ?? 'ok';
    return json({ ok: true });
  }
  if (url.pathname === '/__test/video') { videoBytes = await body(); return json({ ok: true }); }
  if (url.pathname === '/__test/presence') {
    const target = url.searchParams.get('userId');
    const status = url.searchParams.get('status');
    if (![user.id, peer.id].includes(target) || !['online', 'idle', 'offline'].includes(status)) return json({ error: 'Invalid presence.' }, 400);
    fixturePresence.set(target, status);
    io.emit('presence:changed', { userId: target, status });
    return json({ ok: true });
  }
  if (url.pathname === '/__test/presence-snapshot') {
    const mode = url.searchParams.get('mode');
    if (mode === 'hold') holdPresenceSnapshots = true;
    if (mode === 'release') {
      holdPresenceSnapshots = false;
      for (const send of heldPresenceSnapshots.splice(0)) send();
      fixturePresence.set(user.id, 'idle');
      io.emit('presence:changed', { userId: user.id, status: 'idle' });
    }
    return json({ pending: heldPresenceSnapshots.length });
  }
  if (url.pathname === '/__test/group-member') {
    const included = url.searchParams.get('included') === 'true';
    groupMembers = included ? [{ ...user, role: 'owner' }, { ...peer, role: 'member' }] : [{ ...user, role: 'owner' }];
    io.emit('conversation:updated', { conversationId: group });
    return json({ ok: true });
  }
  if (url.pathname === '/__test/realtime') {
    const message = { ...messages.at(-1), id: randomUUID(), createdAt: new Date().toISOString(), body: 'Realtime attachment', attachments: [attachment('realtime.png')], reactions: [] };
    messages.push(message);
    io.emit('message:created', message);
    return json(message);
  }
  if (url.pathname === '/__test/reaction') {
    const message = messages.find((item) => item.id === url.searchParams.get('messageId'));
    if (!message) return json({ error: 'Message not found.' }, 404);
    const existing = message.reactions.find((item) => item.reaction === '😂');
    if (existing) existing.count += 1;
    else message.reactions.push({ reaction: '😂', count: 1, reactedByCurrentUser: false });
    const event = { conversationId: message.conversationId, messageId: message.id, userId: peer.id,
      reaction: '😂', active: true, reactions: message.reactions.map(({ reaction, count }) => ({ reaction, count })) };
    io.emit('message:reactions', event);
    return json(event);
  }
  const isPeer = request.headers.cookie?.includes('cubic_session=browser-peer');
  if (!isPeer && !request.headers.cookie?.includes('cubic_session=browser-fixture')) return json({ error: 'Authentication required.' }, 401);
  const requestUser = isPeer ? peer : user;
  if (url.pathname === '/api/v1/users/me/profile' && request.method === 'PATCH') {
    const payload = JSON.parse((await body()).toString());
    if (typeof payload.displayName !== 'string' || !payload.displayName.trim()) return json({ error: 'Invalid profile.' }, 400);
    requestUser.displayName = payload.displayName.trim();
    groupMembers = groupMembers.map((member) => member.id === requestUser.id ? { ...member, displayName: requestUser.displayName } : member);
    io.emit('profile:changed', { userId: requestUser.id, displayName: requestUser.displayName, avatarUrl: requestUser.avatarUrl });
    return json({ displayName: requestUser.displayName });
  }
  if (url.pathname === '/api/v1/users/me/avatar' && request.method === 'POST') {
    const uploaded = await body();
    if (!uploaded.includes(Buffer.from('GIF89a'))) return json({ error: 'Use a GIF image.' }, 415);
    requestUser.avatarUrl = `/api/v1/users/${requestUser.id}/avatar/test.gif`;
    groupMembers = groupMembers.map((member) => member.id === requestUser.id ? { ...member, avatarUrl: requestUser.avatarUrl } : member);
    const profile = { userId: requestUser.id, displayName: requestUser.displayName, avatarUrl: requestUser.avatarUrl };
    io.emit('profile:changed', profile);
    return json({ profile });
  }
  if (url.pathname === '/api/v1/users/me/avatar' && request.method === 'DELETE') {
    requestUser.avatarUrl = null;
    groupMembers = groupMembers.map((member) => member.id === requestUser.id ? { ...member, avatarUrl: null } : member);
    const profile = { userId: requestUser.id, displayName: requestUser.displayName, avatarUrl: null };
    io.emit('profile:changed', profile);
    return json({ profile });
  }
  const avatarOwner = [user, peer].find((candidate) => url.pathname === `/api/v1/users/${candidate.id}/avatar/test.gif` && candidate.avatarUrl);
  if (avatarOwner) {
    response.writeHead(200, { 'content-type': 'image/gif', 'x-content-type-options': 'nosniff' });
    response.end(animatedGif);
    return;
  }
  if (url.pathname === '/api/v1/auth/me') return json({ user: requestUser });
  if (url.pathname === '/api/v1/auth/session') return json({ authenticated: true, user: requestUser });
  if (url.pathname === '/api/v1/auth/sessions' && request.method === 'GET') {
    if (sessionMode === 'error') return json({ error: 'Session management is temporarily unavailable.' }, 503);
    return json({ sessions: sessionMode === 'empty' ? [] : activeSessions });
  }
  if (url.pathname === '/api/v1/auth/sessions/others' && request.method === 'DELETE') {
    activeSessions = activeSessions.filter((session) => session.current);
    response.writeHead(204);
    return response.end();
  }
  if (url.pathname === '/api/v1/auth/sessions' && request.method === 'DELETE') {
    activeSessions = [];
    response.writeHead(204, { 'set-cookie': 'cubic_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' });
    return response.end();
  }
  const sessionAction = /^\/api\/v1\/auth\/sessions\/([0-9a-f-]+)$/.exec(url.pathname);
  if (sessionAction && request.method === 'DELETE') {
    activeSessions = activeSessions.filter((session) => session.id !== sessionAction[1]);
    response.writeHead(204);
    return response.end();
  }
  if (url.pathname === '/api/v1/social/friends') return json({ friends: fixtureServerFriends ? [isPeer ? user : peer] : [] });
  if (url.pathname === '/api/v1/servers' && request.method === 'GET') {
    return json({ servers: fixtureServers.filter((item) => fixtureServerMembers.get(item.id)?.has(requestUser.id)) });
  }
  if (url.pathname === '/api/v1/servers' && request.method === 'POST') {
    const payload = JSON.parse((await body()).toString());
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!name || name.length > 96) return json({ error: 'Invalid server name.' }, 400);
    const now = new Date().toISOString();
    const server = { id: randomUUID(), name, ownerUserId: requestUser.id, createdAt: now, updatedAt: now };
    fixtureServers.push(server);
    fixtureServerMembers.set(server.id, new Set([requestUser.id]));
    return json({ server }, 201);
  }
  if (url.pathname === '/api/v1/servers/invites' && request.method === 'GET') {
    return json({ invites: fixtureServerInvites.filter((item) => item.invitee.id === requestUser.id && item.status === 'pending') });
  }
  const inviteAction = /^\/api\/v1\/servers\/invites\/([0-9a-f-]+)(\/accept)?$/.exec(url.pathname);
  if (inviteAction) {
    const invite = fixtureServerInvites.find((item) => item.id === inviteAction[1] && item.status === 'pending');
    if (!invite) return json({ error: 'Invitation not found.' }, 404);
    if (inviteAction[2] && request.method === 'POST') {
      if (invite.invitee.id !== requestUser.id) return json({ error: 'Invitation not found.' }, 404);
      invite.status = 'accepted';
      fixtureServerMembers.get(invite.serverId).add(requestUser.id);
      return json({ server: fixtureServers.find((item) => item.id === invite.serverId) });
    }
    if (!inviteAction[2] && request.method === 'DELETE') {
      const server = fixtureServers.find((item) => item.id === invite.serverId);
      if (server?.ownerUserId !== requestUser.id) return json({ error: 'Invitation not found.' }, 404);
      invite.status = 'cancelled';
      response.writeHead(204); return response.end();
    }
  }
  const serverDetail = /^\/api\/v1\/servers\/([0-9a-f-]+)$/.exec(url.pathname);
  if (serverDetail && request.method === 'GET') {
    const selected = fixtureServers.find((item) => item.id === serverDetail[1] && fixtureServerMembers.get(item.id)?.has(requestUser.id));
    return selected ? json({ server: selected }) : json({ error: 'Server not found.' }, 404);
  }
  const serverInvites = /^\/api\/v1\/servers\/([0-9a-f-]+)\/invites$/.exec(url.pathname);
  if (serverInvites) {
    const selected = fixtureServers.find((item) => item.id === serverInvites[1]);
    if (selected?.ownerUserId !== requestUser.id) return json({ error: 'Server not found.' }, 404);
    if (request.method === 'GET') return json({ invites: fixtureServerInvites.filter((item) => item.serverId === selected.id && item.status === 'pending') });
    if (request.method === 'POST') {
      const payload = JSON.parse((await body()).toString());
      if (!fixtureServerFriends || payload.userId !== (isPeer ? user.id : peer.id)) return json({ error: 'You can only invite friends.' }, 403);
      if (fixtureServerMembers.get(selected.id)?.has(payload.userId)) return json({ error: 'Already a member.' }, 409);
      if (fixtureServerInvites.some((item) => item.serverId === selected.id && item.invitee.id === payload.userId && item.status === 'pending')) return json({ error: 'Already pending.' }, 409);
      const invite = { id: randomUUID(), serverId: selected.id, serverName: selected.name, inviter: requestUser, invitee: isPeer ? user : peer, status: 'pending', createdAt: new Date().toISOString() };
      fixtureServerInvites.push(invite);
      return json({ invite }, 201);
    }
  }
  const serverMembers = /^\/api\/v1\/servers\/([0-9a-f-]+)\/members$/.exec(url.pathname);
  if (serverMembers && request.method === 'GET') {
    const selected = fixtureServers.find((item) => item.id === serverMembers[1]);
    const members = fixtureServerMembers.get(serverMembers[1]);
    if (!selected || !members?.has(requestUser.id)) return json({ error: 'Server not found.' }, 404);
    return json({ members: [...members].map((id) => ({ ...(id === user.id ? user : peer), owner: id === selected.ownerUserId })) });
  }
  const serverMemberRemove = /^\/api\/v1\/servers\/([0-9a-f-]+)\/members\/(fixture-user|fixture-peer)$/.exec(url.pathname);
  if (serverMemberRemove && request.method === 'DELETE') {
    const selected = fixtureServers.find((item) => item.id === serverMemberRemove[1]);
    const members = fixtureServerMembers.get(serverMemberRemove[1]);
    if (!selected || !members?.has(requestUser.id)) return json({ error: 'Server member not found.' }, 404);
    if (selected.ownerUserId !== requestUser.id) return json({ error: 'Only the server owner can remove members.' }, 403);
    if (selected.ownerUserId === serverMemberRemove[2]) return json({ error: 'The server owner cannot be removed.' }, 403);
    if (!members.has(serverMemberRemove[2])) return json({ error: 'Server member not found.' }, 404);
    members.delete(serverMemberRemove[2]);
    for (const channel of fixtureChannels.filter((item) => item.serverId === selected.id)) {
      for (const [socketId, userId] of fixtureSockets) {
        if (userId === serverMemberRemove[2]) io.sockets.sockets.get(socketId)?.emit('conversation:removed', { conversationId: channel.conversationId });
      }
    }
    response.writeHead(204); return response.end();
  }
  const serverLeave = /^\/api\/v1\/servers\/([0-9a-f-]+)\/leave$/.exec(url.pathname);
  if (serverLeave && request.method === 'POST') {
    const selected = fixtureServers.find((item) => item.id === serverLeave[1]);
    const members = fixtureServerMembers.get(serverLeave[1]);
    if (!selected || !members?.has(requestUser.id)) return json({ error: 'Server not found.' }, 404);
    if (selected.ownerUserId === requestUser.id) return json({ error: 'Owner cannot leave.' }, 403);
    members.delete(requestUser.id);
    response.writeHead(204); return response.end();
  }
  const serverChannels = /^\/api\/v1\/servers\/([0-9a-f-]+)\/channels$/.exec(url.pathname);
  const categoryRoute = /^\/api\/v1\/servers\/([0-9a-f-]+)\/categories(?:\/([0-9a-f-]+)(?:\/(move))?)?$/.exec(url.pathname);
  const channelMoveRoute = /^\/api\/v1\/servers\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)\/move$/.exec(url.pathname);
  const compact = (rows) => rows.sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).forEach((item, index) => { item.position = index; });
  if (categoryRoute) {
    const selected = fixtureServers.find((item) => item.id === categoryRoute[1] && fixtureServerMembers.get(item.id)?.has(requestUser.id));
    if (!selected) return json({ error: 'Server not found.' }, 404);
    const current = fixtureCategories.find((item) => item.id === categoryRoute[2] && item.serverId === selected.id);
    if (request.method === 'GET' && !categoryRoute[2]) return json({ categories: fixtureCategories.filter((item) => item.serverId === selected.id).sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt)) });
    if (selected.ownerUserId !== requestUser.id) return json({ error: 'Owner only.' }, 403);
    if (categoryRoute[2] && !current) return json({ error: 'Category not found.' }, 404);
    const payload = request.method === 'DELETE' ? {} : JSON.parse((await body()).toString());
    if (request.method === 'POST' && !current) {
      const name = typeof payload.name === 'string' ? payload.name.trim() : '';
      if (!name || name.length > 96) return json({ error: 'Invalid category.' }, 400);
      const now = new Date().toISOString();
      const category = { id: randomUUID(), serverId: selected.id, name, position: fixtureCategories.filter((item) => item.serverId === selected.id).length, createdAt: now, updatedAt: now };
      fixtureCategories.push(category);
      return json({ category }, 201);
    }
    if (request.method === 'PATCH') {
      const name = typeof payload.name === 'string' ? payload.name.trim() : '';
      if (!name || name.length > 96) return json({ error: 'Invalid category.' }, 400);
      current.name = name; current.updatedAt = new Date().toISOString(); return json({ category: current });
    }
    if (request.method === 'DELETE') {
      const uncategorized = fixtureChannels.filter((item) => item.serverId === selected.id && item.categoryId === null);
      const contained = fixtureChannels.filter((item) => item.serverId === selected.id && item.categoryId === current.id);
      fixtureCategories = fixtureCategories.filter((item) => item.id !== current.id);
      contained.forEach((item) => { item.categoryId = null; });
      uncategorized.sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
      contained.sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
      [...uncategorized, ...contained].forEach((item, index) => { item.position = index; });
      compact(fixtureCategories.filter((item) => item.serverId === selected.id));
      response.writeHead(204); return response.end();
    }
    if (request.method === 'POST' && categoryRoute[3] === 'move') {
      const ordered = fixtureCategories.filter((item) => item.serverId === selected.id).sort((a, b) => a.position - b.position);
      if (!Number.isInteger(payload.targetIndex) || payload.targetIndex < 0 || payload.targetIndex >= ordered.length) return json({ error: 'Invalid index.' }, 400);
      ordered.splice(ordered.indexOf(current), 1); ordered.splice(payload.targetIndex, 0, current);
      ordered.forEach((item, index) => { item.position = index; }); return json({ categories: ordered });
    }
  }
  if (channelMoveRoute && request.method === 'POST') {
    const selected = fixtureServers.find((item) => item.id === channelMoveRoute[1] && fixtureServerMembers.get(item.id)?.has(requestUser.id));
    if (!selected) return json({ error: 'Server not found.' }, 404);
    if (selected.ownerUserId !== requestUser.id) return json({ error: 'Owner only.' }, 403);
    const channel = fixtureChannels.find((item) => item.id === channelMoveRoute[2] && item.serverId === selected.id);
    if (!channel) return json({ error: 'Channel not found.' }, 404);
    const payload = JSON.parse((await body()).toString());
    if (payload.targetCategoryId && !fixtureCategories.some((item) => item.id === payload.targetCategoryId && item.serverId === selected.id)) return json({ error: 'Category not found.' }, 404);
    const ordered = (items) => items.sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const source = ordered(fixtureChannels.filter((item) => item.serverId === selected.id && item.categoryId === channel.categoryId && item.id !== channel.id));
    const target = channel.categoryId === payload.targetCategoryId ? source : ordered(fixtureChannels.filter((item) => item.serverId === selected.id && item.categoryId === payload.targetCategoryId));
    if (!Number.isInteger(payload.targetIndex) || payload.targetIndex < 0 || payload.targetIndex > target.length) return json({ error: 'Invalid index.' }, 400);
    channel.categoryId = payload.targetCategoryId; target.splice(payload.targetIndex, 0, channel);
    source.forEach((item, index) => { item.position = index; });
    target.forEach((item, index) => { item.position = index; });
    return json({ moved: true });
  }
  if (serverChannels) {
    const selected = fixtureServers.find((item) => item.id === serverChannels[1] && fixtureServerMembers.get(item.id)?.has(requestUser.id));
    if (!selected) return json({ error: 'Server not found.' }, 404);
    if (request.method === 'GET') return json({ channels: fixtureChannels.filter((item) => item.serverId === selected.id).sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)) });
    if (request.method === 'POST') {
      if (selected.ownerUserId !== requestUser.id) return json({ error: 'Only owner can create channels.' }, 403);
      const payload = JSON.parse((await body()).toString());
      const name = typeof payload.name === 'string' ? payload.name.trim() : '';
      if (!name || name.length > 96) return json({ error: 'Invalid channel name.' }, 400);
      if (payload.categoryId && !fixtureCategories.some((item) => item.id === payload.categoryId && item.serverId === selected.id)) return json({ error: 'Category not found.' }, 404);
      const now = new Date().toISOString();
      const categoryId = payload.categoryId || null;
      const channel = { id: randomUUID(), serverId: selected.id, conversationId: randomUUID(), categoryId, position: fixtureChannels.filter((item) => item.serverId === selected.id && item.categoryId === categoryId).length, name, createdAt: now, updatedAt: now };
      fixtureChannels.push(channel);
      return json({ channel }, 201);
    }
  }
  if (url.pathname === '/api/v1/social/requests') return json({ requests: [] });
  if (url.pathname === '/api/v1/groups/invites') return json({ invites: [] });
  if (url.pathname === `/api/v1/groups/${group}`) return json({ group: { id: group, title: 'Fixture group', members: groupMembers, invites: [], currentRole: isPeer ? 'member' : 'owner' } });
  if (url.pathname === '/api/v1/conversations') return json({ conversations: [
    { id: dm, kind: 'direct', peer: isPeer ? user : peer },
    { id: group, kind: 'group', title: 'Fixture group', memberCount: groupMembers.length }
  ] });
  if (url.pathname.endsWith('/messages')) {
    const conversationId = url.pathname.split('/')[4];
    const channel = fixtureChannels.find((item) => item.conversationId === conversationId);
    if (channel && !fixtureServerMembers.get(channel.serverId)?.has(requestUser.id)) return json({ error: 'Conversation not found.' }, 404);
    if (request.method === 'POST') {
      const payload = JSON.parse((await body()).toString());
      const target = messages.find((item) => item.id === payload.replyToMessageId);
      const message = { id: randomUUID(), conversationId, senderId: requestUser.id, senderDisplayName: requestUser.displayName, createdAt: new Date().toISOString(), body: payload.body,
        editedAt: null, deletedAt: null, attachments: payload.attachmentIds.map((id) => staged.get(id)), clientMessageId: payload.clientMessageId,
        reactions: [],
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
  const reactionAction = /^\/api\/v1\/conversations\/([^/]+)\/messages\/([^/]+)\/reactions$/.exec(url.pathname);
  if (reactionAction && (request.method === 'PUT' || request.method === 'DELETE')) {
    const payload = JSON.parse((await body()).toString());
    const message = messages.find((item) => item.conversationId === reactionAction[1] && item.id === reactionAction[2]);
    if (!message) return json({ error: 'Message not found.' }, 404);
    const existing = message.reactions.find((item) => item.reaction === payload.reaction);
    let changed = false;
    if (request.method === 'PUT' && !existing?.reactedByCurrentUser) {
      if (existing) {
        existing.count += 1;
        existing.reactedByCurrentUser = true;
      } else {
        message.reactions.push({ reaction: payload.reaction, count: 1, reactedByCurrentUser: true });
      }
      changed = true;
    } else if (request.method === 'DELETE' && existing?.reactedByCurrentUser) {
      existing.count -= 1;
      existing.reactedByCurrentUser = false;
      if (existing.count === 0) message.reactions = message.reactions.filter((item) => item !== existing);
      changed = true;
    }
    if (changed) io.emit('message:reactions', { conversationId: message.conversationId, messageId: message.id,
      userId: user.id, reaction: payload.reaction, active: request.method === 'PUT',
      reactions: message.reactions.map(({ reaction, count }) => ({ reaction, count })) });
    return json({ messageId: message.id, reactions: message.reactions, changed });
  }
  if (url.pathname.endsWith('/attachments') && request.method === 'POST') {
    const upload = (await body()).toString();
    const name = /filename="([^"]+)"/.exec(upload)?.[1] ?? 'upload.png';
    const item = attachment(name);
    item.conversationId = url.pathname.split('/')[4];
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
  const socketUserId = socket.handshake.headers.cookie?.includes('cubic_session=browser-peer') ? peer.id : user.id;
  fixtureSockets.set(socket.id, socketUserId);
  fixturePresence.set(socketUserId, 'online');
  io.emit('presence:changed', { userId: socketUserId, status: 'online' });
  socket.emit('realtime:ready', { userId: socketUserId, conversationCount: 2 });
  socket.on('conversation:join', (_event, ack) => ack?.({ ok: true }));
  socket.on('presence:snapshot', (_event, ack) => {
    const result = { ok: true, statuses: Object.fromEntries(groupMembers.map((member) => [member.id, fixturePresence.get(member.id) ?? 'offline'])) };
    if (holdPresenceSnapshots) heldPresenceSnapshots.push(() => ack?.(result));
    else ack?.(result);
  });
  socket.on('presence:set', (event, ack) => {
    if (!event || !['active', 'idle'].includes(event.state)) return ack?.({ ok: false });
    const status = event.state === 'active' ? 'online' : 'idle';
    fixturePresence.set(socketUserId, status);
    io.emit('presence:changed', { userId: socketUserId, status });
    ack?.({ ok: true });
  });
  socket.on('call:sync', (_event, ack) => ack?.({ ok: true, call: null }));
  socket.on('disconnect', () => {
    fixtureSockets.delete(socket.id);
    if (![...fixtureSockets.values()].includes(socketUserId)) {
      fixturePresence.set(socketUserId, 'offline');
      io.emit('presence:changed', { userId: socketUserId, status: 'offline' });
    }
  });
});
server.listen(3198, '127.0.0.1');
const web = spawn(process.execPath, ['server.mjs'], {
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: '3197',
    API_INTERNAL_URL: 'http://127.0.0.1:3198',
    TRUST_PROXY_CIDRS: '127.0.0.1/32,::1/128'
  },
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
