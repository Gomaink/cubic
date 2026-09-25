import type { AudioCaptureOptions } from 'livekit-client';

export function microphoneCaptureOptions(processing: boolean, deviceId: string): AudioCaptureOptions {
  return {
    deviceId: deviceId ? { exact: deviceId } : undefined,
    // Optional boolean constraints are preferences; browsers may ignore unsupported ones.
    echoCancellation: processing,
    noiseSuppression: processing,
    autoGainControl: processing,
    voiceIsolation: processing
  };
}

export function missingSelectedCameraNotice(cameraActive: boolean): string {
  return cameraActive
    ? 'The selected camera disconnected. Choose another in Voice & Video settings.'
    : '';
}

function errorName(error: unknown): string {
  return error && typeof error === 'object' && 'name' in error
    ? String((error as { name?: unknown }).name ?? '')
    : '';
}

export function mediaDeviceErrorMessage(error: unknown, kind: 'microphone' | 'camera'): string {
  const label = kind === 'camera' ? 'Camera' : 'Microphone';
  const lowerLabel = kind === 'camera' ? 'camera' : 'microphone';
  const name = errorName(error);
  const message = error instanceof Error ? error.message.toLowerCase() : '';

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' ||
      message.includes('requested device not found') || message.includes('object can not be found')) {
    return `No ${lowerLabel} was found on this device.`;
  }
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError' ||
      message.includes('permission denied') || message.includes('not allowed by the user agent')) {
    return `${label} access is blocked. Allow ${lowerLabel} access for this site in browser and operating-system permissions.`;
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return `${label} is unavailable or already being used by another application.`;
  }
  if (name === 'OverconstrainedError') {
    return `${label} is present, but the browser could not satisfy the requested capture settings.`;
  }
  if (name === 'AbortError') return `${label} capture was interrupted. Try again.`;
  return `Could not access the ${lowerLabel}. Check its connection and browser permissions.`;
}

export function screenShareFailure(error: unknown): { cancelled: boolean; message: string } {
  const name = errorName(error);
  if (name === 'AbortError') return { cancelled: true, message: '' };
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return { cancelled: true, message: 'Screen sharing was not started. If access was blocked, check browser permissions.' };
  }
  if (name === 'InvalidStateError') return { cancelled: false, message: 'Click Share again from the active browser tab.' };
  if (name === 'NotFoundError') return { cancelled: false, message: 'No shareable screen, window, or tab was found.' };
  if (name === 'NotReadableError') return { cancelled: false, message: 'The selected screen or window could not be captured.' };
  if (name === 'TypeError') return { cancelled: false, message: 'Screen sharing is not available with this browser configuration.' };
  return { cancelled: false, message: 'Could not start screen sharing. Try again.' };
}
