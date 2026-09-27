---
name: cubic-onyx-design
description: Apply Cubic's Onyx product design language when implementing, refactoring, or reviewing Cubic UI, UX, navigation, settings, controls, menus, forms, responsive layouts, visual states, and frontend surfaces.
---

# Cubic Onyx Design

Use this skill for any Cubic task that creates, changes, refactors, or reviews visible user interface.

Before editing UI:

1. Read `references/onyx-design-language.md`.
2. Inspect the current implementation and reuse established Cubic primitives and tokens.
3. Identify the functional hierarchy before choosing visual treatment.
4. Preserve existing product behavior unless the task explicitly changes behavior.
5. Prefer extending the established Onyx system over creating one-off component styles.

## Core brand rule

The Cubic logo's off-white / gray-white identity is the source of all
non-semantic accent styling in the Onyx theme.

Never introduce arbitrary:

- blue
- purple
- violet
- lavender
- decorative gradients
- decorative glow

as generic Cubic accent styling.

Semantic colors are exceptions only when they communicate actual meaning:

- red: destructive / danger
- green: success / online / healthy
- yellow or amber: warning
- other semantic colors only when the product state genuinely requires them

Selection, active state, focus, primary actions, enabled switches, selected
tabs, selected menu items, navigation emphasis, and non-semantic links must
derive from the Cubic gray-white brand family.

## Product-design principle

Cubic must feel intentionally designed, not "vibe coded".

Reject:

- ornamental shapes with no functional purpose
- arbitrary accent colors
- random gradients or glow
- inconsistent radii
- inconsistent control heights
- browser-default-looking primary product controls
- oversized secondary CTAs
- duplicated navigation
- permanently visible secondary actions when contextual access is sufficient
- one-off CSS patterns when an established Cubic primitive exists
- decorative UI that competes with content
- copying another product literally

Prefer:

- restrained hierarchy
- repeatable interaction patterns
- deliberate spacing rhythm
- consistent geometry
- clear typography hierarchy
- Cubic-specific identity
- reusable but small primitives
- contextual secondary actions
- visible frequent actions
- dedicated settings for complex administration

## Interaction hierarchy

Use this rule throughout Cubic:

**Frequent actions visible.
Secondary actions contextual.
Complex administration in dedicated settings.**

Do not duplicate sidebar/settings navigation with redundant page buttons.

Destructive actions must look destructive and must not use the normal Cubic
brand treatment.

## Controls

When touching buttons, switches, selects, inputs, contextual menus, or icon
buttons:

- use the established Onyx tokens
- preserve consistent height, radius, padding, and typography
- provide hover, focus-visible, pressed, disabled, and loading states where relevant
- keep icon-only controls accessible with an explicit accessible name
- preserve keyboard operation
- keep appropriate mobile touch targets at least 44px
- do not create a large generic component abstraction unless the codebase already requires it

Primary actions may use the brand gray-white treatment.

Secondary controls should normally remain graphite/dark with restrained
borders.

Ghost actions should visually recede until interaction.

Danger actions must use the semantic destructive treatment.

## Navigation and selected states

Selected or active navigation must be:

- clear
- geometric
- restrained
- derived from the Cubic gray-white brand family

Do not use:

- crescents
- arcs
- ornamental active markers
- arbitrary glow
- bright blue/purple selection
- decorative animation merely to signal selection

Hover, selected, focus-visible, and disabled states must remain distinguishable.

## Responsive behavior

Desktop and mobile are the same Cubic design system.

Do not invent a separate mobile aesthetic.

On compact layouts verify:

- no horizontal document overflow
- no clipped controls
- touch actions remain reachable
- contextual actions are not hover-only
- settings remain navigable
- typography remains readable
- controls remain appropriately sized
- important state is not conveyed only through hover

## Accessibility

Every visual refinement must preserve or improve:

- semantic HTML
- keyboard navigation
- focus-visible
- accessible names
- disabled semantics
- switch/checkbox semantics
- menu semantics where applicable
- sufficient contrast
- touch target sizing

Never remove visible focus indication merely because it looks cleaner.

## Visual review

For every meaningful Cubic UI change, explicitly review:

- brand-color compliance
- hierarchy
- spacing rhythm
- alignment
- typography
- surface layering
- border consistency
- control consistency
- active/hover/focus/disabled states
- semantic color use
- desktop/mobile consistency
- horizontal overflow
- whether the result still feels recognizably Cubic

When screenshots are requested, inspect the rendered UI rather than assuming
correct CSS produces correct visual design.

## External inspiration

Products such as Discord or Root may inspire:

- information architecture
- interaction hierarchy
- workflow
- density
- settings organization

They must not be copied literally.

Translate useful ideas into Cubic's own Onyx visual language.

Read `references/onyx-design-language.md` for the detailed design contract.
