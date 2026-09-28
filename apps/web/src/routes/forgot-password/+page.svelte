<script lang="ts">
  import { onMount } from 'svelte';
  let available = $state<boolean | null>(null);
  let identifier = $state('');
  let busy = $state(false);
  let sent = $state(false);
  let error = $state('');
  const generic = 'If an eligible account exists, password reset instructions have been sent.';
  onMount(() => {
    void fetch('/api/v1/auth/capabilities').then((response) => response.ok ? response.json() : null)
      .then((value) => { available = value?.passwordRecoveryAvailable === true; }).catch(() => { available = false; });
  });
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    error = '';
    try {
      const response = await fetch('/api/v1/auth/password/recovery', { method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier }) });
      if (response.status === 429) throw new Error('Too many requests. Try again later.');
      if (!response.ok) throw new Error('Could not submit the request. Try again later.');
      sent = true;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not submit the request. Try again later.';
    } finally { busy = false; }
  }
</script>

<svelte:head><title>Forgot password — Cubic</title></svelte:head>
<main class="auth-shell">
  <section class="auth-panel">
    <a class="auth-brand" href="/"><img src="/images/cubic-w-nobg.png" alt="" /><span>Cubic</span></a>
    <div class="auth-copy"><p class="eyebrow">ACCOUNT RECOVERY</p><h1>Reset your password.</h1><p>Enter your email or username. Recovery is available for accounts with a verified email.</p></div>
    {#if available === null}<p role="status">Loading recovery options…</p>
    {:else if !available}<p role="status">Password recovery is unavailable on this Cubic instance.</p>
    {:else if sent}<p role="status">{generic}</p>
    {:else}
      <form class="auth-form" onsubmit={submit}>
        <label><span>Email or username</span><input bind:value={identifier} autocomplete="username" required maxlength="254" /></label>
        {#if error}<p class="form-error" role="alert">{error}</p>{/if}
        <button class="button button-primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset instructions'}</button>
      </form>
    {/if}
    <p class="auth-switch"><a href="/login">Back to log in</a></p>
  </section>
</main>
