import { RoomServiceClient, ServerError, WebhookReceiver } from 'livekit-server-sdk';
import type { Database } from '@cubic/database';
import type { SessionService } from '../security/session.js';
import type { RealtimeEvents, ServerVoicePresenceEvent } from '../realtime/events.js';
import { parseVoiceParticipantIdentity, roomScopedSessionTag } from '../voice/token.js';
import { createServerVoiceToken, parseServerVoiceRoomName, serverVoiceRoomName } from './token.js';

interface Participant {
  identity: string;
  name?: string;
  attributes?: Record<string, string>;
}

export interface ServerVoiceAdmin {
  listRooms(names?: string[]): Promise<Array<{ name: string }>>;
  listParticipants(room: string): Promise<Participant[]>;
  removeParticipant(room: string, identity: string): Promise<void>;
}

export interface ServerVoiceServiceOptions {
  database: Database;
  sessions: SessionService;
  events: RealtimeEvents;
  apiKey: string;
  apiSecret: string;
  apiUrl: string;
  publicUrl: string;
  admin?: ServerVoiceAdmin;
  intervalMs?: number;
}

const MAX_TRACKED_ROOMS = 1_000;
const RECONCILE_INTERVAL_MS = 30_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ServerVoiceService {
  private readonly admin: ServerVoiceAdmin;
  private readonly receiver: WebhookReceiver;
  private readonly occupancy = new Map<string, ServerVoicePresenceEvent>();
  private readonly channelRefreshes = new Map<string, Promise<void>>();
  private readonly unsubscribe: () => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private reconciling: Promise<void> | null = null;

  constructor(private readonly options: ServerVoiceServiceOptions) {
    this.admin = options.admin ?? new RoomServiceClient(options.apiUrl, options.apiKey, options.apiSecret,
      { requestTimeout: 10, failover: false });
    this.receiver = new WebhookReceiver(options.apiKey, options.apiSecret);
    this.unsubscribe = options.events.onSessionRevoked(() => { void this.reconcile().catch(() => {}); });
  }

  snapshot(serverId: string): ServerVoicePresenceEvent[] {
    return [...this.occupancy.values()].filter((item) => item.serverId === serverId);
  }

  async start(): Promise<void> {
    await this.reconcile().catch(() => {});
    this.timer = setInterval(() => { void this.reconcile().catch(() => {}); }, this.options.intervalMs ?? RECONCILE_INTERVAL_MS);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe();
    await (this.reconciling ?? Promise.resolve());
  }

  async issueTicket(input: {
    channelId: string; sessionId: string; userId: string; displayName: string;
  }): Promise<{ url: string; token: string }> {
    // Lock the canonical server row, as owner member removal does. The preliminary
    // lookup is only for lock selection; authorization is repeated after the lock.
    const preliminary = await this.options.database.pool.query<{ server_id: string }>(
      `select server_id from server_voice_channels where id = $1`, [input.channelId]
    );
    const serverId = preliminary.rows[0]?.server_id;
    if (!serverId) throw new ServerVoiceDeniedError();
    const client = await this.options.database.pool.connect();
    try {
      await client.query('begin');
      const locked = await client.query(`select 1 from servers where id = $1 for update`, [serverId]);
      if (!locked.rowCount) throw new ServerVoiceDeniedError();
      const allowed = await client.query(
        `select 1 from server_voice_channels voice
           join server_members member on member.server_id = voice.server_id and member.user_id = $3
           left join server_channel_categories category
             on category.id = voice.category_id and category.server_id = voice.server_id
          where voice.id = $1 and voice.server_id = $2
            and (voice.category_id is null or category.id is not null)`,
        [input.channelId, serverId, input.userId]
      );
      if (!allowed.rowCount) throw new ServerVoiceDeniedError();
      const session = await this.options.sessions.validateId(input.sessionId, { activity: false });
      if (!session || session.user.id !== input.userId) throw new ServerVoiceDeniedError();
      const ticket = await createServerVoiceToken({
        apiKey: this.options.apiKey, apiSecret: this.options.apiSecret,
        publicUrl: this.options.publicUrl, channelId: input.channelId,
        userId: input.userId, displayName: input.displayName, sessionId: input.sessionId
      });
      await client.query('commit');
      return { url: ticket.url, token: ticket.token };
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async receiveWebhook(body: string, authHeader: string | undefined): Promise<void> {
    let event;
    try { event = await this.receiver.receive(body, authHeader); }
    catch { throw new InvalidServerVoiceWebhookError(); }
    if (typeof event.event !== 'string' || !event.event ||
        typeof event.room?.name !== 'string' || !event.room.name) {
      throw new InvalidServerVoiceWebhookError();
    }
    const channelId = parseServerVoiceRoomName(event.room?.name ?? '');
    if (!channelId) return;
    if (!['participant_joined', 'participant_left', 'participant_connection_aborted', 'room_finished'].includes(event.event)) return;
    await this.refreshChannel(channelId);
  }

  async revokeMember(serverId: string, userId: string): Promise<void> {
    const channels = await this.options.database.pool.query<{ id: string }>(
      `select id from server_voice_channels where server_id = $1`, [serverId]
    );
    for (const { id } of channels.rows) {
      const roomName = serverVoiceRoomName(id);
      const participants = await this.listParticipantsOrEmpty(roomName);
      for (const participant of participants) {
        if (participant.attributes?.cubicUserId !== userId) continue;
        await this.removeParticipant(roomName, participant.identity);
      }
      await this.refreshChannel(id);
    }
  }

  reconcile(): Promise<void> {
    if (this.reconciling) return this.reconciling;
    this.reconciling = this.runReconciliation().finally(() => { this.reconciling = null; });
    return this.reconciling;
  }

  private async runReconciliation(): Promise<void> {
    const rooms = (await this.admin.listRooms()).filter((room) => parseServerVoiceRoomName(room.name));
    if (rooms.length > MAX_TRACKED_ROOMS) throw new Error('Server voice room reconciliation limit exceeded.');
    const observed = new Set<string>();
    for (const room of rooms) {
      const channelId = parseServerVoiceRoomName(room.name)!;
      observed.add(channelId);
      await this.refreshChannel(channelId);
    }
    for (const [channelId, prior] of this.occupancy) {
      if (observed.has(channelId)) continue;
      this.occupancy.delete(channelId);
      this.options.events.emitServerVoicePresence({ ...prior, occupants: [] });
    }
  }

  private async refreshChannel(channelId: string): Promise<void> {
    const previous = this.channelRefreshes.get(channelId) ?? Promise.resolve();
    const refresh = previous.catch(() => {}).then(() => this.refreshChannelNow(channelId));
    this.channelRefreshes.set(channelId, refresh);
    try { await refresh; }
    finally {
      if (this.channelRefreshes.get(channelId) === refresh) this.channelRefreshes.delete(channelId);
    }
  }

  private async refreshChannelNow(channelId: string): Promise<void> {
    const channel = await this.options.database.pool.query<{ server_id: string }>(
      `select voice.server_id from server_voice_channels voice
         left join server_channel_categories category
           on category.id = voice.category_id and category.server_id = voice.server_id
        where voice.id = $1 and (voice.category_id is null or category.id is not null)`, [channelId]
    );
    const serverId = channel.rows[0]?.server_id;
    const roomName = serverVoiceRoomName(channelId);
    const participants = await this.listParticipantsOrEmpty(roomName);
    if (!serverId) {
      for (const participant of participants) await this.removeParticipant(roomName, participant.identity);
      const previous = this.occupancy.get(channelId);
      if (previous) {
        this.occupancy.delete(channelId);
        this.options.events.emitServerVoicePresence({ ...previous, occupants: [] });
      }
      return;
    }
    const occupants = new Map<string, { userId: string; displayName: string }>();
    for (const participant of participants) {
      const userId = participant.attributes?.cubicUserId;
      if (!userId || !UUID_PATTERN.test(userId) ||
          participant.attributes?.cubicServerVoiceChannelId !== channelId ||
          !await this.isAuthorizedParticipant(roomName, serverId, userId, participant.identity)) {
        await this.removeParticipant(roomName, participant.identity);
        continue;
      }
      // Multiple devices remain distinct in LiveKit; the compact sidebar dedupes users.
      const user = await this.options.database.pool.query<{ display_name: string }>(
        `select display_name from users where id = $1`, [userId]
      );
      if (user.rows[0]) occupants.set(userId, { userId, displayName: user.rows[0].display_name });
    }
    const next: ServerVoicePresenceEvent = { serverId, channelId, occupants: [...occupants.values()] };
    const previous = this.occupancy.get(channelId);
    if (next.occupants.length) this.occupancy.set(channelId, next);
    else this.occupancy.delete(channelId);
    if (JSON.stringify(previous?.occupants ?? []) !== JSON.stringify(next.occupants)) {
      this.options.events.emitServerVoicePresence(next);
    }
  }

  private async isAuthorizedParticipant(roomName: string, serverId: string, userId: string, identity: string): Promise<boolean> {
    const parsed = parseVoiceParticipantIdentity(identity);
    if (!parsed) return false;
    const member = await this.options.database.pool.query(
      `select 1 from server_members where server_id = $1 and user_id = $2`, [serverId, userId]
    );
    if (!member.rowCount) return false;
    const sessions = await this.options.sessions.listActiveForUser(userId);
    for (const session of sessions) {
      if (roomScopedSessionTag(this.options.apiSecret, roomName, session.id) !== parsed.sessionTag) continue;
      const valid = await this.options.sessions.validateId(session.id, { activity: false });
      return valid?.user.id === userId;
    }
    return false;
  }

  private async listParticipantsOrEmpty(roomName: string): Promise<Participant[]> {
    try { return await this.admin.listParticipants(roomName); }
    catch (error) {
      if (error instanceof ServerError && (error.status === 404 || error.code === 'not_found')) return [];
      throw error;
    }
  }

  private async removeParticipant(roomName: string, identity: string): Promise<void> {
    try { await this.admin.removeParticipant(roomName, identity); }
    catch (error) {
      if (error instanceof ServerError && (error.status === 404 || error.code === 'not_found')) return;
      throw error;
    }
  }
}

export class ServerVoiceDeniedError extends Error {
  constructor() { super('Voice channel is unavailable.'); }
}

export class InvalidServerVoiceWebhookError extends Error {
  constructor() { super('Invalid LiveKit webhook.'); }
}
