# Fix two pre-existing flaky tests — Implementation Plan

## Overview

Fix two pre-existing flaky tests surfaced while running `test-plan-refresh-2026-11-16`'s gates, neither caused by that change. A trivial timeout bump closes the Stop-hook self-test gap entirely. The admin-ranges flake has no clean in-process fix (confirmed cross-process race on a deliberately-global `admin_settings` row — see research.md); the chosen fix reduces the most common real-world trigger (the Stop hook's own automatic test run colliding with a manually-run `npm test`) via a vitest-wide lock file, with the residual risk (two deliberately-concurrent manual runs can still race) accepted and documented.

## Current State Analysis

- `scripts/__tests__/agent-hooks.test.ts`'s `run()` helper (`execFileSync`, no internal timeout) shells out to `.claude/hooks/end-of-turn.sh`, which runs Biome + a nested `vitest run` + `tsc --noEmit` sequentially, unconditionally, even for a trivially clean fixture. Two tests in this file — "passes (exit 0) on an untracked new clean file" and "nothing changed since HEAD" (confirm exact title when editing) — have no explicit per-test timeout, so they inherit Vitest's 5000ms default. A sibling test ("blocks (exit 2) on a lint error written directly to disk", line 195-206) already carries an explicit `15_000` timeout — the established precedent for this exact slow-hook-script problem.
- `vitest.config.ts` has no `globalSetup`/`globalTeardown` today. Its `serialized-shared-state` project (`fileParallelism: false`, lines 31-53) already serializes `simulation.test.ts`/`harness.test.ts`/`generate-sweep.smoke.test.ts` within one process, but cannot (and per its own comment, does not try to) prevent a second, independent OS process from running the same project concurrently.
- `admin_settings`'s single global row is a confirmed product requirement (schema.ts comment citing FR-002/FR-018; PRD: one admin-set range for the whole deployed app) — not in scope to change.
- `.claude/hooks/end-of-turn.sh` (full file read) runs its nested `npx --no-install vitest run --passWithNoTests` at line 63, inside a `for ROOT in "${ROOTS[@]}"` loop, only when `$CHANGED` is non-empty for that root (line 38-39).

### Key Discoveries:

- The sibling test's existing `15_000` timeout (`agent-hooks.test.ts:206`) is the direct precedent for Phase 1 — no new pattern needed, just applying the same number to the two under-timed tests.
- Vitest's `globalSetup`/`globalTeardown` run once per top-level `vitest` invocation (not per project), which is exactly the granularity needed: one lock held for the life of any `vitest run`, regardless of which project(s) it includes.
- `research.md`'s Open Questions section already names this exact design (test-only mitigation, lock file) as the lowest-risk option; the user confirmed it over the two alternatives (tighter test-file serialization — doesn't address the confirmed cross-process mechanism; architectural per-row scoping — would violate FR-002/FR-018).

## Desired End State

Both Stop-hook self-tests pass reliably under full-suite load (verified by re-running the full suite, not just the targeted test, since the whole point is load-sensitivity). The lock file demonstrably causes a second concurrent `vitest` invocation to skip its own nested test step rather than racing for `admin_settings` — verified by a deliberate, one-off manual concurrent-process check (not a new automated test, per the research's cross-process-contamination lesson). The residual risk (two manual, deliberately-concurrent `npm test` runs can still race) is recorded in `lessons.md`.

## What We're NOT Doing

- Not changing `admin_settings`'s schema or production architecture — confirmed out of scope (FR-002/FR-018).
- Not attempting to fully eliminate the admin-ranges race — only reducing its most common real-world trigger. A deliberately-run pair of manual `npm test` processes can still collide; this is an accepted, documented tradeoff, not a bug in this fix.
- Not touching the 3-file `serialized-shared-state` Vitest project's existing cross-file serialization — it already does its job; this fix adds a cross-*process* layer on top.
- Not adding a new automated test asserting the lock file's behavior — the verification is a one-off manual check per the user's explicit choice, since lessons.md already warns against baking "concurrent npm test processes" into any automated/repeatable test technique.

## Implementation Approach

Phase 1 is a pure test-file edit (two timeout bumps). Phase 2 adds a small, generic lock-file mechanism at the Vitest config level (via `globalSetup`/`globalTeardown`, which already run once per invocation regardless of project) so it protects every `vitest run`/`npm test` invocation uniformly, then wires `.claude/hooks/end-of-turn.sh` to check that lock before its own nested test step. Phase 3 is verification-only: no code changes, just the deliberate concurrent-process check and a `lessons.md` entry.

## Critical Implementation Details

**Stale-lock safety.** The lock file must not be able to permanently wedge the hook if a prior `vitest` process crashed without running its `globalTeardown` (e.g., killed by a timeout or OOM). Write the lock file's own PID as its content; before treating an existing lock as "another process is active," check whether that PID is still alive (e.g., `kill -0 <pid>` on POSIX). A dead PID means a stale lock — treat it as absent and proceed, not as a permanent block.

## Phase 1: Bump Stop-hook self-test timeouts

### Overview

Close the Stop-hook self-test timeout gap entirely — this is the simple, fully-settled half of this change.

### Changes Required:

#### 1. Timeout bump

**File**: `scripts/__tests__/agent-hooks.test.ts`

**Intent**: Give the two under-timed tests ("passes (exit 0) on an untracked new clean file"; the sibling asserting correct behavior when nothing changed since HEAD — confirm its exact title when editing) the same real-wall-clock budget the file's own author already gave a third, similarly-slow case.

**Contract**: Add `, 15_000` as the third argument to both `it(...)` calls, matching line 206's existing pattern exactly.

### Success Criteria:

#### Automated Verification:

- Targeted file passes under full-suite load: `npm test` (run at least twice; this fix's whole point is load-sensitivity, so a single green run is not sufficient evidence — see lessons.md)
- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`

#### Manual Verification:

- None.

---

## Phase 2: Vitest-wide lock file + hook-side skip

### Overview

Add a PID-keyed lock file held for the duration of any `vitest` invocation (via `globalSetup`/`globalTeardown`), and have `.claude/hooks/end-of-turn.sh` skip its own nested test step when another such lock is already held and alive.

### Changes Required:

#### 1. Lock-file globalSetup/globalTeardown

**File**: `vitest.config.ts` (new sibling script, e.g. `vitest.global-setup.ts`, referenced from here)

**Intent**: Hold a lock file for the full lifetime of any top-level `vitest` invocation (manual `npm test`, or the hook's own nested run), so any OTHER concurrently-starting `vitest` process can detect it.

**Contract**: Add `test.globalSetup`/`test.globalTeardown` (sibling keys to `test.environment`/`test.projects` in the existing config) pointing at a new script. Setup: write the current process's PID to a well-known lock path (e.g. `${TMPDIR:-/tmp}/swarm-arena-vitest.lock` — pick a path consistent with how `end-of-turn.sh` already derives its own temp paths, e.g. `${TMPDIR:-/tmp}/claude-hooks/...`, for easy cross-reference). Teardown: remove the lock file unconditionally (even on a failed run — teardown must still run to avoid leaving a live-PID lock behind after a clean exit).

#### 2. Hook-side lock check

**File**: `.claude/hooks/end-of-turn.sh`

**Intent**: Before line 63's nested `npx --no-install vitest run --passWithNoTests`, check whether the lock file from step 1 already exists with a live PID (not the hook's own, not-yet-started invocation). If so, skip the nested test step for this `ROOT` and note the skip in the report instead of running (and potentially racing) it.

**Contract**: A shell check reading the lock file's PID and testing liveness (`kill -0`), following the stale-lock handling in "Critical Implementation Details" above. On skip, append an informational (non-failing) note to `$REPORT`'s accumulation — e.g. `"Tests skipped at $ROOT: another vitest process (pid <N>) is already running."` — distinguishable from the existing failure-reporting lines so the hook's exit code isn't affected by a skip alone.

### Success Criteria:

#### Automated Verification:

- Full suite passes with the new globalSetup/globalTeardown wired in (run at least twice): `npm test`
- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run check`

#### Manual Verification:

- Confirm the hook script still produces its normal pass/fail report when run alone (no concurrent process) — i.e., the lock mechanism doesn't change behavior in the common case.

---

## Phase 3: Deliberate concurrent-process verification + lessons.md note

### Overview

Prove the lock actually causes a skip under real concurrent load (not just in isolation), and record the accepted residual risk.

### Changes Required:

#### 1. Lessons.md entry

**File**: `context/foundation/lessons.md`

**Intent**: Document that the admin-ranges cross-process race is mitigated (common Stop-hook-collision case), not eliminated (two manually-run concurrent `npm test` processes can still race) — so a future session doesn't re-discover this as a surprise or assume the race is fully closed.

**Contract**: New entry following this file's existing format (Context / Problem / Rule / Applies to).

### Success Criteria:

#### Automated Verification:

- None — this phase is verification + documentation, not a new automated check (per the plan's own "What We're NOT Doing").

#### Manual Verification:

- Deliberately launch two real `npm test` processes at nearly the same time (a one-off manual check, not a reusable technique) and confirm: the second process's hook-relevant path (or a standalone invocation of the same lock mechanism) observes the first's live lock and would skip; confirm via the lock file's presence/PID during the overlap window, not by relying on a flaky test's pass/fail alone.

---

## Testing Strategy

### Unit Tests:

- Phase 1's fix is validated by the existing tests themselves (now correctly timed), run under full-suite load at least twice.

### Integration Tests:

- None beyond the existing full-suite run.

### Manual Testing Steps:

1. Run `npm test` twice in a row after Phase 1 to confirm both previously-flaky tests pass under real full-suite contention.
2. After Phase 2, run the hook script alone (no concurrent process) and confirm its normal report is unchanged.
3. After Phase 2, perform Phase 3's deliberate concurrent-process check.

## References

- Research: `context/changes/admin-ranges-and-hook-test-flakes/research.md`
- Precedent: `context/foundation/lessons.md` (cross-process contamination entries), `context/archive/2026-11-16-pre-existing-admin-settings-flakes/`
- Timeout precedent: `scripts/__tests__/agent-hooks.test.ts:195-206`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Bump Stop-hook self-test timeouts

#### Automated

- [x] 1.1 Targeted file passes under full-suite load (2x): `npm test` — f6dd68b
- [x] 1.2 Typecheck passes: `npm run typecheck` — f6dd68b
- [x] 1.3 Lint passes: `npm run check` — f6dd68b

### Phase 2: Vitest-wide lock file + hook-side skip

#### Automated

- [x] 2.1 Full suite passes with new globalSetup/globalTeardown (2x): `npm test` — 99e68fb
- [x] 2.2 Typecheck passes: `npm run typecheck` — 99e68fb
- [x] 2.3 Lint passes: `npm run check` — 99e68fb

#### Manual

- [x] 2.4 Hook script's normal pass/fail report is unchanged when run alone — 99e68fb

### Phase 3: Deliberate concurrent-process verification + lessons.md note

#### Manual

- [x] 3.1 Deliberate concurrent-process check confirms the lock causes a detectable skip
