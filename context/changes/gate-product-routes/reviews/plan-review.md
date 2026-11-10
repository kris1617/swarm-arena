<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Gate Product Routes with Login and Roles (F-01)

- **Plan**: context/changes/gate-product-routes/plan.md
- **Mode**: Deep
- **Date**: 2026-11-10
- **Verdict**: REVISE (fixed in triage → SOUND)
- **Findings**: 1 critical, 1 warning, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | FAIL (fixed) |
| Blind Spots | PASS |
| Plan Completeness | WARNING (fixed) |

## Grounding

Grounding: 7/7 paths ✓, 5/5 symbols ✓, brief↔plan ✓

## Findings

### F1 — Session strategy left undecided; default breaks middleware gating

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architectural Fitness
- **Location**: Phase 3 (NextAuth config) and Phase 4 (middleware)
- **Detail**: Phase 3 added `@auth/drizzle-adapter` but never set a session strategy. With an adapter present, NextAuth defaults to database sessions — every `auth()` call, including the one in `middleware.ts`, hits the local sqlite file, which Next.js middleware cannot reach in its default Edge runtime.
- **Fix A**: JWT sessions — middleware decodes a signed cookie, zero DB dependency on the gate path; role set once in the `jwt` callback at sign-in.
  - Strength: Edge-compatible by construction, standard documented NextAuth v5 pattern.
  - Tradeoff: A role change only applies on the user's next sign-in.
  - Confidence: HIGH.
  - Blind spot: Exact v5 callback shapes should be checked against current docs during Phase 3.
- **Fix B ⭐ Chosen**: Force Node.js middleware runtime, keep database sessions
  - Strength: Role changes apply immediately — no JWT staleness.
  - Tradeoff: Adds a DB read to every gated request via `export const runtime = "nodejs"` in `middleware.ts`.
  - Confidence: MEDIUM — Node middleware runtime is stable in Next 16, but DB-per-middleware-request is unproven in this repo.
  - Blind spot: sqlite file lock contention under concurrent middleware requests hasn't been measured.
- **Decision**: FIXED (Fix B) — plan.md Phase 3/4, Implementation Approach, and Critical Implementation Details updated to state the database-session strategy and `runtime: "nodejs"` requirement explicitly; a manual verification step added in Phase 4.

### F2 — Migration command deferred to implementation when it's already known

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 and Migration Notes
- **Detail**: The plan said "check which one deploy script already uses before picking" — but `context/deployment/deploy-plan.md:13` already states production applies schema via `drizzle-kit push` (`npm run db:push`).
- **Fix**: Update Phase 2 and Migration Notes to state definitively: apply via `npm run db:push`.
- **Decision**: FIXED — plan.md Phase 2 and Migration Notes updated to cite `deploy-plan.md:13` directly.
