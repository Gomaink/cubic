import { expect, test } from '@playwright/test';
import { openUserSettings } from './navigation';

const fixture = 'http://127.0.0.1:3198';

test.beforeEach(async ({ request }) => { await request.post(`${fixture}/__test/reset`); });

test('an existing passkey confirms enrollment and removal without replacing password confirmation', async ({ page, context, request }) => {
  await request.get(`${fixture}/__test/email-verified?value=true`);
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: 'localhost', path: '/' }]);
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true
  } });
  await page.goto('http://localhost:3197/app');
  await openUserSettings(page);
  const settings = page.getByRole('region', { name: 'User Settings' });
  await settings.getByRole('navigation', { name: 'User settings sections' }).getByRole('button', { name: 'Security' }).click();
  await settings.getByRole('button', { name: 'Add passkey' }).click();
  await settings.getByLabel('Passkey name').fill('First device');
  await settings.getByLabel('Current password').last().fill('test-only-password');
  await settings.getByRole('button', { name: 'Continue' }).click();
  await expect(settings.getByText('First device')).toBeVisible();

  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'usb', hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, defaultBackupEligibility: true, defaultBackupState: true
  } });
  await settings.getByRole('button', { name: 'Add passkey' }).click();
  await settings.getByLabel('Passkey name').fill('Second device');
  await settings.getByRole('button', { name: 'Use passkey' }).click();
  await expect(settings.getByRole('button', { name: 'Confirm with passkey' })).toBeVisible();
  await settings.getByRole('button', { name: 'Confirm with passkey' }).click();
  await expect(settings.getByText('Second device')).toBeVisible();
  await expect(settings.locator('.cubic-passkey-row')).toHaveCount(2);

  const second = settings.locator('.cubic-passkey-row').filter({ hasText: 'Second device' });
  await expect(second).toContainText('Synced passkey · Backed up');
  await second.getByRole('button', { name: 'Remove' }).click();
  await expect(settings.getByRole('heading', { name: 'Remove Second device' })).toBeVisible();
  await settings.getByRole('button', { name: 'Use passkey' }).click();
  await settings.getByRole('button', { name: 'Confirm with passkey and remove' }).click();
  await expect(second).toHaveCount(0);
  await expect(settings.getByText('First device')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('canceled passkey confirmation leaves the operation available through password', async ({ page, context, request }) => {
  let completionRequests = 0;
  page.on('request', (entry) => { if (entry.url().includes('/reauthentication/complete')) completionRequests += 1; });
  await request.get(`${fixture}/__test/email-verified?value=true`);
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: 'localhost', path: '/' }]);
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true
  } });
  await page.goto('http://localhost:3197/app');
  await openUserSettings(page);
  const settings = page.getByRole('region', { name: 'User Settings' });
  await settings.getByRole('navigation', { name: 'User settings sections' }).getByRole('button', { name: 'Security' }).click();
  await settings.getByRole('button', { name: 'Add passkey' }).click();
  await settings.getByLabel('Current password').last().fill('test-only-password');
  await settings.getByRole('button', { name: 'Continue' }).click();
  await expect(settings.locator('.cubic-passkey-row')).toHaveCount(1);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'credentials', { value: { get: async () => { throw new DOMException('Canceled', 'NotAllowedError'); } } });
  });
  await settings.getByRole('button', { name: 'Add passkey' }).click();
  await settings.getByRole('button', { name: 'Use passkey' }).click();
  await settings.getByRole('button', { name: 'Confirm with passkey' }).click();
  await expect(settings.getByText('Passkey prompt closed or unavailable. Try again or use your password.')).toBeVisible();
  await expect(settings.getByRole('alert')).toHaveCount(0);
  expect(completionRequests).toBe(0);
  const withoutProof = await request.post(`${fixture}/api/v1/auth/passkeys/options`, {
    headers: { cookie: 'cubic_session=browser-fixture', origin: 'http://localhost:3197' }, data: {}
  });
  expect(withoutProof.status()).toBe(403);
  await expect(settings.locator('.cubic-passkey-row')).toHaveCount(1);
  await expect(settings.getByText(/Last used/)).toHaveCount(0);
  await settings.getByRole('button', { name: 'Use password' }).click();
  await expect(settings.getByLabel('Current password').last()).toBeFocused();
  await settings.getByRole('button', { name: 'Cancel' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
