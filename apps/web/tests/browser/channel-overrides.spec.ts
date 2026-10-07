import { expect, test } from '@playwright/test';
import { chooseChannelAction, chooseServerCreate, isCompactNavigation, openServers } from './navigation';

test.beforeEach(async ({ page, context, request }) => {
  await request.post('http://127.0.0.1:3198/__test/reset');
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/app');
});

test('channel permission editor supports role, member and @everyone tri-state', async ({ page, browser, request }) => {
  await openServers(page);
  await page.getByRole('button', { name: 'Create server' }).first().click();
  const create = page.getByRole('dialog', { name: 'Create server' });
  await create.getByRole('textbox', { name: 'Server name' }).fill('Override Lab');
  await create.getByRole('button', { name: 'Create server' }).click();
  const serverId = await page.evaluate(async () => (await (await fetch('/api/v1/servers')).json()).servers[0].id as string);
  await request.post(`http://127.0.0.1:3198/__test/server-member?serverId=${serverId}`);
  const roleId = await page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/servers/${id}/roles`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Smoke Manager', permissions: ['VIEW_CHANNEL'] }) });
    return (await response.json()).role.id as string;
  }, serverId);
  await page.evaluate(async ({ serverId, roleId }) => fetch(`/api/v1/servers/${serverId}/members/fixture-peer/roles/${roleId}`, { method: 'PUT' }), { serverId, roleId });
  await chooseServerCreate(page, 'Create text channel');
  const dialog = page.getByRole('dialog', { name: 'Create text channel' });
  await dialog.getByRole('textbox', { name: 'Channel name' }).fill('smoke');
  await dialog.getByRole('button', { name: 'Create text channel' }).click();
  if (isCompactNavigation(page)) await page.getByRole('button', { name: 'Back to server' }).click();
  await chooseChannelAction(page, 'text', 'smoke', 'Channel settings for smoke');
  const settings = page.getByRole('region', { name: 'smoke channel settings' });
  await expect(settings.getByRole('heading', { name: 'Permissions' })).toBeVisible();
  await settings.getByRole('combobox', { name: 'Add role/member override' }).selectOption({ label: 'Role · Smoke Manager' });
  await settings.getByRole('button', { name: 'Add', exact: true }).click();
  const view = settings.getByRole('group', { name: 'View channel' });
  await view.getByRole('radio', { name: 'Deny' }).check();
  await settings.getByRole('button', { name: 'Save permissions' }).click();
  await expect(settings.getByRole('button', { name: /Smoke Manager.*Role/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const peerContext = await browser.newContext();
  try {
    await peerContext.addCookies([{ name: 'cubic_session', value: 'browser-peer', domain: '127.0.0.1', path: '/' }]);
    const peerPage = await peerContext.newPage();
    await peerPage.goto('/app');
    await openServers(peerPage);
    await peerPage.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Open server Override Lab' }).click();
    await expect(peerPage.getByRole('button', { name: 'Text channel smoke' })).toHaveCount(0);
    await expect(peerPage.getByRole('button', { name: 'Actions for text channel smoke' })).toHaveCount(0);
    await view.getByRole('radio', { name: 'Allow' }).check();
    await settings.getByRole('button', { name: 'Save permissions' }).click();
    await expect(peerPage.getByRole('button', { name: 'Text channel smoke' })).toBeEnabled();
    await view.getByRole('radio', { name: 'Inherit' }).check();
    await settings.getByRole('button', { name: 'Save permissions' }).click();
    await expect(settings.getByRole('button', { name: /Smoke Manager.*Role/ })).toHaveCount(0);
    await expect(peerPage.getByRole('button', { name: 'Text channel smoke' })).toBeEnabled();
  } finally { await peerContext.close(); }

  await settings.getByRole('combobox', { name: 'Add role/member override' }).selectOption({ label: 'Role · @everyone' });
  await settings.getByRole('button', { name: 'Add', exact: true }).click();
  await view.getByRole('radio', { name: 'Deny' }).check();
  await settings.getByRole('button', { name: 'Save permissions' }).click();
  await expect(settings.getByRole('button', { name: /@everyone.*Role/ })).toBeVisible();
  await settings.getByRole('button', { name: 'Remove override' }).click();
  await settings.getByRole('combobox', { name: 'Add role/member override' }).selectOption({ label: 'Member · Fixture DM' });
  await settings.getByRole('button', { name: 'Add', exact: true }).click();
  await view.getByRole('radio', { name: 'Allow' }).check();
  await settings.getByRole('button', { name: 'Save permissions' }).click();
  await expect(settings.getByRole('button', { name: /Fixture DM.*Member/ })).toBeVisible();
});
