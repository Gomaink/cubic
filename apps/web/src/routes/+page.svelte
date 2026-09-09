<script lang="ts">
  let { data } = $props();
</script>

<svelte:head>
  <title>Cubic v2 — Identity online</title>
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
    <p class="eyebrow">v2.0.0-alpha.2 · identity & security</p>
    <h1>Your identity now belongs to the server.</h1>
    <p class="lead">
      Cubic now has real PostgreSQL accounts, persistent sessions, Argon2id passwords and
      authorization boundaries ready for the conversation engine.
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
        <strong>{data.apiReachable ? 'Identity layer online' : 'Web online · API unavailable'}</strong>
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

  <section class="feature-grid" aria-label="Alpha 2 capabilities">
    <article class="feature-card">
      <span class="feature-index">01</span>
      <h2>Server-authoritative identity</h2>
      <p>Writes will derive the user from the authenticated session instead of trusting IDs sent by the browser.</p>
    </article>
    <article class="feature-card">
      <span class="feature-index">02</span>
      <h2>Persistent sessions</h2>
      <p>Random session tokens live in HttpOnly cookies; only token digests are persisted in PostgreSQL.</p>
    </article>
    <article class="feature-card">
      <span class="feature-index">03</span>
      <h2>Legacy-friendly migration</h2>
      <p>Imported bcrypt accounts can log in once and transparently move to Argon2id.</p>
    </article>
    <article class="feature-card">
      <span class="feature-index">04</span>
      <h2>Ready for conversations</h2>
      <p>The next alpha attaches messages, groups and realtime events to this trusted identity boundary.</p>
    </article>
  </section>

  <section class="next next-wide">
    <p class="eyebrow">Next milestone</p>
    <h2>alpha.3 — conversation engine</h2>
    <p>Conversation membership, DMs, group-ready messages, cursor pagination and authenticated realtime.</p>
  </section>
</main>
