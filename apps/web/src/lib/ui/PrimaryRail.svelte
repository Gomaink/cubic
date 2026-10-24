<script lang="ts">
  import Icon from './Icon.svelte';

  type Server = { id: string; name: string; iconUrl: string | null; ownerUserId: string; createdAt: string; updatedAt: string };
  let {
    servers, selectedServerId, messagesSelected, serverBrowserSelected, loading,
    onmessages, onbrowse, onserver, oncreate
  }: {
    servers: Server[];
    selectedServerId: string | null;
    messagesSelected: boolean;
    serverBrowserSelected: boolean;
    loading: boolean;
    onmessages: () => void;
    onbrowse: () => void;
    onserver: (server: Server) => void;
    oncreate: (event: MouseEvent) => void;
  } = $props();

  function hideFailedIcon(event: Event) {
    if (event.currentTarget instanceof HTMLImageElement) event.currentTarget.hidden = true;
  }
</script>

<nav class="cubic-primary-rail" aria-label="Primary navigation">
  <button class="cubic-primary-messages" class:selected={messagesSelected} type="button" aria-label="Messages" aria-current={messagesSelected ? 'page' : undefined} title="Messages" onclick={onmessages}>
    <Icon name="message" size={22} />
    <span class="sr-only">Messages</span>
  </button>
  <span class="cubic-primary-rule" aria-hidden="true"></span>
  <div class="cubic-primary-servers" aria-label="Your servers">
    <button class="cubic-primary-browse" class:selected={serverBrowserSelected} type="button" aria-label="Browse servers" aria-current={serverBrowserSelected ? 'page' : undefined} title="Browse servers" onclick={onbrowse}><Icon name="server" size={21} /></button>
    {#if loading}<span class="cubic-primary-status">Loading servers…</span>{/if}
    {#each servers as server (server.id)}
      <button class="cubic-primary-server" class:selected={selectedServerId === server.id} type="button" aria-label={`Open server ${server.name}`} aria-current={selectedServerId === server.id ? 'page' : undefined} title={server.name} onclick={() => onserver(server)}>
        <span class="cubic-primary-server-icon">{server.name.slice(0, 1).toUpperCase()}{#if server.iconUrl}{#key server.iconUrl}<img src={server.iconUrl} alt="" onerror={hideFailedIcon} />{/key}{/if}</span>
      </button>
    {/each}
    <button class="cubic-primary-create" type="button" aria-label="Create server" title="Create server" onclick={oncreate}><Icon name="plus" size={21} /></button>
  </div>
</nav>

<style>
  .cubic-primary-rail { --rail-padding: 10px; display: flex; flex-direction: column; align-items: center; gap: 8px; min-width: 0; min-height: 0; height: 100%; padding: 8px var(--rail-padding); border-right: 1px solid var(--ui-stroke); background: var(--ui-bg-deep); }
  .cubic-primary-servers { display: flex; flex: 1 1 auto; min-height: 0; width: calc(100% + var(--rail-padding) + var(--rail-padding)); padding-inline: var(--rail-padding); flex-direction: column; align-items: center; gap: 7px; overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; }
  button { position: relative; display: grid; flex: 0 0 44px; place-items: center; width: 44px; height: 44px; padding: 0; border: 1px solid transparent; border-radius: 14px; background: var(--ui-bg-raised); color: var(--ui-muted); cursor: pointer; transition: background var(--ui-motion-fast), border-radius var(--ui-motion-fast), color var(--ui-motion-fast); }
  button:hover { border-radius: 12px; background: var(--cubic-bg-hover); color: var(--ui-text); }
  button:focus-visible { outline: 2px solid var(--ui-focus-ring); outline-offset: 2px; }
  button.selected { border-color: var(--cubic-brand-border); border-radius: 12px; background: var(--cubic-brand-soft); color: var(--ui-text); }
  button.selected:hover { background: color-mix(in srgb, var(--ui-accent) 22%, var(--ui-bg-raised)); }
  button.selected::before { position: absolute; left: calc(0px - var(--rail-padding)); width: 3px; height: 30px; border-radius: 0 3px 3px 0; background: var(--ui-text); content: ''; }
  .cubic-primary-rule { flex: 0 0 1px; width: 28px; background: var(--ui-stroke); }
  .cubic-primary-server-icon { position: relative; display: grid; place-items: center; width: 40px; height: 40px; overflow: hidden; border-radius: 11px; background: var(--ui-bg-raised); color: var(--ui-text); font-weight: 800; }
  .cubic-primary-server-icon img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .cubic-primary-create { border-color: var(--ui-stroke); color: var(--ui-accent); }
  .cubic-primary-status { max-width: 52px; color: var(--cubic-muted); font-size: .65rem; text-align: center; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
  @media (max-width: 680px) { .cubic-primary-rail { --rail-padding: 6px; padding: 9px var(--rail-padding) max(9px, env(safe-area-inset-bottom)); } button { width: 46px; min-height: 46px; } }
</style>
