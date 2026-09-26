import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { isCompactNavigation, openServers, openUserSettings } from './navigation';

const fixture = 'http://127.0.0.1:3198';
const artifacts = '/tmp/cubic-alpha11-slice4';

test.beforeEach(async ({ page, context, request }) => {
  await request.post(`${fixture}/__test/reset`);
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/app');
});

test('User Settings preserves conversation and server navigation across responsive layouts', async ({ page }, testInfo) => {
  await mkdir(artifacts, { recursive: true });
  await page.locator('.conversation-row').filter({ hasText: 'Fixture DM' }).click();
  await expect(page.locator('.chat-heading')).toContainText('Fixture DM');
  await openUserSettings(page);
  const settings = page.getByRole('region', { name: 'User Settings' });
  const nav = settings.getByRole('navigation', { name: 'User settings sections' });
  await expect(nav.getByRole('button', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
  await expect(settings.getByText('Username changes are not supported yet.')).toBeVisible();
  await expect(settings.getByRole('textbox', { name: /email|password|username/i })).toHaveCount(0);
  const screenshotPrefix: Record<string, string> = {
    desktop: 'desktop', 'phone-portrait': 'phone-portrait',
    'phone-landscape': 'phone-landscape', 'small-phone': 'small-phone'
  };
  const prefix = screenshotPrefix[testInfo.project.name];
  if (prefix) await page.screenshot({ path: `${artifacts}/${prefix}-profile-settings.png` });

  await nav.getByRole('button', { name: 'Sessions' }).click();
  await expect(settings.getByRole('heading', { name: 'Active sessions' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Sessions' })).toHaveAttribute('aria-current', 'page');
  if (prefix === 'desktop' || prefix === 'phone-portrait') {
    await page.screenshot({ path: `${artifacts}/${prefix}-sessions-settings.png` });
  }
  await nav.getByRole('button', { name: 'Profile' }).click();
  await settings.getByRole('button', { name: 'Close User Settings' }).click();
  await expect(page.locator('.chat-heading')).toContainText('Fixture DM');

  await openServers(page);
  await page.getByRole('button', { name: 'Create server' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Create server' });
  await dialog.getByRole('textbox', { name: 'Server name' }).fill('Settings Return');
  await dialog.getByRole('button', { name: 'Create server' }).click();
  if (isCompactNavigation(page)) {
    const back = page.getByRole('button', { name: 'Back to server', exact: true });
    if (await back.isVisible()) await back.click();
  }
  await openUserSettings(page);
  await settings.getByRole('button', { name: 'Close User Settings' }).click();
  await expect(page.locator('.cubic-server-sidebar-head')).toContainText('Settings Return');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
