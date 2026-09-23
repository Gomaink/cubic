import { test, expect } from '@playwright/test';

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
  await page.getByRole('textbox', { name: 'Server name' }).fill('Aurora');
  await page.getByRole('button', { name: 'Create server' }).click();
  await expect(page.getByRole('region', { name: 'Server: Aurora' })).toBeVisible();
  await expect(page.getByText('This server does not have channels yet.')).toBeVisible();
  await expect(page.locator('.cubic-server-row')).toHaveCount(1);
  await expect(page.locator('.cubic-server-row')).toHaveAttribute('aria-current', 'page');

  await page.getByRole('button', { name: 'Back to chats' }).click();
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
  await page.getByRole('textbox', { name: 'Server name' }).fill('Mobile server');
  await page.getByRole('button', { name: 'Create server' }).click();
  await expect(page.getByRole('region', { name: 'Server: Mobile server' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to servers' }).click();
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
  await page.getByRole('textbox', { name: 'Server name' }).fill('Workshop');
  await page.getByRole('button', { name: 'Create server' }).click();
  await expect(page.getByText('This server does not have channels yet.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Channel name' }).fill('general');
  await page.getByRole('button', { name: 'Create text channel' }).click();
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
  if ((page.viewportSize()?.width ?? 1000) <= 680) {
    await page.getByRole('button', { name: 'Open text channel general' }).click();
  } else {
    await page.getByRole('button', { name: 'Text channel general' }).click();
  }
  await expect(page.getByText('Channel hello')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
