<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';

  let { emailVerified }: { emailVerified: boolean } = $props();
  type Passkey = { id: string; label: string; createdAt: string; lastUsedAt: string | null };
  let passkeys = $state<Passkey[]>([]);
  let loading = $state(true);
  let supported = $state<boolean | null>(null);
  let mode = $state<'add' | 'remove' | null>(null);
  let selected = $state<Passkey | null>(null);
  let password = $state('');
  let label = $state('Passkey');
  let busy = $state(false);
  let error = $state('');
  let notice = $state('');
  let passwordInput = $state<HTMLInputElement | null>(null);

  async function load() {
    try {
      const response = await fetch('/api/v1/auth/passkeys', { credentials: 'include' });
      if (!response.ok) throw new Error();
      passkeys = (await response.json() as { passkeys: Passkey[] }).passkeys;
    } catch { error = 'Could not load passkeys. Reopen Settings to retry.'; }
    finally { loading = false; }
  }
  onMount(() => { supported = browserSupportsWebAuthn(); void load(); });
  async function open(next: 'add' | 'remove', passkey: Passkey | null = null) {
    mode = next;
    selected = passkey;
    password = '';
    label = 'Passkey';
    error = '';
    notice = '';
    await tick();
    passwordInput?.focus();
  }
  function close() { mode = null; selected = null; password = ''; }
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !mode) return;
    const action = mode;
    const currentPassword = password;
    password = '';
    busy = true;
    error = '';
    notice = '';
    try {
      if (action === 'add') {
        const response = await fetch('/api/v1/auth/passkeys/options', { method: 'POST', credentials: 'include',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currentPassword }) });
        if (!response.ok) {
          const body = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(response.status === 403 ? 'Current password is incorrect.' : response.status === 429 ? 'Too many attempts. Try again later.' : body.error === 'A verified email is required to add a passkey.' ? body.error : 'Could not start passkey setup. Try again.');
        }
        const setup = await response.json() as { challengeId: string; options: Parameters<typeof startRegistration>[0]['optionsJSON'] };
        let credential;
        try { credential = await startRegistration({ optionsJSON: setup.options }); }
        catch (cause) {
          if (cause instanceof Error && (cause.name === 'NotAllowedError' || cause.name === 'AbortError')) {
            notice = 'Passkey setup canceled.';
            close();
            return;
          }
          throw new Error('Passkey setup did not complete. Try again.');
        }
        const saved = await fetch('/api/v1/auth/passkeys/complete', { method: 'POST', credentials: 'include',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challengeId: setup.challengeId, response: credential, label: label.trim() || 'Passkey' }) });
        if (!saved.ok) throw new Error(saved.status === 429 ? 'Too many attempts. Try again later.' : 'Could not verify the passkey. Try again.');
        passkeys = (await saved.json() as { passkeys: Passkey[] }).passkeys;
        notice = 'Passkey added.';
      } else if (selected) {
        const response = await fetch(`/api/v1/auth/passkeys/${selected.id}`, { method: 'DELETE', credentials: 'include',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currentPassword }) });
        if (!response.ok) throw new Error(response.status === 403 ? 'Current password is incorrect.' : response.status === 429 ? 'Too many attempts. Try again later.' : 'Could not remove the passkey. Try again.');
        passkeys = passkeys.filter((entry) => entry.id !== selected?.id);
        notice = 'Passkey removed.';
      }
      close();
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Passkey action failed. Try again.'; }
    finally { busy = false; }
  }
</script>

<section class="cubic-passkeys cubic-security-form" aria-labelledby="cubic-passkeys-title" aria-busy={busy || loading}>
  <div class="cubic-security-intro"><h3 id="cubic-passkeys-title">Passkeys</h3><p>Passkeys are stored by your device or password manager. Use one to sign in to Cubic.</p></div>
  {#if loading}<p role="status">Loading passkeys…</p>
  {:else}
    {#if passkeys.length === 0}<p class="cubic-passkeys-help">No passkeys added yet.</p>{/if}
    {#each passkeys as passkey (passkey.id)}
      <div class="cubic-passkey-row"><div><strong>{passkey.label}</strong><small>Added {new Date(passkey.createdAt).toLocaleDateString()}{passkey.lastUsedAt ? ` · Last used ${new Date(passkey.lastUsedAt).toLocaleDateString()}` : ''}</small></div><button class="cubic-control cubic-control-ghost" type="button" disabled={busy} onclick={() => void open('remove', passkey)}>Remove</button></div>
    {/each}
    {#if !emailVerified}<p class="cubic-passkeys-help">Verify your current email before adding a passkey.</p>
    {:else if supported === false}<p class="cubic-passkeys-help">This browser does not support passkey enrollment.</p>
    {:else if supported}<button class="cubic-control cubic-control-secondary cubic-passkeys-add" type="button" disabled={busy} onclick={() => void open('add')}>Add passkey</button>{/if}
    {#if mode}
      <form class="cubic-passkeys-confirm" onsubmit={submit}>
        <h4>{mode === 'add' ? 'Add passkey' : `Remove ${selected?.label ?? 'passkey'}`}</h4>
        {#if mode === 'add'}<label for="cubic-passkey-label">Passkey name</label><input id="cubic-passkey-label" bind:value={label} maxlength="64" required disabled={busy} />{/if}
        <label for="cubic-passkey-password">Current password</label>
        <input id="cubic-passkey-password" bind:this={passwordInput} type="password" bind:value={password} autocomplete="current-password" maxlength="128" required disabled={busy} />
        <div class="cubic-passkeys-actions"><button class={mode === 'remove' ? 'cubic-control cubic-control-danger' : 'cubic-control cubic-control-primary'} type="submit" disabled={busy}>{busy ? 'Working…' : mode === 'add' ? 'Continue' : 'Remove passkey'}</button><button class="cubic-control cubic-control-ghost" type="button" disabled={busy} onclick={close}>Cancel</button></div>
      </form>
    {/if}
  {/if}
  {#if error}<p class="cubic-passkeys-error" role="alert">{error}</p>{/if}
  {#if notice}<p class="cubic-passkeys-notice" role="status">{notice}</p>{/if}
</section>

<style>
  .cubic-passkeys { display: grid; gap: 9px; max-width: 520px; padding: 20px; border: 1px solid var(--cubic-border); border-radius: var(--cubic-control-radius); background: var(--cubic-bg-2); }
  .cubic-security-intro { margin-bottom: 8px; }
  .cubic-security-intro h3 { margin: 0; font-size: 1rem; }
  .cubic-security-intro p, .cubic-passkeys-help, .cubic-passkey-row small { margin: 6px 0 0; color: var(--cubic-muted); font-size: .83rem; line-height: 1.45; }
  .cubic-passkey-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; padding: 10px 0; border-top: 1px solid var(--cubic-border); }
  .cubic-passkey-row div { min-width: 0; }
  .cubic-passkey-row strong, .cubic-passkey-row small { display: block; overflow-wrap: anywhere; }
  .cubic-passkeys-add { justify-self: start; }
  .cubic-passkeys-confirm { display: grid; gap: 9px; padding-top: 12px; border-top: 1px solid var(--cubic-border); }
  .cubic-passkeys-confirm h4 { margin: 0 0 4px; font-size: .9rem; }
  .cubic-passkeys-confirm label { font-size: .84rem; font-weight: 650; }
  .cubic-passkeys-confirm input { width: 100%; min-width: 0; min-height: 44px; padding: 9px 11px; border: 1px solid var(--cubic-control-border); border-radius: var(--cubic-control-radius); background: var(--cubic-control-bg); color: var(--cubic-text); font: inherit; }
  .cubic-passkeys-confirm input:focus-visible { outline: 2px solid var(--cubic-brand-focus); outline-offset: 2px; }
  .cubic-passkeys-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .cubic-passkeys-actions button, .cubic-passkey-row button { min-height: 44px; }
  .cubic-passkeys-error, .cubic-passkeys-notice { margin: 4px 0 0; font-size: .83rem; line-height: 1.4; }
  .cubic-passkeys-error { color: var(--cubic-red); }
  .cubic-passkeys-notice { color: var(--cubic-text); }
  @media (max-width: 680px) { .cubic-passkeys { padding: 16px; } }
</style>
