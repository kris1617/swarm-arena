---
date: 2026-11-20T11:23:45+01:00
researcher: Claude Sonnet 5
git_commit: aa0bacd28260c993fc117b77830cc8e411f98589
branch: master
repository: swarm-arena
topic: "Reference pages content-accuracy update (S-52, M-13) — what's actually stale vs. accurate"
tags: [research, codebase, reference, content-accuracy, per-tribe, predator-tribe, scoring]
status: complete
last_updated: 2026-11-20
last_updated_by: Claude Sonnet 5
---

# Research: Reference pages content-accuracy update

**Date**: 2026-11-20T11:23:45+01:00
**Researcher**: Claude Sonnet 5
**Git Commit**: aa0bacd28260c993fc117b77830cc8e411f98589
**Branch**: master
**Repository**: swarm-arena

## Research Question

The user reports the 4 reference pages (storyline, parameters, population-lifecycle, scoring) need their content extended/corrected to reflect simulation mechanics added since they were last substantively updated — specifically citing per-tribe boid behavior (F-09/S-40), predator tribes (F-10/S-43), and area-aware scoring (S-25). Which pages are actually stale, and what specifically needs to change? (S-25's scoring-factor gap was already fixed by the sibling change `reference-pages-ui-refresh`/S-50 earlier today — this research re-verifies that fix still holds and investigates the two tribe-related areas.)

## Summary

Of the 4 pages, **2 are genuinely stale and 2 are already accurate** — confirmed by direct code inspection, not inferred from commit history (per `lessons.md`'s "re-verify never-touched claims" rule):

1. **`parameters/page.tsx` — stale, real gap.** Its own code comment explicitly defers documenting per-tribe fields to "Phase 8's tabbed per-tribe UI" as not-yet-built — but that UI shipped and archived on 2026-11-18 (`per-tribe-behavior-weights`'s Phase 8, roadmap S-40 done). The page currently documents zero of the 9 boid per-tribe fields, 5 predator-tribe fields, or the 2 per-tribe toggles (`crossbreedingEnabled`, `preyTarget`) that exist today.
2. **`scoring/page.tsx` — already fixed for factor count (S-50, same day), but has one remaining precision gap.** The "Genetic diversity" factor description doesn't caveat that the pooled population-wide metric conflates within-tribe diversity with inter-tribe separation, and that the crossbreeding toggle changes what the number reflects over time.
3. **`population-lifecycle/page.tsx` — already accurate, no change needed.** Direct inspection of `classifyPopulationPhase` confirms it is a single, whole-population, boids-only classification — exactly what the page currently describes ("the boid population's state"). None of the 5 archived per-tribe/predator-tribe changes touched this logic.
4. **`storyline/page.tsx` — already accurate, no change needed.** It closely paraphrases the PRD's own Vision & Problem Statement, and FR-034 defines this page's scope as the general pitch, explicitly separate from parameter/mechanics detail. No source material frames tribes as a vision-level differentiator this page should carry.

## Detailed Findings

### Charge 1 — `parameters/page.tsx` is missing 14 real, shipped configuration fields

- `parameters/page.tsx:9-13`'s own comment: "documents the top-level `startInputSchema` scalar fields only... documenting [per-tribe fields] belongs with Phase 8's tabbed per-tribe UI, not this generic reference page" — written when that UI was still unbuilt.
- `context/archive/2026-11-17-per-tribe-behavior-weights/plan.md:420-445` (Phase 8) built exactly that tabbed per-tribe UI; `change.md:4` confirms `status: archived`; `context/foundation/roadmap.md:792,1124` confirms S-40 `done`, 2026-11-18. The page's deferral comment is now factually wrong — the UI it says doesn't exist does.
- The 9 undocumented boid per-tribe fields (`src/server/simulation/parameter-ranges.ts:71-81`, `TRIBE_RANGED_FIELD_NAMES`): `neighborRadius`, `separationRadius`, `predatorDetectionRadius`, `burstMult`, `burstCostMult`, `matePreference`, `foodStockShare`, `foodRegenShare`, `foodConsumptionRate`.
- The 5 undocumented predator per-tribe fields (`parameter-ranges.ts:95-101`, `PREDATOR_TRIBE_RANGED_FIELD_NAMES`): `detectionRadius`, `captureRadiusMult`, `matePreference` (reused, same gene semantics as boids'), `maxSpeed`, `minSpeed` (predator-tribe-specific; not shared with boids' own differently-ranged `maxSpeed`/`minSpeed`).
- Two additional per-tribe configuration concepts exist in the schema but are deliberately NOT numeric-ranged, so they fall outside both arrays above — still real, user-facing configuration a documentation page should cover: `crossbreedingEnabled: boolean` (both boid and predator tribe configs, `src/server/api/routers/simulation.ts:90-113,121-139`) and `preyTarget: "boids" | "boids-and-predators"` (predator tribes only, `simulation.ts:138`, gates hunting behavior at `boids.ts:977-993,1606-1619`).

### Charge 2 — `scoring/page.tsx`'s genetic-diversity description is accurate but imprecise about tribe/crossbreeding interaction

- `computeGeneticDiversity` (`boids.ts:2084-2119`) pools ALL boids into one coefficient-of-variation calculation — confirmed no per-tribe grouping or weighting anywhere in the function.
- Because tribes typically start with distinct color/gene clusters, the pooled metric's value is shaped by **both** within-tribe variation and inter-tribe separation. Enabling crossbreeding (`reproducePopulation`, `boids.ts:1251-1259`, gated on `tribeConfigs[...].crossbreedingEnabled`) blends those clusters over time via `inheritGenes` (`boids.ts:1290-1296`), which can lower the pooled score even if within-tribe variation is unchanged — purely because tribes are merging, not because anything is "losing diversity" in the colloquial sense.
- Current text (`scoring/page.tsx:16`, unchanged since S-50's factor-count fix): "How genetically diverse the surviving population remained." Technically accurate (it IS a population-level metric) but doesn't warn a reader with multiple, crossbreeding-enabled tribes that a declining number might just mean "tribes are blending," not "the population is becoming less diverse" in the sense they'd expect.

### Non-charge — `population-lifecycle/page.tsx` is already accurate

- `classifyPopulationPhase` (`boids.ts:2139-2177`) has exactly one call site (`single-run-lifecycle.ts:286-291`), fed a single run-wide `populationCount` built from `nextBoids.length` across ALL flocks combined (`single-run-lifecycle.ts:245`) — not per-tribe, and explicitly excluding predators (predators feed a *different*, separate density metric, `single-run-lifecycle.ts:246-252`, that never reaches the phase classifier).
- Grepping the whole codebase for `classifyPopulationPhase`/`PopulationPhase` found no second call site and no per-tribe branching anywhere near it.
- None of the 5 archived per-tribe/predator-tribe changes' `plan.md` files mention "lifecycle" or the classifier by name; two of them touch `single-run-lifecycle.ts`, but only for unrelated config-threading plumbing, not near the classification block.
- Current page text ("Every tick, the boid population's state is classified...") already correctly scopes this to "the boid population" (singular, whole-population) — it does not claim per-tribe or predator-inclusive behavior, so there is nothing to correct.

### Non-charge — `storyline/page.tsx` is already accurate

- Full-file comparison against `context/foundation/prd.md:21-25`'s Vision & Problem Statement shows the page closely paraphrases the PRD's own language.
- FR-034 (`prd.md:213`) defines this page's scope as "a general storyline description of the simulation," explicitly separate from the parameters and scoring pages — mechanics detail is deliberately routed elsewhere by design, not omitted by drift.
- The two tribe-introducing changes' own `change.md` Notes are empty placeholders, and their `plan.md` overviews frame tribes in pure engineering language ("give every boid tribe its own behavior profile") — no product-framing source treats tribes as a vision-level differentiator this page should carry.

## Code References

- `src/app/reference/parameters/page.tsx:9-13` — the stale "Phase 8 not built yet" comment.
- `src/server/simulation/parameter-ranges.ts:71-81,95-101` — `TRIBE_RANGED_FIELD_NAMES`, `PREDATOR_TRIBE_RANGED_FIELD_NAMES`.
- `src/server/api/routers/simulation.ts:90-113,121-139` — `tribeConfigSchema`, `predatorTribeConfigSchema`, including `crossbreedingEnabled`/`preyTarget`.
- `src/server/simulation/boids.ts:977-993,1606-1619` — `preyTarget`-gated hunting behavior.
- `src/server/simulation/boids.ts:2084-2119` — `computeGeneticDiversity`, whole-population pooling.
- `src/server/simulation/boids.ts:1251-1259,1290-1296` — crossbreeding gate and gene inheritance (blends clusters).
- `src/server/simulation/boids.ts:2125-2177` — `PopulationPhase` type and `classifyPopulationPhase`.
- `src/server/simulation/single-run-lifecycle.ts:245-291` — the classifier's single call site, confirming whole-population/boids-only scope.
- `context/archive/2026-11-17-per-tribe-behavior-weights/plan.md:420-445` — Phase 8, the tabbed per-tribe UI that shipped.
- `context/foundation/prd.md:21-25,213` — storyline page's scope (FR-034) and vision language.

## Architecture Insights

- This is the third M-12/M-13-family research doc to find a documentation gap caused by a reference page's own code comment going stale after the feature it deferred to actually shipped — a recurring pattern worth naming explicitly for future reference-page work: a comment that says "not built yet, see Phase N" needs re-checking against that phase's actual archive status before being trusted, same as any other "never touched" claim.
- The genetic-diversity finding is a case where the *code* hasn't changed incorrectly — the metric still does exactly what it always did — but a *new configuration dimension* (tribes + crossbreeding) changed what that existing metric means to a reader, without the reference page being updated to reflect the new interpretive context. This is a different failure mode than "stale claim about what exists" — it's "accurate claim, insufficient caveat for a newly-relevant case."

## Historical Context (from prior changes)

- `context/archive/2026-11-20-reference-pages-ui-refresh/` (S-50, same day) — fixed the scoring page's factor count (4→5 visible +note on 6th) and extracted `LabeledCard`/`BackLink`. Did not touch the genetic-diversity description or the parameters page's stale comment — out of that change's scope (token/component drift only).
- `context/archive/2026-11-17-per-tribe-behavior-weights/` (F-09/S-40) and `context/archive/2026-11-18-predator-tribe-concept/` (F-10) — the two changes that introduced the fields this research found undocumented.
- `context/archive/2026-11-18-second-predator-tribe-prey-target/` (S-43) — introduced `preyTarget`.
- `context/archive/2026-11-15-live-crossbreeding-toggle/` — introduced `crossbreedingEnabled`.

## Related Research

- `context/archive/2026-11-20-reference-pages-ui-refresh/research.md` — sibling audit, token/component scope only.

## Open Questions

1. **How much detail should the parameters page give per-tribe fields** — a full 14-field breakdown matching the existing format (title, description, range/default), or a shorter summary paragraph pointing to the live tabbed UI for exact ranges (which vary by tribe index and admin settings)? Both are defensible; the existing page already shows ranges per top-level field, so matching that format for per-tribe fields would be consistent, but per-tribe ranges are identical across tribes (not per-tribe-index-specific) per `ParameterRanges`' lookup structure — confirming the exact values to show is a `/10x-plan`-level decision. — Owner: user, via `/10x-plan`. Block: no.
2. **Where should `crossbreedingEnabled`/`preyTarget` be documented** — as part of the parameters page's existing card list (treating them as configurable items without a numeric range), or in prose alongside the per-tribe section? — Owner: user/team, via `/10x-plan`. Block: no.
