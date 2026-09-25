import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page, context, request }) => {
  await request.post('http://127.0.0.1:3198/__test/reset');
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/app');
});

test('owner manages voice channels in mixed text/voice order and media outage preserves navigation', async ({ page }) => {
  await page.getByRole('button', { name: 'Servers', exact: true }).click();
  await page.getByRole('button', { name: 'Create server' }).first().click();
  await page.getByRole('dialog', { name: 'Create server' }).getByRole('textbox', { name: 'Server name' }).fill('Voice Hub');
  await page.getByRole('dialog', { name: 'Create server' }).getByRole('button', { name: 'Create server' }).click();
  await page.getByRole('button', { name: 'Create category' }).click();
  await page.getByRole('dialog', { name: 'Create category' }).getByRole('textbox', { name: 'Category name' }).fill('General');
  await page.getByRole('dialog', { name: 'Create category' }).getByRole('button', { name: 'Create category' }).click();
  await page.getByRole('button', { name: 'Create text channel' }).click();
  await page.getByRole('dialog', { name: 'Create text channel' }).getByRole('textbox', { name: 'Channel name' }).fill('chat');
  await page.getByRole('dialog', { name: 'Create text channel' }).getByRole('combobox', { name: 'Category' }).selectOption({ label: 'General' });
  await page.getByRole('dialog', { name: 'Create text channel' }).getByRole('button', { name: 'Create text channel' }).click();
  await page.getByRole('button', { name: 'Back to server' }).click();
  await page.getByRole('button', { name: 'Create voice channel' }).click();
  const create = page.getByRole('dialog', { name: 'Create voice channel' });
  await create.getByRole('textbox', { name: 'Voice channel name' }).fill('Lounge');
  await create.getByRole('combobox', { name: 'Category' }).selectOption({ label: 'General' });
  await create.getByRole('button', { name: 'Create voice channel' }).click();
  const category = page.getByRole('region', { name: 'Category General' });
  await expect(category.getByRole('button', { name: 'Join voice channel Lounge' })).toBeVisible();
  await category.getByRole('button', { name: 'Move Lounge up' }).click();
  await expect(category.locator('.cubic-channel-row').first()).toHaveAttribute('aria-label', 'Join voice channel Lounge');
  await category.getByRole('button', { name: 'Rename voice channel Lounge' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename voice channel' });
  await rename.getByRole('textbox', { name: 'Voice channel name' }).fill('Gaming');
  await rename.getByRole('button', { name: 'Save voice channel' }).click();
  await expect(category.getByRole('button', { name: 'Join voice channel Gaming' })).toBeVisible();
  await category.getByRole('button', { name: 'Move Gaming to category' }).click();
  await page.getByRole('dialog', { name: 'Move channel' }).getByRole('combobox', { name: 'Move channel to' }).selectOption('');
  await page.getByRole('dialog', { name: 'Move channel' }).getByRole('button', { name: 'Move to end' }).click();
  await expect(category.getByRole('button', { name: 'Join voice channel Gaming' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Join voice channel Gaming' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not join voice channel' })).toBeVisible();
  await page.getByRole('button', { name: 'Text channel chat' }).click();
  await expect(page.locator('.chat-heading')).toContainText('chat');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('member ticket joins the selected voice room, keeps text usable, and leaves cleanly', async ({ page, request }) => {
  await request.post('http://127.0.0.1:3198/__test/server-voice-connected');
  await page.addInitScript(() => {
    const observations = { connects: [] as Array<{ url: string; token: string }>, disconnects: 0 };
    const browser = window as Window & {
      __cubicVoiceTest?: typeof observations;
      __cubicServerVoiceTestRoom?: () => unknown;
    };
    browser.__cubicVoiceTest = observations;
    browser.__cubicServerVoiceTestRoom = () => {
      const localParticipant = {
        identity: 'fixture-local', name: 'Tester', isLocal: true, isSpeaking: false,
        isMicrophoneEnabled: false,
        getTrackPublication: () => undefined,
        async setMicrophoneEnabled(enabled: boolean) { this.isMicrophoneEnabled = enabled; }
      };
      return {
        localParticipant,
        remoteParticipants: new Map(),
        canPlaybackAudio: true,
        on: () => {},
        async connect(url: string, token: string) { observations.connects.push({ url, token }); },
        async startAudio() {},
        async switchActiveDevice() {},
        async disconnect() { observations.disconnects += 1; }
      };
    };
  });
  await page.reload();
  await page.getByRole('button', { name: 'Servers', exact: true }).click();
  await page.getByRole('button', { name: 'Create server' }).first().click();
  await page.getByRole('dialog', { name: 'Create server' }).getByRole('textbox', { name: 'Server name' }).fill('Voice Hub');
  await page.getByRole('dialog', { name: 'Create server' }).getByRole('button', { name: 'Create server' }).click();
  await page.getByRole('button', { name: 'Create text channel' }).click();
  await page.getByRole('dialog', { name: 'Create text channel' }).getByRole('textbox', { name: 'Channel name' }).fill('chat');
  await page.getByRole('dialog', { name: 'Create text channel' }).getByRole('button', { name: 'Create text channel' }).click();
  await page.getByRole('button', { name: 'Back to server' }).click();
  await page.getByRole('button', { name: 'Create voice channel' }).click();
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
  await expect(dock.getByRole('button', { name: 'Turn camera on' })).toHaveCount(0);
  await expect(dock.getByRole('button', { name: 'Share screen' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Text channel chat' }).click();
  await expect(page.locator('.chat-heading')).toContainText('chat');
  await expect(dock).toContainText('1 connected');
  await dock.getByRole('button', { name: 'Leave voice channel' }).click();
  await expect(dock).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__cubicVoiceTest?.disconnects)).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
