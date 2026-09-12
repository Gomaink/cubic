<script lang="ts">
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';

  let {
    own,
    open,
    reactionOpen,
    selectedReactions,
    onreply,
    onedit,
    ondelete,
    onreaction,
    ontogglereactions,
    ontoggle
  }: {
    own: boolean;
    open: boolean;
    reactionOpen: boolean;
    selectedReactions: string[];
    onreply: () => void;
    onedit: () => void;
    ondelete: () => void;
    onreaction: (reaction: string) => void;
    ontogglereactions: () => void;
    ontoggle: () => void;
  } = $props();

  const reactions = [
    { value: '❤️', label: 'Heart' },
    { value: '👍', label: 'Thumbs up' },
    { value: '😂', label: 'Laughing' },
    { value: '😮', label: 'Surprised' },
    { value: '😢', label: 'Sad' },
    { value: '👎', label: 'Thumbs down' }
  ];

  let trigger = $state<HTMLButtonElement | null>(null);
  let desktopReactionTrigger = $state<HTMLButtonElement | null>(null);
  let mobileReactionTrigger = $state<HTMLButtonElement | null>(null);
  let menu = $state<HTMLDivElement | null>(null);
  let reactionPicker = $state<HTMLDivElement | null>(null);

  $effect(() => {
    if (reactionOpen) {
      void tick().then(() => reactionPicker?.querySelector<HTMLButtonElement>('button')?.focus());
    } else if (open) {
      void tick().then(() => menu?.querySelector<HTMLButtonElement>('button')?.focus());
    }
  });

  function closeFromKeyboard(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    ontoggle();
    void tick().then(() => trigger?.focus());
  }

  function closeReactionPicker(event: KeyboardEvent) {
    const buttons = Array.from(reactionPicker?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;

    if (event.key === 'Escape') {
      event.preventDefault();
      ontogglereactions();
      void tick().then(() => {
        const reactionTrigger = desktopReactionTrigger?.offsetParent
          ? desktopReactionTrigger
          : mobileReactionTrigger?.offsetParent
            ? mobileReactionTrigger
            : trigger;
        reactionTrigger?.focus();
      });
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % buttons.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else return;

    event.preventDefault();
    buttons[next]?.focus();
  }
</script>

<div class="cubic-message-actions">
  <div class="cubic-message-actions-desktop" aria-label="Message actions">
    <button
      bind:this={desktopReactionTrigger}
      type="button"
      aria-label="Add reaction"
      aria-haspopup="menu"
      aria-expanded={reactionOpen}
      title="Add reaction"
      onclick={ontogglereactions}
    >
      <Icon name="smile" size={16} />
    </button>
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
      <button
        bind:this={mobileReactionTrigger}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={reactionOpen}
        onclick={ontogglereactions}
      >
        <Icon name="smile" size={16} /> React
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

  {#if reactionOpen}
    <div
      class="cubic-message-reaction-picker"
      bind:this={reactionPicker}
      role="menu"
      tabindex="-1"
      aria-label="Choose a reaction"
      onkeydown={closeReactionPicker}
    >
      {#each reactions as reaction}
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={selectedReactions.includes(reaction.value)}
          aria-label={`React with ${reaction.label}`}
          title={reaction.label}
          class:selected={selectedReactions.includes(reaction.value)}
          onclick={() => onreaction(reaction.value)}
        >
          {reaction.value}
        </button>
      {/each}
    </div>
  {/if}
</div>
