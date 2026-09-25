import type { Page } from '@playwright/test';

async function closeMobileContent(page: Page) {
  if ((page.viewportSize()?.width ?? 1000) > 680) return;
  const back = page.locator('.chat-panel.open:not(.cubic-server-empty) .chat-back');
  if (await back.isVisible()) await back.click();
}

export async function openMessages(page: Page) {
  await closeMobileContent(page);
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Messages' }).click();
}

export async function openServers(page: Page) {
  await closeMobileContent(page);
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Browse servers' }).click();
}

export async function openPeople(page: Page) {
  await openMessages(page);
  await page.getByRole('button', { name: 'People and friends' }).click();
}
