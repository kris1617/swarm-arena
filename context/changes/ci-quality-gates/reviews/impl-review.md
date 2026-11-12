<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Quality-Gates Wiring Implementation Plan

- **Plan**: context/changes/ci-quality-gates/plan.md
- **Scope**: Phase 1 of 1 (Full plan)
- **Reviewed phases**: 1
- **Date**: 2026-11-12
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Build/migrate steps needed more env vars and an extra step than the plan specified

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — already resolved and verified; recorded for the historical record only
- **Dimension**: Plan Adherence
- **Location**: .github/workflows/deploy.yml:17-41
- **Detail**: The plan's Contract (plan.md:50) specified only `SKIP_ENV_VALIDATION: "1"` on the build step and four gated commands (build, typecheck, check, test), with no separate migrate step. The first real CI run (43299493103) failed: `next build` executes server code during static page-data collection (`/_not-found`), which eagerly constructs the libsql client via `env.DATABASE_URL` — `SKIP_ENV_VALIDATION` only bypasses Zod validation, not the value lookup, so `DATABASE_URL` was `undefined` and `createClient` threw `URL_INVALID`. After adding `DATABASE_URL`/`AUTH_SECRET`/`AUTH_GITHUB_ID`/`AUTH_GITHUB_SECRET` (mirroring `vitest.config.ts`'s own test env) to the build step, a second run failed on `npm test`: a fresh checkout's `db.sqlite` has no schema, so `simulation.test.ts`'s real-DB fixtures hit `SQLITE_ERROR: no such table`. A `Migrate test database` step (`npm run db:migrate`, same dummy env) was added before `npm test` to fix this. Both fixes are fix-forward commits (5f4191d, 48a9e36) landed after the phase's original commit (ec641e3), exactly the kind of gap only a real Actions run could reveal — which plan.md:64 and plan-brief.md:49/57 both flagged in advance as the one thing local verification couldn't prove.
- **Fix**: None needed — already fixed and verified green on a real CI run (43300550632: `test` 1m7s, `deploy` ran after it). No deploy secrets were touched; all added env values are dummy test constants matching the existing `vitest.config.ts` pattern, not real secrets.
- **Decision**: ACCEPTED (no action — captured for history; plan.md Progress item 1.6 and the plan-brief's "Open Risks" already anticipated exactly this class of gap)
