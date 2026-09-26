import { expect, test } from '@playwright/test';
import { chooseServerCreate, hasCoarsePointer, isCompactNavigation, openServers } from './navigation';

test.beforeEach(async ({ page, context, request }) => {
  await request.post('http://127.0.0.1:3198/__test/reset');
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/app');
});

test('server navigation keeps mixed channels clean and contextual actions reachable', async ({ page }, testInfo) => {
  await openServers(page);
  await page.getByRole('button', { name: 'Create server' }).first().click();
  const createServer = page.getByRole('dialog', { name: 'Create server' });
  await createServer.getByRole('textbox', { name: 'Server name' }).fill('Navigation Lab');
  await createServer.getByRole('button', { name: 'Create server' }).click();
  const rail = page.getByRole('navigation', { name: 'Primary navigation' });
  const serverEntry = rail.getByRole('button', { name: 'Open server Navigation Lab' });
  await expect(serverEntry).toHaveAttribute('aria-current', 'page');
  await serverEntry.click();
  await expect(page.locator('.cubic-server-sidebar-head')).toContainText('Navigation Lab');
  await expect(page.locator('.cubic-channel-list')).toContainText('No channels yet. Add a text or voice channel to get started.');

  await chooseServerCreate(page, 'Create category');
  const categoryDialog = page.getByRole('dialog', { name: 'Create category' });
  await categoryDialog.getByRole('textbox', { name: 'Category name' }).fill('General');
  await categoryDialog.getByRole('button', { name: 'Create category' }).click();
  await chooseServerCreate(page, 'Create text channel');
  const textDialog = page.getByRole('dialog', { name: 'Create text channel' });
  await textDialog.getByRole('textbox', { name: 'Channel name' }).fill('chat');
  await textDialog.getByRole('combobox', { name: 'Category' }).selectOption({ label: 'General' });
  await textDialog.getByRole('button', { name: 'Create text channel' }).click();
  await expect(page.locator('.chat-heading')).toContainText('chat');
  await chooseServerCreate(page, 'Create voice channel');
  const voiceDialog = page.getByRole('dialog', { name: 'Create voice channel' });
  await voiceDialog.getByRole('textbox', { name: 'Voice channel name' }).fill('Lounge');
  await voiceDialog.getByRole('combobox', { name: 'Category' }).selectOption({ label: 'General' });
  await voiceDialog.getByRole('button', { name: 'Create voice channel' }).click();

  const category = page.getByRole('region', { name: 'Category General' });
  await expect(category.getByRole('button', { name: 'Text channel chat', exact: true })).toBeVisible();
  await expect(category.getByRole('button', { name: 'Join voice channel Lounge', exact: true })).toBeVisible();
  await expect(category.getByRole('button', { name: 'Move Lounge up' })).toHaveCount(0);
  await expect(category.getByRole('button', { name: 'Actions for voice channel Lounge' })).toBeVisible();
  await category.getByRole('button', { name: 'Text channel chat', exact: true }).click();
  await expect(category.getByRole('button', { name: 'Text channel chat', exact: true })).toHaveAttribute('aria-current', 'page');
  if (isCompactNavigation(page)) {
    await expect(page.getByRole('button', { name: 'Back to server', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back to server', exact: true }).click();
  } else {
    await expect(page.getByRole('button', { name: 'Back to server', exact: true })).toBeHidden();
  }

  const voice = category.getByRole('button', { name: 'Join voice channel Lounge', exact: true });
  if (await hasCoarsePointer(page)) {
    await voice.dispatchEvent('touchstart');
    await page.waitForTimeout(600);
    await voice.dispatchEvent('touchend');
  } else {
    await voice.click({ button: 'right' });
  }
  await expect(category.getByRole('button', { name: 'Channel settings for Lounge' })).toBeVisible();
  await expect(category.getByRole('button', { name: 'Rename voice channel Lounge' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Leave voice' })).toHaveCount(0);
  await category.getByRole('button', { name: 'Actions for voice channel Lounge' }).click();
  await expect(category.getByRole('button', { name: 'Channel settings for Lounge' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  if (testInfo.project.name === 'desktop') await page.screenshot({ path: '/tmp/cubic-alpha11-slice2/desktop-server-navigation.png' });
  if (testInfo.project.name === 'phone-portrait') await page.screenshot({ path: '/tmp/cubic-alpha11-slice2/phone-server-navigation.png' });
});
