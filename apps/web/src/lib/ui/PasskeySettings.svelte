<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';

  let { emailVerified }: { emailVerified: boolean } = $props();
  type Passkey = { id: string; label: string; createdAt: string; lastUsedAt: string | null; deviceType: string; backedUp: boolean };
  let passkeys = $state<Passkey[]>([]);
  let loading = $state(true);
  let supported = $state<boolean | null>(null);
  let mode = $state<'add' | 'rename' | 'remove' | null>(null);
  let confirmMethod = $state<'password' | 'passkey'>('password');
  let selected = $state<Passkey | null>(null);
  let password = $state('');
  let label = $state('Passkey');
  let busy = $state(false);
  let error = $state('');
  let notice = $state('');
  let passwordInput = $state<HTMLInputElement | null>(null);
  let labelInput = $state<HTMLInputElement | null>(null);
  let addButton = $state<HTMLButtonElement | null>(null);
  let passkeyConfirmButton = $state<HTMLButtonElement | null>(null);
  let actionTrigger: HTMLButtonElement | null = null;

  function deviceDescription(passkey: Passkey) {
    if (passkey.deviceType === 'multiDevice') return passkey.backedUp ? 'Synced passkey · Backed up' : 'Multi-device passkey · Not backed up';
    if (passkey.deviceType === 'singleDevice') return `Device-bound passkey · ${passkey.backedUp ? 'Backed up' : 'Not backed up'}`;
    return passkey.backedUp ? 'Backed up' : 'Not backed up';
  }

  async function load() {
    try {
      const response = await fetch('/api/v1/auth/passkeys', { credentials: 'include' });
      if (!response.ok) throw new Error();
      passkeys = (await response.json() as { passkeys: Passkey[] }).passkeys;
    } catch { error = 'Could not load passkeys. Reopen Settings to retry.'; }
    finally { loading = false; }
  }
  onMount(() => { supported = browserSupportsWebAuthn(); void load(); });
  async function open(next: 'add' | 'rename' | 'remove', passkey: Passkey | null, trigger: HTMLButtonElement) {
    actionTrigger = trigger;
    mode = next;
    confirmMethod = 'password';
    selected = passkey;
    password = '';
    label = next === 'rename' ? passkey?.label ?? '' : 'Passkey';
    error = '';
    notice = '';
    await tick();
    if (next === 'rename') labelInput?.focus();
    else passwordInput?.focus();
  }
  async function close() {
    mode = null; selected = null; password = ''; confirmMethod = 'password';
    await tick();
    if (actionTrigger?.isConnected) actionTrigger.focus();
    else addButton?.focus();
    actionTrigger = null;
  }
  function cancelOnEscape(event: KeyboardEvent) {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopPropagation(); void close(); }
  }
  async function chooseMethod(next: 'password' | 'passkey') {
    confirmMethod = next;
    password = '';
    error = '';
    notice = '';
    await tick();
    if (next === 'password') passwordInput?.focus();
    else passkeyConfirmButton?.focus();
  }
  async function reauthenticateWithPasskey() {
    const response = await fetch('/api/v1/auth/passkeys/reauthentication/options', { method: 'POST', credentials: 'include' });
    if (!response.ok) throw new Error(response.status === 429 ? 'Too many attempts. Try again later.' : 'Could not start passkey confirmation. Try again.');
    const ceremony = await response.json() as { challengeId: string; options: Parameters<typeof startAuthentication>[0]['optionsJSON'] };
    let assertion;
    try { assertion = await startAuthentication({ optionsJSON: ceremony.options }); }
    catch (cause) {
      if (cause instanceof Error && (cause.name === 'NotAllowedError' || cause.name === 'AbortError')) {
        notice = 'Passkey confirmation canceled.';
        return false;
      }
      throw new Error('Passkey confirmation did not complete. Try again.');
    }
    const completed = await fetch('/api/v1/auth/passkeys/reauthentication/complete', { method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challengeId: ceremony.challengeId, response: assertion }) });
    if (!completed.ok) throw new Error(completed.status === 429 ? 'Too many attempts. Try again later.' : 'Could not confirm the passkey. Try again.');
    return true;
  }
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !mode) return;
    const action = mode;
    const currentPassword = password;
    const method = confirmMethod;
    const nextLabel = label.trim();
    password = '';
    busy = true;
    error = '';
    notice = '';
    try {
      if (action !== 'rename' && method === 'passkey' && !(await reauthenticateWithPasskey())) return;
      const confirmation = method === 'password' ? { currentPassword } : {};
      if (action === 'add') {
        const response = await fetch('/api/v1/auth/passkeys/options', { method: 'POST', credentials: 'include',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify(confirmation) });
        if (!response.ok) {
          const body = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(response.status === 403 ? method === 'passkey' ? 'Passkey confirmation expired. Try again.' : 'Current password is incorrect.' : response.status === 429 ? 'Too many attempts. Try again later.' : body.error === 'A verified email is required to add a passkey.' ? body.error : 'Could not start passkey setup. Try again.');
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
      } else if (action === 'rename' && selected) {
        const response = await fetch(`/api/v1/auth/passkeys/${selected.id}`, { method: 'PATCH', credentials: 'include',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: nextLabel }) });
        if (!response.ok) throw new Error(response.status === 429 ? 'Too many attempts. Try again later.' :
          response.status === 400 ? 'Enter a passkey name between 1 and 64 characters.' : 'Could not rename the passkey. Try again.');
        const updated = (await response.json() as { passkey: Passkey }).passkey;
        passkeys = passkeys.map((entry) => entry.id === updated.id ? updated : entry);
        notice = 'Passkey renamed.';
      } else if (selected) {
        const response = await fetch(`/api/v1/auth/passkeys/${selected.id}`, { method: 'DELETE', credentials: 'include',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify(confirmation) });
        if (!response.ok) throw new Error(response.status === 403 ? method === 'passkey' ? 'Passkey confirmation expired. Try again.' : 'Current password is incorrect.' : response.status === 429 ? 'Too many attempts. Try again later.' : 'Could not remove the passkey. Try again.');
        passkeys = passkeys.filter((entry) => entry.id !== selected?.id);
        notice = 'Passkey removed.';
      }
      busy = false;
      await close();
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
      <div class="cubic-passkey-row">
        <div class="cubic-passkey-details"><strong>{passkey.label}</strong><small>Added {new Date(passkey.createdAt).toLocaleDateString()}{passkey.lastUsedAt ? ` · Last used ${new Date(passkey.lastUsedAt).toLocaleDateString()}` : ''}</small><small>{deviceDescription(passkey)}</small></div>
        <div class="cubic-passkey-row-actions"><button class="cubic-control cubic-control-ghost" type="button" disabled={busy} onclick={(event) => void open('rename', passkey, event.currentTarget)}>Rename</button><button class="cubic-control cubic-control-ghost" type="button" disabled={busy} onclick={(event) => void open('remove', passkey, event.currentTarget)}>Remove</button></div>
      </div>
    {/each}
    {#if !emailVerified}<p class="cubic-passkeys-help">Verify your current email before adding a passkey.</p>
    {:else if supported === false}<p class="cubic-passkeys-help">This browser does not support passkey enrollment.</p>
    {:else if supported}<button bind:this={addButton} class="cubic-control cubic-control-secondary cubic-passkeys-add" type="button" disabled={busy} onclick={(event) => void open('add', null, event.currentTarget)}>Add passkey</button>{/if}
    {#if mode}
      <form class="cubic-passkeys-confirm" onsubmit={submit}>
        <h4>{mode === 'add' ? 'Add passkey' : mode === 'rename' ? `Rename ${selected?.label ?? 'passkey'}` : `Remove ${selected?.label ?? 'passkey'}`}</h4>
        {#if mode === 'add' || mode === 'rename'}<label for="cubic-passkey-label">Passkey name</label><input id="cubic-passkey-label" bind:this={labelInput} bind:value={label} onkeydown={cancelOnEscape} maxlength="64" required disabled={busy} />{/if}
        {#if mode !== 'rename' && supported && passkeys.length > 0}
          <div class="cubic-passkeys-methods" role="group" aria-label="Confirmation method">
            <button class={confirmMethod === 'password' ? 'cubic-control cubic-control-secondary cubic-passkeys-method-active' : 'cubic-control cubic-control-ghost'} type="button" aria-pressed={confirmMethod === 'password'} disabled={busy} onclick={() => void chooseMethod('password')}>Use password</button>
            <button class={confirmMethod === 'passkey' ? 'cubic-control cubic-control-secondary cubic-passkeys-method-active' : 'cubic-control cubic-control-ghost'} type="button" aria-pressed={confirmMethod === 'passkey'} disabled={busy} onclick={() => void chooseMethod('passkey')}>Use passkey</button>
          </div>
        {/if}
        {#if mode !== 'rename' && confirmMethod === 'password'}<label for="cubic-passkey-password">Current password</label>
        <input id="cubic-passkey-password" bind:this={passwordInput} type="password" bind:value={password} onkeydown={cancelOnEscape} autocomplete="current-password" maxlength="128" required disabled={busy} />{/if}
        {#if mode !== 'rename' && confirmMethod === 'passkey'}<p class="cubic-passkeys-help">Your device or password manager will ask you to confirm.</p>{/if}
        <div class="cubic-passkeys-actions"><button bind:this={passkeyConfirmButton} class={mode === 'remove' ? 'cubic-control cubic-control-danger' : 'cubic-control cubic-control-primary'} type="submit" disabled={busy}>{busy ? 'Working…' : mode === 'add' ? confirmMethod === 'passkey' ? 'Confirm with passkey' : 'Continue' : mode === 'rename' ? 'Save name' : confirmMethod === 'passkey' ? 'Confirm with passkey and remove' : 'Remove passkey'}</button><button class="cubic-control cubic-control-ghost" type="button" disabled={busy} onclick={() => void close()}>Cancel</button></div>
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
  .cubic-passkey-details { flex: 1 1 auto; }
  .cubic-passkey-row-actions { display: flex; flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; gap: 4px; }
  .cubic-passkey-row strong, .cubic-passkey-row small { display: block; overflow-wrap: anywhere; }
  .cubic-passkeys-add { justify-self: start; }
  .cubic-passkeys-confirm { display: grid; gap: 9px; padding-top: 12px; border-top: 1px solid var(--cubic-border); }
  .cubic-passkeys-confirm h4 { margin: 0 0 4px; font-size: .9rem; }
  .cubic-passkeys-confirm label { font-size: .84rem; font-weight: 650; }
  .cubic-passkeys-confirm input { width: 100%; min-width: 0; min-height: 44px; padding: 9px 11px; border: 1px solid var(--cubic-control-border); border-radius: var(--cubic-control-radius); background: var(--cubic-control-bg); color: var(--cubic-text); font: inherit; }
  .cubic-passkeys-confirm input:focus-visible { outline: 2px solid var(--cubic-brand-focus); outline-offset: 2px; }
  .cubic-passkeys-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .cubic-passkeys-methods { display: flex; flex-wrap: wrap; gap: 8px; }
  .cubic-passkeys-method-active { border-color: var(--cubic-brand-border); }
  .cubic-passkeys-actions button, .cubic-passkey-row button { min-height: 44px; }
  .cubic-passkeys-error, .cubic-passkeys-notice { margin: 4px 0 0; font-size: .83rem; line-height: 1.4; }
  .cubic-passkeys-error { color: var(--cubic-red); }
  .cubic-passkeys-notice { color: var(--cubic-text); }
  @media (max-width: 680px) { .cubic-passkeys { padding: 16px; } .cubic-passkey-row { align-items: stretch; flex-direction: column; gap: 6px; } .cubic-passkey-row-actions { justify-content: flex-start; } }
</style>
