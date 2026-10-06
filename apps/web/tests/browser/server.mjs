// Isolated, in-memory API fixtures: never connects to PostgreSQL or live services.
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { Server } from 'socket.io';
import sharp from 'sharp';

const user = { id: 'fixture-user', username: 'tester', displayName: 'Tester', avatarUrl: null };
const peer = { id: 'fixture-peer', username: 'peer', displayName: 'Fixture DM', avatarUrl: null };
const dm = '11111111-1111-4111-8111-111111111111';
const group = '22222222-2222-4222-8222-222222222222';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
const fixtureIconWebp = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#f25252' } }).webp().toBuffer();
const animatedGif = Buffer.from('47494638396101000100800000000000ffffff21f90400000000002c000000000100010000020244010021f90400000000002c00000000010001000002024c01003b', 'hex');
let messages;
let staged;
let videoBytes;
let sessionMode;
let fixtureSettings;
let settingsFailNext;
let activeSessions;
let fixturePassword;
let fixtureEmail;
let fixtureEmailVerifiedAt;
let fixtureMailMode;
let fixtureMail;
let fixtureEmailTokens;
let fixtureResetTokens;
let fixturePasskeys;
let fixturePasskeyChallenge;
let fixturePasskeyAuthenticationChallenges;
let fixturePasskeyReauthChallenge;
let fixturePasskeyReauthAt;
let fixtureSessionValid;
let groupMembers;
let fixtureServers;
let fixtureIconCounter;
let fixtureChannels;
let fixtureVoiceChannels;
let fixtureServerVoiceConnected;
let fixtureCategories;
let fixtureServerMembers;
let fixtureServerRoles;
let fixtureRoleAssignments;
let fixtureServerInvites;
let fixtureShareInviteLinks;
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
  fixturePassword = 'test-only-password';
  fixtureEmail = 'tester@example.test';
  fixtureEmailVerifiedAt = null;
  fixtureMailMode = 'enabled';
  fixtureMail = [];
  fixtureEmailTokens = [];
  fixtureResetTokens = [];
  fixturePasskeys = [];
  fixturePasskeyChallenge = null;
  fixturePasskeyAuthenticationChallenges = [];
  fixturePasskeyReauthChallenge = null;
  fixturePasskeyReauthAt = null;
  fixtureSessionValid = true;
  fixtureSettings = { theme: 'dark', compactMode: false, reduceMotion: false, inputVolume: 100, outputVolume: 100 };
  settingsFailNext = false;
  fixtureServers = [];
  fixtureIconCounter = 0;
  fixtureChannels = [];
  fixtureVoiceChannels = [];
  fixtureServerVoiceConnected = false;
  fixtureCategories = [];
  fixtureServerMembers = new Map();
  fixtureServerRoles = new Map();
  fixtureRoleAssignments = new Map();
  fixtureServerInvites = [];
  fixtureShareInviteLinks = [];
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
  if (url.pathname === '/__test/mail-mode') { fixtureMailMode = url.searchParams.get('value') ?? 'enabled'; return json({ ok: true }); }
  if (url.pathname === '/__test/mail') return json({ messages: fixtureMail });
  if (url.pathname === '/__test/email-verified') { fixtureEmailVerifiedAt = url.searchParams.get('value') === 'true' ? new Date().toISOString() : null; return json({ ok: true }); }
  if (url.pathname === '/__test/server-friends') { fixtureServerFriends = true; return json({ ok: true }); }
  if (url.pathname === '/__test/server-voice-connected') {
    fixtureServerVoiceConnected = true;
    return json({ ok: true });
  }
  if (url.pathname === '/__test/server-member' && request.method === 'POST') {
    const members = fixtureServerMembers.get(url.searchParams.get('serverId'));
    if (!members) return json({ error: 'Server not found.' }, 404);
    members.add(peer.id);
    return json({ ok: true });
  }
  if (url.pathname === '/__test/session-mode') {
    sessionMode = url.searchParams.get('value') ?? 'ok';
    return json({ ok: true });
  }
  if (url.pathname === '/__test/settings' && request.method === 'POST') {
    const update = JSON.parse((await body()).toString());
    fixtureSettings = { ...fixtureSettings, ...update };
    return json({ settings: fixtureSettings });
  }
  if (url.pathname === '/__test/settings-fail-next') { settingsFailNext = true; return json({ ok: true }); }
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
  if (url.pathname === '/api/v1/auth/capabilities') return json({ passwordRecoveryAvailable: fixtureMailMode !== 'disabled' });
  if (url.pathname === '/api/v1/auth/passkeys/authentication/options' && request.method === 'POST') {
    const options = await generateAuthenticationOptions({ rpID: 'localhost', allowCredentials: [], userVerification: 'required', timeout: 300000 });
    const challengeId = randomUUID();
    fixturePasskeyAuthenticationChallenges.push({ id: challengeId, challenge: options.challenge, expiresAt: Date.now() + 300000, used: false });
    return json({ challengeId, options });
  }
  if (url.pathname === '/api/v1/auth/passkeys/authentication/complete' && request.method === 'POST') {
    const payload = JSON.parse((await body()).toString());
    const challenge = fixturePasskeyAuthenticationChallenges.find((entry) => entry.id === payload.challengeId && !entry.used && entry.expiresAt > Date.now());
    const credential = fixturePasskeys.find((entry) => entry.credentialId === payload.response?.id);
    if (!challenge || !credential || !fixtureEmailVerifiedAt) return json({ error: 'Passkey sign-in could not be completed.' }, 401);
    try {
      const verified = await verifyAuthenticationResponse({ response: payload.response,
        expectedChallenge: challenge.challenge, expectedOrigin: 'http://localhost:3197', expectedRPID: 'localhost',
        credential: { id: credential.credentialId, publicKey: credential.publicKey, counter: credential.counter, transports: credential.transports },
        requireUserVerification: true });
      if (!verified.verified) return json({ error: 'Passkey sign-in could not be completed.' }, 401);
      challenge.used = true;
      credential.counter = verified.authenticationInfo.newCounter;
      credential.lastUsedAt = new Date().toISOString();
      fixtureSessionValid = true;
      activeSessions.unshift({ id: randomUUID(), current: true, client: 'Chrome on Linux', createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 86400000).toISOString() });
      response.setHeader('set-cookie', 'cubic_session=browser-fixture; Path=/; HttpOnly; SameSite=Lax');
      return json({ user });
    } catch { return json({ error: 'Passkey sign-in could not be completed.' }, 401); }
  }
  if (url.pathname === '/api/v1/auth/password/recovery' && request.method === 'POST') {
    const payload = JSON.parse((await body()).toString());
    if (typeof payload.identifier !== 'string' || !payload.identifier.trim() || payload.identifier.length > 254) return json({ error: 'Enter an email or username.' }, 400);
    const identifier = payload.identifier.trim().toLowerCase();
    if (fixtureMailMode === 'enabled' && fixtureEmailVerifiedAt && ['tester', fixtureEmail].includes(identifier)) {
      for (const entry of fixtureResetTokens) if (!entry.used) entry.superseded = true;
      const token = randomBytes(32).toString('base64url');
      fixtureResetTokens.push({ token, email: fixtureEmail, expiresAt: Date.now() + 1800000, used: false });
      fixtureMail.push({ purpose: 'password_reset', to: fixtureEmail, url: `http://127.0.0.1:3197/reset-password#token=${token}` });
    }
    return json({ message: 'If an eligible account exists, password reset instructions have been sent.' });
  }
  if (url.pathname === '/api/v1/auth/password/reset' && request.method === 'POST') {
    const payload = JSON.parse((await body()).toString());
    if (typeof payload.newPassword !== 'string' || payload.newPassword.length < 10 || payload.newPassword.length > 128) return json({ status: 'invalid' }, 400);
    const entry = fixtureResetTokens.find((item) => item.token === payload.token);
    if (!entry || entry.superseded || entry.email !== fixtureEmail || !fixtureEmailVerifiedAt) return json({ status: 'invalid' }, 400);
    if (entry.used) return json({ status: 'used' }, 400);
    if (entry.expiresAt <= Date.now()) return json({ status: 'expired' }, 400);
    entry.used = true;
    for (const pending of fixtureResetTokens) pending.used = true;
    for (const pending of fixtureEmailTokens) if (pending.purpose === 'change_email') pending.used = true;
    fixturePassword = payload.newPassword;
    fixtureSessionValid = false;
    activeSessions = [];
    return json({ status: 'changed' });
  }
  if (url.pathname === '/api/v1/auth/login' && request.method === 'POST') {
    const payload = JSON.parse((await body()).toString());
    if (payload.password !== fixturePassword) return json({ error: 'Invalid credentials.' }, 401);
    if (String(payload.identifier).toLowerCase() === 'tester@example.test' && fixtureEmail !== 'tester@example.test') return json({ error: 'Invalid credentials.' }, 401);
    const account = String(payload.identifier).toLowerCase().includes('peer') ? 'browser-peer' : 'browser-fixture';
    fixtureSessionValid = true;
    response.setHeader('set-cookie', `cubic_session=${account}; Path=/; HttpOnly; SameSite=Lax`);
    return json({ user: account === 'browser-peer' ? peer : user });
  }
  if (url.pathname === '/api/v1/auth/register' && request.method === 'POST') {
    response.setHeader('set-cookie', 'cubic_session=browser-peer; Path=/; HttpOnly; SameSite=Lax');
    return json({ user: peer });
  }
  if (url.pathname === '/api/v1/auth/email/verify' && request.method === 'POST') {
    const payload = JSON.parse((await body()).toString());
    const found = fixtureEmailTokens.find((entry) => entry.token === payload.token);
    if (!found) return json({ status: 'invalid' }, 400);
    if (found.used) return json({ status: 'used' }, 400);
    if (found.superseded) return json({ status: 'invalid' }, 400);
    if (found.expiresAt < Date.now()) return json({ status: 'expired' }, 400);
    found.used = true;
    fixtureEmailVerifiedAt = new Date().toISOString();
    if (found.purpose === 'change_email') { fixtureEmail = found.email; fixtureSessionValid = false; activeSessions = []; }
    return json({ status: found.purpose === 'change_email' ? 'changed' : 'verified' });
  }
  if (url.pathname === '/api/v1/server-invite-links/preview' && request.method === 'POST') {
    const payload = JSON.parse((await body()).toString());
    const link = fixtureShareInviteLinks.find((item) => item.token === payload.token && !item.revokedAt && Date.parse(item.expiresAt) > Date.now());
    if (!link) return json({ error: 'Invite unavailable.' }, 404);
    const server = fixtureServers.find((item) => item.id === link.serverId);
    if (!server) return json({ error: 'Invite unavailable.' }, 404);
    const preview = { valid: true, server: { id: server.id, name: server.name } };
    if (request.headers.cookie?.includes('cubic_session=browser-peer')) preview.alreadyMember = fixtureServerMembers.get(server.id)?.has(peer.id) ?? false;
    else if (request.headers.cookie?.includes('cubic_session=browser-fixture')) preview.alreadyMember = fixtureServerMembers.get(server.id)?.has(user.id) ?? false;
    return json(preview);
  }
  if (!isPeer && (!request.headers.cookie?.includes('cubic_session=browser-fixture') || !fixtureSessionValid)) return json({ error: 'Authentication required.' }, 401);
  const sendFixtureMail = (purpose, email) => {
    if (fixtureMailMode !== 'enabled') return false;
    for (const entry of fixtureEmailTokens) if (entry.purpose === purpose && !entry.used) entry.superseded = true;
    const token = randomBytes(32).toString('base64url');
    fixtureEmailTokens.push({ purpose, email, token, expiresAt: Date.now() + (purpose === 'change_email' ? 3600000 : 86400000), used: false });
    fixtureMail.push({ purpose, to: email, url: `http://127.0.0.1:3197/verify-email#token=${token}` });
    return true;
  };
  if (url.pathname === '/api/v1/auth/security' && request.method === 'GET') return json({ email: fixtureEmail, emailVerifiedAt: fixtureEmailVerifiedAt, mailDeliveryAvailable: fixtureMailMode !== 'disabled' });
  const publicPasskey = ({ id, label, createdAt, lastUsedAt, deviceType, backedUp }) => ({ id, label, createdAt, lastUsedAt, deviceType, backedUp });
  if (url.pathname === '/api/v1/auth/passkeys' && request.method === 'GET') return json({ passkeys: fixturePasskeys.map(publicPasskey) });
  if (url.pathname === '/api/v1/auth/passkeys/reauthentication/options' && request.method === 'POST') {
    if (isPeer || !fixtureEmailVerifiedAt || !fixturePasskeys.length) return json({ error: 'Passkey confirmation could not be completed.' }, 400);
    const options = await generateAuthenticationOptions({ rpID: 'localhost', timeout: 300000, userVerification: 'required',
      allowCredentials: fixturePasskeys.map((entry) => ({ id: entry.credentialId, transports: entry.transports })) });
    fixturePasskeyReauthChallenge = { id: randomUUID(), challenge: options.challenge, expiresAt: Date.now() + 300000, used: false };
    return json({ challengeId: fixturePasskeyReauthChallenge.id, options });
  }
  if (url.pathname === '/api/v1/auth/passkeys/reauthentication/complete' && request.method === 'POST') {
    const payload = JSON.parse((await body()).toString());
    const challenge = fixturePasskeyReauthChallenge;
    const credential = fixturePasskeys.find((entry) => entry.credentialId === payload.response?.id);
    if (isPeer || !challenge || challenge.id !== payload.challengeId || challenge.used || challenge.expiresAt <= Date.now() || !credential || !fixtureEmailVerifiedAt)
      return json({ error: 'Passkey confirmation could not be completed.' }, 400);
    try {
      const verified = await verifyAuthenticationResponse({ response: payload.response,
        expectedChallenge: challenge.challenge, expectedOrigin: 'http://localhost:3197', expectedRPID: 'localhost',
        credential: { id: credential.credentialId, publicKey: credential.publicKey, counter: credential.counter, transports: credential.transports },
        requireUserVerification: true });
      if (!verified.verified) return json({ error: 'Passkey confirmation could not be completed.' }, 400);
      challenge.used = true;
      credential.counter = verified.authenticationInfo.newCounter;
      credential.lastUsedAt = new Date().toISOString();
      fixturePasskeyReauthAt = Date.now();
      response.writeHead(204); response.end(); return;
    } catch { return json({ error: 'Passkey confirmation could not be completed.' }, 400); }
  }
  if (url.pathname === '/api/v1/auth/passkeys/options' && request.method === 'POST') {
    const payload = JSON.parse((await body()).toString());
    if (!fixtureEmailVerifiedAt) return json({ error: 'A verified email is required to add a passkey.' }, 409);
    if (payload.currentPassword === undefined ? !fixturePasskeyReauthAt || fixturePasskeyReauthAt <= Date.now() - 300000 : payload.currentPassword !== fixturePassword)
      return json({ error: payload.currentPassword === undefined ? 'Confirm with your password or passkey.' : 'Current password is incorrect.' }, 403);
    const options = await generateRegistrationOptions({ rpName: 'Cubic', rpID: 'localhost', userName: user.username,
      userDisplayName: user.displayName, userID: Buffer.from(user.id), attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: fixturePasskeys.map((entry) => ({ id: entry.credentialId, transports: entry.transports })) });
    fixturePasskeyChallenge = { id: randomUUID(), challenge: options.challenge, used: false, passkeyStepUp: payload.currentPassword === undefined };
    return json({ challengeId: fixturePasskeyChallenge.id, options });
  }
  if (url.pathname === '/api/v1/auth/passkeys/complete' && request.method === 'POST') {
    const payload = JSON.parse((await body()).toString());
    if (!fixturePasskeyChallenge || fixturePasskeyChallenge.id !== payload.challengeId || fixturePasskeyChallenge.used ||
      (fixturePasskeyChallenge.passkeyStepUp && (!fixturePasskeyReauthAt || fixturePasskeyReauthAt <= Date.now() - 300000))) return json({ error: 'Could not verify the passkey.' }, 400);
    try {
      const verified = await verifyRegistrationResponse({ response: payload.response,
        expectedChallenge: fixturePasskeyChallenge.challenge, expectedOrigin: 'http://localhost:3197', expectedRPID: 'localhost', requireUserVerification: true });
      if (!verified.verified || fixturePasskeys.some((entry) => entry.credentialId === verified.registrationInfo.credential.id)) return json({ error: 'Could not verify the passkey.' }, 400);
      fixturePasskeyChallenge.used = true;
      fixturePasskeys.push({ id: randomUUID(), label: typeof payload.label === 'string' ? payload.label.slice(0, 64) : 'Passkey',
        credentialId: verified.registrationInfo.credential.id, publicKey: verified.registrationInfo.credential.publicKey,
        counter: verified.registrationInfo.credential.counter, transports: payload.response.response.transports ?? [],
        deviceType: verified.registrationInfo.credentialDeviceType, backedUp: verified.registrationInfo.credentialBackedUp,
        createdAt: new Date().toISOString(), lastUsedAt: null });
      return json({ passkeys: fixturePasskeys.map(publicPasskey) }, 201);
    } catch { return json({ error: 'Could not verify the passkey.' }, 400); }
  }
  if (url.pathname.startsWith('/api/v1/auth/passkeys/') && request.method === 'PATCH') {
    const payload = JSON.parse((await body()).toString());
    const label = typeof payload.label === 'string' ? payload.label.trim().normalize('NFC') : '';
    if (Object.keys(payload).some((key) => key !== 'label') || !label || label.length > 64 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(label))
      return json({ error: 'Enter a passkey name between 1 and 64 characters.' }, 400);
    const credential = fixturePasskeys.find((entry) => entry.id === url.pathname.split('/').at(-1));
    if (!credential) return json({ error: 'Passkey not found.' }, 404);
    credential.label = label;
    return json({ passkey: publicPasskey(credential) });
  }
  if (url.pathname.startsWith('/api/v1/auth/passkeys/') && request.method === 'DELETE') {
    const payload = JSON.parse((await body()).toString());
    if (payload.currentPassword === undefined ? !fixturePasskeyReauthAt || fixturePasskeyReauthAt <= Date.now() - 300000 : payload.currentPassword !== fixturePassword)
      return json({ error: payload.currentPassword === undefined ? 'Confirm with your password or passkey.' : 'Current password is incorrect.' }, 403);
    const index = fixturePasskeys.findIndex((entry) => entry.id === url.pathname.split('/').at(-1));
    if (index < 0) return json({ error: 'Passkey not found.' }, 404);
    fixturePasskeys.splice(index, 1);
    fixturePasskeyReauthAt = null;
    response.writeHead(204); response.end(); return;
  }
  if (url.pathname === '/api/v1/auth/email/verification' && request.method === 'POST') {
    if (fixtureMailMode === 'disabled') return json({ error: 'Email delivery is not configured.' }, 503);
    if (fixtureMailMode === 'failure') return json({ error: 'Email delivery is temporarily unavailable. Try again later.' }, 503);
    if (fixtureEmailVerifiedAt) return json({ error: 'This email is already verified.' }, 409);
    sendFixtureMail('verify_email', fixtureEmail);
    return json({ message: 'Verification email sent.' });
  }
  if (url.pathname === '/api/v1/auth/email/change' && request.method === 'POST') {
    const payload = JSON.parse((await body()).toString());
    if (fixtureMailMode === 'disabled') return json({ error: 'Email delivery is not configured.' }, 503);
    if (typeof payload.newEmail !== 'string' || !payload.newEmail.includes('@') || !payload.currentPassword) return json({ error: 'Enter a valid new email and current password.' }, 400);
    if (payload.currentPassword !== fixturePassword) return json({ error: 'Current password is incorrect.' }, 403);
    const email = payload.newEmail.trim().toLowerCase();
    if (email === fixtureEmail) return json({ error: 'Enter a different email address.' }, 400);
    if (email === 'occupied@example.test') return json({ error: 'That email address is unavailable.' }, 409);
    if (fixtureMailMode === 'failure') return json({ error: 'Email delivery is temporarily unavailable. Try again later.' }, 503);
    sendFixtureMail('change_email', email);
    return json({ message: 'Verification email sent to the new address. Your current email remains unchanged until verification.' });
  }
  if (url.pathname === '/api/v1/auth/password' && request.method === 'PATCH') {
    const payload = JSON.parse((await body()).toString());
    if (!payload.currentPassword || typeof payload.newPassword !== 'string' || payload.newPassword.length < 10 || payload.newPassword.length > 128 || payload.newPassword !== payload.confirmPassword) return json({ error: 'Invalid password change.' }, 400);
    if (payload.currentPassword !== fixturePassword) return json({ error: 'Current password is incorrect.' }, 403);
    fixturePassword = payload.newPassword;
    activeSessions = activeSessions.filter((session) => session.current);
    return json({ message: 'Password changed. Other sessions were signed out.' });
  }
  const requestUser = isPeer ? peer : user;
  if (url.pathname === '/api/v1/users/me/settings' && request.method === 'GET') return json({ settings: fixtureSettings });
  if (url.pathname === '/api/v1/users/me/settings' && request.method === 'PATCH') {
    const change = JSON.parse((await body()).toString());
    if (settingsFailNext) { settingsFailNext = false; return json({ error: 'Temporary settings failure.' }, 503); }
    if (Object.keys(change).some((key) => !['compactMode', 'reduceMotion', 'theme', 'inputVolume', 'outputVolume'].includes(key))) return json({ error: 'Invalid settings.' }, 400);
    fixtureSettings = { ...fixtureSettings, ...change };
    return json({ settings: fixtureSettings });
  }
  if (url.pathname === '/api/v1/server-invite-links/join' && request.method === 'POST') {
    const payload = JSON.parse((await body()).toString());
    const link = fixtureShareInviteLinks.find((item) => item.token === payload.token && !item.revokedAt && Date.parse(item.expiresAt) > Date.now());
    if (!link) return json({ error: 'Invite unavailable.' }, 404);
    const selected = fixtureServers.find((item) => item.id === link.serverId);
    if (!selected) return json({ error: 'Invite unavailable.' }, 404);
    const alreadyMember = fixtureServerMembers.get(selected.id).has(requestUser.id);
    fixtureServerMembers.get(selected.id).add(requestUser.id);
    return json({ server: { id: selected.id, name: selected.name }, joined: !alreadyMember, alreadyMember });
  }
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
    const kind = uploaded.includes(Buffer.from('GIF89a')) ? 'gif'
      : uploaded.includes(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png' : null;
    if (!kind) return json({ error: 'Use a supported image.' }, 415);
    requestUser.avatarUrl = `/api/v1/users/${requestUser.id}/avatar/test.${kind}`;
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
  const avatarOwner = [user, peer].find((candidate) => url.pathname === candidate.avatarUrl && candidate.avatarUrl);
  if (avatarOwner) {
    const staticImage = avatarOwner.avatarUrl.endsWith('.png');
    response.writeHead(200, { 'content-type': staticImage ? 'image/png' : 'image/gif', 'x-content-type-options': 'nosniff' });
    response.end(staticImage ? png : animatedGif);
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
    const server = { id: randomUUID(), name, iconUrl: null, ownerUserId: requestUser.id, createdAt: now, updatedAt: now };
    fixtureServers.push(server);
    fixtureServerMembers.set(server.id, new Set([requestUser.id]));
    fixtureServerRoles.set(server.id, [{ id: server.id, name: '@everyone', position: 0, isDefault: true, permissions: ['VIEW_SERVER', 'SEND_MESSAGES', 'CONNECT', 'SPEAK', 'VIDEO', 'SCREEN_SHARE', 'VIEW_CHANNEL'] }]);
    fixtureRoleAssignments.set(server.id, new Map());
    return json({ server }, 201);
  }
  const serverIcon = /^\/api\/v1\/servers\/([0-9a-f-]+)\/icon$/.exec(url.pathname);
  if (serverIcon) {
    const selected = fixtureServers.find((item) => item.id === serverIcon[1]);
    if (!selected || !fixtureServerMembers.get(selected.id)?.has(requestUser.id)) return json({ error: 'Server not found.' }, 404);
    if (request.method === 'GET') {
      if (!selected.iconUrl) return json({ error: 'Server icon not found.' }, 404);
      response.writeHead(200, { 'content-type': 'image/webp', 'cache-control': 'private, no-store' });
      return response.end(fixtureIconWebp);
    }
    if (selected.ownerUserId !== requestUser.id) return json({ error: 'Only the server owner can manage icons.' }, 403);
    if (request.method === 'PUT') {
      const upload = await body();
      if (!upload.includes(png)) return json({ error: 'Use a valid JPEG, PNG or WebP image.' }, 415);
      selected.iconUrl = `/api/v1/servers/${selected.id}/icon?v=${++fixtureIconCounter}`;
      selected.updatedAt = new Date().toISOString();
      return json({ server: selected });
    }
    if (request.method === 'DELETE') {
      selected.iconUrl = null;
      selected.updatedAt = new Date().toISOString();
      return json({ server: selected });
    }
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
  const shareLinks = /^\/api\/v1\/servers\/([0-9a-f-]+)\/invite-links(?:\/([0-9a-f-]+)\/revoke)?$/.exec(url.pathname);
  if (shareLinks) {
    const selected = fixtureServers.find((item) => item.id === shareLinks[1]);
    if (selected?.ownerUserId !== requestUser.id) return json({ error: 'Server not found.' }, 404);
    if (shareLinks[2]) {
      const link = fixtureShareInviteLinks.find((item) => item.id === shareLinks[2] && item.serverId === selected.id);
      if (!link) return json({ error: 'Invite link not found.' }, 404);
      link.revokedAt ??= new Date().toISOString();
      return json({ inviteLink: { id: link.id, createdAt: link.createdAt, expiresAt: link.expiresAt, revokedAt: link.revokedAt } });
    }
    if (request.method === 'GET') return json({ inviteLinks: fixtureShareInviteLinks.filter((item) => item.serverId === selected.id).map(({ token, serverId, ...metadata }) => metadata) });
    if (request.method === 'POST') {
      const createdAt = new Date().toISOString();
      const link = { id: randomUUID(), serverId: selected.id, token: randomUUID().replaceAll('-', '') + 'abcdefghijk', createdAt, expiresAt: new Date(Date.parse(createdAt) + 7 * 24 * 60 * 60 * 1000).toISOString(), revokedAt: null };
      fixtureShareInviteLinks.push(link);
      return json({ inviteLink: { id: link.id, createdAt: link.createdAt, expiresAt: link.expiresAt, revokedAt: null }, token: link.token }, 201);
    }
  }
  const serverMembers = /^\/api\/v1\/servers\/([0-9a-f-]+)\/members$/.exec(url.pathname);
  if (serverMembers && request.method === 'GET') {
    const selected = fixtureServers.find((item) => item.id === serverMembers[1]);
    const members = fixtureServerMembers.get(serverMembers[1]);
    if (!selected || !members?.has(requestUser.id)) return json({ error: 'Server not found.' }, 404);
    return json({ members: [...members].map((id) => ({ ...(id === user.id ? user : peer), owner: id === selected.ownerUserId,
      roleIds: [...(fixtureRoleAssignments.get(selected.id)?.get(id) ?? [])],
      highestRolePosition: Math.max(0, ...[...(fixtureRoleAssignments.get(selected.id)?.get(id) ?? [])].map((roleId) => fixtureServerRoles.get(selected.id)?.find((role) => role.id === roleId)?.position ?? 0)) })) });
  }
  const serverRoles = /^\/api\/v1\/servers\/([0-9a-f-]+)\/roles(?:\/([0-9a-f-]+))?$/.exec(url.pathname);
  if (serverRoles) {
    const selected = fixtureServers.find((item) => item.id === serverRoles[1]);
    if (!selected || !fixtureServerMembers.get(selected.id)?.has(requestUser.id)) return json({ error: 'Server not found.' }, 404);
    const roles = fixtureServerRoles.get(selected.id) ?? [];
    if (request.method === 'GET' && !serverRoles[2]) return json({ roles: [...roles].sort((a, b) => b.position - a.position), permissionNames: ['VIEW_SERVER', 'MANAGE_SERVER', 'MANAGE_ROLES', 'MANAGE_CHANNELS', 'MANAGE_INVITES', 'KICK_MEMBERS', 'SEND_MESSAGES', 'MANAGE_MESSAGES', 'CONNECT', 'SPEAK', 'VIDEO', 'SCREEN_SHARE', 'VIEW_CHANNEL'] });
    if (selected.ownerUserId !== requestUser.id) return json({ error: 'Role management denied.' }, 403);
    if (request.method === 'POST' && !serverRoles[2]) {
      const payload = JSON.parse((await body()).toString());
      const role = { id: randomUUID(), name: payload.name.trim(), position: Math.max(...roles.map((item) => item.position)) + 1, isDefault: false, permissions: payload.permissions ?? [] };
      roles.push(role);
      return json({ role }, 201);
    }
    const role = roles.find((item) => item.id === serverRoles[2]);
    if (!role) return json({ error: 'Role not found.' }, 404);
    if (request.method === 'PATCH') {
      const payload = JSON.parse((await body()).toString());
      if (role.isDefault && payload.name !== undefined) return json({ error: 'Default role is fixed.' }, 403);
      role.name = payload.name ?? role.name;
      role.permissions = payload.permissions ?? role.permissions;
      return json({ role });
    }
    if (request.method === 'DELETE' && !role.isDefault) {
      roles.splice(roles.indexOf(role), 1);
      for (const assignments of fixtureRoleAssignments.get(selected.id)?.values() ?? []) assignments.delete(role.id);
      response.writeHead(204); return response.end();
    }
  }
  const memberRole = /^\/api\/v1\/servers\/([0-9a-f-]+)\/members\/(fixture-user|fixture-peer)\/roles\/([0-9a-f-]+)$/.exec(url.pathname);
  if (memberRole) {
    const selected = fixtureServers.find((item) => item.id === memberRole[1]);
    const role = fixtureServerRoles.get(memberRole[1])?.find((item) => item.id === memberRole[3] && !item.isDefault);
    if (!selected || !role || !fixtureServerMembers.get(selected.id)?.has(memberRole[2])) return json({ error: 'Role not found.' }, 404);
    if (selected.ownerUserId !== requestUser.id || memberRole[2] === selected.ownerUserId) return json({ error: 'Role management denied.' }, 403);
    let assignments = fixtureRoleAssignments.get(selected.id)?.get(memberRole[2]);
    if (!assignments) { assignments = new Set(); fixtureRoleAssignments.get(selected.id)?.set(memberRole[2], assignments); }
    const had = assignments.has(role.id);
    if (request.method === 'PUT') assignments.add(role.id);
    else if (request.method === 'DELETE') assignments.delete(role.id);
    return json(request.method === 'PUT' ? { assigned: !had } : { removed: had });
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
    for (const [socketId, userId] of fixtureSockets) {
      if (userId === serverMemberRemove[2]) io.sockets.sockets.get(socketId)?.emit('server:removed', { serverId: selected.id });
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
  const canManageChannels = (selected) => selected.ownerUserId === requestUser.id ||
    (fixtureServerRoles.get(selected.id) ?? []).some((role) => role.permissions.includes('MANAGE_CHANNELS') &&
      (role.isDefault || fixtureRoleAssignments.get(selected.id)?.get(requestUser.id)?.has(role.id)));
  const channelManagement = /^\/api\/v1\/servers\/([0-9a-f-]+)\/channel-management$/.exec(url.pathname);
  if (channelManagement && request.method === 'GET') {
    const selected = fixtureServers.find((item) => item.id === channelManagement[1] && fixtureServerMembers.get(item.id)?.has(requestUser.id));
    if (!selected) return json({ error: 'Server not found.' }, 404);
    if (!canManageChannels(selected)) return json({ error: 'Channel management denied.' }, 403);
    return json({ canManageChannels: true, channels: fixtureChannels.filter((item) => item.serverId === selected.id),
      voiceChannels: fixtureVoiceChannels.filter((item) => item.serverId === selected.id),
      categories: fixtureCategories.filter((item) => item.serverId === selected.id) });
  }
  const textChannel = /^\/api\/v1\/servers\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)$/.exec(url.pathname);
  if (textChannel) {
    const selected = fixtureServers.find((item) => item.id === textChannel[1] && fixtureServerMembers.get(item.id)?.has(requestUser.id));
    if (!selected) return json({ error: 'Server not found.' }, 404);
    if (!canManageChannels(selected)) return json({ error: 'Channel management denied.' }, 403);
    const channel = fixtureChannels.find((item) => item.id === textChannel[2] && item.serverId === selected.id);
    if (!channel) return json({ error: 'Channel not found.' }, 404);
    if (request.method === 'DELETE') {
      fixtureChannels = fixtureChannels.filter((item) => item !== channel);
      messages = messages.filter((item) => item.conversationId !== channel.conversationId);
      response.writeHead(204); return response.end();
    }
    if (request.method === 'PATCH') {
      const payload = JSON.parse((await body()).toString());
      const name = typeof payload.name === 'string' ? payload.name.trim() : '';
      if (!name || name.length > 96) return json({ error: 'Invalid channel.' }, 400);
      channel.name = name; channel.updatedAt = new Date().toISOString(); return json({ channel });
    }
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
    if (!canManageChannels(selected)) return json({ error: 'Channel management denied.' }, 403);
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
      const uncategorized = [...fixtureChannels, ...fixtureVoiceChannels].filter((item) => item.serverId === selected.id && item.categoryId === null);
      const contained = [...fixtureChannels, ...fixtureVoiceChannels].filter((item) => item.serverId === selected.id && item.categoryId === current.id);
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
    if (!canManageChannels(selected)) return json({ error: 'Channel management denied.' }, 403);
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
  const typedMove = /^\/api\/v1\/servers\/([0-9a-f-]+)\/layout\/(text|voice)\/([0-9a-f-]+)\/move$/.exec(url.pathname);
  if (typedMove && request.method === 'POST') {
    const selected = fixtureServers.find((item) => item.id === typedMove[1] && fixtureServerMembers.get(item.id)?.has(requestUser.id));
    if (!selected) return json({ error: 'Server not found.' }, 404);
    if (!canManageChannels(selected)) return json({ error: 'Channel management denied.' }, 403);
    const all = [...fixtureChannels, ...fixtureVoiceChannels];
    const channel = (typedMove[2] === 'text' ? fixtureChannels : fixtureVoiceChannels).find((item) => item.id === typedMove[3] && item.serverId === selected.id);
    if (!channel) return json({ error: 'Channel not found.' }, 404);
    const payload = JSON.parse((await body()).toString());
    if (payload.targetCategoryId && !fixtureCategories.some((item) => item.id === payload.targetCategoryId && item.serverId === selected.id)) return json({ error: 'Category not found.' }, 404);
    const ordered = (items) => items.sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const source = ordered(all.filter((item) => item.serverId === selected.id && item.categoryId === channel.categoryId && item.id !== channel.id));
    const target = channel.categoryId === payload.targetCategoryId ? source : ordered(all.filter((item) => item.serverId === selected.id && item.categoryId === payload.targetCategoryId));
    if (!Number.isInteger(payload.targetIndex) || payload.targetIndex < 0 || payload.targetIndex > target.length) return json({ error: 'Invalid index.' }, 400);
    channel.categoryId = payload.targetCategoryId; target.splice(payload.targetIndex, 0, channel);
    source.forEach((item, index) => { item.position = index; });
    target.forEach((item, index) => { item.position = index; });
    return json({ moved: true });
  }
  const voiceChannels = /^\/api\/v1\/servers\/([0-9a-f-]+)\/voice-channels(?:\/([0-9a-f-]+))?$/.exec(url.pathname);
  if (voiceChannels) {
    const selected = fixtureServers.find((item) => item.id === voiceChannels[1] && fixtureServerMembers.get(item.id)?.has(requestUser.id));
    if (!selected) return json({ error: 'Server not found.' }, 404);
    if (request.method === 'GET' && !voiceChannels[2]) return json({ channels: fixtureVoiceChannels.filter((item) => item.serverId === selected.id).sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)) });
    if (!canManageChannels(selected)) return json({ error: 'Channel management denied.' }, 403);
    if (request.method === 'DELETE' && voiceChannels[2]) {
      const channel = fixtureVoiceChannels.find((item) => item.id === voiceChannels[2] && item.serverId === selected.id);
      if (!channel) return json({ error: 'Voice channel not found.' }, 404);
      fixtureVoiceChannels = fixtureVoiceChannels.filter((item) => item !== channel);
      response.writeHead(204); return response.end();
    }
    const payload = JSON.parse((await body()).toString());
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!name || name.length > 96) return json({ error: 'Invalid voice channel.' }, 400);
    if (request.method === 'PATCH' && voiceChannels[2]) {
      const channel = fixtureVoiceChannels.find((item) => item.id === voiceChannels[2] && item.serverId === selected.id);
      if (!channel) return json({ error: 'Voice channel not found.' }, 404);
      channel.name = name; channel.updatedAt = new Date().toISOString(); return json({ channel });
    }
    if (request.method === 'POST' && !voiceChannels[2]) {
      if (payload.categoryId && !fixtureCategories.some((item) => item.id === payload.categoryId && item.serverId === selected.id)) return json({ error: 'Category not found.' }, 404);
      const now = new Date().toISOString(); const categoryId = payload.categoryId || null;
      const channel = { id: randomUUID(), serverId: selected.id, categoryId, name,
        position: [...fixtureChannels, ...fixtureVoiceChannels].filter((item) => item.serverId === selected.id && item.categoryId === categoryId).length,
        createdAt: now, updatedAt: now };
      fixtureVoiceChannels.push(channel); return json({ channel }, 201);
    }
  }
  const voiceToken = /^\/api\/v1\/server-voice\/channels\/([0-9a-f-]+)\/token$/.exec(url.pathname);
  if (voiceToken && request.method === 'POST') {
    const channel = fixtureVoiceChannels.find((item) => item.id === voiceToken[1]);
    if (!channel || !fixtureServerMembers.get(channel.serverId)?.has(requestUser.id))
      return json({ error: 'Voice channel unavailable.' }, 404);
    if (!fixtureServerVoiceConnected) return json({ error: 'Fixture LiveKit unavailable.' }, 503);
    return json({ url: 'wss://fixture-livekit.invalid', token: `fixture-ticket:cubic-server-voice-${channel.id}` });
  }
  if (serverChannels) {
    const selected = fixtureServers.find((item) => item.id === serverChannels[1] && fixtureServerMembers.get(item.id)?.has(requestUser.id));
    if (!selected) return json({ error: 'Server not found.' }, 404);
    if (request.method === 'GET') return json({ channels: fixtureChannels.filter((item) => item.serverId === selected.id).sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)) });
    if (request.method === 'POST') {
      if (!canManageChannels(selected)) return json({ error: 'Channel management denied.' }, 403);
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
  socket.on('server:voice:subscribe', (event, ack) => {
    const member = fixtureServerMembers.get(event?.serverId)?.has(fixtureSockets.get(socket.id));
    ack?.({ ok: Boolean(member), presence: [] });
  });
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
// Build a test-only bundle so the media-transport seam is absent from normal
// production builds. The preview server and all Cubic UI/API calls stay real.
const browserBuild = spawnSync('npm', ['run', 'build', '--', '--mode', 'browser-test'], {
  cwd: new URL('../..', import.meta.url), stdio: 'inherit'
});
if (browserBuild.status !== 0) throw new Error('Could not build browser acceptance fixture.');
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
