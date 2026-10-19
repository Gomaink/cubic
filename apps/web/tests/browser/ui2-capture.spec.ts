import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve('../../build/ui-overhaul/ui2-screenshots/final');
const viewports = [
  ['desktop-1916x1076', 1916, 1076],
  ['desktop-1440x900', 1440, 900],
  ['desktop-1366x768', 1366, 768],
  ['narrow-desktop-900x700', 900, 700],
  ['phone-landscape-844x390', 844, 390],
  ['phone-portrait-390x844', 390, 844],
  ['small-phone-320x568', 320, 568]
] as const;

test('capture UI-2 shell states', async ({ page, context, request }, testInfo) => {
  mkdirSync(out, { recursive: true });
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);

  const projectViewports = viewports.filter(([name]) => name.startsWith(`${testInfo.project.name}-`));
  for (const [name, width, height] of projectViewports) {
    await page.setViewportSize({ width, height });
    for (const state of ['messages', 'conversation', 'people', 'settings', 'server'] as const) {
      await request.post('http://127.0.0.1:3198/__test/reset');
      await page.goto('/app');
      await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
      if (state === 'conversation') {
        await page.locator('.conversation-row').filter({ hasText: 'Fixture DM' }).click();
        await expect(page.getByPlaceholder('Message…')).toBeVisible();
      } else if (state === 'people') {
        await page.getByRole('button', { name: 'People and friends' }).click();
        await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
      } else if (state === 'settings') {
        await page.getByRole('button', { name: 'User Settings' }).click();
        await expect(page.getByRole('region', { name: 'User Settings' })).toBeVisible();
      } else if (state === 'server') {
        await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Create server' }).click();
        const dialog = page.getByRole('dialog', { name: 'Create server' });
        await dialog.getByRole('textbox', { name: 'Server name' }).fill('UI Foundation');
        if (name === 'desktop-1440x900') {
          await page.screenshot({ path: resolve(out, `${name}-server-dialog.png`), animations: 'disabled' });
        }
        await dialog.getByRole('button', { name: 'Create server' }).click();
        await expect(page.locator('.cubic-server-sidebar-head')).toContainText('UI Foundation');
      }
      await page.screenshot({ path: resolve(out, `${name}-${state}.png`), animations: 'disabled' });
      if (state === 'conversation') {
        await page.locator('.chat-header button[aria-label="Members"]').click();
        const panel = page.getByRole('complementary', { name: 'Conversation member' });
        await expect(panel).toBeVisible();
        const geometry = await page.evaluate(() => ({
          panelTop: document.querySelector('.cubic-member-panel')!.getBoundingClientRect().top,
          headerBottom: document.querySelector('.chat-panel > .chat-header')!.getBoundingClientRect().bottom,
          composerBottom: document.querySelector('.chat-panel > .composer')!.getBoundingClientRect().bottom
        }));
        expect(geometry.panelTop).toBe(width <= 680 ? 0 : geometry.headerBottom);
        expect(geometry.composerBottom).toBeLessThanOrEqual(height);
        await page.screenshot({ path: resolve(out, `${name}-conversation-members.png`), animations: 'disabled' });
        if (name === 'desktop-1440x900') {
          const member = panel.getByRole('button', { name: 'Fixture DM, offline' });
          await member.click();
          const profile = page.locator('dialog.cubic-profile-dialog');
          await expect(profile).toBeVisible();
          await page.screenshot({ path: resolve(out, `${name}-profile-dialog.png`), animations: 'disabled' });
          await profile.getByRole('button', { name: 'Close profile' }).click();
          await expect(member).toBeFocused();
        }
      }
      if (name === 'desktop-1440x900' && state === 'server') {
        await page.getByRole('button', { name: 'Add channel or category' }).click();
        await page.getByRole('button', { name: 'Create text channel', exact: true }).click();
        const channel = page.getByRole('dialog', { name: 'Create text channel' });
        await channel.getByRole('textbox', { name: 'Channel name' }).fill('general');
        await channel.getByRole('button', { name: 'Create text channel' }).click();
        await expect(page.locator('.chat-heading')).toContainText('general');
        await page.screenshot({ path: resolve(out, `${name}-server-channel.png`), animations: 'disabled' });
        await page.getByRole('button', { name: 'Actions for text channel general' }).click();
        await expect(page.getByRole('button', { name: 'Channel settings for general' })).toBeVisible();
        await page.screenshot({ path: resolve(out, `${name}-channel-menu.png`), animations: 'disabled' });
      }
    }
  }
});
