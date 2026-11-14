---
change_id: dashboard-restyle
title: Restyle the post-login dashboard onto the F-06 design-system contract
status: implementing
created: 2026-11-14
updated: 2026-11-14
archived_at: null
---

## Notes

Roadmap S-16 (M-3, "Modernization and polish"). Depends only on F-06 (`ui-design-system-foundation`, done, archived) — no dependency on S-15.

**Target view:** `src/app/dashboard/page.tsx` (the post-login landing page, wrapped in `AppShell`'s sidebar shell since F-06).

**Design-system variant:** Existing system (Tailwind v4 + shadcn/ui, the course variant). Values live in `src/styles/globals.css` (`:root`/`.dark` + `@theme inline`); components live in `src/components/ui/`. Extend, don't fork.

**Pre-audit findings (10x-ui Step 2):**
- Hardcoded-value scan on `dashboard/page.tsx`: **zero hits** — the view is already fully token-compliant (`bg-input`, `bg-background`, `text-foreground`, `bg-foreground/35`, etc.), no literal hex/rgb/palette classes. This is NOT a missing-tokens case.
- `src/components/ui/` has: `button.tsx`, `input.tsx`, `separator.tsx`, `sheet.tsx`, `sidebar.tsx`, `skeleton.tsx`, `switch.tsx`, `tooltip.tsx`. No `checkbox.tsx` — the dashboard's "select run for comparison" control is a bare `<input type="checkbox" className="size-4 shrink-0">`, not a shared component.
- Several `<Link>` elements are manually styled to look like buttons (`className="bg-input text-foreground hover:bg-foreground/35 rounded-full px-10 py-3 font-semibold"` repeated near-verbatim across "Start a simulation", "View", "View analysis", "Compare selected" — 5 occurrences) instead of going through the `Button` component (which the page already imports and uses elsewhere for the filter pills and the disabled "Compare selected" state). This is a missing-shared-component / duplicated-primitive charge, not a token charge.
- `AGENTS.md`'s UI section is current (tokens, shared components, no-literal-colors rule) — no stale rule to fix.

Rules file to extend if a guard is needed: `AGENTS.md` (`## UI` section).
