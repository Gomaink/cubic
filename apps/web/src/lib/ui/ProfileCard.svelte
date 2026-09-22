<script lang="ts">
  import { onMount } from 'svelte';

  export type ProfileIdentity = {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };

  let {
    profile,
    own,
    onclose,
    onsave,
    onupload,
    onremove
  }: {
    profile: ProfileIdentity;
    own: boolean;
    onclose: () => void;
    onsave: (displayName: string) => Promise<void>;
    onupload: (file: File) => Promise<void>;
    onremove: () => Promise<void>;
  } = $props();

  let dialog: HTMLDialogElement;
  let fileInput = $state<HTMLInputElement | null>(null);
  let editing = $state(false);
  let draft = $state('');
  let busy = $state(false);
  let error = $state('');
  let failedAvatarUrl = $state<string | null>(null);

  onMount(() => {
    dialog.showModal();
    dialog.focus();
    return () => { if (dialog.open) dialog.close(); };
  });

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    error = '';
    try { await action(); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Could not update profile.'; }
    finally { busy = false; }
  }
</script>

<dialog bind:this={dialog} class="cubic-profile-dialog" aria-label={`${profile.displayName}'s profile`} onclose={onclose}>
  <header class="cubic-profile-head">
    <strong>USER PROFILE</strong>
    <button type="button" aria-label="Close profile" onclick={onclose}>×</button>
  </header>
  <div class="cubic-profile-body">
    <div class="cubic-profile-avatar">
      {#if profile.avatarUrl && failedAvatarUrl !== profile.avatarUrl}
        <img src={profile.avatarUrl} alt={`${profile.displayName}'s avatar`} onerror={() => failedAvatarUrl = profile.avatarUrl} />
      {:else}
        <span aria-label={`${profile.displayName}'s initials`}>{profile.displayName.slice(0, 1).toUpperCase()}</span>
      {/if}
    </div>
    <h2>{profile.displayName}</h2>
    <p>@{profile.username}</p>
    {#if own}
      {#if editing}
        <form class="cubic-profile-edit" onsubmit={(event) => {
          event.preventDefault();
          void run(async () => { await onsave(draft.trim()); editing = false; });
        }}>
          <label for="cubic-profile-name">Display name</label>
          <input id="cubic-profile-name" bind:value={draft} maxlength="64" required disabled={busy} />
          <button type="submit" disabled={busy || !draft.trim()}>Save display name</button>
        </form>
      {:else}
        <button type="button" onclick={() => { draft = profile.displayName; editing = true; }}>Edit display name</button>
      {/if}
      <div class="cubic-profile-avatar-actions">
        <input bind:this={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Choose avatar image" onchange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void run(() => onupload(file));
          event.currentTarget.value = '';
        }} />
        <button type="button" disabled={busy} onclick={() => fileInput?.click()}>Change avatar</button>
        {#if profile.avatarUrl}<button type="button" disabled={busy} onclick={() => void run(onremove)}>Remove avatar</button>{/if}
      </div>
      {#if error}<p class="cubic-profile-error" role="alert">{error}</p>{/if}
    {/if}
  </div>
</dialog>

<style>
  .cubic-profile-dialog { width: min(420px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); margin: auto; padding: 0; overflow: auto; border: 1px solid #32343a; border-radius: 10px; background: #17181c; color: #e9eaed; box-shadow: 0 24px 70px #0009; }
  .cubic-profile-dialog::backdrop { background: #000a; }
  .cubic-profile-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: #22242a; }
  .cubic-profile-head strong { font-size: .7rem; letter-spacing: .08em; }
  .cubic-profile-head button { border: 0; background: transparent; color: #ddd; font-size: 1.5rem; cursor: pointer; }
  .cubic-profile-body { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 22px 18px; }
  .cubic-profile-avatar { display: grid; place-items: center; width: 88px; height: 88px; overflow: hidden; border-radius: 50%; background: #393b43; font-size: 2rem; }
  .cubic-profile-avatar img { width: 100%; height: 100%; object-fit: cover; }
  h2, p { margin: 0; }
  h2 { font-size: 1.2rem; }
  p { color: #aeb2bc; }
  .cubic-profile-body button { padding: 8px 12px; border: 1px solid #454852; border-radius: 5px; background: #2a2c34; color: #f3f3f5; cursor: pointer; }
  .cubic-profile-body button:disabled { opacity: .55; cursor: default; }
  .cubic-profile-edit { display: flex; flex-direction: column; gap: 7px; width: 100%; }
  .cubic-profile-edit label { font-size: .75rem; }
  .cubic-profile-edit input { width: 100%; padding: 9px; border: 1px solid #555964; border-radius: 5px; background: #111216; color: white; }
  .cubic-profile-avatar-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
  .cubic-profile-avatar-actions input { position: absolute; width: 1px; height: 1px; opacity: 0; }
  .cubic-profile-error { color: #ff9a9a; font-size: .8rem; }
</style>
