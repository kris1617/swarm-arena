# Plan Brief: Correct S-27's live-adjustable field set

Full plan: `context/changes/correct-live-parameter-field-set/plan.md`

## What and why

S-27 (archived) shipped live-adjustment for 5 fields on a running server-owned simulation, but direct code inspection confirms 3 of them — `separationWeight`/`alignmentWeight`/`cohesionWeight` — are per-boid genetic traits, set once at birth and inherited via parent-gene blending; the flocking calculation never reads the live-patched value. **Live-adjusting these 3 fields has had no effect on anything since S-27 shipped.** This plan removes them and adds `energyThreshold`/`mutationChance`/`mutationMagnitude` — confirmed genuinely global, read only at reproduction, so adjusting them correctly affects future offspring without retroactively changing existing individuals.

## Starting Point

The mechanism (`applyLiveParams`, `checkLiveParamRangesSoft`, dirty-tracking, the changelog, the `ReferenceLine` overlay) is entirely generic over the field set — only `LiveAdjustableParams` (the type), `updateRunParams`'s zod schema, `getLiveRunState`'s literal field spread, and the panel's `LIVE_FIELDS`/`LIVE_FIELD_LABELS` name the specific 5 fields. No reference page or other file names them. This is a field-allowlist swap on an already-working mechanism, not a new one.

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| UI framing | Group panel fields under "Takes effect immediately" / "Affects future offspring only" headings | User-chosen — prevents the exact confusion ("I changed it, nothing happened") this defect caused |
| Manual verification | Deterministic before/after test per new field (mutationMagnitude=0 → zero-deviation offspring; high energyThreshold → reproduction stops) | User-chosen over statistical observation — the exact rigor S-27's own verification lacked |
| Lesson | Recorded in `context/foundation/lessons.md` (commit `db09de6`) | User-chosen — "UI accepts input ≠ feature verified" is a standing rule for future live-adjust/toggle features |
| S-27 itself | Not modified (archived, immutable) — this is a separate corrective change | Required by the toolkit's archive-immutability rule |

## Phases

1. **Backend: field-set swap** — `LiveAdjustableParams` type, `updateRunParams`'s zod schema, `getLiveRunState`'s literal field spread.
2. **Frontend: panel field swap + grouped UI** — `LIVE_FIELDS`/`LIVE_FIELD_LABELS`, two-heading grouped rendering.

**Prerequisites**: none — S-27's mechanism already exists and is reused as-is.
**Estimated effort**: 2 phases; Phase 1 touches 2 backend files, Phase 2 touches 1 frontend file.

## What We're NOT Doing

- Not changing the genetic-inheritance model to make weights live-adjustable (e.g. offspring blending toward a live "tribe baseline") — field-set swap was chosen over a deeper architecture change.
- Not touching `applyLiveParams`, the changelog persistence, or the analysis-page overlay — all generic, no changes needed.
- Not changing client-staged runs — that's S-28's separate, already-sequenced-after scope.

## References

- Roadmap: S-31 (`correct-live-parameter-field-set`), M-6
- Defect source: S-27 (archived) — `context/archive/2026-11-15-live-parameter-adjustment/`
- Full plan: `context/changes/correct-live-parameter-field-set/plan.md`
