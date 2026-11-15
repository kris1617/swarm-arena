# Reference Documentation Pages Implementation Plan

## Overview

Add four static reference/documentation pages (storyline, parameters, population-lifecycle model, scoring metrics), reachable from one sidebar nav entry via a small index page, separated from the functional app pages per FR-034. All content is drafted directly from the PRD's existing text — no new product decisions.

## Current State Analysis

- `src/components/app-shell.tsx:23-24` already carries a code comment reserving this exact slot: "S-20 (reference-documentation-pages) still needs its own entry here when that page ships." `NAV_ITEMS` currently has Dashboard, Simulation, Leaderboard — each a single flat entry.
- No static/prose content page exists yet in `src/app/`. No typography plugin (`@tailwindcss/typography`) is installed (`package.json` has no `typography` dependency) — content pages must use plain Tailwind token classes (`text-foreground`, `text-muted-foreground`, etc.), the same discipline every other page already follows per AGENTS.md's "no literal colors" rule.
- `src/app/leaderboard/page.tsx` is the most recent precedent for a new top-level page's shape: `<div>` root (never `<main>` — `SidebarInset` in `src/app/layout.tsx` already owns that landmark), token-class styling throughout.
- `context/foundation/prd.md` fixes all four pages' content:
  - **Storyline** — `## Vision & Problem Statement` and `## User & Persona` (lines 20-30): a hobbyist experimenting with boids + predator-prey dynamics, turning trial-and-error tuning into a measurable, resumable experimentation loop.
  - **Parameters** — `src/server/simulation/parameter-ranges.ts:6-49`'s `RANGED_PARAMETER_NAMES`/`DEFAULT_PARAMETER_RANGES` (13 admin-ranged numeric parameters: boidCount, separationWeight, alignmentWeight, cohesionWeight, maxDurationSeconds, predatorCount, protectionThreshold, foodStockInitial, foodRegenRate, flockCount, energyThreshold, mutationChance, mutationMagnitude) plus the one boolean toggle PRD FR-002 names that isn't ranged (crossbreedingEnabled).
  - **Population lifecycle** — PRD `## Business Logic` (lines 226-232): the five boom-bust/irruptive-growth phases (Establishment, Growth, Overshoot, Crash, Recovery) and how classification combines population trend with the food-availability ratio.
  - **Scoring** — PRD `## Business Logic` (lines 224, 236): the four-factor product (survival duration, food-management efficiency, genetic diversity, phase-quality) and what the phase-quality factor specifically rewards (time-weighted phase health + a Crash→Recovery resilience bonus).
- Roadmap S-20's own stated "unknown" (who writes the descriptive copy) is already resolved in the roadmap item itself: a first draft is derivable directly from the PRD text named above; the user can revise content after it ships. This plan treats that as settled, not open.

## Desired End State

A signed-in user opens "Reference" from the sidebar and sees a small index page linking to four sub-pages — Storyline, Parameters, Population Lifecycle, Scoring — each a static content page with no interactive elements, separated from (not interleaved with) the functional app pages. Verification: visit all four sub-pages directly and via the index's links; confirm the sidebar's "Reference" entry is present and highlights as active on any of the five reference routes.

### Key Discoveries:

- `app-shell.tsx`'s `NAV_ITEMS` slot and comment are already waiting for this exact change — only one array entry needs to be added, and the comment removed (both S-19 and S-20 are now accounted for).
- `isActive={pathname === item.href}` (`app-shell.tsx:44`) only matches the exact nav href — the "Reference" entry will highlight only on `/reference` itself, not on its four sub-pages. This plan accepts that as-is (matches the existing per-route-exact-match behavior every other nav entry already has); not a new problem this change introduces.

## What We're NOT Doing

- No new shared `Prose`/`Article`/typography component or Tailwind typography plugin — four short, plain pages don't justify a new dependency or abstraction.
- No CMS, MDX, or markdown-file-based content — content is plain JSX/TSX, same as every other page in this app.
- No interactivity (search, table of contents, collapsible sections) — these are read-only reference pages.
- No change to `parameter-ranges.ts` or any other source of truth — the parameters page reads (conceptually, by reference in prose — not by importing the module into a client page) the same 13-parameter list already defined there; it does not duplicate it as a second authority that could drift. Concretely, descriptions are written directly into the page, mirroring the existing names/defaults verbatim rather than computing them.
- No public/unauthenticated access — these pages stay behind the existing auth middleware, consistent with every other app page; FR-034 doesn't ask for public docs.

## Implementation Approach

One phase: five new static pages (one index + four content pages) under `src/app/reference/`, plus one new `NAV_ITEMS` entry replacing the now-obsolete S-20 placeholder comment in `app-shell.tsx`.

## Phase 1: Reference pages + nav wiring

### Overview

Build the index page, the four content pages, and wire the sidebar entry.

### Changes Required:

#### 1. Add the reference index page

**File**: `src/app/reference/page.tsx` (new)

**Intent**: A simple, non-interactive list page linking to the four sub-pages, giving the single sidebar entry something to land on and a clear separation point from the functional app.

**Contract**: Root element is a `<div>` (never `<main>`). Four `Link`s to `/reference/storyline`, `/reference/parameters`, `/reference/population-lifecycle`, `/reference/scoring`, each with a one-line description. No data fetching — fully static.

#### 2. Add the storyline page

**File**: `src/app/reference/storyline/page.tsx` (new)

**Intent**: Static prose describing the simulation's premise, drawn directly from the PRD's Vision & Problem Statement and User & Persona sections (verbatim substance, rewritten as reader-facing prose rather than a planning document's voice).

**Contract**: `<div>` root; plain `<h1>`/`<p>` structure using token text classes (`text-foreground`, `text-muted-foreground` for secondary text); a link back to `/reference`.

#### 3. Add the parameters page

**File**: `src/app/reference/parameters/page.tsx` (new)

**Intent**: Static description of each of the 13 admin-ranged numeric parameters plus the one boolean toggle, naming what each one controls in plain language (not just restating the variable name). Source the parameter names/defaults from `DEFAULT_PARAMETER_RANGES` in `src/server/simulation/parameter-ranges.ts` so the list can't silently drift from the real admin-configurable set — import the constant rather than hand-copying the names, but the min/max shown here are the ship-time defaults, not the current admin's live settings (this page does not call `getParameterRanges`; it is static content, not a live settings view).

**Contract**: `<div>` root; one entry per parameter (name, one-sentence description, default value from the imported constant) plus the `crossbreedingEnabled` toggle (named in prose since it isn't in the ranged-parameter record); a link back to `/reference`.

#### 4. Add the population-lifecycle page

**File**: `src/app/reference/population-lifecycle/page.tsx` (new)

**Intent**: Static description of the five boom-bust lifecycle phases (Establishment, Growth, Overshoot, Crash, Recovery) and, briefly, how classification works (trend + food-availability ratio) — content drawn directly from PRD `## Business Logic`.

**Contract**: `<div>` root; one section per phase with its one-line description (reuse PRD's own phase descriptions almost verbatim — they're already written in clear, final form); a link back to `/reference`.

#### 5. Add the scoring page

**File**: `src/app/reference/scoring/page.tsx` (new)

**Intent**: Static description of the four score factors (survival duration, food-management efficiency, genetic diversity, phase quality) and specifically what the phase-quality factor rewards (time-weighted phase health + Crash→Recovery resilience bonus) — content drawn directly from PRD `## Business Logic`.

**Contract**: `<div>` root; one section per factor; a link back to `/reference`.

#### 6. Wire the sidebar nav entry

**File**: `src/components/app-shell.tsx`

**Intent**: Add `{ label: "Reference", href: "/reference" }` to `NAV_ITEMS`, and remove the now-fully-resolved "S-19/S-20" placeholder comment above it (S-19 already added its own entry; this change adds the last one).

**Contract**: No change to `NavItem`'s shape or the rendering loop — purely a new array entry plus a comment deletion.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run check`
- Full suite still passes: `npm test`
- Hardcoded-value scan across all five new pages returns zero hits (tokens only, matching AGENTS.md's UI rules)
- Each of the 13 parameter entries on the parameters page is sourced from the imported `DEFAULT_PARAMETER_RANGES` constant, not a hand-typed duplicate list (spot-checked by reading the diff, not a runtime test — this is static content, not business logic)

#### Manual Verification:

- All five routes (`/reference` and its four sub-pages) load without error and show the expected content
- The index page's four links each navigate to the correct sub-page, and each sub-page's back-link returns to the index
- The sidebar shows a single "Reference" entry linking to `/reference`, highlighted as active only while on `/reference` itself (not on its sub-pages — accepted as-is, matching every other nav entry's exact-match behavior)
- The parameters page's 13 numeric defaults match `DEFAULT_PARAMETER_RANGES` in `src/server/simulation/parameter-ranges.ts` exactly (visual spot check against the source file)

## Testing Strategy

### Unit Tests:

None planned — this phase adds no business logic, only static markup. The existing test suite continues to pass unmodified (confirmed via Success Criteria above).

### Manual Testing Steps:

1. Sign in, click "Reference" in the sidebar, confirm it lands on `/reference` with four links.
2. Click each of the four links in turn; confirm each sub-page loads with distinct, on-topic content and a working back-link.
3. Compare the parameters page's listed defaults against `DEFAULT_PARAMETER_RANGES` to confirm no transcription drift.
4. Confirm none of the five pages require a running simulation, a session, or any other precondition beyond being signed in (they are pure static content).

## Performance Considerations

None — static content, no data fetching, no new dependencies.

## Migration Notes

None — no schema change, no data migration.

## References

- `src/components/app-shell.tsx:23-28` — the `NAV_ITEMS` slot and placeholder comment this change resolves.
- `src/app/leaderboard/page.tsx` — the most recent precedent for a new top-level page's root-element/token-styling shape.
- `context/foundation/prd.md` FR-034 — the requirement naming all four pages.
- `context/foundation/prd.md` `## Vision & Problem Statement` / `## User & Persona` — storyline page source content.
- `context/foundation/prd.md` `## Business Logic` — population-lifecycle and scoring page source content.
- `src/server/simulation/parameter-ranges.ts` — the single source of truth for the parameters page's 13-entry list and defaults.
- Roadmap `context/foundation/roadmap.md` S-20 — the Slice entry this plan implements, including its own pre-resolved "who writes the copy" unknown.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Reference pages + nav wiring

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck`
- [x] 1.2 Linting passes: `npm run check`
- [x] 1.3 Full suite still passes: `npm test`
- [x] 1.4 Hardcoded-value scan across all five new pages returns zero hits
- [x] 1.5 Each parameters-page entry is sourced from the imported `DEFAULT_PARAMETER_RANGES` constant, not hand-typed

#### Manual

- [x] 1.6 All five routes load without error and show expected content
- [x] 1.7 Index page's four links and each sub-page's back-link work correctly
- [x] 1.8 Sidebar shows a single "Reference" entry, active only on `/reference` itself
- [x] 1.9 Parameters page's 13 numeric defaults match `DEFAULT_PARAMETER_RANGES` exactly
