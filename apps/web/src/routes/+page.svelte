<script lang="ts">
  let { data } = $props();

  const services = [
    { name: 'SvelteKit', role: 'Reactive web client', state: 'ready' },
    { name: 'Fastify', role: 'Typed HTTP API', state: 'ready' },
    { name: 'PostgreSQL', role: 'Relational persistence', state: data.health?.database ?? 'unknown' },
    { name: 'Drizzle', role: 'Schema and migrations', state: 'ready' }
  ];
</script>

<svelte:head>
  <title>Cubic v2 — Foundation</title>
  <meta
    name="description"
    content="Cubic is being rebuilt as a fast, self-hosted messenger with group voice and screen sharing."
  />
</svelte:head>

<main class="shell">
  <section class="hero">
    <div class="brand-row">
      <img class="logo" src="/images/cubic-w-nobg.png" alt="Cubic" />
      <div>
        <p class="eyebrow">v2.0.0-alpha.1</p>
        <h1>Cubic is being rebuilt.</h1>
      </div>
    </div>

    <p class="lead">
      A new foundation for a lightweight, self-hosted messenger: reactive UI, typed API,
      relational data and a clean path to group chat, voice rooms and screen sharing.
    </p>

    <div class="status-card" class:online={data.apiReachable}>
      <span class="status-dot" aria-hidden="true"></span>
      <div>
        <strong>{data.apiReachable ? 'Foundation online' : 'Web online · API unavailable'}</strong>
        <span>
          {#if data.health}
            API {data.health.version} · PostgreSQL {data.health.database}
          {:else}
            Start the API and PostgreSQL to complete the stack.
          {/if}
        </span>
      </div>
    </div>
  </section>

  <section class="grid" aria-label="Cubic v2 foundation services">
    {#each services as service}
      <article class="service-card">
        <div class="service-header">
          <h2>{service.name}</h2>
          <span>{service.state}</span>
        </div>
        <p>{service.role}</p>
      </article>
    {/each}
  </section>

  <section class="next">
    <p class="eyebrow">Next milestone</p>
    <h2>alpha.2 — identity & security</h2>
    <p>
      Users, sessions, Argon2id authentication, authorization boundaries and migration tooling
      from the legacy MongoDB model.
    </p>
  </section>
</main>
