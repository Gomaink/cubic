<script lang="ts">
  import Icon from './Icon.svelte';

  type PresenceStatus = 'online' | 'idle' | 'offline';
  type Member = {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    role?: 'owner' | 'admin' | 'member';
  };

  let {
    title,
    members,
    statuses,
    onclose,
    onmemberclick
  }: {
    title: string;
    members: Member[];
    statuses: Record<string, PresenceStatus>;
    onclose: () => void;
    onmemberclick: (member: Member) => void;
  } = $props();

  const statusOrder: Record<PresenceStatus, number> = { online: 0, idle: 1, offline: 2 };
  const roleOrder = { owner: 0, admin: 1, member: 2 };
  function hideFailedAvatar(event: Event) {
    if (event.currentTarget instanceof HTMLImageElement) event.currentTarget.hidden = true;
  }
  const orderedMembers = $derived([...members].sort((left, right) => {
    const statusDifference = statusOrder[statuses[left.id] ?? 'offline'] - statusOrder[statuses[right.id] ?? 'offline'];
    if (statusDifference) return statusDifference;
    const roleDifference = roleOrder[left.role ?? 'member'] - roleOrder[right.role ?? 'member'];
    return roleDifference || left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id);
  }));
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape') onclose(); }} />

<aside class="cubic-member-panel" aria-label={title}>
  <header class="cubic-member-panel-head">
    <div><small>CONVERSATION</small><h2>{title}</h2></div>
    <button type="button" aria-label="Close member panel" title="Close members" onclick={onclose}>
      <Icon name="x" size={18} />
    </button>
  </header>
  <div class="cubic-member-panel-list">
    <p class="cubic-member-panel-count">Members — {members.length}</p>
    {#each orderedMembers as member (member.id)}
      {@const status = statuses[member.id] ?? 'offline'}
      <button type="button" class="cubic-member-panel-row" aria-label={`${member.displayName}, ${member.role ? `${member.role}, ` : ''}${status}`} onclick={() => onmemberclick(member)}>
        <span class="cubic-member-panel-avatar">
          {member.displayName.slice(0, 1).toUpperCase()}
          {#if member.avatarUrl}{#key member.avatarUrl}<img src={member.avatarUrl} alt="" onerror={hideFailedAvatar} />{/key}{/if}
          <span class:cubic-online={status === 'online'} class:cubic-idle={status === 'idle'} class="cubic-member-panel-dot" aria-hidden="true"></span>
        </span>
        <span class="cubic-member-panel-copy">
          <strong>{member.displayName}</strong>
          <small>@{member.username}{member.role ? ` · ${member.role}` : ''} · {status}</small>
        </span>
      </button>
    {/each}
  </div>
</aside>

<style>
  .cubic-member-panel { position: absolute; z-index: 12; inset: 0 0 0 auto; width: 240px; display: flex; flex-direction: column; min-height: 0; border-left: 1px solid #232428; background: #111214; box-shadow: -12px 0 28px rgba(0,0,0,.2); }
  .cubic-member-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 68px; padding: 12px 14px; border-bottom: 1px solid #232428; }
  .cubic-member-panel-head small { color: #949ba4; font-size: .6rem; letter-spacing: .08em; font-weight: 700; }
  .cubic-member-panel-head h2 { margin: 2px 0 0; color: #f2f3f5; font-size: .9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 165px; }
  .cubic-member-panel-head button { display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 4px; background: transparent; color: #b5bac1; cursor: pointer; }
  .cubic-member-panel-head button:hover { background: #2b2d31; }
  .cubic-member-panel-list { overflow-y: auto; min-height: 0; padding: 12px 8px; }
  .cubic-member-panel-count { margin: 0 7px 8px; color: #949ba4; font-size: .68rem; font-weight: 700; text-transform: uppercase; }
  .cubic-member-panel-row { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 48px; padding: 5px 7px; border: 0; border-radius: 5px; background: transparent; text-align: left; cursor: pointer; }
  .cubic-member-panel-row:hover { background: #1e1f22; }
  .cubic-member-panel-avatar { position: relative; display: grid; flex: 0 0 34px; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: #34363d; color: #f2f3f5; font-size: .8rem; font-weight: 700; }
  .cubic-member-panel-avatar img { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: inherit; object-fit: cover; }
  .cubic-member-panel-dot { position: absolute; right: -2px; bottom: -2px; width: 12px; height: 12px; border: 3px solid #111214; border-radius: 50%; background: #73767d; }
  .cubic-member-panel-dot.cubic-online { background: #23a55a; }
  .cubic-member-panel-dot.cubic-idle { background: #f0b232; }
  .cubic-member-panel-copy { min-width: 0; }
  .cubic-member-panel-copy strong, .cubic-member-panel-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cubic-member-panel-copy strong { color: #dbdee1; font-size: .78rem; }
  .cubic-member-panel-copy small { color: #949ba4; font-size: .66rem; text-transform: capitalize; }
  @media (max-width: 680px) { .cubic-member-panel { width: 100%; border-left: 0; } }
</style>
