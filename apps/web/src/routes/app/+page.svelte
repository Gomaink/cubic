<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { io, type Socket } from 'socket.io-client';
  import { recoverAfterServerDisconnect } from '$lib/realtime/server-disconnect.js';
  import { Room, RoomEvent, Track } from 'livekit-client';
  import { mediaDeviceErrorMessage, microphoneCaptureOptions, missingSelectedCameraNotice, screenShareFailure } from '$lib/media-ux';
  import Icon from '$lib/ui/Icon.svelte';
  import PrimaryRail from '$lib/ui/PrimaryRail.svelte';
  import UserBar from '$lib/ui/UserBar.svelte';
  import VideoTile from '$lib/ui/VideoTile.svelte';
  import ScreenShareTile from '$lib/ui/ScreenShareTile.svelte';
  import MessageAttachments from '$lib/ui/MessageAttachments.svelte';
  import MessageActions from '$lib/ui/MessageActions.svelte';
  import UserSettings from '$lib/ui/UserSettings.svelte';
  import MemberPanel from '$lib/ui/MemberPanel.svelte';
  import ProfileCard from '$lib/ui/ProfileCard.svelte';
  import ServerInviteCard from '$lib/ui/ServerInviteCard.svelte';
  import { firstTrustedServerInviteToken, ServerInvitePreviewQueue } from '$lib/server-invite-links';

  let { data } = $props();
  let updatedCurrentUser = $state<typeof data.user | null>(null);
  let currentUser = $derived(updatedCurrentUser ?? data.user);
  type ProfileIdentity = { id: string; username: string; displayName: string; avatarUrl: string | null };
  let selectedProfile = $state<ProfileIdentity | null>(null);
  let loggingOut = $state(false);
  let userSettingsOpen = $state(false);
  let tab = $state<'chats' | 'people' | 'servers'>('chats');
  function showMessages() {
    navigationMenu = null;
    if (activeConversation?.kind === 'server_text') closeConversation();
    closeServerDialog();
    serverMembersOpen = false;
    serverMenuOpen = false;
    serverSurface = null;
    channelSettingsTarget = null;
    channelLoadSequence += 1;
    serverDetailSequence += 1;
    tab = 'chats';
    activeServer = null;
  }
  function showPeople() {
    navigationMenu = null;
    closeConversation();
    closeServerDialog();
    serverMembersOpen = false;
    serverMenuOpen = false;
    serverSurface = null;
    channelSettingsTarget = null;
    activeServer = null;
    channelLoadSequence += 1;
    serverDetailSequence += 1;
    tab = 'people';
    void refreshServerInvites();
  }
  function showServerBrowser() {
    navigationMenu = null;
    closeConversation();
    closeServerDialog();
    serverMembersOpen = false;
    serverMenuOpen = false;
    serverSurface = null;
    channelSettingsTarget = null;
    activeServer = null;
    channelLoadSequence += 1;
    serverDetailSequence += 1;
    tab = 'servers';
  }
  let query = $state('');
  let searchResults = $state<any[]>([]);
  let friends = $state<any[]>([]);
  let requests = $state<any[]>([]);
  let groupInvites = $state<any[]>([]);
  let serverInvites = $state<any[]>([]);
  let conversations = $state<any[]>([]);
  let activeConversation = $state<any | null>(null);
  type ServerSummary = { id: string; name: string; iconUrl: string | null; ownerUserId: string; createdAt: string; updatedAt: string };
  type ServerTextChannel = { kind: 'text'; id: string; serverId: string; conversationId: string; categoryId: string | null; position: number; name: string; createdAt: string; updatedAt: string };
  type ServerVoiceChannel = { kind: 'voice'; id: string; serverId: string; categoryId: string | null; position: number; name: string; createdAt: string; updatedAt: string };
  type ServerLayoutChannel = ServerTextChannel | ServerVoiceChannel;
  type ServerCategory = { id: string; serverId: string; name: string; position: number; createdAt: string; updatedAt: string };
  type ShareInviteLink = { id: string; createdAt: string; expiresAt: string; revokedAt: string | null };
  let servers = $state<ServerSummary[]>([]);
  let activeServer = $state<ServerSummary | null>(null);
  let serverChannels = $state<ServerTextChannel[]>([]);
  let serverVoiceChannels = $state<ServerVoiceChannel[]>([]);
  let serverVoicePresence = $state<Record<string, Array<{ userId: string; displayName: string }>>>({});
  let serverCategories = $state<ServerCategory[]>([]);
  let categoryName = $state('');
  let channelCategoryId = $state('');
  let layoutBusy = $state(false);
  let layoutError = $state('');
  let editingCategoryId = $state<string | null>(null);
  let movingChannelId = $state<string | null>(null);
  let movingChannelKind = $state<'text' | 'voice'>('text');
  let voiceChannelName = $state('');
  let editingVoiceChannelId = $state<string | null>(null);
  let moveDestinationId = $state('');
  let activeChannel = $state<ServerTextChannel | null>(null);
  let channelsLoading = $state(false);
  let channelsError = $state('');
  let channelName = $state('');
  let channelCreateBusy = $state(false);
  let channelLoadSequence = 0;
  let serversLoading = $state(true);
  let serversError = $state('');
  let serverName = $state('');
  let serverCreateBusy = $state(false);
  let serverIconFile = $state<File | null>(null);
  let serverIconBusy = $state(false);
  let serverIconError = $state('');
  let serverMembers = $state<ProfileIdentity[]>([]);
  let pendingServerInvites = $state<any[]>([]);
  let shareInviteLinks = $state<ShareInviteLink[]>([]);
  let oneTimeInviteUrl = $state('');
  let shareInviteBusy = $state(false);
  let shareInviteError = $state('');
  let shareInviteNotice = $state('');
  let shareInviteSequence = 0;
  let serverInviteTarget = $state('');
  let serverMembershipBusy = $state(false);
  let serverMembershipError = $state('');
  let serverMembersOpen = $state(false);
  let serverMembersReturnFocus: HTMLElement | null = null;
  let memberRemovalTarget = $state<ProfileIdentity | null>(null);
  type ServerSurface = 'overview' | 'members' | 'invites';
  type ChannelSettingsTarget = { kind: 'text' | 'voice'; id: string };
  let serverMenuOpen = $state(false);
  let serverSurface = $state<ServerSurface | null>(null);
  let channelSettingsTarget = $state<ChannelSettingsTarget | null>(null);
  let channelSettingsName = $state('');
  let channelSettingsCategoryId = $state('');
  let channelSettingsBusy = $state(false);
  let channelSettingsError = $state('');
  let navigationMenu = $state<string | null>(null);
  let navigationPressTimer: ReturnType<typeof setTimeout> | null = null;
  let navigationPressConsumeTimer: ReturnType<typeof setTimeout> | null = null;
  let consumedNavigationPress: string | null = null;
  let serverDialog = $state<'server' | 'channel' | 'voice-channel' | 'rename-voice-channel' | 'invite' | 'category' | 'rename-category' | 'move-channel' | 'remove-member' | 'icon' | null>(null);
  let serverDialogReturnFocus: HTMLElement | null = null;
  let serverDetailSequence = 0;
  let serverInviteSequence = 0;
  let serverListRevision = 0;
  let serverRefreshSequence = 0;
  let chatMessages = $state<any[]>([]);
  let trustedInviteOrigin = $state('');
  const invitePreviewQueue = new ServerInvitePreviewQueue();
  let messageBody = $state('');
  let messageInput = $state<HTMLInputElement | null>(null);
  let busy = $state(false);
  let error = $state('');
  let realtimeConnected = $state(false);
  let realtimeSocket: Socket | null = null;
  let refreshQueued = false;

  let newGroupOpen = $state(false);
  let newGroupTitle = $state('');
  let newGroupMemberIds = $state<string[]>([]);
  let groupPanelOpen = $state(false);
  let memberPanelOpen = $state(false);
  type PresenceStatus = 'online' | 'idle' | 'offline';
  let memberPresence = $state<Record<string, PresenceStatus>>({});
  let pendingPresenceSnapshot: { conversationId: string; changedUserIds: Set<string> } | null = null;
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
  let voiceAttemptSerial = 0;
  let voiceConversationId = $state<string | null>(null);
  let activeServerVoiceId = $state<string | null>(null);
  let activeServerVoiceServerId = $state<string | null>(null);
  let voiceRetryServerChannel = $state<ServerVoiceChannel | null>(null);
  let voiceConversationTitle = $state('');
  let voiceStatus = $state<'idle' | 'connecting' | 'connected' | 'reconnecting'>('idle');
  let voiceParticipants = $state<VoiceParticipantView[]>([]);
  let voiceMuted = $state(false);
  let voiceError = $state('');
  let voiceRetryConversation = $state<any | null>(null);
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

  type ReplyPreview = {
    id: string;
    senderId: string;
    senderUsername: string;
    senderDisplayName: string;
    body: string;
    deletedAt: string | null;
    attachmentKind: 'image' | 'video' | 'file' | null;
  };

  type MessageReaction = {
    reaction: string;
    count: number;
    reactedByCurrentUser: boolean;
  };

  type MessageReactionEvent = {
    conversationId: string;
    messageId: string;
    userId: string;
    reaction: string;
    active: boolean;
    reactions: Array<{ reaction: string; count: number }>;
  };

  const REACTION_LABELS: Record<string, string> = {
    '❤️': 'Heart',
    '👍': 'Thumbs up',
    '😂': 'Laughing',
    '😮': 'Surprised',
    '😢': 'Sad',
    '👎': 'Thumbs down'
  };

  let replyingTo = $state<ReplyPreview | null>(null);
  let editingMessageId = $state<string | null>(null);
  let draftBeforeEdit = '';
  let actionMenuMessageId = $state<string | null>(null);
  let reactionPickerMessageId = $state<string | null>(null);
  let reactionBusyKey = $state<string | null>(null);
  let deleteCandidate = $state<any | null>(null);
  let deleteDialog = $state<HTMLDialogElement | null>(null);
  let highlightedMessageId = $state<string | null>(null);
  let highlightTimer: ReturnType<typeof setTimeout> | null = null;

  let voiceDeafened = $state(false);
  let voiceMutedBeforeDeafen = false;
  let voiceCameraEnabled = $state(false);
  let voiceCameraExpected = false;
  let voiceScreenShareEnabled = $state(false);
  let serverVoiceStageCollapsed = $state(false);

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
  let browserVoiceProcessing = $state(true);
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
    placement: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
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
    return conversation.kind === 'server_text'
      ? conversation.title ?? 'Text channel'
      : conversation.kind === 'group'
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

  async function refreshServerInvites() {
    const sequence = ++serverInviteSequence;
    try {
      const payload = await api('/api/v1/servers/invites');
      if (sequence !== serverInviteSequence) return;
      serverInvites = payload.invites;
    } catch (cause) {
      if (sequence === serverInviteSequence) error = cause instanceof Error ? cause.message : 'Could not load server invitations.';
    }
  }

  async function refreshServerMembership(server: ServerSummary) {
    const sequence = ++serverDetailSequence;
    serverMembershipError = '';
    try {
      const [members, invites] = await Promise.all([
        api(`/api/v1/servers/${server.id}/members`),
        server.ownerUserId === currentUser.id ? api(`/api/v1/servers/${server.id}/invites`) : Promise.resolve({ invites: [] })
      ]);
      if (sequence !== serverDetailSequence || activeServer?.id !== server.id) return;
      serverMembers = members.members;
      pendingServerInvites = invites.invites;
    } catch (cause) {
      if (sequence === serverDetailSequence && activeServer?.id === server.id)
        serverMembershipError = cause instanceof Error ? cause.message : 'Could not load server members.';
    }
  }

  async function refreshConversations() {
    const payload = await api('/api/v1/conversations');
    conversations = payload.conversations;
    if (activeConversation) {
      const refreshed = conversations.find((item: any) => item.id === activeConversation.id);
      if (refreshed) activeConversation = refreshed;
    }
  }

  async function refreshServers() {
    const sequence = ++serverRefreshSequence;
    const revision = serverListRevision;
    serversLoading = true;
    serversError = '';
    try {
      const payload = await api('/api/v1/servers');
      if (sequence !== serverRefreshSequence || revision !== serverListRevision) return;
      servers = payload.servers;
      let pendingServerId: string | null = null;
      try { pendingServerId = sessionStorage.getItem('cubic:open-server'); } catch { /* Storage may be unavailable. */ }
      if (pendingServerId) {
        try { sessionStorage.removeItem('cubic:open-server'); } catch { /* Selection can still continue. */ }
        const pendingServer = servers.find((item) => item.id === pendingServerId);
        if (pendingServer) selectServer(pendingServer);
      }
      if (activeServer) {
        const current = servers.find((server) => server.id === activeServer?.id);
        if (current) activeServer = current;
        else {
          if (activeConversation?.kind === 'server_text') closeConversation();
          closeServerDialog();
          serverMembersOpen = false;
          serverMenuOpen = false;
          serverSurface = null;
          channelSettingsTarget = null;
          navigationMenu = null;
          serverDetailSequence += 1;
          channelLoadSequence += 1;
          serverChannels = [];
          serverVoiceChannels = [];
          serverCategories = [];
          serverMembers = [];
          pendingServerInvites = [];
          shareInviteSequence += 1;
          shareInviteLinks = [];
          oneTimeInviteUrl = '';
          activeChannel = null;
          activeServer = null;
        }
      }
    } catch (cause) {
      if (sequence === serverRefreshSequence && revision === serverListRevision) {
        serversError = cause instanceof Error ? cause.message : 'Could not load servers.';
      }
    } finally {
      if (sequence === serverRefreshSequence) serversLoading = false;
    }
  }

  function selectServer(server: ServerSummary) {
    navigationMenu = null;
    if (activeServer?.id === server.id) {
      closeConversation();
      serverMembersOpen = false;
      serverMenuOpen = false;
      serverSurface = null;
      channelSettingsTarget = null;
      tab = 'servers';
      return;
    }
    closeServerDialog();
    serverMembersOpen = false;
    serverMenuOpen = false;
    serverSurface = null;
    channelSettingsTarget = null;
    closeConversation();
    activeServer = server;
    tab = 'servers';
    serverCategories = [];
    serverVoiceChannels = [];
    serverVoicePresence = {};
    layoutError = '';
    void refreshServerChannels(server);
    subscribeServerVoicePresence(server.id);
    serverMembers = [];
    pendingServerInvites = [];
    shareInviteSequence += 1;
    shareInviteLinks = [];
    oneTimeInviteUrl = '';
    serverInviteTarget = '';
    void refreshServerMembership(server);
  }

  function subscribeServerVoicePresence(serverId: string) {
    const socket = realtimeSocket;
    if (!socket?.connected) return;
    socket.emit('server:voice:subscribe', { serverId }, (result: {
      ok: boolean; presence?: Array<{ channelId: string; occupants: Array<{ userId: string; displayName: string }> }>;
    }) => {
      if (activeServer?.id !== serverId || !result?.ok) return;
      serverVoicePresence = Object.fromEntries((result.presence ?? []).map((item) => [item.channelId, item.occupants]));
    });
  }

  function toggleServerMembers(event: MouseEvent) {
    navigationMenu = null;
    serverMenuOpen = false;
    if (serverMembersOpen) { closeServerMembers(); return; }
    serverMembersReturnFocus = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    serverMembersOpen = true;
  }

  function closeServerMembers() {
    serverMembersOpen = false;
    const previous = serverMembersReturnFocus;
    serverMembersReturnFocus = null;
    void tick().then(() => previous?.isConnected && previous.focus());
  }

  function openServerSurface(view: ServerSurface) {
    const server = activeServer;
    if (!server || (view === 'invites' && server.ownerUserId !== currentUser.id)) return;
    navigationMenu = null;
    serverMenuOpen = false;
    serverMembersOpen = false;
    channelSettingsTarget = null;
    channelSettingsError = '';
    serverSurface = view;
    void refreshServerMembership(server);
    if (view === 'invites') void refreshShareInviteLinks(server);
  }

  function closeServerSurface() {
    serverSurface = null;
    oneTimeInviteUrl = '';
    shareInviteNotice = '';
  }

  function channelSettingsChannel(): ServerLayoutChannel | null {
    const target = channelSettingsTarget;
    if (!target) return null;
    return [...serverChannels, ...serverVoiceChannels].find((channel) => channel.kind === target.kind && channel.id === target.id) ?? null;
  }

  function openChannelSettings(channel: ServerLayoutChannel) {
    if (!activeServer || activeServer.ownerUserId !== currentUser.id) return;
    navigationMenu = null;
    serverMenuOpen = false;
    serverMembersOpen = false;
    serverSurface = null;
    channelSettingsTarget = { kind: channel.kind, id: channel.id };
    channelSettingsName = channel.name;
    channelSettingsCategoryId = channel.categoryId ?? '';
    channelSettingsError = '';
  }

  function closeChannelSettings() {
    channelSettingsTarget = null;
    channelSettingsError = '';
  }

  async function saveVoiceChannelSettings(event: SubmitEvent) {
    event.preventDefault();
    const server = activeServer;
    const channel = channelSettingsChannel();
    const name = channelSettingsName.trim();
    if (!server || !channel || channel.kind !== 'voice' || server.ownerUserId !== currentUser.id || channelSettingsBusy) return;
    if (!name || name.length > 96) { channelSettingsError = 'Enter a voice channel name of 1–96 characters.'; return; }
    if (name === channel.name) return;
    channelSettingsBusy = true;
    channelSettingsError = '';
    try {
      await api(`/api/v1/servers/${server.id}/voice-channels/${channel.id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
      if (activeServer?.id !== server.id) return;
      await refreshServerChannels(server);
      channelSettingsName = name;
    } catch (cause) {
      if (activeServer?.id === server.id) channelSettingsError = cause instanceof Error ? cause.message : 'Could not rename voice channel.';
    } finally { channelSettingsBusy = false; }
  }

  async function saveChannelSettingsCategory(event: SubmitEvent) {
    event.preventDefault();
    const channel = channelSettingsChannel();
    if (!channel || channelSettingsBusy || channelSettingsCategoryId === (channel.categoryId ?? '')) return;
    channelSettingsBusy = true;
    channelSettingsError = '';
    const targetCategoryId = channelSettingsCategoryId || null;
    const targetIndex = channelsInScope(targetCategoryId).filter((item) => item.kind !== channel.kind || item.id !== channel.id).length;
    try {
      const moved = await mutateLayout(`/layout/${channel.kind}/${channel.id}/move`, 'POST', { targetCategoryId, targetIndex });
      if (!moved) channelSettingsError = layoutError || 'Could not move channel.';
    } finally { channelSettingsBusy = false; }
  }

  async function inviteServerFriend(event: SubmitEvent) {
    event.preventDefault();
    const server = activeServer;
    if (!server || server.ownerUserId !== currentUser.id || !serverInviteTarget || serverMembershipBusy) return;
    serverMembershipBusy = true;
    serverMembershipError = '';
    try {
      const payload = await api(`/api/v1/servers/${server.id}/invites`, { method: 'POST', body: JSON.stringify({ userId: serverInviteTarget }) });
      if (activeServer?.id !== server.id) return;
      serverDetailSequence += 1;
      pendingServerInvites = [...pendingServerInvites.filter((invite) => invite.id !== payload.invite.id), payload.invite];
      serverInviteTarget = '';
    } catch (cause) {
      if (activeServer?.id === server.id) serverMembershipError = cause instanceof Error ? cause.message : 'Could not send invitation.';
    } finally { serverMembershipBusy = false; }
  }

  async function cancelServerInvite(inviteId: string) {
    const serverId = activeServer?.id;
    if (serverMembershipBusy) return;
    serverMembershipBusy = true;
    serverMembershipError = '';
    try {
      await api(`/api/v1/servers/invites/${inviteId}`, { method: 'DELETE' });
      if (activeServer?.id !== serverId) return;
      serverDetailSequence += 1;
      pendingServerInvites = pendingServerInvites.filter((invite) => invite.id !== inviteId);
    } catch (cause) {
      const current = activeServer;
      if (current && current.id === serverId) {
        serverMembershipError = cause instanceof Error ? cause.message : 'Invitation changed. Refresh the list.';
        void refreshServerMembership(current);
      }
    } finally { serverMembershipBusy = false; }
  }

  async function refreshShareInviteLinks(server: ServerSummary) {
    const sequence = ++shareInviteSequence;
    shareInviteError = '';
    try {
      const payload = await api(`/api/v1/servers/${server.id}/invite-links`);
      if (sequence !== shareInviteSequence || activeServer?.id !== server.id) return;
      shareInviteLinks = payload.inviteLinks;
    } catch (cause) {
      if (sequence === shareInviteSequence && activeServer?.id === server.id)
        shareInviteError = cause instanceof Error ? cause.message : 'Could not load share links.';
    }
  }

  async function createShareInviteLink() {
    const server = activeServer;
    if (!server || server.ownerUserId !== currentUser.id || shareInviteBusy) return;
    shareInviteBusy = true;
    shareInviteError = '';
    shareInviteNotice = '';
    try {
      const result = await api(`/api/v1/servers/${server.id}/invite-links`, { method: 'POST' });
      if (activeServer?.id !== server.id || (serverDialog !== 'invite' && serverSurface !== 'invites')) return;
      shareInviteSequence += 1;
      shareInviteLinks = [result.inviteLink, ...shareInviteLinks];
      oneTimeInviteUrl = `${window.location.origin}/invite#${result.token}`;
    } catch (cause) {
      if (activeServer?.id === server.id) shareInviteError = cause instanceof Error ? cause.message : 'Could not create share link.';
    } finally { shareInviteBusy = false; }
  }

  async function copyShareInviteLink() {
    if (!oneTimeInviteUrl) return;
    try {
      await navigator.clipboard.writeText(oneTimeInviteUrl);
      shareInviteNotice = 'Link copied.';
    } catch {
      shareInviteNotice = 'Select the link above to copy it manually.';
    }
  }

  async function shareInviteLink() {
    if (!oneTimeInviteUrl || !navigator.share) return;
    try { await navigator.share({ url: oneTimeInviteUrl }); }
    catch { /* User cancelled sharing or the platform declined it. */ }
  }

  async function revokeShareInviteLink(linkId: string) {
    const server = activeServer;
    if (!server || server.ownerUserId !== currentUser.id || shareInviteBusy) return;
    shareInviteBusy = true;
    shareInviteError = '';
    try {
      const result = await api(`/api/v1/servers/${server.id}/invite-links/${linkId}/revoke`, { method: 'POST' });
      if (activeServer?.id !== server.id) return;
      shareInviteSequence += 1;
      shareInviteLinks = shareInviteLinks.map((link) => link.id === linkId ? result.inviteLink : link);
    } catch (cause) {
      if (activeServer?.id === server.id) {
        shareInviteError = cause instanceof Error ? cause.message : 'Could not revoke link.';
        void refreshShareInviteLinks(server);
      }
    } finally { shareInviteBusy = false; }
  }

  async function acceptServerInvite(inviteId: string) {
    if (serverMembershipBusy) return;
    serverMembershipBusy = true;
    error = '';
    try {
      const payload = await api(`/api/v1/servers/invites/${inviteId}/accept`, { method: 'POST' });
      serverInviteSequence += 1;
      serverInvites = serverInvites.filter((invite) => invite.id !== inviteId);
      const server = payload.server as ServerSummary;
      serverListRevision += 1;
      servers = [server, ...servers.filter((item) => item.id !== server.id)];
      selectServer(server);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Invitation changed. Refresh the list.';
      void refreshServerInvites();
    } finally { serverMembershipBusy = false; }
  }

  async function leaveSelectedServer() {
    const server = activeServer;
    if (!server || server.ownerUserId === currentUser.id || serverMembershipBusy) return;
    serverMembershipBusy = true;
    serverMembershipError = '';
    try {
      await api(`/api/v1/servers/${server.id}/leave`, { method: 'POST' });
      serverListRevision += 1;
      servers = servers.filter((item) => item.id !== server.id);
      if (activeServer?.id !== server.id) return;
      closeConversation();
      serverDetailSequence += 1;
      channelLoadSequence += 1;
      closeServerDialog();
      serverMembersOpen = false;
      serverMenuOpen = false;
      serverSurface = null;
      channelSettingsTarget = null;
      navigationMenu = null;
      serverChannels = [];
      serverVoiceChannels = [];
      serverCategories = [];
      serverMembers = [];
      pendingServerInvites = [];
      activeServer = null;
      activeChannel = null;
      tab = 'chats';
    } catch (cause) {
      if (activeServer?.id === server.id) serverMembershipError = cause instanceof Error ? cause.message : 'Could not leave server.';
    } finally { serverMembershipBusy = false; }
  }

  function confirmMemberRemoval(member: ProfileIdentity, event: MouseEvent) {
    if (!activeServer || activeServer.ownerUserId !== currentUser.id || member.id === currentUser.id) return;
    memberRemovalTarget = member;
    serverMembershipError = '';
    openServerDialog('remove-member', event);
  }

  async function removeSelectedServerMember() {
    const server = activeServer;
    const target = memberRemovalTarget;
    if (!server || !target || serverDialog !== 'remove-member' || server.ownerUserId !== currentUser.id ||
        target.id === currentUser.id || serverMembershipBusy) return;
    serverMembershipBusy = true;
    serverMembershipError = '';
    try {
      await api(`/api/v1/servers/${server.id}/members/${target.id}`, { method: 'DELETE' });
      if (activeServer?.id !== server.id || memberRemovalTarget?.id !== target.id) return;
      serverDetailSequence += 1;
      serverMembers = serverMembers.filter((member) => member.id !== target.id);
      if (selectedProfile?.id === target.id) selectedProfile = null;
      closeServerDialog();
      await tick();
      document.querySelector<HTMLButtonElement>('.cubic-server-member-refresh')?.focus();
      void refreshServerMembership(server);
    } catch (cause) {
      if (activeServer?.id === server.id && memberRemovalTarget?.id === target.id)
        serverMembershipError = cause instanceof Error ? cause.message : 'Could not remove server member.';
    } finally { serverMembershipBusy = false; }
  }

  async function refreshServerChannels(server: ServerSummary) {
    const sequence = ++channelLoadSequence;
    channelsLoading = true;
    channelsError = '';
    serverChannels = [];
    serverVoiceChannels = [];
    serverCategories = [];
    try {
      const [payload, categoryPayload, voicePayload] = await Promise.all([
        api(`/api/v1/servers/${server.id}/channels`),
        api(`/api/v1/servers/${server.id}/categories`),
        api(`/api/v1/servers/${server.id}/voice-channels`)
      ]);
      if (sequence !== channelLoadSequence || activeServer?.id !== server.id) return;
      serverChannels = payload.channels.map((item: Omit<ServerTextChannel, 'kind'>) => ({ ...item, kind: 'text' as const }));
      serverVoiceChannels = voicePayload.channels.map((item: Omit<ServerVoiceChannel, 'kind'>) => ({ ...item, kind: 'voice' as const }));
      serverCategories = categoryPayload.categories;
    } catch (cause) {
      if (sequence === channelLoadSequence && activeServer?.id === server.id) {
        channelsError = cause instanceof Error ? cause.message : 'Could not load channels.';
      }
    } finally {
      if (sequence === channelLoadSequence) channelsLoading = false;
    }
  }

  async function createChannel(event: SubmitEvent) {
    event.preventDefault();
    const server = activeServer;
    if (!server || channelCreateBusy || channelsLoading) return;
    const name = channelName.trim();
    if (!name || name.length > 96) {
      channelsError = 'Enter a channel name of 1–96 characters.';
      return;
    }
    channelCreateBusy = true;
    channelsError = '';
    try {
      const payload = await api(`/api/v1/servers/${server.id}/channels`, {
        method: 'POST', body: JSON.stringify({ name, categoryId: channelCategoryId || null })
      });
      if (activeServer?.id !== server.id) return;
      const channel = { ...payload.channel, kind: 'text' as const } as ServerTextChannel;
      channelLoadSequence += 1;
      channelsLoading = false;
      serverChannels = [...serverChannels.filter((item) => item.id !== channel.id), channel]
        .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      channelName = '';
      channelCategoryId = '';
      closeServerDialog();
      await selectChannel(channel);
    } catch (cause) {
      if (activeServer?.id === server.id) channelsError = cause instanceof Error ? cause.message : 'Could not create channel.';
    } finally {
      channelCreateBusy = false;
    }
  }

  async function saveVoiceChannel(event: SubmitEvent) {
    event.preventDefault();
    const server = activeServer;
    if (!server || server.ownerUserId !== currentUser.id || channelCreateBusy) return;
    const name = voiceChannelName.trim();
    if (!name || name.length > 96) { channelsError = 'Enter a voice channel name of 1–96 characters.'; return; }
    channelCreateBusy = true;
    channelsError = '';
    try {
      const id = editingVoiceChannelId;
      await api(`/api/v1/servers/${server.id}/voice-channels${id ? `/${id}` : ''}`, {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(id ? { name } : { name, categoryId: channelCategoryId || null })
      });
      if (activeServer?.id !== server.id) return;
      voiceChannelName = '';
      editingVoiceChannelId = null;
      closeServerDialog();
      await refreshServerChannels(server);
    } catch (cause) {
      if (activeServer?.id === server.id) channelsError = cause instanceof Error ? cause.message : 'Could not save voice channel.';
    } finally { channelCreateBusy = false; }
  }

  function channelsInScope(categoryId: string | null): ServerLayoutChannel[] {
    return [...serverChannels, ...serverVoiceChannels].filter((channel) => channel.categoryId === categoryId)
      .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind));
  }

  function toggleNavigationMenu(key: string) {
    serverMenuOpen = false;
    navigationMenu = navigationMenu === key ? null : key;
  }

  function openNavigationContext(event: MouseEvent, key: string) {
    event.preventDefault();
    serverMenuOpen = false;
    navigationMenu = key;
  }

  function startNavigationPress(key: string) {
    endNavigationPress();
    consumedNavigationPress = null;
    navigationPressTimer = setTimeout(() => {
      if (navigationPressConsumeTimer) clearTimeout(navigationPressConsumeTimer);
      consumedNavigationPress = key;
      serverMenuOpen = false;
      navigationMenu = key;
      navigationPressTimer = null;
      navigationPressConsumeTimer = setTimeout(() => {
        if (consumedNavigationPress === key) consumedNavigationPress = null;
        navigationPressConsumeTimer = null;
      }, 1000);
    }, 550);
  }

  function endNavigationPress() {
    if (navigationPressTimer) clearTimeout(navigationPressTimer);
    navigationPressTimer = null;
  }

  function navigationPressWasConsumed(key: string) {
    if (consumedNavigationPress !== key) return false;
    if (navigationPressConsumeTimer) clearTimeout(navigationPressConsumeTimer);
    navigationPressConsumeTimer = null;
    consumedNavigationPress = null;
    return true;
  }

  async function mutateLayout(path: string, method: string, body?: object) {
    const server = activeServer;
    if (!server || layoutBusy || channelsLoading) return false;
    layoutBusy = true;
    layoutError = '';
    try {
      await api(`/api/v1/servers/${server.id}${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (activeServer?.id !== server.id) return false;
      await refreshServerChannels(server);
      return true;
    } catch (cause) {
      if (activeServer?.id === server.id) layoutError = cause instanceof Error ? cause.message : 'Could not update channel layout.';
      return false;
    } finally { layoutBusy = false; }
  }

  async function saveCategory(event: SubmitEvent) {
    event.preventDefault();
    const name = categoryName.trim();
    if (!name || name.length > 96) { layoutError = 'Enter a category name of 1–96 characters.'; return; }
    const categoryId = editingCategoryId;
    const saved = await mutateLayout(categoryId ? `/categories/${categoryId}` : '/categories', categoryId ? 'PATCH' : 'POST', { name });
    if (saved) { categoryName = ''; editingCategoryId = null; closeServerDialog(); }
  }

  async function deleteSelectedCategory(categoryId: string) {
    const category = serverCategories.find((item) => item.id === categoryId);
    if (!category || !confirm(`Delete ${category.name}? Its channels will move to Uncategorized and their messages will remain.`)) return;
    await mutateLayout(`/categories/${categoryId}`, 'DELETE');
  }

  async function shiftCategory(categoryId: string, offset: number) {
    const index = serverCategories.findIndex((item) => item.id === categoryId);
    if (index < 0) return;
    await mutateLayout(`/categories/${categoryId}/move`, 'POST', { targetIndex: index + offset });
  }

  async function shiftChannel(channel: ServerLayoutChannel, offset: number) {
    const scope = channelsInScope(channel.categoryId);
    const index = scope.findIndex((item) => item.kind === channel.kind && item.id === channel.id);
    if (index < 0) return;
    await mutateLayout(`/layout/${channel.kind}/${channel.id}/move`, 'POST', { targetCategoryId: channel.categoryId, targetIndex: index + offset });
  }

  async function moveSelectedChannel(event: SubmitEvent) {
    event.preventDefault();
    const channel = [...serverChannels, ...serverVoiceChannels].find((item) => item.id === movingChannelId && item.kind === movingChannelKind);
    if (!channel) return;
    const targetCategoryId = moveDestinationId || null;
    const targetIndex = channelsInScope(targetCategoryId)
      .filter((item) => item.kind !== channel.kind || item.id !== channel.id).length;
    if (await mutateLayout(`/layout/${channel.kind}/${channel.id}/move`, 'POST', { targetCategoryId, targetIndex })) {
      movingChannelId = null;
      closeServerDialog();
    }
  }

  async function selectChannel(channel: ServerTextChannel) {
    if (activeServer?.id !== channel.serverId) return;
    navigationMenu = null;
    serverMembersOpen = false;
    serverMenuOpen = false;
    serverSurface = null;
    channelSettingsTarget = null;
    activeChannel = channel;
    await selectConversation({ id: channel.conversationId, kind: 'server_text', title: channel.name }, true);
  }

  async function createServer(event: SubmitEvent) {
    event.preventDefault();
    if (serverCreateBusy) return;
    const name = serverName.trim();
    if (!name || name.length > 96) {
      serversError = 'Enter a server name of 1–96 characters.';
      return;
    }
    serverCreateBusy = true;
    serversError = '';
    try {
      const payload = await api('/api/v1/servers', { method: 'POST', body: JSON.stringify({ name }) });
      const server = payload.server as ServerSummary;
      serverListRevision += 1;
      servers = [server, ...servers.filter((item) => item.id !== server.id)];
      serverName = '';
      closeServerDialog();
      selectServer(server);
    } catch (cause) {
      serversError = cause instanceof Error ? cause.message : 'Could not create server.';
    } finally {
      serverCreateBusy = false;
    }
  }

  function applyServerIdentity(server: ServerSummary) {
    serverListRevision += 1;
    servers = servers.map((item) => item.id === server.id ? server : item);
    if (activeServer?.id === server.id) activeServer = server;
  }

  async function uploadServerIcon(event: SubmitEvent) {
    event.preventDefault();
    const server = activeServer;
    const file = serverIconFile;
    if (!server || !file || serverIconBusy || server.ownerUserId !== currentUser.id) return;
    if (file.size > 5 * 1024 * 1024) { serverIconError = 'Choose an image up to 5 MiB.'; return; }
    serverIconBusy = true;
    serverIconError = '';
    const body = new FormData();
    body.append('icon', file);
    try {
      const payload = await api(`/api/v1/servers/${server.id}/icon`, { method: 'PUT', body });
      applyServerIdentity(payload.server as ServerSummary);
      if (activeServer?.id === server.id && serverDialog === 'icon') closeServerDialog();
    } catch (cause) {
      if (activeServer?.id === server.id && serverDialog === 'icon') serverIconError = cause instanceof Error ? cause.message : 'Could not upload server icon.';
    } finally { serverIconBusy = false; }
  }

  async function removeSelectedServerIcon() {
    const server = activeServer;
    if (!server || serverIconBusy || server.ownerUserId !== currentUser.id) return;
    serverIconBusy = true;
    serverIconError = '';
    try {
      const payload = await api(`/api/v1/servers/${server.id}/icon`, { method: 'DELETE' });
      applyServerIdentity(payload.server as ServerSummary);
      if (activeServer?.id === server.id && serverDialog === 'icon') closeServerDialog();
    } catch (cause) {
      if (activeServer?.id === server.id && serverDialog === 'icon') serverIconError = cause instanceof Error ? cause.message : 'Could not remove server icon.';
    } finally { serverIconBusy = false; }
  }

  function openServerDialog(kind: NonNullable<typeof serverDialog>, trigger: Event) {
    navigationMenu = null;
    const target = trigger.currentTarget instanceof HTMLElement ? trigger.currentTarget : null;
    const menu = target?.closest('.cubic-navigation-actions');
    serverDialogReturnFocus = menu?.previousElementSibling?.querySelector<HTMLElement>('button[aria-expanded]') ?? target;
    serverMenuOpen = false;
    serverDialog = kind;
    if (kind === 'icon') { serverIconFile = null; serverIconError = ''; }
    if (kind === 'invite' && activeServer) void refreshShareInviteLinks(activeServer);
  }

  function closeServerDialog() {
    if (!serverDialog) return;
    serverDialog = null;
    oneTimeInviteUrl = '';
    shareInviteNotice = '';
    memberRemovalTarget = null;
    serverIconFile = null;
    serverIconError = '';
    const previous = serverDialogReturnFocus;
    serverDialogReturnFocus = null;
    void tick().then(() => previous?.isConnected && previous.focus());
  }

  function showServerDialog(node: HTMLDialogElement) {
    node.showModal();
    node.querySelector<HTMLInputElement | HTMLSelectElement>('input, select')?.focus();
    return { destroy: () => { if (node.open) node.close(); } };
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

  function memberPanelMembers() {
    if (activeConversation?.kind === 'group') return groupDetails?.members ?? [];
    return activeConversation?.peer ? [activeConversation.peer] : [];
  }

  function openProfile(user: ProfileIdentity) {
    if (user.id === currentUser.id) {
      userSettingsOpen = true;
      return;
    }
    selectedProfile = { id: user.id, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl };
  }

  function hideFailedUserAvatar(event: Event) {
    if (event.currentTarget instanceof HTMLImageElement) event.currentTarget.hidden = true;
  }

  function applyProfileChanged(profile: { userId: string; displayName: string; avatarUrl: string | null }) {
    const update = (user: any) => user?.id === profile.userId
      ? { ...user, displayName: profile.displayName, avatarUrl: profile.avatarUrl }
      : user;
    updatedCurrentUser = update(currentUser);
    selectedProfile = update(selectedProfile);
    friends = friends.map(update);
    serverMembers = serverMembers.map(update);
    pendingServerInvites = pendingServerInvites.map((invite) => ({ ...invite, invitee: update(invite.invitee), inviter: update(invite.inviter) }));
    serverInvites = serverInvites.map((invite) => ({ ...invite, invitee: update(invite.invitee), inviter: update(invite.inviter) }));
    searchResults = searchResults.map(update);
    requests = requests.map((request) => ({ ...request, user: update(request.user) }));
    conversations = conversations.map((conversation) => ({ ...conversation, peer: update(conversation.peer) }));
    if (activeConversation) activeConversation = { ...activeConversation, peer: update(activeConversation.peer) };
    if (groupDetails?.members) groupDetails = { ...groupDetails, members: groupDetails.members.map(update) };
    chatMessages = chatMessages.map((message) => message.senderId === profile.userId
      ? { ...message, senderDisplayName: profile.displayName, senderAvatarUrl: profile.avatarUrl }
      : message);
  }

  async function saveOwnProfile(displayName: string) {
    const result = await api('/api/v1/users/me/profile', { method: 'PATCH', body: JSON.stringify({ displayName }) });
    applyProfileChanged({ userId: currentUser.id, displayName: result.displayName, avatarUrl: currentUser.avatarUrl });
  }

  async function uploadOwnAvatar(file: File) {
    const body = new FormData();
    body.append('avatar', file, file.name);
    const result = await api('/api/v1/users/me/avatar', { method: 'POST', body });
    applyProfileChanged(result.profile);
  }

  async function removeOwnAvatar() {
    const result = await api('/api/v1/users/me/avatar', { method: 'DELETE' });
    applyProfileChanged(result.profile);
  }

  function closeUserSettings() {
    userSettingsOpen = false;
    void tick().then(() => {
      const mobileTrigger = document.querySelector<HTMLButtonElement>('.cubic-mobile-user-settings-trigger');
      const target = mobileTrigger && getComputedStyle(mobileTrigger).display !== 'none'
        ? mobileTrigger : document.querySelector<HTMLButtonElement>('.cubic-user-menu-trigger');
      target?.focus();
    });
  }

  function requestPresenceSnapshot(socket: Socket) {
    const conversationId = activeConversation?.id;
    if (!conversationId || !socket.connected) return;
    const pending = { conversationId, changedUserIds: new Set<string>() };
    pendingPresenceSnapshot = pending;
    socket.timeout(4000).emit('presence:snapshot', { conversationId }, (
      failure: Error | null,
      result?: { ok: boolean; statuses?: Record<string, PresenceStatus> }
    ) => {
      if (pendingPresenceSnapshot !== pending) return;
      pendingPresenceSnapshot = null;
      if (!failure && result?.ok && activeConversation?.id === conversationId && realtimeSocket === socket) {
        const currentStatuses = Object.fromEntries(
          Object.entries(result.statuses ?? {}).filter(([userId]) => !pending.changedUserIds.has(userId))
        );
        memberPresence = { ...memberPresence, ...currentStatuses };
      }
    });
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
    if (message.senderId === currentUser.id) return currentUser.displayName;
    return message.senderDisplayName ?? message.senderUsername ?? 'Member';
  }

  function messageSenderInitial(message: any): string {
    return messageSenderName(message).slice(0, 1).toUpperCase() || '?';
  }

  function isMessageContinuation(index: number): boolean {
    if (index <= 0) return false;
    const current = chatMessages[index];
    const previous = chatMessages[index - 1];
    if (current?.replyTo) return false;
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

  function applyChangedMessage(message: any) {
    const existing = chatMessages.find((item: any) => item.id === message.id);
    const selected = new Map(
      reactionsOf(existing).map((reaction) => [reaction.reaction, reaction.reactedByCurrentUser])
    );
    const changed = {
      ...message,
      reactions: reactionsOf(message).map((reaction) => ({
        ...reaction,
        reactedByCurrentUser: selected.get(reaction.reaction) ?? reaction.reactedByCurrentUser
      }))
    };
    upsertMessage(changed);
    const parentPreview = replyPreviewFromMessage(changed);
    chatMessages = chatMessages.map((item: any) =>
      item.id !== changed.id && item.replyTo?.id === changed.id
        ? { ...item, replyTo: parentPreview }
        : item
    );
    if (replyingTo?.id === changed.id) replyingTo = parentPreview;
  }

  function applyReactionEvent(event: MessageReactionEvent) {
    const index = chatMessages.findIndex((message: any) => message.id === event.messageId);
    if (index < 0) return;
    const current = chatMessages[index];
    const selected = new Map(
      reactionsOf(current).map((reaction) => [reaction.reaction, reaction.reactedByCurrentUser])
    );
    current.reactions = event.reactions.map((reaction) => ({
      ...reaction,
      reactedByCurrentUser: event.userId === data.user.id && reaction.reaction === event.reaction
        ? event.active
        : selected.get(reaction.reaction) ?? false
    }));
    chatMessages = [...chatMessages];
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

  async function selectConversation(conversation: any, preserveServer = false) {
    deleteDialog?.close();
    if (!preserveServer) {
      activeServer = null;
      activeChannel = null;
      channelLoadSequence += 1;
      tab = 'chats';
      serverMembersOpen = false;
      serverMenuOpen = false;
      closeServerDialog();
    }
    activeConversation = conversation;
    pendingPresenceSnapshot = null;
    groupPanelOpen = false;
    memberPanelOpen = false;
    groupDetails = null;
    chatMessages = [];
    historyCursor = null;
    historyHasMore = false;
    historyLoading = false;
    unreadNewMessages = 0;
    atLatest = true;
    replyingTo = null;
    editingMessageId = null;
    actionMenuMessageId = null;
    reactionPickerMessageId = null;
    reactionBusyKey = null;
    deleteCandidate = null;

    await loadLatestHistory(conversation.id);
    if (conversation.kind === 'group') await refreshGroupDetails();

    realtimeSocket?.timeout(4000).emit('conversation:join', { conversationId: conversation.id }, () => {});
    if (realtimeSocket && conversation.kind !== 'server_text') requestPresenceSnapshot(realtimeSocket);
  }

  function closeConversation() {
    serverMembersOpen = false;
    activeConversation = null;
    activeChannel = null;
    pendingPresenceSnapshot = null;
    chatMessages = [];
    groupDetails = null;
    groupPanelOpen = false;
    memberPanelOpen = false;
    historyCursor = null;
    historyHasMore = false;
    historyLoading = false;
    unreadNewMessages = 0;
    atLatest = true;
    messagesViewport = null;
    replyingTo = null;
    editingMessageId = null;
    actionMenuMessageId = null;
    reactionPickerMessageId = null;
    reactionBusyKey = null;
    deleteCandidate = null;
  }

  function messageInviteToken(message: any, conversationKind: string | undefined, origin: string): string | null {
    if (!origin || message.deletedAt || (conversationKind !== 'direct' && conversationKind !== 'group')) return null;
    return firstTrustedServerInviteToken(message.body, origin);
  }

  async function openServerFromInvite(serverId: string, conversationId: string) {
    if (activeConversation?.id !== conversationId) return;
    try {
      const payload = await api(`/api/v1/servers/${serverId}`);
      if (activeConversation?.id !== conversationId) return;
      const server = payload.server as ServerSummary;
      serverListRevision += 1;
      servers = [server, ...servers.filter((item) => item.id !== server.id)];
      selectServer(server);
    } catch {
      if (activeConversation?.id === conversationId) error = 'Could not open this server. You may no longer be a member.';
    }
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

  function reactionsOf(message: any): MessageReaction[] {
    return Array.isArray(message?.reactions) ? message.reactions : [];
  }

  function replyPreviewFromMessage(message: any): ReplyPreview {
    const firstAttachment = attachmentsOf(message)[0];
    const attachmentKind = firstAttachment?.contentType?.startsWith('image/')
      ? 'image'
      : firstAttachment?.contentType?.startsWith('video/')
        ? 'video'
        : firstAttachment
          ? 'file'
          : null;
    return {
      id: message.id,
      senderId: message.senderId,
      senderUsername: message.senderUsername ?? '',
      senderDisplayName: messageSenderName(message),
      body: message.deletedAt ? '' : message.body.slice(0, 160),
      deletedAt: message.deletedAt ?? null,
      attachmentKind: message.deletedAt ? null : attachmentKind
    };
  }

  function replyPreviewLabel(preview: ReplyPreview): string {
    if (preview.deletedAt) return 'Message deleted';
    if (preview.body?.trim()) return preview.body.trim();
    if (preview.attachmentKind === 'image') return 'Photo';
    if (preview.attachmentKind === 'video') return 'Video';
    if (preview.attachmentKind === 'file') return 'File';
    return 'Message';
  }

  async function startReply(message: any) {
    replyingTo = replyPreviewFromMessage(message);
    editingMessageId = null;
    actionMenuMessageId = null;
    reactionPickerMessageId = null;
    await tick();
    messageInput?.focus();
  }

  async function startEdit(message: any) {
    draftBeforeEdit = messageBody;
    editingMessageId = message.id;
    replyingTo = null;
    actionMenuMessageId = null;
    reactionPickerMessageId = null;
    messageBody = message.body;
    await tick();
    messageInput?.focus();
    messageInput?.setSelectionRange(messageBody.length, messageBody.length);
  }

  async function cancelEdit() {
    editingMessageId = null;
    messageBody = draftBeforeEdit;
    draftBeforeEdit = '';
    await tick();
    messageInput?.focus();
  }

  function scrollToReplyTarget(messageId: string) {
    const target = document.getElementById(`message-${messageId}`);
    if (!target) {
      error = 'The replied-to message is not currently loaded.';
      return;
    }
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    highlightedMessageId = messageId;
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
      highlightedMessageId = null;
      highlightTimer = null;
    }, 1600);
  }

  async function requestDelete(message: any) {
    deleteCandidate = message;
    actionMenuMessageId = null;
    reactionPickerMessageId = null;
    await tick();
    deleteDialog?.showModal();
    deleteDialog?.querySelector<HTMLButtonElement>('.cubic-message-delete-cancel')?.focus();
  }

  function closeDeleteDialog() {
    const messageId = deleteCandidate?.id;
    deleteDialog?.close();
    void tick().then(() => {
      const article = messageId ? document.getElementById(`message-${messageId}`) : null;
      const controls = article?.querySelectorAll<HTMLButtonElement>(
        '[aria-label="Delete message"], [aria-label="Message actions"]'
      );
      const visible = controls
        ? Array.from(controls).find((control) => control.offsetParent !== null)
        : null;
      (visible ?? messageInput)?.focus();
    });
  }

  async function toggleReaction(message: any, reaction: string) {
    const conversationId = activeConversation?.id;
    const busyKey = `${message.id}:${reaction}`;
    if (!conversationId || message.deletedAt || reactionBusyKey) return;

    const selected = reactionsOf(message).some(
      (item) => item.reaction === reaction && item.reactedByCurrentUser
    );
    reactionBusyKey = busyKey;
    actionMenuMessageId = null;
    reactionPickerMessageId = null;
    error = '';

    try {
      const result = await api(
        `/api/v1/conversations/${conversationId}/messages/${message.id}/reactions`,
        { method: selected ? 'DELETE' : 'PUT', body: JSON.stringify({ reaction }) }
      );
      if (activeConversation?.id !== conversationId || !Array.isArray(result?.reactions)) return;
      const index = chatMessages.findIndex((item: any) => item.id === message.id);
      if (index < 0) return;
      chatMessages[index] = { ...chatMessages[index], reactions: result.reactions };
      chatMessages = [...chatMessages];
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not update reaction.';
    } finally {
      if (reactionBusyKey === busyKey) reactionBusyKey = null;
    }
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

  function currentEditingMessage(): any | null {
    return editingMessageId
      ? chatMessages.find((item: any) => item.id === editingMessageId) ?? null
      : null;
  }

  function composerSubmitDisabled(): boolean {
    if (busy) return true;
    const editing = currentEditingMessage();
    if (editing) return !messageBody.trim() && attachmentsOf(editing).length === 0;
    return stagedUploadPending() || (!messageBody.trim() && stagedReadyIds().length === 0);
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
    const replyToMessageId = replyingTo?.id ?? null;
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
            attachmentIds,
            replyToMessageId
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
        replyingTo = null;
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

  async function saveEditedMessage() {
    const conversationId = activeConversation?.id;
    const message = chatMessages.find((item: any) => item.id === editingMessageId);
    const body = messageBody.trim();
    if (!conversationId || !message || busy || (!body && attachmentsOf(message).length === 0)) return;

    busy = true;
    error = '';
    try {
      const result = await api(
        `/api/v1/conversations/${conversationId}/messages/${message.id}`,
        { method: 'PATCH', body: JSON.stringify({ body }) }
      );
      if (activeConversation?.id === conversationId && result?.message) {
        applyChangedMessage(result.message);
      }
      editingMessageId = null;
      messageBody = draftBeforeEdit;
      draftBeforeEdit = '';
      await tick();
      messageInput?.focus();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not edit message.';
    } finally {
      busy = false;
    }
  }

  function submitComposer() {
    if (editingMessageId) {
      void saveEditedMessage();
    } else {
      void sendMessage();
    }
  }

  async function confirmDeleteMessage() {
    const conversationId = activeConversation?.id;
    const message = deleteCandidate;
    if (!conversationId || !message || busy) return;

    busy = true;
    error = '';
    try {
      const result = await api(
        `/api/v1/conversations/${conversationId}/messages/${message.id}`,
        { method: 'DELETE' }
      );
      if (activeConversation?.id === conversationId && result?.message) {
        applyChangedMessage(result.message);
      }
      closeDeleteDialog();
      await refreshConversations();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not delete message.';
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
    browserVoiceProcessing = localStorage.getItem('cubic.browserVoiceProcessing') !== 'false';

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

  function setBrowserVoiceProcessing(enabled: boolean) {
    browserVoiceProcessing = enabled;
    saveMediaPreference('cubic.browserVoiceProcessing', String(enabled));
    mediaSettingsNotice = 'This choice applies the next time your microphone starts or you rejoin.';
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

    const vertical = event.clientY < window.innerHeight / 2 ? 'top' : 'bottom';
    const horizontal = event.clientX < window.innerWidth / 2 ? 'left' : 'right';

    streamVolumeMenu = {
      identity: participant.identity,
      name: participant.name,
      placement: `${vertical}-${horizontal}`,
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
        voiceCameraExpected = true;

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
      if (kind === 'camera') {
        voiceError = mediaDeviceErrorMessage(error, 'camera');
      } else {
        const failure = screenShareFailure(error);
        if (failure.cancelled) voiceMediaNotice = failure.message;
        else voiceError = failure.message;
      }
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
        voiceMediaNotice = 'The selected microphone disconnected. Choose another in Voice & Video settings; the browser default will be tried next time the microphone starts.';
      }
      if (selectedVideoInput && !videoInputDevices.some((device) => device.deviceId === selectedVideoInput)) {
        const cameraWasActive = voiceCameraExpected || voiceCameraEnabled || Boolean(
          room?.localParticipant.getTrackPublication(Track.Source.Camera)?.track
        );
        selectedVideoInput = '';
        saveMediaPreference('cubic.videoInput', '');
        const cameraNotice = missingSelectedCameraNotice(cameraWasActive);
        if (cameraNotice) voiceMediaNotice = cameraNotice;
      }
      if (
        selectedAudioOutput &&
        audioOutputSupported &&
        !audioOutputDevices.some((device) => device.deviceId === selectedAudioOutput)
      ) {
        selectedAudioOutput = '';
        saveMediaPreference('cubic.audioOutput', '');
        voiceMediaNotice = 'The selected output device disconnected. Audio will use the browser default.';
      }
    } catch (error) {
      mediaSettingsNotice = 'Could not list media devices. Check browser permissions and try again.';
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
      mediaSettingsNotice = kind === 'audiooutput'
        ? 'Could not switch audio output. The browser default remains available.'
        : mediaDeviceErrorMessage(error, kind === 'videoinput' ? 'camera' : 'microphone');
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
    if (!activeServerVoiceId && (!activeConversation || voiceConversationId !== activeConversation.id)) return false;
    return voiceParticipants.some((participant) => participant.cameraEnabled) ||
      activeScreenShares().length > 0;
  }



  function screenShareSupported(): boolean {
    return typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices);
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
    if (activeServerVoiceId && activeShares.length === 0 && !nextParticipants.some((participant) => participant.cameraEnabled)) {
      serverVoiceStageCollapsed = false;
    }
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

  async function enableVoiceAudio() {
    const room = voiceRoom;
    if (!room) return;
    try {
      await room.startAudio();
      if (voiceRoom === room) voiceMediaNotice = '';
    } catch {
      if (voiceRoom === room) voiceMediaNotice = 'Browser audio playback is still paused. Check browser sound permissions.';
    }
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
    voiceAttemptSerial += 1;
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
    activeServerVoiceId = null;
    activeServerVoiceServerId = null;
    voiceRetryServerChannel = null;
    voiceConversationTitle = '';
    voiceStatus = 'idle';
    voiceRetryConversation = null;
    voiceParticipants = [];
    voiceMuted = false;
    voiceDeafened = false;
    voiceMutedBeforeDeafen = false;
    voiceCameraEnabled = false;
    voiceCameraExpected = false;
    voiceScreenShareEnabled = false;
    serverVoiceStageCollapsed = false;
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

    const attempt = ++voiceAttemptSerial;
    activeServerVoiceId = null;
    activeServerVoiceServerId = null;
    voiceRetryServerChannel = null;
    voiceStatus = 'connecting';
    voiceRetryConversation = null;
    voiceConversationId = conversation.id;
    voiceConversationTitle = conversationName(conversation);

    try {
      const ticket = await api(`/api/v1/voice/conversations/${conversation.id}/token`, { method: 'POST' });
      if (attempt !== voiceAttemptSerial) return;
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
      room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (voiceRoom !== room) return;
        if (!room.canPlaybackAudio) voiceMediaNotice = 'Browser audio playback is paused. Enable audio to hear this call.';
        else if (voiceMediaNotice.startsWith('Browser audio playback is paused')) voiceMediaNotice = '';
      });
      room.on(RoomEvent.MediaDevicesError, () => {
        if (voiceRoom === room) {
          voiceError = 'A media device became unavailable. Check its connection and choose another in Voice & Video settings.';
          syncVoiceParticipants();
        }
      });
      room.on(RoomEvent.Disconnected, () => {
        if (voiceRoom === room) {
          const disconnectedConversationId = voiceConversationId;
          voiceRetryConversation = conversation;
          voiceError = 'Voice connection ended. Check your network and try again.';
          voiceRoom = null;
          voiceConversationId = null;
          voiceConversationTitle = '';
          voiceStatus = 'idle';
          voiceParticipants = [];
          voiceMuted = false;
          voiceDeafened = false;
          voiceMutedBeforeDeafen = false;
          voiceCameraEnabled = false;
          voiceCameraExpected = false;
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
      if (voiceRoom !== room || attempt !== voiceAttemptSerial) {
        await room.disconnect();
        return;
      }

      await room.startAudio().catch(() => {
        if (voiceRoom === room) voiceMediaNotice = 'Browser audio playback is paused. Enable audio to hear this call.';
      });

      let microphoneWarning = '';
      try {
        await room.localParticipant.setMicrophoneEnabled(
          true,
          microphoneCaptureOptions(browserVoiceProcessing, selectedAudioInput)
        );
      } catch (microphoneError) {
        microphoneWarning =
          `Joined muted — ${mediaDeviceErrorMessage(microphoneError, 'microphone')}`;
      }

      if (voiceRoom !== room) return;

      voiceStatus = 'connected';
      voiceRetryConversation = null;
      syncVoiceParticipants();

      if (selectedAudioOutput && audioOutputSupported) {
        room.switchActiveDevice('audiooutput', selectedAudioOutput).catch(() => {
          if (voiceRoom === room) voiceMediaNotice = 'Could not use the saved audio output. Check Voice & Video settings.';
        });
      }

      if (microphoneWarning) {
        voiceError = microphoneWarning;
      }
      if (directCall?.state === 'accepted' && directCall.conversationId === conversation.id) {
        callUiState = 'in-call';
      }
    } catch (e) {
      if (attempt !== voiceAttemptSerial) return;
      const failedRoom = voiceRoom;
      voiceRoom = null;
      voiceConversationId = null;
      voiceConversationTitle = '';
      voiceStatus = 'idle';
      voiceRetryConversation = conversation;
      voiceParticipants = [];
      clearVoiceAudio();
      if (failedRoom) await failedRoom.disconnect().catch(() => {});
      if (directCall?.state === 'accepted' && directCall.conversationId === conversation.id) {
        callUiState = 'rejoin';
      }
      voiceError = 'Could not connect to voice. Check your network and try again.';
    }
  }

  async function joinServerVoice(channel: ServerVoiceChannel) {
    voiceError = '';
    if (!window.isSecureContext) {
      voiceError = 'Voice requires HTTPS on mobile browsers.';
      return;
    }
    if (activeServerVoiceId === channel.id && voiceRoom) return;
    if (voiceRoom) {
      if (!confirm(`Leave ${voiceConversationTitle || 'the current voice room'} and join ${channel.name}?`)) return;
      await leaveVoice();
    }
    const attempt = ++voiceAttemptSerial;
    voiceStatus = 'connecting';
    activeServerVoiceId = channel.id;
    activeServerVoiceServerId = channel.serverId;
    serverVoiceStageCollapsed = false;
    voiceConversationId = null;
    voiceConversationTitle = channel.name;
    voiceRetryServerChannel = null;
    try {
      const ticket = await api(`/api/v1/server-voice/channels/${channel.id}/token`, { method: 'POST' });
      if (attempt !== voiceAttemptSerial || activeServerVoiceId !== channel.id) return;
      // The browser-test build substitutes only the media transport. Cubic's
      // ticket request, selected channel and connected UI remain real.
      const testFactory = import.meta.env.MODE === 'browser-test'
        ? (window as Window & { __cubicServerVoiceTestRoom?: () => Room }).__cubicServerVoiceTestRoom
        : undefined;
      const room = testFactory?.() ?? new Room({ adaptiveStream: true, dynacast: true });
      voiceRoom = room;
      const resync = () => { if (voiceRoom === room) syncVoiceParticipants(); };
      room.on(RoomEvent.ParticipantConnected, resync);
      room.on(RoomEvent.ParticipantDisconnected, resync);
      room.on(RoomEvent.TrackMuted, resync);
      room.on(RoomEvent.TrackUnmuted, resync);
      room.on(RoomEvent.TrackPublished, (publication) => {
        if (publication.source === Track.Source.ScreenShare) screenShareFocusDismissed = false;
        resync();
      });
      room.on(RoomEvent.TrackUnpublished, resync);
      room.on(RoomEvent.LocalTrackPublished, (publication) => {
        if (publication.source === Track.Source.ScreenShare) screenShareFocusDismissed = false;
        resync();
      });
      room.on(RoomEvent.LocalTrackUnpublished, resync);
      room.on(RoomEvent.ActiveSpeakersChanged, resync);
      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (voiceRoom !== room) return;
        attachVoiceAudio(track, publication, participant);
        syncVoiceParticipants();
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => { detachVoiceAudio(track); resync(); });
      room.on(RoomEvent.Reconnecting, () => { if (voiceRoom === room) voiceStatus = 'reconnecting'; });
      room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (voiceRoom !== room) return;
        if (!room.canPlaybackAudio) voiceMediaNotice = 'Browser audio playback is paused. Enable audio to hear this channel.';
        else if (voiceMediaNotice.startsWith('Browser audio playback is paused')) voiceMediaNotice = '';
      });
      room.on(RoomEvent.Reconnected, () => {
        if (voiceRoom !== room) return;
        voiceStatus = 'connected';
        resync();
        // Reconnect must not make a stale server membership feel authorized.
        void api(`/api/v1/servers/${channel.serverId}/voice-channels`).then((payload) => {
          if (voiceRoom === room && !payload.channels?.some((item: { id: string }) => item.id === channel.id))
            void leaveVoice(false);
        }).catch(() => {
          if (voiceRoom === room) void leaveVoice(false);
        });
      });
      room.on(RoomEvent.Disconnected, () => {
        if (voiceRoom !== room || attempt !== voiceAttemptSerial) return;
        void leaveVoice(false).then(() => {
          if (voiceAttemptSerial !== attempt + 1 || voiceRoom) return;
          voiceRetryServerChannel = channel;
          voiceError = 'Voice connection ended. Check your network and try again.';
        });
      });
      await room.connect(ticket.url, ticket.token);
      if (voiceRoom !== room || attempt !== voiceAttemptSerial) { await room.disconnect(); return; }
      await room.startAudio().catch(() => {
        if (voiceRoom === room) voiceMediaNotice = 'Browser audio playback is paused. Enable audio to hear this channel.';
      });
      try {
        await room.localParticipant.setMicrophoneEnabled(true,
          microphoneCaptureOptions(browserVoiceProcessing, selectedAudioInput));
      } catch (cause) {
        voiceError = `Joined muted — ${mediaDeviceErrorMessage(cause, 'microphone')}`;
      }
      if (voiceRoom !== room) return;
      voiceStatus = 'connected';
      syncVoiceParticipants();
      if (selectedAudioOutput && audioOutputSupported) {
        room.switchActiveDevice('audiooutput', selectedAudioOutput).catch(() => {});
      }
    } catch {
      if (attempt !== voiceAttemptSerial || activeServerVoiceId !== channel.id) return;
      const failedRoom = voiceRoom;
      await leaveVoice(false);
      if (failedRoom) await failedRoom.disconnect().catch(() => {});
      voiceRetryServerChannel = channel;
      voiceError = 'Could not join voice channel. Check your access and connection.';
    }
  }

  async function toggleVoiceMute() {
    const room = voiceRoom;
    if (!room || voiceStatus !== 'connected' || voiceDeafened) return;

    try {
      await room.localParticipant.setMicrophoneEnabled(
        !room.localParticipant.isMicrophoneEnabled,
        microphoneCaptureOptions(browserVoiceProcessing, selectedAudioInput)
      );
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
        await room.localParticipant.setMicrophoneEnabled(
          !voiceMutedBeforeDeafen,
          microphoneCaptureOptions(browserVoiceProcessing, selectedAudioInput)
        );
        voiceDeafened = false;
        setRemoteAudioDeafened(false);
        voiceMutedBeforeDeafen = false;
      }
      syncVoiceParticipants();
    } catch (e) {
      voiceError = mediaDeviceErrorMessage(e, 'microphone');
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
      voiceCameraExpected = false;
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
      const failure = screenShareFailure(error);
      if (failure.cancelled) voiceMediaNotice = failure.message;
      else voiceError = failure.message;
      syncVoiceParticipants();
    }
  }

  function focusScreenShare(identity: string) {
    focusedScreenShareIdentity = identity;
    focusedVideoIdentity = null;
    screenShareFocusDismissed = false;
  }

  function focusNextScreenShare() {
    const shares = activeScreenShares();
    if (shares.length < 2) return;
    const current = shares.findIndex((participant) => participant.identity === focusedScreenShareIdentity);
    focusScreenShare(shares[(current + 1) % shares.length].identity);
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
    serverListRevision += 1;
    serverRefreshSequence += 1;
    servers = [];
    activeServer = null;
    activeChannel = null;
    serverChannels = [];
    serverVoiceChannels = [];
    serverVoicePresence = {};
    channelLoadSequence += 1;
    serverDetailSequence += 1;
    serverInviteSequence += 1;
    serverMembers = [];
    pendingServerInvites = [];
    serverInvites = [];
    await leaveVoice();
    realtimeSocket?.disconnect();
    try { await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' }); }
    finally { window.location.assign('/login'); }
  }

  onMount(() => {
    trustedInviteOrigin = window.location.origin;
    loadMediaPreferences();
    Promise.all([refreshSocial(), refreshGroupInvites(), refreshServerInvites(), refreshConversations()]).catch((e) => error = e.message);
    void refreshServers();

    const PRESENCE_IDLE_MS = 5 * 60 * 1000;
    let lastActivityAt = Date.now();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let reportedActivity: 'active' | 'idle' | null = null;

    const socket = io({
      path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'], timeout: 5000, reconnection: true
    });
    realtimeSocket = socket;

    const reportActivity = (state: 'active' | 'idle') => {
      if (reportedActivity === state) return;
      reportedActivity = state;
      if (socket.connected) socket.emit('presence:set', { state });
    };
    const scheduleIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (document.visibilityState === 'hidden') {
        reportActivity('idle');
        return;
      }
      const remaining = PRESENCE_IDLE_MS - (Date.now() - lastActivityAt);
      if (remaining <= 0) {
        reportActivity('idle');
      } else {
        idleTimer = setTimeout(scheduleIdle, remaining);
      }
    };
    const markActivity = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (reportedActivity === 'active' && now - lastActivityAt < 1000) return;
      lastActivityAt = now;
      reportActivity('active');
      scheduleIdle();
    };

    socket.on('connect', () => {
      realtimeConnected = true;
      reportedActivity = null;
      Promise.all([refreshSocial(), refreshGroupInvites(), refreshConversations(), syncActiveConversation(), refreshGroupDetails()]).catch(() => {});
      syncDirectCall(socket).catch(() => {});
    });
    socket.on('realtime:ready', () => {
      reportActivity(document.visibilityState === 'hidden' || Date.now() - lastActivityAt >= PRESENCE_IDLE_MS ? 'idle' : 'active');
      scheduleIdle();
      if (activeConversation?.kind !== 'server_text') requestPresenceSnapshot(socket);
      if (activeServer) subscribeServerVoicePresence(activeServer.id);
    });
    socket.on('disconnect', (reason) => {
      realtimeConnected = false;
      pendingPresenceSnapshot = null;
      reportedActivity = null;
      if (reason === 'io server disconnect') {
        void recoverAfterServerDisconnect(socket, () => realtimeSocket === socket);
      }
    });
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
    socket.on('message:updated', (message: any) => {
      if (activeConversation?.id === message.conversationId) {
        applyChangedMessage(message);
      }
      queueConversationRefresh();
    });
    socket.on('message:deleted', (message: any) => {
      if (activeConversation?.id === message.conversationId) {
        applyChangedMessage(message);
        if (editingMessageId === message.id) {
          editingMessageId = null;
          messageBody = draftBeforeEdit;
          draftBeforeEdit = '';
        }
        if (actionMenuMessageId === message.id) actionMenuMessageId = null;
        if (reactionPickerMessageId === message.id) reactionPickerMessageId = null;
        if (deleteCandidate?.id === message.id) closeDeleteDialog();
      }
      queueConversationRefresh();
    });
    socket.on('message:reactions', (event: MessageReactionEvent) => {
      if (activeConversation?.id === event.conversationId) applyReactionEvent(event);
    });
    socket.on('conversation:updated', (event: any) => {
      queueConversationRefresh();
      if (activeConversation?.id === event?.conversationId && activeConversation.kind === 'group') {
        refreshGroupDetails().then(() => requestPresenceSnapshot(socket)).catch(() => {});
      }
    });
    socket.on('presence:changed', (event: { userId?: string; status?: PresenceStatus }) => {
      if (event?.userId && (event.status === 'online' || event.status === 'idle' || event.status === 'offline')) {
        pendingPresenceSnapshot?.changedUserIds.add(event.userId);
        memberPresence = { ...memberPresence, [event.userId]: event.status };
      }
    });
    socket.on('profile:changed', (event: { userId?: string; displayName?: string; avatarUrl?: string | null }) => {
      if (event?.userId && typeof event.displayName === 'string' &&
          (typeof event.avatarUrl === 'string' || event.avatarUrl === null)) {
        applyProfileChanged({ userId: event.userId, displayName: event.displayName, avatarUrl: event.avatarUrl });
      }
    });
    socket.on('conversation:removed', (event: any) => {
      const wasServerChannel = serverChannels.some((channel) => channel.conversationId === event?.conversationId);
      if (voiceConversationId === event?.conversationId) void leaveVoice();
      if (activeConversation?.id === event?.conversationId) closeConversation();
      if (wasServerChannel) void refreshServers();
      refreshConversations().catch(() => {});
    });
    socket.on('server:voice:presence', (event: {
      serverId: string; channelId: string; occupants: Array<{ userId: string; displayName: string }>;
    }) => {
      if (event?.serverId === activeServer?.id && Array.isArray(event.occupants))
        serverVoicePresence = { ...serverVoicePresence, [event.channelId]: event.occupants };
    });
    socket.on('server:removed', (event: { serverId: string }) => {
      if (!event?.serverId) return;
      if (activeServerVoiceServerId === event.serverId) void leaveVoice(false);
      serverListRevision += 1;
      servers = servers.filter((item) => item.id !== event.serverId);
      if (activeServer?.id === event.serverId) {
        closeConversation();
        activeServer = null;
        activeChannel = null;
        serverChannels = [];
        serverVoiceChannels = [];
        serverVoicePresence = {};
        tab = 'chats';
      }
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

      markActivity();

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
      else scheduleIdle();
    };

    const onMediaDeviceChange = () => {
      if (mediaSettingsOpen || voiceRoom) void refreshMediaDevices();
    };

    window.addEventListener('pageshow', resumeRealtime);
    window.addEventListener('focus', resumeRealtime);
    window.addEventListener('online', resumeRealtime);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('keydown', markActivity);
    window.addEventListener('pointerdown', markActivity);
    window.addEventListener('pointermove', markActivity);
    window.addEventListener('touchstart', markActivity);
    navigator.mediaDevices?.addEventListener?.('devicechange', onMediaDeviceChange);

    return () => {
      endNavigationPress();
      if (navigationPressConsumeTimer) clearTimeout(navigationPressConsumeTimer);
      navigationPressConsumeTimer = null;
      consumedNavigationPress = null;
      invitePreviewQueue.dispose();
      if (resumeTimer) clearTimeout(resumeTimer);
      if (idleTimer) clearTimeout(idleTimer);
      pendingPresenceSnapshot = null;

      window.removeEventListener('pageshow', resumeRealtime);
      window.removeEventListener('focus', resumeRealtime);
      window.removeEventListener('online', resumeRealtime);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('keydown', markActivity);
      window.removeEventListener('pointerdown', markActivity);
      window.removeEventListener('pointermove', markActivity);
      window.removeEventListener('touchstart', markActivity);
      navigator.mediaDevices?.removeEventListener?.('devicechange', onMediaDeviceChange);

      realtimeSocket = null;
      socket.disconnect();
      if (callNoticeTimer) clearTimeout(callNoticeTimer);
      void leaveVoice();
    };
  });
</script>

<svelte:head><title>Cubic — {currentUser.displayName}</title></svelte:head>
<svelte:window onkeydown={(event) => { if (event.key === 'Escape') { if (userSettingsOpen) closeUserSettings(); else { navigationMenu = null; serverMenuOpen = false; if (serverMembersOpen) closeServerMembers(); else if (channelSettingsTarget) closeChannelSettings(); else if (serverSurface) closeServerSurface(); } } }} />

<main class="messenger-shell cubic-app-shell">
  <PrimaryRail servers={servers} selectedServerId={activeServer?.id ?? null} messagesSelected={tab !== 'servers'} serverBrowserSelected={tab === 'servers' && activeServer === null} loading={serversLoading} onmessages={showMessages} onbrowse={showServerBrowser} onserver={selectServer} oncreate={(event) => openServerDialog('server', event)} />

  {#if userSettingsOpen}
    <UserSettings profile={currentUser} voiceAvailable={voiceStatus !== 'idle'} {loggingOut} onclose={closeUserSettings} onsave={saveOwnProfile} onupload={uploadOwnAvatar} onremove={removeOwnAvatar} onmedia={() => { userSettingsOpen = false; void showMediaSettings(); }} onlogout={() => void logout()} />
  {/if}

  {#if serverDialog}
    <dialog class="cubic-server-dialog" use:showServerDialog aria-label={serverDialog === 'icon' ? 'Server icon' : serverDialog === 'remove-member' ? 'Remove server member' : serverDialog === 'server' ? 'Create server' : serverDialog === 'channel' ? 'Create text channel' : serverDialog === 'voice-channel' ? 'Create voice channel' : serverDialog === 'rename-voice-channel' ? 'Rename voice channel' : serverDialog === 'invite' ? 'Invite people' : serverDialog === 'move-channel' ? 'Move channel' : serverDialog === 'rename-category' ? 'Rename category' : 'Create category'} onclose={closeServerDialog} oncancel={(event) => { if ((serverDialog === 'remove-member' && serverMembershipBusy) || (serverDialog === 'icon' && serverIconBusy)) event.preventDefault(); }}>
      <header><h2>{serverDialog === 'icon' ? 'Server icon' : serverDialog === 'remove-member' ? 'Remove server member' : serverDialog === 'server' ? 'Create server' : serverDialog === 'channel' ? 'Create text channel' : serverDialog === 'voice-channel' ? 'Create voice channel' : serverDialog === 'rename-voice-channel' ? 'Rename voice channel' : serverDialog === 'invite' ? 'Invite people' : serverDialog === 'move-channel' ? 'Move channel' : serverDialog === 'rename-category' ? 'Rename category' : 'Create category'}</h2><button type="button" aria-label="Close server dialog" onclick={closeServerDialog} disabled={(serverDialog === 'remove-member' && serverMembershipBusy) || (serverDialog === 'icon' && serverIconBusy)}><Icon name="x" size={18} /></button></header>
      {#if serverDialog === 'server'}
        <form class="cubic-server-create" onsubmit={createServer}>
          <label for="cubic-server-name">Server name</label>
          <input id="cubic-server-name" bind:value={serverName} maxlength="96" required placeholder="Name your server" />
          <button type="submit" disabled={serverCreateBusy}>{serverCreateBusy ? 'Creating…' : 'Create server'}</button>
        </form>
        {#if serversError}<p class="inline-error" role="alert">{serversError}</p>{/if}
      {:else if serverDialog === 'icon' && activeServer?.ownerUserId === currentUser.id}
        <form class="cubic-server-create cubic-server-icon-form" onsubmit={uploadServerIcon}>
          <div class="cubic-server-icon-current" aria-label={`Current icon for ${activeServer.name}`}>
            <span class="cubic-server-icon-shell">{activeServer.name.slice(0, 1).toUpperCase()}{#if activeServer.iconUrl}{#key activeServer.iconUrl}<img src={activeServer.iconUrl} alt="" onerror={hideFailedUserAvatar} />{/key}{/if}</span>
            <span>{activeServer.iconUrl ? 'Current server icon' : 'Using fallback initials'}</span>
          </div>
          <label for="cubic-server-icon-file">Choose JPEG, PNG or WebP (up to 5 MiB)</label>
          <input id="cubic-server-icon-file" type="file" accept="image/jpeg,image/png,image/webp" onchange={(event) => serverIconFile = event.currentTarget.files?.[0] ?? null} disabled={serverIconBusy} />
          <button type="submit" disabled={serverIconBusy || !serverIconFile}>{serverIconBusy ? 'Saving…' : activeServer.iconUrl ? 'Replace icon' : 'Upload icon'}</button>
          {#if activeServer.iconUrl}<button type="button" class="quiet" onclick={removeSelectedServerIcon} disabled={serverIconBusy}>Remove icon</button>{/if}
          {#if serverIconError}<p class="inline-error" role="alert">{serverIconError}</p>{/if}
        </form>
      {:else if serverDialog === 'channel' && activeServer}
        <form class="cubic-server-create" onsubmit={createChannel}>
          <label for="cubic-channel-name">Channel name</label>
          <input id="cubic-channel-name" bind:value={channelName} maxlength="96" required placeholder="New text channel" />
          <label for="cubic-channel-category">Category</label>
          <select id="cubic-channel-category" bind:value={channelCategoryId}>
            <option value="">Uncategorized</option>
            {#each serverCategories as category (category.id)}<option value={category.id}>{category.name}</option>{/each}
          </select>
          <button type="submit" disabled={channelCreateBusy || channelsLoading}>{channelCreateBusy ? 'Creating…' : 'Create text channel'}</button>
        </form>
        {#if channelsError}<p class="inline-error" role="alert">{channelsError}</p>{/if}
      {:else if (serverDialog === 'voice-channel' || serverDialog === 'rename-voice-channel') && activeServer?.ownerUserId === currentUser.id}
        <form class="cubic-server-create" onsubmit={saveVoiceChannel}>
          <label for="cubic-voice-channel-name">Voice channel name</label>
          <input id="cubic-voice-channel-name" bind:value={voiceChannelName} maxlength="96" required placeholder="Lounge" />
          {#if serverDialog === 'voice-channel'}
            <label for="cubic-voice-channel-category">Category</label>
            <select id="cubic-voice-channel-category" bind:value={channelCategoryId}>
              <option value="">Uncategorized</option>
              {#each serverCategories as category (category.id)}<option value={category.id}>{category.name}</option>{/each}
            </select>
          {/if}
          <button type="submit" disabled={channelCreateBusy || channelsLoading}>{channelCreateBusy ? 'Saving…' : serverDialog === 'voice-channel' ? 'Create voice channel' : 'Save voice channel'}</button>
        </form>
        {#if channelsError}<p class="inline-error" role="alert">{channelsError}</p>{/if}
      {:else if (serverDialog === 'category' || serverDialog === 'rename-category') && activeServer?.ownerUserId === currentUser.id}
        <form class="cubic-server-create" onsubmit={saveCategory}>
          <label for="cubic-category-name">Category name</label>
          <input id="cubic-category-name" bind:value={categoryName} maxlength="96" required />
          <button type="submit" disabled={layoutBusy || channelsLoading}>{layoutBusy ? 'Saving…' : serverDialog === 'category' ? 'Create category' : 'Save category'}</button>
        </form>
        {#if layoutError}<p class="inline-error" role="alert">{layoutError}</p>{/if}
      {:else if serverDialog === 'move-channel' && activeServer?.ownerUserId === currentUser.id}
        <form class="cubic-server-create" onsubmit={moveSelectedChannel}>
          <label for="cubic-channel-destination">Move channel to</label>
          <select id="cubic-channel-destination" bind:value={moveDestinationId}>
            <option value="">Uncategorized</option>
            {#each serverCategories as category (category.id)}<option value={category.id}>{category.name}</option>{/each}
          </select>
          <button type="submit" disabled={layoutBusy || channelsLoading}>{layoutBusy ? 'Moving…' : 'Move to end'}</button>
        </form>
        {#if layoutError}<p class="inline-error" role="alert">{layoutError}</p>{/if}
      {:else if serverDialog === 'invite' && activeServer && activeServer.ownerUserId === currentUser.id}
        <h3>Targeted friend invitation</h3>
        <form class="cubic-server-create" onsubmit={inviteServerFriend}>
          <label for="cubic-server-invite-friend">Invite a friend</label>
          <select id="cubic-server-invite-friend" bind:value={serverInviteTarget} required>
            <option value="">Choose a friend</option>
            {#each friends.filter((friend) => friend.id !== currentUser.id && !serverMembers.some((member) => member.id === friend.id) && !pendingServerInvites.some((invite) => invite.invitee.id === friend.id)) as friend (friend.id)}
              <option value={friend.id}>{friend.displayName} (@{friend.username})</option>
            {/each}
          </select>
          <button type="submit" disabled={serverMembershipBusy || !serverInviteTarget}>Invite friend</button>
        </form>
        {#if pendingServerInvites.length}<h3>Pending invitations</h3>{/if}
        {#each pendingServerInvites as invite (invite.id)}
          <div class="cubic-server-member-row"><span>{invite.invitee.displayName} · Pending</span><button type="button" aria-label={`Cancel invitation for ${invite.invitee.displayName}`} onclick={() => cancelServerInvite(invite.id)} disabled={serverMembershipBusy}>Cancel</button></div>
        {/each}
        <section class="cubic-share-invites" aria-label="Shareable invite links">
          <h3>Share invite link</h3>
          <p>Anyone with a link can join. Links expire after 7 days. Removing a member does not revoke a link.</p>
          <button type="button" onclick={createShareInviteLink} disabled={shareInviteBusy}>{shareInviteBusy ? 'Creating…' : 'Create shareable link'}</button>
          {#if oneTimeInviteUrl}
            <div class="cubic-share-once">
              <label for="cubic-share-invite-url">New link — shown only once</label>
              <input id="cubic-share-invite-url" value={oneTimeInviteUrl} readonly onclick={(event) => event.currentTarget.select()} />
              <div class="cubic-share-actions">
                <button type="button" onclick={copyShareInviteLink}>Copy link</button>
                {#if typeof navigator !== 'undefined' && typeof navigator.share === 'function'}<button type="button" onclick={shareInviteLink}>Share link</button>{/if}
                <button type="button" onclick={() => { oneTimeInviteUrl = ''; shareInviteNotice = ''; }}>Done</button>
              </div>
              <small>After closing this link, it cannot be revealed again. Create a new one if needed.</small>
            </div>
          {/if}
          {#if shareInviteNotice}<p role="status">{shareInviteNotice}</p>{/if}
          {#if shareInviteLinks.length}<h3>Existing links</h3>{/if}
          {#each shareInviteLinks as link (link.id)}
            <div class="cubic-share-link-row">
              <span>Created {new Date(link.createdAt).toLocaleDateString()} · {link.revokedAt ? 'Revoked' : Date.parse(link.expiresAt) <= Date.now() ? 'Expired' : `Expires ${new Date(link.expiresAt).toLocaleDateString()}`}</span>
              {#if !link.revokedAt && Date.parse(link.expiresAt) > Date.now()}<button type="button" aria-label={`Revoke link created ${new Date(link.createdAt).toLocaleDateString()}`} onclick={() => revokeShareInviteLink(link.id)} disabled={shareInviteBusy}>Revoke</button>{/if}
            </div>
          {/each}
          {#if shareInviteError}<p class="inline-error" role="alert">{shareInviteError} <button type="button" onclick={() => refreshShareInviteLinks(activeServer!)}>Retry</button></p>{/if}
        </section>
        {#if serverMembershipError}<p class="inline-error" role="alert">{serverMembershipError} <button type="button" onclick={() => refreshServerMembership(activeServer!)}>Retry</button></p>{/if}
      {:else if serverDialog === 'remove-member' && activeServer && memberRemovalTarget && activeServer.ownerUserId === currentUser.id}
        <div class="cubic-server-remove-confirm">
          <p>Remove <strong>{memberRemovalTarget.displayName}</strong> from <strong>{activeServer.name}</strong>?</p>
          <p>They will lose access to this server. Their previous messages will remain.</p>
          {#if serverMembershipError}<p class="inline-error" role="alert">{serverMembershipError}</p>{/if}
          <div class="cubic-server-remove-actions">
            <button type="button" onclick={closeServerDialog} disabled={serverMembershipBusy}>Cancel</button>
            <button type="button" class="cubic-server-remove-submit" onclick={removeSelectedServerMember} disabled={serverMembershipBusy}>{serverMembershipBusy ? 'Removing…' : 'Remove from server'}</button>
          </div>
        </div>
      {/if}
    </dialog>
  {/if}

  <div class="cubic-context-column">
  <section class="conversation-list" class:cubic-server-sidebar={tab === 'servers' && activeServer !== null}>
    {#if tab === 'chats'}
      <header class="conversation-list-header">
        <div><small>MESSAGES</small><h1>Conversations</h1></div>
        <div class="cubic-messages-header-actions"><button class="icon-action" type="button" aria-label="People and friends" title="People and friends" onclick={showPeople}><Icon name="users" size={19} /></button><button class="icon-action" type="button" aria-label="New group" title="New group" onclick={openNewGroup}><Icon name="plus" size={19} /></button></div>
      </header>
      {#if conversations.length === 0}<div class="empty-state">No conversations yet.<br />Add a friend or create a group.</div>{/if}
      {#each conversations as conversation}
        <button class="conversation-row" class:active={activeConversation?.id === conversation.id} onclick={() => selectConversation(conversation)}>
          {#if conversation.kind === 'group' && conversation.avatarUrl}
            <img class="avatar group-avatar avatar-image" src={conversation.avatarUrl} alt="" />
          {:else if conversation.kind === 'direct' && conversation.peer?.avatarUrl}
            <span class="avatar cubic-user-avatar-shell">{conversationLetter(conversation)}{#key conversation.peer.avatarUrl}<img src={conversation.peer.avatarUrl} alt="" onerror={hideFailedUserAvatar} />{/key}</span>
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
    {:else if tab === 'servers'}
      {#if activeServer}
        <header class="conversation-list-header cubic-server-sidebar-head">
          <div class="cubic-server-heading"><span class="cubic-server-icon-shell" aria-hidden="true">{activeServer.name.slice(0, 1).toUpperCase()}{#if activeServer.iconUrl}{#key activeServer.iconUrl}<img src={activeServer.iconUrl} alt="" onerror={hideFailedUserAvatar} />{/key}{/if}</span><span><small>SERVER</small><h1>{activeServer.name}</h1></span></div>
          <button class="icon-action" type="button" aria-label="Settings" title="Settings" onclick={() => openServerSurface('overview')}><Icon name="settings" size={19} /></button>
        </header>
        <div class="cubic-channel-sidebar-head">
          <strong>CHANNELS</strong>
          {#if activeServer.ownerUserId === currentUser.id}
            <button type="button" aria-label="Add channel or category" aria-expanded={navigationMenu === 'create'} title="Add channel or category" onclick={() => toggleNavigationMenu('create')}><Icon name="plus" size={18} /></button>
          {/if}
        </div>
        {#if navigationMenu === 'create'}
          <div class="cubic-navigation-actions" role="group" aria-label="Create in this server">
            <button type="button" onclick={(event) => { navigationMenu = null; channelCategoryId = ''; openServerDialog('channel', event); }}>Create text channel</button>
            <button type="button" onclick={(event) => { navigationMenu = null; voiceChannelName = ''; editingVoiceChannelId = null; channelCategoryId = ''; openServerDialog('voice-channel', event); }}>Create voice channel</button>
            <button type="button" onclick={(event) => { navigationMenu = null; categoryName = ''; editingCategoryId = null; openServerDialog('category', event); }}>Create category</button>
          </div>
        {/if}
        <div class="cubic-channel-list" aria-label={`Channels in ${activeServer.name}`}>
          {#if channelsLoading}<p class="cubic-server-list-status">Loading channels…</p>{/if}
          {#if !channelsLoading && serverChannels.length === 0 && serverVoiceChannels.length === 0}<p class="cubic-server-list-status">{activeServer.ownerUserId === currentUser.id ? 'No channels yet. Add a text or voice channel to get started.' : 'This server has no channels yet.'}</p>{/if}
          {#each channelsInScope(null) as channel, index (`${channel.kind}:${channel.id}`)}
            <div class="cubic-layout-channel-line">
              {#if channel.kind === 'text'}
                <button class="cubic-channel-row" type="button" aria-label={`Text channel ${channel.name}`} aria-current={activeChannel?.id === channel.id ? 'page' : undefined} oncontextmenu={(event) => activeServer?.ownerUserId === currentUser.id && openNavigationContext(event, `channel:${channel.kind}:${channel.id}`)} ontouchstart={() => activeServer?.ownerUserId === currentUser.id && startNavigationPress(`channel:${channel.kind}:${channel.id}`)} ontouchend={endNavigationPress} ontouchcancel={endNavigationPress} ontouchmove={endNavigationPress} onclick={() => { if (!navigationPressWasConsumed(`channel:${channel.kind}:${channel.id}`)) void selectChannel(channel); }}><span aria-hidden="true">#</span><span>{channel.name}</span></button>
              {:else}
                <button class="cubic-channel-row cubic-voice-channel-row" type="button" aria-label={`Join voice channel ${channel.name}`} aria-current={activeServerVoiceId === channel.id ? 'true' : undefined} oncontextmenu={(event) => activeServer?.ownerUserId === currentUser.id && openNavigationContext(event, `channel:${channel.kind}:${channel.id}`)} ontouchstart={() => activeServer?.ownerUserId === currentUser.id && startNavigationPress(`channel:${channel.kind}:${channel.id}`)} ontouchend={endNavigationPress} ontouchcancel={endNavigationPress} ontouchmove={endNavigationPress} onclick={() => { if (!navigationPressWasConsumed(`channel:${channel.kind}:${channel.id}`)) void joinServerVoice(channel); }}><Icon name="headphones" size={17} /><span>{channel.name}</span></button>
              {/if}
              {#if activeServer.ownerUserId === currentUser.id}
                <button class="cubic-navigation-more" type="button" aria-label={`Actions for ${channel.kind} channel ${channel.name}`} aria-expanded={navigationMenu === `channel:${channel.kind}:${channel.id}`} title="Channel actions" onclick={() => toggleNavigationMenu(`channel:${channel.kind}:${channel.id}`)}><Icon name="more" size={17} /></button>
              {/if}
            </div>
            {#if navigationMenu === `channel:${channel.kind}:${channel.id}` && activeServer.ownerUserId === currentUser.id}
              <div class="cubic-navigation-actions" role="group" aria-label={`Actions for ${channel.name}`}>
                <button type="button" disabled={layoutBusy || index === 0} onclick={() => { navigationMenu = null; void shiftChannel(channel, -1); }}>Move {channel.name} up</button>
                <button type="button" disabled={layoutBusy || index === channelsInScope(null).length - 1} onclick={() => { navigationMenu = null; void shiftChannel(channel, 1); }}>Move {channel.name} down</button>
                <button type="button" onclick={() => openChannelSettings(channel)}>Channel settings for {channel.name}</button>
                <button type="button" disabled={layoutBusy} onclick={(event) => { navigationMenu = null; movingChannelId = channel.id; movingChannelKind = channel.kind; moveDestinationId = channel.categoryId ?? ''; openServerDialog('move-channel', event); }}>Move {channel.name} to category</button>
              </div>
            {/if}
            {#if channel.kind === 'voice' && serverVoicePresence[channel.id]?.length}
              <ul class="cubic-voice-occupants" aria-label={`People in ${channel.name}`}>
                {#each serverVoicePresence[channel.id] as occupant (occupant.userId)}<li>{occupant.displayName}</li>{/each}
              </ul>
            {/if}
          {/each}
          {#each serverCategories as category, categoryIndex (category.id)}
            <section class="cubic-layout-category" aria-label={`Category ${category.name}`}>
              <div class="cubic-layout-category-head"><strong>{category.name}</strong>
                {#if activeServer.ownerUserId === currentUser.id}
                  <button class="cubic-navigation-more" type="button" aria-label={`Actions for category ${category.name}`} aria-expanded={navigationMenu === `category:${category.id}`} title="Category actions" onclick={() => toggleNavigationMenu(`category:${category.id}`)}><Icon name="more" size={17} /></button>
                {/if}
              </div>
              {#if navigationMenu === `category:${category.id}` && activeServer.ownerUserId === currentUser.id}
                <div class="cubic-navigation-actions" role="group" aria-label={`Actions for category ${category.name}`}>
                  <button type="button" disabled={layoutBusy || categoryIndex === 0} onclick={() => { navigationMenu = null; void shiftCategory(category.id, -1); }}>Move category {category.name} up</button>
                  <button type="button" disabled={layoutBusy || categoryIndex === serverCategories.length - 1} onclick={() => { navigationMenu = null; void shiftCategory(category.id, 1); }}>Move category {category.name} down</button>
                  <button type="button" onclick={(event) => { navigationMenu = null; editingCategoryId = category.id; categoryName = category.name; openServerDialog('rename-category', event); }}>Rename category {category.name}</button>
                  <button type="button" class="cubic-navigation-danger" disabled={layoutBusy} onclick={() => { navigationMenu = null; void deleteSelectedCategory(category.id); }}>Delete category {category.name}</button>
                </div>
              {/if}
              {#each channelsInScope(category.id) as channel, index (`${channel.kind}:${channel.id}`)}
                <div class="cubic-layout-channel-line">
                  {#if channel.kind === 'text'}
                    <button class="cubic-channel-row" type="button" aria-label={`Text channel ${channel.name}`} aria-current={activeChannel?.id === channel.id ? 'page' : undefined} oncontextmenu={(event) => activeServer?.ownerUserId === currentUser.id && openNavigationContext(event, `channel:${channel.kind}:${channel.id}`)} ontouchstart={() => activeServer?.ownerUserId === currentUser.id && startNavigationPress(`channel:${channel.kind}:${channel.id}`)} ontouchend={endNavigationPress} ontouchcancel={endNavigationPress} ontouchmove={endNavigationPress} onclick={() => { if (!navigationPressWasConsumed(`channel:${channel.kind}:${channel.id}`)) void selectChannel(channel); }}><span aria-hidden="true">#</span><span>{channel.name}</span></button>
                  {:else}
                    <button class="cubic-channel-row cubic-voice-channel-row" type="button" aria-label={`Join voice channel ${channel.name}`} aria-current={activeServerVoiceId === channel.id ? 'true' : undefined} oncontextmenu={(event) => activeServer?.ownerUserId === currentUser.id && openNavigationContext(event, `channel:${channel.kind}:${channel.id}`)} ontouchstart={() => activeServer?.ownerUserId === currentUser.id && startNavigationPress(`channel:${channel.kind}:${channel.id}`)} ontouchend={endNavigationPress} ontouchcancel={endNavigationPress} ontouchmove={endNavigationPress} onclick={() => { if (!navigationPressWasConsumed(`channel:${channel.kind}:${channel.id}`)) void joinServerVoice(channel); }}><Icon name="headphones" size={17} /><span>{channel.name}</span></button>
                  {/if}
                  {#if activeServer.ownerUserId === currentUser.id}
                    <button class="cubic-navigation-more" type="button" aria-label={`Actions for ${channel.kind} channel ${channel.name}`} aria-expanded={navigationMenu === `channel:${channel.kind}:${channel.id}`} title="Channel actions" onclick={() => toggleNavigationMenu(`channel:${channel.kind}:${channel.id}`)}><Icon name="more" size={17} /></button>
                  {/if}
                </div>
                {#if navigationMenu === `channel:${channel.kind}:${channel.id}` && activeServer.ownerUserId === currentUser.id}
                  <div class="cubic-navigation-actions" role="group" aria-label={`Actions for ${channel.name}`}>
                    <button type="button" disabled={layoutBusy || index === 0} onclick={() => { navigationMenu = null; void shiftChannel(channel, -1); }}>Move {channel.name} up</button>
                    <button type="button" disabled={layoutBusy || index === channelsInScope(category.id).length - 1} onclick={() => { navigationMenu = null; void shiftChannel(channel, 1); }}>Move {channel.name} down</button>
                    <button type="button" onclick={() => openChannelSettings(channel)}>Channel settings for {channel.name}</button>
                    <button type="button" disabled={layoutBusy} onclick={(event) => { navigationMenu = null; movingChannelId = channel.id; movingChannelKind = channel.kind; moveDestinationId = channel.categoryId ?? ''; openServerDialog('move-channel', event); }}>Move {channel.name} to category</button>
                  </div>
                {/if}
                {#if channel.kind === 'voice' && serverVoicePresence[channel.id]?.length}
                  <ul class="cubic-voice-occupants" aria-label={`People in ${channel.name}`}>
                    {#each serverVoicePresence[channel.id] as occupant (occupant.userId)}<li>{occupant.displayName}</li>{/each}
                  </ul>
                {/if}
              {/each}
            </section>
          {/each}
          {#if layoutError}<p class="inline-error" role="alert">{layoutError}</p>{/if}
          {#if channelsError}<div class="inline-error cubic-server-error" role="alert">{channelsError} <button type="button" onclick={() => refreshServerChannels(activeServer!)}>Retry list</button></div>{/if}
        </div>
      {:else}
        <header class="conversation-list-header"><div><small>SPACES</small><h1>Servers</h1></div><button class="icon-action" type="button" aria-label="Create server" onclick={(event) => openServerDialog('server', event)}><Icon name="plus" size={19} /></button></header>
        <div class="cubic-server-list" aria-label="Your servers">
          {#if serversLoading}<p class="cubic-server-list-status">Loading servers…</p>{/if}
          {#if !serversLoading && servers.length === 0}<p class="cubic-server-list-status">No servers yet. Create one to get started.</p>{/if}
          {#each servers as server (server.id)}
            <button class="conversation-row cubic-server-row" aria-label={`Open server ${server.name}`} onclick={() => selectServer(server)}>
              <span class="avatar group-avatar cubic-server-icon-shell">{server.name.slice(0, 1).toUpperCase()}{#if server.iconUrl}{#key server.iconUrl}<img src={server.iconUrl} alt="" onerror={hideFailedUserAvatar} />{/key}{/if}</span>
              <span class="conversation-copy"><strong>{server.name}</strong><small>Server</small></span>
            </button>
          {/each}
        </div>
        {#if serversError}<div class="inline-error cubic-server-error" role="alert">{serversError} <button type="button" onclick={refreshServers}>Retry list</button></div>{/if}
      {/if}
    {:else}
      <header class="conversation-list-header"><div><small>SOCIAL</small><h1>People</h1></div><button class="icon-action" type="button" aria-label="Back to Messages" title="Back to Messages" onclick={showMessages}><Icon name="back" size={19} /></button></header>
      <div class="people-search"><input bind:value={query} oninput={search} placeholder="Search username or name" /></div>
      {#if error}<div class="inline-error">{error}</div>{/if}
      {#if serverInvites.length}<h2 class="section-label">Server invitations</h2>{/if}
      {#each serverInvites as invite (invite.id)}
        <div class="person-row cubic-server-invite-row">
          <span class="avatar group-avatar" aria-hidden="true">{invite.serverName.slice(0, 1).toUpperCase()}</span>
          <div><strong>{invite.serverName}</strong><small>Pending invitation from @{invite.inviter.username}</small></div>
          <div class="row-actions"><button type="button" aria-label={`Accept invitation to ${invite.serverName}`} onclick={() => acceptServerInvite(invite.id)} disabled={serverMembershipBusy}>Accept</button></div>
        </div>
      {/each}
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
        <div class="person-row"><span class="avatar cubic-user-avatar-shell">{request.user.displayName.slice(0,1).toUpperCase()}{#if request.user.avatarUrl}{#key request.user.avatarUrl}<img src={request.user.avatarUrl} alt="" onerror={hideFailedUserAvatar} />{/key}{/if}</span><button class="cubic-profile-person" type="button" onclick={() => openProfile(request.user)}><strong>{request.user.displayName}</strong><small>@{request.user.username} · {request.direction}</small></button><div class="row-actions">{#if request.direction === 'incoming'}<button onclick={() => acceptRequest(request.id)}>Accept</button>{/if}<button class="quiet" onclick={() => dismissRequest(request.id)}>{request.direction === 'incoming' ? 'Decline' : 'Cancel'}</button></div></div>
      {/each}
      {#if friends.length}<h2 class="section-label">Friends</h2>{/if}
      {#each friends as friend}
        <div class="person-row"><span class="avatar cubic-user-avatar-shell">{friend.displayName.slice(0,1).toUpperCase()}{#if friend.avatarUrl}{#key friend.avatarUrl}<img src={friend.avatarUrl} alt="" onerror={hideFailedUserAvatar} />{/key}{/if}</span><button class="cubic-profile-person" type="button" onclick={() => openProfile(friend)}><strong>{friend.displayName}</strong><small>@{friend.username}</small></button><div class="row-actions"><button onclick={() => openDirect(friend.id)} disabled={busy}>Message</button></div></div>
      {/each}
      {#if searchResults.length}<h2 class="section-label">Search</h2>{/if}
      {#each searchResults as person}
        <div class="person-row"><span class="avatar cubic-user-avatar-shell">{person.displayName.slice(0,1).toUpperCase()}{#if person.avatarUrl}{#key person.avatarUrl}<img src={person.avatarUrl} alt="" onerror={hideFailedUserAvatar} />{/key}{/if}</span><button class="cubic-profile-person" type="button" onclick={() => openProfile(person)}><strong>{person.displayName}</strong><small>@{person.username}</small></button><div class="row-actions"><button onclick={() => addFriend(person.id)}>Add</button></div></div>
      {/each}
    {/if}
  </section>
  <UserBar displayName={currentUser.displayName} username={currentUser.username} avatarUrl={currentUser.avatarUrl} onsettings={() => userSettingsOpen = true} />
  </div>

  <section class="chat-panel" class:open={activeConversation !== null || activeServer !== null} class:cubic-members-open={memberPanelOpen} class:cubic-server-members-open={serverMembersOpen && activeServer !== null} class:cubic-server-empty={activeServer !== null && activeConversation === null && serverSurface === null && channelSettingsTarget === null} class:cubic-server-surface-open={serverSurface !== null || channelSettingsTarget !== null}>
    {#if activeServer && serverSurface}
      <section class="cubic-server-settings-surface" aria-label={`${activeServer.name} server settings`}>
        <header class="chat-header">
          <button class="chat-back" type="button" aria-label="Back to server" onclick={closeServerSurface}><Icon name="back" size={24} /></button>
          <div class="chat-heading"><strong>{activeServer.name}</strong><small>Server settings</small></div>
          <button class="chat-meta-button" type="button" aria-label="Close server settings" title="Close settings" onclick={closeServerSurface}><Icon name="x" size={19} /></button>
        </header>
        <div class="cubic-server-settings-layout">
          <nav class="cubic-settings-nav" aria-label="Server settings sections">
            <button type="button" aria-current={serverSurface === 'overview' ? 'page' : undefined} onclick={() => openServerSurface('overview')}><Icon name="server" size={17} /> Overview</button>
            <button type="button" aria-current={serverSurface === 'members' ? 'page' : undefined} onclick={() => openServerSurface('members')}><Icon name="users" size={17} /> Members <span>{serverMembers.length}</span></button>
            {#if activeServer.ownerUserId === currentUser.id}
              <button type="button" aria-current={serverSurface === 'invites' ? 'page' : undefined} onclick={() => openServerSurface('invites')}><Icon name="user-plus" size={17} /> Invites</button>
            {/if}
          </nav>
          <div class="cubic-settings-content">
            {#if serverSurface === 'overview'}
              <section class="cubic-settings-section" aria-labelledby="cubic-server-overview-title">
                <div class="cubic-settings-title">
                  <div class="cubic-settings-server-identity">
                    <span class="cubic-server-icon-shell cubic-settings-server-icon" aria-hidden="true">{activeServer.name.slice(0, 1).toUpperCase()}{#if activeServer.iconUrl}{#key activeServer.iconUrl}<img src={activeServer.iconUrl} alt="" onerror={hideFailedUserAvatar} />{/key}{/if}</span>
                    <div><small>SERVER OVERVIEW</small><h2 id="cubic-server-overview-title">{activeServer.name}</h2><p>{activeServer.ownerUserId === currentUser.id ? 'You own this server.' : 'You are a member of this server.'}</p></div>
                  </div>
                  {#if activeServer.ownerUserId === currentUser.id}<button type="button" class="cubic-settings-secondary" onclick={(event) => openServerDialog('icon', event)}><Icon name="upload" size={16} /> Change icon</button>{/if}
                </div>
                <div class="cubic-settings-stats" aria-label="Server summary">
                  <div><strong>{serverMembers.length}</strong><span>Members</span></div>
                  <div><strong>{serverChannels.length}</strong><span>Text channels</span></div>
                  <div><strong>{serverVoiceChannels.length}</strong><span>Voice channels</span></div>
                </div>
                <div class="cubic-settings-card">
                  <div class="cubic-settings-row"><div><strong>Server name</strong><small>Name changes are not available yet.</small></div><span>{activeServer.name}</span></div>
                  <div class="cubic-settings-row"><div><strong>Owner</strong><small>Server ownership is fixed in the current server model.</small></div><span>{serverMembers.find((member) => member.id === activeServer?.ownerUserId)?.displayName ?? 'Owner'}</span></div>
                  <div class="cubic-settings-row"><div><strong>Created</strong><small>Server creation date</small></div><span>{new Date(activeServer.createdAt).toLocaleDateString()}</span></div>
                </div>
                {#if activeServer.ownerUserId === currentUser.id}
                  <div class="cubic-settings-actions"><button type="button" onclick={() => openServerSurface('members')}><Icon name="users" size={16} /> Manage members</button><button type="button" onclick={() => openServerSurface('invites')}><Icon name="user-plus" size={16} /> Manage invites</button></div>
                {:else}
                  <div class="cubic-settings-danger"><div><strong>Leave server</strong><p>Your previous messages remain after you leave.</p></div><button type="button" class="danger-button" onclick={leaveSelectedServer} disabled={serverMembershipBusy}>Leave server</button></div>
                {/if}
                {#if serverMembershipError}<p class="inline-error" role="alert">{serverMembershipError}</p>{/if}
              </section>
            {:else if serverSurface === 'members'}
              <section class="cubic-settings-section" aria-labelledby="cubic-server-members-title">
                <div class="cubic-settings-title"><div><small>SERVER</small><h2 id="cubic-server-members-title">Members · {serverMembers.length}</h2><p>People with access to {activeServer.name}.</p></div><button type="button" class="cubic-settings-secondary cubic-server-member-refresh" onclick={() => refreshServerMembership(activeServer!)}>Refresh</button></div>
                <div class="cubic-settings-member-list">
                  {#each serverMembers as member (member.id)}
                    <div class="cubic-settings-member-row">
                      <button class="cubic-server-member-entry" type="button" aria-label={`Open ${member.displayName}'s profile, ${member.id === activeServer.ownerUserId ? 'owner' : 'member'}`} onclick={() => openProfile(member)}>
                        <span class="avatar cubic-user-avatar-shell">{member.displayName.slice(0,1).toUpperCase()}{#if member.avatarUrl}{#key member.avatarUrl}<img src={member.avatarUrl} alt="" onerror={hideFailedUserAvatar} />{/key}{/if}</span>
                        <span><strong>{member.displayName}</strong><small>@{member.username} · {member.id === activeServer.ownerUserId ? 'Owner' : 'Member'}</small></span>
                      </button>
                      {#if activeServer.ownerUserId === currentUser.id && member.id !== activeServer.ownerUserId}<button class="cubic-server-member-remove" type="button" aria-label={`Remove ${member.displayName} from server`} onclick={(event) => confirmMemberRemoval(member, event)} disabled={serverMembershipBusy}>Remove</button>{/if}
                    </div>
                  {/each}
                  {#if !serverMembers.length}<p class="cubic-settings-empty">No members are available right now.</p>{/if}
                </div>
                {#if serverMembershipError}<p class="inline-error" role="alert">{serverMembershipError} <button type="button" onclick={() => refreshServerMembership(activeServer!)}>Retry</button></p>{/if}
              </section>
            {:else if serverSurface === 'invites' && activeServer.ownerUserId === currentUser.id}
              <section class="cubic-settings-section" aria-labelledby="cubic-server-invites-title">
                <div class="cubic-settings-title"><div><small>SERVER</small><h2 id="cubic-server-invites-title">Invites</h2><p>Invite friends directly or create a seven-day share link.</p></div></div>
                <div class="cubic-settings-card cubic-settings-form-card">
                  <h3>Invite a friend</h3>
                  <form class="cubic-server-create" onsubmit={inviteServerFriend}>
                    <label for="cubic-settings-server-invite-friend">Friend</label>
                    <select id="cubic-settings-server-invite-friend" bind:value={serverInviteTarget} required>
                      <option value="">Choose a friend</option>
                      {#each friends.filter((friend) => friend.id !== currentUser.id && !serverMembers.some((member) => member.id === friend.id) && !pendingServerInvites.some((invite) => invite.invitee.id === friend.id)) as friend (friend.id)}<option value={friend.id}>{friend.displayName} (@{friend.username})</option>{/each}
                    </select>
                    <button type="submit" disabled={serverMembershipBusy || !serverInviteTarget}>Invite friend</button>
                  </form>
                  {#if pendingServerInvites.length}<h3>Pending invitations</h3>{/if}
                  {#each pendingServerInvites as invite (invite.id)}<div class="cubic-server-member-row"><span>{invite.invitee.displayName} · Pending</span><button type="button" aria-label={`Cancel invitation for ${invite.invitee.displayName}`} onclick={() => cancelServerInvite(invite.id)} disabled={serverMembershipBusy}>Cancel</button></div>{/each}
                </div>
                <div class="cubic-settings-card cubic-share-invites" aria-label="Shareable invite links">
                  <h3>Share invite link</h3><p>Anyone with a link can join. Links expire after 7 days. Removing a member does not revoke a link.</p>
                  <button type="button" onclick={createShareInviteLink} disabled={shareInviteBusy}>{shareInviteBusy ? 'Creating…' : 'Create shareable link'}</button>
                  {#if oneTimeInviteUrl}<div class="cubic-share-once"><label for="cubic-settings-share-invite-url">New link — shown only once</label><input id="cubic-settings-share-invite-url" value={oneTimeInviteUrl} readonly onclick={(event) => event.currentTarget.select()} /><div class="cubic-share-actions"><button type="button" onclick={copyShareInviteLink}>Copy link</button>{#if typeof navigator !== 'undefined' && typeof navigator.share === 'function'}<button type="button" onclick={shareInviteLink}>Share link</button>{/if}<button type="button" onclick={() => { oneTimeInviteUrl = ''; shareInviteNotice = ''; }}>Done</button></div><small>After closing this link, it cannot be revealed again. Create a new one if needed.</small></div>{/if}
                  {#if shareInviteNotice}<p role="status">{shareInviteNotice}</p>{/if}
                  {#if shareInviteLinks.length}<h3>Existing links</h3>{/if}
                  {#each shareInviteLinks as link (link.id)}<div class="cubic-share-link-row"><span>Created {new Date(link.createdAt).toLocaleDateString()} · {link.revokedAt ? 'Revoked' : Date.parse(link.expiresAt) <= Date.now() ? 'Expired' : `Expires ${new Date(link.expiresAt).toLocaleDateString()}`}</span>{#if !link.revokedAt && Date.parse(link.expiresAt) > Date.now()}<button type="button" aria-label={`Revoke link created ${new Date(link.createdAt).toLocaleDateString()}`} onclick={() => revokeShareInviteLink(link.id)} disabled={shareInviteBusy}>Revoke</button>{/if}</div>{/each}
                  {#if shareInviteError}<p class="inline-error" role="alert">{shareInviteError} <button type="button" onclick={() => refreshShareInviteLinks(activeServer!)}>Retry</button></p>{/if}
                </div>
                {#if serverMembershipError}<p class="inline-error" role="alert">{serverMembershipError} <button type="button" onclick={() => refreshServerMembership(activeServer!)}>Retry</button></p>{/if}
              </section>
            {/if}
          </div>
        </div>
      </section>
    {:else if activeServer && channelSettingsTarget}
      {@const settingsChannel = channelSettingsChannel()}
      {#if settingsChannel}
        {@const settingsScope = channelsInScope(settingsChannel.categoryId)}
        {@const settingsIndex = settingsScope.findIndex((item) => item.kind === settingsChannel.kind && item.id === settingsChannel.id)}
        <section class="cubic-server-settings-surface cubic-channel-settings-surface" aria-label={`${settingsChannel.name} channel settings`}>
          <header class="chat-header"><button class="chat-back" type="button" aria-label="Back to server" onclick={closeChannelSettings}><Icon name="back" size={24} /></button><div class="chat-heading"><strong>{settingsChannel.name}</strong><small>{settingsChannel.kind === 'voice' ? 'Voice channel settings' : 'Text channel settings'}</small></div><button class="chat-meta-button" type="button" aria-label="Close channel settings" onclick={closeChannelSettings}><Icon name="x" size={19} /></button></header>
          <div class="cubic-channel-settings-content">
            <div class="cubic-settings-title"><div><small>{settingsChannel.kind === 'voice' ? 'VOICE CHANNEL' : 'TEXT CHANNEL'}</small><h2>{settingsChannel.name}</h2><p>Only controls supported by the current Cubic server model are shown here.</p></div></div>
            {#if settingsChannel.kind === 'voice'}
              <form class="cubic-settings-card cubic-settings-form-card" onsubmit={saveVoiceChannelSettings}><label for="cubic-channel-settings-name">Channel name</label><div class="cubic-settings-inline-form"><input id="cubic-channel-settings-name" bind:value={channelSettingsName} maxlength="96" /><button type="submit" disabled={channelSettingsBusy || !channelSettingsName.trim() || channelSettingsName.trim() === settingsChannel.name}>Save name</button></div></form>
            {:else}
              <div class="cubic-settings-card"><div class="cubic-settings-row"><div><strong>Channel name</strong><small>Text-channel renaming is not implemented yet.</small></div><span>{settingsChannel.name}</span></div></div>
            {/if}
            <form class="cubic-settings-card cubic-settings-form-card" onsubmit={saveChannelSettingsCategory}><label for="cubic-channel-settings-category">Category</label><select id="cubic-channel-settings-category" bind:value={channelSettingsCategoryId}><option value="">Uncategorized</option>{#each serverCategories as category (category.id)}<option value={category.id}>{category.name}</option>{/each}</select><button type="submit" disabled={channelSettingsBusy || channelSettingsCategoryId === (settingsChannel.categoryId ?? '')}>{channelSettingsBusy ? 'Moving…' : 'Move to category'}</button></form>
            <div class="cubic-settings-card"><div class="cubic-settings-row cubic-settings-order-row"><div><strong>Channel order</strong><small>Move within the current category.</small></div><div class="cubic-settings-order-actions"><button type="button" disabled={layoutBusy || channelSettingsBusy || settingsIndex <= 0} onclick={() => void shiftChannel(settingsChannel, -1)}>Move up</button><button type="button" disabled={layoutBusy || channelSettingsBusy || settingsIndex < 0 || settingsIndex >= settingsScope.length - 1} onclick={() => void shiftChannel(settingsChannel, 1)}>Move down</button></div></div></div>
            {#if channelSettingsError}<p class="inline-error" role="alert">{channelSettingsError}</p>{/if}
            {#if layoutError}<p class="inline-error" role="alert">{layoutError}</p>{/if}
          </div>
        </section>
      {:else}
        <section class="cubic-server-settings-surface"><header class="chat-header"><button class="chat-back" type="button" aria-label="Back to server" onclick={closeChannelSettings}><Icon name="back" size={24} /></button><div class="chat-heading"><strong>Channel unavailable</strong><small>Server settings</small></div></header><div class="cubic-server-foundation-copy"><p>This channel is no longer available.</p><button type="button" onclick={closeChannelSettings}>Back to server</button></div></section>
      {/if}
    {:else if activeConversation}
      <header class="chat-header">
        <button class="chat-back" type="button" aria-label={activeConversation.kind === 'server_text' ? 'Back to server' : 'Back to conversations'} title="Back" onclick={closeConversation}><Icon name="back" size={24} /></button>
        {#if activeConversation.kind === 'direct' && activeConversation.peer}
          <button class="cubic-profile-header-opener" type="button" aria-label={`Open ${activeConversation.peer.displayName}'s profile`} onclick={() => openProfile(activeConversation.peer)}>
            <span class="avatar cubic-user-avatar-shell">{conversationLetter(activeConversation)}{#if activeConversation.peer.avatarUrl}{#key activeConversation.peer.avatarUrl}<img src={activeConversation.peer.avatarUrl} alt="" onerror={hideFailedUserAvatar} />{/key}{/if}</span>
          </button>
        {:else if activeConversation.avatarUrl ?? groupDetails?.avatarUrl}
          <img class="avatar group-avatar avatar-image" src={activeConversation.avatarUrl ?? groupDetails?.avatarUrl} alt="" />
        {:else}
          <span class="avatar group-avatar">{conversationLetter(activeConversation)}</span>
        {/if}
        <div class="chat-heading">
          <strong>{conversationName(activeConversation)}</strong>
          <small>{activeConversation.kind === 'server_text' ? `Text channel · ${activeServer?.name ?? 'Server'}` : activeConversation.kind === 'group' ? `${activeConversation.memberCount ?? groupDetails?.members?.length ?? 0} members` : `@${activeConversation.peer?.username ?? ''}`}</small>
        </div>
        <button class="chat-meta-button cubic-mobile-user-settings-trigger" type="button" aria-label="User Settings" title="User Settings" onclick={() => userSettingsOpen = true}><Icon name="settings" size={19} /></button>
        {#if activeConversation.kind === 'group'}
          <button class="chat-meta-button" type="button" aria-label="Group settings" title="Group settings" onclick={() => { memberPanelOpen = false; groupPanelOpen = !groupPanelOpen; if (groupPanelOpen) refreshGroupDetails().catch(() => {}); }}>
            <Icon name="settings" size={19} />
          </button>
        {/if}
        {#if activeConversation.kind !== 'server_text'}
          <button class="chat-meta-button" type="button" aria-label="Members" title="Members" aria-expanded={memberPanelOpen} onclick={() => { groupPanelOpen = false; memberPanelOpen = !memberPanelOpen; if (memberPanelOpen && realtimeSocket) requestPresenceSnapshot(realtimeSocket); }}>
            <Icon name="users" size={19} />
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
        {:else if activeConversation.kind === 'group'}
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

      {#if voiceStatus !== 'idle' && !activeServerVoiceId && mediaStageVisible()}
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
          {@const inviteToken = messageInviteToken(message, activeConversation?.kind, trustedInviteOrigin)}
          {#if showMessageDateDivider(index)}
            <div class="message-date-divider" aria-label={formatMessageDay(message.createdAt)}>
              <span>{formatMessageDay(message.createdAt)}</span>
            </div>
          {/if}

          <article
            id={`message-${message.id}`}
            class="discord-message"
            class:continuation={isMessageContinuation(index)}
            class:mine={message.senderId === data.user.id}
            class:cubic-message-highlight={highlightedMessageId === message.id}
          >
            <div class="discord-message-gutter">
              {#if !isMessageContinuation(index)}
                <span class="discord-message-avatar fallback cubic-user-avatar-shell">
                  {messageSenderInitial(message)}
                  {#if message.senderAvatarUrl}{#key message.senderAvatarUrl}<img src={message.senderAvatarUrl} alt="" loading="lazy" onerror={hideFailedUserAvatar} />{/key}{/if}
                </span>
              {:else}
                <time class="discord-message-hover-time" datetime={message.createdAt}>
                  {formatMessageTime(message.createdAt)}
                </time>
              {/if}
            </div>

            <div class="discord-message-content">
              {#if !isMessageContinuation(index)}
                <header class="discord-message-header">
                  <button class="cubic-profile-author" type="button" aria-label={`Open ${messageSenderName(message)}'s profile`} onclick={() => openProfile({ id: message.senderId, username: message.senderUsername ?? '', displayName: messageSenderName(message), avatarUrl: message.senderAvatarUrl ?? null })}><strong>{messageSenderName(message)}</strong></button>
                  {#if message.senderId === data.user.id}
                    <span class="discord-you">you</span>
                  {/if}
                  <time datetime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
                </header>
              {/if}

              {#if message.replyTo}
                <button
                  class="cubic-message-reply-preview"
                  type="button"
                  aria-label={`Go to message from ${message.replyTo.senderDisplayName}`}
                  title="Go to replied-to message"
                  onclick={() => scrollToReplyTarget(message.replyTo.id)}
                >
                  <strong>{message.replyTo.senderDisplayName}</strong>
                  <span>{replyPreviewLabel(message.replyTo)}</span>
                </button>
              {/if}

              <div class="discord-message-body" class:deleted={Boolean(message.deletedAt)}>
                {message.deletedAt ? 'Message deleted' : message.body}
                {#if !message.deletedAt && message.editedAt}
                  <span class="cubic-message-edited">(edited)</span>
                {/if}
              </div>

              {#if inviteToken}
                {#key inviteToken}
                  <ServerInviteCard
                    token={inviteToken}
                    queue={invitePreviewQueue}
                    onJoined={() => { void refreshServers(); }}
                    onGoToServer={(serverId) => { void openServerFromInvite(serverId, message.conversationId); }}
                  />
                {/key}
              {/if}

              {#if !message.deletedAt && attachmentsOf(message).length > 0}
                <MessageAttachments attachments={attachmentsOf(message)} />
              {/if}

              {#if !message.deletedAt && reactionsOf(message).length > 0}
                <div class="cubic-message-reactions" aria-label="Message reactions">
                  {#each reactionsOf(message) as reaction (reaction.reaction)}
                    <button
                      type="button"
                      class:selected={reaction.reactedByCurrentUser}
                      aria-pressed={reaction.reactedByCurrentUser}
                      aria-label={`${REACTION_LABELS[reaction.reaction] ?? reaction.reaction}, ${reaction.count} ${reaction.count === 1 ? 'reaction' : 'reactions'}${reaction.reactedByCurrentUser ? ', selected' : ''}`}
                      title={reaction.reactedByCurrentUser ? 'Remove your reaction' : 'Add this reaction'}
                      disabled={Boolean(reactionBusyKey)}
                      onclick={() => void toggleReaction(message, reaction.reaction)}
                    >
                      <span aria-hidden="true">{reaction.reaction}</span>
                      <strong>{reaction.count}</strong>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>

            {#if !message.deletedAt}
              <MessageActions
                own={message.senderId === data.user.id}
                open={actionMenuMessageId === message.id}
                reactionOpen={reactionPickerMessageId === message.id}
                selectedReactions={reactionsOf(message).filter((reaction) => reaction.reactedByCurrentUser).map((reaction) => reaction.reaction)}
                onreply={() => void startReply(message)}
                onedit={() => void startEdit(message)}
                ondelete={() => void requestDelete(message)}
                onreaction={(reaction) => void toggleReaction(message, reaction)}
                ontogglereactions={() => {
                  actionMenuMessageId = null;
                  reactionPickerMessageId = reactionPickerMessageId === message.id ? null : message.id;
                }}
                ontoggle={() => {
                  reactionPickerMessageId = null;
                  actionMenuMessageId = actionMenuMessageId === message.id ? null : message.id;
                }}
              />
            {/if}
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

      {#if editingMessageId || replyingTo}
        <div class="cubic-message-composer-banner" aria-live="polite">
          {#if editingMessageId}
            <Icon name="edit" size={16} />
            <span><strong>Editing message</strong><small>Attachments will stay unchanged.</small></span>
            <button type="button" aria-label="Cancel editing" title="Cancel editing" onclick={() => void cancelEdit()}>
              <Icon name="x" size={16} />
            </button>
          {:else if replyingTo}
            <Icon name="reply" size={16} />
            <span>
              <strong>Replying to {replyingTo.senderDisplayName}</strong>
              <small>{replyPreviewLabel(replyingTo)}</small>
            </span>
            <button
              type="button"
              aria-label="Cancel reply"
              title="Cancel reply"
              onclick={() => {
                replyingTo = null;
                void tick().then(() => messageInput?.focus());
              }}
            >
              <Icon name="x" size={16} />
            </button>
          {/if}
        </div>
      {/if}

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
                <progress
                  class="cubic-upload-progress"
                  max="100"
                  value={item.progress}
                  aria-label={`Uploading ${item.fileName}: ${item.progress}%`}
                ></progress>
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
          submitComposer();
        }}
        onpaste={(event) => {
          if (!editingMessageId) handleAttachmentPaste(event);
        }}
        ondragover={(event) => {
          if (!editingMessageId && event.dataTransfer?.types.includes('Files')) {
            event.preventDefault();
          }
        }}
        ondrop={(event) => {
          if (!editingMessageId) handleAttachmentDrop(event);
        }}
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
          title={editingMessageId ? 'Attachments cannot be changed while editing' : 'Add attachment'}
          disabled={busy || Boolean(editingMessageId) || stagedUploadPending()}
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
          bind:this={messageInput}
          bind:value={messageBody}
          maxlength="8000"
          autocomplete="off"
          placeholder={editingMessageId ? 'Edit message…' : 'Message…'}
        />

        <button
          type="submit"
          aria-label={editingMessageId ? 'Save message' : 'Send message'}
          title={editingMessageId ? 'Save edit' : stagedUploadPending() ? 'Wait for attachments to finish uploading' : 'Send'}
          disabled={composerSubmitDisabled()}
        >
          <Icon name={editingMessageId ? 'check' : 'send'} size={18} />
        </button>
      </form>

      {#if deleteCandidate}
        <dialog
          class="cubic-message-delete-dialog"
          bind:this={deleteDialog}
          aria-labelledby="cubic-message-delete-title"
          oncancel={(event) => {
            event.preventDefault();
            closeDeleteDialog();
          }}
          onclose={() => {
            deleteCandidate = null;
            deleteDialog = null;
          }}
        >
          <h2 id="cubic-message-delete-title">Delete message?</h2>
          <p>This message will be shown as deleted. Replies to it will remain in the conversation.</p>
          <div>
            <button class="cubic-message-delete-cancel" type="button" disabled={busy} onclick={closeDeleteDialog}>Cancel</button>
            <button class="danger" type="button" disabled={busy} onclick={() => void confirmDeleteMessage()}>
              {busy ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </dialog>
      {/if}

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
      {#if memberPanelOpen && activeConversation.kind !== 'server_text'}
        <MemberPanel
          title={activeConversation.kind === 'group' ? 'Group members' : 'Conversation member'}
          members={memberPanelMembers()}
          statuses={memberPresence}
          onclose={() => memberPanelOpen = false}
          onmemberclick={openProfile}
        />
      {/if}
    {:else if activeServer}
      <section class="cubic-server-foundation" aria-label={`Server: ${activeServer.name}`}>
        <header class="chat-header">
          <button class="chat-back" type="button" aria-label="Back to servers" onclick={() => activeServer = null}><Icon name="back" size={24} /></button>
          <div class="chat-heading"><strong>{activeServer.name}</strong><small>Server</small></div>
        </header>
        <div class="cubic-server-foundation-copy">
          <Icon name="message" size={30} />
          <h2>{serverChannels.length ? `Welcome to ${activeServer.name}` : activeServer.name}</h2>
          <p>{serverChannels.length ? 'Choose a text channel from the sidebar.' : 'This server does not have channels yet. Your existing chats and groups remain available.'}</p>
        </div>
      </section>
    {:else}
      <div class="chat-placeholder"><img src="/images/cubic-w-nobg.png" alt="" /><h2>Your Cubic conversations</h2><p>Select a chat, or create a group with your friends.</p></div>
    {/if}
    {#if activeServer && serverMembersOpen}
      <aside class="cubic-server-member-pane" aria-label={`Members of ${activeServer.name}`}>
        <header><div><small>SERVER</small><h2>Members · {serverMembers.length}</h2></div><button type="button" aria-label="Close server members" onclick={closeServerMembers}><Icon name="x" size={18} /></button></header>
        <div class="cubic-server-member-scroll">
          <button type="button" class="cubic-server-member-refresh" onclick={() => refreshServerMembership(activeServer!)}>Refresh members</button>
          {#each serverMembers as member (member.id)}
            <div class="cubic-server-member-row-entry">
              <button class="cubic-server-member-entry" type="button" aria-label={`Open ${member.displayName}'s profile, ${member.id === activeServer.ownerUserId ? 'owner' : 'member'}`} onclick={() => openProfile(member)}>
                <span class="avatar cubic-user-avatar-shell">{member.displayName.slice(0,1).toUpperCase()}{#if member.avatarUrl}{#key member.avatarUrl}<img src={member.avatarUrl} alt="" onerror={hideFailedUserAvatar} />{/key}{/if}</span>
                <span><strong>{member.displayName}</strong><small>{member.id === activeServer.ownerUserId ? 'Owner' : 'Member'}</small></span>
              </button>
              {#if activeServer.ownerUserId === currentUser.id && member.id !== activeServer.ownerUserId}
                <button class="cubic-server-member-remove" type="button" aria-label={`Remove ${member.displayName} from server`} title="Remove from server" onclick={(event) => confirmMemberRemoval(member, event)} disabled={serverMembershipBusy}>Remove</button>
              {/if}
            </div>
          {/each}
          {#if serverMembershipError}<p class="inline-error" role="alert">{serverMembershipError}</p>{/if}
        </div>
      </aside>
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

  {#if activeServerVoiceId && voiceStatus !== 'idle' && mediaStageVisible() && !serverVoiceStageCollapsed}
    <section class="video-stage cubic-server-voice-stage" class:presentation-mode={Boolean(focusedScreenShareParticipant())} bind:this={videoStageElement} aria-label="Server voice media">
      <header class="video-stage-head">
        <Icon name={focusedScreenShareParticipant() ? 'screen-share' : 'camera'} size={18} />
        <div>
          <strong>{focusedScreenShareParticipant() ? `${focusedScreenShareParticipant()?.name} is sharing` : voiceConversationTitle}</strong>
          <small>{voiceParticipants.length} connected · {voiceParticipants.filter((participant) => participant.cameraEnabled).length} cameras · {activeScreenShares().length} shares</small>
        </div>
        {#if focusedVideoIdentity || focusedScreenShareIdentity}
          <button class="video-stage-action" type="button" aria-label="Return to grid" onclick={returnToMediaGrid}><Icon name="users" size={18} /></button>
        {/if}
        {#if activeScreenShares().length > 1}
          <button class="video-stage-action" type="button" aria-label="Next screen share" onclick={focusNextScreenShare}><Icon name="screen-share" size={18} /></button>
        {/if}
        <button class="video-stage-action" type="button" aria-label="Minimize media stage" onclick={() => serverVoiceStageCollapsed = true}><Icon name="chevron-down" size={18} /></button>
        <button class="video-stage-action" type="button" aria-label="Voice and video settings" onclick={showMediaSettings}><Icon name="settings" size={18} /></button>
        <button class="video-stage-action" type="button" aria-label="Fullscreen media" onclick={fullscreenVideoStage}><Icon name="maximize" size={18} /></button>
      </header>
      {#if focusedScreenShareParticipant()}
        <div class="presentation-layout">
          <div class="presentation-main">
            <ScreenShareTile track={focusedScreenShareParticipant()?.screenShareTrack} name={focusedScreenShareParticipant()?.name ?? 'Member'} local={focusedScreenShareParticipant()?.local ?? false} focused={true} onclick={returnToMediaGrid} oncontextmenu={(event) => {
              const participant = focusedScreenShareParticipant();
              if (participant) openStreamVolumeMenu(event, participant);
            }} />
          </div>
          <div class="presentation-filmstrip" aria-label="Voice participants">
            {#each activeScreenShares().filter((participant) => participant.identity !== focusedScreenShareIdentity) as participant (`share-${participant.identity}`)}
              <ScreenShareTile track={participant.screenShareTrack} name={participant.name} local={participant.local} focused={false} onclick={() => focusScreenShare(participant.identity)} oncontextmenu={(event) => openStreamVolumeMenu(event, participant)} />
            {/each}
            {#each voiceParticipants as participant (participant.identity)}
              <VideoTile track={participant.videoTrack} name={participant.name} local={participant.local} speaking={participant.speaking} cameraEnabled={participant.cameraEnabled} focused={false} onclick={() => toggleVideoFocus(participant.identity)} />
            {/each}
          </div>
        </div>
      {:else}
        <div class="video-grid" class:has-focus={Boolean(focusedVideoIdentity)} class:participants-1={voiceParticipants.length === 1 && activeScreenShares().length === 0} class:participants-2={voiceParticipants.length + activeScreenShares().length === 2}>
          {#each activeScreenShares() as participant (`share-${participant.identity}`)}
            <ScreenShareTile track={participant.screenShareTrack} name={participant.name} local={participant.local} focused={false} onclick={() => focusScreenShare(participant.identity)} oncontextmenu={(event) => openStreamVolumeMenu(event, participant)} />
          {/each}
          {#each voiceParticipants as participant (participant.identity)}
            <VideoTile track={participant.videoTrack} name={participant.name} local={participant.local} speaking={participant.speaking} cameraEnabled={participant.cameraEnabled} focused={focusedVideoIdentity === participant.identity} onclick={() => toggleVideoFocus(participant.identity)} />
          {/each}
        </div>
      {/if}
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
          <strong>{voiceConversationTitle || voiceRetryServerChannel?.name || (voiceRetryConversation ? conversationName(voiceRetryConversation) : 'Voice')}</strong>
          <small role="status" aria-live="polite">
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
          {#if activeServerVoiceId && serverVoiceStageCollapsed && mediaStageVisible()}
            <button class="voice-settings-button" type="button" aria-label="Show media stage" onclick={() => serverVoiceStageCollapsed = false}><Icon name="camera" size={17} /></button>
          {/if}
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
            <label class="cubic-voice-processing-option">
              <input type="checkbox" checked={browserVoiceProcessing} onchange={(event) => setBrowserVoiceProcessing(event.currentTarget.checked)} />
              <span><strong>Browser voice processing</strong><small>Echo cancellation, noise suppression and automatic gain when supported.</small></span>
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
            aria-pressed={voiceMuted}
            aria-label={voiceMuted ? 'Unmute microphone' : 'Mute microphone'}
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
            aria-pressed={voiceDeafened}
            aria-label={voiceDeafened ? 'Undeafen audio' : 'Deafen audio'}
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
          <button class="voice-leave" type="button" title="Disconnect" aria-label={activeServerVoiceId ? 'Leave voice channel' : 'Disconnect from call'} onclick={() => leaveVoice()}>
            <Icon name="phone-off" size={18} /><span>Leave</span>
          </button>
        </div>
      {/if}

      {#if voiceMediaNotice}
        <div class="voice-media-notice" role="status">
          {voiceMediaNotice}
          {#if voiceMediaNotice.startsWith('Browser audio playback is paused')}
            <button type="button" onclick={enableVoiceAudio}>Enable audio</button>
          {/if}
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
        <div class="inline-error voice-error" role="alert">{voiceError}</div>
        {#if voiceStatus === 'idle'}
          <div class="voice-dock-actions">
            {#if voiceRetryConversation}
              <button type="button" onclick={() => joinVoice(voiceRetryConversation)}>Retry voice</button>
            {/if}
            {#if voiceRetryServerChannel}
              <button type="button" onclick={() => joinServerVoice(voiceRetryServerChannel!)}>Retry voice channel</button>
            {/if}
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
      class:top-left={streamVolumeMenu.placement === 'top-left'}
      class:top-right={streamVolumeMenu.placement === 'top-right'}
      class:bottom-left={streamVolumeMenu.placement === 'bottom-left'}
      class:bottom-right={streamVolumeMenu.placement === 'bottom-right'}
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
{#if selectedProfile}
  <ProfileCard
    profile={selectedProfile}
    onclose={() => selectedProfile = null}
  />
{/if}
