import { test, expect, type Locator, type Page } from '@playwright/test';

const fixture = 'http://127.0.0.1:3198';

async function openConversation(page: Page) {
  await page.locator('.conversation-row').filter({ hasText: 'Fixture DM' }).click();
  await expect(page.locator('.discord-message')).toHaveCount(50);
}

async function chooseAction(message: Locator, accessibleName: string, menuName: string) {
  const trigger = message.getByRole('button', { name: 'Message actions' });
  if (await trigger.isVisible()) {
    await trigger.click();
    await message.getByRole('menuitem', { name: menuName }).click();
    return;
  }

  await message.hover();
  await message.getByRole('button', { name: accessibleName }).click();
}

test.beforeEach(async ({ page, context, request }) => {
  await request.post(`${fixture}/__test/reset`);
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/app');
  await openConversation(page);
});

test('reply banner cancels, sends, renders a preview, and scrolls to its loaded target', async ({ page }) => {
  const target = page.locator('#message-message-79');
  await expect(target).toContainText('History message 79');

  await chooseAction(target, 'Reply to message', 'Reply');
  const banner = page.locator('.cubic-message-composer-banner');
  await expect(banner).toContainText('Replying to Fixture DM');
  await expect(banner).toContainText('History message 79');
  await expect(page.locator('.composer input:not([type=file])')).toBeFocused();
  await page.getByRole('button', { name: 'Cancel reply' }).click();
  await expect(banner).toHaveCount(0);

  await chooseAction(target, 'Reply to message', 'Reply');
  await page.locator('.composer input:not([type=file])').fill('Reply body');
  await page.getByRole('button', { name: 'Send message' }).click();

  const sent = page.locator('.discord-message').last();
  await expect(sent).toContainText('Reply body');
  await expect(sent.locator('.cubic-message-reply-preview')).toContainText('Fixture DM');
  await expect(sent.locator('.cubic-message-reply-preview')).toContainText('History message 79');
  await sent.locator('.cubic-message-reply-preview').click();
  await expect(target).toHaveClass(/cubic-message-highlight/);
  await page.reload();
  await openConversation(page);
  await expect(page.locator('.discord-message').last().locator('.cubic-message-reply-preview')).toContainText('History message 79');
});

test('own message edit cancel/save and delete confirmation update the existing row', async ({ page }) => {
  const input = page.locator('.composer input:not([type=file])');
  await input.fill('Message to change');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.discord-message')).toHaveCount(51);

  const ownId = await page.locator('.discord-message').last().getAttribute('id');
  const own = page.locator(`#${ownId}`);
  await chooseAction(own, 'Edit message', 'Edit');
  await expect(page.locator('.cubic-message-composer-banner')).toContainText('Editing message');
  await expect(input).toHaveValue('Message to change');
  await input.fill('Discard this edit');
  await page.getByRole('button', { name: 'Cancel editing' }).click();
  await expect(own).toContainText('Message to change');

  await chooseAction(own, 'Edit message', 'Edit');
  await input.fill('Edited in place');
  await page.getByRole('button', { name: 'Save message' }).click();
  await expect(page.locator('.discord-message')).toHaveCount(51);
  await expect(own).toContainText('Edited in place');
  await expect(own.locator('.cubic-message-edited')).toHaveText('(edited)');

  await chooseAction(own, 'Reply to message', 'Reply');
  await input.fill('Reply that survives deletion');
  await page.getByRole('button', { name: 'Send message' }).click();
  const child = page.locator('.discord-message').last();
  await expect(child.locator('.cubic-message-reply-preview')).toContainText('Edited in place');

  await chooseAction(own, 'Delete message', 'Delete');
  const dialog = page.getByRole('dialog', { name: 'Delete message?' });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await chooseAction(own, 'Delete message', 'Delete');
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.discord-message')).toHaveCount(52);
  await expect(own.locator('.discord-message-body')).toHaveText('Message deleted');
  await expect(child.locator('.cubic-message-reply-preview')).toContainText('Message deleted');
  await expect(own.getByRole('button', { name: 'Message actions' })).toHaveCount(0);
});

test('touch layouts expose one keyboard-operable action menu without regressing media', async ({ page }) => {
  const message = page.locator('.discord-message').last();
  const trigger = message.getByRole('button', { name: 'Message actions' });

  if (await trigger.isVisible()) {
    await trigger.click();
    await expect(message.getByRole('menu')).toBeVisible();
    await expect(message.getByRole('menuitem', { name: 'Reply' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(message.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  } else {
    await message.hover();
    await expect(message.getByRole('button', { name: 'Reply to message' })).toBeVisible();
  }

  await expect(page.locator('.cubic-media-gallery')).not.toHaveCount(0);
  await expect(page.locator('.cubic-media-video[controls][playsinline]')).not.toHaveCount(0);
  expect(await page.locator('.messages').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
});
