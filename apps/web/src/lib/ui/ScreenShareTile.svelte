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

  let videoElement: HTMLVideoElement | null = null;

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
</script>

<button
  class="screen-share-tile"
  class:focused
  type="button"
  aria-label={`${focused ? 'Unfocus' : 'Focus'} ${name}'s screen share`}
  title={`${focused ? 'Unfocus' : 'Focus'} ${name}'s screen share`}
  onclick={onclick}
  oncontextmenu={oncontextmenu}
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
