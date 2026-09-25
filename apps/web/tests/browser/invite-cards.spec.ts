import { expect, test, type Locator, type Page } from '@playwright/test';
import { chooseServerCreate, openMessages, openServers } from './navigation';

async function createLink(page: Page) {
  await openServers(page);
  await page.getByRole('button', { name: 'Create server' }).first().click();
  const create = page.getByRole('dialog', { name: 'Create server' });
  await create.getByRole('textbox', { name: 'Server name' }).fill('Card destination');
  await create.getByRole('button', { name: 'Create server' }).click();
  await page.getByRole('button', { name: 'Options for Card destination' }).click();
  await page.getByRole('button', { name: 'Invite people' }).click();
  const invite = page.getByRole('dialog', { name: 'Invite people' });
  await invite.getByRole('button', { name: 'Create shareable link' }).click();
  const url = await invite.getByRole('textbox', { name: 'New link — shown only once' }).inputValue();
  await invite.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Close server dialog' }).click();
  return url;
}

async function send(page: Page, body: string) {
  await page.getByPlaceholder('Message…').fill(body);
  await page.getByRole('button', { name: 'Send message' }).click();
  const message = page.locator('.discord-message').last();
  await expect.poll(async () => (await message.locator('.discord-message-body').textContent())?.includes(body) === true).toBe(true);
  return message;
}

async function editMessage(message: Locator) {
  const trigger = message.getByRole('button', { name: 'Message actions' });
  if (await trigger.isVisible()) {
    await trigger.click();
    await message.getByRole('menuitem', { name: 'Edit' }).click();
  } else {
    await message.hover();
    await message.getByRole('button', { name: 'Edit message' }).click();
  }
}

test.beforeEach(async ({ page, context, request }) => {
  await request.post('http://127.0.0.1:3198/__test/reset');
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/app');
});

test('DM card preserves text, joins through existing API, rejects lookalikes, and becomes unavailable after revoke', async ({ page, browser }) => {
  test.setTimeout(60_000);
  const url = await createLink(page);
  await openMessages(page);
  await page.locator('.conversation-row').filter({ hasText: 'Fixture DM' }).click();
  let previews = 0;
  page.on('request', (request) => { if (request.url().endsWith('/api/v1/server-invite-links/preview')) previews += 1; });
  const body = `Join us ${url} and see https://example.com`;
  const ownerMessage = await send(page, body);
  const messageId = await ownerMessage.getAttribute('id');
  expect(messageId).toBeTruthy();
  await expect(ownerMessage.getByRole('group', { name: 'Server invite' })).toBeVisible();
  await expect(ownerMessage.getByRole('button', { name: 'Go to server' })).toBeVisible();
  expect(previews).toBe(1);
  await send(page, `https://127.0.0.1.evil.example/invite#${url.split('#')[1]}`);
  await expect(page.locator('.discord-message').last().getByRole('group', { name: 'Server invite' })).toHaveCount(0);
  expect(previews).toBe(1);

  const peerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3197' });
  try {
    await peerContext.addCookies([{ name: 'cubic_session', value: 'browser-peer', domain: '127.0.0.1', path: '/' }]);
    const peer = await peerContext.newPage();
    await peer.goto('/app');
    await peer.locator('.conversation-row').filter({ hasText: 'Tester' }).click();
    const card = peer.locator(`#${messageId}`).getByRole('group', { name: 'Server invite' });
    await card.scrollIntoViewIfNeeded();
    await expect(card).toContainText('Card destination');
    await card.getByRole('button', { name: 'Join server' }).click();
    await expect(card.getByRole('button', { name: 'Go to server' })).toBeVisible();
    await card.getByRole('button', { name: 'Go to server' }).click();
    await expect(peer.locator('.cubic-server-sidebar-head')).toContainText('Card destination');

    await openServers(page);
    await page.locator('.cubic-server-row').filter({ hasText: 'Card destination' }).click();
    await page.getByRole('button', { name: 'Options for Card destination' }).click();
    await page.getByRole('button', { name: 'Invite people' }).click();
    await page.getByRole('dialog', { name: 'Invite people' }).getByRole('button', { name: /Revoke link created/ }).click();
    await openMessages(peer);
    await peer.locator('.conversation-row').filter({ hasText: 'Tester' }).click();
    const staleCard = peer.locator(`#${messageId}`).getByRole('group', { name: 'Server invite' });
    await staleCard.scrollIntoViewIfNeeded();
    await staleCard.getByRole('button', { name: 'Refresh invitation' }).click();
    await expect(staleCard).toContainText('Invite unavailable.');
  } finally { await peerContext.close(); }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('group gets only the first trusted card; server text remains plain and mobile composer stays reachable', async ({ page }) => {
  const url = await createLink(page);
  await openMessages(page);
  await page.locator('.conversation-row').filter({ hasText: 'Fixture group' }).click();
  const body = `First ${url} second ${url} ordinary https://example.com`;
  const groupMessage = await send(page, body);
  await expect(groupMessage.getByRole('group', { name: 'Server invite' })).toHaveCount(1);
  await expect(groupMessage.getByRole('button', { name: 'Go to server' })).toBeVisible();
  await editMessage(groupMessage);
  await page.getByPlaceholder('Message…').fill('No invite after edit');
  await page.getByRole('button', { name: 'Save message' }).click();
  await expect(groupMessage.getByRole('group', { name: 'Server invite' })).toHaveCount(0);
  await expect(groupMessage.locator('.discord-message-body')).toContainText('No invite after edit');
  await openServers(page);
  await page.locator('.cubic-server-row').filter({ hasText: 'Card destination' }).click();
  await chooseServerCreate(page, 'Create text channel');
  const channelDialog = page.getByRole('dialog', { name: 'Create text channel' });
  await channelDialog.getByRole('textbox', { name: 'Channel name' }).fill('general');
  await channelDialog.getByRole('button', { name: 'Create text channel' }).click();
  const channelMessage = await send(page, url);
  await expect(channelMessage.getByRole('group', { name: 'Server invite' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
});
