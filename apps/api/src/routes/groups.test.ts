import assert from 'node:assert/strict';
import test from 'node:test';
import { groupRoutes, withGroupLock } from './groups.js';


test('group mutation lock serializes the critical section inside one transaction', async () => {
  const calls: string[] = [];
  const client = {
    async query(sql: string) {
      calls.push(sql);
      return { rows: [], rowCount: 0 };
    },
    release() { calls.push('release'); }
  };
  const database = { pool: { async connect() { return client; } } } as never;

  await withGroupLock(database, '00000000-0000-4000-8000-000000000001', async () => {
    calls.push('action');
    return 'ok';
  });

  assert.equal(calls[0], 'begin');
  assert.match(calls[1] ?? '', /pg_advisory_xact_lock/);
  assert.equal(calls[2], 'action');
  assert.equal(calls[3], 'commit');
  assert.equal(calls[4], 'release');
});

test('group mutation lock rolls back and releases on failure', async () => {
  const calls: string[] = [];
  const client = {
    async query(sql: string) {
      calls.push(sql);
      return { rows: [], rowCount: 0 };
    },
    release() { calls.push('release'); }
  };
  const database = { pool: { async connect() { return client; } } } as never;

  await assert.rejects(() => withGroupLock(database, '00000000-0000-4000-8000-000000000001', async () => {
    calls.push('action');
    throw new Error('boom');
  }));

  assert.ok(calls.includes('rollback'));
  assert.equal(calls.at(-1), 'release');
});

const groupId = '20000000-0000-4000-8000-000000000001';
const actorId = '10000000-0000-4000-8000-000000000001';
const targetId = '10000000-0000-4000-8000-000000000002';
const otherId = '10000000-0000-4000-8000-000000000003';
const invitedId = '10000000-0000-4000-8000-000000000004';
const inviteId = '30000000-0000-4000-8000-000000000001';

type Role = 'owner' | 'admin' | 'member';
type RouteHandler = (request: any, reply: any) => Promise<any>;

class GroupRouteDatabase {
  precheckRoles = new Map<string, Role>([[actorId, 'admin'], [targetId, 'member']]);
  lockedRoles = new Map<string, Role>([[actorId, 'admin'], [targetId, 'member']]);
  userIds = [actorId, targetId, otherId];
  precheckAvatarKey: string | null = 'precheck-avatar.png';
  avatarKey: string | null = 'old-avatar.png';
  title = 'Before';
  sequence: string[] = [];
  failMutation = false;

  db = {
    select: () => {
      const builder: any = {
        from: () => builder,
        where: () => builder,
        limit: async () => [{ id: 'friendship' }]
      };
      return builder;
    }
  };

  pool = {
    query: async (sql: string, params: any[] = []) => this.query(sql, params, false),
    connect: async () => ({
      query: async (sql: string, params: any[] = []) => this.query(sql, params, true),
      release: () => { this.sequence.push('release'); }
    })
  };

  private result(rows: any[] = [], rowCount = rows.length) {
    return { rows, rowCount };
  }

  async query(sql: string, params: any[], locked: boolean) {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') {
      this.sequence.push(normalized);
      return this.result();
    }
    if (normalized.includes('pg_advisory_xact_lock')) {
      this.sequence.push('lock');
      return this.result();
    }
    if (normalized.includes('join conversation_members m on m.conversation_id = c.id')) {
      const role = (locked ? this.lockedRoles : this.precheckRoles).get(params[1]);
      const rows = params[0] === groupId && role
        ? [{
            id: groupId,
            title: this.title,
            created_by: actorId,
            avatar_key: locked ? this.avatarKey : this.precheckAvatarKey,
            role
          }]
        : [];
      this.sequence.push(`${locked ? 'locked' : 'precheck'}:${params[1]}:${role ?? 'missing'}`);
      return this.result(rows);
    }
    if (normalized.startsWith('select user_id from conversation_members')) {
      this.sequence.push('snapshot-users');
      return this.result(this.userIds.map((user_id) => ({ user_id })));
    }
    if (normalized.startsWith('select count(*)::int as count from conversation_members')) {
      return this.result([{ count: this.userIds.length }]);
    }
    if (normalized.startsWith('select 1 from blocks')) return this.result();
    if (normalized.startsWith('insert into conversation_members')) {
      this.sequence.push('insert-member');
      if (!this.userIds.includes(params[1])) this.userIds.push(params[1]);
      this.lockedRoles.set(params[1], 'member');
      return this.result([{ user_id: params[1] }]);
    }
    if (normalized.startsWith('update group_invites')) return this.result();
    if (normalized.startsWith('update conversation_members set role = $3')) {
      this.sequence.push('update-role');
      this.lockedRoles.set(params[1], params[2]);
      return this.result([], 1);
    }
    if (normalized.startsWith("update conversation_members set role = 'admin'")) {
      this.sequence.push('demote-owner');
      this.lockedRoles.set(params[1], 'admin');
      return this.result([], 1);
    }
    if (normalized.startsWith("update conversation_members set role = 'owner'")) {
      this.sequence.push('promote-owner');
      this.lockedRoles.set(params[1], 'owner');
      return this.result([], 1);
    }
    if (normalized.startsWith('delete from conversation_members')) {
      this.sequence.push('delete-member');
      this.userIds = this.userIds.filter((id) => id !== params[1]);
      this.lockedRoles.delete(params[1]);
      return this.result([], 1);
    }
    if (normalized.startsWith('update conversations set title')) {
      if (this.failMutation) throw new Error('mutation failed');
      this.sequence.push('update-title');
      this.title = params[1];
      return this.result([], 1);
    }
    if (normalized.startsWith('update conversations set avatar_key')) {
      if (this.failMutation) throw new Error('mutation failed');
      this.sequence.push('update-avatar');
      this.avatarKey = params.length > 1 ? params[1] : null;
      return this.result([], 1);
    }
    if (normalized.startsWith('update conversations set updated_at')) return this.result([], 1);
    if (normalized.startsWith('delete from conversations')) {
      if (this.failMutation) throw new Error('mutation failed');
      this.sequence.push('delete-group');
      this.userIds = [];
      this.lockedRoles.clear();
      return this.result([], 1);
    }
    if (normalized.includes('join conversation_members mine')) {
      const role = this.lockedRoles.get(params[1]) ?? this.precheckRoles.get(params[1]);
      return this.result(role ? [{
        id: groupId,
        title: this.title,
        avatar_key: this.avatarKey,
        created_by: actorId,
        created_at: new Date('2026-09-14T12:00:00.000Z'),
        updated_at: new Date('2026-09-14T12:00:00.000Z'),
        role
      }] : []);
    }
    if (normalized.includes('from conversation_members cm join users u')) {
      return this.result(this.userIds.map((id) => ({
        id,
        username: `user-${id.at(-1)}`,
        display_name: `User ${id.at(-1)}`,
        avatar_url: null,
        role: this.lockedRoles.get(id) ?? 'member',
        joined_at: new Date('2026-09-14T12:00:00.000Z')
      })));
    }
    if (normalized.includes('from group_invites gi join users u')) return this.result();
    throw new Error(`Unexpected fixture SQL: ${normalized}`);
  }
}

async function groupRouteHarness(database = new GroupRouteDatabase()) {
  const handlers = new Map<string, RouteHandler>();
  const app = {
    get(path: string, _options: unknown, handler: RouteHandler) { handlers.set(`GET ${path}`, handler); },
    post(path: string, _options: unknown, handler: RouteHandler) { handlers.set(`POST ${path}`, handler); },
    patch(path: string, _options: unknown, handler: RouteHandler) { handlers.set(`PATCH ${path}`, handler); },
    delete(path: string, _options: unknown, handler: RouteHandler) { handlers.set(`DELETE ${path}`, handler); }
  };
  const deletedAvatarKeys: Array<string | null | undefined> = [];
  const events: Array<{ type: string; payload: any }> = [];
  const candidate = { key: 'new-avatar.png', contentType: 'image/png' as const };
  const mediaStore = {
    saveGroupAvatar: async () => {
      database.sequence.push('save:new-avatar.png');
      return candidate;
    },
    deleteGroupAvatar: async (key: string | null | undefined) => {
      deletedAvatarKeys.push(key);
      database.sequence.push(`delete-media:${key ?? 'none'}`);
    },
    readGroupAvatar: async () => { throw new Error('not used'); }
  };
  const realtimeEvents = {
    emitConversationOpened(payload: any) { events.push({ type: 'opened', payload }); },
    emitConversationChanged(payload: any) {
      database.sequence.push('event:changed');
      events.push({ type: 'changed', payload });
    },
    emitConversationRemoved(payload: any) {
      database.sequence.push('event:removed');
      events.push({ type: 'removed', payload });
    },
    emitGroupInvitesChanged(payload: any) { events.push({ type: 'invites', payload }); }
  };

  await groupRoutes(app as never, {
    database: database as never,
    cookieName: 'session',
    sessionService: {} as never,
    mediaStore: mediaStore as never,
    realtimeEvents: realtimeEvents as never,
    groupAvatarMaxBytes: 2_000_000
  });

  async function invoke(
    method: string,
    path: string,
    options: { userId?: string; params?: Record<string, string>; body?: unknown } = {}
  ) {
    const state = { statusCode: 200, payload: undefined as any };
    const reply = {
      code(code: number) { state.statusCode = code; return reply; },
      send(payload?: any) { state.payload = payload; return payload; }
    };
    const request = {
      auth: { user: { id: options.userId ?? actorId } },
      params: { id: groupId, userId: targetId, ...(options.params ?? {}) },
      body: options.body,
      file: async () => ({
        file: { truncated: false },
        toBuffer: async () => Buffer.from('avatar')
      })
    };
    await handlers.get(`${method} ${path}`)!(request, reply);
    return state;
  }

  return { database, deletedAvatarKeys, events, invoke };
}

test('rename makes its final management decision from the locked membership', async () => {
  const harness = await groupRouteHarness();
  harness.database.precheckRoles.set(actorId, 'admin');
  harness.database.lockedRoles.set(actorId, 'member');

  const response = await harness.invoke('PATCH', '/:id', { body: { title: 'After' } });

  assert.equal(response.statusCode, 403);
  assert.equal(harness.database.title, 'Before');
  assert.ok(harness.database.sequence.indexOf('lock') < harness.database.sequence.indexOf(`locked:${actorId}:member`));
  assert.equal(harness.events.length, 0);
});

test('avatar replacement reauthorizes under lock and cleans a denied candidate', async () => {
  const harness = await groupRouteHarness();
  harness.database.precheckRoles.set(actorId, 'admin');
  harness.database.lockedRoles.set(actorId, 'member');

  const response = await harness.invoke('POST', '/:id/avatar');

  assert.equal(response.statusCode, 403);
  assert.equal(harness.database.avatarKey, 'old-avatar.png');
  assert.deepEqual(harness.deletedAvatarKeys, ['new-avatar.png']);
  assert.equal(harness.events.length, 0);
});

test('avatar replacement cleans its candidate on rollback and never deletes the old media', async () => {
  const database = new GroupRouteDatabase();
  database.failMutation = true;
  const harness = await groupRouteHarness(database);

  await assert.rejects(harness.invoke('POST', '/:id/avatar'), /mutation failed/);

  assert.deepEqual(harness.deletedAvatarKeys, ['new-avatar.png']);
  assert.ok(database.sequence.includes('rollback'));
  assert.equal(harness.events.length, 0);
});

test('successful avatar replacement commits before old-media deletion and event publication', async () => {
  const harness = await groupRouteHarness();
  const response = await harness.invoke('POST', '/:id/avatar');

  assert.equal(response.statusCode, 200);
  assert.deepEqual(harness.deletedAvatarKeys, ['old-avatar.png']);
  assert.ok(harness.database.sequence.indexOf('commit') < harness.database.sequence.indexOf('delete-media:old-avatar.png'));
  assert.ok(harness.database.sequence.indexOf('commit') < harness.database.sequence.indexOf('event:changed'));
});

test('avatar removal denies authority lost before the locked decision', async () => {
  const harness = await groupRouteHarness();
  harness.database.precheckRoles.set(actorId, 'admin');
  harness.database.lockedRoles.set(actorId, 'member');

  const response = await harness.invoke('DELETE', '/:id/avatar');

  assert.equal(response.statusCode, 403);
  assert.equal(harness.database.avatarKey, 'old-avatar.png');
  assert.deepEqual(harness.deletedAvatarKeys, []);
});

test('successful avatar removal deletes old media and emits only after commit', async () => {
  const harness = await groupRouteHarness();
  const response = await harness.invoke('DELETE', '/:id/avatar');

  assert.equal(response.statusCode, 204);
  assert.equal(harness.database.avatarKey, null);
  assert.deepEqual(harness.deletedAvatarKeys, ['old-avatar.png']);
  assert.ok(harness.database.sequence.indexOf('commit') < harness.database.sequence.indexOf('delete-media:old-avatar.png'));
  assert.ok(harness.database.sequence.indexOf('commit') < harness.database.sequence.indexOf('event:changed'));
});

test('avatar removal rollback preserves old media and publishes no event', async () => {
  const database = new GroupRouteDatabase();
  database.failMutation = true;
  const harness = await groupRouteHarness(database);

  await assert.rejects(harness.invoke('DELETE', '/:id/avatar'), /mutation failed/);

  assert.equal(database.avatarKey, 'old-avatar.png');
  assert.ok(database.sequence.includes('rollback'));
  assert.deepEqual(harness.deletedAvatarKeys, []);
  assert.equal(harness.events.length, 0);
});

test('legacy direct member add denies stale pre-lock administrative authority', async () => {
  const harness = await groupRouteHarness();
  harness.database.precheckRoles.set(actorId, 'admin');
  harness.database.lockedRoles.set(actorId, 'member');

  const response = await harness.invoke('POST', '/:id/members', {
    body: { userId: '10000000-0000-4000-8000-000000000004' }
  });

  assert.equal(response.statusCode, 403);
  assert.equal(harness.database.sequence.includes('insert-member'), false);
  assert.equal(harness.events.length, 0);
});

test('legacy direct member add retains authorized admin behavior and locked capacity state', async () => {
  const harness = await groupRouteHarness();
  const addedId = '10000000-0000-4000-8000-000000000004';
  const response = await harness.invoke('POST', '/:id/members', {
    body: { userId: addedId }
  });

  assert.equal(response.statusCode, 201);
  assert.ok(harness.database.userIds.includes(addedId));
  assert.equal(harness.database.lockedRoles.get(addedId), 'member');
  assert.deepEqual(harness.events[0], {
    type: 'opened',
    payload: { conversationId: groupId, userIds: [actorId, targetId, otherId, addedId] }
  });
});

test('role changes and member removals use current locked roles', async () => {
  const roleHarness = await groupRouteHarness();
  roleHarness.database.lockedRoles.set(actorId, 'admin');
  roleHarness.database.lockedRoles.set(targetId, 'member');
  const roleResponse = await roleHarness.invoke('PATCH', '/:id/members/:userId', {
    body: { role: 'admin' }
  });
  assert.equal(roleResponse.statusCode, 403);
  assert.equal(roleHarness.database.sequence.includes('update-role'), false);

  const removalHarness = await groupRouteHarness();
  removalHarness.database.lockedRoles.set(actorId, 'admin');
  removalHarness.database.lockedRoles.set(targetId, 'admin');
  const removalResponse = await removalHarness.invoke('DELETE', '/:id/members/:userId');
  assert.equal(removalResponse.statusCode, 403);
  assert.equal(removalHarness.database.sequence.includes('delete-member'), false);
});

test('authorized owner role changes and admin member removal retain their effects', async () => {
  const roleHarness = await groupRouteHarness();
  roleHarness.database.lockedRoles.set(actorId, 'owner');
  roleHarness.database.lockedRoles.set(targetId, 'member');
  const roleResponse = await roleHarness.invoke('PATCH', '/:id/members/:userId', {
    body: { role: 'admin' }
  });
  assert.equal(roleResponse.statusCode, 200);
  assert.equal(roleHarness.database.lockedRoles.get(targetId), 'admin');
  assert.equal(roleHarness.events[0]?.type, 'changed');

  const removalHarness = await groupRouteHarness();
  removalHarness.database.lockedRoles.set(actorId, 'admin');
  removalHarness.database.lockedRoles.set(targetId, 'member');
  const removalResponse = await removalHarness.invoke('DELETE', '/:id/members/:userId');
  assert.equal(removalResponse.statusCode, 200);
  assert.equal(removalHarness.database.userIds.includes(targetId), false);
  assert.deepEqual(removalHarness.events[0], {
    type: 'removed',
    payload: {
      conversationId: groupId,
      removedUserIds: [targetId],
      remainingUserIds: [actorId, otherId]
    }
  });
});

test('ownership transfer requires current locked ownership and target membership', async () => {
  const staleOwner = await groupRouteHarness();
  staleOwner.database.lockedRoles.set(actorId, 'admin');
  let response = await staleOwner.invoke('POST', '/:id/transfer-owner', {
    body: { userId: targetId }
  });
  assert.equal(response.statusCode, 403);
  assert.equal(staleOwner.database.sequence.includes('promote-owner'), false);

  const missingTarget = await groupRouteHarness();
  missingTarget.database.lockedRoles.set(actorId, 'owner');
  missingTarget.database.lockedRoles.delete(targetId);
  response = await missingTarget.invoke('POST', '/:id/transfer-owner', {
    body: { userId: targetId }
  });
  assert.equal(response.statusCode, 404);
  assert.equal(missingTarget.database.sequence.includes('demote-owner'), false);
});

test('ownership transfer atomically demotes the current owner and promotes its member target', async () => {
  const harness = await groupRouteHarness();
  harness.database.lockedRoles.set(actorId, 'owner');
  harness.database.lockedRoles.set(targetId, 'member');

  const response = await harness.invoke('POST', '/:id/transfer-owner', {
    body: { userId: targetId }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(harness.database.lockedRoles.get(actorId), 'admin');
  assert.equal(harness.database.lockedRoles.get(targetId), 'owner');
  assert.ok(harness.database.sequence.indexOf('demote-owner') < harness.database.sequence.indexOf('promote-owner'));
  assert.ok(harness.database.sequence.indexOf('promote-owner') < harness.database.sequence.indexOf('commit'));
});

test('leave preserves owner-transfer and ordinary member behavior under lock', async () => {
  const owner = await groupRouteHarness();
  owner.database.lockedRoles.set(actorId, 'owner');
  const ownerResponse = await owner.invoke('POST', '/:id/leave');
  assert.equal(ownerResponse.statusCode, 409);
  assert.equal(owner.database.sequence.includes('delete-member'), false);

  const member = await groupRouteHarness();
  member.database.lockedRoles.set(actorId, 'member');
  const memberResponse = await member.invoke('POST', '/:id/leave');
  assert.equal(memberResponse.statusCode, 204);
  assert.deepEqual(member.events, [{
    type: 'removed',
    payload: {
      conversationId: groupId,
      removedUserIds: [actorId],
      remainingUserIds: [targetId, otherId]
    }
  }]);

  const soleOwner = await groupRouteHarness();
  soleOwner.database.userIds = [actorId];
  soleOwner.database.lockedRoles = new Map([[actorId, 'owner']]);
  const soleOwnerResponse = await soleOwner.invoke('POST', '/:id/leave');
  assert.equal(soleOwnerResponse.statusCode, 204);
  assert.ok(soleOwner.database.sequence.includes('delete-group'));
  assert.deepEqual(soleOwner.events, [{
    type: 'removed',
    payload: {
      conversationId: groupId,
      removedUserIds: [actorId],
      remainingUserIds: []
    }
  }]);
});

test('group deletion revalidates owner and snapshots users and avatar inside the transaction', async () => {
  const staleOwner = await groupRouteHarness();
  staleOwner.database.precheckRoles.set(actorId, 'owner');
  staleOwner.database.lockedRoles.set(actorId, 'admin');
  const denied = await staleOwner.invoke('DELETE', '/:id');
  assert.equal(denied.statusCode, 409);
  assert.equal(staleOwner.database.sequence.includes('delete-group'), false);
  assert.equal(staleOwner.events.length, 0);

  const deleted = await groupRouteHarness();
  deleted.database.precheckRoles.set(actorId, 'owner');
  deleted.database.lockedRoles.set(actorId, 'owner');
  deleted.database.userIds = [actorId, targetId, otherId];
  const response = await deleted.invoke('DELETE', '/:id');
  assert.equal(response.statusCode, 204);
  assert.deepEqual(deleted.events, [{
    type: 'removed',
    payload: {
      conversationId: groupId,
      removedUserIds: [actorId, targetId, otherId],
      remainingUserIds: []
    }
  }]);
  assert.deepEqual(deleted.deletedAvatarKeys, ['old-avatar.png']);
  assert.ok(deleted.database.sequence.indexOf('lock') < deleted.database.sequence.indexOf(`locked:${actorId}:owner`));
  assert.ok(deleted.database.sequence.indexOf(`locked:${actorId}:owner`) < deleted.database.sequence.indexOf('snapshot-users'));
  assert.ok(deleted.database.sequence.indexOf('snapshot-users') < deleted.database.sequence.indexOf('delete-group'));
  assert.ok(deleted.database.sequence.indexOf(`locked:${actorId}:owner`) < deleted.database.sequence.indexOf('delete-group'));
  assert.ok(deleted.database.sequence.indexOf('commit') < deleted.database.sequence.indexOf('delete-media:old-avatar.png'));
  assert.ok(deleted.database.sequence.indexOf('commit') < deleted.database.sequence.indexOf('event:removed'));
});

test('group deletion rollback publishes no event and removes no avatar', async () => {
  const database = new GroupRouteDatabase();
  database.precheckRoles.set(actorId, 'owner');
  database.lockedRoles.set(actorId, 'owner');
  database.failMutation = true;
  const harness = await groupRouteHarness(database);

  await assert.rejects(harness.invoke('DELETE', '/:id'), /mutation failed/);

  assert.ok(database.sequence.includes('rollback'));
  assert.deepEqual(harness.deletedAvatarKeys, []);
  assert.equal(harness.events.length, 0);
});

type InviteStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

class InviteRouteDatabase {
  precheckRoles = new Map<string, Role>([[actorId, 'admin'], [targetId, 'member']]);
  lockedRoles = new Map<string, Role>([[actorId, 'admin'], [targetId, 'member']]);
  members = new Set([actorId, targetId]);
  invite: {
    id: string;
    conversation_id: string;
    inviter_id: string;
    invitee_id: string;
    status: InviteStatus;
  } | null = {
    id: inviteId,
    conversation_id: groupId,
    inviter_id: actorId,
    invitee_id: invitedId,
    status: 'pending'
  };
  sequence: string[] = [];
  failTransition = false;
  private snapshot: { members: Set<string>; invite: InviteRouteDatabase['invite'] } | null = null;

  db = {
    select: () => {
      const builder: any = {
        from: () => builder,
        where: () => builder,
        limit: async () => [{ id: 'friendship' }]
      };
      return builder;
    }
  };

  pool = {
    query: async (sql: string, params: any[] = []) => this.query(sql, params, false),
    connect: async () => ({
      query: async (sql: string, params: any[] = []) => this.query(sql, params, true),
      release: () => { this.sequence.push('release'); }
    })
  };

  private result(rows: any[] = [], rowCount = rows.length) {
    return { rows, rowCount };
  }

  private copyInvite() {
    return this.invite ? { ...this.invite } : null;
  }

  async query(sql: string, params: any[], locked: boolean) {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized === 'begin') {
      this.snapshot = { members: new Set(this.members), invite: this.copyInvite() };
      this.sequence.push('begin');
      return this.result();
    }
    if (normalized === 'commit') {
      this.snapshot = null;
      this.sequence.push('commit');
      return this.result();
    }
    if (normalized === 'rollback') {
      if (this.snapshot) {
        this.members = new Set(this.snapshot.members);
        this.invite = this.snapshot.invite ? { ...this.snapshot.invite } : null;
      }
      this.snapshot = null;
      this.sequence.push('rollback');
      return this.result();
    }
    if (normalized.includes('pg_advisory_xact_lock')) {
      this.sequence.push('lock-group');
      return this.result();
    }
    if (normalized === 'select conversation_id from group_invites where id = $1 limit 1') {
      this.sequence.push('locate-invite');
      const invite = this.invite;
      return this.result(invite && invite.id === params[0] ? [{ conversation_id: invite.conversation_id }] : []);
    }
    if (normalized.includes('select id, conversation_id, inviter_id, invitee_id, status from group_invites') && normalized.includes('for update')) {
      this.sequence.push('lock-invite');
      const invite = this.invite;
      return this.result(invite && invite.id === params[0] && invite.conversation_id === params[1] ? [this.copyInvite()] : []);
    }
    if (normalized.includes('join conversation_members m on m.conversation_id = c.id')) {
      const role = (locked ? this.lockedRoles : this.precheckRoles).get(params[1]);
      this.sequence.push(`${locked ? 'locked' : 'precheck'}:${params[1]}:${role ?? 'missing'}`);
      return this.result(params[0] === groupId && role ? [{
        id: groupId,
        avatar_key: null,
        role
      }] : []);
    }
    if (normalized.startsWith('select 1 from blocks')) return this.result();
    if (normalized.startsWith('select 1 from conversations')) return this.result([{ '?column?': 1 }]);
    if (normalized.startsWith('select 1 from conversation_members')) {
      return this.result(this.members.has(params[1]) ? [{ '?column?': 1 }] : []);
    }
    if (normalized.startsWith('select id, status from group_invites')) {
      this.sequence.push('lock-invite-pair');
      const invite = this.invite;
      return this.result(
        invite && invite.conversation_id === params[0] && invite.invitee_id === params[1]
          ? [{ id: invite.id, status: invite.status }]
          : []
      );
    }
    if (normalized.startsWith('select (select count(*)::int from conversation_members')) {
      return this.result([{
        members: this.members.size,
        invites: this.invite?.status === 'pending' ? 1 : 0
      }]);
    }
    if (normalized.startsWith('select count(*)::int as count from conversation_members')) {
      return this.result([{ count: this.members.size }]);
    }
    if (normalized.startsWith('insert into group_invites')) {
      this.sequence.push('upsert-invite');
      this.invite = {
        id: this.invite?.id ?? inviteId,
        conversation_id: params[0],
        inviter_id: params[1],
        invitee_id: params[2],
        status: 'pending'
      };
      return this.result([{ id: this.invite.id }]);
    }
    if (normalized.startsWith('insert into conversation_members')) {
      this.sequence.push('insert-member');
      this.members.add(params[1]);
      this.lockedRoles.set(params[1], 'member');
      return this.result([], 1);
    }
    if (normalized.startsWith('update group_invites')) {
      if (this.failTransition) throw new Error('invite transition failed');
      if (!this.invite || this.invite.id !== params[0] || this.invite.status !== 'pending') return this.result();
      if (normalized.includes("status = 'accepted'")) this.invite.status = 'accepted';
      else if (normalized.includes("status = 'declined'")) this.invite.status = 'declined';
      else if (normalized.includes("status = 'cancelled'")) this.invite.status = 'cancelled';
      this.sequence.push(`transition:${this.invite.status}`);
      return this.result([{ id: this.invite.id }]);
    }
    if (normalized.startsWith('update conversations set updated_at')) return this.result([], 1);
    if (normalized.startsWith('select user_id from conversation_members')) {
      this.sequence.push('snapshot-users');
      return this.result([...this.members].map((user_id) => ({ user_id })));
    }
    if (normalized.includes('join conversation_members mine')) {
      const role = this.lockedRoles.get(params[1]);
      return this.result(role ? [{
        id: groupId,
        title: 'Group',
        avatar_key: null,
        created_by: actorId,
        created_at: new Date('2026-09-16T12:00:00.000Z'),
        updated_at: new Date('2026-09-16T12:00:00.000Z'),
        role
      }] : []);
    }
    if (normalized.includes('from conversation_members cm join users u')) {
      return this.result([...this.members].map((id) => ({
        id,
        username: `user-${id.at(-1)}`,
        display_name: `User ${id.at(-1)}`,
        avatar_url: null,
        role: this.lockedRoles.get(id) ?? 'member',
        joined_at: new Date('2026-09-16T12:00:00.000Z')
      })));
    }
    if (normalized.includes('from group_invites gi join users u')) return this.result();
    throw new Error(`Unexpected invite fixture SQL: ${normalized}`);
  }
}

async function inviteRouteHarness(database = new InviteRouteDatabase()) {
  const handlers = new Map<string, RouteHandler>();
  const app = {
    get(path: string, _options: unknown, handler: RouteHandler) { handlers.set(`GET ${path}`, handler); },
    post(path: string, _options: unknown, handler: RouteHandler) { handlers.set(`POST ${path}`, handler); },
    patch(path: string, _options: unknown, handler: RouteHandler) { handlers.set(`PATCH ${path}`, handler); },
    delete(path: string, _options: unknown, handler: RouteHandler) { handlers.set(`DELETE ${path}`, handler); }
  };
  const events: Array<{ type: string; payload: any }> = [];
  const realtimeEvents = {
    emitConversationOpened(payload: any) { database.sequence.push('event:opened'); events.push({ type: 'opened', payload }); },
    emitConversationChanged(payload: any) { database.sequence.push('event:changed'); events.push({ type: 'changed', payload }); },
    emitConversationRemoved(payload: any) { events.push({ type: 'removed', payload }); },
    emitGroupInvitesChanged(payload: any) { database.sequence.push('event:invites'); events.push({ type: 'invites', payload }); }
  };

  await groupRoutes(app as never, {
    database: database as never,
    cookieName: 'session',
    sessionService: {} as never,
    mediaStore: {} as never,
    realtimeEvents: realtimeEvents as never,
    groupAvatarMaxBytes: 2_000_000
  });

  async function invoke(
    method: string,
    path: string,
    options: { userId?: string; params?: Record<string, string>; body?: unknown } = {}
  ) {
    const state = { statusCode: 200, payload: undefined as any };
    const reply = {
      code(code: number) { state.statusCode = code; return reply; },
      send(payload?: any) { state.payload = payload; return payload; }
    };
    const request = {
      auth: { user: { id: options.userId ?? actorId } },
      params: { id: groupId, inviteId, ...(options.params ?? {}) },
      body: options.body
    };
    await handlers.get(`${method} ${path}`)!(request, reply);
    return state;
  }

  return { database, events, invoke };
}

test('invite create/reopen revalidates current management authority under the group lock', async () => {
  const harness = await inviteRouteHarness();
  harness.database.precheckRoles.set(actorId, 'admin');
  harness.database.lockedRoles.set(actorId, 'member');
  harness.database.invite!.status = 'declined';

  const response = await harness.invoke('POST', '/:id/invites', { body: { userId: invitedId } });

  assert.equal(response.statusCode, 403);
  assert.equal(harness.database.invite?.status, 'declined');
  assert.equal(harness.database.sequence.includes('upsert-invite'), false);
  assert.equal(harness.events.length, 0);
  assert.ok(harness.database.sequence.indexOf('lock-group') < harness.database.sequence.indexOf(`locked:${actorId}:member`));
});

test('invite reopen locks group then invite row and publishes only after commit', async () => {
  const harness = await inviteRouteHarness();
  harness.database.invite!.status = 'declined';

  const response = await harness.invoke('POST', '/:id/invites', { body: { userId: invitedId } });

  assert.equal(response.statusCode, 201);
  assert.equal(harness.database.invite?.status, 'pending');
  assert.ok(harness.database.sequence.indexOf('lock-group') < harness.database.sequence.indexOf('lock-invite-pair'));
  assert.ok(harness.database.sequence.indexOf('lock-invite-pair') < harness.database.sequence.indexOf('upsert-invite'));
  assert.ok(harness.database.sequence.indexOf('commit') < harness.database.sequence.indexOf('event:invites'));
  assert.ok(harness.database.sequence.indexOf('commit') < harness.database.sequence.indexOf('event:changed'));
});

test('invite acceptance locks group before invite and atomically adds membership', async () => {
  const harness = await inviteRouteHarness();

  const response = await harness.invoke('POST', '/invites/:inviteId/accept', { userId: invitedId });

  assert.equal(response.statusCode, 200);
  assert.equal(harness.database.invite?.status, 'accepted');
  assert.equal(harness.database.members.has(invitedId), true);
  assert.ok(harness.database.sequence.indexOf('locate-invite') < harness.database.sequence.indexOf('lock-group'));
  assert.ok(harness.database.sequence.indexOf('lock-group') < harness.database.sequence.indexOf('lock-invite'));
  assert.ok(harness.database.sequence.indexOf('transition:accepted') < harness.database.sequence.indexOf('commit'));
  assert.ok(harness.database.sequence.indexOf('commit') < harness.database.sequence.indexOf('event:opened'));
});

test('duplicate acceptance and a different actor preserve existing response semantics without events', async () => {
  const wrongActor = await inviteRouteHarness();
  let response = await wrongActor.invoke('POST', '/invites/:inviteId/accept', { userId: otherId });
  assert.equal(response.statusCode, 404);
  assert.equal(wrongActor.database.invite?.status, 'pending');
  assert.equal(wrongActor.events.length, 0);

  const duplicate = await inviteRouteHarness();
  duplicate.database.invite!.status = 'accepted';
  duplicate.database.members.add(invitedId);
  response = await duplicate.invoke('POST', '/invites/:inviteId/accept', { userId: invitedId });
  assert.equal(response.statusCode, 409);
  assert.equal(duplicate.database.members.has(invitedId), true);
  assert.equal(duplicate.events.length, 0);
});

test('invite creation and acceptance enforce capacity from locked group state', async () => {
  const create = await inviteRouteHarness();
  create.database.invite!.status = 'pending';
  for (let index = 0; index < 48; index += 1) create.database.members.add(`member-${index}`);
  let response = await create.invoke('POST', '/:id/invites', { body: { userId: invitedId } });
  assert.equal(response.statusCode, 409);
  assert.equal(response.payload?.error, 'Group is full.');
  assert.equal(create.database.sequence.includes('upsert-invite'), false);
  assert.equal(create.events.length, 0);

  const accept = await inviteRouteHarness();
  for (let index = 0; index < 48; index += 1) accept.database.members.add(`member-${index}`);
  response = await accept.invoke('POST', '/invites/:inviteId/accept', { userId: invitedId });
  assert.equal(response.statusCode, 409);
  assert.equal(response.payload?.error, 'Group is full.');
  assert.equal(accept.database.invite?.status, 'pending');
  assert.equal(accept.database.members.has(invitedId), false);
  assert.equal(accept.events.length, 0);
});

test('decline is invitee-only, serialized, and emits only after commit', async () => {
  const wrongActor = await inviteRouteHarness();
  let response = await wrongActor.invoke('POST', '/invites/:inviteId/decline', { userId: otherId });
  assert.equal(response.statusCode, 404);
  assert.equal(wrongActor.database.invite?.status, 'pending');
  assert.equal(wrongActor.events.length, 0);

  const invitee = await inviteRouteHarness();
  response = await invitee.invoke('POST', '/invites/:inviteId/decline', { userId: invitedId });
  assert.equal(response.statusCode, 204);
  assert.equal(invitee.database.invite?.status, 'declined');
  assert.ok(invitee.database.sequence.indexOf('lock-group') < invitee.database.sequence.indexOf('lock-invite'));
  assert.ok(invitee.database.sequence.indexOf('commit') < invitee.database.sequence.indexOf('event:invites'));
  assert.ok(invitee.database.sequence.indexOf('commit') < invitee.database.sequence.indexOf('event:changed'));
});

test('original inviter may cancel after membership loss while unauthorized third parties remain forbidden', async () => {
  const inviter = await inviteRouteHarness();
  inviter.database.invite!.inviter_id = otherId;
  inviter.database.precheckRoles.delete(otherId);
  inviter.database.lockedRoles.delete(otherId);
  inviter.database.members.delete(otherId);

  let response = await inviter.invoke('DELETE', '/invites/:inviteId', { userId: otherId });
  assert.equal(response.statusCode, 204);
  assert.equal(inviter.database.invite?.status, 'cancelled');
  assert.ok(inviter.database.sequence.indexOf('commit') < inviter.database.sequence.indexOf('event:invites'));

  const thirdParty = await inviteRouteHarness();
  response = await thirdParty.invoke('DELETE', '/invites/:inviteId', { userId: targetId });
  assert.equal(response.statusCode, 403);
  assert.equal(thirdParty.database.invite?.status, 'pending');
  assert.equal(thirdParty.events.length, 0);

  thirdParty.database.invite = null;
  response = await thirdParty.invoke('DELETE', '/invites/:inviteId', { userId: targetId });
  assert.equal(response.statusCode, 404);
});

test('current admin may cancel an invite created by someone else', async () => {
  const harness = await inviteRouteHarness();
  harness.database.invite!.inviter_id = otherId;

  const response = await harness.invoke('DELETE', '/invites/:inviteId', { userId: actorId });

  assert.equal(response.statusCode, 204);
  assert.equal(harness.database.invite?.status, 'cancelled');
  assert.ok(harness.database.sequence.indexOf('lock-group') < harness.database.sequence.indexOf(`locked:${actorId}:admin`));
  assert.ok(harness.database.sequence.indexOf('commit') < harness.database.sequence.indexOf('event:invites'));
});

test('failed invite transition rolls back and publishes no success event', async () => {
  const harness = await inviteRouteHarness();
  harness.database.failTransition = true;

  await assert.rejects(
    harness.invoke('POST', '/invites/:inviteId/accept', { userId: invitedId }),
    /invite transition failed/
  );

  assert.equal(harness.database.invite?.status, 'pending');
  assert.equal(harness.database.members.has(invitedId), false);
  assert.ok(harness.database.sequence.includes('rollback'));
  assert.equal(harness.events.length, 0);
});
