import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { openUserSettings } from './navigation';

const fixture = 'http://127.0.0.1:3198';
const artifacts = '/tmp/cubic-alpha11-slice6';

test.beforeEach(async ({ page, context, request }) => {
  await request.post(`${fixture}/__test/reset`);
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', {
      configurable: true,
      value: async () => [
        { kind: 'audioinput', deviceId: 'fixture-mic', groupId: 'fixture', label: 'Fixture microphone' },
        { kind: 'videoinput', deviceId: 'fixture-camera', groupId: 'fixture', label: 'Fixture camera' },
        { kind: 'audiooutput', deviceId: 'fixture-speaker', groupId: 'fixture', label: 'Fixture speaker' }
      ]
    });
  });
  await page.goto('/app');
});

test('Voice & Video saves browser-local choices and keeps the conversation', async ({ page }, testInfo) => {
  await mkdir(artifacts, { recursive: true });
  await page.locator('.conversation-row').filter({ hasText: 'Fixture DM' }).click();
  await openUserSettings(page);
  const settings = page.getByRole('region', { name: 'User Settings' });
  const voiceNav = settings.getByRole('navigation', { name: 'User settings sections' }).getByRole('button', { name: 'Voice & Video' });
  await voiceNav.click();
  await expect(voiceNav).toHaveAttribute('aria-current', 'page');
  await expect(settings.getByRole('heading', { name: 'Voice & Video' })).toBeVisible();
  await expect(settings.getByRole('combobox', { name: 'Microphone' })).toBeEnabled();
  await settings.getByRole('combobox', { name: 'Microphone' }).selectOption('fixture-mic');
  await settings.getByRole('combobox', { name: 'Camera', exact: true }).selectOption('fixture-camera');
  await settings.getByRole('combobox', { name: 'Output device' }).selectOption('fixture-speaker');
  await expect(settings.getByText('This choice will apply when you next use voice or video.')).toBeVisible();
  await settings.getByRole('button', { name: /Smooth.*720p/ }).first().click();
  await expect(settings.getByRole('button', { name: /Smooth.*720p/ }).first()).toHaveAttribute('aria-pressed', 'true');
  await settings.getByRole('button', { name: /Motion.*720p/ }).click();
  await expect(settings.getByRole('button', { name: /Motion.*720p/ })).toHaveAttribute('aria-pressed', 'true');
  await settings.getByRole('checkbox', { name: /Browser voice processing/ }).focus();
  await page.keyboard.press('Space');
  await expect(settings.getByRole('checkbox', { name: /Browser voice processing/ })).not.toBeChecked();
  expect(await page.evaluate(() => ({
    mic: localStorage.getItem('cubic.audioInput'),
    camera: localStorage.getItem('cubic.videoInput'),
    speaker: localStorage.getItem('cubic.audioOutput'),
    quality: localStorage.getItem('cubic.cameraQuality'),
    share: localStorage.getItem('cubic.screenShareQuality'),
    processing: localStorage.getItem('cubic.browserVoiceProcessing')
  }))).toEqual({ mic: 'fixture-mic', camera: 'fixture-camera', speaker: 'fixture-speaker', quality: 'smooth', share: 'motion', processing: 'false' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await settings.locator('.cubic-user-settings-content').evaluate((node) => { node.scrollTop = 0; });
  await page.screenshot({ path: `${artifacts}/${testInfo.project.name}-voice-video-settings.png` });
  await settings.getByRole('button', { name: 'Close User Settings' }).click();
  await expect(page.locator('.chat-heading')).toContainText('Fixture DM');
  await page.reload();
  await openUserSettings(page);
  await voiceNav.click();
  await expect(settings.getByRole('combobox', { name: 'Microphone' })).toHaveValue('fixture-mic');
  await expect(settings.getByRole('combobox', { name: 'Camera', exact: true })).toHaveValue('fixture-camera');
  await expect(settings.getByRole('combobox', { name: 'Output device' })).toHaveValue('fixture-speaker');
  await expect(settings.getByRole('button', { name: /Smooth.*720p/ }).first()).toHaveAttribute('aria-pressed', 'true');
  await expect(settings.getByRole('button', { name: /Motion.*720p/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(settings.getByRole('checkbox', { name: /Browser voice processing/ })).not.toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
