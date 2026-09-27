# Cubic Onyx Design Language

This document defines the visual and interaction contract for Cubic's Onyx
theme.

It exists to keep future Cubic UI work coherent as the product grows.

---

# 1. Brand foundation

Cubic is visually anchored in its own logo.

The logo's off-white / gray-white identity is the authoritative source of
non-semantic accent styling.

Current implementation uses brand tokens derived from the real Cubic logo
asset and established CSS variables. UI work should consume those tokens
instead of inventing replacement hex values.

Do not guess brand colors from memory or from screenshots.

If the brand asset or authoritative brand token changes in the future, update
the token source rather than scattering new hard-coded colors.

---

# 2. Onyx palette philosophy

Onyx is not:

> dark UI + a fashionable accent color

Onyx is:

> near-black foundations + layered charcoal/graphite surfaces + cool gray
> structure + Cubic gray-white identity

The product should remain largely monochromatic.

## Foundation

Use a restrained hierarchy such as:

- near-black application background
- charcoal navigation surfaces
- graphite raised surfaces
- slightly lighter graphite hover/selected surfaces
- cool-gray separators and borders

The distinction between surfaces should often come from subtle luminance,
borders, and hierarchy rather than color.

## Brand

The Cubic gray-white brand family is used for:

- primary emphasis
- selected controls
- active navigation
- focus indication
- enabled Onyx switches
- primary actions
- selected tabs
- important non-semantic emphasis

Use multiple strengths derived from the same brand family:

- strong
- normal
- soft
- subtle
- border
- focus

Do not substitute generic blue, blurple, lavender, or violet.

---

# 3. Semantic color

Colors outside the Cubic gray-white family must communicate meaning.

## Danger

Red is appropriate for:

- revoke
- delete
- remove
- destructive confirmation
- security-critical failure

Do not use red merely for emphasis.

## Success

Green is appropriate for:

- online presence
- successful completion
- healthy status
- connected state where that state is genuinely meaningful

Do not use green as decorative accent.

## Warning

Yellow/amber is appropriate for:

- warnings
- degraded state
- caution requiring user attention

Do not introduce warning color without warning semantics.

---

# 4. Typography

Typography should feel functional and modern rather than decorative.

Use hierarchy through:

- size
- weight
- spacing
- muted foreground levels

Prefer:

- off-white primary text
- cool-gray secondary text
- subdued gray metadata

Avoid introducing colored text when hierarchy can be expressed through tone
and weight.

Headings should establish structure without becoming oversized marketing
typography inside application surfaces.

---

# 5. Surface hierarchy

A Cubic screen should make the hierarchy understandable before the user
interacts.

Typical progression:

1. application foundation
2. persistent navigation
3. local navigation/sidebar
4. content surface
5. raised card/control surface
6. menu/dialog/popover

Avoid unnecessary nested cards.

Cards should exist because content benefits from grouping, not because every
section needs a rectangle.

Borders should be subtle and consistent.

---

# 6. Buttons

Cubic uses a small intentional hierarchy.

## Primary

Use for the main action in a local context.

Characteristics:

- Cubic gray-white brand treatment
- strong contrast
- proportional width
- clear disabled state

Do not make every primary button full-width.

## Secondary

Use for meaningful but non-primary actions.

Characteristics:

- graphite/dark background
- restrained border
- off-white foreground

## Ghost

Use for low-priority actions.

Characteristics:

- minimal resting surface
- clear hover/focus state
- visually recedes until interaction

## Danger

Use only for destructive actions.

Characteristics:

- semantic red treatment
- visually distinct from brand actions

## Icon button

Use for compact actions such as:

- settings
- close
- edit
- add
- copy
- contextual menu

Requirements:

- consistent geometry
- clear hover/focus
- accessible label
- appropriate touch target

---

# 7. Switches and boolean controls

Boolean preferences such as Compact mode and Reduced motion should use Cubic
Onyx switches, not browser-default-looking checkboxes.

Enabled state:

- derives from Cubic gray-white family
- remains restrained rather than pure glaring white
- keeps a clear thumb/track distinction

Disabled/off state:

- neutral graphite/cool gray
- remains distinguishable without relying only on color

Requirements:

- keyboard operable
- semantic checkbox/switch state
- visible focus
- >=44px appropriate mobile interaction target

---

# 8. Inputs and selects

Inputs and selects should belong visually to Onyx.

Prefer:

- dark surface
- subtle cool-gray border
- brand-derived focus treatment
- clear placeholder/disabled distinction
- consistent radius and height

Avoid browser-default-looking high-priority product controls.

Native behavior may remain where required for accessibility or platform
compatibility, but the surrounding visual language should remain Cubic.

---

# 9. Navigation

Navigation should be calm and legible.

## Active states

Use:

- graphite selected surface
- restrained gray-white border or indicator
- clear foreground emphasis

Do not use:

- decorative crescents
- arcs
- neon strips
- arbitrary glow
- generic blue or purple selection states

Active state should look like part of the navigation system, not decoration
placed beside it.

## Secondary actions

Kebab/context actions should not permanently clutter desktop lists.

Desktop:

- show on hover
- show on focus-within
- show for selected/active item when useful
- show while menu is open
- preserve keyboard accessibility

Touch:

- actions must remain reachable
- never rely on hover
- preserve long-press/contextual behavior when supported

---

# 10. Context menus

Menus should feel structured rather than like stacked raw text buttons.

Use:

- consistent rows
- restrained icons when they improve scanning
- clear disabled state
- grouping/separators where semantic grouping exists
- brand-derived focus/active state

Avoid:

- decorative icons with no informational benefit
- excessive separators
- oversized menu rows
- browser-default focus rectangles disconnected from Onyx

---

# 11. Profile and identity editing

Editing identity should be visually tied to the identity being edited.

For avatar/server icon:

- place edit affordance on or adjacent to the image
- use a small edit/camera control
- keep destructive removal secondary
- only display removal when meaningful

Do not give Change and Remove equal visual priority.

---

# 12. Settings architecture

Settings should scale vertically rather than accumulating horizontal tabs
forever.

Long-term preferred structure:

USER SETTINGS
- Profile
- Privacy
- Blocked users
- Sessions
- security capabilities when actually supported

APP SETTINGS
- App / Appearance
- Voice & Video
- Chat
- Notifications
- Keybindings when supported

Only expose real capabilities.

Never create fake settings for backend behavior that does not exist.

Navigation should appear once.

Do not add page buttons that duplicate an existing Settings navigation item.

---

# 13. Server settings

Server administration should follow the same Onyx system as account settings.

Prefer:

- sidebar/section navigation
- structured overview
- contextual identity editing
- clear member/invite surfaces

Do not duplicate navigation with buttons such as "Manage members" if a Members
section already exists beside the current view.

---

# 14. Invite UI

Invites must prioritize useful state.

## Pending targeted invitation

Present as a structured row:

- person
- state
- relevant action

Avoid raw inline text strings.

## Share link

An active link surface should prioritize available authoritative information:

- status
- created date
- expiry
- creator only if the API actually provides it
- copy only if the secret is securely recoverable
- revoke as destructive

Never weaken invite-token security for convenience.

If only a token digest is stored:

- do not store plaintext merely to add Copy
- do not fake a recoverable link
- preserve copy-on-creation behavior

## Revoked links

Revoked links should be visually de-emphasized.

When many exist, a collapsed "Show N revoked links" pattern is appropriate.

Revoked entries must not dominate the primary invite workflow.

---

# 15. Empty states

Empty states should be restrained.

Use:

- Cubic icon or simple product-relevant icon
- concise heading
- short explanation
- action only when genuinely useful

Avoid huge illustrations or decorative filler unless the product context
specifically benefits from them.

---

# 16. Messaging surfaces

Messages are content-first.

Avoid excessive cards, bubbles, borders, or accent color.

Use spacing and typography to communicate grouping.

Compact mode should make density visibly higher without damaging:

- readability
- touch targets
- continuation-message behavior
- message scanning

---

# 17. Voice & video

Voice/video surfaces must follow the same Onyx design language.

Future Voice & Video Settings should use:

- established Onyx controls
- Cubic brand focus/selection
- restrained device selectors
- useful preview surfaces
- clear media state

Do not create a separate neon/streaming aesthetic.

Media state colors remain semantic.

---

# 18. Responsive design

Desktop and mobile share one visual language.

Mobile may reorganize layout, but not identity.

Verify on compact layouts:

- readable text
- >=44px appropriate touch controls
- no horizontal overflow
- no clipped menus
- no hover-only functionality
- settings sections remain reachable
- dialogs/surfaces fit the viewport
- persistent media/voice state is not accidentally destroyed by navigation

---

# 19. Motion

Motion must support comprehension.

Do not animate simply because animation is available.

Reduced Motion must reduce Cubic-owned animation and transition effects while
preserving state changes and functionality.

Avoid:

- bouncy decoration
- exaggerated spring effects
- glowing animated accents
- unnecessary entrance animations

---

# 20. "Vibe-coded" rejection checklist

Before accepting a UI change, ask:

- Was any color introduced because it "looked cool" rather than because it is
  Cubic brand or semantic?
- Is there decorative geometry without a functional purpose?
- Are there multiple unrelated radii or control heights?
- Does any important control still look browser-default?
- Is a secondary action visually louder than the primary task?
- Is navigation duplicated?
- Are kebabs/actions permanently visible when they could be contextual?
- Did the implementation invent a new one-off CSS pattern?
- Does the mobile screen look like a different product?
- Is there an unnecessary gradient or glow?
- Could this screen plausibly belong to a generic AI-generated dashboard?

If yes, refine it.

---

# 21. Acceptance checklist

Before completing a Cubic UI slice, verify:

## Identity
- no arbitrary blue/purple/lavender accent
- brand emphasis derives from Cubic gray-white
- semantic colors communicate actual state

## Controls
- consistent button hierarchy
- consistent switch styling
- consistent inputs/selects
- accessible icon buttons

## Interaction
- hover
- focus-visible
- selected
- active
- disabled
- loading where applicable

## Navigation
- no redundant navigation
- secondary actions contextual where appropriate

## Accessibility
- keyboard operation
- visible focus
- accessible names
- semantic controls
- appropriate mobile touch targets

## Responsive
- desktop
- narrow desktop
- phone portrait
- phone landscape
- small phone
- no horizontal overflow

## Visual
- spacing rhythm
- alignment
- typography
- density
- surface hierarchy
- unmistakably Cubic

Screenshots should be reviewed whenever the slice meaningfully changes visible
UI.
