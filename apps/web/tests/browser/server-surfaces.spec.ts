import { expect, test } from '@playwright/test';
import { chooseServerCreate, isCompactNavigation, openServers } from './navigation';

const fixture = 'http://127.0.0.1:3198';

test.beforeEach(async ({ page, context, request }) => {
  await request.post(`${fixture}/__test/reset`);
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/app');
});

async function expectDedicatedSurfaceOwnsViewport(
  page: import('@playwright/test').Page,
  surface: import('@playwright/test').Locator
) {
  const viewport = page.viewportSize();
  if (!viewport) return;
  const shouldOwnViewport = viewport.width <= 680 || (viewport.width <= 900 && viewport.height <= 500);
  if (!shouldOwnViewport) return;

  await expect.poll(async () => {
    const box = await surface.boundingBox();
    return Boolean(
      box &&
      Math.abs(box.x) <= 1 &&
      Math.abs(box.y) <= 1 &&
      box.width >= viewport.width - 1 &&
      box.height >= viewport.height - 1
    );
  }, {
    message: 'dedicated settings surface should finish its transition and own the viewport',
    timeout: 3000
  }).toBe(true);
}

async function createSurfaceServer(page: import('@playwright/test').Page) {
  await openServers(page);
  await page.getByRole('button', { name: 'Create server' }).first().click();
  const create = page.getByRole('dialog', { name: 'Create server' });
  await create.getByRole('textbox', { name: 'Server name' }).fill('Surface Lab');
  await create.getByRole('button', { name: 'Create server' }).click();

  await chooseServerCreate(page, 'Create category');
  let dialog = page.getByRole('dialog', { name: 'Create category' });
  await dialog.getByRole('textbox', { name: 'Category name' }).fill('General');
  await dialog.getByRole('button', { name: 'Create category' }).click();

  await chooseServerCreate(page, 'Create category');
  dialog = page.getByRole('dialog', { name: 'Create category' });
  await dialog.getByRole('textbox', { name: 'Category name' }).fill('Later');
  await dialog.getByRole('button', { name: 'Create category' }).click();

  await chooseServerCreate(page, 'Create text channel');
  dialog = page.getByRole('dialog', { name: 'Create text channel' });
  await dialog.getByRole('textbox', { name: 'Channel name' }).fill('chat');
  await dialog.getByRole('combobox', { name: 'Category' }).selectOption({ label: 'General' });
  await dialog.getByRole('button', { name: 'Create text channel' }).click();
  await expect(page.locator('.chat-heading')).toContainText('chat');

  await chooseServerCreate(page, 'Create voice channel');
  dialog = page.getByRole('dialog', { name: 'Create voice channel' });
  await dialog.getByRole('textbox', { name: 'Voice channel name' }).fill('Lounge');
  await dialog.getByRole('combobox', { name: 'Category' }).selectOption({ label: 'General' });
  await dialog.getByRole('button', { name: 'Create voice channel' }).click();
}

test('server overview, members, invites, and channel settings use dedicated honest surfaces', async ({ page }, testInfo) => {
  await createSurfaceServer(page);
  if (isCompactNavigation(page) && await page.getByRole('button', { name: 'Back to server', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Back to server', exact: true }).click();
  }

  await page.getByRole('button', { name: 'Options for Surface Lab' }).click();
  await page.getByRole('button', { name: 'Server overview' }).click();
  const settings = page.getByRole('region', { name: 'Surface Lab server settings' });
  await expect(settings).toBeVisible();
  await expectDedicatedSurfaceOwnsViewport(page, settings);
  await expect(settings.getByRole('heading', { name: 'Surface Lab' })).toBeVisible();
  await expect(settings.getByText('Text channels').locator('..')).toContainText('1');
  await expect(settings.getByText('Voice channels').locator('..')).toContainText('1');
  await expect(settings.getByText('Name changes are not available yet.')).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Change icon' })).toBeVisible();
  await page.screenshot({ path: `/tmp/cubic-alpha11-slice3/${testInfo.project.name}-server-overview.png` });

  await settings.getByRole('navigation', { name: 'Server settings sections' }).getByRole('button', { name: /^Members/ }).click();
  await expect(settings.getByRole('heading', { name: 'Members · 1' })).toBeVisible();
  await expect(settings.getByRole('button', { name: /Open Tester.*profile, owner/ })).toBeVisible();

  await settings.getByRole('button', { name: 'Invites' }).click();
  await expect(settings.getByRole('heading', { name: 'Invites' })).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Create shareable link' })).toBeVisible();
  await expect(settings.getByRole('combobox', { name: 'Friend' })).toBeVisible();

  if (isCompactNavigation(page)) await page.getByRole('button', { name: 'Back to server', exact: true }).click();
  else await page.getByRole('button', { name: 'Close server settings' }).click();
  await expect(settings).toHaveCount(0);
  await expect(page.locator('.cubic-server-sidebar-head')).toContainText('Surface Lab');

  const general = page.getByRole('region', { name: 'Category General' });
  await general.getByRole('button', { name: 'Actions for voice channel Lounge' }).click();
  await general.getByRole('button', { name: 'Channel settings for Lounge' }).click();
  let channelSettings = page.getByRole('region', { name: 'Lounge channel settings' });
  await expect(channelSettings).toBeVisible();
  const channelName = channelSettings.getByRole('textbox', { name: 'Channel name' });
  await channelName.fill('Stage');
  await channelSettings.getByRole('button', { name: 'Save name' }).click();
  channelSettings = page.getByRole('region', { name: 'Stage channel settings' });
  await expect(channelSettings).toBeVisible();
  await channelSettings.getByRole('combobox', { name: 'Category' }).selectOption({ label: 'Later' });
  await channelSettings.getByRole('button', { name: 'Move to category' }).click();
  await expect(channelSettings.getByRole('button', { name: 'Move to category' })).toBeDisabled();
  if (isCompactNavigation(page)) await page.getByRole('button', { name: 'Back to server', exact: true }).click();
  else await page.getByRole('button', { name: 'Close channel settings' }).click();

  const later = page.getByRole('region', { name: 'Category Later' });
  await expect(later.getByRole('button', { name: 'Join voice channel Stage', exact: true })).toBeVisible();

  await page.getByRole('region', { name: 'Category General' }).getByRole('button', { name: 'Actions for text channel chat' }).click();
  await page.getByRole('button', { name: 'Channel settings for chat' }).click();
  const textSettings = page.getByRole('region', { name: 'chat channel settings' });
  await expect(textSettings).toBeVisible();
  await expectDedicatedSurfaceOwnsViewport(page, textSettings);
  await expect(textSettings.getByText('Text-channel renaming is not implemented yet.')).toBeVisible();
  await expect(textSettings.getByRole('textbox', { name: 'Channel name' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/cubic-alpha11-slice3/${testInfo.project.name}-channel-settings.png` });
});

test('ordinary members get read-only server surfaces without owner administration', async ({ page, browser, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One desktop authorization/visibility pass covers the shared surface.');
  await openServers(page);
  await page.getByRole('button', { name: 'Create server' }).first().click();
  const create = page.getByRole('dialog', { name: 'Create server' });
  await create.getByRole('textbox', { name: 'Server name' }).fill('Member Surface');
  await create.getByRole('button', { name: 'Create server' }).click();
  const serverId = await page.evaluate(async () => (await (await fetch('/api/v1/servers')).json()).servers[0].id as string);
  await request.post(`${fixture}/__test/server-member?serverId=${serverId}`);

  const memberContext = await browser.newContext();
  try {
    await memberContext.addCookies([{ name: 'cubic_session', value: 'browser-peer', domain: '127.0.0.1', path: '/' }]);
    const memberPage = await memberContext.newPage();
    await memberPage.goto('/app');
    await openServers(memberPage);
    await memberPage.locator('.cubic-server-row').filter({ hasText: 'Member Surface' }).click();
    await memberPage.getByRole('button', { name: 'Options for Member Surface' }).click();
    await memberPage.getByRole('button', { name: 'Server overview' }).click();
    const settings = memberPage.getByRole('region', { name: 'Member Surface server settings' });
    await expect(settings.getByText('You are a member of this server.')).toBeVisible();
    await expect(settings.getByRole('button', { name: 'Invites' })).toHaveCount(0);
    await expect(settings.getByRole('button', { name: 'Change icon' })).toHaveCount(0);
    await expect(settings.getByRole('button', { name: 'Leave server' })).toBeVisible();
    await settings.getByRole('navigation', { name: 'Server settings sections' }).getByRole('button', { name: /^Members/ }).click();
    await expect(settings.getByRole('button', { name: /Remove .* from server/ })).toHaveCount(0);
  } finally {
    await memberContext.close();
  }
});
