# Color palette redesign Implementation Plan

## Overview

Replace the app's unmodified create-t3-app scaffold palette with a deliberately designed one: a full, distinct tonal ladder across the 6 shadcn surface roles (fixing the "6 roles collapsed into 2 values" flatness research found), a more vibrant `--primary`, and a new warm `--accent` reused from the existing chart-3 amber hue — targeting a vibrant/energetic, modern-SaaS-dashboard feel instead of today's flat, cool-only scheme. Chart tokens and canvas entity colors stay untouched (already correct, carry simulation meaning).

## Current State Analysis

- `src/styles/globals.css:65-134` — `:root` and `.dark` are byte-identical. `--background`/`--card`/`--popover` all equal `oklch(0.212 0.043 280.069)`; `--secondary`/`--muted`/`--accent` all equal `oklch(0.29 0.043 280.069)` — 6 semantically distinct roles render as only 2 actual values.
- `--primary`/`--sidebar-primary` = `oklch(0.279 0.155 290.166)` — the only token with real chroma today; hue ~290 (violet/purple).
- `--ring` = `oklch(0.75 0.12 290)` — same hue family as `--primary`, used by 12 files for focus-visible outlines.
- `--chart-3` = `#f59e0b` (amber) — already a diversified, correct categorical palette per AGENTS.md; not touched by this change.
- `--destructive` = `oklch(0.65 0.18 20)` — already warm (red-orange), distinct hue (20) from the new accent's hue (~68) — no risk of confusion between "danger" and "the new accent."
- Full detail: `context/changes/color-palette-redesign/research.md`.

## Desired End State

Every one of the 6 surface-role tokens has its own distinct value, forming a visible tonal ladder from darkest (background) to lightest (accent). `--primary` reads as more vibrant (higher lightness and chroma) without losing dark-mode legibility. A new warm `--accent` (amber-family, reused from `--chart-3`'s hue) gives the palette the one warm counterpoint design research recommends. `:root` and `.dark` remain byte-identical (documented, intentional — no light/dark toggle exists). Chart tokens, canvas entity colors, and sidebar tokens are untouched.

### Key Discoveries:

- `--input` (not `--card`) is this app's de facto "card surface" class (24 files: `LabeledCard`, `AnalysisCard`, `RunRow`, most form fields) — but it's an alpha-over-background overlay (`oklch(1 0 0 / 10%)`), not a solid token, so it naturally follows whatever `--background` becomes with no separate edit needed.
- M-12 already built kitchen-sink pages for 5 views (`dashboard`, `leaderboard`, `runs`, `admin`, `reference`) that enumerate every design-token-driven component state — these are the ideal verification surface for a token-only change like this one; no new kitchen-sink page is needed.
- `--sidebar`/`--sidebar-accent` are already achromatic (chroma 0) and visually distinct from the main content area by design — left untouched; the user decided chart/canvas colors (and by extension this pre-existing achromatic framing) stay out of scope.

## What We're NOT Doing

- Not touching `--chart-1` through `--chart-5` — user decision: already correct, already diversified, out of scope.
- Not touching `src/styles/theme-colors.ts` (canvas entity colors: boid/food/predator) — user decision: carries simulation meaning (colorblind-safe shape+color pairing), out of scope.
- Not adding a light/dark toggle — `:root`/`.dark` staying identical is documented, intentional existing behavior, not part of this change's scope.
- Not changing `--foreground`/`*-foreground` (all pure white) — changing universal body-text color carries the highest legibility-regression risk for the smallest payoff; current white-on-dark contrast is already strong.
- Not changing `--border`/`--input` values directly — both are alpha-over-background overlays that naturally shift with the new `--background`, no edit needed.
- Not changing `--sidebar`/`--sidebar-accent`/`--sidebar-border`/`--sidebar-ring` — achromatic, already visually distinct from content, not implicated by the "depressing" complaint.

## Implementation Approach

Single phase: this is a one-file, token-values-only change (no component code, no new files). Verification reuses the existing M-12 kitchen-sink pages instead of building new ones.

## Phase 1: Apply the new design-token palette

### Overview

Replace the relevant `:root`/`.dark` CSS custom properties in `globals.css` with a full, distinct tonal ladder plus a more vibrant primary and new warm accent; verify live across representative pages.

### Changes Required:

#### 1. Surface-role tonal ladder (background → card → popover → secondary → muted → accent)

**File**: `src/styles/globals.css`

**Intent**: Give each of the 6 shadcn surface roles its own distinct value instead of 2 collapsed values, restoring the visual depth shadcn's component library assumes. Keep `secondary`/`muted` in the existing cool purple-family hue (subtle, low-chroma); make `accent` the one warm token, per the 60-30-10 principle design research recommends (one scarce accent, not a palette-wide hue change).

**Contract**: Update these 6 custom properties identically in both `:root` and `.dark` (they must stay byte-identical, per the file's own documented "no toggle" intent):

```css
--background: oklch(0.16 0.035 280);
--card: oklch(0.21 0.042 282);
--popover: oklch(0.25 0.045 283);
--secondary: oklch(0.30 0.05 284);
--muted: oklch(0.34 0.035 280);
--accent: oklch(0.34 0.11 68);
```

`--card-foreground`, `--popover-foreground`, `--secondary-foreground`, `--accent-foreground` stay `oklch(1 0 0)` (unchanged) — each new value keeps enough lightness separation from white text to stay legible (lightness 0.21–0.34 vs. foreground 1.0).

#### 2. More vibrant `--primary` and matching `--sidebar-primary`

**File**: `src/styles/globals.css`

**Intent**: Raise lightness and chroma on the app's one existing chromatic brand token so it reads as more vibrant/energetic, per the user's chosen "modern SaaS feel" direction — without changing its hue family (user decision: keep purple).

**Contract**: Update in both `:root` and `.dark`:

```css
--primary: oklch(0.34 0.195 291);
--sidebar-primary: oklch(0.34 0.195 291);
```

`--primary-foreground`/`--sidebar-primary-foreground` stay `oklch(1 0 0)` (unchanged — still strong contrast at this lightness).

#### 3. Updated `--ring` and `--muted-foreground`

**File**: `src/styles/globals.css`

**Intent**: `--ring` (focus-visible outlines, 12 consuming files) should track `--primary`'s new, more vibrant direction so focus states don't look washed out next to the new brand color. `--muted-foreground` (de-emphasized text, 17 consuming files) gets a small lightness bump to stay legible against the new, slightly lighter `--muted`.

**Contract**: Update in both `:root` and `.dark`:

```css
--ring: oklch(0.80 0.16 291);
--muted-foreground: oklch(0.68 0.03 280);
```

#### 4. Unchanged tokens (explicit, so nothing is missed or accidentally touched)

**File**: `src/styles/globals.css`

**Intent**: Confirm scope discipline — these tokens are deliberately left as-is.

**Contract**: `--foreground`/`*-foreground` (pure white), `--destructive`/`--destructive-foreground`, `--border`, `--input`, `--radius`, `--sidebar`/`--sidebar-accent`/`--sidebar-border`/`--sidebar-ring`/`--sidebar-foreground`, `--chart-1` through `--chart-5`, and the entire `@theme inline` block all stay exactly as they are today.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full suite still passes: `npm test`
- `:root` and `.dark` blocks remain byte-identical after the edit: `diff <(sed -n '/^:root {/,/^}/p' src/styles/globals.css) <(sed -n '/^\.dark {/,/^}/p' src/styles/globals.css | sed 's/^\.dark/:root/')` (adjust the extraction to the file's actual block boundaries) shows no differences beyond the selector itself.
- `--chart-1` through `--chart-5` and every line in `src/styles/theme-colors.ts` are byte-unchanged: `git diff --stat src/styles/theme-colors.ts` shows no changes; `git diff src/styles/globals.css` shows no changes to the `--chart-N` lines.

#### Manual Verification:

- Live, production-build screenshots of: `/dashboard/kitchen-sink`, `/leaderboard/kitchen-sink`, `/runs/kitchen-sink`, `/admin/kitchen-sink`, `/reference/kitchen-sink`, plus `/dashboard` and `/login` themselves — confirm every surface role is now visually distinguishable (no two adjacent surfaces look identical), the new accent color is visible wherever `bg-accent`/`text-accent-foreground` render, and nothing reads as broken or illegible.
- Focus-visible ring check: tab to a focusable element (e.g. a kitchen-sink `BackLink` or button) and confirm the ring is clearly visible against the new background — not washed out, not clipped.
- Rough contrast spot-check: confirm body text (`text-foreground`, white) and muted text (`text-muted-foreground`) both read clearly against their respective new backgrounds on at least one screenshot each.
- Subjective check against the stated goal: does the result read as more vibrant/energetic than before, not just differently-colored?

## Testing Strategy

### Unit Tests:

- None new — this is a CSS custom-property value change with no logic; the existing suite (`npm test`) is the regression gate (confirms no snapshot/test currently hardcodes an old token value in an unexpected way).

### Manual Testing Steps:

1. Build and serve a production build (`npm run build && npm run start`), not the dev server, to avoid Turbopack HMR interference (established pattern this project uses for visual verification).
2. Screenshot each of the 7 pages listed in Success Criteria at a representative desktop width.
3. Tab-focus check on at least one interactive element for the ring verification.
4. Compare before/after mentally (or via the prior M-12 kitchen-sink screenshots still in review history) against the "vibrant/energetic, modern SaaS feel" goal.

## Performance Considerations

None — CSS custom-property value changes only, no new computation, no additional assets.

## Migration Notes

None — no persisted data, no schema, no API surface touched. Pure presentational change.

## References

- `context/changes/color-palette-redesign/research.md` — full inventory of current tokens, why the current scheme reads as flat/depressing, and external design-research grounding for the fix direction.
- `context/archive/2026-11-14-ui-design-system-foundation/` (F-06) — confirms the current palette was never a deliberate design choice (inherited scaffold default).
- `src/app/dashboard/kitchen-sink/page.tsx`, `src/app/leaderboard/kitchen-sink/page.tsx`, `src/app/runs/kitchen-sink/page.tsx`, `src/app/admin/kitchen-sink/page.tsx`, `src/app/reference/kitchen-sink/page.tsx` — the verification surface this plan reuses from M-12.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Apply the new design-token palette

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck` — 12cbe36
- [x] 1.2 Lint passes: `npm run check` — 12cbe36
- [x] 1.3 Full suite still passes: `npm test` — 12cbe36
- [x] 1.4 `:root` and `.dark` blocks remain byte-identical — verified via diff, only difference is `--radius` (root-only by the plan's own contract) — 12cbe36
- [x] 1.5 `--chart-1..5` and `theme-colors.ts` are byte-unchanged — verified via `git diff` — 12cbe36

#### Manual

- [x] 1.6 Live screenshots across 7 representative pages confirm every surface role is visually distinguishable and the new accent renders correctly — verified live (production build): login, dashboard/kitchen-sink, leaderboard/kitchen-sink, reference/kitchen-sink, admin/kitchen-sink, runs/kitchen-sink all screenshot; background/card/popover/secondary/muted now all visibly distinct tonal steps, warm amber --accent clearly visible on the dashboard's active tab, destructive red stays distinct from the new accent hue. — 12cbe36
- [x] 1.7 Focus-visible ring check passes (clearly visible, not washed out) — verified via computed-style inspection (outlineColor resolves exactly to the new oklch(0.8 0.16 291) value) and visually on reference/kitchen-sink's BackLink. — 12cbe36
- [x] 1.8 Rough contrast spot-check on body text and muted text — confirmed legible across all 6 screenshotted pages, including small muted-foreground labels in admin/kitchen-sink. — 12cbe36
- [x] 1.9 Subjective check: result reads as more vibrant/energetic than before — confirmed: the gradient banner, primary buttons, and new warm accent produce a visibly livelier result than the prior flat, single-hue scheme. — 12cbe36
