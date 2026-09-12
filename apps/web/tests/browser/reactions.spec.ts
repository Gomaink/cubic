import { test, expect, type Locator, type Page } from '@playwright/test';

const fixture = 'http://127.0.0.1:3198';

async function openConversation(page: Page) {
  await page.locator('.conversation-row').filter({ hasText: 'Fixture DM' }).click();
  await expect(page.locator('.discord-message')).toHaveCount(50);
}

async function chooseMessageAction(message: Locator, accessibleName: string, menuName: string) {
  const trigger = message.getByRole('button', { name: 'Message actions' });
  if (await trigger.isVisible()) {
    await trigger.click();
    await message.getByRole('menuitem', { name: menuName }).click();
    return;
  }
  await message.hover();
  await message.getByRole('button', { name: accessibleName }).click();
}

async function openReactionPicker(message: Locator) {
  await chooseMessageAction(message, 'Add reaction', 'React');
  await expect(message.getByRole('menu', { name: 'Choose a reaction' })).toBeVisible();
}

test.beforeEach(async ({ page, context, request }) => {
  await request.post(`${fixture}/__test/reset`);
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/app');
  await openConversation(page);
});

test('adds, persists, receives, and removes compact reactions', async ({ page, request }) => {
  const target = page.locator('#message-message-79');
  await openReactionPicker(target);
  await target.getByRole('menuitemcheckbox', { name: 'React with Heart' }).click();

  const heart = target.getByRole('button', { name: /Heart, 1 reaction, selected/ });
  await expect(heart).toHaveAttribute('aria-pressed', 'true');

  await request.post(`${fixture}/__test/reaction?messageId=message-79`);
  await expect(target.getByRole('button', { name: /Laughing, 1 reaction/ })).toHaveAttribute('aria-pressed', 'false');

  await page.reload();
  await openConversation(page);
  await expect(page.locator('#message-message-79').getByRole('button', { name: /Heart, 1 reaction, selected/ })).toBeVisible();
  await expect(page.locator('#message-message-79').getByRole('button', { name: /Laughing, 1 reaction/ })).toBeVisible();

  await page.locator('#message-message-79').getByRole('button', { name: /Heart, 1 reaction, selected/ }).click();
  await expect(page.locator('#message-message-79').getByRole('button', { name: /Heart/ })).toHaveCount(0);
  await expect(page.locator('#message-message-79').getByRole('button', { name: /Laughing, 1 reaction/ })).toBeVisible();
});

test('reaction picker is keyboard and touch accessible across attachment, reply, and edited messages', async ({ page }) => {
  const attachmentMessage = page.locator('#message-message-70');
  await openReactionPicker(attachmentMessage);
  await expect(attachmentMessage.getByRole('menuitemcheckbox', { name: 'React with Heart' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(attachmentMessage.getByRole('menu', { name: 'Choose a reaction' })).toHaveCount(0);
  await openReactionPicker(attachmentMessage);
  const heartChoice = attachmentMessage.getByRole('menuitemcheckbox', { name: 'React with Heart' });
  const thumbsChoice = attachmentMessage.getByRole('menuitemcheckbox', { name: 'React with Thumbs up' });
  await expect(heartChoice).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(thumbsChoice).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(attachmentMessage.getByRole('button', { name: /Thumbs up, 3 reactions, selected/ })).toBeVisible();

  const target = page.locator('#message-message-79');
  await chooseMessageAction(target, 'Reply to message', 'Reply');
  const input = page.locator('.composer input:not([type=file])');
  await input.fill('Reaction reply');
  await page.getByRole('button', { name: 'Send message' }).click();
  const reply = page.locator('.discord-message').last();
  await chooseMessageAction(reply, 'Edit message', 'Edit');
  await input.fill('Edited reaction reply');
  await page.getByRole('button', { name: 'Save message' }).click();
  await openReactionPicker(reply);
  await reply.getByRole('menuitemcheckbox', { name: 'React with Laughing' }).click();
  await expect(reply.locator('.cubic-message-reply-preview')).toContainText('History message 79');
  await expect(reply.locator('.cubic-message-edited')).toHaveText('(edited)');
  await expect(reply.getByRole('button', { name: /Laughing, 1 reaction, selected/ })).toBeVisible();

  const flow = await page.locator('.discord-message').evaluateAll((nodes) => nodes.flatMap((node, index) => {
    const rect = node.getBoundingClientRect();
    const content = node.querySelector('.discord-message-content')!.getBoundingClientRect();
    const next = nodes[index + 1]?.getBoundingClientRect();
    return content.bottom > rect.bottom + 1 || (next && rect.bottom > next.top + 1) ? [index] : [];
  }));
  expect(flow).toEqual([]);
  expect(await page.locator('.messages').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
});
