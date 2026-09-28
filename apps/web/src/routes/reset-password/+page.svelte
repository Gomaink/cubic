<script lang="ts">
  import { onMount } from 'svelte';
  let resetToken: string | null = null;
  let resetStatus = $state<'ready' | 'submitting' | 'changed' | 'invalid' | 'expired' | 'used' | 'unavailable'>('ready');
  let newPassword = $state('');
  let confirmPassword = $state('');
  let error = $state('');
  onMount(() => {
    const fragment = location.hash;
    history.replaceState(history.state, '', location.pathname + location.search);
    resetToken = new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : '').get('token');
    if (!resetToken) resetStatus = 'invalid';
  });
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!resetToken || resetStatus === 'submitting') return;
    error = '';
    if (newPassword !== confirmPassword) { error = 'New passwords do not match.'; return; }
    resetStatus = 'submitting';
    try {
      const response = await fetch('/api/v1/auth/password/reset', { method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: resetToken, newPassword }) });
      const result = await response.json().catch(() => ({})) as { status?: string };
      resetStatus = result.status === 'changed' || result.status === 'expired' || result.status === 'used' || result.status === 'invalid'
        ? result.status : 'unavailable';
    } catch { resetStatus = 'unavailable'; }
    finally { resetToken = null; newPassword = ''; confirmPassword = ''; }
  }
</script>

<svelte:head><title>Reset password — Cubic</title></svelte:head>
<main class="auth-shell">
  <section class="auth-panel">
    <a class="auth-brand" href="/"><img src="/images/cubic-w-nobg.png" alt="" /><span>Cubic</span></a>
    <div class="auth-copy"><p class="eyebrow">ACCOUNT RECOVERY</p>
      {#if resetStatus === 'changed'}<h1>Password changed.</h1><p>All previous sessions were signed out. Sign in with your new password.</p>
      {:else if resetStatus === 'expired'}<h1>Link expired.</h1><p>Request another reset link from the login page.</p>
      {:else if resetStatus === 'used'}<h1>Link already used.</h1><p>Request another reset link if you still need to change your password.</p>
      {:else if resetStatus === 'invalid'}<h1>Invalid link.</h1><p>Check the link or request another reset link.</p>
      {:else if resetStatus === 'unavailable'}<h1>Could not reset password.</h1><p>Try again later or request a new link.</p>
      {:else}<h1>Choose a new password.</h1><p>This link expires 30 minutes after it was sent.</p>{/if}
    </div>
    {#if resetStatus === 'ready' || resetStatus === 'submitting'}
      <form class="auth-form" onsubmit={submit}>
        <label><span>New password</span><input type="password" bind:value={newPassword} autocomplete="new-password" minlength="10" maxlength="128" required disabled={resetStatus === 'submitting'} /></label>
        <label><span>Confirm new password</span><input type="password" bind:value={confirmPassword} autocomplete="new-password" maxlength="128" required disabled={resetStatus === 'submitting'} aria-invalid={error ? 'true' : undefined} /></label>
        {#if error}<p class="form-error" role="alert">{error}</p>{/if}
        <button class="button button-primary" type="submit" disabled={resetStatus === 'submitting'}>{resetStatus === 'submitting' ? 'Changing password…' : 'Reset password'}</button>
      </form>
    {/if}
    <p class="auth-switch"><a href="/login">{resetStatus === 'changed' ? 'Sign in to Cubic' : 'Back to log in'}</a></p>
  </section>
</main>
