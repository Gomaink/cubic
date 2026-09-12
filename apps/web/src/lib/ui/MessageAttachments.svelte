<script lang="ts">
  import Icon from './Icon.svelte';

  type Attachment = {
    id: string;
    originalName: string;
    contentType: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
    url: string;
  };

  let { attachments }: { attachments: Attachment[] } = $props();
  let selectedId = $state<string | null>(null);
  let failedImages = $state<string[]>([]);
  let dialog = $state<HTMLDialogElement>();

  const images = $derived(attachments.filter((item) => item.contentType.startsWith('image/')));
  const videos = $derived(attachments.filter((item) => item.contentType.startsWith('video/')));
  const media = $derived(attachments.filter((item) =>
    item.contentType.startsWith('image/') || item.contentType.startsWith('video/')));
  const files = $derived(attachments.filter((item) =>
    !item.contentType.startsWith('image/') && !item.contentType.startsWith('video/')));
  const selectedIndex = $derived(media.findIndex((item) => item.id === selectedId));
  const selected = $derived(media[selectedIndex]);

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function imageRatio(item: Attachment): number {
    // Reserve space even when dimensions are unavailable or the request is slow.
    return item.width && item.height
      ? Math.max(0.75, Math.min(16 / 9, item.width / item.height))
      : 4 / 3;
  }

  function showLightbox(node: HTMLDialogElement) {
    node.showModal();
    node.querySelector<HTMLButtonElement>('[aria-label="Close media viewer"]')?.focus({ preventScroll: true });
    return { destroy: () => node.close() };
  }

  function openMedia(id: string, button: HTMLButtonElement) {
    button.closest('.cubic-message-attachments')?.querySelectorAll('video').forEach((video) => video.pause());
    selectedId = id;
  }

  function navigate(direction: number) {
    selectedId = media[(selectedIndex + direction + media.length) % media.length]?.id ?? null;
  }

  function handleKeys(event: KeyboardEvent) {
    if (event.key === 'Tab' && dialog) {
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), video[controls]'));
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
      return;
    }
    // Native video controls retain their own seeking/volume keyboard shortcuts.
    if (event.target instanceof HTMLVideoElement || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      navigate(event.key === 'ArrowLeft' ? -1 : 1);
    }
  }
</script>

<div class="cubic-message-attachments">
  {#if images.length > 0}
    <div
      class="cubic-media-gallery"
      class:single={images.length === 1}
      class:triple={images.length === 3}
      class:many={images.length > 4}
    >
      {#each images as attachment (attachment.id)}
        <button
          class="cubic-media-image"
          type="button"
          style:--cubic-media-ratio={images.length === 1 ? imageRatio(attachment) : 1}
          aria-label={`Open ${attachment.originalName}`}
          onclick={(event) => openMedia(attachment.id, event.currentTarget)}
        >
          {#if failedImages.includes(attachment.id)}
            <span class="cubic-media-unavailable">Image unavailable<br />{attachment.originalName}</span>
          {:else}
            <img
              src={attachment.url}
              alt={attachment.originalName}
              loading="lazy"
              decoding="async"
              onerror={() => failedImages = [...failedImages, attachment.id]}
            />
          {/if}
        </button>
      {/each}
    </div>
  {/if}

  {#each videos as attachment (attachment.id)}
    <div class="cubic-media-video-card">
      <!-- User uploads have no caption track; retain accessible native controls. -->
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        class="cubic-media-video"
        src={attachment.url}
        controls
        playsinline
        preload="metadata"
        aria-label={attachment.originalName}
      ></video>
      <button class="cubic-media-video-open" type="button" onclick={(event) => openMedia(attachment.id, event.currentTarget)}>
        <span>{attachment.originalName}</span><Icon name="maximize" size={16} />
      </button>
    </div>
  {/each}

  {#each files as attachment (attachment.id)}
    <a
      class="cubic-message-attachment"
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${attachment.originalName}`}
    >
      <span class="cubic-attachment-glyph" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
            fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
          <path d="M14 2v6h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
        </svg>
      </span>
      <span class="cubic-attachment-copy">
        <strong>{attachment.originalName}</strong>
        <small>{formatSize(attachment.sizeBytes)}</small>
      </span>
    </a>
  {/each}
</div>

{#if selected}
  <dialog
    class="cubic-media-lightbox"
    bind:this={dialog}
    use:showLightbox
    aria-label="Message media viewer"
    onclose={() => selectedId = null}
    onkeydown={handleKeys}
  >
    <div class="cubic-media-toolbar">
      <span class="cubic-media-caption" aria-live="polite">{selected.originalName}</span>
      <a href={selected.url} target="_blank" rel="noopener noreferrer" aria-label="Open original media" title="Open original media">
        <Icon name="maximize" />
      </a>
      <button type="button" aria-label="Close media viewer" onclick={() => dialog?.close()}><Icon name="x" /></button>
    </div>
    <div class="cubic-media-stage">
      {#key selected.id}
        {#if selected.contentType.startsWith('image/')}
          {#if failedImages.includes(selected.id)}
            <span class="cubic-media-unavailable">Image unavailable. Use “Open original media” to try the file directly.</span>
          {:else}
            <img src={selected.url} alt={selected.originalName} onerror={() => failedImages = [...failedImages, selected.id]} />
          {/if}
        {:else}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video src={selected.url} controls playsinline preload="metadata" aria-label={selected.originalName}></video>
        {/if}
      {/key}
    </div>
    <div class="cubic-media-navigation">
      <button type="button" aria-label="Previous media" disabled={media.length < 2} onclick={() => navigate(-1)}><Icon name="back" /></button>
      <span aria-live="polite">{selectedIndex + 1} / {media.length}</span>
      <button class="cubic-media-next" type="button" aria-label="Next media" disabled={media.length < 2} onclick={() => navigate(1)}><Icon name="back" /></button>
    </div>
  </dialog>
{/if}

<style>
  .cubic-media-gallery {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px;
    min-width: 0;
    overflow: hidden;
    border-radius: 8px;
  }
  .cubic-media-gallery.single { grid-template-columns: minmax(0, 1fr); max-width: 420px; }
  .cubic-media-gallery.many { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .cubic-media-gallery.triple > :first-child { grid-column: 1 / -1; aspect-ratio: 2; }
  .cubic-media-image {
    display: block;
    position: relative;
    width: 100%;
    min-width: 0;
    padding: 0;
    border: 0;
    aspect-ratio: var(--cubic-media-ratio);
    overflow: hidden;
    background: #1e1f22;
    color: #dbdee1;
    cursor: zoom-in;
  }
  .cubic-media-image img {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .cubic-media-gallery.single img { object-fit: contain; }
  .cubic-media-image:focus-visible { outline: 2px solid #b5baff; outline-offset: -3px; }
  .cubic-media-unavailable { display: block; padding: 12px; overflow-wrap: anywhere; font-size: .8rem; }
  .cubic-media-image > .cubic-media-unavailable { position: absolute; inset: 0; overflow: auto; }
  .cubic-media-video-card { min-width: 0; overflow: hidden; border-radius: 8px; background: #1e1f22; }
  .cubic-media-video { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: contain; background: #000; }
  .cubic-media-video-open {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    border: 0;
    background: transparent;
    color: #dbdee1;
    cursor: pointer;
  }
  .cubic-media-video-open span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cubic-media-lightbox {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    height: 100dvh;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
    border: 0;
    background: #090a0ef5;
    color: #dbdee1;
    overflow: hidden;
  }
  .cubic-media-lightbox[open] { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 8px; }
  .cubic-media-lightbox::backdrop { background: #000b; }
  .cubic-media-toolbar, .cubic-media-navigation { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .cubic-media-caption { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cubic-media-lightbox button, .cubic-media-toolbar a {
    flex: 0 0 44px;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 1px solid #3f4147;
    border-radius: 8px;
    background: #1e1f22;
    color: inherit;
    cursor: pointer;
  }
  .cubic-media-lightbox button:disabled { opacity: .35; cursor: default; }
  .cubic-media-stage { display: grid; place-items: center; min-width: 0; min-height: 0; overflow: hidden; }
  .cubic-media-stage img, .cubic-media-stage video { display: block; width: 100%; height: 100%; min-height: 0; object-fit: contain; }
  .cubic-media-navigation { justify-content: center; }
  .cubic-media-navigation span { min-width: 64px; text-align: center; font-size: .8rem; }
  .cubic-media-next :global(svg) { transform: rotate(180deg); }
  @media (max-height: 450px) {
    .cubic-media-lightbox[open] { gap: 4px; padding-block: 4px; }
  }
</style>
