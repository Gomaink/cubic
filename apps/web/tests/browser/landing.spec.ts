import { expect, test } from '@playwright/test';

test('public landing describes available Cubic features without stale milestone copy', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.hero .eyebrow')).toContainText('Cubic early access · self-hosted messenger');
  await expect(page.locator('.hero .eyebrow')).not.toContainText('undefined');
  await expect(page.getByRole('heading', { level: 1, name: 'Your space to talk, together.' })).toBeVisible();
  for (const name of ['Messaging', 'Servers', 'Voice & media', 'Account security', 'Across your browsers', 'Self-hosted']) {
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  }
  await expect(page.getByRole('link', { name: 'Create a Cubic account' })).toHaveAttribute('href', '/register');
  await expect(page.getByText(/Conversation Engine|alpha\.3|alpha\.4|Discover|Electron Preview/)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
