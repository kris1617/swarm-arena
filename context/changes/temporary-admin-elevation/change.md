---
change_id: temporary-admin-elevation
title: Time-boxed, self-service admin elevation for any account
status: plan_reviewed
created: 2026-11-14
updated: 2026-11-14
archived_at: null
---

## Notes

Roadmap S-22 (M-3, "Modernization and polish"). No prerequisites — ready, parallel with everything else in M-3. PRD ref FR-030, Open Question #6 (mechanism explicitly deferred to `/10x-plan`, now resolved below).

**Current state**: `users.role` (`member`/`admin` enum) already exists. `ADMIN_EMAILS` permanently seeds `admin` once, at account creation (`src/server/auth/config.ts`'s `createUser` event) — unrelated, pre-existing bootstrap mechanism, untouched by this change. `adminProcedure` (`src/server/api/trpc.ts:164-169`) gates mutations on `ctx.session.user.role === "admin"`. `/admin/settings` (`src/app/admin/settings/page.tsx`) is the one existing admin-only page, gated the same way. No UI or mutation path exists today to change `role` after account creation except a manual DB edit.

**Resolved decisions** (3 questions during `/10x-plan`'s interview):
1. **Mechanism**: time-boxed grant, auto-expiring — elevating sets `role: "admin"` + a new `elevatedUntil` timestamp; authorization checks `role === "admin" AND (elevatedUntil === null OR now < elevatedUntil)`, so access lapses on its own with no cron job needed.
2. **Scope**: supports elevating any account by id/email, not just self.
3. **Who can grant**: any logged-in user can always elevate/revert their OWN account (no admin prerequisite — this is what bootstraps the single real user and prevents a lockout); elevating a DIFFERENT account requires the caller already be (effectively) admin.
