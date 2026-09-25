import { test, expect } from '@playwright/test';
import { chooseChannelAction, chooseServerCreate, isCompactNavigation, openMessages, openServers } from './navigation';

test.beforeEach(async ({ page, context, request }) => {
  await request.post('http://127.0.0.1:3198/__test/reset');
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/app');
});

test('owner manages voice channels in mixed text/voice order and media outage preserves navigation', async ({ page }) => {
  await openServers(page);
  await page.getByRole('button', { name: 'Create server' }).first().click();
  await page.getByRole('dialog', { name: 'Create server' }).getByRole('textbox', { name: 'Server name' }).fill('Voice Hub');
  await page.getByRole('dialog', { name: 'Create server' }).getByRole('button', { name: 'Create server' }).click();
  await chooseServerCreate(page, 'Create category');
  await page.getByRole('dialog', { name: 'Create category' }).getByRole('textbox', { name: 'Category name' }).fill('General');
  await page.getByRole('dialog', { name: 'Create category' }).getByRole('button', { name: 'Create category' }).click();
  await chooseServerCreate(page, 'Create text channel');
  await page.getByRole('dialog', { name: 'Create text channel' }).getByRole('textbox', { name: 'Channel name' }).fill('chat');
  await page.getByRole('dialog', { name: 'Create text channel' }).getByRole('combobox', { name: 'Category' }).selectOption({ label: 'General' });
  await page.getByRole('dialog', { name: 'Create text channel' }).getByRole('button', { name: 'Create text channel' }).click();
  if (isCompactNavigation(page)) await page.getByRole('button', { name: 'Back to server' }).click();
  await chooseServerCreate(page, 'Create voice channel');
  const create = page.getByRole('dialog', { name: 'Create voice channel' });
  await create.getByRole('textbox', { name: 'Voice channel name' }).fill('Lounge');
  await create.getByRole('combobox', { name: 'Category' }).selectOption({ label: 'General' });
  await create.getByRole('button', { name: 'Create voice channel' }).click();
  const category = page.getByRole('region', { name: 'Category General' });
  await expect(category.getByRole('button', { name: 'Join voice channel Lounge' })).toBeVisible();
  await chooseChannelAction(page, 'voice', 'Lounge', 'Move Lounge up');
  await expect(category.locator('.cubic-channel-row').first()).toHaveAttribute('aria-label', 'Join voice channel Lounge');
  await chooseChannelAction(page, 'voice', 'Lounge', 'Rename voice channel Lounge');
  const rename = page.getByRole('dialog', { name: 'Rename voice channel' });
  await rename.getByRole('textbox', { name: 'Voice channel name' }).fill('Gaming');
  await rename.getByRole('button', { name: 'Save voice channel' }).click();
  await expect(category.getByRole('button', { name: 'Join voice channel Gaming' })).toBeVisible();
  await chooseChannelAction(page, 'voice', 'Gaming', 'Move Gaming to category');
  await page.getByRole('dialog', { name: 'Move channel' }).getByRole('combobox', { name: 'Move channel to' }).selectOption('');
  await page.getByRole('dialog', { name: 'Move channel' }).getByRole('button', { name: 'Move to end' }).click();
  await expect(category.getByRole('button', { name: 'Join voice channel Gaming' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Join voice channel Gaming' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not join voice channel' })).toBeVisible();
  await page.getByRole('button', { name: 'Text channel chat', exact: true }).click();
  await expect(page.locator('.chat-heading')).toContainText('chat');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('member ticket joins the selected voice room, keeps text usable, and leaves cleanly', async ({ page, request }, testInfo) => {
  await request.post('http://127.0.0.1:3198/__test/server-voice-connected');
  await page.addInitScript(() => {
    if (navigator.mediaDevices && !navigator.mediaDevices.getDisplayMedia) {
      Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async () => ({}) });
    }
    const observations = {
      connects: [] as Array<{ url: string; token: string }>, disconnects: 0,
      cameraStarts: 0, cameraStops: 0, shareStarts: 0, shareStops: 0,
      shareAudioRequested: false, provideShareAudio: false,
      stopNativeShare: () => {}, addRemoteMedia: () => {}, removeRemoteMedia: () => {}, reconnect: () => {}
    };
    const browser = window as Window & {
      __cubicVoiceTest?: typeof observations;
      __cubicServerVoiceTestRoom?: () => unknown;
    };
    browser.__cubicVoiceTest = observations;
    browser.__cubicServerVoiceTestRoom = () => {
      const listeners = new Map<string, Array<(...args: any[]) => void>>();
      const emit = (event: string, ...args: any[]) => listeners.get(event)?.forEach((listener) => listener(...args));
      const track = () => ({ attach: () => {}, detach: () => {} });
      const publications = new Map<string, { source: string; isMuted: boolean; track: ReturnType<typeof track> }>();
      const remotePublications = new Map<string, { source: string; isMuted: boolean; track: ReturnType<typeof track> }>();
      const localParticipant = {
        identity: 'fixture-local', name: 'Tester', isLocal: true, isSpeaking: false,
        isMicrophoneEnabled: false,
        getTrackPublication: (source: string) => publications.get(source),
        async setMicrophoneEnabled(enabled: boolean) { this.isMicrophoneEnabled = enabled; },
        async setCameraEnabled(enabled: boolean) {
          if (enabled) { observations.cameraStarts += 1; publications.set('camera', { source: 'camera', isMuted: false, track: track() }); emit('localTrackPublished', publications.get('camera')); }
          else { observations.cameraStops += 1; publications.delete('camera'); emit('localTrackUnpublished'); }
        },
        async setScreenShareEnabled(enabled: boolean, options?: { audio?: boolean }) {
          if (enabled) {
            observations.shareStarts += 1;
            observations.shareAudioRequested = Boolean(options?.audio);
            publications.set('screen_share', { source: 'screen_share', isMuted: false, track: track() });
            if (observations.provideShareAudio) publications.set('screen_share_audio', { source: 'screen_share_audio', isMuted: false, track: track() });
            emit('localTrackPublished', publications.get('screen_share'));
          }
          else { observations.shareStops += 1; publications.delete('screen_share'); publications.delete('screen_share_audio'); emit('localTrackUnpublished'); }
        }
      };
      const remote = {
        identity: 'fixture-remote', name: 'Remote member', isLocal: false,
        isSpeaking: false, isMicrophoneEnabled: true,
        getTrackPublication: (source: string) => remotePublications.get(source)
      };
      const remoteParticipants = new Map<string, typeof remote>();
      observations.stopNativeShare = () => {
        publications.delete('screen_share'); publications.delete('screen_share_audio'); emit('localTrackUnpublished');
      };
      observations.addRemoteMedia = () => {
        remotePublications.set('camera', { source: 'camera', isMuted: false, track: track() });
        remotePublications.set('screen_share', { source: 'screen_share', isMuted: false, track: track() });
        remoteParticipants.set(remote.identity, remote); emit('participantConnected', remote);
      };
      observations.removeRemoteMedia = () => {
        remoteParticipants.delete(remote.identity); remotePublications.clear(); emit('participantDisconnected', remote);
      };
      observations.reconnect = () => { emit('reconnecting'); emit('reconnected'); };
      return {
        localParticipant,
        remoteParticipants,
        canPlaybackAudio: true,
        on(event: string, listener: (...args: any[]) => void) { listeners.set(event, [...(listeners.get(event) ?? []), listener]); },
        async connect(url: string, token: string) { observations.connects.push({ url, token }); },
        async startAudio() {},
        async switchActiveDevice() {},
        async disconnect() { observations.disconnects += 1; }
      };
    };
  });
  await page.reload();
  await openServers(page);
  await page.getByRole('button', { name: 'Create server' }).first().click();
  await page.getByRole('dialog', { name: 'Create server' }).getByRole('textbox', { name: 'Server name' }).fill('Voice Hub');
  await page.getByRole('dialog', { name: 'Create server' }).getByRole('button', { name: 'Create server' }).click();
  await chooseServerCreate(page, 'Create text channel');
  await page.getByRole('dialog', { name: 'Create text channel' }).getByRole('textbox', { name: 'Channel name' }).fill('chat');
  await page.getByRole('dialog', { name: 'Create text channel' }).getByRole('button', { name: 'Create text channel' }).click();
  if (isCompactNavigation(page)) await page.getByRole('button', { name: 'Back to server' }).click();
  await chooseServerCreate(page, 'Create voice channel');
  await page.getByRole('dialog', { name: 'Create voice channel' }).getByRole('textbox', { name: 'Voice channel name' }).fill('Lounge');
  await page.getByRole('dialog', { name: 'Create voice channel' }).getByRole('button', { name: 'Create voice channel' }).click();
  const joinButton = page.getByRole('button', { name: 'Join voice channel Lounge' });
  const ticketResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST' && /\/api\/v1\/server-voice\/channels\/[0-9a-f-]+\/token$/.test(response.url()));
  await joinButton.click();
  const response = await ticketResponse;
  expect(response.status()).toBe(200);
  const channelId = /\/channels\/([0-9a-f-]+)\/token$/.exec(response.url())?.[1];
  expect(channelId).toBeTruthy();
  const ticket = await response.json();
  expect(ticket.token).toBe(`fixture-ticket:cubic-server-voice-${channelId}`);
  await expect.poll(() => page.evaluate(() => (window as any).__cubicVoiceTest?.connects)).toEqual([
    { url: 'wss://fixture-livekit.invalid', token: ticket.token }
  ]);
  const dock = page.getByRole('region', { name: 'Voice room' });
  await expect(dock).toContainText('1 connected');
  await expect(joinButton).toHaveAttribute('aria-current', 'true');
  await dock.getByRole('button', { name: 'Mute microphone' }).click();
  await expect(dock.getByRole('button', { name: 'Unmute microphone' })).toHaveAttribute('aria-pressed', 'true');
  await dock.getByRole('button', { name: 'Deafen audio' }).click();
  await expect(dock.getByRole('button', { name: 'Undeafen audio' })).toHaveAttribute('aria-pressed', 'true');
  await dock.getByRole('button', { name: 'Undeafen audio' }).click();
  await expect(dock.getByRole('button', { name: 'Unmute microphone' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dock).not.toContainText('The selected camera disconnected');
  await dock.getByRole('button', { name: 'Turn camera on' }).click();
  await page.getByRole('dialog', { name: 'Camera quality' }).getByRole('button', { name: 'Turn on', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__cubicVoiceTest?.cameraStarts)).toBe(1);
  const stage = page.getByRole('region', { name: 'Server voice media' });
  await expect(stage).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dock.getByRole('button', { name: 'Share screen' }).click();
  await page.getByRole('dialog', { name: 'Go Live quality' }).getByRole('button', { name: 'Go Live', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__cubicVoiceTest?.shareStarts)).toBe(1);
  expect(await page.evaluate(() => (window as any).__cubicVoiceTest.shareAudioRequested)).toBe(true);
  await expect(dock).toContainText('Screen is live without shared audio');
  await expect(stage.getByRole('button', { name: /screen share/ })).toBeVisible();
  await page.evaluate(() => (window as any).__cubicVoiceTest.addRemoteMedia());
  await expect(stage).toContainText('Remote member');
  await expect(stage.locator('video')).toHaveCount(4);
  await stage.getByRole('button', { name: 'Next screen share' }).click();
  await expect(stage).toContainText('Remote member is sharing');
  await stage.getByRole('button', { name: 'Return to grid' }).click();
  await page.evaluate(() => (window as any).__cubicVoiceTest.reconnect());
  await expect(stage.getByRole('button', { name: "Focus Remote member's screen share" })).toHaveCount(1);
  await page.evaluate(() => (window as any).__cubicVoiceTest.removeRemoteMedia());
  await expect(stage).not.toContainText('Remote member');
  await stage.getByRole('button', { name: 'Minimize media stage' }).click();
  await page.getByRole('button', { name: 'Text channel chat', exact: true }).click();
  await expect(page.locator('.chat-heading')).toContainText('chat');
  await expect(dock).toContainText('1 connected');
  await dock.getByRole('button', { name: 'Show media stage' }).click();
  await expect(stage).toBeVisible();
  await stage.getByRole('button', { name: 'Minimize media stage' }).click();
  await openMessages(page);
  await page.locator('.conversation-row').filter({ hasText: 'Fixture DM' }).click();
  await expect(dock).toContainText('1 connected');
  if (testInfo.project.name === 'desktop') await page.screenshot({ path: '/tmp/cubic-alpha11-slice1/desktop-voice-in-messages.png' });
  await dock.getByRole('button', { name: 'Show media stage' }).click();
  await expect(stage).toBeVisible();
  await openServers(page);
  await expect(dock).toContainText('1 connected');
  await dock.getByRole('button', { name: 'Stop sharing screen' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__cubicVoiceTest?.shareStops)).toBe(1);
  await dock.getByRole('button', { name: 'Share screen' }).click();
  await page.evaluate(() => { (window as any).__cubicVoiceTest.provideShareAudio = true; });
  await page.getByRole('dialog', { name: 'Go Live quality' }).getByRole('button', { name: 'Go Live', exact: true }).click();
  await expect(dock).toContainText('Shared audio is active');
  await page.evaluate(() => (window as any).__cubicVoiceTest.stopNativeShare());
  await expect(dock.getByRole('button', { name: 'Share screen' })).toBeVisible();
  await dock.getByRole('button', { name: 'Turn camera off' }).click();
  await expect(stage).toHaveCount(0);
  await dock.getByRole('button', { name: 'Turn camera on' }).click();
  await page.getByRole('dialog', { name: 'Camera quality' }).getByRole('button', { name: 'Turn on', exact: true }).click();
  await expect(stage).toBeVisible();
  await dock.getByRole('button', { name: 'Leave voice channel' }).click();
  await expect(dock).toHaveCount(0);
  await expect(stage).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__cubicVoiceTest?.disconnects)).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
