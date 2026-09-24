export const serverInviteTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function validServerInviteToken(value: unknown): value is string {
  return typeof value === 'string' && serverInviteTokenPattern.test(value);
}

export function firstTrustedServerInviteToken(body: string, trustedOrigin: string): string | null {
  // Only inspect complete, absolute URL-shaped words. An embedded URL in an
  // external URL's query must never become a trusted Cubic invitation.
  const candidates = /(?:^|[\s(<])((?:https?:\/\/)[^\s<>"'`]+)/g;
  for (const match of body.matchAll(candidates)) {
    const candidate = match[1].replace(/[.,!?;:)\]}]+$/, '');
    if (!/^https?:\/\/[^/?#]+\/invite#[A-Za-z0-9_-]{43}$/.test(candidate)) continue;
    try {
      const url = new URL(candidate);
      if (url.origin === trustedOrigin && url.pathname === '/invite' && !url.username && !url.password &&
        !url.search && validServerInviteToken(url.hash.slice(1))) return url.hash.slice(1);
    } catch { /* Malformed message URLs remain plain text. */ }
  }
  return null;
}

export type ServerInvitePreview = { valid: true; server: { id: string; name: string }; alreadyMember?: boolean };
export type ServerInvitePreviewResult =
  | { kind: 'available'; preview: ServerInvitePreview }
  | { kind: 'unavailable' | 'error' | 'deferred' };

export async function previewServerInvite(token: string): Promise<ServerInvitePreviewResult> {
  try {
    const response = await fetch('/api/v1/server-invite-links/preview', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      credentials: 'include', cache: 'no-store', body: JSON.stringify({ token })
    });
    if (response.status === 404) return { kind: 'unavailable' };
    if (!response.ok) return { kind: 'error' };
    return { kind: 'available', preview: await response.json() as ServerInvitePreview };
  } catch { return { kind: 'error' }; }
}

export async function joinServerInvite(token: string): Promise<Response> {
  return fetch('/api/v1/server-invite-links/join', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    credentials: 'include', cache: 'no-store', body: JSON.stringify({ token })
  });
}

type PendingPreview = { token: string; resolve: (result: ServerInvitePreviewResult) => void };

export class ServerInvitePreviewQueue {
  private readonly cached = new Map<string, { until: number; promise: Promise<ServerInvitePreviewResult> }>();
  private readonly pending: PendingPreview[] = [];
  private readonly automaticTimes: number[] = [];
  private active = 0;
  private disposed = false;

  preview(token: string, automatic = true): Promise<ServerInvitePreviewResult> {
    if (this.disposed) return Promise.resolve({ kind: 'deferred' });
    const now = Date.now();
    const cached = this.cached.get(token);
    if (cached && cached.until > now) return cached.promise;
    if (cached) this.cached.delete(token);
    if (automatic) {
      while (this.automaticTimes[0] !== undefined && this.automaticTimes[0] <= now - 60_000)
        this.automaticTimes.shift();
      if (this.automaticTimes.length >= 20 || this.pending.length >= 20) return Promise.resolve({ kind: 'deferred' });
      this.automaticTimes.push(now);
    }
    const promise = new Promise<ServerInvitePreviewResult>((resolve) => {
      this.pending.push({ token, resolve });
      this.drain();
    });
    this.cached.set(token, { until: now + 60_000, promise });
    while (this.cached.size > 64) this.cached.delete(this.cached.keys().next().value!);
    return promise;
  }

  invalidate(token: string) { this.cached.delete(token); }

  dispose() {
    this.disposed = true;
    this.cached.clear();
    for (const task of this.pending.splice(0)) task.resolve({ kind: 'deferred' });
  }

  private drain() {
    while (!this.disposed && this.active < 2 && this.pending.length) {
      const task = this.pending.shift()!;
      this.active += 1;
      void previewServerInvite(task.token).then((result) => {
        if (result.kind === 'error') this.cached.delete(task.token);
        task.resolve(result);
      }).finally(() => { this.active -= 1; this.drain(); });
    }
  }
}
