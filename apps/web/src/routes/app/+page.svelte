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
  let conversations = $state<any[]>([]);
  let activeConversation = $state<any | null>(null);
  let chatMessages = $state<any[]>([]);
  let messageBody = $state('');
  let busy = $state(false);
  let error = $state('');
  let realtimeConnected = $state(false);
  let realtimeSocket: Socket | null = null;
  let refreshQueued = false;

  async function api(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers ?? {});

    if (init.body != null && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    const response = await fetch(path, {
      credentials: 'include',
      ...init,
      headers
    });
    if (response.status === 204) return null;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? 'Request failed.');
    return payload;
  }

  async function refreshSocial() {
    const [friendData, requestData] = await Promise.all([
      api('/api/v1/social/friends'),
      api('/api/v1/social/requests')
    ]);
    friends = friendData.friends;
    requests = requestData.requests;
  }

  async function refreshConversations() {
    const payload = await api('/api/v1/conversations');
    conversations = payload.conversations;
    if (activeConversation) {
      activeConversation = conversations.find((item: any) => item.id === activeConversation.id) ?? activeConversation;
    }
  }

  function queueConversationRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      refreshConversations().catch(() => {});
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
      // A reconnect or manual selection will retry.
    }
  }

  async function search() {
    error = '';
    if (query.trim().length < 2) {
      searchResults = [];
      return;
    }
    try {
      searchResults = (await api(`/api/v1/social/search?q=${encodeURIComponent(query.trim())}`)).users;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Search failed.';
    }
  }

  async function addFriend(userId: string) {
    try {
      await api('/api/v1/social/requests', {
        method: 'POST',
        body: JSON.stringify({ userId })
      });
      await refreshSocial();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not send friend request.';
    }
  }

  async function acceptRequest(id: string) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await api(`/api/v1/social/requests/${id}/accept`, { method: 'POST' });
      await Promise.all([refreshSocial(), refreshConversations()]);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not accept friend request.';
    } finally {
      busy = false;
    }
  }

  async function dismissRequest(id: string) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await api(`/api/v1/social/requests/${id}`, { method: 'DELETE' });
      await refreshSocial();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not dismiss friend request.';
    } finally {
      busy = false;
    }
  }

  async function openDirect(userId: string) {
    busy = true;
    error = '';
    try {
      const result = await api('/api/v1/conversations/direct', {
        method: 'POST',
        body: JSON.stringify({ userId })
      });
      await refreshConversations();
      const conversation = conversations.find((item: any) => item.id === result.conversationId);
      if (conversation) await selectConversation(conversation);
      tab = 'chats';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not open conversation.';
    } finally {
      busy = false;
    }
  }

  async function selectConversation(conversation: any) {
    activeConversation = conversation;
    const payload = await api(`/api/v1/conversations/${conversation.id}/messages?limit=50`);
    chatMessages = payload.messages;

    realtimeSocket?.timeout(4000).emit(
      'conversation:join',
      { conversationId: conversation.id },
      () => {}
    );
  }

  function createClientMessageId() {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }

    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
    return [
      hex.slice(0, 4).join(''),
      hex.slice(4, 6).join(''),
      hex.slice(6, 8).join(''),
      hex.slice(8, 10).join(''),
      hex.slice(10, 16).join('')
    ].join('-');
  }

  async function sendMessage() {
    const body = messageBody.trim();
    if (!body || !activeConversation || busy) return;

    const conversationId = activeConversation.id;
    messageBody = '';
    busy = true;
    error = '';

    try {
      const result = await api(`/api/v1/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ clientMessageId: createClientMessageId(), body })
      });

      if (activeConversation?.id === conversationId && result?.message) {
        upsertMessage(result.message);
      }
      await refreshConversations();
    } catch (e) {
      messageBody = body;
      error = e instanceof Error ? e.message : 'Could not send message.';
    } finally {
      busy = false;
    }
  }

  async function logout() {
    loggingOut = true;
    realtimeSocket?.disconnect();
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
    } finally {
      window.location.assign('/login');
    }
  }

  onMount(() => {
    Promise.all([refreshSocial(), refreshConversations()]).catch((e) => error = e.message);

    const socket = io({
      path: '/socket.io',
      withCredentials: true,
      transports: ['websocket', 'polling'],
      timeout: 5000,
      reconnection: true
    });
    realtimeSocket = socket;

    socket.on('connect', () => {
      realtimeConnected = true;
      Promise.all([refreshConversations(), syncActiveConversation()]).catch(() => {});
    });

    socket.on('disconnect', () => {
      realtimeConnected = false;
    });

    socket.on('connect_error', () => {
      realtimeConnected = false;
    });

    socket.on('message:created', (message: any) => {
      if (activeConversation?.id === message.conversationId) {
        upsertMessage(message);
      }
      queueConversationRefresh();
    });

    socket.on('conversation:updated', () => {
      queueConversationRefresh();
    });

    const resumeRealtime = () => {
      if (document.visibilityState === 'hidden') return;

      if (!socket.connected) {
        socket.connect();
      }

      Promise.all([
        refreshSocial(),
        refreshConversations(),
        syncActiveConversation()
      ]).catch(() => {});
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        resumeRealtime();
      }
    };

    window.addEventListener('pageshow', resumeRealtime);
    window.addEventListener('focus', resumeRealtime);
    window.addEventListener('online', resumeRealtime);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
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
    <button class:active={tab === 'people'} onclick={() => tab = 'people'}>People {requests.filter((r) => r.direction === 'incoming').length ? `(${requests.filter((r) => r.direction === 'incoming').length})` : ''}</button>
    <div class="messenger-nav-spacer"></div>
    <div class="mini-profile"><span>{data.user.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{data.user.displayName}</strong><small>@{data.user.username}</small></div></div>
    <button onclick={logout} disabled={loggingOut}>{loggingOut ? 'Logging out…' : 'Log out'}</button>
  </aside>

  <section class="conversation-list">
    {#if tab === 'chats'}
      <header><div><small>MESSAGES</small><h1>Conversations</h1></div></header>
      {#if conversations.length === 0}<div class="empty-state">No conversations yet.<br />Add a friend and start a DM.</div>{/if}
      {#each conversations as conversation}
        <button class="conversation-row" class:active={activeConversation?.id === conversation.id} onclick={() => selectConversation(conversation)}>
          <span class="avatar">{(conversation.peer?.displayName ?? '?').slice(0,1).toUpperCase()}</span>
          <span class="conversation-copy"><strong>{conversation.peer?.displayName ?? conversation.title ?? 'Conversation'}</strong><small>{conversation.lastMessage?.body ?? `@${conversation.peer?.username ?? ''}`}</small></span>
        </button>
      {/each}
    {:else}
      <header><div><small>SOCIAL</small><h1>People</h1></div></header>
      <div class="people-search"><input bind:value={query} oninput={search} placeholder="Search username or name" /></div>
      {#if error}<div class="inline-error">{error}</div>{/if}
      {#if requests.length}<h2 class="section-label">Requests</h2>{/if}
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
        <button
          class="chat-back"
          type="button"
          aria-label="Back to conversations"
          onclick={() => {
            activeConversation = null;
            chatMessages = [];
          }}
        >
          ‹
        </button>

        <span class="avatar">
          {(activeConversation.peer?.displayName ?? '?').slice(0,1).toUpperCase()}
        </span>

        <div>
          <strong>{activeConversation.peer?.displayName ?? 'Conversation'}</strong>
          <small>@{activeConversation.peer?.username ?? ''}</small>
        </div>
      </header>

      <div class="messages">
        {#if chatMessages.length === 0}
          <div class="chat-empty">
            <strong>No messages yet</strong>
            <span>Send the first message to start the conversation.</span>
          </div>
        {/if}

        {#each chatMessages as message}
          <div class="message" class:mine={message.senderId === data.user.id}>
            <div class="message-bubble">
              {message.deletedAt ? 'Message deleted' : message.body}
            </div>
            <small>
              {new Date(message.createdAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit'
              })}
            </small>
          </div>
        {/each}
      </div>

      {#if error}
        <div class="inline-error chat-error">{error}</div>
      {/if}

      <form
        class="composer"
        onsubmit={(event) => {
          event.preventDefault();
          sendMessage();
        }}
      >
        <input
          bind:value={messageBody}
          maxlength="8000"
          autocomplete="off"
          placeholder="Message…"
        />
        <button type="submit" disabled={!messageBody.trim() || busy}>Send</button>
      </form>
    {:else}
      <div class="chat-placeholder">
        <img src="/images/cubic-w-nobg.png" alt="" />
        <h2>Your Cubic conversations</h2>
        <p>Select a chat, or open People to start one with a friend.</p>
      </div>
    {/if}
  </section>
</main>
