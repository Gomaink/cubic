/** The only web origin authorized to run inside the Desktop Preview. */
export const CUBIC_ORIGIN = 'https://cubic.goma.ink';

export type NavigationKind = 'internal' | 'external' | 'blocked';

export function classifyNavigation(target: string): NavigationKind {
  try {
    const url = new URL(target);
    if (url.username || url.password) return 'blocked';
    if (url.origin === CUBIC_ORIGIN) return 'internal';

    // Never send a downgraded or alternate-port Cubic URL to the OS browser.
    if (url.hostname === new URL(CUBIC_ORIGIN).hostname) return 'blocked';
    if (url.protocol === 'http:' || url.protocol === 'https:') return 'external';
  } catch {
    // Relative, malformed, and non-URL targets cannot cross the shell boundary.
  }
  return 'blocked';
}

/** Only browser capabilities used by Cubic's current web experience. */
export function allowsPermission(
  permission: string,
  requestingUrl: string,
  isMainFrame: boolean,
  mediaTypes?: readonly string[]
): boolean {
  if (!isMainFrame || classifyNavigation(requestingUrl) !== 'internal') return false;
  if (permission === 'media') {
    return mediaTypes !== undefined && mediaTypes.length > 0 &&
      mediaTypes.every((type) => type === 'audio' || type === 'video');
  }
  return permission === 'speaker-selection' ||
    permission === 'clipboard-sanitized-write' ||
    permission === 'fullscreen';
}

/** Parse an Electron security origin without accepting a different authority. */
export function inspectCubicSecurityOrigin(value: unknown): {
  present: boolean;
  parseable: boolean;
  normalizedMatches: boolean;
} {
  if (typeof value !== 'string' || value.length === 0) {
    return { present: false, parseable: false, normalizedMatches: false };
  }
  try {
    const parsed = new URL(value);
    return {
      present: true,
      parseable: true,
      normalizedMatches: parsed.protocol === 'https:' &&
        parsed.hostname === 'cubic.goma.ink' && parsed.port === '' &&
        parsed.username === '' && parsed.password === '' &&
        parsed.origin === CUBIC_ORIGIN
    };
  } catch {
    return { present: true, parseable: false, normalizedMatches: false };
  }
}

/** Display capture has a separate, stricter grant path than camera/microphone. */
export function allowsDisplayCapture(
  requestingOrigin: string | undefined,
  requestingUrl: string | undefined,
  isMainFrame: boolean
): boolean {
  return isMainFrame && inspectCubicSecurityOrigin(requestingOrigin).normalizedMatches &&
    requestingUrl !== undefined && classifyNavigation(requestingUrl) === 'internal';
}

/**
 * Electron 44 reports getDisplayMedia as media with an empty mediaTypes list.
 * Electron 45+ reports it as display-capture. This allowance only lets Chromium
 * continue to the separately secured setDisplayMediaRequestHandler; it does not
 * choose or grant a capture source.
 */
export interface LegacyDisplayPermissionContext {
  phase: 'check' | 'request';
  electronVersion: string | undefined;
  permission: string;
  mediaType?: string | undefined;
  mediaTypes?: readonly string[] | undefined;
  requesterMatches: boolean;
  isMainFrame: boolean;
  requestingOrigin: string | undefined;
  requestingUrl: string | undefined;
  currentDocumentUrl: string | undefined;
  isWindows: boolean;
}

export function allowsElectron44LegacyDisplayPermission(context: LegacyDisplayPermissionContext): boolean {
  const { phase, electronVersion, permission, mediaType, mediaTypes, requesterMatches,
    isMainFrame, requestingOrigin, requestingUrl, currentDocumentUrl, isWindows } = context;
  if (!/^44\.(?:\d+\.)*\d+$/.test(electronVersion ?? '') ||
      permission !== 'media' || !isWindows || !requesterMatches || !isMainFrame) return false;
  if (phase === 'check'
    ? mediaType !== undefined || mediaTypes !== undefined
    : mediaType !== undefined || mediaTypes === undefined || mediaTypes.length !== 0) {
    return false;
  }
  if (!requestingOrigin || !requestingUrl || !currentDocumentUrl) return false;
  try {
    const origin = new URL(requestingOrigin);
    if (origin.username || origin.password || origin.origin !== CUBIC_ORIGIN) return false;
  } catch {
    return false;
  }
  return classifyNavigation(requestingUrl) === 'internal' &&
    classifyNavigation(currentDocumentUrl) === 'internal';
}

/** Web notifications are eligible only from the current Cubic document. */
export function allowsNotifications(
  requestingOrigin: string | undefined,
  requestingUrl: string | undefined,
  isMainFrame: boolean
): boolean {
  return isMainFrame && requestingOrigin === CUBIC_ORIGIN &&
    requestingUrl !== undefined && classifyNavigation(requestingUrl) === 'internal';
}

/** Facts from Electron's display request; frame identity is checked in main. */
export function allowsDisplayRequest(
  securityOrigin: string | undefined,
  frameUrl: string | undefined,
  frameIsExpectedMain: boolean,
  userGesture: boolean,
  videoRequested: boolean
): boolean {
  return userGesture && videoRequested &&
    allowsDisplayCapture(securityOrigin, frameUrl, frameIsExpectedMain);
}
