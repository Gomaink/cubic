# Cubic product direction

**Status: approved direction, not an implementation claim.** See [README](README.md) for what exists and [ROADMAP](ROADMAP.md) for planned milestones.

## Onyx

Cubic uses a dark, minimal graphite system with its own neutral gray-white brand accent. Do not add arbitrary blue, purple or violet accents, decorative glow or gradients. Use semantic color only when the color communicates real state.

**Selected-state decision:** remove the current partial white arc/border treatment wherever it appears, including channel selection and Settings. Use surface and foreground contrast for selection. Preserve a clear, accessible `:focus-visible` indicator; removing ornament must never remove keyboard focus visibility. This is approved future UI work, not part of the current documentation slice.

## Navigation and channels

The long-term information hierarchy is DM/server rail → context sidebar → content → optional members. A server is not a conversation. Uncategorized channels precede categories. There is no global “CHANNELS” heading. Categories offer `+` only to authorized users. Channel headers align compactly, show the channel-type icon inline and omit a large square icon. See Alpha 12 for management and permission plans.

## Invites and discovery

Server invites should converge on **links only**: no “Invite Friend” action and no targeted server invites. Current targeted invites remain functional until a future replacement. “Browse Servers” becomes **Discover**, a place to find new public communities rather than duplicates of servers already in the user's rail.

## User interaction

Clicking a user in any surface should open the same ProfileCard. Context actions should use one UserContextMenu with additional context-specific actions. Existing surfaces will be aligned as future work.

## Notifications

Preference precedence is **global → server → channel override**. A channel override wins for that channel; server preferences win when no channel override exists.

## Accounts and ownership

Future account deletion must be blocked while the user owns servers. The owner must transfer or delete those servers first. Account deletion is not currently implemented.

## Desktop preview and production

The Electron preview starts in 11.9; production hardening follows in Alpha 17. Secure defaults include `nodeIntegration: false`, `contextIsolation: true`, sandboxing, a minimal preload bridge and no Cubic account token in localStorage. Auto-update begins in the preview phase, with final channels and packaging hardened later. No desktop app is currently advertised as available.
