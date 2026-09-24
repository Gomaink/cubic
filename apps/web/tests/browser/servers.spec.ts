import { test, expect } from '@playwright/test';

async function createServer(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name: 'Create server' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Create server' });
  await dialog.getByRole('textbox', { name: 'Server name' }).fill(name);
  await dialog.getByRole('button', { name: 'Create server' }).click();
  await expect(dialog).toHaveCount(0);
}

async function createChannel(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name: 'Create text channel' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create text channel' });
  await dialog.getByRole('textbox', { name: 'Channel name' }).fill(name);
  await dialog.getByRole('button', { name: 'Create text channel' }).click();
  await expect(dialog).toHaveCount(0);
}

test.beforeEach(async ({ page, context, request }) => {
  await request.post('http://127.0.0.1:3198/__test/reset');
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/app');
});

test('creates and selects an empty server while existing DM and group chats remain usable', async ({ page }) => {
  await expect(page.locator('.conversation-row').filter({ hasText: 'Fixture DM' })).toBeVisible();
  await expect(page.locator('.conversation-row').filter({ hasText: 'Fixture group' })).toBeVisible();

  await page.getByRole('button', { name: 'Servers', exact: true }).click();
  await expect(page.getByText('No servers yet. Create one to get started.')).toBeVisible();
  await createServer(page, 'Aurora');
  await expect(page.locator('.cubic-server-sidebar-head')).toContainText('Aurora');
  await expect(page.locator('.cubic-channel-list')).toContainText('This server does not have channels yet.');
  if ((page.viewportSize()?.width ?? 1000) > 680) await expect(page.getByRole('button', { name: 'Open server Aurora' })).toHaveAttribute('aria-current', 'page');

  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  await page.locator('.conversation-row').filter({ hasText: 'Fixture group' }).click();
  await expect(page.locator('.chat-heading')).toContainText('Fixture group');
  if ((page.viewportSize()?.width ?? 1000) <= 680) {
    await page.getByRole('button', { name: 'Back to conversations' }).click();
  }
  await page.locator('.conversation-row').filter({ hasText: 'Fixture DM' }).click();
  await expect(page.locator('.chat-heading')).toContainText('Fixture DM');
  await expect(page.getByText('History message 79')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('server selection and return controls remain reachable on narrow viewports', async ({ page }, testInfo) => {
  test.skip(!['phone-portrait', 'phone-landscape', 'small-phone'].includes(testInfo.project.name), 'Mobile navigation coverage.');
  await page.getByRole('button', { name: 'Servers', exact: true }).click();
  await createServer(page, 'Mobile server');
  await expect(page.locator('.cubic-server-sidebar-head')).toContainText('Mobile server');
  await page.getByRole('button', { name: 'Servers', exact: true }).click();
  await expect(page.locator('.cubic-server-row')).toBeVisible();
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  await expect(page.locator('.conversation-row').filter({ hasText: 'Fixture DM' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('.messenger-nav').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test('owner creates a text channel, messages with an attachment, and returns to legacy chats', async ({ page }, testInfo) => {
  await expect(page.locator('.conversation-row').filter({ hasText: 'Fixture DM' })).toBeVisible();
  await expect(page.locator('.conversation-row').filter({ hasText: 'Fixture group' })).toBeVisible();
  await page.getByRole('button', { name: 'Servers', exact: true }).click();
  await createServer(page, 'Workshop');
  await expect(page.locator('.cubic-channel-list')).toContainText('This server does not have channels yet.');
  await createChannel(page, 'general');
  await expect(page.locator('.cubic-channel-row')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.chat-heading')).toContainText('general');
  await expect(page.getByRole('button', { name: 'Start voice call' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Join group voice' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Group settings' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Members', exact: true })).toHaveCount(0);

  await page.getByPlaceholder('Message…').fill('Channel hello');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Channel hello')).toBeVisible();
  await page.locator('.cubic-attachment-input').setInputFiles({ name: 'channel.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') });
  await expect(page.getByText('channel.png')).toBeVisible();
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.cubic-message-attachments img[alt="channel.png"]')).toBeVisible();

  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  await page.locator('.conversation-row').filter({ hasText: 'Fixture DM' }).click();
  await expect(page.locator('.chat-heading')).toContainText('Fixture DM');
  if (['phone-portrait', 'phone-landscape', 'small-phone'].includes(testInfo.project.name)) {
    await page.getByRole('button', { name: 'Back to conversations' }).click();
  }
  await page.locator('.conversation-row').filter({ hasText: 'Fixture group' }).click();
  await expect(page.locator('.chat-heading')).toContainText('Fixture group');
  await page.getByRole('button', { name: 'Servers', exact: true }).click();
  await page.locator('.cubic-server-row').filter({ hasText: 'Workshop' }).click();
  await page.getByRole('button', { name: 'Text channel general' }).click();
  await expect(page.getByText('Channel hello')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('targeted friend joins existing text channel, sends a message, then leaves without affecting owner', async ({ page, browser, request }) => {
  await request.post('http://127.0.0.1:3198/__test/server-friends');
  await page.reload();
  await page.getByRole('button', { name: 'Servers', exact: true }).click();
  await createServer(page, 'Shared space');
  await page.getByRole('button', { name: 'Create category' }).click();
  const categoryDialog = page.getByRole('dialog', { name: 'Create category' });
  await categoryDialog.getByRole('textbox', { name: 'Category name' }).fill('Projects');
  await categoryDialog.getByRole('button', { name: 'Create category' }).click();
  await page.getByRole('button', { name: 'Create text channel' }).click();
  const channelDialog = page.getByRole('dialog', { name: 'Create text channel' });
  await channelDialog.getByRole('textbox', { name: 'Channel name' }).fill('general');
  await channelDialog.getByRole('combobox', { name: 'Category' }).selectOption({ label: 'Projects' });
  await channelDialog.getByRole('button', { name: 'Create text channel' }).click();
  await page.getByRole('button', { name: 'Back to server' }).click();
  await page.getByRole('button', { name: 'Options for Shared space' }).click();
  await expect(page.getByRole('button', { name: 'Leave server' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Invite people' }).click();
  const inviteDialog = page.getByRole('dialog', { name: 'Invite people' });
  await inviteDialog.getByRole('combobox', { name: 'Invite a friend' }).selectOption('fixture-peer');
  await inviteDialog.getByRole('button', { name: 'Invite friend' }).click();
  await expect(inviteDialog).toContainText('Fixture DM · Pending');
  await inviteDialog.getByRole('button', { name: 'Close server dialog' }).click();
  const serverId = (await page.evaluate(async () => (await (await fetch('/api/v1/servers')).json()).servers[0].id)) as string;
  const conversationId = (await page.evaluate(async (id) => (await (await fetch(`/api/v1/servers/${id}/channels`)).json()).channels[0].conversationId, serverId)) as string;

  const friendContext = await browser.newContext();
  try {
    await friendContext.addCookies([{ name: 'cubic_session', value: 'browser-peer', domain: '127.0.0.1', path: '/' }]);
    const friendPage = await friendContext.newPage();
    await friendPage.goto('/app');
    await friendPage.getByRole('button', { name: 'People', exact: false }).click();
    await expect(friendPage.getByText('Pending invitation from @tester')).toBeVisible();
    await friendPage.getByRole('button', { name: 'Accept invitation to Shared space' }).click();
    await expect(friendPage.locator('.cubic-server-sidebar-head')).toContainText('Shared space');
    await expect(friendPage.getByRole('region', { name: 'Category Projects' })).toContainText('general');
    await expect(friendPage.getByRole('button', { name: 'Create category' })).toHaveCount(0);
    await friendPage.getByRole('button', { name: 'Members · 2' }).click();
    await expect(friendPage.getByRole('complementary', { name: 'Members of Shared space' })).toContainText('Tester');
    await friendPage.getByRole('button', { name: 'Close server members' }).click();
    await friendPage.getByRole('button', { name: 'Text channel general' }).click();
    await expect(friendPage.getByRole('button', { name: 'Start voice call' })).toHaveCount(0);
    await expect(friendPage.getByRole('button', { name: 'Join group voice' })).toHaveCount(0);
    await friendPage.getByPlaceholder('Message…').fill('Hello from friend');
    await friendPage.getByRole('button', { name: 'Send message' }).click();
    await expect(friendPage.getByText('Hello from friend')).toBeVisible();
    await page.getByRole('button', { name: 'Members · 1' }).click();
    await page.getByRole('button', { name: 'Refresh members' }).click();
    await expect(page.getByRole('complementary', { name: 'Members of Shared space' })).toContainText('Fixture DM');
    await page.getByRole('button', { name: 'Close server members' }).click();
    await friendPage.getByRole('button', { name: 'Back to server' }).click();
    await expect(friendPage.getByRole('button', { name: 'Create text channel' })).toHaveCount(0);
    await friendPage.getByRole('button', { name: 'Options for Shared space' }).click();
    await friendPage.getByRole('button', { name: 'Leave server' }).click();
    await expect(friendPage.locator('.cubic-server-row')).toHaveCount(0);
    expect(await friendPage.evaluate(async (id) => (await fetch(`/api/v1/conversations/${id}/messages`)).status, conversationId)).toBe(404);
    await expect(friendPage.locator('.conversation-row').filter({ hasText: 'Tester' })).toBeVisible();
    expect(await friendPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Servers', exact: true }).click();
    await expect(page.locator('.cubic-server-row').filter({ hasText: 'Shared space' })).toBeVisible();
    await page.locator('.cubic-server-row').filter({ hasText: 'Shared space' }).click();
    await page.getByRole('button', { name: 'Text channel general' }).click();
    await expect(page.getByText('Hello from friend')).toBeVisible();
  } finally {
    await friendContext.close().catch(() => {});
  }
});

test('owner confirms ordinary member removal without changing chats or server content', async ({ page, browser, request }) => {
  await request.post('http://127.0.0.1:3198/__test/server-friends');
  await page.reload();
  await page.getByRole('button', { name: 'Servers', exact: true }).click();
  await createServer(page, 'Removal space');
  await createChannel(page, 'general');
  const serverId = await page.evaluate(async () => (await (await fetch('/api/v1/servers')).json()).servers[0].id as string);
  const conversationId = await page.evaluate(async (id) => (await (await fetch(`/api/v1/servers/${id}/channels`)).json()).channels[0].conversationId as string, serverId);
  await page.getByRole('button', { name: 'Back to server' }).click();
  await page.getByRole('button', { name: 'Options for Removal space' }).click();
  await page.getByRole('button', { name: 'Invite people' }).click();
  const inviteDialog = page.getByRole('dialog', { name: 'Invite people' });
  await inviteDialog.getByRole('combobox', { name: 'Invite a friend' }).selectOption('fixture-peer');
  await inviteDialog.getByRole('button', { name: 'Invite friend' }).click();
  await inviteDialog.getByRole('button', { name: 'Close server dialog' }).click();

  const friendContext = await browser.newContext();
  try {
    await friendContext.addCookies([{ name: 'cubic_session', value: 'browser-peer', domain: '127.0.0.1', path: '/' }]);
    const friendPage = await friendContext.newPage();
    await friendPage.goto('/app');
    await friendPage.getByRole('button', { name: 'People', exact: false }).click();
    await friendPage.getByRole('button', { name: 'Accept invitation to Removal space' }).click();
    await friendPage.getByRole('button', { name: 'Members · 2' }).click();
    await expect(friendPage.getByRole('button', { name: /Remove .* from server/ })).toHaveCount(0);
    const directRemovalStatus = await friendPage.evaluate(async (id) => (await fetch(`/api/v1/servers/${id}/members/fixture-user`, { method: 'DELETE' })).status, serverId);
    expect(directRemovalStatus).toBe(403);
    await friendPage.getByRole('button', { name: 'Close server members' }).click();
    await friendPage.getByRole('button', { name: 'Text channel general' }).click();

    await page.getByRole('button', { name: 'Text channel general' }).click();
    await page.getByRole('button', { name: 'Server members' }).click();
    await page.getByRole('button', { name: 'Refresh members' }).click();
    const pane = page.getByRole('complementary', { name: 'Members of Removal space' });
    await expect(pane.getByRole('heading', { name: 'Members · 2' })).toBeVisible();
    await expect(pane.getByRole('button', { name: 'Remove Tester from server' })).toHaveCount(0);
    await pane.getByRole('button', { name: 'Remove Fixture DM from server' }).click();
    const confirmation = page.getByRole('dialog', { name: 'Remove server member' });
    await expect(confirmation).toContainText('Remove Fixture DM from Removal space?');
    await expect(confirmation).toContainText('Their previous messages will remain.');
    await confirmation.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(pane.getByRole('button', { name: 'Remove Fixture DM from server' })).toBeFocused();
    await pane.getByRole('button', { name: 'Remove Fixture DM from server' }).click();
    await confirmation.getByRole('button', { name: 'Remove from server' }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(pane.getByRole('heading', { name: 'Members · 1' })).toBeVisible();
    await expect(pane.getByRole('button', { name: 'Remove Fixture DM from server' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await expect(friendPage.locator('.cubic-server-sidebar-head')).toHaveCount(0);
    await expect(friendPage.locator('.cubic-server-row')).toHaveCount(0);
    await friendPage.reload();
    await friendPage.getByRole('button', { name: 'Servers', exact: true }).click();
    await expect(friendPage.locator('.cubic-server-row')).toHaveCount(0);
    const denied = await friendPage.evaluate(async ({ serverId, conversationId }) => ({
      server: (await fetch(`/api/v1/servers/${serverId}`)).status,
      messages: (await fetch(`/api/v1/conversations/${conversationId}/messages`)).status
    }), { serverId, conversationId });
    expect(denied).toEqual({ server: 404, messages: 404 });
    await friendPage.getByRole('button', { name: 'Chats', exact: true }).click();
    await expect(friendPage.locator('.conversation-row').filter({ hasText: 'Fixture group' })).toBeVisible();
    await expect(friendPage.locator('.conversation-row').filter({ hasText: 'Tester' })).toBeVisible();

    await page.getByRole('button', { name: 'Close server members' }).click();
    await page.getByPlaceholder('Message…').fill('Content remains usable');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText('Content remains usable')).toBeVisible();
  } finally {
    await friendContext.close().catch(() => {});
  }
});

test('server shell keeps channel, member and DM/group contexts separate', async ({ page }) => {
  await page.locator('.conversation-row').filter({ hasText: 'Fixture DM' }).click();
  await expect(page.locator('.chat-heading')).toContainText('Fixture DM');
  await expect(page.getByRole('button', { name: 'Start voice call' })).toBeVisible();
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  if ((page.viewportSize()?.width ?? 1000) <= 680) await page.getByRole('button', { name: 'Back to conversations' }).click();
  await page.locator('.conversation-row').filter({ hasText: 'Fixture group' }).click();
  await expect(page.getByRole('button', { name: 'Join group voice' })).toBeVisible();
  await page.getByRole('button', { name: 'Servers', exact: true }).click();
  await createServer(page, 'First place');
  await page.getByRole('button', { name: 'Create text channel' }).click();
  await expect(page.getByRole('dialog', { name: 'Create text channel' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Create text channel' })).toHaveCount(0);
  await createChannel(page, 'alpha');
  await page.getByPlaceholder('Message…').fill('First channel message');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('First channel message')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start voice call' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Join group voice' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Server members' }).click();
  await expect(page.getByRole('complementary', { name: 'Members of First place' })).toContainText('Owner');
  await page.getByRole('button', { name: 'Close server members' }).click();
  await expect(page.getByRole('complementary', { name: 'Members of First place' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to server' }).click();
  await createChannel(page, 'beta');
  await expect(page.locator('.chat-heading')).toContainText('beta');
  await expect(page.getByText('First channel message')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to server' }).click();
  await page.getByRole('button', { name: 'Text channel alpha' }).click();
  await expect(page.getByText('First channel message')).toBeVisible();
  await page.getByRole('button', { name: 'Servers', exact: true }).click();
  await createServer(page, 'Second place');
  await createChannel(page, 'other');
  await expect(page.getByText('First channel message')).toHaveCount(0);
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  await page.locator('.conversation-row').filter({ hasText: 'Fixture DM' }).click();
  await expect(page.locator('.chat-heading')).toContainText('Fixture DM');
  await expect(page.locator('.cubic-server-sidebar-head')).toHaveCount(0);
  await page.getByRole('button', { name: 'Servers', exact: true }).click();
  await page.locator('.cubic-server-row').filter({ hasText: 'First place' }).click();
  await page.getByRole('button', { name: 'Text channel alpha' }).click();
  await expect(page.getByText('First channel message')).toBeVisible();
  await expect(page.locator('.chat-heading')).toContainText('alpha');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByPlaceholder('Message…')).toBeVisible();
});

test('a late channel-list response cannot replace a newer server selection', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One deterministic request-order regression is sufficient.');
  await page.getByRole('button', { name: 'Servers', exact: true }).click();
  await createServer(page, 'Older server');
  await createChannel(page, 'old-channel');
  await page.getByRole('button', { name: 'Servers', exact: true }).click();
  await createServer(page, 'Newer server');
  const oldId = await page.evaluate(async () => (await (await fetch('/api/v1/servers')).json()).servers.find((server: { name: string }) => server.name === 'Older server').id as string);
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const intercepted = new Promise<void>((resolve) => { entered = resolve; });
  await page.route(`**/api/v1/servers/${oldId}/channels`, async (route) => {
    entered();
    await held;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Open server Older server' }).click();
  await intercepted;
  await page.getByRole('button', { name: 'Open server Newer server' }).click();
  const response = page.waitForResponse((item) => item.url().endsWith(`/api/v1/servers/${oldId}/channels`));
  release();
  await response;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.locator('.cubic-server-sidebar-head')).toContainText('Newer server');
  await expect(page.locator('.cubic-channel-list')).not.toContainText('old-channel');
});

test('owner organizes channels into categories without losing messages or legacy chats', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: 'Servers', exact: true }).click();
  await createServer(page, 'Organized');
  await page.getByRole('button', { name: 'Create category' }).click();
  let dialog = page.getByRole('dialog', { name: 'Create category' });
  await dialog.getByRole('textbox', { name: 'Category name' }).fill('Projects');
  await dialog.getByRole('button', { name: 'Create category' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Create category' }).click();
  dialog = page.getByRole('dialog', { name: 'Create category' });
  await dialog.getByRole('textbox', { name: 'Category name' }).fill('Archive');
  await dialog.getByRole('button', { name: 'Create category' }).click();
  await expect(page.getByRole('region', { name: 'Category Projects' })).toBeVisible();
  await page.getByRole('button', { name: 'Create text channel' }).click();
  dialog = page.getByRole('dialog', { name: 'Create text channel' });
  await dialog.getByRole('textbox', { name: 'Channel name' }).fill('build');
  await dialog.getByRole('combobox', { name: 'Category' }).selectOption({ label: 'Projects' });
  await dialog.getByRole('button', { name: 'Create text channel' }).click();
  await expect(page.locator('.chat-heading')).toContainText('build');
  await page.getByPlaceholder('Message…').fill('Category message survives');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Category message survives')).toBeVisible();
  if (['phone-portrait', 'phone-landscape', 'small-phone'].includes(testInfo.project.name)) await page.getByRole('button', { name: 'Back to server' }).click();
  await page.getByRole('button', { name: 'Create text channel' }).click();
  dialog = page.getByRole('dialog', { name: 'Create text channel' });
  await dialog.getByRole('textbox', { name: 'Channel name' }).fill('notes');
  await dialog.getByRole('combobox', { name: 'Category' }).selectOption({ label: 'Projects' });
  await dialog.getByRole('button', { name: 'Create text channel' }).click();
  if (['phone-portrait', 'phone-landscape', 'small-phone'].includes(testInfo.project.name)) await page.getByRole('button', { name: 'Back to server' }).click();
  await page.getByRole('button', { name: 'Move notes up' }).click();
  await expect(page.getByRole('region', { name: 'Category Projects' }).getByRole('button', { name: /^Text channel/ }).first()).toHaveAccessibleName('Text channel notes');
  await page.getByRole('button', { name: 'Rename category Projects' }).click();
  dialog = page.getByRole('dialog', { name: 'Rename category' });
  await dialog.getByRole('textbox', { name: 'Category name' }).fill('Current');
  await dialog.getByRole('button', { name: 'Save category' }).click();
  await expect(page.getByRole('region', { name: 'Category Current' })).toContainText('build');
  await page.getByRole('button', { name: 'Move category Archive up' }).click();
  await page.getByRole('button', { name: 'Move build to category' }).click();
  dialog = page.getByRole('dialog', { name: 'Move channel' });
  await dialog.getByRole('combobox', { name: 'Move channel to' }).selectOption({ label: 'Archive' });
  await dialog.getByRole('button', { name: 'Move to end' }).click();
  await expect(page.getByRole('region', { name: 'Category Archive' })).toContainText('build');
  await page.getByRole('button', { name: 'Move build to category' }).click();
  dialog = page.getByRole('dialog', { name: 'Move channel' });
  await dialog.getByRole('combobox', { name: 'Move channel to' }).selectOption({ label: 'Uncategorized' });
  await dialog.getByRole('button', { name: 'Move to end' }).click();
  await expect(page.getByRole('region', { name: 'Category Archive' })).not.toContainText('build');
  await page.getByRole('button', { name: 'Move build to category' }).click();
  dialog = page.getByRole('dialog', { name: 'Move channel' });
  await dialog.getByRole('combobox', { name: 'Move channel to' }).selectOption({ label: 'Archive' });
  await dialog.getByRole('button', { name: 'Move to end' }).click();
  page.once('dialog', (confirmation) => confirmation.accept());
  await page.getByRole('button', { name: 'Delete category Archive' }).click();
  await expect(page.getByRole('region', { name: 'Category Archive' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Text channel build' }).click();
  await expect(page.getByText('Category message survives')).toBeVisible();
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  await page.locator('.conversation-row').filter({ hasText: 'Fixture DM' }).click();
  await expect(page.locator('.chat-heading')).toContainText('Fixture DM');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
