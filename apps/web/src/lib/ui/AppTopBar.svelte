<script lang="ts">
  let { title }: { title: string } = $props();
</script>

<header class="cubic-app-topbar" aria-label="Application bar">
  <span class="cubic-app-topbar-brand">Cubic</span>
  <span class="cubic-app-topbar-context" title={title}>{title}</span>
</header>

<style>
  .cubic-app-topbar { display: grid; grid-template-columns: 1fr minmax(0, 2fr) 1fr; align-items: center; min-width: 0; height: var(--ui-topbar-height); padding: 0 14px; border-bottom: 1px solid var(--ui-stroke); background: var(--ui-bg-deep); }
  .cubic-app-topbar-brand { grid-column: 1; color: var(--ui-text); font-size: .72rem; font-weight: 800; letter-spacing: -.02em; }
  .cubic-app-topbar-context { grid-column: 2; overflow: hidden; color: var(--ui-muted); font-size: .7rem; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
  @media (max-width: 680px), (max-width: 900px) and (max-height: 500px) { .cubic-app-topbar { display: none; } }
</style>
