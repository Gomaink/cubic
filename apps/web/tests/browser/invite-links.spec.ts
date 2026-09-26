import { expect, test } from '@playwright/test';
import { closeServerSettings, openServerSettingsSection, openServers } from './navigation';

async function createShareLink(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Create server' }).first().click();
  const createServer = page.getByRole('dialog', { name: 'Create server' });
  await createServer.getByRole('textbox', { name: 'Server name' }).fill('Shareable home');
  await createServer.getByRole('button', { name: 'Create server' }).click();
  await openServerSettingsSection(page, 'Invites');
  const invite = page.getByRole('region', { name: 'Shareable home server settings' });
  await expect(invite.getByRole('heading', { name: 'Invites' })).toBeVisible();
  await invite.getByRole('button', { name: 'Create shareable link' }).click();
  const link = await invite.getByRole('textbox', { name: 'New link — shown only once' }).inputValue();
  expect(/^http:\/\/127\.0\.0\.1:3197\/invite#[A-Za-z0-9_-]{43}$/.test(link)).toBe(true);
  return { invite, link };
}

test.beforeEach(async ({ page, context, request }) => {
  await request.post('http://127.0.0.1:3198/__test/reset');
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/app');
  await openServers(page);
});

test('owner displays a bearer once, manages metadata, and revoke makes the link unavailable', async ({ page, browser }) => {
  const { invite, link } = await createShareLink(page);
  await invite.getByRole('button', { name: 'Copy link' }).click();
  await expect(invite.getByRole('status')).toContainText(/copied|copy it manually/i);
  await invite.getByRole('button', { name: 'Done' }).click();
  await expect(invite.getByRole('textbox', { name: 'New link — shown only once' })).toHaveCount(0);
  await expect(invite.getByRole('heading', { name: 'Existing links' })).toBeVisible();
  await expect(invite.getByRole('button', { name: 'Copy link' })).toHaveCount(0);
  await invite.getByRole('button', { name: /Revoke link created/ }).click();
  await expect(invite).toContainText('Revoked');
  const guest = await browser.newContext({ baseURL: 'http://127.0.0.1:3197' });
  try {
    const pageGuest = await guest.newPage();
    await pageGuest.goto(link);
    await expect(pageGuest).toHaveURL('/invite');
    await expect(pageGuest.getByText('Invite unavailable.')).toBeVisible();
  } finally { await guest.close(); }
});

test('guest preview strips fragment, login continues in tab, join and remove/rejoin use normal membership', async ({ page, browser }) => {
  const { invite, link } = await createShareLink(page);
  await invite.getByRole('button', { name: 'Done' }).click();
  await closeServerSettings(page);
  const guest = await browser.newContext({ baseURL: 'http://127.0.0.1:3197' });
  try {
    const recipient = await guest.newPage();
    await recipient.goto(link);
    await expect(recipient).toHaveURL('/invite');
    await expect(recipient.getByText("You've been invited to")).toContainText('Shareable home');
    await recipient.getByRole('link', { name: 'Log in' }).click();
    await expect(recipient).toHaveURL('/login?returnTo=invite');
    await recipient.getByRole('textbox', { name: 'E-mail or username' }).fill('peer');
    await recipient.getByLabel('Password').fill('test-only-password');
    await recipient.getByRole('button', { name: 'Log in' }).click();
    await expect(recipient).toHaveURL('/invite');
    await recipient.getByRole('button', { name: 'Join server' }).click();
    await expect(recipient).toHaveURL('/app');
    await expect(recipient.locator('.cubic-server-sidebar-head')).toContainText('Shareable home');

    await openServerSettingsSection(page, 'Members');
    await page.getByRole('region', { name: 'Shareable home server settings' }).getByRole('button', { name: 'Refresh' }).click();
    await page.getByRole('button', { name: /Remove Fixture DM from server/ }).click();
    await page.getByRole('dialog', { name: 'Remove server member' }).getByRole('button', { name: 'Remove from server' }).click();
    await recipient.reload();
    await expect(recipient.locator('.cubic-server-sidebar-head')).toHaveCount(0);
    await recipient.goto(link);
    await recipient.getByRole('button', { name: 'Join server' }).click();
    await expect(recipient.locator('.cubic-server-sidebar-head')).toContainText('Shareable home');
    expect(await recipient.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await guest.close(); }
});

test('registration continuation reaches the same invite without token in auth URL', async ({ page, browser }) => {
  const { invite, link } = await createShareLink(page);
  await invite.getByRole('button', { name: 'Done' }).click();
  const guest = await browser.newContext({ baseURL: 'http://127.0.0.1:3197' });
  try {
    const recipient = await guest.newPage();
    await recipient.goto(link);
    await recipient.getByRole('link', { name: 'Create account' }).click();
    await expect(recipient).toHaveURL('/register?returnTo=invite');
    await recipient.getByLabel('Display name').fill('New person');
    await recipient.getByLabel('Username').fill('newperson');
    await recipient.getByLabel('E-mail').fill('newperson@proof.invalid');
    await recipient.getByLabel('Password').fill('test-only-password');
    await recipient.getByRole('button', { name: 'Create account' }).click();
    await expect(recipient).toHaveURL('/invite');
    await expect(recipient.getByRole('button', { name: 'Join server' })).toBeVisible();
    expect(await recipient.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await guest.close(); }
});

test('auth continuation ignores an untrusted return destination', async ({ browser }) => {
  const guest = await browser.newContext({ baseURL: 'http://127.0.0.1:3197' });
  try {
    const page = await guest.newPage();
    await page.goto('/login?returnTo=https://attacker.invalid/path');
    await page.getByRole('textbox', { name: 'E-mail or username' }).fill('peer');
    await page.getByLabel('Password').fill('test-only-password');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL('/app');
  } finally { await guest.close(); }
});
