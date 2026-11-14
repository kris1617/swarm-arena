<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Time-boxed, self-service admin elevation for any account

- **Plan**: context/changes/temporary-admin-elevation/plan.md
- **Mode**: Deep
- **Date**: 2026-11-14
- **Verdict**: REVISE
- **Findings**: 1 critical, 1 warning, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL |
| Plan Completeness | PASS |

## Grounding

5/5 paths confirmed to exist. 5/5 riskiest claims verified against actual code (adminProcedure's exact check, type-augmentation compatibility, blast radius of `role`-reading call sites — none missed, session-callback DB-freshness under the `database` strategy, migration tooling, existing test pattern). Brief↔plan consistent. Progress↔Phase headings match 1:1 across all 3 phases.

## Findings

### F1 — Open GitHub sign-up + prerequisite-free self-elevation = any stranger can become admin

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 2, Change 2 (elevateSelf)
- **Detail**: Confirmed via code: `src/server/auth/config.ts` has no `signIn` callback, no org-membership check, no allowlist — GitHub OAuth sign-in is open to any GitHub account. The plan's `elevateSelf` is a `protectedProcedure` with no admin prerequisite (by design, to prevent self-lockout). The combination means: anyone on the internet can sign in via GitHub, become a "member," then immediately call `elevateSelf` and gain admin — including the ability to mutate `adminSettings` (parameter ranges, object-count cap, flockCount range), which are global/shared, not scoped to their own account. This consequence follows directly from the "self always allowed" decision made during planning, but that decision's own stated tradeoff ("would need rethinking before a second real account with less trust joined") undersold the risk — there already effectively IS no trust boundary on who can sign up at all.
- **Fix A ⭐ Recommended**: Gate `elevateSelf` on `ADMIN_EMAILS` membership, not just "any logged-in user"
  - Strength: Closes the escalation hole completely by reusing the exact trust boundary (`ADMIN_EMAILS` env var) this app already relies on for bootstrap — zero new config. Still avoids a self-lockout: the real user's email stays in `ADMIN_EMAILS`, so they can always self-elevate/revert. Other already-admin accounts can still grant admin to further accounts via `elevateAccount`, unaffected.
  - Tradeoff: Self-elevation is no longer "any logged-in user" — a future trusted member not in `ADMIN_EMAILS` would need an existing admin to grant them access via `elevateAccount` rather than self-serving, which is already consistent with the "others require already-admin" rule.
  - Confidence: HIGH — reuses an existing, already-trusted mechanism; no new moving parts.
  - Blind spot: If `ADMIN_EMAILS` is ever empty/misconfigured in production, self-elevation becomes unreachable for everyone — same failure mode `ADMIN_EMAILS` already has today for the bootstrap-admin path, not a new risk this introduces.
- **Fix B**: Add an `ALLOW_SELF_ELEVATION` env flag, default off
  - Strength: Keeps the mechanism fully generic for a future multi-trusted-user scenario.
  - Tradeoff: Doesn't close the hole by default — relies on the deployer remembering to leave it off in production, the exact "forgot to configure it" risk the time-boxed design was meant to avoid in the first place.
  - Confidence: MEDIUM — functionally sound but reintroduces a configuration-remembering burden.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix B — `ALLOW_SELF_ELEVATION` env flag, default off; see plan.md Phase 2 change 4)

### F2 — Email lookup for elevateAccount/revertAccount is case-sensitive

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2, Change 2 (elevateAccount/revertAccount)
- **Detail**: `users.email` has no `COLLATE NOCASE`, so a Drizzle `eq(users.email, input.email)` lookup is an exact, case-sensitive match — unlike `ADMIN_EMAILS`'s own bootstrap check, which explicitly lowercases both sides before comparing (config.ts:31). A correctly-spelled but differently-cased email input would incorrectly throw `BAD_REQUEST` even though the account exists.
- **Fix**: Lowercase both the input email and the comparison (or use SQL `LOWER()`) in `elevateAccount`/`revertAccount`'s lookup, matching `ADMIN_EMAILS`'s existing normalization.
- **Decision**: FIXED (plan.md Phase 2 change 2 updated with case-insensitive comparison)
