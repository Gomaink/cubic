import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { attachmentRoutes } from './attachments.js';
import { PendingAttachmentQuotaError } from '../media/attachment-quotas.js';
import { AttachmentStorageReserveError } from '../media/attachments.js';

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
  conversationKind: 'direct' | 'group' = 'group';
  blocked = false;
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

      if (normalized.includes("c.kind in ('direct', 'group')")) {
        const rows = params[0] === conversation && this.members.has(params[1])
          ? [{ conversation_id: conversation, kind: this.conversationKind, role: 'member' }]
          : [];
        return { rows, rowCount: rows.length };
      }

      if (normalized.includes('from direct_conversation_pairs dp')) {
        const rows = this.blocked ? [{}] : [];
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
          item.id !== params[0] || item.uploader_id !== params[1] || item.message_id !== null
        );
        return { rows: [], rowCount: before - this.attachments.length };
      }

      throw new Error(`Unexpected fixture SQL: ${normalized}`);
    }
  };
}

type Handler = (request: any, reply: any) => Promise<any>;

async function routeHarness(
  database = new AttachmentRouteDatabase(),
  overrides: {
    assertFreeSpace?: () => Promise<void>;
    save?: () => Promise<any>;
    insertPendingAttachment?: (...args: any[]) => Promise<any>;
    open?: (key: string) => unknown;
    detectForDelivery?: (key: string, claimedMime: string) => Promise<string>;
  } = {}
) {
  const handlers = new Map<string, Handler>();
  const routeOptions = new Map<string, any>();
  const deletedKeys: string[] = [];
  const publishedKeys: string[] = [];
  const app = {
    get(path: string, options: unknown, handler: Handler) { routeOptions.set(`GET ${path}`, options); handlers.set(`GET ${path}`, handler); },
    post(path: string, options: unknown, handler: Handler) { routeOptions.set(`POST ${path}`, options); handlers.set(`POST ${path}`, handler); },
    delete(path: string, options: unknown, handler: Handler) { routeOptions.set(`DELETE ${path}`, options); handlers.set(`DELETE ${path}`, handler); }
  };
  const stored = {
    key: '50000000-0000-4000-8000-000000000099',
    originalName: 'upload.txt',
    contentType: 'text/plain',
    kind: 'document',
    sizeBytes: 7,
    width: null,
    height: null
  };
  const store = {
    open: overrides.open ?? ((key: string) => Readable.from([key])),
    detectForDelivery: overrides.detectForDelivery ?? (async (_key: string, claimedMime: string) => claimedMime),
    delete: async (key: string) => { deletedKeys.push(key); },
    discardStaged: async (key: string) => { deletedKeys.push(key); },
    publish: async (key: string) => { publishedKeys.push(key); },
    assertFreeSpace: overrides.assertFreeSpace ?? (async () => {}),
    save: overrides.save ?? (async () => stored)
  };
  await attachmentRoutes(app as never, {
    database: database as never,
    cookieName: 'session',
    sessionService: {} as never,
    attachmentStore: store as never,
    attachmentMaxBytes: 1024,
    attachmentPendingMaxCount: 20,
    attachmentPendingMaxBytes: 10_000,
    attachmentMinFreeBytes: 1024,
    insertPendingAttachment: overrides.insertPendingAttachment ?? (async (
      _database: unknown,
      _attachment: unknown,
      _quota: unknown,
      beforeCommit?: () => Promise<void>
    ) => {
      await beforeCommit?.();
      return {
        ...attachment({ storage_key: stored.key, original_name: stored.originalName }),
        kind: stored.kind,
        width: stored.width,
        height: stored.height,
        created_at: new Date('2026-09-13T12:00:00.000Z')
      };
    })
  });

  async function invoke(
    method: string,
    path: string,
    userId: string | null = uploader,
    input: { file?: any } = {}
  ) {
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
      params: { id: path.includes('conversations') ? conversation : attachmentId },
      file: async () => input.file ?? {
        file: Object.assign(Readable.from([Buffer.from('content')]), { truncated: false }),
        filename: 'upload.txt',
        mimetype: 'text/plain'
      },
      log: { warn() {}, error() {} }
    };
    await handlers.get(`${method} ${path}`)!(request, reply);
    return state;
  }

  return { database, deletedKeys, publishedKeys, routeOptions, invoke };
}

test('pending attachment content is visible only to its uploader', async () => {
  const harness = await routeHarness();

  const ownerResponse = await harness.invoke('GET', '/attachments/:id/content');
  assert.equal(ownerResponse.statusCode, 200);
  assert.equal(ownerResponse.headers['content-type'], 'text/plain');
  assert.equal(ownerResponse.headers['x-content-type-options'], 'nosniff');
  assert.equal(ownerResponse.headers['cache-control'], 'private, no-store');
  assert.equal(ownerResponse.headers['content-disposition'],
    "attachment; filename=\"report final.txt\"; filename*=UTF-8''report%20final.txt");

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
  assert.deepEqual(harness.deletedKeys, []);
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
    const response = await (await routeHarness(database, {
      detectForDelivery: async () => 'application/octet-stream'
    })).invoke('GET', '/attachments/:id/content');
    assert.match(response.headers['content-disposition'] ?? '', /^attachment;/);
    assert.equal(response.headers['content-type'], 'application/octet-stream');
  }
});

test('PDF content is explicitly download-only', async () => {
  const database = new AttachmentRouteDatabase();
  database.attachments[0] = attachment({ content_type: 'application/pdf' });
  const response = await (await routeHarness(database)).invoke('GET', '/attachments/:id/content');
  assert.equal(response.headers['content-type'], 'application/pdf');
  assert.match(response.headers['content-disposition'] ?? '', /^attachment;/);
});

test('delivery sanitizes legacy control, bidi, path, and Unicode filenames', async () => {
  const database = new AttachmentRouteDatabase();
  database.attachments[0] = attachment({ original_name: '../résumé\r\n\u202etest.txt' });
  const response = await (await routeHarness(database)).invoke('GET', '/attachments/:id/content');
  const header = response.headers['content-disposition'] ?? '';
  assert.doesNotMatch(header, /[\r\n\u202e\\/]/u);
  assert.match(header, /filename\*=UTF-8''/);
});

test('recognized image and video types retain inline content serving', async () => {
  for (const contentType of ['image/png', 'video/mp4']) {
    const database = new AttachmentRouteDatabase();
    database.attachments[0] = attachment({ content_type: contentType });
    const response = await (await routeHarness(database)).invoke('GET', '/attachments/:id/content');
    assert.match(response.headers['content-disposition'] ?? '', /^inline;/);
  }
});

test('missing attachment bytes return generic not-found semantics while preserving metadata', async () => {
  const database = new AttachmentRouteDatabase();
  const harness = await routeHarness(database, {
    open: async () => {
      throw Object.assign(new Error('internal path omitted'), { code: 'ENOENT' });
    }
  });

  const response = await harness.invoke('GET', '/attachments/:id/content');
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.payload, { error: 'Attachment not found.' });
  assert.equal(database.attachments.length, 1);
});

test('normal upload persists a pending row and returns its attachment DTO', async () => {
  const harness = await routeHarness();
  const response = await harness.invoke('POST', '/conversations/:id/attachments');

  assert.equal(response.statusCode, 201);
  assert.equal(response.payload.attachment.originalName, 'upload.txt');
  assert.deepEqual(harness.deletedKeys, []);
  assert.deepEqual(harness.publishedKeys, ['50000000-0000-4000-8000-000000000099']);
  assert.equal(
    harness.routeOptions.get('POST /conversations/:id/attachments').config.rateLimit,
    false
  );
});

test('upload authorization preserves membership and bilateral direct-block semantics', async () => {
  const outsiderDatabase = new AttachmentRouteDatabase();
  const outsiderHarness = await routeHarness(outsiderDatabase);
  const outsiderResponse = await outsiderHarness.invoke(
    'POST',
    '/conversations/:id/attachments',
    outsider
  );
  assert.equal(outsiderResponse.statusCode, 404);
  assert.deepEqual(outsiderHarness.publishedKeys, []);

  const blockedDatabase = new AttachmentRouteDatabase();
  blockedDatabase.conversationKind = 'direct';
  blockedDatabase.blocked = true;
  const blockedHarness = await routeHarness(blockedDatabase);
  const blockedResponse = await blockedHarness.invoke(
    'POST',
    '/conversations/:id/attachments'
  );
  assert.equal(blockedResponse.statusCode, 403);
  assert.deepEqual(blockedResponse.payload, { error: 'Messaging is not allowed.' });
  assert.deepEqual(blockedHarness.publishedKeys, []);
});

test('quota rejection removes the just-written file and leaves no pending DB row', async () => {
  const database = new AttachmentRouteDatabase();
  const initialRows = database.attachments.length;
  const harness = await routeHarness(database, {
    insertPendingAttachment: async () => { throw new PendingAttachmentQuotaError('count'); }
  });

  const response = await harness.invoke('POST', '/conversations/:id/attachments');
  assert.equal(response.statusCode, 409);
  assert.equal(response.payload.code, 'ATTACHMENT_PENDING_COUNT_QUOTA');
  assert.deepEqual(harness.deletedKeys, ['50000000-0000-4000-8000-000000000099']);
  assert.equal(database.attachments.length, initialRows);
});

test('pending byte quota has distinct diagnostics and DB insertion failures remove the file', async () => {
  for (const [error, expectedStatus, expectedCode] of [
    [new PendingAttachmentQuotaError('bytes'), 409, 'ATTACHMENT_PENDING_BYTE_QUOTA'],
    [new Error('database unavailable'), 500, undefined]
  ] as const) {
    const harness = await routeHarness(new AttachmentRouteDatabase(), {
      insertPendingAttachment: async () => { throw error; }
    });

    if (expectedStatus === 500) {
      await assert.rejects(
        () => harness.invoke('POST', '/conversations/:id/attachments'),
        /database unavailable/
      );
    } else {
      const response = await harness.invoke('POST', '/conversations/:id/attachments');
      assert.equal(response.statusCode, expectedStatus);
      assert.equal(response.payload.code, expectedCode);
    }
    assert.deepEqual(harness.deletedKeys, ['50000000-0000-4000-8000-000000000099']);
  }
});

test('database failure after atomic publication preserves a recoverable filesystem orphan', async () => {
  const harness = await routeHarness(new AttachmentRouteDatabase(), {
    insertPendingAttachment: async (
      _database: unknown,
      _attachment: unknown,
      _quota: unknown,
      beforeCommit?: () => Promise<void>
    ) => {
      await beforeCommit?.();
      throw Object.assign(new Error('commit failed'), { code: '08006' });
    }
  });

  await assert.rejects(
    () => harness.invoke('POST', '/conversations/:id/attachments'),
    /commit failed/
  );
  assert.deepEqual(harness.publishedKeys, ['50000000-0000-4000-8000-000000000099']);
  assert.deepEqual(harness.deletedKeys, []);
});

test('storage reserve rejection occurs before a file is written', async () => {
  let saveCalled = false;
  const harness = await routeHarness(new AttachmentRouteDatabase(), {
    assertFreeSpace: async () => {
      throw new AttachmentStorageReserveError(10n, 20n, 30n);
    },
    save: async () => {
      saveCalled = true;
      throw new Error('must not save');
    }
  });

  const response = await harness.invoke('POST', '/conversations/:id/attachments');
  assert.equal(response.statusCode, 507);
  assert.equal(response.payload.code, 'ATTACHMENT_STORAGE_RESERVE');
  assert.equal(saveCalled, false);
  assert.deepEqual(harness.deletedKeys, []);
});

test('individual oversize rejection keeps 413 semantics and no stored file', async () => {
  const harness = await routeHarness(new AttachmentRouteDatabase(), {
    save: async () => {
      throw Object.assign(new Error('too large'), { code: 'CUBIC_ATTACHMENT_TOO_LARGE' });
    }
  });

  const response = await harness.invoke('POST', '/conversations/:id/attachments');
  assert.equal(response.statusCode, 413);
  assert.match(response.payload.error, /limit/);
  assert.deepEqual(harness.deletedKeys, []);
});
