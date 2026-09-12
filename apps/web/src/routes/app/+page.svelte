<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { io, type Socket } from 'socket.io-client';
  import { Room, RoomEvent, Track } from 'livekit-client';
  import Icon from '$lib/ui/Icon.svelte';
  import VideoTile from '$lib/ui/VideoTile.svelte';
  import ScreenShareTile from '$lib/ui/ScreenShareTile.svelte';
  import MessageAttachments from '$lib/ui/MessageAttachments.svelte';

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

  type VoiceParticipantView = {
    identity: string;
    name: string;
    muted: boolean;
    speaking: boolean;
    local: boolean;
    cameraEnabled: boolean;
    videoTrack: any | null;
    screenShareEnabled: boolean;
    screenShareTrack: any | null;
    screenShareAudioEnabled: boolean;
  };

  let voiceRoom: Room | null = null;
  let voiceConversationId = $state<string | null>(null);
  let voiceConversationTitle = $state('');
  let voiceStatus = $state<'idle' | 'connecting' | 'connected' | 'reconnecting'>('idle');
  let voiceParticipants = $state<VoiceParticipantView[]>([]);
  let voiceMuted = $state(false);
  let voiceError = $state('');
  let voiceAudioHost: HTMLDivElement | null = null;

  const MESSAGE_PAGE_SIZE = 50;
  const HISTORY_TOP_THRESHOLD = 120;
  const LATEST_THRESHOLD = 120;

  let messagesViewport: HTMLDivElement | null = null;
  let historyCursor = $state<string | null>(null);
  let historyHasMore = $state(false);
  let historyLoading = $state(false);
  let atLatest = $state(true);
  let unreadNewMessages = $state(0);

  let voiceDeafened = $state(false);
  let voiceMutedBeforeDeafen = false;
  let voiceCameraEnabled = $state(false);
  let voiceScreenShareEnabled = $state(false);

  type CameraQualityPreset = 'data-saver' | 'balanced' | 'smooth' | 'high';
  type ScreenShareQualityPreset = 'text' | 'balanced' | 'smooth' | 'motion';

  let mediaSettingsOpen = $state(false);
  let mediaSettingsBusy = $state(false);
  let mediaSettingsNotice = $state('');
  let audioInputDevices = $state<MediaDeviceInfo[]>([]);
  let videoInputDevices = $state<MediaDeviceInfo[]>([]);
  let audioOutputDevices = $state<MediaDeviceInfo[]>([]);
  let selectedAudioInput = $state('');
  let selectedVideoInput = $state('');
  let selectedAudioOutput = $state('');
  let audioOutputSupported = $state(false);
  let cameraQuality = $state<CameraQualityPreset>('balanced');
  let screenShareQuality = $state<ScreenShareQualityPreset>('text');

  type MediaPreflightKind = 'camera' | 'screen-share';
  type MediaResolutionChoice = 720 | 1080;
  type MediaFpsChoice = 15 | 24 | 30 | 60;

  let mediaPreflightKind = $state<MediaPreflightKind | null>(null);
  let mediaPreflightResolution = $state<MediaResolutionChoice>(1080);
  let mediaPreflightFps = $state<MediaFpsChoice>(60);
  let mediaPreflightBusy = $state(false);
  let screenShareRequestAudio = $state(true);
  let voiceMediaNotice = $state('');

  type StreamVolumeMenuState = {
    identity: string;
    name: string;
    x: number;
    y: number;
    volume: number;
    audioAvailable: boolean;
  };

  let streamVolumeMenu = $state<StreamVolumeMenuState | null>(null);
  let focusedVideoIdentity = $state<string | null>(null);
  let focusedScreenShareIdentity = $state<string | null>(null);
  let screenShareFocusDismissed = false;
  let videoStageElement: HTMLElement | null = null;

  type DirectCallWire = {
    id: string;
    conversationId: string;
    callerId: string;
    calleeId: string;
    callerDisplayName: string;
    callerUsername: string;
    state: 'ringing' | 'accepted' | 'declined' | 'cancelled' | 'ended' | 'missed';
    createdAt: string;
    acceptedAt: string | null;
    actorId: string | null;
    joinSocketIds: string[];
  };

  type CallUiState = 'idle' | 'calling' | 'ringing' | 'connecting' | 'in-call' | 'rejoin';

  let directCall = $state<DirectCallWire | null>(null);
  let callUiState = $state<CallUiState>('idle');
  let callActionBusy = $state(false);
  let callNotice = $state('');
  let callNoticeTimer: ReturnType<typeof setTimeout> | undefined;

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


  function messageSenderName(message: any): string {
    if (message.senderId === data.user.id) return data.user.displayName;
    return message.senderDisplayName ?? message.senderUsername ?? 'Member';
  }

  function messageSenderInitial(message: any): string {
    return messageSenderName(message).slice(0, 1).toUpperCase() || '?';
  }

  function isMessageContinuation(index: number): boolean {
    if (index <= 0) return false;
    const current = chatMessages[index];
    const previous = chatMessages[index - 1];
    if (!current || !previous || current.senderId !== previous.senderId) return false;

    const currentAt = new Date(current.createdAt);
    const previousAt = new Date(previous.createdAt);
    if (currentAt.toDateString() !== previousAt.toDateString()) return false;

    return currentAt.getTime() - previousAt.getTime() <= 7 * 60 * 1000;
  }

  function showMessageDateDivider(index: number): boolean {
    if (index === 0) return true;
    const current = chatMessages[index];
    const previous = chatMessages[index - 1];
    if (!current || !previous) return false;

    return new Date(current.createdAt).toDateString() !==
      new Date(previous.createdAt).toDateString();
  }

  function formatMessageDay(value: string): string {
    const date = new Date(value);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

    return date.toLocaleDateString([], {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric'
    });
  }

  function formatMessageTime(value: string): string {
    return new Date(value).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function sortMessages(items: any[]): any[] {
    return [...items].sort((a: any, b: any) => {
      const byTime = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return byTime || String(a.id).localeCompare(String(b.id));
    });
  }

  function mergeMessages(...pages: any[][]): any[] {
    const byId = new Map<string, any>();
    for (const pageItems of pages) {
      for (const message of pageItems) byId.set(message.id, message);
    }
    return sortMessages(Array.from(byId.values()));
  }

  function upsertMessage(message: any): boolean {
    const index = chatMessages.findIndex((item: any) => item.id === message.id);
    if (index >= 0) {
      chatMessages[index] = message;
      chatMessages = [...chatMessages];
      return false;
    }
    chatMessages = sortMessages([...chatMessages, message]);
    return true;
  }

  function isNearLatest(): boolean {
    const viewport = messagesViewport;
    if (!viewport) return true;
    return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= LATEST_THRESHOLD;
  }

  async function scrollToLatest(behavior: ScrollBehavior = 'auto') {
    await tick();
    const viewport = messagesViewport;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
    atLatest = true;
    unreadNewMessages = 0;
  }

  async function loadLatestHistory(conversationId: string) {
    historyLoading = true;
    historyCursor = null;
    historyHasMore = false;
    unreadNewMessages = 0;
    atLatest = true;

    try {
      const payload = await api(
        `/api/v1/conversations/${conversationId}/messages?limit=${MESSAGE_PAGE_SIZE}`
      );
      if (activeConversation?.id !== conversationId) return;

      chatMessages = mergeMessages(payload.messages ?? [], chatMessages);
      historyCursor = payload.nextCursor ?? null;
      historyHasMore = Boolean(payload.nextCursor);
      await scrollToLatest();
    } finally {
      if (activeConversation?.id === conversationId) historyLoading = false;
    }
  }

  async function loadOlderMessages() {
    const conversationId = activeConversation?.id;
    const cursor = historyCursor;
    const viewport = messagesViewport;
    if (!conversationId || !cursor || !viewport || historyLoading || !historyHasMore) return;

    historyLoading = true;
    const previousHeight = viewport.scrollHeight;
    const previousTop = viewport.scrollTop;

    try {
      const payload = await api(
        `/api/v1/conversations/${conversationId}/messages?limit=${MESSAGE_PAGE_SIZE}&before=${encodeURIComponent(cursor)}`
      );
      if (activeConversation?.id !== conversationId) return;

      chatMessages = mergeMessages(payload.messages ?? [], chatMessages);
      historyCursor = payload.nextCursor ?? null;
      historyHasMore = Boolean(payload.nextCursor);

      await tick();
      const current = messagesViewport;
      if (current) current.scrollTop = current.scrollHeight - previousHeight + previousTop;
    } finally {
      if (activeConversation?.id === conversationId) historyLoading = false;
    }
  }

  function handleMessagesScroll() {
    const viewport = messagesViewport;
    if (!viewport) return;

    const nowAtLatest = isNearLatest();
    atLatest = nowAtLatest;
    if (nowAtLatest) unreadNewMessages = 0;

    if (viewport.scrollTop <= HISTORY_TOP_THRESHOLD && historyHasMore && !historyLoading) {
      void loadOlderMessages();
    }
  }

  async function syncActiveConversation() {
    const conversationId = activeConversation?.id;
    if (!conversationId) return;

    try {
      const wasAtLatest = isNearLatest();
      const knownIds = new Set(chatMessages.map((message: any) => message.id));
      const payload = await api(
        `/api/v1/conversations/${conversationId}/messages?limit=${MESSAGE_PAGE_SIZE}`
      );
      if (activeConversation?.id !== conversationId) return;

      const incoming = (payload.messages ?? []).filter((message: any) => !knownIds.has(message.id));
      chatMessages = mergeMessages(chatMessages, payload.messages ?? []);

      if (historyCursor === null && chatMessages.length <= MESSAGE_PAGE_SIZE) {
        historyCursor = payload.nextCursor ?? null;
        historyHasMore = Boolean(payload.nextCursor);
      }

      if (wasAtLatest) {
        await scrollToLatest();
      } else {
        unreadNewMessages += incoming.filter((message: any) => message.senderId !== data.user.id).length;
        atLatest = false;
      }
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
    chatMessages = [];
    historyCursor = null;
    historyHasMore = false;
    historyLoading = false;
    unreadNewMessages = 0;
    atLatest = true;

    await loadLatestHistory(conversation.id);
    if (conversation.kind === 'group') await refreshGroupDetails();

    realtimeSocket?.timeout(4000).emit('conversation:join', { conversationId: conversation.id }, () => {});
  }

  function closeConversation() {
    activeConversation = null;
    chatMessages = [];
    groupDetails = null;
    groupPanelOpen = false;
    historyCursor = null;
    historyHasMore = false;
    historyLoading = false;
    unreadNewMessages = 0;
    atLatest = true;
    messagesViewport = null;
  }


  type MessageAttachment = {
    id: string;
    conversationId: string;
    messageId: string | null;
    originalName: string;
    contentType: string;
    kind: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
    createdAt: string;
    url: string;
  };

  type StagedAttachment = {
    localId: string;
    fileName: string;
    sizeBytes: number;
    progress: number;
    status: 'uploading' | 'ready' | 'error';
    attachment: MessageAttachment | null;
    error: string;
  };

  const MAX_ATTACHMENTS_PER_MESSAGE = 10;
  const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

  let attachmentInput: HTMLInputElement | null = null;
  let stagedAttachments = $state<StagedAttachment[]>([]);
  let stagedAttachmentConversationId = $state<string | null>(null);
  const attachmentUploadRequests = new Map<string, XMLHttpRequest>();

  function attachmentsOf(message: any): MessageAttachment[] {
    return Array.isArray(message?.attachments) ? message.attachments : [];
  }

  function currentStagedAttachments(): StagedAttachment[] {
    if (!activeConversation) return [];
    if (stagedAttachmentConversationId !== activeConversation.id) return [];
    return stagedAttachments;
  }

  function updateStagedAttachment(
    localId: string,
    patch: Partial<StagedAttachment>
  ) {
    stagedAttachments = stagedAttachments.map((item) =>
      item.localId === localId ? { ...item, ...patch } : item
    );
  }

  function formatAttachmentSize(sizeBytes: number): string {
    if (sizeBytes < 1024) return `${sizeBytes} B`;
    if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
    return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function uploadAttachment(
    file: File,
    conversationId: string,
    localId: string
  ): Promise<MessageAttachment> {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      attachmentUploadRequests.set(localId, request);

      request.open(
        'POST',
        `/api/v1/conversations/${conversationId}/attachments`
      );
      request.withCredentials = true;

      request.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        updateStagedAttachment(localId, {
          progress: Math.min(
            99,
            Math.max(1, Math.round((event.loaded / event.total) * 100))
          )
        });
      };

      request.onload = () => {
        attachmentUploadRequests.delete(localId);

        let payload: any = null;
        try {
          payload = request.responseText
            ? JSON.parse(request.responseText)
            : null;
        } catch {
          // Fall through to status-based error.
        }

        if (
          request.status >= 200 &&
          request.status < 300 &&
          payload?.attachment
        ) {
          resolve(payload.attachment as MessageAttachment);
          return;
        }

        reject(
          new Error(
            payload?.error ??
              `Attachment upload failed (${request.status || 'network'}).`
          )
        );
      };

      request.onerror = () => {
        attachmentUploadRequests.delete(localId);
        reject(new Error('Attachment upload failed.'));
      };

      request.onabort = () => {
        attachmentUploadRequests.delete(localId);
        reject(new Error('Attachment upload cancelled.'));
      };

      const form = new FormData();
      form.append('file', file, file.name);
      request.send(form);
    });
  }

  async function discardStagedAttachment(
    localId: string,
    deleteRemote = true
  ) {
    const item = stagedAttachments.find(
      (candidate) => candidate.localId === localId
    );

    stagedAttachments = stagedAttachments.filter(
      (candidate) => candidate.localId !== localId
    );

    const request = attachmentUploadRequests.get(localId);
    if (request) {
      attachmentUploadRequests.delete(localId);
      request.abort();
    }

    if (deleteRemote && item?.attachment?.id) {
      await fetch(`/api/v1/attachments/${item.attachment.id}`, {
        method: 'DELETE',
        credentials: 'include'
      }).catch(() => {});
    }

    if (stagedAttachments.length === 0) {
      stagedAttachmentConversationId = null;
    }
  }

  async function discardAllStagedAttachments(deleteRemote = true) {
    const items = [...stagedAttachments];

    stagedAttachments = [];
    stagedAttachmentConversationId = null;

    for (const item of items) {
      const request = attachmentUploadRequests.get(item.localId);
      if (request) {
        attachmentUploadRequests.delete(item.localId);
        request.abort();
      }

      if (deleteRemote && item.attachment?.id) {
        await fetch(`/api/v1/attachments/${item.attachment.id}`, {
          method: 'DELETE',
          credentials: 'include'
        }).catch(() => {});
      }
    }
  }

  async function queueAttachmentFiles(
    fileList: FileList | File[]
  ) {
    if (!activeConversation) return;

    const files = Array.from(fileList);
    if (files.length === 0) return;

    const conversationId = activeConversation.id;

    if (
      stagedAttachmentConversationId &&
      stagedAttachmentConversationId !== conversationId
    ) {
      await discardAllStagedAttachments(true);
    }

    stagedAttachmentConversationId = conversationId;

    const availableSlots =
      MAX_ATTACHMENTS_PER_MESSAGE - stagedAttachments.length;

    if (availableSlots <= 0) {
      error = `You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files.`;
      return;
    }

    const acceptedFiles = files.slice(0, availableSlots);

    if (files.length > availableSlots) {
      error = `Only ${availableSlots} more attachment${
        availableSlots === 1 ? '' : 's'
      } can be added.`;
    } else {
      error = '';
    }

    const tasks = acceptedFiles.map(async (file) => {
      if (file.size < 1) {
        error = `${file.name || 'File'} is empty.`;
        return;
      }

      if (file.size > MAX_ATTACHMENT_BYTES) {
        error = `${file.name} exceeds the 25 MB limit.`;
        return;
      }

      const localId = createClientMessageId();

      stagedAttachments = [
        ...stagedAttachments,
        {
          localId,
          fileName: file.name || 'attachment',
          sizeBytes: file.size,
          progress: 0,
          status: 'uploading',
          attachment: null,
          error: ''
        }
      ];

      try {
        const attachment = await uploadAttachment(
          file,
          conversationId,
          localId
        );

        updateStagedAttachment(localId, {
          progress: 100,
          status: 'ready',
          attachment,
          error: ''
        });
      } catch (uploadError) {
        if (
          !stagedAttachments.some(
            (candidate) => candidate.localId === localId
          )
        ) {
          return;
        }

        updateStagedAttachment(localId, {
          status: 'error',
          error:
            uploadError instanceof Error
              ? uploadError.message
              : 'Attachment upload failed.'
        });
      }
    });

    await Promise.allSettled(tasks);
  }

  function handleAttachmentPaste(event: ClipboardEvent) {
    const files = event.clipboardData?.files;
    if (!files || files.length === 0) return;

    event.preventDefault();
    void queueAttachmentFiles(files);
  }

  function handleAttachmentDrop(event: DragEvent) {
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;

    event.preventDefault();
    void queueAttachmentFiles(files);
  }

  function stagedReadyIds(): string[] {
    return currentStagedAttachments()
      .filter(
        (item) =>
          item.status === 'ready' &&
          Boolean(item.attachment?.id)
      )
      .map((item) => item.attachment!.id);
  }

  function stagedUploadPending(): boolean {
    return currentStagedAttachments().some(
      (item) => item.status === 'uploading'
    );
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
    const attachmentIds = stagedReadyIds();

    if (
      !activeConversation ||
      busy ||
      stagedUploadPending() ||
      (!body && attachmentIds.length === 0)
    ) {
      return;
    }

    const conversationId = activeConversation.id;
    const sentStagedLocalIds = new Set(
      currentStagedAttachments()
        .filter((item) => item.status === 'ready')
        .map((item) => item.localId)
    );

    messageBody = '';
    busy = true;
    error = '';

    try {
      const result = await api(
        `/api/v1/conversations/${conversationId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({
            clientMessageId: createClientMessageId(),
            body,
            attachmentIds
          })
        }
      );

      stagedAttachments = stagedAttachments.filter(
        (item) => !sentStagedLocalIds.has(item.localId)
      );

      if (
        stagedAttachmentConversationId === conversationId &&
        stagedAttachments.length === 0
      ) {
        stagedAttachmentConversationId = null;
      }

      if (
        activeConversation?.id === conversationId &&
        result?.message
      ) {
        upsertMessage(result.message);
        await scrollToLatest('smooth');
      }

      await refreshConversations();
    } catch (e) {
      messageBody = body;
      error =
        e instanceof Error
          ? e.message
          : 'Could not send message.';
    } finally {
      busy = false;
    }
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


  function socketRequest<T = any>(event: string, payload: unknown = {}): Promise<T> {
    const socket = realtimeSocket;
    if (!socket?.connected) return Promise.reject(new Error('Realtime is reconnecting. Try again in a moment.'));

    return new Promise<T>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Realtime request timed out.')), 6000);
      socket.emit(event, payload, (result: any) => {
        window.clearTimeout(timeout);
        if (!result?.ok) {
          reject(new Error(result?.error ?? 'Realtime request failed.'));
          return;
        }
        resolve(result as T);
      });
    });
  }

  function conversationForCall(call: DirectCallWire): any {
    const known = conversations.find((conversation) => conversation.id === call.conversationId);
    if (known) return known;

    return {
      id: call.conversationId,
      kind: 'direct',
      peer: {
        id: call.callerId,
        displayName: call.callerDisplayName,
        username: call.callerUsername
      }
    };
  }

  function callPeerName(call: DirectCallWire): string {
    const known = conversations.find((conversation) => conversation.id === call.conversationId);
    if (known) return conversationName(known);
    return call.callerId === data.user.id ? 'Friend' : call.callerDisplayName;
  }

  function showCallNotice(message: string) {
    callNotice = message;
    if (callNoticeTimer) clearTimeout(callNoticeTimer);
    callNoticeTimer = setTimeout(() => {
      callNotice = '';
      callNoticeTimer = undefined;
    }, 3500);
  }

  async function applyCallEvent(socket: Socket, call: DirectCallWire) {
    if (['declined', 'cancelled', 'ended', 'missed'].includes(call.state)) {
      const wasCurrent =
        directCall?.id === call.id ||
        (voiceConversationId === call.conversationId && directCall?.conversationId === call.conversationId);

      if (wasCurrent && voiceConversationId === call.conversationId) {
        await leaveVoice(false);
      }

      if (directCall?.id === call.id || wasCurrent) {
        directCall = null;
        callUiState = 'idle';
      }

      const message =
        call.state === 'declined' ? 'Call declined' :
        call.state === 'cancelled' ? 'Call cancelled' :
        call.state === 'missed' ? 'No answer' :
        'Call ended';
      showCallNotice(message);
      return;
    }

    directCall = call;

    if (call.state === 'ringing') {
      callUiState = call.callerId === data.user.id ? 'calling' : 'ringing';
      return;
    }

    const shouldJoin = call.joinSocketIds?.includes(socket.id ?? '') ?? false;
    if (shouldJoin) {
      callUiState = 'connecting';
      await joinVoice(conversationForCall(call));
      return;
    }

    callUiState =
      voiceConversationId === call.conversationId && voiceStatus === 'connected'
        ? 'in-call'
        : 'rejoin';
  }

  async function syncDirectCall(socket: Socket) {
    try {
      const result = await socketRequest<{ ok: true; call: DirectCallWire | null }>('call:sync');
      if (!result.call) {
        if (!voiceRoom || directCall?.conversationId === voiceConversationId) {
          directCall = null;
          callUiState = 'idle';
        }
        return;
      }
      await applyCallEvent(socket, result.call);
    } catch {
      // The normal Socket.IO reconnect loop will retry on the next connect event.
    }
  }

  async function startDirectCall(conversation: any) {
    if (conversation.kind !== 'direct' || callActionBusy) return;

    if (!window.isSecureContext) {
      voiceError = 'Calls require HTTPS so the browser can safely access your microphone.';
      return;
    }

    if (directCall) {
      showCallNotice('Finish the current call first');
      return;
    }

    if (voiceRoom) {
      if (!confirm(`Leave ${voiceConversationTitle || 'the current voice room'} and call ${conversationName(conversation)}?`)) return;
      await leaveVoice();
    }

    callActionBusy = true;
    voiceError = '';

    try {
      const result = await socketRequest<{ ok: true; call: DirectCallWire }>('call:start', {
        conversationId: conversation.id
      });
      directCall = result.call;
      callUiState = 'calling';
    } catch (e) {
      callUiState = 'idle';
      voiceError = e instanceof Error ? e.message : 'Could not start the call.';
    } finally {
      callActionBusy = false;
    }
  }

  async function acceptDirectCall() {
    const call = directCall;
    if (!call || call.state !== 'ringing' || call.calleeId !== data.user.id || callActionBusy) return;

    callActionBusy = true;
    try {
      if (voiceRoom && voiceConversationId !== call.conversationId) await leaveVoice();
      callUiState = 'connecting';
      await socketRequest('call:accept', { callId: call.id });
    } catch (e) {
      callUiState = 'ringing';
      voiceError = e instanceof Error ? e.message : 'Could not accept the call.';
    } finally {
      callActionBusy = false;
    }
  }

  async function declineDirectCall() {
    const call = directCall;
    if (!call || callActionBusy) return;
    callActionBusy = true;
    try {
      await socketRequest('call:decline', { callId: call.id });
    } catch (e) {
      voiceError = e instanceof Error ? e.message : 'Could not decline the call.';
    } finally {
      callActionBusy = false;
    }
  }

  async function cancelDirectCall() {
    const call = directCall;
    if (!call || callActionBusy) return;
    callActionBusy = true;
    try {
      await socketRequest('call:cancel', { callId: call.id });
    } catch (e) {
      voiceError = e instanceof Error ? e.message : 'Could not cancel the call.';
    } finally {
      callActionBusy = false;
    }
  }

  async function endDirectCall() {
    const call = directCall;
    if (!call || callActionBusy) return;
    callActionBusy = true;
    try {
      await socketRequest('call:end', { callId: call.id });
    } catch (e) {
      voiceError = e instanceof Error ? e.message : 'Could not end the call.';
    } finally {
      callActionBusy = false;
    }
  }

  async function rejoinDirectCall() {
    const call = directCall;
    if (!call || call.state !== 'accepted' || callActionBusy) return;
    callUiState = 'connecting';
    await joinVoice(conversationForCall(call));
  }


  function loadMediaPreferences() {
    if (typeof localStorage === 'undefined') return;

    const savedCameraQuality = localStorage.getItem('cubic.cameraQuality');
    const savedShareQuality = localStorage.getItem('cubic.screenShareQuality');

    if (savedCameraQuality === 'data-saver' || savedCameraQuality === 'balanced' || savedCameraQuality === 'smooth' || savedCameraQuality === 'high') {
      cameraQuality = savedCameraQuality;
    }
    if (savedShareQuality === 'text' || savedShareQuality === 'balanced' || savedShareQuality === 'smooth' || savedShareQuality === 'motion') {
      screenShareQuality = savedShareQuality;
    }

    selectedAudioInput = localStorage.getItem('cubic.audioInput') ?? '';
    selectedVideoInput = localStorage.getItem('cubic.videoInput') ?? '';
    selectedAudioOutput = localStorage.getItem('cubic.audioOutput') ?? '';

    const savedShareAudio = localStorage.getItem('cubic.screenShareRequestAudio');
    if (savedShareAudio === 'false') screenShareRequestAudio = false;

    audioOutputSupported =
      typeof HTMLMediaElement !== 'undefined' &&
      'setSinkId' in HTMLMediaElement.prototype;
  }

  function saveMediaPreference(key: string, value: string) {
    if (typeof localStorage === 'undefined') return;
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  }

  function deviceLabel(device: MediaDeviceInfo, index: number, fallback: string): string {
    return device.label || `${fallback} ${index + 1}`;
  }

  function clampStreamVolume(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  function savedStreamVolume(identity: string): number {
    if (typeof localStorage === 'undefined') return 100;
    const raw = Number(localStorage.getItem(`cubic.streamVolume.${identity}`));
    return Number.isFinite(raw) ? clampStreamVolume(raw) : 100;
  }

  function applyStreamVolume(identity: string, volume: number) {
    const normalized = clampStreamVolume(volume);

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`cubic.streamVolume.${identity}`, String(normalized));
    }

    const escapedIdentity =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(identity)
        : identity.replace(/["\\]/g, '\\$&');

    voiceAudioHost
      ?.querySelectorAll<HTMLMediaElement>(
        `[data-cubic-stream-audio="1"][data-participant-identity="${escapedIdentity}"]`
      )
      .forEach((element) => {
        element.volume = normalized / 100;
        element.muted = voiceDeafened;
      });

    if (streamVolumeMenu?.identity === identity) {
      streamVolumeMenu = { ...streamVolumeMenu, volume: normalized };
    }
  }

  function openStreamVolumeMenu(event: MouseEvent, participant: VoiceParticipantView) {
    if (participant.local) return;

    event.preventDefault();
    event.stopPropagation();

    const width = 270;
    const height = 160;
    const x = Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8));
    const y = Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8));

    streamVolumeMenu = {
      identity: participant.identity,
      name: participant.name,
      x,
      y,
      volume: savedStreamVolume(participant.identity),
      audioAvailable: participant.screenShareAudioEnabled
    };
  }

  function closeStreamVolumeMenu() {
    streamVolumeMenu = null;
  }

  function onStreamVolumeInput(event: Event) {
    const menu = streamVolumeMenu;
    if (!menu) return;

    const value = Number((event.currentTarget as HTMLInputElement).value);
    applyStreamVolume(menu.identity, value);
  }

  function toggleStreamVolumeMute() {
    const menu = streamVolumeMenu;
    if (!menu) return;
    applyStreamVolume(menu.identity, menu.volume === 0 ? 100 : 0);
  }

  function cameraPreflightDefaults(): {
    resolution: MediaResolutionChoice;
    fps: MediaFpsChoice;
  } {
    const savedResolution =
      typeof localStorage !== 'undefined'
        ? Number(localStorage.getItem('cubic.cameraStartResolution'))
        : 0;
    const savedFps =
      typeof localStorage !== 'undefined'
        ? Number(localStorage.getItem('cubic.cameraStartFps'))
        : 0;

    if ((savedResolution === 720 || savedResolution === 1080) && [24, 30, 60].includes(savedFps)) {
      return {
        resolution: savedResolution as MediaResolutionChoice,
        fps: savedFps as MediaFpsChoice
      };
    }

    if (cameraQuality === 'smooth') return { resolution: 720, fps: 60 };
    if (cameraQuality === 'high') return { resolution: 1080, fps: 30 };
    return { resolution: 720, fps: cameraQuality === 'data-saver' ? 24 : 30 };
  }

  function screenSharePreflightDefaults(): {
    resolution: MediaResolutionChoice;
    fps: MediaFpsChoice;
  } {
    const savedResolution =
      typeof localStorage !== 'undefined'
        ? Number(localStorage.getItem('cubic.screenShareStartResolution'))
        : 0;
    const savedFps =
      typeof localStorage !== 'undefined'
        ? Number(localStorage.getItem('cubic.screenShareStartFps'))
        : 0;

    if ((savedResolution === 720 || savedResolution === 1080) && [15, 30, 60].includes(savedFps)) {
      return {
        resolution: savedResolution as MediaResolutionChoice,
        fps: savedFps as MediaFpsChoice
      };
    }

    if (screenShareQuality === 'motion') return { resolution: 720, fps: 60 };
    if (screenShareQuality === 'smooth') return { resolution: 1080, fps: 60 };
    if (screenShareQuality === 'balanced') return { resolution: 1080, fps: 30 };
    return { resolution: 1080, fps: 15 };
  }

  function openMediaPreflight(kind: MediaPreflightKind) {
    voiceError = '';
    voiceMediaNotice = '';
    mediaPreflightKind = kind;

    const defaults =
      kind === 'camera'
        ? cameraPreflightDefaults()
        : screenSharePreflightDefaults();

    mediaPreflightResolution = defaults.resolution;
    mediaPreflightFps = defaults.fps;
  }

  function closeMediaPreflight() {
    if (mediaPreflightBusy) return;
    mediaPreflightKind = null;
  }

  function videoDimensions(resolution: MediaResolutionChoice) {
    return resolution === 1080
      ? { width: 1920, height: 1080 }
      : { width: 1280, height: 720 };
  }

  function cameraStartCaptureOptions(
    resolution: MediaResolutionChoice,
    fps: MediaFpsChoice
  ): any {
    return {
      deviceId: selectedVideoInput ? { exact: selectedVideoInput } : undefined,
      resolution: videoDimensions(resolution),
      frameRate: fps
    };
  }

  function cameraStartPublishOptions(
    resolution: MediaResolutionChoice,
    fps: MediaFpsChoice
  ): any {
    const maxBitrate =
      resolution === 1080
        ? (fps === 60 ? 6_000_000 : 3_500_000)
        : (fps === 60 ? 3_000_000 : 1_500_000);

    return {
      simulcast: true,
      videoEncoding: { maxBitrate, maxFramerate: fps },
      degradationPreference: fps === 60 ? 'maintain-framerate' : 'balanced'
    };
  }

  function screenStartCaptureOptions(
    resolution: MediaResolutionChoice,
    fps: MediaFpsChoice
  ): any {
    return {
      audio: screenShareRequestAudio,
      systemAudio: screenShareRequestAudio ? 'include' : 'exclude',
      surfaceSwitching: 'include',
      selfBrowserSurface: 'include',
      suppressLocalAudioPlayback: false,
      contentHint: fps === 60 ? 'motion' : (fps === 15 ? 'text' : 'detail'),
      resolution: {
        ...videoDimensions(resolution),
        frameRate: fps
      }
    };
  }

  function screenStartPublishOptions(
    resolution: MediaResolutionChoice,
    fps: MediaFpsChoice
  ): any {
    let maxBitrate = 2_500_000;

    if (resolution === 720) {
      maxBitrate = fps === 60 ? 5_000_000 : fps === 30 ? 2_500_000 : 1_500_000;
    } else {
      maxBitrate = fps === 60 ? 8_000_000 : fps === 30 ? 4_500_000 : 2_500_000;
    }

    return {
      simulcast: true,
      screenShareEncoding: { maxBitrate, maxFramerate: fps },
      degradationPreference: fps === 60 ? 'maintain-framerate' : 'maintain-resolution'
    };
  }

  function setPreflightResolution(resolution: MediaResolutionChoice) {
    mediaPreflightResolution = resolution;
  }

  function setPreflightFps(fps: MediaFpsChoice) {
    mediaPreflightFps = fps;
  }

  async function confirmMediaPreflight() {
    const room = voiceRoom;
    const kind = mediaPreflightKind;
    if (!room || voiceStatus !== 'connected' || !kind || mediaPreflightBusy) return;

    mediaPreflightBusy = true;
    voiceError = '';
    voiceMediaNotice = '';

    try {
      if (kind === 'camera') {
        await room.localParticipant.setCameraEnabled(
          true,
          cameraStartCaptureOptions(mediaPreflightResolution, mediaPreflightFps),
          cameraStartPublishOptions(mediaPreflightResolution, mediaPreflightFps)
        );

        saveMediaPreference('cubic.cameraStartResolution', String(mediaPreflightResolution));
        saveMediaPreference('cubic.cameraStartFps', String(mediaPreflightFps));
      } else {
        screenShareFocusDismissed = false;

        await room.localParticipant.setScreenShareEnabled(
          true,
          screenStartCaptureOptions(mediaPreflightResolution, mediaPreflightFps),
          screenStartPublishOptions(mediaPreflightResolution, mediaPreflightFps)
        );

        saveMediaPreference('cubic.screenShareStartResolution', String(mediaPreflightResolution));
        saveMediaPreference('cubic.screenShareStartFps', String(mediaPreflightFps));
        saveMediaPreference(
          'cubic.screenShareRequestAudio',
          screenShareRequestAudio ? 'true' : 'false'
        );

        window.setTimeout(() => {
          if (voiceRoom !== room || !voiceScreenShareEnabled) return;

          const audioPublication =
            room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio);

          if (screenShareRequestAudio && (!audioPublication || audioPublication.isMuted)) {
            voiceMediaNotice =
              'Screen is live without shared audio. If your browser offers “Share tab/system audio”, enable it in the native picker. Some browsers do not support screen-share audio.';
          } else if (screenShareRequestAudio && audioPublication) {
            voiceMediaNotice = 'Shared audio is active.';
          }
        }, 600);
      }

      mediaPreflightKind = null;
      syncVoiceParticipants();
    } catch (error) {
      voiceError =
        kind === 'camera'
          ? mediaDeviceErrorMessage(error, 'camera')
          : screenShareErrorMessage(error);
      syncVoiceParticipants();
    } finally {
      mediaPreflightBusy = false;
    }
  }

  function cameraQualityLabel(): string {
    if (cameraQuality === 'data-saver') return 'Data saver · 360p 24fps';
    if (cameraQuality === 'smooth') return 'Smooth · 720p 60fps';
    if (cameraQuality === 'high') return 'High · 1080p 30fps';
    return 'Balanced · 720p 30fps';
  }

  function screenShareQualityLabel(): string {
    if (screenShareQuality === 'motion') return 'Motion · 720p 60fps';
    if (screenShareQuality === 'smooth') return 'Smooth · 1080p 60fps';
    if (screenShareQuality === 'balanced') return 'Balanced · 1080p 30fps';
    return 'Text · 1080p 15fps';
  }

  function cameraCaptureOptions(): any {
    const deviceId = selectedVideoInput
      ? { exact: selectedVideoInput }
      : undefined;

    if (cameraQuality === 'data-saver') {
      return {
        deviceId,
        resolution: { width: 640, height: 360 },
        frameRate: 24
      };
    }

    if (cameraQuality === 'smooth') {
      return {
        deviceId,
        resolution: { width: 1280, height: 720 },
        frameRate: 60
      };
    }

    if (cameraQuality === 'high') {
      return {
        deviceId,
        resolution: { width: 1920, height: 1080 },
        frameRate: 30
      };
    }

    return {
      deviceId,
      resolution: { width: 1280, height: 720 },
      frameRate: 30
    };
  }

  function cameraPublishOptions(): any {
    if (cameraQuality === 'data-saver') {
      return {
        simulcast: true,
        videoEncoding: { maxBitrate: 600_000, maxFramerate: 24 },
        degradationPreference: 'maintain-framerate'
      };
    }

    if (cameraQuality === 'smooth') {
      return {
        simulcast: true,
        videoEncoding: { maxBitrate: 3_000_000, maxFramerate: 60 },
        degradationPreference: 'maintain-framerate'
      };
    }

    if (cameraQuality === 'high') {
      return {
        simulcast: true,
        videoEncoding: { maxBitrate: 3_500_000, maxFramerate: 30 },
        degradationPreference: 'maintain-resolution'
      };
    }

    return {
      simulcast: true,
      videoEncoding: { maxBitrate: 1_500_000, maxFramerate: 30 },
      degradationPreference: 'maintain-framerate'
    };
  }

  function screenShareCaptureOptions(): any {
    if (screenShareQuality === 'motion') {
      return {
        audio: true,
        contentHint: 'motion',
        resolution: { width: 1280, height: 720, frameRate: 60 }
      };
    }

    if (screenShareQuality === 'smooth') {
      return {
        audio: true,
        contentHint: 'motion',
        resolution: { width: 1920, height: 1080, frameRate: 60 }
      };
    }

    if (screenShareQuality === 'balanced') {
      return {
        audio: true,
        contentHint: 'detail',
        resolution: { width: 1920, height: 1080, frameRate: 30 }
      };
    }

    return {
      audio: true,
      contentHint: 'text',
      resolution: { width: 1920, height: 1080, frameRate: 15 }
    };
  }

  function screenSharePublishOptions(): any {
    if (screenShareQuality === 'motion') {
      return {
        simulcast: true,
        screenShareEncoding: { maxBitrate: 5_000_000, maxFramerate: 60 },
        degradationPreference: 'maintain-framerate'
      };
    }

    if (screenShareQuality === 'smooth') {
      return {
        simulcast: true,
        screenShareEncoding: { maxBitrate: 8_000_000, maxFramerate: 60 },
        degradationPreference: 'balanced'
      };
    }

    if (screenShareQuality === 'balanced') {
      return {
        simulcast: true,
        screenShareEncoding: { maxBitrate: 4_500_000, maxFramerate: 30 },
        degradationPreference: 'maintain-resolution'
      };
    }

    return {
      simulcast: true,
      screenShareEncoding: { maxBitrate: 2_500_000, maxFramerate: 15 },
      degradationPreference: 'maintain-resolution'
    };
  }

  async function refreshMediaDevices() {
    mediaSettingsNotice = '';

    try {
      const devices = await Room.getLocalDevices(undefined, false);
      audioInputDevices = devices.filter((device) => device.kind === 'audioinput');
      videoInputDevices = devices.filter((device) => device.kind === 'videoinput');
      audioOutputDevices = devices.filter((device) => device.kind === 'audiooutput');

      const room = voiceRoom;
      if (room) {
        selectedAudioInput = room.getActiveDevice('audioinput') || selectedAudioInput;
        selectedVideoInput = room.getActiveDevice('videoinput') || selectedVideoInput;
        if (audioOutputSupported) {
          selectedAudioOutput = room.getActiveDevice('audiooutput') || selectedAudioOutput;
        }
      }

      if (selectedAudioInput && !audioInputDevices.some((device) => device.deviceId === selectedAudioInput)) {
        selectedAudioInput = '';
        saveMediaPreference('cubic.audioInput', '');
      }
      if (selectedVideoInput && !videoInputDevices.some((device) => device.deviceId === selectedVideoInput)) {
        selectedVideoInput = '';
        saveMediaPreference('cubic.videoInput', '');
      }
      if (
        selectedAudioOutput &&
        audioOutputSupported &&
        !audioOutputDevices.some((device) => device.deviceId === selectedAudioOutput)
      ) {
        selectedAudioOutput = '';
        saveMediaPreference('cubic.audioOutput', '');
      }
    } catch (error) {
      mediaSettingsNotice =
        error instanceof Error ? error.message : 'Could not list media devices.';
    }
  }

  async function showMediaSettings() {
    mediaSettingsOpen = true;
    await refreshMediaDevices();
  }

  function hideMediaSettings() {
    mediaSettingsOpen = false;
    mediaSettingsNotice = '';
  }

  async function switchMediaDevice(
    kind: 'audioinput' | 'videoinput' | 'audiooutput',
    deviceId: string
  ) {
    const room = voiceRoom;
    if (!room || voiceStatus !== 'connected') return;

    if (kind === 'audiooutput' && !audioOutputSupported) {
      mediaSettingsNotice = 'Audio output selection is not supported by this browser.';
      return;
    }

    mediaSettingsBusy = true;
    mediaSettingsNotice = '';

    try {
      const switched = await room.switchActiveDevice(kind, deviceId);
      if (!switched) {
        throw new Error('The browser could not switch to that device.');
      }

      if (kind === 'audioinput') {
        selectedAudioInput = deviceId;
        saveMediaPreference('cubic.audioInput', deviceId);
      } else if (kind === 'videoinput') {
        selectedVideoInput = deviceId;
        saveMediaPreference('cubic.videoInput', deviceId);
      } else {
        selectedAudioOutput = deviceId;
        saveMediaPreference('cubic.audioOutput', deviceId);
      }

      await refreshMediaDevices();
    } catch (error) {
      mediaSettingsNotice =
        error instanceof Error ? error.message : 'Could not switch media device.';
    } finally {
      mediaSettingsBusy = false;
    }
  }

  async function onAudioInputChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    await switchMediaDevice('audioinput', value);
  }

  async function onVideoInputChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    await switchMediaDevice('videoinput', value);
  }

  async function onAudioOutputChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    await switchMediaDevice('audiooutput', value);
  }

  async function setCameraQualityPreset(next: CameraQualityPreset) {
    if (cameraQuality === next || mediaSettingsBusy) return;

    const previous = cameraQuality;
    cameraQuality = next;
    saveMediaPreference('cubic.cameraQuality', next);
    mediaSettingsNotice = '';

    const room = voiceRoom;
    if (!room || voiceStatus !== 'connected') return;

    const publication = room.localParticipant.getTrackPublication(Track.Source.Camera);
    const track = publication?.track;
    if (!track) return;

    const wasEnabled = voiceCameraEnabled;
    mediaSettingsBusy = true;
    try {
      await room.localParticipant.unpublishTrack(track, true);

      if (wasEnabled) {
        await room.localParticipant.setCameraEnabled(
          true,
          cameraCaptureOptions(),
          cameraPublishOptions()
        );
      }

      syncVoiceParticipants();
      mediaSettingsNotice = wasEnabled
        ? `Camera quality changed to ${cameraQualityLabel()}.`
        : `Camera quality set to ${cameraQualityLabel()}.`;
    } catch (error) {
      cameraQuality = previous;
      saveMediaPreference('cubic.cameraQuality', previous);
      voiceError = mediaDeviceErrorMessage(error, 'camera');
      syncVoiceParticipants();
    } finally {
      mediaSettingsBusy = false;
    }
  }

  function setScreenShareQualityPreset(next: ScreenShareQualityPreset) {
    screenShareQuality = next;
    saveMediaPreference('cubic.screenShareQuality', next);
    mediaSettingsNotice = voiceScreenShareEnabled
      ? `Screen-share quality changed to ${screenShareQualityLabel()}. It will apply the next time you start sharing.`
      : `Screen-share quality set to ${screenShareQualityLabel()}.`;
  }

  function mediaStageVisible(): boolean {
    if (!activeConversation || voiceConversationId !== activeConversation.id) return false;
    return voiceParticipants.some((participant) => participant.cameraEnabled) ||
      activeScreenShares().length > 0;
  }



  function mediaDeviceErrorMessage(
    error: unknown,
    kind: 'microphone' | 'camera'
  ): string {
    const label = kind === 'camera' ? 'Camera' : 'Microphone';
    const lowerLabel = kind === 'camera' ? 'camera' : 'microphone';

    const errorName =
      error && typeof error === 'object' && 'name' in error
        ? String((error as { name?: unknown }).name ?? '')
        : '';

    const rawMessage =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : '';

    const normalizedMessage = rawMessage.toLowerCase();

    if (
      errorName === 'NotFoundError' ||
      errorName === 'DevicesNotFoundError' ||
      normalizedMessage.includes('object can not be found') ||
      normalizedMessage.includes('requested device not found')
    ) {
      return `No ${lowerLabel} was found on this device.`;
    }

    if (
      errorName === 'NotAllowedError' ||
      errorName === 'PermissionDeniedError' ||
      errorName === 'SecurityError' ||
      normalizedMessage.includes('not allowed by the user agent') ||
      normalizedMessage.includes('permission denied')
    ) {
      return `${label} access is blocked. Allow ${lowerLabel} access for cubic.goma.ink in your browser/site permissions and check the operating-system privacy settings.`;
    }

    if (
      errorName === 'NotReadableError' ||
      errorName === 'TrackStartError'
    ) {
      return `${label} is unavailable or already being used by another application.`;
    }

    if (errorName === 'OverconstrainedError') {
      return `${label} is present, but the browser could not satisfy the requested capture settings.`;
    }

    if (errorName === 'AbortError') {
      return `${label} capture was interrupted. Try again.`;
    }

    return rawMessage || `Could not access the ${lowerLabel}.`;
  }

  function screenShareSupported(): boolean {
    return typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices);
  }

  function screenShareErrorMessage(error: unknown): string {
    const errorName =
      error && typeof error === 'object' && 'name' in error
        ? String((error as { name?: unknown }).name ?? '')
        : '';
    const rawMessage = error instanceof Error ? error.message : '';

    if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
      return 'Screen sharing was cancelled or blocked by the browser.';
    }
    if (errorName === 'InvalidStateError') {
      return 'Click Share again from the active browser tab to start screen sharing.';
    }
    if (errorName === 'NotFoundError') {
      return 'No shareable screen, window, or tab was found.';
    }
    if (errorName === 'NotReadableError') {
      return 'The selected screen or window could not be captured by the operating system.';
    }
    if (errorName === 'TypeError') {
      return 'Screen sharing is not available with this browser configuration.';
    }
    if (errorName === 'AbortError') {
      return 'Screen sharing was cancelled.';
    }

    return rawMessage || 'Could not start screen sharing.';
  }

  function activeScreenShares(): VoiceParticipantView[] {
    return voiceParticipants.filter((participant) => participant.screenShareEnabled);
  }

  function focusedScreenShareParticipant(): VoiceParticipantView | null {
    if (!focusedScreenShareIdentity) return null;
    return voiceParticipants.find(
      (participant) =>
        participant.identity === focusedScreenShareIdentity && participant.screenShareEnabled
    ) ?? null;
  }

  function syncVoiceParticipants() {
    const room = voiceRoom;
    if (!room) {
      voiceParticipants = [];
      voiceMuted = false;
      voiceCameraEnabled = false;
      voiceScreenShareEnabled = false;
      focusedVideoIdentity = null;
      focusedScreenShareIdentity = null;
      screenShareFocusDismissed = false;
      return;
    }

    const all = [room.localParticipant, ...Array.from(room.remoteParticipants.values())];
    const nextParticipants = all.map((participant) => {
      const cameraPublication = participant.getTrackPublication(Track.Source.Camera);
      const screenPublication = participant.getTrackPublication(Track.Source.ScreenShare);
      const screenAudioPublication =
        participant.getTrackPublication(Track.Source.ScreenShareAudio);
      const cameraEnabled = Boolean(
        cameraPublication &&
        !cameraPublication.isMuted &&
        cameraPublication.track
      );
      const screenShareEnabled = Boolean(screenPublication && !screenPublication.isMuted);

      return {
        identity: participant.identity,
        name: participant.name || (participant.isLocal ? data.user.displayName : 'Member'),
        muted: !participant.isMicrophoneEnabled,
        speaking: participant.isSpeaking,
        local: participant.isLocal,
        cameraEnabled,
        videoTrack: cameraPublication?.track ?? null,
        screenShareEnabled,
        screenShareTrack: screenPublication?.track ?? null,
        screenShareAudioEnabled: Boolean(
          screenAudioPublication &&
          !screenAudioPublication.isMuted &&
          screenAudioPublication.track
        )
      };
    });

    voiceParticipants = nextParticipants;
    voiceMuted = !room.localParticipant.isMicrophoneEnabled;

    const localCamera = room.localParticipant.getTrackPublication(Track.Source.Camera);
    voiceCameraEnabled = Boolean(localCamera && !localCamera.isMuted && localCamera.track);

    const localScreen = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
    voiceScreenShareEnabled = Boolean(localScreen && !localScreen.isMuted);

    if (
      focusedVideoIdentity &&
      !nextParticipants.some((participant) => participant.identity === focusedVideoIdentity)
    ) {
      focusedVideoIdentity = null;
    }

    const activeShares = nextParticipants.filter((participant) => participant.screenShareEnabled);
    if (activeShares.length === 0) {
      focusedScreenShareIdentity = null;
      screenShareFocusDismissed = false;
    } else if (
      focusedScreenShareIdentity &&
      !activeShares.some((participant) => participant.identity === focusedScreenShareIdentity)
    ) {
      focusedScreenShareIdentity = screenShareFocusDismissed ? null : activeShares[0].identity;
    } else if (!focusedScreenShareIdentity && !screenShareFocusDismissed) {
      focusedScreenShareIdentity = activeShares[0].identity;
      focusedVideoIdentity = null;
    }
  }

  function setRemoteAudioDeafened(deafened: boolean) {
    voiceAudioHost
      ?.querySelectorAll<HTMLMediaElement>(
        '[data-cubic-voice="1"], [data-cubic-stream-audio="1"]'
      )
      .forEach((element) => {
        element.muted = deafened;
      });
  }

  function attachVoiceAudio(track: any, publication: any, participant: any) {
    if (track.kind !== Track.Kind.Audio || !voiceAudioHost) return;

    const element = track.attach();
    element.autoplay = true;
    element.muted = voiceDeafened;
    element.setAttribute('playsinline', '');

    if (publication?.source === Track.Source.ScreenShareAudio) {
      const identity = participant?.identity ?? 'unknown';
      element.dataset.cubicStreamAudio = '1';
      element.dataset.participantIdentity = identity;
      element.volume = savedStreamVolume(identity) / 100;
    } else {
      element.dataset.cubicVoice = '1';
    }

    voiceAudioHost.appendChild(element);
  }

  function detachVoiceAudio(track: any) {
    const elements = track.detach?.() ?? [];
    for (const element of elements) {
      if (element instanceof HTMLElement) element.remove();
    }
  }

  function clearVoiceAudio() {
    voiceAudioHost
      ?.querySelectorAll(
        '[data-cubic-voice="1"], [data-cubic-stream-audio="1"]'
      )
      .forEach((element) => element.remove());
  }

  async function leaveVoice(endDirect = true) {
    const room = voiceRoom;
    const activeCall =
      directCall?.state === 'accepted' && directCall.conversationId === voiceConversationId
        ? directCall
        : null;

    if (endDirect && activeCall && realtimeSocket?.connected) {
      realtimeSocket.emit('call:end', { callId: activeCall.id }, () => {});
    }

    voiceRoom = null;
    voiceConversationId = null;
    voiceConversationTitle = '';
    voiceStatus = 'idle';
    voiceParticipants = [];
    voiceMuted = false;
    voiceDeafened = false;
    voiceMutedBeforeDeafen = false;
    voiceCameraEnabled = false;
    voiceScreenShareEnabled = false;
    focusedVideoIdentity = null;
    focusedScreenShareIdentity = null;
    screenShareFocusDismissed = false;
    mediaSettingsOpen = false;
    mediaSettingsNotice = '';
    mediaPreflightKind = null;
    voiceMediaNotice = '';
    streamVolumeMenu = null;
    voiceError = '';
    clearVoiceAudio();

    if (activeCall) {
      directCall = null;
      callUiState = 'idle';
    }

    if (room) {
      if (room.localParticipant.getTrackPublication(Track.Source.ScreenShare)) {
        await room.localParticipant.setScreenShareEnabled(false).catch(() => {});
      }
      if (room.localParticipant.getTrackPublication(Track.Source.Camera)) {
        await room.localParticipant.setCameraEnabled(false).catch(() => {});
      }
      await room.disconnect().catch(() => {});
    }
  }

  async function joinVoice(conversation: any) {
    voiceError = '';

    if (!window.isSecureContext) {
      voiceError = 'Voice requires HTTPS on mobile browsers. Open Cubic through its HTTPS hostname.';
      return;
    }

    if (voiceConversationId === conversation.id && voiceRoom) return;

    if (voiceRoom && voiceConversationId !== conversation.id) {
      if (!confirm(`Leave ${voiceConversationTitle || 'the current voice room'} and join ${conversationName(conversation)}?`)) return;
      await leaveVoice();
    }

    voiceStatus = 'connecting';
    voiceConversationId = conversation.id;
    voiceConversationTitle = conversationName(conversation);

    try {
      const ticket = await api(`/api/v1/voice/conversations/${conversation.id}/token`, { method: 'POST' });
      const room = new Room({
        adaptiveStream: true,
        dynacast: true
      });
      voiceRoom = room;

      const resync = () => {
        if (voiceRoom === room) syncVoiceParticipants();
      };

      room.on(RoomEvent.ParticipantConnected, resync);
      room.on(RoomEvent.ParticipantDisconnected, resync);
      room.on(RoomEvent.TrackMuted, resync);
      room.on(RoomEvent.TrackUnmuted, resync);
      room.on(RoomEvent.TrackPublished, (publication) => {
        if (publication.source === Track.Source.ScreenShare) {
          screenShareFocusDismissed = false;
        }
        resync();
      });
      room.on(RoomEvent.TrackUnpublished, resync);
      room.on(RoomEvent.LocalTrackPublished, (publication) => {
        if (publication.source === Track.Source.ScreenShare) {
          screenShareFocusDismissed = false;
        }
        resync();
      });
      room.on(RoomEvent.LocalTrackUnpublished, resync);
      room.on(RoomEvent.ActiveSpeakersChanged, resync);
      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (voiceRoom !== room) return;
        attachVoiceAudio(track, publication, participant);
        syncVoiceParticipants();
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        detachVoiceAudio(track);
        resync();
      });
      room.on(RoomEvent.Reconnecting, () => {
        if (voiceRoom === room) voiceStatus = 'reconnecting';
      });
      room.on(RoomEvent.Reconnected, () => {
        if (voiceRoom === room) {
          voiceStatus = 'connected';
          syncVoiceParticipants();
        }
      });
      room.on(RoomEvent.Disconnected, () => {
        if (voiceRoom === room) {
          const disconnectedConversationId = voiceConversationId;
          voiceRoom = null;
          voiceConversationId = null;
          voiceConversationTitle = '';
          voiceStatus = 'idle';
          voiceParticipants = [];
          voiceMuted = false;
          voiceDeafened = false;
          voiceMutedBeforeDeafen = false;
          voiceCameraEnabled = false;
          voiceScreenShareEnabled = false;
          focusedVideoIdentity = null;
          focusedScreenShareIdentity = null;
          screenShareFocusDismissed = false;
          mediaSettingsOpen = false;
          mediaSettingsNotice = '';
          clearVoiceAudio();

          if (directCall?.state === 'accepted' && directCall.conversationId === disconnectedConversationId) {
            callUiState = 'rejoin';
          }
        }
      });

      await room.connect(ticket.url, ticket.token);
      if (voiceRoom !== room) {
        await room.disconnect();
        return;
      }

      await room.startAudio().catch(() => {});

      let microphoneWarning = '';
      try {
        await room.localParticipant.setMicrophoneEnabled(
          true,
          selectedAudioInput
            ? { deviceId: { exact: selectedAudioInput } }
            : undefined
        );
      } catch (microphoneError) {
        microphoneWarning =
          `Joined muted — ${mediaDeviceErrorMessage(microphoneError, 'microphone')}`;
      }

      voiceStatus = 'connected';
      syncVoiceParticipants();

      if (selectedAudioOutput && audioOutputSupported) {
        room.switchActiveDevice('audiooutput', selectedAudioOutput).catch(() => {});
      }

      if (microphoneWarning) {
        voiceError = microphoneWarning;
      }
      if (directCall?.state === 'accepted' && directCall.conversationId === conversation.id) {
        callUiState = 'in-call';
      }
    } catch (e) {
      const failedRoom = voiceRoom;
      voiceRoom = null;
      voiceConversationId = null;
      voiceConversationTitle = '';
      voiceStatus = 'idle';
      voiceParticipants = [];
      clearVoiceAudio();
      if (failedRoom) await failedRoom.disconnect().catch(() => {});
      if (directCall?.state === 'accepted' && directCall.conversationId === conversation.id) {
        callUiState = 'rejoin';
      }
      voiceError = e instanceof Error ? e.message : 'Could not join voice.';
    }
  }

  async function toggleVoiceMute() {
    const room = voiceRoom;
    if (!room || voiceStatus !== 'connected' || voiceDeafened) return;

    try {
      await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled);
      syncVoiceParticipants();
    } catch (e) {
      voiceError = mediaDeviceErrorMessage(e, 'microphone');
      syncVoiceParticipants();
    }
  }

  async function toggleVoiceDeafen() {
    const room = voiceRoom;
    if (!room || voiceStatus !== 'connected') return;

    try {
      if (!voiceDeafened) {
        voiceMutedBeforeDeafen = !room.localParticipant.isMicrophoneEnabled;
        await room.localParticipant.setMicrophoneEnabled(false);
        voiceDeafened = true;
        setRemoteAudioDeafened(true);
      } else {
        voiceDeafened = false;
        setRemoteAudioDeafened(false);
        await room.localParticipant.setMicrophoneEnabled(!voiceMutedBeforeDeafen);
        voiceMutedBeforeDeafen = false;
      }
      syncVoiceParticipants();
    } catch (e) {
      voiceError = e instanceof Error ? e.message : 'Could not change deafen state.';
    }
  }

  async function toggleVoiceCamera() {
    const room = voiceRoom;
    if (!room || voiceStatus !== 'connected') return;

    const current = room.localParticipant.getTrackPublication(Track.Source.Camera);
    const enabled = Boolean(current && !current.isMuted && current.track);

    if (!enabled) {
      openMediaPreflight('camera');
      return;
    }

    try {
      voiceError = '';
      await room.localParticipant.setCameraEnabled(false);
      syncVoiceParticipants();
    } catch (error) {
      voiceError = mediaDeviceErrorMessage(error, 'camera');
      syncVoiceParticipants();
    }
  }

  async function toggleScreenShare() {
    const room = voiceRoom;
    if (!room || voiceStatus !== 'connected') return;

    if (!screenShareSupported()) {
      voiceError = 'Screen sharing is not available in this browser.';
      return;
    }

    const current = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
    const enabled = Boolean(current && !current.isMuted);

    if (!enabled) {
      openMediaPreflight('screen-share');
      return;
    }

    try {
      voiceError = '';
      voiceMediaNotice = '';
      await room.localParticipant.setScreenShareEnabled(false);
      syncVoiceParticipants();
    } catch (error) {
      voiceError = screenShareErrorMessage(error);
      syncVoiceParticipants();
    }
  }

  function focusScreenShare(identity: string) {
    focusedScreenShareIdentity = identity;
    focusedVideoIdentity = null;
    screenShareFocusDismissed = false;
  }

  function returnToMediaGrid() {
    focusedScreenShareIdentity = null;
    focusedVideoIdentity = null;
    screenShareFocusDismissed = activeScreenShares().length > 0;
  }

  function toggleVideoFocus(identity: string) {
    focusedScreenShareIdentity = null;
    screenShareFocusDismissed = activeScreenShares().length > 0;
    focusedVideoIdentity = focusedVideoIdentity === identity ? null : identity;
  }

  async function fullscreenVideoStage() {
    const element = videoStageElement;
    if (!element) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (element.requestFullscreen) {
        await element.requestFullscreen();
      }
    } catch {
      // Fullscreen is optional; the video grid remains usable without it.
    }
  }

  async function logout() {
    loggingOut = true;
    await leaveVoice();
    realtimeSocket?.disconnect();
    try { await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' }); }
    finally { window.location.assign('/login'); }
  }

  onMount(() => {
    loadMediaPreferences();
    Promise.all([refreshSocial(), refreshGroupInvites(), refreshConversations()]).catch((e) => error = e.message);

    const socket = io({
      path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'], timeout: 5000, reconnection: true
    });
    realtimeSocket = socket;

    socket.on('connect', () => {
      realtimeConnected = true;
      Promise.all([refreshSocial(), refreshGroupInvites(), refreshConversations(), syncActiveConversation(), refreshGroupDetails()]).catch(() => {});
      syncDirectCall(socket).catch(() => {});
    });
    socket.on('disconnect', () => { realtimeConnected = false; });
    socket.on('connect_error', () => { realtimeConnected = false; });
    socket.on('message:created', (message: any) => {
      if (activeConversation?.id === message.conversationId) {
        const shouldFollow = isNearLatest() || message.senderId === data.user.id;
        const inserted = upsertMessage(message);
        if (inserted) {
          if (shouldFollow) {
            void scrollToLatest(message.senderId === data.user.id ? 'smooth' : 'auto');
          } else {
            unreadNewMessages += 1;
            atLatest = false;
          }
        }
      }
      queueConversationRefresh();
    });
    socket.on('conversation:updated', (event: any) => {
      queueConversationRefresh();
      if (activeConversation?.id === event?.conversationId && activeConversation.kind === 'group') {
        refreshGroupDetails().catch(() => {});
      }
    });
    socket.on('conversation:removed', (event: any) => {
      if (voiceConversationId === event?.conversationId) void leaveVoice();
      if (activeConversation?.id === event?.conversationId) closeConversation();
      refreshConversations().catch(() => {});
    });
    socket.on('group:invites:updated', () => {
      refreshGroupInvites().catch(() => {});
    });
    socket.on('call:incoming', (event: DirectCallWire) => {
      void applyCallEvent(socket, event);
    });
    socket.on('call:state', (event: DirectCallWire) => {
      void applyCallEvent(socket, event);
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

    const onMediaDeviceChange = () => {
      if (mediaSettingsOpen) refreshMediaDevices().catch(() => {});
    };

    window.addEventListener('pageshow', resumeRealtime);
    window.addEventListener('focus', resumeRealtime);
    window.addEventListener('online', resumeRealtime);
    document.addEventListener('visibilitychange', onVisibilityChange);
    navigator.mediaDevices?.addEventListener?.('devicechange', onMediaDeviceChange);

    return () => {
      if (resumeTimer) clearTimeout(resumeTimer);

      window.removeEventListener('pageshow', resumeRealtime);
      window.removeEventListener('focus', resumeRealtime);
      window.removeEventListener('online', resumeRealtime);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      navigator.mediaDevices?.removeEventListener?.('devicechange', onMediaDeviceChange);

      realtimeSocket = null;
      socket.disconnect();
      if (callNoticeTimer) clearTimeout(callNoticeTimer);
      void leaveVoice();
    };
  });
</script>

<svelte:head><title>Cubic — {data.user.displayName}</title></svelte:head>

<main class="messenger-shell">
  <aside class="messenger-nav">
    <div class="messenger-brand"><img src="/images/cubic-w-nobg.png" alt="" /><strong>Cubic</strong><span title={realtimeConnected ? 'Realtime connected' : 'Realtime reconnecting'}>{realtimeConnected ? 'LIVE' : 'SYNC'}</span></div>
    <button class="nav-action" class:active={tab === 'chats'} title="Chats" onclick={() => tab = 'chats'}>
      <Icon name="message" size={20} /><span>Chats</span>
    </button>
    <button class="nav-action" class:active={tab === 'people'} title="People" onclick={() => { tab = 'people'; closeConversation(); }}>
      <Icon name="users" size={20} />
      <span>People{(requests.filter((r) => r.direction === 'incoming').length + groupInvites.length) ? ` · ${requests.filter((r) => r.direction === 'incoming').length + groupInvites.length}` : ''}</span>
    </button>
    <div class="messenger-nav-spacer"></div>
    <div class="mini-profile"><span>{data.user.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{data.user.displayName}</strong><small>@{data.user.username}</small></div></div>
    <button class="logout-action" title="Log out" aria-label="Log out" onclick={logout} disabled={loggingOut}>
      <Icon name="logout" size={20} /><span>{loggingOut ? 'Wait…' : 'Log out'}</span>
    </button>
  </aside>

  <section class="conversation-list">
    {#if tab === 'chats'}
      <header class="conversation-list-header">
        <div><small>MESSAGES</small><h1>Conversations</h1></div>
        <button class="icon-action" type="button" aria-label="New group" title="New group" onclick={openNewGroup}><Icon name="plus" size={19} /></button>
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
        <button class="chat-back" type="button" aria-label="Back to conversations" title="Back" onclick={closeConversation}><Icon name="back" size={24} /></button>
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
          <button class="chat-meta-button" type="button" aria-label="Group settings" title="Group settings" onclick={() => { groupPanelOpen = !groupPanelOpen; if (groupPanelOpen) refreshGroupDetails().catch(() => {}); }}>
            <Icon name="settings" size={19} />
          </button>
        {/if}
        {#if activeConversation.kind === 'direct'}
          <button
            class="chat-voice-button"
            class:active={directCall?.conversationId === activeConversation.id}
            type="button"
            aria-label="Start voice call"
            title={directCall?.conversationId === activeConversation.id ? 'Call active' : 'Start voice call'}
            onclick={() => startDirectCall(activeConversation)}
            disabled={callActionBusy || directCall !== null}
          >
            <Icon name={directCall?.conversationId === activeConversation.id ? 'phone-out' : 'phone'} size={19} />
          </button>
        {:else}
          <button
            class="chat-voice-button"
            class:active={voiceConversationId === activeConversation.id && voiceStatus === 'connected'}
            type="button"
            aria-label="Join group voice"
            title={voiceConversationId === activeConversation.id ? 'Group voice connected' : 'Join group voice'}
            onclick={() => joinVoice(activeConversation)}
            disabled={voiceStatus === 'connecting' && voiceConversationId === activeConversation.id}
          >
            <Icon name="headphones" size={20} />
          </button>
        {/if}
      </header>

      {#if voiceStatus !== 'idle' && mediaStageVisible()}
        <section
          class="video-stage"
          class:presentation-mode={Boolean(focusedScreenShareParticipant())}
          bind:this={videoStageElement}
          aria-label="Call media"
        >
          <header class="video-stage-head">
            <Icon name={focusedScreenShareParticipant() ? 'screen-share' : 'camera'} size={18} />
            <div>
              <strong>
                {focusedScreenShareParticipant()
                  ? `${focusedScreenShareParticipant()?.name}${focusedScreenShareParticipant()?.local ? ' · you' : ''} is sharing`
                  : (voiceConversationTitle || conversationName(activeConversation))}
              </strong>
              <small>
                {voiceParticipants.length} connected ·
                {voiceParticipants.filter((participant) => participant.cameraEnabled).length} camera{voiceParticipants.filter((participant) => participant.cameraEnabled).length === 1 ? '' : 's'} ·
                {activeScreenShares().length} share{activeScreenShares().length === 1 ? '' : 's'}
              </small>
            </div>
            {#if focusedVideoIdentity || focusedScreenShareIdentity}
              <button
                class="video-stage-action"
                type="button"
                title="Return to grid"
                aria-label="Return to grid"
                onclick={returnToMediaGrid}
              >
                <Icon name="users" size={18} />
              </button>
            {/if}
            <button
              class="video-stage-action"
              class:active={mediaSettingsOpen}
              type="button"
              title="Voice & video settings"
              aria-label="Voice and video settings"
              onclick={showMediaSettings}
            >
              <Icon name="settings" size={18} />
            </button>
            <button
              class="video-stage-action"
              type="button"
              title="Fullscreen"
              aria-label="Fullscreen media"
              onclick={fullscreenVideoStage}
            >
              <Icon name="maximize" size={18} />
            </button>
          </header>

          {#if focusedScreenShareParticipant()}
            <div class="presentation-layout">
              <div class="presentation-main">
                <ScreenShareTile
                  track={focusedScreenShareParticipant()?.screenShareTrack}
                  name={focusedScreenShareParticipant()?.name ?? 'Member'}
                  local={focusedScreenShareParticipant()?.local ?? false}
                  focused={true}
                  onclick={returnToMediaGrid}
                  oncontextmenu={(event) => {
                    const participant = focusedScreenShareParticipant();
                    if (participant) openStreamVolumeMenu(event, participant);
                  }}
                />
              </div>

              <div class="presentation-filmstrip" aria-label="Call participants">
                {#each voiceParticipants as participant (participant.identity)}
                  <VideoTile
                    track={participant.videoTrack}
                    name={participant.name}
                    local={participant.local}
                    speaking={participant.speaking}
                    cameraEnabled={participant.cameraEnabled}
                    focused={false}
                    onclick={() => toggleVideoFocus(participant.identity)}
                  />
                {/each}
              </div>
            </div>
          {:else}
            <div
              class="video-grid"
              class:has-focus={Boolean(focusedVideoIdentity)}
              class:participants-1={voiceParticipants.length === 1 && activeScreenShares().length === 0}
              class:participants-2={voiceParticipants.length + activeScreenShares().length === 2}
            >
              {#each activeScreenShares() as participant (`share-${participant.identity}`)}
                <ScreenShareTile
                  track={participant.screenShareTrack}
                  name={participant.name}
                  local={participant.local}
                  focused={false}
                  onclick={() => focusScreenShare(participant.identity)}
                  oncontextmenu={(event) => openStreamVolumeMenu(event, participant)}
                />
              {/each}

              {#each voiceParticipants as participant (participant.identity)}
                <VideoTile
                  track={participant.videoTrack}
                  name={participant.name}
                  local={participant.local}
                  speaking={participant.speaking}
                  cameraEnabled={participant.cameraEnabled}
                  focused={focusedVideoIdentity === participant.identity}
                  onclick={() => toggleVideoFocus(participant.identity)}
                />
              {/each}
            </div>
          {/if}
        </section>
      {/if}

      <div class="messages-wrap">
        <div
          class="messages cubic-attachment-message-stream"
          bind:this={messagesViewport}
          onscroll={handleMessagesScroll}
          aria-busy={historyLoading}
        >
          {#if historyLoading && chatMessages.length > 0}
            <div class="history-loading" role="status">Loading older messages...</div>
          {/if}
          {#if historyLoading && chatMessages.length === 0}
            <div class="message-skeleton-list" aria-hidden="true">
              {#each [1, 2, 3, 4, 5, 6] as row}
                <div class="message-skeleton" class:mine={row % 3 === 0}>
                  <span></span>
                  <i></i>
                </div>
              {/each}
            </div>
          {/if}
        {#if chatMessages.length === 0 && !historyLoading}
          <div class="chat-empty"><strong>No messages yet</strong><span>Send the first message to start the conversation.</span></div>
        {/if}
        {#each chatMessages as message, index (message.id)}
          {#if showMessageDateDivider(index)}
            <div class="message-date-divider" aria-label={formatMessageDay(message.createdAt)}>
              <span>{formatMessageDay(message.createdAt)}</span>
            </div>
          {/if}

          <article
            class="discord-message"
            class:continuation={isMessageContinuation(index)}
            class:mine={message.senderId === data.user.id}
          >
            <div class="discord-message-gutter">
              {#if !isMessageContinuation(index)}
                {#if message.senderAvatarUrl}
                  <img
                    class="discord-message-avatar"
                    src={message.senderAvatarUrl}
                    alt=""
                    loading="lazy"
                  />
                {:else}
                  <span class="discord-message-avatar fallback">
                    {messageSenderInitial(message)}
                  </span>
                {/if}
              {:else}
                <time class="discord-message-hover-time" datetime={message.createdAt}>
                  {formatMessageTime(message.createdAt)}
                </time>
              {/if}
            </div>

            <div class="discord-message-content">
              {#if !isMessageContinuation(index)}
                <header class="discord-message-header">
                  <strong>{messageSenderName(message)}</strong>
                  {#if message.senderId === data.user.id}
                    <span class="discord-you">you</span>
                  {/if}
                  <time datetime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
                </header>
              {/if}

              <div class="discord-message-body" class:deleted={Boolean(message.deletedAt)}>
                {message.deletedAt ? 'Message deleted' : message.body}
              </div>

              {#if !message.deletedAt && attachmentsOf(message).length > 0}
                <MessageAttachments attachments={attachmentsOf(message)} />
              {/if}
            </div>
          </article>
        {/each}
        </div>

        {#if !atLatest}
          <button
            class="jump-latest"
            type="button"
            aria-label="Jump to latest messages"
            title="Jump to latest"
            onclick={() => scrollToLatest('smooth')}
          >
            <Icon name="chevron-down" size={19} />
            {#if unreadNewMessages > 0}
              <span>{unreadNewMessages > 99 ? '99+' : unreadNewMessages}</span>
            {/if}
          </button>
        {/if}
      </div>

      {#if error}<div class="inline-error chat-error">{error}</div>{/if}

      {#if currentStagedAttachments().length > 0}
        <div
          class="cubic-attachment-staging"
          aria-label="Attachments ready to send"
        >
          {#each currentStagedAttachments() as item (item.localId)}
            <div
              class="cubic-staged-attachment"
              class:error={item.status === 'error'}
            >
              <div class="cubic-staged-attachment-main">
                <span class="cubic-attachment-glyph" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18">
                    <path
                      d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linejoin="round"
                    />
                    <path
                      d="M14 2v6h6"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linejoin="round"
                    />
                  </svg>
                </span>

                <span class="cubic-staged-attachment-copy">
                  <strong>{item.fileName}</strong>
                  <small>
                    {#if item.status === 'uploading'}
                      Uploading… {item.progress}%
                    {:else if item.status === 'ready'}
                      {formatAttachmentSize(item.sizeBytes)} · Ready
                    {:else}
                      {item.error || 'Upload failed'}
                    {/if}
                  </small>
                </span>
              </div>

              {#if item.status === 'uploading'}
                <div
                  class="cubic-upload-progress"
                  aria-label={`Uploading ${item.fileName}: ${item.progress}%`}
                >
                  <span style={`width: ${item.progress}%`}></span>
                </div>
              {/if}

              <button
                class="cubic-staged-remove"
                type="button"
                aria-label={`Remove ${item.fileName}`}
                title="Remove attachment"
                onclick={() => void discardStagedAttachment(item.localId)}
              >
                ×
              </button>
            </div>
          {/each}
        </div>
      {/if}

      <form
        class="composer cubic-attachment-composer"
        onsubmit={(event) => {
          event.preventDefault();
          sendMessage();
        }}
        onpaste={handleAttachmentPaste}
        ondragover={(event) => {
          if (event.dataTransfer?.types.includes('Files')) {
            event.preventDefault();
          }
        }}
        ondrop={handleAttachmentDrop}
      >
        <input
          class="cubic-attachment-input"
          bind:this={attachmentInput}
          type="file"
          multiple
          tabindex="-1"
          aria-hidden="true"
          onchange={(event) => {
            const input = event.currentTarget;
            if (input.files?.length) {
              void queueAttachmentFiles(input.files);
            }
            input.value = '';
          }}
        />

        <button
          class="cubic-attachment-picker"
          type="button"
          aria-label="Add attachment"
          title="Add attachment"
          disabled={busy || stagedUploadPending()}
          onclick={() => attachmentInput?.click()}
        >
          <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
            <path
              d="m20.5 11.5-8.9 8.9a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 1 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>

        <input
          bind:value={messageBody}
          maxlength="8000"
          autocomplete="off"
          placeholder="Message…"
        />

        <button
          type="submit"
          aria-label="Send message"
          title={stagedUploadPending() ? 'Wait for attachments to finish uploading' : 'Send'}
          disabled={
            busy ||
            stagedUploadPending() ||
            (!messageBody.trim() && stagedReadyIds().length === 0)
          }
        >
          <Icon name="send" size={18} />
        </button>
      </form>

      {#if groupPanelOpen && groupDetails}
        <aside class="group-panel" aria-label="Group settings">
          <div class="group-panel-head">
            <div><small>GROUP SETTINGS</small><h2>{groupDetails.title}</h2></div>
            <button class="icon-action" type="button" aria-label="Close group settings" title="Close" onclick={() => groupPanelOpen = false}><Icon name="x" size={18} /></button>
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
              <div class="group-inline-form"><input id="group-name" bind:value={groupRename} maxlength="96" /><button title="Save group name" onclick={renameGroup} disabled={busy || !groupRename.trim()}><Icon name="check" size={16} /><span>Save</span></button></div>
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
                    <button class="quiet" title={member.role === 'admin' ? 'Remove admin role' : 'Make admin'} onclick={() => setGroupRole(member.id, member.role === 'admin' ? 'member' : 'admin')}>
                      <Icon name="shield" size={15} /><span>{member.role === 'admin' ? 'Demote' : 'Admin'}</span>
                    </button>
                    <button class="quiet" title="Transfer ownership" onclick={() => transferGroupOwner(member.id)}><Icon name="crown" size={15} /><span>Owner</span></button>
                  {/if}
                  {#if member.id !== data.user.id && member.role !== 'owner' && (groupDetails.currentRole === 'owner' || (groupDetails.currentRole === 'admin' && member.role === 'member'))}
                    <button class="danger-button" title="Remove member" onclick={() => removeGroupMember(member.id)}><Icon name="user-minus" size={15} /><span>Remove</span></button>
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
                    <button class="quiet" title="Cancel invitation" onclick={() => cancelGroupInvite(invite.id)} disabled={busy}><Icon name="x" size={15} /><span>Cancel</span></button>
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
                  <button title="Invite friend" onclick={() => inviteGroupMember(friend.id)} disabled={busy}><Icon name="user-plus" size={15} /><span>Invite</span></button>
                </div>
              {/each}
            </div>
          {/if}

          <div class="group-setting-block group-danger-zone">
            {#if groupDetails.currentRole === 'owner'}
              <p>Transfer ownership before leaving while other members remain.</p>
              <button class="danger-button wide" onclick={deleteGroup} disabled={busy}><Icon name="trash" size={16} /><span>Delete group</span></button>
            {:else}
              <button class="danger-button wide" onclick={leaveGroup} disabled={busy}><Icon name="logout" size={16} /><span>Leave group</span></button>
            {/if}
          </div>
        </aside>
      {/if}
    {:else}
      <div class="chat-placeholder"><img src="/images/cubic-w-nobg.png" alt="" /><h2>Your Cubic conversations</h2><p>Select a chat, or create a group with your friends.</p></div>
    {/if}
  </section>

  {#if directCall && callUiState !== 'in-call'}
    <section class="call-lifecycle-card" aria-live="polite" aria-label="Voice call">
      <div class="call-lifecycle-copy">
        <span class="call-lifecycle-avatar">{callPeerName(directCall).slice(0,1).toUpperCase()}</span>
        <div>
          <strong>{callPeerName(directCall)}</strong>
          <small>
            {callUiState === 'calling' ? 'Calling…' :
             callUiState === 'ringing' ? 'Incoming voice call' :
             callUiState === 'connecting' ? 'Connecting…' :
             'Call in progress'}
          </small>
        </div>
      </div>

      <div class="call-lifecycle-actions">
        {#if callUiState === 'calling'}
          <button class="call-cancel" type="button" onclick={cancelDirectCall} disabled={callActionBusy}>
            <Icon name="phone-off" size={18} /><span>Cancel</span>
          </button>
        {:else if callUiState === 'ringing'}
          <button class="call-decline" type="button" onclick={declineDirectCall} disabled={callActionBusy}>
            <Icon name="phone-off" size={18} /><span>Decline</span>
          </button>
          <button class="call-accept" type="button" onclick={acceptDirectCall} disabled={callActionBusy}>
            <Icon name="phone-in" size={18} /><span>Accept</span>
          </button>
        {:else if callUiState === 'rejoin'}
          <button class="call-end" type="button" onclick={endDirectCall} disabled={callActionBusy}>
            <Icon name="phone-off" size={18} /><span>End</span>
          </button>
          <button class="call-rejoin" type="button" onclick={rejoinDirectCall} disabled={callActionBusy}>
            <Icon name="phone" size={18} /><span>Rejoin</span>
          </button>
        {:else}
          <button class="call-end" type="button" onclick={endDirectCall} disabled={callActionBusy}>
            <Icon name="phone-off" size={18} /><span>End</span>
          </button>
        {/if}
      </div>
    </section>
  {/if}

  {#if callNotice}
    <div class="call-notice" role="status">{callNotice}</div>
  {/if}

  {#if voiceStatus !== 'idle' || voiceError}
    <section class="voice-dock" aria-label="Voice room">
      <div class="voice-dock-head">
        <span class="voice-dock-icon" aria-hidden="true"><Icon name="headphones" size={20} /></span>
        <div>
          <strong>{voiceConversationTitle || 'Voice'}</strong>
          <small>
            {voiceStatus === 'connected'
              ? `${voiceParticipants.length} connected`
              : voiceStatus === 'reconnecting'
                ? 'Reconnecting…'
                : voiceStatus === 'connecting'
                  ? 'Joining voice…'
                  : 'Voice unavailable'}
          </small>
        </div>
        {#if voiceStatus !== 'idle'}
          <button
            class="voice-settings-button"
            class:active={mediaSettingsOpen}
            type="button"
            title="Voice & video settings"
            aria-label="Voice and video settings"
            onclick={() => mediaSettingsOpen ? hideMediaSettings() : showMediaSettings()}
          >
            <Icon name="settings" size={17} />
          </button>
        {/if}
      </div>

      {#if mediaSettingsOpen}
        <section class="media-settings-panel" aria-label="Voice and video settings">
          <header class="media-settings-head">
            <div>
              <strong>Voice & Video</strong>
              <small>Changes are saved on this browser.</small>
            </div>
            <button type="button" title="Close settings" aria-label="Close settings" onclick={hideMediaSettings}>
              <Icon name="x" size={17} />
            </button>
          </header>

          <div class="media-settings-section">
            <span class="media-settings-label">Input devices</span>

            <label>
              <span>Microphone</span>
              <select
                value={selectedAudioInput}
                onchange={onAudioInputChange}
                disabled={mediaSettingsBusy || audioInputDevices.length === 0}
              >
                {#if audioInputDevices.length === 0}
                  <option value="">No microphone detected</option>
                {/if}
                {#each audioInputDevices as device, index}
                  <option value={device.deviceId}>{deviceLabel(device, index, 'Microphone')}</option>
                {/each}
              </select>
            </label>

            <label>
              <span>Camera</span>
              <select
                value={selectedVideoInput}
                onchange={onVideoInputChange}
                disabled={mediaSettingsBusy || videoInputDevices.length === 0}
              >
                {#if videoInputDevices.length === 0}
                  <option value="">No camera detected</option>
                {/if}
                {#each videoInputDevices as device, index}
                  <option value={device.deviceId}>{deviceLabel(device, index, 'Camera')}</option>
                {/each}
              </select>
            </label>

            <label>
              <span>Output device</span>
              <select
                value={selectedAudioOutput}
                onchange={onAudioOutputChange}
                disabled={mediaSettingsBusy || !audioOutputSupported || audioOutputDevices.length === 0}
              >
                {#if !audioOutputSupported}
                  <option value="">Browser default · selection unsupported</option>
                {:else if audioOutputDevices.length === 0}
                  <option value="">Browser default</option>
                {/if}
                {#each audioOutputDevices as device, index}
                  <option value={device.deviceId}>{deviceLabel(device, index, 'Speaker')}</option>
                {/each}
              </select>
            </label>
          </div>

          <div class="media-settings-section">
            <div class="media-settings-section-head">
              <span class="media-settings-label">Camera quality</span>
              <small>{cameraQualityLabel()}</small>
            </div>
            <div class="media-quality-options" aria-label="Camera quality">
              <button
                type="button"
                class:active={cameraQuality === 'data-saver'}
                onclick={() => setCameraQualityPreset('data-saver')}
                disabled={mediaSettingsBusy}
              >
                Data saver
                <small>360p · 24</small>
              </button>
              <button
                type="button"
                class:active={cameraQuality === 'balanced'}
                onclick={() => setCameraQualityPreset('balanced')}
                disabled={mediaSettingsBusy}
              >
                Balanced
                <small>720p · 30</small>
              </button>
              <button
                type="button"
                class:active={cameraQuality === 'smooth'}
                onclick={() => setCameraQualityPreset('smooth')}
                disabled={mediaSettingsBusy}
              >
                Smooth
                <small>720p · 60</small>
              </button>
              <button
                type="button"
                class:active={cameraQuality === 'high'}
                onclick={() => setCameraQualityPreset('high')}
                disabled={mediaSettingsBusy}
              >
                High
                <small>1080p · 30</small>
              </button>
            </div>
          </div>

          <div class="media-settings-section">
            <div class="media-settings-section-head">
              <span class="media-settings-label">Screen share</span>
              <small>{screenShareQualityLabel()}</small>
            </div>
            <div class="media-quality-options" aria-label="Screen share quality">
              <button
                type="button"
                class:active={screenShareQuality === 'text'}
                onclick={() => setScreenShareQualityPreset('text')}
              >
                Text
                <small>1080p · 15</small>
              </button>
              <button
                type="button"
                class:active={screenShareQuality === 'balanced'}
                onclick={() => setScreenShareQualityPreset('balanced')}
              >
                Balanced
                <small>1080p · 30</small>
              </button>
              <button
                type="button"
                class:active={screenShareQuality === 'smooth'}
                onclick={() => setScreenShareQualityPreset('smooth')}
              >
                Smooth
                <small>1080p · 60</small>
              </button>
              <button
                type="button"
                class:active={screenShareQuality === 'motion'}
                onclick={() => setScreenShareQualityPreset('motion')}
              >
                Motion
                <small>720p · 60</small>
              </button>
            </div>
          </div>

          <div class="media-adaptive-row">
            <Icon name="check" size={16} />
            <div>
              <strong>Adaptive bandwidth</strong>
              <small>Adaptive Stream + Dynacast are enabled for this call.</small>
            </div>
          </div>

          {#if mediaSettingsNotice}
            <div class="media-settings-notice" role="status">{mediaSettingsNotice}</div>
          {/if}
        </section>
      {/if}

      {#if voiceParticipants.length && !mediaStageVisible()}
        <div class="voice-participants">
          {#each voiceParticipants as participant}
            <div class="voice-participant" class:speaking={participant.speaking}>
              <span>{participant.name.slice(0,1).toUpperCase()}</span>
              <div>
                <strong>{participant.name}{participant.local ? ' · you' : ''}</strong>
                <small>{participant.muted ? 'Muted' : participant.speaking ? 'Speaking' : 'Microphone on'}</small>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      {#if voiceStatus !== 'idle'}
        <div class="voice-dock-actions">
          <button
            type="button"
            class:active={voiceMuted}
            title={voiceDeafened ? 'Undeafen before changing microphone state' : (voiceMuted ? 'Unmute' : 'Mute')}
            onclick={toggleVoiceMute}
            disabled={voiceStatus !== 'connected' || voiceDeafened}
          >
            <Icon name={voiceMuted ? 'mic-off' : 'mic'} size={18} />
            <span>{voiceMuted ? 'Unmute' : 'Mute'}</span>
          </button>
          <button
            type="button"
            class:active={voiceDeafened}
            title={voiceDeafened ? 'Undeafen' : 'Deafen'}
            onclick={toggleVoiceDeafen}
            disabled={voiceStatus !== 'connected'}
          >
            <Icon name={voiceDeafened ? 'headphones-off' : 'headphones'} size={18} />
            <span>{voiceDeafened ? 'Undeafen' : 'Deafen'}</span>
          </button>
          <button
            type="button"
            class:camera-active={voiceCameraEnabled}
            title={voiceCameraEnabled ? 'Turn camera off' : 'Turn camera on'}
            aria-label={voiceCameraEnabled ? 'Turn camera off' : 'Turn camera on'}
            onclick={toggleVoiceCamera}
            disabled={voiceStatus !== 'connected'}
          >
            <Icon name={voiceCameraEnabled ? 'camera-off' : 'camera'} size={18} />
            <span>{voiceCameraEnabled ? 'Camera off' : 'Camera'}</span>
          </button>
          <button
            type="button"
            class:screen-share-active={voiceScreenShareEnabled}
            title={!screenShareSupported()
              ? 'Screen sharing is not available in this browser'
              : voiceScreenShareEnabled
                ? 'Stop sharing'
                : 'Share your screen'}
            aria-label={voiceScreenShareEnabled ? 'Stop sharing screen' : 'Share screen'}
            onclick={toggleScreenShare}
            disabled={voiceStatus !== 'connected' || !screenShareSupported()}
          >
            <Icon name={voiceScreenShareEnabled ? 'screen-share-off' : 'screen-share'} size={18} />
            <span>{voiceScreenShareEnabled ? 'Stop share' : 'Share'}</span>
          </button>
          <button class="voice-leave" type="button" title="Disconnect" aria-label="Disconnect from call" onclick={() => leaveVoice()}>
            <Icon name="phone-off" size={18} /><span>Leave</span>
          </button>
        </div>
      {/if}

      {#if voiceMediaNotice}
        <div class="voice-media-notice" role="status">
          {voiceMediaNotice}
          <button
            type="button"
            aria-label="Dismiss media notice"
            title="Dismiss"
            onclick={() => voiceMediaNotice = ''}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      {/if}

      {#if voiceError}
        <div class="inline-error voice-error">{voiceError}</div>
        {#if voiceStatus === 'idle'}
          <div class="voice-dock-actions">
            <button type="button" onclick={() => voiceError = ''}>Dismiss</button>
          </div>
        {/if}
      {/if}

      <div class="voice-audio-host" bind:this={voiceAudioHost}></div>
    </section>
  {/if}

  {#if mediaPreflightKind}
    <div class="media-preflight-backdrop">
      <section
        class="media-preflight"
        role="dialog"
        aria-modal="true"
        aria-label={mediaPreflightKind === 'camera' ? 'Camera quality' : 'Go Live quality'}
      >
        <header>
          <div>
            <Icon name={mediaPreflightKind === 'camera' ? 'camera' : 'screen-share'} size={20} />
            <div>
              <strong>{mediaPreflightKind === 'camera' ? 'Turn on camera' : 'Go Live'}</strong>
              <small>
                {mediaPreflightKind === 'camera'
                  ? 'Choose quality before publishing your camera.'
                  : 'Choose stream quality before the browser share picker opens.'}
              </small>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            title="Close"
            onclick={closeMediaPreflight}
            disabled={mediaPreflightBusy}
          >
            <Icon name="x" size={17} />
          </button>
        </header>

        <div class="media-preflight-section">
          <span>Resolution</span>
          <div class="media-preflight-options two">
            <button
              type="button"
              class:active={mediaPreflightResolution === 720}
              onclick={() => setPreflightResolution(720)}
            >
              720p
            </button>
            <button
              type="button"
              class:active={mediaPreflightResolution === 1080}
              onclick={() => setPreflightResolution(1080)}
            >
              1080p
            </button>
          </div>
        </div>

        <div class="media-preflight-section">
          <span>Frame rate</span>
          <div class="media-preflight-options">
            {#if mediaPreflightKind === 'screen-share'}
              <button
                type="button"
                class:active={mediaPreflightFps === 15}
                onclick={() => setPreflightFps(15)}
              >
                15 FPS
              </button>
            {:else}
              <button
                type="button"
                class:active={mediaPreflightFps === 24}
                onclick={() => setPreflightFps(24)}
              >
                24 FPS
              </button>
            {/if}
            <button
              type="button"
              class:active={mediaPreflightFps === 30}
              onclick={() => setPreflightFps(30)}
            >
              30 FPS
            </button>
            <button
              type="button"
              class:active={mediaPreflightFps === 60}
              onclick={() => setPreflightFps(60)}
            >
              60 FPS
            </button>
          </div>
        </div>

        {#if mediaPreflightKind === 'screen-share'}
          <label class="media-preflight-audio">
            <input type="checkbox" bind:checked={screenShareRequestAudio} />
            <div>
              <strong>Request shared audio</strong>
              <small>
                Your browser decides whether tab/system audio is available. If the native picker offers
                a Share audio checkbox, enable it there too.
              </small>
            </div>
          </label>
        {/if}

        <div class="media-preflight-summary">
          <strong>{mediaPreflightResolution}p · {mediaPreflightFps} FPS</strong>
          <small>
            {mediaPreflightKind === 'screen-share' && mediaPreflightResolution === 1080 && mediaPreflightFps === 60
              ? 'Up to ~8 Mbps'
              : mediaPreflightKind === 'screen-share' && mediaPreflightFps === 60
                ? 'Up to ~5 Mbps'
                : mediaPreflightKind === 'camera' && mediaPreflightResolution === 1080 && mediaPreflightFps === 60
                  ? 'Up to ~6 Mbps'
                  : 'Adaptive bitrate'}
          </small>
        </div>

        <footer>
          <button type="button" onclick={closeMediaPreflight} disabled={mediaPreflightBusy}>
            Cancel
          </button>
          <button
            class="primary"
            type="button"
            onclick={confirmMediaPreflight}
            disabled={mediaPreflightBusy}
          >
            {mediaPreflightBusy
              ? 'Starting…'
              : mediaPreflightKind === 'screen-share'
                ? 'Go Live'
                : 'Turn on'}
          </button>
        </footer>
      </section>
    </div>
  {/if}

  {#if streamVolumeMenu}
    <button
      class="stream-volume-dismiss"
      type="button"
      aria-label="Close stream volume menu"
      onclick={closeStreamVolumeMenu}
      oncontextmenu={(event) => {
        event.preventDefault();
        closeStreamVolumeMenu();
      }}
    ></button>

    <section
      class="stream-volume-menu"
      style={`left:${streamVolumeMenu.x}px;top:${streamVolumeMenu.y}px`}
      aria-label={`${streamVolumeMenu.name}'s stream volume`}
    >
      <header>
        <div>
          <strong>{streamVolumeMenu.name}'s stream</strong>
          <small>{streamVolumeMenu.audioAvailable ? 'Stream volume' : 'No shared audio track'}</small>
        </div>
        <span>{streamVolumeMenu.volume}%</span>
      </header>

      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={streamVolumeMenu.volume}
        disabled={!streamVolumeMenu.audioAvailable}
        aria-label="Stream volume"
        oninput={onStreamVolumeInput}
      />

      <button
        type="button"
        onclick={toggleStreamVolumeMute}
        disabled={!streamVolumeMenu.audioAvailable}
      >
        <Icon name={streamVolumeMenu.volume === 0 ? 'volume' : 'volume-off'} size={17} />
        {streamVolumeMenu.volume === 0 ? 'Unmute stream' : 'Mute stream'}
      </button>

      {#if !streamVolumeMenu.audioAvailable}
        <p>The sender's browser/source did not publish screen-share audio.</p>
      {/if}
    </section>
  {/if}

  {#if newGroupOpen}
    <div class="modal-backdrop">
      <section class="group-create-modal" role="dialog" aria-modal="true" aria-labelledby="new-group-title">
        <div class="group-panel-head"><div><small>NEW</small><h2 id="new-group-title">Create group</h2></div><button class="icon-action" type="button" aria-label="Close" title="Close" onclick={() => newGroupOpen = false}><Icon name="x" size={18} /></button></div>
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
