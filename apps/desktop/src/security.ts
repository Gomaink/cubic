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

/** Display capture has a separate, stricter grant path than camera/microphone. */
export function allowsDisplayCapture(
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
