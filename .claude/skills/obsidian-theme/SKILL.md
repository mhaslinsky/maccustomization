---
name: obsidian-theme
description: Edit the Obsidian CSS snippet codegen. Use when touching scripts/build-obsidian-theme.mjs, debugging why <vault>/.obsidian/snippets/uber-theme.css isn't applying after a theme switch, debugging why a registered vault wasn't picked up by auto-discovery, adjusting which Obsidian CSS variables map to which theme tokens, tweaking the glass-surface treatment, or asking why we're a snippet vs a full theme. SKIP for widgets, window borders, menu bar, terminal, or Slack work.
---

# Obsidian CSS snippet integration

Theme tokens flow into Obsidian via a generated CSS snippet, one per registered vault.

## Files

- **`scripts/build-obsidian-theme.mjs`** — codegen. Same esbuild-bundle → data-URL → dynamic-import pattern as the others. Auto-discovers vaults, writes snippet, enables it in `appearance.json`.
- **`<vault>/.obsidian/snippets/uber-theme.css`** — external state. One file per vault. Skip-if-unchanged: only rewritten when the generated CSS differs from disk.
- **`<vault>/.obsidian/appearance.json`** — patched whenever `"uber-theme"` is missing from `enabledCssSnippets` (initial install AND any later run where the user manually disabled it via Obsidian's UI — we re-enable it). Other fields preserved.

## Why a snippet (not a full theme)

A snippet is a single CSS file that overrides Obsidian's CSS variables and composes with whatever **theme** the user already has selected (default, AnuPpuccin, Catppuccin, etc.). We retint colors and apply the glass-surface treatment without stomping on layout/typography choices the user made via their main theme. A full theme would need a manifest, full coverage of every Obsidian surface, and would force-replace whatever theme is selected — much more work for less composability.

## Vault auto-discovery

Vaults come from `~/Library/Application Support/obsidian/obsidian.json` (the registry Obsidian writes whenever you open a vault). The codegen iterates every registered vault whose `path` exists on disk and writes a snippet to each. No config needed — open a new vault in Obsidian and the next `npm run build` picks it up.

If Obsidian isn't installed, the registry file doesn't exist and the codegen exits silently with a log line. No-op for users without Obsidian.

## Theme → Obsidian variable mapping

| Obsidian variable | Source | Notes |
|---|---|---|
| `--background-primary` | `layout.cardBg` (composited for opaque themes; raw rgba for glass) | Editor / main pane |
| `--background-primary-alt` | `bg` lightened 6% | Slight elevation |
| `--background-secondary` | `bg` darkened 20% | Sidebar / panel |
| `--background-modifier-border` | `bg` lightened 20% | Dividers |
| `--background-modifier-hover` | `fg @ alpha 0.08` | Hover wash |
| `--text-normal` | `accents.status.text` for opaque themes; `#FFFFFF` for glass | Same rule as Warp glass mode |
| `--text-muted` / `--text-faint` | `smallMuted` / `fg @ 0.5` | |
| `--text-accent` | `accents.status.h1` | Default link / accent text |
| `--text-error` / `--text-warning` / `--text-success` | `status.bad` / `.warn` / `.good` | |
| `--interactive-accent` | `menuBarTint` | Cursor, primary buttons |
| `--h1-color` … `--h4-color` | `accents.status.h1`, `weather.h1`, `calendar.h1`, `nowplaying.h1` | Heading colors mapped to our four widget accent families so each H-level reads as a different family |
| `--code-background` | `fg @ alpha 0.08` | Inline code |
| `--code-keyword` / `--code-string` / `--code-value` / `--code-function` | `nowplaying.h1` / `status.good` / `weather.h1` / `calendar.h1` | Cheap syntax highlight reusing the same family rotation |
| `--blockquote-border-color` | `menuBarTint` | |

## Glass-theme behavior

For themes with translucent `cardBg` (`liquid-glass`, `liquid-glass-dark`, `frutiger-aero`), the codegen emits an additional block that:

1. **Sets the Obsidian background CSS vars to alpha-scaled values from `cardBg`** — `--background-primary` at `cardBg.a × 0.5`, `--background-primary-alt` at `× 0.7`, `--background-secondary` at `× 0.4`. Note: under Position A (current default), the editor body itself is NOT painted via `--background-primary` — `.workspace` is fully transparent and the inner editor surfaces are forced transparent (item 3). These vars remain set as a fallback for any unhandled Obsidian surface that consumes them directly (some plugin-rendered panes, edge modals), so they let the wallpaper bleed through (via vibrancy) when Obsidian's "Translucent window" toggle is on instead of compositing onto a hex bg.
2. **Forces the root chain transparent** — `html`, `body`, `.app-container`, `.horizontal-main-container`, `.theme-dark`, `.theme-light` all `background-color: transparent !important`. Prevents user-installed themes (AnuPpuccin, Catppuccin, Default) from painting an opaque bg that blocks vibrancy.
3. **Forces inner editor surfaces transparent and `backdrop-filter: none`** — `.workspace-ribbon`, `.workspace-split`, `.workspace-tabs`, `.workspace-leaf-content`, `.markdown-*`, `.cm-*`, `.view-*`, `.status-bar`, AIDB hub surfaces. Empty bg + no filter on these so the `.workspace` glass layer below is the only one painting.
4. **Leaves `.workspace` untinted** (`cardBg.a × 0` — fully transparent). **No `backdrop-filter` on `.workspace`** either. The editor surface is wallpaper + AppKit vibrancy material with no CSS overlay; theme identity lives in headings, code chrome, modals, and the inner-edge highlight. See "backdrop-filter on `.workspace` doesn't work in Electron" + "Vibrancy perceptual cliff" sections below for the rationale.
5. **Tints `.modal`, `.suggestion-container`, `.menu`, `.popover`** with `cardBg.a × 0.9` AND **applies `backdrop-filter: blur(...)`** (no `saturate(...)`) — those surfaces are smaller stacking contexts where Chromium's `backdrop-filter` does work, so they get real frost-blur. The `layout.backdropSaturate` token is consumed by the widget pipeline (`src/widget_theme.ts`), not Obsidian.
6. **Soft inner top-edge highlight** on `.workspace-leaf-content` via `box-shadow: inset 0 1px 0 rgba(255,255,255,0.18)` — the lit-edge that pairs with our card aesthetic.
7. **Component-level glass treatments** for inline code (accent chip), code blocks (translucent card), tables (rounded glass with distinct header / alternating rows / hover / mono accent first column), callouts (translucent card with thicker accent left border + `backdrop-filter`), links (accent color + low-alpha underline), and `strong` (soft white at 600 weight). Adapted from the Glass Theme design (archived under `~/Desktop/AIDB/_global/personal/mac-customization/glass-theme-design/`) — the design's structural moves applied with this theme's accent palette instead of its literal deep-navy values, so the look stays on-brand for whatever theme is active. Every surface is alpha-tinted (not opaque) so vibrancy + wallpaper continue to bleed through.

**Required for the wallpaper-bleed-through to work**: the user must enable Settings → Appearance → "Translucent window" once. We don't write that key because it lives under different paths across Obsidian versions and the toggle is one-time. Without it, the alpha values composite onto Obsidian's opaque chrome and read as the flat hex bg.

## backdrop-filter on `.workspace` doesn't work in Electron

Empirical finding from build-out: **`backdrop-filter: blur(...)` on `.workspace` (or any large workspace-level container) does not reliably blur the macOS vibrancy backdrop in Obsidian's Electron+vibrancy stack.** Symptom: editor renders solid opaque cyan instead of frosted glass; **resizing the window shows the correct frosted-glass render for one frame then freezes again.**

We tried and rejected:

- **Übersicht-style opacity keepalive animation** (`50% { opacity: 0.9999; }`). Works for our widgets in `.claude/rules/widget-build-invariants.md` — those run in WebKit. Obsidian is Chromium, different bug, didn't fix.
- `will-change: backdrop-filter` — no effect.
- `::before` pseudo-element trick — no effect.
- `!important` on backdrop-filter — rule was already winning, not a specificity issue.
- Moving the glass layer to body / `.app-container` — same freeze.

Root cause is that Chromium composites the WebContents framebuffer separately from the AppKit `NSVisualEffectView` vibrancy layer; `backdrop-filter` samples the framebuffer (which is empty/transparent in our case), not the vibrancy layer underneath. Window resize briefly invalidates the compositor cache and reveals the vibrancy layer — that's what the user sees as "works for one frame then breaks."

**Current pragmatic fix:** `.workspace` has **no bg paint and no backdrop-filter** (the "transparent paper" position — see the perceptual-cliff section for why we picked 0 over an in-between value). macOS vibrancy + wallpaper show through directly (unblurred, but visible). Modals/menus/popovers KEEP both an alpha-tinted bg AND `backdrop-filter` because they're smaller stacking contexts where Chromium handles `backdrop-filter` consistently — the frost-blur effect is preserved on those, and they become the showpiece glass surface that the editor body deliberately is not.

For real frost-blur on the editor surface we'd need to either fork Obsidian's Electron flags or accept the limitation. If the bug is fixed in a future Chromium / Electron / Obsidian release, re-enable backdrop-filter on `.workspace` and remove this section.

## Vibrancy perceptual cliff (the alpha multiplier looks broken below ~0.30)

When tuning `.workspace`'s alpha multiplier, **values that produce a final alpha below ~0.30 all look visually identical** over the macOS vibrancy material. This is NOT a bug in the codegen, hot-reload, or cascade — it's a perceptual interaction with `NSVisualEffectView`.

macOS vibrancy in dark mode (`NSVisualEffectMaterialUnderWindowBackground` or similar — Obsidian picks the material) already renders a bluish-gray cast. Our cyan/blue tints below ~0.30 alpha blend imperceptibly into that cast. Sweep test: setting `.workspace` to `rgba(133, 207, 238, 0.01)` vs `0.13` vs `0.30` produces no visible difference; `0.99` finally reads as obviously cyan.

Modals don't have this problem because their `backdrop-filter: blur` adds visual weight — the blurred sample of underlying pixels combined with even ~0.234 alpha produces a clearly frosted appearance. `.workspace` skips `backdrop-filter` (see the section above), so it needs to push past the cliff with much higher alpha to register.

**The multiplier is a taste dial, not a fixed value.** The codegen ships with `0` — the "transparent paper" position. Rationale: the in-between values (0.05–0.30) all sit in the perceptual dead zone documented below, so we either commit to no tint (and let theme identity live in headings, modals, code chrome) or commit to a heavy tint past 0.30. Anything in between is design-by-indecision. Empirical anchors observed during tuning (frutiger-aero, dark mode, vibrancy on):

| Multiplier | Final alpha (cardBg.a=0.26) | Reads as |
|---|---|---|
| 0    | 0     | No tint, vibrancy + wallpaper only (current default — "transparent paper") |
| 0.12 | 0.031 | Wallpaper-forward, vestigial tint (previous default — within dead zone) |
| 0.5  | 0.13  | Modest cyan glaze (still in dead zone — looks identical to 0.12) |
| 1.0  | 0.26  | Modal-equivalent density, glass-like |
| 1.2  | 0.31  | "Too heavy" per user |
| 2.0  | 0.52  | Frosted-glass but feels opaque |

The "heavy" threshold sits around final alpha ~0.30 — past it, the editor reads as a tinted pane rather than vibrancy with a hint of color. Below ~0.30 the tint is perceptually absorbed by the AppKit material wash and looks identical to 0. Tune to taste, but only consider raising past ~1.0; values between 0 and 1.0 all read as "no tint" or "vestigial tint" depending on lighting.

**Symptom this section exists to prevent:** future debug sessions where someone sweeps the multiplier from 0.02 to 0.99 (in the codegen, with rebuilds), sees no change, and concludes the codegen is broken / hot-reload is broken / Chromium is broken. They're all working — the values just live in the dead zone.

Diagnostic to confirm you're hitting this cliff vs. an actual bug:

```js
// In Obsidian DevTools console — bypasses the cascade.
document.querySelector('.workspace').style.setProperty('background-color', 'rgba(133, 207, 238, 0.99)', 'important')
```

If the editor turns near-solid cyan, the system works end-to-end and you're tuning in the dead zone. Push past 0.30. If the editor doesn't change, you have a different bug.

## Vibrancy material applies a dark/light wash you can't override

When the Obsidian window is translucent and macOS is in **dark appearance**, the wallpaper bleeding through is **darkened by AppKit's `NSVisualEffectView` material itself** — it's not something we paint, it's how the AppKit material is designed. In **light appearance** the same material applies a white wash and the wallpaper reads brighter. Confirmed empirically: switching macOS appearance dark → light flips the cast from dark-gray to white with no other changes.

This is a property of which `NSVisualEffectMaterial` Obsidian's `BrowserWindow` config requests. Every Electron/Mac app with vibrancy (Slack, Notion, Linear, Cursor) shows the same behavior. **You can't change it from a CSS snippet** — it's set in Obsidian's main process when the window is created.

Practical implications when tuning the snippet:

- Don't expect the editor to ever look like a true clear-glass overlay on the wallpaper. There's always a material wash between vibrancy and the WebContents.
- Frutiger-aero / liquid-glass themes look more on-brand in macOS **light** appearance because the lighter wash matches the aqua aesthetic. In dark macOS, the dark wash fights against light/cyan accents.
- If a user reports "dark layer behind the cyan that won't go away", that's the material wash. Confirm by toggling Settings → Appearance → "Translucent window" off — the wash disappears (replaced by Obsidian's solid bg). It's not a missing transparent override.

Options if the user wants to escape the dark wash:
- Switch macOS appearance to light (System Settings → Appearance → Light/Auto).
- Switch Obsidian's base theme to Light (Settings → Appearance → Base color → Light) — separate from macOS appearance, but some users report the vibrancy material adapts.
- Patch Obsidian's `app.asar` to change which `NSVisualEffectMaterial` is requested (`fullscreen-ui`, `popover`, `under-window` are all lighter than the default). Same fragility category as the Slack `app.asar` patch — sudo, TCC App Management, auto-update wipes it on every Obsidian update. Not a small lift.
- Disable Translucent window entirely — no vibrancy, no wash, but also no wallpaper.

## Translucent only when window is focused

Symptom: when Obsidian has window focus, the editor is correctly translucent and the wallpaper shows through. When focus moves to another app (Cmd+Tab away or click another window), the editor flips to opaque solid blue.

This is **macOS `NSVisualEffectView` default behavior** — `state: NSVisualEffectStateFollowsWindowActiveState` is the default, which disables vibrancy when the window blurs. Same behavior in Slack, Notion, any other Electron app with `vibrancy` enabled by default. Not fixable from CSS — Obsidian's main process owns the `BrowserWindow` config and would need `visualEffectState: 'active'` to keep vibrancy on regardless of focus. We can't reach that from a snippet.

Workarounds we considered and rejected:

- **JS to swap alpha based on document focus events.** Could work but adds runtime JS to a CSS-snippet system, breaks the "pure CSS" contract.
- **Patch Obsidian's `app.asar` to set `visualEffectState: 'active'`.** Same fragility as the Slack patch (auto-update wipes it; sudo + TCC needed). Cost > benefit for a focus-state polish.

**Accepting the limitation as documented.** If a future Obsidian release exposes the Electron flag in user settings, re-test and update.

## Hot-reload caveat

Obsidian watches `<vault>/.obsidian/snippets/` and reapplies CSS automatically for **already-enabled** snippets — no Obsidian restart on subsequent builds. But the **first time** the snippet is added to a vault, the codegen also has to flip it on in `appearance.json`. If Obsidian was running before the snippet existed, it may need a single manual toggle of Settings → Appearance → CSS snippets (refresh button + flip toggle) to register the new file. Subsequent rewrites then hot-reload cleanly.

If the snippet is rewritten while Obsidian is running and the changes don't appear, that's the symptom — the file is on disk and enabled in `appearance.json`, but Obsidian missed the create event. One manual toggle fixes it permanently.

## Skip-if-unchanged

Each vault is checked independently. The CSS body is compared against the existing snippet, AND the `enabledCssSnippets` array is checked for our entry. Only vaults where one of those changed get a write. Output reports `(snippet)`, `(enabled)`, or `(snippet + enabled)` per vault, or a single "all up-to-date" line when nothing changed.

## Multiple vaults

The codegen handles this implicitly — the registry lists all of them, and we write to each. Theme switches propagate to every vault simultaneously. There's no per-vault override mechanism (deliberately — the whole point of the codegen ecosystem is one source of truth).

There's currently no opt-out mechanism — every registered vault gets the snippet on every run. Manually disabling it via Obsidian's UI doesn't stick because the codegen re-adds `"uber-theme"` to `enabledCssSnippets` on the next run if it's missing. If a real need emerges, the natural place to add an opt-out is the per-vault loop in `build-obsidian-theme.mjs`.
