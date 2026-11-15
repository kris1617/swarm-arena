# Live-adjust crossbreeding toggle — Plan Brief

> Full plan: `context/changes/live-crossbreeding-toggle/plan.md`

## What & Why

S-29, M-6's second slice: a user toggles crossbreeding on or off for a running simulation (both server-owned and client-staged) and sees the effect on subsequent reproduction events — mixed-flock pairs stop or start producing offspring. `crossbreedingEnabled` is already read fresh every tick on both paths; this slice is a type/schema widening to make it live-adjustable, not new mechanism.

## Starting Point

Server-owned: `crossbreedingEnabled` is read fresh from `run.params` every tick already (same pattern the 5 numeric live fields use), but isn't in `LiveAdjustableParams`'s allowlist yet. Client-staged: it's still a plain closed-over prop, in the same unfixed state the 5 numeric fields were in before S-28's ref treatment.

## Desired End State

A user can flip a Switch (not a NumberField) on either execution path's live-edit panel, grouped under "Affects future offspring only," and see mixed-flock reproduction correctly start or stop on subsequent ticks.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| UI control | Switch component, matching existing toggle idioms | Semantically correct for a boolean — a NumberField would be wrong |
| Type shape | Widen the numeric range machinery (RANGED_PARAMETER_NAMES/checkLiveParamRangesSoft) with a degenerate 0-1 range, rather than a separate boolean-only path | Zero new branching logic in the shared functions themselves |
| Changelog | Encode as 0/1 in the existing numeric oldValue/newValue | Full parity with the other 5 fields on the analysis chart overlay |
| Throttle | Shared 500ms server-side throttle applies automatically | No special-casing — applyLiveParams's throttle is per-run, not per-field |
| Scope | Both execution paths in this one slice | User's explicit choice, expanding from the roadmap's server-owned-only framing |
| Manual verification | Deterministic before/after test (toggle off, confirm no new mixed-flock offspring) | Same rigor that caught S-27's non-functional-fields defect |
| Mid-tick edge case | No special handling — reproducePopulation evaluates the gate fresh each tick, no in-flight state to interrupt | Confirmed by code inspection, not a new design choice |

## Scope

**In scope:**
- `crossbreedingEnabled` added to `RANGED_PARAMETER_NAMES`/`LiveAdjustableParams`/both panels' `LIVE_FIELDS`.
- Generic (not field-name-specific) boolean↔number coercion at the handful of call sites that need a number.
- Switch rendering on both `server-run-viewer.tsx` and `simulation-canvas.tsx`.

**Out of scope:**
- Changing `checkLiveParamRangesSoft`'s own implementation.
- Any new live-adjust mutation or type — reuses the existing numeric machinery end-to-end.
- Special handling for a toggle flip mid-reproduction (confirmed unnecessary).

## Architecture / Approach

`Pick`'s type preservation means `LiveAdjustableParams`/`applyLiveParams` need no special typing for the boolean field — only `ParameterChangeEntry`'s changelog push and `checkLiveParamRangesSoft`'s call sites need a small, generic `typeof value === "boolean" ? Number(value) : value` coercion. The client-staged panel's internal state is already uniformly numeric, so it needs almost no new conversion; the server-owned panel needs one explicit boolean-back-conversion right before sending the mutation.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Shared field-set widening | Backend accepts the boolean field via the existing numeric machinery | Low — the coercion is generic and isolated to 2 call sites |
| 2. Server-owned panel | Switch wired into the existing batched-apply flow | Low — one field added to an already-working mechanism |
| 3. Client-staged panel | Ref + Switch wired into the existing per-field-apply flow | Low — mirrors S-28's exact pattern for 5 prior fields |

**Prerequisites:** None — confirmed no hard technical dependency; independent of S-28/S-30.
**Estimated effort:** 3 phases, each touching 1-2 files.

## Open Risks & Assumptions

- Assumes the degenerate `{min:0,max:1}` admin range never meaningfully differs in practice (an admin could technically "configure" it, but there's no UI reason to) — acceptable per the user's explicit choice to reuse the numeric machinery as-is.

## Success Criteria (Summary)

- Toggling crossbreeding off mid-run on either execution path stops new mixed-flock offspring for the remainder of the run (same-flock reproduction continues).
- The analysis chart's changelog overlay shows the toggle flip, same as any other live edit.
- No regression to the existing 5 numeric live-adjustable fields on either panel.
