<script lang="ts">
  let {
    track = null,
    name,
    local = false,
    speaking = false,
    cameraEnabled = false,
    focused = false,
    onclick
  }: {
    track?: any | null;
    name: string;
    local?: boolean;
    speaking?: boolean;
    cameraEnabled?: boolean;
    focused?: boolean;
    onclick?: () => void;
  } = $props();

  let videoElement: HTMLVideoElement | null = null;

  $effect(() => {
    const currentTrack = track;
    const element = videoElement;

    if (!currentTrack || !element || !cameraEnabled) return;

    currentTrack.attach(element);
    return () => {
      try {
        currentTrack.detach(element);
      } catch {}
    };
  });
</script>

<button
  class="video-tile"
  class:speaking
  class:focused
  class:camera-off={!cameraEnabled || !track}
  type="button"
  aria-label={`${focused ? 'Unfocus' : 'Focus'} ${name}`}
  title={`${focused ? 'Unfocus' : 'Focus'} ${name}`}
  onclick={onclick}
>
  {#if cameraEnabled && track}
    <video
      bind:this={videoElement}
      class:mirrored={local}
      autoplay
      playsinline
      muted={local}
    ></video>
  {:else}
    <div class="video-placeholder">
      <span>{name.slice(0, 1).toUpperCase()}</span>
    </div>
  {/if}

  <div class="video-tile-label">
    <strong>{name}{local ? ' · you' : ''}</strong>
  </div>
</button>
