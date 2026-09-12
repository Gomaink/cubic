import { test, expect, type Page } from '@playwright/test';

const fixture = 'http://127.0.0.1:3198';

async function openConversation(page: Page) {
  await page.locator('.conversation-row').filter({ hasText: 'Fixture DM' }).click();
  await expect(page.locator('.discord-message')).toHaveCount(50);
  await expect.poll(() => page.locator('.messages').evaluate((node) =>
    node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThan(3);
}

async function assertFlow(page: Page) {
  const problems = await page.locator('.discord-message').evaluateAll((nodes) => nodes.flatMap((node, index) => {
    const rect = node.getBoundingClientRect();
    const content = node.querySelector('.discord-message-content')!.getBoundingClientRect();
    const next = nodes[index + 1]?.getBoundingClientRect();
    return content.bottom > rect.bottom + 1 || (next && rect.bottom > next.top + 1) ? [index] : [];
  }));
  expect(problems).toEqual([]);
  expect(await page.locator('.messages').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
}

test.beforeEach(async ({ page, context, request }) => {
  await request.post(`${fixture}/__test/reset`);
  await context.addCookies([{ name: 'cubic_session', value: 'browser-fixture', domain: '127.0.0.1', path: '/' }]);
  await page.goto('/app');
  await openConversation(page);
});

test('message heights, galleries, native video, file cards, and composer staging', async ({ page }) => {
  await assertFlow(page);
  await expect(page.locator('.cubic-media-gallery.triple')).toHaveCount(1);
  await expect(page.locator('.cubic-media-gallery.many .cubic-media-image')).toHaveCount(10);
  await expect(page.locator('.cubic-message-attachment')).toHaveCount(3);
  await expect(page.locator('.cubic-media-video[controls][playsinline]')).toHaveCount(2);
  const controls = await page.locator('.composer').evaluate((node) => {
    const children = [...node.children].filter((item) => !(item instanceof HTMLInputElement && item.type === 'file'));
    return children.map((item) => {
      const rect = item.getBoundingClientRect();
      return { left: rect.left, right: rect.right, center: rect.top + rect.height / 2 };
    });
  });
  expect(controls).toHaveLength(3);
  expect(controls[0].right).toBeLessThan(controls[1].left);
  expect(controls[1].right).toBeLessThan(controls[2].left);
  expect(Math.abs(controls[0].center - controls[1].center)).toBeLessThan(1);
  expect(Math.abs(controls[2].center - controls[1].center)).toBeLessThan(1);

  await page.locator('input[type=file].cubic-attachment-input').setInputFiles(
    Array.from({ length: 10 }, (_, index) => ({ name: `upload-${index}.png`, mimeType: 'image/png', buffer: Buffer.from('fixture') }))
  );
  await expect(page.locator('.cubic-staged-attachment')).toHaveCount(10);
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled();
  const staging = await page.locator('.cubic-attachment-staging').boundingBox();
  const composer = await page.locator('.composer').boundingBox();
  expect(staging!.y + staging!.height).toBeLessThanOrEqual(composer!.y + 1);
  expect(composer!.y + composer!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.cubic-attachment-staging')).toHaveCount(0);
  await expect(page.locator('.discord-message')).toHaveCount(51); // POST + socket must deduplicate.
  await expect(page.locator('.discord-message').last().locator('.cubic-media-image')).toHaveCount(10);
  await assertFlow(page);
});

test('lightbox stays within the viewport and navigates only the selected message', async ({ page }, testInfo) => {
  const trigger = page.getByRole('button', { name: 'Open mixed-0.png', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Message media viewer' });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close media viewer' })).toBeFocused();
  await expect(dialog.locator('.cubic-media-caption')).toHaveText('mixed-0.png');
  await page.keyboard.press('ArrowRight');
  await expect(dialog.locator('.cubic-media-caption')).toHaveText('mixed-1.png');
  await page.getByRole('button', { name: 'Next media' }).click();
  await expect(dialog.locator('video')).toHaveCount(1);
  await expect(dialog.locator('.cubic-media-caption')).toHaveText('mixed-video.webm');
  await page.getByRole('button', { name: 'Next media' }).click();
  await expect(dialog.locator('.cubic-media-caption')).toHaveText('mixed-0.png');
  await page.getByRole('button', { name: 'Previous media' }).click();
  await expect(dialog.locator('.cubic-media-caption')).toHaveText('mixed-video.webm');
  await page.keyboard.press('ArrowLeft');
  await expect(dialog.locator('.cubic-media-caption')).toHaveText('mixed-1.png');
  const fit = await dialog.evaluate((node) => {
    const image = node.querySelector('img')!.getBoundingClientRect();
    const toolbar = node.querySelector('.cubic-media-toolbar')!.getBoundingClientRect();
    const navigation = node.querySelector('.cubic-media-navigation')!.getBoundingClientRect();
    return image.top >= toolbar.bottom && image.bottom <= navigation.top && image.left >= 0 && image.right <= innerWidth && node.scrollHeight <= node.clientHeight;
  });
  expect(fit).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('lightbox.png') });
  // Native modal focus containment keeps underlying chat controls inert.
  for (let index = 0; index < 6; index++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole('button', { name: 'Close media viewer' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Open single.png', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Next media' })).toBeDisabled();
  await page.keyboard.press('Escape');
});

test('older history, realtime unread, latest positioning, reload and group switching', async ({ page, request }) => {
  await page.locator('.messages').evaluate((node) => { node.scrollTop = 0; });
  await expect(page.locator('.discord-message')).toHaveCount(80);
  await assertFlow(page);
  // The previously first message remains near the top after prepending history.
  const position = await page.locator('.discord-message').filter({ hasText: 'History message 30' }).boundingBox();
  const viewport = await page.locator('.messages').boundingBox();
  expect(Math.abs(position!.y - viewport!.y)).toBeLessThan(80);
  await request.post(`${fixture}/__test/realtime`);
  await expect(page.locator('.discord-message')).toHaveCount(81);
  const jump = page.getByRole('button', { name: 'Jump to latest messages' });
  await expect(jump).toContainText('1');
  await jump.click();
  await expect(jump).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open realtime.png' })).toBeInViewport();
  await page.reload();
  await openConversation(page);
  await expect(page.getByRole('button', { name: 'Open realtime.png' })).toBeInViewport();
  if (page.viewportSize()!.width <= 680) await page.getByRole('button', { name: 'Back to conversations' }).click();
  await page.locator('.conversation-row').filter({ hasText: 'Fixture group' }).click();
  await expect(page.locator('.chat-empty')).toBeVisible();
  if (page.viewportSize()!.width <= 680) await page.getByRole('button', { name: 'Back to conversations' }).click();
  await openConversation(page);
});

test('slow images reserve height and broken images keep a usable fallback', async ({ page }) => {
  await page.getByRole('button', { name: 'Open broken.png', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Open broken.png', exact: true })).toContainText('Image unavailable');
  const trigger = page.getByRole('button', { name: 'Open portrait.png', exact: true });
  const url = await trigger.locator('img').getAttribute('src');
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**${url}`, async (route) => { await pending; await route.continue(); });
  await page.reload();
  await openConversation(page);
  await trigger.scrollIntoViewIfNeeded();
  const original = await trigger.boundingBox();
  expect(await trigger.locator('img').evaluate((node: HTMLImageElement) => node.complete)).toBe(false);
  release();
  await expect.poll(() => trigger.locator('img').evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
  expect((await trigger.boundingBox())!.height).toBe(original!.height);
  await assertFlow(page);
  await page.getByRole('button', { name: 'Open broken.png', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Image unavailable');
  await expect(page.getByRole('link', { name: 'Open original media' })).toHaveAttribute('href', /^\/api\/v1\/attachments\//);
  await page.keyboard.press('Escape');
});

test('native video decodes and plays an authenticated URL', async ({ page, request }) => {
  // Generate a small real WebM in Chromium, avoiding external media downloads.
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    const recorded = new Promise<Blob>((resolve) => {
      recorder.ondataavailable = (event) => chunks.push(event.data);
      recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
    });
    recorder.start();
    const context = canvas.getContext('2d')!;
    for (let index = 0; index < 5; index++) {
      context.fillStyle = index % 2 ? '#5865f2' : '#111214';
      context.fillRect(0, 0, 32, 32);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    recorder.stop();
    const blob = await recorded;
    stream.getTracks().forEach((track) => track.stop());
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  await request.post(`${fixture}/__test/video`, { data: Buffer.from(bytes) });
  const video = page.locator('.cubic-media-video').first();
  await video.scrollIntoViewIfNeeded();
  await video.evaluate(async (node: HTMLVideoElement) => {
    node.muted = true;
    // The fixture page preloads a zero-byte placeholder before the generated
    // WebM is posted; bypass that initial response when validating playback.
    node.src = `${node.src}?fixture=${Date.now()}`;
    node.load();
    await node.play();
  });
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0);
  await assertFlow(page);
});
