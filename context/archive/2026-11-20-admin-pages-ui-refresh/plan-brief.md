# Admin pages modernization pass — Plan Brief

> Full plan: `context/changes/admin-pages-ui-refresh/plan.md`
> Research: `context/changes/admin-pages-ui-refresh/research.md`

## What & Why

`/10x-ui`'s audit corrected the roadmap's own prior "admin pages never restyled" claim — they already use design tokens correctly — but found two real charges: a genuine `<main>`-landmark accessibility bug on the settings page, and 19 hand-rolled inputs that should adopt the existing `NumberField` component.

## Starting Point

Both admin pages/forms already use `bg-input`/`bg-background`/`rounded-full` tokens correctly. `admin/settings/page.tsx`'s root element is `<main>` (should be `<div>`, same bug class `AGENTS.md` already documents and every other audited view already avoids). `NumberField` exists and is used elsewhere (`simulation/page.tsx`) but neither admin form adopts it yet.

## Desired End State

`admin/settings` has exactly one `<main>` landmark. Both forms render their number inputs through `NumberField` (now accepting an optional `className`). A kitchen-sink page proves the forms' real states.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Landmark bug | Fix now, isolated phase | A genuine accessibility bug (two nested `<main>`s), not a style nit — the clearest, smallest fix in M-12. | Research |
| `NumberField` widening | Add optional `className?: string`, merged via `cn()` | Exact same precedent `RunRow` already established; confirmed backward-compatible since no existing caller (`simulation/page.tsx`) passes one today. | Research |
| `target-email` text input | Stays as-is, no new component | One occurrence doesn't meet this repo's extraction threshold. | Research |
| Phase structure | 3 phases, not 2 | Isolates the trivial 1-line landmark fix from the larger 19-call-site refactor, per explicit user request. | User |

## Scope

**In scope:** the landmark fix, `NumberField` widening + adoption in both admin forms, an admin kitchen-sink page.

**Out of scope:** a new `TextField` component, the forms' loading/success inline text, mutation/validation logic, `simulation/page.tsx`'s existing `NumberField` usage (beyond confirming it's unaffected).

## Architecture / Approach

Presentation-only refactor in 3 phases. Phase 1 fixes the landmark bug in isolation; Phase 2 widens and adopts `NumberField`; Phase 3 proves the real states.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Landmark fix | `<main>` → `<div>` on admin/settings | Trivial — tag-name-only change |
| 2. NumberField widening & adoption | 19 call sites refactored | Low — widening follows an established, already-proven precedent |
| 3. States gate | Kitchen-sink page for the real surface | Low — mirrors an established pattern |

**Prerequisites:** None.
**Estimated effort:** 3 phases, single session each.

## Open Risks & Assumptions

- None — research resolved both material decisions with direct evidence before this plan was written.

## Success Criteria (Summary)

- `/admin/settings` has one `<main>` landmark, not two.
- Both admin forms render and behave identically to today.
- `simulation/page.tsx`'s existing `NumberField` usage is unaffected by the widening.
