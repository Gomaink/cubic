<script lang="ts">
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';

  let {
    own,
    open,
    onreply,
    onedit,
    ondelete,
    ontoggle
  }: {
    own: boolean;
    open: boolean;
    onreply: () => void;
    onedit: () => void;
    ondelete: () => void;
    ontoggle: () => void;
  } = $props();

  let trigger = $state<HTMLButtonElement | null>(null);
  let menu = $state<HTMLDivElement | null>(null);

  $effect(() => {
    if (open) {
      void tick().then(() => menu?.querySelector<HTMLButtonElement>('button')?.focus());
    }
  });

  function closeFromKeyboard(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    ontoggle();
    void tick().then(() => trigger?.focus());
  }
</script>

<div class="cubic-message-actions">
  <div class="cubic-message-actions-desktop" aria-label="Message actions">
    <button type="button" aria-label="Reply to message" title="Reply" onclick={onreply}>
      <Icon name="reply" size={16} />
    </button>
    {#if own}
      <button type="button" aria-label="Edit message" title="Edit" onclick={onedit}>
        <Icon name="edit" size={16} />
      </button>
      <button class="danger" type="button" aria-label="Delete message" title="Delete" onclick={ondelete}>
        <Icon name="trash" size={16} />
      </button>
    {/if}
  </div>

  <button
    class="cubic-message-actions-trigger"
    bind:this={trigger}
    type="button"
    aria-label="Message actions"
    aria-haspopup="menu"
    aria-expanded={open}
    title="Message actions"
    onclick={ontoggle}
  >
    <Icon name="more" size={19} />
  </button>

  {#if open}
    <div
      class="cubic-message-actions-menu"
      bind:this={menu}
      role="menu"
      tabindex="-1"
      aria-label="Message actions"
      onkeydown={closeFromKeyboard}
    >
      <button type="button" role="menuitem" onclick={onreply}>
        <Icon name="reply" size={16} /> Reply
      </button>
      {#if own}
        <button type="button" role="menuitem" onclick={onedit}>
          <Icon name="edit" size={16} /> Edit
        </button>
        <button class="danger" type="button" role="menuitem" onclick={ondelete}>
          <Icon name="trash" size={16} /> Delete
        </button>
      {/if}
    </div>
  {/if}
</div>
