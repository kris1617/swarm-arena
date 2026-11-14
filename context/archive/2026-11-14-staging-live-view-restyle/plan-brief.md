# Restyle the simulation staging form and live view — Brief

Full plan: `context/changes/staging-live-view-restyle/plan.md`

## What this is

Roadmap S-17 (M-3). A `/10x-ui`-driven audit of `src/app/simulation/page.tsx` found it's already in better shape than the dashboard was — token-compliant, with 4 existing mutation error states already handled. Three real charges: one accidental-architecture issue (shared with S-16's fix), one missing-shared-component gap, one minor loading-state gap.

## Starting Point

- Zero hardcoded-value scan hits — not a color/token change.
- Page's root `<main>` is nested inside `AppShell`'s own `<main>` (`SidebarInset`, from F-06) — identical to the issue S-16 just fixed on the dashboard.
- 12 near-identical hand-assembled `<label>`+`<Input type="number">` blocks — a duplication-drift risk, not yet user-visible.
- The running/saved run-list panels render nothing until their query resolves — milder than dashboard's analogous bug (no misleading message, just a visible pop-in).

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Scope | Fix this view only, defer `runs/*` pages' identical `<main>` issue to S-18 | `/10x-ui`'s one-view-per-change rule |
| NumberField location | `src/components/ui/number-field.tsx` (shared, not page-local) | Genuinely reusable composite per `AGENTS.md`'s "shared components live in `src/components/ui`" rule |
| Charge 3 (loading skeleton) | Included in scope | User confirmed during planning — closes the view's only remaining loading-state gap in one pass |
| Questions asked | One (Charge 3's scope) | Research resolved everything else; this was the one genuine ambiguity |

## Phases

1. **Build `NumberField`** — new shared component wrapping the existing `Input`, no usage yet.
2. **Apply the three fixes** — `<main>`→`<div>`, swap 12 blocks for `NumberField`, add loading skeleton for run-list panels.
3. **States verification** — confirm all 7 states, explicitly re-checking "error"/"empty" N/A reasoning against the actual hooks (per the lesson S-16's impl-review recorded), screenshot desktop + mobile.

**Prerequisites**: F-06 (done, archived). **Estimated effort**: small — one new composite component plus one file's worth of edits, no new business logic.

## References

- `context/changes/staging-live-view-restyle/research.md`
- `context/archive/2026-11-14-dashboard-restyle/`
- `context/foundation/lessons.md` (the states-matrix-N/A lesson this plan's Phase 3 applies)
