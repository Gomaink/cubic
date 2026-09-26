<script lang="ts">
  import { onMount } from 'svelte';

  type SessionView = {
    id: string;
    current: boolean;
    client: string;
    createdAt: string;
    lastSeenAt: string;
    expiresAt: string;
  };

  let sessions = $state<SessionView[]>([]);
  let loading = $state(true);
  let error = $state('');
  let pendingAction = $state<string | null>(null);

  const dateTime = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  function formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Unknown' : dateTime.format(date);
  }

  async function request(path: string, init: RequestInit = {}) {
    const response = await fetch(path, { credentials: 'include', ...init });
    if (response.status === 401) {
      window.location.assign('/login');
      throw new Error('Authentication required.');
    }
    if (!response.ok) throw new Error('Session management is temporarily unavailable. Please try again.');
    return response;
  }

  async function loadSessions() {
    loading = true;
    error = '';
    try {
      const response = await request('/api/v1/auth/sessions');
      const payload = await response.json() as { sessions?: SessionView[] };
      sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
    } catch (caught) {
      error = caught instanceof Error && caught.message === 'Authentication required.'
        ? ''
        : 'Unable to load active sessions. Please try again.';
    } finally {
      loading = false;
    }
  }

  async function revokeSession(session: SessionView) {
    const prompt = session.current
      ? 'Log out this session? Every tab using it will be signed out.'
      : `Revoke ${session.client}? Every tab using that session will be signed out.`;
    if (!window.confirm(prompt)) return;

    pendingAction = session.id;
    error = '';
    try {
      await request(`/api/v1/auth/sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE' });
      if (session.current) {
        window.location.assign('/login');
        return;
      }
      await loadSessions();
    } catch (caught) {
      if (caught instanceof Error && caught.message !== 'Authentication required.') {
        error = 'Unable to revoke that session. Please try again.';
      }
    } finally {
      pendingAction = null;
    }
  }

  async function revokeOthers() {
    if (!window.confirm('Log out all other sessions? This session will stay signed in.')) return;
    pendingAction = 'others';
    error = '';
    try {
      await request('/api/v1/auth/sessions/others', { method: 'DELETE' });
      await loadSessions();
    } catch (caught) {
      if (caught instanceof Error && caught.message !== 'Authentication required.') {
        error = 'Unable to revoke other sessions. Please try again.';
      }
    } finally {
      pendingAction = null;
    }
  }

  async function logoutEverywhere() {
    if (!window.confirm('Log out everywhere? Every Cubic session for this account will be revoked.')) return;
    pendingAction = 'all';
    error = '';
    try {
      await request('/api/v1/auth/sessions', { method: 'DELETE' });
      window.location.assign('/login');
    } catch (caught) {
      if (caught instanceof Error && caught.message !== 'Authentication required.') {
        error = 'Unable to log out everywhere. Please try again.';
      }
    } finally {
      pendingAction = null;
    }
  }

  onMount(() => {
    void loadSessions();
  });
</script>

<section class="cubic-session-panel" aria-labelledby="cubic-session-title">
    <header class="cubic-session-header">
      <div>
        <small>ACCOUNT SECURITY</small>
        <h2 id="cubic-session-title">Active sessions</h2>
        <p>Review the browsers and devices currently signed in to Cubic.</p>
      </div>
    </header>

    <div class="cubic-session-content" aria-busy={loading}>
      {#if loading}
        <div class="cubic-session-state" role="status">Loading active sessions…</div>
      {:else if error && sessions.length === 0}
        <div class="cubic-session-state cubic-session-error" role="alert">
          <span>{error}</span>
          <button type="button" onclick={loadSessions}>Retry</button>
        </div>
      {:else if sessions.length === 0}
        <div class="cubic-session-state">No active sessions were found.</div>
      {:else}
        <div class="cubic-session-list">
          {#each sessions as session (session.id)}
            <article class="cubic-session-row" class:current={session.current}>
              <div class="cubic-session-row-main">
                <div class="cubic-session-client">
                  <strong>{session.client}</strong>
                  {#if session.current}<span>Current session</span>{/if}
                </div>
                <dl>
                  <div><dt>Created</dt><dd>{formatDate(session.createdAt)}</dd></div>
                  <div><dt>Last active</dt><dd>Approximately {formatDate(session.lastSeenAt)}</dd></div>
                  <div><dt>Expires</dt><dd>{formatDate(session.expiresAt)}</dd></div>
                </dl>
              </div>
              <button
                type="button"
                class:danger={session.current}
                disabled={pendingAction !== null}
                onclick={() => revokeSession(session)}
              >
                {pendingAction === session.id ? 'Working…' : session.current ? 'Log out this session' : 'Revoke'}
              </button>
            </article>
          {/each}
        </div>
      {/if}

      {#if error && sessions.length > 0}<p class="cubic-session-inline-error" role="alert">{error}</p>{/if}
    </div>

    <footer class="cubic-session-footer">
      <button
        type="button"
        disabled={pendingAction !== null || sessions.filter((session) => !session.current).length === 0}
        onclick={revokeOthers}
      >
        {pendingAction === 'others' ? 'Working…' : 'Log out all other sessions'}
      </button>
      <button type="button" class="danger" disabled={pendingAction !== null} onclick={logoutEverywhere}>
        {pendingAction === 'all' ? 'Working…' : 'Log out everywhere'}
      </button>
    </footer>
</section>
