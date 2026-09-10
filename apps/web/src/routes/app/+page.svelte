<script lang="ts">
  import { onMount } from 'svelte';
  import { io, type Socket } from 'socket.io-client';

  let { data } = $props();
  let loggingOut = $state(false);
  let tab = $state<'chats' | 'people'>('chats');
  let query = $state('');
  let searchResults = $state<any[]>([]);
  let friends = $state<any[]>([]);
  let requests = $state<any[]>([]);
  let groupInvites = $state<any[]>([]);
  let conversations = $state<any[]>([]);
  let activeConversation = $state<any | null>(null);
  let chatMessages = $state<any[]>([]);
  let messageBody = $state('');
  let busy = $state(false);
  let error = $state('');
  let realtimeConnected = $state(false);
  let realtimeSocket: Socket | null = null;
  let refreshQueued = false;

  let newGroupOpen = $state(false);
  let newGroupTitle = $state('');
  let newGroupMemberIds = $state<string[]>([]);
  let groupPanelOpen = $state(false);
  let groupDetails = $state<any | null>(null);
  let groupRename = $state('');
  let avatarUploading = $state(false);
  let avatarError = $state('');
  let avatarInput: HTMLInputElement | null = null;

  async function api(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers ?? {});
    if (typeof init.body === 'string' && !headers.has('content-type')) headers.set('content-type', 'application/json');

    const response = await fetch(path, { credentials: 'include', ...init, headers });
    if (response.status === 204) return null;

    const raw = await response.text();
    let payload: any = {};

    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = {};
    }

    if (!response.ok) {
      throw new Error(
        payload.error ??
        `Request failed (${response.status}${response.statusText ? ` ${response.statusText}` : ''}).`
      );
    }

    return payload;
  }

  function conversationName(conversation: any) {
    return conversation.kind === 'group'
      ? conversation.title ?? 'Untitled group'
      : conversation.peer?.displayName ?? 'Conversation';
  }

  function conversationMeta(conversation: any) {
    if (conversation.lastMessage?.body) return conversation.lastMessage.body;
    if (conversation.kind === 'group') return `${conversation.memberCount ?? 0} members`;
    return `@${conversation.peer?.username ?? ''}`;
  }

  function conversationLetter(conversation: any) {
    return conversationName(conversation).slice(0, 1).toUpperCase() || '?';
  }

  async function refreshSocial() {
    const [friendData, requestData] = await Promise.all([
      api('/api/v1/social/friends'),
      api('/api/v1/social/requests')
    ]);
    friends = friendData.friends;
    requests = requestData.requests;
  }

  async function refreshGroupInvites() {
    const payload = await api('/api/v1/groups/invites');
    groupInvites = payload.invites;
  }

  async function refreshConversations() {
    const payload = await api('/api/v1/conversations');
    conversations = payload.conversations;
    if (activeConversation) {
      const refreshed = conversations.find((item: any) => item.id === activeConversation.id);
      if (refreshed) activeConversation = refreshed;
    }
  }

  async function refreshGroupDetails() {
    if (!activeConversation || activeConversation.kind !== 'group') {
      groupDetails = null;
      return;
    }
    const payload = await api(`/api/v1/groups/${activeConversation.id}`);
    groupDetails = payload.group;
    groupRename = payload.group.title;
  }

  function queueConversationRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      Promise.all([refreshConversations(), refreshGroupDetails()]).catch(() => {});
    });
  }

  function upsertMessage(message: any) {
    const index = chatMessages.findIndex((item: any) => item.id === message.id);
    if (index >= 0) {
      chatMessages[index] = message;
      chatMessages = [...chatMessages];
      return;
    }
    chatMessages = [...chatMessages, message].sort(
      (a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }

  async function syncActiveConversation() {
    if (!activeConversation) return;
    try {
      const payload = await api(`/api/v1/conversations/${activeConversation.id}/messages?limit=50`);
      chatMessages = payload.messages;
    } catch {
      // Resume/reconnect will retry.
    }
  }

  async function search() {
    error = '';
    if (query.trim().length < 2) { searchResults = []; return; }
    try {
      searchResults = (await api(`/api/v1/social/search?q=${encodeURIComponent(query.trim())}`)).users;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Search failed.';
    }
  }

  async function addFriend(userId: string) {
    try {
      await api('/api/v1/social/requests', { method: 'POST', body: JSON.stringify({ userId }) });
      await refreshSocial();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not send friend request.';
    }
  }

  async function acceptRequest(id: string) {
    if (busy) return;
    busy = true; error = '';
    try {
      await api(`/api/v1/social/requests/${id}/accept`, { method: 'POST' });
      await Promise.all([refreshSocial(), refreshGroupInvites(), refreshConversations()]);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not accept friend request.';
    } finally { busy = false; }
  }

  async function dismissRequest(id: string) {
    if (busy) return;
    busy = true; error = '';
    try {
      await api(`/api/v1/social/requests/${id}`, { method: 'DELETE' });
      await refreshSocial();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not dismiss friend request.';
    } finally { busy = false; }
  }

  async function openDirect(userId: string) {
    busy = true; error = '';
    try {
      const result = await api('/api/v1/conversations/direct', { method: 'POST', body: JSON.stringify({ userId }) });
      await refreshConversations();
      const conversation = conversations.find((item: any) => item.id === result.conversationId);
      if (conversation) await selectConversation(conversation);
      tab = 'chats';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not open conversation.';
    } finally { busy = false; }
  }

  async function selectConversation(conversation: any) {
    activeConversation = conversation;
    groupPanelOpen = false;
    groupDetails = null;
    const payload = await api(`/api/v1/conversations/${conversation.id}/messages?limit=50`);
    chatMessages = payload.messages;
    if (conversation.kind === 'group') await refreshGroupDetails();

    realtimeSocket?.timeout(4000).emit('conversation:join', { conversationId: conversation.id }, () => {});
  }

  function closeConversation() {
    activeConversation = null;
    chatMessages = [];
    groupDetails = null;
    groupPanelOpen = false;
  }

  function createClientMessageId() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
    return [hex.slice(0,4).join(''), hex.slice(4,6).join(''), hex.slice(6,8).join(''), hex.slice(8,10).join(''), hex.slice(10,16).join('')].join('-');
  }

  async function sendMessage() {
    const body = messageBody.trim();
    if (!body || !activeConversation || busy) return;
    const conversationId = activeConversation.id;
    messageBody = ''; busy = true; error = '';
    try {
      const result = await api(`/api/v1/conversations/${conversationId}/messages`, {
        method: 'POST', body: JSON.stringify({ clientMessageId: createClientMessageId(), body })
      });
      if (activeConversation?.id === conversationId && result?.message) upsertMessage(result.message);
      await refreshConversations();
    } catch (e) {
      messageBody = body;
      error = e instanceof Error ? e.message : 'Could not send message.';
    } finally { busy = false; }
  }

  function toggleNewGroupMember(userId: string) {
    newGroupMemberIds = newGroupMemberIds.includes(userId)
      ? newGroupMemberIds.filter((id) => id !== userId)
      : [...newGroupMemberIds, userId];
  }

  function openNewGroup() {
    error = '';
    newGroupTitle = '';
    newGroupMemberIds = [];
    newGroupOpen = true;
  }

  async function createGroup() {
    if (busy || !newGroupTitle.trim() || newGroupMemberIds.length === 0) return;
    busy = true; error = '';
    try {
      const result = await api('/api/v1/groups', {
        method: 'POST',
        body: JSON.stringify({ title: newGroupTitle.trim(), memberIds: newGroupMemberIds })
      });
      newGroupOpen = false;
      newGroupTitle = '';
      newGroupMemberIds = [];
      await refreshConversations();
      const conversation = conversations.find((item: any) => item.id === result.group.id);
      if (conversation) await selectConversation(conversation);
      tab = 'chats';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not create group.';
    } finally { busy = false; }
  }

  async function renameGroup() {
    if (!activeConversation || !groupRename.trim() || busy) return;
    busy = true; error = '';
    try {
      const result = await api(`/api/v1/groups/${activeConversation.id}`, {
        method: 'PATCH', body: JSON.stringify({ title: groupRename.trim() })
      });
      groupDetails = result.group;
      await refreshConversations();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not rename group.';
    } finally { busy = false; }
  }

  async function inviteGroupMember(userId: string) {
    if (!activeConversation || busy) return;
    busy = true; error = '';
    try {
      const result = await api(`/api/v1/groups/${activeConversation.id}/invites`, {
        method: 'POST', body: JSON.stringify({ userId })
      });
      groupDetails = result.group;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not invite friend.';
    } finally { busy = false; }
  }

  async function cancelGroupInvite(inviteId: string) {
    if (busy) return;
    busy = true; error = '';
    try {
      await api(`/api/v1/groups/invites/${inviteId}`, { method: 'DELETE' });
      await refreshGroupDetails();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not cancel invitation.';
    } finally { busy = false; }
  }

  async function acceptGroupInvite(inviteId: string) {
    if (busy) return;
    busy = true; error = '';
    try {
      const result = await api(`/api/v1/groups/invites/${inviteId}/accept`, { method: 'POST' });
      await Promise.all([refreshGroupInvites(), refreshConversations()]);
      const conversation = conversations.find((item: any) => item.id === result.group.id);
      if (conversation) await selectConversation(conversation);
      tab = 'chats';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not accept group invitation.';
    } finally { busy = false; }
  }

  async function declineGroupInvite(inviteId: string) {
    if (busy) return;
    busy = true; error = '';
    try {
      await api(`/api/v1/groups/invites/${inviteId}/decline`, { method: 'POST' });
      await refreshGroupInvites();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not decline group invitation.';
    } finally { busy = false; }
  }

  async function uploadGroupAvatar(event: Event) {
    if (!activeConversation || avatarUploading) return;

    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const allowedTypes = new Set([
      'image/png',
      'image/jpeg',
      'image/webp'
    ]);

    if (!allowedTypes.has(file.type)) {
      avatarError = `Unsupported image type: ${file.type || 'unknown'}. Use PNG, JPEG or WebP.`;
      input.value = '';
      return;
    }

    const maxBytes = 2 * 1024 * 1024;

    if (file.size > maxBytes) {
      const sizeMb = (file.size / 1024 / 1024).toFixed(2);
      avatarError = `Image is ${sizeMb} MB. Maximum allowed size is 2 MB.`;
      input.value = '';
      return;
    }

    avatarUploading = true;
    avatarError = '';
    error = '';

    try {
      const body = new FormData();
      body.append('avatar', file, file.name);

      const result = await api(`/api/v1/groups/${activeConversation.id}/avatar`, {
        method: 'POST',
        body
      });

      groupDetails = result.group;
      await refreshConversations();
    } catch (e) {
      avatarError = e instanceof Error ? e.message : 'Could not upload group avatar.';
    } finally {
      input.value = '';
      avatarUploading = false;
    }
  }

  async function removeGroupAvatar() {
    if (!activeConversation || busy) return;
    busy = true; error = '';
    try {
      await api(`/api/v1/groups/${activeConversation.id}/avatar`, { method: 'DELETE' });
      await Promise.all([refreshGroupDetails(), refreshConversations()]);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not remove group avatar.';
    } finally { busy = false; }
  }

  async function setGroupRole(userId: string, role: 'admin' | 'member') {
    if (!activeConversation || busy) return;
    busy = true; error = '';
    try {
      const result = await api(`/api/v1/groups/${activeConversation.id}/members/${userId}`, {
        method: 'PATCH', body: JSON.stringify({ role })
      });
      groupDetails = result.group;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not change role.';
    } finally { busy = false; }
  }

  async function removeGroupMember(userId: string) {
    if (!activeConversation || busy) return;
    busy = true; error = '';
    try {
      const result = await api(`/api/v1/groups/${activeConversation.id}/members/${userId}`, { method: 'DELETE' });
      groupDetails = result.group;
      await refreshConversations();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not remove member.';
    } finally { busy = false; }
  }

  async function transferGroupOwner(userId: string) {
    if (!activeConversation || busy) return;
    if (!confirm('Transfer ownership to this member? You will become an admin.')) return;
    busy = true; error = '';
    try {
      const result = await api(`/api/v1/groups/${activeConversation.id}/transfer-owner`, {
        method: 'POST', body: JSON.stringify({ userId })
      });
      groupDetails = result.group;
      await refreshConversations();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not transfer ownership.';
    } finally { busy = false; }
  }

  async function leaveGroup() {
    if (!activeConversation || busy) return;
    if (!confirm('Leave this group?')) return;
    const id = activeConversation.id;
    busy = true; error = '';
    try {
      await api(`/api/v1/groups/${id}/leave`, { method: 'POST' });
      closeConversation();
      await refreshConversations();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not leave group.';
    } finally { busy = false; }
  }

  async function deleteGroup() {
    if (!activeConversation || busy) return;
    if (!confirm('Delete this group permanently? Messages will be deleted too.')) return;
    const id = activeConversation.id;
    busy = true; error = '';
    try {
      await api(`/api/v1/groups/${id}`, { method: 'DELETE' });
      closeConversation();
      await refreshConversations();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not delete group.';
    } finally { busy = false; }
  }

  async function logout() {
    loggingOut = true;
    realtimeSocket?.disconnect();
    try { await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' }); }
    finally { window.location.assign('/login'); }
  }

  onMount(() => {
    Promise.all([refreshSocial(), refreshGroupInvites(), refreshConversations()]).catch((e) => error = e.message);

    const socket = io({
      path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'], timeout: 5000, reconnection: true
    });
    realtimeSocket = socket;

    socket.on('connect', () => {
      realtimeConnected = true;
      Promise.all([refreshSocial(), refreshGroupInvites(), refreshConversations(), syncActiveConversation(), refreshGroupDetails()]).catch(() => {});
    });
    socket.on('disconnect', () => { realtimeConnected = false; });
    socket.on('connect_error', () => { realtimeConnected = false; });
    socket.on('message:created', (message: any) => {
      if (activeConversation?.id === message.conversationId) upsertMessage(message);
      queueConversationRefresh();
    });
    socket.on('conversation:updated', (event: any) => {
      queueConversationRefresh();
      if (activeConversation?.id === event?.conversationId && activeConversation.kind === 'group') {
        refreshGroupDetails().catch(() => {});
      }
    });
    socket.on('conversation:removed', (event: any) => {
      if (activeConversation?.id === event?.conversationId) closeConversation();
      refreshConversations().catch(() => {});
    });
    socket.on('group:invites:updated', () => {
      refreshGroupInvites().catch(() => {});
    });

    let resumeTimer: ReturnType<typeof setTimeout> | undefined;

    const resumeRealtime = () => {
      if (document.visibilityState === 'hidden') return;

      if (resumeTimer) clearTimeout(resumeTimer);

      resumeTimer = setTimeout(() => {
        if (document.visibilityState === 'hidden') return;

        if (!socket.connected) socket.connect();

        Promise.all([
          refreshSocial(),
          refreshGroupInvites(),
          refreshConversations(),
          syncActiveConversation(),
          refreshGroupDetails()
        ]).catch(() => {});
      }, 500);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') resumeRealtime();
    };

    window.addEventListener('pageshow', resumeRealtime);
    window.addEventListener('focus', resumeRealtime);
    window.addEventListener('online', resumeRealtime);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      if (resumeTimer) clearTimeout(resumeTimer);

      window.removeEventListener('pageshow', resumeRealtime);
      window.removeEventListener('focus', resumeRealtime);
      window.removeEventListener('online', resumeRealtime);
      document.removeEventListener('visibilitychange', onVisibilityChange);

      realtimeSocket = null;
      socket.disconnect();
    };
  });
</script>

<svelte:head><title>Cubic — {data.user.displayName}</title></svelte:head>

<main class="messenger-shell">
  <aside class="messenger-nav">
    <div class="messenger-brand"><img src="/images/cubic-w-nobg.png" alt="" /><strong>Cubic</strong><span title={realtimeConnected ? 'Realtime connected' : 'Realtime reconnecting'}>{realtimeConnected ? 'LIVE' : 'SYNC'}</span></div>
    <button class:active={tab === 'chats'} onclick={() => tab = 'chats'}>Chats</button>
    <button class:active={tab === 'people'} onclick={() => { tab = 'people'; closeConversation(); }}>People {(requests.filter((r) => r.direction === 'incoming').length + groupInvites.length) ? `(${requests.filter((r) => r.direction === 'incoming').length + groupInvites.length})` : ''}</button>
    <div class="messenger-nav-spacer"></div>
    <div class="mini-profile"><span>{data.user.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{data.user.displayName}</strong><small>@{data.user.username}</small></div></div>
    <button onclick={logout} disabled={loggingOut}>{loggingOut ? 'Logging out…' : 'Log out'}</button>
  </aside>

  <section class="conversation-list">
    {#if tab === 'chats'}
      <header class="conversation-list-header">
        <div><small>MESSAGES</small><h1>Conversations</h1></div>
        <button class="icon-action" type="button" aria-label="New group" title="New group" onclick={openNewGroup}>+</button>
      </header>
      {#if conversations.length === 0}<div class="empty-state">No conversations yet.<br />Add a friend or create a group.</div>{/if}
      {#each conversations as conversation}
        <button class="conversation-row" class:active={activeConversation?.id === conversation.id} onclick={() => selectConversation(conversation)}>
          {#if conversation.kind === 'group' && conversation.avatarUrl}
            <img class="avatar group-avatar avatar-image" src={conversation.avatarUrl} alt="" />
          {:else}
            <span class="avatar" class:group-avatar={conversation.kind === 'group'}>{conversationLetter(conversation)}</span>
          {/if}
          <span class="conversation-copy">
            <strong>{conversationName(conversation)}</strong>
            <small>{conversationMeta(conversation)}</small>
          </span>
          {#if conversation.kind === 'group'}<span class="conversation-kind">GROUP</span>{/if}
        </button>
      {/each}
    {:else}
      <header><div><small>SOCIAL</small><h1>People</h1></div></header>
      <div class="people-search"><input bind:value={query} oninput={search} placeholder="Search username or name" /></div>
      {#if error}<div class="inline-error">{error}</div>{/if}
      {#if groupInvites.length}<h2 class="section-label">Group invitations</h2>{/if}
      {#each groupInvites as invite}
        <div class="person-row">
          {#if invite.group.avatarUrl}<img class="avatar group-avatar avatar-image" src={invite.group.avatarUrl} alt="" />{:else}<span class="avatar group-avatar">{invite.group.title.slice(0,1).toUpperCase()}</span>{/if}
          <div><strong>{invite.group.title}</strong><small>Invited by @{invite.inviter.username}</small></div>
          <div class="row-actions"><button onclick={() => acceptGroupInvite(invite.id)} disabled={busy}>Accept</button><button class="quiet" onclick={() => declineGroupInvite(invite.id)} disabled={busy}>Decline</button></div>
        </div>
      {/each}
      {#if requests.length}<h2 class="section-label">Friend requests</h2>{/if}
      {#each requests as request}
        <div class="person-row"><span class="avatar">{request.user.displayName.slice(0,1).toUpperCase()}</span><div><strong>{request.user.displayName}</strong><small>@{request.user.username} · {request.direction}</small></div><div class="row-actions">{#if request.direction === 'incoming'}<button onclick={() => acceptRequest(request.id)}>Accept</button>{/if}<button class="quiet" onclick={() => dismissRequest(request.id)}>{request.direction === 'incoming' ? 'Decline' : 'Cancel'}</button></div></div>
      {/each}
      {#if friends.length}<h2 class="section-label">Friends</h2>{/if}
      {#each friends as friend}
        <div class="person-row"><span class="avatar">{friend.displayName.slice(0,1).toUpperCase()}</span><div><strong>{friend.displayName}</strong><small>@{friend.username}</small></div><div class="row-actions"><button onclick={() => openDirect(friend.id)} disabled={busy}>Message</button></div></div>
      {/each}
      {#if searchResults.length}<h2 class="section-label">Search</h2>{/if}
      {#each searchResults as person}
        <div class="person-row"><span class="avatar">{person.displayName.slice(0,1).toUpperCase()}</span><div><strong>{person.displayName}</strong><small>@{person.username}</small></div><div class="row-actions"><button onclick={() => addFriend(person.id)}>Add</button></div></div>
      {/each}
    {/if}
  </section>

  <section class="chat-panel" class:open={activeConversation !== null}>
    {#if activeConversation}
      <header class="chat-header">
        <button class="chat-back" type="button" aria-label="Back to conversations" onclick={closeConversation}>‹</button>
        {#if activeConversation.kind === 'group' && (activeConversation.avatarUrl ?? groupDetails?.avatarUrl)}
          <img class="avatar group-avatar avatar-image" src={activeConversation.avatarUrl ?? groupDetails?.avatarUrl} alt="" />
        {:else}
          <span class="avatar" class:group-avatar={activeConversation.kind === 'group'}>{conversationLetter(activeConversation)}</span>
        {/if}
        <div class="chat-heading">
          <strong>{conversationName(activeConversation)}</strong>
          <small>{activeConversation.kind === 'group' ? `${activeConversation.memberCount ?? groupDetails?.members?.length ?? 0} members` : `@${activeConversation.peer?.username ?? ''}`}</small>
        </div>
        {#if activeConversation.kind === 'group'}
          <button class="chat-meta-button" type="button" onclick={() => { groupPanelOpen = !groupPanelOpen; if (groupPanelOpen) refreshGroupDetails().catch(() => {}); }}>Group</button>
        {/if}
      </header>

      <div class="messages">
        {#if chatMessages.length === 0}
          <div class="chat-empty"><strong>No messages yet</strong><span>Send the first message to start the conversation.</span></div>
        {/if}
        {#each chatMessages as message}
          <div class="message" class:mine={message.senderId === data.user.id}>
            {#if activeConversation.kind === 'group' && message.senderId !== data.user.id}
              <small class="message-author">{message.senderDisplayName ?? message.senderUsername ?? 'Member'}</small>
            {/if}
            <div class="message-bubble">{message.deletedAt ? 'Message deleted' : message.body}</div>
            <small>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
          </div>
        {/each}
      </div>

      {#if error}<div class="inline-error chat-error">{error}</div>{/if}
      <form class="composer" onsubmit={(event) => { event.preventDefault(); sendMessage(); }}>
        <input bind:value={messageBody} maxlength="8000" autocomplete="off" placeholder="Message…" />
        <button type="submit" disabled={!messageBody.trim() || busy}>Send</button>
      </form>

      {#if groupPanelOpen && groupDetails}
        <aside class="group-panel" aria-label="Group settings">
          <div class="group-panel-head">
            <div><small>GROUP</small><h2>{groupDetails.title}</h2></div>
            <button class="icon-action" type="button" aria-label="Close group settings" onclick={() => groupPanelOpen = false}>×</button>
          </div>

          {#if groupDetails.currentRole === 'owner' || groupDetails.currentRole === 'admin'}
            <div class="group-setting-block">
              <span class="modal-section-title">Group avatar</span>
              <div class="group-avatar-editor">
                {#if groupDetails.avatarUrl}<img class="avatar group-avatar group-avatar-large avatar-image" src={groupDetails.avatarUrl} alt="" />{:else}<span class="avatar group-avatar group-avatar-large">{groupDetails.title.slice(0,1).toUpperCase()}</span>{/if}
                <input
                  class="avatar-file-input"
                  bind:this={avatarInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onchange={uploadGroupAvatar}
                  disabled={avatarUploading}
                />

                <button
                  class="upload-button"
                  type="button"
                  onclick={() => avatarInput?.click()}
                  disabled={avatarUploading}
                >
                  {avatarUploading ? 'Uploading…' : 'Change'}
                </button>

                {#if groupDetails.avatarUrl}
                  <button class="quiet" onclick={removeGroupAvatar} disabled={busy || avatarUploading}>
                    Remove
                  </button>
                {/if}
              </div>

              <small class="setting-hint">PNG, JPEG or WebP · max 2 MB</small>

              {#if avatarError}
                <div class="inline-error avatar-upload-error">{avatarError}</div>
              {/if}
            </div>
            <div class="group-setting-block">
              <label for="group-name">Group name</label>
              <div class="group-inline-form"><input id="group-name" bind:value={groupRename} maxlength="96" /><button onclick={renameGroup} disabled={busy || !groupRename.trim()}>Save</button></div>
            </div>
          {/if}

          <div class="group-setting-block">
            <div class="group-setting-title"><strong>Members</strong><span>{groupDetails.members.length}</span></div>
            {#each groupDetails.members as member}
              <div class="group-member-row">
                <span class="avatar small-avatar">{member.displayName.slice(0,1).toUpperCase()}</span>
                <div class="group-member-copy"><strong>{member.displayName}</strong><small>@{member.username} · {member.role}</small></div>
                <div class="group-member-actions">
                  {#if groupDetails.currentRole === 'owner' && member.id !== data.user.id && member.role !== 'owner'}
                    <button class="quiet" onclick={() => setGroupRole(member.id, member.role === 'admin' ? 'member' : 'admin')}>{member.role === 'admin' ? 'Demote' : 'Admin'}</button>
                    <button class="quiet" onclick={() => transferGroupOwner(member.id)}>Owner</button>
                  {/if}
                  {#if member.id !== data.user.id && member.role !== 'owner' && (groupDetails.currentRole === 'owner' || (groupDetails.currentRole === 'admin' && member.role === 'member'))}
                    <button class="danger-button" onclick={() => removeGroupMember(member.id)}>Remove</button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>

          {#if groupDetails.currentRole === 'owner' || groupDetails.currentRole === 'admin'}
            {#if groupDetails.pendingInvites?.length}
              <div class="group-setting-block">
                <div class="group-setting-title"><strong>Pending invitations</strong><span>{groupDetails.pendingInvites.length}</span></div>
                {#each groupDetails.pendingInvites as invite}
                  <div class="group-member-row">
                    <span class="avatar small-avatar">{invite.user.displayName.slice(0,1).toUpperCase()}</span>
                    <div class="group-member-copy"><strong>{invite.user.displayName}</strong><small>@{invite.user.username} · pending</small></div>
                    <button class="quiet" onclick={() => cancelGroupInvite(invite.id)} disabled={busy}>Cancel</button>
                  </div>
                {/each}
              </div>
            {/if}
            <div class="group-setting-block">
              <strong>Invite friends</strong>
              {#each friends.filter((friend) => !groupDetails.members.some((member: any) => member.id === friend.id) && !groupDetails.pendingInvites?.some((invite: any) => invite.user.id === friend.id)) as friend}
                <div class="group-member-row">
                  <span class="avatar small-avatar">{friend.displayName.slice(0,1).toUpperCase()}</span>
                  <div class="group-member-copy"><strong>{friend.displayName}</strong><small>@{friend.username}</small></div>
                  <button onclick={() => inviteGroupMember(friend.id)} disabled={busy}>Invite</button>
                </div>
              {/each}
            </div>
          {/if}

          <div class="group-setting-block group-danger-zone">
            {#if groupDetails.currentRole === 'owner'}
              <p>Transfer ownership before leaving while other members remain.</p>
              <button class="danger-button wide" onclick={deleteGroup} disabled={busy}>Delete group</button>
            {:else}
              <button class="danger-button wide" onclick={leaveGroup} disabled={busy}>Leave group</button>
            {/if}
          </div>
        </aside>
      {/if}
    {:else}
      <div class="chat-placeholder"><img src="/images/cubic-w-nobg.png" alt="" /><h2>Your Cubic conversations</h2><p>Select a chat, or create a group with your friends.</p></div>
    {/if}
  </section>

  {#if newGroupOpen}
    <div class="modal-backdrop">
      <section class="group-create-modal" role="dialog" aria-modal="true" aria-labelledby="new-group-title">
        <div class="group-panel-head"><div><small>NEW</small><h2 id="new-group-title">Create group</h2></div><button class="icon-action" type="button" aria-label="Close" onclick={() => newGroupOpen = false}>×</button></div>
        <label for="new-group-name">Group name</label>
        <input id="new-group-name" bind:value={newGroupTitle} maxlength="96" placeholder="Weekend crew" />
        <strong class="modal-section-title">Choose friends</strong>
        <div class="group-friend-picker">
          {#each friends as friend}
            <label class="group-friend-option">
              <input type="checkbox" checked={newGroupMemberIds.includes(friend.id)} onchange={() => toggleNewGroupMember(friend.id)} />
              <span class="avatar small-avatar">{friend.displayName.slice(0,1).toUpperCase()}</span>
              <span><strong>{friend.displayName}</strong><small>@{friend.username}</small></span>
            </label>
          {/each}
          {#if friends.length === 0}<p class="empty-state">Add a friend before creating a group.</p>{/if}
        </div>
        {#if error}<div class="inline-error">{error}</div>{/if}
        <button class="primary-wide" onclick={createGroup} disabled={busy || !newGroupTitle.trim() || newGroupMemberIds.length === 0}>{busy ? 'Creating…' : `Create group (${newGroupMemberIds.length + 1})`}</button>
      </section>
    </div>
  {/if}
</main>
