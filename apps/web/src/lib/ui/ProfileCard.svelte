<script lang="ts">
  import { onMount } from 'svelte';

  export type ProfileIdentity = {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };

  let { profile, onclose }: {
    profile: ProfileIdentity;
    onclose: () => void;
  } = $props();

  let dialog: HTMLDialogElement;
  let failedAvatarUrl = $state<string | null>(null);

  onMount(() => {
    dialog.showModal();
    dialog.focus();
    return () => { if (dialog.open) dialog.close(); };
  });

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
</style>
