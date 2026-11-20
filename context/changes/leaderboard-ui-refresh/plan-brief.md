# Leaderboard view modernization pass — Plan Brief

> Full plan: `context/changes/leaderboard-ui-refresh/plan.md`
> Research: `context/changes/leaderboard-ui-refresh/research.md`

## What & Why

`/10x-ui`'s audit of the leaderboard found zero token drift but a clear missing-shared-component opportunity: its row markup maps directly onto `RunRow`, a component `dashboard-ui-refresh` deliberately placed under `src/components/` so this exact change could adopt it without re-extracting.

## Starting Point

`src/app/leaderboard/page.tsx` (95 lines) already uses semantic tokens correctly. Its row (rank + run info + score + 2 conditional badges + action link) is a hand-rolled near-duplicate of `RunRow`, differing only by a top-3 `border-primary` border variant `RunRow` doesn't support yet.

## Desired End State

The leaderboard looks visually identical but renders through `RunRow`, which now accepts an optional `className` for the top-3 variant. The error/empty blocks no longer duplicate their container markup. A kitchen-sink page at `/leaderboard/kitchen-sink` proves the state matrix plus the className variant.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| `RunRow` widening | Add optional `className?: string`, merged via `cn()` | `cn()` is this repo's established className-merge idiom (already used in 3+ shadcn components); confirmed backward-compatible with `dashboard-ui-refresh`'s 3 existing callers, which all omit the prop. | Research |
| Status-card duplication | Stays local (no shared component) | Confirmed ceiling of exactly 2 instances (dashboard, leaderboard) — `runs/[runId]`/`runs/compare` already use `StatusMessage` instead, so no third consumer will ever need it. | Research |
| Badge spans | Stay as inline conditional spans, no extraction | 2 call sites with differing data sources in 1 file is below this repo's observed shared-component threshold. | Research |
| `AGENTS.md` | No new edit | The `RunRow`/`Tabs` guard note added during `dashboard-ui-refresh` already names both components generically — it already covers this view. | Research |

## Scope

**In scope:** `RunRow`'s `className` widening, leaderboard's adoption of it, local error/empty dedup, a leaderboard kitchen-sink page.

**Out of scope:** `runs/[runId]`/`runs/compare` (S-48's own change, and they already use `StatusMessage` correctly), a new `Badge` primitive, a new `AGENTS.md` note, any data-fetching/ranking-logic change.

## Architecture / Approach

Presentation-only refactor in 2 phases, mirroring `dashboard-ui-refresh`'s own successful shape. Phase 1 widens and adopts `RunRow`; Phase 2 proves the state matrix including the new `className`-variant composition.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Leaderboard component refactor | `RunRow` widened + adopted, error/empty dedup | Low — the widening is additive; regression-checked against dashboard's 3 existing callers |
| 2. States gate | Kitchen-sink page incl. className-variant proof | Low — mirrors an existing, working pattern |

**Prerequisites:** None — `RunRow`/`cn()` already exist.
**Estimated effort:** 2 phases, single session each.

## Open Risks & Assumptions

- None — research resolved every material decision with direct evidence before this plan was written.

## Success Criteria (Summary)

- Leaderboard renders and behaves identically to today (rank, score, badges, top-3 border, error/empty/loading).
- `RunRow`'s widening causes zero visual regression on `dashboard-ui-refresh`'s 3 existing call sites.
- The next agent adopting `RunRow` elsewhere finds the `className` override already documented by its own type signature.
