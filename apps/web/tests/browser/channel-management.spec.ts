import { expect, test } from '@playwright/test';
import { chooseServerCreate, openServers } from './navigation';

test.beforeEach(async ({ page, context, request }) => {
  await request.post('http://127.0.0.1:3198/__test/reset');
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/app');
});

test('category controls create there and channel settings rename and delete with confirmation', async ({ page }, testInfo) => {
  await openServers(page);
  await page.getByRole('button', { name: 'Create server' }).first().click();
  const createServer = page.getByRole('dialog', { name: 'Create server' });
  await createServer.getByRole('textbox', { name: 'Server name' }).fill('Channel Lab');
  await createServer.getByRole('button', { name: 'Create server' }).click();
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Open server Channel Lab' }).click();
  await expect(page.locator('.cubic-channel-sidebar-head')).not.toContainText('CHANNELS');
  await chooseServerCreate(page, 'Create category');
  const categoryDialog = page.getByRole('dialog', { name: 'Create category' });
  await categoryDialog.getByRole('textbox', { name: 'Category name' }).fill('Projects');
  await categoryDialog.getByRole('button', { name: 'Create category' }).click();
  await chooseServerCreate(page, 'Create text channel');
  const uncategorized = page.getByRole('dialog', { name: 'Create text channel' });
  await uncategorized.getByRole('textbox', { name: 'Channel name' }).fill('lobby');
  await uncategorized.getByRole('button', { name: 'Create text channel' }).click();
  const back = page.getByRole('button', { name: 'Back to server', exact: true });
  if (testInfo.project.name === 'phone-portrait') { await expect(back).toBeVisible(); await back.click(); }
  const category = page.getByRole('region', { name: 'Category Projects' });
  await expect(page.locator('.cubic-channel-list > .cubic-layout-channel-line').first().getByRole('button', { name: 'Text channel lobby', exact: true })).toBeVisible();
  expect(await page.evaluate(() => {
    const list = document.querySelector('.cubic-channel-list');
    const plain = list?.querySelector(':scope > .cubic-layout-channel-line');
    const category = list?.querySelector(':scope > .cubic-layout-category');
    return Boolean(plain && category && plain.compareDocumentPosition(category) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  await expect(category.getByRole('button', { name: 'Add channel to Projects' })).toBeVisible();
  await category.getByRole('button', { name: 'Add channel to Projects' }).click();
  await category.getByRole('button', { name: 'Create text channel in Projects' }).click();
  const textDialog = page.getByRole('dialog', { name: 'Create text channel' });
  await expect(textDialog.getByRole('combobox', { name: 'Category' })).toHaveValue(/^[0-9a-f-]{36}$/);
  await textDialog.getByRole('textbox', { name: 'Channel name' }).fill('plans');
  await textDialog.getByRole('button', { name: 'Create text channel' }).click();
  if (testInfo.project.name === 'phone-portrait') { await expect(back).toBeVisible(); await back.click(); }
  await expect(category.getByRole('button', { name: 'Text channel plans', exact: true })).toBeVisible();
  await expect(page.locator('.cubic-channel-list').getByRole('button', { name: 'Text channel plans', exact: true })).toHaveCount(1);
  await category.getByRole('button', { name: 'Actions for text channel plans' }).click();
  await category.getByRole('button', { name: 'Channel settings for plans' }).click();
  await page.getByRole('textbox', { name: 'Channel name' }).fill('roadmap');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('region', { name: 'roadmap channel settings' })).toBeVisible();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Delete roadmap' }).click();
  await expect(page.getByRole('region', { name: 'roadmap channel settings' })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete roadmap' }).click();
  await expect(category.getByRole('button', { name: 'Text channel roadmap', exact: true })).toHaveCount(0);
  await category.getByRole('button', { name: 'Add channel to Projects' }).click();
  await category.getByRole('button', { name: 'Create voice channel in Projects' }).click();
  const voiceDialog = page.getByRole('dialog', { name: 'Create voice channel' });
  await voiceDialog.getByRole('textbox', { name: 'Voice channel name' }).fill('standup');
  await voiceDialog.getByRole('button', { name: 'Create voice channel' }).click();
  await category.getByRole('button', { name: 'Actions for voice channel standup' }).click();
  await category.getByRole('button', { name: 'Channel settings for standup' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete standup' }).click();
  await expect(category.getByRole('button', { name: 'Join voice channel standup', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('member sees management actions only after MANAGE_CHANNELS is assigned', async ({ page, context, request }) => {
  const created = await context.request.post('http://127.0.0.1:3198/api/v1/servers', { data: { name: 'Permissions Lab' } });
  expect(created.status()).toBe(201);
  const server = (await created.json()).server;
  await request.post(`http://127.0.0.1:3198/__test/server-member?serverId=${server.id}`);
  await context.addCookies([{ name: 'cubic_session', value: 'browser-peer', domain: '127.0.0.1', path: '/' }]);
  await page.reload();
  await openServers(page);
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Open server Permissions Lab' }).click();
  await expect(page.getByRole('button', { name: 'Add channel or category' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add channel to Projects' })).toHaveCount(0);
  const managerRole = await context.request.post(`http://127.0.0.1:3198/api/v1/servers/${server.id}/roles`, {
    headers: { cookie: 'cubic_session=browser-fixture' }, data: { name: 'Channel manager', permissions: ['MANAGE_CHANNELS'] }
  });
  expect(managerRole.status()).toBe(201);
  const role = (await managerRole.json()).role;
  const assigned = await context.request.put(`http://127.0.0.1:3198/api/v1/servers/${server.id}/members/fixture-peer/roles/${role.id}`, {
    headers: { cookie: 'cubic_session=browser-fixture' }
  });
  expect(assigned.status()).toBe(200);
  await page.reload();
  await openServers(page);
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Open server Permissions Lab' }).click();
  await expect(page.getByRole('button', { name: 'Add channel or category' })).toBeVisible();
  await chooseServerCreate(page, 'Create category');
  await page.getByRole('dialog', { name: 'Create category' }).getByRole('textbox', { name: 'Category name' }).fill('Projects');
  await page.getByRole('dialog', { name: 'Create category' }).getByRole('button', { name: 'Create category' }).click();
  await expect(page.getByRole('region', { name: 'Category Projects' }).getByRole('button', { name: 'Add channel to Projects' })).toBeVisible();
});
