import { test, expect } from '@playwright/test';
import { chooseServerCreate, isCompactNavigation } from './navigation';

test.beforeEach(async ({ page, context, request }) => {
  await request.post('http://127.0.0.1:3198/__test/reset');
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/app');
});

test('primary rail, user bar, and contextual navigation retain existing actions', async ({ page }, testInfo) => {
  const rail = page.getByRole('navigation', { name: 'Primary navigation' });
  const messages = rail.getByRole('button', { name: 'Messages' });
  await expect(messages).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.cubic-messages-header-actions').getByRole('button')).toHaveCount(2);
  await expect(rail.getByRole('button', { name: 'Browse servers' })).toBeVisible();
  if (testInfo.project.name === 'desktop') await page.screenshot({ path: '/tmp/cubic-alpha11-slice1/desktop-messages.png' });
  if (testInfo.project.name === 'phone-portrait') await page.screenshot({ path: '/tmp/cubic-alpha11-slice1/phone-messages.png' });
  await expect(page.locator('.messenger-nav')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'People and friends' })).toBeVisible();
  await page.getByRole('button', { name: 'People and friends' }).click();
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Messages' }).click();
  await expect(page.getByRole('heading', { name: 'Conversations', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'User Settings' }).click();
  const userSettings = page.getByRole('region', { name: 'User Settings' });
  await expect(userSettings.getByRole('button', { name: 'Log out' })).toBeVisible();
  await userSettings.getByRole('navigation', { name: 'User settings sections' }).getByRole('button', { name: 'Sessions' }).click();
  await expect(userSettings.getByRole('heading', { name: 'Active sessions' })).toBeVisible();
  await userSettings.getByRole('button', { name: 'Close User Settings' }).click();

  await rail.getByRole('button', { name: 'Create server' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create server' });
  await dialog.getByRole('textbox', { name: 'Server name' }).fill('Alpha Shell');
  await dialog.getByRole('button', { name: 'Create server' }).click();
  const server = rail.getByRole('button', { name: 'Open server Alpha Shell' });
  await expect(server).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.cubic-server-sidebar-head')).toContainText('Alpha Shell');
  await expect(page.locator('.cubic-server-sidebar-head .icon-action')).toHaveCount(1);
  if (testInfo.project.name === 'desktop') await page.screenshot({ path: '/tmp/cubic-alpha11-slice1/desktop-server.png' });
  if (testInfo.project.name === 'phone-portrait') await page.screenshot({ path: '/tmp/cubic-alpha11-slice1/phone-server-navigation.png' });
  await messages.click();
  await expect(messages).toHaveAttribute('aria-current', 'page');
  await server.click();
  await expect(server).toHaveAttribute('aria-current', 'page');

  await chooseServerCreate(page, 'Create text channel');
  const channel = page.getByRole('dialog', { name: 'Create text channel' });
  await channel.getByRole('textbox', { name: 'Channel name' }).fill('general');
  await channel.getByRole('button', { name: 'Create text channel' }).click();
  await expect(page.locator('.chat-heading')).toContainText('general');
  if (isCompactNavigation(page)) {
    await expect(page.getByRole('button', { name: 'Back to server' })).toBeVisible();
  } else {
    await expect(page.getByRole('button', { name: 'Back to server' })).toBeHidden();
  }
  if (isCompactNavigation(page)) {
    await page.getByRole('button', { name: 'Back to server' }).click();
    await expect(page.locator('.cubic-server-sidebar-head')).toBeVisible();
  }
  await messages.click();
  await page.locator('.conversation-row').filter({ hasText: 'Fixture DM' }).click();
  await expect(page.locator('.chat-heading')).toContainText('Fixture DM');
  if (isCompactNavigation(page)) {
    await expect(page.getByRole('button', { name: 'Back to conversations' })).toBeVisible();
  } else {
    await expect(page.getByRole('button', { name: 'Back to conversations' })).toBeHidden();
  }
  await expect(page.getByPlaceholder('Message…')).toBeVisible();
  if (testInfo.project.name === 'phone-portrait') await page.screenshot({ path: '/tmp/cubic-alpha11-slice1/phone-conversation.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
