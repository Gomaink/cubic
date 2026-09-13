import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { attachmentRoutes } from './attachments.js';

const uploader = '10000000-0000-4000-8000-000000000001';
const member = '10000000-0000-4000-8000-000000000002';
const outsider = '10000000-0000-4000-8000-000000000003';
const conversation = '20000000-0000-4000-8000-000000000001';
const attachmentId = '50000000-0000-4000-8000-000000000001';
const messageId = '30000000-0000-4000-8000-000000000001';

type AttachmentRow = {
  id: string;
  conversation_id: string;
  uploader_id: string;
  message_id: string | null;
  storage_key: string;
  original_name: string;
  content_type: string;
  size_bytes: number;
};

function attachment(overrides: Partial<AttachmentRow> = {}): AttachmentRow {
  return {
    id: attachmentId,
    conversation_id: conversation,
    uploader_id: uploader,
    message_id: null,
    storage_key: '50000000-0000-4000-8000-000000000099',
    original_name: 'report final.txt',
    content_type: 'text/plain',
    size_bytes: 7,
    ...overrides
  };
}

class AttachmentRouteDatabase {
  attachments = [attachment()];
  members = new Set([uploader, member]);
  contentQuery = '';

  pool = {
    query: async (sql: string, params: any[] = []) => {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

      if (normalized.includes('from attachments a')) {
        this.contentQuery = normalized;
        const row = this.attachments.find((item) => item.id === params[0]);
        if (!row) return { rows: [], rowCount: 0 };

        const userId = params[1] as string;
        const pendingOwner = row.message_id === null && row.uploader_id === userId;
        const memberCanRead = this.members.has(userId) && (
          row.message_id !== null || !normalized.includes('a.message_id is not null')
        );
        const rows = pendingOwner || memberCanRead ? [row] : [];
        return { rows, rowCount: rows.length };
      }

      if (normalized.startsWith('select id, storage_key from attachments')) {
        const rows = this.attachments.filter((item) =>
          item.id === params[0] && item.uploader_id === params[1] && item.message_id === null
        );
        return { rows, rowCount: rows.length };
      }

      if (normalized.startsWith('delete from attachments')) {
        const before = this.attachments.length;
        this.attachments = this.attachments.filter((item) =>
          item.id !== params[0] || item.message_id !== null
        );
        return { rows: [], rowCount: before - this.attachments.length };
      }

      throw new Error(`Unexpected fixture SQL: ${normalized}`);
    }
  };
}

type Handler = (request: any, reply: any) => Promise<any>;

async function routeHarness(database = new AttachmentRouteDatabase()) {
  const handlers = new Map<string, Handler>();
  const deletedKeys: string[] = [];
  const app = {
    get(path: string, _options: unknown, handler: Handler) { handlers.set(`GET ${path}`, handler); },
    post(path: string, _options: unknown, handler: Handler) { handlers.set(`POST ${path}`, handler); },
    delete(path: string, _options: unknown, handler: Handler) { handlers.set(`DELETE ${path}`, handler); }
  };
  const store = {
    open: (key: string) => Readable.from([key]),
    delete: async (key: string) => { deletedKeys.push(key); }
  };
  await attachmentRoutes(app as never, {
    database: database as never,
    cookieName: 'session',
    attachmentStore: store as never,
    attachmentMaxBytes: 1024
  });

  async function invoke(method: string, path: string, userId: string | null = uploader) {
    const state = {
      statusCode: 200,
      payload: undefined as any,
      headers: {} as Record<string, string>
    };
    const reply = {
      code(code: number) { state.statusCode = code; return reply; },
      header(name: string, value: string) { state.headers[name.toLowerCase()] = value; return reply; },
      send(payload?: any) { state.payload = payload; return payload; }
    };
    const request = {
      auth: userId ? { user: { id: userId } } : null,
      params: { id: attachmentId }
    };
    await handlers.get(`${method} ${path}`)!(request, reply);
    return state;
  }

  return { database, deletedKeys, invoke };
}

test('pending attachment content is visible only to its uploader', async () => {
  const harness = await routeHarness();

  const ownerResponse = await harness.invoke('GET', '/attachments/:id/content');
  assert.equal(ownerResponse.statusCode, 200);
  assert.equal(ownerResponse.headers['content-type'], 'text/plain');
  assert.equal(ownerResponse.headers['x-content-type-options'], 'nosniff');
  assert.equal(ownerResponse.headers['cache-control'], 'private, no-store');
  assert.equal(
    ownerResponse.headers['content-disposition'],
    "inline; filename*=UTF-8''report%20final.txt"
  );

  for (const userId of [member, outsider]) {
    const response = await harness.invoke('GET', '/attachments/:id/content', userId);
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.payload, { error: 'Attachment not found.' });
  }

  const unauthenticated = await harness.invoke('GET', '/attachments/:id/content', null);
  assert.equal(unauthenticated.statusCode, 401);
  assert.match(harness.database.contentQuery, /a\.message_id is not null and exists/);
});

test('pending attachment deletion is available only to its uploader', async () => {
  for (const userId of [member, outsider]) {
    const harness = await routeHarness();
    const response = await harness.invoke('DELETE', '/attachments/:id', userId);
    assert.equal(response.statusCode, 404);
    assert.equal(harness.database.attachments.length, 1);
    assert.deepEqual(harness.deletedKeys, []);
  }

  const harness = await routeHarness();
  const response = await harness.invoke('DELETE', '/attachments/:id');
  assert.equal(response.statusCode, 204);
  assert.equal(harness.database.attachments.length, 0);
  assert.deepEqual(harness.deletedKeys, ['50000000-0000-4000-8000-000000000099']);
});

test('bound attachment requires current conversation membership even for its uploader', async () => {
  const database = new AttachmentRouteDatabase();
  database.attachments[0]!.message_id = messageId;
  const harness = await routeHarness(database);

  assert.equal(
    (await harness.invoke('GET', '/attachments/:id/content', member)).statusCode,
    200
  );

  database.members.delete(uploader);
  for (const userId of [uploader, outsider]) {
    const response = await harness.invoke('GET', '/attachments/:id/content', userId);
    assert.equal(response.statusCode, 404);
  }
});

test('scriptable and unknown attachment types remain download-only', async () => {
  for (const contentType of ['image/svg+xml', 'text/html', 'application/octet-stream']) {
    const database = new AttachmentRouteDatabase();
    database.attachments[0] = attachment({ content_type: contentType });
    const response = await (await routeHarness(database)).invoke('GET', '/attachments/:id/content');
    assert.match(response.headers['content-disposition'] ?? '', /^attachment;/);
  }
});

test('recognized image and video types retain inline content serving', async () => {
  for (const contentType of ['image/png', 'video/mp4']) {
    const database = new AttachmentRouteDatabase();
    database.attachments[0] = attachment({ content_type: contentType });
    const response = await (await routeHarness(database)).invoke('GET', '/attachments/:id/content');
    assert.match(response.headers['content-disposition'] ?? '', /^inline;/);
  }
});
