import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationRoutes } from './conversations.js';
import { createRealtimeEvents, type RealtimeMessage } from '../realtime/events.js';

const me = '10000000-0000-4000-8000-000000000001';
const peer = '10000000-0000-4000-8000-000000000002';
const outsider = '10000000-0000-4000-8000-000000000003';
const conversation = '20000000-0000-4000-8000-000000000001';
const otherConversation = '20000000-0000-4000-8000-000000000002';
const firstMessage = '30000000-0000-4000-8000-000000000001';
const secondMessage = '30000000-0000-4000-8000-000000000002';
const firstClient = '40000000-0000-4000-8000-000000000001';
const secondClient = '40000000-0000-4000-8000-000000000002';
const thirdClient = '40000000-0000-4000-8000-000000000003';
const attachmentId = '50000000-0000-4000-8000-000000000001';
const createdAt = new Date('2026-09-12T12:00:00.000Z');

type RawMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  client_message_id: string;
  reply_to_message_id: string | null;
  body: string;
  created_at: Date;
  edited_at: Date | null;
  deleted_at: Date | null;
};

function rawMessage(overrides: Partial<RawMessage> = {}): RawMessage {
  return {
    id: firstMessage,
    conversation_id: conversation,
    sender_id: me,
    client_message_id: firstClient,
    reply_to_message_id: null,
    body: 'Original message',
    created_at: createdAt,
    edited_at: null,
    deleted_at: null,
    ...overrides
  };
}

function camelMessage(row: RawMessage) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    clientMessageId: row.client_message_id,
    replyToMessageId: row.reply_to_message_id,
    body: row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    senderUsername: row.sender_id === me ? 'me' : 'peer',
    senderDisplayName: row.sender_id === me ? 'Me' : 'Peer',
    senderAvatarUrl: null
  };
}

function rawAttachment(messageId: string | null = null, contentType = 'image/png') {
  return {
    id: attachmentId,
    conversation_id: conversation,
    uploader_id: me,
    message_id: messageId,
    storage_key: 'fixture-key',
    original_name: 'fixture.png',
    content_type: contentType,
    kind: contentType.startsWith('image/') ? 'image' : 'file',
    size_bytes: 123,
    width: 20,
    height: 10,
    created_at: createdAt,
    attached_at: messageId ? createdAt : null
  };
}

class RouteDatabase {
  messages = new Map<string, RawMessage>();
  attachments = [rawAttachment()];
  selectResults: any[][] = [];
  nextMessage = 10;

  db = {
    select: () => {
      const builder: any = {
        from: () => builder,
        innerJoin: () => builder,
        where: () => builder,
        orderBy: () => builder,
        limit: async () => this.selectResults.shift() ?? []
      };
      return builder;
    }
  };

  pool = {
    query: async (sql: string, params: any[] = []) => this.query(sql, params),
    connect: async () => ({
      query: async (sql: string, params: any[] = []) => this.query(sql, params),
      release() {}
    })
  };

  result(rows: any[] = []) {
    return { rows, rowCount: rows.length };
  }

  async query(sql: string, params: any[]) {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') return this.result();
    if (normalized.includes('from direct_conversation_pairs dp') && normalized.includes('join blocks')) return this.result();

    if (normalized.includes('from messages m') && normalized.includes('join users u')) {
      const row = this.messages.get(params[0]);
      if (!row || row.conversation_id !== params[1]) return this.result();
      return this.result([{
        ...row,
        sender_username: row.sender_id === me ? 'me' : 'peer',
        sender_display_name: row.sender_id === me ? 'Me' : 'Peer',
        sender_avatar_url: null
      }]);
    }

    if (normalized.includes('from messages parent')) {
      const rows = (params[0] as string[]).flatMap((id) => {
        const row = this.messages.get(id);
        if (!row) return [];
        const attachment = this.attachments.find((item) => item.message_id === id);
        return [{
          id: row.id,
          sender_id: row.sender_id,
          body: row.body,
          deleted_at: row.deleted_at,
          sender_username: row.sender_id === me ? 'me' : 'peer',
          sender_display_name: row.sender_id === me ? 'Me' : 'Peer',
          attachment_content_type: attachment?.content_type ?? null
        }];
      });
      return this.result(rows);
    }

    if (normalized.includes('from attachments') && normalized.includes('message_id = any')) {
      const ids = params[0] as string[];
      return this.result(this.attachments.filter((item) => item.message_id && ids.includes(item.message_id)));
    }

    if (normalized.startsWith('select 1 from attachments where message_id')) {
      const rows = this.attachments.some((item) => item.message_id === params[0]) ? [{}] : [];
      return this.result(rows);
    }

    if (normalized.startsWith('insert into messages')) {
      const row = rawMessage({
        id: `30000000-0000-4000-8000-${String(this.nextMessage++).padStart(12, '0')}`,
        conversation_id: params[0],
        sender_id: params[1],
        client_message_id: params[2],
        reply_to_message_id: params[3],
        body: params[4],
        created_at: params[5]
      });
      this.messages.set(row.id, row);
      return this.result([row]);
    }

    if (normalized.startsWith('update attachments') && normalized.includes('set message_id')) {
      const ids = params[2] as string[];
      const changed = this.attachments.filter((item) =>
        ids.includes(item.id) && item.conversation_id === params[3]
        && item.uploader_id === params[4] && item.message_id === null
      );
      for (const item of changed) {
        item.message_id = params[0];
        item.attached_at = params[1];
      }
      return this.result(changed);
    }

    if (normalized.startsWith('update messages') && normalized.includes('set body = $1')) {
      const row = this.messages.get(params[2]);
      if (!row || row.deleted_at || row.conversation_id !== params[3] || row.sender_id !== params[4]) return this.result();
      row.body = params[0];
      row.edited_at = params[1];
      return this.result([{ id: row.id }]);
    }

    if (normalized.startsWith('update messages') && normalized.includes("set body = ''")) {
      const row = this.messages.get(params[1]);
      if (!row || row.deleted_at || row.conversation_id !== params[2] || row.sender_id !== params[3]) return this.result();
      row.body = '';
      row.deleted_at = params[0];
      return this.result([{ id: row.id }]);
    }

    if (normalized.startsWith('update conversations')) return this.result();
    throw new Error(`Unexpected fixture SQL: ${normalized}`);
  }
}

type Handler = (request: any, reply: any) => Promise<any>;

async function routeHarness(database = new RouteDatabase()) {
  const handlers = new Map<string, Handler>();
  const app = {
    get(path: string, _options: unknown, handler: Handler) { handlers.set(`GET ${path}`, handler); },
    post(path: string, _options: unknown, handler: Handler) { handlers.set(`POST ${path}`, handler); },
    patch(path: string, _options: unknown, handler: Handler) { handlers.set(`PATCH ${path}`, handler); },
    delete(path: string, _options: unknown, handler: Handler) { handlers.set(`DELETE ${path}`, handler); }
  };
  const events = createRealtimeEvents();
  await conversationRoutes(app as never, { database: database as never, cookieName: 'session', realtimeEvents: events });

  async function invoke(method: string, path: string, input: { params?: any; query?: any; body?: any; userId?: string | null }) {
    const state = { statusCode: 200, payload: undefined as any };
    const reply = {
      code(code: number) { state.statusCode = code; return reply; },
      send(payload?: any) { state.payload = payload; return payload; }
    };
    const userId = input.userId === undefined ? me : input.userId;
    const request = {
      auth: userId ? { user: { id: userId, username: 'me', displayName: 'Me', avatarUrl: null } } : null,
      params: input.params ?? {},
      query: input.query ?? {},
      body: input.body
    };
    await handlers.get(`${method} ${path}`)!(request, reply);
    return state;
  }

  return { database, events, invoke };
}

function sendBody(overrides: Record<string, unknown> = {}) {
  return { clientMessageId: firstClient, body: 'New message', attachmentIds: [], ...overrides };
}

test('reply creation validates membership and same-conversation targets, then emits its compact preview', async () => {
  const database = new RouteDatabase();
  database.messages.set(firstMessage, rawMessage({ sender_id: peer, body: '', client_message_id: secondClient }));
  database.attachments[0]!.message_id = firstMessage;
  const harness = await routeHarness(database);
  const createdEvents: RealtimeMessage[] = [];
  harness.events.onMessageCreated((event) => createdEvents.push(event.message));
  database.selectResults.push([{ userId: me }], []);

  const response = await harness.invoke('POST', '/:id/messages', {
    params: { id: conversation },
    body: sendBody({ replyToMessageId: firstMessage })
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.payload.message.replyTo.id, firstMessage);
  assert.equal(response.payload.message.replyTo.attachmentKind, 'image');
  assert.deepEqual(createdEvents, [response.payload.message]);

  database.messages.get(firstMessage)!.deleted_at = createdAt;
  database.selectResults.push([{ userId: me }], []);
  const deletedTarget = await harness.invoke('POST', '/:id/messages', {
    params: { id: conversation },
    body: sendBody({ clientMessageId: thirdClient, replyToMessageId: firstMessage })
  });
  assert.equal(deletedTarget.statusCode, 201);
  assert.equal(deletedTarget.payload.message.replyTo.body, '');
  assert.equal(deletedTarget.payload.message.replyTo.attachmentKind, null);
  assert.equal(deletedTarget.payload.message.replyTo.deletedAt, createdAt.toISOString());

  const missing = new RouteDatabase();
  const missingHarness = await routeHarness(missing);
  missing.selectResults.push([{ userId: me }], []);
  const missingResponse = await missingHarness.invoke('POST', '/:id/messages', {
    params: { id: conversation },
    body: sendBody({ replyToMessageId: firstMessage })
  });
  assert.equal(missingResponse.statusCode, 400);

  const cross = new RouteDatabase();
  cross.messages.set(firstMessage, rawMessage({ conversation_id: otherConversation }));
  const crossHarness = await routeHarness(cross);
  cross.selectResults.push([{ userId: me }], []);
  const crossResponse = await crossHarness.invoke('POST', '/:id/messages', {
    params: { id: conversation },
    body: sendBody({ replyToMessageId: firstMessage })
  });
  assert.equal(crossResponse.statusCode, 400);

  const denied = new RouteDatabase();
  const deniedHarness = await routeHarness(denied);
  denied.selectResults.push([]);
  const deniedResponse = await deniedHarness.invoke('POST', '/:id/messages', {
    params: { id: conversation }, body: sendBody(), userId: outsider
  });
  assert.equal(deniedResponse.statusCode, 404);
});

test('history batches attachments and reply previews while preserving cursor pagination', async () => {
  const database = new RouteDatabase();
  const parent = rawMessage({ id: firstMessage, sender_id: peer, body: 'Parent text' });
  const child = rawMessage({ id: secondMessage, client_message_id: secondClient, reply_to_message_id: firstMessage, body: 'Child text' });
  database.messages.set(parent.id, parent);
  database.messages.set(child.id, child);
  database.attachments[0]!.message_id = child.id;
  database.selectResults.push([{ userId: me }], [camelMessage(child), camelMessage(parent)]);
  const harness = await routeHarness(database);

  const response = await harness.invoke('GET', '/:id/messages', {
    params: { id: conversation }, query: { limit: 1 }
  });
  assert.equal(response.payload.messages.length, 1);
  assert.equal(response.payload.messages[0].replyTo.body, 'Parent text');
  assert.equal(response.payload.messages[0].attachments[0].id, attachmentId);
  assert.equal(response.payload.nextCursor, child.created_at.toISOString());
});

test('editing enforces ownership, deletion state, body rules, and keeps immutable message fields and attachments', async () => {
  const database = new RouteDatabase();
  const original = rawMessage();
  database.messages.set(original.id, original);
  database.attachments[0]!.message_id = original.id;
  database.selectResults.push([{ userId: me }]);
  const harness = await routeHarness(database);
  const events: RealtimeMessage[] = [];
  harness.events.onMessageUpdated((event) => events.push(event.message));

  const response = await harness.invoke('PATCH', '/:id/messages/:messageId', {
    params: { id: conversation, messageId: original.id }, body: { body: '' }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.message.body, '');
  assert.ok(response.payload.message.editedAt);
  assert.equal(response.payload.message.clientMessageId, firstClient);
  assert.equal(response.payload.message.createdAt, createdAt.toISOString());
  assert.equal(response.payload.message.attachments[0].id, attachmentId);
  assert.deepEqual(events, [response.payload.message]);

  const textOnly = new RouteDatabase();
  textOnly.messages.set(firstMessage, rawMessage());
  textOnly.attachments = [];
  textOnly.selectResults.push([{ userId: me }]);
  const textHarness = await routeHarness(textOnly);
  const empty = await textHarness.invoke('PATCH', '/:id/messages/:messageId', {
    params: { id: conversation, messageId: firstMessage }, body: { body: '   ' }
  });
  assert.equal(empty.statusCode, 400);

  for (const [senderId, deletedAt, expected] of [
    [peer, null, 403],
    [me, createdAt, 409]
  ] as const) {
    const denied = new RouteDatabase();
    denied.messages.set(firstMessage, rawMessage({ sender_id: senderId, deleted_at: deletedAt }));
    denied.selectResults.push([{ userId: me }]);
    const deniedHarness = await routeHarness(denied);
    const deniedResponse = await deniedHarness.invoke('PATCH', '/:id/messages/:messageId', {
      params: { id: conversation, messageId: firstMessage }, body: { body: 'Changed' }
    });
    assert.equal(deniedResponse.statusCode, expected);
  }
});

test('soft deletion enforces ownership, rejects repeats, persists in history, and emits realtime state', async () => {
  const database = new RouteDatabase();
  database.messages.set(firstMessage, rawMessage());
  database.attachments[0]!.message_id = firstMessage;
  database.selectResults.push([{ userId: me }]);
  const harness = await routeHarness(database);
  const events: RealtimeMessage[] = [];
  harness.events.onMessageDeleted((event) => events.push(event.message));

  const response = await harness.invoke('DELETE', '/:id/messages/:messageId', {
    params: { id: conversation, messageId: firstMessage }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.message.body, '');
  assert.ok(response.payload.message.deletedAt);
  assert.equal(response.payload.message.attachments[0].id, attachmentId);
  assert.deepEqual(events, [response.payload.message]);

  database.selectResults.push([{ userId: me }]);
  const repeated = await harness.invoke('DELETE', '/:id/messages/:messageId', {
    params: { id: conversation, messageId: firstMessage }
  });
  assert.equal(repeated.statusCode, 409);

  database.selectResults.push([{ userId: me }], [camelMessage(database.messages.get(firstMessage)!)]);
  const history = await harness.invoke('GET', '/:id/messages', {
    params: { id: conversation }, query: { limit: 50 }
  });
  assert.ok(history.payload.messages[0].deletedAt);

  const foreign = new RouteDatabase();
  foreign.messages.set(firstMessage, rawMessage({ sender_id: peer }));
  foreign.selectResults.push([{ userId: me }]);
  const foreignHarness = await routeHarness(foreign);
  const denied = await foreignHarness.invoke('DELETE', '/:id/messages/:messageId', {
    params: { id: conversation, messageId: firstMessage }
  });
  assert.equal(denied.statusCode, 403);
});

test('normal text, attachment-only, text-plus-attachment, and client idempotency retain their payloads', async () => {
  for (const [body, attachmentIds] of [
    ['Text only', []],
    ['', [attachmentId]],
    ['Text and file', [attachmentId]]
  ] as const) {
    const database = new RouteDatabase();
    database.selectResults.push([{ userId: me }], []);
    const harness = await routeHarness(database);
    const response = await harness.invoke('POST', '/:id/messages', {
      params: { id: conversation }, body: sendBody({ body, attachmentIds: [...attachmentIds] })
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.payload.message.body, body);
    assert.equal(response.payload.message.attachments.length, attachmentIds.length);
  }

  const database = new RouteDatabase();
  const existing = rawMessage();
  database.messages.set(existing.id, existing);
  database.selectResults.push([{ userId: me }], [camelMessage(existing)]);
  const harness = await routeHarness(database);
  const response = await harness.invoke('POST', '/:id/messages', {
    params: { id: conversation }, body: sendBody()
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.duplicate, true);
  assert.equal(response.payload.message.id, existing.id);
  assert.equal(database.messages.size, 1);
});
