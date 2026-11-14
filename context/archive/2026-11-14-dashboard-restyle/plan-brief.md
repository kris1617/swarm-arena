# Restyle the post-login dashboard — Brief

Full plan: `context/changes/dashboard-restyle/plan.md`

## What this is

Roadmap S-16 (M-3). A `/10x-ui`-driven audit of `src/app/dashboard/page.tsx` found it's already fully token-compliant — this is not a "replace literal colors" change. It's four concrete charges: two missing-shared-component gaps, one accessibility landmark issue, and one real loading-state bug.

## Starting Point

- Dashboard already uses `from-primary to-background`-style tokens throughout — zero hardcoded-value scan hits.
- Five links are styled to look like buttons via duplicated classNames, with no focus-visible ring (the shared `Button` component has one built in, but these links don't go through it).
- No shared `Checkbox` component exists yet; the comparison selector uses a bare native `<input type="checkbox">`.
- The page's root `<main>` is now nested inside `AppShell`'s own `<main>` (`SidebarInset`, from F-06) — an invalid double landmark, sitewide but fixed here only for this view.
- The empty-state message can flash for returning users with existing runs, because the loading state isn't distinguished from "no runs" in the current `isEmpty` logic.

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Scope | Fix this view only, defer the sitewide-recurring `<main>` and Link-as-button patterns to S-17/S-18 | `/10x-ui`'s one-view-per-change rule; research confirmed the same patterns in `simulation`/`runs/*` pages |
| Checkbox | Add via `npx shadcn@latest add checkbox` | Same CLI path F-06 used for `sidebar`; no new dependency decision |
| Loading fix | Gate on query `isPending`, reuse existing `skeleton.tsx` | Already installed as a sidebar transitive dependency; no new primitive needed |
| Questions asked | Zero | Research fully resolved every decision with concrete, unambiguous fixes |

## Phases

1. **Add the Checkbox primitive** — `npx shadcn@latest add checkbox`, no usage yet.
2. **Apply the four fixes** — Button-wrap the 5 links, swap in Checkbox, `<main>`→`<div>`, add loading skeleton.
3. **States verification** — confirm all 7 states (error is N/A, reasoned explicitly), screenshot desktop + mobile.

**Prerequisites**: F-06 (done, archived). **Estimated effort**: small — one file's worth of edits plus one CLI-installed primitive, no new business logic.

## References

- `context/changes/dashboard-restyle/research.md`
- `context/archive/2026-11-14-ui-design-system-foundation/plan.md`
