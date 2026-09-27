import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { openUserSettings } from './navigation';

const fixture = 'http://127.0.0.1:3198';
const artifacts = '/tmp/cubic-alpha11-slice7-2';

test.beforeEach(async ({ page, context, request }) => {
  await request.post(`${fixture}/__test/reset`);
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/app');
});

test('private email verification and change complete through a cleaned fragment across viewports', async ({ page, request }, testInfo) => {
  await mkdir(artifacts, { recursive: true });
  await openUserSettings(page);
  const settings = page.getByRole('region', { name: 'User Settings' });
  await settings.getByRole('navigation', { name: 'User settings sections' }).getByRole('button', { name: 'Profile' }).click();
  await expect(settings.getByText('tester@example.test')).toHaveCount(0);
  const securityNav = settings.getByRole('navigation', { name: 'User settings sections' }).getByRole('button', { name: 'Security' });
  await securityNav.focus();
  await page.keyboard.press('Enter');
  await expect(settings.getByText('tester@example.test')).toBeVisible();
  await expect(settings.getByText('Unverified')).toBeVisible();
  await settings.getByRole('heading', { name: 'Email' }).scrollIntoViewIfNeeded();
  const project = testInfo.project.name;
  await page.screenshot({ path: `${artifacts}/${project}-security-email.png` });
  if (project === 'desktop') await page.screenshot({ path: `${artifacts}/desktop-email-unverified.png` });
  if (project === 'phone-portrait') expect(await settings.getByRole('button', { name: 'Send verification email' }).evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await settings.getByRole('button', { name: 'Send verification email' }).click();
  await expect(settings.getByRole('status')).toContainText('Verification email sent.');
  const messages = (await (await request.get(`${fixture}/__test/mail`)).json()).messages;
  expect(messages.at(-1).to).toBe('tester@example.test');
  await page.goto(messages.at(-1).url);
  await expect(page.getByRole('heading', { name: 'Email verified.' })).toBeVisible();
  expect(page.url()).not.toContain('#');
  const browserStorage = await page.evaluate(() => ({
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
  }));
  expect(browserStorage.local).toEqual([]);
  expect(browserStorage.session.map(([key]) => key).sort()).toEqual([
    'sveltekit:scroll',
    'sveltekit:snapshot',
  ]);
  expect(JSON.stringify(browserStorage)).not.toContain('token=');
  await page.goto('/app');
  await openUserSettings(page);
  const refreshed = page.getByRole('region', { name: 'User Settings' });
  await refreshed.getByRole('navigation', { name: 'User settings sections' }).getByRole('button', { name: 'Security' }).click();
  await expect(refreshed.getByText('Verified', { exact: true })).toBeVisible();
  await expect(refreshed.getByRole('button', { name: 'Send verification email' })).toHaveCount(0);
  if (project === 'desktop' || project === 'phone-portrait') await page.screenshot({ path: `${artifacts}/${project === 'desktop' ? 'desktop' : 'phone'}-email-verified.png` });
  await refreshed.getByRole('button', { name: 'Change email' }).click();
  await expect(refreshed.getByText('Completing the change signs you out everywhere.')).toBeVisible();
  await refreshed.getByLabel('New email').scrollIntoViewIfNeeded();
  if (project === 'desktop' || project === 'phone-portrait') await page.screenshot({ path: `${artifacts}/${project === 'desktop' ? 'desktop' : 'phone'}-email-change.png` });
  const newEmail = refreshed.getByLabel('New email');
  const currentPassword = refreshed.getByLabel('Current password').last();
  await newEmail.fill('changed@example.test');
  await currentPassword.fill('wrong-test-password');
  await refreshed.getByRole('button', { name: 'Send change verification' }).click();
  await expect(refreshed.getByRole('alert')).toContainText('Current password is incorrect.');
  await currentPassword.fill('test-only-password');
  await newEmail.fill('occupied@example.test');
  await refreshed.getByRole('button', { name: 'Send change verification' }).click();
  await expect(refreshed.getByRole('alert')).toContainText('unavailable');
  await newEmail.fill('CHANGED@EXAMPLE.TEST');
  await refreshed.getByRole('button', { name: 'Send change verification' }).click();
  await expect(refreshed.getByRole('status')).toContainText('current email remains unchanged');
  await expect(refreshed.getByText('tester@example.test')).toBeVisible();
  const changeMessages = (await (await request.get(`${fixture}/__test/mail`)).json()).messages;
  expect(changeMessages.at(-1).to).toBe('changed@example.test');
  await page.goto(changeMessages.at(-1).url);
  await expect(page.getByRole('heading', { name: 'Email changed.' })).toBeVisible();
  await expect(page.getByText('All sessions were signed out.')).toBeVisible();
  expect(page.url()).not.toContain('#');
  const oldLogin = await request.post('/api/v1/auth/login', { data: { identifier: 'tester@example.test', password: 'test-only-password' } });
  expect(oldLogin.status()).toBe(401);
  const newLogin = await request.post('/api/v1/auth/login', { data: { identifier: 'changed@example.test', password: 'test-only-password' } });
  expect(newLogin.status()).toBe(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('disabled delivery shows private email without working-looking send actions', async ({ page, request }, testInfo) => {
  await request.get(`${fixture}/__test/mail-mode?value=disabled`);
  await openUserSettings(page);
  const settings = page.getByRole('region', { name: 'User Settings' });
  await settings.getByRole('navigation', { name: 'User settings sections' }).getByRole('button', { name: 'Security' }).click();
  await expect(settings.getByText('tester@example.test')).toBeVisible();
  await expect(settings.getByText('Email delivery is not configured on this Cubic instance.')).toBeVisible();
  await settings.getByRole('heading', { name: 'Email' }).scrollIntoViewIfNeeded();
  await expect(settings.getByRole('button', { name: 'Send verification email' })).toHaveCount(0);
  await expect(settings.getByRole('button', { name: 'Change email' })).toHaveCount(0);
  if (testInfo.project.name === 'desktop') await page.screenshot({ path: `${artifacts}/desktop-mail-disabled.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
