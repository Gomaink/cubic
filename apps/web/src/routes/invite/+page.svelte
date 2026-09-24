<script lang="ts">
  import { onMount } from 'svelte';

  const continuationKey = 'cubic:pending-server-invite';
  const serverSelectionKey = 'cubic:open-server';
  const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
  type Preview = { valid: true; server: { id: string; name: string }; alreadyMember?: boolean };

  let inviteState = $state<'loading' | 'guest' | 'ready' | 'already' | 'unavailable' | 'network-error' | 'joining'>('loading');
  let preview = $state<Preview | null>(null);
  let error = $state('');
  let token: string | null = null;

  function clearInvite() {
    token = null;
    try { sessionStorage.removeItem(continuationKey); } catch { /* Private-mode storage may be unavailable. */ }
  }

  async function loadPreview() {
    if (!token) { inviteState = 'unavailable'; return; }
    inviteState = 'loading';
    error = '';
    try {
      const [inviteResponse, sessionResponse] = await Promise.all([
        fetch('/api/v1/server-invite-links/preview', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          credentials: 'include', cache: 'no-store', body: JSON.stringify({ token })
        }),
        fetch('/api/v1/auth/me', { credentials: 'include', cache: 'no-store' })
      ]);
      if (inviteResponse.status === 404) { clearInvite(); inviteState = 'unavailable'; return; }
      if (!inviteResponse.ok || (!sessionResponse.ok && sessionResponse.status !== 401)) throw new Error('Could not reach Cubic.');
      preview = await inviteResponse.json() as Preview;
      inviteState = sessionResponse.ok ? (preview.alreadyMember ? 'already' : 'ready') : 'guest';
    } catch {
      error = 'Could not check this invitation. Please try again.';
      inviteState = 'network-error';
    }
  }

  async function join() {
    if (!token || !preview || inviteState !== 'ready') return;
    inviteState = 'joining';
    error = '';
    try {
      const response = await fetch('/api/v1/server-invite-links/join', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        credentials: 'include', cache: 'no-store', body: JSON.stringify({ token })
      });
      if (response.status === 404) { clearInvite(); inviteState = 'unavailable'; return; }
      if (response.status === 401) { inviteState = 'guest'; return; }
      if (!response.ok) throw new Error('Could not join this server.');
      const result = await response.json() as { server: { id: string } };
      clearInvite();
      openServer(result.server.id);
    } catch {
      error = 'Could not join this server. Please try again.';
      inviteState = 'ready';
    }
  }

  function openServer(serverId: string) {
    clearInvite();
    try { sessionStorage.setItem(serverSelectionKey, serverId); } catch { /* Navigation still works without selection. */ }
    window.location.assign('/app');
  }

  onMount(() => {
    const fragment = window.location.hash.slice(1);
    if (fragment) {
      window.history.replaceState(window.history.state, '', '/invite');
      if (!tokenPattern.test(fragment)) { clearInvite(); inviteState = 'unavailable'; return; }
      token = fragment;
      try { sessionStorage.setItem(continuationKey, fragment); } catch { /* Current-tab preview still works. */ }
    } else {
      try { token = sessionStorage.getItem(continuationKey); } catch { token = null; }
    }
    if (!token || !tokenPattern.test(token)) { clearInvite(); inviteState = 'unavailable'; return; }
    void loadPreview();
  });
</script>

<svelte:head>
  <title>Server invitation — Cubic</title>
  <meta name="referrer" content="no-referrer" />
</svelte:head>

<main class="auth-shell cubic-invite-page">
  <section class="auth-panel cubic-invite-panel">
    <a class="auth-brand" href="/"><img src="/images/cubic-w-nobg.png" alt="" /><span>Cubic</span></a>
    <div class="auth-copy">
      <p class="eyebrow">SERVER INVITATION</p>
      <h1>Join a server.</h1>
    </div>
    {#if inviteState === 'loading'}
      <p role="status">Checking invitation…</p>
    {:else if inviteState === 'unavailable'}
      <p role="alert">Invite unavailable.</p>
      <a class="button button-ghost" href="/">Back to Cubic</a>
    {:else if inviteState === 'network-error'}
      <p role="alert">{error}</p>
      <button class="button button-primary" type="button" onclick={loadPreview}>Retry</button>
    {:else if preview}
      <p>You've been invited to <strong>{preview.server.name}</strong>.</p>
      {#if inviteState === 'guest'}
        <p>Log in or create an account to join.</p>
        <div class="cubic-invite-actions"><a class="button button-primary" href="/login?returnTo=invite">Log in</a><a class="button button-ghost" href="/register?returnTo=invite">Create account</a></div>
      {:else if inviteState === 'already'}
        <button class="button button-primary" type="button" onclick={() => openServer(preview!.server.id)}>Go to server</button>
      {:else}
        {#if error}<p role="alert">{error}</p>{/if}
        <button class="button button-primary" type="button" onclick={join} disabled={inviteState === 'joining'}>{inviteState === 'joining' ? 'Joining…' : 'Join server'}</button>
      {/if}
      <button class="button button-ghost" type="button" onclick={() => { clearInvite(); window.location.assign('/'); }}>Dismiss invitation</button>
    {/if}
  </section>
</main>
