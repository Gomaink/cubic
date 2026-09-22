export type PresenceStatus = 'online' | 'idle' | 'offline';
export type SocketActivity = 'active' | 'idle';

export class PresenceRegistry {
  private readonly socketsByUser = new Map<string, Map<string, SocketActivity>>();
  private readonly userBySocket = new Map<string, string>();

  constructor(private readonly onChange: (userId: string, status: PresenceStatus) => void) {}

  status(userId: string): PresenceStatus {
    const sockets = this.socketsByUser.get(userId);
    if (!sockets?.size) return 'offline';
    return [...sockets.values()].some((activity) => activity === 'active') ? 'online' : 'idle';
  }

  register(userId: string, socketId: string): void {
    if (this.userBySocket.has(socketId)) throw new Error('Socket is already registered for presence.');
    const before = this.status(userId);
    let sockets = this.socketsByUser.get(userId);
    if (!sockets) this.socketsByUser.set(userId, sockets = new Map());
    sockets.set(socketId, 'active');
    this.userBySocket.set(socketId, userId);
    this.emitIfChanged(userId, before);
  }

  setActivity(socketId: string, activity: SocketActivity): boolean {
    const userId = this.userBySocket.get(socketId);
    if (!userId || (activity !== 'active' && activity !== 'idle')) return false;
    const sockets = this.socketsByUser.get(userId);
    if (!sockets) return false;
    const before = this.status(userId);
    sockets.set(socketId, activity);
    this.emitIfChanged(userId, before);
    return true;
  }

  unregister(socketId: string): void {
    const userId = this.userBySocket.get(socketId);
    if (!userId) return;
    const before = this.status(userId);
    this.userBySocket.delete(socketId);
    const sockets = this.socketsByUser.get(userId);
    sockets?.delete(socketId);
    if (sockets?.size === 0) this.socketsByUser.delete(userId);
    this.emitIfChanged(userId, before);
  }

  clear(): void {
    this.socketsByUser.clear();
    this.userBySocket.clear();
  }

  private emitIfChanged(userId: string, before: PresenceStatus): void {
    const after = this.status(userId);
    if (after !== before) this.onChange(userId, after);
  }
}
