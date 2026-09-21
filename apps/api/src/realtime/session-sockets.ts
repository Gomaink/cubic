import type { Socket } from 'socket.io';

export class SessionSocketRegistry {
  private readonly socketsBySession = new Map<string, Map<string, Socket>>();

  register(sessionId: string, socket: Socket): void {
    let sockets = this.socketsBySession.get(sessionId);
    if (!sockets) {
      sockets = new Map();
      this.socketsBySession.set(sessionId, sockets);
    }

    sockets.set(socket.id, socket);
    socket.once('disconnect', () => this.unregister(sessionId, socket.id));
  }

  unregister(sessionId: string, socketId: string): void {
    const sockets = this.socketsBySession.get(sessionId);
    if (!sockets) return;

    sockets.delete(socketId);
    if (sockets.size === 0) this.socketsBySession.delete(sessionId);
  }

  disconnectSession(sessionId: string): void {
    const sockets = this.socketsBySession.get(sessionId);
    if (!sockets) return;

    this.socketsBySession.delete(sessionId);
    for (const socket of sockets.values()) socket.disconnect(true);
  }

  sessionIds(): string[] {
    return [...this.socketsBySession.keys()];
  }

  get sessionCount(): number {
    return this.socketsBySession.size;
  }

  get socketCount(): number {
    let count = 0;
    for (const sockets of this.socketsBySession.values()) count += sockets.size;
    return count;
  }
}
