# Reference pages content accuracy update Implementation Plan

## Overview

Fix two genuine content-accuracy gaps research confirmed by direct code inspection: the parameters page's own stale comment defers documenting 14 real per-tribe/predator-tribe fields plus 2 toggles to "Phase 8," which shipped and archived on 2026-11-18 — and the scoring page's genetic-diversity description doesn't caveat that the pooled metric conflates within-tribe diversity with inter-tribe separation, an interpretation that changes once crossbreeding is involved. The storyline and population-lifecycle pages were confirmed accurate and are untouched.

## Current State Analysis

- `src/app/reference/parameters/page.tsx:9-13` — code comment: "documenting [per-tribe fields] belongs with Phase 8's tabbed per-tribe UI, not this generic reference page." That UI (`context/archive/2026-11-17-per-tribe-behavior-weights/plan.md`'s Phase 8) is archived, roadmap S-40 `done`. The comment is now false.
- `src/server/simulation/parameter-ranges.ts:71-81,95-101` — `TRIBE_RANGED_FIELD_NAMES` (9 boid fields) and `PREDATOR_TRIBE_RANGED_FIELD_NAMES` (5 predator-tribe fields, one reused from the boid set) — all currently undocumented on the parameters page.
- `src/server/api/routers/simulation.ts:90-113,121-139` — `tribeConfigSchema`/`predatorTribeConfigSchema` also carry `crossbreedingEnabled: boolean` (both) and `preyTarget: "boids" | "boids-and-predators"` (predator only) — real configuration, deliberately not numeric-ranged, also undocumented.
- `src/app/reference/scoring/page.tsx:15-17` (`FACTORS` array's "Genetic diversity" entry) — accurate but imprecise; `computeGeneticDiversity` (`boids.ts:2084-2119`) pools all boids regardless of tribe, so the number reflects both within-tribe variation and inter-tribe separation, and crossbreeding (`boids.ts:1251-1259,1290-1296`) changes that balance over a run.
- Full detail, including every field's description and the storyline/population-lifecycle accuracy confirmation: `context/changes/reference-pages-content-update/research.md`.

## Desired End State

The parameters page documents all 30 configurable fields that exist today: 16 top-level (unchanged), 9 boid per-tribe, 5 predator-tribe, plus the 2 per-tribe toggles — with the stale "not built yet" comment removed. The scoring page's genetic-diversity card carries one additional sentence correctly scoping what the number does and doesn't mean once tribes and crossbreeding are involved.

### Key Discoveries:

- All per-tribe field ranges are **shared across every tribe** of a given type (one `ParameterRanges` entry per field name, not per-tribe-index) — confirmed by `parameter-ranges.ts`'s own comments ("one shared range for all tribes (decided)"). This means the existing card format (title, description, Range/Default line) applies cleanly with no per-tribe-index variation to represent.
- `matePreference` is reused identically between `TRIBE_RANGED_FIELD_NAMES` and `PREDATOR_TRIBE_RANGED_FIELD_NAMES` — same range `{min: 0, max: 1, default: 0.5}`, same semantics for both species (`parameter-ranges.ts:85-94`). The plan documents it once per section (boid section and predator-tribe section) since each section is self-contained, matching how the existing top-level section is read independently.
- `predatorFlockCount` is already documented (it's a top-level field, not a per-tribe one) — not touched by this change.

## What We're NOT Doing

- Not touching `src/app/reference/storyline/page.tsx` or `src/app/reference/population-lifecycle/page.tsx` — research confirmed both are already accurate (storyline matches PRD/FR-034 scope; population-lifecycle correctly describes a single whole-population, boids-only classification).
- Not touching `src/app/runs/compare/page.tsx`'s own factor breakdown — out of scope, a separate archived change's deliberate design (per `reference-pages-ui-refresh`'s own research).
- Not changing any numeric range or default value — this is documentation only, no schema/logic change.
- Not adding a tabbed or interactive per-tribe UI element to the reference page itself — the user chose the full-card format matching the existing static page, not a new UI idiom.

## Implementation Approach

Two phases, mirroring the sibling `reference-pages-ui-refresh` change's successful split: the larger structural content addition (parameters page) first, then the small, independent precision fix (scoring page) second.

## Phase 1: Parameters page per-tribe section

### Overview

Add a per-tribe section documenting all 14 ranged fields plus the 2 toggles, matching the existing card format; remove the stale "Phase 8 not built yet" comment.

### Changes Required:

#### 1. Remove the stale deferral comment

**File**: `src/app/reference/parameters/page.tsx`

**Intent**: The comment at lines 9-13 claims per-tribe fields are deferred to an unbuilt UI. That UI shipped 2026-11-18 (S-40). Remove the comment since this phase makes it false by actually documenting those fields here.

**Contract**: Delete the comment block; no replacement needed (the new sections below are self-explanatory).

#### 2. Boid per-tribe field descriptions and labels

**File**: `src/app/reference/parameters/page.tsx`

**Intent**: Document the 9 `TRIBE_RANGED_FIELD_NAMES` fields the same way the existing 16 top-level fields are documented — title, plain-language description, Range/Default line.

**Contract**: Add a `TRIBE_PARAMETER_DESCRIPTIONS`/`TRIBE_PARAMETER_LABELS` pair (same shape as the existing `PARAMETER_DESCRIPTIONS`/`PARAMETER_LABELS`, keyed by `TribeRangedFieldName` from `~/server/simulation/parameter-ranges`), with these exact values:

| Field | Label | Description | Range | Default |
|---|---|---|---|---|
| `neighborRadius` | Neighbor radius | How far a boid looks to count others as flockmates for alignment and cohesion. | 1–500 | 70 |
| `separationRadius` | Separation radius | How close another flockmate has to be before a boid steers away to avoid crowding. | 1–500 | 25 |
| `predatorDetectionRadius` | Predator detection radius | How far a boid can notice a nearby predator and react to it. | 1–500 | 50 |
| `burstMult` | Burst speed multiplier | How much faster a boid moves while bursting away from a detected predator. | 0–10 | 1 |
| `burstCostMult` | Burst energy cost multiplier | How much extra energy a boid spends per tick while bursting, on top of normal movement cost. | 0–10 | 1 |
| `matePreference` | Mate preference | How close in color another boid must be for this tribe's boids to accept it as a mate. | 0–1 | 0.5 |
| `foodStockShare` | Food stock share | This tribe's share of the food pool available at the start of a run. | 0–10,000 | 50 |
| `foodRegenShare` | Food regen share | This tribe's share of how quickly consumed food is replenished. | 0–1,000 | 5 |
| `foodConsumptionRate` | Food consumption rate | How much food one boid in this tribe consumes per tick. | 0–10 | 0.5 |

Render as a new `<div>` section with its own heading ("Per-tribe boid parameters") above the existing top-level section's closing `<BackLink />`, using the same `LabeledCard`/map pattern as the existing top-level list.

#### 3. Predator per-tribe field descriptions and labels

**File**: `src/app/reference/parameters/page.tsx`

**Intent**: Document the 5 `PREDATOR_TRIBE_RANGED_FIELD_NAMES` fields the same way.

**Contract**: Add a `PREDATOR_TRIBE_PARAMETER_DESCRIPTIONS`/`PREDATOR_TRIBE_PARAMETER_LABELS` pair, keyed by `PredatorTribeRangedFieldName`, with these exact values:

| Field | Label | Description | Range | Default |
|---|---|---|---|---|
| `detectionRadius` | Detection radius | How far a predator tribe scans to find prey. | 1–500 | 200 |
| `captureRadiusMult` | Capture radius multiplier | How much this tribe's effective capture range is scaled relative to the simulation's base capture radius. | 0.1–5 | 1 |
| `matePreference` | Mate preference | How close in color another predator must be for this tribe to accept it as a mate. | 0–1 | 0.5 |
| `maxSpeed` | Max speed | The fastest this tribe's predators can move. | 1–300 | 55 |
| `minSpeed` | Min speed | The slowest this tribe's predators can move. | 0–300 | 20 |

Render as a new section ("Per-tribe predator parameters") immediately after the boid per-tribe section, same card pattern.

#### 4. Per-tribe toggles section

**File**: `src/app/reference/parameters/page.tsx`

**Intent**: Document `crossbreedingEnabled` and `preyTarget` — real per-tribe configuration that isn't numeric-ranged, so it doesn't fit the Range/Default card shape the other sections use.

**Contract**: Add a "Per-tribe toggles" section with 2 `LabeledCard`s (title + description only, no Range/Default line):

- **Crossbreeding** — "Whether this tribe's boids (or predator tribe) can mate with members of a different tribe. When enabled for both tribes involved, the offspring's genes (including color) are a blend of both parents'."
- **Prey target** (predator tribes only) — "Which populations a predator tribe hunts: boids only, or boids and the boids/predators of other predator tribes. A tribe never hunts its own members."

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full suite still passes: `npm test`
- Hardcoded-value scan on the touched file stays at 0 hits: `grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|-\[[0-9.]+(px|rem)\]|\b(bg|text|border|ring|outline|from|via|to|fill|stroke|shadow|divide)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b' src/app/reference/parameters/page.tsx`

#### Manual Verification:

- `/reference/parameters` renders 3 sections (top-level, per-tribe boid, per-tribe predator) plus the toggles subsection, with no visual regression on the existing 16 top-level cards.
- Every new card's range/default line matches the table above exactly (spot-check at least 3).

## Phase 2: Scoring page genetic-diversity caveat

### Overview

Add one sentence to the scoring page's genetic-diversity description noting the tribe/crossbreeding interaction research found.

### Changes Required:

#### 1. Genetic-diversity factor description

**File**: `src/app/reference/scoring/page.tsx`

**Intent**: The existing description ("How genetically diverse the surviving population remained") is accurate but doesn't warn that with multiple tribes, the number reflects both within-tribe variation and how separate the tribes' gene pools still are — and that enabling crossbreeding will tend to lower it over time as tribes blend, independent of any real change in within-tribe variation.

**Contract**: Append one sentence to the "Genetic diversity" factor's `description` string: "With multiple tribes, this number also reflects how separate the tribes' gene pools still are — enabling crossbreeding will tend to lower it over time as tribes blend, even if within-tribe variation hasn't changed."

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full suite still passes: `npm test`

#### Manual Verification:

- `/reference/scoring`'s "Genetic diversity" card shows the new sentence, reads clearly, and doesn't overstate what the comparison UI shows elsewhere.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to archive.

---

## Testing Strategy

### Unit Tests:

- None new — matches the milestone's established precedent (no existing unit tests for any reference page).

### Manual Testing Steps:

1. Phase 1's manual checks (3 sections render correctly, range/default values match).
2. Phase 2's manual check (new sentence renders, reads clearly).

## Performance Considerations

None — presentation/content-only change.

## Migration Notes

None — no persisted data shape changes.

## References

- `context/changes/reference-pages-content-update/research.md` — full field inventory, accuracy confirmation for storyline/population-lifecycle, and the genetic-diversity precision finding.
- `context/archive/2026-11-17-per-tribe-behavior-weights/`, `context/archive/2026-11-18-predator-tribe-concept/`, `context/archive/2026-11-18-second-predator-tribe-prey-target/` — the changes whose fields this page now documents.
- `context/archive/2026-11-20-reference-pages-ui-refresh/` — sibling change (S-50), `LabeledCard`/`BackLink` components this plan's new sections reuse.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Parameters page per-tribe section

#### Automated

- [ ] 1.1 Typecheck passes: `npm run typecheck`
- [ ] 1.2 Lint passes: `npm run check`
- [ ] 1.3 Full suite still passes: `npm test`
- [ ] 1.4 Hardcoded-value scan on the touched file stays at 0 hits

#### Manual

- [ ] 1.5 /reference/parameters renders 3 sections plus toggles, no regression on existing 16 cards
- [ ] 1.6 Spot-checked range/default values match the plan's table

### Phase 2: Scoring page genetic-diversity caveat

#### Automated

- [ ] 2.1 Typecheck passes: `npm run typecheck`
- [ ] 2.2 Lint passes: `npm run check`
- [ ] 2.3 Full suite still passes: `npm test`

#### Manual

- [ ] 2.4 New sentence renders, reads clearly, doesn't overstate the comparison UI
