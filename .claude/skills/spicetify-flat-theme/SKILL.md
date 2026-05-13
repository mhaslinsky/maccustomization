---
name: spicetify-flat-theme
description: Edit the Spicetify (Spotify) theme codegen. Use when touching scripts/build-spicetify-theme.mjs, changing how active-theme color tokens map to Spicetify's 18-slot color.ini, debugging why ~/.config/spicetify/Themes/uber-theme/ doesn't pick up active-theme changes, debugging the config-xpui.ini patch (current_theme / color_scheme), explaining why this integration is flat-color-only with no glass user.css, or considering whether to add a glass / transparency path (don't, without re-reading the "Why no glass" section below). SKIP for widgets, window borders, menu bar, terminal, or Obsidian work.
---

# Spicetify (Spotify) — flat color-only theme

The repo ships a codegen at `scripts/build-spicetify-theme.mjs` that maps the active theme's color tokens to Spicetify's `color.ini` and writes it to `~/.config/spicetify/Themes/uber-theme/`. Wired into `npm run build` after `build:obsidian`.

**This is a flat, color-only integration by design.** No `user.css` glass treatment, no `backdrop-filter`, no class-name chasing. The codegen owns the 18-slot Spicetify color palette; Spotify owns layout, typography, and chrome.

## How it works

- Same esbuild → data-URL → dynamic-import pattern as the other codegens. Active theme loaded from `_active.ts`.
- Glass themes (`layout.cardBg` alpha < 1) get composited onto a hue-preserving dark base (`cardBg.rgb * 0.4`) — same trick as `build-warp-theme.mjs` and `build-obsidian-theme.mjs`. Opaque themes pass through.
- 18 `color.ini` keys mapped from theme tokens:
  - `text` / `subtext` ← `accents.status.text` / `accents.status.smallMuted`
  - `main` / `player` ← composited bg; `main-elevated` / `card` / `tab-active` derived by lighten
  - `sidebar` ← darkened bg; `shadow` ← bg darkened 45%
  - `highlight` / `highlight-elevated` ← alpha-tinted text over bg
  - `button` / `button-active` / `notification` ← `menuBarTint` composited; `accentBright` = lighten 15%
  - `button-disabled` / `selected-row` / `misc` ← fgMuted variants
  - `notification-error` ← `status.bad` composited
- `user.css` is intentionally an empty ASCII placeholder. Spicetify expects the file to exist alongside `color.ini` in a theme dir.
- `config-xpui.ini` patched in place: `current_theme = uber-theme`, `color_scheme = base`. All other keys preserved.
- ASCII-only header in `color.ini` (em-dashes in comments triggered "No section found" from Spicetify's INI parser on the 2026-05-01 attempt — kept ASCII as guard).

## Applying

The codegen writes files; it does **not** run `spicetify apply`. `spicetify apply` rewrites Spotify's xpui.js with colors baked in, requires Spotify closed, and restarts it. Per project convention (memory: `feedback_app_restarts.md`) we ask the user to close apps before triggering restarts; we don't trust `pgrep` for Spotify any more than we trust it for Warp.

Workflow after a theme switch:

1. `npm run build` (or `npm run build:spicetify` on its own)
2. Close Spotify
3. `spicetify apply`

`spicetify watch -s` would auto-reload `color.ini` / `user.css` changes if running, but the repo doesn't manage that — assume manual apply.

## Why no glass

A glass-style Spicetify codegen was attempted on **2026-05-01** and reverted the same day. Deciding constraint: **Spotify's NSWindow is opaque on macOS.** Spotify uses CEF (Chromium Embedded Framework); there's no Spicetify-exposed `spotify_launch_flags` that turns it transparent. `backdrop-filter` inside `user.css` therefore samples whatever Spotify is rendering underneath (album-art backdrops, playlist gradient washes, page-level color extracts) — **not the desktop wallpaper**. Same dead end SGlass and Frostify hit.

To get true desktop transparency we would need to asar-patch Spotify the way `scripts/patch-slack-app.mjs` patched Slack — set NSWindow background clear, force CEF web contents transparent, inject CSS through the root chain. That inherits all the Slack-asar fragility (sudo, App Management TCC, auto-update wipes the patch on every Spotify update, re-sign required). Slack's CSS-injection path was itself deprecated 2026-05-12 for these reasons; mirroring it for Spotify is not the right move.

**Don't add a glass path without one of these:**

1. User explicitly authorizes a Spotify asar-patch and accepts the maintenance cost (re-patch on every Spotify auto-update). Mirror `patch-slack-app.mjs` structure.
2. Spotify ships native transparent-window support that Spicetify can flip via `spotify_launch_flags`. Check Spicetify changelogs and Spotify CEF version bumps before assuming.
3. User explicitly asks for tinted-panel glass over Spotify's own content (NOT over wallpaper) and acknowledges that's the look. In that case bring back the `user.css` from 2026-05-01 — it lived briefly in `scripts/build-spicetify-theme.mjs` and got removed. There's no git trace; reconstruct from `build-obsidian-theme.mjs`'s glass section if needed.

## Gotchas

- **ASCII-only header in `color.ini`.** Em-dashes (`—`) in comments triggered "No section found" errors on the prior attempt; the parser is a Go INI lib that rejects some Unicode. Keep header pure ASCII.
- **`color.ini` requires opaque 6-digit hex, no `#`, no alpha.** The codegen composites alpha onto a derived dark base before emitting. Uppercase or lowercase both accepted by Spicetify; we emit uppercase.
- **`config-xpui.ini` patch regex pitfalls.** The `patchKey` helper uses `[ \t]*` (not `\s*`) around `=`, because `\s` includes `\n` and an empty-value line (`key = \n`) would otherwise eat the trailing newline and capture the NEXT line as the "value", silently deleting it on replace. The replacement also explicitly emits one space before the new value, regardless of the original spacing, so reformatting is stable.
- **`spicetify path userdata` → `~/.config/spicetify`**, but the bundled `SpicetifyDefault` theme lives at `~/.spicetify/Themes/SpicetifyDefault`. User themes go in `~/.config/spicetify/Themes/`. Don't confuse the two.
- **Section name = `[base]`.** Single-scheme theme; `color_scheme = base` in `config-xpui.ini` matches.
- **`spicetify apply` restarts Spotify.** Per the app-restart memory, never auto-apply.

## Cross-references

- Memory: `project_spicetify_dead_end.md` (predates this rewrite; mirrors the "Why no glass" rationale). Still accurate for the glass path; could be updated to note the flat-only codegen now exists.
- The Slack asar-patch we'd need to mirror for transparency: `scripts/patch-slack-app.mjs` and `.claude/skills/slack-theme/SKILL.md`. Slack-CSS path itself deprecated 2026-05-12 — same maintenance lesson.
- The Obsidian CSS-snippet pattern (closest sibling): `scripts/build-obsidian-theme.mjs` and `.claude/skills/obsidian-theme/SKILL.md`.
- Spicetify docs: <https://spicetify.app/docs/development/themes>.
