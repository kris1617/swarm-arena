# /simulation Start button not submitting — Plan Brief

> Full plan: `context/changes/simulation-start-button-not-submitting/plan.md`
> Research: `context/changes/simulation-start-button-not-submitting/research.md`

## What & Why

`/simulation`'s "Start" button never submits — not in dev, not in the
production build, not via click or Enter. Root-caused during planning
(not guessed): the `energyThreshold` field's HTML `min="0.1"` paired
with `step="1"` and a default value of `50` is off the valid step
grid, so the browser's native HTML5 constraint validation silently
blocks the form's `submit` event before it ever reaches React — zero
JS error, zero network request. Production evidence (1 user, 13 real
sessions, 0 rows ever in `simulation_run`) suggests this has likely
never worked since this field's range became admin-configurable.

## Starting Point

`buildStartInput()`'s clamp logic was always correct; the browser
never let the form reach it. This is a confirmed recurrence of an
already-fixed bug class from `context/foundation/lessons.md` — the
same field, previously fixed with `min={0.0001}`→`min={0}`, regressed
when the range system became admin-configurable and
`energyThreshold.min` landed at `0.1`.

## Desired End State

Clicking "Start" with default values actually starts a run, in both
dev and production. The existing `authenticated-simulation-run.spec.ts`
passes again (it has an independent, separately-fixed locator bug too).
A new assertion fails if this exact defect class recurs.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Fix approach | Change HTML `min` to `0`, keep the real floor enforced only via the existing submit-time clamp | Matches `lessons.md`'s own prescribed pattern for this exact bug class | Research |
| Scope | This one field only | Live `checkValidity()` check confirmed every other field in the form is currently valid | Research |
| Regression-test layer | e2e (`checkValidity()` assertion) | No unit/integration layer in this stack can observe browser-native constraint validation | Plan |
| Phase structure | Root-cause investigation folded into planning itself (not a separate implementation phase) | The investigation was fully completed during `/10x-plan`'s own research step, per its own "determine by researching" instruction — nothing left to "reproduce" at implementation time | Plan |

## Scope

**In scope:** the `energyThreshold` field's HTML `min` attribute, a new regression test, fixing the separate `authenticated-simulation-run.spec.ts` locator collision.

**Out of scope:** auditing every other `NumberField` in the app, changing the actual admin-configurable range values, resuming `test-plan-refresh-2026-11-18`'s paused Phase 3, wiring e2e into CI.

## Architecture / Approach

A one-line JSX attribute change plus two small e2e test edits — no new components, no new patterns.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Fix + regression test | The field fixed, a test that would have caught this | None significant — the fix is a single attribute, verified live before writing |
| 2. Fix the separate locator bug | `authenticated-simulation-run.spec.ts` passes again | None — `exact: true` is the established fix pattern used elsewhere in this session's work |

**Prerequisites:** None.
**Estimated effort:** Small — under 1 session, 2 phases.

## Open Risks & Assumptions

- Scoped the fix to `energyThreshold` only, based on a live `checkValidity()` check against the form's *current* default values — a future default-value change to another field could introduce the same class of bug again; this plan does not add a systematic guard against that, only a point regression test for this specific field.

## Success Criteria (Summary)

- A real user can start a simulation from `/simulation` with default values, in production.
- `authenticated-simulation-run.spec.ts` passes.
- The new regression test fails if `energyThreshold`'s `min` reverts.
