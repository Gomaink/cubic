import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { chooseServerCreate, isCompactNavigation, openServers, openUserSettings } from './navigation';

const fixture = 'http://127.0.0.1:3198';
const artifacts = '/tmp/cubic-alpha11-slice5';
const densityArtifacts = '/tmp/cubic-alpha11-slice5/compact-refinement';
const screenshotProjects = new Set(['desktop', 'phone-portrait', 'small-phone']);

test.beforeEach(async ({ page, context, request }) => {
  await request.post(`${fixture}/__test/reset`);
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/app');
});

test('App preferences load, save, persist and apply across viewport sizes', async ({ page, request }, testInfo) => {
  await mkdir(artifacts, { recursive: true });
  await request.post(`${fixture}/__test/settings`, { data: { reduceMotion: true } });
  await page.reload();
  const normalConversationHeight = await page.locator('.conversation-row').first().evaluate((node) => node.getBoundingClientRect().height);
  await page.locator('.conversation-row').filter({ hasText: 'Fixture DM' }).click();
  await expect(page.locator('.discord-message.continuation').first()).toBeVisible();
  const normalStreamGap = await page.locator('.cubic-attachment-message-stream').evaluate((node) => Number.parseFloat(getComputedStyle(node).gap));
  const normalContinuationHeight = await page.locator('.discord-message.continuation').first().evaluate((node) => node.getBoundingClientRect().height);
  if (screenshotProjects.has(testInfo.project.name)) {
    await mkdir(densityArtifacts, { recursive: true });
    await page.locator('#message-message-45').evaluate((node) => node.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: `${densityArtifacts}/${testInfo.project.name}-normal-messages.png` });
  }
  await openUserSettings(page);
  const settings = page.getByRole('region', { name: 'User Settings' });
  await settings.getByRole('navigation', { name: 'User settings sections' }).getByRole('button', { name: 'App', exact: true }).click();
  const compact = settings.getByRole('checkbox', { name: 'Compact mode' });
  const motion = settings.getByRole('checkbox', { name: 'Reduced motion' });
  await expect(motion).toBeChecked();
  await expect(compact).not.toBeChecked();
  await expect(page.locator('.cubic-app-shell')).toHaveClass(/cubic-app-reduce-motion/);
  const highlighted = page.locator('.discord-message').first();
  await highlighted.evaluate((node) => node.classList.add('cubic-message-highlight'));
  const reducedDuration = await highlighted.evaluate((node) => Number.parseFloat(getComputedStyle(node).animationDuration));
  expect(reducedDuration).toBeLessThan(0.01);
  await expect(settings.getByRole('checkbox', { name: /theme|volume|device|notification|language/i })).toHaveCount(0);
  await expect(settings.getByRole('textbox', { name: /email|password|username/i })).toHaveCount(0);
  await page.screenshot({ path: `${artifacts}/${testInfo.project.name}-app-settings.png` });

  const patchBodies: unknown[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/v1/users/me/settings') && request.method() === 'PATCH') patchBodies.push(request.postDataJSON());
  });
  const beforeGap = await page.locator('.discord-message:not(.continuation)').first().evaluate((node) => Number.parseFloat(getComputedStyle(node).marginTop));
  await compact.check();
  await expect(compact).toBeChecked();
  await expect(page.locator('.cubic-app-shell')).toHaveClass(/cubic-app-compact/);
  const afterGap = await page.locator('.discord-message:not(.continuation)').first().evaluate((node) => Number.parseFloat(getComputedStyle(node).marginTop));
  expect(afterGap).toBeLessThan(beforeGap - 8);
  const compactStreamGap = await page.locator('.cubic-attachment-message-stream').evaluate((node) => Number.parseFloat(getComputedStyle(node).gap));
  expect(compactStreamGap).toBeLessThan(normalStreamGap - 4);
  const compactContinuationHeight = await page.locator('.discord-message.continuation').first().evaluate((node) => node.getBoundingClientRect().height);
  expect(compactContinuationHeight).toBeLessThan(normalContinuationHeight);
  const continuationMinHeight = await page.locator('.discord-message.continuation').first().evaluate((node) => getComputedStyle(node).minHeight);
  expect(continuationMinHeight).toBe('20px');
  const compactConversationHeight = await page.locator('.conversation-row').first().evaluate((node) => node.getBoundingClientRect().height);
  expect(compactConversationHeight).toBeLessThan(normalConversationHeight - 8);
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) expect(compactConversationHeight).toBeGreaterThanOrEqual(44);
  if (testInfo.project.name === 'desktop' || testInfo.project.name === 'phone-portrait') {
    await page.screenshot({ path: `${artifacts}/${testInfo.project.name}-app-settings-compact.png` });
  }
  await motion.uncheck();
  await expect(motion).not.toBeChecked();
  await expect(page.locator('.cubic-app-shell')).not.toHaveClass(/cubic-app-reduce-motion/);
  const normalDuration = await highlighted.evaluate((node) => Number.parseFloat(getComputedStyle(node).animationDuration));
  expect(normalDuration).toBeGreaterThan(1);
  expect(patchBodies).toEqual([{ compactMode: true }, { reduceMotion: false }]);
  const saved = await request.get(`${fixture}/api/v1/users/me/settings`, { headers: { cookie: 'cubic_session=browser-fixture' } });
  expect((await saved.json()).settings).toMatchObject({ compactMode: true, reduceMotion: false });
  await settings.getByRole('button', { name: 'Close User Settings' }).click();
  await expect(page.locator('.chat-heading')).toContainText('Fixture DM');
  if (screenshotProjects.has(testInfo.project.name)) {
    await page.locator('#message-message-45').evaluate((node) => node.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: `${densityArtifacts}/${testInfo.project.name}-compact-messages.png` });
  }
  await openUserSettings(page);
  await settings.getByRole('navigation', { name: 'User settings sections' }).getByRole('button', { name: 'App', exact: true }).click();
  await expect(compact).toBeChecked();
  await page.reload();
  await openUserSettings(page);
  await settings.getByRole('navigation', { name: 'User settings sections' }).getByRole('button', { name: 'App', exact: true }).click();
  await expect(compact).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await settings.getByRole('button', { name: 'Close User Settings' }).click();
  await page.locator('.conversation-row').filter({ hasText: 'Fixture group' }).click();
  await openUserSettings(page);
  await settings.getByRole('navigation', { name: 'User settings sections' }).getByRole('button', { name: 'App', exact: true }).click();
  await settings.getByRole('button', { name: 'Close User Settings' }).click();
  await expect(page.locator('.chat-heading')).toContainText('Fixture group');
});

test('Compact mode tightens server navigation while retaining mobile channel targets', async ({ page }, testInfo) => {
  await openServers(page);
  await page.getByRole('button', { name: 'Create server' }).first().click();
  const serverDialog = page.getByRole('dialog', { name: 'Create server' });
  await serverDialog.getByRole('textbox', { name: 'Server name' }).fill('Density Lab');
  await serverDialog.getByRole('button', { name: 'Create server' }).click();
  await chooseServerCreate(page, 'Create category');
  const categoryDialog = page.getByRole('dialog', { name: 'Create category' });
  await categoryDialog.getByRole('textbox', { name: 'Category name' }).fill('General');
  await categoryDialog.getByRole('button', { name: 'Create category' }).click();
  await chooseServerCreate(page, 'Create text channel');
  const textDialog = page.getByRole('dialog', { name: 'Create text channel' });
  await textDialog.getByRole('textbox', { name: 'Channel name' }).fill('chat');
  await textDialog.getByRole('combobox', { name: 'Category' }).selectOption({ label: 'General' });
  await textDialog.getByRole('button', { name: 'Create text channel' }).click();
  await expect(page.locator('.chat-heading')).toContainText('chat');
  if (isCompactNavigation(page)) {
    await page.getByRole('button', { name: 'Back to server', exact: true }).click();
    await expect(page.locator('.chat-panel')).toHaveClass(/cubic-server-empty/);
  }
  await chooseServerCreate(page, 'Create voice channel');
  const voiceDialog = page.getByRole('dialog', { name: 'Create voice channel' });
  await voiceDialog.getByRole('textbox', { name: 'Voice channel name' }).fill('Lounge');
  await voiceDialog.getByRole('combobox', { name: 'Category' }).selectOption({ label: 'General' });
  await voiceDialog.getByRole('button', { name: 'Create voice channel' }).click();
  if (isCompactNavigation(page)) {
    const back = page.getByRole('button', { name: 'Back to server', exact: true });
    if (await back.isVisible()) await back.click();
  }
  const category = page.getByRole('region', { name: 'Category General' });
  const voice = category.getByRole('button', { name: 'Join voice channel Lounge' });
  await expect(voice).toBeVisible();
  const geometry = () => page.evaluate(() => {
    const header = document.querySelector('.cubic-channel-sidebar-head');
    const category = document.querySelector('.cubic-layout-category');
    const text = document.querySelector('.cubic-layout-category .cubic-channel-row');
    const voice = document.querySelector('.cubic-layout-category .cubic-voice-channel-row');
    if (!header || !category || !text || !voice) throw new Error('Missing server navigation fixture');
    return {
      extent: voice.getBoundingClientRect().bottom - header.getBoundingClientRect().top,
      categoryGap: Number.parseFloat(getComputedStyle(category).marginTop),
      textHeight: text.getBoundingClientRect().height,
      voiceHeight: voice.getBoundingClientRect().height
    };
  });
  const normal = await geometry();
  if (screenshotProjects.has(testInfo.project.name)) {
    await mkdir(densityArtifacts, { recursive: true });
    await page.screenshot({ path: `${densityArtifacts}/${testInfo.project.name}-normal-navigation.png` });
  }
  await openUserSettings(page);
  const settings = page.getByRole('region', { name: 'User Settings' });
  await settings.getByRole('navigation', { name: 'User settings sections' }).getByRole('button', { name: 'App', exact: true }).click();
  await settings.getByRole('checkbox', { name: 'Compact mode' }).check();
  await expect(page.locator('.cubic-app-shell')).toHaveClass(/cubic-app-compact/);
  await settings.getByRole('button', { name: 'Close User Settings' }).click();
  const compact = await geometry();
  expect(compact.extent).toBeLessThan(normal.extent - 15);
  expect(compact.categoryGap).toBeLessThan(normal.categoryGap);
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
    expect(compact.textHeight).toBeGreaterThanOrEqual(44);
    expect(compact.voiceHeight).toBeGreaterThanOrEqual(44);
  } else {
    expect(compact.textHeight).toBeLessThan(normal.textHeight);
    expect(compact.voiceHeight).toBeLessThan(normal.voiceHeight);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (screenshotProjects.has(testInfo.project.name)) {
    await page.screenshot({ path: `${densityArtifacts}/${testInfo.project.name}-compact-navigation.png` });
  }
});

test('failed save retains server value and allows retry', async ({ page, request }) => {
  await openUserSettings(page);
  const settings = page.getByRole('region', { name: 'User Settings' });
  await settings.getByRole('navigation', { name: 'User settings sections' }).getByRole('button', { name: 'App', exact: true }).click();
  const compact = settings.getByRole('checkbox', { name: 'Compact mode' });
  await expect(compact).not.toBeChecked();
  await request.post(`${fixture}/__test/settings-fail-next`);
  await compact.click();
  await expect(settings.getByRole('alert')).toContainText('Could not save app preferences. Try again.');
  await expect(compact).not.toBeChecked();
  await expect(page.locator('.cubic-app-shell')).not.toHaveClass(/cubic-app-compact/);
  await compact.check();
  await expect(compact).toBeChecked();
});
