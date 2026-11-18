# Admin-settings range backfill Implementation Plan

## Overview

Fix `getOrSeedAdminSettings` so an existing `admin_settings` row missing
range keys added by later milestones gets backfilled with
`DEFAULT_PARAMETER_RANGES` and persisted — closing a confirmed production
bug where `/simulation` (and, by the same call path, live mid-run parameter
adjustment and the admin ranges-editing page) crashes once it reads a
missing range key.

## Current State Analysis

- `getOrSeedAdminSettings` (`src/server/api/routers/simulation.ts:179-204`)
  only writes `DEFAULT_PARAMETER_RANGES` when **no** row exists yet
  (`id=1`). When a row already exists, it returns
  `existing.parameterRanges as ParameterRanges` verbatim, with zero merge
  against the current `DEFAULT_PARAMETER_RANGES` shape.
- Confirmed live (2026-11-18): production's row has only the original 15
  keys (`boidCount`, `separationWeight`, ..., `zDepth`), missing 14 keys
  added since (`neighborRadius`, `separationRadius`,
  `predatorDetectionRadius`, `burstMult`, `burstCostMult`,
  `matePreference`, `foodStockShare`, `foodRegenShare`,
  `foodConsumptionRate`, `predatorFlockCount`, `detectionRadius`,
  `captureRadiusMult`, `maxSpeed`, `minSpeed` — the full set is
  `RANGED_PARAMETER_NAMES`, `src/server/simulation/parameter-ranges.ts:5-59`).
- Several call sites read through this incomplete object and each breaks the
  same way (`range.min` on `undefined`) once the missing-key code path is
  hit:
  - `src/app/simulation/page.tsx` — reads `ranges.<key>.min/max/default` for every `RANGED_PARAMETER_NAMES` entry while building the start form and `buildStartInput()`'s clamping. This is the confirmed, reproduced crash.
  - `checkLiveParamRangesSoft` (`src/server/simulation/parameter-ranges.ts:228-245`) — `const range = ranges[field]; if (value < range.min ...)` with no undefined-guard; used by live mid-run parameter adjustment.
  - `updateParameterRanges` (`src/server/api/routers/simulation.ts:1760-1800`) — the admin ranges-editing mutation types its input as `Record<RangedParameterName, ParameterRange>` (every key required). Confirmed at runtime (zod v4): `z.record()` with an enum key schema fails `safeParse` with `invalid_type` for every missing key, so a client UI built against today's incomplete `getParameterRanges()` output cannot assemble a submission that passes validation at all — it fails before reaching `ctx.db`.
  - `src/app/simulation/_components/server-run-viewer.tsx` and `simulation-canvas.tsx` — same `rangesQuery.data?.parameterRanges ?? DEFAULT_PARAMETER_RANGES` pattern as page.tsx, then index the same specific keys (e.g. `ranges.maxSpeed.min`, `ranges.detectionRadius.min`).
  - `admin-settings-form.tsx` — loops over `RANGED_PARAMETER_NAMES` doing `ranges[name].min/.max/.default`, same vulnerable pattern (this is the admin ranges-editing page's own form).
  - All of the above are fixed transparently by the single fix point below — named here for documentation completeness (plan-review F2), not because any of them need an independent code change.
- **`scripts/corpus/harness.ts:72-91`** (`getOrSeedAdminSettingsRanges`) has
  a *deliberately duplicated* copy of this exact bug — its own comment
  states it exists only because the real `getOrSeedAdminSettings` is
  private/non-exported and this module can't import it. It feeds
  `ensureAdminRangesAdmit`/`ensureAdminRangesAdmitForBatch`, which index
  the same missing keys the same way. Confirmed via plan-review (F1): no
  test in `harness.test.ts` asserts on this duplicate's specific behavior,
  so exporting the real function and deleting the duplicate is safe.
- Zero existing test coverage for `getOrSeedAdminSettings` or `admin_settings` backfill behavior (confirmed via grep — consistent with how this slipped through several milestones unnoticed, since dev/test DBs are always freshly seeded and never hit the "existing incomplete row" branch).
- This project already has a test helper for this singleton row,
  `resetAdminSettingsToDefaults` (`src/server/db/admin-settings-test-reset.ts`), and an established upsert pattern for it (`.insert(adminSettings).values(...).onConflictDoUpdate(...)`, same file and `updateParameterRanges`) — reused here, not reinvented.

### Key Discoveries:

- `ParameterRanges = Record<RangedParameterName, ParameterRange>` (`parameter-ranges.ts:132`) — a plain keyed record, trivially mergeable via object spread.
- The bug is invisible in dev/test because those DBs are always freshly seeded via `getOrSeedAdminSettings`'s own `!existing` branch — only a long-lived production DB whose row predates later milestones ever exercises the broken branch.

## Desired End State

Any `admin_settings` row — however old, however many keys it's missing —
reads back as a complete `ParameterRanges` object with every
`RANGED_PARAMETER_NAMES` key present: admin-edited keys keep their stored
value, missing keys get `DEFAULT_PARAMETER_RANGES`'s value, and the
backfilled result is persisted so the row becomes complete going forward
(no repeated backfill work on every subsequent read).

**Verification**: `npm run typecheck`, `npm run check`, `npm test` all
pass; a new regression test proves the exact production shape (a stored
row missing keys) returns and persists a complete, correctly-merged
object; after deploy, `/simulation` renders without the "Something went
wrong" crash.

## What We're NOT Doing

- Not changing `DEFAULT_PARAMETER_RANGES`'s values or adding/removing any `RANGED_PARAMETER_NAMES` entry — this is a backfill mechanism fix, not a ranges-data change.
- Not changing `updateParameterRanges`'s validation or the admin UI — once `getOrSeedAdminSettings` always returns a complete object, that page's existing "load current ranges, edit, submit" flow works unmodified.
- Not writing a standalone one-off migration script to patch the production row directly — the in-code backfill-on-read is self-healing and runs automatically on first request after deploy, no manual DB step needed.

## Implementation Approach

One phase: fix the `existing` branch of `getOrSeedAdminSettings` to merge
and persist, export it and delete `scripts/corpus/harness.ts`'s duplicated
copy of the same bug (plan-review F1), add a regression test reproducing
the exact production shape, verify.

## Critical Implementation Details

**Write-back is conditional, not unconditional.** Only issue the upsert
when the merged object actually differs from what's stored (i.e.
backfill was genuinely needed) — once a row is complete, every normal
read returns early with no extra write, keeping the hot `getParameterRanges`
query path's common case exactly as cheap as it is today.

**Merge direction**: `{ ...DEFAULT_PARAMETER_RANGES, ...existing.parameterRanges }` —
defaults first, existing values spread on top, so an admin's prior edits
to already-present keys are never silently reverted; only genuinely
*missing* keys fall back to the default.

## Phase 1: Backfill missing range keys on read

### Overview

Merge and persist, add a regression test, verify against the exact
reproduced production shape.

### Changes Required:

#### 1. Backfill-and-persist on the existing-row branch

**File**: `src/server/api/routers/simulation.ts`

**Intent**: When a stored row is missing keys `DEFAULT_PARAMETER_RANGES`
now has, merge them in (existing values win per-key) and persist the
complete result, instead of returning the stored object verbatim.

**Contract**: In `getOrSeedAdminSettings`'s `if (existing)` branch, compute
`merged = { ...DEFAULT_PARAMETER_RANGES, ...(existing.parameterRanges as ParameterRanges) }`.
If `JSON.stringify(merged) !== JSON.stringify(existing.parameterRanges)`,
upsert `parameterRanges: merged` back onto the row (same
`.insert(adminSettings).values(...).onConflictDoUpdate(...)` shape
`updateParameterRanges` and `resetAdminSettingsToDefaults` already use,
targeting `adminSettings.id`), then return `merged` (not the stale
`existing.parameterRanges`) either way. Change the function's declaration
from `async function getOrSeedAdminSettings` to
`export async function getOrSeedAdminSettings` (plan-review F1 — needed
by item 2 below).

#### 2. Delete the duplicated seeding helper in corpus tooling

**File**: `scripts/corpus/harness.ts`

**Intent**: Plan-review F1 — this file's `getOrSeedAdminSettingsRanges`
(lines 72-91) is a deliberately duplicated copy of the same seed-if-absent
logic, kept only because the real function was private. Now that it's
exported, delete the duplicate and call the real (now-fixed) function
instead, so the corpus/sweep validation tooling gets the same backfill fix
with no second bug to maintain.

**Contract**: Remove `getOrSeedAdminSettingsRanges` entirely. At its two
call sites (`ensureAdminRangesAdmit`, `ensureAdminRangesAdmitForBatch`),
replace `const original = await getOrSeedAdminSettingsRanges(db);` with
`const { parameterRanges: original } = await getOrSeedAdminSettings(db);`
(the real function returns `{ parameterRanges, maxObjectCount,
maxConcurrentObjectCount }`, not a bare `ParameterRanges` — destructure to
keep `original`'s downstream usage unchanged). Import
`getOrSeedAdminSettings` from `~/server/api/routers/simulation`. Remove
now-unused imports (`DEFAULT_PARAMETER_RANGES`,
`DEFAULT_MAX_OBJECT_COUNT`, `DEFAULT_MAX_CONCURRENT_OBJECT_COUNT`,
`adminSettings`, `ADMIN_SETTINGS_ID`) only if nothing else in this file
still uses them — check before removing each.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- New test passes: `npx vitest run src/server/api/routers/simulation.test.ts -t "backfill"`
- Full suite still passes: `npm test`

#### Manual Verification:

- After deploy, `/simulation` renders the parameters form without the "Something went wrong" crash, signed in against the real production DB
- The admin ranges-editing page (`/admin/settings` or equivalent) loads without error and shows all `RANGED_PARAMETER_NAMES` fields, not just the original 15

## Testing Strategy

### Unit Tests:

- `getOrSeedAdminSettings` with a deliberately incomplete stored row
  (the exact reproduced production shape — only the original 15 keys):
  returns a complete `ParameterRanges` object with all `RANGED_PARAMETER_NAMES`
  keys; keys present in the stored row keep their stored values; missing
  keys get `DEFAULT_PARAMETER_RANGES`'s values; the row is actually
  updated in the DB afterward (re-query confirms persistence).
- A second case: calling it again on an already-complete row makes no
  further write (assert via a spy/count, or by confirming a subsequent
  read returns byte-identical JSON without needing a second backfill).
- This test is written to reproduce the exact bug first (fails against
  today's code — the stored incomplete row comes back incomplete), per
  this project's own debugging convention: evidence first, then a failing
  test, then the fix.

### Manual Testing Steps:

1. After deploy, sign in and visit `/simulation` — confirm the form renders without crashing.
2. Visit the admin ranges-editing page and confirm every `RANGED_PARAMETER_NAMES` field is present and editable.

## Performance Considerations

None beyond the one-time conditional write described in "Critical
Implementation Details" — negligible for a singleton row read on a
non-hot-loop query.

## Migration Notes

None — the fix is self-healing on first read after deploy; no manual DB
intervention needed.

## References

- Confirmed root cause and live reproduction: `context/changes/admin-settings-range-backfill/change.md`
- Existing upsert pattern for this row: `src/server/db/admin-settings-test-reset.ts`, `updateParameterRanges` (`src/server/api/routers/simulation.ts:1760-1800`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backfill missing range keys on read

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck`
- [x] 1.2 Lint passes: `npm run check`
- [x] 1.3 New test passes: `npx vitest run src/server/api/routers/simulation.test.ts -t "backfill"`
- [x] 1.4 Full suite still passes: `npm test`

#### Manual

- [ ] 1.5 `/simulation` renders without the "Something went wrong" crash against real production data
- [ ] 1.6 Admin ranges-editing page loads with every `RANGED_PARAMETER_NAMES` field present
