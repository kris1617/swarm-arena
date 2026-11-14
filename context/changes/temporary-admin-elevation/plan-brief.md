# Time-boxed, self-service admin elevation — Brief

Full plan: `context/changes/temporary-admin-elevation/plan.md`

## What this is

Roadmap S-22 (M-3), FR-030. A reversible path to the `admin` role: elevation auto-expires on its own (no cron), and any logged-in user can always self-elevate/self-revert (no prerequisite), while elevating a *different* account requires the caller already be admin.

## Starting Point

- `users.role` already exists (`member`/`admin`); `ADMIN_EMAILS` permanently seeds admin once at account creation — untouched, unrelated bootstrap mechanism.
- `adminProcedure` and `/admin/settings`'s page check both gate on raw `role === "admin"` today, with no expiry concept and no way to change `role` after creation except a manual DB edit.

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Mechanism | Time-boxed grant, auto-expiring (`elevatedUntil` timestamp, checked lazily) | A real "temporary" guarantee without needing a scheduled job |
| Scope | Any account by email, not just self | Matches FR-030's literal wording; user explicitly asked for this over the simpler self-only default |
| Who can grant | Self always allowed (no prerequisite); granting *another* account requires caller already be effectively admin | Prevents a self-lockout (reverting your own admin status would otherwise strand you) while still blocking arbitrary members from granting admin to other accounts |

## Phases

1. **Schema + helper** — `elevatedUntil` column on `users`; a shared `isEffectivelyAdmin(user)` function.
2. **Mutations + wiring** — `elevateSelf`/`revertSelf`/`elevateAccount`/`revertAccount`/`listElevatedAccounts`; `adminProcedure` and the NextAuth session callback both route through the shared helper.
3. **UI** — a new `/admin/elevation` page: self-service controls for anyone, cross-account controls only when currently effectively admin.

**Prerequisites**: none (roadmap-ready). **Estimated effort**: medium — one schema migration, a new router, and authorization logic touching two existing check sites, so correctness matters more than code volume here.

## References

- `src/server/db/schema.ts`, `src/server/auth/config.ts`, `src/server/api/trpc.ts` (existing mechanisms extended)
- `context/foundation/prd.md` FR-030, Open Question #6
- `context/foundation/roadmap.md` S-22
