import { test, expect } from '@playwright/test';

const fixture = 'http://127.0.0.1:3198';

test.beforeEach(async ({ page, context, request }) => {
  await request.post(`${fixture}/__test/reset`);
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/app');
  await page.locator('.conversation-row').filter({ hasText: 'Fixture group' }).click();
});

test('member panel shows roles, presence and member changes without breaking chat layout', async ({ page, request }) => {
  const toggle = page.locator('.chat-header button[aria-label="Members"]');
  await toggle.click();
  const panel = page.getByRole('complementary', { name: 'Group members' });
  await expect(panel).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByLabel('Tester, owner, online')).toBeVisible();
  await expect(panel.getByLabel('Fixture DM, member, offline')).toBeVisible();

  await request.post(`${fixture}/__test/presence?userId=fixture-peer&status=idle`);
  await expect(panel.getByLabel('Fixture DM, member, idle')).toBeVisible();
  await request.post(`${fixture}/__test/group-member?included=false`);
  await expect(panel.locator('.cubic-member-panel-row')).toHaveCount(1);
  await request.post(`${fixture}/__test/group-member?included=true`);
  await expect(panel.locator('.cubic-member-panel-row')).toHaveCount(2);

  if ((page.viewportSize()?.width ?? 1000) <= 680) {
    const panelWidth = await panel.evaluate((node) => node.getBoundingClientRect().width);
    const chatWidth = await page.locator('.chat-panel').evaluate((node) => node.getBoundingClientRect().width);
    expect(Math.abs(panelWidth - chatWidth)).toBeLessThan(2);
  }
  await panel.getByRole('button', { name: 'Close member panel' }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.messages-wrap')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a second authenticated browser updates presence in the first member panel', async ({ page, browser, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One desktop realtime run covers the shared client behavior.');
  await page.locator('.chat-header button[aria-label="Members"]').click();
  const panel = page.getByRole('complementary', { name: 'Group members' });
  await expect(panel.getByLabel('Fixture DM, member, offline')).toBeVisible();

  const peerContext = await browser.newContext();
  try {
    await peerContext.addCookies([{ name: 'cubic_session', value: 'browser-peer', domain: '127.0.0.1', path: '/' }]);
    const peerPage = await peerContext.newPage();
    await peerPage.goto('/app');
    await expect(panel.getByLabel('Fixture DM, member, online')).toBeVisible();
  } finally {
    await peerContext.close();
  }
  await expect(panel.getByLabel('Fixture DM, member, offline')).toBeVisible();
});

test('a direct conversation shows its peer without inventing a group role', async ({ page }) => {
  if ((page.viewportSize()?.width ?? 1000) <= 680) {
    await page.getByRole('button', { name: 'Back to conversations' }).click();
  }
  await page.locator('.conversation-row').filter({ hasText: 'Fixture DM' }).click();
  await page.locator('.chat-header button[aria-label="Members"]').click();
  const panel = page.getByRole('complementary', { name: 'Conversation member' });
  await expect(panel.getByLabel('Fixture DM, offline')).toBeVisible();
  await expect(panel.locator('.cubic-member-panel-row')).toHaveCount(1);
});

test('an in-flight presence snapshot cannot overwrite a newer realtime status', async ({ page, request }) => {
  const toggle = page.locator('.chat-header button[aria-label="Members"]');
  await toggle.click();
  const panel = page.getByRole('complementary', { name: 'Group members' });
  await expect(panel.getByLabel('Fixture DM, member, offline')).toBeVisible();
  await request.post(`${fixture}/__test/presence-snapshot?mode=hold`);
  await panel.getByRole('button', { name: 'Close member panel' }).click();
  await toggle.click();
  await expect.poll(async () => (await (await request.get(`${fixture}/__test/presence-snapshot`)).json()).pending).toBe(1);

  await request.post(`${fixture}/__test/presence?userId=fixture-peer&status=online`);
  await expect(panel.getByLabel('Fixture DM, member, online')).toBeVisible();
  await request.post(`${fixture}/__test/presence-snapshot?mode=release`);
  // The fixture sends this marker after the held Socket.IO acknowledgement.
  await expect(panel.getByLabel('Tester, owner, idle')).toBeVisible();
  await expect(panel.getByLabel('Fixture DM, member, online')).toBeVisible();
});
