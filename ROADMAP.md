# Cubic v2 roadmap

**Status of this document: PLANNED work.** It does not describe features available today. Desktop Preview 11.9.1–11.9.4 and the screen-share fixes passed functional Windows smoke on the `2.0.0-alpha.7` development line. Alpha 11.9 remains open: signed installer, protected release, real A-to-B auto-update and distribution negative cases are pending. For implemented capabilities see [README](README.md), [CHANGELOG](CHANGELOG.md) and [RELEASE_NOTES](RELEASE_NOTES.md). Exact scope and order can change before release.

## 11.9 — Desktop Preview Foundation (in progress)

Begin a secure Electron preview in parallel with the web app. This is not the production desktop hardening milestone; see Alpha 17 and [Product Direction](PRODUCT_DIRECTION.md).

The functional Windows preview passed shell/auth/navigation, Windows Hello passkey, session persistence, mic/camera/output, voice, native Window/Screen sharing, Tray and external links. The Web app does not yet emit native notifications. The 11.9.5 updater and 11.9.6 distribution pipeline are statically reviewed; a real Authenticode certificate, signed NSIS installer, installed executable signature verification, protected GitHub release, A-to-B update and negative-case smoke are still required. The operational version plan is A=`2.0.0-alpha.8` after integration into `refactor/v2`, then B=`2.0.0-alpha.9` only after installing and validating A; `VERSION` remains `2.0.0-alpha.7` until a separately approved bump.

## Alpha 12 — Advanced Server Experience (planned)

| Slice | Planned outcome |
| --- | --- |
| 12.1 | Role model |
| 12.2 | Central permission engine |
| 12.3 | Channel model and management |
| 12.4 | Channel permission overrides |
| 12.5 | Roles and member administration |
| 12.6 | Mention permissions |
| 12.7 | Server invite links 2.0 |
| 12.8 | Public server profiles and visibility |
| 12.9 | Discover / server directory |
| 12.10 | Server identity |
| 12.11 | Server lifecycle |
| 12.12 | Audit log and moderation history |
| 12.13 | Account and ownership lifecycle |

**Channels:** remove the global “CHANNELS” heading; place uncategorized channels above categories; allow a category `+` only with permission. Use a compact header with the channel type inline and no large square channel icon. Plan category-aware creation, channel context menus, favorites, pin to top, copy link, mute, notification overrides, edit, duplicate, delete, topics, slowmode and permission inheritance.

**Invites:** converge on links only. Remove “Invite Friend” and targeted server invites; make existing links copyable. Add expiration, maximum uses, counters, editing, revocation, history and Pause Invites. Role grants, temporary membership and audit integration follow the permission and audit models. Today's shareable links and targeted invitations remain implemented until this work replaces them.

**Discover:** “Browse Servers” should find **new** public communities, not repeat the user's server rail. Plan featured, popular, growing, niche and small-community sections; categories, tags, language and search. An account with no servers should enter Discover during onboarding.

**Server identity and lifecycle:** icon, banner, description, category, tags and language; transfer ownership and delete server. The icon exists today; the other identity controls are planned. Account deletion must be blocked while the account owns servers, until ownership is transferred or those servers are deleted. Audit events should be structured and immutable, with user/action filters and expandable details.

## Alpha 13 — Messaging & Notifications 2.0 (planned)

| Slice | Planned outcome |
| --- | --- |
| 13.1 Message utilities | Pin, forward, copy text/link, mark unread, integrated with existing reply/reaction/edit/delete. |
| 13.2 Rich text / Markdown | Bold, italic, underline, strikethrough, `||spoiler||`, inline/code blocks, headings, subtext, quotes, lists, masked links, clickable raw URLs and correct escaping. Safe link previews remain later work. |
| 13.3 Mentions & pings | Structured `@user`, `@role`, `@everyone`, `@here` and autocomplete. |
| 13.4 Read state / unread / badges | Cross-device read cursor, mark unread, server unread and mention counts. |
| 13.5 Notification preferences | Global, server and channel scopes; mute, suppress mentions, desktop/push. |
| 13.6 Cubic sound system | Original sounds for messages/DMs/mentions, calls, join/leave, mute/deafen and streams, with preview, toggles and volume. |
| 13.7 Rich invite cards | Server banner/icon/name, online/member counts, description, Join / Go to Server and expired/revoked states. Existing basic invite cards are already implemented. |
| 13.8 Link previews | Safe external link previews/unfurls, subject to SSRF and content-security design. |

For 13.3, enforce structured mention permissions on the backend for both message POST and PATCH. An edit that creates a new mention must be validated even though today's own-message edit path does not recheck `SEND_MESSAGES`. Literal `@everyone` and `@here` remain plain text until structured mentions ship.

## Alpha 14 — Profiles, Presence & Member Experience 2.0 (planned)

Extended profiles: bio, user banner, badges, account-created and server-joined dates, profile cards and full profiles, mutual friends/servers, private notes, per-server nickname, later server-specific avatar/bio. Presence, custom status, rich activity, linked accounts, Spotify and possible Listen Along are future work. Clicking a user anywhere should open the same ProfileCard; context actions should use one shared UserContextMenu plus context-specific actions. Today's basic profile and presence are separate from these plans.

## Alpha 15 — Voice & Video 2.0 (planned)

Participant avatars, click-through to the shared ProfileCard, context actions from voice, user volume, moderation, video and screen-share refinements, and media reliability. Current voice, camera and sharing are already available; these are improvements.

## Alpha 16 — Internationalization & Localization (planned)

Translation architecture and packs, locale formatting, language preference and RTL readiness. Priority: English, Português (Brasil), Español, Français and Deutsch, then broader major-world-language coverage.

## Alpha 17 — Desktop Production Hardening (planned)

Electron **begins in 11.9**, not here. Alpha 17 covers production signing and final update channels, deep links, tray/startup polish, installer polish, crash recovery and cross-platform packaging.

## Release path (planned)

- **Beta 1:** migration/upgrade, performance, security and cross-platform QA.
- **v2.0.0-rc.1:** feature freeze, corrections and release hardening.
- **v2.0.0 Stable:** general availability after release criteria are met.
