<script lang="ts">
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
</section>

<style>
  .cubic-security-settings { width: min(100%, 760px); margin: 0 auto; }
  .cubic-security-title { margin-bottom: 20px; }
  .cubic-security-title small { color: var(--cubic-muted); font-size: .7rem; font-weight: 800; letter-spacing: .08em; }
  .cubic-security-title h2 { margin: 4px 0 0; font-size: 1.35rem; }
  .cubic-security-form { display: grid; gap: 9px; max-width: 520px; padding: 20px; border: 1px solid var(--cubic-border); border-radius: var(--cubic-control-radius); background: var(--cubic-bg-2); }
  .cubic-security-intro { margin-bottom: 8px; }
  .cubic-security-intro h3 { margin: 0; font-size: 1rem; }
  .cubic-security-intro p { margin: 6px 0 0; color: var(--cubic-muted); font-size: .83rem; line-height: 1.45; }
  .cubic-security-form label { margin-top: 5px; font-size: .84rem; font-weight: 650; }
  .cubic-security-form input { width: 100%; min-width: 0; min-height: 44px; padding: 9px 11px; border: 1px solid var(--cubic-control-border); border-radius: var(--cubic-control-radius); background: var(--cubic-control-bg); color: var(--cubic-text); font: inherit; }
  .cubic-security-form input:focus-visible { outline: 2px solid var(--cubic-brand-focus); outline-offset: 2px; }
  .cubic-security-form input:disabled { opacity: var(--cubic-control-disabled-opacity); }
  .cubic-security-actions { margin-top: 12px; }
  .cubic-security-error, .cubic-security-success { margin: 6px 0 0; font-size: .83rem; line-height: 1.4; }
  .cubic-security-error { color: var(--cubic-red); }
  .cubic-security-success { color: var(--cubic-text); }
  @media (max-width: 680px) { .cubic-security-form { padding: 16px; } .cubic-security-actions button { min-height: 44px; } }
</style>
