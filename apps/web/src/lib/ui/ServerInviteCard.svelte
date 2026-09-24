<script lang="ts">
  import { onMount } from 'svelte';
  import { joinServerInvite, type ServerInvitePreview, type ServerInvitePreviewQueue } from '$lib/server-invite-links';

  let { token, queue, onJoined, onGoToServer }: {
    token: string;
    queue: ServerInvitePreviewQueue;
    onJoined: (serverId: string) => void;
    onGoToServer: (serverId: string) => void;
  } = $props();

  let cardElement = $state<HTMLElement | null>(null);
  let cardStatus = $state<'idle' | 'loading' | 'available' | 'unavailable' | 'error' | 'joining'>('idle');
  let preview = $state<ServerInvitePreview | null>(null);
  let requestGeneration = 0;
  let mounted = false;

  async function resolve(automatic: boolean) {
    if (cardStatus === 'loading' || cardStatus === 'joining') return;
    const generation = ++requestGeneration;
    cardStatus = 'loading';
    if (!automatic) queue.invalidate(token);
    const result = await queue.preview(token, automatic);
    if (!mounted || generation !== requestGeneration) return;
    if (result.kind === 'available') {
      preview = result.preview;
      cardStatus = 'available';
    } else {
      preview = null;
      cardStatus = result.kind === 'deferred' ? 'idle' : result.kind;
    }
  }

  async function join() {
    if (cardStatus !== 'available' || !preview || preview.alreadyMember) return;
    const generation = ++requestGeneration;
    cardStatus = 'joining';
    try {
      const response = await joinServerInvite(token);
      if (!mounted || generation !== requestGeneration) return;
      if (response.status === 404) {
        queue.invalidate(token);
        preview = null;
        cardStatus = 'unavailable';
      } else if (response.status === 401) {
        window.location.assign(`/invite#${token}`);
      } else if (!response.ok) {
        cardStatus = 'error';
      } else {
        const joined = await response.json() as { server: { id: string } };
        if (!mounted || generation !== requestGeneration) return;
        preview = { ...preview, server: { ...preview.server, id: joined.server.id }, alreadyMember: true };
        cardStatus = 'available';
        onJoined(joined.server.id);
      }
    } catch {
      if (mounted && generation === requestGeneration) cardStatus = 'error';
    }
  }

  onMount(() => {
    mounted = true;
    if (!cardElement || typeof IntersectionObserver === 'undefined') return () => { mounted = false; requestGeneration += 1; };
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void resolve(true);
    }, { root: cardElement.closest('.messages'), rootMargin: '100px' });
    observer.observe(cardElement);
    return () => { mounted = false; requestGeneration += 1; observer.disconnect(); };
  });
</script>

<section bind:this={cardElement} class="cubic-server-invite-card" role="group" aria-label="Server invite">
  <span class="cubic-server-invite-card-mark" aria-hidden="true">#</span>
  <div class="cubic-server-invite-card-detail">
    <small>SERVER INVITE</small>
    {#if cardStatus === 'idle'}
      <p>Invitation ready to check.</p>
      <button type="button" onclick={() => void resolve(false)}>Check invitation</button>
    {:else if cardStatus === 'loading'}
      <p role="status">Checking invitation…</p>
    {:else if cardStatus === 'unavailable'}
      <p role="status">Invite unavailable.</p>
    {:else if cardStatus === 'error'}
      <p role="alert">Could not check this invitation.</p>
      <button type="button" onclick={() => void resolve(false)}>Retry invitation</button>
    {:else if preview}
      <strong class="cubic-server-invite-card-name">{preview.server.name}</strong>
      <div class="cubic-server-invite-card-actions">
        {#if preview.alreadyMember}
          <button type="button" onclick={() => onGoToServer(preview!.server.id)}>Go to server</button>
        {:else}
          <button type="button" onclick={join} disabled={cardStatus === 'joining'}>{cardStatus === 'joining' ? 'Joining…' : 'Join server'}</button>
        {/if}
        {#if cardStatus === 'available'}<button class="cubic-server-invite-card-refresh" type="button" onclick={() => void resolve(false)}>Refresh invitation</button>{/if}
      </div>
    {/if}
  </div>
</section>
