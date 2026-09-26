<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import SessionSettings from './SessionSettings.svelte';

  type Identity = { username: string; displayName: string; avatarUrl: string | null };
  let {
    profile, voiceAvailable, loggingOut, onclose, onsave, onupload, onremove, onmedia, onlogout
  }: {
    profile: Identity;
    voiceAvailable: boolean;
    loggingOut: boolean;
    onclose: () => void;
    onsave: (displayName: string) => Promise<void>;
    onupload: (file: File) => Promise<void>;
    onremove: () => Promise<void>;
    onmedia: () => void;
    onlogout: () => void;
  } = $props();

  let section = $state<'profile' | 'sessions'>('profile');
  let draft = $state('');
  let busy = $state(false);
  let error = $state('');
  let failedAvatarUrl = $state<string | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);

  onMount(() => { draft = profile.displayName; });

  async function run(action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    error = '';
    try { await action(); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Could not update profile.'; }
    finally { busy = false; }
  }
</script>

<section class="cubic-user-settings" aria-label="User Settings">
  <header class="cubic-user-settings-head">
    <div><small>ACCOUNT</small><h1>User Settings</h1></div>
    <button type="button" aria-label="Close User Settings" title="Close User Settings" onclick={onclose}><Icon name="x" size={19} /></button>
  </header>
  <div class="cubic-user-settings-layout">
    <nav class="cubic-user-settings-nav" aria-label="User settings sections">
      <button type="button" aria-current={section === 'profile' ? 'page' : undefined} onclick={() => section = 'profile'}>Profile</button>
      <button type="button" aria-current={section === 'sessions' ? 'page' : undefined} onclick={() => section = 'sessions'}>Sessions</button>
      <div class="cubic-user-settings-utilities">
        {#if voiceAvailable}<button type="button" onclick={onmedia}>Voice &amp; Video</button>{/if}
        <button type="button" disabled={loggingOut} onclick={onlogout}>{loggingOut ? 'Logging out…' : 'Log out'}</button>
      </div>
    </nav>
    <div class="cubic-user-settings-content">
      {#if section === 'profile'}
        <section class="cubic-user-profile-settings" aria-labelledby="cubic-user-profile-title">
          <div class="cubic-user-settings-title"><small>YOUR ACCOUNT</small><h2 id="cubic-user-profile-title">Profile</h2></div>
          <div class="cubic-user-profile-identity">
            <span class="cubic-user-profile-avatar">
              {#if profile.avatarUrl && failedAvatarUrl !== profile.avatarUrl}
                <img src={profile.avatarUrl} alt={`${profile.displayName}'s avatar`} onerror={() => failedAvatarUrl = profile.avatarUrl} />
              {:else}
                <span aria-label={`${profile.displayName}'s initials`}>{profile.displayName.slice(0, 1).toUpperCase()}</span>
              {/if}
            </span>
            <div><strong>{profile.displayName}</strong><span>@{profile.username}</span></div>
          </div>
          <div class="cubic-user-profile-field">
            <strong>Avatar</strong>
            <div class="cubic-user-profile-actions">
              <input bind:this={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Choose avatar image" onchange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void run(() => onupload(file));
                event.currentTarget.value = '';
              }} />
              <button type="button" disabled={busy} onclick={() => fileInput?.click()}>Change avatar</button>
              {#if profile.avatarUrl}<button type="button" disabled={busy} onclick={() => void run(onremove)}>Remove avatar</button>{/if}
            </div>
          </div>
          <form class="cubic-user-profile-field" onsubmit={(event) => {
            event.preventDefault();
            const name = draft.trim();
            if (name) void run(() => onsave(name));
          }}>
            <label for="cubic-user-display-name">Display name</label>
            <div class="cubic-user-profile-actions">
              <input id="cubic-user-display-name" bind:value={draft} maxlength="64" required disabled={busy} />
              <button type="submit" disabled={busy || !draft.trim() || draft.trim() === profile.displayName}>Save changes</button>
            </div>
          </form>
          <div class="cubic-user-profile-field"><strong>Username</strong><p>@{profile.username}</p><small>Username changes are not supported yet.</small></div>
          {#if error}<p class="cubic-user-profile-error" role="alert">{error}</p>{/if}
        </section>
      {:else}
        <SessionSettings />
      {/if}
    </div>
  </div>
</section>

<style>
  .cubic-user-settings { position: fixed; inset: 0 0 0 66px; z-index: 85; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: #111217; color: var(--cubic-text); }
  .cubic-user-settings-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex: 0 0 auto; min-height: 66px; padding: 10px 22px; border-bottom: 1px solid var(--cubic-border); background: #15171d; }
  .cubic-user-settings-head small, .cubic-user-settings-title small { color: var(--cubic-muted); font-size: .7rem; font-weight: 800; letter-spacing: .08em; }
  .cubic-user-settings-head h1 { margin: 2px 0 0; font-size: 1.1rem; }
  .cubic-user-settings-head button { display: grid; place-items: center; width: 42px; height: 42px; border: 0; border-radius: 7px; background: transparent; color: var(--cubic-text); cursor: pointer; }
  .cubic-user-settings-head button:hover { background: var(--cubic-bg-hover); }
  .cubic-user-settings-layout { display: grid; grid-template-columns: 184px minmax(0, 1fr); flex: 1 1 auto; min-height: 0; }
  .cubic-user-settings-nav { display: flex; flex-direction: column; gap: 4px; padding: 16px 10px; border-right: 1px solid var(--cubic-border); background: #15171d; }
  .cubic-user-settings-nav button { min-height: 42px; padding: 8px 10px; border: 0; border-radius: 7px; background: transparent; color: var(--cubic-muted); font: inherit; text-align: left; cursor: pointer; }
  .cubic-user-settings-nav button:hover, .cubic-user-settings-nav button:focus-visible { background: var(--cubic-bg-hover); color: var(--cubic-text); }
  .cubic-user-settings-nav button[aria-current="page"] { background: #272c38; color: #f3f5fb; box-shadow: inset 3px 0 0 #adb7ff; }
  .cubic-user-settings-utilities { display: flex; flex-direction: column; gap: 4px; margin-top: auto; padding-top: 12px; border-top: 1px solid var(--cubic-border); }
  .cubic-user-settings-utilities button:last-child { color: #f0b6bb; }
  .cubic-user-settings-content { min-width: 0; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 24px clamp(18px, 4vw, 42px) max(36px, env(safe-area-inset-bottom)); }
  .cubic-user-profile-settings { width: min(100%, 760px); margin: 0 auto; }
  .cubic-user-settings-title { margin-bottom: 20px; }
  .cubic-user-settings-title h2 { margin: 4px 0 0; font-size: 1.35rem; }
  .cubic-user-profile-identity { display: flex; align-items: center; gap: 14px; min-width: 0; padding-bottom: 20px; border-bottom: 1px solid var(--cubic-border); }
  .cubic-user-profile-avatar { position: relative; display: grid; flex: 0 0 72px; place-items: center; width: 72px; height: 72px; overflow: hidden; border-radius: 50%; background: #383d51; font-size: 1.5rem; font-weight: 800; }
  .cubic-user-profile-avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .cubic-user-profile-identity > div { min-width: 0; overflow-wrap: anywhere; }
  .cubic-user-profile-identity strong, .cubic-user-profile-identity div span { display: block; }
  .cubic-user-profile-identity div span { margin-top: 4px; color: var(--cubic-muted); font-size: .83rem; }
  .cubic-user-profile-field { display: grid; gap: 10px; padding: 19px 0; border-bottom: 1px solid var(--cubic-border); }
  .cubic-user-profile-field > strong, .cubic-user-profile-field label { font-size: .85rem; font-weight: 700; }
  .cubic-user-profile-field p { margin: 0; }
  .cubic-user-profile-field small { color: var(--cubic-muted); }
  .cubic-user-profile-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
  .cubic-user-profile-actions input[type="file"] { position: absolute; width: 1px; height: 1px; opacity: 0; }
  .cubic-user-profile-actions input:not([type="file"]) { flex: 1 1 230px; min-width: 0; min-height: 42px; padding: 8px 10px; border: 1px solid #474b58; border-radius: 7px; background: #101117; color: var(--cubic-text); font: inherit; }
  .cubic-user-profile-actions button { min-height: 42px; padding: 8px 12px; border: 1px solid #454955; border-radius: 7px; background: #242730; color: var(--cubic-text); font: inherit; cursor: pointer; }
  .cubic-user-profile-actions button:disabled { opacity: .5; cursor: default; }
  .cubic-user-profile-error { color: #ff9ca3; }
  button:focus-visible, input:focus-visible { outline: 2px solid #aeb3ff; outline-offset: 2px; }
  @media (max-width: 760px) { .cubic-user-settings-layout { grid-template-columns: 148px minmax(0, 1fr); } }
  @media (max-width: 680px), (max-width: 900px) and (max-height: 500px) {
    .cubic-user-settings { inset: 0; height: 100dvh; }
    .cubic-user-settings-layout { display: flex; flex-direction: column; }
    .cubic-user-settings-head { min-height: 54px; padding: 7px 12px; }
    .cubic-user-settings-nav { flex: 0 0 auto; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 4px; padding: 6px 10px; border-right: 0; border-bottom: 1px solid var(--cubic-border); }
    .cubic-user-settings-nav button { min-height: 42px; }
    .cubic-user-settings-nav button[aria-current="page"] { box-shadow: inset 0 -3px 0 #adb7ff; }
    .cubic-user-settings-utilities { flex-direction: row; gap: 2px; margin: 0 0 0 auto; padding: 0 0 0 5px; border: 0; }
    .cubic-user-settings-content { padding: 16px 14px max(24px, env(safe-area-inset-bottom)); }
  }
  @media (max-width: 380px) { .cubic-user-settings-utilities button { padding-inline: 5px; font-size: .73rem; } }
</style>
