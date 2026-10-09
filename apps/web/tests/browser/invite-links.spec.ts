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
  await invite.getByRole('button', { name: 'Create invite link' }).click();
  const link = await invite.getByRole('textbox', { name: 'Invite link' }).inputValue();
  expect(/^http:\/\/127\.0\.0\.1:3197\/invite#v2\.fixture\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(link)).toBe(true);
  return { invite, link };
}

test.beforeEach(async ({ page, context, request }) => {
  await request.post('http://127.0.0.1:3198/__test/reset');
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/app');
  await openServers(page);
});

test('owner can copy after reload, edit, pause, resume and revoke a link', async ({ page, browser }) => {
  const { invite, link } = await createShareLink(page);
  await invite.getByRole('button', { name: 'Copy link' }).first().click();
  await expect(invite.getByRole('status')).toContainText(/copied|copy it manually/i);
  await invite.getByRole('button', { name: 'Done' }).click();
  await expect(invite.getByRole('textbox', { name: 'Invite link' })).toHaveCount(0);
  await expect(invite.getByRole('heading', { name: 'Manage invite links' })).toBeVisible();
  await expect(invite.locator('.cubic-share-link-row')).toContainText('Active');
  await page.reload();
  await openServers(page);
  await page.locator('.cubic-server-row').filter({ hasText: 'Shareable home' }).click();
  await openServerSettingsSection(page, 'Invites');
  await invite.getByRole('button', { name: 'Copy link' }).click();
  await expect(invite.getByRole('textbox', { name: 'Invite link' })).toHaveValue(link);
  await invite.getByRole('button', { name: 'Done' }).click();
  const expirationBefore = await page.evaluate(async () => {
    const server = (await (await fetch('/api/v1/servers')).json()).servers[0];
    return (await (await fetch(`/api/v1/servers/${server.id}/invite-links`)).json()).inviteLinks[0].expiresAt as string;
  });
  await invite.getByRole('button', { name: 'Edit' }).click();
  await invite.getByLabel('Maximum uses').last().selectOption('1');
  await invite.getByRole('button', { name: 'Save link settings' }).click();
  await expect(invite.locator('.cubic-share-link-row')).toContainText('0 / 1 uses');
  const expirationAfter = await page.evaluate(async () => {
    const server = (await (await fetch('/api/v1/servers')).json()).servers[0];
    return (await (await fetch(`/api/v1/servers/${server.id}/invite-links`)).json()).inviteLinks[0].expiresAt as string;
  });
  expect(expirationAfter).toBe(expirationBefore);
  await invite.getByRole('button', { name: 'Edit' }).click();
  await invite.getByLabel('Expiration').last().selectOption('1d');
  await invite.getByRole('button', { name: 'Save link settings' }).click();
  const shortenedExpiration = await page.evaluate(async () => {
    const server = (await (await fetch('/api/v1/servers')).json()).servers[0];
    return (await (await fetch(`/api/v1/servers/${server.id}/invite-links`)).json()).inviteLinks[0].expiresAt as string;
  });
  expect(Date.parse(shortenedExpiration)).toBeLessThan(Date.parse(expirationBefore));
  page.once('dialog', (dialog) => dialog.accept());
  await invite.getByRole('button', { name: 'Pause invites' }).click();
  await expect(invite.locator('.cubic-share-link-row')).toContainText('Paused');
  await invite.getByRole('button', { name: 'Resume invites' }).click();
  await expect(invite.locator('.cubic-share-link-row')).toContainText('Active');
  await invite.getByRole('button', { name: /Revoke link created/ }).click();
  await expect(invite.locator('.cubic-share-link-inactive')).toContainText('Revoked');
  await expect(invite.getByRole('button', { name: /Revoke link created/ })).toHaveCount(0);
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

test('legacy link gains a copyable v2 credential while its original token remains valid', async ({ page, request, browser }) => {
  const { invite } = await createShareLink(page);
  const serverId = await page.evaluate(async () => (await (await fetch('/api/v1/servers')).json()).servers[0].id as string);
  const seeded = await request.post(`http://127.0.0.1:3198/__test/legacy-server-link?serverId=${serverId}`);
  const { originalToken } = await seeded.json() as { originalToken: string };
  await invite.getByRole('button', { name: 'Done' }).click();
  await page.reload();
  await openServers(page);
  await page.locator('.cubic-server-row').filter({ hasText: 'Shareable home' }).click();
  await openServerSettingsSection(page, 'Invites');
  await invite.locator('.cubic-share-link-row').first().getByRole('button', { name: 'Copy link' }).click();
  await expect(invite.getByRole('textbox', { name: 'Invite link' })).toHaveValue(/\/invite#v2\.fixture\./);
  const guest = await browser.newContext({ baseURL: 'http://127.0.0.1:3197' });
  try {
    const recipient = await guest.newPage();
    await recipient.goto(`/invite#${originalToken}`);
    await expect(recipient.getByText("You've been invited to")).toContainText('Shareable home');
  } finally { await guest.close(); }
});

test('member with MANAGE_INVITES sees management while ordinary member does not', async ({ page, request, browser }) => {
  await createShareLink(page);
  const serverId = await page.evaluate(async () => (await (await fetch('/api/v1/servers')).json()).servers[0].id as string);
  await request.post(`http://127.0.0.1:3198/__test/server-member?serverId=${serverId}`);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3197' });
  try {
    await context.addCookies([{ name: 'cubic_session', value: 'browser-peer', domain: '127.0.0.1', path: '/' }]);
    const member = await context.newPage();
    await member.goto('/app');
    await openServers(member);
    await member.locator('.cubic-server-row').filter({ hasText: 'Shareable home' }).click();
    await openServerSettingsSection(member, 'Overview');
    const settings = member.getByRole('region', { name: 'Shareable home server settings' });
    await expect(settings.getByRole('button', { name: 'Invites' })).toHaveCount(0);
    await request.post(`http://127.0.0.1:3198/__test/manage-invites-role?serverId=${serverId}`);
    await member.reload();
    await openServers(member);
    await member.locator('.cubic-server-row').filter({ hasText: 'Shareable home' }).click();
    await openServerSettingsSection(member, 'Invites');
    await expect(settings.getByRole('button', { name: 'Create invite link' })).toBeVisible();
    await settings.locator('.cubic-share-link-row').getByRole('button', { name: 'Copy link' }).click();
    await expect(settings.getByRole('textbox', { name: 'Invite link' })).toHaveValue(/\/invite#v2\.fixture\./);
  } finally { await context.close(); }
});

test('exhausted and expired links become unavailable, while history pages remain visible', async ({ page, request, browser }) => {
  const { invite, link } = await createShareLink(page);
  await invite.getByRole('button', { name: 'Done' }).click();
  await invite.getByRole('button', { name: 'Edit' }).click();
  await invite.getByLabel('Maximum uses').last().selectOption('1');
  await invite.getByRole('button', { name: 'Save link settings' }).click();
  const recipientContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3197' });
  try {
    await recipientContext.addCookies([{ name: 'cubic_session', value: 'browser-peer', domain: '127.0.0.1', path: '/' }]);
    const recipient = await recipientContext.newPage();
    await recipient.goto(link);
    await recipient.getByRole('button', { name: 'Join server' }).click();
    await expect(recipient).toHaveURL('/app');
  } finally { await recipientContext.close(); }
  await invite.getByRole('navigation', { name: 'Server settings sections' }).getByRole('button', { name: 'Invites' }).click();
  await expect(invite.locator('.cubic-share-link-row')).toContainText('Exhausted');
  await expect(invite.locator('.cubic-share-link-row')).toContainText('1 / 1 uses');
  const guest = await browser.newContext({ baseURL: 'http://127.0.0.1:3197' });
  try {
    const preview = await guest.newPage();
    await preview.goto(link);
    await expect(preview.getByText('Invite unavailable.')).toBeVisible();
  } finally { await guest.close(); }
  const serverId = await page.evaluate(async () => (await (await fetch('/api/v1/servers')).json()).servers[0].id as string);
  const current = await page.evaluate(async (id) => (await (await fetch(`/api/v1/servers/${id}/invite-links`)).json()).inviteLinks[0].id as string, serverId);
  await request.post(`http://127.0.0.1:3198/__test/expire-server-link?linkId=${current}`);
  await request.post(`http://127.0.0.1:3198/__test/invite-history?serverId=${serverId}`);
  await invite.getByRole('navigation', { name: 'Server settings sections' }).getByRole('button', { name: 'Invites' }).click();
  await expect(invite.locator('.cubic-share-link-row')).toHaveCount(20);
  await invite.getByRole('button', { name: 'Next' }).click();
  await expect(invite.locator('.cubic-share-link-row')).toHaveCount(3);
  await expect(invite.locator('.cubic-share-link-row').last()).toContainText('Expired');
});
