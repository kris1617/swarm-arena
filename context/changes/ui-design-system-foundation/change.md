---
change_id: ui-design-system-foundation
title: Shared app shell and extended design tokens (shadcn-admin-dashboard pattern)
status: impl_reviewed
created: 2026-11-14
updated: 2026-11-14
archived_at: null
---

## Notes

Roadmap F-06 (M-3, 2026-11-14, "Modernization and polish"). Minimal
cross-cutting enabler: a shared app shell (sidebar nav) and extended
design tokens, following `next-shadcn-admin-dashboard`'s structural
pattern (Next.js App Router + shadcn/ui + Tailwind, MIT-licensed —
confirmed via web research as adoptable incrementally since this app
already uses shadcn/ui primitives). Demonstrated end-to-end on the
login page (S-15, the next change) before any other page adopts it.
Explicitly bounded — this is NOT a full redesign; see roadmap Risk
line and PRD FR-032's Non-Goal ("No full UI rewrite onto a new
template").
