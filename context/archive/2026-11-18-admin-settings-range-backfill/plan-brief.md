# Admin-settings range backfill — Plan Brief

> Full plan: `context/changes/admin-settings-range-backfill/plan.md`

## What & Why

Production's `admin_settings` row was seeded long ago and only has the
original 15 parameter-range keys; several milestones since added 14 more
that `/simulation`'s code now expects. The mismatch crashes the page
("Something went wrong") the moment it reads a missing key — confirmed
live via direct production DB inspection. The same incomplete object also
breaks live mid-run parameter adjustment and the admin ranges-editing
page, since all three read through the same function.

## Starting Point

`getOrSeedAdminSettings` only ever writes `DEFAULT_PARAMETER_RANGES` when
no row exists at all; an existing row is returned verbatim, with no merge
against the current default shape. This is invisible in dev/test (always
freshly seeded) and only bites the one long-lived production DB. A
plan-review pass also found a deliberately-duplicated copy of this exact
bug in `scripts/corpus/harness.ts` (kept only because the real function
was private) — now folded into this same fix.

## Desired End State

Any stored row, however old, reads back complete — missing keys filled
from defaults, existing admin edits preserved — and the backfilled
result is persisted so it's complete going forward with no repeated work.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Backfill scope | One fix point: `getOrSeedAdminSettings` | All three broken call sites (`/simulation`, live param adjustment, admin settings page) read through this one function. |
| Persist vs. in-memory | Persist the merged result back to the DB | User's explicit choice — the row becomes self-correcting after one read; the write is conditional (only when a diff actually exists), so the common case stays a pure read. |
| Merge direction | Defaults first, existing values override per-key | Never silently reverts an admin's prior edits to keys that already existed. |
| Duplicate helper in corpus tooling | Export the real function, delete the duplicate | Plan-review F1 — one fix point for both production and dev tooling, no test depends on the duplicate's specific behavior. |

## Scope

**In scope:** The backfill-and-persist fix, a regression test reproducing the exact production shape, manual confirmation against the live deployment.

**Out of scope:** Changing `DEFAULT_PARAMETER_RANGES`'s values, the admin UI, or `updateParameterRanges`'s validation; no manual DB migration script.

## Architecture / Approach

One phase: on `getOrSeedAdminSettings`'s existing-row branch, merge
`DEFAULT_PARAMETER_RANGES` as base with the stored row's values
overriding per-key, write back only if that differs from what's stored,
return the merged object either way.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backfill missing range keys on read | Fixed function + regression test | None significant — the write is conditional and idempotent, concurrent first-reads racing to backfill converge on the same deterministic value |

**Prerequisites:** None.
**Estimated effort:** Single phase, well under a session.

## Open Risks & Assumptions

- Assumes no admin has intentionally removed a key from `DEFAULT_PARAMETER_RANGES` that still exists in a stored row (would just pass through unused, harmless).

## Success Criteria (Summary)

- `/simulation` and the admin ranges-editing page both work against the real production DB without crashing.
- A stored row backfills once and stays complete — no repeated backfill work on every read.
