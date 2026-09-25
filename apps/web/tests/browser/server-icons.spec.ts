import { test, expect } from '@playwright/test';
import { openMessages, openServers } from './navigation';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

test.beforeEach(async ({ page, context, request }) => {
  await request.post('http://127.0.0.1:3198/__test/reset');
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/app');
});

test('owner uploads, replaces and removes an immutable server icon with initials fallback', async ({ page }) => {
  await openServers(page);
  await page.getByRole('button', { name: 'Create server' }).first().click();
  const create = page.getByRole('dialog', { name: 'Create server' });
  await create.getByRole('textbox', { name: 'Server name' }).fill('Icons');
  await create.getByRole('button', { name: 'Create server' }).click();
  await expect(page.locator('.cubic-server-sidebar-head .cubic-server-icon-shell img')).toHaveCount(0);

  await page.getByRole('button', { name: 'Options for Icons' }).click();
  await page.getByRole('button', { name: 'Server icon', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Server icon' });
  await expect(dialog.getByText('Using fallback initials')).toBeVisible();
  await dialog.locator('input[type=file]').setInputFiles({ name: 'icon.png', mimeType: 'image/png', buffer: png });
  await dialog.getByRole('button', { name: 'Upload icon' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.cubic-server-sidebar-head .cubic-server-icon-shell img')).toBeVisible();
  const firstUrl = await page.locator('.cubic-server-sidebar-head .cubic-server-icon-shell img').getAttribute('src');

  await openMessages(page);
  await openServers(page);
  await page.locator('.cubic-server-row').filter({ hasText: 'Icons' }).click();
  await expect(page.locator('.cubic-server-sidebar-head .cubic-server-icon-shell img')).toBeVisible();
  await page.getByRole('button', { name: 'Options for Icons' }).click();
  await page.getByRole('button', { name: 'Server icon', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Server icon' });
  await dialog.locator('input[type=file]').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: png });
  await dialog.getByRole('button', { name: 'Replace icon' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.cubic-server-sidebar-head .cubic-server-icon-shell img')).toBeVisible();
  expect(await page.locator('.cubic-server-sidebar-head .cubic-server-icon-shell img').getAttribute('src')).not.toBe(firstUrl);

  await page.getByRole('button', { name: 'Options for Icons' }).click();
  await page.getByRole('button', { name: 'Server icon', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Server icon' });
  await dialog.locator('input[type=file]').setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await dialog.getByRole('button', { name: 'Replace icon' }).click();
  await expect(dialog.getByRole('alert')).toContainText('valid JPEG');
  await expect(dialog.getByText('Current server icon')).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove icon' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.cubic-server-sidebar-head .cubic-server-icon-shell img')).toHaveCount(0);
  await expect(page.locator('.cubic-server-sidebar-head .cubic-server-icon-shell')).toContainText('I');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('member sees the server icon without owner icon controls', async ({ page, browser, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One desktop permission run covers the shared server menu.');
  await openServers(page);
  await page.getByRole('button', { name: 'Create server' }).first().click();
  const create = page.getByRole('dialog', { name: 'Create server' });
  await create.getByRole('textbox', { name: 'Server name' }).fill('Shared icon');
  await create.getByRole('button', { name: 'Create server' }).click();
  await page.getByRole('button', { name: 'Options for Shared icon' }).click();
  await page.getByRole('button', { name: 'Server icon', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Server icon' });
  await dialog.locator('input[type=file]').setInputFiles({ name: 'icon.png', mimeType: 'image/png', buffer: png });
  await dialog.getByRole('button', { name: 'Upload icon' }).click();
  const src = await page.locator('.cubic-server-sidebar-head .cubic-server-icon-shell img').getAttribute('src');
  const serverId = /\/servers\/([0-9a-f-]+)\/icon/.exec(src ?? '')?.[1];
  expect(serverId).toBeTruthy();
  await request.post(`http://127.0.0.1:3198/__test/server-member?serverId=${serverId}`);
  const memberContext = await browser.newContext();
  try {
    await memberContext.addCookies([{ name: 'cubic_session', value: 'browser-peer', domain: '127.0.0.1', path: '/' }]);
    const memberPage = await memberContext.newPage();
    await memberPage.goto('/app');
    await openServers(memberPage);
    await memberPage.locator('.cubic-server-row').filter({ hasText: 'Shared icon' }).click();
    await expect(memberPage.locator('.cubic-server-sidebar-head .cubic-server-icon-shell img')).toBeVisible();
    await memberPage.getByRole('button', { name: 'Options for Shared icon' }).click();
    await expect(memberPage.getByRole('button', { name: 'Server icon', exact: true })).toHaveCount(0);
  } finally { await memberContext.close(); }
});
