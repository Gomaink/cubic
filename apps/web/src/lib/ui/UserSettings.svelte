<script lang="ts">
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import SecuritySettings from './SecuritySettings.svelte';
  import SessionSettings from './SessionSettings.svelte';
  import { modalFocus } from './modalFocus';

  type Identity = { username: string; displayName: string; avatarUrl: string | null };
  type AppPreferences = { compactMode: boolean; reduceMotion: boolean };
  let {
    profile, loggingOut, preferences, preferencesError, mediaControls, onvoicevideo, onretry, onpreference, onclose, onsave, onupload, onremove, onlogout
  }: {
    profile: Identity;
    loggingOut: boolean;
    preferences: AppPreferences | null;
    preferencesError: string;
    mediaControls: Snippet;
    onvoicevideo: () => void;
    onretry: () => Promise<void>;
    onpreference: (change: Partial<AppPreferences>) => Promise<void>;
    onclose: () => void;
    onsave: (displayName: string) => Promise<void>;
    onupload: (file: File) => Promise<void>;
    onremove: () => Promise<void>;
    onlogout: () => void;
  } = $props();

  let section = $state<'profile' | 'security' | 'sessions' | 'app' | 'voice-video'>('profile');
  let draft = $state('');
  let busy = $state(false);
  let error = $state('');
  let failedAvatarUrl = $state<string | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);
  let preferenceBusy = $state(false);
  let preferenceError = $state('');

  onMount(() => { draft = profile.displayName; });

  async function run(action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    error = '';
    try { await action(); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Could not update profile.'; }
    finally { busy = false; }
  }

  async function savePreference(change: Partial<AppPreferences>, input: HTMLInputElement, field: keyof AppPreferences) {
    if (preferenceBusy || !preferences) return;
    preferenceBusy = true;
    preferenceError = '';
    try { await onpreference(change); }
    catch { preferenceError = 'Could not save app preferences. Try again.'; }
    finally {
      input.checked = preferences?.[field] ?? false;
      preferenceBusy = false;
    }
  }
</script>

<section class="cubic-user-settings" aria-label="User Settings">
  <div class="cubic-user-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="cubic-user-settings-heading" tabindex="-1" use:modalFocus>
  <header class="cubic-user-settings-head">
    <div><small>ACCOUNT</small><h1 id="cubic-user-settings-heading">User Settings</h1></div>
    <button type="button" aria-label="Close User Settings" title="Close User Settings" onclick={onclose}><Icon name="x" size={19} /></button>
  </header>
  <div class="cubic-user-settings-layout">
    <nav class="cubic-user-settings-nav" aria-label="User settings sections">
      <button type="button" aria-current={section === 'profile' ? 'page' : undefined} onclick={() => section = 'profile'}>Profile</button>
      <button type="button" aria-current={section === 'security' ? 'page' : undefined} onclick={() => section = 'security'}>Security</button>
      <button type="button" aria-current={section === 'sessions' ? 'page' : undefined} onclick={() => section = 'sessions'}>Sessions</button>
      <button type="button" aria-current={section === 'app' ? 'page' : undefined} onclick={() => section = 'app'}>App</button>
      <button type="button" aria-current={section === 'voice-video' ? 'page' : undefined} onclick={() => { section = 'voice-video'; onvoicevideo(); }}>Voice &amp; Video</button>
      <div class="cubic-user-settings-utilities">
        <button type="button" disabled={loggingOut} onclick={onlogout}>{loggingOut ? 'Logging out…' : 'Log out'}</button>
      </div>
    </nav>
    <div class="cubic-user-settings-content">
      {#if section === 'profile'}
        <section class="cubic-user-profile-settings" aria-labelledby="cubic-user-profile-title">
          <div class="cubic-user-settings-title"><small>YOUR ACCOUNT</small><h2 id="cubic-user-profile-title">Profile</h2></div>
          <div class="cubic-user-profile-identity">
            <span class="cubic-user-profile-avatar-edit">
              <span class="cubic-user-profile-avatar">
                {#if profile.avatarUrl && failedAvatarUrl !== profile.avatarUrl}
                  <img src={profile.avatarUrl} alt={`${profile.displayName}'s avatar`} onerror={() => failedAvatarUrl = profile.avatarUrl} />
                {:else}
                  <span aria-label={`${profile.displayName}'s initials`}>{profile.displayName.slice(0, 1).toUpperCase()}</span>
                {/if}
              </span>
              <input bind:this={fileInput} type="file" tabindex="-1" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Choose avatar image" onchange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void run(() => onupload(file));
                event.currentTarget.value = '';
              }} />
              <button class="cubic-user-avatar-edit-button" type="button" aria-label="Change avatar" title="Change avatar" disabled={busy} onclick={() => fileInput?.click()}><Icon name="edit" size={15} /></button>
            </span>
            <div><strong>{profile.displayName}</strong><span>@{profile.username}</span></div>
          </div>
          {#if profile.avatarUrl}<div class="cubic-user-profile-field cubic-user-avatar-remove-row"><strong>Avatar</strong><button class="cubic-control cubic-control-ghost cubic-user-avatar-remove" type="button" disabled={busy} onclick={() => void run(onremove)}>Remove avatar</button></div>{/if}
          <form class="cubic-user-profile-field" onsubmit={(event) => {
            event.preventDefault();
            const name = draft.trim();
            if (name) void run(() => onsave(name));
          }}>
            <label for="cubic-user-display-name">Display name</label>
            <div class="cubic-user-profile-actions">
              <input id="cubic-user-display-name" bind:value={draft} maxlength="64" required disabled={busy} />
              <button class="cubic-control cubic-control-primary" type="submit" disabled={busy || !draft.trim() || draft.trim() === profile.displayName}>Save changes</button>
            </div>
          </form>
          <div class="cubic-user-profile-field"><strong>Username</strong><p>@{profile.username}</p><small>Username changes are not supported yet.</small></div>
          {#if error}<p class="cubic-user-profile-error" role="alert">{error}</p>{/if}
        </section>
      {:else if section === 'security'}
        <SecuritySettings />
      {:else if section === 'sessions'}
        <SessionSettings />
      {:else if section === 'app'}
        <section class="cubic-app-preferences" aria-labelledby="cubic-app-preferences-title">
          <div class="cubic-user-settings-title"><small>PREFERENCES</small><h2 id="cubic-app-preferences-title">App</h2></div>
          {#if preferences}
            <div class="cubic-app-preference-row">
              <div><strong>Compact mode</strong><small id="cubic-compact-description">Reduce spacing in messages and navigation lists.</small></div>
              <input class="cubic-preference-switch" type="checkbox" aria-label="Compact mode" aria-describedby="cubic-compact-description" checked={preferences.compactMode} disabled={preferenceBusy} onchange={(event) => void savePreference({ compactMode: event.currentTarget.checked }, event.currentTarget, 'compactMode')} />
            </div>
            <div class="cubic-app-preference-row">
              <div><strong>Reduced motion</strong><small id="cubic-motion-description">Minimize app animations and transitions.</small></div>
              <input class="cubic-preference-switch" type="checkbox" aria-label="Reduced motion" aria-describedby="cubic-motion-description" checked={preferences.reduceMotion} disabled={preferenceBusy} onchange={(event) => void savePreference({ reduceMotion: event.currentTarget.checked }, event.currentTarget, 'reduceMotion')} />
            </div>
            {#if preferenceBusy}<p role="status">Saving preferences…</p>{/if}
            {#if preferenceError}<p class="cubic-user-profile-error" role="alert">{preferenceError}</p>{/if}
          {:else if preferencesError}
            <p class="cubic-user-profile-error" role="alert">{preferencesError}</p>
            <button class="cubic-control cubic-control-secondary cubic-app-preferences-retry" type="button" onclick={() => void onretry()}>Retry loading preferences</button>
          {:else}
            <p role="status">Loading preferences…</p>
          {/if}
        </section>
      {:else if section === 'voice-video'}
        <section class="cubic-voice-video-settings" aria-labelledby="cubic-voice-video-title">
          <div class="cubic-user-settings-title"><small>THIS BROWSER</small><h2 id="cubic-voice-video-title">Voice &amp; Video</h2></div>
          <p class="cubic-voice-video-intro">Device and quality choices are saved on this browser. Available devices depend on browser permissions.</p>
          {@render mediaControls()}
        </section>
      {/if}
    </div>
  </div>
  </div>
</section>

<style>
  .cubic-user-settings { position: fixed; inset: 0 0 0 66px; z-index: 85; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: #111217; color: var(--cubic-text); }
  .cubic-user-settings-dialog { display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0; min-height: 0; }
  .cubic-user-settings-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex: 0 0 auto; min-height: 66px; padding: 10px 22px; border-bottom: 1px solid var(--cubic-border); background: #15171d; }
  .cubic-user-settings-head small, .cubic-user-settings-title small { color: var(--cubic-muted); font-size: .7rem; font-weight: 800; letter-spacing: .08em; }
  .cubic-user-settings-head h1 { margin: 2px 0 0; font-size: 1.1rem; }
  .cubic-user-settings-head button { display: grid; place-items: center; width: 42px; height: 42px; border: 0; border-radius: 7px; background: transparent; color: var(--cubic-text); cursor: pointer; }
  .cubic-user-settings-head button:hover { background: var(--cubic-bg-hover); }
  .cubic-user-settings-layout { display: grid; grid-template-columns: 184px minmax(0, 1fr); flex: 1 1 auto; min-height: 0; }
  .cubic-user-settings-nav { display: flex; flex-direction: column; gap: 4px; padding: 16px 10px; border-right: 1px solid var(--cubic-border); background: #15171d; }
  .cubic-user-settings-nav button { min-height: 42px; padding: 8px 10px; border: 0; border-radius: 7px; background: transparent; color: var(--cubic-muted); font: inherit; text-align: left; cursor: pointer; }
  .cubic-user-settings-nav button:hover, .cubic-user-settings-nav button:focus-visible { background: var(--cubic-bg-hover); color: var(--cubic-text); }
  .cubic-user-settings-nav button[aria-current="page"] { background: var(--cubic-brand-soft); color: var(--cubic-text); box-shadow: inset 3px 0 0 var(--cubic-brand-active); }
  .cubic-user-settings-utilities { display: flex; flex-direction: column; gap: 4px; margin-top: auto; padding-top: 12px; border-top: 1px solid var(--cubic-border); }
  .cubic-user-settings-utilities button:last-child { color: #f0b6bb; }
  .cubic-user-settings-content { min-width: 0; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 24px clamp(18px, 4vw, 42px) max(36px, env(safe-area-inset-bottom)); }
  .cubic-user-profile-settings { width: min(100%, 760px); margin: 0 auto; }
  .cubic-user-settings-title { margin-bottom: 20px; }
  .cubic-user-settings-title h2 { margin: 4px 0 0; font-size: 1.35rem; }
  .cubic-user-profile-identity { display: flex; align-items: center; gap: 14px; min-width: 0; padding-bottom: 20px; border-bottom: 1px solid var(--cubic-border); }
  .cubic-user-profile-avatar-edit { position: relative; display: block; flex: 0 0 72px; width: 72px; height: 72px; }
  .cubic-user-profile-avatar { position: relative; display: grid; place-items: center; width: 72px; height: 72px; overflow: hidden; border-radius: 50%; background: #34363b; font-size: 1.5rem; font-weight: 800; }
  .cubic-user-avatar-edit-button { position: absolute; right: -12px; bottom: -12px; display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--cubic-bg-0); cursor: pointer; }
  .cubic-user-avatar-edit-button::before { content: ''; position: absolute; inset: 6px; border: 1px solid var(--cubic-brand-border); border-radius: 50%; background: var(--cubic-brand-action); }
  .cubic-user-avatar-edit-button :global(svg) { position: relative; }
  .cubic-user-avatar-edit-button:hover::before { background: var(--cubic-brand-hover); }
  .cubic-user-profile-avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .cubic-user-profile-avatar-edit input[type="file"] { position: absolute; width: 1px; height: 1px; opacity: 0; }
  .cubic-user-profile-identity > div { min-width: 0; overflow-wrap: anywhere; }
  .cubic-user-profile-identity strong, .cubic-user-profile-identity div span { display: block; }
  .cubic-user-profile-identity div span { margin-top: 4px; color: var(--cubic-muted); font-size: .83rem; }
  .cubic-user-profile-field { display: grid; gap: 10px; padding: 19px 0; border-bottom: 1px solid var(--cubic-border); }
  .cubic-user-profile-field > strong, .cubic-user-profile-field label { font-size: .85rem; font-weight: 700; }
  .cubic-user-profile-field p { margin: 0; }
  .cubic-user-profile-field small { color: var(--cubic-muted); }
  .cubic-user-profile-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
  .cubic-user-profile-actions input:not([type="file"]) { flex: 1 1 230px; min-width: 0; min-height: 42px; padding: 8px 10px; border: 1px solid #474b58; border-radius: 7px; background: #101117; color: var(--cubic-text); font: inherit; }
  .cubic-user-profile-actions button { font: inherit; }
  .cubic-user-avatar-remove-row .cubic-user-avatar-remove { color: #ffc0c3; }
  .cubic-user-profile-actions button:disabled { opacity: .5; cursor: default; }
  .cubic-user-profile-error { color: #ff9ca3; }
  .cubic-app-preferences { width: min(100%, 760px); margin: 0 auto; }
  .cubic-voice-video-settings { width: min(100%, 760px); margin: 0 auto; }
  .cubic-voice-video-intro { margin: -4px 0 18px; color: var(--cubic-muted); font-size: .84rem; line-height: 1.5; }
  .cubic-app-preference-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 66px; padding: 12px 0; border-bottom: 1px solid var(--cubic-border); }
  .cubic-app-preference-row > div { min-width: 0; }
  .cubic-app-preference-row strong, .cubic-app-preference-row small { display: block; }
  .cubic-app-preference-row strong { font-size: .86rem; }
  .cubic-app-preference-row small { margin-top: 4px; color: var(--cubic-muted); line-height: 1.4; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--cubic-brand-focus); outline-offset: 2px; }
  @media (max-width: 760px) { .cubic-user-settings-layout { grid-template-columns: 148px minmax(0, 1fr); } }
  @media (max-width: 680px), (max-width: 900px) and (max-height: 500px) {
    .cubic-user-settings { inset: 0; height: 100dvh; }
    .cubic-user-settings-layout { display: flex; flex-direction: column; }
    .cubic-user-settings-head { min-height: 54px; padding: 7px 12px; }
    .cubic-user-settings-nav { flex: 0 0 auto; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 4px; padding: 6px 10px; border-right: 0; border-bottom: 1px solid var(--cubic-border); }
    .cubic-user-settings-nav button { min-height: 44px; }
    .cubic-user-settings-head button, .cubic-user-profile-actions input:not([type="file"]) { min-height: 44px; }
    .cubic-user-settings-nav button[aria-current="page"] { box-shadow: inset 0 -3px 0 var(--cubic-brand-active); }
    .cubic-user-settings-utilities { flex-direction: row; gap: 2px; margin: 0 0 0 auto; padding: 0 0 0 5px; border: 0; }
    .cubic-user-settings-content { padding: 16px 14px max(24px, env(safe-area-inset-bottom)); }
  }
  @media (max-width: 380px) { .cubic-user-settings-utilities button { padding-inline: 5px; font-size: .73rem; } }
</style>
