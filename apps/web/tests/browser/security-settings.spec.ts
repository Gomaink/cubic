import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { openUserSettings } from './navigation';

const fixture = 'http://127.0.0.1:3198';
const artifacts = '/tmp/cubic-alpha11-slice7-1';

test.beforeEach(async ({ page, context, request }) => {
  await request.post(`${fixture}/__test/reset`);
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/app');
});

test('Security changes a password with validation and refreshes Sessions across viewports', async ({ page }, testInfo) => {
  await mkdir(artifacts, { recursive: true });
  await openUserSettings(page);
  const settings = page.getByRole('region', { name: 'User Settings' });
  const nav = settings.getByRole('navigation', { name: 'User settings sections' });
  await nav.getByRole('button', { name: 'Security' }).focus();
  await page.keyboard.press('Enter');
  await expect(nav.getByRole('button', { name: 'Security' })).toHaveAttribute('aria-current', 'page');
  await expect(settings.getByRole('heading', { name: 'Password' })).toBeVisible();
  const current = settings.getByLabel('Current password');
  const next = settings.getByLabel('New password', { exact: true });
  const confirm = settings.getByLabel('Confirm new password');
  await expect(current).toHaveAttribute('type', 'password');
  await expect(next).toHaveAttribute('type', 'password');
  await expect(confirm).toHaveAttribute('type', 'password');
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
    expect(await nav.getByRole('button', { name: 'Security' }).evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    expect(await current.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: `${artifacts}/${testInfo.project.name}-security.png` });
  let submitted = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/v1/auth/password') && request.method() === 'PATCH') submitted += 1;
  });

  await current.fill('test-only-password');
  await next.fill('test-only-updated-password');
  await confirm.fill('test-only-mismatch');
  await settings.getByRole('button', { name: 'Change password' }).click();
  await expect(settings.getByRole('alert')).toContainText('New passwords do not match.');
  expect(submitted).toBe(0);
  await confirm.fill('test-only-updated-password');
  await current.fill('test-only-wrong');
  await settings.getByRole('button', { name: 'Change password' }).click();
  await expect(settings.getByRole('alert')).toContainText('Current password is incorrect.');
  if (testInfo.project.name === 'phone-portrait') await page.screenshot({ path: `${artifacts}/phone-security-error.png` });
  await current.fill('test-only-password');
  await settings.getByRole('button', { name: 'Change password' }).click();
  await expect(settings.getByRole('status')).toContainText('Password changed. Other sessions were signed out.');
  await expect(current).toHaveValue('');
  await expect(next).toHaveValue('');
  await expect(confirm).toHaveValue('');
  expect(submitted).toBe(2);
  if (testInfo.project.name === 'desktop') await page.screenshot({ path: `${artifacts}/desktop-security-success.png` });

  await nav.getByRole('button', { name: 'Sessions' }).click();
  await expect(settings.locator('.cubic-session-row')).toHaveCount(1);
  await nav.getByRole('button', { name: 'App', exact: true }).click();
  await expect(settings.getByRole('heading', { name: 'App' })).toBeVisible();
  await nav.getByRole('button', { name: 'Security' }).click();
  await expect(settings.getByRole('heading', { name: 'Password' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await settings.getByRole('button', { name: 'Close User Settings' }).click();
});
