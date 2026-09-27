<script lang="ts">
  import { onMount } from 'svelte';

  let state = $state<'consuming' | 'verified' | 'changed' | 'invalid' | 'expired' | 'used' | 'conflict' | 'unavailable'>('consuming');

  onMount(() => {
    const fragment = location.hash;
    history.replaceState(history.state, '', location.pathname + location.search);
    const token = new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : '').get('token');
    if (!token) { state = 'invalid'; return; }
    void (async () => {
      try {
        const response = await fetch('/api/v1/auth/email/verify', {
          method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token })
        });
        const body = await response.json() as { status?: string };
        state = body.status === 'verified' || body.status === 'changed' || body.status === 'expired' || body.status === 'used' || body.status === 'conflict' || body.status === 'invalid'
          ? body.status : 'unavailable';
      } catch {
        state = 'unavailable';
      }
    })();
  });
</script>

<svelte:head><title>Verify email — Cubic</title></svelte:head>

<main class="auth-shell">
  <section class="auth-panel" aria-live="polite">
    <a class="auth-brand" href="/"><img src="/images/cubic-w-nobg.png" alt="" /><span>Cubic</span></a>
    <div class="auth-copy">
      <p class="eyebrow">ACCOUNT SECURITY</p>
      {#if state === 'consuming'}<h1>Verifying email…</h1><p>Checking your verification link.</p>
      {:else if state === 'verified'}<h1>Email verified.</h1><p>Your current account email is now verified. Your sessions remain signed in.</p>
      {:else if state === 'changed'}<h1>Email changed.</h1><p>Your new email is verified. All sessions were signed out. Sign in again with your username or new email.</p>
      {:else if state === 'expired'}<h1>Link expired.</h1><p>Sign in and request another verification email from Security Settings.</p>
      {:else if state === 'used'}<h1>Link already used.</h1><p>This verification link has already been used. Sign in to check your email status.</p>
      {:else if state === 'conflict'}<h1>Email unavailable.</h1><p>This address is no longer available. Sign in and request a change to another email.</p>
      {:else if state === 'invalid'}<h1>Invalid link.</h1><p>Check the link or sign in to request another verification email.</p>
      {:else}<h1>Could not verify email.</h1><p>Try again later or request another verification email from Security Settings.</p>{/if}
    </div>
    {#if state !== 'consuming'}<a class="button button-primary" href={state === 'changed' ? '/login' : '/app'}>{state === 'changed' ? 'Sign in again' : 'Continue to Cubic'}</a>{/if}
  </section>
</main>
