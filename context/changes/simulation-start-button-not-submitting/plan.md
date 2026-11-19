# /simulation Start button not submitting Implementation Plan

## Overview

Fix `/simulation`'s "Start" button — clicking it (or pressing Enter in
any field) never submits the start form, in any environment (dev or
production build), because the `energyThreshold` field's HTML `min`
attribute (`0.1`, sourced from the admin-configurable range) is off its
`step="1"` grid for the field's own default value of `50` — the
browser's native HTML5 constraint validation silently blocks
submission with zero JS-visible error. Add a regression test and fix
the sibling `authenticated-simulation-run.spec.ts` locator bug that
was masking this from ever being caught.

## Current State Analysis

- **Root cause, confirmed empirically** (via direct browser
  investigation during planning, not guessed): `/simulation/page.tsx`'s
  `energyThreshold` `NumberField` (`page.tsx:1168-1175`) renders
  `min={ranges.energyThreshold.min}` (= `0.1`,
  `src/server/simulation/parameter-ranges.ts:152`) with `step="1"` and
  a default value of `50` (`page.tsx:267`,
  `useState(50)`). `0.1 + N*1` never equals `50` for any integer `N`
  (the nearest valid values are `49.1`/`50.1`), so
  `form.checkValidity()` returns `false` on this field even before any
  user interaction. Clicking the `type="submit"` button (or pressing
  Enter) fires the real DOM `click`/`keydown` event, but the browser's
  native form-submission algorithm checks constraint validity first
  and silently aborts — no `submit` event ever reaches the DOM, no JS
  error, `startRun.mutate(...)` is never called. Confirmed by: (a)
  `form.checkValidity()` returning `false` with exactly this field
  listed as invalid; (b) a native `document.addEventListener("submit",
  ...)` listener never firing on a real click, while a plain `click`
  listener on the button itself does fire; (c) manually dispatching a
  `SubmitEvent` directly on the form *does* reach React's `onSubmit`
  handler and successfully calls `simulation.start` — proving React's
  event wiring itself is intact and the defect is purely the browser's
  native pre-submission validation gate.
- **This is a confirmed recurrence of an already-documented bug
  class**: `context/foundation/lessons.md`'s "HTML number inputs: min
  must not break the step grid for whole-number values" entry already
  fixed this exact symptom on this exact field in
  `genetic-inheritance-crossbreeding` (2026-11-13), prescribing
  `min={0}` plus a submit-time clamp instead of encoding the range's
  `.positive()`-style floor directly in the HTML `min`. The range
  system became admin-configurable sometime after that fix (`ranges.*`
  now reads from `DEFAULT_PARAMETER_RANGES`/the admin-settings DB row
  instead of a hardcoded literal), and `energyThreshold.min` landed at
  `0.1` — reintroducing the exact misalignment the lesson warned about,
  on the one field the lesson had already named.
- **Scope is this one field.** Checked every other `NumberField` in
  this form's `min`/`step`/default combination against
  `src/server/simulation/parameter-ranges.ts`'s current defaults:
  `boidCount`, `separationWeight`, `alignmentWeight`, `cohesionWeight`,
  `maxDurationSeconds`, `predatorCount`, `protectionThreshold`,
  `foodRegenRate`, `flockCount`, `mutationChance`, `mutationMagnitude`,
  `xyArea`, `zDepth`, `predatorFlockCount` all land exactly on their
  respective step grids with their current defaults (confirmed by the
  live `checkValidity()` run returning exactly one invalid field).
  `energyThreshold` is used as a form field only in this one file
  (grepped all other `energyThreshold` references — display-only in
  `reference/parameters`, `simulation-canvas.tsx`,
  `server-run-viewer.tsx`, none are editable form inputs).
- **This bug has likely never worked, in production or anywhere else,
  since this field's current range was set.** Confirmed via the
  production database directly: 1 real user, 13 real sign-in sessions
  over time, **zero** rows ever in the `simulation_run` table.
- **The existing e2e regression test for this exact flow has been
  silently broken too**, for an independent reason:
  `tests/e2e/authenticated-simulation-run.spec.ts:26` uses
  `page.getByRole("button", { name: "Start" })` with no `exact: true`,
  which now matches both the real "Start" submit button and the
  "Start on server" button (`page.tsx:1221-1230`,
  substring-matches). Confirmed broken in isolation
  (`npx playwright test authenticated-simulation-run`). Since e2e is
  not wired into this project's CI gates
  (`context/foundation/test-plan.md` §5: only lint/typecheck/unit
  +integration are required), this test's failure went unnoticed and
  could not have caught the `energyThreshold` regression either.

### Key Discoveries:

- `buildStartInput()` (`page.tsx:363-...`) already clamps
  `energyThreshold` correctly —
  `Math.min(Math.max(ranges.energyThreshold.min, energyThreshold),
  ranges.energyThreshold.max)` (confirmed present). The clamp logic
  itself was never the bug; the browser never lets the form reach that
  code at all.
- `tests/e2e/auth.setup.ts`/`auth-ux.spec.ts`'s test-auth bypass +
  Playwright's `exact: true` option are the established tools for
  reproducing and fixing both defects — no new test infrastructure
  needed.

## Desired End State

Clicking "Start" on `/simulation` with its own default field values
submits successfully and transitions to the running canvas, in both
`next dev` and the production build. `authenticated-simulation-run.spec.ts`
passes again. A new regression test fails if this exact defect (an
off-grid `min`/`step` combination silently blocking submission)
recurs on any field in this form.

**Verification**: `npm run typecheck`, `npm run check`, `npm test` all
pass; `npx playwright test authenticated-simulation-run` passes;
a new test asserting `form.checkValidity()` is `true` against the
form's own default values passes, and fails if `energyThreshold`'s
`min` is reverted to `ranges.energyThreshold.min`.

## What We're NOT Doing

- Not changing `DEFAULT_PARAMETER_RANGES.energyThreshold`'s actual
  `min`/`max`/`default` values — those remain the real, admin-editable
  product constraint. Only the HTML `min` attribute (a client-side
  nicety, not the authoritative bound) changes.
- Not auditing every `NumberField` across the entire app for the same
  pattern (e.g. `admin-settings-form.tsx`, `reference/parameters`) —
  scoped to this one form, which is the one confirmed broken by a live
  `checkValidity()` check against its own current defaults. A broader
  audit is a separate, lower-urgency task if it's ever wanted.
- Not resuming `test-plan-refresh-2026-11-18`'s paused Phase 3 as part
  of this plan — that happens separately, once this fix lands, and is
  tracked in its own change folder.
- Not wiring e2e into CI as part of this fix — that's
  `context/foundation/test-plan.md` §5's own separately-tracked gate,
  already noted there as not yet required.

## Implementation Approach

Two phases: fix the field + add a regression test proving the real
end-to-end flow works, then fix the separate pre-existing locator
collision in the existing spec so it passes again too.

## Phase 1: Fix the energyThreshold field and add a regression test

### Overview

Change the HTML `min` attribute to `0` (matching the lesson's
established pattern) and add an e2e test that would have caught this.

### Changes Required:

#### 1. Fix the field's HTML `min` attribute

**File**: `src/app/simulation/page.tsx`

**Intent**: Stop encoding the range's configurable floor in the HTML
`min` attribute — it only needs to prevent negative/zero input at the
browser level, and must stay aligned with `step="1"`'s grid for any
value the field's own default or admin-configured range might take.

**Contract**: Change the `energyThreshold` `NumberField`'s `min` prop
(`page.tsx:1171`) from `ranges.energyThreshold.min` to the literal
`0`, matching this file's own other integer-stepped fields (e.g.
`protectionThreshold`, `predatorCount`, which already use `min={0}`
or an integer range floor with `step` unspecified/`1`). The real floor
(`ranges.energyThreshold.min`, which can be a fractional admin-set
value) stays enforced exactly as today, via `buildStartInput()`'s
existing `Math.max(ranges.energyThreshold.min, energyThreshold)`
clamp at submit time — unchanged.

#### 2. Add a regression test proving the real submit flow works

**File**: `tests/e2e/authenticated-simulation-run.spec.ts`

**Intent**: Prove the actual defect class (a silently-blocked native
submit) stays caught, not just that `buildStartInput()`'s clamp logic
is correct — the existing unit/integration suite could never see this
bug, since it never reaches React.

**Contract**: Add a new test (or extend the existing one) that, before
clicking "Start", asserts
`await page.evaluate(() => document.querySelector("form")?.checkValidity())`
is `true` against the form's own untouched default values (no field
filled in at all) — this is the exact assertion that would have failed
before this phase's fix, and is cheaper and more precise than relying
solely on the subsequent click actually transitioning state (which the
existing test already checks, but which this project's own
`lessons.md` convention — "UI accepts input is not feature verified"
— suggests pairing with a direct assertion on the actual mechanism
that broke).

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Full suite still passes: `npm test`
- New/extended test passes: `npx playwright test authenticated-simulation-run`

#### Manual Verification:

- Deliberate-break check: revert `min` back to
  `ranges.energyThreshold.min`, confirm the new `checkValidity()`
  assertion goes red, then restore the fix — proving the test actually
  catches this defect class, not just that it passes today.

## Phase 2: Fix the separate button-name-collision defect

### Overview

Fix the pre-existing, independent locator bug so the existing spec
passes on its own terms, unblocking it as a real CI-quality signal
going forward.

### Changes Required:

#### 1. Disambiguate the "Start" button locator

**File**: `tests/e2e/authenticated-simulation-run.spec.ts`

**Intent**: `getByRole("button", { name: "Start" })` now matches both
the real "Start" button and "Start on server" (substring match) since
the latter was added after this spec was written.

**Contract**: Add `exact: true` to both the `"Start"` and `"Stop"`
locators in this file (`exact: true` on `"Stop"` too, for the same
substring-safety reason, matching the pattern this plan's Phase 1 test
and `test-plan-refresh-2026-11-18`'s own `page-smoke-sweep.spec.ts`
already use).

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- Spec passes in isolation: `npx playwright test authenticated-simulation-run`

#### Manual Verification:

- None — the automated e2e run against a real browser is itself the
  verification layer.

## Testing Strategy

### Unit Tests:

- None new — this defect lives entirely in the browser's native
  form-validation layer, which no unit/integration test in this
  project's stack can observe (confirmed: `vitest`'s jsdom-free setup
  has no DOM/browser constraint-validation implementation at all).

### Manual Testing Steps:

1. After deploy, sign in and visit `/simulation` — click "Start" with
   default field values, confirm it transitions to the running canvas.

## Performance Considerations

None.

## Migration Notes

None — client-side-only fix, no schema/data change.

## References

- Research: `context/changes/simulation-start-button-not-submitting/research.md`
- The original lesson this is a recurrence of: `context/foundation/lessons.md` ("HTML number inputs: min must not break the step grid for whole-number values")
- Discovered while implementing: `context/changes/test-plan-refresh-2026-11-18/` (paused Phase 3)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Fix the energyThreshold field and add a regression test

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck` — fddd275
- [x] 1.2 Lint passes: `npm run check` — fddd275
- [x] 1.3 Full suite still passes: `npm test` — fddd275
- [x] 1.4 New/extended test passes: `npx playwright test authenticated-simulation-run` — fddd275

#### Manual

- [x] 1.5 Deliberate-break check: reverted min, confirmed red, restored — fddd275

### Phase 2: Fix the separate button-name-collision defect

#### Automated

- [x] 2.1 Typecheck passes: `npm run typecheck` — c6911c8
- [x] 2.2 Lint passes: `npm run check` — c6911c8
- [x] 2.3 Spec passes in isolation: `npx playwright test authenticated-simulation-run` — c6911c8
