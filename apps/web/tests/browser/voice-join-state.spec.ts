import { expect, test, type Page } from '@playwright/test';
import { chooseServerCreate, openServers } from './navigation';

async function installRoomControls(page: Page) {
  await page.addInitScript(() => {
    type Deferred = { promise: Promise<void>; resolve: () => void; reject: () => void };
    const deferred = (): Deferred => {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      return { promise, resolve, reject: () => reject(new Error('Fixture media failure')) };
    };
    const rooms: Array<any> = [];
    const controls = {
      rooms,
      emitConnected(index: number) { rooms[index].emit('connected'); },
      resolveConnect(index: number) { rooms[index].connection.resolve(); },
      rejectConnect(index: number) { rooms[index].connection.reject(); },
      resolveAudio(index: number) { rooms[index].audio.resolve(); },
      rejectAudio(index: number) { rooms[index].audio.reject(); },
      resolveMicrophone(index: number) { rooms[index].microphone.resolve(); },
      rejectMicrophone(index: number) { rooms[index].microphone.reject(); },
      disconnect(index: number) { rooms[index].emit('disconnected'); }
    };
    const factory = () => {
      const listeners = new Map<string, Array<() => void>>();
      const connection = deferred();
      const audio = deferred();
      const microphone = deferred();
      const room = {
        connection, audio, microphone, connectCalls: 0, disconnectCalls: 0,
        localParticipant: {
          identity: 'fixture-local', name: 'Tester', isLocal: true, isSpeaking: false,
          isMicrophoneEnabled: false,
          getTrackPublication: () => undefined,
          async setMicrophoneEnabled(enabled: boolean) {
            if (!enabled) { this.isMicrophoneEnabled = false; return; }
            await microphone.promise;
            this.isMicrophoneEnabled = true;
          }
        },
        remoteParticipants: new Map(), canPlaybackAudio: true,
        on(event: string, listener: () => void) { listeners.set(event, [...(listeners.get(event) ?? []), listener]); },
        emit(event: string) { listeners.get(event)?.forEach((listener) => listener()); },
        async connect() { this.connectCalls++; await connection.promise; },
        async startAudio() { await audio.promise; },
        async disconnect() { this.disconnectCalls++; },
        async switchActiveDevice() {}
      };
      rooms.push(room);
      return room;
    };
    Object.assign(window, {
      __cubicVoiceJoinControls: controls,
      __cubicServerVoiceTestRoom: factory,
      __cubicVoiceTestRoom: factory
    });
  });
}

async function roomCount(page: Page, count: number) {
  await expect.poll(() => page.evaluate(() => (window as any).__cubicVoiceJoinControls.rooms.length)).toBe(count);
}

async function control(page: Page, method: string, index: number) {
  await page.evaluate(({ method, index }) => (window as any).__cubicVoiceJoinControls[method](index), { method, index });
}

async function createServerVoice(page: Page) {
  await openServers(page);
  await page.getByRole('button', { name: 'Create server' }).first().click();
  await page.getByRole('dialog', { name: 'Create server' }).getByRole('textbox', { name: 'Server name' }).fill('Voice Hub');
  await page.getByRole('dialog', { name: 'Create server' }).getByRole('button', { name: 'Create server' }).click();
  await chooseServerCreate(page, 'Create voice channel');
  await page.getByRole('dialog', { name: 'Create voice channel' }).getByRole('textbox', { name: 'Voice channel name' }).fill('Lounge');
  await page.getByRole('dialog', { name: 'Create voice channel' }).getByRole('button', { name: 'Create voice channel' }).click();
  return page.getByRole('button', { name: 'Join voice channel Lounge' });
}

test.beforeEach(async ({ page, context, request }) => {
  await request.post('http://127.0.0.1:3198/__test/reset');
  await request.post('http://127.0.0.1:3198/__test/server-voice-connected');
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  await installRoomControls(page);
  await page.goto('/app');
});

test('server voice connects before media settles and reports independent media failures', async ({ page }) => {
  const join = await createServerVoice(page);
  await join.click();
  await roomCount(page, 1);
  const dock = page.getByRole('region', { name: 'Voice room' });
  await expect(dock).toContainText('Joining voice…');
  await control(page, 'emitConnected', 0);
  await expect(dock).toContainText('Joining voice…');
  await control(page, 'resolveConnect', 0);
  await expect(dock).toContainText('1 connected');
  await control(page, 'rejectAudio', 0);
  await expect(dock).toContainText('Browser audio playback is paused');
  await expect(dock).toContainText('1 connected');
  await control(page, 'rejectMicrophone', 0);
  await expect(dock.getByRole('alert')).toContainText('Connected, microphone unavailable');
  await expect(dock.getByRole('button', { name: 'Unmute microphone' })).toBeVisible();
  await expect(dock).toContainText('1 connected');
});

test('server voice timeout cleans up and retry uses a new room; stale connect cannot restore old room', async ({ page }) => {
  test.setTimeout(60_000);
  const join = await createServerVoice(page);
  let tickets = 0;
  page.on('response', (response) => {
    if (response.request().method() === 'POST' && /\/api\/v1\/server-voice\/channels\/[^/]+\/token$/.test(response.url())) tickets++;
  });
  await page.clock.install();
  await join.click();
  await roomCount(page, 1);
  await page.clock.fastForward(15_100);
  const dock = page.getByRole('region', { name: 'Voice room' });
  await expect(dock).toContainText('Voice unavailable');
  await expect(dock.getByRole('button', { name: 'Retry voice channel' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__cubicVoiceJoinControls.rooms[0].disconnectCalls)).toBeGreaterThan(0);
  await dock.getByRole('button', { name: 'Retry voice channel' }).click();
  await roomCount(page, 2);
  expect(tickets).toBe(2);
  await control(page, 'resolveConnect', 0);
  await expect(dock).toContainText('Joining voice…');
  await control(page, 'emitConnected', 1);
  await control(page, 'resolveConnect', 1);
  await expect(dock).toContainText('1 connected');
});

test('server voice rejected connect exposes retry on the same channel', async ({ page }) => {
  const join = await createServerVoice(page);
  await join.click();
  await roomCount(page, 1);
  await control(page, 'rejectConnect', 0);
  const dock = page.getByRole('region', { name: 'Voice room' });
  await expect(dock.getByRole('button', { name: 'Retry voice channel' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__cubicVoiceJoinControls.rooms[0].disconnectCalls)).toBeGreaterThan(0);
  await join.click();
  await roomCount(page, 2);
  await control(page, 'emitConnected', 1);
  await control(page, 'resolveConnect', 1);
  await expect(dock).toContainText('1 connected');
});

test('server voice leave and disconnect during setup ignore late media completion', async ({ page }) => {
  const join = await createServerVoice(page);
  await join.click();
  await roomCount(page, 1);
  const dock = page.getByRole('region', { name: 'Voice room' });
  await dock.getByRole('button', { name: 'Leave voice channel' }).click();
  await expect(dock).toHaveCount(0);
  await control(page, 'resolveConnect', 0);
  await expect(dock).toHaveCount(0);
  await join.click();
  await roomCount(page, 2);
  await control(page, 'disconnect', 1);
  await expect(dock).toContainText('Voice unavailable');
  await control(page, 'resolveConnect', 1);
  await expect(dock).not.toContainText('1 connected');
  await dock.getByRole('button', { name: 'Retry voice channel' }).click();
  await roomCount(page, 3);
  await control(page, 'emitConnected', 2);
  await control(page, 'resolveConnect', 2);
  await expect(dock).toContainText('1 connected');
  await control(page, 'disconnect', 2);
  await expect(dock).toContainText('Voice unavailable');
  await control(page, 'resolveAudio', 2);
  await control(page, 'resolveMicrophone', 2);
  await expect(dock).not.toContainText('1 connected');
});

test('group voice uses the same connection-first media state', async ({ page }) => {
  await page.locator('.conversation-row').filter({ hasText: 'Fixture group' }).click();
  await page.route('**/api/v1/voice/conversations/*/token', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'wss://fixture-livekit.invalid', token: 'fixture-group-ticket' })
  }));
  await page.getByRole('button', { name: 'Join group voice' }).click();
  await roomCount(page, 1);
  const dock = page.getByRole('region', { name: 'Voice room' });
  await expect(dock).toContainText('Joining voice…');
  await control(page, 'emitConnected', 0);
  await control(page, 'resolveConnect', 0);
  await expect(dock).toContainText('1 connected');
  await control(page, 'rejectMicrophone', 0);
  await expect(dock.getByRole('alert')).toContainText('Connected, microphone unavailable');
  await expect(dock).toContainText('1 connected');
});
