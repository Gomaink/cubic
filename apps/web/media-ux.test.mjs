import assert from 'node:assert/strict';
import test from 'node:test';
import { microphoneCaptureOptions, mediaDeviceErrorMessage, screenShareFailure } from './src/lib/media-ux.ts';

test('native microphone processing follows the saved choice without requiring unsupported constraints', () => {
  assert.deepEqual(microphoneCaptureOptions(true, ''), {
    deviceId: undefined, echoCancellation: true, noiseSuppression: true,
    autoGainControl: true, voiceIsolation: true
  });
  assert.deepEqual(microphoneCaptureOptions(false, 'selected-device'), {
    deviceId: { exact: 'selected-device' }, echoCancellation: false,
    noiseSuppression: false, autoGainControl: false, voiceIsolation: false
  });
});

test('media errors are actionable and never expose raw exception text', () => {
  assert.match(mediaDeviceErrorMessage(new DOMException('private device label', 'NotFoundError'), 'microphone'), /No microphone/);
  assert.match(mediaDeviceErrorMessage(new DOMException('private device label', 'NotAllowedError'), 'camera'), /browser and operating-system permissions/);
  assert.equal(mediaDeviceErrorMessage(new Error('secret internal failure'), 'microphone').includes('secret'), false);
  assert.deepEqual(screenShareFailure(new DOMException('user dismissed picker', 'AbortError')), { cancelled: true, message: '' });
  assert.equal(screenShareFailure(new DOMException('dismissed picker', 'NotAllowedError')).cancelled, true);
  assert.equal(screenShareFailure(new Error('secret internal failure')).message.includes('secret'), false);
});
