# Export a run's parameters, score, and history — Plan Brief

> Full plan: `context/changes/run-export/plan.md`

## What & Why

Roadmap S-14. Let the user export a completed run's parameters, score, and history outside the app — in JSON (full-fidelity) or CSV (parameters + score, spreadsheet-friendly) — closing FR-017, the last of the three nice-to-have FRs M-1 deferred.

## Starting Point

No export capability exists anywhere in the codebase. `simulationRuns` already has every field an export needs; nothing new is persisted. The only non-tRPC Route Handler precedent is `test-auth/login/route.ts` (different auth model, same shape).

## Desired End State

On a completed run's analysis page (`/runs/[runId]`), the user clicks "Export JSON" or "Export CSV" and gets a downloaded file named `run-<id>.json`/`.csv`. Another user's run, a non-existent run, or a still-running run errors instead of downloading.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Export formats | JSON (full-fidelity) + CSV (parameters + score only) | Already resolved product decision — see PRD FR-017 | Prior (user, 2026-11-14) |
| Trigger location | `/runs/[runId]` analysis page, not the dashboard | That page already requires a completed run; keeps the dashboard uncluttered | Plan |
| Architecture | A plain Next.js Route Handler (`/api/runs/[runId]/export`), not a tRPC procedure | tRPC always returns JSON; a Route Handler can set `Content-Disposition` for a real file download and return either format cleanly | Plan |
| Ownership/status gating | Mirrors `getRunAnalysis`'s exact shape (403 forbidden, 400 not-completed) | Same risk, same established pattern — no reason to invent a new gate shape | Plan |
| Testability | CSV/JSON formatting extracted into a plain function (`buildRunExport`), separate from the Route Handler | Mirrors an existing project lesson: framework glue (sessions, `NextRequest`) is awkward to unit-test directly; pure logic should be extractable | Plan |

## Scope

**In scope:**
- `buildRunExport` — plain JSON/CSV formatter, unit-tested directly.
- `GET /api/runs/[runId]/export?format=json|csv` — authenticated, ownership/status-gated download route.
- Two export links on `/runs/[runId]`'s analysis page.

**Out of scope:**
- Dashboard export controls.
- Export for `running`/`saved` runs.
- Any format beyond JSON/CSV (no image export).
- Bulk/multi-run export.

## Architecture / Approach

Thin Route Handler (auth + ownership/status gate) delegates to a plain formatter function. Two phases: backend route + formatter, then the UI links.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend | `buildRunExport` + the export route, fully gated and tested | Getting the ownership/status gate exactly right (matching `getRunAnalysis`) |
| 2. UI links | Two export links on the analysis page | None significant — a direct `<a>` download, no new state |

**Prerequisites:** F-05 (done, archived) — export reads data F-05 already persists.
**Estimated effort:** 2 phases, smaller than S-12's.

## Open Risks & Assumptions

- Assumes CSV's lack of quoting/escaping logic is safe because every exported value is a number, boolean, or ISO date string (never free text) — true today; would need revisiting if a free-text field (e.g. a run name/label) is ever added to `simulationRuns`.

## Success Criteria (Summary)

- A completed run's owner can download a correct JSON and a correct CSV export from its analysis page.
- Another user's run, a non-existent run, or a running run cannot be exported.
- No regression to `/runs/[runId]`'s existing analysis rendering.
