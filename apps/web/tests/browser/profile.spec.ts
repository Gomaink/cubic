import { test, expect } from '@playwright/test';

const fixture = 'http://127.0.0.1:3198';
const gif = Buffer.from('47494638396101000100800000000000ffffff21f90400000000002c000000000100010000020244010021f90400000000002c00000000010001000002024c01003b', 'hex');

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

test('own profile edits display name and preserves member role and presence', async ({ page }) => {
  await page.getByRole('button', { name: 'Members', exact: true }).click();
  await page.getByRole('complementary', { name: 'Group members' }).getByRole('button', { name: 'Tester, owner, online' }).click();
  const profile = page.locator('dialog.cubic-profile-dialog');
  await expect(profile).toBeVisible();
  await profile.getByRole('button', { name: 'Edit display name' }).click();
  await profile.getByLabel('Display name').fill('Updated Tester');
  await profile.getByRole('button', { name: 'Save display name' }).click();
  await expect(profile.getByRole('heading', { name: 'Updated Tester' })).toBeVisible();
  await profile.getByRole('button', { name: 'Close profile' }).click();
  const panel = page.getByRole('complementary', { name: 'Group members' });
  await expect(panel.getByRole('button', { name: 'Updated Tester, owner, online' })).toBeVisible();
  if ((page.viewportSize()?.width ?? 1000) <= 680) {
    await page.getByRole('button', { name: 'Open your profile' }).click();
    await expect(profile.getByRole('heading', { name: 'Updated Tester' })).toBeVisible();
    await profile.getByRole('button', { name: 'Close profile' }).click();
    await expect(page.locator('.messages-wrap')).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('GIF upload renders as an image and removal restores initials without a reload', async ({ page, request }) => {
  await page.getByRole('button', { name: 'Members', exact: true }).click();
  await page.getByRole('complementary', { name: 'Group members' }).getByRole('button', { name: 'Tester, owner, online' }).click();
  const profile = page.locator('dialog.cubic-profile-dialog');
  await profile.getByLabel('Choose avatar image').setInputFiles({ name: 'animated.gif', mimeType: 'image/gif', buffer: gif });
  const image = profile.getByRole('img', { name: "Tester's avatar" });
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', /\/avatar\/test\.gif$/);
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  const url = await image.getAttribute('src');
  const media = await request.get(`${fixture}${url}`, { headers: { cookie: 'cubic_session=browser-fixture' } });
  expect(media.headers()['content-type']).toBe('image/gif');
  await profile.getByRole('button', { name: 'Close profile' }).click();
  await expect(page.getByRole('complementary', { name: 'Group members' }).locator('img[src$="test.gif"]')).toBeVisible();

  await page.getByRole('complementary', { name: 'Group members' }).getByRole('button', { name: 'Tester, owner, online' }).click();
  await profile.getByRole('button', { name: 'Remove avatar' }).click();
  await expect(profile.getByLabel("Tester's initials")).toBeVisible();
  await profile.getByRole('button', { name: 'Close profile' }).click();
  await expect(page.getByRole('complementary', { name: 'Group members' }).locator('img[src$="test.gif"]')).toHaveCount(0);
});
