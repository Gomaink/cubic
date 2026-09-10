<script lang="ts">
  let { data } = $props();
</script>

<svelte:head>
  <title>Cubic v2 — Realtime messenger</title>
  <meta
    name="description"
    content="Cubic is a lightweight self-hosted messenger being rebuilt for groups, voice rooms and screen sharing."
  />
</svelte:head>

<main class="shell landing-shell">
  <nav class="topbar">
    <a class="brand" href="/" aria-label="Cubic home">
      <img src="/images/cubic-w-nobg.png" alt="" />
      <span>Cubic</span>
    </a>
    <div class="nav-actions">
      {#if data.user}
        <span class="nav-user">@{data.user.username}</span>
        <a class="button button-primary button-small" href="/app">Open Cubic</a>
      {:else}
        <a class="button button-ghost button-small" href="/login">Log in</a>
        <a class="button button-primary button-small" href="/register">Create account</a>
      {/if}
    </div>
  </nav>

  <section class="hero hero-alpha2">
    <p class="eyebrow">v2.0.0-alpha.3 · conversation engine</p>
    <h1>Your conversations are now live.</h1>
    <p class="lead">
      Cubic now has a server-authoritative social graph, canonical direct messages,
      persistent history and authenticated realtime delivery between devices.
    </p>

    <div class="hero-actions">
      {#if data.user}
        <a class="button button-primary" href="/app">Continue as {data.user.displayName}</a>
      {:else}
        <a class="button button-primary" href="/register">Create a Cubic account</a>
        <a class="button button-ghost" href="/login">I already have one</a>
      {/if}
    </div>

    <div class="status-card" class:online={data.apiReachable}>
      <span class="status-dot" aria-hidden="true"></span>
      <div>
        <strong>{data.apiReachable ? 'Conversation engine online' : 'Web online · API unavailable'}</strong>
        <span>
          {#if data.health}
            API {data.health.version} · PostgreSQL {data.health.database} · auth {data.health.auth ?? 'starting'}
          {:else}
            Start the API and PostgreSQL to complete the stack.
          {/if}
        </span>
      </div>
    </div>
  </section>

  <section class="feature-grid" aria-label="Alpha 3 capabilities">
    <article class="feature-card">
      <span class="feature-index">01</span>
      <h2>Social graph</h2>
      <p>Search, friend requests, friendships and blocks now run on server-authoritative identity.</p>
    </article>
    <article class="feature-card">
      <span class="feature-index">02</span>
      <h2>Canonical direct messages</h2>
      <p>Each pair of users shares one direct conversation with membership-based authorization and durable history.</p>
    </article>
    <article class="feature-card">
      <span class="feature-index">03</span>
      <h2>Authenticated realtime</h2>
      <p>Socket.IO resolves the existing server session and delivers new messages instantly to conversation members.</p>
    </article>
    <article class="feature-card">
      <span class="feature-index">04</span>
      <h2>Mobile-resilient UI</h2>
      <p>The messenger resynchronizes after mobile tab suspension and keeps landing/auth pages independently scrollable.</p>
    </article>
  </section>

  <section class="next next-wide">
    <p class="eyebrow">Next milestone</p>
    <h2>alpha.4 — groups & permissions</h2>
    <p>Group creation, membership management, roles, permissions, invites and the first group-ready media boundary.</p>
  </section>
</main>
