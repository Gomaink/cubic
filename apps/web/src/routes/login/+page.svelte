<script lang="ts">
  let identifier = $state('');
  let password = $state('');
  let error = $state('');
  let submitting = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    submitting = true;

    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ identifier, password })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        error = payload.error ?? 'Unable to log in.';
        return;
      }

      window.location.assign('/app');
    } catch {
      error = 'Cubic could not reach the API.';
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head><title>Log in — Cubic</title></svelte:head>

<main class="auth-shell">
  <section class="auth-panel">
    <a class="auth-brand" href="/">
      <img src="/images/cubic-w-nobg.png" alt="" />
      <span>Cubic</span>
    </a>

    <div class="auth-copy">
      <p class="eyebrow">Welcome back</p>
      <h1>Log in.</h1>
      <p>Your session is stored server-side and the browser only keeps an HttpOnly session token.</p>
    </div>

    <form class="auth-form" onsubmit={submit}>
      <label>
        <span>E-mail or username</span>
        <input bind:value={identifier} autocomplete="username" required maxlength="254" placeholder="samuel" />
      </label>
      <label>
        <span>Password</span>
        <input bind:value={password} type="password" autocomplete="current-password" required maxlength="128" placeholder="••••••••••" />
      </label>

      {#if error}<p class="form-error" role="alert">{error}</p>{/if}

      <button class="button button-primary button-full" type="submit" disabled={submitting}>
        {submitting ? 'Signing in…' : 'Log in'}
      </button>
    </form>

    <p class="auth-switch">New to Cubic? <a href="/register">Create an account</a>.</p>
  </section>
  <aside class="auth-aside" aria-hidden="true">
    <span>alpha.2</span>
    <strong>Identity first.<br />Messages next.</strong>
  </aside>
</main>
