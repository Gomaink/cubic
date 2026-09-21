import { randomUUID } from 'node:crypto';
import { ServerError, RoomServiceClient } from 'livekit-server-sdk';
import type { Database } from '@cubic/database';
import type { RealtimeEvents } from '../realtime/events.js';
import type { SessionService } from '../security/session.js';
import {
  VOICE_TOKEN_TTL_SECONDS,
  createVoiceJoinToken,
  directVoiceRoomName,
  parseVoiceParticipantIdentity,
  roomScopedSessionTag,
  voiceParticipantIdentity,
  voiceRoomName,
  type VoiceJoinTicket
} from './token.js';

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const GROUP_ROOM_PATTERN = new RegExp(`^cubic-voice-(${UUID_PATTERN})$`, 'i');
const DIRECT_ROOM_PATTERN = new RegExp(`^cubic-voice-direct-(${UUID_PATTERN})$`, 'i');
const UUID_VALUE_PATTERN = new RegExp(`^${UUID_PATTERN}$`, 'i');
const TOMBSTONE_GRACE_MS = 60_000;

export interface AuthorizedVoiceScope {
  kind: 'group' | 'direct';
  conversationId: string;
  roomName: string;
  callId: string | null;
}

export interface ManagedVoiceRoom {
  kind: 'group' | 'direct';
  conversationId: string | null;
  callId: string | null;
  valid: boolean;
}

export interface VoiceAuthorizationStore {
  resolveScope(userId: string, conversationId: string): Promise<AuthorizedVoiceScope | null>;
  resolveManagedRoom(roomName: string): Promise<ManagedVoiceRoom | null>;
}

export interface LiveKitAdminClient {
  listRooms(names?: string[]): Promise<Array<{ name: string }>>;
  listParticipants(room: string): Promise<Array<{
    identity: string;
    attributes?: Record<string, string>;
  }>>;
  removeParticipant(
    room: string,
    identity: string,
    options?: { revokeTokenTs?: bigint }
  ): Promise<void>;
  deleteRoom(room: string): Promise<void>;
}

interface VoiceLogger {
  info(object: Record<string, unknown>, message: string): void;
  warn(object: Record<string, unknown>, message: string): void;
  error(object: Record<string, unknown>, message: string): void;
}

interface IssuedParticipant {
  identity: string;
  sessionId: string;
  userId: string;
  conversationId: string;
  callId: string | null;
  roomName: string;
  expiresAtMs: number;
  cancelled: boolean;
}

interface AdminTask {
  key: string;
  kind: 'remove-participant' | 'delete-room';
  roomName: string;
  participantIdentity?: string;
  attempts: number;
  nextAttemptAtMs: number;
}

export interface IssueVoiceTicketInput {
  sessionId: string;
  userId: string;
  displayName: string;
  conversationId: string;
  participantInstanceId?: string;
}

export interface LiveKitAuthorizationServiceOptions {
  apiKey: string;
  apiSecret: string;
  apiUrl: string;
  publicUrl: string;
  sessionService: SessionService;
  store: VoiceAuthorizationStore;
  events: RealtimeEvents;
  reconciliationIntervalMs?: number;
  maximumQueueSize?: number;
  maximumRegistrySize?: number;
  adminClient?: LiveKitAdminClient;
  logger?: VoiceLogger;
  now?: () => number;
  random?: () => number;
}

export class VoiceAuthorizationDeniedError extends Error {
  constructor() {
    super('Voice is unavailable.');
    this.name = 'VoiceAuthorizationDeniedError';
  }
}

export class LiveKitControlPlaneUnavailableError extends Error {
  constructor() {
    super('Voice service is temporarily unavailable.');
    this.name = 'LiveKitControlPlaneUnavailableError';
  }
}

export function createDatabaseVoiceAuthorizationStore(
  database: Database
): VoiceAuthorizationStore {
  return {
    async resolveScope(userId, conversationId) {
      const result = await database.pool.query<{
        kind: string;
        user_low_id: string | null;
        user_high_id: string | null;
        blocked: boolean;
        call_id: string | null;
      }>(
        `select c.kind,
                dp.user_low_id,
                dp.user_high_id,
                exists (
                  select 1
                    from blocks b
                   where (b.blocker_id = dp.user_low_id and b.blocked_id = dp.user_high_id)
                      or (b.blocker_id = dp.user_high_id and b.blocked_id = dp.user_low_id)
                ) as blocked,
                (
                  select active_call.id
                    from calls active_call
                    join call_participants cp
                      on cp.call_id = active_call.id
                     and cp.user_id = $2
                   where active_call.conversation_id = c.id
                     and active_call.status = 'accepted'
                     and active_call.ended_at is null
                   order by active_call.started_at desc, active_call.id desc
                   limit 1
                ) as call_id
           from conversations c
           join conversation_members cm
             on cm.conversation_id = c.id
            and cm.user_id = $2
           left join direct_conversation_pairs dp on dp.conversation_id = c.id
          where c.id = $1
          limit 1`,
        [conversationId, userId]
      );

      const row = result.rows[0];
      if (!row) return null;
      if (row.kind === 'group') {
        return {
          kind: 'group',
          conversationId,
          roomName: voiceRoomName(conversationId),
          callId: null
        };
      }
      if (
        row.kind !== 'direct' ||
        !row.user_low_id ||
        !row.user_high_id ||
        (row.user_low_id !== userId && row.user_high_id !== userId) ||
        row.blocked ||
        !row.call_id
      ) {
        return null;
      }
      return {
        kind: 'direct',
        conversationId,
        roomName: directVoiceRoomName(row.call_id),
        callId: row.call_id
      };
    },

    async resolveManagedRoom(roomName) {
      const direct = DIRECT_ROOM_PATTERN.exec(roomName);
      if (direct) {
        const callId = direct[1]!;
        const result = await database.pool.query<{ conversation_id: string }>(
          `select call.conversation_id
             from calls call
             join conversations c on c.id = call.conversation_id and c.kind = 'direct'
            where call.id = $1
              and call.status = 'accepted'
              and call.ended_at is null
            limit 1`,
          [callId]
        );
        return {
          kind: 'direct',
          conversationId: result.rows[0]?.conversation_id ?? null,
          callId,
          valid: Boolean(result.rows[0])
        };
      }

      const group = GROUP_ROOM_PATTERN.exec(roomName);
      if (!group) return null;
      const conversationId = group[1]!;
      const result = await database.pool.query<{ kind: string }>(
        'select kind from conversations where id = $1 limit 1',
        [conversationId]
      );
      return {
        kind: 'group',
        conversationId,
        callId: null,
        valid: result.rows[0]?.kind === 'group'
      };
    }
  };
}

function isIdempotentNotFound(error: unknown): boolean {
  return error instanceof ServerError &&
    (error.status === 404 || error.code === 'not_found');
}

export class LiveKitAuthorizationService {
  private readonly admin: LiveKitAdminClient;
  private readonly issued = new Map<string, IssuedParticipant>();
  private readonly queue = new Map<string, AdminTask>();
  private readonly sessionTombstones = new Map<string, number>();
  private readonly callTombstones = new Map<string, number>();
  private readonly reconciliationIntervalMs: number;
  private readonly maximumQueueSize: number;
  private readonly maximumRegistrySize: number;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly unsubscribe: Array<() => void> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private reconciliationTimer: ReturnType<typeof setInterval> | null = null;
  private draining: Promise<void> | null = null;
  private reconciling: Promise<void> | null = null;
  private adminTail: Promise<void> = Promise.resolve();
  private started = false;
  private stopped = false;
  private controlPlaneHealthy = true;
  private logger: VoiceLogger | undefined;

  constructor(private readonly options: LiveKitAuthorizationServiceOptions) {
    this.admin = options.adminClient ?? new RoomServiceClient(
      options.apiUrl,
      options.apiKey,
      options.apiSecret,
      { requestTimeout: 10, failover: false }
    );
    this.reconciliationIntervalMs = options.reconciliationIntervalMs ?? 30_000;
    this.maximumQueueSize = options.maximumQueueSize ?? 1_000;
    this.maximumRegistrySize = options.maximumRegistrySize ?? 10_000;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.logger = options.logger;

    this.unsubscribe.push(
      options.events.onSessionRevoked((event) => this.revokeSession(event.sessionId)),
      options.events.onConversationRemoved((event) => {
        this.revokeConversationUsers(event.conversationId, event.removedUserIds);
        if (event.remainingUserIds.length === 0) {
          this.enqueueDeleteRoom(voiceRoomName(event.conversationId));
        }
        void this.reconcile();
      }),
      options.events.onDirectBlocked((event) => {
        const callIds = new Set(
          [...this.issued.values()]
            .filter((participant) => participant.conversationId === event.conversationId)
            .flatMap((participant) => participant.callId ? [participant.callId] : [])
        );
        if (event.callId) callIds.add(event.callId);
        this.revokeConversationUsers(event.conversationId, [event.blockerId, event.blockedId]);
        for (const callId of callIds) this.revokeCall(callId, event.conversationId);
        void this.reconcile();
      }),
      options.events.onCallAuthorizationEnded((event) => {
        this.revokeCall(event.callId, event.conversationId);
      })
    );
  }

  get healthy(): boolean {
    return this.controlPlaneHealthy;
  }

  get queuedTaskCount(): number {
    return this.queue.size;
  }

  get issuedParticipantCount(): number {
    return this.issued.size;
  }

  setLogger(logger: VoiceLogger): void {
    this.logger = logger;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.reconcile();
    this.reconciliationTimer = setInterval(
      () => void this.reconcile(),
      this.reconciliationIntervalMs
    );
    this.reconciliationTimer.unref();
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
    this.timer = null;
    this.reconciliationTimer = null;
    for (const unsubscribe of this.unsubscribe.splice(0)) unsubscribe();
    await Promise.allSettled([
      this.draining ?? Promise.resolve(),
      this.reconciling ?? Promise.resolve(),
      this.adminTail
    ]);
  }

  async issueJoinTicket(input: IssueVoiceTicketInput): Promise<VoiceJoinTicket> {
    if (!this.controlPlaneHealthy || this.stopped) {
      throw new LiveKitControlPlaneUnavailableError();
    }

    this.cleanupExpiredState();
    if (this.issued.size >= this.maximumRegistrySize) {
      throw new LiveKitControlPlaneUnavailableError();
    }

    const initialScope = await this.options.store.resolveScope(
      input.userId,
      input.conversationId
    );
    if (!initialScope) throw new VoiceAuthorizationDeniedError();

    const participantInstanceId = input.participantInstanceId ?? randomUUID();
    const sessionTag = roomScopedSessionTag(
      this.options.apiSecret,
      initialScope.roomName,
      input.sessionId
    );
    const identity = voiceParticipantIdentity(sessionTag, participantInstanceId);
    const issued: IssuedParticipant = {
      identity,
      sessionId: input.sessionId,
      userId: input.userId,
      conversationId: input.conversationId,
      callId: initialScope.callId,
      roomName: initialScope.roomName,
      expiresAtMs: this.now() + VOICE_TOKEN_TTL_SECONDS * 1_000,
      cancelled: false
    };
    this.issued.set(identity, issued);

    try {
      const ticket = await createVoiceJoinToken({
        apiKey: this.options.apiKey,
        apiSecret: this.options.apiSecret,
        publicUrl: this.options.publicUrl,
        roomName: initialScope.roomName,
        conversationId: input.conversationId,
        userId: input.userId,
        displayName: input.displayName,
        sessionId: input.sessionId,
        participantInstanceId
      });

      const currentSession = await this.options.sessionService.validateId(input.sessionId, {
        activity: false
      });
      if (!currentSession || currentSession.user.id !== input.userId) {
        issued.cancelled = true;
      }

      const finalScope = await this.options.store.resolveScope(
        input.userId,
        input.conversationId
      );
      if (
        issued.cancelled ||
        !this.controlPlaneHealthy ||
        this.sessionTombstones.has(input.sessionId) ||
        (initialScope.callId && this.callTombstones.has(initialScope.callId)) ||
        !finalScope ||
        finalScope.roomName !== initialScope.roomName
      ) {
        throw new VoiceAuthorizationDeniedError();
      }

      return ticket;
    } catch (error) {
      this.issued.delete(identity);
      throw error;
    }
  }

  revokeSession(sessionId: string): void {
    this.sessionTombstones.set(
      sessionId,
      this.now() + VOICE_TOKEN_TTL_SECONDS * 1_000 + TOMBSTONE_GRACE_MS
    );
    for (const participant of this.issued.values()) {
      if (participant.sessionId !== sessionId) continue;
      participant.cancelled = true;
      this.enqueueRemoveParticipant(participant.roomName, participant.identity);
    }
    void this.reconcile();
  }

  revokeConversationUsers(conversationId: string, userIds: string[]): void {
    const targets = new Set(userIds);
    for (const participant of this.issued.values()) {
      if (
        participant.conversationId !== conversationId ||
        !targets.has(participant.userId)
      ) continue;
      participant.cancelled = true;
      this.enqueueRemoveParticipant(participant.roomName, participant.identity);
    }
  }

  revokeCall(callId: string, conversationId: string): void {
    this.callTombstones.set(
      callId,
      this.now() + VOICE_TOKEN_TTL_SECONDS * 1_000 + TOMBSTONE_GRACE_MS
    );
    const roomName = directVoiceRoomName(callId);
    for (const participant of this.issued.values()) {
      if (participant.callId !== callId && participant.conversationId !== conversationId) continue;
      if (participant.roomName !== roomName) continue;
      participant.cancelled = true;
      this.enqueueRemoveParticipant(roomName, participant.identity);
    }
    this.enqueueDeleteRoom(roomName);
  }

  reconcile(): Promise<void> {
    if (this.reconciling) return this.reconciling;
    this.reconciling = this.runReconciliation().finally(() => {
      this.reconciling = null;
    });
    return this.reconciling;
  }

  private async runReconciliation(): Promise<void> {
    this.cleanupExpiredState();
    let controlPlaneSucceeded = false;
    try {
      const rooms = await this.runAdmin(() => this.admin.listRooms());
      controlPlaneSucceeded = true;
      for (const room of rooms) {
        if (!GROUP_ROOM_PATTERN.test(room.name) && !DIRECT_ROOM_PATTERN.test(room.name)) continue;

        let managed: ManagedVoiceRoom | null;
        try {
          managed = await this.options.store.resolveManagedRoom(room.name);
        } catch {
          continue;
        }
        if (!managed || !managed.valid || !managed.conversationId) {
          this.enqueueDeleteRoom(room.name);
          continue;
        }

        let participants;
        try {
          participants = await this.runAdmin(() => this.admin.listParticipants(room.name));
        } catch (error) {
          this.markControlPlaneFailure(error, 'list-participants');
          controlPlaneSucceeded = false;
          continue;
        }

        for (const participant of participants) {
          let authorized: boolean;
          try {
            authorized = await this.isParticipantAuthorized(
              room.name,
              managed,
              participant
            );
          } catch {
            // Database uncertainty is not proof of revocation.
            continue;
          }
          if (!authorized) {
            this.enqueueRemoveParticipant(room.name, participant.identity);
          }
        }
      }
      if (
        controlPlaneSucceeded &&
        ![...this.queue.values()].some((task) => task.attempts > 0)
      ) {
        this.controlPlaneHealthy = true;
      }
    } catch (error) {
      this.markControlPlaneFailure(error, 'list-rooms');
    }
  }

  private async isParticipantAuthorized(
    roomName: string,
    managed: ManagedVoiceRoom,
    participant: { identity: string; attributes?: Record<string, string> }
  ): Promise<boolean> {
    const parsed = parseVoiceParticipantIdentity(participant.identity);
    const userId = participant.attributes?.cubicUserId;
    const conversationId = participant.attributes?.cubicConversationId;
    if (
      !parsed ||
      !userId ||
      !UUID_VALUE_PATTERN.test(userId) ||
      !conversationId ||
      !UUID_VALUE_PATTERN.test(conversationId) ||
      conversationId !== managed.conversationId
    ) {
      return false;
    }

    let sessionId: string | null = null;
    const registered = this.issued.get(participant.identity);
    if (
      registered &&
      registered.userId === userId &&
      registered.conversationId === conversationId &&
      registered.roomName === roomName
    ) {
      sessionId = registered.sessionId;
    } else {
      const sessions = await this.options.sessionService.listActiveForUser(userId);
      for (const session of sessions) {
        if (
          roomScopedSessionTag(this.options.apiSecret, roomName, session.id) ===
          parsed.sessionTag
        ) {
          sessionId = session.id;
          break;
        }
      }
    }
    if (!sessionId || this.sessionTombstones.has(sessionId)) return false;

    const session = await this.options.sessionService.validateId(sessionId, { activity: false });
    if (!session || session.user.id !== userId) return false;
    const scope = await this.options.store.resolveScope(userId, conversationId);
    return Boolean(scope && scope.roomName === roomName);
  }

  private enqueueRemoveParticipant(roomName: string, participantIdentity: string): void {
    this.enqueue({
      key: `participant:${roomName}:${participantIdentity}`,
      kind: 'remove-participant',
      roomName,
      participantIdentity,
      attempts: 0,
      nextAttemptAtMs: this.now()
    });
  }

  private enqueueDeleteRoom(roomName: string): void {
    this.enqueue({
      key: `room:${roomName}`,
      kind: 'delete-room',
      roomName,
      attempts: 0,
      nextAttemptAtMs: this.now()
    });
  }

  private enqueue(task: AdminTask): void {
    if (this.stopped || this.queue.has(task.key)) return;
    if (this.queue.size >= this.maximumQueueSize) {
      this.controlPlaneHealthy = false;
      this.logger?.warn(
        { operation: task.kind, queueSize: this.queue.size },
        'LiveKit authorization queue is at capacity; reconciliation will retry'
      );
      return;
    }
    this.queue.set(task.key, task);
    this.scheduleDrain(0);
  }

  private scheduleDrain(delayMs: number): void {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drainQueue();
    }, Math.max(0, delayMs));
    this.timer.unref();
  }

  private drainQueue(): Promise<void> {
    if (this.draining) return this.draining;
    this.draining = this.runQueue().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  private async runQueue(): Promise<void> {
    while (!this.stopped) {
      const now = this.now();
      const task = [...this.queue.values()]
        .filter((candidate) => candidate.nextAttemptAtMs <= now)
        .sort((left, right) => left.nextAttemptAtMs - right.nextAttemptAtMs)[0];
      if (!task) {
        const next = [...this.queue.values()]
          .reduce<number | null>((value, candidate) =>
            value === null ? candidate.nextAttemptAtMs : Math.min(value, candidate.nextAttemptAtMs), null);
        if (next !== null) this.scheduleDrain(next - now);
        return;
      }

      try {
        await this.executeTask(task);
        this.queue.delete(task.key);
        if (![...this.queue.values()].some((pending) => pending.attempts > 0)) {
          this.controlPlaneHealthy = true;
        }
      } catch (error) {
        if (isIdempotentNotFound(error)) {
          this.queue.delete(task.key);
          if (![...this.queue.values()].some((pending) => pending.attempts > 0)) {
            this.controlPlaneHealthy = true;
          }
          continue;
        }
        this.markControlPlaneFailure(error, task.kind);
        task.attempts += 1;
        const base = Math.min(30_000, 250 * 2 ** Math.min(task.attempts - 1, 7));
        const jitter = Math.floor(base * 0.2 * this.random());
        task.nextAttemptAtMs = this.now() + base + jitter;
      }
    }
  }

  private async executeTask(task: AdminTask): Promise<void> {
    if (task.kind === 'delete-room') {
      await this.runAdmin(() => this.admin.deleteRoom(task.roomName));
      return;
    }
    await this.runAdmin(() => this.admin.removeParticipant(
      task.roomName,
      task.participantIdentity!
    ));
  }

  private runAdmin<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.adminTail.then(operation);
    this.adminTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private markControlPlaneFailure(error: unknown, operation: string): void {
    this.controlPlaneHealthy = false;
    this.logger?.warn(
      {
        operation,
        errorName: error instanceof Error ? error.name : 'UnknownError'
      },
      'LiveKit authorization control-plane operation failed'
    );
  }

  private cleanupExpiredState(): void {
    const now = this.now();
    const registryCutoff = now - this.reconciliationIntervalMs * 2;
    for (const [identity, participant] of this.issued) {
      if (participant.expiresAtMs < registryCutoff) this.issued.delete(identity);
    }
    for (const [sessionId, expiresAt] of this.sessionTombstones) {
      if (expiresAt < now) this.sessionTombstones.delete(sessionId);
    }
    for (const [callId, expiresAt] of this.callTombstones) {
      if (expiresAt < now) this.callTombstones.delete(callId);
    }
  }
}
