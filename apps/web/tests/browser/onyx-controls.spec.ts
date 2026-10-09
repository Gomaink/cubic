import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { chooseServerCreate, hasCoarsePointer, isCompactNavigation, openServerSettingsSection, openServers, openUserSettings } from './navigation';

const artifacts = '/tmp/cubic-alpha11-slice5-1';
const screenshotPrefix: Record<string, string> = { desktop: 'desktop', 'phone-portrait': 'phone', 'small-phone': 'small-phone' };

test.beforeEach(async ({ page, context, request }) => {
  await request.post('http://127.0.0.1:3198/__test/reset');
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/app');
});

test('Onyx rail, switches, avatar action, channel menu and server settings stay usable', async ({ page, request }, testInfo) => {
  const prefix = screenshotPrefix[testInfo.project.name];
  if (prefix) await mkdir(artifacts, { recursive: true });
  const rail = page.getByRole('navigation', { name: 'Primary navigation' });
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--cubic-brand').trim())).toBe('#fdfdfd');
  const messages = rail.getByRole('button', { name: 'Messages' });
  await expect(messages).toHaveAttribute('aria-current', 'page');
  const active = await messages.evaluate((node) => ({ border: getComputedStyle(node).borderColor, shadow: getComputedStyle(node).boxShadow, bg: getComputedStyle(node).backgroundColor }));
  expect(active.shadow).toBe('none');
  expect(active.border).not.toBe('rgba(0, 0, 0, 0)');
  await messages.focus();
  expect(await messages.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('solid');
  await messages.evaluate((node: HTMLButtonElement) => node.blur());
  if (prefix && prefix !== 'small-phone') await page.screenshot({ path: `${artifacts}/${prefix}-main-rail.png` });

  await openUserSettings(page);
  const settings = page.getByRole('region', { name: 'User Settings' });
  const avatar = settings.getByRole('button', { name: 'Change avatar' });
  await expect(avatar).toBeVisible();
  expect(await avatar.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  const chooser = page.waitForEvent('filechooser');
  await avatar.click();
  expect((await chooser).isMultiple()).toBe(false);
  if (prefix === 'desktop') await page.screenshot({ path: `${artifacts}/desktop-user-profile.png` });
  await settings.getByRole('navigation', { name: 'User settings sections' }).getByRole('button', { name: 'App' }).click();
  if (await hasCoarsePointer(page)) expect(await settings.getByRole('navigation', { name: 'User settings sections' }).getByRole('button', { name: 'App' }).evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  const compact = settings.getByRole('checkbox', { name: 'Compact mode' });
  const motion = settings.getByRole('checkbox', { name: 'Reduced motion' });
  for (const toggle of [compact, motion]) {
    expect(await toggle.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toBeChecked();
  }
  await expect(compact).toBeEnabled();
  await expect(motion).toBeEnabled();
  if (prefix) await page.screenshot({ path: `${artifacts}/${prefix}-app-settings.png` });
  await settings.getByRole('button', { name: 'Close User Settings' }).click();

  await request.post('http://127.0.0.1:3198/__test/server-friends');
  await page.reload();
  await openServers(page);
  await page.getByRole('button', { name: 'Create server' }).first().click();
  const create = page.getByRole('dialog', { name: 'Create server' });
  await create.getByRole('textbox', { name: 'Server name' }).fill('Onyx Lab');
  await create.getByRole('button', { name: 'Create server' }).click();
  await chooseServerCreate(page, 'Create category');
  const categoryDialog = page.getByRole('dialog', { name: 'Create category' });
  await categoryDialog.getByRole('textbox', { name: 'Category name' }).fill('General');
  await categoryDialog.getByRole('button', { name: 'Create category' }).click();
  await chooseServerCreate(page, 'Create text channel');
  const channelDialog = page.getByRole('dialog', { name: 'Create text channel' });
  await channelDialog.getByRole('textbox', { name: 'Channel name' }).fill('chat');
  await channelDialog.getByRole('combobox', { name: 'Category' }).selectOption({ label: 'General' });
  await channelDialog.getByRole('button', { name: 'Create text channel' }).click();
  if (isCompactNavigation(page)) await page.getByRole('button', { name: 'Back to server', exact: true }).click();
  const category = page.getByRole('region', { name: 'Category General' });
  const actions = category.getByRole('button', { name: 'Actions for text channel chat' });
  if (await hasCoarsePointer(page)) {
    await expect(actions).toHaveCSS('opacity', '1');
  } else {
    const categoryActions = category.getByRole('button', { name: 'Actions for category General' });
    await expect(categoryActions).toHaveCSS('opacity', '0');
    await category.locator('.cubic-layout-category-head').hover();
    await expect(categoryActions).toHaveCSS('opacity', '1');
    await expect(actions).toHaveCSS('opacity', '1');
    await actions.focus();
    await page.keyboard.press('Enter');
    await expect(actions).toHaveAttribute('aria-expanded', 'true');
  }
  if (await hasCoarsePointer(page)) await actions.click();
  await expect(category.getByRole('group', { name: 'Actions for chat' }).getByRole('button', { name: 'Channel settings for chat' })).toBeVisible();
  if (prefix === 'desktop') await page.screenshot({ path: `${artifacts}/desktop-channel-menu.png` });
  await actions.click();

  await openServerSettingsSection(page, 'Overview');
  const serverSettings = page.getByRole('region', { name: 'Onyx Lab server settings' });
  await expect(serverSettings.getByRole('button', { name: 'Change icon' })).toBeVisible();
  await expect(serverSettings.getByRole('button', { name: /Manage members|Manage invites/ })).toHaveCount(0);
  if (prefix && prefix !== 'small-phone') await page.screenshot({ path: `${artifacts}/${prefix}-server-overview.png` });
  await serverSettings.getByRole('navigation', { name: 'Server settings sections' }).getByRole('button', { name: /Members/ }).click();
  await expect(serverSettings.getByRole('heading', { name: /Members/ })).toBeVisible();
  await serverSettings.getByRole('navigation', { name: 'Server settings sections' }).getByRole('button', { name: /Invites/ }).click();
  if (await hasCoarsePointer(page)) expect(await serverSettings.getByRole('combobox', { name: 'Expiration' }).evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await expect(serverSettings.getByRole('button', { name: 'Invite friend' })).toHaveCount(0);
  await serverSettings.getByRole('button', { name: 'Create invite link' }).click();
  await serverSettings.getByRole('button', { name: 'Done' }).click();
  await expect(serverSettings.locator('.cubic-share-link-status')).toContainText('Active');
  if (prefix) {
    await serverSettings.locator('.cubic-settings-content').evaluate((node) => node.scrollTop = 0);
    await page.screenshot({ path: `${artifacts}/${prefix}-server-invites.png` });
    if (prefix === 'small-phone') {
      await serverSettings.locator('.cubic-share-link-row').first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${artifacts}/small-phone-server-invites-link.png` });
    }
  }
  await serverSettings.getByRole('button', { name: /Revoke link created/ }).click();
  await expect(serverSettings.locator('.cubic-share-link-inactive')).toContainText('Revoked');
  await expect(serverSettings.getByRole('button', { name: /Revoke link created/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
