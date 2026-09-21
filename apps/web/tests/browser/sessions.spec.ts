import { test, expect, type Page } from '@playwright/test';

const fixture = 'http://127.0.0.1:3198';

async function openSessions(page: Page) {
  await page.getByRole('button', { name: 'Active sessions' }).click();
  await expect(page.getByRole('dialog', { name: 'Active sessions' })).toBeVisible();
}

test.beforeEach(async ({ page, context, request }) => {
  await request.post(`${fixture}/__test/reset`);
  await context.addCookies([{
    name: 'cubic_session',
    value: 'browser-fixture',
    domain: '127.0.0.1',
    path: '/'
  }]);
  await page.goto('/app');
});

test('session dialog is responsive, keyboard accessible, and shows safe session metadata', async ({ page }) => {
  await page.route('**/api/v1/auth/sessions', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await new Promise((resolve) => setTimeout(resolve, 150));
    return route.continue();
  });

  await page.getByRole('button', { name: 'Active sessions' }).click();
  await expect(page.getByText('Loading active sessions…')).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'Active sessions' });
  await expect(dialog.getByText('Firefox on Linux')).toBeVisible();
  await expect(dialog.getByText('Unknown client')).toBeVisible();
  await expect(dialog.getByText('Current session')).toBeVisible();
  await expect(dialog.getByText(/Approximately/).first()).toBeVisible();

  const bounds = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.height);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Active sessions' })).toBeVisible();
});

test('session dialog handles error, retry, and empty states', async ({ page, request }) => {
  await request.post(`${fixture}/__test/session-mode?value=error`);
  await openSessions(page);
  await expect(page.getByRole('alert')).toContainText('Unable to load active sessions');

  await request.post(`${fixture}/__test/session-mode?value=ok`);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('Firefox on Linux')).toBeVisible();
  await page.getByRole('button', { name: 'Close active sessions' }).click();

  await request.post(`${fixture}/__test/session-mode?value=empty`);
  await openSessions(page);
  await expect(page.getByText('No active sessions were found.')).toBeVisible();
});

test('session revocation requires confirmation and refreshes or redirects appropriately', async ({ page, request }) => {
  await openSessions(page);
  const unknownRow = page.locator('.cubic-session-row').filter({ hasText: 'Unknown client' });

  page.once('dialog', (confirmation) => confirmation.dismiss());
  await unknownRow.getByRole('button', { name: 'Revoke' }).click();
  await expect(unknownRow).toBeVisible();

  page.once('dialog', (confirmation) => confirmation.accept());
  await unknownRow.getByRole('button', { name: 'Revoke' }).click();
  await expect(unknownRow).toHaveCount(0);

  await page.getByRole('button', { name: 'Close active sessions' }).click();
  await request.post(`${fixture}/__test/reset`);
  await openSessions(page);
  page.once('dialog', (confirmation) => confirmation.accept());
  await page.getByRole('button', { name: 'Log out all other sessions' }).click();
  await expect(page.locator('.cubic-session-row')).toHaveCount(1);
  await expect(page.getByText('Firefox on Linux')).toBeVisible();

  page.once('dialog', (confirmation) => confirmation.dismiss());
  await page.getByRole('button', { name: 'Log out everywhere' }).click();
  await expect(page).toHaveURL(/\/app$/);

  page.once('dialog', (confirmation) => confirmation.accept());
  await page.getByRole('button', { name: 'Log out everywhere' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
