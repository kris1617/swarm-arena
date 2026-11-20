# Reference pages modernization pass Implementation Plan

## Overview

Re-audit the 5 reference pages against this repo's design-system contract via `/10x-ui` — the lowest-drift view group in M-12. The pre-audit found zero token drift but two clear missing-shared-component opportunities (`LabeledCard`, 25 instances across 3 files; `BackLink`, 4 instances across 4 files) plus a user-approved content-accuracy fix on the scoring page (it documents 4 scoring factors; the real formula now has 6, 5 of them user-visible).

## Current State Analysis

- `src/app/reference/parameters/page.tsx:82-95` (16 instances), `population-lifecycle/page.tsx:54-64` (5), `scoring/page.tsx:35-45` (4) all repeat the identical `<div className="bg-input flex flex-col gap-1 rounded-2xl px-6 py-4">` title+description card shell — 25 instances total, the largest duplication count found in any M-12 audit.
- `src/app/reference/storyline/page.tsx:40-45`, `parameters/page.tsx:100-105`, `population-lifecycle/page.tsx:68-73`, `scoring/page.tsx:70-75` all repeat the byte-identical `<Link className="text-foreground hover:text-muted-foreground underline" href="/reference">← Back to Reference</Link>`.
- `src/app/reference/scoring/page.tsx`'s `FACTORS` array has 4 entries; `src/server/simulation/boids.ts:2423-2451`'s `computeScore` multiplies 6 terms; `src/app/runs/compare/page.tsx:17-23`'s `FACTOR_LABELS` exposes 5 of them as a user-visible breakdown.
- `src/app/reference/page.tsx`'s topic-link cards use `rounded-2xl` (not `rounded-full`), so they're a legitimate card-link pattern, not a disguised button — no charge there.
- Full detail: `context/changes/reference-pages-ui-refresh/research.md`.

## Desired End State

All 25 card instances and all 4 back-link instances render through two new shared components with no visual change. The scoring page accurately describes 5 visible factors plus a note on the 6th (predator-tribe balance, multi-tribe runs only). A kitchen-sink page proves both components' states.

### Key Discoveries:

- Neither `RunRow` nor `AnalysisCard` fits this card shape (different container element, gap, padding) — a new, purpose-built `LabeledCard` is the right call, following the same `src/components/` placement convention.
- `BackLink` is parameterless (always the same href/label) — the simplest possible shared component, no props beyond none.
- The scoring formula's 6th factor (`predatorTribeBalance`) is deliberately NOT exposed in the comparison UI's own breakdown (confirmed via the archived `second-predator-tribe-prey-target` plan's own stated scope) — the reference page should match the 5-factor breakdown users can actually see, not invent a 6th chart that doesn't exist elsewhere.

## What We're NOT Doing

- Not touching `src/app/runs/compare/page.tsx`'s `FACTOR_LABELS` (archived change, out of scope) — it deliberately excludes `predatorTribeBalance` by design, and this change doesn't reopen that decision.
- Not touching `reference/page.tsx`'s topic cards — confirmed a legitimate card-link pattern, not a charge.
- Not adding phase-color swatches to `population-lifecycle/page.tsx` (matching `runs/[runId]/page.tsx`'s `PHASE_COLORS`) — an enhancement idea noticed during the audit, not a confirmed drift/duplication charge; left for a future change if wanted.

## Implementation Approach

Three phases: the structural UI extraction first (both shared components, same mechanical shape), then the content fix in its own reviewable phase (business content, not UI structure), then a states gate — matching the milestone's established shape with the content fix isolated per explicit user preference.

## Phase 1: Shared component extraction

### Overview

Extract `LabeledCard` and `BackLink`, then adopt both across all 4 affected pages.

### Changes Required:

#### 1. `LabeledCard` shared component

**File**: `src/components/labeled-card.tsx` (new)

**Intent**: Give the 25 near-identical title+description card sections one implementation instead of 25 hand-copied ones, placed under `src/components/` (sibling to `src/components/run-row.tsx`, `analysis-card.tsx`).

**Contract**: `LabeledCard({ title, children }: { title: React.ReactNode; children: React.ReactNode })` rendering `<div className="bg-input flex flex-col gap-1 rounded-2xl px-6 py-4"><span className="text-foreground font-semibold">{title}</span>{children}</div>` — copied verbatim from the existing shell markup, no visual change. `children` carries the description span (and, for `parameters/page.tsx`, the additional range/default span) exactly as each call site already renders them.

#### 2. `BackLink` shared component

**File**: `src/components/back-link.tsx` (new)

**Intent**: Give the 4 byte-identical "Back to Reference" links one implementation.

**Contract**: `BackLink()` (no props) rendering `<Link className="text-foreground hover:text-muted-foreground underline" href="/reference">← Back to Reference</Link>` — copied verbatim, no visual change.

#### 3. Adopt both in `parameters/page.tsx`, `population-lifecycle/page.tsx`, `scoring/page.tsx`, `storyline/page.tsx`

**File**: the 4 files above

**Intent**: Replace each file's hand-rolled card/back-link markup with `LabeledCard`/`BackLink` — no behavior change, markup only.

**Contract**: Each of the 25 card instances becomes `<LabeledCard title={...}>{existing description/extra-line spans unchanged}</LabeledCard>`; each of the 4 back-link instances becomes `<BackLink />`.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full suite still passes: `npm test`
- Hardcoded-value scan on touched files stays at 0 hits: `grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|-\[[0-9.]+(px|rem)\]|\b(bg|text|border|ring|outline|from|via|to|fill|stroke|shadow|divide)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b' src/components/labeled-card.tsx src/components/back-link.tsx src/app/reference/parameters/page.tsx src/app/reference/population-lifecycle/page.tsx src/app/reference/scoring/page.tsx src/app/reference/storyline/page.tsx`

#### Manual Verification:

- All 4 pages render identically to before: every card's title/description/extra-line and every back-link.

## Phase 2: Scoring content fix

### Overview

Correct `scoring/page.tsx`'s factor count and description to match the real formula.

### Changes Required:

#### 1. `FACTORS` array and body text

**File**: `src/app/reference/scoring/page.tsx`

**Intent**: Document the 5 user-visible scoring factors (matching `runs/compare/page.tsx`'s own breakdown) instead of 4, and add one sentence noting the 6th, not-separately-broken-out factor for multi-tribe runs.

**Contract**: Add a 5th `FACTORS` entry — `{ name: "Area population density", description: "How well-populated the simulation's configured area stayed relative to its size, averaged over the run." }` — and change "the product of four factors" to "the product of five factors." Add one sentence after the existing phase-quality paragraph: a plain-language note that runs with more than one predator tribe also factor in how balanced the tribes' populations stayed, scored as a neutral no-op for single-tribe runs — not broken out as its own line in the comparison view.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full suite still passes: `npm test`

#### Manual Verification:

- `/reference/scoring` lists 5 factor cards (not 4) and the body text says "five factors."
- The new predator-tribe-balance sentence reads clearly and doesn't overstate what the comparison UI actually shows.

## Phase 3: States gate

### Overview

Prove `LabeledCard`/`BackLink`'s states via a kitchen-sink page.

### Changes Required:

#### 1. Reference kitchen-sink page

**File**: `src/app/reference/kitchen-sink/page.tsx` (new)

**Intent**: Render both components in their real states for review, following the same structure/comment style as the milestone's other kitchen-sink pages.

**Contract**: Sections: `LabeledCard: default` (2-line, matching population-lifecycle/scoring), `LabeledCard: with extra line` (3-line, matching parameters), `BackLink: default`/`BackLink: focus-visible`/`BackLink: hover`. No `disabled`/`error`/`empty`/`loading` states exist on these static content pages — mark each N/A explicitly with a one-line reason, matching the precedent set by `leaderboard`/`runs` kitchen-sink pages for views with no such states, rather than fabricating one. Root element is a `<div>`, not `<main>`.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full suite still passes: `npm test`

#### Manual Verification:

- All states (and explicit N/A markers) visible at `/reference/kitchen-sink`, screenshot at desktop and one mobile width.
- Focus-visible ring on `BackLink` uses the `--ring` token (or, if `Link` has no built-in focus-visible styling, confirm this gap already exists identically on every other reference-page link today — not a regression introduced here).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to archive.

---

## Testing Strategy

### Unit Tests:

- None new — matches the milestone's established precedent (no existing unit tests for any reference page or `src/components/ui`-level presentation component).

### Manual Testing Steps:

1. Phase 1's manual checks (all 4 pages render identically).
2. Phase 2's manual checks (scoring page's corrected factor count and new sentence).
3. Phase 3's manual checks (kitchen-sink states, focus-visible ring or confirmed pre-existing gap).

## Performance Considerations

None — presentation/content-only change.

## Migration Notes

None — no persisted data shape changes.

## References

- `context/changes/reference-pages-ui-refresh/research.md` — `/10x-ui` audit findings, charge verdicts, and the content-fix evidence.
- `context/archive/2026-11-19-area-aware-population-insight/`, `context/archive/2026-11-18-second-predator-tribe-prey-target/` — the two changes whose factors this page's content fix catches up to.
- `src/app/leaderboard/kitchen-sink/page.tsx`, `src/app/runs/kitchen-sink/page.tsx` — kitchen-sink precedents this plan's Phase 3 follows, including the explicit-N/A convention.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared component extraction

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck` — 0493d3a
- [x] 1.2 Lint passes: `npm run check` — 0493d3a
- [x] 1.3 Full suite still passes: `npm test` — 0493d3a
- [x] 1.4 Hardcoded-value scan on touched files stays at 0 hits — 0493d3a

#### Manual

- [x] 1.5 All 4 pages render identically to before (cards and back-links) — verified live (production build): all 16 parameters cards (with range/default line), all 5 population-lifecycle phase cards (2-line variant), all 4 scoring factor cards, and all 4 BackLink instances render correctly with no visual change. — 0493d3a

### Phase 2: Scoring content fix

#### Automated

- [x] 2.1 Typecheck passes: `npm run typecheck` — a74d79a
- [x] 2.2 Lint passes: `npm run check` — a74d79a
- [x] 2.3 Full suite still passes: `npm test` — a74d79a

#### Manual

- [x] 2.4 /reference/scoring lists 5 factor cards and says "five factors" — verified live (production build): all 5 factor cards render including "Area population density"; body text says "product of five factors" and "five-part breakdown." — a74d79a
- [x] 2.5 Predator-tribe-balance sentence reads clearly, doesn't overstate the UI — verified live: the new sentence renders correctly, explicitly noting it's "not broken out as its own line in the comparison view" so it doesn't claim UI that doesn't exist. — a74d79a

### Phase 3: States gate

#### Automated

- [x] 3.1 Typecheck passes: `npm run typecheck` — f407bac
- [x] 3.2 Lint passes: `npm run check` — f407bac
- [x] 3.3 Full suite still passes: `npm test` — f407bac

#### Manual

- [x] 3.4 All states/N-As visible at `/reference/kitchen-sink`, screenshot at desktop and one mobile width — verified live (production build): screenshots at 1280×900 and 390×844 both render all sections correctly, no overflow. — f407bac
- [x] 3.5 Focus-visible ring on BackLink uses the `--ring` token (or confirmed pre-existing gap, not a regression) — verified live via computed-style inspection: focused outlineColor resolves to oklab equivalent of `--ring: oklch(0.75 0.12 290)` at 50% alpha, matching the `ring-ring/50` token used elsewhere in this repo. — f407bac
