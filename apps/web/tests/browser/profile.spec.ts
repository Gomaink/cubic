import { test, expect } from '@playwright/test';
import { openUserSettings } from './navigation';

const fixture = 'http://127.0.0.1:3198';
const gif = Buffer.from('47494638396101000100800000000000ffffff21f90400000000002c000000000100010000020244010021f90400000000002c00000000010001000002024c01003b', 'hex');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

test.beforeEach(async ({ page, context, request }) => {
  await request.post(`${fixture}/__test/reset`);
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/app');
  await page.locator('.conversation-row').filter({ hasText: 'Fixture group' }).click();
});

test('member profile is read-only and closes back to the member panel', async ({ page }) => {
  await page.getByRole('button', { name: 'Members', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Group members' });
  await panel.getByRole('button', { name: 'Fixture DM, member, offline' }).click();
  const profile = page.locator('dialog.cubic-profile-dialog');
  await expect(profile).toBeVisible();
  await expect(profile.getByText('Fixture DM')).toBeVisible();
  await expect(profile.getByText('@peer')).toBeVisible();
  await expect(profile.getByRole('button', { name: 'Edit display name' })).toHaveCount(0);
  await profile.getByRole('button', { name: 'Close profile' }).click();
  await expect(panel).toBeVisible();
});

test('own profile opens Settings and edits display name without losing context', async ({ page }) => {
  await page.getByRole('button', { name: 'Members', exact: true }).click();
  await page.getByRole('complementary', { name: 'Group members' }).getByRole('button', { name: 'Tester, owner, online' }).click();
  const settings = page.getByRole('region', { name: 'User Settings' });
  await expect(settings).toBeVisible();
  await expect(settings.getByText('@tester').first()).toBeVisible();
  await expect(settings.getByRole('textbox', { name: 'Display name' })).toHaveValue('Tester');
  await expect(settings.getByRole('textbox', { name: /username/i })).toHaveCount(0);
  await expect(settings.getByRole('textbox', { name: /email|password/i })).toHaveCount(0);
  await settings.getByRole('textbox', { name: 'Display name' }).fill('Updated Tester');
  await settings.getByRole('button', { name: 'Save changes' }).click();
  await expect(settings.getByRole('heading', { name: 'Profile' })).toBeVisible();
  await expect(settings.getByText('Updated Tester')).toBeVisible();
  await settings.getByRole('button', { name: 'Close User Settings' }).click();
  const panel = page.getByRole('complementary', { name: 'Group members' });
  await expect(panel.getByRole('button', { name: 'Updated Tester, owner, online' })).toBeVisible();
  await expect(page.locator('.cubic-user-bar-copy')).toContainText('Updated Tester');
  if ((page.viewportSize()?.width ?? 1000) <= 680) {
    await panel.getByRole('button', { name: 'Close member panel' }).click();
    await page.getByRole('button', { name: 'Back to conversations' }).click();
    await openUserSettings(page);
    await expect(settings).toContainText('Updated Tester');
    await settings.getByRole('button', { name: 'Close User Settings' }).click();
    await page.locator('.conversation-row').filter({ hasText: 'Fixture group' }).click();
    await expect(page.locator('.messages-wrap')).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('GIF upload renders as an image and removal restores initials without a reload', async ({ page, request }) => {
  await openUserSettings(page);
  const settings = page.getByRole('region', { name: 'User Settings' });
  await settings.getByLabel('Choose avatar image').setInputFiles({ name: 'animated.gif', mimeType: 'image/gif', buffer: gif });
  const image = settings.getByRole('img', { name: "Tester's avatar" });
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', /\/avatar\/test\.gif$/);
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  const url = await image.getAttribute('src');
  const media = await request.get(`${fixture}${url}`, { headers: { cookie: 'cubic_session=browser-fixture' } });
  expect(media.headers()['content-type']).toBe('image/gif');
  await expect(page.locator('.cubic-user-bar-avatar img[src$="test.gif"]')).toHaveCount(1);
  await settings.getByRole('button', { name: 'Remove avatar' }).click();
  await expect(settings.getByLabel("Tester's initials")).toBeVisible();
  await expect(page.locator('.cubic-user-bar-avatar img[src$="test.gif"]')).toHaveCount(0);
});

test('static PNG avatar uses the existing upload and authenticated delivery path', async ({ page, request }) => {
  await openUserSettings(page);
  const settings = page.getByRole('region', { name: 'User Settings' });
  await settings.getByLabel('Choose avatar image').setInputFiles({ name: 'still.png', mimeType: 'image/png', buffer: png });
  const image = settings.getByRole('img', { name: "Tester's avatar" });
  await expect(image).toHaveAttribute('src', /\/avatar\/test\.png$/);
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  const media = await request.get(`${fixture}${await image.getAttribute('src')}`, { headers: { cookie: 'cubic_session=browser-fixture' } });
  expect(media.headers()['content-type']).toBe('image/png');
});
