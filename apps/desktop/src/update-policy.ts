export type UpdateState = 'idle' | 'checking' | 'downloading' | 'ready';

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Reject unsigned or redirected packaged update configurations before networking. */
export function isTrustedUpdateConfig(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const config = value as Record<string, unknown>;
  const publisher = config.publisherName;
  const hasPublisher = typeof publisher === 'string'
    ? publisher.trim().length > 0
    : Array.isArray(publisher) && publisher.length > 0 &&
      publisher.every((name) => typeof name === 'string' && name.trim().length > 0);
  return hasPublisher && config.provider === 'github' && config.owner === 'Gomaink' &&
    config.repo === 'cubic' && config.channel === 'alpha' &&
    (config.protocol === undefined || config.protocol === 'https') &&
    config.host === undefined && config.private !== true &&
    config.token === undefined && config.requestHeaders === undefined;
}

export function canStartUpdateCheck(
  active: boolean,
  state: UpdateState,
  hasPendingCheck: boolean,
  installRequested: boolean
): boolean {
  return active && state === 'idle' && !hasPendingCheck && !installRequested;
}

/** The preview accepts only newer alpha builds on its current release line. */
export function isEligiblePreviewUpdate(current: string, candidate: string): boolean {
  const pattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-alpha\.(0|[1-9]\d*)$/u;
  const from = pattern.exec(current);
  const to = pattern.exec(candidate);
  if (!from || !to || from.slice(1, 4).some((part, index) => part !== to[index + 1])) return false;
  const oldSequence = Number(from[4]);
  const newSequence = Number(to[4]);
  return Number.isSafeInteger(oldSequence) && Number.isSafeInteger(newSequence) && newSequence > oldSequence;
}

export function updateMenuAction(state: UpdateState, updaterActive: boolean): {
  label: string;
  enabled: boolean;
  action: 'check' | 'install' | null;
} {
  if (state === 'ready') return { label: 'Restart to Update', enabled: updaterActive, action: 'install' };
  if (state === 'checking') return { label: 'Checking for Updates…', enabled: false, action: null };
  if (state === 'downloading') return { label: 'Downloading Update…', enabled: false, action: null };
  return { label: 'Check for Updates', enabled: updaterActive, action: 'check' };
}
