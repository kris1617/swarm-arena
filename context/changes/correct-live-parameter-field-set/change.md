---
change_id: correct-live-parameter-field-set
title: Correct S-27's live-adjustable field set
status: implemented
created: 2026-11-15
updated: 2026-11-15
archived_at: null
---

## Notes

Roadmap S-31 (M-6, "Extended live tuning"). No prerequisites; prerequisite for S-28 (client-staged parity should target the corrected set, not S-27's original).

**Confirmed defect (direct code inspection, 2026-11-15)**: S-27 (archived) live-adjusts `separationWeight`/`alignmentWeight`/`cohesionWeight` via `run.params`, but these are **per-boid genetic traits** (`boid.genes.separationWeight`, etc.) — set once at birth, inherited by offspring as a blend of their two parents' genes (`boids.ts:788-796`). The flocking force calculation (`boids.ts:627-645`) reads each boid's *own* gene value, never `run.params`. **S-27's live-adjustment of these 3 fields has no effect on anything** — not existing boids (use their own genes), not new offspring (inherit blended *parent* genes, never consulting the live-patched value).

`foodRegenRate` and `protectionThreshold` **are** genuinely global, read fresh from `params` every tick (`boids.ts:1085,1090`) — these two already work correctly and are untouched by this fix.

`energyThreshold`, `mutationChance`, `mutationMagnitude` are **also global**, consulted only at the moment of reproduction (`boids.ts:816-826, 915-916`) — live-adjusting these correctly affects only future offspring, never retroactively changing an existing individual. These are not currently in the live-adjustable set and should be added.

**Outcome**: Remove `separationWeight`/`alignmentWeight`/`cohesionWeight` from the live-adjustable set (both the registry's `LiveAdjustableParams` type and the `ServerRunViewer` panel's fields); add `energyThreshold`/`mutationChance`/`mutationMagnitude`. Keep `foodRegenRate`/`protectionThreshold` as-is.

**Critical lesson from S-27's own impl-review and manual verification**: manual verification for this change must observe an *actual behavior change* (e.g., a visibly different mutation rate in subsequent offspring, or a changed reproduction-eligibility threshold) — not just that the mutation accepts the input and the UI reflects the new value. That's the exact gap that let S-27's defect ship unnoticed through two rounds of manual verification.

**Open decision for `/10x-plan`**: should the live-view panel's UI framing/copy distinguish `energyThreshold`/`mutationChance`/`mutationMagnitude` (whose effect is "future offspring only") from `foodRegenRate`/`protectionThreshold` (whose effect is immediate)?
