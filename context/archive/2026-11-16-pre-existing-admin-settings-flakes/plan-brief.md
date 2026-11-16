# Pre-existing admin-settings flakes — Plan Brief

> Full plan: `context/changes/pre-existing-admin-settings-flakes/plan.md`
> Research: `context/changes/pre-existing-admin-settings-flakes/research.md`

## What & Why

Two confirmed, pre-existing flaky tests surfaced by `vitest-parallel-flakiness`'s
stress testing — neither caused by Vitest parallelism, both real bugs in
production code that predate that change. Fix both at the root instead of
leaving them as accepted risk, since the user explicitly chose the
thorough path for each: root-cause Bug 1 via instrumentation rather than a
blind defensive patch, and add real serialization for Bug 2 rather than
re-accepting the existing risk note.

## Starting Point

`getOrSeedAdminSettings` (`simulation.ts`) and its near-duplicate
`getOrSeedAdminSettingsRanges` (`harness.ts`) both do a correct
check-then-insert in isolation, but `simulation.test.ts`'s "lets an admin
update ranges..." test still intermittently hits the insert branch when
the row should already exist — true rate ~5-10% in isolation, far higher
under concurrent system load. Separately, `harness.ts`'s
`ensureAdminRangesAdmit`/`ensureAdminRangesAdmitForBatch` have no
synchronization at all, so two concurrent callers (today, only a
deliberately-constructed test) can interleave their widen/restore writes
— an already-accepted risk from a prior change, confirmed by this
change's research to be exactly as scoped (no wider blast radius than
originally documented).

## Desired End State

Bug 1 has either a confirmed, fixed root cause with a regression test, or
a provably-correct defensive fix if the bounded reproduction attempt
doesn't land. Bug 2's concurrent-widen race is closed by a real async
lock, verified by the previously-~25%-flaky concurrent-batch test passing
20/20 consecutive runs.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Bug 1 approach | Instrument and root-cause first, bounded to 40 reproduction attempts, with a defensive fallback | User explicitly chose the thorough path over the faster defensive-only fix | Plan (user-confirmed) |
| Bug 2 approach | Add real serialization (async lock), not leave as accepted risk | User explicitly chose to fix it now rather than re-accept the existing risk note | Plan (user-confirmed) |
| Lock mechanism | A minimal in-process promise-chaining mutex, no new dependency | The race is entirely single-process/single-SQLite-writer; no distributed coordination needed | Plan |
| Defensive fallback shape | onConflictDoNothing + re-SELECT the actual row, never assume defaults | Avoids a correctness trap research flagged: a naive upsert-to-defaults could silently discard a real admin customization on the rare conflict path | Research + Plan |

## Scope

**In scope:**
- Temporary instrumentation + bounded reproduction attempt for Bug 1
- A fix for Bug 1 (root-cause or defensive fallback, depending on reproduction outcome)
- A real async lock serializing `harness.ts`'s admin-ranges widen/restore cycle, applied to both `startCorpusRun`'s internal path and `generate-sweep.ts`'s `runBatch`
- Updating `harness.test.ts`'s concurrent-batch test to exercise the fixed, locked path

**Out of scope:**
- Anything already fixed by `vitest-parallel-flakiness` (admin-settings reset helper, Vitest Projects split, diff-scoped assertions)
- A DB-level lock or new dependency — not needed for a single-process race
- `admin_settings` schema changes

## Architecture / Approach

Bug 1: instrument → reproduce under a bounded budget → fix based on
evidence (or fall back to a correctness-safe defensive fix). Bug 2: a
minimal async mutex exported from `harness.ts`, wrapped around the
widen→run→restore critical section wherever it's invoked (today:
`startCorpusRun`'s own internal path, and `generate-sweep.ts`'s
`runBatch`) — this makes the primitive itself safe for any future
concurrent caller, not just the one test that currently exercises it.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Instrument TOCTOU sites | Togglable diagnostic logging, zero behavior change when off | Low |
| 2. Reproduce under load | Either a captured failure, or a documented clean 40-attempt budget | Medium — open-ended by nature, bounded by design |
| 3. Fix Bug 1 | Root-cause fix or defensive fallback | Medium — fix shape depends on Phase 2's outcome |
| 4. Serialize widen/restore | A real async lock closing Bug 2 structurally | Low — small, well-understood primitive |
| 5. Update concurrent-batch test | Proves the lock actually works, 20/20 | Low |
| 6. Cleanup + verification | Removes temporary instrumentation, confirms both fixes together | Low |

**Prerequisites:** None — standalone from `vitest-parallel-flakiness`, which is already archived.
**Estimated effort:** ~1-2 sessions; Phase 2's reproduction attempt dominates wall-clock time, not implementation effort.

## Open Risks & Assumptions

- Phase 2 may not reproduce Bug 1 within the 40-attempt budget — the plan treats this as a valid outcome, not a blocker, and Phase 3's fallback fix is correctness-safe either way.
- The async lock in Phase 4 has zero effect on the one real production caller today (`runBatch` is always sequential) — its value is making the primitive safe for a future concurrent caller, which is a judgment call the user already made explicitly.

## Success Criteria (Summary)

- `harness.test.ts`'s concurrent-batch test passes 20/20 consecutive runs (up from ~75%).
- `simulation.test.ts`'s admin-range test either has a confirmed root cause with a regression test, or a defensive fix proven correct on the conflict path.
- Full suite and `--no-file-parallelism` both stay green.
