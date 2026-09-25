<script lang="ts">
  import Icon from './Icon.svelte';

  let {
    displayName, username, avatarUrl, loggingOut, voiceAvailable,
    onprofile, onsessions, onmedia, onlogout
  }: {
    displayName: string;
    username: string;
    avatarUrl: string | null;
    loggingOut: boolean;
    voiceAvailable: boolean;
    onprofile: () => void;
    onsessions: () => void;
    onmedia: () => void;
    onlogout: () => void;
  } = $props();
  let menuOpen = $state(false);
  function hideFailedAvatar(event: Event) {
    if (event.currentTarget instanceof HTMLImageElement) event.currentTarget.hidden = true;
  }
  function action(callback: () => void) { menuOpen = false; callback(); }
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape') menuOpen = false; }} />
<div class="cubic-user-bar" role="group" aria-label="Your account">
  {#if menuOpen}
    <div class="cubic-user-actions" aria-label="Your account actions">
      <button type="button" onclick={() => action(onprofile)}>Profile</button>
      <button type="button" onclick={() => action(onsessions)}>Sessions</button>
      {#if voiceAvailable}<button type="button" onclick={() => action(onmedia)}>Voice &amp; Video</button>{/if}
      <button type="button" onclick={() => action(onlogout)} disabled={loggingOut}>{loggingOut ? 'Logging out…' : 'Log out'}</button>
    </div>
  {/if}
  <button class="cubic-user-identity" type="button" aria-label="Open your profile" onclick={onprofile}>
    <span class="cubic-user-bar-avatar">{displayName.slice(0, 1).toUpperCase()}{#if avatarUrl}{#key avatarUrl}<img src={avatarUrl} alt="" onerror={hideFailedAvatar} />{/key}{/if}</span>
    <span class="cubic-user-bar-copy"><strong>{displayName}</strong><small>Account · @{username}</small></span>
  </button>
  <button class="cubic-user-menu-trigger" type="button" aria-label="Account actions" aria-expanded={menuOpen} title="Account actions" onclick={() => menuOpen = !menuOpen}><Icon name="settings" size={19} /></button>
</div>

<style>
  .cubic-user-bar { position: relative; display: flex; flex: 0 0 auto; align-items: center; gap: 6px; min-width: 0; min-height: 66px; padding: 8px 10px max(8px, env(safe-area-inset-bottom)); border-top: 1px solid #ffffff1c; background: #181a20; }
  button { border: 0; color: var(--cubic-text); font: inherit; cursor: pointer; }
  button:focus-visible { outline: 2px solid #aeb3ff; outline-offset: 2px; }
  .cubic-user-identity { display: flex; flex: 1 1 auto; align-items: center; gap: 9px; min-width: 0; padding: 3px; border-radius: 7px; background: transparent; text-align: left; }
  .cubic-user-identity:hover, .cubic-user-menu-trigger:hover { background: var(--cubic-bg-hover); }
  .cubic-user-bar-avatar { position: relative; display: grid; flex: 0 0 38px; place-items: center; width: 38px; height: 38px; overflow: hidden; border-radius: 50%; background: #383d51; font-weight: 800; }
  .cubic-user-bar-avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .cubic-user-bar-copy { display: block; min-width: 0; }
  .cubic-user-bar-copy strong, .cubic-user-bar-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cubic-user-bar-copy strong { font-size: .81rem; }
  .cubic-user-bar-copy small { color: var(--cubic-muted); font-size: .7rem; }
  .cubic-user-menu-trigger { display: grid; flex: 0 0 42px; place-items: center; width: 42px; height: 42px; border-radius: 7px; background: transparent; }
  .cubic-user-actions { position: absolute; z-index: 90; right: 8px; bottom: calc(100% + 6px); display: grid; gap: 3px; width: min(210px, calc(100vw - 84px)); padding: 6px; border: 1px solid var(--cubic-border); border-radius: 9px; background: #23262e; box-shadow: 0 12px 32px #0008; }
  .cubic-user-actions button { min-height: 42px; padding: 7px 10px; border-radius: 6px; background: transparent; text-align: left; }
  .cubic-user-actions button:hover { background: var(--cubic-bg-hover); }
</style>
