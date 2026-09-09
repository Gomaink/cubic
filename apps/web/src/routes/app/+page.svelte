<script lang="ts">
  let { data } = $props();
  let loggingOut = $state(false);

  async function logout() {
    loggingOut = true;
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
    } finally {
      window.location.assign('/login');
    }
  }
</script>

<svelte:head><title>Cubic — {data.user.displayName}</title></svelte:head>

<main class="app-shell">
  <aside class="app-sidebar">
    <a class="brand" href="/">
      <img src="/images/cubic-w-nobg.png" alt="" />
      <span>Cubic</span>
    </a>
    <div class="sidebar-spacer"></div>
    <button class="button button-ghost button-full" onclick={logout} disabled={loggingOut}>
      {loggingOut ? 'Logging out…' : 'Log out'}
    </button>
  </aside>

  <section class="app-content">
    <div class="app-kicker">
      <span class="status-dot"></span>
      authenticated session
    </div>
    <h1>Hi, {data.user.displayName}.</h1>
    <p class="lead app-lead">
      Your Cubic v2 identity is live. The conversation engine lands in alpha.3; this screen proves that login,
      session recovery and protected routing are already working end to end.
    </p>

    <div class="identity-card">
      <div class="identity-avatar">
        {data.user.displayName.slice(0, 1).toUpperCase()}
      </div>
      <div class="identity-copy">
        <strong>{data.user.displayName}</strong>
        <span>@{data.user.username}</span>
      </div>
      <span class="identity-badge">SESSION VERIFIED</span>
    </div>

    <div class="app-grid">
      <article class="feature-card">
        <span class="feature-index">AUTH</span>
        <h2>HttpOnly session</h2>
        <p>The protected page resolves your identity from the server instead of a browser-supplied user ID.</p>
      </article>
      <article class="feature-card muted-card">
        <span class="feature-index">NEXT</span>
        <h2>Conversations</h2>
        <p>DMs and groups will share one conversation model, built directly on this identity layer.</p>
      </article>
    </div>
  </section>
</main>
