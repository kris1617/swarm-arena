# Color palette redesign — Plan Brief

> Full plan: `context/changes/color-palette-redesign/plan.md`
> Research: `context/changes/color-palette-redesign/research.md`

## What & Why

The app's color scheme is create-t3-app's unmodified scaffold default — never a deliberate design choice — and the user reports it "feels depressing/low-energy." Research found two concrete causes: 6 distinct shadcn surface roles collapse into just 2 actual values, and every UI-chrome token sits in one cool hue family with no warm counterpoint.

## Starting Point

`src/styles/globals.css`'s `:root`/`.dark` blocks (byte-identical, dark-mode-only, no toggle) define `--background`/`--card`/`--popover` as one value and `--secondary`/`--muted`/`--accent` as another. `--primary` is the only token with real chroma. Chart tokens (`--chart-1..5`) and canvas entity colors (`theme-colors.ts`) are already correct and distinct.

## Desired End State

All 6 surface roles get distinct values forming a visible tonal ladder. `--primary` is more vibrant. A new warm `--accent` (amber, reused from `--chart-3`) gives the palette its one warm counterpoint. Chart/canvas colors, foreground text, and sidebar tokens stay untouched.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Target mood | Vibrant/energetic, modern SaaS feel | Directly targets the "depressing/low-energy" complaint rather than a minimal patch. | User |
| Hue family | Keep purple, fix tonal depth + add warm accent | Research found tonal flatness is the likely bigger contributor than hue itself; smaller, safer change. | User + Research |
| Accent source | Reuse `--chart-3`'s amber hue, not a brand-new color | Zero new meaning to invent; visually cohesive with a color users already see in charts. | User |
| Chart/canvas scope | Stay out of scope | Already correct per AGENTS.md; canvas colors carry colorblind-safe simulation meaning. | User |
| Tonal depth | Full 6-distinct-value ladder | Every surface role gets its own value, not just 2-3 steps. | User |
| Verification | Live screenshots across 7 pages + focus-ring/contrast check | Matches this project's established manual-verification pattern; reuses M-12's existing kitchen-sink pages. | User |

## Scope

**In scope:** `src/styles/globals.css`'s surface-role tokens (background/card/popover/secondary/muted/accent), `--primary`/`--sidebar-primary`, `--ring`, `--muted-foreground`.

**Out of scope:** `--chart-1..5`, `src/styles/theme-colors.ts` (canvas entity colors), `--foreground`/`*-foreground`, `--border`/`--input`, `--sidebar`/`--sidebar-accent`/etc., any light/dark toggle.

## Architecture / Approach

Single phase — a one-file, token-values-only change with no component code touched. Verification reuses M-12's existing kitchen-sink pages instead of building new ones.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Apply the new design-token palette | Full tonal ladder + vibrant primary + warm accent, live-verified | Low — pure CSS values, no logic; widest-usage consumer (`bg-input`) is an alpha overlay that follows automatically |

**Prerequisites:** None.
**Estimated effort:** 1 phase, single session.

## Open Risks & Assumptions

- None — research and the planning interview resolved every material decision (mood, hue family, accent source, chart/canvas scope, tonal depth, verification approach) before this plan was written.

## Success Criteria (Summary)

- All 6 surface roles are visually distinguishable; no two adjacent surfaces look identical.
- The new warm accent renders correctly wherever used; focus-visible rings remain clearly legible against the new background.
- The result subjectively reads as more vibrant/energetic than before — the actual bar the user set, not just "different."
