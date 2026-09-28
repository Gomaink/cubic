<script lang="ts">
  import { onMount } from 'svelte';
  import PasskeySettings from './PasskeySettings.svelte';
  type EmailState = { email: string; emailVerifiedAt: string | null; mailDeliveryAvailable: boolean };
  let emailState = $state<EmailState | null>(null);
  let emailLoading = $state(true);
  let emailError = $state('');
  let emailNotice = $state('');
  let sendingVerification = $state(false);
  let changingEmail = $state(false);
  let emailBusy = $state(false);
  let newEmail = $state('');
  let emailPassword = $state('');

  async function loadEmail() {
    try {
      const response = await fetch('/api/v1/auth/security', { credentials: 'include' });
      if (!response.ok) throw new Error();
      emailState = await response.json() as EmailState;
    } catch {
      emailError = 'Could not load email security details. Try reopening Settings.';
    } finally {
      emailLoading = false;
    }
  }
  onMount(() => { void loadEmail(); });

  async function resendVerification() {
    if (sendingVerification) return;
    sendingVerification = true;
    emailError = '';
    emailNotice = '';
    try {
      const response = await fetch('/api/v1/auth/email/verification', { method: 'POST', credentials: 'include' });
      if (response.status === 429) throw new Error('Too many requests. Try again later.');
      if (!response.ok) throw new Error('Verification email could not be sent. Try again later.');
      emailNotice = 'Verification email sent. Check your inbox.';
    } catch (cause) {
      emailError = cause instanceof Error ? cause.message : 'Verification email could not be sent.';
    } finally {
      sendingVerification = false;
    }
  }

  async function requestEmailChange(event: SubmitEvent) {
    event.preventDefault();
    if (emailBusy) return;
    emailBusy = true;
    emailError = '';
    emailNotice = '';
    try {
      const response = await fetch('/api/v1/auth/email/change', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newEmail, currentPassword: emailPassword })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        const safe = ['Current password is incorrect.', 'That email address is unavailable.', 'Enter a different email address.', 'Enter a valid new email and current password.'];
        throw new Error(response.status === 429 ? 'Too many attempts. Try again later.' : safe.includes(body.error ?? '') ? body.error : 'Email change could not be started. Try again later.');
      }
      emailNotice = 'Verification email sent to the new address. Your current email remains unchanged until verification.';
      newEmail = '';
      emailPassword = '';
      changingEmail = false;
    } catch (cause) {
      emailError = cause instanceof Error ? cause.message : 'Email change could not be started.';
    } finally {
      emailBusy = false;
    }
  }

  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');
  let busy = $state(false);
  let error = $state('');
  let success = $state('');
  let confirmationInput = $state<HTMLInputElement | null>(null);

  async function changePassword(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    error = '';
    success = '';
    if (newPassword !== confirmPassword) {
      error = 'New passwords do not match.';
      confirmationInput?.focus();
      return;
    }

    busy = true;
    try {
      const response = await fetch('/api/v1/auth/password', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
      });
      if (response.status === 401) {
        window.location.assign('/login');
        return;
      }
      if (response.status === 403) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error === 'Current password is incorrect.'
          ? 'Current password is incorrect.' : 'Could not change password. Try again.');
      }
      if (response.status === 400) throw new Error('Use 10–128 characters for the new password.');
      if (response.status === 429) throw new Error('Too many attempts. Try again later.');
      if (!response.ok) throw new Error('Could not change password. Try again.');
      currentPassword = '';
      newPassword = '';
      confirmPassword = '';
      success = 'Password changed. Other sessions were signed out.';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not change password. Try again.';
    } finally {
      busy = false;
    }
  }
</script>

<section class="cubic-security-settings" aria-labelledby="cubic-security-title">
  <div class="cubic-security-title"><small>YOUR ACCOUNT</small><h2 id="cubic-security-title">Security</h2></div>
  <form class="cubic-security-form" onsubmit={changePassword} aria-busy={busy} aria-describedby={error ? 'cubic-security-error' : undefined}>
    <div class="cubic-security-intro"><h3>Password</h3><p>Changing your password signs out your other active sessions.</p></div>
    <label for="cubic-current-password">Current password</label>
    <input id="cubic-current-password" type="password" bind:value={currentPassword} autocomplete="current-password" maxlength="128" required disabled={busy} />
    <label for="cubic-new-password">New password</label>
    <input id="cubic-new-password" type="password" bind:value={newPassword} autocomplete="new-password" minlength="10" maxlength="128" required disabled={busy} />
    <label for="cubic-confirm-password">Confirm new password</label>
    <input id="cubic-confirm-password" bind:this={confirmationInput} type="password" bind:value={confirmPassword} autocomplete="new-password" maxlength="128" required disabled={busy} aria-invalid={error === 'New passwords do not match.' ? 'true' : undefined} />
    <div class="cubic-security-actions"><button class="cubic-control cubic-control-primary" type="submit" disabled={busy}>{busy ? 'Changing password…' : 'Change password'}</button></div>
    {#if error}<p id="cubic-security-error" class="cubic-security-error" role="alert">{error}</p>{/if}
    {#if success}<p class="cubic-security-success" role="status">{success}</p>{/if}
  </form>
  <section class="cubic-security-form cubic-security-email" aria-labelledby="cubic-security-email-title" aria-busy={emailLoading || sendingVerification || emailBusy}>
    <div class="cubic-security-intro"><h3 id="cubic-security-email-title">Email</h3><p>Your email is private account information.</p></div>
    {#if emailLoading}
      <p role="status">Loading email details…</p>
    {:else if emailState}
      <div class="cubic-security-email-detail"><span>Current email</span><strong>{emailState.email}</strong></div>
      <div class="cubic-security-email-detail"><span>Status</span><strong>{emailState.emailVerifiedAt ? 'Verified' : 'Unverified'}</strong></div>
      {#if !emailState.mailDeliveryAvailable}
        <p class="cubic-security-help">Email delivery is not configured on this Cubic instance.</p>
      {:else}
        {#if !emailState.emailVerifiedAt}
          <button class="cubic-control cubic-control-secondary" type="button" disabled={sendingVerification} onclick={resendVerification}>{sendingVerification ? 'Sending…' : 'Send verification email'}</button>
        {/if}
        {#if changingEmail}
          <form class="cubic-security-email-change" onsubmit={requestEmailChange}>
            <p>The new address must be verified before it replaces your current email. Completing the change signs you out everywhere.</p>
            <label for="cubic-new-email">New email</label>
            <input id="cubic-new-email" type="email" bind:value={newEmail} autocomplete="email" maxlength="254" required disabled={emailBusy} />
            <label for="cubic-email-current-password">Current password</label>
            <input id="cubic-email-current-password" type="password" bind:value={emailPassword} autocomplete="current-password" maxlength="128" required disabled={emailBusy} />
            <div class="cubic-security-email-actions">
              <button class="cubic-control cubic-control-primary" type="submit" disabled={emailBusy}>{emailBusy ? 'Sending…' : 'Send change verification'}</button>
              <button class="cubic-control cubic-control-ghost" type="button" disabled={emailBusy} onclick={() => { changingEmail = false; emailPassword = ''; newEmail = ''; }}>Cancel</button>
            </div>
          </form>
        {:else}
          <button class="cubic-control cubic-control-secondary" type="button" onclick={() => changingEmail = true}>Change email</button>
        {/if}
      {/if}
    {/if}
    {#if emailError}<p class="cubic-security-error" role="alert">{emailError}</p>{/if}
    {#if emailNotice}<p class="cubic-security-success" role="status">{emailNotice}</p>{/if}
  </section>
  <PasskeySettings emailVerified={Boolean(emailState?.emailVerifiedAt)} />
</section>

<style>
  .cubic-security-settings { width: min(100%, 760px); margin: 0 auto; }
  .cubic-security-settings { display: grid; gap: 18px; }
  .cubic-security-title { margin-bottom: 20px; }
  .cubic-security-title small { color: var(--cubic-muted); font-size: .7rem; font-weight: 800; letter-spacing: .08em; }
  .cubic-security-title h2 { margin: 4px 0 0; font-size: 1.35rem; }
  .cubic-security-form { display: grid; gap: 9px; max-width: 520px; padding: 20px; border: 1px solid var(--cubic-border); border-radius: var(--cubic-control-radius); background: var(--cubic-bg-2); }
  .cubic-security-intro { margin-bottom: 8px; }
  .cubic-security-intro h3 { margin: 0; font-size: 1rem; }
  .cubic-security-intro p { margin: 6px 0 0; color: var(--cubic-muted); font-size: .83rem; line-height: 1.45; }
  .cubic-security-form label { margin-top: 5px; font-size: .84rem; font-weight: 650; }
  .cubic-security-settings input { width: 100%; min-width: 0; min-height: 44px; padding: 9px 11px; border: 1px solid var(--cubic-control-border); border-radius: var(--cubic-control-radius); background: var(--cubic-control-bg); color: var(--cubic-text); font: inherit; }
  .cubic-security-settings input:focus-visible { outline: 2px solid var(--cubic-brand-focus); outline-offset: 2px; }
  .cubic-security-settings input:disabled { opacity: var(--cubic-control-disabled-opacity); }
  .cubic-security-actions { margin-top: 12px; }
  .cubic-security-error, .cubic-security-success { margin: 6px 0 0; font-size: .83rem; line-height: 1.4; }
  .cubic-security-error { color: var(--cubic-red); }
  .cubic-security-success { color: var(--cubic-text); }
  .cubic-security-email-detail { display: grid; gap: 3px; min-width: 0; }
  .cubic-security-email-detail span { color: var(--cubic-muted); font-size: .78rem; }
  .cubic-security-email-detail strong { overflow-wrap: anywhere; font-size: .9rem; }
  .cubic-security-help, .cubic-security-email-change p { margin: 4px 0; color: var(--cubic-muted); font-size: .83rem; line-height: 1.45; }
  .cubic-security-email > button { justify-self: start; }
  .cubic-security-email-change { display: grid; gap: 9px; padding-top: 10px; border-top: 1px solid var(--cubic-border); }
  .cubic-security-email-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  @media (max-width: 680px) { .cubic-security-form { padding: 16px; } .cubic-security-actions button { min-height: 44px; } }
</style>
