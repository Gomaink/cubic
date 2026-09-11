# Cubic Web — Strict UI Compatibility Rules

These rules extend the repository AGENTS.md.

The current Cubic UI is a validated compatibility surface.

## Before editing

Read the exact current implementation first.

Do not reconstruct +page.svelte or app.css from an older copy.

Do not replace large files wholesale.

Understand the affected message/composer DOM hierarchy and existing
responsive CSS before applying changes.

## Allowed scope for attachment/media tasks

Prefer changes limited to:
- message attachment rendering
- attachment staging
- composer attachment controls
- attachment/media lightbox
- local feature-specific CSS

Do not modify unrelated:
- navbar
- conversations sidebar
- mobile navigation
- group panel
- voice UI
- camera UI
- screen sharing
- media stage
- landing page

unless explicitly required by the task.

## CSS

Avoid broad selectors.

Avoid global layout rewrites.

Avoid !important unless absolutely unavoidable and justified.

Use feature-specific prefixes such as:
- cubic-media-*
- cubic-attachment-*

Any fix for an attachment must not alter unrelated messages or call UI.

## Responsive behavior

Always reason about:
- desktop
- narrow desktop
- iPhone portrait
- iPhone landscape

The message viewport must retain independent scrolling.

Composer controls on mobile must remain on one horizontal row.

Staging/preview elements must participate normally in layout and must not
overlay neighboring messages.

## Validation

After web changes run:
- npm run check
- npm test
- npm run build
- git diff --check

Then carefully inspect:
- git diff -- apps/web
- git diff --stat -- apps/web

If unrelated UI changed, fix it before reporting completion.
