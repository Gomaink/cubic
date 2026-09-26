import type { Page } from '@playwright/test';

async function closeMobileContent(page: Page) {
  if (!isCompactNavigation(page)) return;
  const back = page.locator('.chat-panel.open:not(.cubic-server-empty) .chat-back');
  if (await back.isVisible()) await back.click();
}

/** Mirrors the shell breakpoint rather than Playwright project names. */
export function isCompactNavigation(page: Page) {
  return (page.viewportSize()?.width ?? 1000) <= 680;
}

export async function hasCoarsePointer(page: Page) {
  return page.evaluate(() => matchMedia('(pointer: coarse)').matches);
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

export async function openUserSettings(page: Page) {
  const compactHeader = page.locator('.chat-panel.open .cubic-mobile-user-settings-trigger');
  if (isCompactNavigation(page) && await compactHeader.isVisible()) await compactHeader.click();
  else await page.locator('.cubic-user-bar').getByRole('button', { name: 'User Settings' }).click();
}

export async function openServerSettings(page: Page) {
  await closeMobileContent(page);
  await page.locator('.cubic-server-sidebar-head').getByRole('button', { name: 'Settings', exact: true }).click();
}

export async function openServerSettingsSection(page: Page, name: 'Overview' | 'Members' | 'Invites') {
  await openServerSettings(page);
  await page.getByRole('navigation', { name: 'Server settings sections' }).getByRole('button', { name: new RegExp(`^${name}(?:\\s|$)`) }).click();
}

export async function closeServerSettings(page: Page) {
  const name = isCompactNavigation(page) ? 'Back to server' : 'Close server settings';
  await page.getByRole('button', { name, exact: true }).click();
}

export async function chooseServerCreate(page: Page, name: 'Create category' | 'Create text channel' | 'Create voice channel') {
  const back = page.getByRole('button', { name: 'Back to server', exact: true });
  if (await back.isVisible()) await back.click();
  await page.getByRole('button', { name: 'Add channel or category' }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

export async function chooseChannelAction(page: Page, kind: 'text' | 'voice', channelName: string, action: string) {
  await page.getByRole('button', { name: `Actions for ${kind} channel ${channelName}` }).click();
  await page.getByRole('button', { name: action, exact: true }).click();
}

export async function chooseCategoryAction(page: Page, categoryName: string, action: string) {
  await page.getByRole('button', { name: `Actions for category ${categoryName}` }).click();
  await page.getByRole('button', { name: action, exact: true }).click();
}
