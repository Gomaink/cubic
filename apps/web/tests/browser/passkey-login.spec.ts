import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { openUserSettings } from './navigation';

const fixture = 'http://127.0.0.1:3198';
const artifacts = '/tmp/cubic-alpha11-slice7-4-2';

test.beforeEach(async ({ request }) => { await request.post(`${fixture}/__test/reset`); });

test('resident passkey signs in with an ordinary Cubic session and removal blocks future login', async ({ page, context, request }, testInfo) => {
  await mkdir(artifacts, { recursive: true });
  await request.get(`${fixture}/__test/email-verified?value=true`);
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: 'localhost', path: '/' }]);
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true
  } });
  await page.goto('http://localhost:3197/app');
  await openUserSettings(page);
  let settings = page.getByRole('region', { name: 'User Settings' });
  await settings.getByRole('navigation', { name: 'User settings sections' }).getByRole('button', { name: 'Security' }).click();
  await settings.getByRole('button', { name: 'Add passkey' }).click();
  await settings.getByLabel('Current password').last().fill('test-only-password');
  await settings.getByRole('button', { name: 'Continue' }).click();
  await expect(settings.getByText('Passkey added.')).toBeVisible();
  await context.clearCookies();
  await page.goto('http://localhost:3197/login');
  const button = page.getByRole('button', { name: 'Sign in with passkey' });
  await expect(button).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  const project = testInfo.project.name;
  const prefix = project === 'desktop' ? 'desktop' : project === 'phone-portrait' ? 'phone' : project === 'phone-landscape' ? 'phone-landscape' : project === 'small-phone' ? 'small-phone' : null;
  if (project === 'phone-landscape' || project === 'small-phone') await button.scrollIntoViewIfNeeded();
  if (prefix) await page.screenshot({ path: `${artifacts}/${prefix}-login-passkey.png` });
  if (project.includes('phone')) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  let releaseCompletion: () => void = () => {};
  const completionHold = new Promise<void>((resolve) => { releaseCompletion = resolve; });
  await page.route('**/api/v1/auth/passkeys/authentication/complete', async (route) => {
    await completionHold;
    await route.continue();
  });
  const completionRequest = page.waitForRequest('**/api/v1/auth/passkeys/authentication/complete');
  await button.focus();
  await page.keyboard.press('Enter');
  await completionRequest;
  if (project === 'desktop' || project === 'phone-portrait') await page.screenshot({ path: `${artifacts}/${prefix}-passkey-prompt.png` });
  releaseCompletion();
  await expect(page).toHaveURL(/\/app$/);
  await page.unroute('**/api/v1/auth/passkeys/authentication/complete');
  await expect.poll(async () => (await page.request.get('http://localhost:3197/api/v1/auth/me')).status()).toBe(200);
  await openUserSettings(page);
  settings = page.getByRole('region', { name: 'User Settings' });
  await settings.getByRole('navigation', { name: 'User settings sections' }).getByRole('button', { name: 'Sessions' }).click();
  await expect(settings.getByText('Chrome on Linux')).toBeVisible();
  await settings.getByRole('navigation', { name: 'User settings sections' }).getByRole('button', { name: 'Security' }).click();
  const lastUsed = settings.getByText(/Last used/);
  await expect(lastUsed).toBeVisible();
  if (project === 'desktop' || project === 'phone-portrait') await lastUsed.scrollIntoViewIfNeeded();
  if (project === 'desktop' || project === 'phone-portrait') await page.screenshot({ path: `${artifacts}/${prefix}-passkey-login-success.png` });
  await settings.getByRole('button', { name: 'Remove' }).click();
  await settings.getByLabel('Current password').last().fill('test-only-password');
  await settings.getByRole('button', { name: 'Remove passkey' }).click();
  await expect(settings.getByText('Passkey removed.')).toBeVisible();
  await context.clearCookies();
  await page.goto('http://localhost:3197/login');
  await button.click();
  await expect(page.getByRole('alert')).toContainText('Passkey sign-in could not be completed.');
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => Object.keys(localStorage).every((key) => !/auth|token|session/i.test(key)) &&
    Object.keys(sessionStorage).every((key) => !/auth|token|session/i.test(key)))).toBe(true);
});

test('cancellation and unsupported WebAuthn leave password login available', async ({ page }) => {
  let completionRequests = 0;
  page.on('request', (request) => { if (request.url().includes('/passkeys/authentication/complete')) completionRequests += 1; });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'credentials', { value: { get: async () => { throw new DOMException('Canceled', 'NotAllowedError'); } } });
  });
  await page.goto('http://localhost:3197/login');
  if (!await page.evaluate(() => typeof PublicKeyCredential === 'function')) {
    await expect(page.getByRole('button', { name: 'Sign in with passkey' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
    expect(completionRequests).toBe(0);
    expect((await page.request.get('http://localhost:3197/api/v1/auth/me')).status()).toBe(401);
    return;
  }
  await page.getByRole('button', { name: 'Sign in with passkey' }).click();
  await expect(page.getByRole('status')).toContainText('Passkey prompt closed or unavailable. Try again or use your password.');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(completionRequests).toBe(0);
  expect((await page.request.get('http://localhost:3197/api/v1/auth/me')).status()).toBe(401);
  await expect(page.getByRole('button', { name: 'Log in' })).toBeEnabled();
  await page.addInitScript(() => { Object.defineProperty(window, 'PublicKeyCredential', { value: undefined }); });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign in with passkey' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
