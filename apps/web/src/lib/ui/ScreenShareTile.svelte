<script lang="ts">
  let {
    track = null,
    name,
    local = false,
    focused = false,
    onclick,
    oncontextmenu
  }: {
    track?: any | null;
    name: string;
    local?: boolean;
    focused?: boolean;
    onclick?: () => void;
    oncontextmenu?: (event: MouseEvent) => void;
  } = $props();

  let videoElement = $state<HTMLVideoElement | null>(null);

  $effect(() => {
    const currentTrack = track;
    const element = videoElement;
    if (!currentTrack || !element) return;

    currentTrack.attach(element);
    return () => {
      try {
        currentTrack.detach(element);
      } catch {}
    };
  });

  function openContextMenuFromKeyboard(event: KeyboardEvent) {
    if (!oncontextmenu || (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey))) return;
    if (!(event.currentTarget instanceof HTMLButtonElement)) return;
    event.preventDefault();
    const button = event.currentTarget;
    const bounds = button.getBoundingClientRect();
    button.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + bounds.height / 2
    }));
  }
</script>

<button
  class="screen-share-tile"
  class:focused
  type="button"
  aria-label={`${focused ? 'Unfocus' : 'Focus'} ${name}'s screen share`}
  title={`${focused ? 'Unfocus' : 'Focus'} ${name}'s screen share`}
  onclick={onclick}
  oncontextmenu={oncontextmenu}
  onkeydown={openContextMenuFromKeyboard}
>
  {#if track}
    <video bind:this={videoElement} autoplay playsinline muted={local}></video>
  {:else}
    <div class="screen-share-loading">
      <span>{local ? 'Starting your screen share…' : `Loading ${name}'s screen…`}</span>
    </div>
  {/if}

  <div class="screen-share-label">
    <strong>{local ? 'Your screen' : `${name}'s screen`}</strong>
    <small>{local ? 'You are sharing' : `${name} is sharing`}</small>
  </div>
</button>
