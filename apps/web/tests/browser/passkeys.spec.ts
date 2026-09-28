import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { openUserSettings } from './navigation';

const fixture = 'http://127.0.0.1:3198';
const artifacts = '/tmp/cubic-alpha11-slice7-4-1';

test.beforeEach(async ({ request }) => { await request.post(`${fixture}/__test/reset`); });

test('verified account enrolls and removes a passkey with current-password confirmation', async ({ page, context, request }, testInfo) => {
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
  const settings = page.getByRole('region', { name: 'User Settings' });
  await settings.getByRole('navigation', { name: 'User settings sections' }).getByRole('button', { name: 'Security' }).click();
  await expect(settings.getByRole('heading', { name: 'Passkeys' })).toBeVisible();
  const project = testInfo.project.name;
  const screen = project === 'desktop' ? 'desktop' : project === 'phone-portrait' ? 'phone' : null;
  if (screen) await page.screenshot({ path: `${artifacts}/${screen}-security-passkeys.png` });
  if (project === 'phone-landscape' || project === 'small-phone') await page.screenshot({ path: `${artifacts}/${project}-passkeys.png` });
  const add = settings.getByRole('button', { name: 'Add passkey' });
  await expect(add).toBeVisible();
  await add.focus();
  await page.keyboard.press('Enter');
  await expect(settings.getByRole('heading', { name: 'Add passkey' })).toBeVisible();
  if (screen) await page.screenshot({ path: `${artifacts}/${screen}-add-passkey.png` });
  const password = settings.getByLabel('Current password').last();
  await settings.getByLabel('Passkey name').fill('Test device');
  await password.fill('wrong-test-password');
  await settings.getByRole('button', { name: 'Continue' }).click();
  await expect(settings.getByRole('alert')).toContainText('Current password is incorrect.');
  await password.fill('test-only-password');
  await settings.getByRole('button', { name: 'Continue' }).click();
  await expect(settings.getByText('Passkey added.')).toBeVisible();
  await expect(settings.getByText('Test device')).toBeVisible();
  await expect(settings.getByText('No passkeys added yet.')).toHaveCount(0);
  if (screen) await page.screenshot({ path: `${artifacts}/${screen}-passkey-added.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (project.includes('phone')) expect((await add.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const row = settings.locator('.cubic-passkey-row');
  await expect(row).toContainText('Device-bound passkey');
  await row.getByRole('button', { name: 'Rename' }).click();
  await expect(settings.getByRole('heading', { name: 'Rename Test device' })).toBeVisible();
  const nameInput = settings.getByLabel('Passkey name');
  await expect(nameInput).toBeFocused();
  await nameInput.fill('Canceled name');
  await page.keyboard.press('Escape');
  await expect(settings.getByRole('heading', { name: 'Rename Test device' })).toHaveCount(0);
  await expect(row).toContainText('Test device');
  await row.getByRole('button', { name: 'Rename' }).click();
  await settings.getByLabel('Passkey name').fill('  My laptop  ');
  await settings.getByRole('button', { name: 'Save name' }).click();
  await expect(settings.getByText('Passkey renamed.')).toBeVisible();
  await expect(row).toContainText('My laptop');
  await expect(row).not.toContainText('Test device');
  await expect(row.getByRole('button', { name: 'Rename' })).toBeFocused();
  await page.route('**/api/v1/auth/passkeys/*', async (route) => {
    if (route.request().method() === 'PATCH') await route.fulfill({ status: 503, json: { error: 'Temporary failure.' } });
    else await route.continue();
  });
  await row.getByRole('button', { name: 'Rename' }).click();
  await settings.getByLabel('Passkey name').fill('Unsaved name');
  await settings.getByRole('button', { name: 'Save name' }).click();
  await expect(settings.getByRole('alert')).toContainText('Could not rename the passkey. Try again.');
  await expect(row).toContainText('My laptop');
  await settings.getByRole('button', { name: 'Cancel' }).click();
  await page.unroute('**/api/v1/auth/passkeys/*');
  await expect(row.getByRole('button', { name: 'Rename' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (project.includes('phone')) expect((await row.getByRole('button', { name: 'Rename' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await row.getByRole('button', { name: 'Remove' }).click();
  await expect(settings.getByRole('heading', { name: 'Remove My laptop' })).toBeVisible();
  if (screen) await page.screenshot({ path: `${artifacts}/${screen}-remove-passkey.png` });
  const removePassword = settings.getByLabel('Current password').last();
  await removePassword.fill('wrong-test-password');
  await settings.getByRole('button', { name: 'Remove passkey' }).click();
  await expect(settings.getByRole('alert')).toContainText('Current password is incorrect.');
  await removePassword.fill('test-only-password');
  await settings.getByRole('button', { name: 'Remove passkey' }).click();
  await expect(settings.getByText('Passkey removed.')).toBeVisible();
  await expect(row).toHaveCount(0);
  await expect(settings.getByRole('button', { name: 'Add passkey' })).toBeFocused();
  await settings.getByRole('button', { name: 'Close User Settings' }).click();
});

test('unverified email and unsupported browser offer no enrollment action', async ({ page, context, request }) => {
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: 'localhost', path: '/' }]);
  await page.goto('http://localhost:3197/app');
  await openUserSettings(page);
  let settings = page.getByRole('region', { name: 'User Settings' });
  await settings.getByRole('navigation', { name: 'User settings sections' }).getByRole('button', { name: 'Security' }).click();
  await expect(settings.getByText('Verify your current email before adding a passkey.')).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Add passkey' })).toHaveCount(0);
  await request.get(`${fixture}/__test/email-verified?value=true`);
  await page.addInitScript(() => { Object.defineProperty(window, 'PublicKeyCredential', { value: undefined }); });
  await page.reload();
  await openUserSettings(page);
  settings = page.getByRole('region', { name: 'User Settings' });
  await settings.getByRole('navigation', { name: 'User settings sections' }).getByRole('button', { name: 'Security' }).click();
  await expect(settings.getByText('This browser does not support passkey enrollment.')).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Add passkey' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('browser cancellation is a normal passkey setup outcome', async ({ page, context, request }) => {
  await request.get(`${fixture}/__test/email-verified?value=true`);
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: 'localhost', path: '/' }]);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'credentials', { value: { create: async () => { throw new DOMException('Canceled', 'NotAllowedError'); } } });
  });
  await page.goto('http://localhost:3197/app');
  await openUserSettings(page);
  const settings = page.getByRole('region', { name: 'User Settings' });
  await settings.getByRole('navigation', { name: 'User settings sections' }).getByRole('button', { name: 'Security' }).click();
  await settings.getByRole('button', { name: 'Add passkey' }).click();
  await settings.getByLabel('Current password').last().fill('test-only-password');
  await settings.getByRole('button', { name: 'Continue' }).click();
  await expect(settings.getByRole('status')).toContainText('Passkey setup canceled.');
  await expect(settings.getByRole('alert')).toHaveCount(0);
  await expect(settings.getByText('No passkeys added yet.')).toBeVisible();
});
