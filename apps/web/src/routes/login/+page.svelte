<script lang="ts">
  import { onMount } from 'svelte';
  import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
  let { data } = $props();
  let recoveryAvailable = $state(false);
  let passkeySupported = $state(false);
  onMount(() => {
    passkeySupported = browserSupportsWebAuthn();
    void fetch('/api/v1/auth/capabilities').then((response) => response.ok ? response.json() : null)
      .then((value) => { recoveryAvailable = value?.passwordRecoveryAvailable === true; }).catch(() => {});
  });
  let identifier = $state('');
  let password = $state('');
  let error = $state('');
  let submitting = $state(false);
  let passkeySubmitting = $state(false);
  let passkeyNotice = $state('');

  async function signInWithPasskey() {
    error = '';
    passkeyNotice = '';
    passkeySubmitting = true;
    try {
      const started = await fetch('/api/v1/auth/passkeys/authentication/options', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}'
      });
      if (!started.ok) throw new Error(started.status === 429 ? 'Too many attempts. Try again later.' : 'Passkey sign-in could not be completed.');
      const ceremony = await started.json();
      let assertion;
      try {
        assertion = await startAuthentication({ optionsJSON: ceremony.options });
      } catch (cause) {
        if (cause instanceof Error && (cause.name === 'AbortError' || cause.name === 'NotAllowedError')) {
          passkeyNotice = 'Passkey sign-in canceled.';
          return;
        }
        throw new Error('Passkey sign-in could not be completed.');
      }
      const completed = await fetch('/api/v1/auth/passkeys/authentication/complete', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challengeId: ceremony.challengeId, response: assertion })
      });
      if (!completed.ok) throw new Error(completed.status === 429 ? 'Too many attempts. Try again later.' : 'Passkey sign-in could not be completed.');
      window.location.assign(data.continueInvite ? '/invite' : '/app');
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Passkey sign-in could not be completed.';
    } finally {
      passkeySubmitting = false;
    }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    submitting = true;

    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ identifier, password })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        error = payload.error ?? 'Unable to log in.';
        return;
      }

      window.location.assign(data.continueInvite ? '/invite' : '/app');
    } catch {
      error = 'Cubic could not reach the API.';
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head><title>Log in — Cubic</title></svelte:head>

<main class="auth-shell">
  <section class="auth-panel">
    <a class="auth-brand" href="/">
      <img src="/images/cubic-w-nobg.png" alt="" />
      <span>Cubic</span>
    </a>

    <div class="auth-copy">
      <p class="eyebrow">Welcome back</p>
      <h1>Log in.</h1>
      <p>Your session is stored server-side and the browser only keeps an HttpOnly session token.</p>
    </div>

    <form class="auth-form" onsubmit={submit}>
      <label>
        <span>E-mail or username</span>
        <input bind:value={identifier} autocomplete="username" required maxlength="254" placeholder="samuel" />
      </label>
      <label>
        <span>Password</span>
        <input bind:value={password} type="password" autocomplete="current-password" required maxlength="128" placeholder="••••••••••" />
      </label>

      {#if error}<p class="form-error" role="alert">{error}</p>{/if}

      <button class="button button-primary button-full" type="submit" disabled={submitting}>
        {submitting ? 'Signing in…' : 'Log in'}
      </button>
    </form>

    {#if passkeySupported}
      <div class="auth-passkey-choice">
        <p class="auth-passkey-divider"><span>or</span></p>
        <button class="cubic-control cubic-control-secondary auth-passkey-button" type="button" disabled={submitting || passkeySubmitting} onclick={signInWithPasskey}>
          {passkeySubmitting ? 'Waiting for passkey…' : 'Sign in with passkey'}
        </button>
        {#if passkeyNotice}<p class="auth-passkey-notice" role="status">{passkeyNotice}</p>{/if}
      </div>
    {/if}

    {#if recoveryAvailable}<p class="auth-switch"><a href="/forgot-password">Forgot password?</a></p>{/if}

    <p class="auth-switch">New to Cubic? <a href={data.continueInvite ? '/register?returnTo=invite' : '/register'}>Create an account</a>.</p>
  </section>
  <aside class="auth-aside" aria-hidden="true">
    <span>alpha.2</span>
    <strong>Identity first.<br />Messages next.</strong>
  </aside>
</main>

<style>
  .auth-passkey-choice { display: grid; gap: 12px; margin-top: 18px; }
  .auth-passkey-divider { display: flex; align-items: center; gap: 12px; margin: 0; color: var(--cubic-muted); font-size: .8rem; }
  .auth-passkey-divider::before, .auth-passkey-divider::after { content: ''; height: 1px; flex: 1; background: var(--cubic-border); }
  .auth-passkey-button { width: 100%; min-height: 44px; }
  .auth-passkey-notice { margin: 0; color: var(--cubic-muted); font-size: .83rem; }
</style>
