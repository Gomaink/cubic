import { expect, test } from '@playwright/test';

const fixture = 'http://127.0.0.1:3198';

test.beforeEach(async ({ request }) => {
  await request.post(`${fixture}/__test/reset`);
});

test('password login is operable from the keyboard', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Cubic' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox', { name: 'E-mail or username' })).toBeFocused();
  await page.keyboard.type('tester');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await page.keyboard.type('test-only-password');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
});

test('settings traps focus, exposes navigation state, and restores the trigger', async ({ page, context }) => {
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/app');
  const trigger = page.locator('button[aria-label="User Settings"]:visible').first();
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'User Settings' });
  await expect(dialog).toBeFocused();
  expect(await page.locator('.cubic-primary-rail').evaluate((node) => (node as HTMLElement).inert)).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  const avatarInput = dialog.getByLabel('Choose avatar image');
  await expect(avatarInput).toHaveAttribute('tabindex', '-1');
  await dialog.getByRole('button', { name: 'Change avatar' }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(avatarInput).not.toBeFocused();
  const security = dialog.getByRole('navigation', { name: 'User settings sections' }).getByRole('button', { name: 'Security' });
  await security.focus();
  await page.keyboard.press('Enter');
  await expect(security).toHaveAttribute('aria-current', 'page');
  await expect(dialog.getByRole('heading', { name: 'Passkeys' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.locator('.cubic-primary-rail').evaluate((node) => (node as HTMLElement).inert)).toBe(false);
  await page.keyboard.press('Enter');
  await expect(dialog).toBeFocused();
  expect(await page.locator('.cubic-primary-rail').evaluate((node) => (node as HTMLElement).inert)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  expect(await page.locator('.cubic-primary-rail').evaluate((node) => (node as HTMLElement).inert)).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('messages, search, attachments, and custom dialog expose usable keyboard paths', async ({ page, context }, testInfo) => {
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/app');
  const conversation = page.locator('.conversation-row').filter({ hasText: 'Fixture DM' });
  await conversation.focus();
  await page.keyboard.press('Enter');
  await expect(conversation).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('article.discord-message.continuation').first()).toHaveAttribute('aria-label', /.+ at .+/);
  await expect(page.locator('article.discord-message:not(.continuation)').first()).not.toHaveAttribute('aria-label');

  const picker = page.getByRole('button', { name: 'Add attachment' });
  if (testInfo.project.use.hasTouch) {
    const dimensions = await picker.evaluate((node) => {
      const style = getComputedStyle(node);
      return { width: style.width, height: style.height, minWidth: style.minWidth, minHeight: style.minHeight };
    });
    expect(dimensions).toEqual({ width: '44px', height: '44px', minWidth: '44px', minHeight: '44px' });
    const box = await picker.boundingBox();
    // Browser coordinate conversion can round a 44 CSS px box a few millionths below 44.
    expect(box!.width).toBeGreaterThanOrEqual(43.99);
    expect(box!.height).toBeGreaterThanOrEqual(43.99);
  }
  await picker.focus();
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await chooser).setFiles({ name: 'accessible.txt', mimeType: 'text/plain', buffer: Buffer.from('fixture') });
  await expect(page.locator('.cubic-staged-attachment')).toHaveCount(1);

  if (page.viewportSize()!.width <= 680) await page.getByRole('button', { name: 'Back to conversations' }).click();
  const people = page.getByRole('button', { name: 'People and friends' });
  await people.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Search people' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Messages' }).click();

  const newGroup = page.getByRole('button', { name: 'New group' });
  await newGroup.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Create group' });
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(newGroup).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
