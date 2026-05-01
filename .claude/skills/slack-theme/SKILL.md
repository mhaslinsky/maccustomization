---
name: slack-theme
description: Edit any of the Slack theming pipeline — the 10-color legacy sidebar string codegen (scripts/build-slack-theme.mjs), the best-effort CSS injection codegen for the most-visible Slack panes (scripts/build-slack-css.mjs; not full UI coverage — see the skill body), or the asar patcher (scripts/patch-slack-app.mjs). Use when touching any of those scripts, changing how theme tokens map to Slack's 10 sidebar slots or to the injected CSS variables / direct selectors, debugging silent rejection by Slack's import dialog (lowercase hex / wrong slot count / new vs legacy field), debugging the asar patch (sudo / TCC App Management / osascript-vs-direct-sudo / sudo -E node invocation / Slack auto-update wiping the patch), explaining why Slack is sync-only on legacy paste (server-side per-workspace, no on-disk theme file for the legacy string), or deciding whether a given Slack codegen should be in the default `npm run build` chain. SKIP for widgets, window borders, menu bar, terminal, or Hammerspoon work.
---

# Slack sidebar theme integration

The Slack sidebar accent strip is the only built-in theming knob Slack exposes. It's set per-workspace via Preferences → Themes → Custom Theme as **10 comma-separated UPPERCASE `#RRGGBB`** values (the older pre-2018 format was 8 colors; Slack added top_nav_bg + top_nav_text and now silently rejects 8-color strings).

## Files

- **`scripts/build-slack-theme.mjs`** — codegen. Same esbuild-bundle → data-URL → dynamic-import pattern as the others. Output is a string copied to the clipboard via `pbcopy`, plus a stdout breakdown of which theme token mapped to which slot.
- **No on-disk artifact.** Slack syncs the legacy theme string value server-side per-user-per-workspace; there's no equivalent of `~/.warp/themes/` to write to. (For deeper, on-disk theming see the asar patch path below — that's a separate mechanism we patched in *because* the legacy string is so limited.)

## Theme → Slack mapping

Slack's slots are positional in the comma-separated string, in this fixed order:

| Slot # | Slack name | Source |
|---|---|---|
| 1 | `column_bg` | `layout.cardBg` composited onto a near-black base (Slack sidebar is opaque, no alpha) |
| 2 | `menu_bg_hover` | `column_bg` lightened 8% (workspace switcher hover) |
| 3 | `active_item` | `menuBarTint` (always saturated; `primary.active` can be white in glass themes and washes out) |
| 4 | `active_item_text` | `accents.status.text` (high-contrast foreground) |
| 5 | `hover_item` | `column_bg` lightened 14% (between resting and active) |
| 6 | `text_color` | `accents.status.text` |
| 7 | `active_presence` | `status.good` (the "available" green) |
| 8 | `mention_badge` | `status.bad` (urgent red pill) |
| 9 | `top_nav_bg` | same as `column_bg` (top nav reads as one piece with the workspace column) |
| 10 | `top_nav_text` | same as `text_color` (consistent header text) |

## Why standalone, not chained

`npm run build` runs every codegen in sequence. The Slack codegen writes to the clipboard via `pbcopy` — chaining it would clobber the user's clipboard on every theme tweak. So `build:slack` lives outside the default chain and is invoked manually when the user actually wants to repaint Slack.

## Activation

Paste-only. After `npm run build:slack`:

1. Open Slack → Preferences → Themes → scroll to the bottom → "Create a custom theme" / "Import theme".
2. **Click "Paste your legacy theme colors"** in the Import dialog (small link, bottom-left). Do NOT paste into the top "Paste in a theme string" field — that's Slack's new encoded format (only 4 anchor colors, separated by `, `), NOT the 10-color UPPERCASE comma-separated format we generate. Pasting our string into the new-format field silently fails and snaps the values back to Slack's "Aubergine" defaults.
3. Paste into the legacy-format input → Apply.
4. Repeat per workspace if you want all of them themed (Slack stores it per-workspace, server-side).

If we ever want to skip the legacy link click, we'd need to reverse-engineer Slack's new theme-string format. The placeholder shown in the Import dialog is 4 hex colors separated by `, ` (e.g. `#124426, #350D36, #EEB317, #392104`); we have not characterized the underlying encoding or which slots Slack derives from those 4 anchors. Not done as of 2026-04-26.

The script's stdout explicitly calls out the legacy-link trap so the user doesn't fall into it.

## Full CSS injection (asar patch)

Slack's legacy theme string only paints a thin slice of the UI. For deeper theming we patch the desktop app to inject custom CSS at startup.

### Files

- **`scripts/build-slack-css.mjs`** — codegen. Generates `~/.config/slack-uber-theme/theme.css` from the active theme. Chained into the default `npm run build` since it's a pure file write (no clipboard side effect, no Slack process touched).
- **`scripts/patch-slack-app.mjs`** — one-shot patcher. Three modes via flags:
  - default → apply patch
  - `--restore` → roll back from `app-<arch>.asar.uber-backup`
  - `--status` → report patch state + CSS file existence
- **`<Slack.app>/Contents/Resources/app-<arch>.asar.uber-backup`** — copy of the asar that was in place immediately before a *fresh* patch run. The patcher first checks for our `slack-uber-theme:v1` marker in the in-place asar; if the marker is **present** it exits early with no changes (so the backup is *not* refreshed). If the marker is **absent** (first patch, post-Slack-auto-update, post-`--restore`) it copies the in-place asar to the backup, then writes the patched one. This is *not* a verified-pristine snapshot — if something else modified the asar without leaving our marker (a different injector, manual edit, partial Slack auto-update), the backup will preserve that drifted state, not a known-good Slack. Strongest guarantee: "the asar Slack would have launched right before our most recent fresh patch attempt." For a known-clean recovery, reinstall Slack rather than relying on this backup. The patcher prefers `~/Applications/Slack.app` over `/Applications/Slack.app` and uses whichever it finds, since `/Applications/*.app` triggers macOS App Management protection (see "What can break" below).

### Commands

```
npm run build:slack-css      — regenerate the CSS (chained into `npm run build`)
npm run status:slack-app     — read-only: arch, asar path, backup, patched yes/no, CSS file existence

# Patch / restore intentionally have NO npm script — they require sudo, and
# `npm run` doesn't pass through a TTY for the password prompt. Invoke node
# directly so sudo can prompt your terminal:

sudo -E node scripts/patch-slack-app.mjs            — apply the patch
sudo -E node scripts/patch-slack-app.mjs --restore  — roll back
```

The patcher itself enforces this — running it without root prints a clear "re-run as `sudo -E node scripts/patch-slack-app.mjs`" error. We tried earlier `npm run patch:slack-app` and `osascript do shell script ... with administrator privileges` workarounds and removed them; both produce silent failures (`npm run` strips the TTY so sudo can't prompt; osascript elevates but TCC attributes the privileged write to osascript itself, which lacks App Management permission, so writes return "Operation not permitted" even as root).

### What gets patched

`dist/preload.bundle.js` inside `app-<arch>.asar` is prepended with a small loader:

1. Reads `~/.config/slack-uber-theme/theme.css` at startup.
2. Waits for `DOMContentLoaded`.
3. Injects the CSS as a `<style id="slack-uber-theme">` on the document head.

Wrapped in `try/catch` so a missing/broken CSS file can't crash the renderer. Marker `/* slack-uber-theme:v1 */` at the top of the prepended block is what `--status` and the idempotency check look for.

### Workflow

- **First time:** `npm run build:slack-css && sudo -E node scripts/patch-slack-app.mjs` → fully quit Slack → reopen.
- **Theme switch:** `npm run theme <name>` rebuilds everything including CSS (the patch persists; only the CSS file is rewritten). Reopen Slack.
- **After Slack auto-updates:** patch is gone (Slack ships a fresh signed asar). Re-run `sudo -E node scripts/patch-slack-app.mjs`. There's no auto-detection — you find out when Slack relaunches looking unthemed. Run `npm run status:slack-app` if unsure.
- **Roll back:** `sudo -E node scripts/patch-slack-app.mjs --restore` copies backup over current asar and re-signs.

### What can break

- **Slack auto-update during a session** wipes the patch with no warning.
- **macOS App Management protection (Sonoma+)** blocks writes to `.app` bundles even with root unless the calling process has been granted App Management permission. The patcher's working invocation is `sudo -E node scripts/patch-slack-app.mjs` from the user's terminal — TCC sees the terminal as the responsible process, and granting App Management to the terminal once (System Settings → Privacy & Security → App Management) unlocks the chain `terminal → sudo → node → root`. Moving Slack to `~/Applications/Slack.app` is also recommended (the patcher auto-detects either location and prefers `~/Applications/`); run `sudo mv /Applications/Slack.app ~/Applications/Slack.app && sudo chown -R $(whoami) ~/Applications/Slack.app` if Slack is currently in `/Applications/`. Both — App Management on terminal AND Slack in `~/Applications/` — were needed in our setup before writes succeeded.
- **macOS Gatekeeper / hardened runtime** — Slack ships code-signed and notarized. Modifying `app-<arch>.asar` breaks the signature, so we re-sign ad-hoc with `codesign --force --deep --sign -`. Works on personal machines; enterprise-managed Macs with strict signing policies may reject this and refuse to launch Slack until restored from backup.
- **Slack changes its bundle layout.** Patcher targets `dist/preload.bundle.js` and aborts before any sudo writes if that path is missing. If Slack moves it, the patcher needs to be updated to find the new entry.
- **Slack ships breaking CSS class changes.** The CSS file uses both internal `--sk_*` custom properties and direct selectors (`.p-channel_sidebar`, `.p-top_nav`, etc.). Both targets shift between major Slack releases. Coverage gaps need to be debugged via Slack DevTools (enable with `defaults write com.tinyspeck.slackmacgap SlackNoAutoUpdates -bool true; SLACK_DEVELOPER_MENU=true open -a Slack`) and selectors added to `scripts/build-slack-css.mjs`. (`open -a Slack` resolves to whichever location the patcher is using — `~/Applications/Slack.app` per the workflow above, falling back to `/Applications/Slack.app`. Don't hardcode either path.)

### Why `build:slack-css` is chained but the patcher is not

`build:slack-css` writes one file, no system surgery — safe to run on every theme tweak, hence its inclusion in the default `npm run build` chain. The patcher (`scripts/patch-slack-app.mjs`) requires sudo, modifies a system app, and re-signs — it's a one-time setup ritual (re-run only after Slack auto-updates), not a per-build step. Running it on every `npm run build` would be hostile.
