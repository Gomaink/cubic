<script lang="ts">
  let { data } = $props();
</script>

<svelte:head>
  <title>Cubic v2 — Realtime messenger</title>
  <meta
    name="description"
    content="Cubic is a self-hosted messenger for conversations, communities, voice and video."
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
    <p class="eyebrow">{data.health ? `v${data.health.version}` : 'Cubic early access'} · self-hosted messenger</p>
    <h1>Your space to talk, together.</h1>
    <p class="lead">
      Keep your conversations and communities on infrastructure you control.
      Message friends, join server channels, and move into voice or video when words are not enough.
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
        <strong>{data.apiReachable ? 'Cubic is available' : 'Messaging is temporarily unavailable'}</strong>
        <span>
          {data.apiReachable ? 'Open the app to start a conversation.' : 'Please try again in a moment.'}
        </span>
      </div>
    </div>
  </section>

  <section class="feature-grid" aria-label="What you can do with Cubic">
    <article class="feature-card">
      <span class="feature-index">01</span>
      <h2>Messaging</h2>
      <p>Direct messages and groups with replies, reactions, attachments and history that stays with you.</p>
    </article>
    <article class="feature-card">
      <span class="feature-index">02</span>
      <h2>Servers</h2>
      <p>Bring people together in text and voice channels, manage members and share invite links.</p>
    </article>
    <article class="feature-card">
      <span class="feature-index">03</span>
      <h2>Voice &amp; media</h2>
      <p>Talk, turn on your camera or share your screen. Choose media settings that work for your device.</p>
    </article>
    <article class="feature-card">
      <span class="feature-index">04</span>
      <h2>Account security</h2>
      <p>Manage sessions, verify or change your email, recover your password and use passkeys.</p>
    </article>
    <article class="feature-card">
      <span class="feature-index">05</span>
      <h2>Across your browsers</h2>
      <p>A responsive web experience for desktop and mobile, with your conversations kept in sync.</p>
    </article>
    <article class="feature-card">
      <span class="feature-index">06</span>
      <h2>Self-hosted</h2>
      <p>Run Cubic on your own infrastructure and keep control of your service and data.</p>
    </article>
  </section>

  <section class="next next-wide">
    <p class="eyebrow">Early access</p>
    <h2>Built for real conversations. Still in alpha.</h2>
    <p>Cubic is actively evolving. Browser and device capabilities can vary, especially for calls, screen sharing and passkeys.</p>
  </section>
</main>
