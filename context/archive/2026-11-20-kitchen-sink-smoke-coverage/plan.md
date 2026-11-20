# Kitchen-sink page smoke coverage Implementation Plan

## Overview

Close the E2E coverage gap M-12/M-13's 5 new kitchen-sink pages left in `tests/e2e/page-smoke-sweep.spec.ts`, following the project's own already-documented `test-plan.md` §6.11 cookbook pattern exactly.

## Current State Analysis

- `tests/e2e/page-smoke-sweep.spec.ts`'s `"page smoke sweep — shared session"` describe block (lines 47-163) covers 13 routes including `/simulation/kitchen-sink`, but not `/dashboard/kitchen-sink`, `/leaderboard/kitchen-sink`, `/runs/kitchen-sink`, `/admin/kitchen-sink`, or `/reference/kitchen-sink`.
- All 5 missing routes are static content, gated only by `src/middleware.ts`'s uniform any-signed-in-user check (no admin-role or dynamic-id requirement) — confirmed by direct code read, same category as the already-covered `/admin/elevation` and `/simulation/kitchen-sink`.
- Full detail, including each route's exact `<h1>` text: `context/changes/kitchen-sink-smoke-coverage/research.md`.

## Desired End State

All 5 kitchen-sink pages have a smoke test in the shared-session describe block, each asserting a route-specific heading is visible and zero console errors occurred — matching the file's existing pattern exactly.

### Key Discoveries:

- No new fixture, describe block, or session reset is needed — all 5 routes fit the file's simplest existing case.

## What We're NOT Doing

- Not asserting anything about color tokens, button variants, card counts, or other visual detail — `test-plan.md` §6.11 explicitly warns against full-page content snapshots; a structural landmark plus zero console errors is the signal this sweep is for. Visual detail is already covered by each UI-refresh change's own manual screenshot review.
- Not touching `tests/e2e/auth-ux.spec.ts` — research confirmed its assertions are role/text-based and unaffected by S-53's button restyle.
- Not adding a new describe block or fixture helper.

## Implementation Approach

Single phase: 5 near-identical test additions to one existing file, each following the file's own established pattern.

## Phase 1: Add the 5 kitchen-sink route tests

### Overview

Add one `test(...)` block per route to the shared-session describe block, in the same style as the existing `/simulation/kitchen-sink` test.

### Changes Required:

#### 1. Five new route tests

**File**: `tests/e2e/page-smoke-sweep.spec.ts`

**Intent**: Extend coverage to the 5 kitchen-sink pages M-12/M-13 added, closing the regression-coverage gap those UI-refresh changes left.

**Contract**: Add 5 `test(...)` blocks inside the existing `"page smoke sweep — shared session"` describe block (after the existing `/simulation/kitchen-sink` test, before the block's closing brace), each following the file's established pattern exactly (`trackConsoleErrors(page)` → `page.goto()` → `getByRole("heading", { name: "<text>", level: 1 })` visible → `tracked.errors` is `[]`):

| Route | Test name | Heading text |
|---|---|---|
| `/dashboard/kitchen-sink` | `"/dashboard/kitchen-sink" renders without error` | `"Dashboard Kitchen Sink"` |
| `/leaderboard/kitchen-sink` | `"/leaderboard/kitchen-sink" renders without error` | `"Leaderboard Kitchen Sink"` |
| `/runs/kitchen-sink` | `"/runs/kitchen-sink" renders without error` | `"Runs Analysis Kitchen Sink"` |
| `/admin/kitchen-sink` | `"/admin/kitchen-sink" renders without error` | `"Admin Kitchen Sink"` |
| `/reference/kitchen-sink` | `"/reference/kitchen-sink" renders without error` | `"Reference Kitchen Sink"` |

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`
- New spec tests pass: `npx playwright test tests/e2e/page-smoke-sweep.spec.ts`
- Full E2E suite still passes: `npx playwright test`
- Full unit/integration suite still passes: `npm test`

#### Manual Verification:

- Review the 5 new test blocks against this project's E2E conventions (no CSS/XPath selectors, no `waitForTimeout`, each test independent — though these 5 share the file's default `storageState` by design, same as every other shared-session test in this file).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to archive.

---

## Testing Strategy

### Unit Tests:

- None — this change IS test code; `tests/e2e/page-smoke-sweep.spec.ts` is the artifact.

### Manual Testing Steps:

1. Run `npx playwright test tests/e2e/page-smoke-sweep.spec.ts` and confirm all 18 tests (13 existing + 5 new) pass.
2. Read the 5 new test blocks once to confirm they follow the established pattern with no deviation.

## Performance Considerations

None — 5 additional Playwright test cases, no production code touched.

## Migration Notes

None — no persisted data, no schema, no production code changes.

## References

- `context/changes/kitchen-sink-smoke-coverage/research.md` — full gap analysis, per-route session requirements, and confirmation `auth-ux.spec.ts` needs no change.
- `context/foundation/test-plan.md` §6.11 — the cookbook pattern this plan follows exactly.
- `tests/e2e/page-smoke-sweep.spec.ts:75-82` — the `/simulation/kitchen-sink` test, the direct reference this plan's 5 new tests mirror.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Add the 5 kitchen-sink route tests

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck` — 2d4bc16
- [x] 1.2 Lint passes: `npm run check` — 2d4bc16
- [x] 1.3 New spec tests pass: `npx playwright test tests/e2e/page-smoke-sweep.spec.ts` — 20/20 passed — 2d4bc16
- [x] 1.4 Full E2E suite still passes: `npx playwright test` — 28/28 passed — 2d4bc16
- [x] 1.5 Full unit/integration suite still passes: `npm test` — 559 passed, 1 skipped — 2d4bc16

#### Manual

- [x] 1.6 5 new test blocks reviewed against this project's E2E conventions — verified: no CSS/XPath selectors, no `waitForTimeout`, exclusively `getByRole` locators, each test independent (own `trackConsoleErrors` call); also fixed a naming-convention deviation found during review — the implementer's test names used quoted route strings (`'"/dashboard/kitchen-sink" renders...'`) diverging from the file's existing unquoted convention (`"/simulation/kitchen-sink renders..."`) — corrected to match. — 2d4bc16
