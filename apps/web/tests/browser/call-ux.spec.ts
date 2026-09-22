import { expect, test } from '@playwright/test';

test('voice failure offers recovery and browser processing preference stays local', async ({ page, context, request }) => {
  await request.post('http://127.0.0.1:3198/__test/reset');
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let attempts = 0;
  await page.route('**/api/v1/voice/conversations/*/token', async (route) => {
    attempts += 1;
    await held;
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Voice unavailable."}' });
  });

  try {
    await page.goto('/app');
    await page.locator('.conversation-row').filter({ hasText: 'Fixture group' }).click();
    await page.getByRole('button', { name: 'Join group voice' }).click();
    const dock = page.getByRole('region', { name: 'Voice room' });
    await expect(dock).toContainText('Joining voice…');
    await dock.getByRole('button', { name: 'Voice and video settings' }).click();
    const processing = dock.getByRole('checkbox', { name: /Browser voice processing/ });
    await expect(processing).toBeChecked();
    await processing.uncheck();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('cubic.browserVoiceProcessing'))).toBe('false');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    release();
    await expect(dock).toContainText('Voice unavailable');
    await expect(dock.getByRole('alert')).toContainText('Could not connect to voice');
    await dock.getByRole('button', { name: 'Retry voice' }).click();
    await expect.poll(() => attempts).toBe(2);
    await expect(dock.getByRole('button', { name: 'Retry voice' })).toBeVisible();
  } finally {
    release();
  }
});
