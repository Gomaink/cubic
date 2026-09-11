import { randomUUID } from 'node:crypto';

export type ActiveDirectCallState = 'ringing' | 'accepted';
export type TerminalDirectCallState = 'declined' | 'cancelled' | 'ended' | 'missed';

export interface DirectCallSession {
  id: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  callerDisplayName: string;
  callerUsername: string;
  callerSocketId: string;
  acceptedSocketId: string | null;
  state: ActiveDirectCallState;
  createdAt: Date;
  acceptedAt: Date | null;
}

export interface StartDirectCallInput {
  conversationId: string;
  callerId: string;
  calleeId: string;
  callerDisplayName: string;
  callerUsername: string;
  callerSocketId: string;
}

export interface FinishedDirectCall {
  call: DirectCallSession;
  state: TerminalDirectCallState;
  actorId: string | null;
}

export class CallLifecycleError extends Error {
  constructor(
    public readonly code: 'busy' | 'forbidden' | 'invalid_state' | 'not_found',
    message: string
  ) {
    super(message);
    this.name = 'CallLifecycleError';
  }
}

export class DirectCallCoordinator {
  private readonly byId = new Map<string, DirectCallSession>();
  private readonly byConversation = new Map<string, string>();
  private readonly byUser = new Map<string, string>();

  constructor(
    private readonly createId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date()
  ) {}

  start(input: StartDirectCallInput): DirectCallSession {
    if (input.callerId === input.calleeId) {
      throw new CallLifecycleError('forbidden', 'You cannot call yourself.');
    }

    const existingConversationCall = this.byConversation.get(input.conversationId);
    if (existingConversationCall) {
      const current = this.byId.get(existingConversationCall);
      if (current && current.callerId === input.callerId && current.state === 'ringing') {
        return current;
      }
      throw new CallLifecycleError('busy', 'This conversation already has an active call.');
    }

    if (this.byUser.has(input.callerId)) {
      throw new CallLifecycleError('busy', 'You are already in another call.');
    }

    if (this.byUser.has(input.calleeId)) {
      throw new CallLifecycleError('busy', 'This user is already in another call.');
    }

    const call: DirectCallSession = {
      id: this.createId(),
      conversationId: input.conversationId,
      callerId: input.callerId,
      calleeId: input.calleeId,
      callerDisplayName: input.callerDisplayName,
      callerUsername: input.callerUsername,
      callerSocketId: input.callerSocketId,
      acceptedSocketId: null,
      state: 'ringing',
      createdAt: this.now(),
      acceptedAt: null
    };

    this.byId.set(call.id, call);
    this.byConversation.set(call.conversationId, call.id);
    this.byUser.set(call.callerId, call.id);
    this.byUser.set(call.calleeId, call.id);
    return call;
  }

  get(callId: string): DirectCallSession | null {
    return this.byId.get(callId) ?? null;
  }

  getForUser(userId: string): DirectCallSession | null {
    const callId = this.byUser.get(userId);
    return callId ? this.byId.get(callId) ?? null : null;
  }

  accept(callId: string, userId: string, socketId: string): DirectCallSession {
    const call = this.require(callId);
    if (call.calleeId !== userId) {
      throw new CallLifecycleError('forbidden', 'Only the recipient can accept this call.');
    }
    if (call.state !== 'ringing') {
      throw new CallLifecycleError('invalid_state', 'This call is no longer ringing.');
    }

    call.state = 'accepted';
    call.acceptedAt = this.now();
    call.acceptedSocketId = socketId;
    return call;
  }

  decline(callId: string, userId: string): FinishedDirectCall {
    const call = this.require(callId);
    if (call.calleeId !== userId) {
      throw new CallLifecycleError('forbidden', 'Only the recipient can decline this call.');
    }
    if (call.state !== 'ringing') {
      throw new CallLifecycleError('invalid_state', 'This call is no longer ringing.');
    }
    return this.finish(call, 'declined', userId);
  }

  cancel(callId: string, userId: string): FinishedDirectCall {
    const call = this.require(callId);
    if (call.callerId !== userId) {
      throw new CallLifecycleError('forbidden', 'Only the caller can cancel this call.');
    }
    if (call.state !== 'ringing') {
      throw new CallLifecycleError('invalid_state', 'This call can no longer be cancelled.');
    }
    return this.finish(call, 'cancelled', userId);
  }

  end(callId: string, userId: string): FinishedDirectCall {
    const call = this.require(callId);
    if (call.callerId !== userId && call.calleeId !== userId) {
      throw new CallLifecycleError('forbidden', 'You are not a participant in this call.');
    }
    if (call.state !== 'accepted') {
      throw new CallLifecycleError('invalid_state', 'This call is not connected.');
    }
    return this.finish(call, 'ended', userId);
  }

  expire(callId: string): FinishedDirectCall | null {
    const call = this.byId.get(callId);
    if (!call || call.state !== 'ringing') return null;
    return this.finish(call, 'missed', null);
  }

  private require(callId: string): DirectCallSession {
    const call = this.byId.get(callId);
    if (!call) throw new CallLifecycleError('not_found', 'Call not found.');
    return call;
  }

  private finish(
    call: DirectCallSession,
    state: TerminalDirectCallState,
    actorId: string | null
  ): FinishedDirectCall {
    this.byId.delete(call.id);
    this.byConversation.delete(call.conversationId);
    this.byUser.delete(call.callerId);
    this.byUser.delete(call.calleeId);
    return { call, state, actorId };
  }
}
