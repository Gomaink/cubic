import { expect, test } from '@playwright/test';
import { openServerSettings, openServers } from './navigation';

const fixture = 'http://127.0.0.1:3198';

test.beforeEach(async ({ page, context, request }) => {
  await request.post(`${fixture}/__test/reset`);
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/app');
});

test('owner manages roles and member assignments in server settings', async ({ page, request }) => {
  await openServers(page);
  await page.getByRole('button', { name: 'Create server' }).first().click();
  const create = page.getByRole('dialog', { name: 'Create server' });
  await create.getByRole('textbox', { name: 'Server name' }).fill('Role Lab');
  await create.getByRole('button', { name: 'Create server' }).click();
  const serverId = await page.evaluate(async () => (await (await fetch('/api/v1/servers')).json()).servers[0].id);
  await request.post(`${fixture}/__test/server-member?serverId=${serverId}`);
  await openServerSettings(page);
  const settings = page.getByRole('region', { name: 'Role Lab server settings' });
  await settings.getByRole('navigation', { name: 'Server settings sections' }).getByRole('button', { name: 'Roles' }).click();
  await expect(settings.getByRole('heading', { name: 'Roles' })).toBeVisible();
  await expect(settings.getByRole('button', { name: /@everyone/ })).toBeVisible();
  await settings.getByRole('textbox', { name: 'Role name' }).fill('Helpers');
  await settings.getByRole('button', { name: 'Create role' }).click();
  await expect(settings.getByRole('heading', { name: 'Helpers' })).toBeVisible();
  await page.route('**/api/v1/servers/*/roles/*', async (route) => {
    const response = await route.fetch();
    if (route.request().method() === 'PATCH') return route.fulfill({ response, json: { ...await response.json(), voiceRevocationPending: true } });
    return route.fulfill({ response });
  });
  await settings.getByRole('checkbox', { name: 'manage roles' }).check();
  await settings.getByRole('button', { name: 'Save role' }).click();
  await expect(settings.getByRole('checkbox', { name: 'manage roles' })).toBeChecked();
  await expect(settings.getByRole('status')).toContainText('pending reconciliation');
  await settings.getByRole('textbox', { name: 'Role name' }).fill('Moderators');
  await settings.getByRole('button', { name: 'Save role' }).click();
  await expect(settings.getByRole('heading', { name: 'Moderators' })).toBeVisible();
  await settings.getByRole('navigation', { name: 'Server settings sections' }).getByRole('button', { name: /^Members/ }).click();
  await expect(settings.getByRole('heading', { name: 'Members · 2' })).toBeVisible();
  await settings.getByRole('button', { name: 'Manage roles' }).click();
  await settings.getByRole('checkbox', { name: 'Moderators' }).check();
  await expect(settings.getByText('Moderators · @everyone')).toBeVisible();
  await settings.getByRole('checkbox', { name: 'Moderators' }).uncheck();
  await expect(settings.getByText('Moderators · @everyone')).toHaveCount(0);
  await settings.getByRole('navigation', { name: 'Server settings sections' }).getByRole('button', { name: 'Roles' }).click();
  await settings.getByRole('button', { name: /@everyone/ }).click();
  await expect(settings.getByRole('textbox', { name: 'Role name' })).toHaveCount(0);
  await expect(settings.getByRole('button', { name: 'Delete role' })).toHaveCount(0);
  await settings.getByRole('button', { name: /Moderators/ }).click();
  page.once('dialog', (dialog) => dialog.dismiss());
  await settings.getByRole('button', { name: 'Delete role' }).click();
  await expect(settings.getByRole('button', { name: /Moderators/ })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await settings.getByRole('button', { name: 'Delete role' }).click();
  await expect(settings.getByRole('button', { name: /Moderators/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('ordinary member sees role details without management controls', async ({ page, browser, request }) => {
  await openServers(page);
  await page.getByRole('button', { name: 'Create server' }).first().click();
  const create = page.getByRole('dialog', { name: 'Create server' });
  await create.getByRole('textbox', { name: 'Server name' }).fill('Read Only Lab');
  await create.getByRole('button', { name: 'Create server' }).click();
  const serverId = await page.evaluate(async () => (await (await fetch('/api/v1/servers')).json()).servers[0].id);
  await request.post(`${fixture}/__test/server-member?serverId=${serverId}`);
  const friendContext = await browser.newContext();
  try {
    await friendContext.addCookies([{ name: 'cubic_session', value: 'browser-peer', domain: '127.0.0.1', path: '/' }]);
    const friendPage = await friendContext.newPage();
    await friendPage.goto('/app');
    await openServers(friendPage);
    await friendPage.locator('.cubic-server-row').filter({ hasText: 'Read Only Lab' }).click();
    await openServerSettings(friendPage);
    const settings = friendPage.getByRole('region', { name: 'Read Only Lab server settings' });
    await settings.getByRole('navigation', { name: 'Server settings sections' }).getByRole('button', { name: 'Roles' }).click();
    await expect(settings.getByRole('button', { name: /@everyone/ })).toBeVisible();
    await expect(settings.getByRole('button', { name: 'Create role' })).toHaveCount(0);
    await settings.getByRole('button', { name: /@everyone/ }).click();
    await expect(settings.getByRole('button', { name: 'Save role' })).toHaveCount(0);
    const denied = await friendPage.evaluate(async (id) => (await fetch(`/api/v1/servers/${id}/roles`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Denied' }) })).status, serverId);
    expect(denied).toBe(403);
  } finally { await friendContext.close(); }
});
