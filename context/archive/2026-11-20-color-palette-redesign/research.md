---
date: 2026-11-20T10:28:42+01:00
researcher: Claude Sonnet 5
git_commit: 329f5b97a2428fd2ae38cc2d513a941aa71ecc74
branch: master
repository: swarm-arena
topic: "Color palette redesign (S-51, M-13) — why the current scheme reads as depressing/low-energy, and what to change"
tags: [research, codebase, design-tokens, color, ui]
status: complete
last_updated: 2026-11-20
last_updated_by: Claude Sonnet 5
---

# Research: Color palette redesign

**Date**: 2026-11-20T10:28:42+01:00
**Researcher**: Claude Sonnet 5
**Git Commit**: 329f5b97a2428fd2ae38cc2d513a941aa71ecc74
**Branch**: master
**Repository**: swarm-arena

## Research Question

The user reports the app's current color scheme "feels depressing/low-energy" and wants it redesigned at the design-token level (`src/styles/globals.css`, `src/styles/theme-colors.ts`), not as a per-view fix (roadmap M-13, S-51, the milestone's north star). What causes the current scheme to read this way, what's already in place that a redesign must respect, and what does external design guidance suggest for fixing it?

## Summary

The current palette is **not a deliberate design choice** — it's create-t3-app's unmodified scaffold default purple (`#2e026d`/`#15162c`-equivalent), merely tokenized (not redesigned) when the design-token system (F-06) was built in 2026-11-14 (`context/archive/2026-11-14-ui-design-system-foundation/plan.md:9-11`). No prior change ever stated an aesthetic rationale for purple.

Two concrete, codebase-level causes of the "depressing/flat" feeling, found by direct inspection:

1. **Surface-tonal collapse.** `--background`, `--card`, and `--popover` are byte-identical (`oklch(0.212 0.043 280.069)`), and `--secondary`, `--muted`, and `--accent` are also byte-identical to each other (`oklch(0.29 0.043 280.069)`) — six semantically distinct shadcn surface roles collapse into just two actual visual values. There is no tonal depth cue anywhere in the UI chrome.
2. **Single cool hue, no warm contrast.** Every UI-chrome token (background/card/popover/primary/secondary/muted/accent/sidebar) sits in the same hue ~280–290° (violet/purple) family, at low-to-moderate chroma. External design research (below) attributes a "calm/low-energy/subdued" read specifically to an all-cool-hue palette with no warm counterpoint.

Both causes are independently fixable without necessarily abandoning the purple hue family — this is a genuine open decision for `/10x-plan`, not something this research resolves unilaterally (see Open Questions).

Two things that are **already correct and out of scope** for this redesign: the chart-series tokens (`--chart-1` through `--chart-5` = gray/green/amber/red/blue) are already diversified and AGENTS.md already mandates using them; and the simulation canvas's entity colors (`theme-colors.ts`: boid blue, food green, predator orange) are a separate, meaningful color-coding system, not part of the "depressing UI chrome" complaint.

## Detailed Findings

### Current token inventory (`src/styles/globals.css`, full read)

- `:root` and `.dark` are **byte-for-byte identical** (lines 65–99 vs. 101–134), except `--radius` only appears in `:root`. The file's own header comment (lines 56–64) states this is intentional: "This app has no light/dark toggle, so `:root` and `.dark` intentionally hold the same single theme."
- Confirmed via `grep -rn "next-themes|ThemeProvider|data-theme" src` (zero matches) and `grep -n "next-themes" package.json` (zero matches, dependency not installed) — the app is **dark-mode-only**, with no runtime theme switch. The `.dark` class exists only because shadcn's scaffold expects it.
- Full token list and values:
  - `--background` / `--card` / `--popover`: `oklch(0.212 0.043 280.069)` (identical)
  - `--foreground` / `--card-foreground` / `--popover-foreground` / `--primary-foreground` / `--secondary-foreground` / `--accent-foreground` / `--destructive-foreground`: `oklch(1 0 0)` (pure white, identical across all of these)
  - `--primary` / `--sidebar-primary`: `oklch(0.279 0.155 290.166)` (hue ~290, the one token with real chroma, 0.155)
  - `--secondary` / `--muted` / `--accent`: `oklch(0.29 0.043 280.069)` (identical to each other)
  - `--muted-foreground`: `oklch(0.65 0.02 280)`
  - `--destructive`: `oklch(0.65 0.18 20)` (hue ~20 — already warm/red-orange)
  - `--border`: `oklch(1 0 0 / 20%)`; `--input`: `oklch(1 0 0 / 10%)` (both white-alpha overlays, not hue-based)
  - `--ring`: `oklch(0.75 0.12 290)` (same purple-family hue as `--primary`)
  - `--chart-1..5`: `#9ca3af` (gray), `#22c55e` (green), `#f59e0b` (amber), `#ef4444` (red), `#38bdf8` (sky blue) — already a diversified categorical palette
  - `--sidebar` / `--sidebar-accent`: `oklch(0.205 0 0)` / `oklch(0.269 0 0)` — pure grayscale (chroma 0), distinct from the main content area's purple-tinted surfaces
  - `--radius: 0.625rem` (root only)
- `@theme inline` (lines 13–54) is standard shadcn Tailwind-token wiring — maps `--color-*` classes to the `--*` CSS vars above; no additional color decisions live there.

### Usage frequency (file-count, not occurrence-count; via grep across `src/**/*.{ts,tsx,css}`)

`text-foreground` (38 files), `bg-input` (24), `bg-background` (15), `text-muted-foreground` (17), `ring-ring` (12), `border-border` (8), `bg-muted` (6), `bg-primary` (4), `bg-destructive` (3), `bg-popover` (3), `--chart-N` forms (4: `runs/[runId]/page.tsx`, `runs/compare/page.tsx`, `simulation-canvas.tsx`, `server-run-viewer.tsx`), `bg-secondary`/`bg-accent`/`bg-card`/`bg-sidebar` (1 file each). `bg-input` is the dominant "card-like surface" class across the app (used by `LabeledCard`, `AnalysisCard`, `RunRow`, and most form fields) — any redesign of `--input`'s value has the widest blast radius of any single token.

### `src/styles/theme-colors.ts` (full read, 37 lines) — canvas-only, out of scope

- `CANVAS_BACKGROUND = "#1e293b"` — deliberately distinct slate backdrop for the `<canvas>`, separate from the page's `--background`.
- `BOID_FILL_COLOR` (`#38bdf8`, cyan-blue), `FOOD_FILL_COLOR` (`#22c55e`, green), `PREDATOR_FILL_COLOR` (`#f97316`, warm orange) — these are the simulation's entity color-coding, with the predator's warm orange deliberately contrasting boid blue "paired with shape differentiation for colorblind accessibility" (comment, lines 13–19). `CANVAS_BORDER_COLOR` / `CANVAS_HIGHLIGHT_COLOR` mirror `--border`/`--foreground` at different alphas.
- These colors carry simulation meaning (entity identity), not app mood — redesigning the UI-chrome palette should leave them alone. `--chart-1..5`'s phase colors (`runs/[runId]/page.tsx:25-29`, `runs/compare/page.tsx:30-33`) are a separate case: they already reference the chart tokens via `var(--chart-N)`, so a value change there would need no new call-site edits.

### AGENTS.md's existing color rules (exact quotes, UI section)

- "No literal colors or arbitrary Tailwind values in views — reference a token instead."
- "Chart-series colors ... must reference `var(--chart-1)` through `var(--chart-5)` (`globals.css`), not a local hex array — these tokens carry real hue now (gray/green/amber/red/blue), not the grayscale placeholder they shipped with."
- `theme-colors.ts` "must be kept in sync with `globals.css` by hand — nothing enforces this automatically."

A redesign that changes any `globals.css` token value referenced by `theme-colors.ts` (there currently are none — the two files use entirely separate color sets, see above) would need to honor this manual-sync rule; as inventoried, no such overlap exists today.

### Historical design rationale — none exists

- F-06 (`context/archive/2026-11-14-ui-design-system-foundation/`) has no `research.md`. Its `plan.md:9` states the color tokens "already existed, unused, in `globals.css` before F-06" — the shadcn scaffold anticipated a sidebar-shell layout and was "never finished." F-06's own stated scope (`plan.md:21`, `plan-brief.md:21`) was "finish what the token setup already anticipated, not inventing new tokens" — it consumed the pre-existing create-t3-app defaults and fixed two literal-hex violations (`layout.tsx`, `login/page.tsx`) by pointing them at those tokens. No aesthetic rationale for purple is stated anywhere.
- S-15 (`context/archive/2026-11-14-branded-login-page/plan.md`) narrowed to favicon-only work; its color choice (reusing `--primary`/`--background`) was "agreed with the user directly during this planning session," with no design-principle writeup.
- `context/foundation/lessons.md` has exactly one color-related lesson ("Procedurally-spread colors must anchor on the actual seed color's hue, not a fixed 0°," lines 33–38) — about boid/flock hue-spacing math, unrelated to palette mood or UI chrome.
- `context/foundation/tech-stack.md` has no mention of design-system or color rationale.

### External design guidance (web research, 2026)

Two searches ([10 Modern Color Palettes for SaaS Dashboards](https://dev.to/danish_khan_2d39d5ccce89b/article-title-10-modern-color-palettes-for-saas-dashboards-2026-edition-4pfm), [Best Admin Dashboard Color Schemes](https://adminlte.io/blog/best-admin-dashboard-color-schemes/), [Dark Dashboard Templates](https://adminlte.io/blog/dark-dashboard-templates/), [SaaS Dashboard Design Trends 2026](https://dev.to/thekitbase/saas-dashboard-design-trends-in-2026-with-examples-121m), [Dark Mode UI Design Tips — Toptal](https://www.toptal.com/designers/ui/dark-mode-ui-design-tips), [Effective Color Schemes for Analytics Dashboards](https://www.insightsoftware.com/simba/blog/effective-color-schemes-for-analytics-dashboards/), [Emotional Design & Psychology — Toptal](https://www.toptal.com/designers/ux/emotional-design-psychology), [Color Theory — Toptal](https://www.toptal.com/designers/ux/color-theory), [Colors and Emotions — Toptal](https://www.toptal.com/designers/ux/colors-and-emotions), [The Role of Color in UX — Toptal](https://www.toptal.com/designers/ux/color-in-ux)) converge on:

- **"Dark" should mean low-light, not black.** Tint surfaces toward dark grays/tinted-dark rather than near-black; add tonal steps between surfaces so elements don't blend into each other (directly applicable here — see the surface-tonal-collapse finding above).
- **One accent color, used scarcely.** The 60-30-10 split (dominant / secondary / accent) is the recommended ratio; overusing the accent is cited as a common reason a UI reads as busy rather than lively.
- **Cool hues read calm/low-energy; a warm accent counters it.** Cool colors (blue, purple, teal) are perceived as calm and settling; warm colors (orange, amber, coral) draw attention and read as energetic. The reliable pattern is a cool base with a single warm accent — not abandoning the cool base entirely.
- **Desaturate accents on dark surfaces.** Fully saturated colors "vibrate" against dark backgrounds; a lightly desaturated warm accent (amber/coral) is recommended over a fully saturated one.
- **Keep chart colors on their own palette strategy**, separate from UI chrome — already true here (`--chart-1..5` is independent of `--primary`/`--secondary`/etc.).
- **Check colorblind safety** when finalizing any new categorical/status colors (lower-confidence source, but consistent with this repo's own existing predator/boid shape+color redundancy).

## Code References

- `src/styles/globals.css:56-134` — the full token system; lines 65-99 (`:root`) and 101-134 (`.dark`), confirmed byte-identical; header comment (56-64) documents the dark-only intent and the create-t3-app provenance.
- `src/styles/globals.css:13-54` — `@theme inline` Tailwind-token wiring (no additional color decisions).
- `src/styles/theme-colors.ts:1-37` — canvas-only colors, out of scope for this redesign.
- `src/server/simulation/seed-colors.ts:10-16` — `BOID_SEED_COLOR`/`FOOD_SEED_COLOR`/`PREDATOR_SEED_COLOR`, the source constants `theme-colors.ts` re-exports.
- `src/app/runs/[runId]/page.tsx:25-29`, `src/app/runs/compare/page.tsx:30-33` — phase-color mappings that already reference `var(--chart-N)`.
- `context/archive/2026-11-14-ui-design-system-foundation/plan.md:9,21` — confirms the palette is an unmodified inherited default, not a designed choice.
- `context/archive/2026-11-14-branded-login-page/plan.md:17,22,46` — confirms no palette rationale was ever written for the login page either.
- `AGENTS.md` (UI section) — the three existing color rules quoted above.

## Architecture Insights

- The six shadcn surface roles (`background`, `card`, `popover`, `secondary`, `muted`, `accent`) were scaffolded as distinct CSS custom properties but were never actually differentiated in value — this repo has effectively been running a 2-tone dark theme (one "base" value, one "slightly lighter but still identical-to-3-other-roles" value) since F-06 shipped, despite shadcn's own component library assuming all six are visually distinguishable. Any redesign should treat "give each surface role its own value" as a structural fix independent of whatever final hue is chosen.
- `bg-input` is this app's de facto "card surface" class (24 files — `LabeledCard`, `AnalysisCard`, `RunRow`, most form inputs) even though `--input` is semantically a form-field-border token in shadcn's own convention, not a card-background token. A hue/value change to `--input` has the single widest blast radius of any token in the system — wider than `--card` itself (3 files), which is shadcn's "intended" card-surface token but is barely used in this codebase.
- `--primary` (hue ~290.166, chroma 0.155) is the only UI-chrome token with meaningful chroma today; every other role is near-neutral (chroma 0.043 or less) or fully achromatic (`--sidebar*`, chroma 0). This matches the external-research finding that a single-accent-with-neutral-everything-else structure is already half-present here — the gap is that the one chromatic token (`--primary`) is cool (purple), not warm, and the neutral tokens don't yet form a real tonal ladder.

## Historical Context (from prior changes)

- `context/archive/2026-11-14-ui-design-system-foundation/` (F-06) — established the token system (consumed pre-existing scaffold defaults, invented no new colors).
- `context/archive/2026-11-14-branded-login-page/` (S-15) — first slice built on F-06; favicon-only scope, no palette discussion.
- `context/archive/2026-11-20-dashboard-ui-refresh/`, `.../leaderboard-ui-refresh/`, `.../runs-analysis-compare-ui-refresh/`, `.../admin-pages-ui-refresh/`, `.../reference-pages-ui-refresh/` (M-12, all 2026-11-20) — all five re-audited views against the *existing* token system for drift/missing-shared-component issues; none questioned or changed the token *values* themselves. This redesign (S-51) is the first change in the project's history to touch token values rather than token *adoption*.

## Related Research

- `context/changes/color-palette-redesign/research.md` (this document) is the first research doc for this change.

## Open Questions

1. **Keep the purple hue family (with real tonal depth + one warm accent added) vs. shift the base hue entirely (e.g. toward a cooler blue/teal or a warmer neutral-gray base)?** Both are defensible per the external research — tonal flatness is likely the larger contributor to "depressing," and fixing it doesn't require abandoning purple. This is a genuine aesthetic decision for `/10x-plan` to raise with the user, not something this research resolves. — Owner: user, via `/10x-plan`. Block: no (research found no reason either path is wrong).
2. **Which token becomes the new warm accent, and does it introduce a new value or reuse an existing warm hue already in the app** (`--chart-3` amber `#f59e0b`, `--destructive` hue~20, or the canvas's `PREDATOR_FILL_COLOR` `#f97316`)? Reusing an existing warm hue would need no new "meaning" to be invented and stays consistent with colors users already see elsewhere in the app. — Owner: user/team, via `/10x-plan`. Block: no.
3. **Does `--ring`'s value need to change if `--primary`'s hue shifts?** `--ring` currently matches `--primary`'s hue family and is used by 12 files for focus-visible outlines — any hue change should re-verify focus-ring legibility against the new background, not just copy the old relationship. — Owner: `/10x-plan` + manual verification during implementation. Block: no.
