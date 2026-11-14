# UI simulation tokens — Plan Brief

> Full plan: `context/changes/ui-simulation-tokens/plan.md`
> Research: `context/changes/ui-simulation-tokens/research.md`

## What & Why

Introduce a real design-system contract (shadcn/ui, with token values derived from the colors already on screen) and apply it to the `/simulation` view, closing 4 charges from `/10x-ui`'s audit: a duplicated gradient background, a duplicated pill-button with no shared component (and no disabled state), canvas colors disconnected from any token, and a raw-palette error color.

## Starting Point

No design system exists in this repo at all — no `src/components/`, no shadcn, no color tokens beyond `--font-sans`. The simulation view's styling is literal Tailwind classes copy-pasted from the stock T3 starter's landing page, independently duplicated across 3 views in this codebase.

## Desired End State

The simulation view looks visually identical to today (same gradient, same button/input appearance — this is a rename, not a redesign), but every value now comes from a named token or a shared `Button`/`Input` component, canvas colors are sourced from the same values via a small JS constants file, and a kitchen-sink page proves all 7 interactive states (including a working disabled-button state and a visible focus ring, neither of which existed before).

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Dependency | Add shadcn/ui | User chose it over a hand-rolled alternative despite the lightweight-default recommendation, for mature built-in component states (hover/focus/disabled) | Plan |
| Token values | Derived from the existing palette (`#2e026d`/`#15162c`/white/red), not a new palette or shadcn defaults | Preserves the app's existing visual identity; "named motif" mapping per the `/10x-ui` skill | Plan |
| Canvas colors | A parallel JS constants file (`theme-colors.ts`), kept in sync by hand | Canvas `fillStyle` can't read a Tailwind class — this is the only way to connect it to the same values | Plan |
| Scope | This view only — landing/login/post.tsx keep their literals for now | `/10x-ui` is explicitly one view per change; those views are future candidates once the contract exists | Plan |
| Dark/light mode | Single theme only, no toggle | The app has no theme toggle today; inventing a second theme would be scope creep | Plan |
| Visual gate | A kitchen-sink page, manually screenshotted — no new test tool | This repo has no Playwright/screenshot-testing setup; the skill explicitly allows this cheaper form | Plan |

## Scope

**In scope:**
- shadcn/ui initialization + `Button`/`Input` components
- Token values in `globals.css` derived from the existing palette
- `theme-colors.ts` for canvas-readable color constants
- Applying tokens/components to `simulation/page.tsx` and `simulation-canvas.tsx`
- A kitchen-sink page proving all 7 states
- An `AGENTS.md` UI rule so the next agent stays on the contract

**Out of scope:**
- Migrating `src/app/page.tsx`, `src/app/login/page.tsx`, or `src/app/_components/post.tsx` onto the new tokens (same literals, different change)
- A light/dark theme toggle
- Any change to simulation *logic* (`boids.ts`, the tRPC router)
- Installing a screenshot-testing tool

## Architecture / Approach

Four phases in `/10x-ui`'s mandated order: (1) scaffold shadcn/ui and its two components with zero view changes; (2) overwrite shadcn's generated placeholder token values with values derived from the existing palette, plus a parallel JS constants file for the canvas; (3) apply those tokens/components to the one audited view, removing every literal the audit found; (4) prove the 7-state matrix via a kitchen-sink page and leave the `AGENTS.md` rule that keeps the next view from drifting the same way.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Environment/library | shadcn/ui scaffolding + Button/Input | None significant — standard CLI scaffolding |
| 2. Token values | Palette-derived tokens + canvas constants | Getting `--destructive`/`--ring` contrast right against the dark background — explicitly re-verified in Phase 4, not assumed here |
| 3. One view | Literals replaced, visually unchanged | A rename that accidentally changes the look — manual check catches this immediately |
| 4. States | 7-state kitchen sink, visual gate, AGENTS.md rule | A state that's technically present but not actually distinguishable on screen (e.g. a focus ring too dark to see) |

**Prerequisites:** `basic-flocking-loop` (implemented) — the view this change tokenizes.
**Estimated effort:** ~1-2 sessions across 4 phases.

## Open Risks & Assumptions

- `--destructive` and `--ring` values are specified as "derived from X, adjusted for contrast" rather than exact hex/OKLCH numbers — Phase 4's manual verification is where these get locked in, not Phase 2's initial pass.
- The 3 other views sharing these same literals (landing, login, post.tsx demo) are left untouched by design — the token contract exists now for them to adopt later, but this change doesn't migrate them.

## Success Criteria (Summary)

- The simulation view is visually unchanged but has zero literal colors/arbitrary values left in its two files.
- The Start button has a real disabled state; focus is visible on every control.
- All 7 states are shown or explicitly marked N/A on a kitchen-sink page.
- The next agent has a rule in `AGENTS.md` telling it where tokens and components live.
