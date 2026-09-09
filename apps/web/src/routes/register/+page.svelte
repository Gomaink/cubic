<script lang="ts">
  let email = $state('');
  let username = $state('');
  let displayName = $state('');
  let password = $state('');
  let error = $state('');
  let submitting = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    submitting = true;

    try {
      const response = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, username, displayName, password })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        error = payload.error ?? 'Unable to create your account.';
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

<svelte:head><title>Create account — Cubic</title></svelte:head>

<main class="auth-shell">
  <section class="auth-panel auth-panel-wide">
    <a class="auth-brand" href="/">
      <img src="/images/cubic-w-nobg.png" alt="" />
      <span>Cubic</span>
    </a>

    <div class="auth-copy">
      <p class="eyebrow">New identity</p>
      <h1>Create account.</h1>
      <p>This account will become the authority for DMs, groups, calls and permissions in later alphas.</p>
    </div>

    <form class="auth-form" onsubmit={submit}>
      <div class="field-row">
        <label>
          <span>Display name</span>
          <input bind:value={displayName} autocomplete="name" required maxlength="64" placeholder="Samuel" />
        </label>
        <label>
          <span>Username</span>
          <input bind:value={username} autocomplete="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_]+" placeholder="samuel" />
        </label>
      </div>
      <label>
        <span>E-mail</span>
        <input bind:value={email} type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com" />
      </label>
      <label>
        <span>Password</span>
        <input bind:value={password} type="password" autocomplete="new-password" required minlength="10" maxlength="128" placeholder="At least 10 characters" />
      </label>

      {#if error}<p class="form-error" role="alert">{error}</p>{/if}

      <button class="button button-primary button-full" type="submit" disabled={submitting}>
        {submitting ? 'Creating account…' : 'Create account'}
      </button>
    </form>

    <p class="auth-switch">Already registered? <a href="/login">Log in</a>.</p>
  </section>
  <aside class="auth-aside" aria-hidden="true">
    <span>Argon2id</span>
    <strong>Passwords are hashed.<br />Sessions are revocable.</strong>
  </aside>
</main>
