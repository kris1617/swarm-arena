# Plan Brief: Visual-regression guard for critical/showcase screens

Full plan: `context/changes/test-plan-refresh-2026-11-20/plan.md`

## What & Why

The project's UI-polish changes this session (`color-palette-redesign`,
`reference-pages-content-update`, `login-page-oauth-polish`) were all
verified only by a human/agent manually inspecting screenshots — and one
real bug (a sign-in button whose `w-full` had no visual effect because the
wrapping `<form>` had no width class) was caught *only* that way. This adds
a deterministic, CI-wired screenshot baseline on 7 critical screens so a
future regression like that is caught automatically, plus a local-only
Claude-vision script for the judgment calls a pixel diff can't make.

This change folder is `test-plan.md` §3 rollout Phase 12 — it updates the
strategy guide (Risk #11, new quality gates) *and* implements the phase.

## Starting Point

- 6 kitchen-sink pages + `/simulation` are console-error-smoke-tested
  (`kitchen-sink-smoke-coverage`) but have zero visual assertions.
- E2E is not wired into CI at all today — `deploy.yml`'s `test` job is
  Vitest-only.
- No vision/LLM dependency exists in this project.

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Screens covered | All 6 kitchen-sink pages + `/simulation` (7 total) | Full coverage over the project's design-token-heaviest surfaces, chosen over a narrower 3-screen set |
| Vision layer | Automated Claude-vision script, not just documented | Adds real automated judgment coverage, not just a cookbook note |
| CI gating | Deploy-blocking, via `deploy.yml`'s `test` job | A real visual regression should block deploy the same way a failing unit test does |
| Snapshot granularity | Full-page screenshots | Simpler; accepted tradeoff that unrelated chrome changes will also trip these tests |
| Baseline generation | Official Playwright Docker image, generated locally | Matches CI's `ubuntu-latest` rendering without a GitHub Actions round-trip to update a baseline |
| Diff tolerance | Playwright's built-in default | No custom `maxDiffPixelRatio` — baseline-generation discipline is what's supposed to make exact-match viable |
| Vision-gate strictness | Informational, non-blocking, local-only | A non-deterministic LLM verdict never blocks deploy; `ANTHROPIC_API_KEY` never reaches CI |
| `E2E_TEST_AUTH_SECRET` in CI | Step-scoped to the new CI step only; `route.ts`'s comment narrowed accordingly | Satisfies the route's real security intent (never reachable on the real deployed app) while enabling CI auth on an ephemeral runner |
| Vision API-failure policy | Soft-fail — log and skip, exit 0 | An Anthropic outage never blocks local work for the least-critical layer |

## Phases

1. **Dependencies, env scaffolding, and strategy-guide update** — `@anthropic-ai/sdk`, `ANTHROPIC_API_KEY` schema entry, narrow `route.ts`'s security comment, update `test-plan.md` §2/§3/§5/§8
2. **Deterministic screenshot tests** — new `tests/e2e/visual-regression.spec.ts`, 7 tests, baselines generated locally via Docker
3. **Wire into CI** — add the new spec only (not the whole E2E suite) to `deploy.yml`'s `test` job, deploy-blocking
4. **Local vision-review script** — `scripts/vision-review.ts`, `npm run visual:review`, non-blocking
5. **Cookbook & doc sync** — `test-plan.md` §6, `test-stack.md`, mark Phase 12 complete

**Prerequisites**: none beyond what's in the repo today. **Estimated effort**: 5 phases, roughly a session each — Phase 3 (CI wiring) carries the most risk since it's the first time this project runs Playwright in CI.

## What We're NOT Doing

- Not CI-gating the rest of the E2E suite — only the new spec file
- Not making the vision script a CI/deploy gate or giving it a GitHub secret
- Not adding a custom pixel-diff tolerance
- Not building a `workflow_dispatch` baseline-regeneration pipeline
- Not covering screens beyond these 7 in this phase

## References

- `context/foundation/test-plan.md` §1, §2, §5 (existing principles and gate table)
- `context/changes/test-plan-refresh-2026-11-20/change.md` (accepted refresh brief)
- `context/archive/2026-11-20-test-plan-refresh-2026-11-18/plan.md` (prior refresh-as-rollout-phase precedent)
- `context/archive/2026-11-20-login-page-oauth-polish/` (the concrete bug this phase protects against)
