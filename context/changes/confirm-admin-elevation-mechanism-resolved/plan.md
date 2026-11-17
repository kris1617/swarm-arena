# Confirm admin-elevation mechanism is resolved Implementation Plan

## Overview

Formally close Open Roadmap Question #6 in `context/foundation/roadmap.md`,
citing this change's research finding — a clean confirmation that the
originally-shipped time-boxed, self-service admin-elevation mechanism
is still fully live and unmodified — and mark roadmap slice S-38 of
M-9 complete. No code changes; a pure documentation closeout.

## Current State Analysis

- `research.md` confirms every component of the `temporary-admin-elevation`
  change (archived 2026-11-14) is still live, correct, and unmodified:
  the `elevatedUntil` column, the `isEffectivelyAdmin` helper, both
  authorization sites (`adminProcedure`, `/admin/settings`'s page-level
  redirect), all 5 tRPC procedures and their router registration, the
  `ALLOW_SELF_ELEVATION` safety flag (currently unset in this repo's
  `.env`, resolving to disabled — the documented secure default), the
  `/admin/elevation` UI, and full test coverage. No later change
  touched any of it.
- Unlike sibling slice S-37 (`confirm-run-history-retroactive-scope`),
  this verification found no gap to fix — there is no code phase in
  this plan.
- `context/foundation/roadmap.md`'s Open Roadmap Question #6 currently
  reads "deferred to `/10x-plan` per PRD Open Question #6, product-level
  requirement already fixed" — accurate as a historical note, but not
  yet marked as formally resolved against current code.

## Desired End State

Open Roadmap Question #6 is marked resolved, citing this verification.
Roadmap slice S-38's Status is `done` in both `## At a glance` and its
own body block. Verify by: reading the updated question text and S-38's
block, confirming both accurately reflect research.md's findings.

## What We're NOT Doing

- Not changing any code — research found nothing to fix.
- Not re-deciding the elevation mechanism itself (self-service toggle
  vs. time-boxed grant vs. something else) — that decision was already
  made and shipped during S-22's own planning; this change only
  confirms it still holds.
- Not touching the `ALLOW_SELF_ELEVATION` flag's current value in this
  repo's `.env` — it's unset (disabled), matching the documented secure
  default; changing it is an operational decision outside this change's
  scope.

## Implementation Approach

A single phase: edit the two roadmap sections, done.

## Phase 1: Roadmap closeout

### Overview

Mark Open Roadmap Question #6 resolved and roadmap slice S-38 complete.

### Changes Required:

#### 1. Resolve Open Roadmap Question #6

**File**: `context/foundation/roadmap.md`

**Intent**: Replace the "deferred to `/10x-plan`" framing with a
resolved note citing this change's verification, matching the format
S-37 used to close Open Roadmap Question #4.

**Contract**: Edit entry #6 under `## Open Roadmap Questions` to state
it's resolved, naming `confirm-admin-elevation-mechanism-resolved` and
summarizing the clean confirmation (mechanism unchanged since
2026-11-14, no gap found).

#### 2. Mark roadmap slice S-38 complete

**File**: `context/foundation/roadmap.md`

**Intent**: Flip S-38's Status to `done` now that the confirmation is
complete.

**Contract**: Edit the `| S-38 | ... |` row's Status cell in
`## At a glance` and the `### S-38:` block's `- **Status:**` line, both
to `done`.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck` (sanity-check only — no code
  changed)
- Lint passes: `npm run check`

#### Manual Verification:

- Read the updated Question #6 entry and S-38's block; confirm both
  accurately cite research.md's findings and the mechanism's current,
  unchanged state.

---

## Testing Strategy

### Unit Tests:

- None — documentation only.

### Integration Tests:

- None.

### Manual Testing Steps:

1. Read the two edited roadmap sections for accuracy against research.md.

## References

- Research: `context/changes/confirm-admin-elevation-mechanism-resolved/research.md`
- The confirmed-unchanged mechanism: `context/archive/2026-11-14-temporary-admin-elevation/plan.md`
- Sibling closeout precedent: `context/archive/2026-11-17-confirm-run-history-retroactive-scope/plan.md`
- Roadmap slice definition: `context/foundation/roadmap.md`, S-38 and Open Roadmap Question #6

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Roadmap closeout

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck`
- [x] 1.2 Lint passes: `npm run check`

#### Manual

- [x] 1.3 Updated Question #6 entry and S-38's block accurately cite research.md's findings
