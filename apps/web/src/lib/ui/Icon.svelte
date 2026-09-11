<script lang="ts">
  type IconName =
    | 'message'
    | 'users'
    | 'plus'
    | 'logout'
    | 'back'
    | 'phone'
    | 'phone-in'
    | 'phone-out'
    | 'phone-off'
    | 'headphones'
    | 'headphones-off'
    | 'settings'
    | 'send'
    | 'mic'
    | 'mic-off'
    | 'check'
    | 'x'
    | 'chevron-down'
    | 'upload'
    | 'trash'
    | 'crown'
    | 'shield'
    | 'user-plus'
    | 'user-minus';

  let {
    name,
    size = 18,
    strokeWidth = 2
  }: { name: IconName; size?: number; strokeWidth?: number } = $props();
</script>

<svg
  viewBox="0 0 24 24"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === 'message'}
    <path d="M4 5.5h16v10H9l-5 4v-14Z" />
  {:else if name === 'users'}
    <path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
    <circle cx="9" cy="7" r="3" />
    <path d="M17 11a3 3 0 1 0 0-6M22 20v-1.5a4 4 0 0 0-3-3.7" />
  {:else if name === 'plus'}
    <path d="M12 5v14M5 12h14" />
  {:else if name === 'logout'}
    <path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9" />
  {:else if name === 'back'}
    <path d="m15 18-6-6 6-6" />
  {:else if name === 'phone' || name === 'phone-in' || name === 'phone-out'}
    <path d="M7.2 3.5 10 7.4 8.3 9.1a14.2 14.2 0 0 0 6.6 6.6l1.7-1.7 3.9 2.8v2.4c0 1-.8 1.8-1.8 1.8C10 20.7 3.3 14 3 5.3 3 4.3 3.8 3.5 4.8 3.5h2.4Z" />
    {#if name === 'phone-in'}<path d="m14 5 4 4M18 5v4h-4" />{/if}
    {#if name === 'phone-out'}<path d="m14 9 4-4M14 5h4v4" />{/if}
  {:else if name === 'phone-off'}
    <path d="m3 3 18 18M7.4 7.4 8.3 9.1a14.2 14.2 0 0 0 6.6 6.6l1.7-1.7 3.9 2.8v2.4c0 .5-.2.9-.5 1.2M5.8 3.5h1.4L10 7.4 9 8.4M3.2 6.7C4 14.6 10.2 20.7 18 21" />
  {:else if name === 'headphones' || name === 'headphones-off'}
    <path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H5a1 1 0 0 1-1-1v-5ZM20 14h-3v6h2a1 1 0 0 0 1-1v-5Z" />
    {#if name === 'headphones-off'}<path d="M3 3l18 18" />{/if}
  {:else if name === 'settings'}
    <circle cx="12" cy="12" r="3" />
    <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.4 3.1a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L5 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 3.1h5l.4-3.1a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z" />
  {:else if name === 'send'}
    <path d="m3 3 18 9-18 9 4-9-4-9ZM7 12h14" />
  {:else if name === 'mic'}
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
  {:else if name === 'mic-off'}
    <path d="m3 3 18 18M9 9v2a3 3 0 0 0 4.7 2.5M15 11V6a3 3 0 0 0-5.8-1M5 11a7 7 0 0 0 11.8 5.1M19 11a7 7 0 0 1-.7 3M12 18v3M9 21h6" />
  {:else if name === 'check'}
    <path d="m5 12 4 4L19 6" />
  {:else if name === 'x'}
    <path d="M6 6l12 12M18 6 6 18" />
  {:else if name === 'chevron-down'}
    <path d="m6 9 6 6 6-6" />
  {:else if name === 'upload'}
    <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
  {:else if name === 'trash'}
    <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
  {:else if name === 'crown'}
    <path d="m4 8 4 4 4-7 4 7 4-4-2 10H6L4 8Z" />
  {:else if name === 'shield'}
    <path d="M12 3 19 6v5c0 4.7-2.8 8-7 10-4.2-2-7-5.3-7-10V6l7-3Z" />
  {:else if name === 'user-plus' || name === 'user-minus'}
    <circle cx="9" cy="8" r="3" />
    <path d="M3 20v-1a6 6 0 0 1 12 0v1" />
    {#if name === 'user-plus'}
      <path d="M18 8v6M15 11h6" />
    {:else}
      <path d="M15 11h6" />
    {/if}
  {/if}
</svg>
