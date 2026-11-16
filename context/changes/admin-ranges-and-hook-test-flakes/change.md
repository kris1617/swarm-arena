---
change_id: admin-ranges-and-hook-test-flakes
title: Fix two pre-existing flaky tests (admin-ranges + Stop hook self-test)
status: preparing
created: 2026-11-16
updated: 2026-11-16
archived_at: null
---

## Notes

Fix two pre-existing flaky tests: simulation.test.ts's "lets an admin update ranges, and start enforces the new bound" (documented in lessons.md from vitest-parallel-flakiness) and scripts/__tests__/agent-hooks.test.ts's "end-of-turn.sh (Stop) passes on an untracked new clean file" (newly observed: passes reliably in isolation, times out intermittently under the full 37-file suite)

Discovered while running test-plan-refresh-2026-11-16's gate stack (Phases 1-2).
Neither flake is caused by that change's diff — both reproduce on unrelated
files/commits. Opened as a separate change per the user's standing preference
for isolating pre-existing-bug fixes from the change that happened to surface
them (see context/archive/2026-11-16-pre-existing-admin-settings-flakes/ for
precedent).
